// Marketplace: customers post ads (vehicles, land, electronics...), everyone searches them, and buyers chat with sellers.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const { httpError } = require('../utils/saleService');
const { cached, invalidate } = require('../utils/cache');
const { emitCustomer } = require('../utils/realtime');
const { sendMail } = require('../utils/mailer');
const templates = require('../utils/emailTemplates');
const { listingImageUrl, removeListingImage } = require('../middleware/upload');
const { CATEGORIES, COUNTIES, getCategory, getSub, fieldsFor } = require('../market/categories');
const search = require('../market/search');

const PAGE_SIZE = 24;
const MAX_ACTIVE_ADS = 50; // per seller
const clean = (s, max) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (s, max) => String(s ?? '').replace(/[<>]/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const isId = (v) => mongoose.isValidObjectId(v);

const slugify = (s) =>
  search.normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'ad';

// What a listing card shows (search results, home page, similar ads)
const CARD_FIELDS = 'slug title price negotiable condition county area images category sub attrs createdAt status';
function card(l) {
  const a = l.attrs || {};
  const bits = [a.year, a.mileage ? `${Number(a.mileage).toLocaleString('en-KE')} km` : null, a.transmission, a.size ? `${a.size} ${a.unit || ''}`.trim() : null, a.storage ? `${a.storage}${/^\d+$/.test(a.storage) ? 'GB' : ''}` : null, a.screen ? `${a.screen}"` : null, a.bedrooms ? `${a.bedrooms} bedroom` : null, a.volume, a.brand]
    .filter(Boolean)
    .slice(0, 3);
  return {
    _id: l._id, slug: l.slug, title: l.title, price: l.price, negotiable: l.negotiable, condition: l.condition,
    county: l.county, area: l.area, image: l.images?.[0] || '', photos: l.images?.length || 0,
    category: l.category, sub: l.sub, facts: bits, createdAt: l.createdAt, status: l.status,
  };
}

const sellerSummary = async (sellerId) => {
  const [c, ads] = await Promise.all([
    Customer.findById(sellerId).select('name avatar createdAt').lean(),
    Listing.countDocuments({ seller: sellerId, status: 'active' }),
  ]);
  return c ? { _id: c._id, name: c.name, avatar: c.avatar || '', memberSince: c.createdAt, activeAds: ads } : null;
};

// ---------------------------------------------------------------- categories & counts
const countsByCategory = () =>
  cached('market:counts', 30000, async () => {
    const rows = await Listing.aggregate([{ $match: { status: 'active' } }, { $group: { _id: { c: '$category', s: '$sub' }, n: { $sum: 1 } } }]);
    const out = {};
    for (const r of rows) {
      out[r._id.c] = out[r._id.c] || { total: 0, subs: {} };
      out[r._id.c].total += r.n;
      out[r._id.c].subs[r._id.s] = r.n;
    }
    return out;
  });
exports.countsByCategory = countsByCategory;

// GET /api/market/categories (everything the forms and filters need)
exports.categories = asyncHandler(async (req, res) => {
  const counts = await countsByCategory();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    counties: COUNTIES,
    categories: CATEGORIES.map((c) => ({
      ...c,
      count: counts[c.slug]?.total || 0,
      subs: c.subs.map((s) => ({ ...s, count: counts[c.slug]?.subs[s.slug] || 0 })),
    })),
  });
});

