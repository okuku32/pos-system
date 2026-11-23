// Our field team: riders deliver orders; shopping agents shop for buyers and check items at the shop before dispatch.
//
//  1. A buyer picks "Kapu rider" and/or "Inspection" at checkout (they pay for both; see market/fieldwork.js).
//  2. When the seller confirms the order, a job opens: inspection first (if chosen), then delivery.
//  3. Approved riders / agents near the shop see the job (pay, pickup, destination) and accept it.
//  4. Riders mark "picked up" and "delivered"; agents record whether the items are right (item, size, colour, quality).
//  5. Finished jobs are paid every week (Admin → Field team → Weekly pay).
const mongoose = require('mongoose');
const Task = require('../models/Task');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const geo = require('../market/geo');
const { weekOf, weekLabel } = require('../market/fieldwork');
const payouts = require('../market/payouts');
const { emitCustomer, emitAdmin } = require('../utils/realtime');

const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);
const MAX_ACTIVE = 3;
const KIND = { rider: 'delivery', agent: 'inspection' };
// which jobs someone sees: riders deliver (and inspect when the job includes it); agents inspect (and deliver
// the jobs that include an inspection)
// courier jobs (take it to a bus / courier office, send it): agents and riders
const jobsFor = (role) => (role === 'partner' ? { kind: 'verification', worker: { $exists: false } } : role === 'rider' ? { kind: 'delivery' } : { $or: [{ kind: 'inspection' }, { kind: 'shopping' }, { kind: 'delivery', 'courier.company': { $exists: true } }] });
const errands = () => require('./errandController');
const VEHICLES = ['Motorbike', 'Bicycle', 'Tuk-tuk', 'Car', 'Van / pickup', 'On foot'];
const orders = () => require('./orderController');
const riders = () => require('../market/riders');
const deliveries = () => require('../market/deliveries');
const mainLeg = (task) => !(task.leg > 1); // the first part of an order (or an order shipped in one go): drives order.rider

