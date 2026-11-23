// Paying the seller directly: a checkout from ONE seller, paid by M-Pesa, goes straight to that seller's own M-Pesa
// (Till, Paybill, Pochi la Biashara or Send Money). A checkout from SEVERAL sellers is paid in one M-Pesa payment to
// Kapu's wallet instead (goods + delivery; see orderController.checkout). The machinery below works for any
// number of orders; today it is used for one.
//
//   fee    first, one M-Pesa prompt to Kapu for our verification & inspection fee (fieldwork.directFee per
//          seller, KSh 150 by default, plus any inspection the buyer asked for). It becomes each order's inspection
//          fee: our shopping agent checks the payment reached the seller and the goods match, and earns that fee.
//   stk    the seller connected their own Daraja (Lipa Na M-Pesa Online) app: we send the buyer an M-Pesa prompt
//          that pays the seller's Till / Paybill directly. A phone shows one M-Pesa prompt at a time, so the prompts
//          go out back to back: the next one as soon as the previous is answered (or times out).
//   manual Pochi la Biashara / Send Money, or sellers who haven't connected Daraja: Safaricom has no prompt for
//          these, so the buyer pays from their M-Pesa menu and sends us the M-Pesa code; the seller types the code
//          they received; we compare the two (the seller never sees the buyer's code).
//
// Only for one-seller checkouts paid by M-Pesa, where the seller has M-Pesa details and a shop on the map (our agent
// goes there), and nothing else is held by us (Safe deal, courier and rider-inspected orders are paid to Kapu
// as before). The goods money never passes through Kapu, so no commission is taken off it.
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const { site } = require('../config/site');
const mpesa = require('../utils/mpesa');
const box = require('../utils/secretBox');

const PROMPT_TIMEOUT_MS = 2 * 60 * 1000; // an unanswered prompt: check with Safaricom, then move on
const QUERY_AFTER_MS = 8000;
const LOCK_MS = 30 * 1000;
const CODE = /^[A-Z0-9]{10}$/; // an M-Pesa transaction code, e.g. SFG3K7QX2P

// our agent's verification fee: from KSh 200 (0 = switched off)
const directFee = () => { const fee = Math.max(0, Math.round(Number(site().fieldwork?.directFee ?? 200) || 0)); return fee > 0 ? Math.max(require('./fieldwork').AGENT_MIN_FEE, fee) : 0; };
// the order may start once our fee is paid (or there is none)
const feeDone = (order) => !(order.payment?.fee?.amount > 0) || order.payment.fee.status === 'paid';

// is this checkout paid straight to its seller? (drafts: one per seller; shops: sellerId → shopLocation)
function splittable(drafts, payMethod, shops) {
  return payMethod === 'mpesa' && drafts.length === 1 && drafts.every((draft) => draft.sellerPay?.method && !draft.verification && draft.delivery?.method !== 'courier' && !draft.rider?.combined && (!draft.inspection || shops.get(String(draft.seller))?.point?.coordinates));
}

// mark each draft as paid straight to its seller, with our verification & inspection fee on top
async function prepare(drafts) {
  const connected = new Map((await Customer.find({ _id: { $in: drafts.map((draft) => draft.seller) }, 'payConnect.shortcode': { $exists: true } }).select('payConnect').lean()).map((customer) => [String(customer._id), customer.payConnect]));
  const demo = site().demoPayments;
  void directFee; // no fee is ever added on its own: only the inspection the buyer chose (“Inspect my goods”)
  const { split } = require('./payouts');
  drafts.forEach((draft, index) => {
    const pay = draft.sellerPay;
    const link = connected.get(String(draft.seller));
    // a Paybill prompt must go to the Paybill the keys belong to; a Till is paid under the seller's store number
    const promptable = demo || (link && (pay.method === 'till' || (pay.method === 'paybill' && link.shortcode === pay.paybill)));
    const base = draft.inspection?.fee || 0; // an inspection the buyer asked for: paid to us too
    const sellerAmount = draft.total - (draft.payOnDelivery || 0) - base;
    if (draft.inspection) draft.inspection.notes = [draft.inspection.notes, 'Paid straight to the seller: check the buyer’s M-Pesa payment reached them'].filter(Boolean).join(' · ');
    draft.commissionPercent = 0;
    draft.commission = 0;
    draft.payment = {
      ...draft.payment, direct: true, channel: promptable ? 'stk' : 'manual', seq: index, amount: sellerAmount,
      to: { method: pay.method, till: pay.till || '', paybill: pay.paybill || '', account: pay.account || '', phone: pay.phone || '', name: pay.name || '', text: pay.text || '', ...(link && promptable ? { shortcode: link.shortcode } : {}) },
      fee: { amount: base, base, status: base > 0 ? 'pending' : 'none' },
    };
  });
}

