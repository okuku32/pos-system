// A client's own business settings, edited by their admin in Settings. Secrets are encrypted at rest
// and never sent back to the browser (only "saved" / "not saved").
const Tenant = require('../models/platform/Tenant');
const asyncHandler = require('../utils/asyncHandler');
const { requireTenant } = require('../tenancy/context');
const { settings, invalidateTenants } = require('../tenancy/tenants');
const { encrypt, mask } = require('../tenancy/secrets');
const { httpError } = require('../utils/saleService');

const SECRET_FIELDS = { mpesa: ['consumerSecret', 'passkey'], email: ['smtpPass'] };
const ALLOWED = {
  branding: ['storeName', 'logoUrl', 'primaryColor'],
  shop: ['address', 'location', 'mapQuery', 'phone', 'whatsapp', 'email', 'hours'],
  mpesa: ['env', 'consumerKey', 'consumerSecret', 'shortcode', 'passkey', 'transactionType'],
  etims: ['mode', 'tin', 'bhfId', 'deviceSerial', 'traderName', 'address', 'defaultItemClass'],
  email: ['from', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass'],
};
const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : v);

// GET /api/tenant/settings (client admin)
exports.get = asyncHandler(async (req, res) => {
  const t = requireTenant();
  const s = settings(t);
  res.json({
    slug: t.slug,
    name: t.name,
    status: t.status,
    plan: t.plan,
    trialEndsAt: t.trialEndsAt,
    shopUrl: s.shopUrl,
    branding: { storeName: s.storeName, ...s.branding },
    shop: s.shop,
    mpesa: { env: s.mpesa.env, consumerKey: s.mpesa.consumerKey, shortcode: s.mpesa.shortcode, transactionType: s.mpesa.transactionType, consumerSecret: mask(s.mpesa.consumerSecret), passkey: mask(s.mpesa.passkey), callbackUrl: s.mpesa.callbackUrl },
    etims: s.etims,
    email: { from: t.settings?.email?.from || '', smtpHost: s.email.smtpHost, smtpPort: s.email.smtpPort, smtpUser: s.email.smtpUser, smtpPass: mask(s.email.smtpPass) },
    taxRate: s.taxRate,
  });
});

// PUT /api/tenant/settings { branding, shop, mpesa, etims, email, taxRate }: only sections sent are changed
exports.update = asyncHandler(async (req, res) => {
  const t = await Tenant.findOne({ slug: requireTenant().slug });
  if (!t) throw httpError('Client not found', 404);
  const set = {};
  for (const [section, fields] of Object.entries(ALLOWED)) {
    const incoming = req.body[section];
    if (!incoming || typeof incoming !== 'object') continue;
    for (const f of fields) {
      if (!(f in incoming)) continue;
      let v = incoming[f];
      if (SECRET_FIELDS[section]?.includes(f)) {
        if (v === mask('x')) continue; // unchanged placeholder: keep the saved secret
        v = encrypt(String(v || '').trim());
      } else if (f === 'hours') {
        v = Array.isArray(v) ? v.filter((r) => Array.isArray(r) && r[0]).slice(0, 7).map(([d, h]) => [clean(d, 40), clean(h, 60)]) : [];
      } else if (f === 'smtpPort') {
        v = Number(v) || 587;
      } else v = clean(v, f === 'address' ? 200 : 120);
      set[`settings.${section}.${f}`] = v;
    }
  }
  if (req.body.mpesa?.env && !['sandbox', 'production'].includes(req.body.mpesa.env)) throw httpError('M-Pesa environment must be sandbox or production');
  if (req.body.etims?.mode && !['off', 'mock', 'sandbox', 'live'].includes(req.body.etims.mode)) throw httpError('Invalid eTIMS mode');
  if (req.body.etims?.tin && !/^[AP]\d{9}[A-Z]$/i.test(req.body.etims.tin)) throw httpError('KRA PIN should look like P051234567X');
  if (req.body.taxRate !== undefined) {
    const r = Number(req.body.taxRate);
    if (!(r >= 0 && r <= 30)) throw httpError('Tax rate must be between 0 and 30%');
    set['settings.taxRate'] = r;
  }
  if (req.body.branding?.storeName) set.name = clean(req.body.branding.storeName, 80);
  await Tenant.updateOne({ _id: t._id }, { $set: set });
  invalidateTenants();
  res.json({ message: 'Settings saved' });
});

// GET /api/shop/info: public details for the shop pages (name, location, contacts)
exports.publicInfo = (req, res) => {
  const t = requireTenant();
  const s = settings(t);
  res.json({ slug: t.slug, storeName: s.storeName, branding: s.branding, shop: s.shop });
};