// A job booked with a chosen shopping agent is theirs alone for this long; then it's offered to everyone near
const RESERVE_MS = 10 * 60 * 1000;
exports.RESERVE_MS = RESERVE_MS;
// the agent a buyer picked on a market's page (agentId from the checkout / booking): approved, still an agent
exports.chosenAgent = async (agentId) => {
  if (!agentId) return null;
  if (!isId(agentId)) throw httpError('Choose your shopping agent again on the market’s page');
  const agent = await Customer.findOne({ _id: agentId, 'worker.role': 'agent', 'worker.status': 'approved', active: { $ne: false } }).select('name phone worker.marketName').lean();
  if (!agent) throw httpError('That shopping agent isn’t available any more. Choose another one on the market’s page, or leave it to us.', 409);
  return { worker: agent._id, name: agent.name, marketName: agent.worker?.marketName || '', phone: agent.phone || '' };
};
// The shopping agent who inspects a seller's goods when the buyer asks for it: an agent of the market the seller
// trades in (available first, then the best rated). Only that market's agents are suggested; a seller who isn't in
// one of our markets (or whose market has no agent yet) gets no suggestion: the nearest agent takes the job then.
// shops: [{ _id: sellerId, shopLocation }] → Map(sellerId → { worker, name, marketName, marketSlug, rating })
const bestAgentsOf = async (marketIds) => {
  const ids = [...new Set((marketIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const Market = require('../models/Market');
  const [agents, markets] = await Promise.all([
    Customer.find({ 'worker.market': { $in: ids }, 'worker.role': 'agent', 'worker.status': 'approved', active: { $ne: false } })
      .select('name phone worker.market worker.marketName worker.available worker.rating').sort({ 'worker.available': -1, 'worker.rating.avg': -1, 'worker.rating.count': -1 }).lean(),
    Market.find({ _id: { $in: ids } }).select('slug name').lean(),
  ]);
  const marketOf = new Map(markets.map((market) => [String(market._id), market]));
  const out = new Map();
  for (const agent of agents) {
    const key = String(agent.worker.market);
    if (!out.has(key)) out.set(key, { worker: agent._id, name: agent.name, phone: agent.phone || '', marketName: agent.worker.marketName || marketOf.get(key)?.name || '', marketSlug: marketOf.get(key)?.slug || '', rating: agent.worker?.rating?.count ? { avg: agent.worker.rating.avg, count: agent.worker.rating.count } : null });
  }
  return out;
};
exports.bestAgentsOf = bestAgentsOf;
exports.marketAgentsFor = async (shops) => {
  const out = new Map();
  const list = (shops || []).filter((shop) => shop?._id);
  if (!list.length) return out;
  const Market = require('../models/Market');
  const marketIds = [...new Set(list.map((shop) => shop.shopLocation?.market).filter(Boolean).map(String))];
  // every market's agents in one read, best first
  const [agents, markets] = await Promise.all([
    marketIds.length ? Customer.find({ 'worker.market': { $in: marketIds }, 'worker.role': 'agent', 'worker.status': 'approved', active: { $ne: false } })
      .select('name phone worker.market worker.marketName worker.available worker.rating').sort({ 'worker.available': -1, 'worker.rating.avg': -1, 'worker.rating.count': -1 }).lean() : [],
    marketIds.length ? Market.find({ _id: { $in: marketIds } }).select('slug name').lean() : [],
  ]);
  const slugOf = new Map(markets.map((market) => [String(market._id), market]));
  const bestOf = new Map();
  for (const agent of agents) if (!bestOf.has(String(agent.worker.market))) bestOf.set(String(agent.worker.market), agent);
  const view = (agent) => ({ worker: agent._id, name: agent.name, phone: agent.phone || '', marketName: agent.worker?.marketName || slugOf.get(String(agent.worker?.market))?.name || '', marketSlug: slugOf.get(String(agent.worker?.market))?.slug || '', rating: agent.worker?.rating?.count ? { avg: agent.worker.rating.avg, count: agent.worker.rating.count } : null });
  for (const shop of list) {
    const best = bestOf.get(String(shop.shopLocation?.market || ''));
    if (best) out.set(String(shop._id), view(best));
  }
  return out;
};
const publicAgent = (agent) => (agent ? { _id: agent.worker, name: agent.name, marketName: agent.marketName, marketSlug: agent.marketSlug, rating: agent.rating } : null);
exports.publicAgent = publicAgent;
const reservation = (chosen) => (chosen?.worker ? { worker: chosen.worker, name: chosen.name, marketName: chosen.marketName || '', until: new Date(Date.now() + RESERVE_MS) } : undefined);
exports.reservation = reservation;
// a job reserved for someone else isn't shown or given to me until their time is up
const notReservedForOthers = (me) => ({ $or: [{ 'preferred.until': { $exists: false } }, { 'preferred.until': { $lte: new Date() } }, { 'preferred.worker': me }] });
// the jobs I can take: those for my role, plus any job a buyer booked me for (e.g. a Shop & ride job for an agent)
// my vehicle: a Ride with us job names the vehicles that may take it; jobs without `vehicles` are for anyone
const forMyVehicle = (vehicle) => ({ $or: [{ vehicles: { $exists: false } }, { vehicles: { $size: 0 } }, { vehicles: vehicle || '' }] });
const jobsForMe = (role, me, vehicle) => ({ $and: [{ $or: [jobsFor(role), ...(role === 'agent' ? [{ 'preferred.worker': me }] : [])] }, notReservedForOthers(me), forMyVehicle(vehicle)] });

// ---------------------------------------------------------------- order → jobs (called by the order code)
async function shopOf(order) {
  const customer = await Customer.findById(order.seller).select('name phone shopLocation').lean();
  const sl = customer?.shopLocation;
  if (!sl?.point?.coordinates) return null;
  return { name: sl.name || customer.name, address: sl.address || '', area: sl.area || '', point: sl.point, phone: customer.phone || '' };
}
// Safe deal: the partner shop where the item is checked (and where our rider collects it)
const partnerShopOf = (order) => {
  const verification = order.verification || {};
  if (verification.lat == null) return null;
  return { name: verification.partnerName, address: verification.address || '', area: verification.area || '', point: { type: 'Point', coordinates: [verification.lng, verification.lat] }, phone: verification.partnerPhone || '' };
};
const DROPOFF_DAYS = 3; // the seller has this long to take the item to the partner shop

// the seller confirmed a Safe deal: the partner shop gets the verification job; the seller is told where to take the item
async function openVerification(order) {
  const shop = partnerShopOf(order);
  if (!shop) return null;
  const Listing = require('../models/Listing');
  const ads = await Listing.find({ _id: { $in: order.items.map((item) => item.listing) } }).select('attrs condition').lean();
  const byId = new Map(ads.map((ad) => [String(ad._id), ad]));
  const partner = await Customer.findById(order.verification.partner).select('name phone').lean();
  const task = await Task.create({
    kind: 'verification', order: order._id, orderNo: order.orderNo, pickup: shop, status: 'assigned', acceptedAt: new Date(),
    worker: order.verification.partner, workerName: partner?.name || order.verification.partnerName, workerPhone: partner?.phone || '',
    items: order.items.map((item) => ({ title: item.title, qty: item.qty, image: item.image, attrs: { ...(byId.get(String(item.listing))?.attrs || {}), ...(item.condition ? { Condition: item.condition } : {}) } })),
    buyerNotes: `Seller: ${order.sellerName}. Price KSh ${order.subtotal.toLocaleString('en-KE')}`,
    fee: order.verification.fee, pay: order.verification.pay,
  });
  order.verification.task = task._id;
  order.verification.status = 'awaiting_dropoff';
  order.verification.dropoffBy = new Date(Date.now() + DROPOFF_DAYS * 24 * 3600000);
  order.history.push({ status: order.status, by: 'system', note: `🛡️ Take the item to ${shop.name}, ${shop.address || shop.area} within ${DROPOFF_DAYS} days for verification` });
  emitCustomer(String(order.verification.partner), 'work:new', { _id: task._id, kind: 'verification', pay: task.pay, shop: shop.name, orderNo: order.orderNo });
  emitAdmin('work:update', { _id: task._id });
  return task;
}

const itemsOf = (order) => order.items.map((item) => ({ title: item.title, qty: item.qty, image: item.image, attrs: item.attrs }));

// tell approved, available riders / agents near the shop that a job came up
exports.alertNearby = (task, options) => alertNearby(task, options);
async function alertNearby(task, { everyone = false } = {}) {
  const [lng, lat] = task.pickup.point.coordinates;
  // booked with a chosen shopping agent: only they are told, until their time is up (then runWaves tells everyone)
  if (!everyone && task.preferred?.worker && new Date(task.preferred.until) > new Date()) {
    await Task.updateOne({ _id: task._id }, { $set: { matched: [{ worker: task.preferred.worker, at: new Date() }], matchedCount: 1, wave2At: task.preferred.until } });
    emitCustomer(String(task.preferred.worker), 'work:new', { _id: task._id, kind: task.kind, pay: task.pay, collectCash: task.collectCash || 0, area: task.pickup.area, shop: task.pickup.name, booked: true });
    // a 🔔 (and a phone push): what, where, and how long they have to take it
    const minutes = Math.max(1, Math.round((new Date(task.preferred.until) - Date.now()) / 60000));
    const what = task.kind === 'inspection' ? 'verify an order' : task.kind === 'delivery' ? 'deliver an order' : 'shop & ride';
    require('../market/alerts').send(task.preferred.worker, {
      kind: 'work', icon: '🧑‍💼', link: '/work',
      title: { en: `A buyer booked you to ${what}: ${task.orderNo}`, sw: `Mnunuzi amekuchagua: ${task.orderNo}` },
      body: {
        en: `${task.pickup.name}${task.pickup.area ? `, ${task.pickup.area}` : ''}. You earn KSh ${task.pay}. It’s yours for ${minutes} minutes: open your jobs and tap “Take it”.`,
        sw: `${task.pickup.name}${task.pickup.area ? `, ${task.pickup.area}` : ''}. Utapata KSh ${task.pay}. Ni yako kwa dakika ${minutes}: fungua kazi zako ubonyeze “Chukua”.`,
      },
    }).catch(() => {});
    emitAdmin('work:update', { _id: task._id });
    return [];
  }
  // rider deliveries: offer it to the best-matched riders first (nearest, with room, well rated)
  if (task.kind === 'delivery' && !task.courier?.company) {
    const best = await riders().match(task);
    const first = best.slice(0, riders().FIRST_WAVE);
    const matched = first.map((item) => ({ worker: item._id, km: item.km, eta: item.eta, at: new Date() }));
    const later = best.length > first.length;
    await Task.updateOne({ _id: task._id }, { $set: { matched, matchedCount: best.length, ...(later ? { wave2At: new Date(Date.now() + riders().WAVE_GAP_MS) } : {}) }, ...(later ? {} : { $unset: { wave2At: 1 } }) });
    for (const item of first) emitCustomer(String(item._id), 'work:new', { _id: task._id, kind: task.kind, pay: task.pay, collectCash: task.collectCash || 0, area: task.pickup.area, shop: task.pickup.name, to: task.dropoff?.address || '', km: task.km || null, matched: true, toShopKm: item.km, toShopEta: item.eta });
    emitAdmin('work:update', { _id: task._id });
    return best;
  }
  const people = await Customer.find({
    'worker.role': task.kind === 'delivery' && task.courier?.company ? { $in: ['rider', 'agent'] } : task.kind === 'delivery' ? 'rider' : 'agent', 'worker.status': 'approved', 'worker.available': true,
    'worker.base': geo.within({ lat, lng, km: 15 }),
  }).select('_id').lean();
  for (const person of people) emitCustomer(String(person._id), 'work:new', { _id: task._id, kind: task.kind, pay: task.pay, collectCash: task.collectCash || 0, area: task.pickup.area, shop: task.pickup.name, to: task.dropoff?.address || '', km: task.km || null });
  emitAdmin('work:update', { _id: task._id });
}

async function openInspection(inspection) {
  const shop = await shopOf(inspection);
  if (!shop) return null;
  // attrs (size, colour…) from the ads, so the agent knows exactly what the buyer ordered
  const Listing = require('../models/Listing');
  const ls = await Listing.find({ _id: { $in: inspection.items.map((item) => item.listing) } }).select('attrs').lean();
  const attrs = new Map(ls.map((item) => [String(item._id), item.attrs || {}]));
  const task = await Task.create({
    kind: 'inspection', order: inspection._id, orderNo: inspection.orderNo, pickup: shop, fee: inspection.inspection.fee, pay: payouts.split(inspection.inspection.fee).net, buyerNotes: inspection.inspection.notes || '',
    preferred: reservation(inspection.inspection.preferred), // the agent the buyer chose gets it first
    items: inspection.items.map((item) => ({ title: item.title, qty: item.qty, image: item.image, attrs: attrs.get(String(item.listing)) || {} })),
  });
  inspection.inspection.task = task._id;
  inspection.inspection.status = 'open';
  await alertNearby(task);
  return task;
}

// leg: the order's first delivery record (its store is where the rider collects; a split order's other parts are
// their own jobs, see callRiderLeg)
async function openDelivery(delivery, leg) {
  const Store = require('../models/Store');
  const legStore = leg?.store && delivery.delivery?.method !== 'verified' ? await Store.findById(leg.store).lean() : null;
  const shop = delivery.delivery?.method === 'verified' ? partnerShopOf(delivery)
    : legStore?.point?.coordinates ? { name: legStore.name, address: legStore.address || '', area: legStore.area || '', point: legStore.point, phone: legStore.phone || (await Customer.findById(delivery.seller).select('phone').lean())?.phone || '' }
      : await shopOf(delivery);
  if (!shop) return null;
  const combined = !!delivery.rider?.combined && !!delivery.inspection?.status && delivery.inspection.status !== 'passed';
  let items = leg && leg.of > 1 ? leg.items.map((item) => ({ title: item.title, qty: item.qty, image: item.image })) : itemsOf(delivery);
  if (combined) {
    const Listing = require('../models/Listing');
    const ls = await Listing.find({ _id: { $in: delivery.items.map((item) => item.listing) } }).select('attrs').lean();
    const attrs = new Map(ls.map((item) => [String(item._id), item.attrs || {}]));
    items = delivery.items.map((item) => ({ title: item.title, qty: item.qty, image: item.image, attrs: attrs.get(String(item.listing)) || {} }));
  }
  // inspect & deliver: the inspection share is paid weekly; the delivery fee is collected in cash from the buyer
  const courier = delivery.rider.courier?.company ? delivery.rider.courier : null;
  // inspect & deliver: the delivery fee is collected in cash from the buyer · courier: everything was paid upfront
  // (a rider's free check changes nothing here: cash only when the buyer pays on delivery)
  // the buyer pays the delivery fee to the rider on delivery (cash or M-Pesa), whatever they paid for the goods
  const prepaid = delivery.payment?.method === 'mpesa' && !delivery.payOnDelivery && delivery.payment.status === 'paid'; // paid to our wallet with the goods
  const cash = courier || prepaid ? 0 : delivery.rider.fee || 0;
  const booked = await bookedRiderFor(delivery, shop);
  const task = await Task.create({
    ...(booked ? { preferred: booked } : {}), // the rider the buyer's scan found gets it first
    kind: 'delivery', inspect: combined, buyerNotes: combined ? delivery.inspection.notes || '' : '', order: delivery._id, orderNo: delivery.orderNo, pickup: shop, items, ...(leg ? { delivery: leg._id, leg: leg.seq } : {}),
    // courier: the agent goes to the courier's office near the shop (the buyer is far away); the buyer's details go on the parcel
    dropoff: courier
      ? { address: `${courier.name} office near the shop`, area: `Send to ${delivery.delivery.address}${delivery.delivery.county && !delivery.delivery.address.includes(delivery.delivery.county) ? `, ${delivery.delivery.county}` : ''}`, phone: delivery.buyerPhone, name: delivery.buyerName }
      : { address: delivery.delivery.address, area: delivery.delivery.county, lat: delivery.delivery.lat, lng: delivery.delivery.lng, phone: delivery.buyerPhone, name: delivery.buyerName },
    km: courier ? undefined : delivery.delivery.km,
    fee: (combined ? delivery.inspection.fee || 0 : 0) + (courier ? courier.handling || 0 : delivery.rider.fee || 0),
    pay: payouts.split((combined ? delivery.inspection.fee || 0 : 0) + (courier ? courier.handling || 0 : delivery.rider.fee || 0)).net + (courier ? courier.fare || 0 : 0),
    reimburse: courier ? courier.fare || 0 : 0,
    collectCash: cash,
    ...(courier ? { courier: { company: courier.company, name: courier.name, fare: courier.fare, eta: courier.eta, toTown: [delivery.delivery.address, delivery.delivery.county].filter(Boolean).join(', ') } } : {}),
  });
  delivery.rider.task = task._id;
  delivery.rider.status = 'open';
  delivery.rider.matching = undefined;
  if (combined) {
    delivery.inspection.task = task._id;
    delivery.inspection.status = 'open';
  }
  const best = await alertNearby(task);
  if (Array.isArray(best)) delivery.rider.matching = best.length ? `${best.length} rider${best.length === 1 ? '' : 's'} near the shop · the closest is ~${best[0].eta} min away` : 'Looking for a rider near the shop';
  task.matchedCount = Array.isArray(best) ? best.length : undefined;
  task.closest = Array.isArray(best) && best[0] ? { km: best[0].km, eta: best[0].eta } : null;
  return task;
}

// the seller confirmed: start the inspection (if the buyer asked). Riders are called by the seller with
// "Call a rider" once the order is packed (and has passed inspection).
// ---------------------------------------------------------------- the rider the buyer booked at the checkout
const RIDER_RESERVE_MS = 3 * 60 * 1000; // they have 3 minutes to take the job, then the nearest riders are asked
// still free, with room for another job, and near the shop? → { worker, name, until } for the job
async function bookedRiderFor(order, shop) {
  const want = order.rider?.preferred?.worker;
  if (!want || order.rider?.courier?.company || !shop?.point?.coordinates) return null;
  const person = await Customer.findOne({ _id: want, 'worker.role': 'rider', 'worker.status': 'approved', 'worker.available': true, active: { $ne: false } }).select('name worker').lean();
  if (!person) return null;
  const where = riders().positionOf(person.worker);
  if (!where || geo.distanceKm(where, shop.point) > riders().REACH_KM) return null;
  if ((await riders().workloadOf(person._id)) >= riders().capacityOf(person.worker)) return null;
  return { worker: person._id, name: person.name, until: new Date(Date.now() + RIDER_RESERVE_MS) };
}
// right after the order is placed: "a buyer booked you", so they can head towards the shop
exports.riderBooked = async (order) => {
  const booked = order.rider?.preferred;
  if (!booked?.worker) return;
  await require('../market/alerts').send(booked.worker, {
    kind: 'work', icon: '🏍️', link: '/work',
    title: { en: `A buyer booked you to deliver: ${order.orderNo}`, sw: `Mnunuzi amekuchagua kusafirisha: ${order.orderNo}` },
    body: {
      en: `From ${order.sellerName} to ${order.delivery?.county || 'the buyer'}${order.delivery?.km ? ` (${order.delivery.km} km)` : ''}. You'll get the job first when the seller has packed it: stay available.`,
      sw: `Kutoka kwa ${order.sellerName}. Utapata kazi kwanza muuzaji akimaliza kufunga.`,
    },
  });
};

exports.afterConfirmed = async (order) => {
  if (order.delivery?.method === 'verified' && order.verification?.status === 'waiting') {
    await openVerification(order);
    await order.save();
    return;
  }
  // inspect & deliver: the agent the seller calls does the inspection too
  if (order.inspection?.status === 'waiting' && !order.rider?.combined) {
    await openInspection(order);
    await order.save();
  }
};

// POST /api/orders/:id/call-rider  (seller: it's packed — alert riders near my shop)
exports.callRider = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id);
  if (!order || String(order.seller) !== String(req.customer._id)) throw httpError('Order not found', 404);
  if (!['rider', 'courier'].includes(order.delivery?.method)) throw httpError('The buyer didn’t choose rider delivery for this order');
  if (order.status !== 'confirmed') throw httpError(order.status === 'placed' ? 'Confirm the order first' : `This order is already ${order.status}`, 409);
  if (order.inspection?.status && !order.rider?.combined && order.inspection.status !== 'passed') throw httpError('Wait for our agent to pass the inspection first', 409);
  if (order.inspection?.status && order.rider?.combined && order.inspection.status === 'failed') throw httpError('The items failed inspection. Fix them and ask for a second inspection, or cancel the order.', 409);
  if (order.rider?.task && ['open', 'assigned', 'picked_up', 'delivered'].includes(order.rider.status)) throw httpError(order.rider.status === 'open' ? 'Riders have been alerted; waiting for one to accept' : 'A rider already took this order', 409);
  const legs = await deliveries().createFor(order);
  const openDeliveryResult = await openDelivery(order, legs[0]);
  if (openDeliveryResult) deliveries().fromTaskSoon(openDeliveryResult);
  if (!openDeliveryResult) throw httpError('Put your shop on the map first (My account → Shop location), so riders can find you');
  order.history.push({ status: order.status, by: 'seller', note: order.rider.courier?.company ? `Called an agent to send it by ${order.rider.courier.name}` : order.rider.combined ? 'Called a rider (checks the items first, free for the buyer)' : 'Called a rider' });
  await order.save();
  orders().broadcast(order);
  const near = await Customer.countDocuments({ 'worker.role': openDeliveryResult.courier?.company ? { $in: ['rider', 'agent'] } : 'rider', 'worker.status': 'approved', 'worker.available': true, 'worker.base': geo.within({ lat: openDeliveryResult.pickup.point.coordinates[1], lng: openDeliveryResult.pickup.point.coordinates[0], km: 15 }) });
  res.json({ order: orders().view(order, req.customer._id), ridersAlerted: openDeliveryResult.matchedCount ?? near, closest: openDeliveryResult.closest || null });
});
// POST /api/orders/:id/deliveries/:deliveryId/call-rider  (seller: another part of a split order is packed at another store)
// Its own job: collected at that store, taken to the buyer. The buyer paid for one delivery, so this rider is the seller's
// cost (taken off what we pay them; Order.splitDeliveryFee).
exports.callRiderLeg = asyncHandler(async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.deliveryId)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id);
  if (!order || String(order.seller) !== String(req.customer._id)) throw httpError('Order not found', 404);
  if (order.delivery?.method !== 'rider') throw httpError('Only rider orders are split between riders');
  if (!['confirmed', 'shipped'].includes(order.status)) throw httpError(order.status === 'placed' ? 'Confirm the order first' : `This order is already ${order.status}`, 409);
  if (order.inspection?.status && !['passed'].includes(order.inspection.status) && !order.rider?.combined) throw httpError('Wait for our agent to pass the inspection first', 409);
  const Delivery = require('../models/Delivery');
  const leg = await Delivery.findOne({ _id: req.params.deliveryId, order: order._id });
  if (!leg) throw httpError('Delivery not found', 404);
  if (leg.seq === 1) throw httpError('Use “Call a rider” for the first part', 409);
  if (deliveries().FINAL.includes(leg.status)) throw httpError(`This part is already ${leg.status}`, 409);
  if (leg.task && (await Task.exists({ _id: leg.task, status: { $in: ['open', 'assigned', 'picked_up', 'delivered'] } }))) throw httpError('Riders have already been called for this part', 409);
  const store = leg.store ? await require('../models/Store').findById(leg.store).lean() : null;
  if (!store?.point?.coordinates) throw httpError(`Put ${store?.name || 'this store'} on the map first (Seller hub → Stores), so riders can find it`);
  if (order.delivery.lat == null) throw httpError('The buyer’s location is missing for this order');
  const quote = await require('../market/fieldwork').riderQuoteByRoad(store.point, { lat: order.delivery.lat, lng: order.delivery.lng });
  if (!quote.ok) throw httpError(quote.reason);
  const task = await Task.create({
    kind: 'delivery', order: order._id, orderNo: order.orderNo, delivery: leg._id, leg: leg.seq,
    pickup: { name: store.name, address: store.address || '', area: store.area || '', point: store.point, phone: store.phone || req.customer.phone || '' },
    items: leg.items.map((item) => ({ title: item.title, qty: item.qty, image: item.image })),
    dropoff: { address: order.delivery.address, area: order.delivery.county, lat: order.delivery.lat, lng: order.delivery.lng, phone: order.buyerPhone, name: order.buyerName },
    km: quote.km, fee: quote.fee, pay: quote.pay, collectCash: 0, // paid by us (charged to the seller), never by the buyer
  });
  leg.task = task._id;
  leg.fee = quote.fee;
  leg.paidBy = 'seller';
  await leg.save();
  await deliveries().fromTask(task);
  const legs = await Delivery.find({ order: order._id, seq: { $gt: 1 }, task: { $exists: true } }).lean();
  const live = await Task.find({ _id: { $in: legs.map((item) => item.task) }, status: { $ne: 'cancelled' } }).select('fee').lean();
  order.splitDeliveryFee = live.reduce((sum, item) => sum + (item.fee || 0), 0);
  order.history.push({ status: order.status, by: 'seller', note: `Called a rider for part ${leg.seq} of ${leg.of} (${store.name}): KSh ${quote.fee} delivery, paid by the seller` });
  await order.save();
  orders().broadcast(order);
  const best = await alertNearby(task);
  res.json({ delivery: deliveries().view(await Delivery.findById(leg._id).lean()), ridersAlerted: Array.isArray(best) ? best.length : 0, fee: quote.fee });
});

