// Marketplace orders (Jumia-style "Buy now").
//
// Checkout: the cart is split into one order per seller. Stock is reserved straight away (atomically, so two
// buyers can't buy the last item twice). Payment:
//   - cod   (cash on delivery): the order is placed at once; the buyer pays the seller on delivery.
//   - mpesa: one STK push for the whole cart, paid to the marketplace. Orders wait in "awaiting_payment" until
//            Safaricom confirms (callback, or our own status check). Unpaid orders are cancelled after 30 minutes
//            and their stock is released. After delivery the seller is owed the total minus the commission.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { stkPush, stkQuery, formatPhone } = require('../utils/mpesa');
const { emitCustomer, emitAdmin } = require('../utils/realtime');
const { invalidate } = require('../utils/cache');
const { site } = require('../config/site');
const { COUNTIES } = require('../market/categories');
const notify = require('../utils/notify');

const PAY_WINDOW_MIN = 30;
// our payment ID, given once a payment is complete: "PAY-7K3M9QX2" (no 0/O/1/I to misread). One per payment: a checkout
// paid to our wallet shares one; an order paid straight to its seller has its own.
const PAY_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newPayRef = () => `PAY-${Array.from(crypto.randomBytes(8), (byte) => PAY_ID_CHARS[byte % PAY_ID_CHARS.length]).join('')}`;
exports.newPayRef = newPayRef;
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);
const NO_BUY_NOW = new Set(['vehicles', 'land-property']); // contact-only categories (also the "services" type)
// second-hand: used, refurbished, ex-UK… (anything not sold as new)
const isSecondHand = (condition) => !!condition && !/^(new|brand new)\b/i.test(String(condition).trim());
exports.isSecondHand = isSecondHand;
exports.canBuyNow = (category, sub) => !NO_BUY_NOW.has(category) && sub !== 'services';

// ---------------------------------------------------------------- views
function view(order, viewer) {
  const role = viewer === 'admin' ? 'admin' : String(order.buyer) === String(viewer) ? 'buyer' : 'seller';
  return {
    _id: order._id, orderNo: order.orderNo, checkoutId: order.checkoutId, role,
    buyer: { _id: order.buyer, name: order.buyerName, ...(role !== 'buyer' ? { phone: order.buyerPhone } : {}) },
    seller: { _id: order.seller, name: order.sellerName },
    items: order.items, subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total, payOnDelivery: order.payOnDelivery || 0, weightKg: order.weightKg,
    delivery: order.delivery,
    sellerPay: order.sellerPay?.method ? { method: order.sellerPay.method, till: order.sellerPay.till || '', paybill: order.sellerPay.paybill || '', account: order.sellerPay.account || '', phone: order.sellerPay.phone || '', name: order.sellerPay.name || '', text: order.sellerPay.text } : null,
    payment: { method: order.payment.method, status: order.payment.status, ref: order.payment.ref || '', receipt: order.payment.receipt, paidAt: order.payment.paidAt, failReason: order.payment.failReason, ...(order.payment.direct ? {
      direct: true, channel: order.payment.channel, amount: order.payment.amount, to: order.payment.to?.text || '', claimed: !!order.payment.claimCode, claimedAt: order.payment.claimedAt, mismatch: !!order.payment.mismatch,
      // the seller never sees the buyer's code (they type the code they received; we compare); the buyer never sees the seller's
      ...(role === 'seller' ? { sellerCode: order.payment.sellerCode || '' } : { claimCode: order.payment.claimCode || '' }),
      fee: order.payment.fee?.amount ? { amount: order.payment.fee.amount, status: order.payment.fee.status, ...(role !== 'seller' ? { receipt: order.payment.fee.receipt || '' } : {}) } : null,
    } : {}) },
    status: order.status, history: order.history, shipNote: order.shipNote, cancelReason: order.cancelReason, cancelledBy: order.cancelledBy,
    ...(order.rider?.fee != null && ['rider', 'courier', 'verified'].includes(order.delivery?.method) ? { rider: { ...(order.rider.courier?.company ? { courier: { company: order.rider.courier.company, name: order.rider.courier.name, fare: order.rider.courier.fare, handling: order.rider.courier.handling, eta: order.rider.courier.eta || '', waybill: order.rider.courier.waybill || '', office: order.rider.courier.office || '', sentAt: order.rider.courier.sentAt } } : {}), combined: !!order.rider.combined, fee: order.rider.fee, status: order.rider.status, name: order.rider.name || '', phone: order.rider.phone || '', ...(order.rider.task && ['assigned', 'picked_up', 'delivered'].includes(order.rider.status) ? { task: String(order.rider.task) } : {}), vehicle: order.rider.vehicle || '', plate: order.rider.plate || '',
      taskId: order.rider.task || null, rated: order.rider.rated || 0, stars: order.rider.stars?.count ? order.rider.stars : null, matching: order.rider.status === 'open' ? order.rider.matching || '' : '',
      ...(['assigned', 'picked_up'].includes(order.rider.status) ? { live: order.rider.live?.lat != null ? order.rider.live : null, eta: order.rider.eta?.minutes != null ? { minutes: order.rider.eta.minutes, at: order.rider.eta.at } : null, kmLeft: order.rider.eta?.kmLeft ?? null, kmToYou: order.rider.eta?.kmToYou ?? null, stage: order.rider.eta?.stage || '' } : {}), ...(role === 'buyer' && order.status === 'delivered' ? { tipPhone: order.rider.tipPhone || order.rider.phone || '' } : {}), tip: order.rider.tip || 0, ...(order.rider.preferred?.name && !order.rider.name ? { booked: { name: String(order.rider.preferred.name).split(' ')[0], vehicle: order.rider.preferred.vehicle || '' } } : {}) } } : {}),
    ...(order.inspection?.status ? { inspection: { fee: order.inspection.fee || 0, free: !!order.inspection.free, by: order.inspection.by || 'agent', notes: order.inspection.notes || '', chosenAgent: order.inspection.preferred?.name ? { name: order.inspection.preferred.name, marketName: order.inspection.preferred.marketName || '', phone: order.inspection.preferred.phone || '' } : null, taskId: order.inspection.task || null, rated: order.inspection.rated || 0, status: order.inspection.status, result: order.inspection.result || '', agentName: order.inspection.agentName || '', agentPhone: order.inspection.agentPhone || '', rechecks: order.inspection.rechecks || 0 } } : {}),
    ...(order.verification?.status ? { verification: verificationView(order.verification, role) } : {}),
    ...(require('../market/transit').forOrder(order) ? { transit: require('../market/transit').forOrder(order) } : {}),
    ...(role !== 'buyer' ? { commission: order.commission, commissionPercent: order.commissionPercent, payout: order.payout } : {}),
    createdAt: order.createdAt, updatedAt: order.updatedAt,
  };
}

// Safe deal: the seller gets the partner shop's address and phone (to drop the item off); the buyer sees where it's checked
function verificationView(verification, role) {
  return {
    status: verification.status, fee: verification.fee || 0, partnerName: verification.partnerName || '', area: verification.area || '', address: verification.address || '',
    hours: verification.hours || '', lat: verification.lat, lng: verification.lng, ...(role !== 'buyer' ? { partnerPhone: verification.partnerPhone || '' } : {}),
    checks: verification.checks || {}, note: verification.note || '', serial: verification.serial || '',
    dropoffBy: verification.dropoffBy, receivedAt: verification.receivedAt, verifiedAt: verification.verifiedAt, refund: verification.refund || 0,
  };
}
exports.view = view;
// tell the buyer, the seller and the admins (each gets their own view)
exports.broadcast = (order) => broadcast(order);
// live-only changes (the rider moved, a new ETA): just the open screens, no 🔔 notification, no directory rebuild
exports.broadcastLive = (order) => {
  emitCustomer(String(order.buyer), 'order:update', view(order, order.buyer));
  emitCustomer(String(order.seller), 'order:update', view(order, order.seller));
};
function broadcast(order) {
  emitCustomer(String(order.buyer), 'order:update', view(order, order.buyer));
  emitCustomer(String(order.seller), 'order:update', view(order, order.seller));
  emitAdmin('order:update', view(order, 'admin'));
  require('../market/alerts').orderChanged(order).catch((error) => console.error('[notify]', error.message)); // 🔔 English & Kiswahili
  require('../market/directory').touch(order.buyer, order.seller); // the buyers / sellers tables
}

// ---------------------------------------------------------------- stock
async function reserve(items) {
  const done = [];
  // items sold online: one atomic update each (it must fail on its own when there isn't enough stock); the same update
  // takes the stock down and marks the ad sold out when it reaches 0
  for (const it of items.filter((item) => !item.offStock)) {
    const listing = await Listing.findOneAndUpdate(
      { _id: it.listing, status: 'active', buyNow: true, stock: { $gte: it.qty } },
      [
        { $set: { stock: { $subtract: ['$stock', it.qty] }, soldCount: { $add: [{ $ifNull: ['$soldCount', 0] }, it.qty] } } },
        { $set: { status: { $cond: [{ $lte: ['$stock', 0] }, 'sold', '$status'] } } }, // sold out
      ],
      { returnDocument: 'after', updatePipeline: true }
    ).select('stock title');
    if (!listing) {
      await release(done);
      const now = await Listing.findById(it.listing).select('stock title status').lean();
      throw httpError(now && now.status === 'active' && now.stock > 0 ? `Only ${now.stock} left of “${now.title}”. Please lower the quantity.` : `“${it.title}” is sold out`, 409);
    }
    done.push(it);
  }
  // agreed-price sales of ads that aren't sold online: nothing to count, the seller manages the ad (one bulk write)
  const offStock = items.filter((item) => item.offStock);
  if (offStock.length) await Listing.bulkWrite(offStock.map((it) => ({ updateOne: { filter: { _id: it.listing }, update: { $inc: { soldCount: it.qty } } } })));
  invalidate('market:');
  require('../market/catalog').refreshSoon(items.map((item) => item.product));
}
async function release(items) {
  if (!items.length) return;
  // one ordered bulk write for every item: stock back, then "back in stock" for ads that were sold out
  const ops = items.flatMap((it) => (it.offStock
    ? [{ updateOne: { filter: { _id: it.listing }, update: { $inc: { soldCount: -it.qty } } } }]
    : [
      { updateOne: { filter: { _id: it.listing }, update: { $inc: { stock: it.qty, soldCount: -it.qty } } } },
      { updateOne: { filter: { _id: it.listing, status: 'sold', buyNow: true, stock: { $gt: 0 } }, update: { $set: { status: 'active' } } } }, // back in stock
    ]));
  await Listing.bulkWrite(ops, { ordered: true });
  invalidate('market:');
  require('../market/catalog').refreshSoon(items.map((item) => item.product));
}

