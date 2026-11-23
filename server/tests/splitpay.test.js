// Who is paid, and the payment ID:   cd server && npm run test:splitpay
//   one seller, M-Pesa → straight to that seller's Till / Paybill / Pochi (plus our verification fee)
//   several sellers, M-Pesa → one payment to the Kapu wallet (goods + delivery fees)
// Real server on a throw-away database. Safaricom (Daraja) is a stand-in that records every request and answers
// like the real API; payment results arrive through the real callback address, with its secret key.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5196;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_splitpay_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 's'.repeat(48), AUTH_RATE_LIMIT: '400', PAY_SECRETS_KEY: '',
  // Kapu's own M-Pesa (single-seller checkouts keep paying us, as before)
  MPESA_ENV: 'sandbox', MPESA_CONSUMER_KEY: 'kapuKey123', MPESA_CONSUMER_SECRET: 'kapuSecret123', MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'kapuPasskey1234567890', MPESA_TRANSACTION_TYPE: 'CustomerPayBillOnline',
  PUBLIC_API_URL: 'https://api.example.test', MPESA_CALLBACK_URL: '', MPESA_CALLBACK_SECRET: '',
});
const mongoose = require('mongoose');
// emails the server queues: captured, nothing is sent
const mails = [];
const jobsModule = require('../utils/jobs');
const originalHandle = jobsModule.handle;
jobsModule.handle = (type, fn) => originalHandle(type, type === 'email' ? async (message) => { mails.push(message); } : fn);
const flushMail = async () => {
  for (let i = 0; i < 20; i++) {
    await require('../utils/jobs').work();
    if (!(await mongoose.connection.collection('jobs').countDocuments({ type: 'email', status: { $in: ['queued', 'running'] } }))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
let staffToken = '';
const adminApi = async (url) => {
  const res = await fetch(BASE + '/api' + url, { headers: { Authorization: `Bearer ${staffToken}`, 'X-Forwarded-For': '10.77.0.1' } });
  return { status: res.status, json: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------- Safaricom stand-in
const axios = require('axios');
const realGet = axios.get;
const realPost = axios.post;
const stk = []; // every STK push: { body, auth, url }
let nextId = 0;
let stkFails = null; // (body) => error message, to make Safaricom refuse a prompt
const queryReply = new Map(); // CheckoutRequestID → STK query answer
axios.get = async (url, cfg) => {
  if (!/\/oauth\/v1\/generate/.test(url)) return realGet(url, cfg);
  const [key] = Buffer.from(String(cfg.headers.Authorization).split(' ')[1], 'base64').toString().split(':');
  if (key.startsWith('bad')) throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } });
  return { data: { access_token: `token-for-${key}`, expires_in: '3599' } };
};
axios.post = async (url, body, cfg) => {
  if (/stkpush\/v1\/processrequest/.test(url)) {
    stk.push({ url, body, auth: cfg.headers.Authorization });
    const refused = stkFails?.(body);
    if (refused) throw Object.assign(new Error(refused), { response: { data: { errorMessage: refused } } });
    nextId += 1;
    return { data: { MerchantRequestID: `m-${nextId}`, CheckoutRequestID: `ws_CO_test_${nextId}`, ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' } };
  }
  if (/stkpushquery\/v1\/query/.test(url)) {
    const reply = queryReply.get(body.CheckoutRequestID);
    if (!reply) throw Object.assign(new Error('The transaction is being processed'), { response: { data: { errorMessage: 'The transaction is being processed' } } });
    return { data: reply };
  }
  return realPost(url, body, cfg);
};

// ---------------------------------------------------------------- helpers
const PASS = 'Kenya-Market-2026';
const api = async (method, url, body, who) => {
  const res = await fetch(BASE + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': who?.ip || '10.20.0.1', ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buffer.toString()); } catch { /* not JSON */ }
  return { status: res.status, json, buffer, type: res.headers.get('content-type') || '' };
};
const until = async (check, what) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};
const callbackKey = () => stk[0].body.CallBackURL.split('/').pop();
const callback = (key, cb) => fetch(`${BASE}/api/mpesa/callback/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Body: { stkCallback: cb } }) });
const paidCb = (id, receipt, amount) => ({ MerchantRequestID: 'm', CheckoutRequestID: id, ResultCode: 0, ResultDesc: 'The service request is processed successfully.', CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: receipt }, { Name: 'TransactionDate', Value: 20261115120000 }, { Name: 'PhoneNumber', Value: 254712000100 }] } });
const cancelledCb = (id) => ({ MerchantRequestID: 'm', CheckoutRequestID: id, ResultCode: 1032, ResultDesc: 'Request cancelled by user' });

let Customer;
let Order;
let Listing;
const people = {};
let ipCount = 0;
async function person(key, { phone, seller, pay }) {
  const email = `${key}.split@example.test`;
  assert.equal((await api('POST', '/customers/register', { name: `${key[0].toUpperCase()}${key.slice(1)} Tester`, email, phone, password: PASS, confirmPassword: PASS, accountType: seller ? 'seller' : 'buyer', ...(seller ? { payDetails: { method: 'till', till: '512345', name: 'Test Shop' } } : {}), ...(seller ? { sellerTypes: ['shop'], sellerCategories: ['electronics'], location: { county: 'Nairobi', area: 'CBD' } } : {}) })).status, 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const login = await api('POST', '/customers/login', { login: email, password: PASS });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  ipCount += 1;
  people[key] = { token: login.json.token, id: login.json.customer._id, ip: `10.20.${ipCount}.1`, email };
  if (pay) assert.equal((await api('PUT', '/customers/me', { payDetails: pay }, people[key])).status, 200);
  return people[key];
}
const ads = {};
let slugN = 0;
async function ad(key, sellerKey, price, deliveryFee = 0) {
  slugN += 1;
  const listing = await Listing.create({
    title: `${key} test item ${slugN}`, slug: `split-test-${key}-${slugN}`, category: 'electronics', sub: 'phones', county: 'Nairobi', area: 'CBD', price, seller: people[sellerKey].id, sellerName: `${sellerKey} shop`,
    status: 'active', buyNow: true, stock: 50, condition: 'New', delivery: { available: true, fee: deliveryFee, pickup: true }, images: [],
  });
  ads[key] = String(listing._id);
}
// verify: the buyer ticks “verify my goods” (KSh 200 to us, the fee prompt these tests follow); without it there's no fee
const checkout = (items, who = people.buyer, method = 'mpesa', verify = method === 'mpesa') => api('POST', '/orders/checkout', { items: items.map(([key, qty]) => ({ listingId: ads[key], qty })), delivery: { method: 'pickup' }, payment: { method, phone: '0712000100' }, ...(verify ? { inspection: { wanted: true } } : {}) }, who);

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  require('../server');
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && mongoose.connection.readyState === 1) break; } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  Customer = require('../models/Customer');
  Order = require('../models/Order');
  Listing = require('../models/Listing');
  await Order.syncIndexes();
  await person('buyer', { phone: '0712000100' });
  await person('outsider', { phone: '0712000101' });
  await person('amina', { phone: '0712000201', seller: true, pay: { method: 'till', till: '512345', name: 'Amina Electronics' } });
  await person('baraka', { phone: '0712000202', seller: true, pay: { method: 'paybill', paybill: '400200', account: 'BARAKA01', name: 'Baraka Traders' } });
  await person('chebet', { phone: '0712000203', seller: true, pay: { method: 'pochi', phone: '0712000203', name: 'Chebet Mama Mboga' } });
  await person('dan', { phone: '0712000204', seller: true }); // no M-Pesa details
  await person('eve', { phone: '0712000205', seller: true, pay: { method: 'pochi', phone: '0712000205', name: 'Eve Fruits' } }); // no shop on the map
  // shops on the map (our agent goes there to verify)
  const shop = (lng, lat, name) => ({ name, address: 'Moi Avenue', area: 'CBD', county: 'Nairobi', point: { type: 'Point', coordinates: [lng, lat] } });
  await Customer.updateOne({ _id: people.amina.id }, { $set: { shopLocation: shop(36.8219, -1.2864, 'Amina Electronics') } });
  await Customer.updateOne({ _id: people.baraka.id }, { $set: { shopLocation: shop(36.8250, -1.2830, 'Baraka Traders') } });
  await Customer.updateOne({ _id: people.chebet.id }, { $set: { shopLocation: shop(36.8190, -1.2900, 'Chebet Mama Mboga') } });
  await person('agent', { phone: '0712000301' });
  await ad('a', 'amina', 1200);
  await ad('b', 'baraka', 800);
  await ad('c', 'chebet', 350);
  await ad('d', 'dan', 500);
  await ad('e', 'eve', 300);
  // the same sellers' ads with their own delivery fees (the several-sellers checkout)
  await ad('da', 'amina', 1200, 200);
  await ad('db', 'baraka', 800, 100);
  await ad('dc', 'chebet', 350, 0);
  // our team: an admin (to find orders by payment ID) and the orders inbox for new-order emails
  const User = require('../models/User');
  await User.create({ name: 'Boss', email: 'boss@splitpay.test', password: 'Admin-pass-2026', role: 'admin' });
  const gate = await require('../middleware/staffGate').loadGate();
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Gate': gate, 'X-Forwarded-For': '10.77.0.2' }, body: JSON.stringify({ email: 'boss@splitpay.test', password: 'Admin-pass-2026' }) });
  staffToken = (await login.json()).token;
  await mongoose.connection.collection('sitesettings').updateOne({ key: 'site' }, { $set: { email: 'orders@kapu.test' } }, { upsert: true });
  await require('../config/site').loadSite();
});
after(async () => {
  axios.get = realGet;
  axios.post = realPost;
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

const KEYS = (prefix, shortcode) => ({ shortcode, consumerKey: `${prefix}ConsumerKey12345`, consumerSecret: `${prefix}ConsumerSecret12345`, passkey: `${prefix}Passkey0123456789abcdef`, env: 'sandbox', password: PASS });

// ---------------------------------------------------------------- sellers connect their own M-Pesa
test('a seller connects their own Daraja keys: password needed, keys checked with Safaricom, stored encrypted, never shown', async () => {
  const { amina, baraka, chebet } = people;
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', KEYS('amina', '174379'))).status, 401, 'needs a login');
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', { ...KEYS('amina', '174379'), password: 'wrong-password' }, amina)).status, 403, 'wrong password');
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', { ...KEYS('bad', '174379') }, amina)).status, 400, 'Safaricom refuses the keys');
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', { ...KEYS('amina', '12') }, amina)).status, 400, 'shortcode shape');
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', { ...KEYS('amina', '174379'), passkey: '<script>' }, amina)).status, 400, 'odd characters in a key');
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', KEYS('chebet', '174379'), chebet)).status, 400, 'Pochi la Biashara has no M-Pesa prompt');
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', KEYS('baraka', '999999'), baraka)).status, 400, 'Paybill keys must be for that Paybill');

  const ok = await api('PUT', '/customers/me/mpesa-connect', KEYS('amina', '174379'), amina);
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.json.payConnect).sort(), ['connected', 'connectedAt', 'env', 'shortcode']);
  assert.equal((await api('PUT', '/customers/me/mpesa-connect', KEYS('baraka', '400200'), baraka)).status, 200);

  const raw = await mongoose.connection.collection('customers').findOne({ email: amina.email });
  const stored = JSON.stringify(raw.payKeys);
  assert.ok(!stored.includes('aminaConsumerKey12345') && !stored.includes('aminaConsumerSecret12345') && !stored.includes('aminaPasskey'), 'no key in plain text');
  assert.match(raw.payKeys.passkey, /^v1\./);
  const me = await api('GET', '/customers/me', undefined, amina);
  const text = JSON.stringify(me.json);
  assert.ok(!/aminaConsumer|aminaPasskey|payKeys/.test(text), 'never sent back');
  assert.equal(me.json.customer?.payConnect?.connected ?? me.json.payConnect?.connected, true);
});

// ---------------------------------------------------------------- when it applies
const OURS = '174379';
const lastOurs = () => [...stk].reverse().find((call) => call.body.PartyB === OURS && call.body.BusinessShortCode === OURS);
const idOf = (call) => `ws_CO_test_${stk.indexOf(call) + 1 + stkOffset}`;
let stkOffset = 0; // CheckoutRequestIDs count every prompt ever sent; stk[] is cleared per test
let round = 0;
let split = {}; // what the scenarios share
// each test: a fresh prompt list, and a fresh buyer IP (the real payment rate limit is 10 tries per 10 minutes)
const resetStk = () => { stkOffset = nextId; stk.length = 0; round += 1; people.buyer.ip = `10.30.${round}.1`; };
// pay our verification fee (the first prompt of a split checkout)
async function payFee(checkoutId, receipt, amount) {
  const call = lastOurs();
  assert.ok(call, 'the fee prompt was sent');
  await callback(callbackKey(), paidCb(idOf(call), receipt, amount ?? call.body.Amount));
  await until(async () => (await Order.find({ checkoutId })).every((order) => order.payment.fee?.status === 'paid'), 'fee paid');
}

// ---------------------------------------------------------------- who is paid
// ONE seller, M-Pesa: straight to that seller (Till / Paybill / Pochi), plus our verification fee
// SEVERAL sellers, M-Pesa: one payment to the Kapu wallet for the goods AND the delivery fees
// either way: a payment ID once it's paid, and the order goes to the buyer and to our team
const team = () => mails.filter((mail) => mail.to === 'orders@kapu.test');

test('several sellers: ONE M-Pesa payment to the Kapu wallet for goods + delivery fees; one payment ID; our team is told', async () => {
  resetStk();
  mails.length = 0;
  const res = await api('POST', '/orders/checkout', { items: [{ listingId: ads.da, qty: 2 }, { listingId: ads.db, qty: 1 }, { listingId: ads.dc, qty: 1 }], delivery: { method: 'delivery', county: 'Nairobi', address: 'Kilimani, Argwings Kodhek Rd, House 12' }, payment: { method: 'mpesa', phone: '0712000100' } }, people.buyer);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.ok(!res.json.payment.split, 'not paid to the sellers directly');
  // goods 2×1200 + 800 + 350 = 3550; delivery 200 (Amina) + 100 (Baraka) + 0 (Chebet) = 300
  assert.equal(stk.length, 1, 'one prompt for everything');
  assert.deepEqual([stk[0].body.PartyB, stk[0].body.Amount, stk[0].auth], [OURS, 3850, 'Bearer token-for-kapuKey123']);
  const orders = await Order.find({ checkoutId: res.json.checkoutId }).sort({ sellerName: 1 });
  assert.deepEqual(orders.map((order) => [order.sellerName, order.deliveryFee, order.payOnDelivery, order.payment.direct || false, order.inspection?.fee || 0]), [['amina shop', 200, 0, false, 0], ['baraka shop', 100, 0, false, 0], ['chebet shop', 0, 0, false, 0]], 'delivery paid upfront, nothing on delivery, no extra fee');
  assert.ok(orders.every((order) => !order.payment.ref), 'no payment ID before paying');

  await callback(callbackKey(), paidCb(idOf(stk[0]), 'SKW1WALLET', 3850));
  await until(async () => (await Order.find({ checkoutId: res.json.checkoutId })).every((order) => order.status === 'placed'), 'all placed');
  const paid = await Order.find({ checkoutId: res.json.checkoutId });
  const refs = new Set(paid.map((order) => order.payment.ref));
  assert.equal(refs.size, 1, 'one payment, one payment ID for all its orders');
  const ref = [...refs][0];
  assert.match(ref, /^PAY-[A-HJ-NP-Z2-9]{8}$/);
  assert.ok(paid.every((order) => order.payment.receipt === 'SKW1WALLET'));
  // the buyer sees it on their orders; our team finds the orders by it (and by the M-Pesa code)
  const mine = await api('GET', `/orders/${paid[0]._id}`, undefined, people.buyer);
  assert.equal(mine.json.payment.ref, ref);
  const admin = await adminApi(`/orders/admin/list?q=${ref}`);
  assert.equal(admin.json.orders.length, 3, 'admin search by payment ID');
  assert.equal((await adminApi('/orders/admin/list?q=skw1wallet')).json.orders.length, 3, 'and by M-Pesa code');
  // emails: the buyer (payment received, with the payment ID) and ONE email to our team for the whole payment
  await flushMail();
  // (demo .test addresses are never emailed: check the buyer's email was triggered and carries the payment ID)
  const buyerCopy = await Order.findById(paid[0]._id).lean();
  assert.equal(buyerCopy.emailsSent?.paid, true, 'the buyer’s payment-received email went out');
  assert.match(require('../utils/emailTemplates').paymentReceived(buyerCopy).text, new RegExp(`Payment ID: ${ref}`));
  assert.equal(team().length, 1, 'one email to our team for the payment');
  assert.match(team()[0].subject, new RegExp(`New paid order ${ref}: KSh 3,850`));
  for (const name of ['amina shop', 'baraka shop', 'chebet shop']) assert.ok(team()[0].html.includes(name), `team email lists ${name}`);
  split = { wallet: res.json.checkoutId, ref };
});

test('several sellers: the rider doesn’t collect the delivery fee again in cash (it was paid to the wallet)', async () => {
  const order = await Order.findOne({ checkoutId: split.wallet, sellerName: 'amina shop' });
  const { split: money } = require('../market/payouts');
  // the rule the rider's job uses: paid upfront → nothing to collect
  const prepaid = order.payment?.method === 'mpesa' && !order.payOnDelivery && order.payment.status === 'paid';
  assert.equal(prepaid, true);
  assert.equal(money(order.deliveryFee || 0, prepaid ? 0 : order.deliveryFee).toPay > 0, true, 'we pay the rider out instead');
});

test('one seller, M-Pesa: our verification fee first, then a prompt that pays the seller’s Till directly; then a payment ID', async () => {
  resetStk();
  mails.length = 0;
  const res = await checkout([['a', 2]]);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const payment = res.json.payment;
  assert.equal(payment.split, true, 'paid straight to the seller');
  assert.equal(payment.sellers, 1);
  assert.deepEqual([payment.fee.amount, payment.fee.state, payment.parts[0].amount, payment.parts[0].to.till, payment.parts[0].channel], [200, 'prompted', 2400, '512345', 'stk']);
  assert.equal(stk.length, 1);
  assert.deepEqual([stk[0].body.PartyB, stk[0].body.Amount], [OURS, 200], 'the fee prompt (to Kapu)');
  const order = await Order.findOne({ checkoutId: res.json.checkoutId });
  assert.deepEqual([order.inspection.fee, order.inspection.pay, order.commission], [200, 170, 0]);

  await payFee(res.json.checkoutId, 'SKF1FEEPD1');
  await until(() => stk.length === 2, 'Amina’s prompt');
  const toSeller = stk[1];
  assert.equal(toSeller.auth, 'Bearer token-for-aminaConsumerKey12345', 'Amina’s own Daraja app');
  assert.deepEqual([toSeller.body.BusinessShortCode, toSeller.body.PartyB, toSeller.body.TransactionType, toSeller.body.Amount], ['174379', '512345', 'CustomerBuyGoodsOnline', 2400]);
  assert.equal(toSeller.body.Password, Buffer.from(`174379aminaPasskey0123456789abcdef${toSeller.body.Timestamp}`).toString('base64'), 'signed with Amina’s passkey');
  assert.ok(!(await Order.findById(order._id)).payment.ref, 'no payment ID until the seller is paid');
  await callback(callbackKey(), paidCb(idOf(toSeller), 'SKA1AMINA1', 2400));
  await until(async () => (await Order.findById(order._id)).status === 'placed', 'placed');
  const done = await Order.findById(order._id);
  assert.match(done.payment.ref, /^PAY-[A-HJ-NP-Z2-9]{8}$/);
  assert.notEqual(done.payment.ref, split.ref, 'a new payment, a new ID');
  assert.deepEqual([done.payment.receipt, done.payment.fee.receipt], ['SKA1AMINA1', 'SKF1FEEPD1']);
  const status = await api('GET', `/orders/checkout/${res.json.checkoutId}`, undefined, people.buyer);
  assert.deepEqual([status.json.status, status.json.parts[0].ref], ['paid', done.payment.ref]);
  await flushMail();
  assert.equal(team().length, 1);
  assert.match(team()[0].subject, new RegExp(`New paid order ${done.payment.ref}: KSh 2,600`), 'KSh 2,400 to the seller + KSh 200 to us');
  assert.match(team()[0].html, /KSh 2,400 straight to <b>amina shop<\/b> and KSh 200 to Kapu/);
  split.amina = { id: res.json.checkoutId, orderId: String(order._id) };
});

test('no inspection asked for: no fee at all; a seller with M-Pesa details is paid directly (even without a shop on the map), one without goes through our wallet', async () => {
  // seller e (eve): Pochi la Biashara, no shop on the map → paid straight to her, no verification fee
  resetStk();
  const direct = await checkout([['e', 1]], people.buyer, 'mpesa', false);
  assert.equal(direct.status, 201, JSON.stringify(direct.json));
  assert.ok(direct.json.payment.split, 'paid straight to the seller');
  assert.equal(direct.json.payment.fee?.amount || 0, 0, 'no fee: the inspection is optional');
  const directOrder = await Order.findOne({ checkoutId: direct.json.checkoutId }).lean();
  assert.ok(!directOrder.inspection?.status && !directOrder.inspection?.fee, 'no inspection unless the buyer asks');
  // seller d (dan): no M-Pesa details (sellers give them at sign-up now, so they're taken away here) → our wallet, no fee
  await Customer.updateOne({ _id: people.dan.id }, { $unset: { payDetails: 1 } });
  resetStk();
  const wallet = await checkout([['d', 1]], people.buyer, 'mpesa', false);
  assert.equal(wallet.status, 201);
  assert.ok(!wallet.json.payment.split);
  assert.deepEqual([stk.length, stk[0].body.PartyB], [1, OURS]);
  assert.ok(!(await Order.findOne({ checkoutId: wallet.json.checkoutId })).inspection?.fee);
  // asking for an inspection of a seller without a shop on the map: refused (our agent couldn't find them)
  assert.equal((await checkout([['e', 1]], people.buyer, 'mpesa', true)).status, 400);
  // and an inspection is paid upfront: never with cash on delivery
  const cash = await api('POST', '/orders/checkout', { items: [{ listingId: ads.a, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'cod', phone: '0712000100' }, inspection: { wanted: true } }, people.buyer);
  assert.equal(cash.status, 400);
  assert.match(cash.json.message, /paid upfront/);
});

test('cash on delivery: no prompts, no fee (one seller or several)', async () => {
  for (const items of [[['a', 1]], [['a', 1], ['b', 1]]]) {
    resetStk();
    const res = await checkout(items, people.buyer, 'cod');
    assert.equal(res.status, 201);
    assert.ok(!res.json.payment.split);
    assert.equal(stk.length, 0);
  }
});

test('a forged “paid” callback (no secret key) is ignored', async () => {
  resetStk();
  const res = await checkout([['a', 1]]);
  const response = await fetch(`${BASE}/api/mpesa/callback/not-the-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Body: { stkCallback: paidCb(idOf(stk[0]), 'QAZ1234567', 150) } }) });
  assert.equal(response.status, 200, 'answered so Safaricom stops retrying');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await Order.findOne({ checkoutId: res.json.checkoutId })).payment.fee.status, 'pending');
});