// the order was cancelled: jobs that haven't finished are cancelled too
exports.afterCancelled = async (order) => {
  await Task.updateMany({ order: order._id, status: { $in: ['open', 'assigned', 'picked_up'] } }, { $set: { status: 'cancelled' } });
  const set = {};
  if (order.inspection?.status && !['passed', 'failed'].includes(order.inspection.status)) set['inspection.status'] = 'cancelled';
  if (order.rider?.fee) set['rider.status'] = 'cancelled';
  if (order.verification?.status && !['passed', 'failed'].includes(order.verification.status)) set['verification.status'] = 'cancelled';
  if (Object.keys(set).length) await Order.updateOne({ _id: order._id }, { $set: set });
};

// POST /api/orders/:id/recheck  (seller: the items are fixed / swapped, please inspect again — once)
exports.recheck = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id);
  if (!order || String(order.seller) !== String(req.customer._id)) throw httpError('Order not found', 404);
  if (order.inspection?.status !== 'failed') throw httpError('Only an order that failed inspection can be checked again');
  if (order.inspection.rechecks >= 1) throw httpError('This order was already inspected twice. Talk to the buyer, or cancel it.');
  if (order.status === 'cancelled') throw httpError('This order was cancelled');
  order.inspection.rechecks += 1;
  order.inspection.result = '';
  if (order.rider?.combined) {
    order.inspection.status = 'waiting'; // the seller calls an agent again: they inspect and deliver
    order.rider.status = 'waiting';
    order.rider.task = undefined;
  } else await openInspection(order);
  order.history.push({ status: order.status, by: 'seller', note: 'Asked for a second inspection' });
  await order.save();
  orders().broadcast(order);
  res.json(orders().view(order, req.customer._id));
});

// ---------------------------------------------------------------- what riders / agents see
const workerView = (worker) =>
  worker?.role ? {
    role: worker.role, status: worker.status, idNumber: worker.idNumber ? `•••${String(worker.idNumber).slice(-3)}` : '', vehicle: worker.vehicle || '', plate: worker.plate || '',
    baseArea: worker.baseArea || '', marketName: worker.marketName || '', marketSlug: worker.marketSlug || '', market: worker.market || null, radiusKm: worker.radiusKm, available: worker.available !== false, mpesaPhone: worker.mpesaPhone || '',
    reviewNote: worker.reviewNote || '', lat: worker.base?.coordinates?.[1], lng: worker.base?.coordinates?.[0],
    capacity: worker.role === 'partner' ? undefined : riders().capacityOf(worker), rating: worker.rating?.count ? worker.rating : null,
    ...(worker.role === 'partner' ? { shopName: worker.shopName || '', shopAddress: worker.shopAddress || '', permitNo: worker.permitNo || '', hours: worker.hours || '' } : {}),
  } : null;

// a job card: exact buyer pin and phone numbers only once it's yours
function taskView(order, me, from) {
  const mine = order.worker && String(order.worker) === String(me);
  const [lng, lat] = order.pickup.point.coordinates;
  return {
    _id: order._id, kind: order.kind, inspect: !!order.inspect, status: order.status, orderNo: order.orderNo, pay: order.pay, fee: order.fee, collectCash: order.collectCash || 0, km: order.km,
    away: from ? geo.distanceKm(from, order.pickup.point) : null,
    pickup: { name: order.pickup.name, address: order.pickup.address, area: order.pickup.area, lat, lng, ...(mine ? { phone: order.pickup.phone } : {}) },
    ...(order.errand ? { errand: true, budget: order.budget || 0, spent: order.spent ?? null } : {}),
    ...(order.list && (order.list.text || order.list.photos) ? { list: { text: order.list.text || '', photos: mine ? Array.from({ length: order.list.photos || 0 }, (_, index) => `/work/tasks/${order._id}/list-photos/${index}`) : [], photoCount: order.list.photos || 0 } } : {}),
    ...(order.quote?.needed ? { quote: { amount: order.quote.amount || 0, sentAt: order.quote.sentAt || null, paidAt: order.quote.paidAt || null } } : {}),
    ...(!['inspection', 'verification'].includes(order.kind) ? { dropoff: { address: order.dropoff.address, area: order.dropoff.area, ...(mine ? { lat: order.dropoff.lat, lng: order.dropoff.lng, phone: order.dropoff.phone, name: order.dropoff.name } : {}) } } : {}),
    ...(order.kind === 'verification' ? { verification: true } : {}),
    items: order.items, buyerNotes: order.buyerNotes || '', result: order.result, mine, acceptedAt: order.acceptedAt, doneAt: order.doneAt, week: order.week, payout: order.payout?.status, payoutAt: order.payout?.dueAt, reimburse: order.reimburse || 0,
    money: order.money || payouts.split(order.fee || 0, order.collectCash || 0, order.reimburse || 0), // what they’ll earn, before they take it
    ...(order.courier?.company ? { courier: { name: order.courier.name, fare: order.courier.fare, eta: order.courier.eta, toTown: order.courier.toTown, waybill: order.courier.waybill || '', office: order.courier.office || '' } } : {}),
    onTheWayAt: order.onTheWayAt, arrivedAt: order.arrivedAt,
    riderConfirmed: !!order.riderConfirmedAt, buyerConfirmed: !!order.buyerConfirmedAt, tips: (order.tips || []).reduce((total, tip) => total + tip.amount, 0),
    createdAt: order.createdAt,
    ...(order.leg ? { leg: order.leg } : {}),
    qty: (order.items || []).reduce((sum, item) => sum + (item.qty || 0), 0),
    matched: (order.matched || []).some((item) => String(item.worker) === String(me)),
    bookedForMe: !!order.preferred?.worker && String(order.preferred.worker) === String(me),
    ...(mine && order.eta?.minutes != null ? { eta: { minutes: order.eta.minutes, at: order.eta.at }, kmLeft: order.eta.kmLeft } : {}),
  };
}

// GET /api/work/me
exports.me = asyncHandler(async (req, res) => {
  const worker = req.customer.worker;
  if (!worker?.role) return res.json({ worker: null });
  const thisWeek = weekOf();
  const result = payouts.rates();
  const [[all], balance, recent, tipRows] = await Promise.all([
    payouts.earnings({ worker: req.customer._id }),
    payouts.balanceOf(req.customer._id),
    require('../models/Payout').find({ worker: req.customer._id }).sort({ createdAt: -1 }).limit(5).select('amount status ref createdAt paidAt jobs method').lean(),
    Task.aggregate([{ $match: { worker: req.customer._id } }, { $unwind: '$tips' }, { $group: { _id: null, total: { $sum: '$tips.amount' } } }]),
  ]);
  const error = all || { jobs: 0, gross: 0, commission: 0, tax: 0, net: 0, cash: 0, reimburse: 0 };
  // today / this week (Monday) earnings, rating and reviews, and how much they're carrying now
  const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
  const startWeek = new Date(startDay); startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));
  const sum = async (since) => {
    const [row] = await Task.aggregate([{ $match: { worker: req.customer._id, status: 'done', doneAt: { $gte: since } } }, { $group: { _id: null, jobs: { $sum: 1 }, earned: { $sum: { $ifNull: ['$money.net', '$pay'] } } } }]);
    return { jobs: row?.jobs || 0, earned: Math.round(row?.earned || 0) };
  };
  const [today, week, reviews, active] = await Promise.all([
    sum(startDay), sum(startWeek),
    Task.find({ worker: req.customer._id, 'rating.stars': { $gte: 1 } }).sort({ 'rating.at': -1 }).limit(8).select('rating orderNo').lean(),
    riders().workloadOf(req.customer._id),
  ]);
  res.json({
    stats: {
      today, week, rating: worker.rating?.count ? worker.rating : { avg: 0, count: 0 },
      reviews: reviews.map((item) => ({ stars: item.rating.stars, comment: item.rating.comment || '', at: item.rating.at, orderNo: item.orderNo })),
      workload: { active, capacity: riders().capacityOf(worker) }, suggestedCapacity: riders().suggestedCapacity(worker.vehicle),
      liveAt: worker.liveAt || null,
    },
    docs: require('./workerDocsController').summaryOf(worker), // missing / expiring / expired documents
    worker: workerView(worker),
    earnings: {
      jobs: error.jobs, fees: error.gross, commission: error.commission, tax: error.tax, earned: error.net, cashCollected: error.cash, refunds: error.reimburse,
      sent: balance.sent, sending: balance.sending, waiting: balance.waiting, ready: balance.ready, owed: balance.owed, balance: balance.balance, nextAt: balance.nextAt,
      tips: tipRows[0]?.total || 0, commissionPercent: result.commissionPercent, taxPercent: result.taxPercent, delayMin: result.delayMin,
      payouts: recent, weekLabel: weekLabel(thisWeek),
      // older app versions
      thisWeek: balance.waiting + balance.ready, due: balance.ready, paid: balance.sent,
    },
  });
});