// the seller's own Daraja settings (keys decrypted only here, only for the call)
async function sellerCfg(sellerId) {
  const customer = await Customer.findById(sellerId).select('+payKeys payConnect').lean();
  if (!customer?.payKeys?.consumerKey || !customer.payConnect?.shortcode) return null;
  try {
    return {
      env: customer.payConnect.env || 'production', shortcode: customer.payConnect.shortcode, callbackUrl: site().mpesa.callbackUrl,
      consumerKey: box.open(customer.payKeys.consumerKey), consumerSecret: box.open(customer.payKeys.consumerSecret), passkey: box.open(customer.payKeys.passkey),
    };
  } catch {
    return null; // keys can't be opened (the encryption key changed): the seller must connect again
  }
}

const settle = (...args) => require('../controllers/orderController').settlePayment(...args);
const announce = (order) => require('../controllers/orderController').broadcast(order);
const errText = (err) => String(err.response?.data?.errorMessage || err.message).slice(0, 120);

// ---------------------------------------------------------------- our fee (one prompt to Kapu)
async function promptFee(orders) {
  const amount = orders.reduce((sum, order) => sum + order.payment.fee.amount, 0);
  const ids = orders.map((order) => order._id);
  const checkoutId = orders[0].checkoutId;
  if (site().demoPayments) {
    const demoId = `demo-fee-${checkoutId}`;
    await Order.updateMany({ _id: { $in: ids } }, { $set: { 'payment.fee.checkoutRequestId': demoId, 'payment.fee.promptedAt': new Date() } });
    await settleFee(demoId, { ok: true, receipt: `DEMOF${checkoutId.slice(0, 5).toUpperCase()}`, amount });
    return false;
  }
  let set;
  try {
    const result = await mpesa.stkPush({ phone: orders[0].payment.phone, amount, accountReference: `OS${checkoutId.slice(0, 8)}`, description: 'Verification' });
    set = { 'payment.fee.checkoutRequestId': result.CheckoutRequestID, 'payment.fee.promptedAt': new Date() };
  } catch (err) {
    set = { 'payment.fee.status': 'failed', 'payment.fee.promptedAt': new Date(), 'payment.fee.failReason': `The M-Pesa prompt for the verification fee couldn’t be sent: ${errText(err)}` };
  }
  await Order.updateMany({ _id: { $in: ids } }, { $set: set });
  for (const order of await Order.find({ _id: { $in: ids } })) announce(order);
  return !set['payment.fee.status'];
}

// the fee's M-Pesa result (callback or query); returns how many orders it matched
async function settleFee(checkoutRequestId, { ok, receipt, reason, amount }) {
  if (!checkoutRequestId) return 0;
  const orders = await Order.find({ 'payment.fee.checkoutRequestId': checkoutRequestId, 'payment.fee.status': { $in: ok ? ['pending', 'failed'] : ['pending'] } });
  if (!orders.length) return 0;
  const due = orders.reduce((sum, order) => sum + (order.payment.fee.amount || 0), 0);
  const { audit } = require('../security/audit');
  let good = ok;
  let why = reason;
  if (good && amount != null && amount !== '' && Number(amount) + 0.5 < due) {
    good = false;
    why = `M-Pesa received KSh ${Number(amount)} instead of KSh ${due}`;
    audit(null, 'mpesa.amount_mismatch', { outcome: 'denied', detail: `fee ${orders[0].checkoutId} ${amount}/${due}` });
  }
  if (good && receipt && (await Order.exists({ checkoutId: { $ne: orders[0].checkoutId }, $or: [{ 'payment.receipt': receipt }, { 'payment.fee.receipt': receipt }, { 'payment.claimCode': receipt }, { 'payment.sellerCode': receipt }] }))) {
    good = false;
    why = 'This M-Pesa payment was already used for another order';
    audit(null, 'mpesa.receipt_reused', { outcome: 'denied', detail: `fee ${orders[0].checkoutId} ${receipt}` });
  }
  for (const order of orders) {
    if (good) {
      order.payment.fee.status = 'paid';
      order.payment.fee.receipt = receipt;
      order.payment.fee.paidAt = new Date();
      order.payment.fee.failReason = undefined;
      order.history.push({ status: order.status, by: 'mpesa', note: `Verification & inspection fee KSh ${order.payment.fee.amount} paid${receipt ? ` (M-Pesa ${receipt})` : ''}` });
    } else if (order.payment.fee.status === 'pending') {
      order.payment.fee.status = 'failed';
      order.payment.fee.failReason = why || 'Payment was not completed';
    } else continue;
    await order.save();
    // the seller was already paid: the order starts now
    if (good && order.payment.status === 'paid') await require('../controllers/orderController').startPaidOrder(order, 'mpesa');
    else announce(order);
  }
  nextSoon(orders[0].checkoutId);
  return orders.length;
}

