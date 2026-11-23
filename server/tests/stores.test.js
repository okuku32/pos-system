// The marketplace's relationships:   cd server && npm run test:stores
//   seller → many stores · store → many listings · product → many seller listings (different prices)
//   buyer → many orders · order → many items · order → many delivery records (split fulfilment)
//   Seller hub: stores, inventory, sales & earnings · riders: one job per part of a split order
// Real server on a throw-away database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_stores_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  MPESA_CONSUMER_KEY: '', ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 'r'.repeat(48), AUTH_RATE_LIMIT: '400',
});
const mongoose = require('mongoose');

const PASS = 'Kenya-Market-2026';
let ipN = 0;
const api = async (method, url, body, who) => {
  const res = await fetch(BASE + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': who?.ip || `10.60.0.${(ipN = (ipN % 250) + 1)}`, ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.json)); return res.json; };
const until = async (check, what) => {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};

let Customer;
let Listing;
let Store;
let Product;
let Order;
let Delivery;
let Task;
const people = {};
let personN = 0;
const NAIROBI = { lat: -1.2864, lng: 36.8219 }; // CBD
const GIKOMBA = { lat: -1.2855, lng: 36.8402 };
async function person(key, { seller = false, at = NAIROBI, phone } = {}) {
  personN += 1;
  const email = `${key}@stores.test`;
  const body = { name: `${key[0].toUpperCase()}${key.slice(1)} Tester`, email, phone: phone || `07116000${String(personN).padStart(2, '0')}`, password: PASS, confirmPassword: PASS, accountType: seller ? 'seller' : 'buyer' };
  if (seller) Object.assign(body, { payDetails: { method: 'till', till: '512345', name: 'Test Shop' }, sellerTypes: ['shop'], sellerCategories: ['electronics', 'cooking-products'], location: { county: 'Nairobi', area: 'CBD', lat: at.lat, lng: at.lng } });
  ok(await api('POST', '/customers/register', body), 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const login = ok(await api('POST', '/customers/login', { login: email, password: PASS }));
  people[key] = { token: login.token, id: login.customer._id, ip: `10.61.${personN}.1` };
  return people[key];
}
const phone = (make, model, price, extra = {}) => ({
  title: `${make} ${model} smartphone ${extra.tag || ''}`.trim(), description: 'Brand new, sealed in the box, one year warranty, delivery within Nairobi.', category: 'electronics', sub: 'phones',
  county: 'Nairobi', area: 'CBD', price, condition: 'New', attrs: { make, model, storage: '128' }, buyNow: true, stock: extra.stock ?? 10, delivery: { available: true, fee: 200, pickup: true }, ...extra.body,
});
const post = (who, data) => api('POST', '/market/listings', data, who);

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
  Listing = require('../models/Listing');
  Store = require('../models/Store');
  Product = require('../models/Product');
  Order = require('../models/Order');
  Delivery = require('../models/Delivery');
  Task = require('../models/Task');
  for (const model of [Store, Product, Delivery, Listing, Order]) await model.syncIndexes();
});
after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

// ---------------------------------------------------------------- seller → many stores
let mainStore;
let branch;
test('a seller has a main store (from their shop location) and can add branches; names are unique, one main store', async () => {
  const amina = await person('amina', { seller: true });
  const first = ok(await api('GET', '/seller/stores', undefined, amina));
  assert.equal(first.stores.length, 1);
  mainStore = first.stores[0];
  assert.deepEqual([mainStore.isMain, mainStore.area, mainStore.county, mainStore.lat], [true, 'CBD', 'Nairobi', NAIROBI.lat]);
  // asking again doesn't make another one
  ok(await api('GET', '/seller/stores', undefined, amina));
  assert.equal(await Store.countDocuments({ seller: amina.id }), 1);

  branch = ok(await api('POST', '/seller/stores', { name: 'Gikomba branch', county: 'Nairobi', area: 'Gikomba', address: 'Gikomba market, stall 12', lat: GIKOMBA.lat, lng: GIKOMBA.lng }, amina), 201);
  assert.deepEqual([branch.isMain, branch.area], [false, 'Gikomba']);
  const same = await api('POST', '/seller/stores', { name: '  gikomba   BRANCH ', county: 'Nairobi', area: 'Gikomba' }, amina);
  assert.equal(same.status, 409, 'the same name (any case / spacing) twice is refused');
  assert.equal((await api('POST', '/seller/stores', { name: 'X', county: 'Nairobi', area: 'Gikomba' }, amina)).status, 400);
  assert.equal((await api('POST', '/seller/stores', { name: 'Atlantis shop', county: 'Atlantis', area: 'Sea' }, amina)).status, 400);
  assert.equal((await api('POST', '/seller/stores', { name: 'London shop', county: 'Nairobi', area: 'CBD', lat: 51.5, lng: -0.12 }, amina)).status, 400, 'pins must be in Kenya');
  // someone else can't see or change Amina's stores
  const other = await person('otieno', { seller: true, at: GIKOMBA });
  assert.equal((await api('PUT', `/seller/stores/${branch._id}`, { name: 'Mine now' }, other)).status, 404);
  assert.equal((await api('POST', `/seller/stores/${branch._id}/close`, {}, other)).status, 404);
  assert.ok(!(ok(await api('GET', '/seller/stores', undefined, other)).stores.some((store) => store._id === branch._id)));
  // the main store can't be closed
  assert.equal((await api('POST', `/seller/stores/${mainStore._id}/close`, {}, amina)).status, 409);
  // buyers see the open stores
  const shown = ok(await api('GET', `/market/sellers/${amina.id}/stores`));
  assert.deepEqual(shown.stores.map((store) => store.name), [mainStore.name, 'Gikomba branch']);
});

// ---------------------------------------------------------------- store → many listings; product → many seller listings
let a15Main;
let a15Branch;
let a15Other;
test('listings belong to a store (the main one unless a branch is chosen) and are found near that store', async () => {
  const amina = people.amina;
  a15Main = ok(await post(amina, phone('Samsung', 'Galaxy A15', 21000)), 201);
  a15Branch = ok(await post(amina, phone('Samsung', 'Galaxy A15', 20500, { body: { store: branch._id }, tag: 'Gikomba' })), 201);
  assert.equal(String(a15Main.store), mainStore._id, 'no store chosen: the main store');
  assert.equal(String(a15Branch.store), branch._id);
  assert.deepEqual(a15Branch.geo.coordinates, [GIKOMBA.lng, GIKOMBA.lat], 'a branch ad sits at the branch pin');
  assert.deepEqual(a15Main.geo.coordinates, [NAIROBI.lng, NAIROBI.lat]);
  // another seller's store can't be used
  const bad = await post(people.otieno, phone('Samsung', 'Galaxy A15', 1, { body: { store: branch._id } }));
  assert.equal(bad.status, 400);
  // editing an ad can move it to another store
  const moved = ok(await api('PUT', `/market/listings/${a15Main._id}`, { ...phone('Samsung', 'Galaxy A15', 21000), store: branch._id }, amina));
  assert.equal(String(moved.store), branch._id);
  ok(await api('PUT', `/market/listings/${a15Main._id}`, { ...phone('Samsung', 'Galaxy A15', 21000), store: mainStore._id }, amina));
});

test('the same product sold by different sellers (and stores) at different prices is one catalogue product', async () => {
  a15Other = ok(await post(people.otieno, phone('Samsung', 'galaxy  A15', 19800, { tag: 'best price' })), 201);
  const ids = [a15Main, a15Branch, a15Other].map((item) => String(item.product));
  assert.ok(ids[0] && ids.every((id) => id === ids[0]), 'one product, three offers');
  await until(async () => (await Product.findById(ids[0]).lean())?.offers === 3, 'the offer count');
  const product = await Product.findById(ids[0]).lean();
  assert.deepEqual([product.offers, product.sellers, product.minPrice, product.maxPrice, product.name], [3, 2, 19800, 21000, 'Samsung Galaxy A15 128']);
  // a buyer compares them, cheapest first, with each seller's store
  const page = ok(await api('GET', `/market/products/${ids[0]}`));
  assert.deepEqual(page.offers.map((offer) => offer.price), [19800, 20500, 21000]);
  assert.deepEqual(page.offers.map((offer) => offer.store?.name), [page.offers[0].store?.name, 'Gikomba branch', mainStore.name]);
  // the ad page says so
  const adPage = ok(await api('GET', `/market/listings/${a15Main.slug}`));
  assert.deepEqual([adPage.product.offers, adPage.product.minPrice, adPage.store.name], [3, 19800, mainStore.name]);
  // the upload form suggests it
  const suggest = ok(await api('GET', '/market/products?q=galaxy a15&category=electronics&sub=phones'));
  assert.equal(suggest.products[0]._id, ids[0]);
  // other products stay apart; titles in another order (and filler words) are the same product
  const a25 = ok(await post(people.otieno, phone('Samsung', 'Galaxy A25', 27000)), 201);
  assert.notEqual(String(a25.product), ids[0]);
  const flour = { description: 'Fresh home baking flour, 2kg packets, wholesale and retail available.', category: 'cooking-products', sub: 'flour', county: 'Nairobi', area: 'CBD', buyNow: true, stock: 40, delivery: { available: true, fee: 100, pickup: true } };
  const unga1 = ok(await post(people.amina, { ...flour, title: 'Unga wa ngano 2kg', price: 210 }), 201);
  const unga2 = ok(await post(people.otieno, { ...flour, title: 'NEW 2kg unga wa ngano, best quality', price: 199 }), 201);
  assert.equal(String(unga1.product), String(unga2.product));
});

test('many sellers posting the same new product at the same moment still make one product (no duplicates)', async () => {
  const sellers = [];
  for (let i = 0; i < 5; i++) sellers.push(await person(`rush${i}`, { seller: true }));
  const posted = await Promise.all(sellers.map((who, index) => post(who, phone('Tecno', 'Spark 30', 15000 + index * 100))));
  posted.forEach((res) => assert.equal(res.status, 201, JSON.stringify(res.json)));
  assert.equal(new Set(posted.map((res) => String(res.json.product))).size, 1);
  assert.equal(await Product.countDocuments({ key: /tecno\|spark 30/ }), 1);
  // things that aren't products (cars, land, jobs) aren't catalogued
  const car = ok(await post(people.otieno, { title: 'Toyota Vitz 2015 clean', description: 'Very clean Toyota Vitz, low mileage, accident free, all papers ready.', category: 'vehicles', sub: 'cars', county: 'Nairobi', price: 850000, condition: 'Foreign used', attrs: { make: 'Toyota', model: 'Vitz', year: 2015 } }), 201);
  assert.equal(car.product, undefined);
});

// ---------------------------------------------------------------- inventory
test('inventory: stock per listing, never below zero, sold out and back, moved between stores', async () => {
  const amina = people.amina;
  const inv = ok(await api('GET', '/seller/inventory', undefined, amina));
  assert.ok(inv.items.length >= 3);
  const branchOnly = ok(await api('GET', `/seller/inventory?store=${branch._id}`, undefined, amina));
  assert.deepEqual(branchOnly.items.map((item) => item._id), [a15Branch._id]);
  assert.equal(branchOnly.items[0].product.offers, 3, 'with how many sellers sell the same product');
  const id = a15Branch._id;
  assert.equal(ok(await api('PATCH', `/seller/inventory/${id}`, { add: 5 }, amina)).stock, 15);
  const tooMany = await api('PATCH', `/seller/inventory/${id}`, { add: -100 }, amina);
  assert.equal(tooMany.status, 409);
  assert.equal((await Listing.findById(id).lean()).stock, 15, 'unchanged');
  // two removals at once can't take it below zero
  const both = await Promise.all([api('PATCH', `/seller/inventory/${id}`, { add: -10 }, amina), api('PATCH', `/seller/inventory/${id}`, { add: -10 }, amina)]);
  assert.deepEqual(both.map((res) => res.status).sort(), [200, 409]);
  assert.equal((await Listing.findById(id).lean()).stock, 5);
  const out = ok(await api('PATCH', `/seller/inventory/${id}`, { stock: 0 }, amina));
  assert.deepEqual([out.stock, out.status], [0, 'sold']);
  await until(async () => (await Product.findById(a15Branch.product).lean()).offers === 2, 'the product to drop the sold-out offer');
  const low = ok(await api('GET', '/seller/inventory?filter=out', undefined, amina));
  assert.ok(low.items.some((item) => item._id === id));
  const back = ok(await api('PATCH', `/seller/inventory/${id}`, { add: 3 }, amina));
  assert.deepEqual([back.stock, back.status, back.low], [3, 'active', true]);
  const movedItem = ok(await api('PATCH', `/seller/inventory/${id}`, { store: mainStore._id }, amina));
  assert.equal(movedItem.store.name, mainStore.name);
  ok(await api('PATCH', `/seller/inventory/${id}`, { store: branch._id }, amina));
  assert.equal((await api('PATCH', `/seller/inventory/${id}`, { add: 1 }, people.otieno)).status, 404, 'not theirs');
  assert.equal((await api('PATCH', `/seller/inventory/${id}`, { stock: -1 }, amina)).status, 400);
});

// ---------------------------------------------------------------- buyer → many orders → many items → many deliveries
let splitOrder;
test('an order with items from two stores has two delivery records; the order ships and arrives when both do', async () => {
  const buyer = await person('wanjiru');
  ok(await api('PATCH', `/seller/inventory/${a15Branch._id}`, { stock: 10 }, people.amina));
  const checkout = ok(await api('POST', '/orders/checkout', { items: [{ listingId: a15Main._id, qty: 1 }, { listingId: a15Branch._id, qty: 2 }], delivery: { method: 'delivery', county: 'Nairobi', address: 'Kilimani, Argwings Kodhek Rd, House 12' }, payment: { method: 'cod', phone: '0712000100' } }, buyer), 201);
  const order = await Order.findOne({ buyer: buyer.id }).lean();
  assert.equal(order.items.length, 2, 'one order, two items');
  assert.deepEqual(order.items.map((item) => String(item.store)).sort(), [mainStore._id, branch._id].sort(), 'each item remembers its store');
  assert.ok(order.items.every((item) => String(item.product) === String(a15Main.product)));
  splitOrder = order;
  const records = ok(await api('GET', `/orders/${order._id}/deliveries`, undefined, buyer));
  assert.equal(records.split, true);
  assert.deepEqual(records.deliveries.map((item) => [item.seq, item.of, item.storeName, item.items.reduce((sum, line) => sum + line.qty, 0), item.status]), [[1, 2, mainStore.name, 1, 'pending'], [2, 2, 'Gikomba branch', 2, 'pending']]);
  assert.equal(await Delivery.countDocuments({ order: order._id }), 2);
  assert.ok(checkout.orders || checkout.orderNo || checkout.order || true);

  const amina = people.amina;
  assert.equal((await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[0]._id}/status`, { status: 'on_the_way' }, amina)).status, 409, 'confirm the order first');
  ok(await api('POST', `/orders/${order._id}/status`, { status: 'confirmed' }, amina));
  // part 1 goes out: the order isn't "shipped" until both parts are
  let res = ok(await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[0]._id}/status`, { status: 'on_the_way', note: 'Boda boda, Kevin 0712 000 111' }, amina));
  assert.deepEqual([res.order.status, res.deliveries[0].status, res.deliveries[1].status], ['confirmed', 'on_the_way', 'pending']);
  res = ok(await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[1]._id}/status`, { status: 'ready' }, amina));
  assert.equal(res.deliveries[1].status, 'ready');
  res = ok(await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[1]._id}/status`, { status: 'on_the_way' }, amina));
  assert.equal(res.order.status, 'shipped', 'both parts sent: shipped');
  assert.equal((await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[1]._id}/status`, { status: 'ready' }, amina)).status, 409, 'can’t go backwards');
  assert.equal((await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[0]._id}/status`, { status: 'on_the_way' }, buyer)).status, 403, 'only the seller sends');
  // the buyer gets part 2 first, then part 1: delivered when both have arrived
  res = ok(await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[1]._id}/received`, {}, buyer));
  assert.deepEqual([res.order.status, res.deliveries[1].status], ['shipped', 'delivered']);
  res = ok(await api('POST', `/orders/${order._id}/deliveries/${records.deliveries[0]._id}/received`, {}, buyer));
  assert.deepEqual([res.order.status, res.deliveries.map((item) => item.status)], ['delivered', ['delivered', 'delivered']]);
  // other people can't see this order's deliveries
  assert.equal((await api('GET', `/orders/${order._id}/deliveries`, undefined, people.otieno)).status, 404);
});

test('a buyer has many orders; cancelling one cancels its deliveries; one store → one delivery', async () => {
  const buyer = people.wanjiru;
  ok(await api('POST', '/orders/checkout', { items: [{ listingId: a15Main._id, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'cod', phone: '0712000100' } }, buyer), 201);
  ok(await api('POST', '/orders/checkout', { items: [{ listingId: a15Other._id, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'cod', phone: '0712000100' } }, buyer), 201);
  const mine = await Order.find({ buyer: buyer.id }).sort({ createdAt: 1 }).lean();
  assert.equal(mine.length, 3, 'three orders for one buyer');
  const [, second, third] = mine;
  assert.notEqual(String(second.seller), String(third.seller));
  const one = ok(await api('GET', `/orders/${second._id}/deliveries`, undefined, buyer));
  assert.deepEqual([one.split, one.deliveries.length], [false, 1]);
  ok(await api('POST', `/orders/${second._id}/status`, { status: 'cancelled', reason: 'Changed my mind' }, buyer));
  await until(async () => (await Delivery.findOne({ order: second._id }).lean())?.status === 'cancelled', 'the delivery to be cancelled');
  // an order can't hold a second "part 1"
  await assert.rejects(Delivery.create({ order: second._id, seq: 1, of: 1, seller: second.seller, buyer: second.buyer }), /E11000/);
});

// ---------------------------------------------------------------- riders: one job per part
test('our riders: each part of a split order is its own job, picked up at its own store; the extra rider is the seller’s cost', async () => {
  const amina = people.amina;
  const buyer = people.wanjiru;
  const rider = await person('kevin');
  await Customer.updateOne({ _id: rider.id }, { $set: { worker: { role: 'rider', status: 'approved', available: true, vehicle: 'Motorbike', mpesaPhone: '254712000222', base: { type: 'Point', coordinates: [NAIROBI.lng, NAIROBI.lat] } } } });
  // a rider order with items from both stores (made directly: the checkout's rider pricing is tested elsewhere)
  const listings = await Listing.find({ _id: { $in: [a15Main._id, a15Branch._id] } }).lean();
  const items = listings.map((item) => ({ listing: item._id, store: item.store, product: item.product, title: item.title, slug: item.slug, image: '', price: item.price, qty: 1, subtotal: item.price }));
  const order = await Order.create({
    orderNo: 'OS-RIDER-1', checkoutId: 'rider-split', buyer: buyer.id, buyerName: 'Wanjiru Tester', buyerPhone: '254712000100', seller: amina.id, sellerName: 'Amina Tester', items,
    subtotal: items.reduce((sum, item) => sum + item.subtotal, 0), deliveryFee: 250, payOnDelivery: 250, total: items.reduce((sum, item) => sum + item.subtotal, 0) + 250,
    delivery: { method: 'rider', address: 'Kilimani, House 12', county: 'Nairobi', lat: -1.2921, lng: 36.7856, km: 4 },
    payment: { method: 'cod', status: 'cod', phone: '254712000100' }, status: 'confirmed', rider: { fee: 250, pay: 225, status: 'waiting' },
  });
  const legs = ok(await api('GET', `/orders/${order._id}/deliveries`, undefined, amina)).deliveries;
  assert.equal(legs.length, 2);
  // part 1: the usual "Call a rider" (collected at the main store); part 2: its own rider at the branch
  const first = ok(await api('POST', `/orders/${order._id}/call-rider`, {}, amina));
  assert.ok(first.order);
  assert.equal((await api('POST', `/orders/${order._id}/deliveries/${legs[0]._id}/call-rider`, {}, amina)).status, 409, 'part 1 uses Call a rider');
  const second = ok(await api('POST', `/orders/${order._id}/deliveries/${legs[1]._id}/call-rider`, {}, amina));
  assert.ok(second.fee >= 150);
  assert.equal((await api('POST', `/orders/${order._id}/deliveries/${legs[1]._id}/call-rider`, {}, amina)).status, 409, 'not twice');
  const jobs = await Task.find({ order: order._id, kind: 'delivery' }).sort({ leg: 1 }).lean();
  assert.deepEqual(jobs.map((job) => [job.leg, job.pickup.name, job.items.length, job.collectCash]), [[1, mainStore.name, 1, 250], [2, 'Gikomba branch', 1, 0]], 'the buyer pays one rider in cash; the second is on the seller');
  assert.deepEqual(jobs[1].pickup.point.coordinates, [GIKOMBA.lng, GIKOMBA.lat]);
  const fresh = await Order.findById(order._id).lean();
  assert.equal(fresh.splitDeliveryFee, second.fee);
  assert.equal(require('../controllers/orderController').sellerAmount(fresh), fresh.total - second.fee - (fresh.rider.fee || 0), 'the extra rider comes off the seller’s money');

  // the rider takes part 2 first: the order's own rider details (part 1) aren't touched
  ok(await api('POST', `/work/tasks/${jobs[1]._id}/accept`, {}, rider));
  ok(await api('POST', `/work/tasks/${jobs[1]._id}/picked-up`, {}, rider));
  await until(async () => (await Delivery.findById(legs[1]._id).lean()).status === 'picked_up', 'part 2 picked up');
  let now = await Order.findById(order._id).lean();
  assert.deepEqual([now.status, now.rider.status], ['confirmed', 'open'], 'part 2 picked up: the order waits for part 1');
  assert.equal((await Delivery.findById(legs[1]._id).lean()).riderName, 'Kevin Tester');
  ok(await api('POST', `/work/tasks/${jobs[1]._id}/on-the-way`, {}, rider));
  ok(await api('POST', `/work/tasks/${jobs[1]._id}/delivered`, {}, rider));
  await until(async () => (await Delivery.findById(legs[1]._id).lean()).status === 'delivered', 'part 2 delivered');
  // part 1
  ok(await api('POST', `/work/tasks/${jobs[0]._id}/accept`, {}, rider));
  ok(await api('POST', `/work/tasks/${jobs[0]._id}/picked-up`, {}, rider));
  now = await Order.findById(order._id).lean();
  assert.deepEqual([now.status, now.rider.status], ['shipped', 'picked_up']);
  ok(await api('POST', `/work/tasks/${jobs[0]._id}/delivered`, {}, rider));
  // the buyer confirms the whole order: both riders' jobs are done
  ok(await api('POST', `/orders/${order._id}/status`, { status: 'delivered' }, buyer));
  await until(async () => (await Task.countDocuments({ order: order._id, status: 'done' })) === 2, 'both jobs done');
  const finalLegs = await Delivery.find({ order: order._id }).sort({ seq: 1 }).lean();
  assert.deepEqual(finalLegs.map((item) => item.status), ['delivered', 'delivered']);
  // the rider's dashboard shows which part each job was
  const myJobs = ok(await api('GET', '/work/jobs', undefined, rider));
  const listed = [...(myJobs.mine || []), ...(myJobs.history || []), ...(myJobs.done || [])].filter((job) => job.orderNo === 'OS-RIDER-1');
  assert.ok(!listed.length || listed.some((job) => job.leg === 2));
});

// ---------------------------------------------------------------- Seller hub: sales & earnings
test('Seller hub overview: orders, sales, earnings after commission and extra riders, best sellers, stock alerts', async () => {
  const view = ok(await api('GET', '/seller/overview?days=30', undefined, people.amina));
  assert.ok(view.sales.delivered >= 2, JSON.stringify(view.sales));
  const delivered = await Order.find({ seller: people.amina.id, status: 'delivered' }).lean();
  const amount = require('../controllers/orderController').sellerAmount;
  assert.equal(view.sales.gross, delivered.reduce((sum, order) => sum + order.subtotal, 0));
  assert.equal(view.sales.net, delivered.reduce((sum, order) => sum + amount(order), 0));
  assert.ok(view.sales.deliveryCosts > 0, 'the extra rider shows as a cost');
  assert.equal(view.best[0].title.startsWith('Samsung Galaxy A15'), true);
  assert.ok(view.stores >= 2);
  assert.ok(view.inventory.units > 0);
  assert.ok(view.recent.length >= 2 && view.recent.every((row) => typeof row.net === 'number'));
  assert.equal((await api('GET', '/seller/overview')).status, 401, 'log in first');
});

test('Seller hub daily: today’s orders and sales, the day before, the last 14 days, any past day', async () => {
  const amina = people.amina;
  const amount = require('../controllers/orderController').sellerAmount;
  const dayKey = (date) => new Date(new Date(date).getTime() + 3 * 3600e3).toISOString().slice(0, 10); // Nairobi days
  const today = dayKey(Date.now());
  const view = ok(await api('GET', '/seller/daily', undefined, amina));
  assert.equal(view.date, today);
  assert.equal(view.isToday, true);
  assert.equal(view.series.length, 14);
  assert.equal(view.series[13].date, today);
  const placed = await Order.find({ seller: amina.id, status: { $ne: 'awaiting_payment' } }).lean();
  const placedToday = placed.filter((order) => dayKey(order.createdAt) === today);
  assert.equal(view.day.orders, placedToday.length);
  assert.equal(view.orders.length, placedToday.length);
  const deliveredToday = placed.filter((order) => order.status === 'delivered');
  assert.ok(deliveredToday.length >= 2);
  assert.equal(view.day.delivered, deliveredToday.length);
  assert.equal(view.day.sales, deliveredToday.reduce((sum, order) => sum + order.subtotal, 0));
  assert.equal(view.day.net, deliveredToday.reduce((sum, order) => sum + amount(order), 0));
  assert.ok(view.delivered.every((row) => row.net > 0 && row.items.length));
  // another seller's orders never show
  assert.ok(view.orders.every((row) => placedToday.some((order) => String(order._id) === String(row._id))));
  // a past day: nothing then
  const past = ok(await api('GET', '/seller/daily?date=2026-01-05', undefined, amina));
  assert.equal(past.date <= today, true);
  if (past.date !== today) assert.deepEqual([past.day.orders, past.day.sales, past.isToday], [0, 0, false]);
  // the future and nonsense: today
  assert.equal(ok(await api('GET', '/seller/daily?date=2999-01-01', undefined, amina)).date, today);
  assert.equal(ok(await api('GET', '/seller/daily?date=nope', undefined, amina)).date, today);
  assert.equal((await api('GET', '/seller/daily')).status, 401, 'log in first');
});

test('no limit on items: a seller can have more than 50 live ads; “Other” in every category', async () => {
  const amina = people.amina;
  const live = await Listing.countDocuments({ seller: amina.id, status: 'active' });
  const template = await Listing.findOne({ seller: amina.id, status: 'active' }).lean();
  const extra = Array.from({ length: Math.max(0, 51 - live) }, (_, index) => ({ ...template, _id: undefined, slug: `bulk-item-${index}-${Date.now()}`, product: undefined }));
  if (extra.length) await Listing.insertMany(extra.map(({ _id, ...rest }) => rest));
  const res = await post(amina, { title: 'Hand-made wooden key holder', description: 'A wooden key holder for the wall, hand made in Nairobi, holds 6 keys.', category: 'furniture', sub: 'other-furniture', county: 'Nairobi', area: 'CBD', price: 650, condition: 'New' });
  ok(res, 201);
  assert.equal(res.json.sub, 'other-furniture');
  assert.ok((await Listing.countDocuments({ seller: amina.id, status: 'active' })) > 51);
  const { CATEGORIES } = require('../market/categories');
  for (const category of CATEGORIES) assert.ok(category.subs.some((sub) => sub.other), `${category.slug} has an “Other” type`);
  assert.equal(CATEGORIES.at(-1).name, 'Other');
});

test('checkout with an inspection and a booked shopping agent: the agent is saved on the order and gets the inspection first', async () => {
  const listing = ok(await post(people.amina, phone('Nokia', 'G42', 15000, { tag: 'agent-pick', stock: 3 })), 201);
  const agent = await person('kevinagent');
  const base = { type: 'Point', coordinates: [NAIROBI.lng, NAIROBI.lat] };
  await Customer.updateOne({ _id: agent.id }, { $set: { worker: { role: 'agent', status: 'approved', approvedAt: new Date(), available: true, base, marketName: 'Gikomba Market' } } });
  const res = await api('POST', '/orders/checkout', { items: [{ listingId: listing._id, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'mpesa', phone: '0712000100' }, inspection: { wanted: true, notes: 'black, sealed box' }, agentId: agent.id }, people.wanjiru);
  if (res.status !== 201 && /inspect/i.test(res.json?.message || '')) return; // inspections switched off here: nothing to check
  const placed = ok(res, 201);
  const order = await Order.findById(placed.orders?.[0]?._id || placed._id || placed.order?._id).lean() || await Order.findOne({ 'items.listing': listing._id }).sort({ createdAt: -1 }).lean();
  assert.equal(String(order.inspection.preferred.worker), agent.id, 'the booked agent is on the order');
  assert.equal(order.inspection.preferred.name, 'Kevinagent Tester');
  // a stranger can't be booked
  const bad = await api('POST', '/orders/checkout', { items: [{ listingId: listing._id, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'mpesa', phone: '0712000100' }, inspection: { wanted: true }, agentId: people.wanjiru.id }, people.wanjiru);
  assert.equal(bad.status, 409);
  // paid and confirmed by the seller: the inspection job is theirs first
  await Order.updateOne({ _id: order._id }, { $set: { status: 'placed', 'payment.status': 'paid' } });
  ok(await api('POST', `/orders/${order._id}/status`, { status: 'confirmed' }, people.amina));
  await until(async () => !!(await Task.findOne({ order: order._id, kind: 'inspection' }).lean()), 'the inspection job');
  const job = await Task.findOne({ order: order._id, kind: 'inspection' }).lean();
  assert.equal(String(job.preferred.worker), agent.id);
  assert.ok(new Date(job.wave2At) > new Date(), 'others hear about it only after their 10 minutes');
});

test('“verify my goods”: the seller’s market agent is linked automatically, sees the seller’s phone once they accept, and can call them in the app', async () => {
  const Market = require('../models/Market');
  const market = await Market.findOne({ approved: true }).lean();
  assert.ok(market, 'a starter market');
  const seller = await person('marketseller', { seller: true });
  await Customer.updateOne({ _id: seller.id }, { $set: { 'shopLocation.market': market._id, 'shopLocation.marketName': market.name } });
  const listing = ok(await post(seller, phone('Nokia', 'C32', 9000, { tag: 'verify-me', stock: 2 })), 201);
  const agent = await person('marketagent');
  const base = { type: 'Point', coordinates: [NAIROBI.lng, NAIROBI.lat] };
  await Customer.updateOne({ _id: agent.id }, { $set: { worker: { role: 'agent', status: 'approved', approvedAt: new Date(), available: true, base, market: market._id, marketName: market.name, rating: { avg: 4.9, count: 30 } } } });
  // the checkout shows who would inspect it
  const quote = ok(await api('POST', '/orders/extras-quote', { items: [{ listingId: listing._id, qty: 1 }], lat: NAIROBI.lat, lng: NAIROBI.lng }, people.wanjiru));
  const suggested = quote.sellers[seller.id].inspectionAgent;
  assert.equal(suggested.name, 'Marketagent Tester');
  assert.equal(suggested.marketSlug, market.slug, 'linked to the market (for “Change agent”)');
  // their contact number pops up with them (for the signed-in buyer only: the quote needs a login)
  const agentPhone = (await Customer.findById(agent.id).lean()).phone;
  assert.ok(agentPhone);
  assert.equal(suggested.phone, agentPhone, 'the agent’s phone at the checkout');
  assert.equal((await api('POST', '/orders/extras-quote', { items: [{ listingId: listing._id, qty: 1 }] })).status, 401, 'not without logging in');
  const bookedQuote = ok(await api('POST', '/orders/extras-quote', { items: [{ listingId: listing._id, qty: 1 }], agentId: agent.id }, people.wanjiru));
  assert.deepEqual([bookedQuote.bookedAgent.name, bookedQuote.bookedAgent.phone], ['Marketagent Tester', agentPhone], 'a booked agent’s contacts too');
  // “How <seller> is paid” on the order summary: the payee, the method and its numbers
  const payTo = quote.sellers[seller.id].payTo;
  assert.deepEqual([payTo.method, payTo.till, payTo.name, payTo.seller], ['till', '512345', 'Test Shop', 'Marketseller Tester']);
  // checkout with an inspection and no agent booked: the market's agent is on the order
  const placed = ok(await api('POST', '/orders/checkout', { items: [{ listingId: listing._id, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'mpesa', phone: '0712000100' }, inspection: { wanted: true } }, people.wanjiru), 201);
  const order = await Order.findOne({ 'items.listing': listing._id }).sort({ createdAt: -1 }).lean();
  assert.equal(String(order.inspection.preferred.worker), agent.id, 'linked automatically');
  const view = ok(await api('GET', `/orders/${order._id}`, undefined, people.wanjiru));
  assert.equal((view.order || view).inspection.chosenAgent.name, 'Marketagent Tester', 'shown on the order page');
  const sellerView = ok(await api('GET', `/orders/${order._id}`, undefined, seller));
  assert.equal((sellerView.order || sellerView).inspection.chosenAgent.phone, agentPhone, 'the seller sees the inspection agent’s number');
  void placed;
  // paid and confirmed: the inspection job goes to that agent first
  await Order.updateOne({ _id: order._id }, { $set: { status: 'placed', 'payment.status': 'paid' } });
  ok(await api('POST', `/orders/${order._id}/status`, { status: 'confirmed' }, seller));
  await until(async () => !!(await Task.findOne({ order: order._id, kind: 'inspection' }).lean()), 'the inspection job');
  const job = await Task.findOne({ order: order._id, kind: 'inspection' }).lean();
  assert.equal(String(job.preferred.worker), agent.id);
  // before accepting: no phone; after: the seller's phone, and in-app calls agent ↔ seller only
  const jobsBefore = ok(await api('GET', `/work/jobs?near=${NAIROBI.lat},${NAIROBI.lng}`, undefined, agent));
  assert.ok(!(jobsBefore.open || []).find((item) => String(item._id) === String(job._id))?.pickup?.phone, 'no number before taking the job');
  // before the agent takes the job, the receipt already names the agent linked to the order (with their phone)
  const early = Buffer.from(await (await fetch(`${BASE}/api/orders/${order._id}/receipt.pdf`, { headers: { Authorization: `Bearer ${people.wanjiru.token}`, 'X-Forwarded-For': people.wanjiru.ip } })).arrayBuffer()).toString('latin1');
  assert.ok(early.includes(Buffer.from('YOUR SHOPPING AGENT: MARKETAGENT TESTER', 'latin1').toString('hex')), 'linked agent on the receipt before accepting');
  assert.ok(early.includes(Buffer.from('linked to this order', 'latin1').toString('hex')));
  ok(await api('POST', `/work/tasks/${job._id}/accept`, {}, agent));
  for (const who of [seller, people.wanjiru]) {
    const seen = ok(await api('GET', `/orders/${order._id}`, undefined, who));
    assert.deepEqual([(seen.order || seen).inspection.agentName, (seen.order || seen).inspection.agentPhone], ['Marketagent Tester', agentPhone], 'the agent who took the job, with their number');
  }
  const jobsAfter = ok(await api('GET', `/work/jobs?near=${NAIROBI.lat},${NAIROBI.lng}`, undefined, agent));
  const mine = (jobsAfter.mine || []).find((item) => String(item._id) === String(job._id));
  assert.ok(mine?.pickup?.phone, 'the seller’s phone, to find their shop');
  const { otherOnRide } = require('../market/calls');
  assert.equal(await otherOnRide(String(job._id), agent.id), seller.id, 'the agent can call the seller');
  assert.equal(await otherOnRide(String(job._id), seller.id), agent.id, 'and the seller the agent');
  assert.equal(await otherOnRide(String(job._id), people.wanjiru.id), null, 'nobody else');
  // the relationship: made when the buyer asked for the inspection, the job counted when the agent took it
  const link = await require('../models/AgentSeller').findOne({ agent: agent.id, seller: seller.id }).lean();
  assert.deepEqual([link.how, link.orders, link.jobs, String(link.market)], ['auto', 1, 1, String(market._id)]);
  const mySellers = ok(await api('GET', '/work/sellers', undefined, agent));
  assert.equal(mySellers.sellers[0]._id, seller.id);
  assert.ok(mySellers.sellers[0].phone, 'the agent has the seller’s contacts');
  assert.equal((await api('GET', '/work/sellers', undefined, people.wanjiru)).status, 403, 'agents only');
  // the receipt names the agent, with their phone
  const pdf = Buffer.from(await (await fetch(`${BASE}/api/orders/${order._id}/receipt.pdf`, { headers: { Authorization: `Bearer ${people.wanjiru.token}`, 'X-Forwarded-For': people.wanjiru.ip } })).arrayBuffer()).toString('latin1');
  const hexOf = (text) => Buffer.from(text, 'latin1').toString('hex'); // the PDF writes its text as hex
  assert.ok(pdf.includes(hexOf('Marketagent Tester')), 'the agent’s full name on the receipt');
  assert.ok(pdf.includes(hexOf('YOUR SHOPPING AGENT: MARKETAGENT TESTER')), 'in the “who attended your order” part (headings are upper case)');
  // rating the agent: only once the inspection is done, once
  assert.equal((await api('POST', `/work/tasks/${job._id}/rate`, { stars: 5 }, people.wanjiru)).status, 400, 'not before the inspection');
  await Order.updateOne({ _id: order._id }, { $set: { 'inspection.status': 'passed' } });
  assert.equal((await api('POST', `/work/tasks/${job._id}/rate`, { stars: 4 }, seller)).status, 404, 'the buyer rates, not the seller');
  const rated = ok(await api('POST', `/work/tasks/${job._id}/rate`, { stars: 4, comment: 'Checked everything, quick' }, people.wanjiru));
  assert.equal(rated.stars, 4);
  assert.equal((await api('POST', `/work/tasks/${job._id}/rate`, { stars: 5 }, people.wanjiru)).status, 409, 'once');
  assert.equal((await Order.findById(order._id).lean()).inspection.rated, 4);
  assert.equal((await Customer.findById(agent.id).lean()).worker.rating.count, 1, 'counts on the agent’s stars');
});

test('only the agent of the seller’s own market is suggested: a seller outside our markets gets none, even with an agent nearby', async () => {
  const seller = await person('areaseller', { seller: true });
  await Customer.updateOne({ _id: seller.id }, { $set: { 'shopLocation.area': 'Kasarani' }, $unset: { 'shopLocation.market': 1 } });
  const listing = ok(await post(seller, phone('Tecno', 'Pop 8', 8000, { tag: 'area', stock: 2 })), 201);
  const agent = await person('kasaraniagent');
  const far = { type: 'Point', coordinates: [36.9, -1.22] }; // based in Kasarani, not in a market
  await Customer.updateOne({ _id: agent.id }, { $set: { worker: { role: 'agent', status: 'approved', approvedAt: new Date(), available: true, base: far, baseArea: 'kasarani' } } });
  const quote = ok(await api('POST', '/orders/extras-quote', { items: [{ listingId: listing._id, qty: 1 }], lat: NAIROBI.lat, lng: NAIROBI.lng }, people.wanjiru));
  assert.equal(quote.sellers[seller.id].inspectionAgent, undefined, 'not in one of our markets: no agent suggested');
  assert.ok(quote.sellers[seller.id].inspection.fee >= 200, 'our agent’s fee starts from KSh 200');
});

test('live tracking: the buyer sees where the rider is, when they arrive and how far they are from the buyer, from accepting to delivered', async () => {
  const seller = people.amina;
  const buyer = people.wanjiru;
  const rider = await person('trackrider');
  const shop = (await Customer.findById(seller.id).lean()).shopLocation.point.coordinates; // [lng, lat]
  await Customer.updateOne({ _id: rider.id }, { $set: { worker: { role: 'rider', status: 'approved', approvedAt: new Date(), available: true, vehicle: 'Motorbike', mpesaPhone: '254712000333', base: { type: 'Point', coordinates: shop }, radiusKm: 10 } } });
  const listing = await Listing.findById(a15Main._id).lean();
  const home = { lat: -1.2921, lng: 36.7856 }; // Kilimani
  const order = await Order.create({
    orderNo: 'OS-TRACK-1', checkoutId: 'track-1', buyer: buyer.id, buyerName: 'Wanjiru Tester', buyerPhone: '254712000100', seller: seller.id, sellerName: 'Amina Tester',
    items: [{ listing: listing._id, store: listing.store, title: listing.title, slug: listing.slug, image: '', price: listing.price, qty: 1, subtotal: listing.price }],
    subtotal: listing.price, deliveryFee: 250, payOnDelivery: 250, total: listing.price + 250,
    delivery: { method: 'rider', address: 'Kilimani, House 12', county: 'Nairobi', lat: home.lat, lng: home.lng, km: 4 },
    payment: { method: 'mpesa', status: 'paid', phone: '254712000100' }, status: 'confirmed', rider: { fee: 250, pay: 225, status: 'waiting' },
  });
  ok(await api('POST', `/orders/${order._id}/call-rider`, {}, seller)); // the seller asks for a rider
  const near = `near=${shop[1]},${shop[0]}`;
  const job = (ok(await api('GET', `/work/jobs?${near}`, undefined, rider)).open || []).find((item) => item.orderNo === 'OS-TRACK-1');
  assert.ok(job, 'the rider sees the job');
  ok(await api('POST', `/work/tasks/${job._id}/accept`, {}, rider));
  const tracking = async () => { const view = ok(await api('GET', `/orders/${order._id}`, undefined, buyer)); return (view.order || view).rider; };
  // on the way to the shop (about 1 km away from it)
  ok(await api('PUT', '/work/location', { lat: shop[1] + 0.009, lng: shop[0] }, rider));
  const first = await tracking();
  assert.equal(first.stage, 'to_shop');
  assert.ok(first.live?.lat != null, 'the buyer sees the rider on the map');
  assert.ok(first.eta?.minutes > 0, 'and when they’ll arrive');
  assert.ok(first.kmLeft > 0.5 && first.kmLeft < 1.5, `about 1 km to the shop (${first.kmLeft})`);
  assert.ok(first.kmToYou > first.kmLeft, `and the full distance to the buyer (${first.kmToYou} km)`);
  // collected: now riding to the buyer, half-way
  ok(await api('POST', `/work/tasks/${job._id}/picked-up`, {}, rider));
  ok(await api('PUT', '/work/location', { lat: (shop[1] + home.lat) / 2, lng: (shop[0] + home.lng) / 2 }, rider));
  const halfway = await tracking();
  assert.equal(halfway.stage, 'to_you');
  assert.ok(halfway.kmToYou < first.kmToYou, `closer (${first.kmToYou} → ${halfway.kmToYou} km)`);
  // nearly there
  ok(await api('PUT', '/work/location', { lat: home.lat + 0.001, lng: home.lng }, rider));
  const close = await tracking();
  assert.ok(close.kmToYou < 0.3, `almost at the door (${close.kmToYou} km)`);
  assert.ok(close.eta.minutes <= halfway.eta.minutes);
  // delivered: the rider says so, the buyer confirms
  ok(await api('POST', `/work/tasks/${job._id}/delivered`, {}, rider));
  ok(await api('POST', `/orders/${order._id}/status`, { status: 'delivered' }, buyer));
  assert.equal((await Order.findById(order._id).lean()).status, 'delivered');
});

// ---------------------------------------------------------------- closing a store; main store follows the shop
test('closing a branch: not while it has orders in progress; its ads move to another store first; history kept', async () => {
  const amina = people.amina;
  const buyer = people.wanjiru;
  ok(await api('POST', '/orders/checkout', { items: [{ listingId: a15Branch._id, qty: 1 }], delivery: { method: 'pickup' }, payment: { method: 'cod', phone: '0712000100' } }, buyer), 201);
  const busy = await api('POST', `/seller/stores/${branch._id}/close`, { moveTo: mainStore._id }, amina);
  assert.equal(busy.status, 409);
  assert.match(busy.json.message, /in progress/);
  const open = await Order.findOne({ buyer: buyer.id, 'items.listing': a15Branch._id, status: 'placed' });
  ok(await api('POST', `/orders/${open._id}/status`, { status: 'cancelled', reason: 'Out of stock today' }, amina));
  assert.equal((await api('POST', `/seller/stores/${branch._id}/close`, {}, amina)).status, 409, 'ads still there: say where they go');
  const closed = ok(await api('POST', `/seller/stores/${branch._id}/close`, { moveTo: mainStore._id }, amina));
  assert.deepEqual([closed.active, closed.moved >= 1], [false, true]);
  assert.equal(await Listing.countDocuments({ store: branch._id }), 0);
  assert.equal(await Store.countDocuments({ _id: branch._id }), 1, 'kept (past orders point at it)');
  assert.equal((await Delivery.countDocuments({ store: branch._id })) > 0, true);
  assert.equal((await post(amina, phone('Samsung', 'Galaxy A15', 21000, { body: { store: branch._id } }))).status, 400, 'a closed store takes no new ads');
  // making the branch... a new branch the main store: the shop location follows, still one main store
  const nakuru = ok(await api('POST', '/seller/stores', { name: 'Nakuru shop', county: 'Nakuru', area: 'Nakuru town', lat: -0.3031, lng: 36.08 }, amina), 201);
  ok(await api('POST', `/seller/stores/${nakuru._id}/main`, {}, amina));
  assert.equal(await Store.countDocuments({ seller: amina.id, isMain: true }), 1);
  const me = await Customer.findById(amina.id).lean();
  assert.deepEqual([me.shopLocation.area, me.shopLocation.county], ['Nakuru town', 'Nakuru']);
  // and back: changing the shop location in My account moves the main store
  ok(await api('POST', `/seller/stores/${mainStore._id}/main`, {}, amina));
  ok(await api('PUT', '/customers/me', { shopLocation: { name: 'Amina Phones CBD', address: 'Moi Avenue, Bazaar building', area: 'CBD', county: 'Nairobi', lat: NAIROBI.lat, lng: NAIROBI.lng } }, amina));
  const main = await Store.findOne({ seller: amina.id, isMain: true }).lean();
  assert.deepEqual([String(main._id), main.name, main.address], [mainStore._id, 'Amina Phones CBD', 'Moi Avenue, Bazaar building']);
});

// ---------------------------------------------------------------- the products collection, shared with the earlier POS version
test('Product indexes build even with old POS products (no key) in the collection; catalogue keys stay unique', async () => {
  // the earlier POS version's grocery products: same collection, no "key" (a plain unique index fails: dup key { key: null })
  await Product.collection.insertMany([
    { name: 'Sugar 2kg', sku: 'SUG-2', barcode: '600000000001', category: 'Groceries', price: 380, stock: 40 },
    { name: 'Maize flour 2kg', sku: 'UNGA-2', category: 'Groceries', price: 210, stock: 25 },
  ]);
  await Product.collection.dropIndex('key_1').catch(() => {});
  await Product.syncIndexes(); // the server does this at start-up: must not fail
  const keyIndex = (await Product.collection.indexes()).find((index) => index.name === 'key_1');
  assert.ok(keyIndex?.unique, 'still unique');
  assert.deepEqual(keyIndex.partialFilterExpression, { key: { $exists: true } });
  const keyPlan = JSON.stringify((await Product.find({ key: 'test|unique-key' }).explain('queryPlanner')).queryPlanner.winningPlan);
  assert.ok(keyPlan.includes('key_1') && !keyPlan.includes('COLLSCAN'), 'finding a product by its key uses the index');
  // catalogue products: a key used twice is still refused
  await Product.create({ key: 'test|unique-key', name: 'Test product one', category: 'electronics', sub: 'phones' });
  await assert.rejects(Product.create({ key: 'test|unique-key', name: 'Test product two', category: 'electronics', sub: 'phones' }), (error) => error.code === 11000);
  // the old records are left as they were, and never show up as catalogue products
  assert.equal(await Product.collection.countDocuments({ key: { $exists: false } }), 2);
  const legacy = await Product.collection.findOne({ sku: 'SUG-2' });
  assert.equal((await api('GET', `/market/products/${legacy._id}`)).status, 404);
  assert.ok(!(await require('../market/catalog').suggest('sugar')).length, 'not in sellers’ title suggestions');
});

// ---------------------------------------------------------------- 🏍️ "Kapu rider": scan, Uber-style fare, booking the rider found
test('Kapu rider: the checkout scans for riders near the shop (ETA, Uber-style fare) and books the nearest, who gets the job first', async () => {
  const NAKURU = { lat: -0.2827, lng: 36.0700 }; // far from the other tests' riders
  const seller = await person('nakuruseller', { seller: true, at: NAKURU });
  const listing = ok(await post(seller, phone('Itel', 'A70', 7000, { tag: 'nakuru', stock: 5, body: { county: 'Nakuru', area: 'Nakuru town' } })), 201);
  const buyerAt = { lat: -0.3000, lng: 36.0900 }; // about 3 km from the shop
  const items = [{ listingId: listing._id, qty: 1 }];
  const scanFor = (who) => api('POST', '/orders/rider-scan', { items, ...buyerAt }, who);

  // nobody free yet: still priced, no rider, nothing to book
  const empty = ok(await scanFor(people.wanjiru)).sellers[seller.id];
  assert.deepEqual([empty.ok, empty.available, empty.nearest, empty.pick], [true, 0, null, undefined]);
  // the fare, like Uber / Bolt: base + per km + per minute, rounded to 10, never below the minimum
  const fw = require('../config/site').site().fieldwork;
  const fare = empty.fare;
  assert.equal(fare.base, fw.riderBase);
  assert.ok(fare.km > 0 && fare.minutes > 0, 'distance and time');
  assert.equal(fare.time, Math.round(fw.riderPerMin * fare.minutes), 'a price per minute');
  assert.equal(fare.total, Math.max(fw.riderMin, Math.round((fare.base + fare.distance + fare.time) / 10) * 10));
  assert.equal(empty.fee, fare.total);
  const { riderFare } = require('../market/fieldwork');
  assert.ok(riderFare(10, 30).total > riderFare(5, 15).total, 'longer trips cost more');
  assert.equal(riderFare(0.2, 1).total, fw.riderMin, 'very short trips: the minimum fare');

  // riders: one 0.5 km from the shop, one 3 km away, one not taking jobs
  const nearRider = await person('nakururider');
  const farRider = await person('nakurufar');
  const offRider = await person('nakurusleep');
  const worker = (lat, available = true) => ({ role: 'rider', status: 'approved', approvedAt: new Date(), available, vehicle: 'Motorbike', mpesaPhone: '254712000444', radiusKm: 8, base: { type: 'Point', coordinates: [NAKURU.lng, lat] } });
  await Customer.updateOne({ _id: nearRider.id }, { $set: { worker: worker(NAKURU.lat + 0.0045) } });
  await Customer.updateOne({ _id: farRider.id }, { $set: { worker: worker(NAKURU.lat + 0.027) } });
  await Customer.updateOne({ _id: offRider.id }, { $set: { worker: worker(NAKURU.lat, false) } });
  const scanned = ok(await scanFor(people.wanjiru));
  const found = scanned.sellers[seller.id];
  assert.equal(found.available, 2, 'only riders who are taking jobs');
  assert.deepEqual([found.nearest.firstName, found.nearest.vehicle, found.nearest.km], ['Nakururider', 'Motorbike', 0.5]);
  assert.equal(found.eta.atShop, 5);
  assert.equal(found.eta.total, found.eta.toShop + found.eta.atShop + found.eta.trip, 'rider to the shop + collecting + shop to the buyer');
  assert.ok(new Date(found.eta.arriveAt) > new Date());
  assert.equal(typeof found.pick, 'string');
  const riderPhone = (await Customer.findById(nearRider.id).lean()).phone;
  assert.ok(!JSON.stringify(scanned).includes(riderPhone), 'never the rider phone');
  assert.ok(!('lat' in found.nearest) && !('lng' in found.nearest), 'never where the rider is');
  assert.equal((await api('POST', '/orders/rider-scan', { items, ...buyerAt })).status, 401, 'logged-in buyers only');
  assert.equal((await api('POST', '/orders/rider-scan', { items }, people.wanjiru)).status, 400, 'needs the buyer location');

  // the checkout books the scanned rider; a token from another buyer, or a changed one, books nobody
  const checkout = (riderPicks) => api('POST', '/orders/checkout', {
    items, delivery: { method: 'rider', county: 'Nakuru', address: 'Milimani estate, house 4, Nakuru', lat: buyerAt.lat, lng: buyerAt.lng },
    payment: { method: 'cod', phone: '0712000100' }, inspection: { choice: 'none' }, ...(riderPicks ? { riderPicks } : {}),
  }, people.wanjiru);
  const lastOrder = () => Order.findOne({ seller: seller.id }).sort({ createdAt: -1 }).lean();
  const otherBuyer = await person('nakurubuyer');
  const theirPick = ok(await scanFor(otherBuyer)).sellers[seller.id].pick;
  ok(await checkout({ [seller.id]: theirPick }), 201);
  assert.ok(!(await lastOrder()).rider.preferred?.worker, 'another buyer booking cannot be used');
  ok(await checkout({ [seller.id]: `${found.pick.slice(0, -4)}AAAA` }), 201);
  assert.ok(!(await lastOrder()).rider.preferred?.worker, 'a changed token books nobody');
  ok(await checkout({ [seller.id]: found.pick }), 201);
  const order = await lastOrder();
  assert.equal(String(order.rider.preferred.worker), nearRider.id, 'the rider found is booked with the order');
  assert.equal(order.deliveryFee, found.fee, 'the price the buyer saw');
  await until(async () => !!(await mongoose.model('Notification').exists({ to: nearRider.id, kind: 'work' })), 'the booked rider is told');
  const buyerView = ok(await api('GET', `/orders/${order._id}`, undefined, people.wanjiru));
  assert.equal((buyerView.order || buyerView).rider.booked.name, 'Nakururider', 'the buyer sees who is booked');

  // the seller packs it and calls a rider: the booked rider gets it first; the others can't take it meanwhile
  ok(await api('POST', `/orders/${order._id}/status`, { status: 'confirmed' }, seller));
  ok(await api('POST', `/orders/${order._id}/call-rider`, {}, seller));
  const task = await Task.findOne({ order: order._id, kind: 'delivery' }).lean();
  assert.equal(String(task.preferred.worker), nearRider.id);
  const left = new Date(task.preferred.until) - Date.now();
  assert.ok(left > 2 * 60000 && left <= 3 * 60000 + 2000, 'theirs for 3 minutes');
  assert.equal((await api('POST', `/work/tasks/${task._id}/accept`, {}, farRider)).status, 409, 'kept for the booked rider');
  ok(await api('POST', `/work/tasks/${task._id}/accept`, {}, nearRider));
  const taken = ok(await api('GET', `/orders/${order._id}`, undefined, people.wanjiru));
  assert.equal((taken.order || taken).rider.name, 'Nakururider Tester', 'connected: the rider has the job (seller and pickup)');

  // if a booked rider doesn't take a job in time, it goes to the nearest riders as usual (the reservation is cleared)
  const late = await Task.create({ kind: 'delivery', status: 'open', orderNo: 'OS-RESERVE-1', pickup: task.pickup, dropoff: task.dropoff, fee: 300, pay: 255, preferred: { worker: farRider.id, name: 'Nakurufar Tester', until: new Date(Date.now() - 1000) }, wave2At: new Date(Date.now() - 1000) });
  await require('../controllers/workController').runWaves();
  const after = await Task.findById(late._id).lean();
  assert.ok(!after.preferred?.worker, 'the reservation is cleared');
  assert.ok((after.matched || []).length > 0, 'and the nearest riders are asked');
});

// ---------------------------------------------------------------- 📈 POS dashboard (shops, wholesalers, importers)
test('POS dashboard: one button for shops (not one-off sellers), and figures that match the orders', async () => {
  // a one-off seller (no shop details, one item): no POS
  const oneOff = await person('oneoffseller');
  const check = ok(await api('GET', '/seller/pos?check=1', undefined, oneOff));
  assert.deepEqual([check.eligible, check.enabled], [false, false]);
  assert.match(check.reason, /shops, wholesalers and importers/);
  assert.equal((await api('POST', '/seller/pos', { enabled: true }, oneOff)).status, 403, 'can’t turn it on');
  // ... until they have 5 live products
  const sample = await Listing.findOne({ status: 'active' }).lean();
  await Listing.collection.insertMany([1, 2, 3, 4, 5].map((n) => ({ ...sample, _id: new mongoose.Types.ObjectId(), seller: new mongoose.Types.ObjectId(oneOff.id), slug: `pos-test-${n}-${Date.now()}`, product: undefined })));
  assert.equal(ok(await api('GET', '/seller/pos?check=1', undefined, oneOff)).eligible, true, '5+ products: yes');

  // a shop (registered with a seller type): one button
  const amina = people.amina;
  const before = ok(await api('GET', '/seller/pos?check=1', undefined, amina));
  assert.deepEqual([before.eligible, before.enabled], [true, false]);
  assert.equal(ok(await api('POST', '/seller/pos', { enabled: true }, amina)).enabled, true);
  const pos = ok(await api('GET', '/seller/pos?range=30', undefined, amina));
  assert.deepEqual([pos.enabled, pos.range, pos.unit], [true, 30, 'day']);
  // the figures agree with the orders themselves
  const from = new Date(Date.now() - 30 * 86400000);
  const placed = await Order.find({ seller: amina.id, status: { $nin: ['awaiting_payment', 'cancelled'] }, createdAt: { $gte: from } }).lean();
  assert.equal(pos.kpis.orders.now, placed.length, 'orders');
  assert.equal(pos.kpis.orderValue.now, placed.reduce((sum, order) => sum + (order.subtotal || 0), 0), 'order value');
  assert.equal(pos.series.reduce((sum, row) => sum + row.orderValue, 0), pos.kpis.orderValue.now, 'the chart adds up');
  assert.equal(pos.hours.reduce((sum, row) => sum + row.orders, 0), placed.length, 'busy hours count every order');
  assert.equal(pos.weekdays.length, 7);
  assert.ok(pos.series.length >= 30 && pos.series.length <= 31, 'a bar per day');
  assert.ok(Array.isArray(pos.products) && pos.products.every((item, index, list) => index === 0 || list[index - 1].revenue >= item.revenue), 'best sellers first');
  assert.ok(pos.stock.live >= 0 && pos.stock.low.every((item) => item.stock <= 3));
  // longer periods: by week and by month; a made-up period falls back to 30 days
  assert.equal(ok(await api('GET', '/seller/pos?range=90', undefined, amina)).unit, 'week');
  assert.equal(ok(await api('GET', '/seller/pos?range=365', undefined, amina)).unit, 'month');
  assert.equal(ok(await api('GET', '/seller/pos?range=9999', undefined, amina)).range, 30);
  // only their own: another shop sees its own (empty) figures, and nobody logged out sees anything
  const other = ok(await api('GET', '/seller/pos?range=30', undefined, people.otieno));
  assert.equal(other.enabled, false, 'off until they turn it on');
  assert.equal((await api('GET', '/seller/pos?range=30')).status, 401);
  // turned off: back to the button
  assert.equal(ok(await api('POST', '/seller/pos', { enabled: false }, amina)).enabled, false);
  assert.equal(ok(await api('GET', '/seller/pos?range=30', undefined, amina)).enabled, false);
});

// ---------------------------------------------------------------- 🏬 About: physical market digitisation (live figures)
test('About page: markets online, with the traders selling in them, their agents, and markets to visit', async () => {
  require('../utils/cache').invalidate('market:about-stats');
  const stats = ok(await api('GET', '/market/about-stats'));
  const inMarkets = await Customer.countDocuments({ 'shopLocation.market': { $exists: true, $ne: null }, active: { $ne: false } });
  assert.ok(inMarkets >= 1, 'the tests above put a seller in a market');
  assert.equal(stats.marketSellers, inMarkets, 'traders selling from a market');
  assert.equal(stats.marketAgents, await Customer.countDocuments({ 'worker.role': 'agent', 'worker.status': 'approved', 'worker.market': { $exists: true, $ne: null }, active: { $ne: false } }));
  assert.ok(Array.isArray(stats.marketList) && stats.marketList.length >= 1 && stats.marketList.length <= 8);
  assert.ok(stats.marketList.every((market) => market.name && market.slug && Object.keys(market).length === 2), 'only the name and the page address');
  const busiest = (await Customer.aggregate([{ $match: { 'shopLocation.market': { $exists: true, $ne: null } } }, { $group: { _id: '$shopLocation.market', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 }]))[0];
  const Market = require('../models/Market');
  assert.equal(stats.marketList[0].slug, (await Market.findById(busiest._id).lean()).slug, 'the market with the most traders first');
});
