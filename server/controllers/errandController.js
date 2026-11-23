// Errands: book our riders or shopping agents directly, without buying from a seller on Kapu.
//   🛵 Ride with us  — parcel delivery around Nairobi, Uber / Bolt style: pick a vehicle (bike, 4-seater car, pickup) at an
//                      upfront fare, the nearest rider with it comes (paid to the rider on delivery; market/rideWithUs.js)
//   🛒 Shop for me   — a shopping agent buys your list at any shop or market, checks it and brings it
//   🛍️ Shop & ride   — replaced by Ride with us and no longer offered in the app; kept so earlier bookings can finish
//                      (our agent inspected what was bought and delivered it via our CBD hub: market/shopRide.js)
const crypto = require('crypto');
const mongoose = require('mongoose');
const Errand = require('../models/Errand');
const Task = require('../models/Task');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { site } = require('../config/site');
const { riderQuote } = require('../market/fieldwork');
const payouts = require('../market/payouts');
const { emitCustomer, emitAdmin } = require('../utils/realtime');
const { formatPhone, stkPush, stkQuery } = require('../utils/mpesa');

const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);
const ksh = (amount) => `KSh ${Math.round(Number(amount) || 0).toLocaleString('en-KE')}`;
const KENYA = (lat, lng) => lat > -4.9 && lat < 5.1 && lng > 33.8 && lng < 42;
const point = (location) => {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && KENYA(lat, lng) ? { lat, lng } : null;
};
const geoPoint = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });
const phoneOk = (value) => {
  try {
    return formatPhone(value);
  } catch {
    return null;
  }
};
const newNo = () => {
  const text = new Date(Date.now() + 3 * 3600e3).toISOString().slice(2, 10).replace(/-/g, '');
  return `ER-${text}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
};

// the shopping agent's service fee: a small share of the budget (Admin → Settings → field team can change it)
function serviceFee(budget) {
  const fieldwork = site().fieldwork || {};
  const pct = fieldwork.shopPercent ?? 5;
  const lo = fieldwork.shopMin ?? 100;
  const hi = fieldwork.shopMax ?? 1500;
  return Math.min(hi, Math.max(lo, Math.round((budget * pct) / 100 / 10) * 10));
}
const BUDGET_MAX = 50000;

// price an errand: delivery (rider rates, from pickup to drop-off) + the shopping service fee.
// A parcel is a Ride with us trip, priced per vehicle (parcel: { size, vehicle }).
async function quote(kind, from, to, budget, parcel = {}) {
  if (kind === 'parcel') return parcelQuote(from, to, parcel);
  if (!from) return { ok: false, reason: kind === 'shopping' ? 'Pin the shop or market on the map' : 'Pin where to pick it up' };
  if (!to) return { ok: false, reason: 'Pin where to deliver it' };
  const currentQuote = await require('../market/fieldwork').riderQuoteByRoad(geoPoint(from), to);
  if (!currentQuote.ok) return { ok: false, km: currentQuote.km, reason: currentQuote.reason.replace('from the shop', 'from the pick-up point').replace('This seller hasn’t put their shop on the map, so riders can’t find it', 'Pin the pick-up point') };
  const service = kind === 'shopping' ? serviceFee(budget || 0) : 0;
  const payNow = kind === 'shopping' ? (budget || 0) + service : 0;
  return { ok: true, km: currentQuote.km, delivery: currentQuote.fee, service, budget: kind === 'shopping' ? budget || 0 : 0, payNow, payOnDelivery: currentQuote.fee, total: payNow + currentQuote.fee };
}

// 🛵 Ride with us: the vehicle the customer chose (or the suggested one), at its upfront fare.
// `ride` carries every vehicle's option, so the app can show them all side by side.
async function parcelQuote(from, to, { size, vehicle } = {}) {
  const parcelSize = ['small', 'medium', 'large'].includes(size) ? size : 'small';
  const ride = await require('../market/rideWithUs').quote({ from, to, size: parcelSize });
  if (!ride.ok) return ride;
  const chosen = ride.options.find((option) => option.vehicle === vehicle) || ride.options.find((option) => option.vehicle === ride.recommended);
  if (!chosen) return { ok: false, reason: 'None of our vehicles can carry that: choose a smaller size or call us', ride };
  if (!chosen.fits) return { ok: false, reason: `${chosen.reason}: choose the 4-seater car or the pickup`, ride };
  // delivery / payOnDelivery / total: the same fields every errand quote has (the rider is paid on delivery)
  return { ok: true, km: ride.km, minutes: chosen.tripMinutes, vehicle: chosen.vehicle, size: parcelSize, surge: chosen.surge, delivery: chosen.fare, service: 0, budget: 0, payNow: 0, payOnDelivery: chosen.fare, total: chosen.fare, ride };
}

function view(task) {
  return {
    _id: task._id, no: task.no, kind: task.kind, status: task.status, createdAt: task.createdAt,
    pickup: task.pickup && { address: task.pickup.address, name: task.pickup.name, phone: task.pickup.phone, lat: task.pickup.lat, lng: task.pickup.lng },
    dropoff: task.dropoff, parcel: task.parcel, shopping: task.shopping?.mode === 'list' ? { ...(task.shopping.toObject ? task.shopping.toObject() : task.shopping), photos: (task.shopping.photos || []).map((photo, index) => `/errands/${task._id}/list-photos/${index}`) } : task.shopping, shopride: task.shopride, notes: task.notes || '', km: task.km, fee: task.fee,
    payment: { method: task.payment.method, status: task.payment.status, amount: task.payment.amount || 0, receipt: task.payment.receipt || '', failReason: task.payment.failReason || '' },
    refund: task.refund?.status !== 'none' ? task.refund : null,
    worker: task.worker?.name ? { ...(task.worker.toObject ? task.worker.toObject() : task.worker), ...(['assigned', 'picked_up'].includes(task.status) && task.worker.eta?.minutes != null ? { kmLeft: task.worker.eta.kmLeft, kmToYou: task.worker.eta.kmToYou ?? null, stage: task.worker.eta.stage } : { live: undefined, eta: undefined }) } : null, history: task.history, cancelReason: task.cancelReason || '',
    taskId: task.task || null, rated: task.rated || 0,
  };
}
const broadcast = (error) => {
  emitCustomer(String(error.customer), 'errand:update', view(error));
  emitAdmin('work:errand', { _id: error._id, no: error.no, status: error.status });
};

// a live notification for the customer (English & Kiswahili)
function tell(error, title, body, icon = '🛵') {
  const Notification = require('../models/Notification');
  Notification.create({ to: error.customer, kind: 'order', icon, title, body, link: `/errands/${error._id}` })
    .then((result) => emitCustomer(String(error.customer), 'notify', { _id: result._id, kind: result.kind, icon, title, body, link: result.link, read: false, createdAt: result.createdAt }))
    .catch(() => {});
}

// ---------------------------------------------------------------- 🛍️ Shop & ride with us
const shopRide = require('../market/shopRide');
const pickupPoints = require('../market/pickupPoints');
const shopRideRates = () => shopRide.rates(site().fieldwork?.shopRide);
// the markets where we have approved shopping agents (refreshed every 5 minutes; cleared with the other market caches)
const agentMarkets = () => require('../utils/cache').cached('market:shopride-agents', 5 * 60 * 1000, async () => {
  const Customer = require('../models/Customer');
  const ids = await Customer.distinct('worker.market', { 'worker.role': 'agent', 'worker.status': 'approved', 'worker.market': { $exists: true, $ne: null }, active: { $ne: false } });
  if (!ids.length) return [];
  const list = await require('../models/Market').find({ _id: { $in: ids }, approved: true }).select('name point').lean();
  return list.filter((market) => market.point?.coordinates).map((market) => ({ _id: String(market._id), name: market.name, lat: market.point.coordinates[1], lng: market.point.coordinates[0] }));
});
// body: { fromArea (pickup point id) | from {lat,lng}, weightKg, inspect, repack, urgency, mode, pointId, to {lat,lng} }
async function shopRideQuote(body, known = {}) {
  const points = await pickupPoints.all();
  if (!points.length) return { ok: false, reason: 'Our pickup points aren’t set up yet. Please try again later.' };
  const areaPoint = points.find((item) => item._id === String(body.fromArea || ''));
  const pin = point(body.from);
  const from = pin || (areaPoint ? { lat: areaPoint.lat, lng: areaPoint.lng } : null);
  if (!from) return { ok: false, reason: 'Where are the items? Choose the area (or share the shop’s location)' };
  const to = point(body.to);
  const mode = body.mode === 'door' ? 'door' : 'point';
  // the pickup point in the buyer's area: the one they chose, or the nearest to where they are
  const chosen = points.find((item) => item._id === String(body.pointId || '') && !item.hub);
  const local = chosen || (to ? shopRide.nearestPoint(points, to) : null);
  // door delivery: priced on the real road from the pickup point (Google Routes API; else estimated)
  const road = mode === 'door' && local && to ? await require('../market/googleMaps').road({ lat: local.lat, lng: local.lng }, to, 'motorbike') : null;
  // where the seller is: in the CBD or a market with our agents (covered), or far (verification required)
  let marketId = null;
  if (known.markets) marketId = known.markets.get(String(body.sellerId)) || null; // looked up for the whole booking at once
  else if (body.sellerId && isId(body.sellerId)) marketId = (await require('../models/Customer').findById(body.sellerId).select('shopLocation.market').lean())?.shopLocation?.market || null;
  const rates = shopRideRates();
  const coverage = shopRide.coverage(pin || from, await agentMarkets(), rates, { marketId });
  const result = shopRide.quote({ from, weightKg: Number(body.weightKg), inspect: body.inspect !== false && body.inspect !== 'false', repack: body.repack === true || body.repack === 'true', urgency: body.urgency === 'express' ? 'express' : 'standard', mode, point: local, to, road, coverage }, rates);
  return result.ok ? { ...result, from, fromArea: areaPoint?.area || '', pointFull: local, coverMarketId: coverage.marketId || null } : result;
}

// GET /api/errands/pickup-points  (public: the areas and our pickup points, the hub first)
exports.pickupPoints = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  const rates = shopRideRates();
  res.json({ points: await pickupPoints.all(), agentMarkets: (await agentMarkets()).map((market) => market.name), rates: { inspectFee: rates.inspectFee, cbdFee: rates.cbdFee, outsideFee: rates.outsideFee, lightKg: rates.lightKg, perExtraKg: rates.perExtraKg, repackFee: rates.repackFee, door: { base: rates.door.base, perKm: rates.door.perKm, perMin: rates.door.perMin, min: rates.door.min } } });
});

// GET /api/errands/shopride/items?q=sho  (public) — "What did you buy?" as they type:
//   items: kinds of things (Women's shoes, TVs, Rice…) whose words start with what's typed, the closest first
//   ads:   matching ads on Kapu, each with its seller (choosing one fills in the seller and where they are)
let itemNames = null;
function itemCatalogue() {
  if (itemNames) return itemNames;
  const { CATEGORIES, ITEMS } = require('../market/categories');
  const names = new Map();
  for (const category of CATEGORIES) {
    if (category.slug === 'other') continue;
    for (const sub of category.subs || []) names.set(sub.name.toLowerCase(), { label: sub.name, hint: category.name, icon: category.icon });
  }
  for (const [key, list] of Object.entries(ITEMS)) for (const name of list) if (name !== 'Other' && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), { label: name, hint: key.replace(/^womens-/, 'women’s ').replace(/^mens-/, 'men’s ').replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase()), icon: '🏷️' });
  itemNames = [...names.values()].map((item) => ({ ...item, words: item.label.toLowerCase().split(/[^a-z0-9’']+/).filter(Boolean) }));
  return itemNames;
}
// ?seller=<id> (the seller found from their phone or an ad): ONLY what that seller sells on Kapu — their active
// ads and the item types they chose when they signed up — matching what's typed, or all of them before typing.
async function sellerItems(sellerId, query) {
  const Customer = require('../models/Customer');
  const Listing = require('../models/Listing');
  const { getCategory, getSub } = require('../market/categories');
  const typed = query.split(/\s+/).filter(Boolean);
  const matches = (label) => !typed.length || typed.every((word) => label.toLowerCase().split(/[^a-z0-9’']+/).some((own) => own.startsWith(word)));
  const [seller, ads, total] = await Promise.all([
    Customer.findOne({ _id: sellerId, active: { $ne: false } }).select('name shopLocation.name shopLocation.area sellerItems sellerCategories').lean(),
    Listing.find({ seller: sellerId, status: 'active', ...(typed.length ? require('../market/search').wordFilter(query, 'all').filter : {}) }).sort({ views: -1, createdAt: -1 }).limit(typed.length ? 30 : 60).select('title price images seller sellerName area county weightKg').lean(),
    Listing.countDocuments({ seller: sellerId, status: 'active' }),
  ]);
  if (!seller) return { items: [], ads: [], seller: null };
  // the types they said they sell (electronics/phones…), or every type of their categories when they picked none
  const types = (seller.sellerItems?.length ? seller.sellerItems : (seller.sellerCategories || []).flatMap((slug) => (getCategory(slug)?.subs || []).map((sub) => `${slug}/${sub.slug}`)))
    .map((key) => { const [cat, sub] = key.split('/'); const category = getCategory(cat); const type = getSub(cat, sub); return type ? { label: type.name, hint: category.name, icon: category.icon } : null; })
    .filter((item) => item && matches(item.label));
  const name = seller.shopLocation?.name || seller.name;
  return {
    seller: { _id: seller._id, name, products: total }, // how many products they have on Kapu
    items: types.slice(0, 12),
    ads: ads.map((ad) => ({ _id: ad._id, title: ad.title, price: ad.price, image: ad.images?.[0] || '', weightKg: ad.weightKg || null, seller: { _id: ad.seller, name: ad.sellerName || name, area: [ad.area, ad.county].filter(Boolean).join(', ') } })),
  };
}
exports.shopRideItems = asyncHandler(async (req, res) => {
  const query = clean(req.query.q, 60).toLowerCase();
  if (req.query.seller) {
    if (!isId(req.query.seller)) throw httpError('Seller not found', 404);
    res.set('Cache-Control', 'private, max-age=15');
    return res.json(await sellerItems(req.query.seller, query));
  }
  if (query.length < 2) return res.json({ items: [], ads: [] });
  const typed = query.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const item of itemCatalogue()) {
    if (!typed.every((word) => item.words.some((own) => own.startsWith(word)))) continue;
    scored.push([item.label.toLowerCase().startsWith(query) ? 0 : 1, item.label.length, item]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const { filter } = require('../market/search').wordFilter(query, 'all');
  const Listing = require('../models/Listing');
  const ads = Object.keys(filter).length
    ? await Listing.find({ status: 'active', ...filter }).sort({ views: -1, createdAt: -1 }).limit(6).select('title price images seller sellerName area county weightKg').lean()
    : [];
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    items: scored.slice(0, 6).map(([, , item]) => ({ label: item.label, hint: item.hint, icon: item.icon })),
    ads: ads.map((ad) => ({ _id: ad._id, title: ad.title, price: ad.price, image: ad.images?.[0] || '', weightKg: ad.weightKg || null, seller: { _id: ad.seller, name: ad.sellerName || '', area: [ad.area, ad.county].filter(Boolean).join(', ') } })),
  });
});

// GET /api/errands/shopride/seller?phone=07…  (logged in: numbers stay away from strangers) or ?id=<seller id> (from an ad)
// A seller on Kapu: their shop's name, area, stall and location fill in "Where is it?" (only what their shop
// page shows anyway; the exact pin only if they made their shop public), and the area's pickup point.
exports.shopRideSeller = asyncHandler(async (req, res) => {
  const Customer = require('../models/Customer');
  let seller = null;
  if (req.query.id) {
    if (!isId(req.query.id)) throw httpError('Seller not found', 404);
    seller = await Customer.findOne({ _id: req.query.id, active: { $ne: false } }).select('name phone accountType shopLocation').lean();
  } else {
    if (!req.customer) throw httpError('Log in to find a seller by their phone number', 401);
    const phone = phoneOk(req.query.phone);
    if (!phone) throw httpError('Enter the seller’s full phone number (07XX XXX XXX)');
    seller = await Customer.findOne({ phone, active: { $ne: false } }).select('name phone accountType shopLocation').lean();
  }
  const shop = seller?.shopLocation || {};
  const isSeller = seller && (seller.accountType === 'seller' || shop.name || shop.point || (await require('../models/Listing').exists({ seller: seller._id, status: 'active' })));
  if (!isSeller) return res.json({ found: false });
  const pin = shop.public && shop.point?.coordinates ? { lat: shop.point.coordinates[1], lng: shop.point.coordinates[0] } : null;
  // the area: from the shop's pin (the CBD hub when it's in the CBD), else from the area / county they typed
  const points = await pickupPoints.all();
  let fromArea = null;
  if (shop.point?.coordinates) {
    const at = { lat: shop.point.coordinates[1], lng: shop.point.coordinates[0] };
    fromArea = shopRide.inCbd(at, shopRideRates()) ? points.find((point) => point.hub) : shopRide.nearestPoint(points, at);
  }
  if (!fromArea && shop.area) fromArea = points.find((point) => point.area.toLowerCase() === String(shop.area).toLowerCase()) || null;
  res.json({
    found: true, _id: seller._id, name: seller.name, shopName: shop.name || '', area: shop.area || '', county: shop.county || '', address: shop.address || '',
    stall: shop.stall || '', market: shop.marketName || '', pin, fromArea: fromArea ? { _id: fromArea._id, area: fromArea.hub ? 'Nairobi CBD' : fromArea.area } : null,
    ...(req.query.phone ? { phone: seller.phone } : {}),
  });
});

// a seller's items: [{ name, qty, price }] (or one "what" with its goodsAmount) → cleaned items, their total, a summary
function itemsOf(seller) {
  const raw = Array.isArray(seller.items) && seller.items.length ? seller.items.slice(0, 20) : [{ name: seller.what, qty: 1, price: seller.goodsAmount }];
  const items = raw.map((item) => ({
    name: clean(item?.name ?? item?.what, 120),
    qty: Math.min(999, Math.max(1, Math.floor(Number(item?.qty) || 1))),
    price: Math.max(0, Math.min(1000000, Math.round(Number(item?.price) || 0))),
  })).filter((item) => item.name.length >= 2);
  const goods = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const what = items.map((item) => `${item.qty > 1 ? `${item.qty} × ` : ''}${item.name}`).join(', ').slice(0, 160);
  return { items, goods, what };
}

// several sellers in one booking: a quote per seller (their place, weight and inspection), one pickup point or door
// for the buyer. When it's paid:
//   now                 inspection (+ repackaging) for every seller
//   after inspection    each seller's goods, plus that seller's delivery fee for a pickup-point booking
//   on delivery (door)  every delivery fee + the door fare, to our rider at the door
async function shopRideGroupQuote(body) {
  const list = Array.isArray(body.sellers) && body.sellers.length ? body.sellers.slice(0, 5) : [body];
  const points = await pickupPoints.all();
  const to = point(body.to);
  const mode = body.mode === 'door' ? 'door' : 'point';
  const chosen = points.find((item) => item._id === String(body.pointId || '') && !item.hub);
  const local = chosen || (to ? shopRide.nearestPoint(points, to) : null);
  if (!local) return { ok: false, reason: mode === 'door' ? 'Share your live location for door delivery' : 'Choose the pickup point in your area' };
  // every seller's market in one query (not one per seller)
  const sellerIds = list.map((seller) => seller.sellerId).filter((id) => id && isId(id));
  const markets = new Map(sellerIds.length ? (await require('../models/Customer').find({ _id: { $in: sellerIds } }).select('shopLocation.market').lean()).map((customer) => [String(customer._id), customer.shopLocation?.market || null]) : []);
  const parts = [];
  for (const [index, seller] of list.entries()) {
    const priced = await shopRideQuote({ ...seller, repack: body.repack, urgency: body.urgency, mode: 'point', pointId: local._id }, { markets });
    if (!priced.ok) return { ...priced, reason: list.length > 1 ? `Seller ${index + 1}: ${priced.reason}` : priced.reason, seller: index };
    parts.push({ index, priced, goods: itemsOf(seller).goods });
  }
  let door = null;
  if (mode === 'door') {
    if (!to) return { ok: false, reason: 'Share your live location for door delivery' };
    if (!shopRide.inNairobi(to, shopRideRates())) return { ok: false, reason: 'Door delivery is within Nairobi for now' };
    const road = await require('../market/googleMaps').road({ lat: local.lat, lng: local.lng }, to, 'motorbike'); // the real road (Routes API), else estimated
    door = shopRide.doorFare(local, to, new Date(), shopRideRates(), road);
  }
  // the shopping agent of each seller's market (the market the seller is in, or next to): one read for all of them
  const marketAgents = await require('./workController').bestAgentsOf(parts.map((part) => part.priced.coverMarketId));
  for (const part of parts) part.agent = marketAgents.get(String(part.priced.coverMarketId || '')) || null;
  const sum = (pick) => parts.reduce((total, part) => total + pick(part), 0);
  const inspection = sum((part) => part.priced.inspection);
  const repack = sum((part) => part.priced.repack);
  const goods = sum((part) => part.goods);
  const delivery = sum((part) => part.priced.delivery.fee);
  const doorFare = door?.fare || 0;
  return {
    ok: true, mode, point: { _id: local._id, name: local.name, area: local.area }, pointFull: local, door,
    parts: parts.map((part) => ({ index: part.index, fromCbd: part.priced.fromCbd, fromArea: part.priced.fromArea, weightKg: part.priced.weightKg, inspection: part.priced.inspection, repack: part.priced.repack, delivery: part.priced.delivery, goods: part.goods, covered: part.priced.covered, zone: part.priced.zone, coverName: part.priced.coverName, verifyRequired: part.priced.verifyRequired, verifyRecommended: part.priced.verifyRecommended, agent: require('./workController').publicAgent(part.agent), agentFull: part.agent, priced: part.priced })),
    totals: { inspection, repack, goods, delivery, door: doorFare, total: inspection + repack + goods + delivery + doorFare },
    schedule: { now: inspection + repack, afterInspection: goods + (mode === 'point' ? delivery : 0), onDelivery: mode === 'door' ? delivery + doorFare : 0 },
    estimate: parts.some((part) => part.priced.estimate),
  };
}

// POST /api/errands/shopride/quote  (public, so the page can show prices before logging in)
// { sellers: [{ fromArea | from, weightKg, inspect, goodsAmount }], mode, pointId, to, repack, urgency } → the group quote;
// a single seller's fields without "sellers" → the single quote (as before)
exports.shopRideQuote = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (Array.isArray(body.sellers)) {
    const result = await shopRideGroupQuote(body);
    if (result.ok) {
      delete result.pointFull;
      result.parts = result.parts.map(({ priced, agentFull, ...part }) => part); // the agent's name only (no phone) in a public price check
    }
    return res.json(result);
  }
  const result = await shopRideQuote(body);
  if (result.ok) delete result.pointFull;
  res.json(result);
});

// the job for our field team (riders: parcels · shopping agents: shopping)
async function openTask(task) {
  if (task.kind === 'shopride') return openShopRideTask(task);
  const parcel = task.kind === 'parcel';
  const fee = (task.fee.delivery || 0) + (task.fee.service || 0);
  const listMode = task.kind === 'shopping' && task.shopping?.mode === 'list';
  const job = await Task.create({
    ...(listMode ? { list: { text: task.shopping.text || '', photos: (task.shopping.photos || []).length }, quote: { needed: true } } : {}),
    kind: parcel ? 'delivery' : 'shopping', errand: task._id, orderNo: task.no,
    pickup: { name: parcel ? task.pickup.name || 'Pick-up point' : task.shopping.shopName || 'Any good shop near the pin', address: task.pickup.address, area: '', point: task.pickup.point, phone: task.pickup.phone },
    dropoff: { address: task.dropoff.address, area: '', lat: task.dropoff.lat, lng: task.dropoff.lng, phone: task.dropoff.phone, name: task.dropoff.name },
    km: task.km,
    // Ride with us: only riders with the vehicle the customer chose are offered the job (see riders.matchAt)
    ...(parcel && task.parcel?.vehicle ? { vehicles: require('../market/rideWithUs').vehicleByKey(task.parcel.vehicle)?.riderVehicles } : {}),
    items: parcel ? [{ title: task.parcel.what, qty: 1, attrs: { size: task.parcel.size, ...(task.parcel.vehicle ? { vehicle: task.parcel.vehicle } : {}) } }] : listMode ? [{ title: `Shopping list${task.shopping.photos?.length ? ` (${task.shopping.photos.length} photo${task.shopping.photos.length === 1 ? '' : 's'})` : ''}`, qty: 1 }] : task.shopping.list.map((item) => ({ title: `${item.name}${item.qty && !/^\d+$/.test(item.qty) ? ` (${item.qty})` : ''}${item.note ? ` · ${item.note}` : ''}`, qty: parseInt(item.qty, 10) || 1 })),
    buyerNotes: [task.notes, parcel ? (task.parcel.payer === 'sender' ? `Collect the ${ksh(task.fee.delivery)} fee from the sender at pick-up` : `Collect the ${ksh(task.fee.delivery)} fee from the recipient on delivery`) : `Budget ${ksh(task.shopping.budget)} (paid). Keep the receipt.`].filter(Boolean).join(' · '),
    budget: parcel ? undefined : task.shopping.budget,
    fee, pay: payouts.split(fee, task.fee.delivery || 0).net, collectCash: task.fee.delivery || 0,
  });
  task.task = job._id;
  task.status = 'open';
  task.history.push({ status: 'open', note: parcel ? 'Looking for a rider near the pick-up point' : listMode ? 'Looking for a shopping agent near you: they’ll price your list' : 'Looking for a shopping agent near the shop' });
  await task.save();
  require('./workController').alertNearby(job).catch(() => {});
  broadcast(task);
  return job;
}

async function openShopRideTask(task) {
  const ride = task.shopride;
  const hub = (await pickupPoints.all()).find((item) => item.hub);
  const fee = (ride.price.inspection || 0) + (ride.price.repack || 0) + (ride.price.delivery || 0);
  const job = await Task.create({
    kind: 'delivery', inspect: true, errand: task._id, orderNo: task.no, // our agent always checks it before taking it
    pickup: { name: ride.sellerName || 'The seller', address: task.pickup.address, area: ride.fromArea || '', point: task.pickup.point, phone: task.pickup.phone },
    dropoff: { address: hub ? `${hub.name}, ${hub.address}` : 'Kapu CBD hub', area: 'CBD', lat: hub?.lat, lng: hub?.lng, phone: hub?.phone || '', name: 'Kapu CBD hub' },
    items: ride.items?.length ? ride.items.map((item) => ({ title: item.name, qty: item.qty, attrs: { ...(item.price ? { price: ksh(item.price) } : {}) } })) : [{ title: ride.what, qty: 1, attrs: { weight: `${ride.weightKg} kg` } }],
    buyerNotes: [ride.inspect ? 'Inspect it: right item, quality and quantity as the buyer ordered' : 'Check it’s the right item and quantity', ride.repack ? 'Repackage it if it isn’t packed well' : '', task.notes, ride.goods?.amount ? `After you pass it, the buyer pays ${ksh(ride.goods.amount)} for it: take it only once your app says it’s paid (we pay the seller). Nothing to collect in cash` : 'The buyer pays the seller themselves. Nothing to collect in cash', 'Bring it to the CBD hub.'].filter(Boolean).join(' · '),
    fee, pay: payouts.split(fee).net, collectCash: 0,
    preferred: require('./workController').reservation(ride.agent), // the agent they booked gets it first
  });
  task.task = job._id;
  task.status = 'open';
  task.history.push({ status: 'open', note: ride.agent?.name ? `Sent to ${ride.agent.name}, the shopping agent you booked` : 'Looking for an agent near the seller' });
  await task.save();
  require('./workController').alertNearby(job).catch(() => {});
  broadcast(task);
  return job;
}

// POST /api/errands/quote { kind, pickup:{lat,lng}, dropoff:{lat,lng}, budget }
exports.quote = asyncHandler(async (req, res) => {
  const kind = req.body.kind === 'shopping' ? 'shopping' : 'parcel';
  const budget = Math.round(Number(req.body.budget) || 0);
  res.json(await quote(kind, point(req.body.pickup), point(req.body.dropoff), budget, { size: req.body.size ?? req.body.parcel?.size, vehicle: req.body.vehicle ?? req.body.parcel?.vehicle }));
});

// POST /api/errands/ride/quote { pickup: { lat, lng }, dropoff: { lat, lng }, size }  (public: no login needed)
// 🛵 Ride with us: every vehicle's upfront fare, trip time and nearest rider's ETA. Never reveals where riders are.
exports.rideQuote = asyncHandler(async (req, res) => {
  const size = ['small', 'medium', 'large'].includes(req.body.size) ? req.body.size : 'small';
  res.json(await require('../market/rideWithUs').quote({ from: point(req.body.pickup), to: point(req.body.dropoff), size }));
});

// ---------------------------------------------------------------- 🛒 Shop for me, the quick way
const listFiles = require('../security/privateFiles');
const LIST_BUCKET = 'lists';
exports.listUpload = listFiles.uploader(LIST_BUCKET, { field: 'photos', max: 4, sizeMb: 8 });

// POST /api/errands/list  (multipart: photos[0-4], text, name, phone, address, lat, lng, notes)
// Only the list (written and / or photographed), the contacts and the delivery address. Nothing to pay now.
exports.createList = asyncHandler(async (req, res) => {
  try {
    const me = req.customer;
    const text = String(req.body.text ?? '').replace(/[<>]/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
    const photos = (req.files || []).map((file) => ({ file: file.filename, mime: file.mimetype }));
    if (text.length < 3 && !photos.length) throw httpError('Write your shopping list, or take a photo of it');
    const to = point({ lat: req.body.lat, lng: req.body.lng });
    if (!to) throw httpError('Pin your delivery address on the map (or use “where I am now”)');
    const address = clean(req.body.address, 200);
    if (address.length < 5) throw httpError('Describe the delivery address (estate, street, building, landmark)');
    const name = clean(req.body.name, 80) || me.name;
    const phone = phoneOk(req.body.phone) || phoneOk(me.phone);
    if (!phone) throw httpError('Enter your phone number: the agent calls you about prices and delivery');
    const errand = new Errand({
      no: newNo(), customer: me._id, customerName: me.name, customerPhone: me.phone, kind: 'shopping',
      // the agent shops near the customer: the job is shown to agents near the delivery address
      pickup: { address: `Shops near ${address}`, name: 'A good shop near the customer', phone: '', lat: to.lat, lng: to.lng, point: geoPoint(to) },
      dropoff: { address, name, phone, lat: to.lat, lng: to.lng },
      notes: clean(req.body.notes, 300), km: 0, fee: { delivery: 0, service: 0 },
      shopping: { mode: 'list', text, photos, list: [], budget: 0 },
      payment: { method: 'mpesa', status: 'none', phone },
    });
    errand.history.push({ status: 'open', note: `Your list${photos.length ? ` (${photos.length} photo${photos.length === 1 ? '' : 's'})` : ''} is in. Nothing to pay yet` });
    await errand.save();
    await openTask(errand);
    res.status(201).json(view(errand));
  } catch (err) {
    listFiles.discard(req);
    throw err;
  }
});

// GET /api/errands/:id/list-photos/:n  (the customer)  ·  /api/errands/admin/:id/list-photos/:n  (our team, audited)
exports.listPhoto = asyncHandler(async (req, res) => {
  const errand = await loadMine(req);
  const photo = errand.shopping?.photos?.[Number(req.params.n)];
  if (!photo) throw httpError('Photo not found', 404);
  listFiles.send(res, LIST_BUCKET, photo.file, `${errand.no}-list-${Number(req.params.n) + 1}`);
});
exports.adminListPhoto = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Errand not found', 404);
  const errand = await Errand.findById(req.params.id).lean();
  const photo = errand?.shopping?.photos?.[Number(req.params.n)];
  if (!photo) throw httpError('Photo not found', 404);
  require('../security/audit').audit(req, 'errand.list.photo.view', { target: errand.no });
  listFiles.send(res, LIST_BUCKET, photo.file, `${errand.no}-list-${Number(req.params.n) + 1}`);
});
// the agent on the job: the photo of the list (see workController)
exports.sendListPhoto = (res, errand, n) => {
  const photo = errand?.shopping?.photos?.[Number(n)];
  if (!photo) return res.status(404).json({ message: 'Photo not found' });
  return listFiles.send(res, LIST_BUCKET, photo.file, `${errand.no}-list-${Number(n) + 1}`);
};

// the agent's price for the list: the goods (amount) + their fee, paid now by the customer with M-Pesa; delivery,
// priced by distance from where the agent is to the customer, is paid on delivery. → the errand
exports.quoteList = async (task, agent, { amount, note }) => {
  const errand = await Errand.findById(task.errand);
  if (!errand || errand.shopping?.mode !== 'list') throw httpError('This job has no list to price', 409);
  if (errand.status === 'cancelled') throw httpError('The customer cancelled this list', 409);
  if (errand.payment.status === 'paid') throw httpError('The customer has already paid: go and buy it', 409);
  if (errand.payment.status === 'pending' && Date.now() - errand.updatedAt < 60 * 1000) throw httpError('The customer has an M-Pesa prompt on their phone right now: wait a minute before changing the price', 409);
  const goods = Math.round(Number(amount));
  if (!(goods >= 50 && goods <= BUDGET_MAX)) throw httpError(`Enter the price of the goods: KSh 50 to ${ksh(BUDGET_MAX)}`);
  const service = serviceFee(goods);
  const where = require('../market/riders').positionOf(agent.worker) || { lat: errand.dropoff.lat, lng: errand.dropoff.lng };
  const ride = await require('../market/fieldwork').riderQuoteByRoad(geoPoint(where), { lat: errand.dropoff.lat, lng: errand.dropoff.lng });
  const delivery = ride.ok ? ride.fee : Number(site().fieldwork?.riderMin) || 150;
  const total = goods + service;
  errand.shopping.budget = goods;
  errand.shopping.quote = { amount: goods, service, delivery, note: clean(note, 300), at: new Date(), by: agent.name };
  errand.fee = { delivery, service };
  errand.km = ride.ok ? ride.km : 0;
  errand.payment = { method: 'mpesa', status: 'pending', amount: total, phone: errand.payment.phone || errand.dropoff.phone };
  errand.status = 'awaiting_payment';
  errand.history.push({ status: 'awaiting_payment', note: `${agent.name} priced your list: ${ksh(goods)} for the goods + ${ksh(service)} fee = ${ksh(total)} to pay now${errand.shopping.quote.note ? ` (“${errand.shopping.quote.note}”)` : ''}. Delivery ${ksh(delivery)}, paid on delivery` });
  // the job: what the agent earns, and the cash they collect on delivery
  const fee = delivery + service;
  await Task.updateOne({ _id: task._id }, { $set: { 'quote.amount': goods, 'quote.sentAt': new Date(), fee, pay: payouts.split(fee, delivery).net, collectCash: delivery, km: errand.km } });
  tell(errand, { en: `Your list is priced: pay ${ksh(total)}`, sw: `Orodha yako imepangiwa bei: lipa ${ksh(total)}` }, { en: `Goods ${ksh(goods)} + fee ${ksh(service)}. Check your phone for the M-Pesa prompt. Delivery ${ksh(delivery)} is paid on delivery.`, sw: 'Angalia simu yako kwa ombi la M-Pesa.' }, '🧾');
  if (site().demoPayments) {
    errand.payment.checkoutRequestId = `demo-${errand.no}-${Date.now().toString(36)}`;
    await errand.save();
    await settle(errand.payment.checkoutRequestId, { ok: true, receipt: `DEMO${crypto.randomBytes(3).toString('hex').toUpperCase()}` });
    return Errand.findById(errand._id);
  }
  try {
    const result = await stkPush({ phone: errand.payment.phone, amount: total, accountReference: errand.no.replace(/-/g, ''), description: 'Kapu shopping' });
    errand.payment.checkoutRequestId = result.CheckoutRequestID;
  } catch (err) {
    errand.payment.status = 'failed'; // the customer can pay from their errand page (“Pay now”)
    errand.payment.failReason = `M-Pesa didn’t start: ${err.response?.data?.errorMessage || err.message}`.slice(0, 200);
  }
  await errand.save();
  broadcast(errand);
  return errand;
};

// the customer paid for a priced list: the agent who priced it goes and buys it (up to what was paid for the goods)
async function listPaid(errand) {
  errand.status = 'assigned';
  errand.history.push({ status: 'assigned', note: `Paid. ${errand.worker?.name || 'Your agent'} is going to buy your list` });
  await errand.save();
  const job = await Task.findOneAndUpdate({ _id: errand.task, status: 'assigned' }, { $set: { budget: errand.shopping.budget, 'quote.paidAt': new Date() } }, { returnDocument: 'after' }).lean();
  if (job?.worker) {
    require('../market/alerts').send(job.worker, { kind: 'work', icon: '✅', link: '/work', title: { en: `Paid: go and buy ${errand.no}`, sw: `Imelipwa: nenda ununue ${errand.no}` }, body: { en: `The customer paid ${ksh(errand.shopping.budget)} for the goods. Buy the list, then tap “I’ve bought it”.`, sw: 'Mteja amelipa. Nunua bidhaa.' } }).catch(() => {});
    emitCustomer(String(job.worker), 'work:update', { _id: job._id });
  }
  broadcast(errand);
}

// POST /api/errands { kind, pickup, dropoff, parcel | shopping, notes, phone }
exports.create = asyncHandler(async (req, res) => {
  const me = req.customer;
  const body = req.body;
  if (body.kind === 'shopride') return createShopRide(req, res);
  const kind = body.kind === 'shopping' ? 'shopping' : 'parcel';
  const from = point(body.pickup);
  const to = point(body.dropoff);
  const quoteResult = await quote(kind, from, to, Math.round(Number(body.shopping?.budget) || 0), { size: body.parcel?.size, vehicle: body.parcel?.vehicle });
  if (!quoteResult.ok) throw httpError(quoteResult.reason);
  // Ride with us, the upfront price: the customer agreed to the fare they saw (parcel.expectedFare). If traffic or
  // demand pushed it up since, don't book: tell them the new price (code PRICE_CHANGED) so they can accept it.
  // If it went down, they simply pay less. The fare charged is always the one worked out here, never the app's.
  const agreedFare = Number(body.parcel?.expectedFare);
  if (kind === 'parcel' && Number.isFinite(agreedFare) && agreedFare > 0 && quoteResult.delivery > agreedFare) {
    const chosen = quoteResult.ride?.options.find((option) => option.vehicle === quoteResult.vehicle);
    const why = chosen?.surge?.reasons?.length ? ` (${chosen.surge.reasons.join(' and ')})` : '';
    throw Object.assign(httpError(`The price just went up to ${ksh(quoteResult.delivery)}${why}. Check the new price and tap Book again.`, 409), { code: 'PRICE_CHANGED' });
  }
  const pickupAddress = clean(body.pickup?.address, 200);
  const dropAddress = clean(body.dropoff?.address, 200);
  if (dropAddress.length < 5) throw httpError('Describe the delivery address (estate, street, building, landmark)');
  const recipientPhone = phoneOk(body.dropoff?.phone) || phoneOk(me.phone);
  if (!recipientPhone) throw httpError('Enter the phone number of whoever receives it');
  const errand = new Errand({
    no: newNo(), customer: me._id, customerName: me.name, customerPhone: me.phone, kind,
    pickup: { address: pickupAddress, name: clean(body.pickup?.name, 80), phone: phoneOk(body.pickup?.phone) || '', lat: from.lat, lng: from.lng, point: geoPoint(from) },
    dropoff: { address: dropAddress, name: clean(body.dropoff?.name, 80) || me.name, phone: recipientPhone, lat: to.lat, lng: to.lng },
    notes: clean(body.notes, 300), km: quoteResult.km, fee: { delivery: quoteResult.delivery, service: quoteResult.service },
  });
  if (kind === 'parcel') {
    const what = clean(body.parcel?.what, 120);
    if (what.length < 3) throw httpError('What are we picking up? (e.g. a bag of clothes, documents, a TV)');
    if (pickupAddress.length < 5) throw httpError('Describe the pick-up address (estate, street, building, landmark)');
    if (!errand.pickup.phone) throw httpError('Enter the phone number at the pick-up point');
    // the fare is the one just worked out here on the server, never a price sent by the app
    errand.parcel = { what, size: quoteResult.size, vehicle: quoteResult.vehicle, minutes: quoteResult.minutes, surge: quoteResult.surge?.multiplier || 1, surgeReasons: quoteResult.surge?.reasons || [], payer: body.parcel?.payer === 'sender' ? 'sender' : 'recipient' };
    errand.payment = { method: 'none', status: 'none' }; // nothing upfront: the rider is paid on delivery (or at pick-up)
    await errand.save();
    await openTask(errand);
    return res.status(201).json(view(errand));
  }
  // shopping
  const list = (Array.isArray(body.shopping?.list) ? body.shopping.list : []).slice(0, 30).map((item) => ({ name: clean(item?.name, 80), qty: clean(item?.qty, 20) || '1', note: clean(item?.note, 120) })).filter((item) => item.name.length >= 2);
  if (!list.length) throw httpError('Add at least one thing to buy');
  const budget = Math.round(Number(body.shopping?.budget) || 0);
  if (!(budget >= 100 && budget <= BUDGET_MAX)) throw httpError(`Set a budget from KSh 100 to ${ksh(BUDGET_MAX)}: the most the agent may spend`);
  errand.shopping = { list, budget, shopName: clean(body.shopping?.shopName, 100) };
  const payPhone = phoneOk(body.phone) || phoneOk(me.phone);
  if (!payPhone) throw httpError('Enter your M-Pesa number');
  errand.payment = { method: 'mpesa', status: 'pending', amount: quoteResult.payNow, phone: payPhone };
  errand.status = 'awaiting_payment';
  errand.history.push({ status: 'awaiting_payment', note: `${ksh(quoteResult.payNow)} to pay with M-Pesa (budget ${ksh(budget)} + service ${ksh(quoteResult.service)})` });
  if (site().demoPayments) {
    errand.payment.checkoutRequestId = `demo-${errand.no}`;
    await errand.save();
    await settle(errand.payment.checkoutRequestId, { ok: true, receipt: `DEMO${crypto.randomBytes(3).toString('hex').toUpperCase()}` });
    return res.status(201).json({ ...view(await Errand.findById(errand._id)), demo: true });
  }
  try {
    const stkPushResult = await stkPush({ phone: payPhone, amount: quoteResult.payNow, accountReference: errand.no.replace(/-/g, ''), description: 'Kapu errand' });
    errand.payment.checkoutRequestId = stkPushResult.CheckoutRequestID;
    await errand.save();
    res.status(201).json({ ...view(errand), message: stkPushResult.CustomerMessage || 'Check your phone and enter your M-Pesa PIN' });
  } catch (err) {
    throw httpError(`M-Pesa payment could not start: ${err.response?.data?.errorMessage || err.message}. Please try again.`, 502);
  }
});

// POST /api/errands { kind: 'shopride', sellers: [{ what, goodsAmount, weightKg, inspect, sellerId, sellerName, sellerPhone,
//   fromArea | from, address, stall }], mode: 'point' | 'door', pointId, to, dropAddress, repack, urgency, phone, notes }
// (one seller's fields at the top level, without "sellers", still work.) Paid now: only the inspection (+ repacking).
async function createShopRide(req, res) {
  const me = req.customer;
  const body = req.body;
  const list = (Array.isArray(body.sellers) && body.sellers.length ? body.sellers : [body]).slice(0, 5).map((item) => ({ ...item }));
  // each seller: what, where, and — when they're on Kapu — their real phone and shop location
  const Customer = require('../models/Customer');
  const onKapuIds = list.map((item) => item.sellerId).filter((id) => id && isId(id));
  const onKapuById = new Map(onKapuIds.length ? (await Customer.find({ _id: { $in: onKapuIds }, active: { $ne: false } }).select('name phone shopLocation').lean()).map((customer) => [String(customer._id), customer]) : []);
  const sellers = [];
  for (const [index, item] of list.entries()) {
    const who = list.length > 1 ? `Seller ${index + 1}: ` : '';
    const bought = itemsOf(item);
    if (!bought.items.length || bought.what.length < 3) throw httpError(`${who}What did you buy? (e.g. 2 pairs of shoes, a 32" TV, 10 kg of rice)`);
    const what = bought.what;
    const address = clean(item.address, 200);
    if (address.length < 3) throw httpError(`${who}Where exactly is it? (the shop’s name, building or street)`);
    const goodsAmount = bought.goods;
    if (goodsAmount > 1000000) throw httpError(`${who}That’s more than we can handle in one booking: call us`);
    let sellerPhone = phoneOk(item.sellerPhone) || '';
    let onKapu = null;
    if (item.sellerId && isId(item.sellerId)) {
      onKapu = onKapuById.get(String(item.sellerId)) || null;
      if (onKapu) {
        sellerPhone = onKapu.phone || sellerPhone;
        const shop = onKapu.shopLocation;
        if (!point(item.from) && shop?.public && shop.point?.coordinates) item.from = { lat: shop.point.coordinates[1], lng: shop.point.coordinates[0] };
      }
    }
    if (goodsAmount > 0 && !sellerPhone) throw httpError(`${who}Enter the seller’s phone number: we pay them for you once the item passes inspection`);
    sellers.push({ what, items: bought.items, address, stall: clean(item.stall, 40), goodsAmount, sellerPhone, onKapu, sellerName: clean(item.sellerName, 80) || onKapu?.shopLocation?.name || onKapu?.name || '', item });
  }
  const agent = await require('./workController').chosenAgent(body.agentId); // the shopping agent they booked, if any
  const priced = await shopRideGroupQuote({ ...body, sellers: sellers.map((seller) => ({ ...seller.item, items: seller.items })) });
  if (!priced.ok) throw httpError(priced.reason);
  const local = priced.pointFull;
  const door = priced.mode === 'door';
  const dropAddress = clean(body.dropAddress, 200);
  if (door && dropAddress.length < 5) throw httpError('Describe your door: estate, street, building, house number or a landmark');
  const recipientPhone = phoneOk(body.recipientPhone) || phoneOk(me.phone);
  if (!recipientPhone) throw httpError('Enter the phone number of whoever receives it');
  const payPhone = phoneOk(body.phone) || phoneOk(me.phone);
  if (!payPhone) throw httpError('Enter your M-Pesa number');
  const group = sellers.length > 1 ? `GR-${newNo().slice(3)}` : undefined;
  const now = priced.schedule.now;
  const errands = sellers.map((seller, index) => {
    const part = priced.parts[index];
    const partNow = part.inspection + part.repack;
    const doorFare = index === 0 ? priced.door?.fare || 0 : 0; // the door fare is charged once, on the first seller's part
    const errand = new Errand({
      no: newNo(), customer: me._id, customerName: me.name, customerPhone: me.phone, kind: 'shopride', ...(group ? { group } : {}),
      pickup: { address: [seller.address, seller.stall && !seller.address.toLowerCase().includes(seller.stall.toLowerCase()) ? seller.stall : ''].filter(Boolean).join(', '), name: seller.sellerName, phone: seller.sellerPhone, lat: part.priced.from.lat, lng: part.priced.from.lng, point: geoPoint(part.priced.from) },
      dropoff: door
        ? { address: dropAddress, name: me.name, phone: recipientPhone, lat: Number(body.to.lat), lng: Number(body.to.lng) }
        : { address: `${local.name}, ${local.address}`, name: me.name, phone: recipientPhone, lat: local.lat, lng: local.lng },
      notes: clean(body.notes, 300), km: index === 0 ? priced.door?.km : undefined,
      shopride: {
        what: seller.what, items: seller.items, sellerName: seller.sellerName, stall: seller.stall, ...(seller.onKapu ? { seller: seller.onKapu._id } : {}),
        ...((agent || part.agentFull) ? { agent: agent || { worker: part.agentFull.worker, name: part.agentFull.name, marketName: part.agentFull.marketName } } : {}),
        fromArea: part.fromArea, fromCbd: part.fromCbd, weightKg: part.weightKg, inspect: part.inspection > 0,
        repack: body.repack === true || body.repack === 'true', urgency: part.delivery.urgency || 'standard', mode: priced.mode,
        point: { id: local._id, name: local.name, area: local.area, address: local.address, hours: local.hours, phone: local.phone, lat: local.lat, lng: local.lng },
        price: { inspection: part.inspection, delivery: part.delivery.fee, repack: part.repack, door: doorFare, doorKm: index === 0 ? priced.door?.km : undefined, traffic: part.delivery.traffic, estimate: part.priced.estimate },
        ...(seller.goodsAmount > 0 ? { goods: { amount: seller.goodsAmount, delivery: door ? 0 : part.delivery.fee, status: 'waiting', phone: payPhone, seller: { phone: seller.sellerPhone } } } : {}),
        onDelivery: door ? part.delivery.fee + doorFare : 0,
      },
      fee: { delivery: part.delivery.fee + doorFare, service: partNow },
      payment: partNow > 0 ? { method: 'mpesa', status: 'pending', amount: partNow, phone: payPhone } : { method: 'none', status: 'none', amount: 0, phone: payPhone },
      status: now > 0 ? 'awaiting_payment' : 'open',
    });
    const parts = [part.inspection ? `inspection ${ksh(part.inspection)}` : '', part.repack ? `repacking ${ksh(part.repack)}` : ''].filter(Boolean).join(' + ');
    errand.history.push({ status: errand.status, note: `${partNow ? `${ksh(partNow)} now (${parts})` : 'Nothing to pay now'}${seller.goodsAmount ? ` · ${ksh(seller.goodsAmount)} for the goods${door ? '' : ` + ${ksh(part.delivery.fee)} delivery`} once our agent passes the inspection` : ''}${door ? ` · ${ksh(part.delivery.fee + doorFare)} delivery when it reaches your door` : ''}` });
    return errand;
  });
  if (now <= 0) {
    await Errand.bulkSave(errands); // one write for every seller's part
    await require('../market/agentSellers').link(sellers.map((seller, index) => ({ seller: seller.onKapu?._id, agent: agent?.worker || priced.parts[index]?.agentFull?.worker, how: 'shopride' })));
    for (const errand of errands) await openTask(errand);
    return res.status(201).json(await withGroup(view(errands[0]), errands[0]));
  }
  const sharedId = site().demoPayments ? `demo-${errands[0].no}` : null;
  if (sharedId) {
    for (const errand of errands) errand.payment.checkoutRequestId = sharedId;
    await Errand.bulkSave(errands);
    await settle(sharedId, { ok: true, receipt: `DEMO${crypto.randomBytes(3).toString('hex').toUpperCase()}` });
    const first = await Errand.findById(errands[0]._id);
    return res.status(201).json({ ...(await withGroup(view(first), first)), demo: true });
  }
  try {
    const stkPushResult = await stkPush({ phone: payPhone, amount: now, accountReference: errands[0].no.replace(/-/g, ''), description: 'Inspection' });
    for (const errand of errands) { errand.payment.checkoutRequestId = stkPushResult.CheckoutRequestID; await errand.save(); }
    return res.status(201).json({ ...(await withGroup(view(errands[0]), errands[0])), message: stkPushResult.CustomerMessage || 'Check your phone and enter your M-Pesa PIN' });
  } catch (err) {
    throw httpError(`M-Pesa payment could not start: ${err.response?.data?.errorMessage || err.message}. Please try again.`, 502);
  }
}

