// Shop & ride with real M-Pesa (not demo payments):   cd server && npm run test:shopride-mpesa
// Real server on a throw-away database; Safaricom (Daraja) is a stand-in that records every prompt and answers like the
// real API. Results arrive through the real callback address with its secret key, or through the status check.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5193;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_shopride_mpesa_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 'm'.repeat(48), AUTH_RATE_LIMIT: '400',
  MPESA_ENV: 'sandbox', MPESA_CONSUMER_KEY: 'kapuKey123', MPESA_CONSUMER_SECRET: 'kapuSecret123', MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'kapuPasskey1234567890', MPESA_TRANSACTION_TYPE: 'CustomerPayBillOnline',
  PUBLIC_API_URL: 'https://api.example.test', MPESA_CALLBACK_URL: '', MPESA_CALLBACK_SECRET: '',
});
const mongoose = require('mongoose');

// ---------------------------------------------------------------- Safaricom stand-in
const axios = require('axios');
const realGet = axios.get;
const realPost = axios.post;
const stk = [];
let nextId = 0;
const queryReply = new Map();
axios.get = async (url, cfg) => (/\/oauth\/v1\/generate/.test(url) ? { data: { access_token: 'sandbox-token', expires_in: '3599' } } : realGet(url, cfg));
axios.post = async (url, body, cfg) => {
  if (/stkpush\/v1\/processrequest/.test(url)) {
    nextId += 1;
    const id = `ws_CO_ride_${nextId}`;
    stk.push({ body, id });
    return { data: { MerchantRequestID: `m-${nextId}`, CheckoutRequestID: id, ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' } };
  }
  if (/stkpushquery\/v1\/query/.test(url)) {
    const reply = queryReply.get(body.CheckoutRequestID);
    if (!reply) throw Object.assign(new Error('The transaction is being processed'), { response: { data: { errorMessage: 'The transaction is being processed' } } });
    return { data: reply };
  }
  return realPost(url, body, cfg);
};
const callback = (cb, key = stk[0].body.CallBackURL.split('/').pop()) => fetch(`${BASE}/api/mpesa/callback/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Body: { stkCallback: cb } }) });
const paidCb = (id, receipt, amount) => ({ MerchantRequestID: 'm', CheckoutRequestID: id, ResultCode: 0, ResultDesc: 'The service request is processed successfully.', CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: receipt }, { Name: 'PhoneNumber', Value: 254712000100 }] } });
const cancelledCb = (id) => ({ MerchantRequestID: 'm', CheckoutRequestID: id, ResultCode: 1032, ResultDesc: 'Request cancelled by user' });

// ---------------------------------------------------------------- helpers
const PASS = 'Kenya-Market-2026';
let ipN = 0;
const api = async (method, url, body, who) => {
  ipN += 1;
  const res = await fetch(BASE + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': who?.ip || `10.60.${Math.floor(ipN / 250)}.${ipN % 250}`, ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const until = async (check, what) => {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.fail(`timed out waiting for ${what}`);
};
let Customer;
let Errand;
let points;
const area = (name) => points.find((item) => item.area === name);
async function person(n, extra = {}) {
  const email = `p${n}@ridempesa.test`;
  assert.equal((await api('POST', '/customers/register', { name: `Person ${n} Tester`, email, phone: `07140${String(n).padStart(5, '0')}`, password: PASS, confirmPassword: PASS })).status, 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true, ...extra } });
  const login = await api('POST', '/customers/login', { login: email, password: PASS });
  return { token: login.json.token, id: login.json.customer._id, ip: `10.61.${n}.1` };
}
let buyer;
let agent;
// our agent takes a seller's job and inspects it (through the agent's API, as their app does)
async function inspect(errandId, passed = true) {
  const Task = require('../models/Task');
  const errand = await Errand.findById(errandId);
  await Task.updateOne({ _id: errand.task }, { $set: { worker: agent.id, workerName: 'Otieno', status: 'assigned', acceptedAt: new Date() } });
  await require('../controllers/errandController').onTask(await Task.findById(errand.task), 'assigned', {});
  const res = await api('POST', `/work/tasks/${errand.task}/inspect`, { checks: { rightItem: true, size: true, colour: true, quality: passed }, note: passed ? '' : 'Torn' }, agent);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return errand.task;
}

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
  Errand = require('../models/Errand');
  points = (await api('GET', '/errands/pickup-points')).json.points;
  buyer = await person(1);
  agent = await person(2, { worker: { role: 'agent', status: 'approved', approvedAt: new Date() } });
});
after(async () => {
  axios.get = realGet;
  axios.post = realPost;
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

const SELLERS = () => [
  { items: [{ name: 'School shoes black', qty: 2, price: 1500 }, { name: 'Sandals', qty: 1, price: 800 }], sellerPhone: '0722300400', sellerName: 'Njeri Shoes', fromArea: area('CBD')._id, address: 'Kamukunji market', stall: 'Stall 14', weightKg: 3, inspect: true },
  { items: [{ name: 'Unga 2kg bale', qty: 1, price: 1800 }], sellerPhone: '0711222333', sellerName: 'Mama Akinyi', fromArea: area('Eastleigh')._id, address: 'First Avenue, shop 3', weightKg: 4, inspect: true },
];

let booking;
test('several items from one seller: their total is the goods; the agent sees each item with its quantity and price', async () => {
  const quote = await api('POST', '/errands/shopride/quote', { sellers: SELLERS(), mode: 'point', pointId: area('Kasarani')._id });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));
  assert.deepEqual(quote.json.parts.map((part) => part.goods), [3800, 1800], '2 × 1,500 + 800 = 3,800');
  assert.deepEqual(quote.json.schedule, { now: 400, afterInspection: 3800 + 1800 + 150 + 250, onDelivery: 0 });
  const res = await api('POST', '/errands', { kind: 'shopride', sellers: SELLERS(), mode: 'point', pointId: area('Kasarani')._id, phone: '0712000100' }, buyer);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  booking = res.json;
  const both = await Errand.find({ group: booking.group.id }).sort({ _id: 1 });
  assert.equal(both[0].shopride.what, '2 × School shoes black, Sandals');
  assert.deepEqual(both[0].shopride.items.map((item) => [item.name, item.qty, item.price]), [['School shoes black', 2, 1500], ['Sandals', 1, 800]]);
  assert.deepEqual(both.map((errand) => errand.shopride.goods.amount), [3800, 1800]);
});

test('the booking: ONE real M-Pesa prompt for both inspections, to Kapu; the booking waits for it', async () => {
  assert.equal(stk.length, 1);
  assert.deepEqual([stk[0].body.PartyB, stk[0].body.BusinessShortCode, stk[0].body.Amount, stk[0].body.PartyA, stk[0].body.TransactionType], ['174379', '174379', 400, '254712000100', 'CustomerPayBillOnline']);
  assert.match(stk[0].body.AccountReference, /^ER\d{6}/);
  assert.match(stk[0].body.CallBackURL, /^https:\/\/api\.example\.test\/api\/mpesa\/callback\/[A-Za-z0-9_-]{20,}$/);
  const both = await Errand.find({ group: booking.group.id });
  assert.ok(both.every((errand) => errand.status === 'awaiting_payment' && errand.payment.status === 'pending' && errand.payment.checkoutRequestId === stk[0].id && !errand.task));
  const page = await api('GET', `/errands/${booking._id}`, undefined, buyer);
  assert.equal(page.json.dueNow, 400, 'the page shows the whole booking’s amount, not one seller’s');
});

test('a forged “paid” (no secret key) is ignored; a cancelled prompt fails the booking payment; “pay again” sends a new prompt', async () => {
  await callback(paidCb(stk[0].id, 'SKF1FORGED', 400), 'not-the-key');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await Errand.findById(booking._id)).payment.status, 'pending', 'forged result ignored');
  await callback(cancelledCb(stk[0].id));
  await until(async () => (await Errand.find({ group: booking.group.id })).every((errand) => errand.payment.status === 'failed'), 'both failed');
  assert.match((await Errand.findById(booking._id)).payment.failReason, /cancelled/i);
  // someone else can't pay again for it
  const stranger = await person(3);
  assert.equal((await api('POST', `/errands/${booking._id}/pay`, {}, stranger)).status, 404);
  const again = await api('POST', `/errands/${booking._id}/pay`, { phone: '0712 999 888' }, buyer);
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(stk.length, 2);
  assert.deepEqual([stk[1].body.Amount, stk[1].body.PartyA], [400, '254712999888'], 'the whole booking, to the new number');
  // the prompt is on the phone: no second prompt for 90 seconds
  assert.equal((await api('POST', `/errands/${booking._id}/pay`, {}, buyer)).status, 409);
  assert.equal(stk.length, 2);
  await callback(paidCb(stk[1].id, 'SKB1BOOKED', 400));
  await until(async () => (await Errand.find({ group: booking.group.id })).every((errand) => errand.status === 'open' && errand.task), 'both open with agent jobs');
  const both = await Errand.find({ group: booking.group.id });
  assert.ok(both.every((errand) => errand.payment.status === 'paid' && errand.payment.receipt === 'SKB1BOOKED'));
  const job = await require('../models/Task').findById(both.find((errand) => String(errand._id) === booking._id).task).lean();
  assert.deepEqual(job.items.map((item) => [item.title, item.qty, item.attrs.price]), [['School shoes black', 2, 'KSh 1,500'], ['Sandals', 1, 'KSh 800']]);
});

test('no callback reaching us (a laptop): after 8 s the booking page asks Safaricom, and the booking starts', async () => {
  const res = await api('POST', '/errands', { kind: 'shopride', sellers: [SELLERS()[1]], mode: 'point', pointId: area('Kasarani')._id }, buyer);
  assert.equal(res.status, 201);
  const id = stk.at(-1).id;
  queryReply.set(id, { ResponseCode: '0', ResultCode: '0', ResultDesc: 'The service request is processed successfully.' });
  await Errand.collection.updateOne({ _id: new mongoose.Types.ObjectId(res.json._id) }, { $set: { updatedAt: new Date(Date.now() - 10000) } });
  const page = await api('GET', `/errands/${res.json._id}`, undefined, buyer);
  assert.deepEqual([page.json.status, page.json.payment.status], ['open', 'paid']);
});

test('after inspection: a real M-Pesa prompt for the goods + delivery; less money is refused; the buyer pays again; the seller is due', async () => {
  const before = stk.length;
  await inspect(booking._id, true);
  await until(() => stk.length === before + 1, 'the goods prompt');
  const goodsPrompt = stk.at(-1);
  assert.deepEqual([goodsPrompt.body.Amount, goodsPrompt.body.PartyB, goodsPrompt.body.PartyA], [3800 + 150, '174379', '254712999888'], 'goods 3,800 + delivery 150, to the buyer’s phone');
  let errand = await Errand.findById(booking._id);
  assert.equal(errand.shopride.goods.status, 'pending');
  // the agent can't take it yet
  assert.equal((await api('POST', `/work/tasks/${errand.task}/picked-up`, undefined, agent)).status, 409);
  // less money than asked: refused
  await callback(paidCb(goodsPrompt.id, 'SKG1SHORT1', 1000));
  await until(async () => (await Errand.findById(booking._id)).shopride.goods.status === 'failed', 'short payment refused');
  assert.match((await Errand.findById(booking._id)).shopride.goods.failReason, /KSh 1000 instead of KSh 3950/);
  // pay again
  const again = await api('POST', `/errands/${booking._id}/pay-goods`, {}, buyer);
  assert.equal(again.status, 200);
  const retry = stk.at(-1);
  assert.equal(retry.body.Amount, 3950);
  await callback(paidCb(retry.id, 'SKG2GOODS2', 3950));
  await until(async () => (await Errand.findById(booking._id)).shopride.goods.status === 'paid', 'goods paid');
  errand = await Errand.findById(booking._id);
  assert.deepEqual([errand.shopride.goods.receipt, errand.shopride.goods.seller.status], ['SKG2GOODS2', 'due']);
  assert.equal((await api('POST', `/work/tasks/${errand.task}/picked-up`, undefined, agent)).status, 200, 'paid: the agent takes it');
});

test('the goods prompt answered through the status check too (no callback)', async () => {
  const other = (await Errand.find({ group: booking.group.id }).sort({ _id: 1 }))[1];
  await inspect(other._id, true);
  await until(async () => (await Errand.findById(other._id)).shopride.goods.status === 'pending', 'goods prompt');
  const id = (await Errand.findById(other._id)).shopride.goods.checkoutRequestId;
  queryReply.set(id, { ResponseCode: '0', ResultCode: '0', ResultDesc: 'ok', MpesaReceiptNumber: 'SKQ1QUERY1' });
  await Errand.collection.updateOne({ _id: other._id }, { $set: { updatedAt: new Date(Date.now() - 10000) } });
  const page = await api('GET', `/errands/${other._id}`, undefined, buyer);
  assert.deepEqual([page.json.shopride.goods.status, page.json.shopride.goods.receipt], ['paid', 'SKQ1QUERY1']);
});