// ---------------------------------------------------------------- the sellers' prompts
// send one seller's M-Pesa prompt to the buyer's phone; true = it's on the phone now (wait for the PIN)
async function prompt(order) {
  const to = order.payment.to || {};
  if (site().demoPayments) {
    order.payment.checkoutRequestId = `demo-${order._id}`;
    order.payment.promptedAt = new Date();
    await order.save();
    const receipt = `DEMO${String(order._id).slice(-6).toUpperCase()}`;
    await settle(order.payment.checkoutRequestId, { ok: true, receipt, amount: order.payment.amount }, { chain: false });
    return false;
  }
  const cfg = await sellerCfg(order.seller);
  if (!cfg) {
    // the seller disconnected meanwhile: the buyer pays them from their M-Pesa menu instead
    order.payment.channel = 'manual';
    await order.save();
    announce(order);
    return false;
  }
  try {
    const result = await mpesa.stkPush({
      phone: order.payment.phone, amount: order.payment.amount, cfg,
      accountReference: to.method === 'paybill' ? to.account : order.orderNo, description: 'Kapu',
      partyB: to.method === 'till' ? to.till : to.paybill,
      transactionType: to.method === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    });
    order.payment.checkoutRequestId = result.CheckoutRequestID;
    order.payment.promptedAt = new Date();
  } catch (err) {
    order.payment.status = 'failed';
    order.payment.promptedAt = new Date();
    order.payment.failReason = `The M-Pesa prompt for ${order.sellerName} couldn’t be sent: ${errText(err)}`;
  }
  await order.save();
  announce(order);
  return order.payment.status === 'pending';
}

// one worker per checkout at a time (any server): a lock on the checkout's first order
async function withLock(checkoutId, work) {
  const now = new Date();
  const leader = await Order.findOneAndUpdate(
    { checkoutId, 'payment.direct': true, 'payment.seq': 0, $or: [{ 'payment.lock': null }, { 'payment.lock': { $lt: new Date(now.getTime() - LOCK_MS) } }] },
    { $set: { 'payment.lock': now } },
    { projection: { _id: 1 } }
  );
  if (!leader) return false;
  try {
    await work();
  } finally {
    await Order.updateOne({ _id: leader._id, 'payment.lock': now }, { $unset: { 'payment.lock': 1 } });
  }
  return true;
}

// ask Safaricom how a prompt ended (no callback can reach a laptop); null = not known yet
async function ask(checkoutRequestId, cfg) {
  if (!checkoutRequestId || checkoutRequestId.startsWith('demo-') || cfg === null) return null;
  try {
    const result = await mpesa.stkQuery(checkoutRequestId, ...(cfg ? [cfg] : []));
    if (String(result.ResultCode) === '0') return { ok: true, receipt: result.MpesaReceiptNumber || '' };
    if (result.ResultCode !== undefined && !/process/i.test(result.ResultDesc || '')) return { ok: false, reason: result.ResultDesc };
  } catch {
    /* still processing, or Safaricom busy */
  }
  return null;
}

// a prompt on the phone: true = still waiting for the PIN; false = it ended (settled, go on)
async function check(promptedAt, checkoutRequestId, cfg, done) {
  const age = Date.now() - promptedAt.getTime();
  if (age < QUERY_AFTER_MS) return true;
  const answer = await ask(checkoutRequestId, cfg);
  if (answer) {
    await done(answer);
    return false;
  }
  if (age < PROMPT_TIMEOUT_MS) return true;
  await done({ ok: false, reason: 'No answer to the M-Pesa prompt (it timed out)' });
  return false;
}

