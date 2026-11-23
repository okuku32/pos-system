// 🛍️ Shop & ride with us: the booking journey and performance:   cd server && npm run test:shopride
// Real server on a throw-away database, demo payments (M-Pesa marked paid at once). The performance part measures the
// pricing itself, the nearest-pickup-point lookup, and the API under hundreds of requests at once (one machine runs
// both the server and the requests, so the limits are generous for a laptop and tight for a real server).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5194;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_shopride_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  MPESA_CONSUMER_KEY: '', MPESA_CONSUMER_SECRET: '', MPESA_SHORTCODE: '', ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 'r'.repeat(48), AUTH_RATE_LIMIT: '400',
});
const mongoose = require('mongoose');
const shopRide = require('../market/shopRide');

const PASS = 'Kenya-Market-2026';
let ipN = 0;
const ip = () => { ipN += 1; return `10.${50 + Math.floor(ipN / 60000)}.${Math.floor(ipN / 250) % 250}.${ipN % 250}`; };
const api = async (method, url, body, who) => {
  let res;
  try {
    res = await fetch(BASE + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': who?.ip || ip(), ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    return { status: `network:${error.cause?.code || error.message}`, json: null }; // counted, not thrown
  }
  return { status: res.status, json: await res.json().catch(() => null) };
};
// the load tests send through a pool of up to 100 kept-alive connections, like a reverse proxy or the app (300 brand-new
// connections in the same millisecond would only measure the operating system's connection queue)
const http = require('http');
const pool = new http.Agent({ keepAlive: true, maxSockets: 100 });
const pooled = (method, url, body, xff = ip()) => new Promise((resolve) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const req = http.request(BASE + '/api' + url, { method, agent: pool, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let text = '';
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json }); });
  });
  req.on('error', (error) => resolve({ status: `network:${error.code}`, json: null }));
  if (data) req.write(data);
  req.end();
});
let Customer;
let Errand;
let points;
let staff;
async function buyer(n) {
  const email = `buyer${n}@shopride.test`;
  const phone = `07130${String(n).padStart(5, '0')}`;
  assert.equal((await api('POST', '/customers/register', { name: `Buyer ${n} Tester`, email, phone, password: PASS, confirmPassword: PASS })).status, 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const login = await api('POST', '/customers/login', { login: email, password: PASS });
  return { token: login.json.token, id: login.json.customer._id, ip: ip() };
}
const pct = (list, p) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor((p / 100) * list.length))];
const area = (name) => points.find((item) => item.area === name);

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.connection.collection('sitesettings').insertOne({ key: 'site', demoPayments: true });
  require('../server');
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && mongoose.connection.readyState === 1) break; } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  Customer = require('../models/Customer');
  Errand = require('../models/Errand');
  await require('../config/site').loadSite();
  const User = require('../models/User');
  await User.create({ name: 'Hub Boss', email: 'hub@shopride.test', password: 'Admin-pass-2026', role: 'admin' });
  const gate = await require('../middleware/staffGate').loadGate();
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Gate': gate, 'X-Forwarded-For': ip() }, body: JSON.stringify({ email: 'hub@shopride.test', password: 'Admin-pass-2026' }) });
  staff = { token: (await login.json()).token, ip: ip() };
});
after(async () => {
  // the list photos this run saved (only the ones its own test database names)
  for (const errand of await mongoose.connection.db.collection('errands').find({ 'shopping.photos.0': { $exists: true } }).project({ 'shopping.photos': 1 }).toArray().catch(() => [])) {
    for (const photo of errand.shopping.photos) if (/^[a-f0-9]{24}\.\w+$/.test(photo.file || '')) { try { require('fs').unlinkSync(path.join(__dirname, '..', 'private', 'lists', photo.file)); } catch { /* gone */ } }
  }
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

// ---------------------------------------------------------------- the journey
test('pickup points and prices are public: the CBD hub plus points in the areas', async () => {
  const res = await api('GET', '/errands/pickup-points');
  assert.equal(res.status, 200);
  points = res.json.points;
  assert.ok(points.length >= 10, `${points.length} points`);
  assert.equal(points[0].hub, true, 'the hub first');
  assert.equal(points[0].area, 'CBD');
  assert.deepEqual([res.json.rates.inspectFee, res.json.rates.cbdFee, res.json.rates.outsideFee, res.json.rates.lightKg], [200, 150, 250, 5]);
});

test('a price check before logging in: from the CBD vs from an area, pickup point vs door', async () => {
  const cbd = await api('POST', '/errands/shopride/quote', { fromArea: area('CBD')._id, weightKg: 3, inspect: true, mode: 'point', pointId: area('Kasarani')._id });
  assert.equal(cbd.status, 200, JSON.stringify(cbd.json));
  assert.deepEqual([cbd.json.fromCbd, cbd.json.delivery.fee, cbd.json.inspection, cbd.json.total, cbd.json.point.area], [true, 150, 200, 350, 'Kasarani']);
  const outside = await api('POST', '/errands/shopride/quote', { fromArea: area('Eastleigh')._id, weightKg: 3, inspect: false, mode: 'point', pointId: area('Kasarani')._id });
  assert.deepEqual([outside.json.fromCbd, outside.json.inspection, outside.json.total, outside.json.verifyRequired, outside.json.verifyRecommended], [false, 0, 250, false, true], 'far from our agents: verification recommended, never forced');
  const outsideVerified = await api('POST', '/errands/shopride/quote', { fromArea: area('Eastleigh')._id, weightKg: 3, inspect: true, mode: 'point', pointId: area('Kasarani')._id });
  assert.deepEqual([outsideVerified.json.inspection, outsideVerified.json.total], [200, 450], 'the buyer asked for it: KSh 200');
  // door: the nearest pickup point to the buyer is found, and the Bolt Send-style fare from it is added
  const door = await api('POST', '/errands/shopride/quote', { fromArea: area('CBD')._id, weightKg: 3, inspect: true, mode: 'door', to: { lat: -1.2240, lng: 36.8900 } });
  assert.equal(door.json.ok, true, JSON.stringify(door.json));
  assert.equal(door.json.point.area, 'Kasarani', 'from the pickup point nearest the buyer');
  assert.ok(door.json.door.fare >= 150 && door.json.total === 350 + door.json.door.fare);
  const bad = await api('POST', '/errands/shopride/quote', { fromArea: 'nope', weightKg: 3, mode: 'point' });
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.reason, /Where are the items/);
});

test('where our trained shopping agents are: a market with an approved agent makes nearby sellers “covered” (inspection optional)', async () => {
  const Market = require('../models/Market');
  const east = area('Eastleigh');
  const market = await Market.create({ name: 'Eastleigh Garissa Lodge', slug: 'eastleigh-test-market', kind: 'mixed', county: 'Nairobi', area: 'Eastleigh', point: { type: 'Point', coordinates: [east.lng, east.lat] }, approved: true });
  const quote = () => api('POST', '/errands/shopride/quote', { fromArea: east._id, weightKg: 3, inspect: false, mode: 'point', pointId: area('Kasarani')._id });
  // an agent who applied but isn't approved yet doesn't count
  const agent = await Customer.create({ name: 'Agent Amina', email: 'agent@shopride.test', phone: '254799000111', password: 'Kenya-Market-2026', emailVerified: true, worker: { role: 'agent', status: 'pending', market: market._id, marketName: market.name } });
  require('../utils/cache').invalidate('market:shopride-agents');
  assert.equal((await quote()).json.verifyRecommended, true, 'pending agent: still far (verification recommended)');
  // approved (through the admin action, which refreshes the list straight away)
  const approve = await api('POST', `/work/admin/workers/${agent._id}`, { action: 'approve' }, staff);
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  const covered = await quote();
  assert.deepEqual([covered.json.covered, covered.json.zone, covered.json.coverName, covered.json.inspection, covered.json.total, covered.json.verifyRequired], [true, 'market', 'Eastleigh Garissa Lodge', 0, 250, false]);
  // each seller's part suggests the agent of the market it's at (name only: no phone in a public price check)
  const group = await api('POST', '/errands/shopride/quote', { sellers: [{ fromArea: east._id, weightKg: 3, inspect: false, items: [{ name: 'Shoes', qty: 1, price: 1000 }] }], mode: 'point', pointId: area('Kasarani')._id });
  assert.equal(group.status, 200, JSON.stringify(group.json));
  assert.equal(group.json.parts[0].agent?.name, 'Agent Amina', 'the market’s agent, suggested automatically');
  assert.equal(group.json.parts[0].agent.marketName, 'Eastleigh Garissa Lodge');
  assert.ok(!JSON.stringify(group.json).includes('254799000111'), 'never their phone');
  // the CBD is always covered
  const cbd = await api('POST', '/errands/shopride/quote', { fromArea: area('CBD')._id, weightKg: 3, inspect: false, mode: 'point', pointId: area('Kasarani')._id });
  assert.deepEqual([cbd.json.covered, cbd.json.zone, cbd.json.inspection], [true, 'cbd', 0]);
  // suspended: the market is no longer covered
  await api('POST', `/work/admin/workers/${agent._id}`, { action: 'suspend' }, staff);
  assert.equal((await quote()).json.verifyRecommended, true, 'no approved agent there any more');
  await Market.deleteOne({ _id: market._id });
  await Customer.deleteOne({ _id: agent._id });
  require('../utils/cache').invalidate('market:shopride-agents');
});

let booking;
let buyerA;
test('booking (pickup point): paid upfront; our agent’s job: collect from the seller, inspect, repack, bring to the CBD hub', async () => {
  buyerA = await buyer(1);
  assert.equal((await api('POST', '/errands', { kind: 'shopride', what: 'Two pairs of school shoes', address: 'Gikomba market, stall 14' }, undefined)).status, 401, 'log in to book');
  const missing = await api('POST', '/errands', { kind: 'shopride', what: 'x', address: 'Gikomba market' }, buyerA);
  assert.equal(missing.status, 400);
  const res = await api('POST', '/errands', { kind: 'shopride', what: 'Two pairs of school shoes', sellerName: 'Mama Njeri shoes', sellerPhone: '0722000111', fromArea: area('Eastleigh')._id, address: 'Gikomba market, stall 14', weightKg: 2, inspect: true, repack: true, mode: 'point', pointId: area('Kasarani')._id }, buyerA);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  booking = res.json;
  assert.deepEqual([booking.kind, booking.status, booking.payment.status, booking.payment.amount], ['shopride', 'open', 'paid', 200], 'only the KSh 200 inspection now (demo payment); delivery comes later');
  assert.deepEqual([booking.shopride.point.area, booking.shopride.mode, booking.shopride.inspect, booking.shopride.repack, booking.shopride.fromCbd], ['Kasarani', 'point', true, true, false]);
  const job = await require('../models/Task').findById(booking.taskId).lean();
  assert.deepEqual([job.kind, job.inspect, job.fee, job.pay, job.collectCash, job.dropoff.name], ['delivery', true, 450, require('../market/payouts').split(450).net, 0, 'Kapu CBD hub']);
  assert.match(job.buyerNotes, /Inspect it/);
  assert.match(job.buyerNotes, /Repackage/);
});

test('collected → at the CBD hub → ready at the Kasarani pickup point (the buyer is told where) → collected', async () => {
  const Task = require('../models/Task');
  const errands = require('../controllers/errandController');
  const task = await Task.findById(booking.taskId);
  task.workerName = 'Otieno';
  await errands.onTask(task, 'assigned', {});
  await errands.onTask(task, 'picked_up', {});
  await errands.onTask(task, 'done', {}); // the agent dropped it at the hub (their job is finished)
  let errand = await Errand.findById(booking._id);
  assert.equal(errand.status, 'at_hub', 'the agent’s finished job doesn’t end the booking');
  // our team: the wrong step is refused; then "at the pickup point"
  assert.equal((await api('POST', `/errands/admin/${booking._id}`, { action: 'out_for_delivery' }, staff)).status, 409, 'not a door booking');
  assert.equal((await api('POST', `/errands/admin/${booking._id}`, { action: 'at_point' }, buyerA)).status, 401, 'our team only');
  const ready = await api('POST', `/errands/admin/${booking._id}`, { action: 'at_point' }, staff);
  assert.equal(ready.status, 200, JSON.stringify(ready.json));
  const note = await mongoose.connection.collection('notifications').findOne({ to: new mongoose.Types.ObjectId(buyerA.id), 'title.en': /Ready to collect/ });
  assert.ok(note, 'the buyer got the message');
  assert.match(note.body.en, /Kasarani pickup point: Thika Road, Roysambu/);
  assert.match(note.body.en, new RegExp(booking.no));
  const mine = await api('GET', `/errands/${booking._id}`, undefined, buyerA);
  assert.equal(mine.json.status, 'at_point');
  // collected: by the buyer's "received" or by our team
  assert.equal((await api('POST', `/errands/${booking._id}/received`, undefined, buyerA)).status, 200);
  errand = await Errand.findById(booking._id);
  assert.equal(errand.status, 'done');
});

test('door delivery: the fare from the buyer’s area point to their live location; hub → out for delivery → delivered → received', async () => {
  const buyerB = await buyer(2);
  const res = await api('POST', '/errands', { kind: 'shopride', what: 'A 32 inch TV', fromArea: area('CBD')._id, address: 'Luthuli Avenue, Electronics Plaza', weightKg: 8, urgency: 'express', inspect: true, mode: 'door', to: { lat: -1.2240, lng: 36.8900 }, dropAddress: 'Roysambu, Lumumba Drive, Block C house 4' }, buyerB);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const price = res.json.shopride.price;
  assert.ok(price.door >= 150 && price.delivery > 150, JSON.stringify(price));
  assert.equal(res.json.payment.amount, price.inspection, 'only the inspection now');
  assert.equal(res.json.shopride.onDelivery, price.delivery + price.door, 'door: the delivery fee and door fare are paid when it arrives');
  assert.equal(res.json.shopride.point.area, 'Kasarani');
  assert.equal(res.json.dropoff.address, 'Roysambu, Lumumba Drive, Block C house 4');
  const step = (action) => api('POST', `/errands/admin/${res.json._id}`, { action }, staff);
  assert.equal((await step('at_hub')).status, 409, 'not collected yet');
  const task = await require('../models/Task').findById(res.json.taskId);
  task.workerName = 'Achieng';
  await require('../controllers/errandController').onTask(task, 'assigned', {});
  assert.equal((await step('at_hub')).status, 200, 'brought in by the team');
  assert.equal((await step('at_point')).status, 409, 'a door booking');
  assert.equal((await step('out_for_delivery')).status, 200);
  assert.equal((await step('delivered')).status, 200);
  assert.equal((await api('POST', `/errands/${res.json._id}/received`, undefined, buyerB)).status, 200);
  assert.equal((await Errand.findById(res.json._id)).status, 'done');
});

test('our team manages the pickup points; a new point is used straight away', async () => {
  const bad = await api('POST', '/errands/admin/pickup-points', { name: 'Kisumu point', area: 'Kisumu', lat: -0.0917, lng: 34.768 }, staff);
  assert.equal(bad.status, 400);
  const made = await api('POST', '/errands/admin/pickup-points', { name: 'Ruai pickup point', area: 'Ruai', address: 'Ruai stage', hours: 'Daily 7am–9pm', lat: -1.2600, lng: 36.9900 }, staff);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const near = await api('POST', '/errands/shopride/quote', { fromArea: area('CBD')._id, weightKg: 1, mode: 'door', to: { lat: -1.2610, lng: 36.9850 } });
  assert.equal(near.json.point.area, 'Ruai', 'nearest point now Ruai');
  assert.equal((await api('PUT', `/errands/admin/pickup-points/${made.json._id}`, { active: false }, staff)).status, 200);
  const after = await api('POST', '/errands/shopride/quote', { fromArea: area('CBD')._id, weightKg: 1, mode: 'door', to: { lat: -1.2610, lng: 36.9850 } });
  assert.notEqual(after.json.point.area, 'Ruai', 'switched off: not used');
  assert.equal((await api('GET', '/errands/admin/pickup-points', undefined, buyerA)).status, 401);
});

// ---------------------------------------------------------------- performance
test('performance: 100,000 price quotes in well under a second', () => {
  const west = area('Westlands');
  const started = performance.now();
  let total = 0;
  for (let i = 0; i < 100000; i++) {
    const result = shopRide.quote({ from: { lat: -1.28 + (i % 50) / 1000, lng: 36.82 + (i % 70) / 1000 }, weightKg: 1 + (i % 12), urgency: i % 3 ? 'standard' : 'express', inspect: i % 2 === 0, mode: i % 4 ? 'point' : 'door', point: west, to: { lat: -1.25, lng: 36.79 } });
    total += result.total;
  }
  const ms = performance.now() - started;
  console.log(`# 100,000 quotes: ${ms.toFixed(0)} ms (${Math.round(100000 / (ms / 1000)).toLocaleString()} a second)`);
  assert.ok(total > 0);
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});

test('performance: the nearest of 500 pickup points, 10,000 times', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ _id: String(i), name: `P${i}`, area: `A${i}`, lat: -1.20 - (i % 25) / 100, lng: 36.70 + Math.floor(i / 25) / 50 }));
  const started = performance.now();
  for (let i = 0; i < 10000; i++) shopRide.nearestPoint(many, { lat: -1.2 - (i % 30) / 100, lng: 36.7 + (i % 40) / 100 });
  const ms = performance.now() - started;
  console.log(`# 10,000 nearest-point lookups over 500 points: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test('performance: 300 price checks at once through the API (100 connections, pickup points cached), all answered, p95 under 1.5 s', async () => {
  const kasarani = area('Kasarani')._id;
  const times = [];
  const codes = {};
  const started = performance.now();
  await Promise.all(Array.from({ length: 300 }, async (_, i) => {
    const t0 = performance.now();
    const res = await pooled('POST', '/errands/shopride/quote', { fromArea: points[i % points.length]._id, weightKg: 1 + (i % 9), inspect: true, mode: i % 2 ? 'point' : 'door', pointId: kasarani, to: { lat: -1.22, lng: 36.89 } });
    times.push(performance.now() - t0);
    codes[res.status] = (codes[res.status] || 0) + 1;
    if (res.status === 200) assert.equal(res.json.ok, true);
  }));
  const wall = (performance.now() - started) / 1000;
  console.log(`# 300 quotes at once: ${JSON.stringify(codes)} · p50 ${pct(times, 50).toFixed(0)} ms · p95 ${pct(times, 95).toFixed(0)} ms · ${(300 / wall).toFixed(0)} a second`);
  assert.deepEqual(codes, { 200: 300 });
  assert.ok(pct(times, 95) < 1500, `p95 ${pct(times, 95).toFixed(0)} ms`);
  // the same from one address: the rate limit stops a flood (60 a minute)
  const flood = { ip: '10.99.1.1' };
  const statuses = await Promise.all(Array.from({ length: 70 }, () => api('POST', '/errands/shopride/quote', { fromArea: kasarani, weightKg: 1, mode: 'point', pointId: kasarani }, flood).then((res) => res.status)));
  assert.ok(statuses.filter((status) => status === 429).length >= 10, 'flood limited');
});

