// Who is online right now: a logged-in customer with the site open (any tab, phone or computer, the Android app).
// Counted from their live connections (Socket.IO). A short grace period covers moving between pages,
// so a seller doesn't flicker "offline" while the next page loads. "Last seen" is saved on the account.
//
// Several servers (REDIS_URL): each server keeps a short-lived "online" key in Redis for the people connected to
// it (refreshed every 30 s), so any server can tell whether someone is online on any of them.
const redis = require('./redis');

const live = new Map(); // customer id → open connections (on this server)
const leftAt = new Map(); // customer id → when their last connection here closed
const GRACE = 45 * 1000;
const KEY = (id) => `kapu:online:${id}`;
const TTL = 90 * 1000;

const save = (id) => {
  const Customer = require('../models/Customer');
  Customer.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
};
const mark = (id, ms) => {
  if (redis.ready()) redis.client().set(KEY(id), '1', 'PX', ms).catch(() => {});
};

let beating = null;
function heartbeat() {
  if (beating || !redis.enabled()) return;
  beating = setInterval(() => {
    if (!redis.ready() || !live.size) return;
    const pipe = redis.client().pipeline();
    for (const id of live.keys()) pipe.set(KEY(id), '1', 'PX', TTL);
    pipe.exec().catch(() => {});
  }, 30 * 1000);
  beating.unref?.();
}

function connected(id) {
  id = String(id);
  heartbeat();
  const was = live.get(id) || 0;
  live.set(id, was + 1);
  leftAt.delete(id);
  mark(id, TTL);
  if (!was) save(id);
}

function disconnected(id) {
  id = String(id);
  const number = (live.get(id) || 1) - 1;
  if (number > 0) return live.set(id, number);
  live.delete(id);
  leftAt.set(id, Date.now());
  mark(id, GRACE); // still "online" for the grace period (another server's heartbeat keeps it if they're there)
  save(id);
  if (leftAt.size > 20000) for (const [key, value] of leftAt) if (Date.now() - value > GRACE) leftAt.delete(key);
}

const isOnline = (id) => live.has(String(id)) || Date.now() - (leftAt.get(String(id)) || 0) < GRACE;

// many at once, across all servers: Map id → online
async function onlineMap(ids) {
  const list = ids.map(String);
  const out = new Map(list.map((id) => [id, isOnline(id)]));
  if (!redis.ready() || !list.length) return out;
  try {
    const values = await redis.client().mget(...list.map(KEY));
    list.forEach((id, index) => { if (values[index]) out.set(id, true); });
  } catch {
    /* Redis unavailable: this server's view */
  }
  return out;
}

module.exports = { connected, disconnected, isOnline, onlineMap };
