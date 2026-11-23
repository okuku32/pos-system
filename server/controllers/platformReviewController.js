// "Rate Kapu": public reviews of the platform by its buyers and sellers (stars + a comment), with the team's replies.
const mongoose = require('mongoose');
const PlatformReview = require('../models/PlatformReview');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { cached, invalidate } = require('../utils/cache');
const { emitAdmin } = require('../utils/realtime');

const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);
const TOPICS = ['buying', 'selling', 'delivery', 'payments', 'support', 'other'];
// "Akinyi Otieno" → "Akinyi O." (first name and an initial: enough to be real, not enough to find them)
const publicName = (name) => {
  const parts = String(name || 'Customer').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};
const view = (review, admin) => ({
  _id: review._id, name: review.name, role: review.role, verified: !!review.verified, rating: review.rating, topic: review.topic, comment: review.comment,
  reply: review.reply || '', repliedAt: review.repliedAt, at: review.createdAt, edited: !!review.editedAt,
  ...(admin ? { status: review.status, hiddenReason: review.hiddenReason || '', customer: review.customer } : {}),
});

// what this person has done on Kapu: buyer, seller or both (and did they complete an order?)
async function experienceOf(customerId) {
  const [bought, sold, delivered, ads, errands] = await Promise.all([
    Order.exists({ buyer: customerId, status: { $ne: 'awaiting_payment' } }),
    Order.exists({ seller: customerId, status: { $ne: 'awaiting_payment' } }),
    Order.exists({ $or: [{ buyer: customerId }, { seller: customerId }], status: 'delivered' }),
    Listing.exists({ seller: customerId }),
    require('../models/Errand').exists({ customer: customerId }).catch(() => null),
  ]);
  const buyer = !!(bought || errands);
  const seller = !!(sold || ads);
  return { buyer, seller, used: buyer || seller, verified: !!delivered, role: buyer && seller ? 'both' : seller ? 'seller' : 'buyer' };
}

// the public summary: average, count, stars distribution, and buyers vs sellers
const summary = () =>
  cached('reviews:summary', 60000, async () => {
    const rows = await PlatformReview.aggregate([
      { $match: { status: 'visible' } },
      { $facet: {
        all: [{ $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }],
        stars: [{ $group: { _id: '$rating', count: { $sum: 1 } } }],
        roles: [{ $group: { _id: '$role', avg: { $avg: '$rating' }, count: { $sum: 1 } } }],
      } },
    ]);
    const [facet] = rows;
    const all = facet.all[0];
    const role = (key) => facet.roles.filter((row) => row._id === key || row._id === 'both').reduce((total, row) => ({ sum: total.sum + row.avg * row.count, count: total.count + row.count }), { sum: 0, count: 0 });
    const side = (key) => { const value = role(key); return { avg: value.count ? Math.round((value.sum / value.count) * 10) / 10 : 0, count: value.count }; };
    return {
      avg: all ? Math.round(all.avg * 10) / 10 : 0, count: all?.count || 0,
      stars: [5, 4, 3, 2, 1].map((star) => ({ stars: star, count: facet.stars.find((row) => row._id === star)?.count || 0 })),
      buyers: side('buyer'), sellers: side('seller'),
    };
  });

