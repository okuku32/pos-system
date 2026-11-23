// Seller hub: stores & branches, inventory, sales and earnings (one seller's own data only).
//   stores      GET/POST /api/seller/stores · PUT /:id · POST /:id/main · POST /:id/close { moveTo }
//   inventory   GET /api/seller/inventory?store=&q=&filter=low|out · PATCH /:listingId { stock | add | store | price }
//   overview    GET /api/seller/overview?days=30  (orders, sales, earnings, payouts, best sellers, stock alerts)
//   daily       GET /api/seller/daily?date=YYYY-MM-DD  (one day's orders and sales, the day before, the last 14 days)
const mongoose = require('mongoose');
const Store = require('../models/Store');
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const Delivery = require('../models/Delivery');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { invalidate } = require('../utils/cache');
const { COUNTIES } = require('../market/categories');
const geo = require('../market/geo');
const stores = require('../market/stores');
const catalog = require('../market/catalog');

const LOW_STOCK = 3;
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value) && /^[a-f0-9]{24}$/i.test(String(value));
const OPEN = ['placed', 'confirmed', 'shipped'];

// ---------------------------------------------------------------- stores
function storeFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = clean(body.name, 80);
    if (out.name.length < 2) throw httpError('Give the store a name (e.g. “Gikomba branch”)');
  }
  if (!partial || body.county !== undefined) {
    out.county = clean(body.county, 40);
    if (!COUNTIES.includes(out.county)) throw httpError('Choose the county the store is in');
  }
  if (!partial || body.area !== undefined) {
    out.area = clean(body.area, 60);
    if (out.area.length < 2) throw httpError('Enter the town or area (e.g. Gikomba, Kawangware)');
  }
  if (body.address !== undefined) out.address = clean(body.address, 200);
  if (body.phone !== undefined) out.phone = clean(body.phone, 20);
  if (body.hours !== undefined) out.hours = clean(body.hours, 80);
  if (body.public !== undefined) out.public = body.public !== false && body.public !== 'false';
  if (body.lat !== undefined || body.lng !== undefined) {
    if (body.lat === null || body.lat === '') out.point = null;
    else {
      const point = geo.toPoint(body.lat, body.lng);
      if (!point) throw httpError('The pin must be in Kenya');
      out.point = point;
    }
  }
  return out;
}
const duplicateName = (error) => error.code === 11000 && /nameKey/.test(error.message);

async function countsFor(sellerId) {
  const [listings, deliveries] = await Promise.all([
    Listing.aggregate([
      { $match: { seller: new mongoose.Types.ObjectId(String(sellerId)), status: 'active' } },
      { $group: { _id: '$store', listings: { $sum: 1 }, units: { $sum: { $cond: ['$buyNow', '$stock', 0] } }, low: { $sum: { $cond: [{ $and: ['$buyNow', { $lte: ['$stock', LOW_STOCK] }] }, 1, 0] } } } },
    ]),
    Delivery.aggregate([{ $match: { seller: new mongoose.Types.ObjectId(String(sellerId)), status: { $nin: ['delivered', 'cancelled'] } } }, { $group: { _id: '$store', deliveries: { $sum: 1 } } }]),
  ]);
  const map = new Map(listings.map((row) => [String(row._id), row]));
  for (const row of deliveries) map.set(String(row._id), { ...(map.get(String(row._id)) || {}), deliveries: row.deliveries });
  return map;
}

// GET /api/seller/stores
exports.stores = asyncHandler(async (req, res) => {
  await stores.ensureMain(req.customer._id);
  const [list, counts] = await Promise.all([Store.find({ seller: req.customer._id }).sort({ active: -1, isMain: -1, name: 1 }).lean(), countsFor(req.customer._id)]);
  res.json({ stores: list.map((store) => stores.view(store, counts.get(String(store._id)))), max: stores.MAX_STORES });
});