test('one seller (Paybill): less money than asked is refused; a reused M-Pesa code is refused; a retry then pays', async () => {
  resetStk();
  const res = await checkout([['b', 1]]);
  const orderId = res.json.payment.parts[0].orderId;
  await payFee(res.json.checkoutId, 'SKF2FEEPD2');
  await until(() => stk.length === 2, 'Baraka’s prompt');
  assert.deepEqual([stk[1].body.BusinessShortCode, stk[1].body.PartyB, stk[1].body.TransactionType, stk[1].body.AccountReference, stk[1].body.Amount], ['400200', '400200', 'CustomerPayBillOnline', 'BARAKA01', 800]);
  await callback(callbackKey(), paidCb(idOf(stk[1]), 'SKB1BARAK1', 500));
  await until(async () => (await Order.findById(orderId)).payment.status === 'failed', 'short payment refused');
  assert.match((await Order.findById(orderId)).payment.failReason, /KSh 500 instead of KSh 800/);
  assert.ok(await mongoose.connection.collection('auditlogs').countDocuments({ action: 'mpesa.amount_mismatch' }) >= 1, 'audited');
  assert.equal((await api('POST', `/orders/checkout/${res.json.checkoutId}/pay`, { orderId, phone: '0712000100' }, people.buyer)).status, 200);
  await until(() => stk.length === 3, 'a new prompt');
  await callback(callbackKey(), paidCb(idOf(stk[2]), 'SKA1AMINA1', 800)); // Amina's code from the earlier test
  await until(async () => /already used/.test((await Order.findById(orderId)).payment.failReason || ''), 'reused code refused');
  await api('POST', `/orders/checkout/${res.json.checkoutId}/pay`, { orderId }, people.buyer);
  await until(() => stk.length === 4, 'again');
  await callback(callbackKey(), paidCb(idOf(stk[3]), 'SKB2BARAK2', 800));
  await until(async () => (await Order.findById(orderId)).status === 'placed', 'Baraka paid');
  const done = await Order.findById(orderId);
  assert.equal(done.payment.receipt, 'SKB2BARAK2');
  assert.match(done.payment.ref, /^PAY-/);
});

