// Lipa Pole Pole (lay-away): pay for an item bit by bit with M-Pesa.
//  1. Buyer picks a deposit (≥ the seller's minimum %) and a number of weeks → M-Pesa prompt for the deposit.
//  2. Deposit paid → the item is reserved (stock taken) and the plan is "active".
//  3. Buyer pays any amount any time (at least the weekly instalment, or what's left) until fully paid.
//  4. Fully paid → it becomes a normal paid order: the seller confirms, ships, and is paid after delivery.
// Cancelling releases the item; money paid is refunded by the marketplace team (marked "refund due").
const crypto = require('crypto');
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { stkPush, stkQuery, formatPhone } = require('../utils/mpesa');
const { emitCustomer, emitAdmin } = require('../utils/realtime');
const { site } = require('../config/site');
const { COUNTIES } = require('../market/categories');
const notify = require('../utils/notify');

const isId = (value) => mongoose.isValidObjectId(value);
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const ksh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;

function view(order, viewer) {
  const role = viewer === 'admin' ? 'admin' : String(order.buyer) === String(viewer) ? 'buyer' : 'seller';
  const remaining = Math.max(0, order.total - order.paid);
  const pending = order.payments.find((payment) => payment.status === 'pending');
  return {
    _id: order._id, planNo: order.planNo, role, listing: order.listing, title: order.title, slug: order.slug, image: order.image, category: order.category,
    buyer: { _id: order.buyer, name: order.buyerName, ...(role !== 'buyer' ? { phone: order.buyerPhone } : {}) },
    seller: { _id: order.seller, name: order.sellerName },
    price: order.price, deliveryFee: order.deliveryFee, total: order.total, deposit: order.deposit, weeks: order.weeks, weekly: order.weekly,
    paid: order.paid, remaining, progress: order.total ? Math.round((order.paid / order.total) * 100) : 0,
    nextAmount: order.status === 'pending_deposit' ? order.deposit : Math.min(order.weekly, remaining),
    delivery: order.delivery, status: order.status, dueBy: order.dueBy, order: order.order,
    payments: order.payments.map((payment) => ({ _id: payment._id, amount: payment.amount, status: payment.status, receipt: payment.receipt, at: payment.at, paidAt: payment.paidAt, failReason: payment.failReason })),
    paying: !!pending, refundDue: order.refundDue, refundStatus: order.refundStatus, cancelReason: order.cancelReason, createdAt: order.createdAt,
  };
}
function broadcast(value) {
  emitCustomer(String(value.buyer), 'plan:update', view(value, value.buyer));
  emitCustomer(String(value.seller), 'plan:update', view(value, value.seller));
  emitAdmin('plan:update', view(value, 'admin'));
}

async function charge(plan, amount, phone) {
  let result;
  try {
    result = await stkPush({ phone, amount, accountReference: plan.planNo.replace(/-/g, '').slice(0, 12), description: 'Lipa Pole Pole' });
  } catch (err) {
    throw httpError(`M-Pesa payment could not start: ${err.response?.data?.errorMessage || err.message}`, 502);
  }
  plan.payments.push({ amount, phone, checkoutRequestId: result.CheckoutRequestID });
  await plan.save();
  return result.CustomerMessage || 'Check your phone and enter your M-Pesa PIN';
}