// POST /api/seller/stores
exports.createStore = asyncHandler(async (req, res) => {
  const fields = storeFields(req.body || {});
  if ((await Store.countDocuments({ seller: req.customer._id, active: true })) >= stores.MAX_STORES) throw httpError(`You can have up to ${stores.MAX_STORES} stores`);
  const hasMain = !!(await stores.ensureMain(req.customer._id));
  let store;
  try {
    store = await Store.create({ ...fields, point: fields.point || undefined, phone: fields.phone || req.customer.phone || '', seller: req.customer._id, isMain: !hasMain });
  } catch (error) {
    if (duplicateName(error)) throw httpError('You already have a store with that name', 409);
    throw error;
  }
  if (store.isMain) await stores.syncShopFromMain(store); // their first store is their shop
  res.status(201).json(stores.view(store));
});

async function myStore(req) {
  if (!isId(req.params.id)) throw httpError('Store not found', 404);
  const store = await Store.findOne({ _id: req.params.id, seller: req.customer._id });
  if (!store) throw httpError('Store not found', 404);
  return store;
}
async function afterPinChange(store, customerId) {
  if (store.isMain) {
    await stores.syncShopFromMain(store);
    const customer = await require('../models/Customer').findById(customerId).select('shopLocation');
    await geo.syncSellerAds(Listing, customer);
  } else await stores.syncBranchAds(store);
  invalidate('market:');
}

// PUT /api/seller/stores/:id
exports.updateStore = asyncHandler(async (req, res) => {
  const store = await myStore(req);
  if (!store.active) throw httpError('This store is closed', 409);
  const fields = storeFields(req.body || {}, { partial: true });
  Object.assign(store, fields);
  if (fields.point === null) store.point = undefined;
  try {
    await store.save();
  } catch (error) {
    if (duplicateName(error)) throw httpError('You already have a store with that name', 409);
    throw error;
  }
  await afterPinChange(store, req.customer._id);
  const counts = await countsFor(req.customer._id);
  res.json(stores.view(store, counts.get(String(store._id))));
});

// POST /api/seller/stores/:id/main  (this store becomes the main one: the shop on the map, riders' default pickup)
exports.makeMain = asyncHandler(async (req, res) => {
  const store = await myStore(req);
  if (!store.active) throw httpError('Open the store first', 409);
  if (store.isMain) return res.json(stores.view(store));
  const old = await Store.findOne({ seller: req.customer._id, isMain: true });
  if (old) await Store.updateOne({ _id: old._id }, { $set: { isMain: false } }); // first, so there's never two main stores
  store.isMain = true;
  await store.save();
  await afterPinChange(store, req.customer._id);
  if (old) await stores.syncBranchAds({ ...old.toObject(), isMain: false });
  res.json(stores.view(store));
});

// POST /api/seller/stores/:id/close { moveTo }  (closed, not deleted: past orders and deliveries still point at it)
exports.closeStore = asyncHandler(async (req, res) => {
  const store = await myStore(req);
  if (store.isMain) throw httpError('Make another store the main one first', 409);
  if (!store.active) return res.json(stores.view(store));
  const openOrders = await Order.countDocuments({ seller: req.customer._id, 'items.store': store._id, status: { $in: OPEN } });
  if (openOrders) throw httpError(`${store.name} has ${openOrders} order${openOrders === 1 ? '' : 's'} in progress. Finish ${openOrders === 1 ? 'it' : 'them'} first.`, 409);
  const ads = await Listing.countDocuments({ store: store._id, status: { $ne: 'hidden' } });
  if (ads) {
    if (!req.body?.moveTo) throw httpError(`Move its ${ads} ad${ads === 1 ? '' : 's'} to another store first (choose where)`, 409);
    const target = await stores.resolve(req.customer._id, req.body.moveTo);
    if (!target || String(target._id) === String(store._id)) throw httpError('Choose another of your stores');
    await Listing.updateMany({ store: store._id }, { $set: { store: target._id } });
    await afterPinChange(target, req.customer._id);
  }
  store.active = false;
  await store.save();
  await stores.syncBranchAds(store);
  res.json({ ...stores.view(store), moved: ads });
});