const newOrderNo = () => {
  const date = new Date();
  const ymd = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `OS${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

// ---------------------------------------------------------------- walking delivery
const { walkQuote } = require('../market/walk');
const geoUtil = require('../market/geo');
const buyerPoint = (location) => (geoUtil.toPoint(location?.lat, location?.lng) ? { lat: Number(location.lat), lng: Number(location.lng) } : null);

// POST /api/orders/walk-quote { items: [{ listingId, qty }], lat, lng }
//   → { sellers: { <sellerId>: { ok, km, minutes, fee, free, reason } } }  can each shop walk this order to me?
exports.walkQuote = asyncHandler(async (req, res) => {
  const at = buyerPoint(req.body);
  if (!at) throw httpError('We need your location in Kenya to check walking delivery');
  const lines = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 50).filter((item) => isId(item.listingId));
  const qty = new Map(lines.map((line) => [String(line.listingId), Math.min(100, Math.max(1, Math.floor(Number(line.qty)) || 1))]));
  const ls = await Listing.find({ _id: { $in: [...qty.keys()] }, status: 'active' }).select('seller price wholesale').lean();
  const bySeller = new Map();
  for (const item of ls) {
    const seller = String(item.seller);
    const sellerEntry = bySeller.get(seller) || { units: 0, subtotal: 0 };
    const qtyEntry = qty.get(String(item._id));
    sellerEntry.units += qtyEntry;
    sellerEntry.subtotal += require('../market/wholesale').unitPrice(item, qtyEntry) * qtyEntry;
    bySeller.set(seller, sellerEntry);
  }
  const shops = await Customer.find({ _id: { $in: [...bySeller.keys()] } }).select('shopLocation').lean();
  const out = {};
  for (const shop of shops) {
    const sellerEntry = bySeller.get(String(shop._id));
    out[shop._id] = walkQuote(shop.shopLocation, at, sellerEntry.units, sellerEntry.subtotal);
  }
  res.json({ sellers: out });
});

// POST /api/orders/extras-quote { items: [{ listingId, qty }], lat, lng }
//   → { sellers: { <sellerId>: { rider: { ok, km, fee, reason }, inspection: { ok, fee, reason } } }, settings }
// 🔍 POST /api/orders/rider-scan { items, lat, lng }  (the buyer chose "Kapu rider": find riders near each seller)
// → { sellers: { <sellerId>: { ok, shop, fare, available, nearest, eta: { toShop, atShop, trip, total, arriveAt }, pick } } }
// pick: a signed, short-lived token for the nearest rider, sent back with the checkout to book them. It's tied to this
// buyer and this seller, so it can't be used to book any other rider or by anyone else. Riders' locations are never sent.
const RIDER_PICK_MIN = 20;
exports.riderScan = asyncHandler(async (req, res) => {
  const at = buyerPoint(req.body);
  if (!at) throw httpError('Share your location so we can find riders and price the trip');
  const lines = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 50).filter((item) => isId(item.listingId));
  const ls = await Listing.find({ _id: { $in: lines.map((line) => line.listingId) } }).select('seller').lean();
  const sellerIds = [...new Set(ls.map((item) => String(item.seller)))].slice(0, 10);
  if (!sellerIds.length) throw httpError('Your cart is empty');
  const shops = await Customer.find({ _id: { $in: sellerIds } }).select('name shopLocation').lean();
  const jwt = require('jsonwebtoken');
  const out = {};
  for (const shop of shops) {
    const point = shop.shopLocation?.point;
    const quote = await require('../market/fieldwork').riderQuoteByRoad(point, at);
    if (!quote.ok) { out[shop._id] = { ok: false, reason: quote.reason }; continue; }
    const found = await require('../market/riders').scan(point, at, quote.minutes);
    out[shop._id] = {
      ok: true, shop: { name: shop.shopLocation?.name || shop.name, area: shop.shopLocation?.area || '' },
      fee: quote.fee, fare: quote.fare, km: quote.km, minutes: quote.minutes, byRoad: !!quote.byRoad,
      available: found.available, nearest: found.nearest,
      eta: found.eta ? { ...found.eta, arriveAt: new Date(Date.now() + found.eta.total * 60000) } : null,
      ...(found.best ? { pick: jwt.sign({ typ: 'rider-pick', r: String(found.best._id), s: String(shop._id), b: String(req.customer._id) }, process.env.JWT_SECRET, { expiresIn: `${RIDER_PICK_MIN}m`, algorithm: 'HS256' }) } : {}),
    };
  }
  res.json({ sellers: out, scannedAt: new Date() });
});

// the riders the buyer booked from the scan: { <sellerId>: token } → Map(sellerId → { worker, name, vehicle }).
// A token that's expired, forged, for another buyer or seller, or for a rider who stopped working is simply ignored:
// the order then goes to the nearest riders as usual.
async function riderPicksOf(picks, buyerId) {
  const out = new Map();
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) return out;
  const jwt = require('jsonwebtoken');
  const wanted = new Map();
  for (const [sellerId, token] of Object.entries(picks).slice(0, 10)) {
    if (!isId(sellerId) || typeof token !== 'string' || token.length > 600) continue;
    try {
      const data = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (data.typ === 'rider-pick' && data.s === sellerId && data.b === String(buyerId) && isId(data.r)) wanted.set(sellerId, data.r);
    } catch { /* expired or not ours */ }
  }
  if (!wanted.size) return out;
  const people = await Customer.find({ _id: { $in: [...new Set(wanted.values())] }, 'worker.role': 'rider', 'worker.status': 'approved', 'worker.available': true, active: { $ne: false } }).select('name worker.vehicle').lean();
  const byId = new Map(people.map((person) => [String(person._id), person]));
  for (const [sellerId, riderId] of wanted) {
    const person = byId.get(riderId);
    if (person) out.set(sellerId, { worker: person._id, name: person.name, vehicle: person.worker?.vehicle || '', at: new Date() });
  }
  return out;
}
exports.riderPicksOf = riderPicksOf;

exports.extrasQuote = asyncHandler(async (req, res) => {
  const { riderQuote, inspectionQuote } = require('../market/fieldwork');
  const at = buyerPoint(req.body);
  const lines = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 50).filter((item) => isId(item.listingId));
  const qty = new Map(lines.map((line) => [String(line.listingId), Math.min(100, Math.max(1, Math.floor(Number(line.qty)) || 1))]));
  const ls = await Listing.find({ _id: { $in: [...qty.keys()] } }).select('seller price wholesale weightKg condition').lean();
  const usedBySeller = new Map(); // seller → has a second-hand item
  for (const item of ls) if (isSecondHand(item.condition)) usedBySeller.set(String(item.seller), true);
  const sub = new Map();
  const kg = new Map(); // seller → parcel weight (null when an item has no weight)
  for (const item of ls) {
    sub.set(String(item.seller), (sub.get(String(item.seller)) || 0) + require('../market/wholesale').unitPrice(item, qty.get(String(item._id))) * qty.get(String(item._id)));
    const seller = String(item.seller);
    const prev = kg.has(seller) ? kg.get(seller) : 0;
    kg.set(seller, prev == null || !(item.weightKg > 0) ? null : Math.round((prev + item.weightKg * qty.get(String(item._id))) * 100) / 100);
  }
  const shops = await Customer.find({ _id: { $in: [...sub.keys()] } }).select('name shopLocation payDetails').lean();
  const out = {};
  for (const shop of shops) {
    const point = shop.shopLocation?.point;
    const strip = (query) => (query.ok ? { ok: true, km: query.km, fee: query.fee, ...(query.byRoad ? { minutes: query.minutes, byRoad: true } : {}) } : { ok: false, reason: query.reason });
    const aq = at ? require('../market/fieldwork').agentQuote(point, at, kg.get(String(shop._id))) : null;
    const cq = at ? require('../market/courier').courierQuote(point, at, kg.get(String(shop._id))) : null;
    const verified = usedBySeller.get(String(shop._id)) ? await safeDealQuote(point, at, sub.get(String(shop._id)) || 0) : { ok: false, reason: 'Safe deal is for second-hand items' };
    if (verified.partner) verified.partner = { ...verified.partner, phone: undefined, owner: undefined, _id: undefined }; // the seller gets the shop's phone once they confirm
    out[shop._id] = { verified, courier: cq ? (cq.ok ? { ok: true, km: cq.km, kg: cq.kg, assumedKg: cq.assumedKg, handling: cq.handling, options: cq.options } : { ok: false, km: cq.km, reason: cq.reason }) : null, weightKg: kg.get(String(shop._id)), agent: aq ? (aq.ok ? { ok: true, km: aq.km, fee: aq.fee, free: aq.free, why: aq.why } : { ok: false, reason: aq.reason }) : null, rider: at ? strip(await require('../market/fieldwork').riderQuoteByRoad(point, at)) : null, inspection: strip(inspectionQuote(sub.get(String(shop._id)) || 0, point)), pay: require('../market/pay').payText(shop.payDetails), payTo: { ...(require('../market/pay').publicPay(shop.payDetails) || {}), seller: shop.shopLocation?.name || shop.name || '' } };
  }
  // the shopping agent who'd inspect each seller's goods (their market's agent), shown at the checkout
  const agents = await require('./workController').marketAgentsFor(shops);
  // with their phone: only here (the signed-in buyer's own checkout), never on public pages
  for (const [sellerId, agent] of agents) if (out[sellerId]) out[sellerId].inspectionAgent = { ...require('./workController').publicAgent(agent), phone: agent.phone || '' };
  // the agent the buyer booked on a market's page (their contacts, for the card at the checkout)
  const booked = req.body.agentId ? await require('./workController').chosenAgent(req.body.agentId).catch(() => null) : null;
  const fieldwork = site().fieldwork;
  res.json({ ...(booked ? { bookedAgent: { _id: booked.worker, name: booked.name, marketName: booked.marketName, phone: booked.phone } } : {}), sellers: out, inspectPercent: fieldwork.inspectPercent, freeKm: fieldwork.inspectFreeKm, freeKg: fieldwork.inspectFreeKg, baseFee: fieldwork.inspectBaseFee, baseKm: fieldwork.inspectBaseKm, demoPayments: site().demoPayments, mpesaReady: site().mpesaReady });
});

// Safe deal: the nearest partner shop to the seller, its verification fee and our rider's fee from there to the buyer
async function safeDealQuote(sellerPoint, buyerAt, subtotal) {
  const partners = require('../market/partners');
  if (!sellerPoint?.coordinates) return { ok: false, reason: 'This seller hasn’t put their shop on the map, so we can’t find a partner shop near them' };
  const partner = await partners.nearestPartner(sellerPoint);
  if (!partner) return { ok: false, reason: `No Kapu partner shop within ${partners.REACH_KM} km of this seller yet` };
  const fee = partners.verifyFee(subtotal);
  const partnerPoint = { type: 'Point', coordinates: [partner.lng, partner.lat] };
  const rider = buyerAt ? await require('../market/fieldwork').riderQuoteByRoad(partnerPoint, buyerAt) : null;
  if (rider && !rider.ok) return { ok: false, reason: rider.reason.replace('the shop', 'our partner shop') };
  return { ok: true, fee, pay: require('../market/payouts').split(fee).net, partner, riderFee: rider?.fee ?? null, riderPay: rider?.pay ?? null, km: rider?.km ?? null };
}
exports.safeDealQuote = safeDealQuote;

// ---------------------------------------------------------------- my deliveries (buyer dashboard)
// GET /api/orders/deliveries → everything our riders / on-foot agents (and the shops' walking deliveries, couriers)
// bring me: where each one is now (packed → dispatched → on the way → arrived → delivered), how many items, and history
exports.deliveries = asyncHandler(async (req, res) => {
  const transit = require('../market/transit');
  const Errand = require('../models/Errand');
  const [orderList, errandList] = await Promise.all([
    Order.find({ buyer: req.customer._id, 'delivery.method': { $in: transit.DELIVERED_BY_US }, status: { $ne: 'awaiting_payment' } }).sort({ createdAt: -1 }).limit(200).lean(),
    Errand.find({ customer: req.customer._id, status: { $ne: 'awaiting_payment' } }).sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  const METHOD = { rider: '🏍️ Our rider', walk: '🚶 Walking delivery (the shop)', courier: '🚌 Courier', verified: '🛡️ Safe deal + our rider' };
  const fromOrder = (order) => {
    const qty = order.items.reduce((sum, item) => sum + item.qty, 0);
    const onFoot = order.delivery.method === 'walk' || order.rider?.vehicle === 'On foot';
    return {
      kind: 'order', _id: order._id, no: order.orderNo, link: `/orders/${order._id}`, at: order.createdAt,
      title: order.items.map((item) => `${item.qty} × ${item.title}`).join(', '), qty, lines: order.items.length,
      from: order.verification?.partnerName ? `${order.sellerName} → ${order.verification.partnerName}` : order.sellerName, to: order.delivery.address || order.delivery.county || '',
      method: order.rider?.vehicle === 'On foot' ? '🚶 Our on-foot delivery agent' : METHOD[order.delivery.method], onFoot,
      person: order.rider?.name ? { name: order.rider.name, phone: ['assigned', 'picked_up', 'delivered'].includes(order.rider.status) ? order.rider.phone || '' : '', vehicle: order.rider.vehicle || '', plate: order.rider.plate || '', stars: order.rider.stars?.count ? order.rider.stars : null } : null,
      ...(['assigned', 'picked_up'].includes(order.rider?.status) ? { live: order.rider.live?.lat != null ? order.rider.live : null, eta: order.rider.eta?.minutes != null ? { minutes: order.rider.eta.minutes, at: order.rider.eta.at } : null, kmLeft: order.rider.eta?.kmLeft ?? null, kmToYou: order.rider.eta?.kmToYou ?? null, stage: order.rider.eta?.stage || '' } : {}),
      dest: order.delivery.lat != null ? { lat: order.delivery.lat, lng: order.delivery.lng } : null, taskId: order.rider?.task || null, rated: order.rider?.rated || 0, matching: order.rider?.status === 'open' ? order.rider.matching || '' : '',
      fee: order.deliveryFee || 0, status: order.status, transit: transit.forOrder(order),
      deliveredAt: order.status === 'delivered' ? (order.history || []).find((entry) => entry.status === 'delivered')?.at || order.updatedAt : null,
    };
  };
  const fromErrand = (errand) => {
    const qty = errand.kind === 'shopping' ? (errand.shopping?.list || []).length : 1;
    return {
      kind: 'errand', _id: errand._id, no: errand.no, link: `/errands/${errand._id}`, at: errand.createdAt,
      title: errand.kind === 'shopping' ? `Shopping: ${(errand.shopping?.list || []).map((item) => item.name).slice(0, 4).join(', ')}` : `Parcel: ${errand.parcel?.what || 'a parcel'}`, qty, lines: qty,
      from: errand.pickup?.address || errand.shopping?.shopName || '', to: errand.dropoff?.address || '',
      method: errand.kind === 'shopping' ? '🛒 Shop for me' : errand.worker?.vehicle === 'On foot' ? '🚶 Parcel, on foot' : '🛵 Parcel', onFoot: errand.worker?.vehicle === 'On foot',
      person: errand.worker?.name ? { name: errand.worker.name, phone: ['assigned', 'picked_up', 'delivered'].includes(errand.status) ? errand.worker.phone || '' : '', vehicle: errand.worker.vehicle || '', plate: errand.worker.plate || '', stars: errand.worker.stars?.count ? errand.worker.stars : null } : null,
      ...(['assigned', 'picked_up'].includes(errand.status) ? { live: errand.worker?.live?.lat != null ? errand.worker.live : null, eta: errand.worker?.eta?.minutes != null ? { minutes: errand.worker.eta.minutes, at: errand.worker.eta.at } : null, kmLeft: errand.worker?.eta?.kmLeft ?? null, kmToYou: errand.worker?.eta?.kmToYou ?? null, stage: errand.worker?.eta?.stage || '' } : {}),
      dest: errand.dropoff?.lat != null ? { lat: errand.dropoff.lat, lng: errand.dropoff.lng } : null, taskId: errand.task || null, rated: errand.rated || 0,
      fee: errand.fee?.delivery || 0, status: errand.status, transit: transit.forErrand(errand),
      deliveredAt: ['done', 'delivered'].includes(errand.status) ? (errand.history || []).find((entry) => ['delivered', 'done'].includes(entry.status))?.at || errand.updatedAt : null,
    };
  };
  const all = [...orderList.map(fromOrder), ...errandList.map(fromErrand)].filter((item) => item.transit).sort((first, second) => new Date(second.at) - new Date(first.at));
  const finished = (item) => item.transit.current === 'delivered' || item.transit.current === 'cancelled' || ['delivered', 'done', 'cancelled'].includes(item.status);
  const active = all.filter((item) => !finished(item));
  const history = all.filter(finished);
  const delivered = history.filter((item) => item.transit.current === 'delivered' || ['delivered', 'done'].includes(item.status));
  res.json({
    summary: {
      active: active.length, itemsOnTheWay: active.reduce((sum, item) => sum + item.qty, 0),
      delivered: delivered.length, itemsDelivered: delivered.reduce((sum, item) => sum + item.qty, 0),
      byUs: delivered.filter((item) => item.method && !/the shop/.test(item.method)).length, onFoot: delivered.filter((item) => item.onFoot).length,
      fees: delivered.reduce((sum, item) => sum + (item.fee || 0), 0), since: all.length ? all[all.length - 1].at : null,
    },
    active, history,
  });
});

// ---------------------------------------------------------------- checkout
// POST /api/orders/checkout { items: [{ listingId, qty }], delivery: { method, county, address, notes }, payment: { method, phone } }
exports.checkout = asyncHandler(async (req, res) => {
  const me = req.customer;
  const lines = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  if (!lines.length) throw httpError('Your cart is empty');
  const method = ['pickup', 'walk', 'rider', 'courier', 'verified'].includes(req.body.delivery?.method) ? req.body.delivery.method : 'delivery';
  // “Inspect my goods” (KSh 200) or “Don't inspect” (no fee): strictly checked, the fee is never taken from the request
  const { readChoice, inspectionFee } = require('../market/inspectionChoice');
  const { inspect, choice: inspectionChoice } = readChoice(req.body.inspection);
  const inspectNotes = clean(req.body.inspection?.notes, 300);
  let riderPicks = null; // the riders booked from the scan, read when a seller's order uses our rider
  // the shopping agent the buyer booked on a market's page: does the inspection (if one is asked for)
  const chosenAgent = inspect && method !== 'rider' ? await require('./workController').chosenAgent(req.body.agentId) : null;
  const county = clean(req.body.delivery?.county, 40);
  // where the buyer is: their map pin (Google Maps search, GPS or a dragged pin); needed for walk, rider and courier
  const buyerAt = method !== 'pickup' ? buyerPoint(req.body.delivery) : null;
  const pinInfo = buyerAt ? {
    pin: ['gps', 'search', 'pin', 'typed'].includes(req.body.delivery?.pin) ? req.body.delivery.pin : undefined,
    placeId: clean(req.body.delivery?.placeId, 200) || undefined,
    accuracy: Number(req.body.delivery?.accuracy) > 0 ? Math.min(100000, Math.round(Number(req.body.delivery.accuracy))) : undefined,
  } : {};
  const courierPick = clean(req.body.delivery?.courier, 40);
  if (method === 'courier') {
    if (!buyerAt) throw httpError('Pin your delivery address on the map so we can send it by courier');
    if (!COUNTIES.includes(county)) throw httpError('Choose your county: you’ll collect the parcel at the courier’s office there');
    if (clean(req.body.delivery?.address, 200).length < 3) throw httpError('Enter your town or address, so the courier knows where to send it');
    if (!courierPick) throw httpError('Choose a courier company');
  }
  if (method === 'verified' && !buyerAt) throw httpError('Share your location so our rider can bring the verified item to you');
  if (method === 'verified' && clean(req.body.delivery?.address, 200).length < 5) throw httpError('Tell the rider exactly where to bring it (building, gate, house number or a landmark)');
  if (method === 'rider' && !buyerAt) throw httpError('Share your location so our rider can find you');
  if (method === 'rider' && clean(req.body.delivery?.address, 200).length < 5) throw httpError('Tell the rider exactly where to bring it (building, gate, house number or a landmark)');
  if (method === 'walk' && !buyerAt) throw httpError('Share your location so the shop can walk your order to you');
  if (method === 'walk' && clean(req.body.delivery?.address, 200).length < 5) throw httpError('Tell the shop exactly where to bring it (building, gate, house number or a landmark)');
  const address = clean(req.body.delivery?.address, 200);
  const notes = clean(req.body.delivery?.notes, 300);
  if (method === 'delivery') {
    if (!COUNTIES.includes(county)) throw httpError('Please choose your county');
    if (address.length < 5) throw httpError('Please enter your delivery address (estate, street, building)');
  }
  const payMethod = req.body.payment?.method === 'mpesa' ? 'mpesa' : 'cod';
  if (method === 'verified' && payMethod !== 'mpesa') throw httpError('Safe deal is paid with M-Pesa: we hold your money until our partner shop has verified the item.');
  if (method === 'verified' && inspect) throw httpError('Safe deal already includes a full check at our partner shop. Choose “Don’t inspect”.');
  if (inspect && req.body.payment?.method === 'cod') throw httpError('An inspection (KSh 200) is paid upfront with M-Pesa, so our agent or rider can be paid. Choose M-Pesa, or choose “Don’t inspect”.');
  if (method === 'courier' && payMethod !== 'mpesa') throw httpError('Courier orders are paid upfront with M-Pesa: our agent pays the courier for you.');
  // a paid inspection (shopping agent / courier) is paid upfront; our rider's free check isn't
  if (inspect && method !== 'rider' && payMethod !== 'mpesa') throw httpError('Inspection is paid with M-Pesa (held safely until delivery). Choose “Pay now with M-Pesa”.');
  let phone;
  try {
    phone = formatPhone(req.body.payment?.phone || me.phone || '');
  } catch {
    throw httpError('Please enter a valid Safaricom number (e.g. 0712 345 678) so the seller can reach you');
  }

  // load and check every item
  const qtyById = new Map();
  const offerById = new Map(); // listingId -> accepted offer id
  for (const line of lines) {
    if (line.offerId) offerById.set(String(line.listingId), String(line.offerId));
    if (!isId(line.listingId)) throw httpError('An item in your cart is not valid');
    const amount = Math.floor(Number(line.qty));
    if (!(amount >= 1 && amount <= 100)) throw httpError('Please choose a quantity between 1 and 100');
    qtyById.set(String(line.listingId), (qtyById.get(String(line.listingId)) || 0) + amount);
  }
  const listings = await Listing.find({ _id: { $in: [...qtyById.keys()] } }).lean();
  if (listings.length !== qtyById.size) throw httpError('Some items in your cart are no longer available. Please refresh your cart.', 409);
  // agreed prices from the chat (an accepted offer, or a price the seller set for this buyer)
  const { usableOffers, markUsed } = require('./offerController');
  const dealById = await usableOffers(offerById, me._id); // one query for every agreed price in the cart
  // ads not sold online use the delivery the seller agreed in the chat
  const deliveryOf = (listing) => {
    if (listing.buyNow) return listing.delivery || {};
    const delivery = dealById.get(String(listing._id))?.delivery || {};
    return { available: !!delivery.available, fee: delivery.available ? delivery.fee || 0 : 0, pickup: delivery.pickup !== false };
  };
  for (const listing of listings) {
    const deal = dealById.get(String(listing._id));
    if (!listing.buyNow && !(deal && exports.canBuyNow(listing.category, listing.sub))) throw httpError(offerById.has(String(listing._id)) ? `Your agreed price for “${listing.title}” has expired. Ask the seller to set it again in the chat.` : `“${listing.title}” isn’t sold online. Chat with or call the seller instead.`, 409);
    if (listing.status !== 'active') throw httpError(`“${listing.title}” is no longer available`, 409);
    if (listing.attrs?.rx === 'Prescription needed') throw httpError(`“${listing.title}” needs a prescription: buy it at the chemist with your prescription`, 409);
    if (String(listing.seller) === String(me._id)) throw httpError(`“${listing.title}” is your own ad`);
    if (deal && qtyById.get(String(listing._id)) > (deal.qty || 1)) throw httpError(`Your agreed price for “${listing.title}” is for ${deal.qty || 1}. Change the quantity in your cart.`);
    if (listing.buyNow && listing.stock < qtyById.get(String(listing._id))) throw httpError(listing.stock > 0 ? `Only ${listing.stock} left of “${listing.title}”` : `“${listing.title}” is sold out`, 409);
    const moq = require('../market/wholesale').minOrder(listing);
    if (qtyById.get(String(listing._id)) < moq) throw httpError(`“${listing.title}” is sold wholesale: the minimum order is ${moq}${listing.wholesale?.unit ? ` ${listing.wholesale.unit}s` : ''}`);
    if (method === 'delivery' && !deliveryOf(listing).available) throw httpError(`The seller of “${listing.title}” doesn't deliver. Choose pickup, or remove it from your cart.`);
    if (method === 'pickup' && deliveryOf(listing).pickup === false) throw httpError(`“${listing.title}” can't be picked up. Choose delivery, or remove it from your cart.`);
  }

  // agreed prices from accepted offers ("Make an offer")
  const priceById = new Map();
  const usedOffers = [];
  for (const listing of listings) {
    const offer = dealById.get(String(listing._id)) || null;
    if (offerById.has(String(listing._id)) && !offer) throw httpError(`Your agreed price for “${listing.title}” has expired. Make a new offer or buy at the normal price.`, 409);
    if (offer) {
      priceById.set(String(listing._id), offer.amount);
      usedOffers.push(offer._id);
    }
  }

  // one order per seller
  const bySeller = new Map();
  for (const listing of listings) {
    const seller = String(listing.seller);
    if (!bySeller.has(seller)) bySeller.set(seller, []);
    bySeller.get(seller).push(listing);
  }
  // walking delivery, our riders and inspection all start from the seller's shop pin
  const shops = new Map();
  if (method === 'walk' || method === 'rider' || method === 'courier' || method === 'verified' || inspect || payMethod === 'mpesa') { // M-Pesa: a one-seller checkout is paid direct only with a shop on the map
    for (const customer of await Customer.find({ _id: { $in: [...bySeller.keys()] } }).select('shopLocation').lean()) shops.set(String(customer._id), customer.shopLocation);
  }
  const { riderQuote, inspectionQuote, agentQuote } = require('../market/fieldwork');
  const { payText } = require('../market/pay');
  // an inspection by an agent: the one the buyer booked, or else each seller's market agent (linked automatically)
  const autoAgents = inspect && method !== 'rider' && !chosenAgent
    ? await require('./workController').marketAgentsFor([...shops].map(([_id, shopLocation]) => ({ _id, shopLocation })))
    : new Map();
  const payBy = new Map((await Customer.find({ _id: { $in: [...bySeller.keys()] } }).select('payDetails').lean()).map((customer) => [String(customer._id), customer.payDetails]));
  const checkoutId = crypto.randomBytes(8).toString('hex');
  const commissionPercent = payMethod === 'mpesa' ? site().commissionPercent : 0;
  const drafts = [];
  for (const [sellerId, ls] of bySeller) {
    const items = ls.map((listing) => {
      const qty = qtyById.get(String(listing._id));
      const price = priceById.get(String(listing._id)) ?? require('../market/wholesale').unitPrice(listing, qty); // agreed price, else the bulk tier for this quantity
      return { listing: listing._id, ...(listing.store ? { store: listing.store } : {}), ...(listing.product ? { product: listing.product } : {}), title: listing.title, slug: listing.slug, image: listing.images?.[0] || '', category: listing.category, sub: listing.sub, condition: listing.condition || '', attrs: listing.attrs || {}, price, qty, subtotal: price * qty, ...(listing.buyNow ? {} : { offStock: true }) };
    });
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    let deliveryFee = method === 'delivery' ? Math.max(0, ...ls.map((item) => deliveryOf(item).fee || 0)) : 0; // one delivery per seller
    let walk = null;
    if (method === 'walk') {
      walk = walkQuote(shops.get(sellerId), buyerAt, items.reduce((sum, item) => sum + item.qty, 0), subtotal);
      if (!walk.ok) throw httpError(`${ls[0].sellerName}: ${walk.reason}. Choose delivery or pickup instead.`);
      deliveryFee = walk.fee;
    }
    // how heavy the parcel is (known only when every item has a weight)
    const weightKg = ls.every((item) => item.weightKg > 0) ? Math.round(ls.reduce((sum, item) => sum + item.weightKg * qtyById.get(String(item._id)), 0) * 100) / 100 : null;
    let rider = null;
    if (method === 'rider' && !riderPicks) riderPicks = await riderPicksOf(req.body.riderPicks, req.customer._id);
    if (method === 'rider') {
      // our rider delivers; asked to check the items, they do it at the shop for free (the buyer may tip them after)
      const quote = await require('../market/fieldwork').riderQuoteByRoad(shops.get(sellerId)?.point, buyerAt); // the real road (same cached answer as the quote)
      if (!quote.ok) throw httpError(`${ls[0].sellerName}: ${quote.reason}. Choose another way to get it.`);
      deliveryFee = quote.fee;
      rider = { fee: quote.fee, pay: quote.pay, status: 'waiting', km: quote.km, ...(inspect ? { combined: true } : {}), ...(riderPicks.get(sellerId) ? { preferred: riderPicks.get(sellerId) } : {}) };
    } else if (method === 'courier') {
      // far away: our agent takes it to the courier's office, pays the fare and sends it (they're refunded the fare weekly)
      const quote = require('../market/courier').courierQuote(shops.get(sellerId)?.point, buyerAt, weightKg);
      if (!quote.ok) throw httpError(`${ls[0].sellerName}: ${quote.reason}. Choose another way to get it.`);
      const option = quote.options.find((currentOption) => currentOption.id === courierPick);
      if (!option) throw httpError('That courier company isn’t available. Choose another one.');
      deliveryFee = option.fare + quote.handling;
      rider = { fee: deliveryFee, pay: option.fare + quote.agentPay, status: 'waiting', km: quote.km, combined: inspect || undefined, courier: { company: option.id, name: option.name, fare: option.fare, handling: quote.handling, eta: option.eta } };
    }
    let verification = null;
    if (method === 'verified') {
      if (!items.some((item) => isSecondHand(item.condition))) throw httpError(`${ls[0].sellerName}: Safe deal is for second-hand items. Choose another way to get it.`);
      const quote = await safeDealQuote(shops.get(sellerId)?.point, buyerAt, subtotal);
      if (!quote.ok) throw httpError(`${ls[0].sellerName}: ${quote.reason}. Choose another way to get it.`);
      const partner = quote.partner;
      deliveryFee = quote.riderFee;
      rider = { fee: quote.riderFee, pay: quote.riderPay, status: 'waiting', km: quote.km };
      verification = {
        partner: partner._id, partnerName: partner.name, partnerPhone: partner.phone, address: partner.address, area: partner.area, hours: partner.hours, lat: partner.lat, lng: partner.lng,
        fee: quote.fee, pay: quote.pay, status: 'waiting',
      };
    }
    let inspection = null;
    if (inspect && method === 'rider') {
      // our rider checks it at the shop while collecting: the same KSh 200 (their share is added to the delivery job)
      const fee = inspectionFee(inspectionChoice);
      inspection = { fee, pay: require('../market/payouts').split(fee).net, notes: inspectNotes, status: 'waiting', by: 'rider' };
    } else if (inspect) {
      // a shopping agent goes to the shop (pickup / the seller's delivery), or checks it before a far courier delivery
      const quote = inspectionQuote(subtotal, shops.get(sellerId)?.point);
      if (!quote.ok) throw httpError(`${ls[0].sellerName}: ${quote.reason}. Choose “Don’t inspect” to continue.`);
      quote.fee = inspectionFee(inspectionChoice); // the fixed KSh 200, decided here only
      quote.pay = require('../market/payouts').split(quote.fee).net;
      const agent = chosenAgent || autoAgents.get(sellerId);
      inspection = { fee: quote.fee, pay: quote.pay, notes: inspectNotes, status: 'waiting', by: 'agent', ...(agent ? { preferred: { worker: agent.worker, name: agent.name, marketName: agent.marketName || '', phone: agent.phone || '' } } : {}) };
    }
    const total = subtotal + deliveryFee + (inspection?.fee || 0) + (verification?.fee || 0);
    // the marketplace's cut is on what the seller sells (not on our rider's or agent's fee)
    const sellerPart = subtotal + (rider ? 0 : deliveryFee);
    const sp = payBy.get(sellerId);
    drafts.push({
      // inspected orders: items + inspection are paid now; only the delivery fee is paid on delivery
      // the delivery fee is never taken upfront: it's paid when the order arrives (to our rider, or the seller's
      // delivery person). Courier is the exception: our agent pays the bus / matatu fare when sending it.
      ...(deliveryFee > 0 && method !== 'courier' ? { payOnDelivery: deliveryFee } : {}),
      ...(weightKg != null ? { weightKg } : {}),
      ...(sp?.method ? { sellerPay: { ...sp, text: payText(sp) } } : {}),
      ...(rider ? { rider: { fee: rider.fee, pay: rider.pay, status: rider.status, combined: !!rider.combined, ...(rider.courier ? { courier: rider.courier } : {}), ...(rider.preferred ? { preferred: rider.preferred } : {}) } } : {}),
      ...(inspection ? { inspection } : {}),
      inspectionChoice, inspectionChoiceAt: new Date(),
      ...(verification ? { verification } : {}),
      orderNo: newOrderNo(), checkoutId,
      buyer: me._id, buyerName: me.name, buyerPhone: phone, buyerEmail: me.email,
      seller: sellerId, sellerName: ls[0].sellerName,
      items, subtotal, deliveryFee, total,
      delivery: {
        method, county: method === 'delivery' || method === 'courier' ? county : walk || rider ? shops.get(sellerId)?.county || ls[0].county : ls[0].county, address: method === 'pickup' ? '' : address, notes,
        pickupArea: [ls[0].area, ls[0].county].filter(Boolean).join(', '),
        ...(walk ? { km: walk.km, minutes: walk.minutes, lat: buyerAt.lat, lng: buyerAt.lng, free: walk.free } : {}),
        ...(rider ? { km: rider.km } : {}),
        ...(buyerAt && !walk ? { lat: buyerAt.lat, lng: buyerAt.lng } : {}),
        ...(buyerAt ? pinInfo : {}),
      },
      payment: { method: payMethod, status: payMethod === 'cod' ? 'cod' : 'pending', phone },
      status: payMethod === 'cod' ? 'placed' : 'awaiting_payment',
      history: [{ status: payMethod === 'cod' ? 'placed' : 'awaiting_payment', by: 'buyer' }],
      commissionPercent,
      commission: Math.round((sellerPart * commissionPercent) / 100),
    });
  }

  // one seller, paid by M-Pesa: straight to that seller's Till / Paybill / Pochi (market/splitPay.js)
  // several sellers, paid by M-Pesa: one payment to Kapu's wallet for the goods AND the delivery fees
  if (payMethod === 'mpesa' && drafts.length >= 2) for (const draft of drafts) delete draft.payOnDelivery;
  const splitPay = require('../market/splitPay');
  const split = splitPay.splittable(drafts, payMethod, shops);
  if (split) await splitPay.prepare(drafts);

  const allItems = drafts.flatMap((draft) => draft.items);
  await reserve(allItems); // throws (and reserves nothing) if anything sold out meanwhile
  let orders;
  try {
    drafts.forEach(require('../market/inspectionChoice').assertNoFeeWithoutConsent); // never an inspection fee the buyer didn't choose
    orders = await Order.insertMany(drafts);
    // the riders the buyer booked: a heads-up now (the job is theirs first once the seller has packed it)
    for (const order of orders) if (order.rider?.preferred?.worker) require('./workController').riderBooked(order).catch(() => {});
  } catch (err) {
    await release(allItems);
    throw err;
  }
  if (usedOffers.length) await markUsed(usedOffers); // an agreed price is used once
  // the buyer asked for their goods to be verified: that agent is now linked to each seller (agent ↔ seller)
  const linked = orders.filter((order) => order.inspection?.preferred?.worker).map((order) => ({ agent: order.inspection.preferred.worker, seller: order.seller, order: order._id, how: chosenAgent ? 'booked' : 'auto' }));
  if (linked.length) await require('../market/agentSellers').link(linked);
  // one delivery record per store each order ships from (split fulfilment: market/deliveries.js)
  for (const order of orders) await require('../market/deliveries').createFor(order).catch((error) => console.error('Delivery records:', error.message));
  // remember the address for next time
  Customer.updateOne({ _id: me._id }, { $set: { ...(method === 'delivery' ? { address, county } : {}), ...(!me.phone ? { phone } : {}) } }).catch(() => {});

  let paymentInfo = { method: payMethod, status: payMethod === 'cod' ? 'cod' : 'pending' };
  if (split) {
    // the first seller's prompt goes out now; the rest follow one by one (manual ones wait for the buyer's codes)
    await splitPay.next(checkoutId);
    orders = await Order.find({ checkoutId });
    const sum = splitPay.summary(orders);
    paymentInfo = {
      method: 'mpesa', split: true, status: sum.parts.every((part) => part.state === 'paid') ? 'paid' : 'pending', amount: sum.payNow, ...sum, demo: site().demoPayments || undefined,
      message: `You pay ${sum.sellers} sellers directly: one M-Pesa payment each`,
    };
  } else if (payMethod === 'mpesa' && site().demoPayments) {
    const amount = drafts.reduce((total, draft) => total + draft.total - (draft.payOnDelivery || 0), 0);
    const demoId = `demo-${checkoutId}`;
    await Order.updateMany({ checkoutId }, { $set: { 'payment.checkoutRequestId': demoId } });
    await settlePayment(demoId, { ok: true, receipt: `DEMO${crypto.randomBytes(3).toString('hex').toUpperCase()}` });
    paymentInfo = { method: 'mpesa', status: 'paid', amount, demo: true, message: 'Demo payment: marked paid without money (M-Pesa isn’t connected yet)' };
    orders = await Order.find({ checkoutId });
  } else if (payMethod === 'mpesa') {
    const amount = drafts.reduce((total, draft) => total + draft.total - (draft.payOnDelivery || 0), 0);
    try {
      const stkPushResult = await stkPush({ phone, amount, accountReference: `OS${checkoutId.slice(0, 8)}`, description: 'Kapu' });
      await Order.updateMany({ checkoutId }, { $set: { 'payment.checkoutRequestId': stkPushResult.CheckoutRequestID } });
      paymentInfo = { method: 'mpesa', status: 'pending', amount, message: stkPushResult.CustomerMessage || 'Check your phone and enter your M-Pesa PIN' };
    } catch (err) {
      // couldn't start the payment: undo everything so the buyer can try again (or choose cash on delivery)
      await Order.deleteMany({ checkoutId });
      await release(allItems);
      if (usedOffers.length) await require('../models/Offer').updateMany({ _id: { $in: usedOffers } }, { $set: { status: 'accepted' } });
      const msg = err.response?.data?.errorMessage || err.message;
      throw httpError(`M-Pesa payment could not start: ${msg}. You can try again or choose cash on delivery.`, 502);
    }
  } else {
    orders.forEach((order) => {
      notify.orderPlaced(order);
      broadcast(order);
    });
  }
  res.status(201).json({ checkoutId, payment: paymentInfo, orders: orders.map((order) => view(order, me._id)) });
});

