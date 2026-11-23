// Paid boosts: a seller pays with M-Pesa and their ad shows as "🔥 Featured" first in search and on the home page.
const mongoose = require('mongoose');
const Boost = require('../models/Boost');
const Listing = require('../models/Listing');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { stkPush, stkQuery, formatPhone } = require('../utils/mpesa');
const { emitCustomer, emitAdmin } = require('../utils/realtime');
const { invalidate } = require('../utils/cache');

// one ad (sellers who aren't in one of our markets)
const BOOST_PLANS = {
  week: { days: 7, amount: 100, label: '1 week', note: 'Quick sale', kind: 'ad' },
  twoweeks: { days: 14, amount: 150, label: '2 weeks', note: 'Most popular', kind: 'ad' },
  month: { days: 30, amount: 250, label: '1 month', note: 'Best value', kind: 'ad' },
};
// sellers in our markets (traders): their whole business, KSh 200 a month (the only way they boost)
const BUSINESS_PLAN = { key: 'business', days: 30, amount: 200, label: '1 month', note: 'All your ads + your business featured', kind: 'business' };
const ALL_PLANS = { ...BOOST_PLANS, business: BUSINESS_PLAN };
exports.BOOST_PLANS = BOOST_PLANS;
exports.BUSINESS_PLAN = BUSINESS_PLAN;
exports.ALL_PLANS = ALL_PLANS;
// a trader: a seller whose shop is in one of our markets
const isTrader = (customer) => !!customer?.shopLocation?.market;
exports.isTrader = isTrader;
const isId = (value) => mongoose.isValidObjectId(value);
const view = (other) => ({ _id: other._id, kind: other.kind || 'ad', listing: other.listing, plan: other.plan, days: other.days, amount: other.amount, status: other.status, receipt: other.receipt, failReason: other.failReason, startsAt: other.startsAt, endsAt: other.endsAt, createdAt: other.createdAt });

// GET /api/market/boosts/plans  → single-ad plans, and the business plan for sellers in our markets
exports.plans = (req, res) => res.json([...Object.entries(BOOST_PLANS).map(([key, value]) => ({ key, ...value })), BUSINESS_PLAN]);

// POST /api/market/boosts { plan, phone, listingId? }  (listingId: a single-ad plan · plan 'business': a market trader)
exports.create = asyncHandler(async (req, res) => {
  const boostPlan = ALL_PLANS[req.body.plan];
  if (!boostPlan) throw httpError('Please choose a boost package');
  const business = boostPlan.kind === 'business';
  const trader = isTrader(req.customer);
  if (business && !trader) throw httpError('“Boost my business” is for sellers in one of our markets. Boost your ads one at a time instead.', 403);
  if (!business && trader) throw httpError(`You sell in ${req.customer.shopLocation?.marketName || 'one of our markets'}: boost your whole business (all your ads) for KSh ${BUSINESS_PLAN.amount} a month instead.`, 409);
  let listing = null;
  if (!business) {
    if (!isId(req.body.listingId)) throw httpError('Ad not found', 404);
    listing = await Listing.findById(req.body.listingId).select('seller status title boostedUntil').lean();
    if (!listing || String(listing.seller) !== String(req.customer._id)) throw httpError('Ad not found', 404);
    if (listing.status !== 'active') throw httpError('Only live ads can be boosted');
  } else if (!(await Listing.exists({ seller: req.customer._id, status: 'active' }))) throw httpError('Post at least one ad first, then boost your business');
  const what = business ? { kind: 'business', listingTitle: `${req.customer.shopLocation?.name || req.customer.name}: all ads (business)` } : { kind: 'ad', listing: listing._id, listingTitle: listing.title };
  let phone;
  try {
    phone = formatPhone(req.body.phone || req.customer.phone || '');
  } catch {
    throw httpError('Please enter a valid Safaricom number for the M-Pesa payment');
  }
  if (require('../config/site').site().demoPayments) {
    const id = `demo-boost-${require('crypto').randomBytes(6).toString('hex')}`;
    const currentBoost = await Boost.create({ ...what, seller: req.customer._id, plan: req.body.plan, days: boostPlan.days, amount: boostPlan.amount, phone, checkoutRequestId: id });
    await settleBoost(id, { ok: true, receipt: `DEMO${id.slice(-6).toUpperCase()}` });
    return res.status(201).json({ boost: view(await Boost.findById(currentBoost._id)), message: 'Demo payment: boost switched on without money (M-Pesa isn’t connected yet)' });
  }
  let result;
  try {
    result = await stkPush({ phone, amount: boostPlan.amount, accountReference: 'BOOST', description: business ? 'Business boost' : 'Ad boost' });
  } catch (err) {
    throw httpError(`M-Pesa payment could not start: ${err.response?.data?.errorMessage || err.message}`, 502);
  }
  const boost = await Boost.create({ ...what, seller: req.customer._id, plan: req.body.plan, days: boostPlan.days, amount: boostPlan.amount, phone, checkoutRequestId: result.CheckoutRequestID });
  res.status(201).json({ boost: view(boost), message: result.CustomerMessage || 'Check your phone and enter your M-Pesa PIN' });
});

