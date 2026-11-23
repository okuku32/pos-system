// Admin dashboard numbers and marketplace settings
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const Conversation = require('../models/Conversation');
const SupportThread = require('../models/SupportThread');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { site, publicSite, updateSite } = require('../config/site');
const { emailMode } = require('../utils/mailer');
const notify = require('../utils/notify');
const { cached, invalidate } = require('../utils/cache');

// GET /api/admin/stats
// (kept for 15 seconds: reloads and several staff at once don't redo the totals)
exports.stats = asyncHandler(async (req, res) => {
  const stats = await cached('admin:stats', 15000, statsNow, { shared: true });
  if (require('../models/User').isAdminLevel(req.user?.role)) return res.json(stats);
  // moderators: the counts they work with, never the business's money (sales, commission, revenue, payments)
  const { gmv, commission, ...orderCounts } = stats.orders || {}; // eslint-disable-line no-unused-vars
  res.json({
    ...stats, orders: orderCounts, boosts: { count: stats.boosts?.count || 0 },
    plans: Object.fromEntries(Object.entries(stats.plans || {}).map(([status, plan]) => [status, { n: plan.n }])), money: false,
  });
});
async function statsNow() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [ads, newAds, users, newUsers, chats, reported, orders, support, boosts, plans, verifyPending, daily] = await Promise.all([
    // per status from the index (no full read of every ad)
    Promise.all(['active', 'sold', 'hidden'].map(async (st) => ({ _id: st, n: await Listing.countDocuments({ status: st }) }))),
    Listing.countDocuments({ createdAt: { $gte: since } }),
    Customer.estimatedDocumentCount(), // the collection's own count: instant
    Customer.countDocuments({ createdAt: { $gte: since } }),
    Conversation.estimatedDocumentCount(),
    Listing.countDocuments({ reportCount: { $gt: 0 }, status: { $ne: 'hidden' } }),
    Order.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: { $cond: [{ $ne: ['$status', 'awaiting_payment'] }, 1, 0] } },
          open: { $sum: { $cond: [{ $in: ['$status', ['placed', 'confirmed', 'shipped']] }, 1, 0] } },
          gmv: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$total', 0] } },
          commission: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'delivered'] }, { $eq: ['$payment.method', 'mpesa'] }] }, '$commission', 0] } },
          payoutsDue: { $sum: { $cond: [{ $eq: ['$payout.status', 'due'] }, '$payout.amount', 0] } },
          refundsDue: { $sum: { $cond: [{ $eq: ['$payment.status', 'refund_due'] }, 1, 0] } },
        },
      },
    ]),
    SupportThread.countDocuments({ status: 'open' }),
    require('../models/Boost').aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    require('../models/Plan').aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, paid: { $sum: '$paid' } } }]),
    require('../models/Customer').countDocuments({ 'verifyRequest.status': 'pending' }),
    Listing.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 14 * 24 * 3600 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Nairobi' } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const byStatus = Object.fromEntries(ads.map((ad) => [ad._id, ad.n]));
  return {
    ads: { active: byStatus.active || 0, sold: byStatus.sold || 0, hidden: byStatus.hidden || 0, newThisWeek: newAds, reported },
    users: { total: users, newThisWeek: newUsers },
    chats,
    orders: orders[0] || { total: 0, open: 0, gmv: 0, commission: 0, payoutsDue: 0, refundsDue: 0 },
    supportOpen: support,
    boosts: { revenue: boosts[0]?.total || 0, count: boosts[0]?.n || 0 },
    plans: Object.fromEntries(plans.map((plan) => [plan._id, { n: plan.n, paid: plan.paid }])),
    verifyPending,
    adsPerDay: daily.map((item) => ({ day: item._id, n: item.n })),
  };
}

