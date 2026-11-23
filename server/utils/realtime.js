// Live updates over Socket.IO.
//  - Admins / moderators (staff token) join "admin": new orders, reported ads, support messages.
//  - A logged-in user (customer token) joins "user:<id>": their chats and their orders, as buyer and as seller.
//  - Anyone with a support conversation's secret token joins "support:<token>" (no account needed).
const { Server } = require('socket.io');
const User = require('../models/User');
const session = require('../security/session');
const { staffMay, STAFF_AREAS } = require('../security/rbac');

// which part of the admin panel an event belongs to: moderators only get the areas they were given
const AREA = { order: 'orders', work: 'orders', plan: 'orders', agreement: 'orders', boost: 'orders', seller: 'sellers', listing: 'ads', report: 'ads', support: 'support' };
const areaOf = (event) => AREA[String(event).split(':')[0]] || null;

let io = null;

function init(httpServer) {
  const allowed = require('../security/csrf').allowedOrigins();
  io = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)), credentials: true },
    // a browser socket from another site is refused (the session cookie would otherwise ride along)
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      try {
        return cb(null, new URL(origin).host === req.headers.host || require('../security/csrf').allowedOrigins().includes(origin));
      } catch {
        return cb(null, false);
      }
    },
    maxHttpBufferSize: 1e5,
  });
  // several servers (REDIS_URL): a message emitted on one server reaches people connected to any of them
  const redis = require('./redis');
  if (redis.enabled()) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      io.adapter(createAdapter(redis.client(), redis.subscriber(), { key: 'kapu:io' }));
    } catch (error) {
      console.error('[realtime] Redis adapter not available, live updates stay on this server:', error.message);
    }
  }
  io.on('connection', async (socket) => {
    const auth = socket.handshake.auth || {};
    const jar = session.parseCookies(socket.handshake.headers.cookie);
    const pick = (base) => jar[`__Host-${base}`] || jar[base];
    const token = typeof auth.token === 'string' ? auth.token : pick(session.POLICY.staff.cookie);
    const customerToken = typeof auth.customerToken === 'string' ? auth.customerToken : pick(session.POLICY.customer.cookie);
    // support chat: its secret is in an httpOnly cookie now ("me"); a token sent by older pages still works
    const support = auth.support === 'me' ? pick('os_support') : auth.support;
    if (token) {
      try {
        const decoded = await session.check(token, 'staff');
        const user = decoded && (await User.findById(decoded.id));
        if (user && user.active && (decoded.tv || 0) === (user.tokenVersion || 0) && !user.mustChangePassword) {
          if (user.role === 'admin' || user.role === 'owner') socket.join('admin');
          for (const staffArea of STAFF_AREAS) if (staffMay(user, `area.${staffArea}`)) socket.join(`admin:${staffArea}`);
        }
      } catch {
        /* invalid token: anonymous socket */
      }
    }
    if (customerToken) {
      try {
        const { verifyCustomerToken } = require('../middleware/customerAuth');
        const customer = await verifyCustomerToken(customerToken);
        if (customer) {
          socket.join(`user:${customer._id}`);
          // online / offline badge for sellers
          const presence = require('./presence');
          presence.connected(customer._id);
          socket.on('disconnect', () => presence.disconnected(customer._id));
          // 📞 in-app calls: set up between the two people's connections (market/calls.js)
          require('../market/calls').attach(io, socket, customer);
        }
      } catch {
        /* invalid token */
      }
    }
    if (typeof support === 'string' && /^[a-f0-9]{32}$/.test(support)) socket.join(`support:${support}`);
  });
  return io;
}

// A private event for one user (chat message, order update...)
function emitCustomer(customerId, event, data) {
  if (io && customerId) io.to(`user:${customerId}`).emit(event, data);
}

// Something the admins should see
function emitAdmin(event, data) {
  if (!io) return;
  const area = areaOf(event);
  // admins are in every area room too, so one emit reaches each allowed person once
  if (area) io.to(`admin:${area}`).emit(event, data);
  else io.to('admin').emit(event, data);
}

// Support chat: admins get every conversation update; the customer only gets their own
function emitSupport(event, thread) {
  if (!io || !thread) return;
  const last = thread.messages[thread.messages.length - 1];
  io.to('admin:support').emit(event, {
    _id: thread._id,
    ticketNo: thread.ticketNo,
    customer: thread.customer,
    status: thread.status,
    unreadByStaff: thread.unreadByStaff,
    lastMessage: last,
  });
  io.to(`support:${thread.token}`).emit('support:update', {
    ticketNo: thread.ticketNo,
    status: thread.status,
    messages: thread.messages.map((message) => ({ id: message._id, from: message.from, staffName: message.from === 'staff' ? message.staffName : undefined, text: message.text, at: message.at })),
    unread: thread.unreadByCustomer,
  });
}

module.exports = { init, emitCustomer, emitAdmin, emitSupport, emitStaff: emitAdmin, server: () => io };