test('one seller (Pochi): “pay from your phone”; buyer’s and seller’s M-Pesa codes compared, never shown to the other side', async () => {
  resetStk();
  const res = await checkout([['c', 3]]);
  const cId = res.json.payment.parts[0].orderId;
  assert.deepEqual([res.json.payment.parts[0].channel, res.json.payment.parts[0].amount], ['manual', 1050]);
  const claim = (code, who = people.buyer) => api('POST', `/orders/checkout/${res.json.checkoutId}/code`, { orderId: cId, code }, who);
  const sellerCode = (body, who = people.chebet) => api('POST', `/orders/${cId}/payment`, body, who);
  const early = await claim('SKE1EARLY1');
  assert.equal(early.status, 409, 'our fee first');
  await payFee(res.json.checkoutId, 'SKF3FEEPD3');
  assert.equal((await claim('123')).status, 400, 'not an M-Pesa code');
  assert.equal((await claim('SKB2BARAK2')).status, 409, 'Baraka’s code can’t pay Chebet');
  assert.equal((await claim('SKC1CHEBE1', people.outsider)).status, 404, 'someone else’s checkout');
  const sent = await claim('skc1 chebex'); // the buyer mistyped the last letter
  assert.deepEqual([sent.status, sent.json.outcome, sent.json.parts[0].state], [200, 'waiting', 'claimed']);
  const sales = await api('GET', '/orders/sales?status=payment', undefined, people.chebet);
  assert.ok(sales.json.orders.some((order) => String(order._id) === String(cId) && order.payment.claimed === true));
  assert.ok(!JSON.stringify(sales.json).includes('SKC1CHEBEX'), 'the seller never sees the buyer’s code');
  assert.equal((await sellerCode({ code: 'SKC1CHEBE1' }, people.amina)).status, 404, 'only Chebet');
  assert.equal((await sellerCode({ code: 'SKC1CHEBE1' }, people.buyer)).status, 404);
  const mismatch = await sellerCode({ code: 'SKC1CHEBE1' });
  assert.equal(mismatch.json.outcome, 'mismatch');
  const buyerView = await api('GET', `/orders/checkout/${res.json.checkoutId}`, undefined, people.buyer);
  assert.deepEqual([buyerView.json.parts[0].state, buyerView.json.status], ['mismatch', 'pending']);
  assert.ok(!JSON.stringify(buyerView.json).includes('SKC1CHEBE1'), 'the buyer never sees the seller’s code');
  const fixed = await claim('SKC1CHEBE1');
  assert.equal(fixed.json.outcome, 'matched');
  const c = await Order.findById(cId);
  assert.deepEqual([c.payment.status, c.payment.receipt, c.status], ['paid', 'SKC1CHEBE1', 'placed']);
  assert.match(c.payment.ref, /^PAY-/, 'a payment ID once the codes match');
  assert.equal((await sellerCode({ code: 'SKC1CHEBE1' })).status, 400, 'nothing left to confirm');
  // the seller may also enter their code first
  resetStk();
  const again = await checkout([['c', 1]]);
  await payFee(again.json.checkoutId, 'SKF4FEEPD4');
  const id2 = again.json.payment.parts[0].orderId;
  assert.equal((await api('POST', `/orders/${id2}/payment`, { code: 'SKS1SELLR1' }, people.chebet)).json.outcome, 'waiting');
  assert.equal((await api('POST', `/orders/checkout/${again.json.checkoutId}/code`, { orderId: id2, code: 'SKS1SELLR1' }, people.buyer)).json.outcome, 'matched');
});

