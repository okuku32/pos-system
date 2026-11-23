// Automatic security tests:   cd server && npm run test:security
// Starts the real server on a throw-away database (kapu_security_test) and attacks it: injection, XSS,
// CSRF, other people's records, roles, sessions, brute force, uploads, error leaks, fake M-Pesa callbacks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_security_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'true',
  MPESA_CONSUMER_KEY: '', SMTP_HOST: '', SMTP_USER: '', ANTHROPIC_API_KEY: '', PUBLIC_API_URL: 'https://shop.example.test',
  CLIENT_URL: 'https://shop.example.test', SHOP_URL: 'https://shop.example.test', JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(48), AUTH_RATE_LIMIT: '40',
});
const mongoose = require('mongoose');

// ---------------------------------------------------------------- tiny HTTP client with a cookie jar
class Client {
  constructor() {
    this.jar = {};
    this.raw = {};
  }
  cookieHeader() {
    return Object.entries(this.jar).map(([key, value]) => `${key}=${value}`).join('; ');
  }
  async req(method, url, { body, headers = {}, bearer, csrf = true, origin, form } = {}) {
    const height = { ...headers };
    if (body !== undefined && !form) height['Content-Type'] = 'application/json';
    if (bearer) height.Authorization = `Bearer ${bearer}`;
    const ck = this.cookieHeader();
    if (ck) height.Cookie = ck;
    if (csrf && this.jar.os_csrf && method !== 'GET') height['X-CSRF-Token'] = decodeURIComponent(this.jar.os_csrf);
    if (origin) height.Origin = origin;
    const res = await fetch(BASE + url, { method, headers: height, body: form || (body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
    for (const item of res.headers.getSetCookie()) {
      const [pair] = item.split(';');
      const currentOf = pair.indexOf('=');
      const currentPair = pair.slice(0, currentOf);
      const pairItem = pair.slice(currentOf + 1);
      this.raw[currentPair] = item;
      if (pairItem === '' || /expires=Thu, 01 Jan 1970/i.test(item)) delete this.jar[currentPair];
      else this.jar[currentPair] = pairItem;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, json, text };
  }
  get(url, order) { return this.req('GET', url, order); }
  post(url, body, order = {}) { return this.req('POST', url, { ...order, body }); }
}
const anon = () => new Client();
const leaks = (result) => /node_modules|at [A-Za-z.]+ \(|MongoServerError|E11000|stack|\\server\\|\/server\//.test(result.text);

let User, Customer, Order, AuditLog, gate;
const accounts = {};

// sign up (unverified, not logged in), confirm the email (as the emailed link would), then log in
async function register(name, email, phone) {
  const anonResult = anon();
  const response = await anonResult.post('/api/customers/register', { name, email, phone, password: 'Safe-pass-2026', confirmPassword: 'Safe-pass-2026' });
  assert.equal(response.status, 201, `register ${email}: ${response.text}`);
  assert.ok(!response.json.token, 'sign-up must not log in');
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const login = await anonResult.post('/api/customers/login', { login: email, password: 'Safe-pass-2026' });
  assert.equal(login.status, 200, `login ${email}: ${login.text}`);
  return { client: anonResult, token: login.json.token, id: login.json.customer._id };
}
async function staffLogin(email, password) {
  const anonResult = anon();
  const response = await anonResult.post('/api/auth/login', { email, password }, { headers: { 'X-Staff-Gate': gate } });
  assert.equal(response.status, 200, `staff login ${email}: ${response.text}`);
  return { client: anonResult, token: response.json.token };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  require('../server'); // starts listening on PORT
  for (let index = 0; index < 100; index++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok && mongoose.connection.readyState === 1) break;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  User = require('../models/User');
  Customer = require('../models/Customer');
  Order = require('../models/Order');
  AuditLog = require('../security/audit').AuditLog;
  gate = await require('../middleware/staffGate').loadGate();
  await User.create({ name: 'Boss', email: 'boss@example.test', password: 'Admin-pass-2026', role: 'admin' });
  await User.create({ name: 'Mod', email: 'mod@example.test', password: 'Mod-pass-2026', role: 'moderator', perms: ['support'] });
  accounts.a = await register('Alice Buyer', 'alice@example.test', '0711000001');
  accounts.b = await register('Brian Buyer', 'brian@example.test', '0711000002');
  accounts.s = await register('Sam Seller', 'sam@example.test', '0711000003');
  accounts.order = await Order.create({
    orderNo: 'SEC-1', buyer: accounts.a.id, seller: accounts.s.id, buyerName: 'Alice Buyer', sellerName: 'Sam Seller', items: [{ title: 'Test phone', price: 1000, qty: 1, subtotal: 1000 }],
    subtotal: 1000, total: 1000, status: 'awaiting_payment', delivery: { method: 'pickup' }, payment: { method: 'mpesa', status: 'pending', checkoutRequestId: 'ws_CO_SECTEST_1' },
  });
});

after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

// ---------------------------------------------------------------- headers, CORS
test('secure HTTP headers on pages and API', async () => {
  const result = await anon().get('/');
  const csp = result.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'nonce-[^']+' 'strict-dynamic'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  const nonce = csp.match(/'nonce-([^']+)'/)[1];
  const scripts = result.text.match(/<script\b[^>]*>/g) || [];
  assert.ok(scripts.length > 0 && scripts.every((script) => script.includes(`nonce="${nonce}"`)), 'every <script> on the page carries the nonce');
  assert.equal(result.headers.get('x-frame-options'), 'DENY');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(result.headers.get('strict-transport-security'));
  assert.ok(!result.headers.get('x-powered-by'), 'no X-Powered-By');
  const api = await anon().get('/api/health');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('CORS: only our own sites', async () => {
  const bad = await fetch(`${BASE}/api/market/categories`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const good = await fetch(`${BASE}/api/market/categories`, { method: 'OPTIONS', headers: { Origin: 'https://shop.example.test', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://shop.example.test');
});

// ---------------------------------------------------------------- injection, XSS, validation
test('NoSQL injection in a login is refused', async () => {
  const response = await anon().post('/api/customers/login', { login: { $ne: null }, password: { $ne: null } });
  assert.equal(response.status, 400);
  assert.ok(!response.json.token);
  const text = await anon().post('/api/auth/login', { email: { $gt: '' }, password: { $gt: '' } }, { headers: { 'X-Staff-Gate': gate } });
  assert.equal(text.status, 400);
});

test('operator keys and prototype pollution are stripped from every request', async () => {
  const { clean } = require('../security/sanitize');
  const out = clean(JSON.parse('{"a":{"$ne":1},"b.c":1,"__proto__":{"polluted":1},"ok":"yes","n":{"constructor":{"x":1}}}'));
  assert.deepEqual(out, { a: {}, ok: 'yes', n: {} });
  assert.equal({}.polluted, undefined);
});

test('XSS: HTML and script are removed from text people type', async () => {
  const { client } = accounts.a;
  const response = await client.req('PUT', '/api/customers/me', { body: { name: 'Alice <script>alert(1)</script><img src=x onerror=alert(2)>', about: 'Hi <b>there</b> javascript:alert(3)' } });
  assert.equal(response.status, 200, response.text);
  assert.ok(!/[<>]/.test(response.json.name) && !/script/i.test(response.json.name), `name: ${response.json.name}`);
  assert.ok(!/javascript:/i.test(response.json.about || ''), `about: ${response.json.about}`);
  await client.req('PUT', '/api/customers/me', { body: { name: 'Alice Buyer' } });
});

test('invalid input is refused with a clear 400 (validation)', async () => {
  const result = await anon().post('/api/customers/register', { name: 'X', email: 'not-an-email', phone: '07', password: 'short' });
  assert.equal(result.status, 400);
  const weak = await anon().post('/api/customers/register', { name: 'Weak Pass', email: 'weak@example.test', phone: '0711000099', password: 'password1' });
  assert.equal(weak.status, 400);
  assert.match(weak.json.message, /too easy|at least 10 characters/i);
  const big = await anon().post('/api/customers/login', { login: 'a'.repeat(300000), password: 'x' });
  assert.equal(big.status, 413);
});

// ---------------------------------------------------------------- sessions, CSRF
test('session cookie is httpOnly + SameSite, and Secure behind HTTPS', async () => {
  const raw = accounts.b.client.raw.os_sid;
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Lax/i);
  const anonResult = anon();
  const response = await anonResult.post('/api/customers/login', { login: 'brian@example.test', password: 'Safe-pass-2026' }, { headers: { 'X-Forwarded-Proto': 'https' } });
  // over HTTPS: the "__Host-" prefix (Secure, this exact site only, whole site, no Domain)
  const sid = anonResult.raw['__Host-os_sid'];
  assert.ok(sid, 'over HTTPS the session cookie is __Host-os_sid');
  assert.match(sid, /Secure/i);
  assert.match(sid, /HttpOnly/i);
  assert.match(sid, /Path=\//);
  assert.ok(!/Domain=/i.test(sid), 'no Domain: sub-domains can neither read nor plant it');
  assert.ok(anonResult.raw['__Host-os_csrf'] && !/HttpOnly/i.test(anonResult.raw['__Host-os_csrf']) && /Secure/i.test(anonResult.raw['__Host-os_csrf']), 'the CSRF cookie is readable by our page, HTTPS only');
  accounts.httpsToken = response.json.token;
});

test('HTTPS only: plain http through the proxy is redirected; an unprotected cookie is ignored over HTTPS', async () => {
  const red = await anon().get('/market/search?q=tv', { headers: { 'X-Forwarded-Proto': 'http' } });
  assert.equal(red.status, 308);
  assert.match(red.headers.get('location'), /^https:\/\//);
  // a valid session in a cookie WITHOUT the __Host- protection (e.g. planted over http) doesn't count over HTTPS
  const planted = await anon().get('/api/customers/me', { headers: { 'X-Forwarded-Proto': 'https', Cookie: `os_sid=${accounts.httpsToken}` } });
  assert.equal(planted.status, 401);
  const real = await anon().get('/api/customers/me', { headers: { 'X-Forwarded-Proto': 'https', Cookie: `__Host-os_sid=${accounts.httpsToken}` } });
  assert.equal(real.status, 200);
});

test('secrets are not given to page scripts: support chat secret and staff link key live in httpOnly cookies', async () => {
  // support chat: the answer has no secret; an httpOnly cookie holds it; "me" works only with that cookie
  const anonResult = anon();
  const response = await anonResult.post('/api/support/threads', { name: 'Akinyi', email: 'akinyi@example.test', topic: 'order', message: 'Where is my parcel please?' });
  assert.equal(response.status, 201, response.text);
  assert.ok(!('token' in response.json) && !/[a-f0-9]{32}/.test(response.text), 'no secret in the response');
  assert.match(anonResult.raw.os_support, /HttpOnly/i);
  assert.equal((await anonResult.get('/api/support/threads/me')).status, 200);
  assert.equal((await anon().get('/api/support/threads/me')).status, 404, 'without the cookie: nothing');
  // staff link: opening it sets an httpOnly cookie; after that the login works without the key in any header
  const currentAnonResult = anon();
  const currentAnonResultEntry = await currentAnonResult.get('/api/auth/gate', { headers: { 'X-Staff-Gate': gate } });
  assert.equal(currentAnonResultEntry.status, 200);
  assert.match(currentAnonResult.raw.os_gate, /HttpOnly/i);
  assert.match(currentAnonResult.raw.os_gate, /SameSite=Strict/i);
  assert.equal((await currentAnonResult.post('/api/auth/login', { email: 'mod@example.test', password: 'Mod-pass-2026' })).status, 200, 'signed in with the cookie, no key header');
  assert.equal((await anon().post('/api/auth/login', { email: 'mod@example.test', password: 'Mod-pass-2026' })).status, 404, 'no key, no cookie: the login doesn’t exist');
});

test('CSRF: a cookie login needs the CSRF token, and other sites are refused', async () => {
  const { client } = accounts.b;
  const noToken = await client.req('PUT', '/api/customers/me', { body: { about: 'forged' }, csrf: false });
  assert.equal(noToken.status, 403);
  assert.equal(noToken.json.code, 'CSRF');
  const foreign = await client.req('PUT', '/api/customers/me', { body: { about: 'forged' }, origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const ok = await client.req('PUT', '/api/customers/me', { body: { about: 'real change' } });
  assert.equal(ok.status, 200);
  const loginCsrf = await anon().post('/api/customers/login', { login: 'brian@example.test', password: 'Safe-pass-2026' }, { origin: 'https://evil.example' });
  assert.equal(loginCsrf.status, 403, 'login from another site is refused');
});

test('logout ends the session on the server (the token stops working)', async () => {
  const anonResult = anon();
  const response = await anonResult.post('/api/customers/login', { login: 'alice@example.test', password: 'Safe-pass-2026' });
  const token = response.json.token;
  assert.equal((await anon().get('/api/customers/me', { bearer: token })).status, 200);
  assert.equal((await anonResult.post('/api/customers/logout', {})).status, 200);
  assert.equal((await anon().get('/api/customers/me', { bearer: token })).status, 401);
  assert.ok(!anonResult.jar.os_sid, 'cookie cleared');
});

test('a forged or tampered token is refused', async () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ sid: 'made-up', id: accounts.a.id, typ: 'customer' }, process.env.JWT_SECRET);
  assert.equal((await anon().get('/api/customers/me', { bearer: forged })).status, 401);
  const wrongKey = jwt.sign({ id: accounts.a.id, typ: 'customer' }, 'not-the-secret');
  assert.equal((await anon().get('/api/customers/me', { bearer: wrongKey })).status, 401);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ id: accounts.a.id, typ: 'customer' })).toString('base64url')}.`;
  assert.equal((await anon().get('/api/customers/me', { bearer: none })).status, 401);
  const old = jwt.sign({ id: accounts.a.id, typ: 'customer' }, process.env.JWT_SECRET); // pre-session token
  assert.equal((await anon().get('/api/customers/me', { bearer: old })).status, 401, 'old tokens only work for the one-time upgrade');
  const up = anon();
  assert.equal((await up.post('/api/customers/session', {}, { bearer: old })).status, 200);
  assert.ok(up.jar.os_sid, 'upgraded to a session cookie');
});

test('changing the password signs out other devices', async () => {
  const phone = anon();
  const token = (await phone.post('/api/customers/login', { login: 'brian@example.test', password: 'Safe-pass-2026' })).json.token;
  const result = await accounts.b.client.post('/api/customers/me/password', { current: 'Safe-pass-2026', next: 'New-pass-2027' });
  assert.equal(result.status, 200, result.text);
  assert.equal((await anon().get('/api/customers/me', { bearer: token })).status, 401, 'other device signed out');
  assert.equal((await accounts.b.client.get('/api/customers/me')).status, 200, 'this device stays signed in');
});

// ---------------------------------------------------------------- passwords, brute force
test('passwords are bcrypt hashes (cost 11+) and never sent back', async () => {
  const customer = await Customer.findOne({ email: 'alice@example.test' }).select('+password').lean();
  assert.match(customer.password, /^\$2[aby]\$1[1-9]\$/);
  const me = await accounts.a.client.get('/api/customers/me');
  assert.ok(!('password' in me.json) && !/\$2[aby]\$/.test(me.text));
});

test('brute force: the account locks after 5 wrong passwords', async () => {
  await register('Lock Me', 'lock@example.test', '0711000004');
  for (let index = 0; index < 5; index++) assert.equal((await anon().post('/api/customers/login', { login: 'lock@example.test', password: 'wrong-guess-1' })).status, 401);
  const locked = await anon().post('/api/customers/login', { login: 'lock@example.test', password: 'Safe-pass-2026' });
  assert.equal(locked.status, 429, 'even the right password waits until the lock ends');
});

// ---------------------------------------------------------------- authorization: other people's records, roles
test('IDOR: nobody can open someone else’s order or receipt', async () => {
  const id = accounts.order._id;
  assert.notEqual((await accounts.a.client.get(`/api/orders/${id}`)).status, 404, 'the buyer can');
  assert.equal((await accounts.b.client.get(`/api/orders/${id}`)).status, 404, 'another buyer cannot');
  assert.equal((await accounts.b.client.get(`/api/orders/${id}/receipt.pdf`)).status, 404);
  assert.equal((await accounts.b.client.post(`/api/orders/${id}/status`, { status: 'cancelled' })).status, 404);
  assert.equal((await anon().get(`/api/orders/${id}`)).status, 401);
  assert.equal((await accounts.b.client.get('/api/orders/not-an-id')).status, 404);
});

test('RBAC: customers can’t reach staff routes; moderators only their areas; audit log is admin-only', async () => {
  assert.equal((await accounts.a.client.get('/api/auth/users')).status, 401);
  assert.equal((await anon().get('/api/auth/users', { bearer: accounts.a.token })).status, 401, 'a customer token is not a staff token');
  const mod = await staffLogin('mod@example.test', 'Mod-pass-2026');
  assert.equal((await mod.client.get('/api/support')).status, 200, 'moderator: own area');
  assert.equal((await mod.client.get('/api/admin/sellers')).status, 403, 'moderator: not their area');
  assert.equal((await mod.client.get('/api/orders/admin/list')).status, 403);
  assert.equal((await mod.client.get('/api/auth/audit')).status, 403);
  assert.equal((await mod.client.post('/api/auth/users', { name: 'X', email: 'x@example.test' })).status, 403);
  const admin = await staffLogin('boss@example.test', 'Admin-pass-2026');
  assert.equal((await admin.client.get('/api/auth/audit')).status, 200);
  assert.equal((await admin.client.get('/api/admin/sellers')).status, 200);
});

test('a seller can’t release their own M-Pesa payout by marking the order delivered', async () => {
  await Order.updateOne({ _id: accounts.order._id }, { $set: { status: 'shipped', 'payment.status': 'paid' } });
  const result = await accounts.s.client.post(`/api/orders/${accounts.order._id}/status`, { status: 'delivered' });
  assert.equal(result.status, 409);
  await Order.updateOne({ _id: accounts.order._id }, { $set: { status: 'awaiting_payment', 'payment.status': 'pending' } });
});

// ---------------------------------------------------------------- money: fake M-Pesa callbacks
test('fake M-Pesa "paid" callbacks are ignored; only Safaricom’s keyed address counts', async () => {
  const body = (id) => ({ Body: { stkCallback: { CheckoutRequestID: id, ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: 'FAKE123' }] } } } });
  await anon().post('/api/mpesa/callback', body('ws_CO_SECTEST_1'));
  await anon().post('/api/mpesa/callback/wrong-key', body('ws_CO_SECTEST_1'));
  const { callbackKey } = require('../security/callbackKey');
  await anon().post(`/api/mpesa/callback/${callbackKey()}`, body({ $ne: null })); // operator injection, even with the key
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await Order.findById(accounts.order._id).lean()).payment.status, 'pending', 'still unpaid');
  await anon().post(`/api/mpesa/callback/${callbackKey()}`, body('ws_CO_SECTEST_1'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await Order.findById(accounts.order._id).lean()).payment.status, 'paid', 'the real (keyed) callback works');
  const site = require('../config/site').site();
  assert.ok(site.mpesa.callbackUrl.endsWith(`/api/mpesa/callback/${callbackKey()}`), 'Safaricom gets the keyed address');
});

// ---------------------------------------------------------------- uploads
test('uploads: a file pretending to be a photo is refused', async () => {
  const form = new FormData();
  form.append('title', 'Fake photo test ad');
  form.append('images', new Blob(['<?php system($_GET["c"]); ?>'], { type: 'image/jpeg' }), 'shell.jpg');
  const response = await accounts.s.client.req('POST', '/api/market/listings', { form });
  assert.equal(response.status, 400);
  assert.match(response.json.message, /real JPG|photo/i);
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'uploads', 'listings');
  const recent = fs.existsSync(dir) ? fs.readdirSync(dir).filter((item) => Date.now() - fs.statSync(path.join(dir, item)).mtimeMs < 5000) : [];
  assert.equal(recent.length, 0, 'nothing was kept on disk');
  for (const item of ['/uploads/listings/..%2F..%2F.env', '/uploads/..%2f.env', '/uploads/listings/%2e%2e/%2e%2e/.env', '/.env', '/server/.env']) {
    const r2 = await anon().get(item);
    assert.ok(!/JWT_SECRET|MONGO_URI|MPESA_/.test(r2.text), `${item} must not reveal secrets`);
  }
  assert.equal((await anon().get('/uploads/listings/x.html')).status, 404, 'only image files are served');
});

// ---------------------------------------------------------------- errors, audit, environment
test('errors never reveal internals', async () => {
  const bad = await anon().req('POST', '/api/customers/login', { body: '{"login": "x", ', headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.ok(!leaks(bad), bad.text);
  const nf = await anon().get('/api/nothing/here');
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.json, { message: 'Not found' });
  // signing up with an email that already has an account gives the same answer as a new sign-up (no account enumeration)
  const dup = await anon().post('/api/customers/register', { name: 'Again', email: 'alice@example.test', phone: '0711000055', password: 'Safe-pass-2026', confirmPassword: 'Safe-pass-2026' });
  assert.equal(dup.status, 201);
  assert.equal(await Customer.countDocuments({ email: 'alice@example.test' }), 1);
  assert.ok(!leaks(dup), dup.text);
});

test('sensitive activity is in the audit log', async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const actions = await AuditLog.distinct('action');
  for (const item of ['customer.register', 'customer.login', 'customer.login_failed', 'customer.locked', 'customer.logout', 'customer.password_changed', 'staff.login', 'csrf.blocked', 'access.denied', 'mpesa.callback_rejected', 'upload.rejected']) {
    assert.ok(actions.includes(item), `audit has ${item}`);
  }
  const anyPw = await AuditLog.findOne({ $or: [{ detail: /Safe-pass|New-pass/ }, { path: /callback\/[A-Za-z0-9_-]{20,}/ }] }).lean();
  assert.equal(anyPw, null, 'no passwords or callback keys in the log');
});

test('environment check refuses a weak JWT secret', async () => {
  const { checkEnv } = require('../security/env');
  const saved = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'change_this_to_a_long_random_string';
  const errs = console.error;
  console.error = () => {};
  const checkEnvResult = checkEnv();
  console.error = errs;
  process.env.JWT_SECRET = saved;
  assert.ok(checkEnvResult.problems.some((problem) => /JWT_SECRET/.test(problem)));
  const site = require('../config/site').publicSite();
  assert.ok(!/consumerSecret|passkey|SMTP_PASS|JWT/i.test(JSON.stringify(site)), 'no secrets sent to the browser');
});

test('environment check refuses placeholder payment keys, sandbox values on live M-Pesa, and a bad PAY_SECRETS_KEY', async () => {
  const { checkEnv } = require('../security/env');
  const keys = ['NODE_ENV', 'MPESA_ENV', 'MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'PAY_SECRETS_KEY'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const run = (values) => {
    Object.assign(process.env, values);
    const [errs, warn, exit] = [console.error, console.warn, process.exit];
    console.error = () => {};
    console.warn = () => {};
    process.exit = () => {}; // a production check would stop the server: not in a test
    try { return checkEnv(); } finally { [console.error, console.warn, process.exit] = [errs, warn, exit]; }
  };
  try {
    const placeholders = run({ NODE_ENV: 'test', MPESA_CONSUMER_KEY: 'your_consumer_key', MPESA_CONSUMER_SECRET: 'your_consumer_secret' });
    assert.ok(placeholders.problems.some((problem) => /MPESA_CONSUMER_KEY is still the placeholder/.test(problem)));
    const live = run({ NODE_ENV: 'production', MPESA_ENV: 'production', MPESA_CONSUMER_KEY: 'k'.repeat(40), MPESA_CONSUMER_SECRET: 's'.repeat(40), MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919' }); // secret-scan:allow (Safaricom's public sandbox passkey)
    assert.ok(live.problems.some((problem) => /sandbox test shortcode/.test(problem)));
    assert.ok(live.problems.some((problem) => /public sandbox passkey/.test(problem)));
    assert.ok(live.warnings.some((warning) => /PAY_SECRETS_KEY is not set/.test(warning)));
    const badKey = run({ NODE_ENV: 'test', MPESA_ENV: 'sandbox', PAY_SECRETS_KEY: 'not-hex' });
    assert.ok(badKey.problems.some((problem) => /PAY_SECRETS_KEY must be 64 hex/.test(problem)));
    const good = run({ NODE_ENV: 'test', MPESA_CONSUMER_KEY: 'k'.repeat(40), MPESA_CONSUMER_SECRET: 's'.repeat(40), PAY_SECRETS_KEY: 'a'.repeat(64) });
    assert.ok(!good.problems.some((problem) => /MPESA|PAY_SECRETS/.test(problem)));
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('rate limiting stops password guessing from one address', async () => {
  let limited = false;
  for (let index = 0; index < 50 && !limited; index++) limited = (await anon().post('/api/customers/forgot-password', { email: `x${index}@example.test` })).status === 429;
  assert.ok(limited);
});
