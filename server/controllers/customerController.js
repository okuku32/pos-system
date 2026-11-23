const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const geo = require('../market/geo');
const { COUNTIES } = require('../market/categories');
const { invalidate } = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');
const { issueCustomer, verifyLegacyToken } = require('../middleware/customerAuth');
const session = require('../security/session');
const { audit } = require('../security/audit');
const { v: value, normalizeEmail, validEmail } = require('../security/validate');
const { formatPhone } = require('../utils/mpesa');
const httpError = require('../utils/httpError');
const { verifyGoogleCredential } = require('../utils/oauth');
const crypto = require('crypto');
const { sendMail } = require('../utils/mailer');
const templates = require('../utils/emailTemplates');
const { site } = require('../config/site');

const RESET_MINUTES = 30;
const VERIFY_HOURS = 24; // the email verification link
const RESEND_GAP_MS = 60 * 1000; // at most one verification email a minute per account
const MAX_FAILS = 5; // wrong passwords in a row before the account is locked…
const LOCK_MINUTES = 15; // …for this long
// unknown accounts still cost one bcrypt comparison, so response times don't reveal which accounts exist
let dummyHash = null;
const DUMMY_CHECK = async (entryValue) => {
  const bcrypt = require('bcryptjs');
  dummyHash ||= await bcrypt.hash(crypto.randomBytes(12).toString('hex'), 11); // same cost as real passwords
  return bcrypt.compare(String(entryValue), dummyHash);
};
const hashToken = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

const clean = (text, max) => String(text || '').replace(/[<>]/g, '').trim().slice(0, max);
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const shopView = (text) =>
  text?.point?.coordinates
    ? {
        name: text.name || '', address: text.address || '', area: text.area || '', county: text.county || '', placeId: text.placeId || '', lat: text.point.coordinates[1], lng: text.point.coordinates[0], public: !!text.public,
        kinds: text.kinds || [], wear: text.wear || [], stall: text.stall || '', market: text.market && text.marketSlug ? { _id: text.market, name: text.marketName, slug: text.marketSlug } : null,
        walk: text.walk?.enabled ? require('../market/walk').publicWalk(text.walk) : { enabled: false },
        hours: text.hours && (text.hours.always || text.hours.days?.length) ? { always: !!text.hours.always, days: text.hours.days || [], override: text.hours.override?.state ? text.hours.override : null, status: require('../market/hours').openState(text.hours) } : null,
      }
    : null;
const chemistView = (ch) => ({ status: ch?.status || 'none', licenceNo: ch?.licenceNo || '', premises: ch?.premises || '', pharmacist: ch?.pharmacist || '', reviewNote: ch?.reviewNote || '' });
const KINDS = ['shop', 'wholesaler', 'boutique', 'mama-mboga', 'samaki', 'market-stall', 'chemist', 'electronics', 'spares', 'baby-shop', 'grocery', 'importer'];
// a new seller's types (optional): only known shop types, at most 5
// what a seller is and sells (sign-up, My account): checked in market/sellerProfile.js
const { sellerTypesFrom, sellerCategoriesFrom, sellerItemsFrom, sellerProfileFrom, tradeFrom, withTradeCategories } = require('../market/sellerProfile');
const tradeView = (trade) => ({ wholesale: trade?.wholesale || [], imports: trade?.imports || [], importFrom: trade?.importFrom || [], vehicles: trade?.vehicles || [], spares: trade?.spares || [] });
const WEARS = ['men', 'women', 'kids'];
// A new seller: what they sell and where (sellerProfileFrom), and how they get paid (required): M-Pesa Till,
// Paybill + account, Pochi la Biashara or Send Money. Buyers paying on delivery see it on their order.
function sellerPayFrom(body = {}) {
  if (!body.payDetails?.method) throw httpError('Add how you get paid: M-Pesa Till, Paybill, Pochi la Biashara or Send Money');
  return require('../market/pay').cleanPay(body.payDetails, httpError, formatPhone);
}
const sellerSignupFrom = (body) => ({ ...sellerProfileFrom(body), payDetails: sellerPayFrom(body) });