test('receipts: the wallet checkout and the direct one each show their payment ID, amounts and M-Pesa codes', async () => {
  const hex = (text) => Buffer.from(text, 'latin1').toString('hex');
  const wallet = await api('GET', `/orders/checkout/${split.wallet}/receipt.pdf`, undefined, people.buyer);
  assert.equal(wallet.status, 200);
  assert.match(wallet.type, /application\/pdf/);
  for (const piece of ['amina shop', 'baraka shop', 'chebet shop', 'SKW1WALLET', 'KSh 3,550', 'KSh 3,850', split.ref]) assert.ok(wallet.buffer.toString('latin1').includes(hex(piece)), `wallet receipt shows ${piece}`);
  const direct = await api('GET', `/orders/${split.amina.orderId}/receipt.pdf`, undefined, people.buyer);
  const ref = (await Order.findById(split.amina.orderId)).payment.ref;
  for (const piece of [ref, 'SKA1AMINA1', 'Till 512345']) assert.ok(direct.buffer.toString('latin1').includes(hex(piece)), `order receipt shows ${piece}`);
  assert.equal((await api('GET', `/orders/checkout/${split.wallet}/receipt.pdf`, undefined, people.outsider)).status, 404, 'only the buyer');
});

test('agent side (direct payment): the seller confirms → an inspection job worth the KSh 200 opens; no Kapu payout to the seller', async () => {
  const id = split.amina.orderId;
  assert.equal((await api('POST', `/orders/${id}/status`, { status: 'confirmed' }, people.amina)).status, 200);
  const job = await require('../models/Task').findOne({ order: id, kind: 'inspection' }).lean();
  assert.ok(job, 'inspection job opened');
  assert.deepEqual([job.fee, job.pay], [200, 170]);
  assert.equal((await api('POST', `/orders/${id}/status`, { status: 'shipped' }, people.amina)).status, 409, 'waits for our agent');
  await Order.updateOne({ _id: id }, { $set: { 'inspection.status': 'passed' } });
  assert.equal((await api('POST', `/orders/${id}/status`, { status: 'shipped' }, people.amina)).status, 200);
  assert.equal((await api('POST', `/orders/${id}/status`, { status: 'delivered' }, people.buyer)).status, 200);
  assert.notEqual((await Order.findById(id)).payout?.status, 'due', 'the seller already has the money');
});

