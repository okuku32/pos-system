// 📞 In-app voice calls (buyer → seller), browser to browser with WebRTC. The server only passes the messages that set
// the call up ("signalling") between the two people's live connections; the voice itself goes directly between them
// (or through a TURN relay when their networks need one).
//
//   caller  call:start { to }                      → ack { callId, sig, to, iceServers }   (callee gets call:incoming)
//   either  call:signal { callId, sig, from, to, kind, data }   kind: accept | decline | busy | offer | answer | ice | end
//
// Rules: you must be logged in; you can call a seller (not yourself); a few calls a minute at most.
// Seller offline: their phones get a "📞 … is calling you" push (Android app), and the call waits for them for a minute:
// as soon as they open the app or the site, it rings there and they can answer. A call is identified by a signed id (callId + the two people), so any server can check a message belongs
// to that call without keeping state, and only those two people can send messages for it.
// A call that wasn't answered leaves the seller a 🔔 "Missed call" notification.
//
// Voice relay (needed on some mobile networks): set TURN_URLS (comma-separated, e.g. turn:turn.example.com:3478),
// TURN_USERNAME and TURN_CREDENTIAL in server/.env. Without them only direct (STUN) connections are tried.
const crypto = require('crypto');
const mongoose = require('mongoose');

const KINDS = ['accept', 'decline', 'busy', 'offer', 'answer', 'ice', 'end'];
const secret = () => process.env.CALL_SECRET || process.env.JWT_SECRET || 'calls';
const sign = (callId, from, to) => crypto.createHmac('sha256', secret()).update(`${callId}|${from}|${to}`).digest('hex').slice(0, 32);
const validSig = (call) => {
  if (!call || typeof call.sig !== 'string' || !/^[a-f0-9]{32}$/.test(call.sig) || !/^[a-f0-9]{24}$/.test(String(call.callId))) return false;
  const expected = sign(call.callId, call.from, call.to);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(call.sig));
};

