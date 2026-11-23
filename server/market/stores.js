// A seller's stores and branches (models/Store.js).
//   main store   mirrors the seller's shop location (Customer.shopLocation), which the "near me" pages, riders and
//                checkout already use; it's created from it the first time it's needed (or at start-up).
//   branches     have their own address and pin; their ads are found near the branch.
// Every listing belongs to one store (Listing.store); a seller can't delete a store that still has ads or open deliveries.
const Store = require('../models/Store');
const Customer = require('../models/Customer');
const httpError = require('../utils/httpError');

const MAX_STORES = 20;
const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));

const mainFields = (customer) => {
  const shop = customer.shopLocation || {};
  return {
    name: shop.name || 'Main store', area: shop.area || '', county: shop.county || customer.county || '', address: shop.address || shop.area || '',
    phone: customer.phone || '', point: shop.point?.coordinates ? shop.point : undefined, public: !!shop.public,
  };
};
const hasShop = (customer) => !!(customer?.shopLocation?.area || customer?.shopLocation?.point?.coordinates);

// the seller's main store (made from their shop location when there isn't one yet); null when they have no shop yet
async function ensureMain(sellerId) {
  const found = await Store.findOne({ seller: sellerId, isMain: true });
  if (found) return found;
  const customer = await Customer.findById(sellerId).select('name phone county shopLocation').lean();
  if (!hasShop(customer)) return null;
  const fields = mainFields(customer);
  for (const name of [fields.name, `${fields.name} (main)`, `${customer.name} main store`]) {
    try {
      return await Store.create({ ...fields, name, seller: sellerId, isMain: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const raced = await Store.findOne({ seller: sellerId, isMain: true });
      if (raced) return raced; // made at the same moment by another request
      // else: a branch already has that name; try the next one
    }
  }
  return null;
}

// the seller's shop location changed (My account → Shop location): the main store follows
async function syncMainFromShop(customer) {
  if (!hasShop(customer)) return Store.updateOne({ seller: customer._id, isMain: true }, { $set: { public: false }, $unset: { point: 1 } });
  const main = await ensureMain(customer._id);
  if (!main) return null;
  const fields = mainFields(customer);
  if (!customer.shopLocation?.name) delete fields.name; // keep the store's own name
  Object.assign(main, fields);
  if (!fields.point) main.point = undefined;
  try {
    await main.save();
  } catch (error) {
    if (error.code !== 11000) throw error;
    delete fields.name; // a branch has that name: keep the old one
    await Store.updateOne({ _id: main._id }, { $set: { ...fields } });
  }
  return main;
}

// the main store was edited in the Seller hub: the shop location follows (so "near me", riders and checkout agree)
async function syncShopFromMain(store) {
  const set = { 'shopLocation.name': store.name, 'shopLocation.area': store.area, 'shopLocation.county': store.county, 'shopLocation.address': store.address, 'shopLocation.public': !!store.public, 'shopLocation.updatedAt': new Date() };
  if (store.point?.coordinates) set['shopLocation.point'] = store.point;
  await Customer.updateOne({ _id: store.seller }, { $set: set });
}

// the store a listing goes in: the one chosen (must be the seller's, and open), else the main store
async function resolve(sellerId, storeId) {
  if (storeId) {
    if (!isId(storeId)) throw httpError('Choose one of your stores');
    const store = await Store.findOne({ _id: storeId, seller: sellerId, active: true });
    if (!store) throw httpError('Choose one of your stores (that store is closed or isn’t yours)');
    return store;
  }
  return ensureMain(sellerId);
}

// an ad is found "near me" at its store's pin, when the pin is public and in the ad's county
const pinFor = (store, county) => (store?.public && store.point?.coordinates && store.county && store.county === county ? store.point : null);

// a branch's pin moved: its ads move with it
async function syncBranchAds(store) {
  const Listing = require('../models/Listing');
  const pin = store.active && store.public && store.point?.coordinates ? store.point : null;
  if (pin && store.county) {
    await Listing.updateMany({ store: store._id, county: store.county }, { $set: { geo: pin } });
    await Listing.updateMany({ store: store._id, county: { $ne: store.county } }, { $unset: { geo: 1 } });
  } else await Listing.updateMany({ store: store._id }, { $unset: { geo: 1 } });
}

const view = (store, counts = {}) => ({
  _id: store._id, name: store.name, area: store.area || '', county: store.county || '', address: store.address || '', phone: store.phone || '', hours: store.hours || '',
  lat: store.point?.coordinates?.[1] ?? null, lng: store.point?.coordinates?.[0] ?? null, public: !!store.public, isMain: !!store.isMain, active: store.active !== false,
  listings: counts.listings || 0, units: counts.units || 0, lowStock: counts.low || 0, openDeliveries: counts.deliveries || 0,
});
// what buyers see of a store
const publicView = (store) => ({ _id: store._id, name: store.name, area: store.area || '', county: store.county || '', address: store.address || '', hours: store.hours || '', isMain: !!store.isMain, ...(store.public && store.point?.coordinates ? { lat: store.point.coordinates[1], lng: store.point.coordinates[0] } : {}) });

// every seller with a shop location gets their main store; listings without a store go in it (start-up, idempotent)
async function backfill() {
  const Listing = require('../models/Listing');
  let stores = 0;
  let listings = 0;
  const sellers = await Customer.find({ $or: [{ 'shopLocation.area': { $exists: true, $ne: '' } }, { 'shopLocation.point': { $exists: true } }] }).select('_id').lean();
  const withMain = new Set((await Store.find({ isMain: true }).select('seller').lean()).map((store) => String(store.seller)));
  for (const seller of sellers) {
    if (withMain.has(String(seller._id))) continue;
    if (await ensureMain(seller._id)) stores += 1;
  }
  const loose = await Listing.distinct('seller', { store: { $exists: false } });
  const mains = loose.length ? await Store.find({ seller: { $in: loose }, isMain: true }).select('_id seller').lean() : []; // one read
  if (mains.length) {
    const result = await Listing.bulkWrite(mains.map((main) => ({ updateMany: { filter: { seller: main.seller, store: { $exists: false } }, update: { $set: { store: main._id } } } })), { ordered: false });
    listings += result.modifiedCount;
  }
  return { stores, listings };
}

module.exports = { ensureMain, syncMainFromShop, syncShopFromMain, resolve, pinFor, syncBranchAds, view, publicView, backfill, MAX_STORES };
