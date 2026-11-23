// Customer support messaging: customers (logged in or not) start a conversation; staff reply from the POS.
const crypto = require('crypto');
const SupportThread = require('../models/SupportThread');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { formatPhone } = require('../utils/mpesa');
const { verifyCustomerToken } = require('../middleware/customerAuth');
const { emitSupport } = require('../utils/realtime');
const notify = require('../utils/notify');

const TOPICS = ['order', 'delivery', 'payment', 'product', 'other'];
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (text, max) => String(text ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const tokenOk = (value) => /^[a-f0-9]{32}$/.test(String(value || ''));
// the conversation's secret lives in an httpOnly cookie (not in the page's storage): "/threads/me/…" uses it
const { readCookie, setCookie, secureReq } = require('../security/session');
const remember = (req, res, token) => setCookie(res, 'os_support', token, { maxAge: 180 * 24 * 3600e3, sameSite: 'lax', secure: secureReq(req) });
exports.useCookieToken = (req, res, next) => {
  if (req.params.token === 'me') req.params.token = readCookie(req, 'os_support') || '';
  next();
};
// POST /api/support/session { token }: an emailed link (/help?chat=<token>) or an older page moves the secret into the cookie
exports.session = asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '');
  if (!tokenOk(token) || !(await SupportThread.exists({ token: token }))) throw httpError('Conversation not found', 404);
  remember(req, res, token);
  res.json({ ok: true });
});

// What the customer sees of their conversation
const customerView = (order) => ({
  ticketNo: order.ticketNo,
  // (the secret token is NOT sent to the page: it lives in an httpOnly cookie)
  status: order.status,
  topic: order.topic,
  orderNo: order.orderNo,
  customer: { name: order.customer?.name },
  messages: order.messages.map((message) => ({ id: message._id, from: message.from, staffName: message.from === 'staff' ? message.staffName : undefined, text: message.text, at: message.at })),
  unread: order.unreadByCustomer,
  createdAt: order.createdAt,
});

// Optional: if a logged-in shop customer is starting the chat, link it to their account
async function optionalCustomer(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return null;
  try {
    return await verifyCustomerToken(authorization.slice(7));
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
  remember(req, res, thread.token);
  res.status(201).json(customerView(thread));
});

// GET /api/support/threads/:token
exports.get = asyncHandler(async (req, res) => {
  if (!tokenOk(req.params.token)) throw httpError('Conversation not found', 404);
  const thread = await SupportThread.findOne({ token: req.params.token });
  if (!thread) throw httpError('Conversation not found', 404);
  res.json(customerView(thread));
});

// POST /api/support/threads/:token/messages { message }
exports.customerMessage = asyncHandler(async (req, res) => {
  if (!tokenOk(req.params.token)) throw httpError('Conversation not found', 404);
  const text = clean(req.body.message, 2000);
  if (!text) throw httpError('Please type your message');
  const thread = await SupportThread.findOneAndUpdate(
    { token: req.params.token },
    {
      $push: { messages: { from: 'customer', text, at: new Date() } },
      $inc: { unreadByStaff: 1 },
      $set: { status: 'open', lastMessageAt: new Date() }, // a new message reopens a closed conversation
    },
    { returnDocument: 'after' }
  );
  if (!thread) throw httpError('Conversation not found', 404);
  emitSupport('support:message', thread);
  res.status(201).json(customerView(thread));
});

// POST /api/support/threads/:token/read: customer has seen staff replies
exports.customerRead = asyncHandler(async (req, res) => {
  if (!tokenOk(req.params.token)) throw httpError('Conversation not found', 404);
  const thread = await SupportThread.findOneAndUpdate({ token: req.params.token }, { $set: { unreadByCustomer: 0 } }, { returnDocument: 'after' });
  if (!thread) throw httpError('Conversation not found', 404);
  res.json({ ok: true });
});

// ---------------- staff side ----------------

const staffSummary = (order) => ({
  _id: order._id,
  ticketNo: order.ticketNo,
  customer: order.customer,
  hasAccount: !!order.customerAccount,
  topic: order.topic,
  orderNo: order.orderNo,
  status: order.status,
  unreadByStaff: order.unreadByStaff,
  lastMessage: order.messages[order.messages.length - 1],
  messageCount: order.messages.length,
  lastMessageAt: order.lastMessageAt,
  createdAt: order.createdAt,
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
    SupportThread.find(filter).sort('-lastMessageAt').limit(200).lean(),
    SupportThread.aggregate([{ $group: { _id: null, n: { $sum: '$unreadByStaff' } } }]),
    SupportThread.countDocuments({ status: 'open' }),
  ]);
  res.json({ threads: threads.map(staffSummary), unread: unread[0]?.n || 0, open });
});

// GET /api/support/:id: full conversation; marks it read
exports.staffGet = asyncHandler(async (req, res) => {
  const thread = await SupportThread.findByIdAndUpdate(req.params.id, { $set: { unreadByStaff: 0 } }, { returnDocument: 'after' });
  if (!thread) throw httpError('Conversation not found', 404);
  emitSupport('support:read', thread);
  res.json({ ...staffSummary(thread), messages: thread.messages });
});

// POST /api/support/:id/reply { message }
exports.reply = asyncHandler(async (req, res) => {
  const text = clean(req.body.message, 2000);
  if (!text) throw httpError('Type a reply first');
  const thread = await SupportThread.findByIdAndUpdate(
    req.params.id,
    {
      $push: { messages: { from: 'staff', staffName: req.user.name, text, at: new Date() } },
      $inc: { unreadByCustomer: 1 },
      $set: { unreadByStaff: 0, lastMessageAt: new Date(), status: 'open' },
    },
    { returnDocument: 'after' }
  );
  if (!thread) throw httpError('Conversation not found', 404);
  emitSupport('support:message', thread);
  notify.supportReply(thread, text, req.user.name); // email the customer if they gave an email
  res.status(201).json({ ...staffSummary(thread), messages: thread.messages });
});

// PATCH /api/support/:id { status: 'open' | 'closed' }
exports.setStatus = asyncHandler(async (req, res) => {
  const status = req.body.status === 'closed' ? 'closed' : 'open';
  const thread = await SupportThread.findByIdAndUpdate(req.params.id, { $set: { status } }, { returnDocument: 'after' });
  if (!thread) throw httpError('Conversation not found', 404);
  emitSupport('support:message', thread);
  res.json({ ...staffSummary(thread), messages: thread.messages });
});
