// Real-time events over Socket.IO.
//  - Staff (staff JWT) join "staff" and get every order event.
//  - A logged-in customer (customer JWT) joins "customer:<id>" and gets updates for all of their orders.
//  - Anyone holding an order's secret tracking token can join "track:<token>" for that one order.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io = null;

function init(httpServer) {
  io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL || '*' } });

  io.on('connection', async (socket) => {
    const { token, customerToken, track, support } = socket.handshake.auth || {};

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.typ !== 'customer') {
          const user = await User.findById(decoded.id);
          if (user && user.active) socket.join('staff');
        }
      } catch {
        /* invalid token: anonymous socket */
      }
    }

    if (customerToken) {
      try {
        const { verifyCustomerToken } = require('../middleware/customerAuth');
        const c = await verifyCustomerToken(customerToken);
        if (c) socket.join(`customer:${c._id}`);
      } catch {
        /* invalid token */
      }
    }

    if (typeof track === 'string' && /^[a-f0-9]{32}$/.test(track)) socket.join(`track:${track}`);
    // A customer following their own support conversation (secret token, no login needed)
    if (typeof support === 'string' && /^[a-f0-9]{32}$/.test(support)) socket.join(`support:${support}`);
  });

  return io;
}

// What anyone with the tracking link may see (no phone number, no address)
function publicOrder(o) {
  return {
    orderNo: o.orderNo,
    status: o.status,
    stage: o.stage,
    type: o.type,
    customer: { name: o.customer?.name },
    items: o.items.map((i) => ({ name: i.name, price: i.price, listPrice: i.listPrice, quantity: i.quantity, subtotal: i.subtotal })),
    subtotal: o.subtotal,
    discount: o.discount,
    savings: o.savings || 0,
    total: o.total,
    stageHistory: (o.stageHistory || []).map((h) => ({ stage: h.stage, at: h.at })),
    eta: o.eta || null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

// What the logged-in owner of the order sees (adds their address and the tracking link)
function ownerOrder(o) {
  return { ...publicOrder(o), trackingToken: o.trackingToken, address: o.customer?.address || '' };
}

function emitOrder(event, order) {
  if (!io || !order) return;
  io.to('staff').emit(event, order);
  if (order.trackingToken) io.to(`track:${order.trackingToken}`).emit('order:status', publicOrder(order));
  const owner = order.customerAccount?._id || order.customerAccount;
  if (owner) io.to(`customer:${owner}`).emit('order:status', ownerOrder(order));
}

// Support chat: staff get every conversation update; the customer only gets their own
function emitSupport(event, thread) {
  if (!io || !thread) return;
  const last = thread.messages[thread.messages.length - 1];
  io.to('staff').emit(event, {
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
    messages: thread.messages.map((m) => ({ id: m._id, from: m.from, staffName: m.from === 'staff' ? m.staffName : undefined, text: m.text, at: m.at })),
    unread: thread.unreadByCustomer,
  });
}

// Plain staff-only event (e.g. a sale finished, so every till refreshes its Today totals)
function emitStaff(event, data) {
  if (io) io.to('staff').emit(event, data);
}

module.exports = { init, emitOrder, publicOrder, ownerOrder, emitSupport, emitStaff };