test('performance: 300 pickup-point lists at once', async () => {
  const times = [];
  await Promise.all(Array.from({ length: 300 }, async () => {
    const t0 = performance.now();
    const res = await pooled('GET', '/errands/pickup-points');
    assert.equal(res.status, 200);
    times.push(performance.now() - t0);
  }));
  console.log(`# 300 pickup-point lists at once: p50 ${pct(times, 50).toFixed(0)} ms · p95 ${pct(times, 95).toFixed(0)} ms`);
  assert.ok(pct(times, 95) < 1500);
});

test('performance: 25 buyers book at the same moment: every booking saved once, with its own number and agent job', async () => {
  const people = [];
  for (let i = 0; i < 25; i++) people.push(await buyer(100 + i));
  const kasarani = area('Kasarani')._id;
  const started = performance.now();
  const results = await Promise.all(people.map((who, i) => api('POST', '/errands', { kind: 'shopride', what: `Order number ${i} of shoes`, fromArea: points[1 + (i % (points.length - 1))]._id, address: 'A shop in the market', weightKg: 1 + (i % 4), inspect: true, mode: 'point', pointId: kasarani }, who)));
  const ms = performance.now() - started;
  console.log(`# 25 bookings at once: ${ms.toFixed(0)} ms`);
  assert.ok(results.every((res) => res.status === 201), JSON.stringify(results.filter((res) => res.status !== 201).map((res) => res.json)));
  assert.equal(new Set(results.map((res) => res.json.no)).size, 25, 'unique booking numbers');
  assert.equal(await require('../models/Task').countDocuments({ errand: { $in: results.map((res) => res.json._id) } }), 25, 'one agent job each');
  assert.ok(ms < 10000);
});