// ---------------------------------------------------------------- M-Pesa results
// marks a whole checkout paid (or failed); used by the callback and by the status check.
// Split payments: one seller's order per prompt; a success that arrives after we gave up on the prompt still
// counts (the buyer did pay that seller); the amount must be the full amount asked; the next seller's prompt follows.
async function settlePayment(checkoutRequestId, result, { chain = true } = {}) {
  if (!checkoutRequestId) return 0;
  const feeMatched = await require('../market/splitPay').settleFee(checkoutRequestId, result); // our verification fee (split payments)
  if (feeMatched) return feeMatched;
  const { receipt, amount } = result;
  const pending = await Order.find({ 'payment.checkoutRequestId': checkoutRequestId, $or: [{ 'payment.status': 'pending' }, ...(result.ok ? [{ 'payment.direct': true, 'payment.status': 'failed' }] : [])] });
  const checkouts = new Set();
  const sharedRef = newPayRef(); // one payment to our wallet: one payment ID for all its orders
  const announced = new Set();
  // orders already holding this M-Pesa code (one query for all of them; orders saved below are added as we go)
  const holders = new Set(result.ok && receipt && pending.some((item) => item.payment.direct)
    ? (await Order.find({ $or: [{ 'payment.receipt': receipt }, { 'payment.claimCode': receipt }, { 'payment.sellerCode': receipt }, { 'payment.fee.receipt': receipt }] }).select('_id').lean()).map((order) => String(order._id))
    : []);
  for (const item of pending) {
    let ok = result.ok;
    let reason = result.reason;
    if (item.payment.direct) {
      checkouts.add(item.checkoutId);
      // paid straight to the seller: the full amount, and an M-Pesa code that hasn't paid for anything else
      if (ok && amount != null && amount !== '' && Number(amount) + 0.5 < (item.payment.amount || 0)) {
        ok = false;
        reason = `M-Pesa received KSh ${Number(amount)} instead of KSh ${item.payment.amount}`;
        require('../security/audit').audit(null, 'mpesa.amount_mismatch', { outcome: 'denied', target: `order:${item._id}`, detail: `${item.orderNo} ${amount}/${item.payment.amount}` });
      }
      if (ok && receipt && [...holders].some((id) => id !== String(item._id))) {
        ok = false;
        reason = 'This M-Pesa payment was already used for another order';
        require('../security/audit').audit(null, 'mpesa.receipt_reused', { outcome: 'denied', target: `order:${item._id}`, detail: `${item.orderNo} ${receipt}` });
      }
      if (!ok && item.payment.status === 'failed') continue; // a late answer that doesn't change anything
    }
    if (ok) {
      if (item.status === 'cancelled') {
        // paid after we already gave up on it: keep the money safe for a refund
        item.payment.status = 'refund_due';
        item.payment.receipt = receipt;
        item.payment.paidAt = new Date();
      } else {
        item.payment.status = 'paid';
        item.payment.receipt = receipt;
        item.payment.paidAt = new Date();
        if (!item.payment.direct) item.payment.ref = sharedRef;
        if (require('../market/splitPay').feeDone(item)) {
          if (item.payment.direct) item.payment.ref = item.payment.ref || newPayRef();
          item.status = 'placed';
          item.history.push({ status: 'placed', by: 'mpesa', note: `M-Pesa ${receipt || ''}`.trim() });
        } else item.history.push({ status: item.status, by: 'mpesa', note: `Seller paid, M-Pesa ${receipt || ''}: waiting for the verification fee` });
      }
    } else if (item.payment.status === 'pending') {
      item.payment.status = 'failed';
      item.payment.failReason = reason || 'Payment was not completed';
    }
    if (ok) item.payment.failReason = undefined;
    await item.save();
    if (ok && receipt) holders.add(String(item._id));
    if (ok && item.status === 'placed') {
      notify.paymentReceived(item);
      notify.orderPlaced(item);
      if (item.payment.ref) announced.add(`${item.checkoutId} ${item.payment.ref}`);
    }
    broadcast(item);
  }
  // our team: one email per payment, once every order of it is saved
  for (const key of announced) tellTeam(...key.split(' '));
  if (chain) for (const checkoutId of checkouts) require('../market/splitPay').nextSoon(checkoutId);
  return pending.length;
}
exports.settlePayment = settlePayment;