// ---------------------------------------------------------------- inventory
const itemView = (item, storeMap, productMap) => {
  const store = storeMap.get(String(item.store));
  const product = productMap.get(String(item.product));
  return {
    _id: item._id, slug: item.slug, title: item.title, image: item.images?.[0] || '', price: item.price, stock: item.stock || 0, status: item.status, buyNow: !!item.buyNow,
    soldCount: item.soldCount || 0, views: item.views || 0, category: item.category, low: !!item.buyNow && item.status === 'active' && item.stock <= LOW_STOCK,
    store: store ? { _id: store._id, name: store.name } : null,
    // other sellers of the same product: how this price compares
    product: product ? { _id: product._id, offers: product.offers, sellers: product.sellers, minPrice: product.minPrice, maxPrice: product.maxPrice } : null,
  };
};

// GET /api/seller/inventory?store=&q=&filter=low|out|online&page=
exports.inventory = asyncHandler(async (req, res) => {
  const filter = { seller: req.customer._id, status: { $ne: 'hidden' } };
  if (req.query.store === 'none') filter.store = { $exists: false };
  else if (isId(req.query.store)) filter.store = req.query.store;
  if (req.query.filter === 'low') Object.assign(filter, { buyNow: true, status: 'active', stock: { $lte: LOW_STOCK } });
  if (req.query.filter === 'out') Object.assign(filter, { buyNow: true, stock: 0 });
  if (req.query.filter === 'online') filter.buyNow = true;
  const text = clean(req.query.q, 60);
  if (text) filter.title = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const page = Math.max(1, Math.min(50, parseInt(req.query.page, 10) || 1));
  const [list, total, summary] = await Promise.all([
    Listing.find(filter).sort({ buyNow: -1, stock: 1, updatedAt: -1 }).skip((page - 1) * 50).limit(50).select('slug title images price stock status buyNow soldCount views category store product').lean(),
    Listing.countDocuments(filter),
    Listing.aggregate([
      { $match: { seller: req.customer._id, status: { $ne: 'hidden' } } },
      { $group: { _id: null, listings: { $sum: 1 }, online: { $sum: { $cond: ['$buyNow', 1, 0] } }, units: { $sum: { $cond: [{ $and: ['$buyNow', { $eq: ['$status', 'active'] }] }, '$stock', 0] } }, value: { $sum: { $cond: [{ $and: ['$buyNow', { $eq: ['$status', 'active'] }] }, { $multiply: ['$stock', '$price'] }, 0] } }, low: { $sum: { $cond: [{ $and: ['$buyNow', { $eq: ['$status', 'active'] }, { $lte: ['$stock', LOW_STOCK] }] }, 1, 0] } }, out: { $sum: { $cond: [{ $and: ['$buyNow', { $eq: ['$stock', 0] }] }, 1, 0] } } } },
    ]),
  ]);
  const [storeList, productList] = await Promise.all([
    Store.find({ _id: { $in: list.map((item) => item.store).filter(Boolean) } }).select('name').lean(),
    require('../models/Product').find({ _id: { $in: list.map((item) => item.product).filter(Boolean) } }).lean(),
  ]);
  const storeMap = new Map(storeList.map((store) => [String(store._id), store]));
  const productMap = new Map(productList.map((product) => [String(product._id), product]));
  res.json({ items: list.map((item) => itemView(item, storeMap, productMap)), total, pages: Math.max(1, Math.ceil(total / 50)), summary: summary[0] || { listings: 0, online: 0, units: 0, value: 0, low: 0, out: 0 }, lowStock: LOW_STOCK });
});