// POST /api/work/apply { role, idNumber, vehicle, plate, lat, lng, baseArea, market, radiusKm, mpesaPhone }
exports.apply = asyncHandler(async (req, res) => {
  const customer = req.customer;
  const body = req.body;
  if (customer.worker?.status === 'approved') throw httpError('You’re already approved');
  if (customer.worker?.status === 'suspended') throw httpError('Your field-team account is suspended. Contact support.');
  if (!['rider', 'agent', 'partner'].includes(body.role)) throw httpError('Choose: rider, shopping agent or partner shop');
  const idNumber = clean(body.idNumber, 12).replace(/\D/g, '');
  if (!/^\d{6,10}$/.test(idNumber)) throw httpError('Enter your national ID number');
  if (!customer.phone) throw httpError('Add your phone number first (Account → Profile): our team will call you');
  const base = geo.toPoint(body.lat, body.lng);
  let shopFields = {};
  if (body.role === 'partner') {
    const shopName = clean(body.shopName, 80);
    const shopAddress = clean(body.shopAddress, 160);
    const permitNo = clean(body.permitNo, 30);
    if (shopName.length < 2) throw httpError('Enter your shop’s name');
    if (shopAddress.length < 5) throw httpError('Enter the shop’s address (street, building, floor, shop number)');
    if (permitNo.length < 3) throw httpError('Enter your business permit number');
    if (!base) throw httpError('Pin your shop on the map');
    // the network is spread out: no two partner shops within 2 km of each other
    const near = await require('../market/partners').tooClose(base, customer._id);
    if (near) throw httpError(`There’s already a Kapu partner shop ${near.km} km away (${near.name}, ${near.area}). Partner shops are at least ${require('../market/partners').SPACING_KM} km apart.`, 409);
    shopFields = { shopName, shopAddress, permitNo, hours: clean(body.hours, 80) };
  }
  if (!base) throw httpError(body.role === 'rider' ? 'Set where you usually wait for jobs (your stage)' : 'Set where you work (your market or area)');
  const baseArea = clean(body.baseArea, 60);
  if (baseArea.length < 2) throw httpError(body.role === 'rider' ? 'Type your stage or area, e.g. Imara Daima stage' : 'Type your market or area, e.g. Gikomba');
  let vehicle = '';
  let plate = '';
  if (body.role === 'rider') {
    vehicle = VEHICLES.includes(body.vehicle) ? body.vehicle : '';
    if (!vehicle) throw httpError('Choose what you ride');
    plate = clean(body.plate, 12).toUpperCase();
    if (['Motorbike', 'Tuk-tuk', 'Car', 'Van / pickup'].includes(vehicle) && !/^K[A-Z]{2,3}\s?\d{3}[A-Z]?$/.test(plate.replace(/\s+/g, ' '))) throw httpError('Enter the number plate, e.g. KMFA 123B');
  }
  let market = null;
  if (body.role === 'agent' && body.market && isId(body.market)) market = await require('../models/Market').findOne({ _id: body.market, approved: true }).lean();
  if (body.role === 'agent' && !market) throw httpError('Choose the market you work in: buyers are linked to the agents of the market they buy from');
  let mpesaPhone;
  try {
    mpesaPhone = require('../utils/mpesa').formatPhone(body.mpesaPhone || customer.phone);
  } catch {
    throw httpError('Enter the M-Pesa number your weekly pay should go to');
  }
  customer.worker = {
    role: body.role, status: 'pending', idNumber, vehicle, plate, base, baseArea, mpesaPhone, appliedAt: new Date(), available: true, ...shopFields,
    radiusKm: Math.min(30, Math.max(1, Number(body.radiusKm) || (body.role === 'rider' ? 5 : 3))),
    ...(market ? { market: market._id, marketName: market.name, marketSlug: market.slug } : {}),
  };
  await customer.save();
  require('../utils/cache').invalidate('market:shopride-agents'); // an agent's market may have changed
  emitAdmin('work:application', { _id: customer._id, name: customer.name, role: body.role });
  res.json({ worker: workerView(customer.worker) });
});

// PUT /api/work/me { available, lat, lng, baseArea, radiusKm }  (approved riders / agents)
exports.updateMe = asyncHandler(async (req, res) => {
  const customer = req.customer;
  if (customer.worker?.status !== 'approved') throw httpError('Your application hasn’t been approved yet');
  if (req.body.available !== undefined) customer.set('worker.available', req.body.available === true || req.body.available === 'true');
  const point = req.body.lat !== undefined ? geo.toPoint(req.body.lat, req.body.lng) : null;
  if (point) customer.set('worker.base', point);
  if (req.body.baseArea) customer.set('worker.baseArea', clean(req.body.baseArea, 60));
  if (customer.worker.role === 'partner' && req.body.hours !== undefined) customer.set('worker.hours', clean(req.body.hours, 80));
  if (customer.worker.role === 'partner' && point) {
    const near = await require('../market/partners').tooClose(point, customer._id);
    if (near) throw httpError(`That’s ${near.km} km from another partner shop (${near.name}). Partner shops are at least 2 km apart.`, 409);
  }
  if (req.body.radiusKm) customer.set('worker.radiusKm', Math.min(30, Math.max(1, Number(req.body.radiusKm) || 5)));
  if (req.body.capacity !== undefined) {
    const capacity = Math.round(Number(req.body.capacity));
    if (!(capacity >= 1 && capacity <= 6)) throw httpError('Choose 1 to 6 jobs at a time');
    customer.set('worker.capacity', capacity);
  }
  await customer.save();
  res.json({ worker: workerView(customer.worker) });
});

const approved = (req) => {
  const worker = req.customer.worker;
  if (worker?.status !== 'approved') throw httpError(worker?.status === 'pending' ? 'Your application is being checked. We’ll call you.' : 'Apply to join the field team first', 403);
  return worker;
};

// GET /api/work/jobs?near=lat,lng  → open jobs near me, and my own jobs
exports.jobs = asyncHandler(async (req, res) => {
  const worker = approved(req);
  const fresh = riders().positionOf(worker);
  const near = geo.parseNear({ near: req.query.near, km: worker.radiusKm || 5 }) || (fresh ? { lat: fresh.lat, lng: fresh.lng, km: worker.radiusKm || 5 } : null);
  const [open, mine] = await Promise.all([
    Promise.all([
      near && worker.available !== false ? Task.find({ ...jobsForMe(worker.role, req.customer._id, worker.vehicle), status: 'open', 'pickup.point': geo.nearest(near) }).limit(30).lean() : [],
      Task.find({ 'preferred.worker': req.customer._id, status: 'open' }).limit(10).lean(), // booked with me: always shown
    ]).then(([nearby, booked]) => [...booked, ...nearby.filter((item) => !booked.some((mine) => String(mine._id) === String(item._id)))]),
    Task.find({ worker: req.customer._id, status: { $in: ['assigned', 'picked_up', 'delivered'] } }).sort({ acceptedAt: 1 }).lean(),
    // (partners: their verification jobs, given to them directly)
  ]);
  const done = await Task.find({ worker: req.customer._id, status: 'done' }).sort({ doneAt: -1 }).limit(20).lean();
  const capacity = riders().capacityOf(worker);
  const active = mine.filter((item) => ['assigned', 'picked_up'].includes(item.status)).length;
  const withRoute = (item) => {
    const view = taskView(item, req.customer._id, near);
    if (near && item.kind !== 'verification') {
      const km = geo.distanceKm(near, item.pickup.point);
      view.toShop = { km, eta: riders().minutesFor(km, worker.vehicle) };
    }
    if (['delivery', 'shopping'].includes(item.kind) && !item.courier?.company) {
      const trip = riders().tripOf(item, worker.vehicle);
      if (trip) view.trip = trip;
    }
    return view;
  };
  const openJobs = open.map(withRoute).sort((first, second) => (second.matched - first.matched) || ((first.toShop?.km ?? 99) - (second.toShop?.km ?? 99)));
  res.json({ near, radiusKm: worker.radiusKm, available: worker.available !== false, capacity, active, full: active >= capacity, open: openJobs, mine: mine.map(withRoute), done: done.map((item) => taskView(item, req.customer._id)) });
});

async function syncOrder(value, fields) {
  const order = await Order.findById(value.order);
  if (!order) return null;
  Object.entries(fields).forEach(([key, entryValue]) => order.set(key, entryValue));
  await order.save();
  orders().broadcast(order);
  return order;
}

