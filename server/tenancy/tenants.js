// Finding the client (tenant) for a request, their settings, and running jobs for every client.
const Tenant = require('../models/platform/Tenant');
const { als, currentTenant, runAsTenant } = require('./context');
const { decrypt } = require('./secrets');

const DEFAULT_SLUG = () => (process.env.DEFAULT_TENANT || 'ordersasa').toLowerCase();
// Base domain the app is served on, e.g. "ordersasa.co.ke" in production or "localhost" in development
const ROOT_DOMAIN = () => (process.env.ROOT_DOMAIN || 'localhost').toLowerCase().replace(/:\d+$/, '');

// ---- cache of tenants (refreshed every 30 s, or immediately after an edit) ----
let cache = { at: 0, bySlug: new Map(), byDomain: new Map() };
async function loadTenants(force = false) {
  if (!force && Date.now() - cache.at < 30000) return cache;
  const list = await Tenant.find({}).lean();
  const bySlug = new Map();
  const byDomain = new Map();
  for (const t of list) {
    bySlug.set(t.slug, t);
    (t.domains || []).forEach((d) => byDomain.set(d, t));
  }
  cache = { at: Date.now(), bySlug, byDomain };
  return cache;
}
const invalidateTenants = () => { cache.at = 0; };

async function findTenant(slug) {
  return (await loadTenants()).bySlug.get(String(slug || '').toLowerCase()) || null;
}

// Work out which client a request is for
async function resolveTenant({ host, headerTenant, pathTenant }) {
  const c = await loadTenants();
  if (pathTenant && c.bySlug.has(pathTenant)) return c.bySlug.get(pathTenant);
  if (headerTenant && c.bySlug.has(String(headerTenant).toLowerCase())) return c.bySlug.get(String(headerTenant).toLowerCase());
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (h) {
    if (c.byDomain.has(h)) return c.byDomain.get(h); // client's own domain
    const root = ROOT_DOMAIN();
    if (h !== root && h.endsWith(`.${root}`)) {
      const sub = h.slice(0, -(root.length + 1)).split('.').pop(); // demo.localhost -> demo
      if (c.bySlug.has(sub)) return c.bySlug.get(sub);
      return { unknown: sub };
    }
  }
  return c.bySlug.get(DEFAULT_SLUG()) || null;
}

const requestHost = (req) => String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();

// Express middleware: every /api request (except the platform console) runs as one client
function tenantMiddleware() {
  return async (req, res, next) => {
    try {
      if (req.path.startsWith('/platform')) return next(); // your admin console: no client
      const m = req.path.match(/^\/mpesa\/callback\/([a-z0-9-]+)\/?$/); // Safaricom callbacks carry the client in the path
      const t = await resolveTenant({ host: requestHost(req), headerTenant: req.headers['x-tenant'], pathTenant: m?.[1] });
      if (!t) return res.status(503).json({ message: 'This system has not been set up yet' });
      if (t.unknown) return res.status(404).json({ message: `No shop found at "${t.unknown}"` });
      if (t.status === 'suspended' && !m) {
        return res.status(403).json({ message: `${t.name}'s account is suspended. Please contact your system provider.`, suspended: true });
      }
      req.tenant = t;
      als.run({ tenant: t }, () => next());
    } catch (err) {
      next(err);
    }
  };
}