// move a checkout's prompts along: our fee first, then each seller, one at a time
async function next(checkoutId) {
  return withLock(checkoutId, async () => {
    for (let guard = 0; guard < 25; guard += 1) {
      const feeLive = await Order.find({ checkoutId, 'payment.direct': true, 'payment.fee.status': 'pending', status: 'awaiting_payment' }).sort({ 'payment.seq': 1 });
      if (feeLive.length) {
        const flying = feeLive.find((order) => order.payment.fee.promptedAt);
        if (flying) {
          if (await check(flying.payment.fee.promptedAt, flying.payment.fee.checkoutRequestId, undefined, (answer) => settleFee(flying.payment.fee.checkoutRequestId, answer))) return;
          continue;
        }
        if (await promptFee(feeLive)) return;
        continue;
      }
      // our fee didn't go through: the buyer pays it (again) before any seller
      if (await Order.exists({ checkoutId, 'payment.direct': true, 'payment.fee.status': 'failed', status: 'awaiting_payment' })) return;
      const live = await Order.find({ checkoutId, 'payment.direct': true, 'payment.channel': 'stk', 'payment.status': 'pending', status: 'awaiting_payment' }).sort({ 'payment.seq': 1 });
      const inFlight = live.find((order) => order.payment.promptedAt);
      if (inFlight) {
        const cfg = (await sellerCfg(inFlight.seller)) || null;
        if (await check(inFlight.payment.promptedAt, inFlight.payment.checkoutRequestId, cfg, (answer) => settle(inFlight.payment.checkoutRequestId, answer, { chain: false }))) return;
        continue;
      }
      if (!live.length) return;
      if (await prompt(live[0])) return; // on the phone: wait for the buyer's PIN (failed / demo: go on to the next)
    }
  });
}
const nextSoon = (checkoutId) => next(checkoutId).catch((error) => console.error('[split-pay]', error.message));

// ---------------------------------------------------------------- what the buyer sees
function stateOf(order) {
  const payment = order.payment;
  if (payment.status === 'paid') return 'paid';
  if (payment.status === 'refund_due' || payment.status === 'refunded') return payment.status;
  if (order.status === 'cancelled') return 'cancelled';
  if (payment.status === 'cod') return 'cod';
  if (payment.claimCode) return payment.mismatch ? 'mismatch' : 'claimed';
  if (payment.status === 'failed') return 'failed';
  if (payment.channel === 'manual') return 'manual';
  return payment.promptedAt ? 'prompted' : 'queued';
}
function feeState(fee) {
  if (!(fee?.amount > 0)) return 'none';
  if (fee.status === 'pending') return fee.promptedAt ? 'prompted' : 'queued';
  return fee.status;
}
function partView(order) {
  const payment = order.payment;
  return {
    orderId: order._id, orderNo: order.orderNo, seller: { _id: order.seller, name: order.sellerName },
    items: order.items.map((item) => ({ title: item.title, qty: item.qty, price: item.price, subtotal: item.subtotal })),
    subtotal: order.subtotal, amount: payment.amount ?? order.total - (order.payOnDelivery || 0), payOnDelivery: order.payOnDelivery || 0,
    fee: payment.fee?.amount || 0, feeBase: payment.fee?.base || 0,
    to: payment.to ? { method: payment.to.method, till: payment.to.till, paybill: payment.to.paybill, account: payment.to.account, phone: payment.to.phone, name: payment.to.name, text: payment.to.text } : null,
    channel: payment.channel, state: stateOf(order), receipt: payment.receipt || '', ref: payment.ref || '', claimCode: payment.claimCode || '', paidAt: payment.paidAt, failReason: payment.failReason || '',
  };
}
function summary(orders) {
  const sorted = [...orders].sort((a, b) => (a.payment.seq ?? 0) - (b.payment.seq ?? 0));
  const parts = sorted.map(partView);
  const add = (key) => parts.reduce((sum, part) => sum + (part[key] || 0), 0);
  // our fee: one payment for the checkout (only the orders still counting it)
  const withFee = sorted.filter((order) => order.payment.fee?.amount > 0 && order.payment.status !== 'cod');
  const fee = withFee.length ? (() => {
    const first = withFee.find((order) => order.payment.fee.status !== 'paid') || withFee[0];
    return {
      amount: withFee.reduce((sum, order) => sum + order.payment.fee.amount, 0), each: directFee(), sellers: withFee.length,
      inspections: withFee.reduce((sum, order) => sum + (order.payment.fee.base || 0), 0),
      state: feeState(first.payment.fee), receipt: withFee.find((order) => order.payment.fee.receipt)?.payment.fee.receipt || '', failReason: first.payment.fee.failReason || '',
    };
  })() : null;
  const sellersNow = add('amount');
  const feeNow = fee?.amount || 0;
  return { parts, fee, goods: add('subtotal'), sellersNow, payNow: sellersNow + feeNow, onDelivery: add('payOnDelivery'), total: sellersNow + feeNow + add('payOnDelivery'), sellers: parts.length };
}

module.exports = { splittable, prepare, sellerCfg, next, nextSoon, summary, partView, stateOf, settleFee, feeDone, directFee, CODE, PROMPT_TIMEOUT_MS };
