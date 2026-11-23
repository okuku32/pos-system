// Marketplace: customers post ads (vehicles, land, electronics...), everyone searches them, and buyers chat with sellers.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { cached, invalidate } = require('../utils/cache');
const { emitCustomer } = require('../utils/realtime');
const { sendMail } = require('../utils/mailer');
const templates = require('../utils/emailTemplates');
const { listingImageUrl, removeListingImage } = require('../middleware/upload');
const { CATEGORIES, COUNTIES, COLOURS, getCategory, getSub, fieldsFor, hasColour } = require('../market/categories');
const search = require('../market/search');
const wholesale = require('../market/wholesale');
const { ORIGINS, IMPORTED, getOrigin, hasOrigin } = require('../market/origins');
const trades = require('../market/trades');
const geo = require('../market/geo');
const stores = require('../market/stores');
const catalog = require('../market/catalog');
const Product = require('../models/Product');

const PAGE_SIZE = 24;
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);

const slugify = (text) =>
  search.normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'ad';

// What a listing card shows (search results, home page, similar ads)
const CARD_FIELDS = 'slug title price wasPrice discountPercent discountUntil negotiable condition county area images category sub attrs createdAt status buyNow stock delivery sellerVerified boostedUntil layaway wholesale origin geo';
function card(listing, near) {
  const attrs = listing.attrs || {};
  const fits = listing.category === 'spare-parts' && attrs.make ? `Fits ${attrs.make}${attrs.model ? ` ${attrs.model}` : ''}${attrs.yearFrom || attrs.yearTo ? ` ${attrs.yearFrom || '…'}–${attrs.yearTo || 'now'}` : ''}` : null;
  const bits = [fits, attrs.item && attrs.item !== 'Other' ? attrs.item : null, attrs.year, attrs.mileage ? `${Number(attrs.mileage).toLocaleString('en-KE')} km` : null, attrs.transmission, attrs.size ? `${attrs.size} ${attrs.unit || ''}`.trim() : null, attrs.storage ? `${attrs.storage}${/^\d+$/.test(attrs.storage) ? 'GB' : ''}` : null, attrs.screen ? `${attrs.screen}"` : null, attrs.bedrooms ? `${attrs.bedrooms} bedroom` : null, attrs.volume, attrs.brand, attrs.colour && attrs.colour !== 'Other' ? attrs.colour : null]
    .filter(Boolean)
    .slice(0, 3);
  return {
    _id: listing._id, slug: listing.slug, title: listing.title, price: listing.price, negotiable: listing.negotiable, condition: listing.condition,
    county: listing.county, area: listing.area, image: listing.images?.[0] || '', photos: listing.images?.length || 0,
    category: listing.category, sub: listing.sub, facts: bits, createdAt: listing.createdAt, status: listing.status,
    ...(listing.buyNow ? { buyNow: true, stock: listing.stock, freeDelivery: !!listing.delivery?.available && !(listing.delivery?.fee > 0) } : {}),
    ...(listing.sellerVerified ? { verified: true } : {}),
    ...(listing.boostedUntil && new Date(listing.boostedUntil) > new Date() ? { featured: true } : {}),
    ...(require('../market/discount').isActive(listing) ? { wasPrice: listing.wasPrice, discount: listing.discountPercent } : {}),
    ...(listing.attrs?.unit && ['fresh-produce', 'samaki'].includes(listing.category) ? { unit: listing.attrs.unit } : {}), // "KSh 10 / kifungu"
    ...(listing.buyNow && listing.layaway?.enabled ? { polePole: true } : {}),
    ...(listing.wholesale?.enabled ? { wholesale: wholesale.summary(listing) } : {}),
    ...(listing.origin && getOrigin(listing.origin) ? { origin: listing.origin } : {}),
    ...(attrs.brand && ['fresh-produce', 'samaki', 'cooking-products'].includes(listing.category) ? { brand: String(attrs.brand) } : {}), // imported food: shown by brand
    ...(near && listing.geo ? { km: geo.distanceKm(near, listing.geo) } : {}),
    ...(listing.geo ? { onMap: true } : {}),
  };
}

// seller card: rating, completed sales, response rate & time, verified (see trustController)
const sellerSummary = (sellerId) => require('./trustController').sellerProfile(sellerId);

// ---------------------------------------------------------------- categories & counts
const countsByCategory = () =>
  cached('market:counts', 30000, async () => {
    const rows = await Listing.aggregate([{ $match: { status: 'active' } }, { $group: { _id: { c: '$category', s: '$sub' }, n: { $sum: 1 } } }]);
    const out = {};
    for (const row of rows) {
      out[row._id.c] = out[row._id.c] || { total: 0, subs: {} };
      out[row._id.c].total += row.n;
      out[row._id.c].subs[row._id.s] = row.n;
    }
    return out;
  });
exports.countsByCategory = countsByCategory;

// GET /api/market/categories (everything the forms and filters need)
exports.categories = asyncHandler(async (req, res) => {
  const counts = await countsByCategory();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    origins: ORIGINS.map(({ key, name, label, flag }) => ({ key, name, label, flag })),
    importCountries: require('../market/importCountries').publicCountries(),
    counties: COUNTIES,
    categories: CATEGORIES.map((category) => ({
      ...category,
      count: counts[category.slug]?.total || 0,
      subs: category.subs.map((sub) => ({ ...sub, count: counts[category.slug]?.subs[sub.slug] || 0 })),
    })),
  });
});