// POST /api/plans { listingId, deposit, weeks, delivery: { method, county, address, notes }, phone, offerId }
exports.create = asyncHandler(async (req, res) => {
  const me = req.customer;
  if (!isId(req.body.listingId)) throw httpError('Ad not found', 404);
  const listing = await Listing.findById(req.body.listingId).lean();
  if (!listing || listing.status !== 'active' || !listing.buyNow) throw httpError('This item can’t be bought online right now', 409);
  if (!listing.layaway?.enabled) throw httpError('The seller doesn’t offer Lipa Pole Pole on this item');
  if (String(listing.seller) === String(me._id)) throw httpError('This is your own ad');
  if (listing.stock < 1) throw httpError('Sold out', 409);
  if (await Plan.exists({ buyer: me._id, listing: listing._id, status: { $in: ['pending_deposit', 'active'] } })) throw httpError('You already have a Lipa Pole Pole plan for this item. Open it from My orders.', 409);

  // price: the ad's price, or an accepted offer
  let price = listing.price;
  const offer = await require('./offerController').usableOffer(req.body.offerId, me._id, listing._id);
  if (offer) price = offer.amount;
  const method = req.body.delivery?.method === 'pickup' ? 'pickup' : 'delivery';
  if (method === 'delivery' && !listing.delivery?.available) throw httpError('The seller doesn’t deliver this item. Choose pickup.');
  if (method === 'pickup' && listing.delivery?.pickup === false) throw httpError('This item can’t be picked up. Choose delivery.');
  const county = clean(req.body.delivery?.county, 40);
  const address = clean(req.body.delivery?.address, 200);
  if (method === 'delivery' && (!COUNTIES.includes(county) || address.length < 5)) throw httpError('Please enter your county and delivery address');
  const deliveryFee = method === 'delivery' ? listing.delivery?.fee || 0 : 0;
  const total = price + deliveryFee;
  const minDeposit = Math.ceil((total * (listing.layaway.minDepositPercent || 30)) / 100);
  const deposit = Math.round(Number(req.body.deposit));
  if (!(deposit >= minDeposit)) throw httpError(`The deposit must be at least ${ksh(minDeposit)} (${listing.layaway.minDepositPercent}%)`);
  if (deposit >= total) throw httpError('That’s the full price: use Buy now instead');
  const weeks = Math.round(Number(req.body.weeks));
  if (!(weeks >= 1 && weeks <= (listing.layaway.maxWeeks || 4))) throw httpError(`Choose between 1 and ${listing.layaway.maxWeeks} weeks`);
  let phone;
  try {
    phone = formatPhone(req.body.phone || me.phone || '');
  } catch {
    throw httpError('Please enter a valid Safaricom number for M-Pesa');
  }

  const plan = new Plan({
    planNo: `LP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    listing: listing._id, title: listing.title, slug: listing.slug, image: listing.images?.[0] || '', category: listing.category,
    buyer: me._id, buyerName: me.name, buyerPhone: phone, buyerEmail: me.email,
    seller: listing.seller, sellerName: listing.sellerName,
    price, deliveryFee, total, deposit, weeks, weekly: Math.ceil((total - deposit) / weeks),
    delivery: { method, county: method === 'delivery' ? county : listing.county, address: method === 'delivery' ? address : '', notes: clean(req.body.delivery?.notes, 300), pickupArea: [listing.area, listing.county].filter(Boolean).join(', ') },
  });
  const message = await charge(plan, deposit, phone);
  if (offer) await require('./offerController').markUsed([offer._id]);
  res.status(201).json({ plan: view(plan, me._id), message });
});

// a fully paid plan becomes a normal paid order
async function complete(currentOrder) {
  const oc = require('./orderController');
  const commissionPercent = site().commissionPercent;
  const order = await Order.create({
    orderNo: oc.newOrderNo(), checkoutId: crypto.randomBytes(8).toString('hex'),
    buyer: currentOrder.buyer, buyerName: currentOrder.buyerName, buyerPhone: currentOrder.buyerPhone, buyerEmail: currentOrder.buyerEmail,
    seller: currentOrder.seller, sellerName: currentOrder.sellerName,
    items: [{ listing: currentOrder.listing, title: currentOrder.title, slug: currentOrder.slug, image: currentOrder.image, category: currentOrder.category, price: currentOrder.price, qty: 1, subtotal: currentOrder.price }],
    subtotal: currentOrder.price, deliveryFee: currentOrder.deliveryFee, total: currentOrder.total, delivery: currentOrder.delivery,
    payment: { method: 'mpesa', status: 'paid', phone: currentOrder.buyerPhone, receipt: currentOrder.payments.filter((payment) => payment.status === 'paid').map((item) => item.receipt).filter(Boolean).slice(-1)[0], paidAt: new Date() },
    status: 'placed', history: [{ status: 'placed', by: 'mpesa', note: `Lipa Pole Pole ${currentOrder.planNo} fully paid` }],
    commissionPercent, commission: Math.round((currentOrder.total * commissionPercent) / 100),
  });
  currentOrder.status = 'completed';
  currentOrder.order = order._id;
  await currentOrder.save();
  notify.paymentReceived(order);
  notify.orderPlaced(order);
  oc.broadcast(order);
}

// Payment result (callback or status check)
async function settlePlanPayment(checkoutRequestId, { ok, receipt, reason }) {
  const plan = await Plan.findOne({ 'payments.checkoutRequestId': checkoutRequestId });
  if (!plan) return 0;
  const pay = plan.payments.find((payment) => payment.checkoutRequestId === checkoutRequestId);
  if (!pay || pay.status !== 'pending') return 1;
  if (!ok) {
    pay.status = 'failed';
    pay.failReason = reason || 'Payment was not completed';
    await plan.save();
    broadcast(plan);
    return 1;
  }
  pay.status = 'paid';
  pay.receipt = receipt;
  pay.paidAt = new Date();
  plan.paid += pay.amount;
  if (['cancelled', 'defaulted'].includes(plan.status)) {
    // money arrived after the plan ended: refund it
    plan.refundDue += pay.amount;
    plan.refundStatus = 'due';
    await plan.save();
    broadcast(plan);
    return 1;
  }
  if (plan.status === 'pending_deposit') {
    // deposit in: reserve the item
    const oc = require('./orderController');
    try {
      await oc.reserve([{ listing: plan.listing, qty: 1, title: plan.title }]);
      plan.reserved = true;
      plan.status = 'active';
      plan.dueBy = new Date(Date.now() + plan.weeks * 7 * 86400000);
    } catch {
      plan.status = 'cancelled';
      plan.cancelReason = 'The item sold out before the deposit arrived';
      plan.refundDue = plan.paid;
      plan.refundStatus = 'due';
    }
  }
  await plan.save();
  if (plan.status === 'active' && plan.paid >= plan.total) await complete(plan);
  broadcast(plan);
  return 1;
}
exports.settlePlanPayment = settlePlanPayment;

async function loadFor(req) {
  if (!isId(req.params.id)) throw httpError('Plan not found', 404);
  const plan = await Plan.findById(req.params.id);
  const me = String(req.customer._id);
  if (!plan || (String(plan.buyer) !== me && String(plan.seller) !== me)) throw httpError('Plan not found', 404);
  return plan;
}

// GET /api/plans/:id  (also checks a pending M-Pesa payment with Safaricom)
exports.get = asyncHandler(async (req, res) => {
  let plan = await loadFor(req);
  const pending = plan.payments.find((payment) => payment.status === 'pending');
  if (pending && Date.now() - new Date(pending.at) > 8000) {
    try {
      const stkQueryResult = await stkQuery(pending.checkoutRequestId);
      if (String(stkQueryResult.ResultCode) === '0') await settlePlanPayment(pending.checkoutRequestId, { ok: true, receipt: stkQueryResult.MpesaReceiptNumber || '' });
      else if (stkQueryResult.ResultCode !== undefined && !/process/i.test(stkQueryResult.ResultDesc || '')) await settlePlanPayment(pending.checkoutRequestId, { ok: false, reason: stkQueryResult.ResultDesc });
      plan = await Plan.findById(plan._id);
    } catch {
      /* still processing */
    }
  }
  res.json(view(plan, req.customer._id));
});

// POST /api/plans/:id/pay { amount, phone }  (the buyer pays the deposit again or the next instalment)
exports.pay = asyncHandler(async (req, res) => {
  const plan = await loadFor(req);
  if (String(plan.buyer) !== String(req.customer._id)) throw httpError('Only the buyer can pay', 403);
  if (!['pending_deposit', 'active'].includes(plan.status)) throw httpError('This plan is closed');
  if (plan.payments.some((payment) => payment.status === 'pending' && Date.now() - new Date(payment.at) < 90000)) throw httpError('A payment is already waiting for your PIN. Check your phone.', 409);
  const remaining = plan.total - plan.paid;
  let amount = plan.status === 'pending_deposit' ? plan.deposit : Math.round(Number(req.body.amount || plan.weekly));
  if (plan.status === 'active') {
    const min = Math.min(100, remaining); // any amount from KSh 100 (pay as you get money)
    if (!(amount >= min)) throw httpError(`Pay at least ${ksh(min)}`);
    amount = Math.min(amount, remaining);
  }
  // pending payments that were never answered are marked failed so the new one is clear
  plan.payments.forEach((payment) => {
    if (payment.status === 'pending') {
      payment.status = 'failed';
      payment.failReason = 'Replaced by a new payment request';
    }
  });
  const phone = formatPhone(req.body.phone || plan.buyerPhone);
  const message = await charge(plan, amount, phone);
  broadcast(plan);
  res.json({ plan: view(plan, req.customer._id), message });
});

// POST /api/plans/:id/cancel { reason }  (the buyer gives up: item released, money refunded)
exports.cancel = asyncHandler(async (req, res) => {
  const plan = await loadFor(req);
  if (String(plan.buyer) !== String(req.customer._id)) throw httpError('Only the buyer can cancel a plan', 403);
  if (!['pending_deposit', 'active'].includes(plan.status)) throw httpError('This plan is already closed');
  await endPlan(plan, 'cancelled', clean(req.body.reason, 200) || 'Cancelled by the buyer');
  res.json(view(plan, req.customer._id));
});

async function endPlan(plan, status, reason) {
  if (plan.reserved) {
    await require('./orderController').release([{ listing: plan.listing, qty: 1 }]);
    plan.reserved = false;
  }
  plan.status = status;
  plan.cancelReason = reason;
  if (plan.paid > 0) {
    plan.refundDue = plan.paid;
    plan.refundStatus = 'due';
  }
  await plan.save();
  broadcast(plan);
}

// GET /api/plans/mine · GET /api/plans/sales
exports.mine = asyncHandler(async (req, res) => {
  const list = await Plan.find({ buyer: req.customer._id, status: { $ne: 'pending_deposit' } }).sort({ createdAt: -1 }).limit(100).lean();
  const fresh = await Plan.find({ buyer: req.customer._id, status: 'pending_deposit', createdAt: { $gte: new Date(Date.now() - 30 * 60000) } }).lean();
  res.json([...fresh, ...list].map((item) => view(item, req.customer._id)));
});
exports.sales = asyncHandler(async (req, res) => {
  const list = await Plan.find({ seller: req.customer._id, status: { $in: ['active', 'completed', 'cancelled', 'defaulted'] } }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((item) => view(item, req.customer._id)));
});

// ---------------------------------------------------------------- admin
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.refunds === '1') filter.refundStatus = 'due';
  else if (req.query.status) filter.status = String(req.query.status);
  const list = await Plan.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((item) => view(item, 'admin')));
});
// POST /api/plans/admin/:id { action: 'refunded' | 'default', ref }
exports.adminAction = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Plan not found', 404);
  const plan = await Plan.findById(req.params.id);
  if (!plan) throw httpError('Plan not found', 404);
  if (req.body.action === 'refunded') {
    if (plan.refundStatus !== 'due') throw httpError('No refund is due');
    plan.refundStatus = 'refunded';
    await plan.save();
    broadcast(plan);
  } else if (req.body.action === 'default') {
    if (plan.status !== 'active') throw httpError('Only active plans can be closed');
    await endPlan(plan, 'defaulted', clean(req.body.ref, 200) || 'Not paid in time');
  } else throw httpError('Unknown action');
  res.json(view(plan, 'admin'));
});

// Deposits not paid within 30 minutes are dropped; plans 14 days past their end date are closed (item released, refund due)
exports.startPlanWorker = () => {
  const sweep = async () => {
    await Plan.updateMany({ status: 'pending_deposit', createdAt: { $lt: new Date(Date.now() - 30 * 60000) }, paid: 0 }, { $set: { status: 'cancelled', cancelReason: 'Deposit not paid' } });
    const late = await Plan.find({ status: 'active', dueBy: { $lt: new Date(Date.now() - 14 * 86400000) } }).limit(50); // in batches
    for (const plan of late) await endPlan(plan, 'defaulted', 'Not fully paid by the due date');
  };
  require('../utils/jobs').every('plan-sweep', 15 * 60 * 1000, sweep)(); // one server at a time; once now
};