// the other sellers' parts of the same booking
async function withGroup(shown, errand) {
  if (!errand.group) return { ...shown, dueNow: errand.status === 'awaiting_payment' ? errand.payment?.amount || 0 : 0 };
  const siblings = await Errand.find({ group: errand.group }).sort({ createdAt: 1, _id: 1 }).select('no status shopride.what shopride.goods.amount shopride.goods.status shopride.sellerName').lean();
  const waiting = await Errand.find({ group: errand.group, status: 'awaiting_payment' }).select('payment.amount').lean();
  return { ...shown, dueNow: waiting.reduce((sum, item) => sum + (item.payment?.amount || 0), 0), group: { id: errand.group, parts: siblings.map((item) => ({ _id: item._id, no: item.no, status: item.status, what: item.shopride?.what || '', sellerName: item.shopride?.sellerName || '', goods: item.shopride?.goods?.amount || 0, goodsStatus: item.shopride?.goods?.status || '' })) } };
}

// ---------------- the goods: after our agent passes the inspection, the buyer pays (to Kapu), we pay the seller
async function promptGoods(errand) {
  const goods = errand.shopride.goods;
  const amount = (goods.amount || 0) + (goods.delivery || 0);
  goods.status = 'pending';
  goods.failReason = undefined;
  if (site().demoPayments) {
    goods.checkoutRequestId = `demo-goods-${errand._id}`;
    await errand.save();
    return settleGoods(goods.checkoutRequestId, { ok: true, receipt: `DEMOG${crypto.randomBytes(2).toString('hex').toUpperCase()}` });
  }
  try {
    const result = await stkPush({ phone: goods.phone || errand.payment.phone, amount, accountReference: errand.no.replace(/-/g, ''), description: 'Goods' });
    goods.checkoutRequestId = result.CheckoutRequestID;
  } catch (err) {
    goods.status = 'failed';
    goods.failReason = `The M-Pesa prompt couldn’t be sent: ${String(err.response?.data?.errorMessage || err.message).slice(0, 120)}`;
  }
  await errand.save();
  broadcast(errand);
  return errand;
}
async function settleGoods(checkoutRequestId, { ok, receipt, reason, amount }) {
  const errand = await Errand.findOne({ 'shopride.goods.checkoutRequestId': checkoutRequestId, 'shopride.goods.status': { $in: ok ? ['pending', 'failed'] : ['pending'] } });
  if (!errand) return 0;
  const goods = errand.shopride.goods;
  const due = (goods.amount || 0) + (goods.delivery || 0);
  if (ok && amount != null && amount !== '' && Number(amount) + 0.5 < due) { ok = false; reason = `M-Pesa received KSh ${Number(amount)} instead of KSh ${due}`; }
  if (ok) {
    goods.status = 'paid';
    goods.receipt = receipt;
    goods.paidAt = new Date();
    goods.seller = { ...(goods.seller?.toObject ? goods.seller.toObject() : goods.seller || {}), status: 'due' };
    errand.history.push({ status: errand.status, note: `Goods paid with M-Pesa ${receipt || ''}: ${ksh(goods.amount)}${goods.delivery ? ` + ${ksh(goods.delivery)} delivery` : ''}. We’re paying ${errand.shopride.sellerName || 'the seller'}; our agent then brings it`.trim() });
    tell(errand, { en: `Goods paid: ${errand.no}`, sw: `Bidhaa zimelipiwa: ${errand.no}` }, { en: `We’re paying ${errand.shopride.sellerName || 'the seller'} and our agent will bring it to our CBD hub.`, sw: 'Tunamlipa muuzaji na wakala wetu ataleta bidhaa.' }, '💵');
    // our agent at the shop: the item is paid for, take it
    const job = errand.task ? await Task.findById(errand.task).select('worker').lean() : null;
    if (job?.worker) require('../market/alerts').send(job.worker, { kind: 'order', icon: '💵', title: { en: `Paid: take the item (${errand.no})`, sw: `Imelipiwa: chukua bidhaa (${errand.no})` }, body: { en: `The buyer paid ${ksh(goods.amount)}. We’re paying the seller now.`, sw: `Mnunuzi amelipa ${ksh(goods.amount)}.` }, link: '/work' }).catch(() => {});
    require('../utils/realtime').emitAdmin('work:errand', { _id: errand._id, no: errand.no, sellerToPay: goods.amount });
  } else {
    goods.status = 'failed';
    goods.failReason = String(reason || 'The payment was not completed').slice(0, 200);
    errand.history.push({ status: errand.status, note: `Goods payment didn’t go through: ${goods.failReason}` });
  }
  await errand.save();
  broadcast(errand);
  return 1;
}