test('our fee prompt cancelled: the seller isn’t prompted until it’s paid; “try again” resends it', async () => {
  resetStk();
  const res = await checkout([['a', 1]]);
  await callback(callbackKey(), cancelledCb(idOf(lastOurs())));
  await until(async () => (await Order.findOne({ checkoutId: res.json.checkoutId })).payment.fee.status === 'failed', 'fee failed');
  assert.equal((await api('GET', `/orders/checkout/${res.json.checkoutId}`, undefined, people.buyer)).json.fee.state, 'failed');
  assert.equal(stk.length, 1, 'no seller prompt');
  assert.equal((await api('POST', `/orders/checkout/${res.json.checkoutId}/pay`, { fee: true }, people.buyer)).status, 200);
  assert.deepEqual([stk.length, stk[1].body.PartyB, stk[1].body.Amount], [2, OURS, 200]);
  await payFee(res.json.checkoutId, 'SKF5FEEPD5');
  await until(() => stk.length === 3 && stk[2].body.PartyB === '512345', 'then Amina');
});

test('a cancelled seller prompt: the buyer can try again; a late “paid” for it still counts', async () => {
  resetStk();
  const res = await checkout([['a', 1]]);
  const orderId = res.json.payment.parts[0].orderId;
  await payFee(res.json.checkoutId, 'SKF6FEEPD6');
  await until(() => stk.length === 2, 'Amina’s prompt');
  const aId = idOf(stk[1]);
  await callback(callbackKey(), cancelledCb(aId));
  await until(async () => (await Order.findById(orderId)).payment.status === 'failed', 'cancelled');
  assert.equal((await api('GET', `/orders/checkout/${res.json.checkoutId}`, undefined, people.buyer)).json.status, 'failed');
  await callback(callbackKey(), paidCb(aId, 'SKL1LATEA1', 1200)); // they had paid just after cancelling
  await until(async () => (await Order.findById(orderId)).status === 'placed', 'late payment counted');
  assert.match((await Order.findById(orderId)).payment.ref, /^PAY-/);
});

