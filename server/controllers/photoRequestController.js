// 📸 "Can't find it? Send a photo": buyers send a seller a photo of something the seller has but hasn't posted
// (so it can't go in the cart). The seller answers with one of their ads, posts a new ad for it in one step, or says
// they don't have it. The buyer then adds the ad to their cart as usual. Our team sees every request.
const crypto = require('crypto');
const mongoose = require('mongoose');
const PhotoRequest = require('../models/PhotoRequest');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const files = require('../security/privateFiles');
const { COUNTIES } = require('../market/categories');
const { emitAdmin } = require('../utils/realtime');

const BUCKET = 'requests';
const MAX_PHOTOS = 3;
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);
const alert = (to, data) => require('../market/alerts').send(to, { kind: 'request', icon: '📸', ...data }).catch(() => {});

exports.upload = files.uploader(BUCKET, { field: 'photos', max: MAX_PHOTOS, sizeMb: 8 });

// what the buyer, the seller and our team see (photos are links to the private, checked file route)
const view = (request, base = '/market/photo-requests') => ({
  _id: request._id, no: request.no, status: request.status, what: request.what, note: request.note || '', qty: request.qty, budget: request.budget || null,
  buyer: { _id: request.buyer, name: request.buyerName }, seller: { _id: request.seller, name: request.sellerName },
  photos: (request.photos || []).map((photo, index) => `${base}/${request._id}/photos/${index}`),
  answer: request.answer?.at ? request.answer : null,
  createdAt: request.createdAt, updatedAt: request.updatedAt,
});