// POST /api/errands/:id/pay { phone }  (Shop & ride: the booking payment didn't go through — prompt again, for the
// whole booking. A prompt still on the phone isn't replaced for 90 seconds, so nothing can be paid twice.)
exports.payAgain = asyncHandler(async (req, res) => {
  let errand = await loadMine(req);
  const pricedList = errand.kind === 'shopping' && errand.shopping?.mode === 'list';
  if ((errand.kind !== 'shopride' && !pricedList) || errand.status !== 'awaiting_payment' || !['failed', 'pending'].includes(errand.payment.status)) throw httpError('Nothing to pay for this booking right now', 409);
  const all = errand.group ? await Errand.find({ group: errand.group, customer: req.customer._id, status: 'awaiting_payment' }) : [errand];
  if (errand.payment.status === 'pending' && errand.payment.checkoutRequestId) {
    if (Date.now() - errand.updatedAt < 90 * 1000) throw httpError('The M-Pesa prompt is still on your phone: enter your PIN, or wait a minute and try again', 409);
    // the old prompt: paid after all?
    try {
      const answer = await stkQuery(errand.payment.checkoutRequestId);
      if (String(answer?.ResultCode) === '0') {
        await settle(errand.payment.checkoutRequestId, { ok: true, receipt: answer.MpesaReceiptNumber || '' });
        errand = await Errand.findById(errand._id);
        return res.json(await withGroup(view(errand), errand));
      }
    } catch {
      /* no answer: send a new prompt */
    }
  }
  const phone = phoneOk(req.body.phone) || errand.payment.phone;
  const amount = all.reduce((sum, item) => sum + (item.payment.amount || 0), 0);
  if (site().demoPayments) {
    const demoId = `demo-${errand.no}-${Date.now().toString(36)}`;
    for (const item of all) { item.payment.status = 'pending'; item.payment.phone = phone; item.payment.checkoutRequestId = demoId; item.payment.failReason = undefined; if (item.shopride?.goods) item.shopride.goods.phone = phone; await item.save(); }
    await settle(demoId, { ok: true, receipt: `DEMO${crypto.randomBytes(3).toString('hex').toUpperCase()}` });
  } else {
    let result;
    try {
      result = await stkPush({ phone, amount, accountReference: errand.no.replace(/-/g, ''), description: pricedList ? 'Kapu shopping' : 'Inspection' });
    } catch (err) {
      throw httpError(`M-Pesa payment could not start: ${err.response?.data?.errorMessage || err.message}. Please try again.`, 502);
    }
    for (const item of all) {
      item.payment.status = 'pending';
      item.payment.phone = phone;
      item.payment.checkoutRequestId = result.CheckoutRequestID;
      item.payment.failReason = undefined;
      if (item.shopride?.goods) item.shopride.goods.phone = phone; // the goods prompt later goes to the number they pay with
      item.history.push({ status: item.status, note: `New M-Pesa prompt: ${ksh(amount)} to ${String(phone).replace(/^254/, '0')}` });
    }
    await Errand.bulkSave(all);
  }
  errand = await Errand.findById(errand._id);
  res.json({ ...(await withGroup(view(errand), errand)), message: 'Check your phone and enter your M-Pesa PIN' });
});