// GET /api/admin/settings
exports.getSettings = (req, res) => {
  const settings = site();
  // moderators: only what the public site shows (no email server or M-Pesa connection details)
  if (!require('../models/User').isAdminLevel(req.user?.role)) return res.json(publicSite());
  res.json({
    ...publicSite(),
    url: settings.url,
    email: { mode: emailMode(), from: process.env.MAIL_FROM || '', host: process.env.SMTP_HOST || '' , contact: publicSite().email },
    mpesa: { env: settings.mpesa.env, configured: !!(settings.mpesa.consumerKey && settings.mpesa.consumerSecret && settings.mpesa.shortcode && settings.mpesa.passkey), callbackUrl: String(settings.mpesa.callbackUrl || '').replace(/\/[^/]+$/, '/••••••') },
  });
};

// PUT /api/admin/settings  (admins only)
// the settings that change what people pay or earn: only the owner may change them
const MONEY_SETTINGS = ['commissionPercent', 'fieldwork', 'courier', 'demoPayments'];
exports.MONEY_SETTINGS = MONEY_SETTINGS;
exports.putSettings = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const moneyChanges = MONEY_SETTINGS.filter((key) => body[key] !== undefined);
  if (moneyChanges.length && req.user?.role !== 'owner') throw httpError('Only the owner can change prices, commissions and payments', 403);
  const str = (value, max) => String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
  const changes = {};
  if (body.name !== undefined) {
    if (str(body.name, 60).length < 2) throw httpError('Please enter the marketplace name');
    changes.name = str(body.name, 60);
  }
  for (const [key, max] of [['tagline', 140], ['address', 200], ['phone', 30], ['whatsapp', 30]]) if (body[key] !== undefined) changes[key] = str(body[key], max);
  // the support email: a real address or empty (never "[object Object]" or other junk shown to customers)
  if (body.email !== undefined) {
    const email = typeof body.email === 'string' ? str(body.email, 120) : null;
    if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) throw httpError('Enter a valid support email (or leave it empty)');
    changes.email = email;
  }
  // social media: each must be an https link on that network's own website (or empty to hide it)
  if (body.social && typeof body.social === 'object') {
    const HOSTS = { tiktok: /(^|\.)tiktok\.com$/, instagram: /(^|\.)instagram\.com$/, facebook: /(^|\.)(facebook|fb)\.com$/, x: /(^|\.)(x|twitter)\.com$/, youtube: /(^|\.)(youtube\.com|youtu\.be)$/ };
    const NAMES = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X (Twitter)', youtube: 'YouTube' };
    changes.social = {};
    for (const key of Object.keys(HOSTS)) {
      const strResult = str(body.social[key], 200);
      if (!strResult) { changes.social[key] = ''; continue; }
      let url;
      try {
        url = new URL(/^https?:\/\//i.test(strResult) ? strResult : `https://${strResult}`);
      } catch {
        throw httpError(`The ${NAMES[key]} link isn’t a valid web address`);
      }
      if (url.protocol !== 'https:' || !HOSTS[key].test(url.hostname)) throw httpError(`The ${NAMES[key]} link must be on ${NAMES[key]}'s own website (https://…)`);
      changes.social[key] = url.toString();
    }
  }
  if (body.mapsKey !== undefined) {
    const strResult = str(body.mapsKey, 120);
    if (strResult && !/^[A-Za-z0-9_-]{20,}$/.test(strResult)) throw httpError('That doesn’t look like a Google Maps API key (it starts with AIza…)');
    changes.mapsKey = strResult;
  }
  if (body.commissionPercent !== undefined) {
    const commissionPercent = Number(body.commissionPercent);
    if (!(commissionPercent >= 0 && commissionPercent <= 50)) throw httpError('Commission must be between 0 and 50%');
    changes.commissionPercent = commissionPercent;
  }
  // riders & shopping agents
  if (body.fieldwork && typeof body.fieldwork === 'object') {
    const fieldwork = body.fieldwork;
    const num = (key, lo, hi, label) => {
      const number = Number(fieldwork[key]);
      if (!(number >= lo && number <= hi)) throw httpError(`${label} must be between ${lo} and ${hi}`);
      return number;
    };
    changes.fieldwork = {
      riderEnabled: fieldwork.riderEnabled !== false && fieldwork.riderEnabled !== 'false',
      riderBase: num('riderBase', 0, 5000, 'Rider base fee'), riderPerKm: num('riderPerKm', 0, 500, 'Rider fee per km'), riderPerMin: fieldwork.riderPerMin === undefined || fieldwork.riderPerMin === '' ? 2 : num('riderPerMin', 0, 100, 'Rider fee per minute'),
      riderMin: num('riderMin', 0, 5000, 'Lowest rider fee'), riderMaxKm: num('riderMaxKm', 1, 200, 'Longest rider trip (km)'),
      riderSharePercent: num('riderSharePercent', 0, 100, 'Rider’s share'),
      inspectEnabled: fieldwork.inspectEnabled !== false && fieldwork.inspectEnabled !== 'false',
      inspectPercent: num('inspectPercent', 0, 20, 'Inspection fee (%)'), inspectMin: num('inspectMin', 200, 5000, 'Lowest inspection fee (our agent’s fee starts from KSh 200)'),
      inspectMax: num('inspectMax', 0, 50000, 'Highest inspection fee'), agentSharePercent: num('agentSharePercent', 0, 100, 'Agent’s share'),
      ...(fieldwork.directFee !== undefined ? { directFee: num('directFee', 0, 5000, 'Verification fee for split payments') } : {}),
      ...(fieldwork.inspectFreeKm !== undefined ? {
        inspectFreeKm: num('inspectFreeKm', 0, 20, 'Free delivery distance (km)'), inspectFreeKg: num('inspectFreeKg', 0, 100, 'Free delivery weight (kg)'),
        inspectBaseFee: num('inspectBaseFee', 0, 5000, 'Inspect & deliver fee'), inspectBaseKm: num('inspectBaseKm', 0, 50, 'Distance covered by that fee (km)'),
      } : {}),
    };
    if (fieldwork.commissionPercent !== undefined) {
      Object.assign(changes.fieldwork, {
        commissionPercent: num('commissionPercent', 0, 50, 'Our commission on agent fees (%)'),
        taxPercent: num('taxPercent', 0, 30, 'Tax on agent fees (%)'),
        payoutDelayMin: num('payoutDelayMin', 0, 1440, 'Minutes before paying the agent'),
      });
    }
    if (changes.fieldwork.inspectMax < changes.fieldwork.inspectMin) throw httpError('The highest inspection fee can’t be below the lowest');
    if (changes.fieldwork.directFee > 0 && changes.fieldwork.directFee < 200) throw httpError('Our agent’s verification fee starts from KSh 200 (or 0 to switch it off)');
  }
  if (body.courier && typeof body.courier === 'object') changes.courier = require('../market/courier').cleanCourier(body.courier, httpError);
  if (body.demoPayments !== undefined) changes.demoPayments = body.demoPayments === true || body.demoPayments === 'true';
  if (body.campaign && typeof body.campaign === 'object') {
    const campaign = body.campaign;
    const link = str(campaign.link, 200);
    changes.campaign = {
      active: campaign.active === true || campaign.active === 'true',
      emoji: str(campaign.emoji, 8), title: str(campaign.title, 80), subtitle: str(campaign.subtitle, 160), cta: str(campaign.cta, 30),
      link: /^\/[^/]/.test(link) || link === '/' ? link : '', // only links inside the site
    };
    if (changes.campaign.active && !changes.campaign.title) throw httpError('Give the campaign a title');
  }
  if (Array.isArray(body.hours)) changes.hours = body.hours.slice(0, 10).map((item) => [str(item[0], 40), str(item[1], 40)]).filter((item) => item[0] && item[1]);
  await updateSite(changes);
  invalidate('market:');
  res.json(publicSite());
});

// POST /api/admin/email-test { to }
exports.emailTest = asyncHandler(async (req, res) => {
  const to = String(req.body.to || req.user.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw httpError('Enter a valid email address');
  const result = await notify.sendTest(to);
  if (!result.sent) throw httpError('Email failed: ' + result.reason, 502);
  res.json({ message: 'Test email sent to ' + to, preview: result.preview });
});
