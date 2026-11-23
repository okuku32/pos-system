// Trust: reviews (only from delivered orders), seller stats (rating, sales, response rate & time),
// and verified sellers (a team member checks who they are, then the ✔ badge shows on their ads).
const mongoose = require('mongoose');
const Review = require('../models/Review');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { cached, invalidate } = require('../utils/cache');
const { emitAdmin } = require('../utils/realtime');

const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);
const oid = (value) => new mongoose.Types.ObjectId(String(value));

// ---------------------------------------------------------------- seller numbers
// Rating average/count and completed sales are stored on the seller (fast to show everywhere)
async function refreshSellerStats(sellerId) {
  const [result] = await Review.aggregate([{ $match: { seller: oid(sellerId) } }, { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }]);
  const completedSales = await Order.countDocuments({ seller: sellerId, status: 'delivered' });
  await Customer.updateOne({ _id: sellerId }, { $set: { rating: { avg: result ? Math.round(result.avg * 10) / 10 : 0, count: result?.count || 0 }, completedSales } });
  invalidate(`seller:${sellerId}`);
}
exports.refreshSellerStats = refreshSellerStats;

// Response rate (share of chats answered) and typical reply time over the last 90 days
const responseStats = (sellerId) =>
  cached(`seller:${sellerId}:resp`, 10 * 60 * 1000, async () => {
    const convs = await Conversation.find({ seller: sellerId, createdAt: { $gte: new Date(Date.now() - 90 * 86400000) } })
      .select('createdAt sellerRepliedAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    if (convs.length < 2) return { responseRate: null, responseMinutes: null, chats: convs.length };
    const replied = convs.filter((conv) => conv.sellerRepliedAt);
    const mins = replied.map((item) => (new Date(item.sellerRepliedAt) - new Date(item.createdAt)) / 60000).sort((first, second) => first - second);
    return {
      responseRate: Math.round((replied.length / convs.length) * 100),
      responseMinutes: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null,
      chats: convs.length,
    };
  });

// Everything the ad page / seller page shows about a seller
exports.sellerProfile = async (sellerId) => {
  const [customer, ads, resp] = await Promise.all([
    Customer.findById(sellerId).select('name avatar createdAt about county verified rating completedSales shopLocation chemist sellerTypes trade').lean(),
    Listing.countDocuments({ seller: sellerId, status: 'active' }),
    responseStats(sellerId),
  ]);
  if (!customer) return null;
  return {
    _id: customer._id, name: customer.name, avatar: customer.avatar || '', about: customer.about || '', county: customer.county || '',
    memberSince: customer.createdAt, activeAds: ads, verified: !!customer.verified,
    rating: customer.rating || { avg: 0, count: 0 }, completedSales: customer.completedSales || 0, ...resp,
    shop: require('../market/geo').publicShop(customer),
    trade: require('../market/sellerProfile').publicTrade(customer.trade),
  };
};

// ---------------------------------------------------------------- reviews
// the service, star by star: only whole stars from 1 to 5 are kept
const ASPECTS = ['described', 'communication', 'delivery'];
const aspectsFrom = (given = {}) => Object.fromEntries(ASPECTS.map((key) => [key, Math.round(Number(given?.[key]))]).filter(([, value]) => value >= 1 && value <= 5));
// POST /api/orders/:id/review { rating, comment }  (the buyer, after delivery)
exports.reviewOrder = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id).lean();
  if (!order || String(order.buyer) !== String(req.customer._id)) throw httpError('Order not found', 404);
  if (order.status !== 'delivered') throw httpError('You can rate the seller once your order is delivered');
  const rating = Math.round(Number(req.body.rating));
  if (!(rating >= 1 && rating <= 5)) throw httpError('Please choose 1 to 5 stars');
  if (await Review.exists({ order: order._id })) throw httpError('You already reviewed this order', 409);
  const review = await Review.create({
    order: order._id, seller: order.seller, buyer: order.buyer, buyerName: order.buyerName, itemTitle: order.items[0]?.title,
    rating, comment: clean(req.body.comment, 500), aspects: aspectsFrom(req.body.aspects),
  });
  await refreshSellerStats(order.seller);
  res.status(201).json(review);
});