// POST /api/errands/:id/pay-goods { phone }  (the buyer: send the goods prompt again)
exports.payGoods = asyncHandler(async (req, res) => {
  const errand = await loadMine(req);
  const goods = errand.shopride?.goods;
  if (!goods?.amount || !['failed', 'pending'].includes(goods.status) || errand.status === 'cancelled') throw httpError('There’s nothing to pay for the goods right now', 409);
  const phone = phoneOk(req.body.phone);
  if (phone) goods.phone = phone;
  await promptGoods(errand);
  res.json(await withGroup(view(await Errand.findById(errand._id)), errand));
});

// M-Pesa result for a shopping errand (the callback and the status check)
async function settle(checkoutRequestId, result) {
  if (await settleGoods(checkoutRequestId, result)) return 1; // Shop & ride: the goods, after the inspection
  // one prompt can pay several errands (a Shop & ride booking from several sellers)
  const all = await Errand.find({ 'payment.checkoutRequestId': checkoutRequestId, 'payment.status': 'pending' });
  if (!all.length) return 0;
  for (const errand of all) await settleOne(errand, result);
  return all.length;
}
async function settleOne(errand, { ok, receipt, reason }) {
  if (ok) {
    errand.payment.status = 'paid';
    errand.payment.receipt = receipt;
    errand.payment.paidAt = new Date();
    errand.history.push({ status: errand.status, note: `Paid with M-Pesa ${receipt || ''}`.trim() });
    if (errand.status === 'cancelled') errand.refund = { amount: errand.payment.amount, status: 'due' }; // paid after giving up: refund it
    else if (errand.shopping?.mode === 'list' && errand.task) {
      await listPaid(errand);
      return 1;
    } else {
      await errand.save();
      await openTask(errand);
      return 1;
    }
  } else {
    errand.payment.status = 'failed';
    errand.payment.failReason = String(reason || 'The payment was not completed').slice(0, 200);
  }
  await errand.save();
  broadcast(errand);
  return 1;
}
exports.settle = settle;