// a split-payment order whose seller and our fee are both paid: it starts (the seller confirms it next)
async function startPaidOrder(order, by, note) {
  if (order.status !== 'awaiting_payment') return order;
  order.payment.ref = order.payment.ref || newPayRef();
  order.status = 'placed';
  order.history.push({ status: 'placed', by, note: note || `Paid: seller M-Pesa ${order.payment.receipt || ''}, verification fee M-Pesa ${order.payment.fee?.receipt || ''}` });
  await order.save();
  notify.paymentReceived(order);
  notify.orderPlaced(order);
  broadcast(order);
  tellTeam(order.checkoutId, order.payment.ref, [order]);
  return order;
}
exports.startPaidOrder = startPaidOrder;

// a paid order for our team: the live admin feed (already sent by broadcast) and an email to the orders inbox with
// the payment ID, the buyer, every seller and where it goes, so it can be tracked and delivered quickly
async function tellTeam(checkoutId, ref, known) {
  try {
    const orders = known || (await Order.find({ checkoutId, 'payment.ref': ref }).lean());
    const to = site().ordersEmail || site().email;
    if (!orders.length || !to) return;
    require('../utils/mailer').sendMail({ to, ...require('../utils/emailTemplates').teamNewOrder(orders, ref, site().url) });
  } catch (error) {
    console.error('[orders] team email', error.message);
  }
}