// GET /api/orders/:id/review  (has this order been reviewed?)
exports.getOrderReview = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  // only the buyer or the seller of that order
  const order = await require('../models/Order').findById(req.params.id).select('buyer seller').lean();
  const me = String(req.customer._id);
  if (!order || (String(order.buyer) !== me && String(order.seller) !== me)) throw httpError('Order not found', 404);
  res.json(await Review.findOne({ order: req.params.id }).lean());
});

// GET /api/market/sellers/:id/reviews
exports.sellerReviews = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Seller not found', 404);
  const list = await Review.find({ seller: req.params.id }).sort({ createdAt: -1 }).limit(50).lean();
  const dist = [5, 4, 3, 2, 1].map((item) => ({ stars: item, n: list.filter((element) => element.rating === item).length }));
  // service averages (item as described, communication, delivery) over every review that rated them
  const [service] = await Review.aggregate([{ $match: { seller: oid(req.params.id) } }, { $group: { _id: null, ...Object.fromEntries(ASPECTS.map((key) => [key, { $avg: `$aspects.${key}` }])), ...Object.fromEntries(ASPECTS.map((key) => [`${key}N`, { $sum: { $cond: [{ $gt: [`$aspects.${key}`, 0] }, 1, 0] } }])) } }]);
  res.json({
    service: Object.fromEntries(ASPECTS.filter((key) => service?.[`${key}N`] > 0).map((key) => [key, { avg: Math.round(service[key] * 10) / 10, count: service[`${key}N`] }])),
    reviews: list.map((item) => ({ _id: item._id, rating: item.rating, aspects: item.aspects || {}, comment: item.comment, buyerName: item.buyerName.split(' ')[0], itemTitle: item.itemTitle, reply: item.reply, at: item.createdAt })),
    distribution: dist,
  });
});

// POST /api/market/reviews/:id/reply { text }  (the seller answers publicly, once)
exports.replyReview = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Review not found', 404);
  const review = await Review.findById(req.params.id);
  if (!review || String(review.seller) !== String(req.customer._id)) throw httpError('Review not found', 404);
  if (review.reply) throw httpError('You already replied to this review');
  const text = clean(req.body.text, 500);
  if (text.length < 2) throw httpError('Please write a reply');
  review.reply = text;
  review.repliedAt = new Date();
  await review.save();
  res.json(review);
});

// ---------------------------------------------------------------- verification
// POST /api/customers/me/verify { note }  (a seller asks to be verified)
exports.requestVerification = asyncHandler(async (req, res) => {
  const customer = req.customer;
  if (customer.verified) throw httpError('You are already verified');
  if (!customer.phone) throw httpError('Add your phone number first (Account → Profile): our team will call you on it');
  if (customer.verifyRequest?.status === 'pending') throw httpError('Your request is being reviewed. We’ll be in touch soon.');
  customer.verifyRequest = { status: 'pending', note: clean(req.body.note, 300), at: new Date() };
  await customer.save();
  emitAdmin('seller:verify-request', { _id: customer._id, name: customer.name });
  res.json({ status: 'pending' });
});