const loadMine = async (req) => {
  if (!isId(req.params.id)) throw httpError('Errand not found', 404);
  const errand = await Errand.findOne({ _id: req.params.id, customer: req.customer._id });
  if (!errand) throw httpError('Errand not found', 404);
  return errand;
};

// GET /api/errands/mine
exports.mine = asyncHandler(async (req, res) => {
  const list = await Errand.find({ customer: req.customer._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json(list.map(view));
});

// GET /api/errands/:id  (also asks M-Pesa about a payment that's taking long)
exports.get = asyncHandler(async (req, res) => {
  let errand = await loadMine(req);
  if (errand.payment.status === 'pending' && errand.payment.checkoutRequestId && !errand.payment.checkoutRequestId.startsWith('demo-') && Date.now() - errand.updatedAt > 8000) {
    try {
      const stkQueryResult = await stkQuery(errand.payment.checkoutRequestId);
      if (stkQueryResult && String(stkQueryResult.ResultCode) !== '' && stkQueryResult.ResultCode !== undefined) {
        await settle(errand.payment.checkoutRequestId, String(stkQueryResult.ResultCode) === '0' ? { ok: true, receipt: '' } : { ok: false, reason: stkQueryResult.ResultDesc });
        errand = await Errand.findById(errand._id);
      }
    } catch {
      /* still waiting */
    }
  }
  const goods = errand.shopride?.goods;
  if (goods?.status === 'pending' && goods.checkoutRequestId && !goods.checkoutRequestId.startsWith('demo-') && Date.now() - errand.updatedAt > 8000) {
    try {
      const answer = await stkQuery(goods.checkoutRequestId);
      if (answer && answer.ResultCode !== undefined && String(answer.ResultCode) !== '') {
        await settleGoods(goods.checkoutRequestId, String(answer.ResultCode) === '0' ? { ok: true, receipt: answer.MpesaReceiptNumber || '' } : { ok: false, reason: answer.ResultDesc });
        errand = await Errand.findById(errand._id);
      }
    } catch {
      /* still waiting */
    }
  }
  res.json(await withGroup(view(errand), errand));
});

// POST /api/errands/:id/cancel { reason }  (before anyone has taken it)
exports.cancel = asyncHandler(async (req, res) => {
  const errand = await loadMine(req);
  const unpaidList = errand.shopping?.mode === 'list' && errand.payment.status !== 'paid' && ['open', 'assigned', 'awaiting_payment'].includes(errand.status);
  if (!['awaiting_payment', 'open'].includes(errand.status) && !unpaidList) throw httpError('Someone is already on it. Call them, or contact us to cancel.', 409);
  if (errand.task) {
    const job = await Task.findOneAndUpdate({ _id: errand.task, status: { $in: unpaidList ? ['open', 'assigned'] : ['open'] } }, { $set: { status: 'cancelled' } }, { returnDocument: 'after' }).lean();
    if (job?.worker) require('../market/alerts').send(job.worker, { kind: 'work', icon: '✖️', link: '/work', title: { en: `Cancelled: ${errand.no}`, sw: `Imeghairiwa: ${errand.no}` }, body: { en: 'The customer cancelled the shopping list before paying. Nothing to buy.', sw: 'Mteja ameghairi kabla ya kulipa.' } }).catch(() => {});
  }
  errand.status = 'cancelled';
  errand.cancelReason = clean(req.body.reason, 200) || 'Cancelled by the customer';
  if (errand.payment.status === 'paid') errand.refund = { amount: errand.payment.amount, status: 'due' };
  errand.history.push({ status: 'cancelled', note: errand.cancelReason });
  await errand.save();
  broadcast(errand);
  res.json(view(errand));
});

// POST /api/errands/:id/received  (the customer: got it)
exports.received = asyncHandler(async (req, res) => {
  const errand = await loadMine(req);
  if (!(errand.kind === 'shopride' ? ['at_point', 'out_for_delivery', 'delivered'] : ['picked_up', 'delivered']).includes(errand.status)) throw httpError('Nothing to confirm yet', 409);
  const task = await Task.findById(errand.task);
  if (task) {
    task.buyerConfirmedAt = new Date();
    if (task.riderConfirmedAt && !['done', 'cancelled'].includes(task.status)) require('./workController').finishTask(task);
    await task.save();
  }
  await complete(errand, 'Received: confirmed by the customer');
  res.json(view(await Errand.findById(errand._id)));
});

// the errand is finished: shopping change goes back to the customer
async function complete(error, note) {
  if (error.status === 'done') return error;
  error.status = 'done';
  if (error.kind === 'shopping' && error.payment.status === 'paid') {
    const change = (error.shopping.budget || 0) - (error.shopping.spent || 0);
    if (change > 0) error.refund = { amount: change, status: 'due' };
  }
  error.history.push({ status: 'done', note: `${note}${error.refund?.status === 'due' ? `. ${ksh(error.refund.amount)} of the budget wasn’t spent: it’s being refunded to your M-Pesa` : ''}` });
  await error.save();
  broadcast(error);
  return error;
}
exports.complete = complete;

// worker events → the errand (called from workController)
// riders' GPS pings for many errands at once: one read and one bulk write (the hottest path: every ~20 s per rider)
exports.onLive = async (tasks) => {
  const byErrand = new Map(tasks.filter((task) => task.errand).map((task) => [String(task.errand), task]));
  if (!byErrand.size) return;
  const list = await Errand.find({ _id: { $in: [...byErrand.keys()] }, status: { $in: ['assigned', 'picked_up'] } });
  const moved = list.filter((errand) => errand.worker?.name).map((errand) => {
    const task = byErrand.get(String(errand._id));
    return { errand, set: { 'worker.live': task.live, ...(task.eta?.minutes != null ? { 'worker.eta': task.eta } : {}) } };
  });
  if (!moved.length) return;
  await Errand.bulkWrite(moved.map(({ errand, set }) => ({ updateOne: { filter: { _id: errand._id }, update: { $set: set } } })), { ordered: false });
  for (const { errand, set } of moved) {
    errand.set(set);
    broadcast(errand);
  }
};

exports.onTask = async (task, event, extra = {}) => {
  if (!task.errand) return;
  const errand = await Errand.findById(task.errand);
  if (!errand || errand.status === 'cancelled') return;
  const who = task.workerName || 'Our team';
  if (event === 'live') { // the rider moved: where they are and when they'll arrive (no history entry)
    if (!errand.worker?.name || !['assigned', 'picked_up'].includes(errand.status)) return;
    const set = { 'worker.live': task.live, ...(task.eta?.minutes != null ? { 'worker.eta': task.eta } : {}) };
    await Errand.updateOne({ _id: errand._id }, { $set: set }); // targeted: this runs on every GPS ping
    errand.set(set);
    broadcast(errand);
    return;
  }
  if (event === 'inspected' && errand.kind === 'shopride') {
    errand.shopride.inspection = { passed: !!extra.passed, note: extra.note || '', at: new Date() };
    if (extra.passed) {
      errand.history.push({ status: errand.status, note: `✅ ${who} inspected it: right item, quality and quantity${extra.note ? ` (${extra.note})` : ''}` });
      await errand.save();
      if (errand.shopride.goods?.amount) {
        const goods = errand.shopride.goods;
        tell(errand, { en: `Inspection passed: pay ${ksh(goods.amount + (goods.delivery || 0))}`, sw: `Ukaguzi umepita: lipa ${ksh(goods.amount + (goods.delivery || 0))}` }, { en: `Check your phone: the M-Pesa prompt for the goods${goods.delivery ? ' and delivery' : ''}. We pay ${errand.shopride.sellerName || 'the seller'} at once.`, sw: 'Angalia simu yako: lipa bidhaa kwa M-Pesa.' }, '✅');
        await promptGoods(errand);
        return errand;
      }
      tell(errand, { en: `Inspection passed: ${errand.no}`, sw: `Ukaguzi umepita: ${errand.no}` }, { en: `${who} checked it: right item, quality and quantity.`, sw: 'Bidhaa ni sahihi.' }, '✅');
    } else {
      errand.status = 'cancelled';
      errand.cancelReason = `Failed inspection: ${extra.note || 'not as ordered'}`;
      if (errand.shopride.goods) errand.shopride.goods.status = 'cancelled';
      errand.history.push({ status: 'cancelled', note: `❌ ${who} found a problem: ${extra.note || 'not as ordered'}. Not bought: you don’t pay for the goods` });
      tell(errand, { en: `Inspection failed: ${errand.no}`, sw: `Ukaguzi haukupita: ${errand.no}` }, { en: `${extra.note || 'It isn’t as ordered'}. We didn’t buy it: you pay nothing for the goods.`, sw: 'Hatukununua: hulipi bidhaa.' }, '❌');
    }
    await errand.save();
    broadcast(errand);
    return errand;
  }
  // Shop & ride: the agent's job ends at the CBD hub (done = dropped there); the booking ends when the buyer collects
  // it at their pickup point or it reaches their door
  if (errand.kind === 'shopride' && event === 'done') {
    if (!['assigned', 'picked_up'].includes(errand.status)) return errand;
    event = 'delivered';
  }
  if (event === 'assigned') {
    errand.status = 'assigned';
    errand.worker = { name: task.workerName, phone: task.workerPhone, vehicle: extra.vehicle || '', plate: extra.plate || '', role: extra.role || '', tipPhone: extra.tipPhone || task.workerPhone, ...(extra.stars ? { stars: extra.stars } : {}), ...(extra.eta ? { eta: extra.eta } : {}), ...(extra.live ? { live: extra.live } : {}) };
    errand.history.push({ status: 'assigned', note: errand.shopping?.mode === 'list' ? `${who} took your list: they’ll check it and send you the price (they may call you)` : `${who} is on the way${errand.kind === 'shopping' ? ' to the shop' : ' to pick it up'}` });
    tell(errand, { en: `${who} took your errand ${errand.no}`, sw: `${who} amechukua kazi yako ${errand.no}` }, { en: errand.kind === 'shopping' ? 'They’re heading to the shop to buy your list.' : 'They’re heading to the pick-up point.', sw: errand.kind === 'shopping' ? 'Anaelekea dukani kununua bidhaa zako.' : 'Anaelekea mahali pa kuchukua mzigo.' });
  } else if (event === 'open') {
    errand.status = 'open';
    errand.worker = {};
    if (errand.shopping?.mode === 'list' && errand.payment.status !== 'paid') { // not paid yet: the next agent prices it again
      errand.shopping.quote = undefined;
      errand.payment = { method: 'mpesa', status: 'none', phone: errand.payment.phone };
    }
    errand.history.push({ status: 'open', note: 'Looking for someone else near you' });
  } else if (event === 'picked_up') {
    errand.status = 'picked_up';
    if (errand.kind === 'shopride') {
      errand.history.push({ status: 'picked_up', note: `${who} collected it${errand.shopride.inspect ? ' and checked it' : ''}${errand.shopride.repack ? ', repackaged it where needed' : ''}, and is bringing it to our CBD hub` });
      tell(errand, { en: `Collected: ${errand.no}`, sw: `Imechukuliwa: ${errand.no}` }, { en: `${who} has your items${errand.shopride.inspect ? ' (inspected)' : ''} and is taking them to our CBD hub.`, sw: `${who} ana bidhaa zako na anazipeleka kituo chetu cha CBD.` }, '📦');
    } else if (errand.kind === 'shopping') {
      errand.shopping.spent = extra.spent;
      errand.shopping.receipt = extra.receipt || '';
      errand.history.push({ status: 'picked_up', note: `${who} bought your items: ${ksh(extra.spent)} spent of your ${ksh(errand.shopping.budget)} budget${extra.receipt ? ` (receipt ${extra.receipt})` : ''}` });
      tell(errand, { en: `Your shopping is bought (${ksh(extra.spent)})`, sw: `Bidhaa zako zimenunuliwa (${ksh(extra.spent)})` }, { en: `${who} is bringing it. Pay the ${ksh(errand.fee.delivery)} delivery fee when it arrives.`, sw: `${who} anakuletea. Lipa ${ksh(errand.fee.delivery)} ya usafiri ukipokea.` }, '🛒');
    } else {
      errand.history.push({ status: 'picked_up', note: `${who} collected the parcel` });
      tell(errand, { en: `Parcel collected: ${errand.no}`, sw: `Mzigo umechukuliwa: ${errand.no}` }, { en: `${who} is on the way to ${errand.dropoff.name || 'the recipient'}.`, sw: `${who} yuko njiani.` }, '📦');
    }
  } else if (event === 'on_the_way') {
    errand.history.push({ status: 'on_the_way', note: `🛵 ${who} is on the way to ${errand.dropoff?.name || 'you'}` });
    tell(errand, { en: `${who} is on the way: ${errand.no}`, sw: `${who} yuko njiani: ${errand.no}` }, { en: 'Keep your phone near: they’ll call when they’re close.', sw: 'Weka simu karibu: atakupigia akikaribia.' }, '🛵');
  } else if (event === 'arrived') {
    if (!errand.history.some((entry) => entry.status === 'on_the_way')) errand.history.push({ status: 'on_the_way', note: `🛵 ${who} is on the way` });
    errand.history.push({ status: 'arrived', note: `📍 ${who} has arrived` });
    tell(errand, { en: `${who} has arrived: ${errand.no}`, sw: `${who} amefika: ${errand.no}` }, { en: 'Please meet them at the drop-off.', sw: 'Tafadhali mpokee.' }, '📍');
  } else if (event === 'delivered' && errand.kind === 'shopride') {
    // the agent brought it to the CBD hub: our team sends it on to the buyer's area (or their door)
    errand.status = 'at_hub';
    errand.history.push({ status: 'at_hub', note: `At our CBD hub. Next: ${errand.shopride.mode === 'door' ? 'your door' : errand.shopride.point.name}` });
    tell(errand, { en: `At our CBD hub: ${errand.no}`, sw: `Iko kituo chetu cha CBD: ${errand.no}` }, { en: errand.shopride.mode === 'door' ? 'It goes out to your door next.' : `It goes to ${errand.shopride.point.name} next. We’ll tell you when it’s ready to collect.`, sw: 'Tutakujulisha ikiwa tayari.' }, '🏢');
  } else if (event === 'delivered') {
    errand.status = 'delivered';
    errand.history.push({ status: 'delivered', note: `${who} says it’s delivered. Got it? Confirm below` });
    tell(errand, { en: `Delivered: ${errand.no}`, sw: `Imefika: ${errand.no}` }, { en: 'Got everything? Tap “Yes, I received it”.', sw: 'Umepokea kila kitu? Bonyeza “Ndiyo, nimepokea”.' }, '✅');
  } else if (event === 'done') {
    return complete(errand, 'Delivered and confirmed');
  }
  await errand.save();
  broadcast(errand);
  return errand;
};

// ---------------------------------------------------------------- admin
// Shop & ride after the hub: which step may follow which
const SHOPRIDE_STEPS = {
  at_hub: { from: ['assigned', 'picked_up'] }, // brought in by the team (the agent's app normally does this)
  at_point: { from: ['at_hub'], mode: 'point' },
  out_for_delivery: { from: ['at_hub'], mode: 'door' },
  delivered: { from: ['out_for_delivery'], mode: 'door' },
  seller_paid: { from: ['assigned', 'picked_up', 'at_hub', 'at_point', 'out_for_delivery', 'delivered', 'done'] },
  collected: { from: ['at_point'], mode: 'point' },
};
async function shopRideStep(errand, action, by, extra) {
  const step = SHOPRIDE_STEPS[action];
  if (!step.from.includes(errand.status) || (step.mode && step.mode !== errand.shopride.mode)) throw httpError(`This booking is “${errand.status.replace(/_/g, ' ')}”: it can’t be marked ${action.replace(/_/g, ' ')} now`, 409);
  const where = errand.shopride.point;
  if (action === 'seller_paid') {
    const goods = errand.shopride.goods;
    if (goods?.status !== 'paid' || goods.seller?.status === 'paid') throw httpError('There’s no seller payment due on this booking', 409);
    goods.seller.status = 'paid';
    goods.seller.ref = clean(extra?.ref, 40);
    goods.seller.at = new Date();
    errand.history.push({ status: errand.status, note: `Paid ${errand.shopride.sellerName || 'the seller'} ${ksh(goods.amount)}${goods.seller.ref ? ` (M-Pesa ${goods.seller.ref})` : ''}` });
    await errand.save();
    broadcast(errand);
    return errand;
  }
  if (action === 'at_hub') {
    errand.status = 'at_hub';
    errand.history.push({ status: 'at_hub', note: 'At our CBD hub' });
  } else if (action === 'at_point') {
    // the message: where to collect it
    errand.status = 'at_point';
    errand.shopride.readyAt = new Date();
    const text = `Your items are ready at ${where.name}: ${where.address}${where.hours ? ` (${where.hours})` : ''}. Show booking ${errand.no}.`;
    errand.history.push({ status: 'at_point', note: text });
    require('../market/alerts').send(errand.customer, { kind: 'order', icon: '📍', title: { en: `Ready to collect at ${where.name}`, sw: `Tayari kuchukuliwa ${where.name}` }, body: { en: text, sw: `Bidhaa zako ziko tayari ${where.name}: ${where.address}. Onyesha nambari ${errand.no}.` }, link: `/errands/${errand._id}` }).catch(() => {});
    pickupEmail(errand, text);
  } else if (action === 'out_for_delivery') {
    errand.status = 'out_for_delivery';
    errand.history.push({ status: 'out_for_delivery', note: `On the way to your door from ${where.name}` });
    tell(errand, { en: `On the way to your door: ${errand.no}`, sw: `Inakuja mlangoni: ${errand.no}` }, { en: 'Keep your phone near: our rider will call when close.', sw: 'Weka simu karibu.' }, '🛵');
  } else if (action === 'delivered') {
    errand.status = 'delivered';
    errand.shopride.deliveryCollected = true;
    errand.history.push({ status: 'delivered', note: `Delivered to your door${errand.shopride.onDelivery ? `; ${ksh(errand.shopride.onDelivery)} delivery fee paid on arrival` : ''}. Got it? Confirm below` });
    tell(errand, { en: `Delivered: ${errand.no}`, sw: `Imefika: ${errand.no}` }, { en: 'Got everything? Tap “Yes, I received it”.', sw: 'Umepokea? Bonyeza “Ndiyo, nimepokea”.' }, '✅');
  } else if (action === 'collected') {
    await complete(errand, `Collected at ${where.name} (${by})`);
    return errand;
  }
  await errand.save();
  broadcast(errand);
  return errand;
}
async function pickupEmail(errand, text) {
  try {
    const customer = await require('../models/Customer').findById(errand.customer).select('email').lean();
    if (!customer?.email || /\.test$/i.test(customer.email)) return;
    require('../utils/mailer').sendMail({ to: customer.email, subject: `Ready to collect: ${errand.no} at ${errand.shopride.point.name}`, text: `${text}\n\n${site().url}/errands/${errand._id}`, html: `<p>${text.replace(/[<>&]/g, '')}</p><p><a href="${site().url}/errands/${errand._id}">See your booking</a></p>` });
  } catch {
    /* the in-app message and push went out anyway */
  }
}

// GET /api/errands/admin/list?status=&refunds=1&kind=shopride
exports.adminList = asyncHandler(async (req, res) => {
  const query = {};
  if (['parcel', 'shopping', 'shopride'].includes(req.query.kind)) query.kind = req.query.kind;
  if (req.query.sellersDue === '1') query['shopride.goods.seller.status'] = 'due';
  if (req.query.refunds === '1') query['refund.status'] = 'due';
  else if (req.query.status) query.status = String(req.query.status);
  const list = await Errand.find(query).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((item) => ({ ...view(item), customerName: item.customerName, customerPhone: item.customerPhone })));
});
// POST /api/errands/admin/:id { action: 'refunded', ref } · Shop & ride: { action: 'at_hub' | 'at_point' | 'out_for_delivery' | 'delivered' | 'collected' }
exports.adminAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Errand not found', 404);
  const errand = await Errand.findById(req.params.id);
  if (!errand) throw httpError('Errand not found', 404);
  if (errand.kind === 'shopride' && SHOPRIDE_STEPS[req.body.action]) {
    await shopRideStep(errand, req.body.action, req.staff?.name || req.user?.name || 'Our team', req.body);
    require('../security/audit').audit(req, 'errand.shopride_step', { target: `errand:${errand._id}`, detail: `${errand.no} ${req.body.action}` });
    return res.json(view(errand));
  }
  if (req.body.action !== 'refunded' || errand.refund?.status !== 'due') throw httpError('Nothing to refund', 409);
  errand.refund.status = 'refunded';
  errand.refund.ref = clean(req.body.ref, 40);
  errand.refund.at = new Date();
  errand.history.push({ status: errand.status, note: `Refunded ${ksh(errand.refund.amount)} to M-Pesa${errand.refund.ref ? ` (${errand.refund.ref})` : ''}` });
  await errand.save();
  broadcast(errand);
  res.json(view(errand));
});