// PATCH /api/seller/inventory/:id { stock } | { add } | { store } | { price }
exports.updateItem = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Item not found', 404);
  const listing = await Listing.findOne({ _id: req.params.id, seller: req.customer._id });
  if (!listing) throw httpError('Item not found', 404);
  if (listing.status === 'hidden') throw httpError('This ad was taken down by the marketplace team', 403);
  const body = req.body || {};
  if (body.add !== undefined || body.stock !== undefined) {
    if (!listing.buyNow) throw httpError('This ad isn’t sold online. Edit it and turn on “Sell online” to keep stock.');
    if (body.add !== undefined) {
      const add = Math.round(Number(body.add));
      if (!Number.isFinite(add) || add === 0 || Math.abs(add) > 100000) throw httpError('Enter how many units to add or remove');
      // atomic: never below zero, even when an order takes stock at the same moment
      const updated = await Listing.findOneAndUpdate({ _id: listing._id, stock: { $gte: Math.max(0, -add) } }, { $inc: { stock: add } }, { returnDocument: 'after' });
      if (!updated) throw httpError(`Only ${listing.stock} in stock: you can’t remove ${-add}`, 409);
      listing.stock = updated.stock;
    } else {
      const stock = Math.round(Number(body.stock));
      if (!(stock >= 0 && stock <= 100000)) throw httpError('Stock must be 0 or more');
      await Listing.updateOne({ _id: listing._id }, { $set: { stock } });
      listing.stock = stock;
    }
    const status = listing.stock > 0 && listing.status === 'sold' ? 'active' : listing.stock === 0 && listing.status === 'active' ? 'sold' : listing.status;
    if (status !== listing.status) await Listing.updateOne({ _id: listing._id }, { $set: { status } });
    listing.status = status;
  }
  if (body.price !== undefined) {
    const price = Math.round(Number(body.price));
    if (!(price >= 1 && price <= 10000000)) throw httpError('Enter a price in KSh (at least 1)');
    await Listing.updateOne({ _id: listing._id }, { $set: { price } });
    listing.price = price;
  }
  if (body.store !== undefined) {
    const store = await stores.resolve(req.customer._id, body.store);
    if (!store) throw httpError('Choose one of your stores');
    const pin = store.isMain ? geo.pinFor(await require('../models/Customer').findById(req.customer._id).select('shopLocation').lean(), listing.county) : stores.pinFor(store, listing.county);
    await Listing.updateOne({ _id: listing._id }, pin ? { $set: { store: store._id, geo: pin } } : { $set: { store: store._id }, $unset: { geo: 1 } });
    listing.store = store._id;
  }
  invalidate('market:');
  catalog.refreshSoon(listing.product);
  const fresh = await Listing.findById(listing._id).select('slug title images price stock status buyNow soldCount views category store product').lean();
  const [store, product] = await Promise.all([fresh.store ? Store.findById(fresh.store).select('name').lean() : null, fresh.product ? require('../models/Product').findById(fresh.product).lean() : null]);
  res.json(itemView(fresh, new Map(store ? [[String(store._id), store]] : []), new Map(product ? [[String(product._id), product]] : [])));
});