// ---------------------------------------------------------------- "What did you buy?" and the seller on Kapu
let shoeSeller;
test('suggestions as they type: kinds of items whose words start with it, and ads with their seller', async () => {
  // a seller on Kapu with a public shop in the CBD (stall 14) and a shoe ad
  const email = 'shoes@shopride.test';
  assert.equal((await api('POST', '/customers/register', { name: 'Njeri Shoes', email, phone: '0722300400', password: PASS, confirmPassword: PASS, accountType: 'seller', payDetails: { method: 'till', till: '512345', name: 'Test Shop' }, sellerTypes: ['market-stall'], sellerCategories: ['clothes-shoes'], location: { county: 'Nairobi', area: 'CBD', lat: -1.2838, lng: 36.8262 } })).status, 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true, 'shopLocation.name': 'Njeri Shoes', 'shopLocation.stall': 'Stall 14, near gate B', 'shopLocation.address': 'Kamukunji market, Moi Avenue' } });
  shoeSeller = await Customer.findOne({ email }).lean();
  const shoeAd = { title: 'School shoes black leather', slug: 'ride-school-shoes', category: 'clothes-shoes', sub: 'mens-shoes', county: 'Nairobi', area: 'CBD', price: 1500, seller: shoeSeller._id, sellerName: 'Njeri Shoes', status: 'active', weightKg: 0.8, images: [] };
  await require('../models/Listing').create({ ...shoeAd, keywords: require('../market/search').keywordsFor(shoeAd) }); // search words, as posting an ad builds them

  const res = await api('GET', '/errands/shopride/items?q=sho');
  assert.equal(res.status, 200);
  const labels = res.json.items.map((item) => item.label);
  assert.ok(labels.some((label) => /shoes/i.test(label)), `items: ${labels}`);
  assert.ok(labels.every((label) => label.toLowerCase().split(/[^a-z’']+/).some((word) => word.startsWith('sho'))), 'only words starting with “sho”');
  const ad = res.json.ads.find((item) => item.title === 'School shoes black leather');
  assert.ok(ad, 'the shoe ad');
  assert.deepEqual([String(ad.seller._id), ad.seller.name, ad.weightKg], [String(shoeSeller._id), 'Njeri Shoes', 0.8]);
  assert.ok(!JSON.stringify(res.json).includes('254722300400'), 'no phone numbers in suggestions');
  const two = await api('GET', '/errands/shopride/items?q=women sh');
  assert.ok(two.json.items.some((item) => /women.?s shoes/i.test(item.label)), 'several words narrow it down');
  assert.deepEqual((await api('GET', '/errands/shopride/items?q=s')).json, { items: [], ads: [] }, 'one letter: nothing yet');
});

test('the seller’s phone fills in the rest: shop, stall, area (CBD hub) and exact location; strangers can’t look numbers up', async () => {
  assert.equal((await api('GET', '/errands/shopride/seller?phone=0722300400')).status, 401, 'log in to look up a number');
  const who = await buyer(200);
  const res = await api('GET', '/errands/shopride/seller?phone=0722 300 400', undefined, who);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([res.json.found, res.json.shopName, res.json.stall, res.json.address, res.json.fromArea.area, res.json.phone], [true, 'Njeri Shoes', 'Stall 14, near gate B', 'Kamukunji market, Moi Avenue', 'Nairobi CBD', '254722300400']);
  assert.deepEqual(res.json.pin, { lat: -1.2838, lng: 36.8262 });
  assert.equal((await api('GET', '/errands/shopride/seller?phone=0799999999', undefined, who)).json.found, false, 'not on Kapu');
  assert.equal((await api('GET', `/errands/shopride/seller?phone=0713000200`, undefined, who)).json.found, false, 'a buyer is not a seller');
  assert.equal((await api('GET', '/errands/shopride/seller?phone=123', undefined, who)).status, 400);
  // from an ad (no login needed): the same details but never the phone
  const byId = await api('GET', `/errands/shopride/seller?id=${shoeSeller._id}`);
  assert.deepEqual([byId.json.found, byId.json.stall, byId.json.phone], [true, 'Stall 14, near gate B', undefined]);
  // a flood of look-ups is stopped
  const flood = { ...who, ip: '10.98.7.6' };
  const statuses = [];
  for (let i = 0; i < 34; i++) statuses.push((await api('GET', `/errands/shopride/seller?phone=07220000${String(i).padStart(2, '0')}`, undefined, flood)).status);
  assert.ok(statuses.includes(429), 'rate limited');
});

test('booking with a seller from Kapu: their real phone and shop location are used, with the stall', async () => {
  const who = await buyer(201);
  const res = await api('POST', '/errands', { kind: 'shopride', what: 'School shoes black leather', sellerId: String(shoeSeller._id), sellerPhone: '0700000000', address: 'Kamukunji market', stall: 'Stall 14', weightKg: 1, inspect: true, mode: 'point', pointId: area('Westlands')._id }, who);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const saved = await Errand.findById(res.json._id).lean();
  assert.equal(saved.pickup.phone, '254722300400', 'the seller’s real phone, not what was typed');
  assert.deepEqual(saved.pickup.point.coordinates, [36.8262, -1.2838], 'their shop’s exact location');
  assert.deepEqual([saved.shopride.stall, String(saved.shopride.seller), saved.shopride.fromCbd, saved.shopride.sellerName], ['Stall 14', String(shoeSeller._id), true, 'Njeri Shoes']);
  assert.match(saved.pickup.address, /Kamukunji market, Stall 14/);
  assert.equal(res.json.payment.amount, 200, 'only the inspection now');
  assert.equal(saved.shopride.price.delivery, 150, 'CBD: KSh 150 delivery, paid later');
});

// ---------------------------------------------------------------- two sellers, inspection now, goods after inspection
let agent;
async function approvedAgent() {
  if (agent) return agent;
  agent = await buyer(300);
  await Customer.updateOne({ _id: agent.id }, { $set: { worker: { role: 'agent', status: 'approved', approvedAt: new Date() } } });
  return agent;
}
// our agent takes the job and inspects it (through the agent's API, as their app does)
async function agentInspects(errandId, passed, note = '') {
  const who = await approvedAgent();
  const Task = require('../models/Task');
  const errand = await Errand.findById(errandId);
  await Task.updateOne({ _id: errand.task }, { $set: { worker: who.id, workerName: 'Otieno', status: 'assigned', acceptedAt: new Date() } });
  await require('../controllers/errandController').onTask(await Task.findById(errand.task), 'assigned', {});
  const checks = { rightItem: true, size: true, colour: true, quality: passed };
  const res = await api('POST', `/work/tasks/${errand.task}/inspect`, { checks, note }, who);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return errand.task;
}

let pair;
test('two sellers in one booking: a quote per seller; pay now only the inspections; goods + delivery after inspection', async () => {
  const sellers = [
    { what: 'School shoes black leather', goodsAmount: 1500, sellerId: String(shoeSeller._id), address: 'Kamukunji market', stall: 'Stall 14', weightKg: 1, inspect: true },
    { what: 'Unga 2kg bale', goodsAmount: 1800, sellerPhone: '0711222333', sellerName: 'Mama Akinyi', fromArea: area('Eastleigh')._id, address: 'First Avenue, shop 3', weightKg: 4, inspect: true },
  ];
  const quote = await api('POST', '/errands/shopride/quote', { sellers, mode: 'point', pointId: area('Kasarani')._id });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));
  // seller 1 is on Kapu but the quote doesn't look them up: their area comes from the booking (here none → CBD pin later)
  const q2 = await api('POST', '/errands/shopride/quote', { sellers: [{ ...sellers[0], fromArea: area('CBD')._id }, sellers[1]], mode: 'point', pointId: area('Kasarani')._id });
  assert.deepEqual(q2.json.parts.map((part) => [part.fromCbd, part.delivery.fee, part.inspection, part.goods]), [[true, 150, 200, 1500], [false, 250, 200, 1800]]);
  assert.deepEqual(q2.json.totals, { inspection: 400, repack: 0, goods: 3300, delivery: 400, door: 0, total: 4100 });
  assert.deepEqual(q2.json.schedule, { now: 400, afterInspection: 3700, onDelivery: 0 });
  const bad = await api('POST', '/errands/shopride/quote', { sellers: [{ ...sellers[0], fromArea: area('CBD')._id }, { ...sellers[1], fromArea: 'nope' }], mode: 'point', pointId: area('Kasarani')._id });
  assert.match(bad.json.reason, /^Seller 2: /);

  const who = await buyer(301);
  const res = await api('POST', '/errands', { kind: 'shopride', sellers, mode: 'point', pointId: area('Kasarani')._id }, who);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.ok(res.json.group && res.json.group.parts.length === 2, 'one booking, two parts');
  const both = await Errand.find({ group: res.json.group.id }).sort({ _id: 1 });
  assert.deepEqual(both.map((errand) => [errand.payment.amount, errand.payment.status, errand.status, errand.shopride.goods.amount, errand.shopride.goods.delivery, errand.shopride.goods.status]), [[200, 'paid', 'open', 1500, 150, 'waiting'], [200, 'paid', 'open', 1800, 250, 'waiting']], 'KSh 400 now (one prompt), goods later');
  assert.equal(new Set(both.map((errand) => errand.payment.checkoutRequestId)).size, 1, 'one M-Pesa prompt for both inspections');
  assert.ok(both.every((errand) => errand.task), 'an agent job for each seller');
  assert.equal(both[0].pickup.phone, '254722300400', 'seller 1: their real phone from Kapu');
  assert.equal(both[0].shopride.fromCbd, true, 'seller 1: their shop pin (CBD) from Kapu');
  pair = { who, ids: both.map((errand) => String(errand._id)) };
});