// POST /api/mpesa/callback  (Safaricom calls this; always answer 200)
exports.mpesaCallback = asyncHandler(async (req, res) => {
  const cb = req.body?.Body?.stkCallback;
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  if (!cb?.CheckoutRequestID) return;
  const items = cb.CallbackMetadata?.Item || [];
  const get = (number) => items.find((item) => item.Name === number)?.Value;
  await settlePayment(cb.CheckoutRequestID, cb.ResultCode === 0 ? { ok: true, receipt: get('MpesaReceiptNumber') } : { ok: false, reason: cb.ResultDesc });
});

async function myCheckout(req) {
  const id = String(req.params.checkoutId || '');
  if (!/^[a-f0-9]{16}$/.test(id)) throw httpError('Checkout not found', 404);
  const orders = await Order.find({ checkoutId: id, buyer: req.customer._id });
  if (!orders.length) throw httpError('Checkout not found', 404);
  return orders;
}

// GET /api/orders/checkout/:checkoutId  (the buyer's "waiting for M-Pesa" screen polls this)
exports.checkoutStatus = asyncHandler(async (req, res) => {
  let orders = await myCheckout(req);
  const payment = orders[0].payment;
  if (payment.direct) {
    // split payment: check the prompt in flight with Safaricom, send the next one, report every seller's part
    await require('../market/splitPay').next(orders[0].checkoutId);
    orders = await myCheckout(req);
    return res.json(splitStatus(req.params.checkoutId, orders, req.customer._id));
  }
  // the callback can't reach a laptop without a public address: ask Safaricom directly after a few seconds
  if (payment.method === 'mpesa' && payment.status === 'pending' && payment.checkoutRequestId && Date.now() - orders[0].updatedAt > 8000) {
    try {
      const stkQueryResult = await stkQuery(payment.checkoutRequestId);
      if (String(stkQueryResult.ResultCode) === '0') await settlePayment(payment.checkoutRequestId, { ok: true, receipt: stkQueryResult.MpesaReceiptNumber || '' });
      else if (stkQueryResult.ResultCode !== undefined && !/process/i.test(stkQueryResult.ResultDesc || '')) await settlePayment(payment.checkoutRequestId, { ok: false, reason: stkQueryResult.ResultDesc });
    } catch {
      /* still processing, or Safaricom busy: try again on the next poll */
    }
    orders = await myCheckout(req);
  }
  const statuses = orders.map((order) => order.payment.status);
  const status = statuses.every((currentStatus) => currentStatus === 'paid') ? 'paid' : statuses.includes('failed') ? 'failed' : statuses.every((currentStatus) => currentStatus === 'cod') ? 'cod' : 'pending';
  res.json({ checkoutId: req.params.checkoutId, status, failReason: orders.find((order) => order.payment.failReason)?.payment.failReason, orders: orders.map((order) => view(order, req.customer._id)) });
});

