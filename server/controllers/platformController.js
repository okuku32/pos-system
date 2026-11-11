// Platform console API: you (the system owner) manage every client from here.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Tenant = require('../models/platform/Tenant');
const PlatformAdmin = require('../models/platform/PlatformAdmin');
const asyncHandler = require('../utils/asyncHandler');
const { runAsTenant, platformConnection } = require('../tenancy/context');
const { invalidateTenants, shopUrl, DEFAULT_SLUG } = require('../tenancy/tenants');
const { httpError } = require('../utils/saleService');

const signPlatform = (id) => jwt.sign({ id, typ: 'platform' }, process.env.JWT_SECRET, { expiresIn: '12h' });
const publicAdmin = (a) => ({ _id: a._id, name: a.name, email: a.email });
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Audit trail of what you do on behalf of clients (support logins, suspensions...)
const audit = (entry) => platformConnection().collection('audit').insertOne({ ...entry, at: new Date() }).catch(() => {});

// ---------- your login ----------
exports.protectPlatform = async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Platform login required' });
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    if (d.typ !== 'platform') return res.status(401).json({ message: 'Platform login required' });
    const a = await PlatformAdmin.findById(d.id);
    if (!a || !a.active) return res.status(401).json({ message: 'Platform login required' });
    req.admin = a;
    next();
  } catch {
    res.status(401).json({ message: 'Your platform session has expired' });
  }
};

exports.setupStatus = asyncHandler(async (req, res) => res.json({ needsSetup: (await PlatformAdmin.estimatedDocumentCount()) === 0 }));

exports.setup = asyncHandler(async (req, res) => {
  if (await PlatformAdmin.estimatedDocumentCount()) throw httpError('Platform setup is already done');
  const { name, email, password } = req.body;
  if (!name || !EMAIL_RX.test(String(email || ''))) throw httpError('Enter your name and a valid email');
  if (String(password || '').length < 8) throw httpError('Password must be at least 8 characters');
  const a = await PlatformAdmin.create({ name, email, password });
  res.status(201).json({ token: signPlatform(a._id), admin: publicAdmin(a) });
});

exports.login = asyncHandler(async (req, res) => {
  const a = await PlatformAdmin.findOne({ email: String(req.body.email || '').toLowerCase() }).select('+password');
  if (!a || !a.active || !(await a.matchPassword(String(req.body.password || '')))) {
    return res.status(401).json({ message: 'Incorrect email or password' });
  }
  res.json({ token: signPlatform(a._id), admin: publicAdmin(a) });
});

exports.me = (req, res) => res.json(publicAdmin(req.admin));