test('no callback (a laptop): after 8 s we ask Safaricom; an unanswered prompt times out; 8 polls at once send nothing twice', async () => {
  resetStk();
  const res = await checkout([['a', 1]]);
  const orderId = res.json.payment.parts[0].orderId;
  await payFee(res.json.checkoutId, 'SKF7FEEPD7');
  await until(() => stk.length === 2, 'Amina’s prompt');
  await Order.updateOne({ _id: orderId }, { $set: { 'payment.promptedAt': new Date(Date.now() - 10000) } });
  queryReply.set(idOf(stk[1]), { ResponseCode: '0', ResultCode: '0', ResultDesc: 'The service request is processed successfully.', MpesaReceiptNumber: 'SKQ1QUERY1' });
  const polled = await api('GET', `/orders/checkout/${res.json.checkoutId}`, undefined, people.buyer);
  assert.deepEqual([polled.json.parts[0].state, polled.json.parts[0].receipt], ['paid', 'SKQ1QUERY1']);

  resetStk();
  const slow = await checkout([['a', 1]]);
  await Order.updateOne({ checkoutId: slow.json.checkoutId }, { $set: { 'payment.fee.promptedAt': new Date(Date.now() - 3 * 60 * 1000) } });
  const polls = await Promise.all(Array.from({ length: 8 }, () => api('GET', `/orders/checkout/${slow.json.checkoutId}`, undefined, people.buyer)));
  assert.ok(polls.every((poll) => poll.status === 200));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(stk.length, 1, 'no second prompt');
  const order = await Order.findOne({ checkoutId: slow.json.checkoutId });
  assert.equal(order.payment.fee.status, 'failed');
  assert.match(order.payment.fee.failReason, /timed out/);
});