test('inspection passed: the buyer is prompted for the goods (+ delivery), paid, the seller is due, then the agent may take it', async () => {
  const taskId = await agentInspects(pair.ids[0], true, 'Size 40 as ordered');
  const errand = await Errand.findById(pair.ids[0]);
  assert.deepEqual([errand.shopride.inspection.passed, errand.shopride.goods.status, errand.shopride.goods.seller.status], [true, 'paid', 'due'], 'demo: the goods prompt is paid at once');
  assert.match(errand.history.map((item) => item.note).join(' | '), /Goods paid with M-Pesa .*KSh 1,500 \+ KSh 150 delivery/);
  const note = await mongoose.connection.collection('notifications').findOne({ to: new mongoose.Types.ObjectId(agent.id), 'title.en': /Paid: take the item/ });
  assert.ok(note, 'our agent is told to take it');
  assert.equal((await api('POST', `/work/tasks/${taskId}/picked-up`, undefined, agent)).status, 200, 'paid: the agent takes it');
  const due = await api('GET', '/errands/admin/list?kind=shopride&sellersDue=1', undefined, staff);
  assert.ok(due.json.some((item) => item._id === pair.ids[0]), 'our team sees the seller to pay');
});

test('the seller payment is recorded by our team; a failed inspection means no goods payment', async () => {
  const paid = await api('POST', `/errands/admin/${pair.ids[0]}`, { action: 'seller_paid', ref: 'SKS1SELLER' }, staff);
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  assert.deepEqual([paid.json.shopride.goods.seller.status, paid.json.shopride.goods.seller.ref], ['paid', 'SKS1SELLER']);
  assert.equal((await api('POST', `/errands/admin/${pair.ids[0]}`, { action: 'seller_paid' }, staff)).status, 409, 'once');
  assert.ok(!(await api('GET', '/errands/admin/list?kind=shopride&sellersDue=1', undefined, staff)).json.some((item) => item._id === pair.ids[0]), 'no longer due');
  // seller 2's item fails: cancelled, nothing to pay for the goods, the agent still earns the inspection
  const taskId = await agentInspects(pair.ids[1], false, 'Bale is torn and wet');
  const failed = await Errand.findById(pair.ids[1]);
  assert.deepEqual([failed.status, failed.shopride.goods.status, failed.shopride.inspection.passed], ['cancelled', 'cancelled', false]);
  assert.match(failed.cancelReason, /Bale is torn and wet/);
  const job = await require('../models/Task').findById(taskId).lean();
  assert.equal(job.fee, 200, 'the agent is paid the KSh 200 inspection');
});