// POST /api/work/tasks/:id/accept
exports.accept = asyncHandler(async (req, res) => {
  const worker = approved(req);
  if (!isId(req.params.id)) throw httpError('Job not found', 404);
  const blocked = require('./workerDocsController').blockedReason(worker); // an expired driving licence / insurance
  if (blocked) throw httpError(blocked, 403);
  const capacity = riders().capacityOf(worker);
  if ((await riders().workloadOf(req.customer._id)) >= capacity) throw httpError(`You’re carrying ${capacity} job${capacity === 1 ? '' : 's'} (your limit). Finish one first, or raise your limit.`);
  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, status: 'open', ...jobsForMe(worker.role, req.customer._id, worker.vehicle) },
    { $set: { status: 'assigned', worker: req.customer._id, workerName: req.customer.name, workerPhone: req.customer.phone, acceptedAt: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (!task) throw httpError('Someone else took this job. Look for another one.', 409);
  // where they are now → when the buyer can expect them
  const from = riders().positionOf(worker);
  const first = from && !['inspection', 'verification'].includes(task.kind) ? riders().etaFor(task, from, worker.vehicle) : null;
  const eta = first ? { minutes: first.minutes, at: new Date(), kmLeft: first.kmLeft, kmToYou: first.kmToYou, stage: first.stage } : undefined;
  const live = from?.live ? { lat: from.lat, lng: from.lng, at: worker.liveAt } : undefined;
  if (eta) await Task.updateOne({ _id: task._id }, { $set: { eta, ...(live ? { live } : {}) } });
  const stars = worker.rating?.count ? { avg: worker.rating.avg, count: worker.rating.count } : undefined;
  if (task.kind === 'delivery' && task.inspect && mainLeg(task)) await syncOrder(task, { 'inspection.status': 'assigned', 'inspection.agentName': req.customer.name, 'inspection.agentPhone': req.customer.phone || '' });
  if (task.kind === 'delivery' && !mainLeg(task)) deliveries().fromTaskSoon(task);
  else if (task.kind === 'delivery') await syncOrder(task, { 'rider.status': 'assigned', 'rider.name': req.customer.name, 'rider.phone': req.customer.phone, 'rider.vehicle': worker.vehicle || '', 'rider.plate': worker.plate || '', 'rider.tipPhone': worker.mpesaPhone || req.customer.phone, 'rider.stars': stars, 'rider.eta': eta, 'rider.live': live });
  else await syncOrder(task, { 'inspection.status': 'assigned', 'inspection.agentName': req.customer.name, 'inspection.agentPhone': req.customer.phone || '' });
  if (task.kind === 'inspection' && task.order) {
    const seller = (await Order.findById(task.order).select('seller').lean())?.seller;
    if (seller) await require('../market/agentSellers').link([{ agent: req.customer._id, seller, how: 'accepted', job: true }]);
  }
  if (task.kind === 'delivery' && mainLeg(task)) deliveries().fromTaskSoon(task);
  await errands().onTask(task, 'assigned', { vehicle: worker.vehicle, plate: worker.plate, role: worker.role, tipPhone: worker.mpesaPhone || req.customer.phone, stars, eta, live });
  emitAdmin('work:update', { _id: task._id });
  res.json(taskView(task, req.customer._id));
});

// POST /api/work/tasks/:id/release  (can't make it: give the job back, before pickup)
exports.release = asyncHandler(async (req, res) => {
  approved(req);
  // a priced list the customer may be paying right now: not given back (the money would have nowhere to go)
  const priced = await Task.findOne({ _id: req.params.id, worker: req.customer._id, 'quote.needed': true, 'quote.sentAt': { $exists: true }, 'quote.paidAt': { $exists: false } }).select('_id').lean();
  if (priced) throw httpError('You sent the customer a price and they may be paying it now. Call them, or contact support to hand this job over.', 409);
  const task = await Task.findOneAndUpdate({ _id: req.params.id, worker: req.customer._id, status: 'assigned' }, { $set: { status: 'open' }, $unset: { worker: 1, workerName: 1, workerPhone: 1, acceptedAt: 1 } }, { returnDocument: 'after' }).lean();
  if (!task) throw httpError('You can only give back a job you haven’t picked up yet', 409);
  await Task.updateOne({ _id: task._id }, { $unset: { eta: 1, live: 1 } });
  if (task.kind === 'delivery' && mainLeg(task)) await syncOrder(task, { 'rider.status': 'open', 'rider.name': '', 'rider.phone': '', 'rider.eta': undefined, 'rider.live': undefined, 'rider.stars': undefined });
  else if (task.kind !== 'delivery') await syncOrder(task, { 'inspection.status': 'open', 'inspection.agentName': '', 'inspection.agentPhone': '' });
  if (task.kind === 'delivery') deliveries().fromTaskSoon(task);
  if (task.quote?.needed) await Task.updateOne({ _id: task._id }, { $unset: { 'quote.amount': 1, 'quote.sentAt': 1 } }); // the next agent prices it again
  await errands().onTask(task, 'open');
  await alertNearby(task);
  res.json(taskView(task, req.customer._id));
});

const myTask = async (req, kind, status) => {
  approved(req);
  if (!isId(req.params.id)) throw httpError('Job not found', 404);
  const task = await Task.findOne({ _id: req.params.id, worker: req.customer._id, kind: Array.isArray(kind) ? { $in: kind } : kind });
  if (!task) throw httpError('Job not found', 404);
  if (!status.includes(task.status)) throw httpError(`This job is already ${task.status.replace('_', ' ')}`, 409);
  return task;
};
exports.finishTask = (task) => finish(task);
const finish = (task) => {
  task.status = 'done';
  task.doneAt = new Date();
  task.week = weekOf(task.doneAt);
  // fee − our commission − tax; paid by M-Pesa 30 minutes from now (cash jobs: our share is charged to their account)
  payouts.settleTask(task, task.doneAt);
};

// POST /api/work/tasks/:id/picked-up  (rider has the parcel)
exports.pickedUp = asyncHandler(async (req, res) => {
  const task = await myTask(req, 'delivery', ['assigned']);
  if (task.inspect && !task.result?.passed) throw httpError('Inspect the items first: tick the checks and tap “Passed”', 409);
  // Shop & ride: take it only once the buyer has paid for it (we pay the seller)
  if (task.errand) {
    const goods = (await require('../models/Errand').findById(task.errand).select('shopride.goods').lean())?.shopride?.goods;
    if (goods?.amount && goods.status !== 'paid') throw httpError('Wait: the buyer is paying for the goods. Take it once your app says it’s paid.', 409);
  }
  task.status = 'picked_up';
  task.pickedUpAt = new Date();
  await task.save();
  await errands().onTask(task, 'picked_up');
  deliveries().fromTaskSoon(task);
  const order = mainLeg(task) ? await Order.findById(task.order) : null;
  if (order && ['placed', 'confirmed'].includes(order.status)) {
    order.rider.status = 'picked_up';
    order.rider.pickedUpAt = task.pickedUpAt;
    const who = req.customer.worker?.vehicle === 'On foot' ? 'Delivery agent' : 'Rider';
    const tel = String(req.customer.phone || '').replace(/^254(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3');
    await orders().applyStatus(order, 'shipped', 'rider', { note: `${who} ${req.customer.name}${tel ? `, ${tel}` : ''}` });
    // the goods are with our team (checked first when the buyer asked): the seller is paid now, not after delivery
    if (orders().releaseEarly(order, `collected by our ${order.rider?.courier?.company ? 'agent' : 'rider'} ${req.customer.name}${task.inspect ? ' after a passed check' : ''}`)) {
      await order.save();
      orders().broadcast(order);
    }
  }
  res.json(taskView(task.toObject(), req.customer._id));
});

// POST /api/work/tasks/:id/bought { spent, receipt }  (shopping errand: the agent bought the list)
exports.bought = asyncHandler(async (req, res) => {
  const task = await myTask(req, 'shopping', ['assigned']);
  if (task.quote?.needed && !task.quote.paidAt) throw httpError(task.quote.sentAt ? 'Wait until the customer has paid your price (you’ll get a notification), then buy it' : 'Price the list first: the customer pays, then you buy it', 409);
  const spent = Math.round(Number(req.body.spent));
  if (!(spent > 0)) throw httpError('Enter how much you spent (KSh), from the receipt');
  if (spent > (task.budget || 0)) throw httpError(`The customer’s budget is KSh ${(task.budget || 0).toLocaleString('en-KE')}. Call them before spending more, or buy less.`);
  task.spent = spent;
  task.receipt = clean(req.body.receipt, 60);
  task.reimburse = spent; // refunded to the agent with their pay (the customer paid the budget upfront)
  task.status = 'picked_up';
  task.pickedUpAt = new Date();
  await task.save();
  await errands().onTask(task, 'picked_up', { spent, receipt: task.receipt });
  res.json(taskView(task.toObject(), req.customer._id));
});

// POST /api/work/tasks/:id/quote { amount, note }  (a shopping agent prices a customer's written / photographed list)
exports.quote = asyncHandler(async (req, res) => {
  const task = await myTask(req, 'shopping', ['assigned']);
  if (!task.quote?.needed) throw httpError('This list already has a budget: just buy it', 409);
  if (task.quote.paidAt) throw httpError('The customer has already paid: go and buy it', 409);
  await errands().quoteList(task, req.customer, { amount: req.body.amount, note: req.body.note });
  const fresh = await Task.findById(task._id).lean();
  res.json(taskView(fresh, req.customer._id));
});

// GET /api/work/tasks/:id/list-photos/:n  (the agent on the job: the photo of the customer's list)
exports.listPhoto = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Job not found', 404);
  const task = await Task.findOne({ _id: req.params.id, worker: req.customer._id, kind: 'shopping', status: { $in: ['assigned', 'picked_up', 'delivered', 'done'] } }).select('errand').lean();
  if (!task?.errand) throw httpError('Job not found', 404);
  const errand = await require('../models/Errand').findById(task.errand).select('no shopping.photos').lean();
  errands().sendListPhoto(res, errand, req.params.n);
});

// POST /api/work/tasks/:id/on-the-way | /arrived  (rider: 🛵 heading to the buyer · 📍 at the buyer's door)
// so the buyer's delivery dashboard shows exactly where it is: packed → dispatched → on the way → arrived → delivered
const stage = (key) => asyncHandler(async (req, res) => {
  const task = await myTask(req, ['delivery', 'shopping'], ['picked_up']);
  if (task.courier?.company) throw httpError('This one goes by courier: tap “Sent” and enter the waybill number', 409);
  const now = new Date();
  if (key === 'arrived') {
    if (task.arrivedAt) throw httpError('You already said you’ve arrived', 409);
    task.arrivedAt = now;
    task.onTheWayAt = task.onTheWayAt || now;
  } else {
    if (task.onTheWayAt) throw httpError('You already said you’re on the way', 409);
    task.onTheWayAt = now;
  }
  await task.save();
  if (task.errand) await errands().onTask(task, key);
  deliveries().fromTaskSoon(task);
  const order = task.order && mainLeg(task) ? await Order.findById(task.order) : null;
  if (order && order.status === 'shipped') {
    if (key === 'arrived') order.rider.arrivedAt = now;
    order.rider.onTheWayAt = order.rider.onTheWayAt || now;
    order.history.push({ status: order.status, by: 'rider', note: key === 'arrived' ? `📍 ${req.customer.name} has arrived` : `🛵 ${req.customer.name} is on the way to you` });
    await order.save();
    orders().broadcast(order);
    require('../market/alerts').riderStage(order, key).catch(() => {});
  }
  res.json(taskView(task.toObject(), req.customer._id));
});
exports.onTheWay = stage('on_the_way');
exports.arrived = stage('arrived');

// POST /api/work/tasks/:id/delivered  (rider: handed over — the buyer confirms too; the job is done when both have)
exports.delivered = asyncHandler(async (req, res) => {
  const task = await myTask(req, ['delivery', 'shopping'], ['picked_up']);
  if (task.courier?.company) throw httpError('This one goes by courier: tap “Sent” and enter the waybill number', 409);
  task.riderConfirmedAt = new Date();
  const order = await Order.findById(task.order);
  const main = mainLeg(task);
  if (task.buyerConfirmedAt || order?.status === 'delivered') {
    finish(task); // the buyer already confirmed
    if (order && main) {
      order.rider.status = 'done';
      await order.save();
      orders().broadcast(order);
    }
  } else {
    task.status = 'delivered';
    if (order && main) {
      order.rider.status = 'delivered';
      order.history.push({ status: order.status, by: 'rider', note: `${req.customer.name} says it’s delivered: waiting for the buyer to confirm` });
      await order.save();
      orders().broadcast(order);
    }
  }
  await task.save();
  deliveries().fromTaskSoon(task);
  if (task.errand) await errands().onTask(task, task.status === 'done' ? 'done' : 'delivered');
  res.json(taskView(task.toObject(), req.customer._id));
});

// POST /api/work/tasks/:id/sent { waybill, office, fare }  (agent: handed to the courier — the job is done)
exports.sent = asyncHandler(async (req, res) => {
  const task = await myTask(req, 'delivery', ['picked_up']);
  if (!task.courier?.company) throw httpError('This isn’t a courier job', 400);
  const waybill = clean(req.body.waybill, 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 /-]{2,39}$/.test(waybill)) throw httpError('Enter the waybill / receipt number from the courier (e.g. EC123456)');
  const office = clean(req.body.office, 120);
  if (office.length < 3) throw httpError('Which office or stage did you send it from? (e.g. Easy Coach, Accra Road)');
  const fare = req.body.fare === undefined || req.body.fare === '' ? null : Math.round(Number(req.body.fare));
  if (fare !== null && !(fare >= 0 && fare <= 50000)) throw httpError('Enter the fare you paid (KSh)');
  Object.assign(task.courier, { waybill, office, sentAt: new Date(), ...(fare !== null ? { actualFare: fare } : {}) });
  // refunded up to the fare we quoted; anything more is held for an admin to check (never paid out automatically)
  if (fare !== null) {
    const quoted = Math.max(0, Math.round(task.courier.fare || 0));
    task.reimburse = Math.min(fare, quoted);
    if (fare > quoted) {
      task.courier.overClaim = fare - quoted;
      require('../security/audit').audit(req, 'courier.fare_over_quote', { target: `task:${task._id}`, detail: `claimed KSh ${fare}, quoted KSh ${quoted}` });
    }
  }
  finish(task);
  await task.save();
  deliveries().fromTaskSoon(task);
  const order = await Order.findById(task.order);
  if (order) {
    Object.assign(order.rider.courier, { waybill, office, sentAt: task.courier.sentAt, ...(fare !== null ? { actualFare: fare } : {}) });
    order.rider.status = 'sent';
    order.shipNote = `Sent by ${task.courier.name}, waybill ${waybill}, from ${office}. Collect it at their office in ${order.delivery.county || 'your town'}${task.courier.eta ? ` (${task.courier.eta.toLowerCase()})` : ''}.`;
    order.history.push({ status: order.status, by: 'agent', note: `📦 Sent by ${task.courier.name}: waybill ${waybill} (${req.customer.name}, ${office})` });
    await order.save();
    orders().broadcast(order);
    require('../market/alerts').courierSent(order).catch(() => {});
  }
  res.json(taskView(task.toObject(), req.customer._id));
});