// ---------------------------------------------------------------- sales & earnings
// GET /api/seller/overview?days=30
exports.overview = asyncHandler(async (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = new Date(Date.now() - days * 864e5);
  const me = req.customer._id;
  const sellerAmount = require('./orderController').sellerAmount;
  const [byStatus, delivered, payouts, inventory, storeCount, open] = await Promise.all([
    Order.aggregate([{ $match: { seller: me, createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 }, value: { $sum: '$subtotal' } } }]),
    Order.find({ seller: me, status: 'delivered', updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(5000)
      .select('orderNo items subtotal total commission splitDeliveryFee inspection.fee verification.fee delivery.method rider.fee payOnDelivery payment.method payment.direct payout updatedAt buyerName').lean(),
    Order.aggregate([{ $match: { seller: me, 'payout.status': { $in: ['due', 'paid'] } } }, { $group: { _id: '$payout.status', amount: { $sum: '$payout.amount' }, n: { $sum: 1 } } }]),
    Listing.aggregate([{ $match: { seller: me, status: { $ne: 'hidden' }, buyNow: true } }, { $group: { _id: null, units: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, '$stock', 0] } }, low: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $lte: ['$stock', LOW_STOCK] }] }, 1, 0] } }, out: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } } } }]),
    Store.countDocuments({ seller: me, active: true }),
    Order.aggregate([{ $match: { seller: me, status: { $in: OPEN } } }, { $group: { _id: '$status', n: { $sum: 1 }, value: { $sum: '$subtotal' } } }]),
  ]);
  let gross = 0;
  let commission = 0;
  let deliveryCosts = 0;
  let net = 0;
  let cash = 0;
  const top = new Map();
  for (const order of delivered) {
    gross += order.subtotal || 0;
    commission += order.commission || 0;
    deliveryCosts += order.splitDeliveryFee || 0;
    net += sellerAmount(order);
    if (order.payment?.method === 'cod') cash += order.total || 0;
    for (const item of order.items || []) {
      const key = String(item.listing || item.title);
      const row = top.get(key) || { title: item.title, slug: item.slug, image: item.image, units: 0, revenue: 0 };
      row.units += item.qty || 0;
      row.revenue += item.subtotal || 0;
      top.set(key, row);
    }
  }
  const status = Object.fromEntries(byStatus.map((row) => [row._id, { orders: row.n, value: row.value }]));
  const pay = Object.fromEntries(payouts.map((row) => [row._id, { amount: row.amount, orders: row.n }]));
  res.json({
    days,
    orders: { total: byStatus.reduce((sum, row) => sum + (row._id === 'awaiting_payment' ? 0 : row.n), 0), byStatus: status, open: Object.fromEntries(open.map((row) => [row._id, { orders: row.n, value: row.value }])) },
    sales: { delivered: delivered.length, gross, commission, deliveryCosts, net, cashCollected: cash, average: delivered.length ? Math.round(gross / delivered.length) : 0 },
    payouts: { paid: pay.paid?.amount || 0, paidOrders: pay.paid?.orders || 0, due: pay.due?.amount || 0, dueOrders: pay.due?.orders || 0 },
    inventory: inventory[0] || { units: 0, low: 0, out: 0 },
    stores: storeCount,
    best: [...top.values()].sort((first, second) => second.revenue - first.revenue).slice(0, 5),
    recent: delivered.slice(0, 15).map((order) => ({
      _id: order._id, orderNo: order.orderNo, at: order.updatedAt, buyerName: order.buyerName, total: order.total, commission: order.commission || 0, deliveryCosts: order.splitDeliveryFee || 0,
      net: sellerAmount(order), payment: order.payment?.method === 'cod' ? 'cash' : order.payment?.direct ? 'direct' : 'mpesa', payout: order.payout?.status || 'not_due',
    })),
  });
});


// ---------------------------------------------------------------- one day: orders & sales
// Days are Kenyan days (EAT, UTC+3, no daylight saving): "today" runs from midnight to midnight in Nairobi.
const EAT = 3 * 3600e3;
const DAY = 864e5;
const SERIES_DAYS = 14;
const dayKey = (date) => new Date(new Date(date).getTime() + EAT).toISOString().slice(0, 10);
const dayStart = (key) => new Date(Date.parse(`${key}T00:00:00Z`) - EAT);
// when an order was delivered: its "delivered" step in the history (older orders: when it was last changed)
const deliveredAt = (order) => [...(order.history || [])].reverse().find((step) => step.status === 'delivered')?.at || order.updatedAt;
const emptyDay = (date) => ({ date, orders: 0, orderValue: 0, cancelled: 0, delivered: 0, sales: 0, net: 0, units: 0 });