test('no taking the item before the goods are paid (a goods prompt that did not go through)', async () => {
  // M-Pesa isn't set up in this test: switch demo payments off so the goods prompt fails
  await mongoose.connection.collection('sitesettings').updateOne({ key: 'site' }, { $set: { demoPayments: false } });
  await require('../config/site').loadSite();
  try {
    const who = await buyer(302);
    // no inspection fee: nothing to pay now, so the booking starts without M-Pesa
    const res = await api('POST', '/errands', { kind: 'shopride', sellers: [{ what: 'A blender', goodsAmount: 3000, sellerPhone: '0711222444', fromArea: area('CBD')._id, address: 'Tom Mboya St', weightKg: 2, inspect: false }], mode: 'point', pointId: area('Westlands')._id }, who);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.payment.amount, 0, 'no inspection fee: nothing now');
    const taskId = await agentInspects(res.json._id, true);
    const errand = await Errand.findById(res.json._id);
    assert.equal(errand.shopride.goods.status, 'failed');
    assert.equal((await api('POST', `/work/tasks/${taskId}/picked-up`, undefined, agent)).status, 409, 'the agent must wait');
    const again = await api('POST', `/errands/${res.json._id}/pay-goods`, { phone: '0712345678' }, who);
    assert.equal(again.status, 200);
    assert.deepEqual([again.json.shopride.goods.status, again.json.shopride.goods.phone], ['failed', '254712345678'], 'tried again on the new number (no M-Pesa here)');
  } finally {
    await mongoose.connection.collection('sitesettings').updateOne({ key: 'site' }, { $set: { demoPayments: true } });
    await require('../config/site').loadSite();
  }
});

test('door delivery: goods after inspection without delivery; the delivery fee and door fare are paid at the door', async () => {
  const who = await buyer(303);
  const res = await api('POST', '/errands', { kind: 'shopride', sellers: [{ what: 'Rice 10kg', goodsAmount: 1600, sellerPhone: '0711222555', fromArea: area('Eastleigh')._id, address: 'Eastleigh Mall', weightKg: 3 }, { what: 'Cooking oil 5L', goodsAmount: 1200, sellerPhone: '0711222666', fromArea: area('CBD')._id, address: 'Nyamakima', weightKg: 4 }], mode: 'door', to: { lat: -1.2240, lng: 36.8900 }, dropAddress: 'Roysambu, Lumumba Drive, house 4' }, who);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const both = await Errand.find({ group: res.json.group.id }).sort({ _id: 1 });
  const doorFare = both[0].shopride.price.door;
  assert.ok(doorFare >= 150 && both[1].shopride.price.door === 0, 'the door fare once');
  assert.deepEqual(both.map((errand) => [errand.shopride.goods.delivery, errand.shopride.onDelivery]), [[0, 250 + doorFare], [0, 150]], 'nothing for delivery with the goods; all of it at the door');
  await agentInspects(String(both[0]._id), true);
  assert.equal((await Errand.findById(both[0]._id)).shopride.goods.status, 'paid');
  const step = (action) => api('POST', `/errands/admin/${both[0]._id}`, { action }, staff);
  assert.equal((await step('at_hub')).status, 200);
  assert.equal((await step('out_for_delivery')).status, 200);
  const delivered = await step('delivered');
  assert.equal(delivered.json.shopride.deliveryCollected, true);
  assert.match(delivered.json.history.at(-1).note, new RegExp(`KSh ${(250 + doorFare).toLocaleString('en-KE')} delivery fee paid on arrival`));
});