// ---------------------------------------------------------------- search
// Builds the database query from the search box text and the filters
function buildQuery(params) {
  const filter = { status: 'active' };
  const info = { detected: null, priceFromText: null, near: null };
  const { category, sub, county, condition } = params;
  if (category && getCategory(category)) filter.category = category;
  if (sub && filter.category && getSub(category, sub)) filter.sub = sub;
  if (county && COUNTIES.includes(county)) filter.county = county;
  if (condition) filter.condition = String(condition).slice(0, 40);
  if (params.photos === '1') filter['images.0'] = { $exists: true };
  if (params.buyNow === '1') filter.buyNow = true;
  if (params.deals === '1' || params.sort === 'discount') Object.assign(filter, require('../market/discount').activeFilter());
  if (params.wholesale === '1') filter['wholesale.enabled'] = true;
  // where it comes from: one origin, or every imported item
  if (params.origin && getOrigin(params.origin)) filter.origin = params.origin;
  else if (params.imported === '1') filter.origin = { $in: IMPORTED };
  // a trade: what a wholesaler sells / what an importer brings in (a group of categories)
  const tradeKind = params.wholesale === '1' ? 'wholesale' : params.imported === '1' || filter.origin ? 'importer' : '';
  const tf = tradeKind && params.trade ? trades.tradeFilter(tradeKind, String(params.trade)) : null;
  if (tf && !filter.category) {
    filter.category = tf.category;
    info.trade = { kind: tradeKind, key: String(params.trade) };
  }
  info.tradeKind = tradeKind;
  // near me: ads from sellers whose shop pin is within the distance
  const near = geo.parseNear(params);
  if (near) {
    filter.geo = geo.within(near);
    info.near = near;
  }

  // spare parts that fit my vehicle's year (parts with no years given fit any year)
  const fitYear = Math.round(Number(params.fitYear));
  if (fitYear >= 1960 && fitYear <= new Date().getFullYear() + 1) {
    filter.$and = [...(filter.$and || []),
      { $or: [{ 'attrs.yearFrom': { $lte: fitYear } }, { 'attrs.yearFrom': { $exists: false } }] },
      { $or: [{ 'attrs.yearTo': { $gte: fitYear } }, { 'attrs.yearTo': { $exists: false } }] }];
    info.fitYear = fitYear;
  }

  // price: explicit filters win over words in the search text
  let query = clean(params.q, 120);
  const value = search.parsePrice(query);
  if (value.min !== null || value.max !== null) {
    query = value.text;
    info.priceFromText = { min: value.min, max: value.max };
  }
  const min = params.minPrice !== undefined && params.minPrice !== '' ? Number(params.minPrice) : value.min;
  const max = params.maxPrice !== undefined && params.maxPrice !== '' ? Number(params.maxPrice) : value.max;
  if (Number.isFinite(min) || Number.isFinite(max)) {
    filter.price = {};
    if (Number.isFinite(min) && min > 0) filter.price.$gte = min;
    if (Number.isFinite(max) && max > 0) filter.price.$lte = max;
    if (!Object.keys(filter.price).length) delete filter.price;
  }

  // colour: one or more (Red|Blue), on any page
  const colours = String(params.colour || '').split('|').filter((item) => COLOURS.includes(item)).slice(0, 10);
  if (colours.length) filter['attrs.colour'] = colours.length > 1 ? { $in: colours } : colours[0];

  // detail filters for the chosen sub-category (make, model, year range, size...)
  if (filter.category && filter.sub) {
    for (const field of fieldsFor(filter.category, filter.sub)) {
      if (field.key === 'colour') continue; // handled above
      const param = params[field.key];
      if (field.type === 'number') {
        const lo = Number(params[`${field.key}_min`]);
        const hi = Number(params[`${field.key}_max`]);
        if (Number.isFinite(lo) && params[`${field.key}_min`] !== '' && params[`${field.key}_min`] !== undefined) filter[`attrs.${field.key}`] = { ...(filter[`attrs.${field.key}`] || {}), $gte: lo };
        if (Number.isFinite(hi) && params[`${field.key}_max`] !== '' && params[`${field.key}_max`] !== undefined) filter[`attrs.${field.key}`] = { ...(filter[`attrs.${field.key}`] || {}), $lte: hi };
      } else if (param) {
        const vals = String(param).split('|').map((item) => clean(item, 60)).filter(Boolean).slice(0, 10);
        if (field.type === 'text') filter[`attrs.${field.key}`] = new RegExp(`^${vals[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        else filter[`attrs.${field.key}`] = vals.length > 1 ? { $in: vals } : vals[0];
      }
    }
  } else if (params.make) {
    filter['attrs.make'] = clean(params.make, 40); // make chosen without a sub-category (e.g. from a suggestion)
    if (params.model) filter['attrs.model'] = clean(params.model, 40);
  }

  if (query && !filter.category) info.detected = search.detectCategory(query);
  return { filter, q: query, info };
}

const SORTS = {
  newest: { boostedUntil: -1, createdAt: -1 },
  'price-asc': { price: 1, createdAt: -1 },
  'price-desc': { price: -1, createdAt: -1 },
  popular: { views: -1, createdAt: -1 },
  discount: { discountPercent: -1, boostedUntil: -1, createdAt: -1 }, // best deals first
};

async function runSearch(params) {
  const page = Math.max(1, Math.min(200, parseInt(params.page, 10) || 1));
  const limit = Math.max(1, Math.min(48, parseInt(params.limit, 10) || PAGE_SIZE));
  const sort = SORTS[params.sort] || SORTS.newest;
  const { filter, q: query, info } = buildQuery(params);

  let relaxed = false;
  let where = filter;
  if (query) {
    where = { ...filter, ...search.wordFilter(query, 'all').filter };
    if (!(await Listing.exists(where))) {
      // nothing has every word: show ads matching some of them instead of an empty page
      const loose = { ...filter, ...search.wordFilter(query, 'any').filter };
      if (await Listing.exists(loose)) {
        where = loose;
        relaxed = true;
      }
    }
  }
  // "nearest first" lets the database order by distance
  const byDistance = info.near && params.sort === 'nearest';
  const findWhere = byDistance ? { ...where, geo: geo.nearest(info.near) } : where;
  const [items, total] = await Promise.all([
    (byDistance ? Listing.find(findWhere) : Listing.find(where).sort(sort)).skip((page - 1) * limit).limit(limit).select(CARD_FIELDS).lean(),
    Listing.countDocuments(where),
  ]);
  // the words point at a category ("mumi" → fish, not Mumias sugar): with no sort chosen, those ads come first
  const meant = info.detected;
  if (meant?.category && !params.sort && !filter.category) {
    const fits = (item) => (item.category === meant.category ? (meant.sub && item.sub === meant.sub ? 2 : 1) : 0);
    items.sort((first, second) => fits(second) - fits(first));
  }
  // the summaries below run at the same time:
  // · how many ads there are in each colour (ignoring the colour and price filters), for the colour swatches
  // · the price range (ignoring the price and colour filters), plus ready-made brackets for the price picker
  // · wholesale / imports: how many ads each trade has (ignoring the chosen trade), for the trade tabs
  const wantColours = !filter.category || hasColour(filter.category);
  const { 'attrs.colour': _ignored, price: _ignoredPrice, ...noColour } = where;
  const { price: _p, 'attrs.colour': _c, ...noPrice } = where;
  const { category: _t, ...noTrade } = info.trade ? where : {};
  const [colourRows, [ps], tradeRows] = await cached(`market:summary:${JSON.stringify(where, (key, value) => (value instanceof RegExp ? `/${value.source}/${value.flags}` : value))}|${wantColours}|${info.tradeKind || ''}|${info.trade?.key || ''}`, 60000, () => Promise.all([
    wantColours ? Listing.aggregate([{ $match: { ...noColour, 'attrs.colour': { $in: COLOURS } } }, { $group: { _id: '$attrs.colour', n: { $sum: 1 } } }]) : [],
    Listing.aggregate([
      { $match: { ...noPrice, price: { $gt: 0 } } },
      {
        $facet: {
          range: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' }, n: { $sum: 1 } } }],
          buckets: [{ $bucketAuto: { groupBy: '$price', buckets: 5 } }],
        },
      },
    ]),
    info.tradeKind && (!filter.category || info.trade) ? Listing.aggregate([{ $match: info.trade ? noTrade : where }, { $group: { _id: '$category', n: { $sum: 1 } } }]) : null,
  ]));
  const colourCounts = COLOURS.map((colour) => ({ name: colour, n: colourRows.find((colourRow) => colourRow._id === colour)?.n || 0 })).filter((item) => item.n > 0);
  if (tradeRows) {
    const byCat = new Map(tradeRows.map((tradeRow) => [tradeRow._id, tradeRow.n]));
    info.trades = trades.publicTrades(info.tradeKind).map((item) => ({ ...item, n: trades.tradeOf(info.tradeKind, item.key).cats.reduce((sum, cat) => sum + (byCat.get(cat) || 0), 0) }));
  }
  const range = ps?.range?.[0];
  const priceStats = range ? { min: range.min, max: range.max, count: range.n, buckets: (ps.buckets || []).map((bucket) => ({ from: bucket._id.min, to: bucket._id.max, n: bucket.count })) } : null;
  return { items: items.map((item) => card(item, info.near)), total, page, pages: Math.max(1, Math.ceil(total / limit)), relaxed, q: query, colours: colourCounts, priceStats, ...info };
}
exports.runSearch = runSearch;

// GET /api/market/ai-search?q=cheapest samsung phone under 20k
//   → what we understood (product, category, price range, order, county) and the matching ads, cheapest first
// what kind of thing the words name: a category / sub-category ("cars", "phones", "gari"), or a brand that only
// belongs to one ("toyota" → Vehicles › Cars, make Toyota). Whole words only, plurals forgiven.
function detectWhat(terms) {
  const search = require('../market/search');
  const text = String(terms || '');
  if (!text.trim()) return null;
  const found = search.detectCategory(text) || search.detectCategory(search.tokens(text).join(' '));
  const words = new Set([...search.tokens(text), ...search.normalize(text).split(' ')]);
  for (const category of CATEGORIES) {
    for (const sb of category.subs) {
      const makeField = (sb.fields || []).find((field) => field.type === 'make' && !String(field.label).startsWith('Fits'));
      if (!makeField?.makes) continue;
      const make = Object.keys(makeField.makes).find((name) => name !== 'Other' && search.normalize(name).split(' ').every((part) => words.has(part)));
      // a brand narrows it down: inside what they named (if anything), or on its own
      if (make && (!found || found.category === category.slug)) return { category: category.slug, sub: sb.slug, make };
    }
  }
  return found;
}

exports.aiSearch = asyncHandler(async (req, res) => {
  const ai = require('../market/aiSearch');
  const text = clean(req.query.q, 200);
  if (text.length < 2) throw httpError('Ask for something, e.g. “cheapest Samsung phone under 20k”');
  // importers ("chinese latest importer"): the Importers page answers it (traders + their latest goods)
  if (require('../market/importerSearch').isImporterQuery(text)) {
    const to = `/importers?q=${encodeURIComponent(text)}`;
    return res.json({ q: text, engine: 'smart', mode: 'go', pages: [{ key: 'importers', label: 'Importers', icon: '🚢', to }], understood: { terms: '', category: '', categoryName: '', minPrice: null, maxPrice: null, sort: 'newest', county: '', summary: require('../market/importerSearch').describe(require('../market/importerSearch').parseImporterQuery(text)) }, total: 0, exact: 0, items: [], cheapest: null, range: null, outside: null, link: to });
  }
  const understood = await ai.understand(text);
  // 🏆 a seller, not an item ("cheapest rice wholesaler", "most reliable supplier near me"): rank the sellers on
  // price, reliability, successful deliveries and distance (market/sellerRank.js)
  const sellerRank = require('../market/sellerRank');
  if (understood.sellers || sellerRank.isSellerQuery(text)) {
    const here = require('../market/geo').toPoint(req.query.lat, req.query.lng) ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : null;
    const ranked = await sellerRank.rank(text, understood, { here, buyerCounty: req.customer?.county || '' });
    const summary = sellerRank.describe(ranked);
    return res.json({
      q: text, engine: understood.engine, mode: 'sellers', pages: [],
      understood: { terms: ranked.terms, category: '', categoryName: '', minPrice: understood.minPrice, maxPrice: understood.maxPrice, sort: ranked.lead, county: ranked.county, summary, ...(ranked.widened ? { widened: true } : {}) },
      ranking: { lead: ranked.lead, weights: ranked.weights, bulk: ranked.bulk, locationUsed: ranked.locationUsed, matched: ranked.matched },
      sellers: ranked.sellers, total: ranked.total, exact: 0, items: [], cheapest: null, range: null, outside: null,
      link: ranked.bulk ? `/wholesale${ranked.terms ? `?q=${encodeURIComponent(ranked.terms)}` : ''}` : `/market/search?${new URLSearchParams(Object.entries({ q: ranked.terms, county: ranked.county }).filter(([, value]) => value))}`,
    });
  }
  // only a page asked for ("track my order"): no product search
  if (understood.pages?.length && !understood.terms && !understood.category && !understood.minPrice && !understood.maxPrice) {
    return res.json({ q: text, engine: understood.engine, mode: 'go', pages: understood.pages, understood: { terms: '', category: '', categoryName: '', minPrice: null, maxPrice: null, sort: understood.sort, county: understood.county, summary: understood.pages.length === 1 ? `Opening ${understood.pages[0].label}` : 'Where do you want to go?' }, total: 0, exact: 0, items: [], cheapest: null, range: null, outside: null, link: understood.pages[0].to });
  }
  const sort = ai.SORTS[understood.sort] || 'price-asc';
  // what kind of thing they want: "car" / "cars" / "gari" / "toyota" → Vehicles › Cars, "phones" → Electronics › Phones
  const search = require('../market/search');
  const meant = understood.category ? { category: understood.category, sub: (search.detectCategory(understood.terms) || {}).category === understood.category ? search.detectCategory(understood.terms).sub : null } : detectWhat(understood.terms);
  const params = {
    q: understood.terms, ...(meant?.category ? { category: meant.category } : {}), ...(meant?.sub ? { sub: meant.sub } : {}), ...(meant?.make ? { make: meant.make } : {}), ...(understood.county ? { county: understood.county } : {}), sort, limit: 12,
    // "cheapest" skips ads with no price (KSh 0 means "ask for the price")
    ...(understood.minPrice || sort === 'price-asc' ? { minPrice: Math.max(1, understood.minPrice || 1) } : {}), ...(understood.maxPrice ? { maxPrice: understood.maxPrice } : {}),
  };
  // search inside that category first; only if it has nothing, look everywhere (and say so)
  let runSearchResult = await runSearch({ ...params, limit: 48 });
  let widened = false;
  if (!runSearchResult.total && meant?.sub) runSearchResult = await runSearch({ ...params, sub: undefined, make: undefined, limit: 48 });
  if (!runSearchResult.total && meant?.category) {
    const { category: _c, sub: _s, make: _m, ...anywhere } = params;
    runSearchResult = await runSearch({ ...anywhere, limit: 48 });
    widened = true;
  }
  // an ad matches a word only as a whole word (or the start of a long one): "car" is not in "carrots" or "cartons".
  // The ad's own category names count too ("car" matches a Toyota Probox listed under Cars)
  const words = [...new Set(search.tokens(understood.terms || ''))].filter((item) => item.length > 1 || /\d/.test(item));
  const wordsOf = (item) => {
    const cat = getCategory(item.category);
    const sb = getSub(item.category, item.sub);
    return new Set(search.tokens([item.title, cat?.name, ...(cat?.synonyms || []), sb?.name, ...(sb?.synonyms || []), ...(item.facts || [])].join(' ')));
  };
  const hasWord = (set, word) => set.has(word) || (word.length >= 4 && [...set].some((item) => item.startsWith(word)));
  const hits = (item) => {
    const set = wordsOf(item);
    return words.filter((word) => hasWord(set, word)).length;
  };
  const sameKind = (item) => meant?.category && !widened && item.category === meant.category;
  // the ad's own words (title, details) beat its category's words: "carrots" → the carrot ads, not every vegetable;
  // "iphone 13" → the iPhone 13, not a Redmi Note 13. Category words count when no title has them ("car" → Toyota Vitz)
  const titleHits = (item) => {
    const own = new Set(search.tokens([item.title, ...(item.facts || [])].join(' ')));
    return words.filter((word) => hasWord(own, word)).length;
  };
  const byTitle = words.length ? runSearchResult.items.filter((item) => titleHits(item) === words.length) : runSearchResult.items;
  const exact = !words.length ? runSearchResult.items : byTitle.length ? byTitle : runSearchResult.items.filter((item) => hits(item) === words.length);
  // related: shares a word with the question, or is the same kind of thing. Never unrelated filler
  const related = words.length ? runSearchResult.items.filter((item) => !exact.includes(item) && (hits(item) > 0 || sameKind(item))) : [];
  runSearchResult.items = [...exact.map((item) => ({ ...item, match: 'exact' })), ...related.map((item) => ({ ...item, match: 'related' }))].slice(0, 12);
  runSearchResult.exact = words.length ? exact.length : runSearchResult.total;
  // nothing in that price range: show the closest ones, so the buyer still gets an answer
  let outside = null;
  if ((!runSearchResult.total || !exact.length) && (understood.minPrice || understood.maxPrice)) {
    const { maxPrice: _mx, minPrice: _mn, ...wide } = params;
    const currentRunSearchResult = await runSearch({ ...wide, minPrice: 1, sort: understood.maxPrice ? 'price-asc' : 'price-desc', limit: 48 });
    const close = words.length ? currentRunSearchResult.items.filter((item) => hits(item) === words.length || sameKind(item)) : currentRunSearchResult.items;
    if (close.length) outside = { items: close.slice(0, 3), total: close.length };
  }
  const prices = runSearchResult.items.map((item) => item.price).filter((item) => item > 0);
  const link = new URLSearchParams(Object.entries({ q: understood.terms, county: understood.county, minPrice: understood.minPrice || '', maxPrice: understood.maxPrice || '', sort }).filter(([, value]) => value));
  res.json({
    q: text, engine: understood.engine, mode: 'search', pages: understood.pages || [],
    understood: { terms: understood.terms, category: meant?.category || '', categoryName: meant?.category ? [getCategory(meant.category)?.name, meant.sub ? getSub(meant.category, meant.sub)?.name : ''].filter(Boolean).join(' › ') : '', minPrice: understood.minPrice, maxPrice: understood.maxPrice, sort: understood.sort, county: understood.county, summary: ai.describe(understood), ...(widened ? { widened: true } : {}) },
    total: runSearchResult.total, exact: runSearchResult.exact, items: runSearchResult.items, cheapest: sort === 'price-asc' && runSearchResult.items[0]?.match === 'exact' ? runSearchResult.items[0] : null,
    range: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    outside, link: `${meant?.category && !widened ? `/market/${meant.category}${meant.sub ? `/${meant.sub}` : ''}` : '/market/search'}?${link}`,
  });
});

// GET /api/market/ai-trends?q=  (sellers: "what sells best in Nairobi under 5k?")
// Real figures from the last 90 days, per commodity (sub-category): units sold on paid/placed orders, buyers who added
// it to a cart, ads competing for it, views and the average price. Claude adds a short tip when a key is set.
exports.aiTrends = asyncHandler(async (req, res) => {
  const ai = require('../market/aiSearch');
  const Order = require('../models/Order');
  const Notification = require('../models/Notification');
  const text = clean(req.query.q, 200);
  const understood = text.length >= 2 ? await ai.understand(text) : { engine: 'none', terms: '', category: '', minPrice: null, maxPrice: null, county: '', pages: [] };
  // the commodity words ("phones", "rice") → categories / sub-categories
  const words = (understood.terms || '').toLowerCase().split(/\s+/).filter((item) => item.length > 2 && !/^(?:sells?|selling|sold|best|top|what|which|items?|things?|goods|commodit(?:y|ies)|products?|demand|market|most|buy|bought|people|right|now|today|week|month|year|this|should|stock|fast|moving|faster|fastest|hot|trending|kenya)$/.test(item));
  const subHit = [];
  for (const category of CATEGORIES) for (const sb of category.subs) {
    const hay = [sb.slug, sb.name, ...(sb.synonyms || [])].join(' ').toLowerCase();
    // whole words only ("phones" must not match "headphones")
    if (words.some((word) => new RegExp(`\\b${word.replace(/s$/, '').replace(/[^a-z0-9]/g, '')}`).test(hay))) subHit.push({ category: category.slug, sub: sb.slug });
  }
  const catWords = CATEGORIES.filter((category) => words.some((word) => category.name.toLowerCase().includes(word) || category.slug.includes(word))).map((item) => item.slug);
  const cats = understood.category ? [understood.category] : catWords;
  const key = `market:trends:${JSON.stringify([cats, subHit, understood.county, understood.minPrice, understood.maxPrice])}`;
  const rows = await cached(key, 5 * 60 * 1000, async () => {
    const since = new Date(Date.now() - 90 * 864e5);
    const price = { ...(understood.minPrice ? { $gte: understood.minPrice } : {}), ...(understood.maxPrice ? { $lte: understood.maxPrice } : {}) };
    const which = (prefix = '') => ({
      ...(subHit.length ? { $or: subHit.map((item) => ({ [`${prefix}category`]: item.category, [`${prefix}sub`]: item.sub })) } : cats.length ? { [`${prefix}category`]: { $in: cats } } : {}),
      ...(Object.keys(price).length ? { [`${prefix}price`]: price } : {}),
    });
    const [sold, ads, carts] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: since }, status: { $nin: ['cancelled', 'awaiting_payment'] }, ...(understood.county ? { 'delivery.county': understood.county } : {}) } },
        { $unwind: '$items' },
        { $match: which('items.') },
        { $group: { _id: { c: '$items.category', s: '$items.sub' }, units: { $sum: '$items.qty' }, revenue: { $sum: '$items.subtotal' }, orders: { $sum: 1 } } },
      ]),
      Listing.aggregate([
        { $match: { status: { $in: ['active', 'sold'] }, ...which(), ...(understood.county ? { county: understood.county } : {}) } },
        { $group: { _id: { c: '$category', s: '$sub' }, ads: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }, views: { $sum: '$views' }, soldAds: { $sum: '$soldCount' }, avgPrice: { $avg: { $cond: [{ $gt: ['$price', 0] }, '$price', null] } }, minPrice: { $min: { $cond: [{ $gt: ['$price', 0] }, '$price', null] } }, sellers: { $addToSet: '$seller' } } },
        { $project: { ads: 1, views: 1, soldAds: 1, avgPrice: 1, minPrice: 1, sellers: { $size: '$sellers' } } },
      ]),
      Notification.aggregate([
        { $match: { kind: 'cart', createdAt: { $gte: since }, listing: { $ne: null } } },
        { $lookup: { from: 'listings', localField: 'listing', foreignField: '_id', as: 'l', pipeline: [{ $project: { category: 1, sub: 1, price: 1, county: 1 } }] } },
        { $unwind: '$l' },
        { $match: { ...which('l.'), ...(understood.county ? { 'l.county': understood.county } : {}) } },
        { $group: { _id: { c: '$l.category', s: '$l.sub' }, carts: { $sum: 1 } } },
      ]),
    ]);
    const map = new Map();
    const row = (id) => {
      const input = `${id.c}/${id.s}`;
      if (!map.has(input)) {
        const sub = getSub(id.c, id.s);
        if (!sub) return null;
        map.set(input, { category: id.c, sub: id.s, name: sub.name, categoryName: getCategory(id.c)?.name || id.c, units: 0, revenue: 0, orders: 0, carts: 0, ads: 0, views: 0, soldAds: 0, sellers: 0, avgPrice: 0, minPrice: 0 });
      }
      return map.get(input);
    };
    for (const item of sold) { const rowResult = row(item._id); if (rowResult) Object.assign(rowResult, { units: item.units || 0, revenue: item.revenue || 0, orders: item.orders }); }
    for (const ad of ads) { const rowResult = row(ad._id); if (rowResult) Object.assign(rowResult, { ads: ad.ads, views: ad.views || 0, soldAds: ad.soldAds || 0, sellers: ad.sellers, avgPrice: Math.round(ad.avgPrice || 0), minPrice: ad.minPrice || 0 }); }
    for (const cart of carts) { const rowResult = row(cart._id); if (rowResult) rowResult.carts = cart.carts; }
    return [...map.values()]
      .map((item) => {
        const demand = item.units * 10 + item.soldAds * 6 + item.carts * 3 + item.views * 0.05;
        return { ...item, demand: Math.round(demand), perAd: item.ads ? Math.round((demand / item.ads) * 10) / 10 : Math.round(demand) };
      })
      .filter((item) => item.demand > 0)
      .sort((first, second) => second.demand - first.demand || second.perAd - first.perAd)
      .slice(0, 12);
  });
  const top = rows[0]?.demand || 1;
  const list = rows.map((row) => ({ ...row, score: Math.max(4, Math.round((row.demand / top) * 100)), tag: row.ads <= 3 && row.demand >= top * 0.25 ? 'gap' : row.demand >= top * 0.6 ? 'hot' : '' }));
  // what the seller already sells (to mark "you sell this")
  let mine = [];
  if (req.customer) mine = await Listing.distinct('sub', { seller: req.customer._id, status: 'active' });
  const money = (amount) => `KSh ${Number(amount).toLocaleString('en-KE')}`;
  const what = subHit.length === 1 ? getSub(subHit[0].category, subHit[0].sub)?.name : cats.length === 1 ? getCategory(cats[0])?.name : subHit.length ? words.join(' ') : '';
  const range = understood.minPrice && understood.maxPrice ? ` between ${money(understood.minPrice)} and ${money(understood.maxPrice)}` : understood.maxPrice ? ` under ${money(understood.maxPrice)}` : understood.minPrice ? ` over ${money(understood.minPrice)}` : '';
  const summary = `Best-selling ${what ? what.toLowerCase() : 'commodities'}${range}${understood.county ? ` in ${understood.county}` : ' across Kenya'} (last 90 days)`;
  const tip = list.length
    ? (await ai.trendAdvice(text || 'What sells best?', list)) ||
      (() => {
        const gap = list.find((item) => item.tag === 'gap' && item !== list[0]);
        return `Top seller: ${list[0].name}${list[0].units ? ` (${list[0].units} sold)` : ''}.${gap ? ` ${gap.name}: buyers are looking but there ${gap.ads === 1 ? 'is only 1 ad' : `are only ${gap.ads} ads`}, a good chance to stand out.` : ''}`;
      })()
    : '';
  res.json({ q: text, engine: understood.engine, summary, tip, county: understood.county || '', minPrice: understood.minPrice, maxPrice: understood.maxPrice, items: list.map((item) => ({ ...item, mine: mine.includes(item.sub) })), pages: understood.pages || [] });
});

// GET /api/market/importers?q=chinese latest importer&origin=china&trade=electronics&latest=1&county=&page=
// Traders who bring in goods from abroad, worked out from their OWN live ads: each seller comes with their latest
// items of that origin, and the counts (items, new this week) are from the same ads — the data always matches.
exports.importers = asyncHandler(async (req, res) => {
  const im = require('../market/importerSearch');
  const text = clean(req.query.q, 120);
  const url = im.parseImporterQuery(text);
  // chips on the page can set or override what the words said
  const pick = String(req.query.origin || '');
  if (pick && IMPORTED.includes(pick)) url.origins = [pick];
  if (pick === 'all') url.origins = []; // 'All countries' chip
  if (req.query.trade !== undefined) url.trade = trades.tradeOf('importer', String(req.query.trade)) ? String(req.query.trade) : null;
  if (req.query.latest !== undefined) url.latest = req.query.latest === '1';
  if (req.query.county !== undefined) url.county = COUNTIES.includes(req.query.county) ? req.query.county : '';
  const page = Math.max(1, Math.min(20, parseInt(req.query.page, 10) || 1));
  const PER = 12;
  const WEEK = new Date(Date.now() - 7 * 864e5);

  const base = (withTerms = true) => {
    const and = [{ status: 'active', origin: { $in: url.origins.length ? url.origins : IMPORTED } }];
    if (url.trade) and.push(trades.tradeFilter('importer', url.trade));
    if (url.county) and.push({ county: url.county });
    if (withTerms && url.terms) and.push(search.wordFilter(url.terms, 'all').filter);
    return { $and: and };
  };
  const key = `market:importers:${JSON.stringify([url, page])}`;
  const out = await cached(key, 30 * 1000, async () => {
    let filter = base(true);
    let relaxed = false;
    let groups = await Listing.aggregate([
      { $match: filter },
      { $group: { _id: '$seller', ads: { $sum: 1 }, newest: { $max: '$createdAt' }, fresh: { $sum: { $cond: [{ $gte: ['$createdAt', WEEK] }, 1, 0] } }, origins: { $addToSet: '$origin' }, cats: { $addToSet: '$category' }, minPrice: { $min: { $cond: [{ $gt: ['$price', 0] }, '$price', null] } }, county: { $first: '$county' }, area: { $first: '$area' } } },
    ]);
    // the product words found nothing: show the importers of that origin / trade instead (and say so)
    if (!groups.length && url.terms) {
      relaxed = true;
      filter = base(false);
      groups = await Listing.aggregate([
        { $match: filter },
        { $group: { _id: '$seller', ads: { $sum: 1 }, newest: { $max: '$createdAt' }, fresh: { $sum: { $cond: [{ $gte: ['$createdAt', WEEK] }, 1, 0] } }, origins: { $addToSet: '$origin' }, cats: { $addToSet: '$category' }, minPrice: { $min: { $cond: [{ $gt: ['$price', 0] }, '$price', null] } }, county: { $first: '$county' }, area: { $first: '$area' } } },
      ]);
    }
    const people = new Map((await Customer.find({ _id: { $in: groups.map((group) => group._id) }, active: { $ne: false } }).select('name avatar verified rating completedSales shopLocation county trade').lean()).map((item) => [String(item._id), item]));
    groups = groups.filter((group) => people.has(String(group._id)));
    const declared = (group) => (people.get(String(group._id)).shopLocation?.kinds || []).includes('importer');
    // latest: whoever got new stock most recently · cheapest: lowest price · otherwise: real importers with the most goods
    groups.sort((first, second) => (url.latest ? second.newest - first.newest : url.cheapest ? (first.minPrice ?? Infinity) - (second.minPrice ?? Infinity) : declared(second) - declared(first) || second.ads - first.ads || second.newest - first.newest));
    const total = groups.length;
    const pageGroups = groups.slice((page - 1) * PER, page * PER);
    const ids = pageGroups.map((pageGroup) => pageGroup._id);
    // each trader's own latest items that match (up to 4)
    const items = ids.length ? await Listing.find({ $and: [filter, { seller: { $in: ids } }] }).sort(url.cheapest ? { price: 1 } : { createdAt: -1 }).limit(ids.length * 12).select(`${CARD_FIELDS} seller`).lean() : [];
    const bySeller = new Map();
    for (const item of items) {
      const seller = String(item.seller);
      if (!bySeller.has(seller)) bySeller.set(seller, []);
      if (bySeller.get(seller).length < 4) bySeller.get(seller).push(card(item));
    }
    const arrivals = url.latest || !text ? (await Listing.find(filter).sort({ createdAt: -1 }).limit(12).select(`${CARD_FIELDS} seller`).lean()).map((item) => ({ ...card(item), sellerId: String(item.seller), sellerName: people.get(String(item.seller))?.name || '' })) : [];
    const sellers = pageGroups.map((pageGroup) => {
      const person = people.get(String(pageGroup._id));
      return {
        _id: pageGroup._id, name: person.name, avatar: person.avatar || '', verified: !!person.verified, rating: person.rating || { avg: 0, count: 0 }, completedSales: person.completedSales || 0,
        importer: declared(pageGroup), shop: person.shopLocation?.public ? geo.publicShop(person) : null, county: person.shopLocation?.county || pageGroup.county || person.county || '', area: person.shopLocation?.area || pageGroup.area || '',
        ads: pageGroup.ads, fresh: pageGroup.fresh, newest: pageGroup.newest, minPrice: pageGroup.minPrice || 0,
        origins: pageGroup.origins.map((origin) => getOrigin(origin)).filter(Boolean).map((item) => ({ key: item.key, name: item.name, flag: item.flag })),
        importFrom: require('../market/sellerProfile').publicTrade(person.trade)?.importFrom || [], // the countries they said they import from
        categories: pageGroup.cats.map((cat) => getCategory(cat)).filter(Boolean).slice(0, 4).map((item) => ({ slug: item.slug, name: item.name, icon: item.icon })),
        items: bySeller.get(String(pageGroup._id)) || [],
      };
    });
    // how many importers per country and per trade, for the chips (same country filter except the chip's own)
    const [byOrigin, byTrade] = await Promise.all([
      Listing.aggregate([{ $match: { status: 'active', origin: { $in: IMPORTED }, ...(url.trade ? trades.tradeFilter('importer', url.trade) : {}) } }, { $group: { _id: '$origin', s: { $addToSet: '$seller' } } }, { $project: { n: { $size: '$s' } } }]),
      Listing.aggregate([{ $match: { status: 'active', origin: { $in: url.origins.length ? url.origins : IMPORTED } } }, { $group: { _id: '$category', s: { $addToSet: '$seller' } } }]),
    ]);
    const tradeCounts = trades.publicTrades('importer').map((item) => {
      const set = new Set();
      const cats = trades.tradeOf('importer', item.key).cats;
      for (const element of byTrade) if (cats.includes(element._id)) for (const entry of element.s) set.add(String(entry));
      return { ...item, sellers: set.size };
    });
    return { total, relaxed, sellers, arrivals, origins: ORIGINS.filter((origin) => IMPORTED.includes(origin.key)).map((item) => ({ key: item.key, name: item.name, flag: item.flag, label: item.label, sellers: byOrigin.find((element) => element._id === item.key)?.n || 0 })), trades: tradeCounts };
  });
  res.json({
    q: text,
    understood: { ...url, summary: im.describe(url), originNames: url.origins.map((origin) => getOrigin(origin)?.name).filter(Boolean), tradeName: url.trade ? trades.tradeOf('importer', url.trade)?.name : '' },
    page, pages: Math.ceil(out.total / 12), ...out,
  });
});

// GET /api/market/presence?ids=a,b,c  → { id: { online, lastSeen } } for SELLERS only (people with ads).
// Buyers' activity is never shown. "Last seen" is rounded to 5 minutes.
exports.presence = asyncHandler(async (req, res) => {
  const ids = [...new Set(String(req.query.ids || '').split(',').filter(isId))].sort().slice(0, 60);
  if (!ids.length) return res.json({});
  const { onlineMap } = require('../utils/presence');
  const sellers = await cached(`presence:sellers:${ids.join(',')}`, 60 * 1000, async () =>
    (await Listing.distinct('seller', { seller: { $in: ids }, status: { $in: ['active', 'sold'] } })).map(String));
  const people = new Map((await Customer.find({ _id: { $in: sellers } }).select('lastSeenAt shopLocation.hours shopLocation.public').lean()).map((item) => [String(item._id), item]));
  // rounded UP to 5 minutes (never later than now): "just now" right after they leave, no exact tracking
  const round = (date) => (date ? new Date(Math.min(Date.now(), Math.ceil(new Date(date).getTime() / 300000) * 300000)).toISOString() : null);
  // shops, wholesalers and individual sellers who set opening hours: open right now by their normal hours?
  const { openState } = require('../market/hours');
  const online = await onlineMap(sellers); // across every server (Redis), or this one
  const isOnline = (id) => online.get(String(id));
  res.json(Object.fromEntries(sellers.map((id) => {
    const person = people.get(id);
    const hours = person?.shopLocation?.hours;
    const state = hours ? openState(hours) : null;
    return [id, { online: isOnline(id), lastSeen: isOnline(id) ? null : round(person?.lastSeenAt), open: state ? { open: state.open, label: state.label } : null }];
  })));
});

// GET /api/market/listings?q=&category=&sub=&county=&minPrice=&maxPrice=&make=&year_min=&sort=&page=
exports.list = asyncHandler(async (req, res) => {
  res.json(await runSearch(req.query));
});

// GET /api/market/suggest?q=  (search box drop-down)
exports.suggest = asyncHandler(async (req, res) => {
  const query = clean(req.query.q, 60);
  if (query.length < 2) return res.json({ terms: [], ads: [] });
  const terms = search.suggestTerms(query, 6);
  const { filter } = search.wordFilter(query, 'all');
  const ads = Object.keys(filter).length
    ? await Listing.find({ status: 'active', ...filter }).sort({ views: -1, createdAt: -1 }).limit(5).select('slug title price images category').lean()
    : [];
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ terms, ads: ads.map((ad) => ({ slug: ad.slug, title: ad.title, price: ad.price, image: ad.images?.[0] || '', category: ad.category })) });
});

// GET /api/market/home  (latest ads per category for the marketplace front page)
// GET /api/market/about-stats  (public) — the About page's figures, counted live (10 minutes, shared):
// live ads, sellers with live ads, orders delivered, counties with live ads, approved markets, approved riders & agents
exports.aboutStats = asyncHandler(async (req, res) => {
  const data = await cached('market:about-stats', 10 * 60 * 1000, async () => {
    const Order = require('../models/Order');
    const [ads, sellers, delivered, counties, markets, team] = await Promise.all([
      Listing.countDocuments({ status: 'active' }),
      Listing.distinct('seller', { status: 'active' }).then((list) => list.length),
      Order.countDocuments({ status: 'delivered' }),
      Listing.distinct('county', { status: 'active' }).then((list) => list.length),
      require('../models/Market').countDocuments({ approved: true }),
      Customer.countDocuments({ 'worker.status': 'approved', 'worker.role': { $in: ['rider', 'agent'] }, active: { $ne: false } }),
    ]);
    const members = await Customer.estimatedDocumentCount(); // everyone who has joined (instant: the collection's own count)
    // markets online: traders who sell from a market, the shopping agents stationed in markets, and a few markets to visit
    const Market = require('../models/Market');
    const [marketSellers, marketAgents, sellersByMarket] = await Promise.all([
      Customer.countDocuments({ 'shopLocation.market': { $exists: true, $ne: null }, active: { $ne: false } }),
      Customer.countDocuments({ 'worker.role': 'agent', 'worker.status': 'approved', 'worker.market': { $exists: true, $ne: null }, active: { $ne: false } }),
      Customer.aggregate([{ $match: { 'shopLocation.market': { $exists: true, $ne: null }, active: { $ne: false } } }, { $group: { _id: '$shopLocation.market', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]),
    ]);
    const busiest = sellersByMarket.length ? await Market.find({ _id: { $in: sellersByMarket.map((row) => row._id) }, approved: true }).select('name slug').lean() : [];
    const order = new Map(sellersByMarket.map((row, index) => [String(row._id), index]));
    const more = busiest.length < 8 ? await Market.find({ approved: true, _id: { $nin: busiest.map((item) => item._id) } }).sort({ name: 1 }).limit(8 - busiest.length).select('name slug').lean() : [];
    const marketList = [...busiest.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id))), ...more].map((item) => ({ name: item.name, slug: item.slug }));
    return { ads, sellers, delivered, counties, markets, team, members, marketSellers, marketAgents, marketList };
  }, { shared: true });
  res.set('Cache-Control', 'public, max-age=300');
  res.json(data);
});

exports.home = asyncHandler(async (req, res) => {
  const data = await cached('market:home', 20000, async () => {
    const [featured, latest, popular, counts, deals] = await Promise.all([
      Listing.find({ status: 'active', boostedUntil: { $gt: new Date() } }).sort({ boostedUntil: -1 }).limit(12).select(CARD_FIELDS).lean(),
      Listing.find({ status: 'active' }).sort({ createdAt: -1 }).limit(16).select(CARD_FIELDS).lean(),
      Listing.find({ status: 'active' }).sort({ views: -1 }).limit(8).select(CARD_FIELDS).lean(),
      countsByCategory(),
      require('../market/discount').topDeals(Listing, { limit: 12, fields: CARD_FIELDS }), // ranked by deal score, not only %
    ]);
    const total = Object.values(counts).reduce((sum, value) => sum + value.total, 0);
    // the top 3 deals are spotlighted at the top of the page (🏆 Top deal)
    return { featured: featured.map(card), deals: deals.map((deal, index) => ({ ...card(deal), ...(index < 3 ? { topDeal: true } : {}) })), latest: latest.map(card), popular: popular.map(card), total };
  }, { shared: true }); // the same for every visitor: worked out once for all servers
  res.json(data);
});

// ---------------------------------------------------------------- one ad
async function loadPublicListing(slug, viewer) {
  const listing = await Listing.findOne({ slug: String(slug).slice(0, 120) }).select('-keywords -reports').lean();
  if (!listing) return null;
  const mine = viewer && String(listing.seller) === String(viewer._id);
  if (listing.status === 'hidden' && !mine) return null;
  return { l: listing, mine };
}
exports.loadPublicListing = loadPublicListing;

const similarTo = (listing, number = 8) =>
  Listing.find({ status: 'active', category: listing.category, sub: listing.sub, _id: { $ne: listing._id } })
    .sort({ createdAt: -1 })
    .limit(number)
    .select(CARD_FIELDS)
    .lean()
    .then((result) => result.map(card));
exports.similarTo = similarTo;

// GET /api/market/listings/:slug
exports.get = asyncHandler(async (req, res) => {
  const found = await loadPublicListing(req.params.slug, req.customer);
  if (!found) throw httpError('This ad is no longer available', 404);
  const { l: listing, mine } = found;
  if (!mine) Listing.updateOne({ _id: listing._id }, { $inc: { views: 1 } }).catch(() => {});
  const [seller, similar, product, store] = await Promise.all([
    sellerSummary(listing.seller), similarTo(listing),
    listing.product ? Product.findById(listing.product).lean() : null,
    listing.store ? require('../models/Store').findById(listing.store).lean() : null,
  ]);
  const sellerDoc = await Customer.findById(listing.seller).select('phone').lean();
  res.json({
    listing: { ...listing, seller: undefined, sellerId: listing.seller, hasPhone: !!(listing.showPhone && sellerDoc?.phone), mine },
    seller,
    similar,
    product: product ? catalog.view(product) : null, // "Sold by N sellers from KSh X": compare them
    store: store && store.active !== false ? stores.publicView(store) : null,
  });
});

// GET /api/market/products?q=samsung a15&category=electronics&sub=phones  (the upload form: is it a product we know?)
exports.productSuggest = asyncHandler(async (req, res) => {
  const category = getCategory(String(req.query.category || '')) ? String(req.query.category) : undefined;
  const sub = category && getSub(category, String(req.query.sub || '')) ? String(req.query.sub) : undefined;
  const list = await catalog.suggest(clean(req.query.q, 90), { category, sub });
  res.json({ products: list.map(catalog.view) });
});

// GET /api/market/products/:id  (one product: every seller's offer of it, cheapest first)
exports.product = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Product not found', 404);
  const product = await Product.findOne({ _id: req.params.id, key: { $type: 'string' } }).lean(); // catalogue products only (not old POS records)
  if (!product) throw httpError('Product not found', 404);
  const offers = await Listing.find({ product: product._id, status: 'active' }).sort({ price: 1, createdAt: -1 }).limit(60).select(`${CARD_FIELDS} seller sellerName store`).lean();
  const storeList = new Map((await require('../models/Store').find({ _id: { $in: offers.map((item) => item.store).filter(Boolean) } }).lean()).map((store) => [String(store._id), store]));
  res.json({
    product: catalog.view(product),
    offers: offers.map((item) => {
      const store = storeList.get(String(item.store));
      return { ...card(item), sellerId: item.seller, sellerName: item.sellerName, store: store ? { _id: store._id, name: store.name, area: store.area || '', county: store.county || '' } : null };
    }),
  });
});

// GET /api/market/sellers/:id/stores  (a seller's open stores and branches)
exports.sellerStores = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Seller not found', 404);
  const list = await require('../models/Store').find({ seller: req.params.id, active: true }).sort({ isMain: -1, name: 1 }).lean();
  res.json({ stores: list.map(stores.publicView) });
});

// GET /api/market/price-guide?category=vehicles&sub=cars&make=Toyota&model=Vitz&year=2015
// Typical asking prices of similar ads (active and sold), so buyers and sellers know a fair price
exports.priceGuide = asyncHandler(async (req, res) => {
  const { category, sub } = req.query;
  const make = clean(req.query.make, 40);
  const model = clean(req.query.model, 40);
  const year = Number(req.query.year);
  if (!getSub(String(category || ''), String(sub || '')) || !make || !model) return res.json(null);
  const key = `market:guide:${category}:${sub}:${make}:${model}:${year || ''}`;
  const data = await cached(key, 30 * 60 * 1000, async () => {
    const base = { category, sub, 'attrs.make': make, 'attrs.model': model, status: { $in: ['active', 'sold'] }, price: { $gt: 0 } };
    let rows = [];
    if (year) rows = await Listing.find({ ...base, 'attrs.year': { $gte: year - 2, $lte: year + 2 } }).select('price').limit(500).lean();
    let span = year ? `${year - 2}–${year + 2}` : '';
    if (rows.length < 3) {
      rows = await Listing.find(base).select('price').limit(500).lean(); // not enough of that age: all years
      span = '';
    }
    if (rows.length < 3) return null;
    const currentRows = rows.map((row) => row.price).sort((first, second) => first - second);
    const at = (query) => currentRows[Math.min(currentRows.length - 1, Math.max(0, Math.round(query * (currentRows.length - 1))))];
    const round = (number) => Math.round(number / 5000) * 5000 || number;
    return { make, model, years: span, count: currentRows.length, low: round(at(0.25)), median: round(at(0.5)), high: round(at(0.75)) };
  });
  res.set('Cache-Control', 'public, max-age=600');
  res.json(data);
});

// GET /api/market/listings/:id/phone  (logged-in users only, to keep numbers away from scrapers)
exports.phone = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const listing = await Listing.findById(req.params.id).select('seller showPhone status').lean();
  if (!listing || listing.status === 'hidden') throw httpError('Ad not found', 404);
  if (!listing.showPhone) throw httpError('This seller prefers to be contacted by chat', 403);
  const customer = await Customer.findById(listing.seller).select('phone').lean();
  if (!customer?.phone) throw httpError('This seller has not added a phone number. Send them a chat instead.', 404);
  res.json({ phone: customer.phone });
});

// GET /api/market/sellers/:id/contact  (logged-in users: a seller's phone, for Call and WhatsApp)
// Any seller with active ads, unless every one of their ads says “contact me by chat only”. Rate-limited like the
// ad phone button, and only for logged-in people, so numbers can't be scraped.
exports.sellerContact = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Seller not found', 404);
  const [seller, ads, open] = await Promise.all([
    Customer.findOne({ _id: req.params.id, active: { $ne: false } }).select('name phone shopLocation.name shopLocation.area shopLocation.county').lean(),
    Listing.countDocuments({ seller: req.params.id, status: 'active' }),
    Listing.exists({ seller: req.params.id, status: 'active', showPhone: { $ne: false } }),
  ]);
  if (!seller || !ads) throw httpError('Seller not found', 404);
  if (!open) throw httpError('This seller prefers to be contacted by chat. Open one of their ads and send a message.', 403);
  if (!seller.phone) throw httpError('This seller has not added a phone number. Open one of their ads and send a message.', 404);
  const local = String(seller.phone).replace(/^254(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3');
  res.set('Cache-Control', 'private, no-store');
  res.json({ name: seller.shopLocation?.name || seller.name, phone: seller.phone, display: local, call: `tel:+${seller.phone}`, whatsapp: `https://wa.me/${seller.phone}?text=${encodeURIComponent(`Hello ${seller.shopLocation?.name || seller.name}, I found you on Kapu.`)}` });
});

// GET /api/market/sellers-near?near=lat,lng&km=10&q=  sellers whose shop pin is close by, nearest first
exports.sellersNear = asyncHandler(async (req, res) => {
  const near = geo.parseNear(req.query);
  if (!near) throw httpError('We need your location in Kenya to find sellers near you');
  res.json({ near, radii: geo.RADII, ...(await findSellersNear(near, req.query)) });
});

// Sellers around a point, by kind:
//   type=wholesale            sellers with bulk prices (bei ya jumla)
//   type=boutique&wear=men    boutiques / clothes sellers (men's or women's wear)
//   type=mama-mboga           mama mbogas and market traders selling fresh produce
//   market=<id>               traders registered in one market
// Only sellers with active ads that match are listed.
// the kinds of "near me" pages: ads that make a seller one of these, and the kind a seller can tick in their shop settings
const NEAR_TYPES = {
  'mama-mboga': { ads: { category: { $in: ['fresh-produce', 'samaki'] } }, kind: 'mama-mboga' },
  electronics: { ads: { category: 'electronics' }, kind: 'electronics' },
  spares: { ads: { category: { $in: ['spare-parts', 'vehicles'] } }, kind: 'spares' }, // motor & spare parts dealers
  baby: { ads: { category: 'baby-kids' }, kind: 'baby-shop' },
  grocery: { ads: { category: { $in: ['cooking-products', 'beverages', 'detergents-cleaning'] } }, kind: 'grocery' },
  chemist: { ads: { category: 'pharmacy' }, kind: 'chemist', licensed: true }, // only chemists our team verified
  importer: { ads: { origin: { $in: IMPORTED } }, kind: 'importer' }, // ex-Japan, ex-UK, Dubai, China… goods
};
// which ads belong on a "near me" page (null: any ad), and what to call them
const KIND_NAMES = { wholesale: 'wholesale', boutique: 'clothes & fashion', 'mama-mboga': 'fresh produce', electronics: 'electronics', spares: 'motor & spare parts', baby: 'baby & kids', grocery: 'cereals & groceries', chemist: 'chemist', importer: 'imported' };
function kindOf(type, wearKey, tradeKey) {
  const { WEAR } = require('../market/fashion');
  // wholesalers / importers: one trade (cereals, electronics…) when chosen
  const tk = type === 'wholesale' || type === 'importer' ? trades.tradeOf(type, tradeKey) : null;
  const withTrade = (trade) => (tk ? { filter: { $and: [trade.filter, trades.tradeFilter(type, tk.key)] }, name: `${tk.name.toLowerCase()}${type === 'wholesale' ? ' wholesale' : ' imported'}` } : trade);
  if (type === 'wholesale') return withTrade({ filter: { 'wholesale.enabled': true }, name: KIND_NAMES.wholesale });
  if (type === 'importer') return withTrade({ filter: NEAR_TYPES.importer.ads, name: KIND_NAMES.importer });
  if (type === 'boutique') {
    const width = WEAR[wearKey] ? wearKey : 'all';
    return { filter: WEAR[width].filter, name: width === 'all' ? KIND_NAMES.boutique : WEAR[width].name.toLowerCase() };
  }
  return NEAR_TYPES[type] ? { filter: NEAR_TYPES[type].ads, name: KIND_NAMES[type] } : null;
}
async function findSellersNear(near, query, { marketId } = {}) {
  const { WEAR } = require('../market/fashion');
  const type = ['wholesale', 'boutique', ...Object.keys(NEAR_TYPES)].includes(query.type) ? query.type : query.wholesale === '1' ? 'wholesale' : '';
  const nearType = NEAR_TYPES[type];
  const wear = type === 'boutique' ? (WEAR[query.wear] ? query.wear : 'all') : '';
  const who = { active: { $ne: false }, 'shopLocation.public': true };
  if (marketId) who['shopLocation.market'] = marketId;
  if (nearType?.licensed) who['chemist.status'] = 'verified';
  else who['shopLocation.point'] = geo.nearest(near);
  // importers from one country (what they said when they joined)
  const from = type === 'importer' && require('../market/importCountries').getCountry(query.from) ? String(query.from).toUpperCase() : '';
  if (from) who['trade.importFrom'] = from;
  const people = await Customer.find(who).limit(marketId ? 200 : 80).select('name avatar verified rating completedSales shopLocation chemist trade businessBoostUntil').lean();
  const ids = people.map((person) => person._id);
  const and = [{ seller: { $in: ids }, status: 'active' }];
  const searchText = clean(query.q, 80);
  if (searchText) and.push(search.wordFilter(searchText, 'all').filter);
  // (wholesale: matched below like the other kinds, so sellers who said they're wholesalers are listed too)
  // ads that make a seller a boutique / mama mboga / wholesaler… (sellers who said they are one also count, with any ad)
  const kindAds = type === 'boutique' ? WEAR[wear].filter : nearType ? nearType.ads : type === 'wholesale' ? { 'wholesale.enabled': true } : null;
  const declared = type === 'boutique' ? (customer) => customer.shopLocation?.kinds?.includes('boutique') && (wear === 'all' || customer.shopLocation.wear?.includes(wear))
    : nearType ? (customer) => customer.shopLocation?.kinds?.includes(nearType.kind)
    : type === 'wholesale' ? (customer) => customer.shopLocation?.kinds?.includes('wholesaler') // said so at sign-up / in their shop settings
    : null;
  // wholesalers and importers by trade (worked out from what they list)
  const tradeKind = type === 'wholesale' ? 'wholesale' : type === 'importer' ? 'importer' : '';
  const trade = tradeKind && trades.tradeOf(tradeKind, String(query.trade || '')) ? String(query.trade) : '';
  const inTrade = trade ? new Set(trades.tradeOf(tradeKind, trade).cats) : null;
  // the categories a seller said they wholesale / import count as much as their ads
  const saidCats = (person) => (tradeKind === 'wholesale' ? person.trade?.wholesale : tradeKind === 'importer' ? person.trade?.imports : null) || [];
  const bulk = { $sum: { $cond: [{ $eq: ['$wholesale.enabled', true] }, 1, 0] } };
  // one pass each: every active ad of these sellers, and the ads that fit this page — per seller and category
  const [all, matching] = await Promise.all([
    Listing.aggregate([{ $match: { $and: and } }, { $group: { _id: '$seller', n: { $sum: 1 }, bulk, cats: { $addToSet: '$category' }, phone: { $max: { $cond: [{ $eq: ['$showPhone', false] }, 0, 1] } } } }]),
    kindAds ? Listing.aggregate([{ $match: { $and: [...and, kindAds] } }, { $group: { _id: { s: '$seller', c: '$category' }, n: { $sum: 1 }, bulk } }]) : null,
  ]);
  const by = new Map(all.map((item) => [String(item._id), item]));
  // fold "per seller & category" into: matching ads, wholesale items, categories (in the chosen trade), and the seller's trades
  let kindBy = null;
  const kindCats = new Map();
  const kindBulk = new Map();
  const sellerTrades = new Map();
  if (matching) {
    kindBy = new Map();
    const catsOf = new Map();
    for (const item of matching) {
      const id = String(item._id.s);
      if (!catsOf.has(id)) catsOf.set(id, []);
      catsOf.get(id).push(item._id.c);
      if (inTrade && !inTrade.has(item._id.c)) continue;
      kindBy.set(id, (kindBy.get(id) || 0) + item.n);
      kindBulk.set(id, (kindBulk.get(id) || 0) + item.bulk);
      if (!kindCats.has(id)) kindCats.set(id, []);
      kindCats.get(id).push(item._id.c);
    }
    if (tradeKind) for (const [id, cats] of catsOf) sellerTrades.set(id, trades.tradesOfCats(tradeKind, cats));
  }
  if (tradeKind) for (const person of people) if (saidCats(person).length) { const id = String(person._id); sellerTrades.set(id, [...new Set([...(sellerTrades.get(id) || []), ...trades.tradesOfCats(tradeKind, saidCats(person))])]); }
  const declaredIds = new Set(declared ? people.filter(declared).map((item) => String(item._id)) : []);
  const tradeCounts = {};
  const sellers = people
    .filter((person) => {
      const id = String(person._id);
      if (!by.has(id)) return false;
      if (tradeKind) for (const item of sellerTrades.get(id) || []) tradeCounts[item] = (tradeCounts[item] || 0) + 1;
      if (trade) return kindBy.has(id) || saidCats(person).some((cat) => inTrade.has(cat)); // a trade: sellers with ads in it, or who said they deal in it
      return !kindBy || kindBy.has(id) || declaredIds.has(id);
    })
    .map((customer) => {
      const id = String(customer._id);
      const value = by.get(id);
      return {
        _id: customer._id, name: customer.name, avatar: customer.avatar || '', verified: !!customer.verified, rating: customer.rating || { avg: 0, count: 0 }, completedSales: customer.completedSales || 0,
        shop: geo.publicShop(customer), km: geo.distanceKm(near, customer.shopLocation.point), ads: kindBy ? kindBy.get(id) || value.n : value.n, wholesale: kindBy ? kindBulk.get(id) || 0 : value.bulk,
        categories: (kindCats.get(id) || value.cats).map((item) => getCategory(item)).filter(Boolean).slice(0, 4).map((item) => ({ slug: item.slug, name: item.name, icon: item.icon })),
        ...(tradeKind ? { trades: sellerTrades.get(id) || [] } : {}),
        ...(tradeKind === 'importer' ? { importFrom: require('../market/sellerProfile').publicTrade(customer.trade)?.importFrom || [] } : {}),
        contact: value.phone === 1, // the phone can be shown (Call / WhatsApp), to logged-in people, on request
        boosted: customer.businessBoostUntil > new Date(), // "boost my business" this month: shown first
      };
    });
  if (marketId) sellers.sort((first, second) => second.boosted - first.boosted || second.ads - first.ads);
  // shops that say they're this kind of shop come first (the rest just have some matching ads), nearest first within each
  else if (declared) sellers.sort((first, second) => second.boosted - first.boosted || declaredIds.has(String(second._id)) - declaredIds.has(String(first._id)) || first.km - second.km);
  else sellers.sort((first, second) => second.boosted - first.boosted); // boosted businesses first (stable: the rest keep their order)
  // "open now": shops whose hours say they're open at this moment (shops without hours are left out)
  const openNow = query.openNow === '1';
  const list = openNow ? sellers.filter((seller) => seller.shop?.hours?.status?.open) : sellers;
  return { sellers: list, type, wear, openNow, wholesaleOnly: type === 'wholesale', ...(tradeKind ? { trade, trades: trades.publicTrades(tradeKind).map((item) => ({ ...item, sellers: tradeCounts[item.key] || 0 })) } : {}) };
}

// ---------------------------------------------------------------- markets & mama mbogas
const Market = require('../models/Market');
const { publicMarket, slugify: marketSlug, KINDS: MARKET_KINDS } = require('../market/markets');
// each market's approved shopping agents (worker.market), counted in one read
const agentCounts = async (ids) => {
  const rows = await Customer.aggregate([{ $match: { 'worker.market': { $in: ids }, 'worker.role': 'agent', 'worker.status': 'approved', active: { $ne: false } } }, { $group: { _id: '$worker.market', n: { $sum: 1 } } }]);
  return new Map(rows.map((row) => [String(row._id), row.n]));
};
const traderCounts = async (ids) => {
  const rows = await Customer.aggregate([{ $match: { 'shopLocation.market': { $in: ids }, 'shopLocation.public': true, active: { $ne: false } } }, { $group: { _id: '$shopLocation.market', n: { $sum: 1 } } }]);
  return new Map(rows.map((row) => [String(row._id), row.n]));
};

// GET /api/market/markets?near=lat,lng&km=10&county=Nairobi&q=gik  (approved markets, nearest first)
exports.markets = asyncHandler(async (req, res) => {
  const near = geo.parseNear(req.query);
  const filter = { approved: true };
  if (near) filter.point = geo.nearest({ ...near, km: Math.max(near.km, 1) });
  if (COUNTIES.includes(req.query.county)) filter.county = req.query.county;
  const query = clean(req.query.q, 40);
  if (query) filter.name = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const list = await Market.find(filter).limit(near ? 40 : 200).lean();
  if (!near) list.sort((first, second) => first.county.localeCompare(second.county) || first.name.localeCompare(second.name));
  // a seller's own suggestions too (so they can register in a market they just added)
  const mine = req.customer ? await Market.find({ suggestedBy: req.customer._id, approved: false }).lean() : [];
  const ids = [...mine, ...list].map((item) => item._id);
  const [counts, agents] = await Promise.all([traderCounts(ids), agentCounts(ids)]);
  res.json({
    near, kinds: MARKET_KINDS,
    markets: [...mine, ...list].map((market) => publicMarket(market, { traders: counts.get(String(market._id)) || 0, agents: agents.get(String(market._id)) || 0, ...(near ? { km: geo.distanceKm(near, market.point) } : {}) })),
  });
});

// GET /api/market/markets/:slug  → the market, its registered traders and what they sell
exports.market = asyncHandler(async (req, res) => {
  const market = await Market.findOne({ slug: String(req.params.slug).slice(0, 80), approved: true }).lean();
  if (!market) throw httpError('Market not found', 404);
  const at = { lat: market.point.coordinates[1], lng: market.point.coordinates[0], km: 3 };
  const { sellers } = await findSellersNear(geo.parseNear(req.query) || at, req.query, { marketId: market._id });
  const ids = sellers.map((seller) => seller._id);
  const items = ids.length ? await Listing.find({ seller: { $in: ids }, status: 'active' }).sort({ boostedUntil: -1, createdAt: -1 }).limit(48).select(CARD_FIELDS).lean() : [];
  items.sort((first, second) => (second.category === 'fresh-produce') - (first.category === 'fresh-produce')); // fresh produce first
  const nearby = await Market.find({ approved: true, _id: { $ne: market._id }, point: geo.nearest({ ...at, km: 15 }) }).limit(6).lean();
  const agents = (await agentCounts([market._id])).get(String(market._id)) || 0;
  res.json({ market: publicMarket(market, { traders: sellers.length, agents }), sellers, items: items.map((item) => card(item)), nearby: nearby.map((currentMarket) => publicMarket(currentMarket, { km: geo.distanceKm(at, currentMarket.point) })) });
});

// GET /api/market/markets/:slug/agents  → the shopping agents who work at this market (linked to it: worker.market).
// Everyone sees who they are; their phone numbers only to signed-in members (like sellers' contacts).
exports.marketAgents = asyncHandler(async (req, res) => {
  const market = await Market.findOne({ slug: String(req.params.slug).slice(0, 80), approved: true }).select('name slug area county').lean();
  if (!market) throw httpError('Market not found', 404);
  const agents = await Customer.find({ 'worker.market': market._id, 'worker.role': 'agent', 'worker.status': 'approved', active: { $ne: false } })
    .select('name avatar phone worker.available worker.rating worker.vehicle worker.liveAt').sort({ 'worker.available': -1, 'worker.rating.avg': -1 }).limit(30).lean();
  // their finished jobs: one count for all of them
  const done = agents.length ? await require('../models/Task').aggregate([{ $match: { worker: { $in: agents.map((agent) => agent._id) }, status: 'done' } }, { $group: { _id: '$worker', n: { $sum: 1 } } }]) : [];
  const jobs = new Map(done.map((row) => [String(row._id), row.n]));
  const signedIn = !!req.customer;
  res.json({
    market: { name: market.name, slug: market.slug, area: market.area, county: market.county },
    signedIn,
    agents: agents.map((agent) => ({
      _id: agent._id, name: agent.name, avatar: agent.avatar || '', available: agent.worker?.available !== false,
      rating: agent.worker?.rating?.count ? { avg: agent.worker.rating.avg, count: agent.worker.rating.count } : null,
      jobs: jobs.get(String(agent._id)) || 0, vehicle: agent.worker?.vehicle || '',
      ...(signedIn && agent.phone ? { phone: agent.phone } : {}),
    })),
  });
});

// POST /api/market/markets { name, kind, area, county, lat, lng }  a seller suggests a market that's missing
exports.suggestMarket = asyncHandler(async (req, res) => {
  const name = clean(req.body.name, 80);
  if (name.length < 3) throw httpError('Please type the market’s name');
  const point = geo.toPoint(req.body.lat, req.body.lng);
  if (!point) throw httpError('Put your shop pin on the map first: we use it as the market’s location');
  const county = clean(req.body.county, 40);
  if (!COUNTIES.includes(county)) throw httpError('Please choose the county');
  if ((await Market.countDocuments({ suggestedBy: req.customer._id, approved: false })) >= 3) throw httpError('You already suggested 3 markets. Our team will check them soon.');
  const close = await Market.findOne({ approved: true, point: geo.nearest({ lat: point.coordinates[1], lng: point.coordinates[0], km: 0.4 }) }).lean();
  if (close) throw httpError(`${close.name} is right here. Choose it from the list instead.`);
  let slug = marketSlug(name);
  if (await Market.exists({ slug })) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  const kind = MARKET_KINDS[req.body.kind] ? req.body.kind : 'mixed';
  const market = await Market.create({ name, slug, kind, area: clean(req.body.area, 60), county, point, days: clean(req.body.days, 80), approved: false, suggestedBy: req.customer._id });
  res.status(201).json({ market: publicMarket(market.toObject(), { traders: 0 }), message: `Thanks! ${name} is added for you now. Our team checks it before it shows to everyone.` });
});

// ----- staff: GET/POST/PUT/DELETE /api/market/admin/markets
exports.adminMarkets = asyncHandler(async (req, res) => {
  const list = await Market.find().sort({ approved: 1, county: 1, name: 1 }).lean();
  const counts = await traderCounts(list.map((item) => item._id));
  const who = await Customer.find({ _id: { $in: list.filter((item) => item.suggestedBy).map((item) => item.suggestedBy) } }).select('name').lean();
  const names = new Map(who.map((item) => [String(item._id), item.name]));
  res.json({ kinds: MARKET_KINDS, markets: list.map((item) => publicMarket(item, { traders: counts.get(String(item._id)) || 0, suggestedBy: item.suggestedBy ? names.get(String(item.suggestedBy)) || 'a seller' : '' })) });
});
async function marketFields(body, current) {
  const name = clean(body.name, 80);
  if (name.length < 3) throw httpError('Please type the market’s name');
  const county = clean(body.county, 40);
  if (!COUNTIES.includes(county)) throw httpError('Please choose the county');
  let point = null;
  if (body.link) {
    const pin = await geo.resolveMapLink(body.link);
    if (!pin) throw httpError('We couldn’t read a location in Kenya from that link. Paste a Google Maps link, or type “lat, lng”.');
    point = geo.toPoint(pin.lat, pin.lng);
  }
  if (!point && !current) throw httpError('Set the market’s location: paste a Google Maps link or type “lat, lng”');
  return {
    name, county, kind: MARKET_KINDS[body.kind] ? body.kind : 'mixed', area: clean(body.area, 60), days: clean(body.days, 80), about: clean(body.about, 400),
    ...(point ? { point } : {}), ...(body.approved !== undefined ? { approved: body.approved === true || body.approved === 'true' } : {}),
  };
}
const syncTraders = (match) => Customer.updateMany({ 'shopLocation.market': match._id }, { $set: { 'shopLocation.marketName': match.name, 'shopLocation.marketSlug': match.slug } });
exports.adminCreateMarket = asyncHandler(async (req, res) => {
  const marketFieldsResult = await marketFields(req.body);
  let slug = marketSlug(marketFieldsResult.name);
  if (await Market.exists({ slug })) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  const market = await Market.create({ ...marketFieldsResult, slug, approved: marketFieldsResult.approved !== false });
  invalidate('market:');
  res.status(201).json(publicMarket(market.toObject(), { traders: 0 }));
});
exports.adminUpdateMarket = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Market not found', 404);
  const market = await Market.findById(req.params.id);
  if (!market) throw httpError('Market not found', 404);
  // { approved: true } alone just approves a seller's suggestion
  const field = Object.keys(req.body).length === 1 && req.body.approved !== undefined ? { approved: req.body.approved === true } : await marketFields(req.body, market);
  Object.assign(market, field);
  await market.save();
  await syncTraders(market);
  invalidate('market:');
  res.json(publicMarket(market.toObject()));
});
exports.adminDeleteMarket = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Market not found', 404);
  const match = await Market.findByIdAndDelete(req.params.id);
  if (!match) throw httpError('Market not found', 404);
  // traders stay on the map, just without the market
  await Customer.updateMany({ 'shopLocation.market': match._id }, { $unset: { 'shopLocation.market': 1, 'shopLocation.marketName': 1, 'shopLocation.marketSlug': 1, 'shopLocation.stall': 1 } });
  invalidate('market:');
  res.json({ message: `${match.name} removed` });
});