// ---------------------------------------------------------------- search
// Builds the database query from the search box text and the filters
function buildQuery(params) {
  const filter = { status: 'active' };
  const info = { detected: null, priceFromText: null };
  const { category, sub, county, condition } = params;
  if (category && getCategory(category)) filter.category = category;
  if (sub && filter.category && getSub(category, sub)) filter.sub = sub;
  if (county && COUNTIES.includes(county)) filter.county = county;
  if (condition) filter.condition = String(condition).slice(0, 40);
  if (params.photos === '1') filter['images.0'] = { $exists: true };

  // price: explicit filters win over words in the search text
  let q = clean(params.q, 120);
  const p = search.parsePrice(q);
  if (p.min !== null || p.max !== null) {
    q = p.text;
    info.priceFromText = { min: p.min, max: p.max };
  }
  const min = params.minPrice !== undefined && params.minPrice !== '' ? Number(params.minPrice) : p.min;
  const max = params.maxPrice !== undefined && params.maxPrice !== '' ? Number(params.maxPrice) : p.max;
  if (Number.isFinite(min) || Number.isFinite(max)) {
    filter.price = {};
    if (Number.isFinite(min) && min > 0) filter.price.$gte = min;
    if (Number.isFinite(max) && max > 0) filter.price.$lte = max;
    if (!Object.keys(filter.price).length) delete filter.price;
  }

  // detail filters for the chosen sub-category (make, model, year range, size...)
  if (filter.category && filter.sub) {
    for (const f of fieldsFor(filter.category, filter.sub)) {
      const v = params[f.key];
      if (f.type === 'number') {
        const lo = Number(params[`${f.key}_min`]);
        const hi = Number(params[`${f.key}_max`]);
        if (Number.isFinite(lo) && params[`${f.key}_min`] !== '' && params[`${f.key}_min`] !== undefined) filter[`attrs.${f.key}`] = { ...(filter[`attrs.${f.key}`] || {}), $gte: lo };
        if (Number.isFinite(hi) && params[`${f.key}_max`] !== '' && params[`${f.key}_max`] !== undefined) filter[`attrs.${f.key}`] = { ...(filter[`attrs.${f.key}`] || {}), $lte: hi };
      } else if (v) {
        const vals = String(v).split('|').map((x) => clean(x, 60)).filter(Boolean).slice(0, 10);
        if (f.type === 'text') filter[`attrs.${f.key}`] = new RegExp(`^${vals[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        else filter[`attrs.${f.key}`] = vals.length > 1 ? { $in: vals } : vals[0];
      }
    }
  } else if (params.make) {
    filter['attrs.make'] = clean(params.make, 40); // make chosen without a sub-category (e.g. from a suggestion)
    if (params.model) filter['attrs.model'] = clean(params.model, 40);
  }

  if (q && !filter.category) info.detected = search.detectCategory(q);
  return { filter, q, info };
}

const SORTS = {
  newest: { createdAt: -1 },
  'price-asc': { price: 1, createdAt: -1 },
  'price-desc': { price: -1, createdAt: -1 },
  popular: { views: -1, createdAt: -1 },
};

async function runSearch(params) {
  const page = Math.max(1, Math.min(200, parseInt(params.page, 10) || 1));
  const limit = Math.max(1, Math.min(48, parseInt(params.limit, 10) || PAGE_SIZE));
  const sort = SORTS[params.sort] || SORTS.newest;
  const { filter, q, info } = buildQuery(params);

  let relaxed = false;
  let where = filter;
  if (q) {
    where = { ...filter, ...search.wordFilter(q, 'all').filter };
    if (!(await Listing.exists(where))) {
      // nothing has every word: show ads matching some of them instead of an empty page
      const loose = { ...filter, ...search.wordFilter(q, 'any').filter };
      if (await Listing.exists(loose)) {
        where = loose;
        relaxed = true;
      }
    }
  }
  const [items, total] = await Promise.all([
    Listing.find(where).sort(sort).skip((page - 1) * limit).limit(limit).select(CARD_FIELDS).lean(),
    Listing.countDocuments(where),
  ]);
  return { items: items.map(card), total, page, pages: Math.max(1, Math.ceil(total / limit)), relaxed, q, ...info };
}
exports.runSearch = runSearch;

// GET /api/market/listings?q=&category=&sub=&county=&minPrice=&maxPrice=&make=&year_min=&sort=&page=
exports.list = asyncHandler(async (req, res) => {
  res.json(await runSearch(req.query));
});

// GET /api/market/suggest?q=  (search box drop-down)
exports.suggest = asyncHandler(async (req, res) => {
  const q = clean(req.query.q, 60);
  if (q.length < 2) return res.json({ terms: [], ads: [] });
  const terms = search.suggestTerms(q, 6);
  const { filter } = search.wordFilter(q, 'all');
  const ads = Object.keys(filter).length
    ? await Listing.find({ status: 'active', ...filter }).sort({ views: -1, createdAt: -1 }).limit(5).select('slug title price images category').lean()
    : [];
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ terms, ads: ads.map((a) => ({ slug: a.slug, title: a.title, price: a.price, image: a.images?.[0] || '', category: a.category })) });
});

// GET /api/market/home  (latest ads per category for the marketplace front page)
exports.home = asyncHandler(async (req, res) => {
  const data = await cached('market:home', 20000, async () => {
    const [latest, popular, counts] = await Promise.all([
      Listing.find({ status: 'active' }).sort({ createdAt: -1 }).limit(16).select(CARD_FIELDS).lean(),
      Listing.find({ status: 'active' }).sort({ views: -1 }).limit(8).select(CARD_FIELDS).lean(),
      countsByCategory(),
    ]);
    const total = Object.values(counts).reduce((a, c) => a + c.total, 0);
    return { latest: latest.map(card), popular: popular.map(card), total };
  });
  res.json(data);
});

// ---------------------------------------------------------------- one ad
async function loadPublicListing(slug, viewer) {
  const l = await Listing.findOne({ slug: String(slug).slice(0, 120) }).select('-keywords -reports').lean();
  if (!l) return null;
  const mine = viewer && String(l.seller) === String(viewer._id);
  if (l.status === 'hidden' && !mine) return null;
  return { l, mine };
}
exports.loadPublicListing = loadPublicListing;

const similarTo = (l, n = 8) =>
  Listing.find({ status: 'active', category: l.category, sub: l.sub, _id: { $ne: l._id } })
    .sort({ createdAt: -1 })
    .limit(n)
    .select(CARD_FIELDS)
    .lean()
    .then((r) => r.map(card));
exports.similarTo = similarTo;

// GET /api/market/listings/:slug
exports.get = asyncHandler(async (req, res) => {
  const found = await loadPublicListing(req.params.slug, req.customer);
  if (!found) throw httpError('This ad is no longer available', 404);
  const { l, mine } = found;
  if (!mine) Listing.updateOne({ _id: l._id }, { $inc: { views: 1 } }).catch(() => {});
  const [seller, similar] = await Promise.all([sellerSummary(l.seller), similarTo(l)]);
  const sellerDoc = await Customer.findById(l.seller).select('phone').lean();
  res.json({
    listing: { ...l, seller: undefined, sellerId: l.seller, hasPhone: !!(l.showPhone && sellerDoc?.phone), mine },
    seller,
    similar,
  });
});

// GET /api/market/listings/:id/phone  (logged-in users only, to keep numbers away from scrapers)
exports.phone = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const l = await Listing.findById(req.params.id).select('seller showPhone status').lean();
  if (!l || l.status === 'hidden') throw httpError('Ad not found', 404);
  if (!l.showPhone) throw httpError('This seller prefers to be contacted by chat', 403);
  const c = await Customer.findById(l.seller).select('phone').lean();
  if (!c?.phone) throw httpError('This seller has not added a phone number. Send them a chat instead.', 404);
  res.json({ phone: c.phone });
});

// GET /api/market/sellers/:id
exports.seller = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Seller not found', 404);
  const seller = await sellerSummary(req.params.id);
  if (!seller) throw httpError('Seller not found', 404);
  const items = await Listing.find({ seller: req.params.id, status: 'active' }).sort({ createdAt: -1 }).limit(60).select(CARD_FIELDS).lean();
  res.json({ seller, items: items.map(card) });
});

// ---------------------------------------------------------------- posting & managing ads
// Checks the form and keeps only allowed values; throws a friendly message for the first problem
function validate(body) {
  const category = String(body.category || '');
  const sub = String(body.sub || '');
  const cat = getCategory(category);
  if (!cat || !getSub(category, sub)) throw httpError('Please choose a category');
  const title = clean(body.title, 90);
  if (title.length < 5) throw httpError('Please give the ad a clear title (at least 5 characters)');
  const description = cleanText(body.description, 5000);
  if (description.length < 20) throw httpError('Please describe the item (at least 20 characters): condition, features, why you’re selling…');
  const county = String(body.county || '');
  if (!COUNTIES.includes(county)) throw httpError('Please choose the county where the item is');
  const price = Math.round(Number(body.price || 0));
  if (!Number.isFinite(price) || price < 0 || price > 5e10) throw httpError('Please enter a valid price');
  let condition = '';
  if (cat.condition) {
    condition = String(body.condition || '');
    if (!cat.condition.includes(condition)) throw httpError('Please choose the condition');
  }
  if (cat.adult && body.licensed !== true && body.licensed !== 'true') throw httpError('Alcohol can only be sold by licensed sellers. Please confirm you hold a valid liquor licence.');

  const attrs = {};
  const input = body.attrs && typeof body.attrs === 'object' ? body.attrs : {};
  for (const f of fieldsFor(category, sub)) {
    const raw = input[f.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (f.required) throw httpError(`Please fill in: ${f.label}`);
      continue;
    }
    if (f.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) throw httpError(`${f.label}: please enter a number${f.min !== undefined ? ` between ${f.min} and ${f.max}` : ''}`);
      attrs[f.key] = n;
    } else if (f.type === 'select') {
      if (!f.options.includes(String(raw))) throw httpError(`${f.label}: please choose from the list`);
      attrs[f.key] = String(raw);
    } else if (f.type === 'make') {
      if (!Object.prototype.hasOwnProperty.call(f.makes, String(raw))) throw httpError(`${f.label}: please choose from the list`);
      attrs[f.key] = String(raw);
    } else {
      attrs[f.key] = clean(raw, 60); // model and free text
    }
  }
  return {
    category, sub, title, description, county, price, condition, attrs,
    area: clean(body.area, 60),
    negotiable: body.negotiable === true || body.negotiable === 'true',
    showPhone: body.showPhone !== false && body.showPhone !== 'false',
  };
}

// Form fields come as JSON in "data" (because photos are sent as multipart form data)
const formBody = (req) => {
  try {
    return typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;
  } catch {
    throw httpError('Invalid form data');
  }
};
const uploaded = (req) => (req.files || []).map((f) => listingImageUrl(f.filename));
const cleanupUploads = (req) => uploaded(req).forEach(removeListingImage);
const changed = () => {
  invalidate('market:');
};

// POST /api/market/listings  (multipart: data=<json>, images=<files>)
exports.create = asyncHandler(async (req, res) => {
  try {
    const v = validate(formBody(req));
    if ((await Listing.countDocuments({ seller: req.customer._id, status: 'active' })) >= MAX_ACTIVE_ADS) {
      throw httpError(`You can have up to ${MAX_ACTIVE_ADS} active ads. Mark sold items as sold or delete old ads first.`);
    }
    const images = uploaded(req);
    const doc = { ...v, images, seller: req.customer._id, sellerName: req.customer.name };
    doc.slug = `${slugify(`${v.title} ${v.area || v.county}`)}-${crypto.randomBytes(3).toString('hex')}`;
    doc.keywords = search.keywordsFor(doc);
    const l = await Listing.create(doc);
    changed();
    res.status(201).json(l);
  } catch (err) {
    cleanupUploads(req); // don't keep photos of an ad that wasn't saved
    throw err;
  }
});

async function ownListing(req) {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const l = await Listing.findById(req.params.id);
  if (!l || String(l.seller) !== String(req.customer._id)) throw httpError('Ad not found', 404);
  return l;
}

// PUT /api/market/listings/:id  (multipart; data.keepImages = photos to keep, in order)
exports.update = asyncHandler(async (req, res) => {
  try {
    const l = await ownListing(req);
    if (l.status === 'hidden') throw httpError('This ad was taken down by the marketplace team and can’t be edited. Please contact support.', 403);
    const body = formBody(req);
    const v = validate(body);
    const fresh = uploaded(req);
    let images;
    if (Array.isArray(body.order)) {
      // exact photo order from the form: existing photo URLs and "new:<n>" for the n-th uploaded file
      images = body.order.map((x) => (typeof x === 'string' && x.startsWith('new:') ? fresh[Number(x.slice(4))] : l.images.includes(x) ? x : null)).filter(Boolean);
      fresh.forEach((u) => !images.includes(u) && images.push(u));
    } else {
      const kept = Array.isArray(body.keepImages) ? body.keepImages.filter((u) => l.images.includes(u)) : l.images;
      images = [...kept, ...fresh];
    }
    images = [...new Set(images)];
    const keep = images.filter((u) => l.images.includes(u));
    if (images.length > 8) throw httpError('You can have up to 8 photos');
    l.images.filter((u) => !keep.includes(u)).forEach(removeListingImage);
    Object.assign(l, v, { images });
    l.keywords = search.keywordsFor(l);
    l.markModified('attrs');
    await l.save();
    changed();
    res.json(l);
  } catch (err) {
    cleanupUploads(req);
    throw err;
  }
});

// PATCH /api/market/listings/:id/status { status: 'active' | 'sold' }
exports.setStatus = asyncHandler(async (req, res) => {
  const l = await ownListing(req);
  if (l.status === 'hidden') throw httpError('This ad was taken down by the marketplace team. Please contact support.', 403);
  const status = req.body.status === 'sold' ? 'sold' : 'active';
  l.status = status;
  await l.save();
  changed();
  res.json({ _id: l._id, status });
});

// DELETE /api/market/listings/:id
exports.remove = asyncHandler(async (req, res) => {
  const l = await ownListing(req);
  l.images.forEach(removeListingImage);
  await l.deleteOne();
  changed();
  res.json({ ok: true });
});

// GET /api/market/mine
exports.mine = asyncHandler(async (req, res) => {
  const items = await Listing.find({ seller: req.customer._id }).sort({ createdAt: -1 }).select(`${CARD_FIELDS} views chats hiddenReason`).lean();
  res.json(items.map((l) => ({ ...card(l), views: l.views, chats: l.chats, hiddenReason: l.hiddenReason })));
});

// GET /api/market/mine/:id  (full ad for the edit form)
exports.mineOne = asyncHandler(async (req, res) => {
  const l = await ownListing(req);
  res.json(l);
});

// POST /api/market/listings/:id/report { reason }
exports.report = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const reason = clean(req.body.reason, 300);
  if (reason.length < 3) throw httpError('Please tell us what’s wrong with this ad');
  const r = await Listing.updateOne(
    { _id: req.params.id, 'reports.by': { $ne: req.customer._id } },
    { $push: { reports: { by: req.customer._id, reason } }, $inc: { reportCount: 1 } }
  );
  res.json({ ok: true, alreadyReported: r.modifiedCount === 0 });
});

// ---------------------------------------------------------------- buyer ↔ seller chat
const meIn = (conv, me) => (String(conv.buyer) === String(me) ? 'buyer' : String(conv.seller) === String(me) ? 'seller' : null);
const convView = (c, me) => {
  const role = meIn(c, me);
  return {
    _id: c._id,
    role,
    listing: { _id: c.listing, title: c.listingTitle, slug: c.listingSlug, image: c.listingImage, price: c.listingPrice, category: c.listingCategory },
    other: role === 'buyer' ? { _id: c.seller, name: c.sellerName } : { _id: c.buyer, name: c.buyerName },
    lastMessage: c.lastMessage,
    unread: role === 'buyer' ? c.unreadBuyer : c.unreadSeller,
    updatedAt: c.updatedAt,
  };
};
const msgView = (m) => ({ _id: m._id, from: m.from, text: m.text, at: m.createdAt });

async function addMessage(conv, me, text) {
  const msg = await ChatMessage.create({ conversation: conv._id, from: me._id, text });
  const role = meIn(conv, me._id);
  const inc = role === 'buyer' ? { unreadSeller: 1 } : { unreadBuyer: 1 };
  const updated = await Conversation.findByIdAndUpdate(
    conv._id,
    { $set: { lastMessage: { text: text.slice(0, 140), from: me._id, at: msg.createdAt } }, $inc: inc },
    { returnDocument: 'after' }
  ).lean();
  // live delivery to both people (all their open tabs and phones)
  for (const who of [updated.buyer, updated.seller]) {
    emitCustomer(String(who), 'market:message', { conversation: convView(updated, who), message: msgView(msg) });
  }
  return { msg, conv: updated };
}

// POST /api/market/conversations { listingId, text }  (start a chat about an ad, or continue the existing one)
exports.startChat = asyncHandler(async (req, res) => {
  const text = cleanText(req.body.text, 2000);
  if (!text) throw httpError('Please type a message');
  if (!isId(req.body.listingId)) throw httpError('Ad not found', 404);
  const l = await Listing.findById(req.body.listingId).lean();
  if (!l || l.status === 'hidden') throw httpError('This ad is no longer available', 404);
  if (String(l.seller) === String(req.customer._id)) throw httpError('This is your own ad');
  let conv = await Conversation.findOne({ listing: l._id, buyer: req.customer._id });
  const isNew = !conv;
  if (!conv) {
    const seller = await Customer.findById(l.seller).select('name email').lean();
    try {
      conv = await Conversation.create({
        listing: l._id, listingTitle: l.title, listingSlug: l.slug, listingImage: l.images?.[0] || '', listingPrice: l.price, listingCategory: l.category,
        buyer: req.customer._id, seller: l.seller, buyerName: req.customer.name, sellerName: seller?.name || l.sellerName,
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      conv = await Conversation.findOne({ listing: l._id, buyer: req.customer._id }); // started twice at once
    }
    if (isNew) {
      Listing.updateOne({ _id: l._id }, { $inc: { chats: 1 } }).catch(() => {});
      // the seller may not be online: let them know by email about a new interested buyer
      if (seller?.email && !/\.test$/i.test(seller.email)) sendMail({ to: seller.email, ...templates.newMarketChat(seller, req.customer.name, l, text, conv._id) });
    }
  }
  const { msg, conv: updated } = await addMessage(conv, req.customer, text);
  res.status(isNew ? 201 : 200).json({ conversation: convView(updated, req.customer._id), message: msgView(msg) });
});

// GET /api/market/conversations
exports.conversations = asyncHandler(async (req, res) => {
  const me = req.customer._id;
  const list = await Conversation.find({ $or: [{ buyer: me }, { seller: me }], lastMessage: { $exists: true } }).sort({ updatedAt: -1 }).limit(200).lean();
  res.json(list.map((c) => convView(c, me)));
});

// GET /api/market/conversations/unread  (badge count)
exports.unread = asyncHandler(async (req, res) => {
  const me = req.customer._id;
  const [r] = await Conversation.aggregate([
    { $match: { $or: [{ buyer: me }, { seller: me }] } },
    { $group: { _id: null, n: { $sum: { $cond: [{ $eq: ['$buyer', me] }, '$unreadBuyer', '$unreadSeller'] } } } },
  ]);
  res.json({ unread: r?.n || 0 });
});

async function myConversation(req) {
  if (!isId(req.params.id)) throw httpError('Conversation not found', 404);
  const c = await Conversation.findById(req.params.id);
  if (!c || !meIn(c, req.customer._id)) throw httpError('Conversation not found', 404);
  return c;
}

// GET /api/market/conversations/:id/messages  (also marks them read)
exports.messages = asyncHandler(async (req, res) => {
  const c = await myConversation(req);
  const role = meIn(c, req.customer._id);
  const msgs = await ChatMessage.find({ conversation: c._id }).sort({ createdAt: 1 }).limit(500).lean();
  const field = role === 'buyer' ? 'unreadBuyer' : 'unreadSeller';
  if (c[field]) {
    c[field] = 0;
    await c.save();
    emitCustomer(String(req.customer._id), 'market:read', { conversation: String(c._id) });
  }
  const listing = await Listing.findById(c.listing).select('status price slug').lean();
  res.json({
    conversation: convView(c.toObject(), req.customer._id),
    listingStatus: listing?.status === 'hidden' ? 'removed' : listing?.status || 'removed',
    messages: msgs.map(msgView),
  });
});

// POST /api/market/conversations/:id/messages { text }
exports.send = asyncHandler(async (req, res) => {
  const c = await myConversation(req);
  const text = cleanText(req.body.text, 2000);
  if (!text) throw httpError('Please type a message');
  const { msg, conv } = await addMessage(c, req.customer, text);
  res.status(201).json({ conversation: convView(conv, req.customer._id), message: msgView(msg) });
});

// POST /api/market/conversations/:id/read
exports.markRead = asyncHandler(async (req, res) => {
  const c = await myConversation(req);
  const field = meIn(c, req.customer._id) === 'buyer' ? 'unreadBuyer' : 'unreadSeller';
  if (c[field]) {
    c[field] = 0;
    await c.save();
  }
  emitCustomer(String(req.customer._id), 'market:read', { conversation: String(c._id) });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- staff moderation
// GET /api/market/admin/listings?q=&status=&reported=1&page=
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (['active', 'sold', 'hidden'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.reported === '1') filter.reportCount = { $gt: 0 };
  const q = clean(req.query.q, 80);
  if (q) Object.assign(filter, search.wordFilter(q, 'all').filter);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const sort = req.query.reported === '1' ? { reportCount: -1, createdAt: -1 } : { createdAt: -1 };
  const [items, total, stats] = await Promise.all([
    Listing.find(filter).sort(sort).skip((page - 1) * 50).limit(50).select(`${CARD_FIELDS} sellerName seller views chats reportCount reports hiddenReason`).lean(),
    Listing.countDocuments(filter),
    Listing.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const [sellers, chats, reported] = await Promise.all([
    Listing.distinct('seller'),
    Conversation.countDocuments(),
    Listing.countDocuments({ reportCount: { $gt: 0 }, status: { $ne: 'hidden' } }),
  ]);
  res.json({
    items: items.map((l) => ({ ...card(l), sellerName: l.sellerName, seller: l.seller, views: l.views, chats: l.chats, reportCount: l.reportCount, reports: (l.reports || []).slice(-5).map((r) => ({ reason: r.reason, at: r.at })), hiddenReason: l.hiddenReason })),
    total,
    pages: Math.max(1, Math.ceil(total / 50)),
    stats: { ...Object.fromEntries(stats.map((s) => [s._id, s.n])), sellers: sellers.length, chats, reported },
  });
});

// PATCH /api/market/admin/listings/:id { status: 'hidden' | 'active', reason, clearReports }
exports.adminSetStatus = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const l = await Listing.findById(req.params.id);
  if (!l) throw httpError('Ad not found', 404);
  if (req.body.status === 'hidden') {
    l.status = 'hidden';
    l.hiddenReason = clean(req.body.reason, 200) || 'Against the marketplace rules';
  } else if (req.body.status === 'active') {
    l.status = 'active';
    l.hiddenReason = '';
  }
  if (req.body.clearReports) {
    l.reports = [];
    l.reportCount = 0;
  }
  await l.save();
  changed();
  res.json({ _id: l._id, status: l.status, reportCount: l.reportCount });
});

// DELETE /api/market/admin/listings/:id
exports.adminRemove = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const l = await Listing.findById(req.params.id);
  if (!l) throw httpError('Ad not found', 404);
  l.images.forEach(removeListingImage);
  await l.deleteOne();
  changed();
  res.json({ ok: true });
});

exports.card = card;
exports.CARD_FIELDS = CARD_FIELDS;