// ---------------------------------------------------------------- a known seller: only what they sell
test('once the seller is known, “What did you buy?” lists only that seller’s products and the types they chose', async () => {
  const Listing = require('../models/Listing');
  const search = require('../market/search');
  // another seller's shoes and TV (must never show for Njeri)
  const other = await Customer.findOne({ email: 'buyer1@shopride.test' }).lean();
  for (const [title, slug, category, sub] of [['Sports shoes blue running', 'other-sports-shoes', 'clothes-shoes', 'mens-shoes'], ['Samsung TV 43 inch smart', 'other-tv', 'electronics', 'tvs']]) {
    const ad = { title, slug, category, sub, county: 'Nairobi', area: 'Westlands', price: 2500, seller: other._id, sellerName: 'Other shop', status: 'active', images: [] };
    await Listing.create({ ...ad, keywords: search.keywordsFor(ad) });
  }
  const sellerId = String(shoeSeller._id);
  // before typing: their whole list
  const all = await api('GET', `/errands/shopride/items?seller=${sellerId}`);
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.equal(all.json.seller.name, 'Njeri Shoes');
  assert.ok(all.json.ads.length >= 1 && all.json.ads.every((ad) => String(ad.seller._id) === sellerId), 'only Njeri’s ads');
  assert.ok(all.json.ads.some((ad) => ad.title === 'School shoes black leather'));
  assert.ok(all.json.items.length > 0 && all.json.items.every((item) => item.hint === 'Clothes & shoes'), `types from the category they sell: ${all.json.items.map((item) => item.label)}`);
  // typing narrows it, still only theirs
  const shoes = await api('GET', `/errands/shopride/items?seller=${sellerId}&q=sho`);
  assert.deepEqual(shoes.json.ads.map((ad) => ad.title), ['School shoes black leather'], 'not the other seller’s sports shoes');
  assert.ok(shoes.json.items.every((item) => /sho/i.test(item.label)));
  const anywhere = await api('GET', '/errands/shopride/items?q=sho');
  assert.ok(anywhere.json.ads.some((ad) => ad.title === 'Sports shoes blue running'), 'without a seller: every seller’s shoes');
  // something they don't sell: nothing (the buyer types it themselves)
  const tv = await api('GET', `/errands/shopride/items?seller=${sellerId}&q=tv`);
  assert.deepEqual([tv.json.items.length, tv.json.ads.length], [0, 0]);
  assert.ok((await api('GET', '/errands/shopride/items?q=tv')).json.ads.some((ad) => /Samsung TV/.test(ad.title)), 'without a seller TVs are found');
  // types chosen at sign-up: exactly those
  await Customer.updateOne({ _id: shoeSeller._id }, { $set: { sellerItems: ['clothes-shoes/mens-shoes', 'clothes-shoes/womens-shoes'] } });
  const chosen = await api('GET', `/errands/shopride/items?seller=${sellerId}`);
  assert.deepEqual(chosen.json.items.map((item) => item.label).sort(), ['Men’s shoes', 'Women’s shoes']);
  // a seller id that isn't one / isn't valid
  assert.deepEqual((await api('GET', `/errands/shopride/items?seller=${new mongoose.Types.ObjectId()}`)).json, { items: [], ads: [], seller: null });
  assert.equal((await api('GET', '/errands/shopride/items?seller=nope')).status, 404);
  assert.ok(!JSON.stringify(all.json).includes('254722300400'), 'no phone numbers');
});

// ---------------------------------------------------------------- Embakasi: exact pickup points
const EMBAKASI_NAMES = ['Fedha stage', 'Nyayo gate B', 'Kwa Ndege stage', 'Pipeline stage', 'Transami stage', 'Tajmall stage', 'Utawala Astrol', 'Utawala Shooters', 'Utawala near Benedicta', 'Ruai stage', 'Bee Centre', 'Donholm next to Greenspan', 'Kayole junction', 'Mutindwa stage', 'Umoja kwa Chief', 'Mowlem stage', 'Njiru stage', 'Imara Daima stage'];
test('Embakasi has its 18 exact pickup points, in order; the two broad starter points are switched off', async () => {
  const list = (await api('GET', '/errands/pickup-points')).json.points;
  const embakasi = list.filter((point) => point.area === 'Embakasi');
  assert.deepEqual(embakasi.map((point) => point.name), EMBAKASI_NAMES);
  assert.ok(embakasi.every((point) => point.address && point.lat < -1.1 && point.lat > -1.4 && point.lng > 36.8 && point.lng < 37.1), 'each with an address and a place in Nairobi');
  assert.ok(!list.some((point) => ['Embakasi pickup point', 'Donholm pickup point'].includes(point.name)), 'replaced by the exact ones');
  // a booking quote at one exact spot
  const tajmall = embakasi.find((point) => point.name === 'Tajmall stage');
  const quote = await api('POST', '/errands/shopride/quote', { sellers: [{ fromArea: area('CBD')._id, weightKg: 1, items: [{ name: 'Shoes', qty: 1, price: 1000 }] }], mode: 'point', pointId: tajmall._id });
  assert.equal(quote.json.point.name, 'Tajmall stage');
  assert.equal(quote.json.point.area, 'Embakasi');
});

test('an existing database gets the Embakasi points once (no duplicates); points our team changed are kept', async () => {
  const PickupPoint = require('../models/PickupPoint');
  const pickup = require('../market/pickupPoints');
  // as it was before: the broad starter points, one of them edited by our team
  await PickupPoint.deleteMany({ area: 'Embakasi' });
  await PickupPoint.deleteMany({ name: 'Donholm pickup point' });
  await PickupPoint.create({ name: 'Donholm pickup point', area: 'Donholm', address: 'Our own Donholm shop, Outer Ring Road', point: { type: 'Point', coordinates: [36.888, -1.296] } }); // edited by our team
  await PickupPoint.updateOne({ name: 'Embakasi pickup point' }, { $set: { active: true, address: 'Pipeline, Embakasi', area: 'Embakasi' } }, { upsert: false });
  if (!(await PickupPoint.exists({ name: 'Embakasi pickup point' }))) await PickupPoint.create({ name: 'Embakasi pickup point', area: 'Embakasi', address: 'Pipeline, Embakasi', point: { type: 'Point', coordinates: [36.893, -1.317] } });
  const added = await pickup.ensureStarters();
  assert.equal(added, 18);
  assert.equal(await pickup.ensureStarters(), 0, 'running again adds nothing');
  assert.equal(await PickupPoint.countDocuments({ area: 'Embakasi', name: { $in: EMBAKASI_NAMES } }), 18, 'no duplicates');
  assert.equal((await PickupPoint.findOne({ name: 'Embakasi pickup point' })).active, false, 'the broad starter point is switched off');
  assert.equal((await PickupPoint.findOne({ name: 'Donholm pickup point' })).active, true, 'the one our team changed stays');
  pickup.reset();
});

test('Eastleigh has its exact pickup points (Madina Mall, 18th Street, Mlango, BBS Mall); the broad one is switched off', async () => {
  require('../market/pickupPoints').reset();
  const list = (await api('GET', '/errands/pickup-points')).json.points;
  const eastleigh = list.filter((point) => point.area === 'Eastleigh');
  assert.deepEqual(eastleigh.map((point) => point.name), ['Madina Mall', '18th Street', 'Mlango', 'BBS Mall']);
  assert.ok(eastleigh.every((point) => point.address.includes('Eastleigh') && point.lat > -1.29 && point.lat < -1.26 && point.lng > 36.84 && point.lng < 36.86), 'each in Eastleigh');
  assert.ok(!list.some((point) => point.name === 'Eastleigh pickup point'));
  // a seller at BBS Mall (outside the CBD), the buyer collecting at Madina Mall
  const bbs = eastleigh.find((point) => point.name === 'BBS Mall');
  const madina = eastleigh.find((point) => point.name === 'Madina Mall');
  const quote = await api('POST', '/errands/shopride/quote', { sellers: [{ fromArea: bbs._id, weightKg: 1, items: [{ name: 'Dera', qty: 1, price: 1200 }] }], mode: 'point', pointId: madina._id });
  assert.deepEqual([quote.json.point.name, quote.json.parts[0].fromCbd, quote.json.totals.delivery], ['Madina Mall', false, 250]);
});