// a split checkout: every seller's part, and one overall status
// paid: all paid · done: nothing left to pay (some paid, the rest cancelled / cash) · failed: something needs the buyer · pending
function splitStatus(checkoutId, orders, viewer) {
  const sum = require('../market/splitPay').summary(orders);
  const states = sum.parts.map((part) => part.state);
  const open = states.some((state) => ['queued', 'prompted', 'manual', 'claimed', 'mismatch'].includes(state));
  const status = states.every((state) => state === 'paid') ? 'paid' : states.includes('failed') && !states.some((state) => ['queued', 'prompted'].includes(state)) ? 'failed' : open ? 'pending' : 'done';
  return { checkoutId, split: true, status, ...sum, failReason: sum.parts.find((part) => part.state === 'failed')?.failReason || '', orders: orders.map((order) => view(order, viewer)) };
}

// POST /api/orders/checkout/:checkoutId/pay { phone, orderId? }  (try M-Pesa again after a failure)
exports.retryPayment = asyncHandler(async (req, res) => {
  const orders = (await myCheckout(req)).filter((item) => item.status === 'awaiting_payment');
  if (!orders.length) throw httpError('Nothing left to pay for this checkout');
  const phone = formatPhone(req.body.phone || orders[0].payment.phone);
  if (orders[0].payment.direct) {
    // split: our verification fee again (it comes first), or the sellers' prompts that failed, one after another
    const feeAgain = orders.filter((order) => order.payment.fee?.status === 'failed');
    if (feeAgain.length && (req.body.fee || !req.body.orderId)) {
      await Order.updateMany({ _id: { $in: feeAgain.map((order) => order._id) } }, { $set: { 'payment.fee.status': 'pending', 'payment.phone': phone }, $unset: { 'payment.fee.promptedAt': 1, 'payment.fee.checkoutRequestId': 1, 'payment.fee.failReason': 1 } });
      await require('../market/splitPay').next(orders[0].checkoutId);
      return res.json({ ...splitStatus(req.params.checkoutId, await myCheckout(req), req.customer._id), message: 'Check your phone: the M-Pesa prompt for the verification fee' });
    }
    const again = orders.filter((order) => order.payment.channel === 'stk' && ['failed', 'pending'].includes(order.payment.status) && (!req.body.orderId || String(order._id) === String(req.body.orderId)));
    if (!again.length) throw httpError('There’s no M-Pesa prompt to send again. For sellers paid by Pochi or Send Money, pay from your phone and enter the M-Pesa code.');
    for (const order of orders) {
      if (order.payment.status === 'pending' || order.payment.status === 'failed') order.payment.phone = phone;
      if (again.includes(order)) {
        order.payment.status = 'pending';
        order.payment.failReason = undefined;
        order.payment.promptedAt = undefined;
        order.payment.checkoutRequestId = undefined;
      }
    }
    await Order.bulkSave(orders);
    await require('../market/splitPay').next(orders[0].checkoutId);
    return res.json({ ...splitStatus(req.params.checkoutId, await myCheckout(req), req.customer._id), message: 'Check your phone: the M-Pesa prompts come one at a time' });
  }
  const amount = orders.reduce((total, order) => total + order.total, 0);
  let result;
  try {
    result = await stkPush({ phone, amount, accountReference: `OS${orders[0].checkoutId.slice(0, 8)}`, description: 'Kapu' });
  } catch (err) {
    throw httpError(`M-Pesa payment could not start: ${err.response?.data?.errorMessage || err.message}`, 502);
  }
  for (const order of orders) {
    order.payment.status = 'pending';
    order.payment.phone = phone;
    order.payment.failReason = undefined;
    order.payment.checkoutRequestId = result.CheckoutRequestID;
  }
  await Order.bulkSave(orders);
  res.json({ status: 'pending', message: result.CustomerMessage || 'Check your phone and enter your M-Pesa PIN' });
});

// Split payments paid from the M-Pesa menu (Pochi la Biashara, Send Money, or a Till / Paybill without prompts):
// the buyer sends us the M-Pesa code from their SMS; the seller types the code they received. We compare the two:
// the same code → paid (the order starts once our verification fee is paid too); different → both are asked to
// check, and our team sees it. Neither side ever sees the other's code, so it can't simply be copied.
const sameCode = (order) => order.payment.claimCode && order.payment.sellerCode && order.payment.claimCode === order.payment.sellerCode;
async function compareCodes(order, req, by) {
  const { audit } = require('../security/audit');
  const alerts = require('../market/alerts');
  if (!order.payment.claimCode || !order.payment.sellerCode) {
    await order.save();
    broadcast(order);
    return 'waiting';
  }
  if (sameCode(order)) {
    const code = order.payment.claimCode;
    order.payment.status = 'paid';
    order.payment.receipt = code;
    order.payment.paidAt = new Date();
    order.payment.mismatch = undefined;
    order.payment.failReason = undefined;
    order.history.push({ status: order.status, by, note: `M-Pesa ${code}: the buyer’s and the seller’s codes match` });
    await order.save();
    audit(req, 'order.payment_matched', { target: `order:${order._id}`, detail: `${order.orderNo} ${code} KSh ${order.payment.amount}` });
    if (require('../market/splitPay').feeDone(order)) await startPaidOrder(order, 'system', `M-Pesa ${code} matched (buyer and seller)`);
    else broadcast(order);
    return 'matched';
  }
  order.payment.mismatch = true;
  order.payment.failReason = 'The M-Pesa code you sent doesn’t match the one the seller received. Check the SMS from M-Pesa and send the code again.';
  order.history.push({ status: order.status, by: 'system', note: 'M-Pesa codes don’t match: buyer and seller asked to check' });
  await order.save();
  audit(req, 'order.payment_mismatch', { outcome: 'denied', target: `order:${order._id}`, detail: `${order.orderNo} buyer ${order.payment.claimCode} seller ${order.payment.sellerCode}` });
  alerts.send(order.buyer, { kind: 'order', icon: '⚠️', title: { en: `Check your M-Pesa code for ${order.sellerName}`, sw: `Angalia nambari ya M-Pesa ya ${order.sellerName}` }, body: { en: `It doesn’t match the code ${order.sellerName} received for order ${order.orderNo}.`, sw: `Hailingani na nambari aliyopokea ${order.sellerName} kwa oda ${order.orderNo}.` }, link: `/pay/${order.checkoutId}` }).catch(() => {});
  alerts.send(order.seller, { kind: 'order', icon: '⚠️', title: { en: `M-Pesa codes don’t match: order ${order.orderNo}`, sw: `Nambari za M-Pesa hazilingani: oda ${order.orderNo}` }, body: { en: 'Check the code in your M-Pesa SMS and enter it again.', sw: 'Angalia nambari kwenye SMS ya M-Pesa na uiweke tena.' }, link: `/sales/${order._id}` }).catch(() => {});
  require('../utils/realtime').emitAdmin('order:update', view(order, 'admin'));
  broadcast(order);
  return 'mismatch';
}
const codeUsedElsewhere = (order, code) => Order.exists({ _id: { $ne: order._id }, $or: [{ 'payment.receipt': code }, { 'payment.claimCode': code }, { 'payment.sellerCode': code }, { 'payment.fee.receipt': code }] });
const cleanCode = (value) => String(value || '').toUpperCase().replace(/\s+/g, '');

// POST /api/orders/checkout/:checkoutId/code { orderId, code }  (the buyer: the M-Pesa code of my payment to this seller)
exports.claimPayment = asyncHandler(async (req, res) => {
  const { CODE, feeDone } = require('../market/splitPay');
  const orders = await myCheckout(req);
  const order = orders.find((item) => String(item._id) === String(req.body.orderId));
  if (!order || !order.payment.direct) throw httpError('Order not found in this checkout', 404);
  if (order.status !== 'awaiting_payment' || !['pending', 'failed'].includes(order.payment.status) || (order.payment.claimCode && !order.payment.mismatch)) throw httpError('This seller’s part doesn’t need a payment code');
  if (!feeDone(order)) throw httpError(`Pay the KSh ${order.payment.fee.amount} verification fee first (the M-Pesa prompt from ${site().name || 'Kapu'})`, 409);
  if (order.payment.channel === 'stk' && order.payment.status === 'pending' && order.payment.promptedAt) throw httpError('An M-Pesa prompt for this seller is on your phone. Enter your PIN there, or wait for it to time out.');
  const code = cleanCode(req.body.code);
  if (!CODE.test(code)) throw httpError('Enter the 10-character M-Pesa code from your confirmation SMS (e.g. SFG3K7QX2P)');
  if (await codeUsedElsewhere(order, code)) {
    require('../security/audit').audit(req, 'mpesa.code_reused', { outcome: 'denied', target: `order:${order._id}`, detail: code });
    throw httpError('This M-Pesa code was already given for another order. Each seller needs their own payment.', 409);
  }
  order.payment.channel = 'manual'; // paid from the M-Pesa menu (also when a prompt failed)
  order.payment.status = 'pending';
  order.payment.failReason = undefined;
  order.payment.claimCode = code;
  order.payment.claimedAt = new Date();
  order.history.push({ status: order.status, by: 'buyer', note: 'Paid the seller from the M-Pesa menu and sent us the M-Pesa code' });
  require('../security/audit').audit(req, 'order.payment_claimed', { target: `order:${order._id}`, detail: `${order.orderNo} ${code} KSh ${order.payment.amount}` });
  const outcome = await compareCodes(order, req, 'buyer');
  if (outcome === 'waiting') {
    require('../market/alerts').send(order.seller, { kind: 'order', icon: '💵', title: { en: `Check your M-Pesa: KSh ${order.payment.amount}`, sw: `Angalia M-Pesa: KSh ${order.payment.amount}` }, body: { en: `${order.buyerName} says they paid order ${order.orderNo}. Enter the M-Pesa code you received.`, sw: `${order.buyerName} amelipa oda ${order.orderNo}. Weka nambari ya M-Pesa uliyopokea.` }, link: `/sales/${order._id}` }).catch(() => {});
  }
  res.json({ ...splitStatus(req.params.checkoutId, await myCheckout(req), req.customer._id), outcome });
});

// POST /api/orders/:id/payment { code } | { received: false }  (the seller: the M-Pesa code I received for this order)
exports.confirmPayment = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findOne({ _id: req.params.id, seller: req.customer._id });
  if (!order) throw httpError('Order not found', 404);
  if (!order.payment.direct || order.payment.channel !== 'manual' || !['pending', 'failed'].includes(order.payment.status) || order.status !== 'awaiting_payment') throw httpError('There’s no payment to confirm on this order');
  if (req.body.received === false) {
    if (!order.payment.claimCode) throw httpError('The buyer hasn’t said they paid yet');
    const code = order.payment.claimCode;
    order.payment.status = 'failed';
    order.payment.claimCode = undefined;
    order.payment.sellerCode = undefined;
    order.payment.mismatch = undefined;
    order.payment.failReason = `${order.sellerName} says no M-Pesa payment arrived. Check your M-Pesa messages, or pay again.`;
    order.history.push({ status: order.status, by: 'seller', note: 'The seller says no M-Pesa payment arrived' });
    await order.save();
    require('../security/audit').audit(req, 'order.payment_rejected', { target: `order:${order._id}`, detail: `${order.orderNo} ${code}` });
    broadcast(order);
    return res.json({ order: view(order, req.customer._id), outcome: 'rejected' });
  }
  const { CODE } = require('../market/splitPay');
  const code = cleanCode(req.body.code);
  if (!CODE.test(code)) throw httpError('Enter the 10-character M-Pesa code from the SMS you received (e.g. SFG3K7QX2P)');
  if (await codeUsedElsewhere(order, code)) {
    require('../security/audit').audit(req, 'mpesa.code_reused', { outcome: 'denied', target: `order:${order._id}`, detail: `seller ${code}` });
    throw httpError('This M-Pesa code was already used for another order.', 409);
  }
  order.payment.sellerCode = code;
  order.payment.sellerCodeAt = new Date();
  if (order.payment.mismatch) order.payment.mismatch = undefined; // compare again with the new code
  require('../security/audit').audit(req, 'order.payment_seller_code', { target: `order:${order._id}`, detail: `${order.orderNo} ${code}` });
  const outcome = await compareCodes(order, req, 'seller');
  res.json({ order: view(order, req.customer._id), outcome });
});

