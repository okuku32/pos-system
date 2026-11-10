// Customer support messaging: customers (logged in or not) start a conversation; staff reply from the POS.
const crypto = require('crypto');
const SupportThread = require('../models/SupportThread');
const asyncHandler = require('../utils/asyncHandler');
const { httpError } = require('../utils/saleService');
const { formatPhone } = require('../utils/mpesa');
const { verifyCustomerToken } = require('../middleware/customerAuth');
const { emitSupport } = require('../utils/realtime');
const notify = require('../utils/notify');

const TOPICS = ['order', 'delivery', 'payment', 'product', 'other'];
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s, max) => String(s ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const tokenOk = (t) => /^[a-f0-9]{32}$/.test(String(t || ''));

// What the customer sees of their conversation
const customerView = (t) => ({
  ticketNo: t.ticketNo,
  token: t.token,
  status: t.status,
  topic: t.topic,
  orderNo: t.orderNo,
  customer: { name: t.customer?.name },
  messages: t.messages.map((m) => ({ id: m._id, from: m.from, staffName: m.from === 'staff' ? m.staffName : undefined, text: m.text, at: m.at })),
  unread: t.unreadByCustomer,
  createdAt: t.createdAt,
});

// Optional: if a logged-in shop customer is starting the chat, link it to their account
async function optionalCustomer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    return await verifyCustomerToken(h.slice(7));
  } catch {
    return null;
  }
}

// ---------------- customer side (no login required) ----------------

// POST /api/support/threads { name, email, phone, topic, orderNo, message }
exports.start = asyncHandler(async (req, res) => {
  const account = await optionalCustomer(req);
  const name = clean(req.body.name || account?.name, 60);
  const email = clean(req.body.email || account?.email, 120).toLowerCase();
  const rawPhone = clean(req.body.phone || account?.phone, 20);
  const text = clean(req.body.message, 2000);

  if (name.length < 2) throw httpError('Please tell us your name');
  if (email && !EMAIL_RX.test(email)) throw httpError('That email address doesn’t look right');
  let phone = '';
  if (rawPhone) {
    try {
      phone = formatPhone(rawPhone);
    } catch {
      throw httpError('That phone number doesn’t look right, e.g. 0712 345 678');
    }
  }
  if (!email && !phone) throw httpError('Please give us an email or phone number so we can get back to you');
  if (text.length < 2) throw httpError('Please type your message');

  const thread = await SupportThread.create({
    token: crypto.randomBytes(16).toString('hex'),
    customer: { name, email: email || undefined, phone: phone || undefined },
    customerAccount: account?._id,
    topic: TOPICS.includes(req.body.topic) ? req.body.topic : 'other',
    orderNo: clean(req.body.orderNo, 30) || undefined,
    messages: [{ from: 'customer', text }],
    unreadByStaff: 1,
  });
  emitSupport('support:new', thread);
  res.status(201).json(customerView(thread));
});

// GET /api/support/threads/:token
exports.get = asyncHandler(async (req, res) => {
  if (!tokenOk(req.params.token)) throw httpError('Conversation not found', 404);
  const t = await SupportThread.findOne({ token: req.params.token });
  if (!t) throw httpError('Conversation not found', 404);
  res.json(customerView(t));
});

// POST /api/support/threads/:token/messages { message }
exports.customerMessage = asyncHandler(async (req, res) => {
  if (!tokenOk(req.params.token)) throw httpError('Conversation not found', 404);
  const text = clean(req.body.message, 2000);
  if (!text) throw httpError('Please type your message');
  const t = await SupportThread.findOneAndUpdate(
    { token: req.params.token },
    {
      $push: { messages: { from: 'customer', text, at: new Date() } },
      $inc: { unreadByStaff: 1 },
      $set: { status: 'open', lastMessageAt: new Date() }, // a new message reopens a closed conversation
    },
    { returnDocument: 'after' }
  );
  if (!t) throw httpError('Conversation not found', 404);
  emitSupport('support:message', t);
  res.status(201).json(customerView(t));
});

// POST /api/support/threads/:token/read: customer has seen staff replies
exports.customerRead = asyncHandler(async (req, res) => {
  if (!tokenOk(req.params.token)) throw httpError('Conversation not found', 404);
  const t = await SupportThread.findOneAndUpdate({ token: req.params.token }, { $set: { unreadByCustomer: 0 } }, { returnDocument: 'after' });
  if (!t) throw httpError('Conversation not found', 404);
  res.json({ ok: true });
});

// ---------------- staff side ----------------

const staffSummary = (t) => ({
  _id: t._id,
  ticketNo: t.ticketNo,
  customer: t.customer,
  hasAccount: !!t.customerAccount,
  topic: t.topic,
  orderNo: t.orderNo,
  status: t.status,
  unreadByStaff: t.unreadByStaff,
  lastMessage: t.messages[t.messages.length - 1],
  messageCount: t.messages.length,
  lastMessageAt: t.lastMessageAt,
  createdAt: t.createdAt,
});

// GET /api/support?status=open&q=
exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ticketNo: rx }, { 'customer.name': rx }, { 'customer.email': rx }, { 'customer.phone': rx }, { orderNo: rx }];
  }
  const [threads, unread, open] = await Promise.all([
    SupportThread.find(filter).sort('-lastMessageAt').limit(200),
    SupportThread.aggregate([{ $group: { _id: null, n: { $sum: '$unreadByStaff' } } }]),
    SupportThread.countDocuments({ status: 'open' }),
  ]);
  res.json({ threads: threads.map(staffSummary), unread: unread[0]?.n || 0, open });
});

// GET /api/support/:id: full conversation; marks it read
exports.staffGet = asyncHandler(async (req, res) => {
  const t = await SupportThread.findByIdAndUpdate(req.params.id, { $set: { unreadByStaff: 0 } }, { returnDocument: 'after' });
  if (!t) throw httpError('Conversation not found', 404);
  emitSupport('support:read', t);
  res.json({ ...staffSummary(t), messages: t.messages });
});

// POST /api/support/:id/reply { message }
exports.reply = asyncHandler(async (req, res) => {
  const text = clean(req.body.message, 2000);
  if (!text) throw httpError('Type a reply first');
  const t = await SupportThread.findByIdAndUpdate(
    req.params.id,
    {
      $push: { messages: { from: 'staff', staffName: req.user.name, text, at: new Date() } },
      $inc: { unreadByCustomer: 1 },
      $set: { unreadByStaff: 0, lastMessageAt: new Date(), status: 'open' },
    },
    { returnDocument: 'after' }
  );
  if (!t) throw httpError('Conversation not found', 404);
  emitSupport('support:message', t);
  notify.supportReply(t, text, req.user.name); // email the customer if they gave an email
  res.status(201).json({ ...staffSummary(t), messages: t.messages });
});

// PATCH /api/support/:id { status: 'open' | 'closed' }
exports.setStatus = asyncHandler(async (req, res) => {
  const status = req.body.status === 'closed' ? 'closed' : 'open';
  const t = await SupportThread.findByIdAndUpdate(req.params.id, { $set: { status } }, { returnDocument: 'after' });
  if (!t) throw httpError('Conversation not found', 404);
  emitSupport('support:message', t);
  res.json({ ...staffSummary(t), messages: t.messages });
});