// ---------------------------------------------------------------- the shopping agent the buyer booked
test('booked with a chosen shopping agent: only they see and can take the job for 10 minutes, then it goes to our riders as usual', async () => {
  const Task = require('../models/Task');
  const at = area('Eastleigh');
  const base = { type: 'Point', coordinates: [at.lng, at.lat] };
  const makeAgent = async (n, name) => {
    const who = await buyer(n);
    await Customer.updateOne({ _id: who.id }, { $set: { name, worker: { role: 'agent', status: 'approved', approvedAt: new Date(), available: true, base, live: base, liveAt: new Date(), marketName: 'Eastleigh' } } });
    return who;
  };
  const chosen = await makeAgent(401, 'Chosen Agent');
  const other = await makeAgent(402, 'Other Agent');
  const rider = await buyer(404);
  await Customer.updateOne({ _id: rider.id }, { $set: { name: 'Near Rider', worker: { role: 'rider', status: 'approved', approvedAt: new Date(), available: true, vehicle: 'Motorbike', base, live: base, liveAt: new Date() } } });
  const who = await buyer(403);
  const book = (extra) => api('POST', '/errands', { kind: 'shopride', what: 'Three kitenge dresses', sellerName: 'Mama Neema', sellerPhone: '0722000999', fromArea: at._id, address: 'Eastleigh, 1st Avenue', weightKg: 2, inspect: true, mode: 'point', pointId: area('Kasarani')._id, ...extra }, who);
  // a stranger (not an approved agent) can't be booked
  assert.equal((await book({ agentId: who.id })).status, 409);
  const res = await book({ agentId: chosen.id });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.shopride.agent.name, 'Chosen Agent', 'the booking says who they booked');
  const job = await Task.findById(res.json.taskId).lean();
  assert.equal(String(job.preferred.worker), chosen.id);
  assert.ok(job.preferred.until > new Date(Date.now() + 9 * 60000), 'theirs alone for 10 minutes');
  // the booked agent gets a 🔔 straight away: what, where, the pay and how long it's theirs
  const Notification = require('../models/Notification');
  let note = null;
  for (let i = 0; i < 40 && !note; i++) { note = await Notification.findOne({ to: chosen.id, kind: 'work' }).lean(); if (!note) await new Promise((r) => setTimeout(r, 50)); }
  assert.ok(note, 'notified');
  assert.match(note.title.en, /booked you/);
  assert.match(note.body.en, /yours for \d+ minutes/);
  assert.equal(note.link, '/work');
  const near = `near=${at.lat},${at.lng}`;
  const seen = async (agent) => ((await api('GET', `/work/jobs?${near}`, undefined, agent)).json.open || []).some((item) => String(item._id) === String(job._id));
  assert.equal(await seen(chosen), true, 'the booked agent sees it (a Shop & ride job, even though they’re an agent)');
  assert.equal(await seen(other), false, 'other agents don’t');
  assert.equal(await seen(rider), false, 'nor our riders, yet');
  assert.equal((await api('POST', `/work/tasks/${job._id}/accept`, {}, other)).status, 409, 'and can’t take it');
  // their 10 minutes are up: the second wave tells our riders (a Shop & ride job is a rider's job), as without a booking
  await Task.updateOne({ _id: job._id }, { $set: { 'preferred.until': new Date(Date.now() - 1000), wave2At: new Date(Date.now() - 1000) } });
  await require('../controllers/workController').runWaves();
  assert.equal(await seen(rider), true, 'now our riders see it');
  assert.equal(await seen(chosen), true, 'and the booked agent can still take it');
  // the booked agent still can take it first (whoever accepts first gets it)
  const taken = await api('POST', `/work/tasks/${job._id}/accept`, {}, chosen);
  assert.equal(taken.status, 200, JSON.stringify(taken.json));
  // without a chosen agent nothing changes
  const plain = await book({});
  assert.equal(plain.status, 201);
  assert.equal((await Task.findById(plain.json.taskId).lean()).preferred, undefined);
});

// ---------------------------------------------------------------- agents belong to a market (like sellers)
test('a shopping agent belongs to a market: required to apply and to be approved, set by our team, counted on the market', async () => {
  const Market = require('../models/Market');
  const market = await Market.findOne({ approved: true }).lean();
  const who = await buyer(501);
  const form = { role: 'agent', idNumber: '30123456', lat: market.point.coordinates[1], lng: market.point.coordinates[0], baseArea: market.area || 'Market', mpesaPhone: '0713000501' };
  const noMarket = await api('POST', '/work/apply', form, who);
  assert.equal(noMarket.status, 400);
  assert.match(noMarket.json.message, /market you work in/);
  // our team can't approve an agent without a market…
  await Customer.updateOne({ _id: who.id }, { $set: { worker: { role: 'agent', status: 'pending', idNumber: '30123456', appliedAt: new Date() } } });
  assert.equal((await api('POST', `/work/admin/workers/${who.id}`, { action: 'approve' }, staff)).status, 409, 'link them to a market first');
  // …so they set it (name and slug kept on the agent, like a seller's market), then approve
  const set = await api('POST', `/work/admin/workers/${who.id}`, { action: 'market', market: String(market._id) }, staff);
  assert.equal(set.status, 200, JSON.stringify(set.json));
  const saved = (await Customer.findById(who.id).lean()).worker;
  assert.deepEqual([String(saved.market), saved.marketName, saved.marketSlug], [String(market._id), market.name, market.slug]);
  assert.equal((await api('POST', `/work/admin/workers/${who.id}`, { action: 'approve' }, staff)).status, 200);
  // the market counts its agents, as it counts its traders
  const page = await api('GET', `/market/markets/${market.slug}`);
  assert.ok(page.json.market.agents >= 1, 'the market page shows its agents');
  const list = await api('GET', '/market/markets');
  assert.ok(list.json.markets.find((item) => item.slug === market.slug).agents >= 1, 'and so does the list of markets');
  // applying again with the market works
  const other = await buyer(502);
  const ok = await api('POST', '/work/apply', { ...form, idNumber: '30123457', mpesaPhone: '0713000502', market: String(market._id) }, other);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await Customer.findById(other.id).lean()).worker.marketSlug, market.slug);
});

// ---------------------------------------------------------------- boosts: one ad, or a market trader's whole business
test('boosts: one ad for 1 week KSh 100, 2 weeks KSh 150 or 1 month KSh 250; sellers in our markets boost their whole business for KSh 200 a month', async () => {
  const Listing = require('../models/Listing');
  const Market = require('../models/Market');
  const plans = (await api('GET', '/market/boosts/plans')).json;
  assert.deepEqual(plans.map((plan) => [plan.key, plan.days, plan.amount]), [['week', 7, 100], ['twoweeks', 14, 150], ['month', 30, 250], ['business', 30, 200]]);
  const seller = async (n) => {
    const who = await buyer(n);
    await Customer.updateOne({ _id: who.id }, { $set: { accountType: 'seller' } });
    return who;
  };
  const adFor = (who, n) => Listing.create({ title: `Boost test item ${n}`, slug: `boost-test-${who.id}-${n}`, category: 'electronics', sub: 'phones', county: 'Nairobi', seller: who.id, price: 1000, status: 'active' });
  const DAY = 86400000;
  const near = (date, days) => Math.abs(new Date(date) - (Date.now() + days * DAY)) < 60000;
  // an ordinary seller: one ad, 2 weeks
  const solo = await seller(601);
  const ad = await adFor(solo, 1);
  const two = await api('POST', '/market/boosts', { listingId: String(ad._id), plan: 'twoweeks', phone: '0713000601' }, solo);
  assert.equal(two.status, 201, JSON.stringify(two.json));
  assert.deepEqual([two.json.boost.amount, two.json.boost.status, two.json.boost.kind], [150, 'paid', 'ad']);
  assert.ok(near((await Listing.findById(ad._id).lean()).boostedUntil, 14), 'featured for 2 weeks');
  assert.equal((await api('POST', '/market/boosts', { plan: 'business', phone: '0713000601' }, solo)).status, 403, 'the business plan is for sellers in our markets');
  // a trader in one of our markets: the whole business, KSh 200 a month (and only that)
  const market = await Market.findOne({ approved: true }).lean();
  const trader = await seller(602);
  await Customer.updateOne({ _id: trader.id }, { $set: { shopLocation: { name: 'Mama Boost Stall', area: market.area || 'Market', county: market.county, point: market.point, public: true, market: market._id, marketName: market.name, marketSlug: market.slug } } });
  const [a1, a2] = [await adFor(trader, 1), await adFor(trader, 2)];
  assert.equal((await api('POST', '/market/boosts', { listingId: String(a1._id), plan: 'week', phone: '0713000602' }, trader)).status, 409, 'traders boost their business, not one ad');
  const biz = await api('POST', '/market/boosts', { plan: 'business', phone: '0713000602' }, trader);
  assert.equal(biz.status, 201, JSON.stringify(biz.json));
  assert.deepEqual([biz.json.boost.amount, biz.json.boost.kind, biz.json.boost.status], [200, 'business', 'paid']);
  for (const item of [a1, a2]) assert.ok(near((await Listing.findById(item._id).lean()).boostedUntil, 30), 'every ad featured for the month');
  assert.ok(near((await Customer.findById(trader.id).lean()).businessBoostUntil, 30), 'the business is boosted for the month');
  // their shop shows first on the market's page, marked as boosted
  const page = (await api('GET', `/market/markets/${market.slug}`)).json;
  const shown = page.sellers.find((item) => String(item._id) === trader.id);
  assert.ok(shown?.boosted, 'a featured business');
  assert.equal(String(page.sellers[0]._id), trader.id, 'shown first');
});