const publicCustomer = (customer) => ({ payDetails: require('../market/pay').publicPay(customer.payDetails), payConnect: customer.payConnect?.shortcode ? { connected: true, shortcode: customer.payConnect.shortcode, env: customer.payConnect.env, connectedAt: customer.payConnect.connectedAt } : { connected: false }, shopLocation: shopView(customer.shopLocation), chemist: chemistView(customer.chemist), _id: customer._id, name: customer.name, email: customer.email, phone: customer.phone || '', address: customer.address || '', county: customer.county || '', about: customer.about || '', accountType: customer.accountType || 'buyer', sellerTypes: customer.sellerTypes || [], sellerCategories: customer.sellerCategories || [], sellerItems: customer.sellerItems || [], trade: tradeView(customer.trade), tradeAsked: !!customer.tradeAskedAt, sellerArea: customer.shopLocation?.area || '', worker: customer.worker?.role ? { role: customer.worker.role, status: customer.worker.status || 'pending' } : null, avatar: customer.avatar || '', authProvider: customer.authProvider || 'password', createdAt: customer.createdAt, verified: !!customer.verified, verifyRequest: customer.verifyRequest?.status || 'none', verifyNote: customer.verifyRequest?.reviewNote || '', rating: customer.rating || { avg: 0, count: 0 }, completedSales: customer.completedSales || 0, businessBoostUntil: customer.businessBoostUntil > new Date() ? customer.businessBoostUntil : null });

function phoneOr400(phone) {
  try {
    return formatPhone(phone);
  } catch {
    throw httpError('Please enter a valid Kenyan mobile number, e.g. 0712 345 678');
  }
}

// POST /api/customers/register { name, email, phone, password }
// POST /api/customers/register { name, email, phone, password, confirmPassword, accountType?, sellerTypes? }
// The account is saved with emailVerified: false and a verification email goes out (your SMTP, via the queue).
// Nobody is logged in here: they log in after confirming the email. The answer is the same whether or not the email
// already has an account (so sign-up can't be used to find out who has one); that owner gets an email instead.
// A role is never taken from this request: everyone signs up as a customer (accountType is only buyer / seller).
const sendVerification = async (customer) => {
  const token = crypto.randomBytes(32).toString('hex');
  await Customer.updateOne({ _id: customer._id }, { $set: { verifyTokenHash: hashToken(token), verifyTokenExpires: new Date(Date.now() + VERIFY_HOURS * 3600e3), verifySentAt: new Date() } });
  sendMail({ to: customer.email, ...templates.verifyEmail(customer, `${site().url}/verify-email?token=${token}`, VERIFY_HOURS) });
};
exports.register = asyncHandler(async (req, res) => {
  const name = clean(req.body.name, 60).replace(/\s+/g, ' ');
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (name.length < 2 || !/\p{L}/u.test(name)) throw httpError('Please enter your full name');
  if (!validEmail(email)) throw httpError('Please enter a valid email address');
  const phone = phoneOr400(req.body.phone);
  value.newPassword({ name, email })(password); // strong enough first, then typed the same twice
  if (typeof req.body.confirmPassword !== 'string' || req.body.confirmPassword !== password) throw httpError('The passwords don’t match');
  const accountType = req.body.accountType === 'seller' ? 'seller' : 'buyer';
  const profile = accountType === 'seller' ? sellerSignupFrom(req.body) : {}; // sellers: type, categories, location and how they get paid (required)
  const done = { message: `We’ve sent a link to ${email}. Open it to confirm your email, then log in.`, needsVerification: true, email };

  const existing = await Customer.findOne({ email }).select('+verifySentAt');
  if (existing) {
    audit(req, 'customer.register_existing', { outcome: 'denied', actor: { kind: 'anonymous', name: email }, target: `customer:${existing._id}` });
    // not verified yet: send the link again (not more than once a minute); verified: tell the owner by email
    if (existing.active && existing.emailVerified === false && !(existing.verifySentAt > new Date(Date.now() - RESEND_GAP_MS))) await sendVerification(existing);
    else if (existing.active && existing.emailVerified !== false) sendMail({ to: existing.email, ...templates.accountExists(existing, `${site().url}/login`, `${site().url}/forgot-password?email=${encodeURIComponent(existing.email)}`) });
    return res.status(201).json(done);
  }
  if (await Customer.exists({ phone })) throw httpError('This phone number is already used by another account. Log in, or use another number.', 409);

  const customer = await Customer.create({ name, email, phone, password, accountType, emailVerified: false, ...profile });
  await sendVerification(customer);
  audit(req, 'customer.register', { actor: { kind: 'customer', id: customer._id, name: email }, target: `customer:${customer._id}` });
  res.status(201).json(done);
});

