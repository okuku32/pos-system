// Real-time events over Socket.IO.
//  - Staff (staff JWT) join "staff" and get every order event.
//  - A logged-in customer (customer JWT) joins "customer:<id>" and gets updates for all of their orders.
//  - Anyone holding an order's secret tracking token can join "track:<token>" for that one order.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { currentTenant, runAsTenant } = require('../tenancy/context');
const { resolveTenant } = require('../tenancy/tenants');
const { tokenMatchesTenant } = require('../tenancy/tokens');

// Channel names are prefixed with the client, e.g. "demo:staff", so clients never see each other's events
const room = (name, tenant = currentTenant()) => `${tenant.slug}:${name}`;

let io = null;

function init(httpServer) {
  io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL || '*' } });

  io.on('connection', async (socket) => {
    const { token, customerToken, track, support } = socket.handshake.auth || {};
    const h = socket.handshake.headers || {};
    const tenant = await resolveTenant({
      host: String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim(),
      headerTenant: socket.handshake.auth?.tenant,
    }).catch(() => null);
    if (!tenant || tenant.unknown || tenant.status === 'suspended') return socket.disconnect(true);
    await runAsTenant(tenant, () => joinRooms(socket, tenant, { token, customerToken, track, support }));
  });

  return io;
}

async function joinRooms(socket, tenant, { token, customerToken, track, support }) {
  const R = (name) => room(name, tenant);
  {
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.typ !== 'customer') {
          if (tokenMatchesTenant(decoded, tenant)) {
            const user = await User.findById(decoded.id);
            if (user && user.active) socket.join(R('staff'));
          }
        }
      } catch {
        /* invalid token: anonymous socket */
      }
    }

    if (customerToken) {
      try {
        const { verifyCustomerToken } = require('../middleware/customerAuth');
        const c = await verifyCustomerToken(customerToken);
        if (c) socket.join(R(`customer:${c._id}`));
      } catch {
        /* invalid token */
      }
    }

    if (typeof track === 'string' && /^[a-f0-9]{32}$/.test(track)) socket.join(R(`track:${track}`));
    // A customer following their own support conversation (secret token, no login needed)
    if (typeof support === 'string' && /^[a-f0-9]{32}$/.test(support)) socket.join(R(`support:${support}`));
  }
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
  if (!io || !order || !currentTenant()) return;
  io.to(room('staff')).emit(event, order);
  if (order.trackingToken) io.to(room(`track:${order.trackingToken}`)).emit('order:status', publicOrder(order));
  const owner = order.customerAccount?._id || order.customerAccount;
  if (owner) io.to(room(`customer:${owner}`)).emit('order:status', ownerOrder(order));
}

// Support chat: staff get every conversation update; the customer only gets their own
function emitSupport(event, thread) {
  if (!io || !thread || !currentTenant()) return;
  const last = thread.messages[thread.messages.length - 1];
  io.to(room('staff')).emit(event, {
    _id: thread._id,
    ticketNo: thread.ticketNo,
    customer: thread.customer,
    status: thread.status,
    unreadByStaff: thread.unreadByStaff,
    lastMessage: last,
  });
  io.to(room(`support:${thread.token}`)).emit('support:update', {
    ticketNo: thread.ticketNo,
    status: thread.status,
    messages: thread.messages.map((m) => ({ id: m._id, from: m.from, staffName: m.from === 'staff' ? m.staffName : undefined, text: m.text, at: m.at })),
    unread: thread.unreadByCustomer,
  });
}

// Plain staff-only event (e.g. a sale finished, so every till refreshes its Today totals)
function emitStaff(event, data) {
  if (io && currentTenant()) io.to(room('staff')).emit(event, data);
}

// Marketplace: a private event for one customer (new chat message, read receipts)
function emitCustomer(customerId, event, data) {
  if (io && currentTenant() && customerId) io.to(room(`customer:${customerId}`)).emit(event, data);
}

module.exports = { emitCustomer, init, emitOrder, publicOrder, ownerOrder, emitSupport, emitStaff };