test('Safaricom refuses the seller’s prompt: the buyer can pay from the M-Pesa menu instead', async () => {
  resetStk();
  stkFails = (body) => (body.PartyB === '512345' ? 'Invalid BusinessShortCode' : null);
  const res = await checkout([['a', 1]]);
  await payFee(res.json.checkoutId, 'SKF8FEEPD8');
  await until(async () => (await Order.findOne({ checkoutId: res.json.checkoutId })).payment.status === 'failed', 'refused');
  stkFails = null;
  const part = (await api('GET', `/orders/checkout/${res.json.checkoutId}`, undefined, people.buyer)).json.parts[0];
  assert.match(part.failReason, /couldn’t be sent/);
  const claim = await api('POST', `/orders/checkout/${res.json.checkoutId}/code`, { orderId: part.orderId, code: 'SKH1HANDA1' }, people.buyer);
  assert.deepEqual([claim.status, claim.json.parts[0].state], [200, 'claimed']);
});

test('cash on delivery before paying: the KSh 200 inspection is dropped (it’s paid upfront only)', async () => {
  resetStk();
  const res = await checkout([['a', 1]]);
  assert.equal((await api('POST', `/orders/checkout/${res.json.checkoutId}/cod`, undefined, people.buyer)).status, 200);
  const order = await Order.findOne({ checkoutId: res.json.checkoutId });
  assert.deepEqual([order.payment.status, order.total, order.inspection?.fee ?? null, order.payment.fee.status], ['cod', 1200, null, 'none']);
});