// ---------- settings for the current client ----------
// Secret fields are decrypted here. For the default client only, empty fields fall back to server/.env,
// so the original single-shop setup keeps working unchanged.
function settings(tenant = currentTenant()) {
  if (!tenant) throw new Error('No client context');
  const s = tenant.settings || {};
  const isDefault = tenant.slug === DEFAULT_SLUG();
  const env = (k) => (isDefault ? process.env[k] || '' : '');
  const pick = (v, envKey, fallback = '') => (v !== undefined && v !== null && v !== '' ? v : env(envKey) || fallback);
  const sec = (v, envKey) => decrypt(v) || env(envKey);

  const publicApi = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  const callbackUrl = publicApi ? `${publicApi}/api/mpesa/callback/${tenant.slug}` : env('MPESA_CALLBACK_URL');

  return {
    slug: tenant.slug,
    storeName: s.branding?.storeName || tenant.name,
    branding: { logoUrl: s.branding?.logoUrl || '', primaryColor: s.branding?.primaryColor || '' },
    shopUrl: shopUrl(tenant),
    shop: {
      address: s.shop?.address || (isDefault ? 'Imara Mall, Mombasa Road, Imara Daima, Nairobi' : ''),
      location: s.shop?.location || (isDefault ? 'Imara Mall' : ''),
      mapQuery: s.shop?.mapQuery || s.shop?.address || (isDefault ? 'Imara Mall, Mombasa Road, Nairobi' : ''),
      phone: s.shop?.phone || '',
      whatsapp: s.shop?.whatsapp || '',
      email: s.shop?.email || '',
      hours: s.shop?.hours || [],
    },
    mpesa: {
      env: pick(s.mpesa?.env, 'MPESA_ENV', 'sandbox'),
      consumerKey: pick(s.mpesa?.consumerKey, 'MPESA_CONSUMER_KEY'),
      consumerSecret: sec(s.mpesa?.consumerSecret, 'MPESA_CONSUMER_SECRET'),
      shortcode: pick(s.mpesa?.shortcode, 'MPESA_SHORTCODE'),
      passkey: sec(s.mpesa?.passkey, 'MPESA_PASSKEY'),
      transactionType: pick(s.mpesa?.transactionType, 'MPESA_TRANSACTION_TYPE', 'CustomerPayBillOnline'),
      callbackUrl,
    },
    etims: {
      mode: pick(s.etims?.mode, 'ETIMS_MODE', 'off'),
      tin: pick(s.etims?.tin, 'ETIMS_TIN').toUpperCase(),
      bhfId: pick(s.etims?.bhfId, 'ETIMS_BHF_ID', '00'),
      deviceSerial: pick(s.etims?.deviceSerial, 'ETIMS_DEVICE_SERIAL'),
      traderName: pick(s.etims?.traderName, 'ETIMS_TRADER_NAME', s.branding?.storeName || tenant.name),
      address: pick(s.etims?.address, 'ETIMS_ADDRESS', s.shop?.address || ''),
      defaultItemClass: pick(s.etims?.defaultItemClass, 'ETIMS_DEFAULT_ITEM_CLASS', '5020230500'),
    },
    email: {
      // A client can use their own SMTP account; otherwise the platform's (server/.env) is used
      from: s.email?.from || `${s.branding?.storeName || tenant.name} <${(process.env.MAIL_FROM || 'no-reply@ordersasa.co.ke').replace(/^.*<|>.*$/g, '')}>`,
      smtpHost: s.email?.smtpHost || '',
      smtpPort: s.email?.smtpPort || 587,
      smtpUser: s.email?.smtpUser || '',
      smtpPass: decrypt(s.email?.smtpPass),
    },
    taxRate: Number(s.taxRate ?? (isDefault ? process.env.TAX_RATE || 0 : 0)),
  };
}

// Public address of a client's shop, used in email links
function shopUrl(tenant) {
  const isDefault = tenant.slug === DEFAULT_SLUG();
  if (tenant.domains?.length) return `https://${tenant.domains[0]}`;
  const base = process.env.ROOT_DOMAIN;
  if (base && !(isDefault && process.env.SHOP_URL)) {
    const local = /localhost/.test(base);
    return `${local ? 'http' : 'https'}://${tenant.slug}.${base}`.replace(/\/$/, '');
  }
  return (process.env.SHOP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

// Run a job once for every client that isn't suspended (e.g. eTIMS retries)
async function forEachTenant(fn, { includeSuspended = false } = {}) {
  const c = await loadTenants(true);
  for (const t of c.bySlug.values()) {
    if (!includeSuspended && t.status === 'suspended') continue;
    try {
      await runAsTenant(t, () => fn(t));
    } catch (err) {
      console.warn(`[tenant ${t.slug}] job failed:`, err.message);
    }
  }
}

// First start: turn the existing single-shop database into the first client
async function bootstrapDefaultTenant() {
  if ((await Tenant.estimatedDocumentCount()) > 0) return null;
  const uriDb = (process.env.MONGO_URI || '').split('?')[0].split('/').pop() || 'pos_system';
  const t = await Tenant.create({ slug: DEFAULT_SLUG(), name: process.env.ETIMS_TRADER_NAME || 'Ordersasa', dbName: uriDb, status: 'active' });
  console.log(`[tenancy] created first client "${t.slug}" using existing database "${uriDb}"`);
  invalidateTenants();
  return t;
}

module.exports = { resolveTenant, requestHost, tenantMiddleware, settings, shopUrl, forEachTenant, bootstrapDefaultTenant, loadTenants, invalidateTenants, findTenant, DEFAULT_SLUG, ROOT_DOMAIN };