// the order was marked delivered (the buyer confirmed, or automatically): the rider's job is done once they confirmed too
exports.afterDelivered = async (order, by) => {
  // a split order's other parts
  for (const leg of await Task.find({ order: order._id, kind: 'delivery', leg: { $gt: 1 }, status: { $nin: ['done', 'cancelled'] } })) {
    leg.buyerConfirmedAt = leg.buyerConfirmedAt || new Date();
    if (leg.riderConfirmedAt || by === 'system') finish(leg);
    await leg.save();
    if (leg.worker) emitCustomer(String(leg.worker), 'work:confirmed', { _id: leg._id, orderNo: leg.orderNo, done: leg.status === 'done' });
  }
  if (!order.rider?.task) return;
  const task = await Task.findById(order.rider.task);
  if (!task || ['done', 'cancelled'].includes(task.status)) return;
  task.buyerConfirmedAt = new Date();
  if (task.riderConfirmedAt || by === 'system') {
    finish(task);
    await Order.updateOne({ _id: order._id }, { $set: { 'rider.status': 'done' } });
    order.rider.status = 'done';
  }
  await task.save();
  if (task.worker) emitCustomer(String(task.worker), 'work:confirmed', { _id: task._id, orderNo: task.orderNo, done: task.status === 'done' });
};

// buyers who forget: 24 hours after the rider said "delivered", the order completes on its own
const runDeliveryCheck = async () => {
    await expireDropoffs();
    // M-Pesa orders the seller sent themselves: the buyer confirms; if they don't, it completes 3 days after sending
    const sellerSent = await Order.find({ status: 'shipped', 'payment.method': 'mpesa', 'delivery.method': { $nin: ['rider', 'courier', 'verified'] }, history: { $elemMatch: { status: 'shipped', at: { $lt: new Date(Date.now() - 3 * 24 * 3600000) } } } }).limit(50);
    for (const item of sellerSent) await orders().applyStatus(item, 'delivered', 'system', { note: 'Completed automatically 3 days after the seller sent it' });
    const late = await Task.find({ kind: { $in: ['delivery', 'shopping'] }, status: 'delivered', riderConfirmedAt: { $lt: new Date(Date.now() - 24 * 3600000) } }).limit(50);
    const lateIds = late.map((task) => task.order).filter(Boolean);
    const lateOrders = new Map(lateIds.length ? (await Order.find({ _id: { $in: lateIds } })).map((order) => [String(order._id), order]) : []); // one read
    for (const task of late) {
      const order = task.order ? lateOrders.get(String(task.order)) || null : null;
      if (order && order.status === 'shipped' && mainLeg(task)) await orders().applyStatus(order, 'delivered', 'system', { note: 'Completed automatically 24 hours after the rider delivered it' });
      else {
        task.buyerConfirmedAt = new Date();
        finish(task);
        await task.save();
        if (task.errand) await errands().onTask(task, 'done');
      }
    }
};
exports.runDeliveryCheck = runDeliveryCheck;

// nobody took a matched job in 90 seconds: alert every rider in reach who has room
async function runWaves() {
  const due = await Task.find({ status: 'open', wave2At: { $lte: new Date() } }).limit(50);
  if (due.length) await Task.updateMany({ _id: { $in: due.map((task) => task._id) } }, { $unset: { wave2At: 1 } }); // one write
  for (const task of due) {
    if (task.preferred?.worker) { // the booked agent / rider didn't take it in time: now everyone near hears about it
      if (task.kind === 'delivery' && !task.errand) { // an order's delivery (a rider booked from the scan): then the nearest riders, in waves, as usual
        await Task.updateOne({ _id: task._id }, { $unset: { preferred: 1 } });
        task.preferred = undefined;
      }
      await alertNearby(task, { everyone: true });
      continue;
    }
    const rest = await riders().match(task, { exclude: (task.matched || []).map((item) => item.worker) });
    for (const item of rest) emitCustomer(String(item._id), 'work:new', { _id: task._id, kind: task.kind, pay: task.pay, collectCash: task.collectCash || 0, area: task.pickup.area, shop: task.pickup.name, to: task.dropoff?.address || '', km: task.km || null, toShopKm: item.km, toShopEta: item.eta });
  }
  return due.length;
}
exports.runWaves = runWaves;

// PUT /api/work/location { lat, lng }  (rider / agent app, every ~20 s while working)
// → matching uses it; buyers see where their order is and when it arrives
exports.location = asyncHandler(async (req, res) => {
  const worker = approved(req);
  const where = geo.toPoint(req.body.lat, req.body.lng);
  if (!where) throw httpError('That location isn’t in Kenya');
  const now = new Date();
  await Customer.updateOne({ _id: req.customer._id }, { $set: { 'worker.live': where, 'worker.liveAt': now } });
  const from = { lat: where.coordinates[1], lng: where.coordinates[0] };
  const near = await nearPlace(from); // "you are near …" on the rider's map
  // the hottest write path in the app (every rider, every ~20 s): one read for the tasks, one for their orders,
  // targeted $set updates (no full saves), and only the open screens are told (no notifications, no table rebuilds)
  const tasks = await Task.find({ worker: req.customer._id, status: { $in: ['assigned', 'picked_up'] }, kind: { $in: ['delivery', 'shopping'] }, 'courier.company': { $exists: false } })
    .select('kind status pickup dropoff km order errand').lean();
  if (!tasks.length) return res.json({ ok: true, tracking: 0, near });
  const live = { lat: from.lat, lng: from.lng, at: now };
  const etas = new Map(tasks.map((task) => {
    const eta = riders().etaFor(task, from, worker.vehicle);
    return [String(task._id), eta ? { minutes: eta.minutes, at: now, kmLeft: eta.kmLeft, kmToYou: eta.kmToYou, stage: eta.stage } : null];
  }));
  await Task.bulkWrite(tasks.map((task) => ({ updateOne: { filter: { _id: task._id }, update: { $set: { live, ...(etas.get(String(task._id)) ? { eta: etas.get(String(task._id)) } : {}) } } } })));
  const orderIds = tasks.filter((task) => task.order).map((task) => task.order);
  if (orderIds.length) {
    const list = await Order.find({ _id: { $in: orderIds }, 'rider.status': { $in: ['assigned', 'picked_up'] } });
    const moved = [];
    for (const order of list) {
      const eta = etas.get(String(order.rider.task));
      if (!eta && !tasks.some((task) => String(task._id) === String(order.rider.task))) continue; // not this rider's job
      const set = { 'rider.live': live, ...(eta ? { 'rider.eta': eta } : {}) };
      moved.push({ order, set });
    }
    if (moved.length) await Order.bulkWrite(moved.map(({ order, set }) => ({ updateOne: { filter: { _id: order._id }, update: { $set: set } } })), { ordered: false });
    for (const { order, set } of moved) {
      order.set(set);
      orders().broadcastLive(order);
    }
  }
  // errands (Shop & ride, parcels): one read and one bulk write for all of them
  await errands().onLive(tasks.filter((item) => item.errand).map((task) => ({ ...task, live, eta: etas.get(String(task._id)) })));
  res.json({ ok: true, tracking: tasks.length, near });
});

// the closest of our named places (pickup points, cached in memory: no database read) to where the rider is
async function nearPlace(from) {
  const points = await require('../market/pickupPoints').all().catch(() => []);
  let best = null;
  for (const point of points) {
    const km = geo.distanceKm(from, { coordinates: [point.lng, point.lat] });
    if (km != null && (!best || km < best.km)) best = { name: point.name, area: point.area, km };
  }
  return best && best.km <= 15 ? best : null;
}

// GET /api/work/sellers  → the sellers this agent works for (linked through orders / jobs), with their contacts
exports.mySellers = asyncHandler(async (req, res) => {
  const worker = approved(req);
  if (worker.role !== 'agent') throw httpError('For shopping agents', 403);
  res.json({ sellers: await require('../market/agentSellers').sellersOf(req.customer._id) });
});

// POST /api/work/tasks/:id/rate { stars, comment }  (the buyer / customer, once, after delivery)
exports.rate = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Delivery not found', 404);
  const task = await Task.findById(req.params.id);
  if (!task?.worker || !['delivery', 'shopping', 'inspection'].includes(task.kind)) throw httpError('Delivery not found', 404);
  let delivered = false;
  if (task.kind === 'inspection') {
    // our shopping agent: rated by the buyer once the inspection is done (passed or failed)
    const order = task.order ? await Order.findById(task.order).select('buyer inspection.status').lean() : null;
    if (!order || String(order.buyer) !== String(req.customer._id)) throw httpError('Inspection not found', 404);
    if (!['passed', 'failed'].includes(order.inspection?.status)) throw httpError('You can rate your agent once they’ve inspected it');
    delivered = true;
  } else if (task.order) {
    const order = await Order.findById(task.order).select('buyer status').lean();
    if (!order || String(order.buyer) !== String(req.customer._id)) throw httpError('Delivery not found', 404);
    delivered = order.status === 'delivered';
  } else if (task.errand) {
    const errand = await require('../models/Errand').findById(task.errand).select('customer status').lean();
    if (!errand || String(errand.customer) !== String(req.customer._id)) throw httpError('Delivery not found', 404);
    delivered = ['delivered', 'done'].includes(errand.status);
  } else throw httpError('Delivery not found', 404);
  if (!delivered && !['delivered', 'done'].includes(task.status)) throw httpError('You can rate your rider once it’s delivered');
  if (task.rating?.stars) throw httpError('You already rated this delivery. Thank you!', 409);
  const stars = Math.round(Number(req.body.stars));
  if (!(stars >= 1 && stars <= 5)) throw httpError('Choose 1 to 5 stars');
  const comment = clean(req.body.comment, 300);
  const rating = await riders().rate(task, stars, comment);
  if (task.order) await Order.updateOne({ _id: task.order }, { $set: task.kind === 'inspection' ? { 'inspection.rated': stars } : { 'rider.rated': stars } });
  if (task.errand) await require('../models/Errand').updateOne({ _id: task.errand }, { $set: { rated: stars } });
  emitCustomer(String(task.worker), 'work:rated', { stars, orderNo: task.orderNo, rating });
  res.json({ ok: true, stars, rating });
});
exports.startWorkWorker = () => {
  // each runs on one server at a time (several servers behind a load balancer never pay a rider twice)
  const jobs = require('../utils/jobs');
  jobs.every('delivery-check', 10 * 60 * 1000, runDeliveryCheck);
  jobs.every('rider-payouts', 60 * 1000, () => payouts.runPayouts());
  jobs.every('rider-matching', 30 * 1000, runWaves);
  jobs.every('worker-doc-reminders', 6 * 3600 * 1000, () => require('./workerDocsController').runDocReminders()); // licences / insurance about to expire
};

// POST /api/orders/:id/tip { amount }  (buyer: "I sent a tip" — the money goes straight to the rider's M-Pesa)
exports.tip = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id);
  if (!order || String(order.buyer) !== String(req.customer._id)) throw httpError('Order not found', 404);
  if (order.status !== 'delivered' || !order.rider?.task) throw httpError('You can tip your rider after the delivery');
  if (order.rider.tippedAt) throw httpError('You already recorded a tip for this delivery. Thank you!', 409); // once per order
  const amount = Math.round(Number(req.body.amount));
  if (!(amount >= 10 && amount <= 10000)) throw httpError('Enter the tip you sent (KSh 10 to 10,000)');
  order.rider.tip = (order.rider.tip || 0) + amount;
  order.rider.tippedAt = new Date();
  await order.save();
  const task = await Task.findByIdAndUpdate(order.rider.task, { $push: { tips: { amount } } }, { returnDocument: 'after' });
  if (task?.worker) emitCustomer(String(task.worker), 'work:tip', { amount, from: order.buyerName.split(' ')[0], orderNo: order.orderNo });
  res.json(orders().view(order, req.customer._id));
});