// ---------------------------------------------------------------- fashion: clothes by type
// GET /api/market/fashion?near=lat,lng&km=10
exports.fashion = asyncHandler(async (req, res) => {
  const { FASHION, linkFor } = require('../market/fashion');
  const near = geo.parseNear(req.query);
  // one aggregate for the whole page: every live clothing ad counted by (category, type, item), with the newest
  // boosted-first 8 of each; the sections (a type, or a type narrowed to some items) are put together from those
  const build = async () => {
    const all = FASHION.flatMap((item) => item.sections);
    const pairs = [...new Map(all.map((section) => [`${section.category}/${section.sub}`, { category: section.category, sub: section.sub }])).values()];
    const project = Object.fromEntries(CARD_FIELDS.split(' ').map((field) => [field, 1]));
    const rows = await Listing.aggregate([
      { $match: { status: 'active', $or: pairs, ...(near ? { geo: geo.within(near) } : {}) } },
      { $project: project },
      { $group: { _id: { category: '$category', sub: '$sub', item: '$attrs.item' }, n: { $sum: 1 }, top: { $topN: { n: 8, sortBy: { boostedUntil: -1, createdAt: -1 }, output: '$$ROOT' } } } },
    ]);
    const time = (value) => (value ? new Date(value).getTime() : -Infinity);
    const newestFirst = (first, second) => time(second.boostedUntil) - time(first.boostedUntil) || time(second.createdAt) - time(first.createdAt);
    const groups = FASHION.map((item) => ({
      group: item.group, icon: item.icon,
      sections: item.sections.map((section) => {
        const parts = rows.filter((row) => row._id.category === section.category && row._id.sub === section.sub && (!section.items || section.items.includes(row._id.item)));
        const items = parts.flatMap((row) => row.top).sort(newestFirst).slice(0, 8);
        return { key: section.key, name: section.name, icon: section.icon, link: linkFor(section), count: parts.reduce((sum, row) => sum + row.n, 0), items: items.map((element) => card(element, near)) };
      }),
    }));
    return { groups, near };
  };
  res.json(near ? await build() : await cached('market:fashion', 30000, build, { shared: true }));
});