// ---------------------------------------------------------------- 🛒 Shop for me, the quick way: a written / photographed list
test('shop for me with a list: write it or photograph it, give contacts and address; an agent prices it, the customer pays, then they buy', async () => {
  const at = { lat: -1.2195, lng: 36.8980 }; // Kasarani
  const PNG = new Blob([Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)])], { type: 'image/png' });
  const sendList = async (fields, photos, who) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    for (const photo of photos) form.append('photos', photo, 'list.png');
    const res = await fetch(BASE + '/api/errands/list', { method: 'POST', headers: { 'X-Forwarded-For': who.ip, Authorization: `Bearer ${who.token}` }, body: form });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const raw = (url, who) => fetch(BASE + '/api' + url, { headers: { 'X-Forwarded-For': who.ip, Authorization: `Bearer ${who.token}` } });
  const customer = await buyer(8801);
  const nosy = await buyer(8802);
  const contact = { name: 'Achieng Tester', phone: '0712345678', address: 'Kasarani, Mwiki road, house 12', lat: at.lat, lng: at.lng };

  // only the list (written or photographed), contacts and the address
  assert.equal((await sendList({ ...contact }, [], customer)).status, 400, 'a list is needed');
  assert.equal((await sendList({ ...contact, lat: '', lng: '' , text: 'Unga 2kg' }, [], customer)).status, 400, 'the delivery address on the map');
  assert.equal((await sendList({ ...contact, address: 'x', text: 'Unga 2kg' }, [], customer)).status, 400, 'a delivery address');
  const booked = await sendList({ ...contact, text: 'Unga 2kg\nSukuma wiki x3\nCooking oil 1L', notes: 'Call at the gate' }, [PNG], customer);
  assert.equal(booked.status, 201, JSON.stringify(booked.json));
  const errand = booked.json;
  assert.deepEqual([errand.status, errand.payment.status, errand.shopping.mode, errand.shopping.photos.length], ['open', 'none', 'list', 1], 'nothing to pay yet');
  assert.equal((await raw(errand.shopping.photos[0], customer)).status, 200, 'the customer sees their photo');
  assert.equal((await raw(`/errands/${errand._id}/list-photos/0`, nosy)).status, 404, 'nobody else does');

  // a shopping agent near the customer takes it, reads the list and sees the photo
  const agent = await buyer(8803);
  await Customer.updateOne({ _id: agent.id }, { $set: { worker: { role: 'agent', status: 'approved', approvedAt: new Date(), available: true, base: { type: 'Point', coordinates: [at.lng, at.lat] }, baseArea: 'Kasarani', radiusKm: 8 } } });
  const jobs = await api('GET', `/work/jobs?near=${at.lat},${at.lng}`, undefined, agent);
  const job = (jobs.json.open || []).find((item) => item.errand && item.list?.text?.includes('Sukuma'));
  assert.ok(job, 'the agent near the customer sees the list');
  assert.deepEqual([job.list.photoCount, job.list.photos.length], [1, 0], 'photos only once they take it');
  assert.equal((await api('POST', `/work/tasks/${job._id}/accept`, {}, agent)).status, 200);
  const mine = (await api('GET', `/work/jobs?near=${at.lat},${at.lng}`, undefined, agent)).json.mine.find((item) => item._id === job._id);
  assert.equal((await raw(mine.list.photos[0], agent)).status, 200, 'the agent on the job sees the photo');
  assert.equal((await raw(mine.list.photos[0], nosy)).status, 404);
  assert.equal((await api('POST', `/work/tasks/${job._id}/bought`, { spent: 900 }, agent)).status, 409, 'no buying before the customer pays');

  // the agent prices it; the customer pays (demo payments: at once); then they buy it
  assert.equal((await api('POST', `/work/tasks/${job._id}/quote`, { amount: 10 }, agent)).status, 400, 'a real price');
  const priced = await api('POST', `/work/tasks/${job._id}/quote`, { amount: 1200, note: 'Naivas prices' }, agent);
  assert.equal(priced.status, 200, JSON.stringify(priced.json));
  const paid = await Errand.findById(errand._id).lean();
  assert.deepEqual([paid.status, paid.payment.status, paid.shopping.budget, paid.shopping.quote.amount], ['assigned', 'paid', 1200, 1200]);
  assert.equal(paid.payment.amount, 1200 + paid.fee.service, 'the goods + the agent’s fee, paid now');
  assert.ok(paid.fee.delivery >= 150, 'delivery (by distance) paid on delivery');
  const Task = require('../models/Task');
  assert.ok((await Task.findById(job._id).lean()).quote.paidAt, 'the agent may buy now');
  assert.equal((await api('POST', `/work/tasks/${job._id}/quote`, { amount: 1500 }, agent)).status, 409, 'no new price once paid');
  assert.equal((await api('POST', `/work/tasks/${job._id}/bought`, { spent: 1300 }, agent)).status, 400, 'not more than was paid for the goods');
  assert.equal((await api('POST', `/work/tasks/${job._id}/bought`, { spent: 1150, receipt: 'NV123' }, agent)).status, 200);
  assert.equal((await Errand.findById(errand._id).lean()).status, 'picked_up');

  // a list can be cancelled before it's paid, even while an agent is pricing it (the agent is told)
  const second = (await sendList({ ...contact, text: 'Bread and milk' }, [], customer)).json;
  const job2 = (await api('GET', `/work/jobs?near=${at.lat},${at.lng}`, undefined, agent)).json.open.find((item) => item.list?.text === 'Bread and milk');
  assert.equal((await api('POST', `/work/tasks/${job2._id}/accept`, {}, agent)).status, 200);
  assert.equal((await api('POST', `/errands/${second._id}/cancel`, {}, customer)).json.status, 'cancelled');
  assert.equal((await Task.findById(job2._id).lean()).status, 'cancelled');
  // and the team sees the photo (audited)
  const team = await fetch(BASE + `/api/errands/admin/${errand._id}/list-photos/0`, { headers: { 'X-Forwarded-For': staff.ip, Authorization: `Bearer ${staff.token}` } });
  assert.equal(team.status, 200);
});
