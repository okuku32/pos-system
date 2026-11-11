const Customer = require('../models/Customer');
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const { signCustomer } = require('../middleware/customerAuth');
const { formatPhone } = require('../utils/mpesa');
const { httpError } = require('../utils/saleService');
const { ownerOrder } = require('../utils/realtime');
const { verifyGoogleCredential } = require('../utils/oauth');
const crypto = require('crypto');
const { sendMail } = require('../utils/mailer');
const templates = require('../utils/emailTemplates');
const { settings } = require('../tenancy/tenants');

const RESET_MINUTES = 30;
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

const clean = (s, max) => String(s || '').replace(/[<>]/g, '').trim().slice(0, max);
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const publicCustomer = (c) => ({ _id: c._id, name: c.name, email: c.email, phone: c.phone || '', address: c.address || '', avatar: c.avatar || '', authProvider: c.authProvider || 'password' });

function phoneOr400(phone) {
  try {
    return formatPhone(phone);
  } catch {
    throw httpError('Please enter a valid Kenyan mobile number, e.g. 0712 345 678');
  }
}

// POST /api/customers/register { name, email, phone, password }
exports.register = asyncHandler(async (req, res) => {
  const name = clean(req.body.name, 60);
  const email = clean(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) throw httpError('Please enter your name');
  if (!EMAIL_RX.test(email)) throw httpError('Please enter a valid email address');
  const phone = phoneOr400(req.body.phone);
  if (password.length < 6) throw httpError('Password must be at least 6 characters');

  if (await Customer.exists({ email })) throw httpError('An account with this email already exists. Try logging in.', 409);
  if (await Customer.exists({ phone })) throw httpError('An account with this phone number already exists. Try logging in.', 409);

  const c = await Customer.create({ name, email, phone, password });
  res.status(201).json({ token: signCustomer(c._id), customer: publicCustomer(c) });
});

// POST /api/customers/login { login: email or phone, password }
exports.login = asyncHandler(async (req, res) => {
  const login = clean(req.body.login, 120);
  const password = String(req.body.password || '');
  let query;
  if (login.includes('@')) query = { email: login.toLowerCase() };
  else {
    try {
      query = { phone: formatPhone(login) };
    } catch {
      query = null;
    }
  }
  const c = query && (await Customer.findOne(query).select('+password'));
  if (c && c.active && !c.password) {
    return res.status(401).json({ message: 'This account uses Google sign-in. Tap “Continue with Google”.' });
  }
  if (!c || !c.active || !(await c.matchPassword(password))) {
    return res.status(401).json({ message: 'Incorrect email/phone or password' });
  }
  res.json({ token: signCustomer(c._id), customer: publicCustomer(c) });
});

exports.me = (req, res) => res.json(publicCustomer(req.customer));

// POST /api/customers/oauth/google { credential }: sign up or log in with Google
exports.google = asyncHandler(async (req, res) => {
  const g = await verifyGoogleCredential(req.body.credential);
  let c = await Customer.findOne({ googleId: g.googleId });
  let created = false;
  if (!c) {
    c = await Customer.findOne({ email: g.email });
    if (c) {
      // existing email/password account: link Google to it
      if (!c.active) return res.status(401).json({ message: 'This account is disabled' });
      c.googleId = g.googleId;
      if (!c.avatar) c.avatar = g.avatar;
      await c.save();
    } else {
      c = await Customer.create({ name: g.name.slice(0, 60), email: g.email, googleId: g.googleId, avatar: g.avatar, authProvider: 'google' });
      created = true;
    }
  }
  if (!c.active) return res.status(401).json({ message: 'This account is disabled' });
  res.status(created ? 201 : 200).json({ token: signCustomer(c._id), customer: publicCustomer(c), created });
});

// POST /api/customers/forgot-password { email }
// Always gives the same answer, whether or not the email has an account (so it can't be used to find customers).
exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  if (!EMAIL_RX.test(email)) throw httpError('Please enter a valid email address');
  const generic = { message: 'If an account exists for that email, we’ve sent a link to reset the password. Check your inbox (and spam folder).' };

  const c = await Customer.findOne({ email });
  if (!c || !c.active) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  await Customer.updateOne({ _id: c._id }, { $set: { resetTokenHash: hashToken(token), resetTokenExpires: new Date(Date.now() + RESET_MINUTES * 60000) } });
  const link = `${settings().shopUrl}/shop/reset-password?token=${token}`;
  sendMail({ to: c.email, ...templates.passwordReset(c, link, RESET_MINUTES) }); // in the background; never blocks or errors the request
  res.json(generic);
});

// POST /api/customers/reset-password { token, password }: sets the new password and logs the customer in
exports.resetPassword = asyncHandler(async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw httpError('This reset link is invalid. Please request a new one.');
  if (password.length < 6) throw httpError('Password must be at least 6 characters');
  const c = await Customer.findOne({ resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires');
  if (!c || !c.active) throw httpError('This reset link has expired or was already used. Please request a new one.');
  c.password = password; // hashed by the model before saving
  c.resetTokenHash = undefined; // single use
  c.resetTokenExpires = undefined;
  c.passwordChangedAt = new Date(); // signs out other devices
  await c.save();
  res.json({ message: 'Your password has been changed', token: signCustomer(c._id), customer: publicCustomer(c) });
});

// PUT /api/customers/me { name, phone, address }
exports.updateMe = asyncHandler(async (req, res) => {
  const c = req.customer;
  if (req.body.name !== undefined) {
    const name = clean(req.body.name, 60);
    if (name.length < 2) throw httpError('Please enter your name');
    c.name = name;
  }
  if (req.body.phone !== undefined) {
    const phone = phoneOr400(req.body.phone);
    if (phone !== c.phone && (await Customer.exists({ phone }))) throw httpError('That phone number is used by another account', 409);
    c.phone = phone;
  }
  if (req.body.address !== undefined) c.address = clean(req.body.address, 200);
  await c.save();
  res.json(publicCustomer(c));
});

// GET /api/customers/orders — the customer's own orders, newest first
exports.myOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ customerAccount: req.customer._id }).sort('-createdAt').limit(50);
  res.json(orders.map(ownerOrder));
});