// ---------- clients ----------
// Usage figures for one client, read from their own database
async function usage(tenant) {
  return runAsTenant(tenant, async () => {
    const User = require('../models/User');
    const Product = require('../models/Product');
    const Sale = require('../models/Sale');
    const Order = require('../models/Order');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const [users, products, today, month, last, openOrders, etimsFailed] = await Promise.all([
      User.countDocuments({ active: true }),
      Product.countDocuments({ active: true }),
      Sale.aggregate([{ $match: { status: 'completed', createdAt: { $gte: start } } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' } } }]),
      Sale.aggregate([{ $match: { status: 'completed', createdAt: { $gte: monthStart } } }, { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' } } }]),
      Sale.findOne({ status: 'completed' }).sort('-createdAt').select('createdAt'),
      Order.countDocuments({ status: 'open' }),
      Sale.countDocuments({ 'etims.status': 'failed' }),
    ]);
    return {
      users,
      products,
      salesToday: today[0]?.n || 0,
      revenueToday: today[0]?.total || 0,
      salesMonth: month[0]?.n || 0,
      revenueMonth: month[0]?.total || 0,
      lastSaleAt: last?.createdAt || null,
      openOrders,
      etimsFailed,
    };
  }).catch((err) => ({ error: err.message }));
}

const view = (t, u) => ({
  _id: t._id,
  slug: t.slug,
  name: t.name,
  status: t.status,
  plan: t.plan,
  trialEndsAt: t.trialEndsAt,
  contact: t.contact || {},
  domains: t.domains || [],
  notes: t.notes || '',
  dbName: t.dbName,
  shopUrl: shopUrl(t),
  isDefault: t.slug === DEFAULT_SLUG(),
  createdAt: t.createdAt,
  usage: u,
});

exports.listTenants = asyncHandler(async (req, res) => {
  const list = await Tenant.find({}).sort('name').lean();
  const withUsage = await Promise.all(list.map(async (t) => view(t, await usage(t))));
  res.json(withUsage);
});

// POST /api/platform/tenants { slug, name, plan, status, trialDays, contact, admin: { name, email, password } }
exports.createTenant = asyncHandler(async (req, res) => {
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const admin = req.body.admin || {};
  if (!Tenant.SLUG_RX.test(slug)) throw httpError('Web address: 1–30 lowercase letters, numbers or dashes (e.g. "mama-mboga")');
  if (Tenant.RESERVED.has(slug)) throw httpError(`"${slug}" is reserved, choose another web address`);
  if (!name) throw httpError("Enter the client's business name");
  if (!admin.name || !EMAIL_RX.test(String(admin.email || ''))) throw httpError("Enter the client admin's name and email");
  if (String(admin.password || '').length < 6) throw httpError('Client admin password must be at least 6 characters');
  if (await Tenant.exists({ slug })) throw httpError(`The address "${slug}" is already taken`, 409);

  const trialDays = Number(req.body.trialDays ?? 14);
  const t = await Tenant.create({
    slug,
    name,
    dbName: `tenant_${slug.replace(/-/g, '_')}`,
    status: ['trial', 'active'].includes(req.body.status) ? req.body.status : 'trial',
    plan: req.body.plan || 'standard',
    trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * 86400000) : undefined,
    contact: { name: req.body.contact?.name || admin.name, email: req.body.contact?.email || admin.email, phone: req.body.contact?.phone || '' },
    settings: { branding: { storeName: name }, etims: { mode: 'off' } },
  });
  invalidateTenants();

  // Create the client's first admin user inside their own (brand new) database
  try {
    await runAsTenant(t.toObject(), async () => {
      const User = require('../models/User');
      await User.create({ name: admin.name, email: admin.email, password: admin.password, role: 'admin' });
    });
  } catch (err) {
    await Tenant.deleteOne({ _id: t._id });
    invalidateTenants();
    throw httpError('Could not create the client admin: ' + err.message);
  }
  audit({ action: 'tenant.create', tenant: slug, by: req.admin.email });
  res.status(201).json(view(t.toObject(), await usage(t.toObject())));
});

// PATCH /api/platform/tenants/:slug { name, status, plan, trialEndsAt, domains, notes, contact }
exports.updateTenant = asyncHandler(async (req, res) => {
  const t = await Tenant.findOne({ slug: req.params.slug });
  if (!t) throw httpError('Client not found', 404);
  const b = req.body;
  if (b.name !== undefined) t.name = String(b.name).trim() || t.name;
  if (b.status !== undefined) {
    if (!['trial', 'active', 'suspended'].includes(b.status)) throw httpError('Invalid status');
    if (b.status === 'suspended' && t.slug === DEFAULT_SLUG()) throw httpError('The main shop cannot be suspended');
    if (b.status !== t.status) audit({ action: `tenant.${b.status}`, tenant: t.slug, by: req.admin.email });
    t.status = b.status;
  }
  if (b.plan !== undefined) t.plan = b.plan;
  if (b.trialEndsAt !== undefined) t.trialEndsAt = b.trialEndsAt ? new Date(b.trialEndsAt) : undefined;
  if (b.notes !== undefined) t.notes = String(b.notes).slice(0, 2000);
  if (b.contact !== undefined) t.contact = { ...t.contact, ...b.contact };
  if (b.domains !== undefined) {
    const list = (Array.isArray(b.domains) ? b.domains : String(b.domains).split(/[\s,]+/)).map((d) => d.trim().toLowerCase()).filter(Boolean);
    for (const d of list) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw httpError(`"${d}" is not a valid domain`);
      if (await Tenant.exists({ domains: d, _id: { $ne: t._id } })) throw httpError(`${d} is already used by another client`);
    }
    t.domains = list;
  }
  await t.save();
  invalidateTenants();
  res.json(view(t.toObject(), await usage(t.toObject())));
});

// POST /api/platform/tenants/:slug/support-login: open the client's system as a support admin for 1 hour
exports.supportLogin = asyncHandler(async (req, res) => {
  const t = await Tenant.findOne({ slug: req.params.slug }).lean();
  if (!t) throw httpError('Client not found', 404);
  const token = await runAsTenant(t, async () => {
    const User = require('../models/User');
    const email = 'platform-support@ordersasa.internal';
    let u = await User.findOne({ email });
    if (!u) u = await User.create({ name: `Support (${req.admin.name})`, email, password: crypto.randomBytes(24).toString('hex'), role: 'admin' });
    else if (!u.active) {
      u.active = true;
      await u.save();
    }
    return jwt.sign({ id: u._id, tid: t.slug, support: req.admin.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
  });
  audit({ action: 'tenant.support-login', tenant: t.slug, by: req.admin.email });
  res.json({ token, url: `${shopUrl(t).replace(/\/shop$/, '')}/?supportToken=${encodeURIComponent(token)}`, expiresIn: 3600 });
});

exports.auditLog = asyncHandler(async (req, res) => {
  const rows = await platformConnection().collection('audit').find({}).sort({ at: -1 }).limit(100).toArray();
  res.json(rows);
});