// GET /api/admin/sellers?q=&pending=1&page=
exports.adminSellers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.pending === '1') filter['verifyRequest.status'] = 'pending';
  if (req.query.verified === '1') filter.verified = true;
  if (req.query.chemists === '1') filter['chemist.status'] = { $in: ['pending', 'verified', 'rejected'] };
  const text = clean(req.query.q, 60).replace(/[.*+?^${}()|[\]\\]/g, '');
  if (text) filter.$or = [{ name: new RegExp(text, 'i') }, { email: new RegExp(text, 'i') }, { phone: new RegExp(text.replace(/^0/, '254'), 'i') }];
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const sort = req.query.pending === '1' ? { 'verifyRequest.at': 1 } : req.query.chemists === '1' ? { 'chemist.status': 1, 'chemist.at': 1 } : { createdAt: -1 };
  const [list, total, pending, chemistsPending] = await Promise.all([
    Customer.find(filter).sort(sort).skip((page - 1) * 50).limit(50).select('name email phone county createdAt verified verifyRequest rating completedSales active chemist shopLocation.name shopLocation.address shopLocation.point').lean(),
    Customer.countDocuments(filter),
    Customer.countDocuments({ 'verifyRequest.status': 'pending' }),
    Customer.countDocuments({ 'chemist.status': 'pending' }),
  ]);
  const ids = list.map((item) => item._id);
  const [ads, flags] = await Promise.all([
    Listing.aggregate([{ $match: { seller: { $in: ids } } }, { $group: { _id: '$seller', n: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }, reports: { $sum: '$reportCount' } } }]),
    Conversation.aggregate([{ $match: { seller: { $in: ids }, flagged: { $gt: 0 } } }, { $group: { _id: '$seller', n: { $sum: '$flagged' } } }]),
  ]);
  const adMap = Object.fromEntries(ads.map((ad) => [String(ad._id), ad]));
  const flagMap = Object.fromEntries(flags.map((flag) => [String(flag._id), flag.n]));
  res.json({
    sellers: list.map((item) => ({ ...item, ads: adMap[String(item._id)]?.n || 0, activeAds: adMap[String(item._id)]?.active || 0, reports: adMap[String(item._id)]?.reports || 0, scamFlags: flagMap[String(item._id)] || 0 })),
    total, pages: Math.max(1, Math.ceil(total / 50)), pending, chemistsPending,
  });
});

// POST /api/admin/sellers/:id { action: 'verify' | 'unverify' | 'reject' | 'disable' | 'enable', note }
exports.adminSellerAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Seller not found', 404);
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw httpError('Seller not found', 404);
  const note = clean(req.body.note, 200);
  switch (req.body.action) {
    case 'verify':
      customer.verified = true;
      customer.verifiedAt = new Date();
      customer.set('verifyRequest.status', 'none');
      customer.set('verifyRequest.reviewNote', note);
      await Listing.updateMany({ seller: customer._id }, { $set: { sellerVerified: true } });
      break;
    case 'unverify':
      customer.verified = false;
      await Listing.updateMany({ seller: customer._id }, { $set: { sellerVerified: false } });
      break;
    case 'reject':
      customer.set('verifyRequest.status', 'rejected');
      customer.set('verifyRequest.reviewNote', note || 'We could not confirm your details');
      break;
    case 'disable':
      customer.active = false; // can't log in; their ads are taken down
      await Listing.updateMany({ seller: customer._id, status: 'active' }, { $set: { status: 'hidden', hiddenReason: note || 'Seller account suspended' } });
      break;
    case 'enable':
      customer.active = true;
      break;
    case 'chemist-approve':
      if (!customer.chemist?.licenceNo) throw httpError('This seller hasn’t sent a chemist licence');
      customer.set('chemist.status', 'verified');
      customer.set('chemist.verifiedAt', new Date());
      customer.set('chemist.reviewNote', note);
      break;
    case 'chemist-reject':
      customer.set('chemist.status', 'rejected');
      customer.set('chemist.reviewNote', note || 'We could not confirm your licence with the Pharmacy and Poisons Board');
      break;
    case 'chemist-revoke':
      customer.set('chemist.status', 'rejected');
      customer.set('chemist.reviewNote', note || 'Your chemist licence is no longer verified');
      // their medicines come down until they're verified again
      await Listing.updateMany({ seller: customer._id, category: 'pharmacy', status: 'active' }, { $set: { status: 'hidden', hiddenReason: 'Chemist licence not verified' } });
      break;
    default:
      throw httpError('Unknown action');
  }
  await customer.save();
  invalidate('market:');
  invalidate(`seller:${customer._id}`);
  res.json({ _id: customer._id, verified: customer.verified, active: customer.active, verifyRequest: customer.verifyRequest, chemist: customer.chemist });
});