// Payment result (from the callback or a status check)
async function settleBoost(checkoutRequestId, { ok, receipt, reason }) {
  const boost = await Boost.findOne({ checkoutRequestId, status: 'pending' });
  if (!boost) return 0;
  if (!ok) {
    boost.status = 'failed';
    boost.failReason = reason || 'Payment was not completed';
    await boost.save();
  } else if (boost.kind === 'business') {
    // the whole business: every live ad featured, and the shop first, until the end of the month (paying again adds a month)
    const Customer = require('../models/Customer');
    const seller = await Customer.findById(boost.seller).select('businessBoostUntil');
    const from = seller?.businessBoostUntil && seller.businessBoostUntil > new Date() ? seller.businessBoostUntil : new Date();
    boost.status = 'paid';
    boost.receipt = receipt;
    boost.paidAt = new Date();
    boost.startsAt = from;
    boost.endsAt = new Date(from.getTime() + boost.days * 86400000);
    await boost.save();
    await Customer.updateOne({ _id: boost.seller }, { $set: { businessBoostUntil: boost.endsAt } });
    await Listing.updateMany({ seller: boost.seller, status: 'active', $or: [{ boostedUntil: null }, { boostedUntil: { $lt: boost.endsAt } }] }, { $set: { boostedUntil: boost.endsAt } });
    invalidate('market:');
    emitAdmin('boost:paid', view(boost));
  } else {
    const listing = await Listing.findById(boost.listing).select('boostedUntil');
    const from = listing?.boostedUntil && listing.boostedUntil > new Date() ? listing.boostedUntil : new Date(); // boosting again adds days
    boost.status = 'paid';
    boost.receipt = receipt;
    boost.paidAt = new Date();
    boost.startsAt = from;
    boost.endsAt = new Date(from.getTime() + boost.days * 86400000);
    await boost.save();
    await Listing.updateOne({ _id: boost.listing }, { $set: { boostedUntil: boost.endsAt } });
    invalidate('market:');
    emitAdmin('boost:paid', view(boost));
  }
  emitCustomer(String(boost.seller), 'boost:update', view(boost));
  return 1;
}
exports.settleBoost = settleBoost;

// GET /api/market/boosts/:id  (the seller's "waiting for M-Pesa" screen polls this)
exports.get = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Boost not found', 404);
  let boost = await Boost.findById(req.params.id);
  if (!boost || String(boost.seller) !== String(req.customer._id)) throw httpError('Boost not found', 404);
  if (boost.status === 'pending' && Date.now() - boost.createdAt > 8000) {
    try {
      const stkQueryResult = await stkQuery(boost.checkoutRequestId);
      if (String(stkQueryResult.ResultCode) === '0') await settleBoost(boost.checkoutRequestId, { ok: true, receipt: stkQueryResult.MpesaReceiptNumber || '' });
      else if (stkQueryResult.ResultCode !== undefined && !/process/i.test(stkQueryResult.ResultDesc || '')) await settleBoost(boost.checkoutRequestId, { ok: false, reason: stkQueryResult.ResultDesc });
      boost = await Boost.findById(boost._id);
    } catch {
      /* still processing */
    }
  }
  res.json(view(boost));
});

// GET /api/market/boosts  (my boosts)
exports.mine = asyncHandler(async (req, res) => {
  const list = await Boost.find({ seller: req.customer._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json(list.map((item) => ({ ...view(item), listingTitle: item.listingTitle })));
});

// Expired boosts stop being featured (keeps the "Featured first" sort simple and fast)
exports.startBoostWorker = () => {
  const sweep = () =>
    Listing.updateMany({ boostedUntil: { $lte: new Date() } }, { $set: { boostedUntil: null } })
      .then((result) => result.modifiedCount && invalidate('market:'))
      .catch(() => {});
  require('../utils/jobs').every('boost-expiry', 10 * 60 * 1000, sweep)(); // one server at a time; once now
};