// POST /api/market/photo-requests  (multipart: photos[1-3], sellerId, what, note, qty, budget)
exports.create = asyncHandler(async (req, res) => {
  try {
    if (!req.files?.length) throw httpError('Take or choose a photo of the item');
    if (!isId(req.body.sellerId)) throw httpError('Seller not found', 404);
    if (String(req.body.sellerId) === String(req.customer._id)) throw httpError('This is your own shop');
    const seller = await Customer.findOne({ _id: req.body.sellerId, active: { $ne: false } }).select('name').lean();
    if (!seller || !(await Listing.exists({ seller: seller._id, status: 'active' }))) throw httpError('Seller not found', 404);
    const what = clean(req.body.what, 120);
    if (what.length < 3) throw httpError('Say what it is, e.g. “Black school shoes, size 38”');
    const qty = Math.round(Number(req.body.qty) || 1);
    if (!(qty >= 1 && qty <= 999)) throw httpError('Quantity: 1 to 999');
    const budget = req.body.budget ? Math.round(Number(req.body.budget)) : null;
    if (budget !== null && !(budget > 0 && budget <= 10000000)) throw httpError('Budget: enter an amount in shillings, or leave it empty');
    // not a way to flood a seller
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [toSeller, today] = await Promise.all([
      PhotoRequest.countDocuments({ buyer: req.customer._id, seller: seller._id, status: 'open' }),
      PhotoRequest.countDocuments({ buyer: req.customer._id, createdAt: { $gte: since } }),
    ]);
    if (toSeller >= 5) throw httpError('You have 5 requests waiting for this seller. Wait for an answer first.', 429);
    if (today >= 20) throw httpError('You’ve sent 20 photo requests today. Please try again tomorrow.', 429);
    const request = await PhotoRequest.create({
      no: `PR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      buyer: req.customer._id, buyerName: req.customer.name, seller: seller._id, sellerName: seller.name,
      what, note: clean(req.body.note, 500), qty, ...(budget ? { budget } : {}),
      photos: req.files.map((file) => ({ file: file.filename, mime: file.mimetype })),
    });
    alert(seller._id, {
      link: '/market/requests?box=received',
      title: { en: `A buyer sent you a photo: ${what}`, sw: `Mnunuzi amekutumia picha: ${what}` },
      body: { en: `${req.customer.name} wants ${qty} of this. Tell them if you have it: pick your ad, or post it in one step.`, sw: `${req.customer.name} anataka ${qty}. Mwambie kama unayo.` },
    });
    emitAdmin('photo-request:new', { _id: request._id, no: request.no });
    res.status(201).json(view(request));
  } catch (err) {
    files.discard(req);
    throw err;
  }
});

// GET /api/market/photo-requests?box=sent|received
exports.mine = asyncHandler(async (req, res) => {
  const received = req.query.box === 'received';
  const list = await PhotoRequest.find(received ? { seller: req.customer._id } : { buyer: req.customer._id }).sort({ createdAt: -1 }).limit(100).lean();
  const counts = await PhotoRequest.aggregate([
    { $match: { $or: [{ seller: req.customer._id, status: 'open' }, { buyer: req.customer._id, seenByBuyer: false }] } },
    { $group: { _id: { $cond: [{ $eq: ['$seller', req.customer._id] }, 'received', 'sent'] }, n: { $sum: 1 } } },
  ]);
  // opened: the buyer has seen the answers
  if (!received && list.some((item) => !item.seenByBuyer)) await PhotoRequest.updateMany({ buyer: req.customer._id, seenByBuyer: false }, { $set: { seenByBuyer: true } });
  if (received && list.some((item) => !item.seenBySeller)) await PhotoRequest.updateMany({ seller: req.customer._id, seenBySeller: false }, { $set: { seenBySeller: true } });
  res.json({ box: received ? 'received' : 'sent', requests: list.map((item) => view(item)), waiting: Object.fromEntries(counts.map((row) => [row._id, row.n])) });
});

async function find(req) {
  if (!isId(req.params.id)) throw httpError('Request not found', 404);
  const request = await PhotoRequest.findById(req.params.id);
  if (!request) throw httpError('Request not found', 404);
  return request;
}

// GET /api/market/photo-requests/:id/photos/:n  (the buyer and that seller only)
exports.photo = asyncHandler(async (req, res) => {
  const request = await find(req);
  const me = String(req.customer._id);
  if (me !== String(request.buyer) && me !== String(request.seller)) throw httpError('Request not found', 404);
  const photo = request.photos[Number(req.params.n)];
  if (!photo) throw httpError('Photo not found', 404);
  files.send(res, BUCKET, photo.file, `${request.no}-${Number(req.params.n) + 1}`);
});

// POST /api/market/photo-requests/:id/answer  (the seller)
//   { action: 'listing', listingId }                                   → "It's this ad"
//   { action: 'create', title, price, stock, description, usePhoto }   → a new ad, posted now
//   { action: 'decline', note }                                        → "Sorry, I don't have it"
exports.answer = asyncHandler(async (req, res) => {
  const request = await find(req);
  if (String(request.seller) !== String(req.customer._id)) throw httpError('Request not found', 404);
  if (request.status !== 'open') throw httpError(request.status === 'cancelled' ? 'The buyer withdrew this request' : 'You already answered this request', 409);
  const note = clean(req.body.note, 300);
  let listing = null;
  if (req.body.action === 'listing') {
    if (!isId(req.body.listingId)) throw httpError('Choose one of your ads');
    listing = await Listing.findOne({ _id: req.body.listingId, seller: req.customer._id, status: 'active' }).select('title slug price').lean();
    if (!listing) throw httpError('Choose one of your live ads');
  } else if (req.body.action === 'create') {
    const seller = await Customer.findById(req.customer._id);
    const county = COUNTIES.includes(seller.shopLocation?.county) ? seller.shopLocation.county : 'Nairobi';
    const description = clean(req.body.description, 2000);
    const stock = Math.round(Number(req.body.stock) || request.qty);
    const images = req.body.usePhoto === false || req.body.usePhoto === 'false' ? [] : request.photos.map((photo) => files.copyToListings(BUCKET, photo.file)).filter(Boolean);
    try {
      listing = await require('./marketController').saveListing(seller, {
        category: 'other', sub: 'misc', condition: 'New',
        title: clean(req.body.title, 90) || request.what,
        description: description.length >= 20 ? description : `${request.what}${request.note ? `. ${request.note}` : ''}. Available now from ${seller.name}.`.slice(0, 2000),
        county, area: seller.shopLocation?.area || '', price: req.body.price,
        buyNow: true, stock, delivery: { available: true, fee: 0, pickup: true },
      }, images);
    } catch (err) {
      images.forEach((url) => require('../middleware/upload').removeListingImage(url));
      throw err;
    }
  } else if (req.body.action !== 'decline') throw httpError('Choose: one of your ads, post it now, or “I don’t have it”');

  request.status = listing ? 'answered' : 'declined';
  request.answer = listing
    ? { listing: listing._id, listingTitle: listing.title, listingSlug: listing.slug, price: listing.price, created: req.body.action === 'create', note, at: new Date() }
    : { note, at: new Date() };
  request.seenByBuyer = false;
  await request.save();
  alert(request.buyer, listing
    ? {
      link: `/market/item/${listing.slug}`,
      title: { en: `${request.sellerName} has it: ${listing.title}`, sw: `${request.sellerName} anayo: ${listing.title}` },
      body: { en: `KSh ${Number(listing.price).toLocaleString('en-KE')}. Open it and add it to your cart.`, sw: `KSh ${Number(listing.price).toLocaleString('en-KE')}. Fungua uiweke kwenye kikapu.` },
    }
    : {
      link: '/market/requests',
      title: { en: `${request.sellerName} doesn’t have “${request.what}”`, sw: `${request.sellerName} hana “${request.what}”` },
      body: { en: note || 'Try another seller in the same market.', sw: note || 'Jaribu muuzaji mwingine.' },
    });
  emitAdmin('photo-request:update', { _id: request._id });
  res.json(view(request));
});

// POST /api/market/photo-requests/:id/cancel  (the buyer)
exports.cancel = asyncHandler(async (req, res) => {
  const request = await find(req);
  if (String(request.buyer) !== String(req.customer._id)) throw httpError('Request not found', 404);
  if (request.status !== 'open') throw httpError('The seller already answered this request', 409);
  request.status = 'cancelled';
  await request.save();
  res.json(view(request));
});

// ---------------------------------------------------------------- our team
// GET /api/market/admin/photo-requests?status=open|answered|declined|cancelled
exports.adminList = asyncHandler(async (req, res) => {
  const filter = ['open', 'answered', 'declined', 'cancelled'].includes(req.query.status) ? { status: req.query.status } : {};
  const [list, counts] = await Promise.all([
    PhotoRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
    PhotoRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  res.json({ requests: list.map((item) => view(item, '/market/admin/photo-requests')), counts: Object.fromEntries(counts.map((row) => [row._id, row.n])) });
});

// GET /api/market/admin/photo-requests/:id/photos/:n  (logged in the audit trail)
exports.adminPhoto = asyncHandler(async (req, res) => {
  const request = await find(req);
  const photo = request.photos[Number(req.params.n)];
  if (!photo) throw httpError('Photo not found', 404);
  require('../security/audit').audit(req, 'photo-request.photo.view', { target: request.no });
  files.send(res, BUCKET, photo.file, `${request.no}-${Number(req.params.n) + 1}`);
});