// GET /api/seller/daily?date=2026-11-19 (default: today)
exports.daily = asyncHandler(async (req, res) => {
  const today = dayKey(Date.now());
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) && !Number.isNaN(Date.parse(req.query.date)) ? String(req.query.date) : today;
  const date = asked > today ? today : asked < dayKey(Date.now() - 400 * DAY) ? today : asked;
  const end = new Date(dayStart(date).getTime() + DAY);
  const from = new Date(end.getTime() - SERIES_DAYS * DAY);
  const me = req.customer._id;
  const sellerAmount = require('./orderController').sellerAmount;
  const orders = await Order.find({
    seller: me,
    status: { $ne: 'awaiting_payment' }, // M-Pesa not paid yet: not an order yet
    $or: [{ createdAt: { $gte: from, $lt: end } }, { status: 'delivered', updatedAt: { $gte: from } }],
  }).sort({ createdAt: -1 }).limit(20000)
    .select('orderNo status items subtotal total commission splitDeliveryFee inspection.fee verification.fee delivery.method rider.fee payOnDelivery payment.method payment.direct buyerName createdAt updatedAt history.status history.at').lean();

  const days = new Map();
  for (let index = SERIES_DAYS - 1; index >= 0; index -= 1) {
    const key = dayKey(end.getTime() - 1 - index * DAY);
    days.set(key, emptyDay(key));
  }
  const placedOn = [];
  const deliveredOn = [];
  for (const order of orders) {
    const placed = days.get(dayKey(order.createdAt));
    if (placed && order.createdAt < end) {
      placed.orders += 1;
      if (order.status === 'cancelled') placed.cancelled += 1;
      else placed.orderValue += order.subtotal || 0;
      if (dayKey(order.createdAt) === date) placedOn.push(order);
    }
    if (order.status === 'delivered') {
      const when = deliveredAt(order);
      const sold = days.get(dayKey(when));
      if (sold && new Date(when) < end) {
        sold.delivered += 1;
        sold.sales += order.subtotal || 0;
        sold.net += sellerAmount(order);
        sold.units += (order.items || []).reduce((sum, item) => sum + (item.qty || 0), 0);
        if (dayKey(when) === date) deliveredOn.push({ ...order, deliveredAt: when });
      }
    }
  }
  const series = [...days.values()];
  const row = (order) => ({
    _id: order._id, orderNo: order.orderNo, status: order.status, at: order.createdAt, buyerName: order.buyerName, total: order.total, subtotal: order.subtotal,
    items: (order.items || []).slice(0, 4).map((item) => ({ title: item.title, qty: item.qty })), more: Math.max(0, (order.items || []).length - 4),
    payment: order.payment?.method === 'cod' ? 'cash' : order.payment?.direct ? 'direct' : 'mpesa',
  });
  res.json({
    date, today, isToday: date === today,
    day: series[series.length - 1],
    previous: series[series.length - 2],
    series,
    orders: placedOn.map(row),
    delivered: deliveredOn.sort((first, second) => new Date(second.deliveredAt) - new Date(first.deliveredAt)).map((order) => ({ ...row(order), deliveredAt: order.deliveredAt, net: sellerAmount(order) })),
  });
});


// ---------------------------------------------------------------- 📈 the POS dashboard (shops, wholesalers, importers)
// Who can turn it on: a business (a seller type: shop, wholesaler, importer, boutique, mama mboga…), a seller in one
// of our markets, or anyone with 5+ live products. Not one-off sellers of a single item.
const POS_MIN_PRODUCTS = 5;
async function posEligibility(customer) {
  if ((customer.sellerTypes || []).length) return { eligible: true, why: 'business' };
  if (customer.shopLocation?.market) return { eligible: true, why: 'market' };
  const live = await Listing.countDocuments({ seller: customer._id, status: 'active' });
  if (live >= POS_MIN_PRODUCTS) return { eligible: true, why: 'products' };
  return { eligible: false, live, reason: `The POS dashboard is for shops, wholesalers and importers, or sellers with ${POS_MIN_PRODUCTS}+ products (you have ${live}). Add your shop details in My account, or post more products.` };
}
exports.posEligibility = posEligibility;

// POST /api/seller/pos { enabled }  (one button: on / off)
exports.setPos = asyncHandler(async (req, res) => {
  const on = req.body.enabled === true || req.body.enabled === 'true';
  if (on) {
    const check = await posEligibility(req.customer);
    if (!check.eligible) throw httpError(check.reason, 403);
  }
  req.customer.set('pos', on ? { enabled: true, at: req.customer.pos?.at || new Date() } : { enabled: false, at: req.customer.pos?.at });
  await req.customer.save();
  res.json({ enabled: on });
});

