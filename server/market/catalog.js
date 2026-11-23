// Our product catalogue (models/Product.js): one product, many seller listings at different prices.
//   productKey   what makes two ads the same product: category + type + brand + model (+ storage / size), or,
//                without a brand and model, the meaningful words of the title (order and filler words ignored)
//   link         puts a listing on its product (the one the seller picked from the suggestions, or the one with
//                its key — made once, the unique key means no duplicates even when two sellers post at once)
//   refresh      recounts a product's live offers, sellers and price range from its listings
// Only things sold as products are catalogued (not land, houses, cars, jobs or services: each of those is unique).
const Product = require('../models/Product');
const { getSub } = require('./categories');

const NOT_PRODUCTS = new Set(['land-property', 'vehicles', 'jobs']);
const FILLER = new Set(['new', 'brand', 'original', 'genuine', 'quality', 'best', 'cheap', 'cheapest', 'offer', 'offers', 'sale', 'deal', 'deals', 'hot', 'free', 'delivery', 'available', 'stock', 'in', 'for', 'the', 'a', 'an', 'and', 'with', 'of', 'at', 'on', 'kenya', 'nairobi', 'price', 'ksh', 'kes', 'only', 'now', 'buy', 'used', 'ex', 'uk', 'exuk', 'mint', 'condition', 'clean', 'sealed', 'box', 'boxed', 'wholesale', 'retail', 'pcs', 'piece', 'pieces']);
const norm = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (text) => [...new Set(norm(text).split(' ').filter((word) => word && !FILLER.has(word)))];

const catalogable = (listing) => !NOT_PRODUCTS.has(listing.category) && listing.sub !== 'services' && !!getSub(listing.category, listing.sub);

function productKey(listing) {
  const attrs = listing.attrs || {};
  const brand = norm(attrs.brand || attrs.make);
  const model = norm(attrs.model);
  const spec = norm(attrs.storage || attrs.size || attrs.pack || '');
  const base = `${listing.category}|${listing.sub}`;
  if (brand && model) return `${base}|${brand}|${model}${spec ? `|${spec}` : ''}`;
  const titleWords = words(listing.title).sort();
  return titleWords.length ? `${base}|t:${titleWords.join(' ')}` : null;
}
const productName = (listing) => {
  const attrs = listing.attrs || {};
  const brand = attrs.brand || attrs.make;
  return brand && attrs.model ? [brand, attrs.model, attrs.storage || attrs.size || attrs.pack].filter(Boolean).join(' ').slice(0, 90) : String(listing.title).slice(0, 90);
};

// listing.product = its product (or nothing, for things that aren't products). Doesn't save the listing.
async function link(listing, chosenId) {
  if (!catalogable(listing)) {
    listing.product = undefined;
    return null;
  }
  if (chosenId && /^[a-f0-9]{24}$/i.test(String(chosenId))) {
    const chosen = await Product.findOne({ _id: chosenId, key: { $type: 'string' }, category: listing.category, sub: listing.sub }).select('_id').lean();
    if (chosen) {
      listing.product = chosen._id;
      return chosen._id;
    }
  }
  const key = productKey(listing);
  if (!key) {
    listing.product = undefined;
    return null;
  }
  const attrs = listing.attrs || {};
  const insert = { key, name: productName(listing), category: listing.category, sub: listing.sub, brand: String(attrs.brand || attrs.make || '').slice(0, 60), model: String(attrs.model || '').slice(0, 60), image: listing.images?.[0] || '' };
  let product;
  try {
    product = await Product.findOneAndUpdate({ key }, { $setOnInsert: insert }, { upsert: true, returnDocument: 'after' }).select('_id').lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    product = await Product.findOne({ key }).select('_id').lean(); // made at the same moment by another seller
  }
  listing.product = product._id;
  return product._id;
}

// recount live offers / sellers / prices (after an ad is posted, edited, sold out, deleted…)
async function refresh(ids) {
  const Listing = require('../models/Listing');
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String))].filter((id) => /^[a-f0-9]{24}$/i.test(id));
  if (!list.length) return;
  const { ObjectId } = require('mongoose').Types;
  // one aggregate for every product, then one bulk write
  const rows = await Listing.aggregate([
      { $match: { product: { $in: list.map((id) => new ObjectId(id)) }, status: 'active' } },
      { $group: { _id: '$product', offers: { $sum: 1 }, sellers: { $addToSet: '$seller' }, minPrice: { $min: { $cond: [{ $gt: ['$price', 0] }, '$price', null] } }, maxPrice: { $max: '$price' }, image: { $first: { $arrayElemAt: ['$images', 0] } } } },
  ]);
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const ops = list.flatMap((id) => {
    const row = byId.get(id);
    const set = row ? { offers: row.offers, sellers: row.sellers.length, minPrice: row.minPrice || 0, maxPrice: row.maxPrice || 0 } : { offers: 0, sellers: 0, minPrice: 0, maxPrice: 0 };
    return [{ updateOne: { filter: { _id: id }, update: { $set: set } } }, ...(row?.image ? [{ updateOne: { filter: { _id: id, image: '' }, update: { $set: { image: row.image } } } }] : [])];
  });
  await Product.bulkWrite(ops, { ordered: false });
}
const refreshSoon = (ids) => { refresh(ids).catch((error) => console.error('Catalogue:', error.message)); };

// the products a seller may mean while typing a title (upload form suggestions)
async function suggest(text, { category, sub } = {}) {
  const query = words(text);
  if (!query.length) return [];
  const filter = { key: { $type: 'string' }, $and: query.slice(0, 5).map((word) => ({ name: new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })) };
  if (category) filter.category = category;
  if (sub) filter.sub = sub;
  return Product.find(filter).sort({ offers: -1, updatedAt: -1 }).limit(8).lean();
}

const view = (product) => ({ _id: product._id, name: product.name, category: product.category, sub: product.sub, brand: product.brand || '', model: product.model || '', image: product.image || '', offers: product.offers || 0, sellers: product.sellers || 0, minPrice: product.minPrice || 0, maxPrice: product.maxPrice || 0 });

// listings from before the catalogue: put each on its product (start-up; a batch at a time)
async function backfill(limit = 5000) {
  const Listing = require('../models/Listing');
  const loose = await Listing.find({ product: { $exists: false }, category: { $nin: [...NOT_PRODUCTS] }, sub: { $ne: 'services' } }).limit(limit).select('title category sub attrs images');
  const touched = new Set();
  const byKey = new Map(); // one product lookup per product, not per listing
  const ops = [];
  for (const listing of loose) {
    const key = catalogable(listing) ? productKey(listing) : null;
    let id = key ? byKey.get(key) : null;
    if (!id) {
      id = await link(listing);
      if (key && id) byKey.set(key, id);
    }
    if (!id) continue;
    ops.push({ updateOne: { filter: { _id: listing._id }, update: { $set: { product: id } } } });
    touched.add(String(id));
  }
  if (ops.length) await Listing.bulkWrite(ops, { ordered: false }); // one write for all of them
  await refresh([...touched]);
  return loose.length;
}

module.exports = { catalogable, productKey, productName, link, refresh, refreshSoon, suggest, view, backfill, words };