// GET /api/market/sellers/:id/basket  → what this seller sells online, with what the cart needs
exports.basket = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Seller not found', 404);
  const customer = await Customer.findById(req.params.id).select('name shopLocation chemist active').lean();
  if (!customer || customer.active === false) throw httpError('Seller not found', 404);
  // from a "near me" page (?type=baby, ?type=boutique&wear=men…): only the items that fit it
  const kind = kindOf(String(req.query.type || ''), String(req.query.wear || ''), String(req.query.trade || ''));
  const buyable = { seller: customer._id, status: 'active', buyNow: true, stock: { $gt: 0 } };
  const pick = (field) => Listing.find(field).sort({ category: 1, title: 1 }).limit(80)
    .select('slug title price images category sub stock delivery area county attrs wholesale condition origin').lean();
  const ls = await pick(kind ? { $and: [buyable, kind.filter] } : buyable);
  // related ads they don't sell online (ask the seller about them)
  const ask = kind ? await Listing.find({ $and: [{ seller: customer._id, status: 'active', _id: { $nin: ls.map((item) => item._id) } }, kind.filter] }).sort({ createdAt: -1 }).limit(12).select('slug title price images category').lean() : [];
  const shown = [...ls, ...ask].map((item) => item._id);
  const others = await Listing.countDocuments({ seller: customer._id, status: 'active', _id: { $nin: shown } });
  // fresh produce first (a mama mboga's list), then everything else they sell
  ls.sort((first, second) => (second.category === 'fresh-produce') - (first.category === 'fresh-produce'));
  res.json({
    seller: { _id: customer._id, name: customer.name, shop: geo.publicShop(customer) },
    others,
    kind: kind ? kind.name : '',
    ask: ask.map((listing) => ({ _id: listing._id, slug: listing.slug, title: listing.title, price: listing.price, image: listing.images?.[0] || '', category: listing.category })),
    items: ls.map((listing) => ({
      _id: listing._id, slug: listing.slug, title: listing.title, price: listing.price, image: listing.images?.[0] || '', category: listing.category, stock: listing.stock,
      unit: listing.attrs?.unit || '', delivery: listing.delivery, area: listing.area, county: listing.county, sellerId: customer._id, sellerName: customer.name, condition: listing.condition || '', origin: listing.origin || '',
      fits: listing.category === 'spare-parts' && listing.attrs?.make ? `${listing.attrs.make}${listing.attrs.model ? ` ${listing.attrs.model}` : ''}${listing.attrs.yearFrom || listing.attrs.yearTo ? ` ${listing.attrs.yearFrom || '…'}–${listing.attrs.yearTo || 'now'}` : ''}` : '',
      wholesale: listing.wholesale?.enabled ? listing.wholesale : undefined,
    })),
  });
});