// POST /api/customers/verify-email { token }: confirms the email (the link from the email). Doesn't log in.
exports.verifyEmail = asyncHandler(async (req, res) => {
  const token = String(req.body.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw httpError('This link is invalid. Ask for a new one from the log-in page.');
  const customer = await Customer.findOneAndUpdate(
    { verifyTokenHash: hashToken(token), verifyTokenExpires: { $gt: new Date() }, active: true },
    { $set: { emailVerified: true, emailVerifiedAt: new Date() }, $unset: { verifyTokenHash: 1, verifyTokenExpires: 1 } }, // single use
    { returnDocument: 'after' }
  );
  if (!customer) {
    audit(req, 'customer.verify_failed', { outcome: 'failed', actor: { kind: 'anonymous' } });
    throw httpError('This link has expired or was already used. Log in to get a new one.');
  }
  audit(req, 'customer.email_verified', { actor: { kind: 'customer', id: customer._id, name: customer.email } });
  res.json({ message: 'Your email is confirmed. You can log in now.', email: customer.email, accountType: customer.accountType || 'buyer', sellerTypes: customer.sellerTypes || [] });
});

// POST /api/customers/resend-verification { email }: always the same answer
exports.resendVerification = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const generic = { message: 'If that email has an account waiting to be confirmed, we’ve sent a new link. Check your inbox (and spam folder).' };
  if (!validEmail(email)) throw httpError('Please enter a valid email address');
  const customer = await Customer.findOne({ email }).select('+verifySentAt');
  if (customer?.active && customer.emailVerified === false && !(customer.verifySentAt > new Date(Date.now() - RESEND_GAP_MS))) await sendVerification(customer);
  res.json(generic);
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
  const customer = query && (await Customer.findOne(query).select('+password +failedLogins +lockedUntil'));
  const who = { kind: 'customer', id: customer?._id, name: login };
  if (customer?.lockedUntil && customer.lockedUntil > new Date()) {
    audit(req, 'customer.login_locked', { outcome: 'denied', actor: who });
    const mins = Math.ceil((customer.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ message: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.` });
  }
  if (customer && customer.active && !customer.password) {
    return res.status(401).json({ message: 'This account uses Google sign-in. Tap “Continue with Google”.' });
  }
  const good = customer && customer.active ? await customer.matchPassword(password) : (await DUMMY_CHECK(password), false);
  if (!good) {
    if (customer) {
      const fails = (customer.failedLogins || 0) + 1;
      const lock = fails >= MAX_FAILS;
      await Customer.updateOne({ _id: customer._id }, lock ? { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } } : { $set: { failedLogins: fails } });
      audit(req, lock ? 'customer.locked' : 'customer.login_failed', { outcome: 'failed', actor: who });
    } else audit(req, 'customer.login_failed', { outcome: 'failed', actor: { kind: 'anonymous', name: login }, detail: 'unknown account' });
    return res.status(401).json({ message: 'Incorrect email/phone or password' });
  }
  if (customer.emailVerified === false) {
    await Customer.updateOne({ _id: customer._id }, { $set: { failedLogins: 0 } });
    audit(req, 'customer.login_unverified', { outcome: 'denied', actor: who });
    return res.status(403).json({ message: 'Please confirm your email first: open the link we sent you. Didn’t get it? Send a new one below.', code: 'EMAIL_NOT_VERIFIED', email: customer.email });
  }
  const set = { failedLogins: 0, lastLoginAt: new Date() };
  if (customer.needsRehash()) customer.password = password; // re-hashed with today's cost on save
  Object.assign(customer, set);
  customer.lockedUntil = undefined;
  await customer.save();
  audit(req, 'customer.login', { actor: { kind: 'customer', id: customer._id, name: login } });
  res.json({ token: await issueCustomer(req, res, customer), customer: publicCustomer(customer) });
});

exports.me = (req, res) => res.json(publicCustomer(req.customer));

// POST /api/customers/session: swap a login token from before server-side sessions for a session cookie
// (browsers that were logged in before this update stay logged in, once, safely)
exports.session = asyncHandler(async (req, res) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  let tokenValue = token ? await require('../middleware/customerAuth').verifyCustomerToken(token) : null;
  if (!tokenValue && token) tokenValue = await verifyLegacyToken(token);
  if (!tokenValue) return res.status(401).json({ message: 'Please log in to continue' });
  await issueCustomer(req, res, tokenValue);
  audit(req, 'customer.session_upgraded', { actor: { kind: 'customer', id: tokenValue._id, name: tokenValue.email } });
  res.json({ customer: publicCustomer(tokenValue) });
});

// POST /api/customers/logout: ends this session (and clears the cookie)
exports.logout = asyncHandler(async (req, res) => {
  if (req.customerSession) await session.revoke(req.customerSession, 'logout');
  session.clearCookie(res, session.POLICY.customer.cookie, req);
  audit(req, 'customer.logout');
  res.json({ message: 'Logged out' });
});

// GET /api/customers/me/sessions · DELETE /api/customers/me/sessions (sign out everywhere else)
exports.sessions = asyncHandler(async (req, res) => {
  const list = await session.list('customer', req.customer._id);
  res.json(list.map((item) => ({ current: item._id === req.customerSession, createdAt: item.createdAt, lastSeenAt: item.lastSeenAt, ip: item.ip, device: item.ua })));
});
exports.signOutOthers = asyncHandler(async (req, res) => {
  const all = await session.revokeAll('customer', req.customer._id, 'signed out elsewhere', req.customerSession);
  audit(req, 'customer.sessions_revoked', { detail: `${all} other session(s)` });
  res.json({ message: all ? `Signed out on ${all} other device${all === 1 ? '' : 's'}` : 'No other devices were signed in' });
});

// POST /api/customers/me/password { current, next }: change my password; other devices are signed out
exports.changePassword = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer._id).select('+password');
  if (customer.password && !(await customer.matchPassword(String(req.body.current || '')))) {
    audit(req, 'customer.password_change_failed', { outcome: 'failed' });
    throw httpError('Your current password is wrong');
  }
  const next = value.newPassword({ name: customer.name, email: customer.email })(req.body.next);
  customer.password = next;
  customer.authProvider = customer.authProvider || 'password';
  customer.passwordChangedAt = new Date();
  await customer.save();
  await session.revokeAll('customer', customer._id, 'password changed');
  audit(req, 'customer.password_changed');
  res.json({ message: 'Password changed. Other devices were signed out.', token: await issueCustomer(req, res, customer), customer: publicCustomer(customer) });
});

// POST /api/customers/oauth/google { credential }: sign up or log in with Google
exports.google = asyncHandler(async (req, res) => {
  const verifyGoogleCredentialResult = await verifyGoogleCredential(req.body.credential);
  let customer = await Customer.findOne({ googleId: verifyGoogleCredentialResult.googleId });
  let created = false;
  if (!customer) {
    customer = await Customer.findOne({ email: verifyGoogleCredentialResult.email });
    if (customer) {
      // existing email/password account: link Google to it
      if (!customer.active) return res.status(401).json({ message: 'This account is disabled' });
      customer.googleId = verifyGoogleCredentialResult.googleId;
      if (!customer.avatar) customer.avatar = verifyGoogleCredentialResult.avatar;
      if (customer.emailVerified === false) {
        // nobody proved they own this email before: whoever set the password may not be the owner
        customer.password = undefined;
        customer.authProvider = 'google';
        customer.passwordChangedAt = new Date();
        await session.revokeAll('customer', customer._id, 'linked to Google before the email was confirmed');
        audit(req, 'customer.unverified_password_removed', { actor: { kind: 'customer', id: customer._id, name: customer.email } });
      }
      customer.emailVerified = true;
      customer.emailVerifiedAt = customer.emailVerifiedAt || new Date();
      customer.verifyTokenHash = undefined;
      customer.verifyTokenExpires = undefined;
      await customer.save();
    } else {
      customer = await Customer.create({ name: verifyGoogleCredentialResult.name.slice(0, 60), email: verifyGoogleCredentialResult.email, googleId: verifyGoogleCredentialResult.googleId, avatar: verifyGoogleCredentialResult.avatar, authProvider: 'google', emailVerified: true, emailVerifiedAt: new Date(), accountType: req.body.accountType === 'seller' ? 'seller' : 'buyer', ...(req.body.accountType === 'seller' ? sellerSignupFrom(req.body) : {}) });
      created = true;
    }
  }
  if (!customer.active) return res.status(401).json({ message: 'This account is disabled' });
  audit(req, created ? 'customer.register' : 'customer.login', { actor: { kind: 'customer', id: customer._id, name: customer.email }, detail: 'Google' });
  res.status(created ? 201 : 200).json({ token: await issueCustomer(req, res, customer), customer: publicCustomer(customer), created });
});

// POST /api/customers/forgot-password { email }
// Always gives the same answer, whether or not the email has an account (so it can't be used to find customers).
exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!validEmail(email)) throw httpError('Please enter a valid email address');
  const generic = { message: 'If an account exists for that email, we’ve sent a link to reset the password. Check your inbox (and spam folder).' };

  const customer = await Customer.findOne({ email });
  audit(req, 'customer.password_reset_requested', { actor: { kind: customer ? 'customer' : 'anonymous', id: customer?._id, name: email }, detail: customer ? '' : 'no such account' });
  if (!customer || !customer.active) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  await Customer.updateOne({ _id: customer._id }, { $set: { resetTokenHash: hashToken(token), resetTokenExpires: new Date(Date.now() + RESET_MINUTES * 60000) } });
  const link = `${site().url}/reset-password?token=${token}`;
  sendMail({ to: customer.email, ...templates.passwordReset(customer, link, RESET_MINUTES) }); // in the background; never blocks or errors the request
  res.json(generic);
});

// POST /api/customers/reset-password { token, password }: sets the new password and logs the customer in
exports.resetPassword = asyncHandler(async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw httpError('This reset link is invalid. Please request a new one.');
  const customer = await Customer.findOne({ resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires');
  if (!customer || !customer.active) throw httpError('This reset link has expired or was already used. Please request a new one.');
  value.newPassword({ name: customer.name, email: customer.email })(password);
  if (req.body.confirmPassword !== undefined && req.body.confirmPassword !== password) throw httpError('The passwords don’t match');
  if (customer.emailVerified === false) { customer.emailVerified = true; customer.emailVerifiedAt = new Date(); } // the reset link proves the email
  customer.password = password; // hashed by the model before saving
  customer.resetTokenHash = undefined; // single use
  customer.resetTokenExpires = undefined;
  customer.passwordChangedAt = new Date(); // signs out other devices
  await customer.save();
  await session.revokeAll('customer', customer._id, 'password reset');
  audit(req, 'customer.password_reset', { actor: { kind: 'customer', id: customer._id, name: customer.email } });
  res.json({ message: 'Your password has been changed', token: await issueCustomer(req, res, customer), customer: publicCustomer(customer) });
});

// PUT /api/customers/me { name, phone, address }
exports.updateMe = asyncHandler(async (req, res) => {
  const customer = req.customer;
  let renamed = false;
  if (req.body.name !== undefined) {
    const name = clean(req.body.name, 60);
    if (name.length < 2) throw httpError('Please enter your name');
    renamed = name !== customer.name;
    customer.name = name;
  }
  if (req.body.phone !== undefined) {
    const phone = phoneOr400(req.body.phone);
    if (phone !== customer.phone && (await Customer.exists({ phone }))) throw httpError('That phone number is used by another account', 409);
    customer.phone = phone;
  }
  if (req.body.address !== undefined) customer.address = clean(req.body.address, 200);
  if (req.body.county !== undefined) customer.county = clean(req.body.county, 40);
  if (req.body.about !== undefined) customer.about = clean(req.body.about, 300);
  if (['buyer', 'seller'].includes(req.body.accountType)) customer.accountType = req.body.accountType;
  if (req.body.sellerTypes !== undefined) customer.sellerTypes = sellerTypesFrom(req.body.sellerTypes);
  if (req.body.sellerCategories !== undefined) customer.sellerCategories = sellerCategoriesFrom(req.body.sellerCategories);
  // types inside the categories (only of categories the seller has; dropping a category drops its types)
  // wholesalers / importers: what they deal in and from where (sent: must be complete; kinds changed: what no longer fits is dropped)
  if (req.body.trade !== undefined || req.body.sellerTypes !== undefined) {
    const given = req.body.trade !== undefined;
    const trade = tradeFrom(given ? req.body.trade : tradeView(customer.trade), customer.sellerTypes || [], { required: given });
    customer.trade = Object.keys(trade).length ? trade : undefined;
    if (customer.trade || customer.sellerCategories?.length) customer.sellerCategories = withTradeCategories(customer.sellerCategories || [], trade);
  }
  if (req.body.tradeAsked === true) customer.tradeAskedAt = customer.tradeAskedAt || new Date();
  // the shop on the map says it too ("Wholesalers near me", the Importers page)
  if (req.body.sellerTypes !== undefined && (customer.shopLocation?.area || customer.shopLocation?.point?.coordinates)) {
    const kinds = new Set(customer.shopLocation.kinds || []);
    for (const kind of ['wholesaler', 'importer']) (customer.sellerTypes || []).includes(kind) ? kinds.add(kind) : kinds.delete(kind);
    customer.shopLocation.kinds = [...kinds];
  }
  if (req.body.sellerItems !== undefined || req.body.sellerCategories !== undefined) customer.sellerItems = sellerItemsFrom(req.body.sellerItems ?? customer.sellerItems, customer.sellerCategories || []);
  // how buyers pay me on delivery (null removes it)
  if (req.body.payDetails !== undefined) customer.payDetails = require('../market/pay').cleanPay(req.body.payDetails, httpError, formatPhone) || undefined;
  let geoChanged = false;
  if (req.body.shopLocation === null) {
    customer.shopLocation = undefined;
    geoChanged = true;
  } else if (req.body.shopLocation && typeof req.body.shopLocation === 'object') {
    const shopLocation = req.body.shopLocation;
    const point = geo.toPoint(shopLocation.lat, shopLocation.lng);
    if (!point) throw httpError('Please set your shop on the map (tap “Use my current location” or search for the address in Kenya)');
    const address = clean(shopLocation.address, 200);
    if (address.length < 4) throw httpError('Please type your shop’s address or nearest landmark');
    const county = clean(shopLocation.county, 40);
    if (!COUNTIES.includes(county)) throw httpError('Please choose the county your shop is in');
    const kinds = [...new Set((Array.isArray(shopLocation.kinds) ? shopLocation.kinds : []).filter((kind) => KINDS.includes(kind)))];
    const wear = kinds.includes('boutique') ? [...new Set((Array.isArray(shopLocation.wear) ? shopLocation.wear : []).filter((item) => WEARS.includes(item)))] : [];
    if (kinds.includes('boutique') && !wear.length) throw httpError('Tell buyers what your boutique sells: men’s wear, women’s wear or kids’ wear');
    // a stall in a market (mama mboga / market trader)
    let market = null;
    if (shopLocation.market && (kinds.includes('mama-mboga') || kinds.includes('market-stall'))) {
      const Market = require('../models/Market');
      market = /^[a-f0-9]{24}$/i.test(String(shopLocation.market)) ? await Market.findOne({ _id: shopLocation.market, $or: [{ approved: true }, { suggestedBy: customer._id }] }).lean() : null;
      if (!market) throw httpError('Please choose your market from the list');
      if (geo.distanceKm({ lat: market.point.coordinates[1], lng: market.point.coordinates[0] }, point) > 3) throw httpError(`Your pin is far from ${market.name}. Put the pin on your stall (or choose the market you’re in).`);
    }
    const walk = require('../market/walk').cleanWalk(shopLocation.walk, httpError);
    // hours: keep what was saved when the form doesn't send them; the override is set with /me/open-status
    const realHours = (height) => (height && (height.always || height.days?.length) ? height : undefined); // an empty saved object counts as no hours
    const before = realHours(customer.shopLocation?.hours ? JSON.parse(JSON.stringify(customer.shopLocation.hours)) : undefined);
    let hours = shopLocation.hours === undefined ? before : shopLocation.hours === null ? undefined : require('../market/hours').cleanHours({ ...shopLocation.hours, override: undefined }, httpError);
    if (hours && before?.override?.state) hours = { ...hours, override: before.override };
    if (kinds.includes('chemist') && !hours) throw httpError('Chemists must show their opening and closing times. Set your opening hours below.');
    customer.shopLocation = {
      hours,
      name: clean(shopLocation.name, 80), address, area: clean(shopLocation.area, 60), county, placeId: clean(shopLocation.placeId, 300), point, public: shopLocation.public !== false, updatedAt: new Date(),
      kinds, wear, stall: market ? clean(shopLocation.stall, 40) : '', walk,
      ...(market ? { market: market._id, marketName: market.name, marketSlug: market.slug } : {}),
    };
    geoChanged = true;
  }
  await customer.save();
  require('../market/directory').touch(customer._id); // the people tables
  if (renamed) {
    await Listing.updateMany({ seller: customer._id }, { $set: { sellerName: customer.name } });
    invalidate('market:');
  }
  if (geoChanged) {
    await require('../market/stores').syncMainFromShop(customer); // the main store follows the shop location
    // the seller's ads show up in "near me" searches from their shop's pin
    await geo.syncSellerAds(Listing, customer);
    invalidate('market:');
  }
  res.json(publicCustomer(customer));
});

// POST /api/customers/me/chemist { licenceNo, premises, pharmacist }  a chemist asks to be verified
exports.requestChemist = asyncHandler(async (req, res) => {
  const customer = req.customer;
  if (customer.chemist?.status === 'verified') throw httpError('Your chemist licence is already verified');
  if (customer.chemist?.status === 'pending') throw httpError('Your licence is being checked. We’ll call you soon.');
  if (!customer.phone) throw httpError('Add your phone number first (Account → Profile): our team will call you on it');
  if (!customer.shopLocation?.point?.coordinates) throw httpError('Put your chemist on the map first (Shop location above)');
  const licenceNo = clean(req.body.licenceNo, 40);
  const premises = clean(req.body.premises, 80);
  const pharmacist = clean(req.body.pharmacist, 80);
  if (licenceNo.length < 4) throw httpError('Enter your Pharmacy and Poisons Board premises licence number');
  if (premises.length < 3) throw httpError('Enter the registered name of your premises');
  if (pharmacist.length < 3) throw httpError('Enter the pharmacist or pharmaceutical technologist in charge');
  customer.chemist = { status: 'pending', licenceNo, premises, pharmacist, at: new Date() };
  await customer.save();
  require('../utils/realtime').emitAdmin('seller:verify-request', { _id: customer._id, name: customer.name, chemist: true });
  res.json(publicCustomer(customer));
});

// POST /api/customers/me/open-status { state: 'auto' | 'open' | 'closed', until: 'today' | '', note }
// "Closed right now" / "Open right now" (for the rest of today, or until changed back), or back to the usual hours
exports.openStatus = asyncHandler(async (req, res) => {
  const customer = req.customer;
  const hours = customer.shopLocation?.hours;
  if (!customer.shopLocation?.point?.coordinates || !hours || (!hours.always && !hours.days?.length)) throw httpError('Set your opening hours first');
  const { endOfKenyaDay } = require('../market/hours');
  const state = req.body.state;
  if (state === 'auto') customer.set('shopLocation.hours.override', undefined);
  else if (['open', 'closed'].includes(state)) customer.set('shopLocation.hours.override', { state, until: req.body.until === 'today' ? endOfKenyaDay() : null, note: clean(req.body.note, 60) });
  else throw httpError('Choose open, closed or your usual hours');
  await customer.save();
  invalidate('market:');
  res.json(publicCustomer(customer));
});

// POST /api/customers/me/map-link { url }  a Google Maps share link (or "lat, lng") → { lat, lng, name }
exports.mapLink = asyncHandler(async (req, res) => {
  const pin = await geo.resolveMapLink(req.body.url);
  if (!pin) throw httpError('We couldn’t read a location in Kenya from that. In Google Maps, open your shop, tap Share and copy the link.');
  res.json(pin);
});

// ---------------------------------------------------------------- M-Pesa prompts straight to the seller
// PUT /api/customers/me/mpesa-connect { shortcode, consumerKey, consumerSecret, passkey, env, password }
// The seller's own Daraja app (Lipa Na M-Pesa Online, from developer.safaricom.co.ke after "Go Live"): with it, a
// buyer paying several sellers gets an M-Pesa prompt that pays this seller's Till / Paybill directly. The keys are
// checked with Safaricom, encrypted (utils/secretBox) and never sent back. Changing where money goes needs the password.
exports.connectMpesa = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer._id).select('+password payDetails payConnect');
  if (customer.password && !(await customer.matchPassword(String(req.body.password || '')))) {
    audit(req, 'customer.mpesa_connect_failed', { outcome: 'failed', detail: 'wrong password' });
    throw httpError('Your password is wrong', 403);
  }
  const pay = customer.payDetails;
  if (!['till', 'paybill'].includes(pay?.method)) throw httpError('M-Pesa prompts work with a Till (Buy Goods) or Paybill. Save one under “How buyers pay you” first.');
  const shortcode = String(req.body.shortcode || '').replace(/\D/g, '');
  if (!/^\d{5,7}$/.test(shortcode)) throw httpError(pay.method === 'till' ? 'Enter your store number (head office shortcode) for the Till: 5 to 7 digits' : 'Enter your Paybill number: 5 to 7 digits');
  if (pay.method === 'paybill' && shortcode !== pay.paybill) throw httpError(`These keys must be for your Paybill ${pay.paybill}`);
  const key = (val, label, min) => {
    const text = String(val || '').trim();
    if (text.length < min || text.length > 200 || !/^[A-Za-z0-9+/=_-]+$/.test(text)) throw httpError(`Enter your ${label} exactly as Daraja shows it`);
    return text;
  };
  const consumerKey = key(req.body.consumerKey, 'consumer key', 10);
  const consumerSecret = key(req.body.consumerSecret, 'consumer secret', 10);
  const passkey = key(req.body.passkey, 'Lipa Na M-Pesa passkey', 20);
  const env = req.body.env === 'sandbox' ? 'sandbox' : 'production';
  // Safaricom must accept the keys (skipped in demo payments: nothing is sent)
  if (!require('../config/site').site().demoPayments) {
    try {
      await require('../utils/mpesa').getAccessToken({ env, consumerKey, consumerSecret });
    } catch {
      audit(req, 'customer.mpesa_connect_failed', { outcome: 'failed', detail: 'keys refused' });
      throw httpError('Safaricom didn’t accept these keys. Check the consumer key and secret (and that the app is live).');
    }
  }
  const { seal } = require('../utils/secretBox');
  customer.payKeys = { consumerKey: seal(consumerKey), consumerSecret: seal(consumerSecret), passkey: seal(passkey) };
  customer.payConnect = { shortcode, env, connectedAt: new Date() };
  await customer.save();
  audit(req, 'customer.mpesa_connected', { detail: `${pay.method} ${shortcode} ${env}` });
  res.json({ payConnect: { connected: true, shortcode, env, connectedAt: customer.payConnect.connectedAt } });
});

// DELETE /api/customers/me/mpesa-connect  (buyers then pay this seller by hand, with the M-Pesa code)
exports.disconnectMpesa = asyncHandler(async (req, res) => {
  await Customer.updateOne({ _id: req.customer._id }, { $unset: { payKeys: 1, payConnect: 1 } });
  audit(req, 'customer.mpesa_disconnected');
  res.json({ payConnect: { connected: false } });
});
