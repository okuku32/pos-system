// 🪪 Riders' documents (private files, expiry dates checked by moderators) and 📸 buyers' photo requests.
//   cd server && npm run test:docs        Real server on a throw-away database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PORT = 5192;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_docs_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  MPESA_CONSUMER_KEY: '', ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 'r'.repeat(48), AUTH_RATE_LIMIT: '400',
});
const mongoose = require('mongoose');

const PASS = 'Kenya-Market-2026';
let ipN = 0;
const ip = () => `10.70.${Math.floor((ipN += 1) / 250)}.${ipN % 250}`;
const headers = (who) => ({ 'X-Forwarded-For': who?.ip || ip(), ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) });
const api = async (method, url, body, who) => {
  const res = await fetch(BASE + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...headers(who) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const send = async (url, fields, fileField, fileList, who) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  for (const file of fileList) form.append(fileField, new Blob([file.bytes], { type: file.type }), file.name);
  const res = await fetch(BASE + '/api' + url, { method: 'POST', headers: headers(who), body: form });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const raw = (url, who) => fetch(BASE + '/api' + url, { headers: headers(who) });
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.json)); return res.json; };
const PNG = { bytes: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]), type: 'image/png', name: 'licence.png' };
const PDF = { bytes: Buffer.from('%PDF-1.4\n% test document\n'), type: 'application/pdf', name: 'insurance.pdf' };
const FAKE = { bytes: Buffer.from('<?php system($_GET["c"]); ?>'), type: 'image/png', name: 'shell.png' };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let Customer;
let staff;
const NAIROBI = { lat: -1.2864, lng: 36.8219 };
let personN = 0;
async function person(key, { seller = false } = {}) {
  personN += 1;
  const email = `${key}@docs.test`;
  const body = { name: `${key[0].toUpperCase()}${key.slice(1)} Tester`, email, phone: `07126000${String(personN).padStart(2, '0')}`, password: PASS, confirmPassword: PASS, accountType: seller ? 'seller' : 'buyer' };
  if (seller) Object.assign(body, { payDetails: { method: 'till', till: '512345', name: 'Test Shop' }, sellerTypes: ['shop'], sellerCategories: ['electronics'], location: { county: 'Nairobi', area: 'CBD', lat: NAIROBI.lat, lng: NAIROBI.lng } });
  ok(await api('POST', '/customers/register', body), 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const login = ok(await api('POST', '/customers/login', { login: email, password: PASS }));
  return { token: login.token, id: login.customer._id, ip: ip() };
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
  const User = require('../models/User');
  await User.create({ name: 'Doc Checker', email: 'mod@docs.test', password: 'Admin-pass-2026', role: 'admin' });
  const gate = await require('../middleware/staffGate').loadGate();
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Gate': gate, 'X-Forwarded-For': ip() }, body: JSON.stringify({ email: 'mod@docs.test', password: 'Admin-pass-2026' }) });
  staff = { token: (await login.json()).token, ip: ip() };
});
after(async () => {
  // remove the files this run made (ad photos, request photos, riders' documents): only those its own test database names
  const db = mongoose.connection.db;
  const gone = (file) => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
  const SERVER = path.join(__dirname, '..');
  for (const listing of await db.collection('listings').find({}).project({ images: 1 }).toArray().catch(() => [])) {
    for (const url of listing.images || []) if (/^\/uploads\/listings\/[a-f0-9]{24}\.\w+$/.test(url)) gone(path.join(SERVER, url));
  }
  for (const request of await db.collection('photorequests').find({}).project({ photos: 1 }).toArray().catch(() => [])) {
    for (const photo of request.photos || []) if (/^[a-f0-9]{24}\.\w+$/.test(photo.file || '')) gone(path.join(SERVER, 'private', 'requests', photo.file));
  }
  for (const person of await db.collection('customers').find({ 'worker.docs.0': { $exists: true } }).project({ 'worker.docs': 1 }).toArray().catch(() => [])) {
    for (const doc of person.worker.docs || []) if (/^[a-f0-9]{24}\.\w+$/.test(doc.file || '')) gone(path.join(SERVER, 'private', 'worker-docs', doc.file));
  }
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

// ---------------------------------------------------------------- riders' documents
let rider;
let licence;
test('a rider uploads documents with expiry dates; they are private (no public URL, owner and staff only)', async () => {
  rider = await person('rider');
  await Customer.updateOne({ _id: rider.id }, { $set: { worker: { role: 'rider', status: 'approved', approvedAt: new Date(), available: true, vehicle: 'Motorbike', plate: 'KMFA 123B', mpesaPhone: '254712000222', base: { type: 'Point', coordinates: [NAIROBI.lng, NAIROBI.lat] } } } });
  const first = ok(await api('GET', '/work/docs', undefined, rider));
  assert.deepEqual(first.summary.missing, ['id', 'licence', 'insurance'], 'a motorbike rider needs ID, driving licence and insurance');

  assert.equal((await send('/work/docs', { kind: 'licence', number: 'DL123' }, 'file', [PNG], rider)).status, 400, 'a licence needs its expiry date');
  assert.equal((await send('/work/docs', { kind: 'licence', expiresAt: day(-3) }, 'file', [PNG], rider)).status, 400, 'an expired licence is refused');
  const fake = await send('/work/docs', { kind: 'licence', expiresAt: day(300) }, 'file', [FAKE], rider);
  assert.equal(fake.status, 400, 'a script pretending to be a photo is refused');
  const privateDir = path.join(__dirname, '..', 'private', 'worker-docs');
  const recent = fs.existsSync(privateDir) ? fs.readdirSync(privateDir).filter((name) => Date.now() - fs.statSync(path.join(privateDir, name)).mtimeMs < 3000) : [];
  assert.equal(recent.length, 0, 'nothing kept on disk');

  licence = ok(await send('/work/docs', { kind: 'licence', number: 'DL-0042', expiresAt: day(20) }, 'file', [PNG], rider), 201).doc;
  assert.deepEqual([licence.kind, licence.status, licence.state, licence.days >= 19 && licence.days <= 21], ['licence', 'pending', 'expiring', true]);
  const insurance = ok(await send('/work/docs', { kind: 'insurance', expiresAt: day(200) }, 'file', [PDF], rider), 201);
  assert.equal(insurance.doc.pdf, true);
  assert.deepEqual(insurance.summary.missing, ['id']);
  assert.equal(insurance.summary.expiring, 1);

  // the file: the rider can open it (never cached); nobody else can; it isn't in the public uploads
  const mine = await raw(licence.file, rider);
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get('cache-control'), /no-store/);
  assert.equal(mine.headers.get('content-type'), 'image/png');
  const stranger = await person('stranger');
  assert.equal((await raw(licence.file, stranger)).status, 404, 'another customer can’t open it');
  assert.equal((await raw(licence.file)).status, 401, 'not without logging in');
  const stored = (await Customer.findById(rider.id).lean()).worker.docs[0].file;
  assert.equal((await fetch(`${BASE}/uploads/${stored}`)).status, 404, 'never served from the public uploads');
  assert.equal((await fetch(`${BASE}/private/worker-docs/${stored}`)).ok, false);
});

test('moderators see whose documents expire, open them (audited), correct the expiry date, approve or reject', async () => {
  const list = ok(await api('GET', '/work/admin/workers?role=rider', undefined, staff));
  const row = list.workers.find((item) => item._id === rider.id);
  assert.deepEqual([row.docs.expiring, row.docs.pending, row.docs.missing], [1, 2, ['id']]);
  assert.ok(ok(await api('GET', '/work/admin/workers?docs=expiring', undefined, staff)).workers.some((item) => item._id === rider.id));
  assert.equal(ok(await api('GET', '/work/admin/workers?docs=expired', undefined, staff)).workers.length, 0);

  const docs = ok(await api('GET', `/work/admin/workers/${rider.id}/docs`, undefined, staff));
  assert.deepEqual([docs.worker.plate, docs.docs.length], ['KMFA 123B', 2]);
  const lic = docs.docs.find((doc) => doc.kind === 'licence');
  const file = await raw(lic.file, staff);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('cache-control'), /no-store/);
  const AuditLog = mongoose.models.AuditLog;
  let logged = false; // the audit entry is written in the background: give it a moment
  for (let i = 0; i < 40 && !logged; i++) { logged = !!(await AuditLog.exists({ action: 'worker.doc.view' })); if (!logged) await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.ok(logged, 'every look at a rider’s document is logged');
  assert.equal((await raw(lic.file, rider)).status, 401, 'a customer token can’t use the staff route');

  assert.equal((await api('POST', `/work/admin/workers/${rider.id}/docs/${lic._id}`, { action: 'reject' }, staff)).status, 400, 'a rejection needs a reason');
  // the date on the licence is later than what the rider typed: the moderator corrects it, then approves
  const approved = ok(await api('POST', `/work/admin/workers/${rider.id}/docs/${lic._id}`, { action: 'approve', expiresAt: day(400) }, staff));
  assert.deepEqual([approved.doc.status, approved.doc.state], ['approved', 'valid']);
  assert.ok(await mongoose.model('Notification').exists({ to: rider.id, kind: 'work' }), 'the rider is told');
  assert.equal((await api('DELETE', `/work/docs/${lic._id}`, undefined, rider)).status, 409, 'an approved document is replaced, not deleted');
});

test('an expired driving licence stops new jobs; reminders go out once per stage (30 days, 7 days, expired)', async () => {
  const docs = (await Customer.findById(rider.id).lean()).worker.docs;
  const lic = docs.find((doc) => doc.kind === 'licence');
  await Customer.updateOne({ _id: rider.id }, { $set: { 'worker.docs.$[d].expiresAt': new Date(Date.now() - 86400000), 'worker.docs.$[d].reminded': '7' } }, { arrayFilters: [{ 'd._id': lic._id }] });
  const accept = await api('POST', `/work/tasks/${new mongoose.Types.ObjectId()}/accept`, {}, rider);
  assert.equal(accept.status, 403);
  assert.match(accept.json.message, /driving licence expired/i);
  const me = ok(await api('GET', '/work/me', undefined, rider));
  assert.match(me.docs.blocked, /Upload the renewed one/);
  assert.ok(ok(await api('GET', '/work/admin/workers?docs=expired', undefined, staff)).workers.some((item) => item._id === rider.id));

  const Notification = mongoose.model('Notification');
  const before = await Notification.countDocuments({ to: rider.id });
  const { runDocReminders } = require('../controllers/workerDocsController');
  assert.equal(await runDocReminders(), 1, 'the expired licence (the insurance is months away)');
  assert.equal(await runDocReminders(), 0, 'not twice');
  assert.equal(await Notification.countDocuments({ to: rider.id }), before + 1);

  // the renewed licence replaces the old one (old file removed), and jobs are open again
  const oldFile = path.join(__dirname, '..', 'private', 'worker-docs', lic.file);
  assert.ok(fs.existsSync(oldFile));
  const renewed = ok(await send('/work/docs', { kind: 'licence', expiresAt: day(700) }, 'file', [PNG], rider), 201);
  assert.equal(renewed.summary.blocked, '');
  assert.equal((await Customer.findById(rider.id).lean()).worker.docs.filter((doc) => doc.kind === 'licence').length, 1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(!fs.existsSync(oldFile), 'the expired file is deleted');
  assert.equal((await api('POST', `/work/tasks/${new mongoose.Types.ObjectId()}/accept`, {}, rider)).status, 409, 'no longer blocked (that job just isn’t open)');
});

test('the rider’s location answers with the nearest named place ("you are near …")', async () => {
  const res = ok(await api('PUT', '/work/location', { lat: NAIROBI.lat, lng: NAIROBI.lng }, rider));
  assert.ok(res.near?.name, JSON.stringify(res));
  assert.ok(res.near.km < 15);
});

// ---------------------------------------------------------------- buyers' photo requests
test('a buyer sends a seller a photo of an item that isn’t in their ads; the seller posts it in one step; the buyer can buy it', async () => {
  const seller = await person('shopkeeper', { seller: true });
  const buyer = await person('buyer');
  const nosy = await person('nosy');
  ok(await api('POST', '/market/listings', { title: 'Samsung Galaxy A15 phone', description: 'Brand new, sealed in the box, one year warranty, delivery within Nairobi.', category: 'electronics', sub: 'phones', county: 'Nairobi', area: 'CBD', price: 18000, condition: 'New', attrs: { make: 'Samsung', model: 'Galaxy A15', storage: '128' }, buyNow: true, stock: 3, delivery: { available: true, fee: 0, pickup: true } }, seller), 201);

  assert.equal((await send('/market/photo-requests', { sellerId: seller.id, what: 'Phone cover' }, 'photos', [], buyer)).status, 400, 'a photo is needed');
  assert.equal((await send('/market/photo-requests', { sellerId: seller.id, what: 'Phone cover' }, 'photos', [FAKE], buyer)).status, 400, 'only real photos');
  assert.equal((await send('/market/photo-requests', { sellerId: seller.id, what: 'Phone cover' }, 'photos', [PNG], seller)).status, 400, 'not to yourself');
  const request = ok(await send('/market/photo-requests', { sellerId: seller.id, what: 'Clear A15 phone cover', note: 'The transparent one on your shelf', qty: 2, budget: 500 }, 'photos', [PNG, PNG], buyer), 201);
  assert.deepEqual([request.status, request.photos.length, request.qty, request.budget], ['open', 2, 2, 500]);
  assert.ok(await mongoose.model('Notification').exists({ to: seller.id, kind: 'request' }), 'the seller is told');

  const received = ok(await api('GET', '/market/photo-requests?box=received', undefined, seller));
  assert.equal(received.requests.length, 1);
  assert.equal((await raw(request.photos[0], seller)).status, 200, 'the seller sees the photo');
  assert.equal((await raw(request.photos[0], buyer)).status, 200);
  assert.equal((await raw(request.photos[0], nosy)).status, 404, 'nobody else does');
  assert.equal((await api('POST', `/market/photo-requests/${request._id}/answer`, { action: 'create', title: 'Clear A15 cover', price: 450, stock: 5 }, buyer)).status, 404, 'only the seller answers');

  const answered = ok(await api('POST', `/market/photo-requests/${request._id}/answer`, { action: 'create', title: 'Clear phone cover for Samsung A15', price: 450, stock: 5, note: 'Yes, I have 5' }, seller));
  assert.deepEqual([answered.status, answered.answer.price, answered.answer.created], ['answered', 450, true]);
  const ad = ok(await api('GET', `/market/listings/${answered.answer.listingSlug}`));
  const adListing = ad.listing || ad;
  assert.deepEqual([adListing.buyNow, adListing.stock, adListing.category], [true, 5, 'other'], 'a real ad that can go in the cart');
  assert.equal(adListing.images.length, 2, 'with the buyer’s photos');
  const photo = await fetch(BASE + adListing.images[0]);
  assert.equal(photo.status, 200, 'copied to the public ad photos');
  assert.match(photo.headers.get('cache-control') || '', /max-age=31536000.*immutable/, 'photos never change: browsers and the CDN keep them a year');
  assert.equal((await api('POST', `/market/photo-requests/${request._id}/answer`, { action: 'decline' }, seller)).status, 409, 'answered once');

  const sent = ok(await api('GET', '/market/photo-requests', undefined, buyer));
  assert.equal(sent.requests[0].answer.listingSlug, answered.answer.listingSlug);

  // "it's this ad" and "I don't have it"; the buyer can withdraw an open one
  const second = ok(await send('/market/photo-requests', { sellerId: seller.id, what: 'Galaxy A15 phone' }, 'photos', [PNG], buyer), 201);
  const own = ok(await api('GET', '/market/mine', undefined, seller));
  const phoneAd = (own.items || own.listings || own).find((item) => /Galaxy A15 phone/.test(item.title));
  ok(await api('POST', `/market/photo-requests/${second._id}/answer`, { action: 'listing', listingId: phoneAd._id }, seller));
  const third = ok(await send('/market/photo-requests', { sellerId: seller.id, what: 'Red iPhone 15' }, 'photos', [PNG], buyer), 201);
  assert.equal(ok(await api('POST', `/market/photo-requests/${third._id}/answer`, { action: 'decline', note: 'Not in stock' }, seller)).status, 'declined');
  const fourth = ok(await send('/market/photo-requests', { sellerId: seller.id, what: 'Charger' }, 'photos', [PNG], buyer), 201);
  assert.equal(ok(await api('POST', `/market/photo-requests/${fourth._id}/cancel`, {}, buyer)).status, 'cancelled');

  // our team sees them all, and the photos (audited)
  const team = ok(await api('GET', '/market/admin/photo-requests', undefined, staff));
  assert.deepEqual([team.requests.length, team.counts.answered, team.counts.declined, team.counts.cancelled], [4, 2, 1, 1]);
  assert.equal((await raw(team.requests[0].photos[0], staff)).status, 200);
  assert.equal((await api('GET', '/market/admin/photo-requests', undefined, buyer)).status, 401);
});