// GET /api/orders/checkout/:checkoutId/receipt.pdf  (one receipt for a checkout: every seller, what was bought from
// each, what each was paid and the M-Pesa code of each payment, and the total)
exports.checkoutReceipt = asyncHandler(async (req, res) => {
  const orders = await myCheckout(req);
  const sum = require('../market/splitPay').summary(orders);
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const first = orders[0];
  const pdf = require('../market/receipt').buildCheckoutReceipt(
    { checkoutId: first.checkoutId, createdAt: first.createdAt, buyerName: first.buyerName, buyerPhone: first.buyerPhone, delivery: first.delivery, split: !!first.payment.direct, method: first.payment.method, ...sum },
    { site: site(), url: `${proto}://${host}` }
  );
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Kapu-checkout-${first.checkoutId.slice(0, 8)}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
});

// POST /api/orders/checkout/:checkoutId/cod  (switch an unpaid checkout to cash on delivery)
exports.switchToCod = asyncHandler(async (req, res) => {
  // a seller's part already paid, with a code the seller is checking, or with a prompt on the phone right now stays as it is
  const orders = (await myCheckout(req)).filter((item) => item.status === 'awaiting_payment' && item.payment.status !== 'paid' && !item.payment.claimCode && !(item.payment.direct && item.payment.status === 'pending' && item.payment.promptedAt && Date.now() - item.payment.promptedAt < 60000));
  if (!orders.length) throw httpError('Nothing to change for this checkout');
  for (const order of orders) {
    order.payment.method = 'cod';
    order.payment.status = 'cod';
    order.payment.failReason = undefined;
    order.commissionPercent = 0;
    order.commission = 0;
    // split payment: our verification fee not paid yet → it's dropped (an inspection the buyer asked for stays)
    const fee = order.payment.fee;
    if (fee?.amount > 0 && fee.status !== 'paid') {
      // cash on delivery: an inspection is paid upfront (so our agent / rider can be paid), so it's dropped with the fee
      order.total -= fee.amount;
      order.inspection = undefined;
      order.inspectionChoice = 'none'; // not paid upfront: no inspection, no fee
      fee.status = 'none';
    }
    order.status = 'placed';
    order.history.push({ status: 'placed', by: 'buyer', note: 'Pay cash on delivery' });
  }
  await Order.bulkSave(orders);
  for (const order of orders) {
    notify.orderPlaced(order);
    broadcast(order);
  }
  res.json({ status: 'cod', orders: orders.map((order) => view(order, req.customer._id)) });
});

// Unpaid M-Pesa orders are cancelled after 30 minutes and their stock goes back on sale
// (a split part whose M-Pesa code the seller is still checking gets 48 hours)
async function expireUnpaid() {
  const old = await Order.find({
    status: 'awaiting_payment', createdAt: { $lt: new Date(Date.now() - PAY_WINDOW_MIN * 60000) },
    $or: [{ 'payment.claimCode': null }, { 'payment.claimedAt': { $lt: new Date(Date.now() - 48 * 3600000) } }],
  }).limit(100); // in batches: the next run takes the rest
  for (const order of old) {
    order.status = 'cancelled';
    order.cancelledBy = 'system';
    order.cancelReason = order.payment.claimCode ? 'The seller didn’t confirm the M-Pesa payment within 48 hours' : 'Not paid within 30 minutes';
    if (order.payment.status === 'pending') order.payment.status = 'failed';
    if (order.payment.status === 'paid') order.payment.status = 'refund_due'; // a split part paid to the seller, never completed
    order.history.push({ status: 'cancelled', by: 'system', note: order.cancelReason });
  }
  if (!old.length) return;
  await Order.bulkSave(old);
  await release(old.flatMap((order) => order.items)); // their stock goes back on sale (one bulk write)
  old.forEach(broadcast);
}
exports.startExpiryWorker = () => {
  require('../utils/jobs').every('unpaid-orders', 5 * 60 * 1000, expireUnpaid)(); // one server at a time; once now
};

// ---------------------------------------------------------------- reading orders
// GET /api/orders/mine  (as a buyer)
exports.mine = asyncHandler(async (req, res) => {
  const list = await Order.find({ buyer: req.customer._id, 'hiddenBy.buyer': { $ne: true } }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((item) => view(item, req.customer._id)));
});

// GET /api/orders/sales?status=  (as a seller) + summary
exports.sales = asyncHandler(async (req, res) => {
  const me = req.customer._id;
  // unpaid orders stay hidden, except split payments paid from the M-Pesa menu (I type the code I received)
  const toConfirm = { status: 'awaiting_payment', 'payment.direct': true, 'payment.channel': 'manual', 'payment.status': { $in: ['pending', 'failed'] }, 'payment.fee.status': { $in: ['paid', 'none'] } };
  const filter = { seller: me, 'hiddenBy.seller': { $ne: true }, $or: [{ status: { $ne: 'awaiting_payment' } }, toConfirm] };
  if (['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(req.query.status)) {
    delete filter.$or;
    filter.status = req.query.status;
  }
  if (req.query.status === 'payment') {
    delete filter.$or;
    Object.assign(filter, toConfirm);
  }
  const [list, sums] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
    Order.aggregate([
      { $match: { seller: new mongoose.Types.ObjectId(String(me)), status: { $ne: 'awaiting_payment' } } },
      {
        $group: {
          _id: null,
          toHandle: { $sum: { $cond: [{ $in: ['$status', ['placed', 'confirmed']] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$total', 0] } },
          payoutDue: { $sum: { $cond: [{ $eq: ['$payout.status', 'due'] }, '$payout.amount', 0] } },
          paidOut: { $sum: { $cond: [{ $eq: ['$payout.status', 'paid'] }, '$payout.amount', 0] } },
        },
      },
    ]),
  ]);
  res.json({ orders: list.map((item) => view(item, me)), summary: sums[0] || { toHandle: 0, delivered: 0, revenue: 0, payoutDue: 0, paidOut: 0 } });
});

// POST /api/orders/:id/hide { hidden }  remove a delivered or cancelled order from my list (or bring it back)
exports.hide = asyncHandler(async (req, res) => {
  const me = String(req.customer._id);
  const order = await Order.findById(req.params.id).select('buyer seller status').lean();
  const role = order && (String(order.buyer) === me ? 'buyer' : String(order.seller) === me ? 'seller' : null);
  if (!role) return res.status(404).json({ message: 'Order not found' });
  if (!['delivered', 'cancelled'].includes(order.status)) return res.status(400).json({ message: 'Only delivered or cancelled orders can be removed from the list' });
  await Order.updateOne({ _id: order._id }, { $set: { [`hiddenBy.${role}`]: req.body?.hidden !== false } });
  res.json({ ok: true });
});

// GET /api/orders/counts  (badges: new sales to handle, orders on the way)
exports.counts = asyncHandler(async (req, res) => {
  const me = req.customer._id;
  const [toHandle, onTheWay] = await Promise.all([
    Order.countDocuments({ seller: me, status: { $in: ['placed'] } }),
    Order.countDocuments({ buyer: me, status: { $in: ['placed', 'confirmed', 'shipped'] } }),
  ]);
  res.json({ toHandle, onTheWay });
});

async function loadFor(req) {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id);
  const me = String(req.customer._id);
  if (!order || (String(order.buyer) !== me && String(order.seller) !== me)) throw httpError('Order not found', 404);
  return order;
}

// GET /api/orders/:id  (buyer or seller)
exports.get = asyncHandler(async (req, res) => {
  const order = await loadFor(req);
  res.json(view(order, req.customer._id));
});

// GET /api/orders/:id/receipt.pdf  (buyer or seller): a receipt to keep, check the items on delivery, and quote if something goes wrong
exports.receipt = asyncHandler(async (req, res) => {
  const order = await loadFor(req);
  await sendReceipt(req, res, order, String(order.buyer) === String(req.customer._id) ? 'buyer' : 'seller');
});
// GET /api/orders/admin/:id/receipt.pdf  (our team)
exports.adminReceipt = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id);
  if (!order) throw httpError('Order not found', 404);
  await sendReceipt(req, res, order, 'admin');
});
async function sendReceipt(req, res, order, role) {
  const seller = await Customer.findById(order.seller).select('name phone shopLocation').lean();
  // our riders / shopping agents who took a job on this order
  const Task = require('../models/Task');
  const jobs = await Task.find({ order: order._id, worker: { $ne: null }, status: { $ne: 'cancelled' } }).sort({ createdAt: 1 }).select('kind inspect courier.name worker workerName workerPhone status acceptedAt pickedUpAt doneAt riderConfirmedAt result.passed').lean();
  const people = new Map((await Customer.find({ _id: { $in: jobs.map((job) => job.worker) } }).select('name phone worker.role worker.vehicle worker.plate worker.status worker.approvedAt worker.baseArea').lean()).map((item) => [String(item._id), item]));
  // the agent linked to this order's inspection (booked or automatic), until they take the job themselves
  const linkedAgent = order.inspection?.preferred?.worker && !jobs.some((job) => job.kind === 'inspection') ? order.inspection.preferred : null;
  if (linkedAgent && !people.has(String(linkedAgent.worker))) {
    const person = await Customer.findById(linkedAgent.worker).select('name phone worker.role worker.status worker.approvedAt worker.baseArea worker.marketName').lean();
    if (person) people.set(String(person._id), person);
  }
  const team = jobs.map((job) => {
    const person = people.get(String(job.worker)) || {};
    return {
      role: person.worker?.role === 'rider' ? 'Rider' : 'Shopping agent', name: person.name || job.workerName, phone: person.phone || job.workerPhone, vehicle: person.worker?.vehicle || '', plate: person.worker?.plate || '', base: person.worker?.baseArea || '',
      approved: person.worker?.status === 'approved', approvedAt: person.worker?.approvedAt,
      job: job.kind === 'inspection' ? 'Inspection at the shop' : job.courier?.name ? `Collected and sent by ${job.courier.name}` : job.inspect ? 'Inspected at the shop and delivered' : 'Delivery',
      acceptedAt: job.acceptedAt, pickedUpAt: job.pickedUpAt, deliveredAt: job.riderConfirmedAt || job.doneAt, status: job.status, passed: job.result?.passed,
    };
  });
  if (linkedAgent) {
    const person = people.get(String(linkedAgent.worker)) || {};
    team.push({
      role: 'Shopping agent', name: person.name || linkedAgent.name, phone: person.phone || linkedAgent.phone || '', base: person.worker?.marketName || linkedAgent.marketName || person.worker?.baseArea || '',
      approved: person.worker?.status === 'approved', approvedAt: person.worker?.approvedAt, job: 'Inspection at the shop (linked to this order)', status: 'booked',
    });
  }
  // items bought before details were kept on orders: take them from the ads
  const missing = order.items.filter((item) => !item.attrs && item.listing).map((item) => item.listing);
  const ads = missing.length ? new Map((await Listing.find({ _id: { $in: missing } }).select('attrs sub condition').lean()).map((item) => [String(item._id), item])) : new Map();
  const items = order.items.map((item) => {
    const it = item.toObject ? item.toObject() : item;
    const ad = ads.get(String(it.listing));
    return ad ? { ...it, attrs: ad.attrs, sub: ad.sub, condition: ad.condition } : it;
  });
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const pdf = require('../market/receipt').buildReceipt({ ...order.toObject(), items }, { role, seller, team, site: site(), url: `${proto}://${host}` });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Kapu-${order.orderNo}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
}