// GET /api/market/delivery-quote?seller=<id>&near=lat,lng&units=3&subtotal=450
//   → { rider: { ok, km, fee, reason }, walk: { ok, km, minutes, fee, free, reason } }  (before logging in)
exports.deliveryQuote = asyncHandler(async (req, res) => {
  if (!isId(req.query.seller)) throw httpError('Seller not found', 404);
  const at = geo.parseNear({ near: req.query.near, km: 1 });
  if (!at) throw httpError('We need your location in Kenya to price the delivery');
  const customer = await Customer.findById(req.query.seller).select('shopLocation').lean();
  if (!customer) throw httpError('Seller not found', 404);
  const units = Math.max(1, Math.min(500, Math.floor(Number(req.query.units)) || 1));
  const subtotal = Math.max(0, Number(req.query.subtotal) || 0);
  const quote = await require('../market/fieldwork').riderQuoteByRoad(customer.shopLocation?.point, at);
  const currentQuote = require('../market/walk').walkQuote(customer.shopLocation, at, units, subtotal);
  res.json({
    rider: quote.ok ? { ok: true, km: quote.km, fee: quote.fee } : { ok: false, reason: quote.reason },
    walk: currentQuote.ok ? { ok: true, km: currentQuote.km, minutes: currentQuote.minutes, fee: currentQuote.fee, free: currentQuote.free } : { ok: false, reason: currentQuote.reason },
  });
});