// POST /api/work/tasks/:id/inspect { checks: { rightItem, size, colour, quality }, note }
exports.inspect = asyncHandler(async (req, res) => {
  approved(req);
  if (!isId(req.params.id)) throw httpError('Job not found', 404);
  const task = await Task.findOne({ _id: req.params.id, worker: req.customer._id, $or: [{ kind: 'inspection' }, { kind: 'delivery', inspect: true }] });
  if (!task) throw httpError('Job not found', 404);
  if (task.status !== 'assigned' || task.result?.passed != null) throw httpError('This job is already inspected', 409);
  const both = task.kind === 'delivery';
  const currentChecks = req.body.checks || {};
  const checks = { rightItem: currentChecks.rightItem === true, size: currentChecks.size === true, colour: currentChecks.colour === true, quality: currentChecks.quality === true };
  const note = clean(req.body.note, 500);
  const passed = Object.values(checks).every(Boolean);
  if (!passed && note.length < 5) throw httpError('Say what’s wrong, so the buyer and seller know (e.g. “size 40, buyer ordered 42”)');
  task.result = { passed, checks, note };
  const order = await Order.findById(task.order);
  const errand = task.errand ? await require('../models/Errand').findById(task.errand).select('shopride.price').lean() : null;
  if (!both) finish(task);
  else if (!passed) {
    // inspect & deliver, failed: paid for the inspection only; nothing to deliver
    task.fee = order?.inspection?.fee ?? errand?.shopride?.price?.inspection ?? 0;
    task.pay = payouts.split(task.fee).net;
    task.collectCash = 0;
    finish(task);
  }
  await task.save();
  if (order && both && !passed) {
    order.rider.status = 'waiting';
    order.rider.task = undefined;
  }
  if (order) {
    order.inspection.status = passed ? 'passed' : 'failed';
    order.inspection.result = note || (passed ? 'Right item, size, colour and quality' : '');
    order.history.push({ status: order.status, by: 'agent', note: passed ? `✅ Inspection passed (${req.customer.name})${note ? `: ${note}` : ''}` : `❌ Inspection failed (${req.customer.name}): ${note}` });
    // passed: the seller may now send it (rider orders: the seller taps "Call a rider")
    // a walking delivery checked by our shopping agent: the seller is paid now, before it's walked over
    if (passed && task.kind === 'inspection' && order.delivery?.method === 'walk') orders().releaseEarly(order, `inspection passed (${req.customer.name})`);
    await order.save();
    orders().broadcast(order);
    require('../utils/notify').inspected?.(order);
  }
  if (task.errand) await errands().onTask(task, 'inspected', { passed, note });
  res.json(taskView(task.toObject(), req.customer._id));
});

// ---------------------------------------------------------------- partner shops: Safe deal verification
// POST /api/work/tasks/:id/received  (partner: the seller brought the item)
exports.received = asyncHandler(async (req, res) => {
  const task = await myTask(req, 'verification', ['assigned']);
  const order = await Order.findById(task.order);
  if (!order || order.status === 'cancelled') throw httpError('This order was cancelled. Don’t take the item.', 409);
  task.status = 'picked_up';
  task.pickedUpAt = new Date();
  await task.save();
  order.verification.status = 'received';
  order.verification.receivedAt = task.pickedUpAt;
  order.history.push({ status: order.status, by: 'partner', note: `📥 Item received at ${order.verification.partnerName} for verification` });
  await order.save();
  orders().broadcast(order);
  res.json(taskView(task.toObject(), req.customer._id));
});

// POST /api/work/tasks/:id/verify { checks: { matchesAd, works, condition, genuine }, serial, note }
//   passed → the seller is paid now and our rider is called to the partner shop · failed → the buyer is refunded
exports.verify = asyncHandler(async (req, res) => {
  const task = await myTask(req, 'verification', ['picked_up']);
  const order = await Order.findById(task.order);
  if (!order || order.status === 'cancelled') throw httpError('This order was cancelled. Give the item back to the seller.', 409);
  const given = req.body.checks || {};
  const checks = { matchesAd: given.matchesAd === true, works: given.works === true, condition: given.condition === true, genuine: given.genuine === true };
  const serial = clean(req.body.serial, 40).toUpperCase();
  const note = clean(req.body.note, 500);
  const passed = Object.values(checks).every(Boolean);
  if (!passed && note.length < 5) throw httpError('Say what’s wrong, so the buyer and seller know (e.g. “screen cracked, the ad says no scratches”)');
  task.result = { passed, checks, note, serial };
  finish(task); // the partner's commission is earned either way: they did the check
  await task.save();
  Object.assign(order.verification, { status: passed ? 'passed' : 'failed', checks, serial, note, verifiedAt: new Date() });
  if (passed) {
    order.history.push({ status: order.status, by: 'partner', note: `✅ Verified at ${order.verification.partnerName}${serial ? ` (serial/IMEI ${serial})` : ''}${note ? `: ${note}` : ''}` });
    orders().releaseEarly(order, `verified at our partner shop ${order.verification.partnerName}`);
    const delivery = await openDelivery(order); // our rider collects it from the partner shop
    if (delivery) order.history.push({ status: order.status, by: 'system', note: '🏍️ Riders near the partner shop alerted' });
    await order.save();
    orders().broadcast(order);
  } else {
    // the buyer gets the item price back; the verification fee paid for the check
    order.verification.refund = order.subtotal;
    await order.save();
    await orders().applyStatus(order, 'cancelled', 'partner', { reason: `Failed verification at ${order.verification.partnerName}: ${note}. Refund of KSh ${order.subtotal.toLocaleString('en-KE')} on its way. Seller: collect your item from the partner shop.` });
  }
  res.json(taskView(task.toObject(), req.customer._id));
});

// POST /api/work/tasks/:id/help { note }  (partner: call a shopping agent nearby, e.g. to test a laptop or check a phone's papers)
exports.help = asyncHandler(async (req, res) => {
  const task = await myTask(req, 'verification', ['assigned', 'picked_up']);
  const note = clean(req.body.note, 300);
  if (note.length < 5) throw httpError('Say what you need help with');
  const [lng, lat] = task.pickup.point.coordinates;
  const agents = await Customer.find({ 'worker.role': 'agent', 'worker.status': 'approved', 'worker.available': true, 'worker.base': geo.within({ lat, lng, km: 10 }) }).select('_id').limit(30).lean();
  const ask = { task: task._id, orderNo: task.orderNo, shop: task.pickup.name, address: task.pickup.address, area: task.pickup.area, phone: req.customer.phone || '', note, lat, lng };
  for (const agent of agents) emitCustomer(String(agent._id), 'work:help', ask);
  emitAdmin('work:help', ask);
  await Order.updateOne({ _id: task.order }, { $push: { 'verification.help': { note, at: new Date() } } });
  require('../security/audit').audit(req, 'partner.help', { target: `task:${task._id}`, detail: note });
  res.json({ ok: true, agentsAlerted: agents.length });
});

// GET /api/work/partners?near=lat,lng  (public: our partner shops / verification centres)
exports.partners = asyncHandler(async (req, res) => {
  const partners = require('../market/partners');
  const near = geo.parseNear({ near: req.query.near, km: 50 });
  // public: the shop, where and when; not the owner's name or phone
  res.json({ spacingKm: partners.SPACING_KM, partners: (await partners.allPartners(near)).map(({ phone, owner, ...shop }) => shop) });
});

// sellers who never dropped the item off: the deal is cancelled and the buyer gets everything back
async function expireDropoffs() {
  const late = await Order.find({ 'delivery.method': 'verified', 'verification.status': 'awaiting_dropoff', 'verification.dropoffBy': { $lt: new Date() }, status: { $in: ['placed', 'confirmed'] } }).limit(50);
  for (const order of late) await orders().applyStatus(order, 'cancelled', 'system', { reason: `The seller didn’t take the item to our partner shop within ${DROPOFF_DAYS} days. Full refund on its way.` });
}
exports.expireDropoffs = expireDropoffs;