// ---------------------------------------------------------------- moving an order along
// what each side may do in each state
const NEXT = {
  seller: { placed: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: ['delivered'] },
  buyer: { awaiting_payment: ['cancelled'], placed: ['cancelled'], shipped: ['delivered'] },
};

// what the seller receives for an M-Pesa order: items minus our commission (fees for our team aren't theirs)
const sellerAmount = (order) => order.total - (order.commission || 0) - (order.splitDeliveryFee || 0) - (order.inspection?.fee || 0) - (order.verification?.fee || 0) - (['rider', 'courier'].includes(order.delivery?.method) ? order.rider?.fee || 0 : order.payOnDelivery || 0);

// Pay the seller BEFORE delivery when our own team has the goods in hand: our rider or courier agent collected them
// (after their check, when one was asked for), or our shopping agent passed the inspection of a walking delivery.
// Only for M-Pesa orders (the buyer's money is held by us; with pay on delivery the buyer pays the seller directly).
function releaseEarly(order, why) {
  if (order.payment?.method !== 'mpesa' || order.payment.status !== 'paid' || order.payment.direct) return false; // paid straight to the seller: nothing held by us
  if (order.payout?.status && order.payout.status !== 'not_due') return false;
  if (!['rider', 'courier', 'walk', 'verified'].includes(order.delivery?.method) || order.status === 'cancelled') return false;
  if (order.delivery.method === 'verified' && order.verification?.status !== 'passed') return false; // only once our partner shop passed it
  order.payout = { status: 'due', amount: sellerAmount(order), early: true, releasedAt: new Date(), why };
  order.history.push({ status: order.status, by: 'system', note: `💰 Seller’s payment released before delivery: ${why}` });
  require('../market/alerts').sellerPaidEarly(order).catch(() => {});
  return true;
}
exports.releaseEarly = releaseEarly;

async function applyStatus(status, next, by, { note, reason } = {}) {
  status.status = next;
  if (next === 'shipped') status.shipNote = clean(note, 200);
  if (next === 'cancelled') {
    status.cancelReason = clean(reason, 200) || (by === 'buyer' ? 'Cancelled by the buyer' : 'Cancelled');
    status.cancelledBy = by;
    if (status.payment.status === 'paid') status.payment.status = 'refund_due'; // money comes back to the buyer
    if (status.payout?.status === 'due') status.payout.status = 'not_due'; // released early but not yet sent: stopped
    if (status.payment.status === 'pending') status.payment.status = 'failed';
    await release(status.items);
  }
  if (next === 'delivered') {
    if (status.payment.method === 'cod') status.payment.status = 'paid'; // cash collected by the seller
    // (already released before delivery? it stays as it is)
    if (status.payment.method === 'mpesa' && status.payment.status === 'paid' && !status.payment.direct && (!status.payout?.status || status.payout.status === 'not_due')) status.payout = { status: 'due', amount: sellerAmount(status) };
  }
  status.history.push({ status: next, by, note: clean(next === 'cancelled' ? status.cancelReason : note, 200) || undefined });
  await status.save();
  // riders & shopping agents
  try {
    if (next === 'confirmed') await require('./workController').afterConfirmed(status);
    if (next === 'delivered') await require('./workController').afterDelivered(status, by);
    if (next === 'cancelled') await require('./workController').afterCancelled(status);
  } catch (err) {
    console.error('Field team job:', err.message);
  }
  // the delivery records follow the order
  await require('../market/deliveries').syncOrder(status, next, by).catch((error) => console.error('Delivery records:', error.message));
  if (next === 'shipped') notify.shipped(status);
  if (next === 'delivered') {
    notify.delivered(status);
    require('./trustController').refreshSellerStats(status.seller).catch(() => {});
  }
  if (next === 'cancelled') notify.cancelled(status);
  // the sale is over: ads that sold out with it are deleted now (if cancelled, stock went back first)
  if (next === 'delivered' || next === 'cancelled') {
    const ids = status.items.map((item) => item.listing).filter(Boolean);
    if (ids.length) require('../market/soldCleanup').purgeSold({ _id: { $in: ids } }).catch((error) => console.error('Sold ads cleanup:', error.message));
  }
  broadcast(status);
  return status;
}
exports.applyStatus = applyStatus;

// POST /api/orders/:id/status { status, note, reason }
exports.setStatus = asyncHandler(async (req, res) => {
  const order = await loadFor(req);
  const role = String(order.seller) === String(req.customer._id) ? 'seller' : 'buyer';
  const next = String(req.body.status || '');
  // the items failed inspection: the buyer may cancel (full refund) even after the seller confirmed
  const failedCancel = role === 'buyer' && next === 'cancelled' && order.inspection?.status === 'failed' && ['placed', 'confirmed'].includes(order.status);
  if (!failedCancel && !(NEXT[role][order.status] || []).includes(next)) {
    throw httpError(`This order is “${order.status.replace('_', ' ')}”, so it can't be changed to “${next}” now`, 409);
  }
  if (next === 'cancelled' && role === 'seller' && clean(req.body.reason, 200).length < 3) throw httpError('Please tell the buyer why you are cancelling');
  if (role === 'seller' && next === 'shipped' && order.inspection?.status && order.inspection.status !== 'passed') throw httpError(order.inspection.status === 'failed' ? 'The items failed inspection. Fix them and ask for a second inspection, or cancel the order.' : 'Wait for our agent to inspect the items before you send them', 409);
  if (role === 'seller' && next === 'delivered' && order.payment?.method === 'mpesa') throw httpError('The buyer confirms delivery of M-Pesa orders. If they forget, it completes on its own 3 days after you sent it.', 409);
  if (role === 'seller' && ['shipped', 'delivered'].includes(next) && order.delivery?.method === 'verified') throw httpError('Take the item to our partner shop: once it’s verified, our rider delivers it from there', 409);
  if (role === 'seller' && ['shipped', 'delivered'].includes(next) && ['rider', 'courier'].includes(order.delivery?.method)) throw httpError(order.delivery.method === 'courier' ? 'Our agent collects the order and sends it by courier' : 'Our rider picks up the order and marks it delivered', 409);
  await applyStatus(order, next, role, { note: req.body.note, reason: req.body.reason });
  res.json(view(order, req.customer._id));
});

// ---------------------------------------------------------------- delivery records (one per store; split fulfilment)
const deliveryRecords = () => require('../market/deliveries');
// GET /api/orders/:id/deliveries  (buyer or seller)
exports.deliveriesOf = asyncHandler(async (req, res) => {
  const order = await loadFor(req);
  const list = await deliveryRecords().createFor(order);
  res.json({ deliveries: list.map(deliveryRecords().view), split: list.length > 1, splitDeliveryFee: String(order.seller) === String(req.customer._id) ? order.splitDeliveryFee || 0 : undefined });
});
// POST /api/orders/:id/deliveries/:deliveryId/status { status: ready | on_the_way | delivered, note }  (the seller sends a part)
exports.deliveryStatus = asyncHandler(async (req, res) => {
  const order = await loadFor(req);
  if (String(order.seller) !== String(req.customer._id)) throw httpError('Only the seller can update a delivery', 403);
  if (!isId(req.params.deliveryId)) throw httpError('Delivery not found', 404);
  const list = await deliveryRecords().sellerUpdate(order, req.params.deliveryId, String(req.body.status || ''), clean(req.body.note, 200));
  res.json({ deliveries: list.map(deliveryRecords().view), order: view(order, req.customer._id) });
});
// POST /api/orders/:id/deliveries/:deliveryId/received  (the buyer got this part)
exports.deliveryReceived = asyncHandler(async (req, res) => {
  const order = await loadFor(req);
  if (String(order.buyer) !== String(req.customer._id)) throw httpError('Only the buyer can confirm a delivery', 403);
  if (!isId(req.params.deliveryId)) throw httpError('Delivery not found', 404);
  const list = await deliveryRecords().received(order, req.params.deliveryId);
  res.json({ deliveries: list.map(deliveryRecords().view), order: view(order, req.customer._id) });
});

// ---------------------------------------------------------------- admin
// GET /api/orders/admin/list?status=&payout=&q=&page=
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (['due', 'paid'].includes(req.query.payout)) filter['payout.status'] = req.query.payout;
  if (req.query.refunds === '1') filter['payment.status'] = 'refund_due';
  const query = clean(req.query.q, 60);
  if (query) filter.$or = [{ 'payment.ref': query.toUpperCase() }, { 'payment.receipt': query.toUpperCase() }, { orderNo: new RegExp(query.replace(/[^A-Za-z0-9-]/g, ''), 'i') }, { buyerName: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, ''), 'i') }, { sellerName: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, ''), 'i') }];
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [list, total, stats] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean(),
    Order.countDocuments(filter),
    Order.aggregate([
      {
        $group: {
          _id: null,
          orders: { $sum: { $cond: [{ $ne: ['$status', 'awaiting_payment'] }, 1, 0] } },
          open: { $sum: { $cond: [{ $in: ['$status', ['placed', 'confirmed', 'shipped']] }, 1, 0] } },
          gmv: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$total', 0] } },
          commission: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'delivered'] }, { $eq: ['$payment.method', 'mpesa'] }] }, '$commission', 0] } },
          payoutsDue: { $sum: { $cond: [{ $eq: ['$payout.status', 'due'] }, '$payout.amount', 0] } },
          payoutsDueCount: { $sum: { $cond: [{ $eq: ['$payout.status', 'due'] }, 1, 0] } },
          refundsDue: { $sum: { $cond: [{ $eq: ['$payment.status', 'refund_due'] }, 1, 0] } },
        },
      },
    ]),
  ]);
  res.json({ orders: list.map((item) => view(item, 'admin')), total, pages: Math.max(1, Math.ceil(total / 50)), stats: stats[0] || {} });
});

// POST /api/orders/admin/:id { action: 'payout' | 'refunded' | 'cancel', ref, reason }
exports.adminAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Order not found', 404);
  const order = await Order.findById(req.params.id);
  if (!order) throw httpError('Order not found', 404);
  const action = req.body.action;
  if (action === 'payout') {
    if (order.payout?.status !== 'due') throw httpError('No payout is due for this order');
    order.payout.status = 'paid';
    order.payout.ref = clean(req.body.ref, 40);
    order.payout.paidAt = new Date();
    order.history.push({ status: order.status, by: 'admin', note: `Seller paid ${order.payout.amount} (${order.payout.ref || 'no ref'})` });
    await order.save();
    broadcast(order);
  } else if (action === 'refunded') {
    if (order.payment.status !== 'refund_due') throw httpError('No refund is due for this order');
    order.payment.status = 'refunded';
    order.history.push({ status: order.status, by: 'admin', note: `Refunded to buyer ${clean(req.body.ref, 40)}`.trim() });
    await order.save();
    broadcast(order);
  } else if (action === 'cancel') {
    if (['delivered', 'cancelled'].includes(order.status)) throw httpError('This order is already finished');
    await applyStatus(order, 'cancelled', 'admin', { reason: req.body.reason || 'Cancelled by the marketplace team' });
  } else throw httpError('Unknown action');
  res.json(view(order, 'admin'));
});

// shared with Lipa Pole Pole plans (planController)
Object.assign(exports, { newOrderNo, broadcast, orderView: view, reserve, release, sellerAmount });