test('a seller who disconnects: buyers then pay them from the M-Pesa menu (no prompt with old keys)', async () => {
  assert.equal((await api('DELETE', '/customers/me/mpesa-connect', undefined, people.baraka)).status, 200);
  assert.equal((await mongoose.connection.collection('customers').findOne({ email: people.baraka.email })).payKeys, undefined);
  resetStk();
  const res = await checkout([['b', 1]]);
  assert.equal(res.json.payment.parts[0].channel, 'manual');
  await payFee(res.json.checkoutId, 'SKF9FEEPD9');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(stk.length, 1, 'only our fee prompt; no prompt to Baraka');
});

// ---------------------------------------------------------------- 🔍 "Inspect my goods" / "Don't inspect" at the checkout
test('checkout: “Don’t inspect” charges only the items; “Inspect my goods” adds exactly KSh 200; tampering is refused', async () => {
  const price = (await Listing.findById(ads.a).lean()).price;
  const place = (inspection) => api('POST', '/orders/checkout', { items: [{ listingId: ads.a, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'mpesa', phone: '0712000100' }, ...(inspection === undefined ? {} : { inspection }) }, people.buyer);
  const orderOf = async (res) => Order.findOne({ checkoutId: res.json.checkoutId }).lean();

  // “Don't inspect”: the items only, no inspection, no fee prompt; the choice is recorded
  resetStk();
  const none = await place({ choice: 'none' });
  assert.equal(none.status, 201, JSON.stringify(none.json));
  const noneOrder = await orderOf(none);
  assert.equal(noneOrder.total, price, 'only the cost of the items');
  assert.ok(!noneOrder.inspection?.fee && !noneOrder.inspection?.status, 'no inspection on the order');
  assert.equal(noneOrder.inspectionChoice, 'none');
  assert.ok(noneOrder.inspectionChoiceAt);
  assert.ok(!(noneOrder.payment.fee?.amount > 0), 'no inspection fee to pay');

  // “Inspect my goods”: the same items + KSh 200, decided by the server
  resetStk();
  const yes = await place({ choice: 'inspect', notes: 'size 42, black' });
  assert.equal(yes.status, 201, JSON.stringify(yes.json));
  const yesOrder = await orderOf(yes);
  assert.equal(yesOrder.total, price + 200);
  assert.deepEqual([yesOrder.inspection.fee, yesOrder.inspectionChoice, yesOrder.inspection.notes.startsWith('size 42, black')], [200, 'inspect', true]);

  // a fee sent by the app is ignored: the choice decides, the amount is fixed
  resetStk();
  const cheap = await place({ choice: 'inspect', fee: 1, amount: 1 });
  assert.equal((await orderOf(cheap)).inspection.fee, 200);
  resetStk();
  const sneaky = await place({ choice: 'none', fee: 200 });
  assert.ok(!(await orderOf(sneaky)).inspection?.fee, '“Don’t inspect” stays free whatever else is sent');

  // ambiguous or made-up choices: refused, nothing created
  const before = await Order.countDocuments();
  for (const inspection of [{ choice: 'none', wanted: true }, { choice: 'INSPECT' }, { choice: 'yes' }, { choice: { $ne: 'none' } }, 'inspect', ['inspect']]) {
    resetStk();
    const res = await place(inspection);
    assert.equal(res.status, 400, `${JSON.stringify(inspection)} → ${res.status}`);
  }
  assert.equal(await Order.countDocuments(), before, 'no order was created');

  // no choice / older apps: never charged unless they really asked (a real true)
  for (const inspection of [undefined, {}, { wanted: 'true' }, { wanted: 1 }]) {
    resetStk();
    const res = await place(inspection);
    assert.equal(res.status, 201);
    const order = await orderOf(res);
    assert.deepEqual([order.total, order.inspectionChoice, !!order.inspection?.fee], [price, 'none', false], JSON.stringify(inspection));
  }
});