// ---------------------------------------------------------------- admin: Field team
// GET /api/work/admin/workers?status=pending|approved|all&role=
exports.adminWorkers = asyncHandler(async (req, res) => {
  const filter = { 'worker.role': { $in: ['rider', 'agent', 'partner'] } };
  if (['pending', 'approved', 'rejected', 'suspended'].includes(req.query.status)) filter['worker.status'] = req.query.status;
  if (['rider', 'agent', 'partner'].includes(req.query.role)) filter['worker.role'] = req.query.role;
  const soon = new Date(Date.now() + 30 * 86400000);
  if (req.query.docs === 'expired') filter['worker.docs.expiresAt'] = { $lt: new Date() };
  if (req.query.docs === 'expiring') filter['worker.docs.expiresAt'] = { $lte: soon };
  if (req.query.docs === 'pending') filter['worker.docs.status'] = 'pending';
  const { summaryOf } = require('./workerDocsController');
  const list = await Customer.find(filter).sort({ 'worker.appliedAt': -1 }).limit(300).select('name email phone worker').lean();
  const stats = await Task.aggregate([{ $match: { worker: { $in: list.map((item) => item._id) } } }, { $group: { _id: '$worker', done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } }, active: { $sum: { $cond: [{ $in: ['$status', ['assigned', 'picked_up']] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$result.passed', false] }, 1, 0] } } } }]);
  const by = new Map(stats.map((stat) => [String(stat._id), stat]));
  const pending = await Customer.countDocuments({ 'worker.status': 'pending' });
  res.json({
    pending,
    workers: list.map((item) => ({ _id: item._id, name: item.name, email: item.email, phone: item.phone, ...workerView(item.worker), idNumber: item.worker.idNumber, appliedAt: item.worker.appliedAt, docs: summaryOf(item.worker), done: by.get(String(item._id))?.done || 0, active: by.get(String(item._id))?.active || 0 })),
  });
});

// POST /api/work/admin/workers/:id { action: approve | reject | suspend | restore, note }
exports.adminWorkerAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Not found', 404);
  const customer = await Customer.findById(req.params.id);
  if (!customer?.worker?.role) throw httpError('Not found', 404);
  const note = clean(req.body.note, 200);
  // the market a shopping agent works in (set or changed by our team)
  if (req.body.action === 'market') {
    if (customer.worker.role !== 'agent') throw httpError('Only shopping agents work in a market');
    const market = isId(req.body.market) ? await require('../models/Market').findOne({ _id: req.body.market, approved: true }).lean() : null;
    if (!market) throw httpError('Choose one of our markets');
    customer.set('worker.market', market._id);
    customer.set('worker.marketName', market.name);
    customer.set('worker.marketSlug', market.slug);
    if (market.point && !customer.worker.base?.coordinates) customer.set('worker.base', market.point);
    customer.set('worker.baseArea', customer.worker.baseArea || market.area || market.name);
    await customer.save();
    require('../utils/cache').invalidate('market:');
    return res.json({ ok: true, market: { _id: market._id, name: market.name, slug: market.slug } });
  }
  const to = { approve: 'approved', reject: 'rejected', suspend: 'suspended', restore: 'approved' }[req.body.action];
  if (to === 'approved' && customer.worker.role === 'agent' && !customer.worker.market) throw httpError('Link this shopping agent to the market they work in first', 409);
  if (!to) throw httpError('Unknown action');
  if (to === 'approved' && customer.worker.role === 'partner') {
    const near = await require('../market/partners').tooClose(customer.worker.base, customer._id);
    if (near) throw httpError(`${near.name} (${near.area}) is an approved partner shop only ${near.km} km away. Partner shops must be at least 2 km apart.`, 409);
  }
  customer.set('worker.status', to);
  customer.set('worker.reviewNote', note);
  if (to === 'approved') customer.set('worker.approvedAt', new Date());
  await customer.save();
  require('../utils/cache').invalidate('market:shopride-agents'); // Shop & ride: which markets have our trained agents
  // a suspended rider's unfinished jobs go back on the board
  if (to === 'suspended') {
    const back = await Task.find({ worker: customer._id, status: 'assigned' });
    for (const task of back) {
      task.status = 'open';
      task.worker = undefined;
      task.workerName = undefined;
      task.workerPhone = undefined;
      await task.save();
      await alertNearby(task);
    }
  }
  res.json({ _id: customer._id, worker: workerView(customer.worker) });
});

// GET /api/work/admin/tasks?status=open|active|done|all
exports.adminTasks = asyncHandler(async (req, res) => {
  const st = { open: ['open'], active: ['assigned', 'picked_up'], done: ['done'], cancelled: ['cancelled'] }[req.query.status];
  const list = await Task.find(st ? { status: { $in: st } } : {}).sort({ updatedAt: -1 }).limit(200).lean();
  res.json({ tasks: list.map((item) => ({ ...taskView(item, item.worker), workerName: item.workerName, workerPhone: item.workerPhone, dropoff: item.dropoff, pickup: { ...item.pickup, lat: item.pickup.point.coordinates[1], lng: item.pickup.point.coordinates[0] } })) });
});

// ---------------------------------------------------------------- admin: earnings & payouts
// the period: ?period=today|week|month|all or ?from=YYYY-MM-DD&to=YYYY-MM-DD (Kenya time)
function periodOf(query) {
  const day = (when) => (/^\d{4}-\d{2}-\d{2}$/.test(String(when || '')) ? new Date(`${when}T00:00:00+03:00`) : null);
  const date = new Date(Date.now() + 3 * 3600000);
  const today = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - 3 * 3600000);
  if (query.from || query.to) return { from: day(query.from), to: day(query.to) ? new Date(day(query.to).getTime() + 86400000) : null, label: 'custom' };
  if (query.period === 'today') return { from: today, label: 'today' };
  if (query.period === 'week') return { from: new Date(today.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000), label: 'week' };
  if (query.period === 'month') return { from: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - 3 * 3600000), label: 'month' };
  return { label: 'all' };
}

// GET /api/work/admin/earnings?period=…  → one row per rider / agent: fees, tax, our commission, cash, sent, balance
exports.adminEarnings = asyncHandler(async (req, res) => {
  const periodOfResult = periodOf(req.query);
  const rows = await payouts.earnings({ from: periodOfResult.from, to: periodOfResult.to });
  const ids = rows.map((row) => row._id);
  const [people, balances] = await Promise.all([
    Customer.find({ _id: { $in: ids } }).select('name phone worker.role worker.mpesaPhone worker.vehicle worker.plate worker.status').lean(),
    Task.aggregate([{ $match: { worker: { $in: ids }, status: 'done', 'payout.status': { $in: ['waiting', 'due', 'owed', 'sending'] } } }, { $group: { _id: { w: '$worker', s: '$payout.status' }, amount: { $sum: { $ifNull: ['$money.toPay', 0] } } } }]),
  ]);
  const who = new Map(people.map((person) => [String(person._id), person]));
  const bal = new Map();
  for (const balance of balances) {
    const id = String(balance._id.w);
    if (!bal.has(id)) bal.set(id, { waiting: 0, due: 0, owed: 0, sending: 0 });
    bal.get(id)[balance._id.s] = balance.amount;
  }
  const out = rows.map((row) => {
    const whoEntry = who.get(String(row._id)) || {};
    const balEntry = bal.get(String(row._id)) || { waiting: 0, due: 0, owed: 0, sending: 0 };
    return {
      worker: row._id, name: whoEntry.name || '(removed)', role: whoEntry.worker?.role || '', phone: whoEntry.phone || '', mpesaPhone: whoEntry.worker?.mpesaPhone || whoEntry.phone || '', vehicle: whoEntry.worker?.vehicle || '', plate: whoEntry.worker?.plate || '', status: whoEntry.worker?.status || '',
      jobs: row.jobs, fees: row.gross, tax: row.tax, commission: row.commission, charged: row.tax + row.commission, earned: row.net, cash: row.cash, refunds: row.reimburse, sent: row.sent, tips: row.tips || 0, last: row.last,
      waiting: balEntry.waiting, ready: balEntry.due, owed: balEntry.owed, sending: balEntry.sending, balance: balEntry.waiting + balEntry.due + balEntry.owed + balEntry.sending,
    };
  });
  const sum = (key) => out.reduce((total, item) => total + (item[key] || 0), 0);
  const result = payouts.rates();
  res.json({
    period: periodOfResult.label, from: periodOfResult.from, to: periodOfResult.to, commissionPercent: result.commissionPercent, taxPercent: result.taxPercent, delayMin: result.delayMin,
    b2cReady: require('../utils/mpesa').b2cReady(), demoPayments: require('../config/site').site().demoPayments,
    rows: out,
    totals: { people: out.length, jobs: sum('jobs'), fees: sum('fees'), tax: sum('tax'), commission: sum('commission'), charged: sum('charged'), earned: sum('earned'), cash: sum('cash'), refunds: sum('refunds'), sent: sum('sent'), balance: sum('balance'), owed: sum('owed'), ready: sum('ready'), waiting: sum('waiting') },
  });
});

// GET /api/work/admin/earnings/:worker?period=…  → their jobs, one line each
exports.adminWorkerJobs = asyncHandler(async (req, res) => {
  if (!isId(req.params.worker)) throw httpError('Not found', 404);
  const periodOfResult = periodOf(req.query);
  const match = { worker: new mongoose.Types.ObjectId(req.params.worker), status: 'done' };
  if (periodOfResult.from || periodOfResult.to) match.doneAt = { ...(periodOfResult.from ? { $gte: periodOfResult.from } : {}), ...(periodOfResult.to ? { $lt: periodOfResult.to } : {}) };
  const list = await Task.find(match).sort({ doneAt: -1 }).limit(300).select('kind inspect courier.name orderNo doneAt money payout tips').lean();
  res.json({
    jobs: list.map((item) => ({
      _id: item._id, orderNo: item.orderNo, doneAt: item.doneAt, what: item.kind === 'inspection' ? 'Inspection' : item.courier?.name ? `Courier (${item.courier.name})` : item.inspect ? 'Check & deliver' : 'Delivery',
      ...(item.money || {}), payout: item.payout?.status, ref: item.payout?.ref || '', dueAt: item.payout?.dueAt, tips: (item.tips || []).reduce((total, tip) => total + tip.amount, 0),
    })),
  });
});

// GET /api/work/admin/payouts/list?status=…  → M-Pesa transfers
exports.adminPayoutList = asyncHandler(async (req, res) => {
  const Payout = require('../models/Payout');
  const filter = ['sending', 'paid', 'failed'].includes(req.query.status) ? { status: req.query.status } : {};
  const list = await Payout.find(filter).sort({ createdAt: -1 }).limit(200).select('-tasks').lean();
  res.json({ payouts: list });
});

// POST /api/work/admin/payouts/:id/retry  → try a failed transfer again now
exports.adminPayoutRetry = asyncHandler(async (req, res) => {
  const Payout = require('../models/Payout');
  if (!isId(req.params.id)) throw httpError('Not found', 404);
  const payout = await Payout.findOneAndUpdate({ _id: req.params.id, status: 'failed' }, { $set: { retried: true } }, { returnDocument: 'after' });
  if (!payout) throw httpError('Only failed transfers can be tried again', 409);
  await Task.updateMany({ 'payout.payout': payout._id, 'payout.status': 'sending' }, { $set: { 'payout.status': 'due' }, $unset: { 'payout.payout': 1 } });
  require('../security/audit').audit(req, 'payout.retry', { target: `payout:${payout._id}`, detail: `KSh ${payout.amount}` });
  const result = await payouts.runPayouts();
  res.json({ message: result.sent ? 'Sent again' : 'Queued: it goes out in the next run' });
});

// POST /api/work/admin/payouts/manual { worker, ref }  → an admin sent the balance by hand (M-Pesa code)
exports.adminPayManual = asyncHandler(async (req, res) => {
  if (!isId(req.body.worker)) throw httpError('Choose who you paid');
  const ref = clean(req.body.ref, 40).toUpperCase();
  if (ref.length < 6) throw httpError('Enter the M-Pesa code of the payment (e.g. SK7H2K9LQ1)');
  const tasks = await Task.find({ worker: req.body.worker, status: 'done', 'payout.status': { $in: ['due', 'waiting', 'owed'] } }).lean();
  const total = tasks.reduce((sum, task) => sum + (task.money?.toPay || 0), 0);
  if (!tasks.length || total <= 0) throw httpError(total < 0 ? 'They owe us more than we owe them: nothing to send' : 'Nothing to pay this person right now');
  const payout = await payouts.createPayout(req.body.worker, tasks, 'manual', { ref, by: req.user?.name || req.user?.email || 'admin', paidAt: new Date() });
  await payouts.markPaid(payout, ref);
  res.json({ message: `Recorded KSh ${total.toLocaleString('en-KE')} paid to ${payout.name} (${ref})`, payout: payout });
});

// GET /api/work/admin/payouts  → finished, unpaid jobs per person per week ("due" once the week is over)
exports.adminPayouts = asyncHandler(async (req, res) => {
  const thisWeek = weekOf();
  const rows = await Task.aggregate([
    { $match: { status: 'done', 'payout.status': { $in: ['unpaid', 'paid'] } } },
    { $group: { _id: { worker: '$worker', week: '$week', paid: '$payout.status' }, jobs: { $sum: 1 }, amount: { $sum: { $subtract: ['$pay', { $ifNull: ['$collectCash', 0] }] } }, ref: { $max: '$payout.ref' }, paidAt: { $max: '$payout.paidAt' }, kinds: { $addToSet: '$kind' } } },
    { $sort: { '_id.week': -1 } },
  ]);
  const people = await Customer.find({ _id: { $in: rows.map((row) => row._id.worker) } }).select('name phone worker.role worker.mpesaPhone').lean();
  const who = new Map(people.map((person) => [String(person._id), person]));
  res.json({
    thisWeek, thisWeekLabel: weekLabel(thisWeek),
    rows: rows.map((row) => {
      const whoEntry = who.get(String(row._id.worker)) || {};
      return { worker: row._id.worker, name: whoEntry.name, phone: whoEntry.phone, mpesaPhone: whoEntry.worker?.mpesaPhone, role: whoEntry.worker?.role, week: row._id.week, weekLabel: weekLabel(row._id.week), jobs: row.jobs, amount: row.amount, status: row._id.paid === 'paid' ? 'paid' : row._id.week < thisWeek ? 'due' : 'this-week', ref: row.ref, paidAt: row.paidAt };
    }),
  });
});

// POST /api/work/admin/payouts { worker, week, ref }  → mark that week's jobs paid
exports.adminPay = asyncHandler(async (req, res) => {
  if (!isId(req.body.worker) || !/^\d{4}-W\d{2}$/.test(String(req.body.week))) throw httpError('Choose who and which week');
  if (String(req.body.week) >= weekOf()) throw httpError('This week isn’t over yet. Pay it from Monday.');
  const ref = clean(req.body.ref, 40);
  if (ref.length < 4) throw httpError('Enter the M-Pesa reference of the payment');
  const result = await Task.updateMany({ worker: req.body.worker, week: req.body.week, status: 'done', 'payout.status': 'unpaid' }, { $set: { 'payout.status': 'paid', 'payout.paidAt': new Date(), 'payout.ref': ref } });
  if (!result.modifiedCount) throw httpError('Nothing left to pay for that week');
  emitCustomer(String(req.body.worker), 'work:paid', { week: req.body.week });
  res.json({ message: `Marked ${result.modifiedCount} job${result.modifiedCount === 1 ? '' : 's'} paid` });
});

module.exports.VEHICLES = VEHICLES;