// ---------------------------------------------------------------- our pickup points (admin)
// GET /api/errands/admin/pickup-points · POST (new) · PUT /api/errands/admin/pickup-points/:id
// { name, area, address, landmark, hours, phone, lat, lng, hub, active }
const PickupPoint = require('../models/PickupPoint');
exports.adminPoints = asyncHandler(async (req, res) => {
  res.json((await PickupPoint.find().sort({ hub: -1, area: 1, order: 1, name: 1 }).lean()).map((item) => ({ ...pickupPoints.plain(item), active: item.active })));
});
function pointFields(body, partial) {
  const out = {};
  for (const [key, max] of [['name', 80], ['area', 60], ['address', 200], ['landmark', 120], ['hours', 80], ['phone', 20]]) if (body[key] !== undefined) out[key] = clean(body[key], max);
  if (!partial && (!out.name || out.name.length < 3)) throw httpError('Name the pickup point');
  if (!partial && (!out.area || out.area.length < 2)) throw httpError('Which area of Nairobi is it in?');
  if (body.lat !== undefined || body.lng !== undefined || !partial) {
    const where = point(body);
    if (!where || !shopRide.inNairobi(where, shopRideRates())) throw httpError('Put the pickup point on the map, in Nairobi');
    out.point = geoPoint(where);
  }
  if (body.hub !== undefined) out.hub = body.hub === true;
  if (body.active !== undefined) out.active = body.active !== false;
  return out;
}
exports.adminSavePoint = asyncHandler(async (req, res) => {
  let saved;
  if (req.params.id) {
    if (!isId(req.params.id)) throw httpError('Pickup point not found', 404);
    saved = await PickupPoint.findByIdAndUpdate(req.params.id, { $set: pointFields(req.body, true) }, { returnDocument: 'after', runValidators: true });
    if (!saved) throw httpError('Pickup point not found', 404);
  } else saved = await PickupPoint.create(pointFields(req.body, false));
  pickupPoints.reset();
  require('../security/audit').audit(req, 'pickup_point.saved', { target: `pickup:${saved._id}`, detail: `${saved.area}: ${saved.name}` });
  res.status(req.params.id ? 200 : 201).json({ ...pickupPoints.plain(saved), active: saved.active });
});