// POST /api/market/cart-check { lines: [{ id, qty, deal }] }
//   → { items: { <id>: { state: 'ok' | 'low' | 'out', stock, reason } } }
// Is everything in the cart still available? (the cart keeps a copy of each item from when it was added)
exports.cartCheck = asyncHandler(async (req, res) => {
  const lines = (Array.isArray(req.body.lines) ? req.body.lines : []).slice(0, 60).filter((item) => isId(item?.id));
  const ls = await Listing.find({ _id: { $in: lines.map((line) => line.id) } }).select('status buyNow stock attrs').lean();
  const by = new Map(ls.map((item) => [String(item._id), item]));
  const items = {};
  for (const line of lines) {
    const listing = by.get(String(line.id));
    const qty = Math.max(1, Math.floor(Number(line.qty)) || 1);
    if (!listing || listing.status === 'hidden') items[line.id] = { state: 'out', stock: 0, reason: 'This ad was removed' };
    else if (listing.status !== 'active') items[line.id] = { state: 'out', stock: 0, reason: 'Sold out' };
    else if (listing.attrs?.rx === 'Prescription needed') items[line.id] = { state: 'out', stock: 0, reason: 'Needs a prescription: buy it at the chemist' };
    else if (!listing.buyNow) items[line.id] = line.deal ? { state: 'ok', stock: qty } : { state: 'out', stock: 0, reason: 'No longer sold online' };
    else if (listing.stock < 1) items[line.id] = { state: 'out', stock: 0, reason: 'Sold out' };
    else if (listing.stock < qty) items[line.id] = { state: 'low', stock: listing.stock, reason: `Only ${listing.stock} left` };
    else items[line.id] = { state: 'ok', stock: listing.stock };
  }
  res.json({ items });
});