// GET /api/reviews?role=buyer|seller&stars=1..5&sort=newest|highest|lowest&page=  (public)
exports.list = asyncHandler(async (req, res) => {
  const filter = { status: 'visible' };
  if (['buyer', 'seller'].includes(req.query.role)) filter.role = { $in: [req.query.role, 'both'] };
  const stars = Number(req.query.stars);
  if (stars >= 1 && stars <= 5) filter.rating = stars;
  const sort = { highest: { rating: -1, createdAt: -1 }, lowest: { rating: 1, createdAt: -1 } }[req.query.sort] || { createdAt: -1 };
  const page = Math.max(1, Math.min(100, parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(30, parseInt(req.query.limit, 10) || 12));
  const [list, total, stats] = await Promise.all([PlatformReview.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(), PlatformReview.countDocuments(filter), summary()]);
  res.json({ ...stats, reviews: list.map((review) => view(review)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// GET /api/reviews/mine  → my review (to edit) and whether I can post one
exports.mine = asyncHandler(async (req, res) => {
  const [review, experience] = await Promise.all([PlatformReview.findOne({ customer: req.customer._id }).lean(), experienceOf(req.customer._id)]);
  res.json({ review: review ? view(review) : null, canReview: experience.used, role: experience.role });
});

// POST /api/reviews { rating, comment, topic }  → post or update my review of Kapu
exports.save = asyncHandler(async (req, res) => {
  const experience = await experienceOf(req.customer._id);
  if (!experience.used) throw httpError('You can rate Kapu after your first order, sale or ad, so every review comes from a real customer.', 403);
  const rating = Math.round(Number(req.body.rating));
  if (!(rating >= 1 && rating <= 5)) throw httpError('Please choose 1 to 5 stars');
  const comment = clean(req.body.comment, 800);
  if (comment.length < 10) throw httpError('Tell us a little more (at least 10 characters), so others know what it was like');
  const topic = TOPICS.includes(req.body.topic) ? req.body.topic : 'other';
  let review = await PlatformReview.findOne({ customer: req.customer._id });
  const created = !review;
  if (review?.status === 'hidden') throw httpError('Your review was hidden by our team. Contact support if you think that’s a mistake.', 403);
  if (!review) review = new PlatformReview({ customer: req.customer._id });
  Object.assign(review, { name: publicName(req.customer.name), role: experience.role, verified: experience.verified, rating, comment, topic });
  if (!created) review.editedAt = new Date();
  await review.save();
  invalidate('reviews:');
  emitAdmin('reviews:new', { _id: review._id, rating, name: review.name });
  res.status(created ? 201 : 200).json(view(review));
});

// DELETE /api/reviews/mine
exports.remove = asyncHandler(async (req, res) => {
  await PlatformReview.deleteOne({ customer: req.customer._id });
  invalidate('reviews:');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin
// GET /api/reviews/admin?status=visible|hidden&stars=
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (['visible', 'hidden'].includes(req.query.status)) filter.status = req.query.status;
  const stars = Number(req.query.stars);
  if (stars >= 1 && stars <= 5) filter.rating = stars;
  if (req.query.unanswered === '1') filter.reply = '';
  const [list, stats] = await Promise.all([PlatformReview.find(filter).sort({ createdAt: -1 }).limit(200).lean(), summary()]);
  res.json({ ...stats, reviews: list.map((review) => view(review, true)) });
});

// POST /api/reviews/admin/:id { action: reply | hide | show, text, reason }
exports.adminAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Review not found', 404);
  const review = await PlatformReview.findById(req.params.id);
  if (!review) throw httpError('Review not found', 404);
  const { audit } = require('../security/audit');
  if (req.body.action === 'reply') {
    const text = clean(req.body.text, 800);
    if (text.length < 2) throw httpError('Write a reply');
    review.reply = text;
    review.repliedAt = new Date();
  } else if (req.body.action === 'hide') {
    // never for being negative: abuse, spam, someone's phone number…
    const reason = clean(req.body.reason, 200);
    if (reason.length < 3) throw httpError('Say why (e.g. abusive words, spam, personal phone number). Reviews are never hidden for being negative.');
    review.status = 'hidden';
    review.hiddenReason = reason;
    audit(req, 'review.hidden', { target: `platformReview:${review._id}`, detail: `${review.rating}★ by ${review.name}: ${reason}` });
  } else if (req.body.action === 'show') {
    review.status = 'visible';
    review.hiddenReason = '';
    audit(req, 'review.shown', { target: `platformReview:${review._id}` });
  } else throw httpError('Unknown action');
  await review.save();
  invalidate('reviews:');
  res.json(view(review, true));
});

exports.publicName = publicName;