const PAY_LABEL = { mpesa: 'M-Pesa', cod: 'Cash on delivery', pole: 'Lipa Pole Pole' };
const DELIVERY_LABEL = { pickup: 'Pickup', delivery: 'Seller delivers', rider: 'Kapu rider', walk: 'Walking delivery', courier: 'Courier', verified: 'Safe deal' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : now > 0 ? null : 0);

// GET /api/seller/pos?range=7|30|90|365
// → { eligible, enabled, ... , and when on: kpis (with the period before), series, products, payments, deliveries,
//     hours, weekdays, statuses, buyers, places, stock }. One read of the seller's orders, worked out here.
exports.pos = asyncHandler(async (req, res) => {
  const check = await posEligibility(req.customer);
  const enabled = !!req.customer.pos?.enabled && check.eligible;
  if (!enabled || req.query.check === '1') return res.json({ ...check, enabled }); // ?check=1: only whether it can be / is on
  const range = [7, 30, 90, 365].includes(Number(req.query.range)) ? Number(req.query.range) : 30;
  const now = Date.now();
  const from = new Date(now - range * DAY);
  const before = new Date(now - 2 * range * DAY);
  const me = req.customer._id;
  const sellerAmount = require('./orderController').sellerAmount;
  const [orders, stockRows] = await Promise.all([
    Order.find({ seller: me, status: { $ne: 'awaiting_payment' }, $or: [{ createdAt: { $gte: before } }, { status: 'delivered', updatedAt: { $gte: before } }] })
      .limit(50000)
      .select('status items subtotal total commission splitDeliveryFee inspection.fee verification.fee delivery.method delivery.county rider.fee payOnDelivery payment.method buyer buyerName createdAt updatedAt history')
      .lean(),
    Listing.find({ seller: me, status: 'active', buyNow: true }).select('title slug stock price images views').sort({ stock: 1 }).limit(400).lean(),
  ]);

  // the buckets of the chart: days (7 / 30), weeks (90), months (365), Kenya time
  const unit = range <= 30 ? 'day' : range <= 90 ? 'week' : 'month';
  const bucketOf = (date) => {
    const key = dayKey(date);
    if (unit === 'day') return key;
    if (unit === 'month') return key.slice(0, 7);
    const day = dayStart(key);
    const monday = new Date(day.getTime() - (((new Date(day.getTime() + EAT).getUTCDay() + 6) % 7) * DAY));
    return dayKey(monday);
  };
  const buckets = new Map();
  for (let t = from.getTime(); t <= now; t += DAY) {
    const key = bucketOf(t);
    if (!buckets.has(key)) buckets.set(key, { key, orders: 0, orderValue: 0, sales: 0 });
  }

  const empty = () => ({ orders: 0, cancelled: 0, orderValue: 0, sales: 0, net: 0, units: 0, delivered: 0 });
  const cur = empty();
  const prev = empty();
  const products = new Map();
  const payments = new Map();
  const deliveries = new Map();
  const statuses = new Map();
  const buyers = new Map();
  const places = new Map();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  const weekdays = WEEKDAYS.map((day) => ({ day, orders: 0, orderValue: 0 }));
  const bump = (map, key, value, extra = {}) => { const row = map.get(key) || { key, n: 0, value: 0, ...extra }; row.n += 1; row.value += value; map.set(key, row); return row; };

  for (const order of orders) {
    const placed = new Date(order.createdAt);
    const live = order.status !== 'cancelled';
    // placed in this period (or the one before): orders, value, who, when, how
    if (placed >= from) {
      cur.orders += 1;
      if (!live) cur.cancelled += 1;
      else cur.orderValue += order.subtotal || 0;
      bump(statuses, order.status, order.subtotal || 0);
      if (live) {
        const bucket = buckets.get(bucketOf(placed));
        if (bucket) { bucket.orders += 1; bucket.orderValue += order.subtotal || 0; }
        bump(payments, order.payment?.method || 'other', order.subtotal || 0);
        bump(deliveries, order.delivery?.method || 'pickup', order.subtotal || 0);
        if (order.delivery?.county) bump(places, order.delivery.county, order.subtotal || 0);
        if (order.buyer) bump(buyers, String(order.buyer), order.subtotal || 0, { name: order.buyerName || 'A buyer' });
        const local = new Date(placed.getTime() + EAT);
        hours[local.getUTCHours()].orders += 1;
        const weekday = weekdays[(local.getUTCDay() + 6) % 7];
        weekday.orders += 1;
        weekday.orderValue += order.subtotal || 0;
        for (const item of order.items || []) {
          const key = String(item.listing || item.title);
          const row = products.get(key) || { key, title: item.title, slug: item.slug || '', image: item.image || '', qty: 0, revenue: 0, orders: 0 };
          row.qty += item.qty || 0;
          row.revenue += item.subtotal ?? (item.price || 0) * (item.qty || 0);
          row.orders += 1;
          products.set(key, row);
        }
      }
    } else if (placed >= before) {
      prev.orders += 1;
      if (!live) prev.cancelled += 1;
      else prev.orderValue += order.subtotal || 0;
    }
    // delivered in this period (or the one before): sales and what the seller earns
    if (order.status === 'delivered') {
      const when = new Date(deliveredAt(order));
      const into = when >= from ? cur : when >= before ? prev : null;
      if (into) {
        into.delivered += 1;
        into.sales += order.subtotal || 0;
        into.net += sellerAmount(order);
        into.units += (order.items || []).reduce((sum, item) => sum + (item.qty || 0), 0);
        if (into === cur) { const bucket = buckets.get(bucketOf(when)); if (bucket) bucket.sales += order.subtotal || 0; }
      }
    }
  }
  const kept = (period) => period.orders - period.cancelled;
  const avg = (period) => (kept(period) ? Math.round(period.orderValue / kept(period)) : 0);
  const buyerRows = [...buyers.values()];
  const kpis = {
    orderValue: { now: cur.orderValue, before: prev.orderValue, change: pct(cur.orderValue, prev.orderValue) },
    sales: { now: cur.sales, before: prev.sales, change: pct(cur.sales, prev.sales) },
    net: { now: Math.round(cur.net), before: Math.round(prev.net), change: pct(cur.net, prev.net) },
    orders: { now: kept(cur), before: kept(prev), change: pct(kept(cur), kept(prev)) },
    avgOrder: { now: avg(cur), before: avg(prev), change: pct(avg(cur), avg(prev)) },
    units: { now: cur.units, before: prev.units, change: pct(cur.units, prev.units) },
    buyers: { now: buyerRows.length, repeat: buyerRows.filter((row) => row.n > 1).length },
    cancelRate: { now: cur.orders ? Math.round((cur.cancelled / cur.orders) * 100) : 0, before: prev.orders ? Math.round((prev.cancelled / prev.orders) * 100) : 0 },
  };
  const top = (map, label, count = 6) => [...map.values()].sort((a, b) => b.value - a.value || b.n - a.n).slice(0, count).map((row) => ({ key: row.key, label: label ? label[row.key] || row.key : row.key, orders: row.n, value: row.value }));
  const low = stockRows.filter((item) => item.stock <= 3);
  const soldKeys = new Set([...products.keys()]);
  res.json({
    ...check, enabled: true, range, unit, from, to: new Date(now),
    kpis,
    series: [...buckets.values()],
    products: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    payments: top(payments, PAY_LABEL),
    deliveries: top(deliveries, DELIVERY_LABEL),
    statuses: [...statuses.values()].map((row) => ({ status: row.key, orders: row.n })),
    buyers: buyerRows.sort((a, b) => b.value - a.value).slice(0, 5).map((row) => ({ name: row.name, orders: row.n, value: row.value })),
    places: top(places, null, 5),
    hours, weekdays,
    stock: {
      live: stockRows.length,
      out: stockRows.filter((item) => item.stock <= 0).length,
      low: low.slice(0, 8).map((item) => ({ _id: item._id, title: item.title, slug: item.slug, stock: item.stock, price: item.price })),
      notSelling: stockRows.filter((item) => !soldKeys.has(String(item._id))).length, // live products with no orders in this period
    },
  });
});