// GET /api/market/sellers/:id
exports.seller = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Seller not found', 404);
  const seller = await sellerSummary(req.params.id);
  if (!seller) throw httpError('Seller not found', 404);
  const [items, phoneOk] = await Promise.all([
    Listing.find({ seller: req.params.id, status: 'active' }).sort({ createdAt: -1 }).limit(60).select(CARD_FIELDS).lean(),
    Listing.exists({ seller: req.params.id, status: 'active', showPhone: { $ne: false } }),
  ]);
  res.json({ seller: { ...seller, contact: !!phoneOk }, items: items.map(card) });
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
  if (cat.slug === 'spare-parts') {
    const yf = Number(body.attrs?.yearFrom);
    const yt = Number(body.attrs?.yearTo);
    if (yf && yt && yt < yf) throw httpError('“Fits up to year” can’t be before “Fits from year”');
  }
  if (cat.adult && body.licensed !== true && body.licensed !== 'true') throw httpError('Alcohol can only be sold by licensed sellers. Please confirm you hold a valid liquor licence.');

  const attrs = {};
  const input = body.attrs && typeof body.attrs === 'object' ? body.attrs : {};
  for (const field of fieldsFor(category, sub)) {
    const raw = input[field.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (field.required) throw httpError(`Please fill in: ${field.label}`);
      continue;
    }
    if (field.type === 'number') {
      const currentRaw = Number(raw);
      if (!Number.isFinite(currentRaw) || (field.min !== undefined && currentRaw < field.min) || (field.max !== undefined && currentRaw > field.max)) throw httpError(`${field.label}: please enter a number${field.min !== undefined ? ` between ${field.min} and ${field.max}` : ''}`);
      attrs[field.key] = currentRaw;
    } else if (field.type === 'select') {
      const value = field.aliases?.[String(raw)] || String(raw); // an older name for the same option
      if (!field.options.includes(value)) throw httpError(`${field.label}: please choose from the list`);
      attrs[field.key] = value;
    } else if (field.type === 'make') {
      if (!Object.prototype.hasOwnProperty.call(field.makes, String(raw))) throw httpError(`${field.label}: please choose from the list`);
      attrs[field.key] = String(raw);
    } else {
      attrs[field.key] = clean(raw, 60); // model and free text
    }
  }
  // Buy now (online orders) — not for vehicles, land or services
  const { canBuyNow } = require('./orderController');
  const buyNow = (body.buyNow === true || body.buyNow === 'true') && canBuyNow(category, sub);
  let stock = 0;
  let delivery = { available: true, fee: 0, pickup: true, days: '' };
  if (buyNow) {
    stock = Math.floor(Number(body.stock));
    if (!(stock >= 0 && stock <= 100000)) throw httpError('Quantity in stock: please enter a number from 0 to 100,000');
    if (!(price > 0)) throw httpError('Items sold online need a price');
    const currentDelivery = body.delivery || {};
    delivery = {
      available: currentDelivery.available !== false && currentDelivery.available !== 'false',
      fee: Math.round(Number(currentDelivery.fee || 0)),
      pickup: currentDelivery.pickup !== false && currentDelivery.pickup !== 'false',
      days: clean(currentDelivery.days, 40),
    };
    if (!(delivery.fee >= 0 && delivery.fee <= 100000)) throw httpError('Delivery fee: please enter a valid amount');
    if (!delivery.available && !delivery.pickup) throw httpError('Choose delivery, pickup, or both, so buyers can get the item');
  }
  // bulk prices: not for vehicles, land and services
  const bulk = require('./orderController').canBuyNow(category, sub) ? wholesale.cleanWholesale(body, price, httpError) : { enabled: false, retail: true, unit: '', tiers: [] };
  let layaway = { enabled: false, minDepositPercent: 30, maxWeeks: 4 };
  if (buyNow && (body.layaway?.enabled === true || body.layaway?.enabled === 'true')) {
    if (price < 1000) throw httpError('Lipa Pole Pole is for items of KSh 1,000 and above');
    layaway = {
      enabled: true,
      minDepositPercent: Math.min(80, Math.max(10, Math.round(Number(body.layaway.minDepositPercent || 30)))),
      maxWeeks: Math.min(12, Math.max(1, Math.round(Number(body.layaway.maxWeeks || 4)))),
    };
  }
  return {
    buyNow, stock, delivery, layaway, wholesale: bulk,
    ...(body.weightKg === '' || body.weightKg === null ? { weightKg: null } : {}),
    ...(body.weightKg !== undefined && body.weightKg !== '' && body.weightKg !== null ? { weightKg: (() => {
      const weightKg = Number(body.weightKg);
      if (!(weightKg > 0 && weightKg <= 5000)) throw httpError('Weight: enter about how many kg one item weighs (e.g. 0.5)');
      return Math.round(weightKg * 100) / 100;
    })() } : {}),
    origin: hasOrigin(category, sub) && getOrigin(String(body.origin || '')) ? String(body.origin) : '',
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
const uploaded = (req) => (req.files || []).map((file) => listingImageUrl(file.filename));
const cleanupUploads = (req) => uploaded(req).forEach(removeListingImage);
const changed = () => {
  invalidate('market:');
};

// medicines: only from verified chemists; prescription medicines are chat / visit only (never "Buy online")
function pharmacyRules(value, entryValue) {
  if (value.category !== 'pharmacy') return value;
  if (entryValue.chemist?.status !== 'verified') throw httpError('Only verified chemists can post medicines and health products. Send your Pharmacy and Poisons Board premises licence in My account → Shop location, and our team will check it.', 403);
  if (value.sub === 'prescription-medicine') value.attrs.rx = 'Prescription needed';
  if (value.attrs.rx === 'Prescription needed') Object.assign(value, { buyNow: false, stock: 0, layaway: { enabled: false, minDepositPercent: 30, maxWeeks: 4 }, wholesale: { enabled: false, retail: true, unit: '', tiers: [] } });
  return value;
}

// POST /api/market/listings  (multipart: data=<json>, images=<files>)
exports.create = asyncHandler(async (req, res) => {
  try {
    const ad = await saveListing(req.customer, formBody(req), uploaded(req));
    res.status(201).json(ad);
  } catch (err) {
    cleanupUploads(req); // don't keep photos of an ad that wasn't saved
    throw err;
  }
});

// a new ad for this seller (the Sell form, or a seller answering a buyer's photo request): checked like any other
async function saveListing(customer, body, images) {
  const listing = pharmacyRules(validate(body), customer);
  Object.assign(listing, require('../market/discount').discountFor(body, listing.price, null, httpError));
  if (listing.buyNow && listing.stock < 1) throw httpError('Quantity in stock must be at least 1 to sell online');
  // no limit on how many items a seller can have: post as many as you sell
  const doc = { ...listing, images, seller: customer._id, sellerName: customer.name, sellerVerified: !!customer.verified };
  if (customer.businessBoostUntil > new Date()) doc.boostedUntil = customer.businessBoostUntil; // their business is boosted this month
  // the store it's sold from (the main store unless the seller picked a branch); found near that store's pin
  const store = await stores.resolve(customer._id, body.store);
  if (store) {
    doc.store = store._id;
    if (!doc.area) doc.area = store.area || '';
  }
  const pin = store && !store.isMain ? stores.pinFor(store, listing.county) : geo.pinFor(customer, listing.county);
  if (pin) doc.geo = pin;
  await catalog.link(doc, body.product); // the catalogue product (other sellers' offers of the same thing)
  doc.slug = `${slugify(`${listing.title} ${listing.area || listing.county}`)}-${crypto.randomBytes(3).toString('hex')}`;
  doc.keywords = search.keywordsFor(doc);
  const ad = await Listing.create(doc);
  changed();
  catalog.refreshSoon(ad.product);
  return ad;
}
exports.saveListing = saveListing;

async function ownListing(req) {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const listing = await Listing.findById(req.params.id);
  if (!listing || String(listing.seller) !== String(req.customer._id)) throw httpError('Ad not found', 404);
  return listing;
}

// PUT /api/market/listings/:id  (multipart; data.keepImages = photos to keep, in order)
exports.update = asyncHandler(async (req, res) => {
  try {
    const listing = await ownListing(req);
    if (listing.status === 'hidden') throw httpError('This ad was taken down by the marketplace team and can’t be edited. Please contact support.', 403);
    const body = formBody(req);
    const pharmacyRulesResult = pharmacyRules(validate(body), req.customer);
    Object.assign(pharmacyRulesResult, require('../market/discount').discountFor(body, pharmacyRulesResult.price, listing, httpError));
    const fresh = uploaded(req);
    let images;
    if (Array.isArray(body.order)) {
      // exact photo order from the form: existing photo URLs and "new:<n>" for the n-th uploaded file
      images = body.order.map((item) => (typeof item === 'string' && item.startsWith('new:') ? fresh[Number(item.slice(4))] : listing.images.includes(item) ? item : null)).filter(Boolean);
      fresh.forEach((item) => !images.includes(item) && images.push(item));
    } else {
      const kept = Array.isArray(body.keepImages) ? body.keepImages.filter((keepImage) => listing.images.includes(keepImage)) : listing.images;
      images = [...kept, ...fresh];
    }
    images = [...new Set(images)];
    const keep = images.filter((image) => listing.images.includes(image));
    if (images.length > 8) throw httpError('You can have up to 8 photos');
    listing.images.filter((image) => !keep.includes(image)).forEach(removeListingImage);
    Object.assign(listing, pharmacyRulesResult, { images });
    if (listing.photoCredit?.source && !images.some((image) => /^https:\/\//.test(image))) listing.photoCredit = undefined; // the seller's own photos now
    listing.keywords = search.keywordsFor(listing);
    listing.markModified('attrs');
    if (listing.buyNow && listing.stock > 0 && listing.status === 'sold') listing.status = 'active';
    if (listing.buyNow && listing.stock === 0 && listing.status === 'active') listing.status = 'sold';
    if (body.store !== undefined && body.store !== '') listing.store = (await stores.resolve(req.customer._id, body.store))?._id || listing.store;
    else if (!listing.store) listing.store = (await stores.ensureMain(req.customer._id))?._id;
    {
      const store = listing.store ? await require('../models/Store').findById(listing.store).lean() : null;
      const pin = store && !store.isMain ? stores.pinFor(store, listing.county) : geo.pinFor(req.customer, listing.county);
      listing.geo = pin || undefined;
    }
    const before = listing.product;
    await catalog.link(listing, body.product);
    await listing.save();
    changed();
    catalog.refreshSoon([before, listing.product]);
    res.json(listing);
  } catch (err) {
    cleanupUploads(req);
    throw err;
  }
});

// PATCH /api/market/listings/:id/price { price, unit }  (mama mbogas change today's price in one tap: KSh 5 or 10 a kifungu,
// tomatoes per kg or per piece… the seller decides). A price cut of 5–70% shows as a deal, like any other edit.
exports.quickPrice = asyncHandler(async (req, res) => {
  const listing = await ownListing(req);
  if (listing.status === 'hidden') throw httpError('This ad was taken down by the marketplace team', 403);
  const price = Math.round(Number(req.body.price));
  if (!(price >= 1 && price <= 10000000)) throw httpError('Enter a price in KSh (at least 1)');
  const before = { price: listing.price, wasPrice: listing.wasPrice, discountUntil: listing.discountUntil };
  if (req.body.unit !== undefined && req.body.unit !== '') {
    const field = fieldsFor(listing.category, listing.sub).find((item) => item.key === 'unit');
    if (!field) throw httpError('This ad isn’t sold per unit');
    const unit = field.aliases?.[String(req.body.unit)] || String(req.body.unit);
    if (!field.options.includes(unit)) throw httpError('Sold per: please choose from the list');
    listing.attrs = { ...(listing.attrs || {}), unit };
    listing.markModified('attrs');
  }
  listing.price = price;
  Object.assign(listing, require('../market/discount').discountFor({}, price, before, httpError));
  if (listing.wholesale?.enabled && listing.wholesale.tiers?.some((tier) => tier.price >= price)) listing.wholesale.tiers = listing.wholesale.tiers.filter((tier) => tier.price < price); // bulk prices must stay below the single price
  await listing.save();
  changed();
  catalog.refreshSoon(listing.product);
  res.json(card(listing.toObject()));
});

// PATCH /api/market/listings/:id/status { status: 'active' | 'sold' }
exports.setStatus = asyncHandler(async (req, res) => {
  const listing = await ownListing(req);
  if (listing.status === 'hidden') throw httpError('This ad was taken down by the marketplace team. Please contact support.', 403);
  const status = req.body.status === 'sold' ? 'sold' : 'active';
  if (status === 'active' && listing.buyNow && listing.stock < 1) throw httpError('Add stock first (Edit the ad → Quantity in stock)');
  listing.status = status;
  await listing.save();
  changed();
  catalog.refreshSoon(listing.product);
  // sold → deleted from the system (unless a sale on it is still in progress: then once that's done)
  if (status === 'sold') {
    const sold = await require('../market/soldCleanup').purgeSold({ _id: listing._id });
    if (sold.deleted) return res.json({ _id: listing._id, status: 'deleted', deleted: true, message: 'Sold! 🎉 The ad has been removed from Kapu.' });
    return res.json({ _id: listing._id, status, deleted: false, message: 'Marked as sold. The ad is hidden and will be removed once the order in progress is complete.' });
  }
  res.json({ _id: listing._id, status });
});

// DELETE /api/market/listings/:id
exports.remove = asyncHandler(async (req, res) => {
  const listing = await ownListing(req);
  listing.images.forEach(removeListingImage);
  await listing.deleteOne();
  changed();
  catalog.refreshSoon(listing.product);
  res.json({ ok: true });
});

// GET /api/market/mine            every ad of mine
// GET /api/market/mine?count=1    { count }: how many ads I've ever posted (0 = selling for the first time)
exports.mine = asyncHandler(async (req, res) => {
  if (req.query.count === '1') return res.json({ count: await Listing.countDocuments({ seller: req.customer._id }) });
  const items = await Listing.find({ seller: req.customer._id }).sort({ createdAt: -1 }).limit(20000).select(`${CARD_FIELDS} views chats hiddenReason`).lean();
  res.json(items.map((item) => ({ ...card(item), views: item.views, chats: item.chats, hiddenReason: item.hiddenReason })));
});

// GET /api/market/mine/:id  (full ad for the edit form)
exports.mineOne = asyncHandler(async (req, res) => {
  const listing = await ownListing(req);
  res.json(listing);
});

// POST /api/market/listings/:id/report { reason }
exports.report = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const reason = clean(req.body.reason, 300);
  if (reason.length < 3) throw httpError('Please tell us what’s wrong with this ad');
  const result = await Listing.updateOne(
    { _id: req.params.id, 'reports.by': { $ne: req.customer._id } },
    { $push: { reports: { by: req.customer._id, reason } }, $inc: { reportCount: 1 } }
  );
  res.json({ ok: true, alreadyReported: result.modifiedCount === 0 });
});

// ---------------------------------------------------------------- buyer ↔ seller chat
const meIn = (conv, me) => (String(conv.buyer) === String(me) ? 'buyer' : String(conv.seller) === String(me) ? 'seller' : null);
const convView = (order, me) => {
  const role = meIn(order, me);
  return {
    _id: order._id,
    role,
    listing: { _id: order.listing, title: order.listingTitle, slug: order.listingSlug, image: order.listingImage, price: order.listingPrice, category: order.listingCategory },
    other: role === 'buyer' ? { _id: order.seller, name: order.sellerName } : { _id: order.buyer, name: order.buyerName },
    lastMessage: order.lastMessage,
    unread: role === 'buyer' ? order.unreadBuyer : order.unreadSeller,
    updatedAt: order.updatedAt,
  };
};
const msgView = (match) => ({
  _id: match._id, from: match.from, text: match.text, at: match.createdAt,
  ...(match.kind && match.kind !== 'text' ? { kind: match.kind } : {}),
  ...(match.offer ? { offer: match.offer } : {}),
  ...(match.visitAt ? { visitAt: match.visitAt, visitStatus: match.visitStatus } : {}),
  ...(match.flag ? { flag: match.flag } : {}),
});

// Messages that ask for money up front are how most marketplace scams start: flag them so the other person sees a warning
const MONEY_RX = /\b(deposit|advance|upfront|up front|booking fee|commitment fee|transport fee|clearance fee|send (me )?(the )?(money|cash|pesa)|tuma (pesa|doo|mkwanja|deposit)|pay (first|before|upfront|in advance)|lipa (kwanza|deposit)|western union|paybill|till (number|no)|buy goods|send (it )?to (this|my) (number|no))\b/i;
const PHONE_RX = /(\+?254|0)\s?[17]\d{2}\s?\d{3}\s?\d{3}/;
const looksLikeScam = (text) => MONEY_RX.test(text) || (PHONE_RX.test(text) && /\b(m-?pesa|send|tuma|pay|lipa)\b/i.test(text));

async function addMessage(conv, me, text, extra = {}) {
  const role = meIn(conv, me._id);
  const flag = (!extra.kind || extra.kind === 'text') && looksLikeScam(text) ? 'money' : undefined;
  const msg = await ChatMessage.create({ conversation: conv._id, from: me._id, text, ...extra, ...(flag ? { flag } : {}) });
  const inc = role === 'buyer' ? { unreadSeller: 1 } : { unreadBuyer: 1 };
  if (flag) inc.flagged = 1;
  const set = { lastMessage: { text: text.slice(0, 140), from: me._id, at: msg.createdAt } };
  if (role === 'seller' && !conv.sellerRepliedAt) set.sellerRepliedAt = msg.createdAt; // response time
  const updated = await Conversation.findByIdAndUpdate(conv._id, { $set: set, $inc: inc }, { returnDocument: 'after' }).lean();
  // live delivery to both people (all their open tabs and phones)
  for (const who of [updated.buyer, updated.seller]) {
    emitCustomer(String(who), 'market:message', { conversation: convView(updated, who), message: msgView(msg) });
  }
  return { msg, conv: updated };
}
exports.addMessage = addMessage;

// The chat between this buyer and the seller of this ad (created on first contact)
async function ensureConversation(order, buyer, firstText) {
  let conv = await Conversation.findOne({ listing: order._id, buyer: buyer._id });
  if (conv) return { conv, isNew: false };
  const seller = await Customer.findById(order.seller).select('name email').lean();
  try {
    conv = await Conversation.create({
      listing: order._id, listingTitle: order.title, listingSlug: order.slug, listingImage: order.images?.[0] || '', listingPrice: order.price, listingCategory: order.category,
      buyer: buyer._id, seller: order.seller, buyerName: buyer.name, sellerName: seller?.name || order.sellerName,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    return { conv: await Conversation.findOne({ listing: order._id, buyer: buyer._id }), isNew: false }; // started twice at once
  }
  Listing.updateOne({ _id: order._id }, { $inc: { chats: 1 } }).catch(() => {});
  // the seller may not be online: let them know by email about a new interested buyer
  if (seller?.email && !/\.test$/i.test(seller.email)) sendMail({ to: seller.email, ...templates.newMarketChat(seller, buyer.name, order, firstText, conv._id) });
  return { conv, isNew: true };
}
exports.ensureConversation = ensureConversation;

async function contactableListing(listingId, me) {
  if (!isId(listingId)) throw httpError('Ad not found', 404);
  const listing = await Listing.findById(listingId).lean();
  if (!listing || listing.status === 'hidden') throw httpError('This ad is no longer available', 404);
  if (String(listing.seller) === String(me._id)) throw httpError('This is your own ad');
  return listing;
}
exports.contactableListing = contactableListing;

// POST /api/market/conversations { listingId, text }  (start a chat about an ad, or continue the existing one)
exports.startChat = asyncHandler(async (req, res) => {
  const text = cleanText(req.body.text, 2000);
  if (!text) throw httpError('Please type a message');
  const listing = await contactableListing(req.body.listingId, req.customer);
  const { conv, isNew } = await ensureConversation(listing, req.customer, text);
  const { msg, conv: updated } = await addMessage(conv, req.customer, text);
  res.status(isNew ? 201 : 200).json({ conversation: convView(updated, req.customer._id), message: msgView(msg) });
});

// GET /api/market/conversations
exports.conversations = asyncHandler(async (req, res) => {
  const me = req.customer._id;
  const list = await Conversation.find({ $or: [{ buyer: me }, { seller: me }], lastMessage: { $exists: true } }).sort({ updatedAt: -1 }).limit(200).lean();
  res.json(list.map((item) => convView(item, me)));
});

// GET /api/market/conversations/unread  (badge count)
exports.unread = asyncHandler(async (req, res) => {
  const me = req.customer._id;
  const [result] = await Conversation.aggregate([
    { $match: { $or: [{ buyer: me }, { seller: me }] } },
    { $group: { _id: null, n: { $sum: { $cond: [{ $eq: ['$buyer', me] }, '$unreadBuyer', '$unreadSeller'] } } } },
  ]);
  res.json({ unread: result?.n || 0 });
});

async function myConversation(req, id = req.params.id) {
  if (!isId(id)) throw httpError('Conversation not found', 404);
  const conversation = await Conversation.findById(id);
  if (!conversation || !meIn(conversation, req.customer._id)) throw httpError('Conversation not found', 404);
  return conversation;
}

// GET /api/market/conversations/:id/messages  (also marks them read)
exports.messages = asyncHandler(async (req, res) => {
  const conversation = await myConversation(req);
  const role = meIn(conversation, req.customer._id);
  // the newest messages (a page of 100); ?before=<message id> loads the page before it ("Load earlier messages")
  const PAGE = 100;
  const before = isId(req.query.before) ? await ChatMessage.findOne({ _id: req.query.before, conversation: conversation._id }).select('createdAt').lean() : null;
  const newestFirst = await ChatMessage.find({ conversation: conversation._id, ...(before ? { createdAt: { $lt: before.createdAt } } : {}) }).sort({ createdAt: -1 }).limit(PAGE + 1).lean();
  const hasMore = newestFirst.length > PAGE;
  const msgs = newestFirst.slice(0, PAGE).reverse();
  const field = role === 'buyer' ? 'unreadBuyer' : 'unreadSeller';
  if (conversation[field]) {
    conversation[field] = 0;
    await conversation.save();
    emitCustomer(String(req.customer._id), 'market:read', { conversation: String(conversation._id) });
  }
  const listing = await Listing.findById(conversation.listing).select('status price slug buyNow stock category sub layaway delivery area county').lean();
  // the latest state of every offer in this chat (offer cards show it)
  const offerIds = [...new Set(msgs.filter((msg) => msg.offer).map((item) => String(item.offer)))];
  const offers = offerIds.length ? await require('../models/Offer').find({ _id: { $in: offerIds } }).lean() : [];
  res.json({
    conversation: convView(conversation.toObject(), req.customer._id),
    listing: listing ? { status: listing.status === 'hidden' ? 'removed' : listing.status, price: listing.price, slug: listing.slug, buyNow: !!listing.buyNow, canBuyOnline: require('./orderController').canBuyNow(listing.category, listing.sub), stock: listing.stock, category: listing.category, sub: listing.sub, delivery: listing.delivery, area: listing.area, county: listing.county } : null,
    listingStatus: listing?.status === 'hidden' ? 'removed' : listing?.status || 'removed',
    messages: msgs.map(msgView), hasMore,
    offers: Object.fromEntries(offers.map((offer) => [String(offer._id), require('./offerController').offerView(offer)])),
  });
});

// POST /api/market/conversations/:id/messages { text }
exports.send = asyncHandler(async (req, res) => {
  const conversation = await myConversation(req);
  const text = cleanText(req.body.text, 2000);
  if (!text) throw httpError('Please type a message');
  const { msg, conv } = await addMessage(conversation, req.customer, text);
  res.status(201).json({ conversation: convView(conv, req.customer._id), message: msgView(msg) });
});

// POST /api/market/conversations/:id/read
exports.markRead = asyncHandler(async (req, res) => {
  const conversation = await myConversation(req);
  const field = meIn(conversation, req.customer._id) === 'buyer' ? 'unreadBuyer' : 'unreadSeller';
  if (conversation[field]) {
    conversation[field] = 0;
    await conversation.save();
  }
  emitCustomer(String(req.customer._id), 'market:read', { conversation: String(conversation._id) });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- site visits (land, houses, vehicles…)
// POST /api/market/visits { listingId, at, note }  (buyer asks to view the item / the plot on a day and time)
exports.requestVisit = asyncHandler(async (req, res) => {
  const listing = await contactableListing(req.body.listingId, req.customer);
  const at = new Date(req.body.at);
  if (Number.isNaN(at.getTime()) || at < new Date(Date.now() + 30 * 60000) || at > new Date(Date.now() + 60 * 86400000)) {
    throw httpError('Please pick a date and time from later today up to 60 days ahead');
  }
  const note = cleanText(req.body.note, 300);
  const when = at.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  const text = `📅 Site visit request: ${when}${note ? `\n${note}` : ''}`;
  const { conv } = await ensureConversation(listing, req.customer, text);
  const { msg, conv: updated } = await addMessage(conv, req.customer, text, { kind: 'visit', visitAt: at, visitStatus: 'requested' });
  res.status(201).json({ conversation: convView(updated, req.customer._id), message: msgView(msg) });
});

// POST /api/market/visits/:messageId { action: 'confirm' | 'decline' }  (the seller answers)
exports.answerVisit = asyncHandler(async (req, res) => {
  if (!isId(req.params.messageId)) throw httpError('Request not found', 404);
  const chatMessage = await ChatMessage.findById(req.params.messageId);
  if (!chatMessage || chatMessage.kind !== 'visit') throw httpError('Request not found', 404);
  const conversation = await myConversation(req, chatMessage.conversation);
  if (meIn(conversation, req.customer._id) !== 'seller') throw httpError('Only the seller can answer a visit request', 403);
  if (chatMessage.visitStatus !== 'requested') throw httpError('This request was already answered');
  const ok = req.body.action === 'confirm';
  chatMessage.visitStatus = ok ? 'confirmed' : 'declined';
  await chatMessage.save();
  const when = chatMessage.visitAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  const text = ok ? `✅ Visit confirmed for ${when}. See you there!` : `❌ ${when} doesn't work. Please suggest another time.`;
  const addMessageResult = await addMessage(conversation, req.customer, text, { kind: 'system' });
  res.json({ message: msgView(addMessageResult.msg), visitStatus: chatMessage.visitStatus });
});

// ---------------------------------------------------------------- staff moderation
// GET /api/market/admin/listings?q=&status=&reported=1&page=
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (['active', 'sold', 'hidden'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.reported === '1') filter.reportCount = { $gt: 0 };
  const query = clean(req.query.q, 80);
  if (query) Object.assign(filter, search.wordFilter(query, 'all').filter);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const sort = req.query.reported === '1' ? { reportCount: -1, createdAt: -1 } : { createdAt: -1 };
  const [items, total, stats] = await Promise.all([
    Listing.find(filter).sort(sort).skip((page - 1) * 50).limit(50).select(`${CARD_FIELDS} sellerName seller views chats reportCount reports hiddenReason`).lean(),
    Listing.countDocuments(filter),
    cached('admin:listing-stats', 30000, () => Listing.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])),
  ]);
  const [sellerRows, chats, reported] = await Promise.all([
    cached('admin:listing-sellers', 60000, () => Listing.aggregate([{ $group: { _id: '$seller' } }, { $count: 'n' }])),
    cached('admin:chats', 60000, () => Conversation.estimatedDocumentCount()),
    Listing.countDocuments({ reportCount: { $gt: 0 }, status: { $ne: 'hidden' } }),
  ]);
  const sellers = { length: sellerRows[0]?.n || 0 }; // only the count is shown
  res.json({
    items: items.map((item) => ({ ...card(item), sellerName: item.sellerName, seller: item.seller, views: item.views, chats: item.chats, reportCount: item.reportCount, reports: (item.reports || []).slice(-5).map((element) => ({ reason: element.reason, at: element.at })), hiddenReason: item.hiddenReason })),
    total,
    pages: Math.max(1, Math.ceil(total / 50)),
    stats: { ...Object.fromEntries(stats.map((stat) => [stat._id, stat.n])), sellers: sellers.length, chats, reported },
  });
});

// PATCH /api/market/admin/listings/:id { status: 'hidden' | 'active', reason, clearReports }
exports.adminSetStatus = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const listing = await Listing.findById(req.params.id);
  if (!listing) throw httpError('Ad not found', 404);
  if (req.body.status === 'hidden') {
    listing.status = 'hidden';
    listing.hiddenReason = clean(req.body.reason, 200) || 'Against the marketplace rules';
  } else if (req.body.status === 'active') {
    listing.status = 'active';
    listing.hiddenReason = '';
  }
  if (req.body.clearReports) {
    listing.reports = [];
    listing.reportCount = 0;
  }
  await listing.save();
  changed();
  res.json({ _id: listing._id, status: listing.status, reportCount: listing.reportCount });
});

// DELETE /api/market/admin/listings/:id
exports.adminRemove = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Ad not found', 404);
  const listing = await Listing.findById(req.params.id);
  if (!listing) throw httpError('Ad not found', 404);
  listing.images.forEach(removeListingImage);
  await listing.deleteOne();
  changed();
  res.json({ ok: true });
});

exports.card = card;
exports.CARD_FIELDS = CARD_FIELDS;