function iceServers() {
  const list = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((url) => url.trim()).filter(Boolean) }];
  const turn = (process.env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);
  if (turn.length) list.push({ urls: turn, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  return list;
}

// a few calls a minute per caller (per server)
const recent = new Map();
function tooMany(id) {
  const now = Date.now();
  const list = (recent.get(id) || []).filter((at) => now - at < 60 * 1000);
  if (list.length >= 5) return true;
  list.push(now);
  recent.set(id, list);
  if (recent.size > 5000) for (const [key, value] of recent) if (!value.some((at) => now - at < 60 * 1000)) recent.delete(key);
  return false;
}

// ---------------------------------------------------------------- calls waiting for an offline seller
// callee id → the call (until it's answered, ended or a minute passes). Redis when there are several servers.
const WAIT_MS = 60 * 1000;
const waiting = new Map();
const waitKey = (id) => `kapu:call-wait:${id}`;
async function holdCall(calleeId, incoming) {
  const redis = require('../utils/redis');
  waiting.set(calleeId, { incoming, until: Date.now() + WAIT_MS });
  if (redis.ready()) await redis.client().set(waitKey(calleeId), JSON.stringify(incoming), 'PX', WAIT_MS).catch(() => {});
}
async function waitingCall(calleeId) {
  const redis = require('../utils/redis');
  const local = waiting.get(calleeId);
  if (local && local.until > Date.now()) return local.incoming;
  waiting.delete(calleeId);
  if (!redis.ready()) return null;
  const raw = await redis.client().get(waitKey(calleeId)).catch(() => null);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function dropCall(calleeId, callId) {
  const redis = require('../utils/redis');
  if (waiting.get(calleeId)?.incoming.callId === callId) waiting.delete(calleeId);
  if (!redis.ready()) return;
  const raw = await redis.client().get(waitKey(calleeId)).catch(() => null);
  if (raw && raw.includes(callId)) await redis.client().del(waitKey(calleeId)).catch(() => {});
}
// wake the seller's phones (Android app push); true when at least one phone can get it
async function ringPhones(calleeId, callerName, callId) {
  const push = require('../utils/push');
  if (!push.enabled()) return false;
  const PushDevice = require('../models/PushDevice');
  if (!(await PushDevice.exists({ customer: calleeId }))) return false;
  push.notify(calleeId, { kind: 'call', icon: '📞', title: `${firstName(callerName)} is calling you`, body: 'Tap to open Kapu and answer the call', link: `/market/messages?call=${callId}` });
  return true;
}

// ---------------------------------------------------------------- rider ↔ buyer, during a delivery
// Once a rider has accepted a delivery (or shopping errand), the rider and the buyer can call each other about it,
// until it's done: { task } instead of { to }. Returns the other person's id, or null.
const RIDE_LIVE = ['assigned', 'picked_up', 'delivered'];
async function otherOnRide(taskId, me) {
  if (!mongoose.isValidObjectId(taskId)) return null;
  const Task = require('../models/Task');
  const task = await Task.findById(taskId).select('kind status worker order errand').lean();
  if (!task || !RIDE_LIVE.includes(task.status) || !task.worker) return null;
  // an inspection: our agent and the seller whose goods they check
  if (task.kind === 'inspection') {
    const seller = task.order ? (await require('../models/Order').findById(task.order).select('seller').lean())?.seller : null;
    if (!seller) return null;
    if (me === String(task.worker)) return String(seller);
    if (me === String(seller)) return String(task.worker);
    return null;
  }
  if (!['delivery', 'shopping'].includes(task.kind)) return null;
  let buyer = null;
  if (task.order) buyer = (await require('../models/Order').findById(task.order).select('buyer').lean())?.buyer;
  else if (task.errand) buyer = (await require('../models/Errand').findById(task.errand).select('customer').lean())?.customer;
  if (!buyer) return null;
  const rider = String(task.worker);
  if (me === rider) return String(buyer);
  if (me === String(buyer)) return rider;
  return null;
}

const isSeller = (person) => person.accountType === 'seller' || (person.sellerTypes || []).length > 0;
const firstName = (name) => String(name || 'Someone').split(' ')[0];

async function missedCall(calleeId, callerName) {
  const alerts = require('./alerts');
  const who = firstName(callerName);
  await alerts.send(calleeId, {
    kind: 'call', icon: '📞', link: '/market/messages',
    title: { en: `Missed call from ${who}`, sw: `Simu uliyokosa kutoka kwa ${who}` },
    body: { en: `${who} called you in the app. Call them back, or reply in your chats.`, sw: `${who} alikupigia kwenye programu. Mpigie tena, au jibu kwenye ujumbe.` },
  }).catch(() => {});
}

// called for every logged-in connection (utils/realtime.js)
function attach(io, socket, customer) {
  const me = String(customer._id);
  const Customer = require('../models/Customer');
  const presence = require('../utils/presence');

  socket.on('call:start', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      // { to: sellerId } a seller · { task: taskId } the rider or the buyer on a delivery that's under way
      const ride = payload?.task != null;
      const to = ride ? await otherOnRide(String(payload.task), me) : String(payload?.to || '');
      if (ride && !to) return reply({ error: 'Calls open once the rider has accepted the delivery, until it’s done' });
      if (!mongoose.isValidObjectId(to)) return reply({ error: 'Choose who to call' });
      if (to === me) return reply({ error: 'You can’t call yourself' });
      if (tooMany(me)) return reply({ error: 'Too many calls. Please wait a minute.' });
      const callee = await Customer.findById(to).select('name avatar accountType sellerTypes active').lean();
      if (!callee || callee.active === false || (!ride && !isSeller(callee))) return reply({ error: 'This person can’t be called in the app' });
      const online = (await presence.onlineMap([to])).get(to);
      const callId = crypto.randomBytes(12).toString('hex');
      const call = { callId, from: me, to, sig: sign(callId, me, to) };
      const servers = iceServers();
      const incoming = { ...call, caller: { _id: me, name: customer.name, avatar: customer.avatar || '' }, iceServers: servers };
      // the call waits up to a minute (a seller who just reconnects, or opens the app from the push, still gets it)
      await holdCall(to, incoming);
      let reach = 'online';
      if (online) io.to(`user:${to}`).emit('call:incoming', incoming);
      else reach = (await ringPhones(to, customer.name, callId)) ? 'push' : 'waiting'; // offline: wake their phones
      reply({ ...call, callee: { _id: to, name: callee.name, avatar: callee.avatar || '' }, iceServers: servers, offline: !online, reach, waitSeconds: online ? undefined : WAIT_MS / 1000 });
    } catch (error) {
      console.error('call:start', error.message);
      reply({ error: 'The call couldn’t start. Please try again.' });
    }
  });

  // I just came online (opened the app from the "is calling you" push, or the site): a call waiting for me rings now
  waitingCall(me).then((incoming) => { if (incoming) socket.emit('call:incoming', incoming); }).catch(() => {});

  socket.on('call:signal', (payload) => {
    if (!payload || !KINDS.includes(payload.kind) || !validSig(payload)) return;
    const from = String(payload.from);
    const to = String(payload.to);
    if (me !== from && me !== to) return; // only the two people on the call
    const other = me === from ? to : from;
    const message = { callId: payload.callId, sig: payload.sig, from, to, kind: payload.kind, by: me, device: typeof payload.device === 'string' ? payload.device.slice(0, 40) : undefined, reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 20) : undefined };
    if (['offer', 'answer', 'ice'].includes(payload.kind)) message.data = payload.data;
    io.to(`user:${other}`).emit('call:signal', message);
    // the callee's other tabs / phones stop ringing once one of them answers or declines
    if (['accept', 'decline', 'busy'].includes(payload.kind) && me === to) io.to(`user:${me}`).emit('call:signal', { ...message, kind: 'taken' });
    if (['accept', 'decline', 'busy', 'end'].includes(payload.kind)) dropCall(to, payload.callId);
    // the caller gave up before anyone answered: the seller gets a missed call
    if (payload.kind === 'end' && me === from && ['no-answer', 'cancelled'].includes(payload.reason)) missedCall(to, customer.name);
  });
}

module.exports = { attach, sign, validSig, iceServers, isSeller, otherOnRide, WAIT_MS };
