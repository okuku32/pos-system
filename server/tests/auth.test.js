// Authentication & authorisation, end to end:   cd server && npm run test:auth
// Starts the real server on a throw-away database (kapu_auth_test) and goes through every path a person (or an
// attacker) can take: sign-up validation, email verification, login, sessions & cookies, brute force, password
// reset, Google sign-in, and what each role may and may not reach. Emails are captured instead of being sent.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_auth_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false',
  MPESA_CONSUMER_KEY: '', SMTP_HOST: '', SMTP_USER: '', ANTHROPIC_API_KEY: '', REDIS_URL: '',
  CLIENT_URL: 'https://shop.example.test', SHOP_URL: 'https://shop.example.test', PUBLIC_API_URL: 'https://shop.example.test',
  JWT_SECRET: process.env.JWT_SECRET || 'y'.repeat(48), AUTH_RATE_LIMIT: '400',
});
const mongoose = require('mongoose');
const mails = [];

// Google: a stand-in for Google's ID-token check ("google:<email>:<sub>" → a verified Google identity)
const jobsModule = require('../utils/jobs');
const originalHandle = jobsModule.handle;
let mailWorkerReady = false;
jobsModule.handle = (type, fn) => {
  if (type === 'email') mailWorkerReady = true;
  return originalHandle(type, type === 'email' ? async (message) => { mails.push(message); } : fn);
};
const oauth = require('../utils/oauth');
oauth.verifyGoogleCredential = async (credential) => {
  const [kind, email, sub] = String(credential).split(':');
  if (kind !== 'google') throw Object.assign(new Error('Google sign-in failed'), { status: 401 });
  return { googleId: sub, email, name: 'Google Person', avatar: '' };
};

// ---------------------------------------------------------------- a small HTTP client with a cookie jar
class Client {
  constructor() { this.jar = {}; this.raw = {}; }
  async req(method, url, { body, headers = {}, bearer, raw } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    const cookie = Object.entries(this.jar).map(([key, value]) => `${key}=${value}`).join('; ');
    if (cookie) h.Cookie = cookie;
    if (this.jar.os_csrf && method !== 'GET') h['X-CSRF-Token'] = decodeURIComponent(this.jar.os_csrf);
    const res = await fetch(BASE + url, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual' });
    for (const item of res.headers.getSetCookie()) {
      const [pair] = item.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      this.raw[name] = item;
      if (pair.slice(at + 1) === '' || /expires=Thu, 01 Jan 1970/i.test(item)) delete this.jar[name];
      else this.jar[name] = pair.slice(at + 1);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(url, o) { return this.req('GET', url, o); }
  post(url, body, o) { return this.req('POST', url, { ...o, body }); }
  put(url, body, o) { return this.req('PUT', url, { ...o, body }); }
}
const anon = () => new Client();

// emails the server queues: captured, nothing is sent (see the jobs.handle patch above)
const mailTo = (email) => mails.filter((mail) => mail.to === email);
const linkToken = (mail, page) => (mail?.text.match(new RegExp(`/${page}\\?token=([a-f0-9]{64})`)) || [])[1];
const flushMail = async () => {
  for (let i = 0; i < 200 && !mailWorkerReady; i++) await new Promise((resolve) => setTimeout(resolve, 50)); // start-up still running
  for (let i = 0; i < 20; i++) {
    await require('../utils/jobs').work();
    if (!(await mongoose.connection.collection('jobs').countDocuments({ type: 'email', status: { $in: ['queued', 'running'] } }))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const PASS = 'Kenya-Market-2026';
const signUp = (client, data) => client.post('/api/customers/register', { name: 'Wanjiku Kamau', phone: '0712000001', password: PASS, confirmPassword: PASS, ...data });
let Customer;
let User;
let gate;
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

// a ready, verified customer, logged in (helper for the role tests)
async function verifiedCustomer(email, phone, extra = {}) {
  const client = anon();
  assert.equal((await signUp(client, { email, phone, name: 'Test Person', ...extra })).status, 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const login = await client.post('/api/customers/login', { login: email, password: PASS });
  assert.equal(login.status, 200, login.text);
  return { client, id: login.json.customer._id, token: login.json.token };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  require('../server');
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && mongoose.connection.readyState === 1) break; } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500)); // start-up tasks (indexes, workers)
  Customer = require('../models/Customer');
  User = require('../models/User');
  gate = await require('../middleware/staffGate').loadGate();
});
after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

// ---------------------------------------------------------------- registration: validation & failure cases
test('sign-up refuses bad input with clear messages', async () => {
  const c = anon();
  const cases = [
    [{ name: '' }, /name/i],
    [{ name: '12345' }, /full name/i],
    [{ email: 'not-an-email' }, /valid email/i],
    [{ email: 'two..dots@example.test' }, /valid email/i],
    [{ phone: '07' }, /mobile number/i],
    [{ password: 'short1A', confirmPassword: 'short1A' }, /at least 10 characters/i],
    [{ password: 'alllowercase123', confirmPassword: 'alllowercase123' }, /uppercase/i],
    [{ password: 'NoNumbersHere', confirmPassword: 'NoNumbersHere' }, /number/i],
    [{ password: 'Password12345', confirmPassword: 'Password12345' }, /too easy/i],
    [{ name: 'Wanjiku Kamau', password: 'Wanjiku-2026x', confirmPassword: 'Wanjiku-2026x' }, /name or email/i],
    [{ email: 'mwangi@example.test', password: 'Mwangi-Pass-99', confirmPassword: 'Mwangi-Pass-99' }, /name or email/i],
    [{ confirmPassword: 'Different-2026x' }, /don’t match/i],
    [{ confirmPassword: undefined }, /don’t match/i],
  ];
  for (const [data, message] of cases) {
    const res = await signUp(c, { email: 'valid@example.test', ...data });
    assert.equal(res.status, 400, `${JSON.stringify(data)} → ${res.status} ${res.text}`);
    assert.match(res.json.message, message, JSON.stringify(data));
  }
  assert.equal(await Customer.countDocuments({}), 0, 'nothing was saved');
});

test('sign-up saves the account securely, unverified, and does NOT log in', async () => {
  const c = anon();
  const asAdmin = await signUp(anon(), { email: 'sneaky@example.test', accountType: 'admin' });
  assert.equal(asAdmin.status, 400, 'accountType can only be buyer or seller');
  const res = await signUp(c, { email: '  Wanjiku.Kamau@Example.TEST ', role: 'admin', emailVerified: true, worker: { role: 'rider', status: 'approved' }, isAdmin: true, perms: ['*'], verifyTokenHash: 'x' });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.needsVerification, true);
  assert.ok(!res.json.token && !res.json.customer, 'no token or account in the answer');
  assert.ok(!c.jar.os_sid && !c.jar['__Host-os_sid'], 'no session cookie');
  const saved = await Customer.findOne({ email: 'wanjiku.kamau@example.test' }).select('+password +verifyTokenHash +verifyTokenExpires').lean();
  assert.ok(saved, 'email saved normalised (trimmed, lowercase)');
  assert.equal(saved.emailVerified, false);
  assert.match(saved.password, /^\$2[aby]\$1[1-9]\$/, 'bcrypt hash, cost 11+');
  assert.notEqual(saved.password, PASS);
  assert.equal(saved.accountType, 'buyer', 'a role is never taken from sign-up');
  assert.ok(!saved.worker?.role && !saved.role && !saved.isAdmin && !saved.perms, 'no injected role or permissions');
  assert.match(saved.verifyTokenHash, /^[a-f0-9]{64}$/);
  const hours = (new Date(saved.verifyTokenExpires) - Date.now()) / 3600e3;
  assert.ok(hours > 23.9 && hours <= 24, `verification link expires in 24 h (${hours.toFixed(2)})`);
  assert.equal(await User.countDocuments({}), 0, 'no staff account created');
});

test('the verification email goes out (through the queue) with a single-use link whose hash is stored', async () => {
  await flushMail();
  const mail = mailTo('wanjiku.kamau@example.test').at(-1);
  assert.ok(mail, 'an email was queued for the new account');
  assert.match(mail.subject, /confirm your email/i);
  const token = linkToken(mail, 'verify-email');
  assert.ok(token, 'the email has the link');
  const saved = await Customer.findOne({ email: 'wanjiku.kamau@example.test' }).select('+verifyTokenHash').lean();
  assert.equal(saved.verifyTokenHash, hashOf(token), 'only the hash is stored, never the token');
});

test('login is refused until the email is confirmed (and wrong passwords get the generic error)', async () => {
  const c = anon();
  const wrong = await c.post('/api/customers/login', { login: 'wanjiku.kamau@example.test', password: 'Wrong-Pass-2026' });
  const nobody = await c.post('/api/customers/login', { login: 'nobody@example.test', password: 'Wrong-Pass-2026' });
  assert.equal(wrong.status, 401);
  assert.equal(nobody.status, 401);
  assert.equal(wrong.json.message, nobody.json.message, 'same message for a wrong password and an unknown email');
  const unverified = await c.post('/api/customers/login', { login: 'WANJIKU.KAMAU@example.test', password: PASS });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.json.code, 'EMAIL_NOT_VERIFIED');
  assert.ok(!unverified.json.token && !c.jar.os_sid, 'no session for an unverified account');
});

test('signing up again with the same email reveals nothing and creates nothing', async () => {
  const before = mails.length;
  const again = await signUp(anon(), { email: 'wanjiku.kamau@example.test', phone: '0712000999' });
  const fresh = await signUp(anon(), { email: 'brand.new@example.test', phone: '0712000998' });
  assert.equal(again.status, 201);
  assert.equal(again.json.message.replace('wanjiku.kamau', 'X'), fresh.json.message.replace('brand.new', 'X'), 'identical answer');
  assert.equal(await Customer.countDocuments({ email: 'wanjiku.kamau@example.test' }), 1);
  await flushMail();
  assert.equal(mails.length, before + 1, 'unverified owner: not re-sent within a minute (only the new account got an email)');
});

test('the verification link: bad, expired and reused links are refused; a good one verifies but does not log in', async () => {
  const c = anon();
  assert.equal((await c.post('/api/customers/verify-email', { token: 'abc' })).status, 400);
  assert.equal((await c.post('/api/customers/verify-email', { token: 'f'.repeat(64) })).status, 400);
  // expired
  const token = linkToken(mailTo('brand.new@example.test').at(-1), 'verify-email');
  await Customer.updateOne({ email: 'brand.new@example.test' }, { $set: { verifyTokenExpires: new Date(Date.now() - 1000) } });
  const expired = await c.post('/api/customers/verify-email', { token });
  assert.equal(expired.status, 400);
  assert.match(expired.json.message, /expired/i);
  // a good one
  const good = linkToken(mailTo('wanjiku.kamau@example.test').at(-1), 'verify-email');
  const ok = await c.post('/api/customers/verify-email', { token: good });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(!ok.json.token && !c.jar.os_sid, 'verifying does not log in');
  const saved = await Customer.findOne({ email: 'wanjiku.kamau@example.test' }).select('+verifyTokenHash').lean();
  assert.equal(saved.emailVerified, true);
  assert.ok(saved.emailVerifiedAt && !saved.verifyTokenHash, 'verified, token cleared');
  assert.equal((await c.post('/api/customers/verify-email', { token: good })).status, 400, 'single use');
});

test('resending the link: the same answer for every email; a new link replaces the old one', async () => {
  const unknown = await anon().post('/api/customers/resend-verification', { email: 'ghost@example.test' });
  const verified = await anon().post('/api/customers/resend-verification', { email: 'wanjiku.kamau@example.test' });
  await Customer.updateOne({ email: 'brand.new@example.test' }, { $unset: { verifySentAt: 1 } });
  const waiting = await anon().post('/api/customers/resend-verification', { email: 'Brand.New@example.test' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.message, verified.json.message);
  assert.equal(verified.json.message, waiting.json.message);
  await flushMail();
  const token = linkToken(mailTo('brand.new@example.test').at(-1), 'verify-email');
  assert.equal((await anon().post('/api/customers/verify-email', { token })).status, 200, 'the new link works');
});

// ---------------------------------------------------------------- login & session
test('login after verifying: a secure server-side session in an httpOnly cookie', async () => {
  const c = anon();
  const res = await c.post('/api/customers/login', { login: 'wanjiku.kamau@example.test', password: PASS });
  assert.equal(res.status, 200, res.text);
  const cookie = c.raw.os_sid;
  assert.ok(cookie, 'session cookie set');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  const me = await c.get('/api/customers/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.email, 'wanjiku.kamau@example.test');
  assert.ok(!('password' in me.json) && !('verifyTokenHash' in me.json), 'no secrets in the profile');
  // behind HTTPS (the proxy says so) the cookie is Secure and __Host- prefixed
  const s = anon();
  await s.post('/api/customers/login', { login: 'wanjiku.kamau@example.test', password: PASS }, { headers: { 'X-Forwarded-Proto': 'https' } });
  const secure = s.raw['__Host-os_sid'];
  assert.ok(secure && /;\s*Secure/i.test(secure) && /Path=\//.test(secure), `Secure cookie over HTTPS: ${secure}`);
});

test('tokens are checked on the server: tampered, revoked and expired sessions are refused', async () => {
  const c = anon();
  const login = await c.post('/api/customers/login', { login: 'wanjiku.kamau@example.test', password: PASS });
  const token = login.json.token;
  assert.equal((await anon().get('/api/customers/me', { bearer: token })).status, 200, 'a valid Bearer token works (the Android app)');
  const [h, p, sig] = token.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), id: new mongoose.Types.ObjectId() })).toString('base64url')}.${sig}`;
  assert.equal((await anon().get('/api/customers/me', { bearer: forged })).status, 401, 'tampered');
  // expired: a session whose lifetime is over
  const Session = mongoose.model('Session');
  const fresh = await anon().post('/api/customers/login', { login: 'wanjiku.kamau@example.test', password: PASS });
  const sid = JSON.parse(Buffer.from(fresh.json.token.split('.')[1], 'base64url')).sid;
  await Session.updateOne({ _id: crypto.createHash('sha256').update(sid).digest('hex') }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await anon().get('/api/customers/me', { bearer: fresh.json.token })).status, 401, 'expired session');
  // logout revokes
  const d = anon();
  const l2 = await d.post('/api/customers/login', { login: 'wanjiku.kamau@example.test', password: PASS });
  assert.equal((await d.post('/api/customers/logout', {})).status, 200);
  assert.equal((await anon().get('/api/customers/me', { bearer: l2.json.token })).status, 401, 'logged out');
});

test('brute force: 5 wrong passwords lock the account (even the right password then fails), with no account hint', async () => {
  await verifiedCustomer('locked@example.test', '0712000300');
  const c = anon();
  for (let i = 0; i < 5; i++) await c.post('/api/customers/login', { login: 'locked@example.test', password: `Wrong-pass-${i}x` });
  const locked = await c.post('/api/customers/login', { login: 'locked@example.test', password: PASS });
  assert.equal(locked.status, 429);
  assert.ok(!locked.json.token);
});

test('NoSQL operators, wrong types and oversized bodies in auth requests are refused', async () => {
  const c = anon();
  assert.equal((await c.post('/api/customers/login', { login: { $gt: '' }, password: { $gt: '' } })).status, 400);
  assert.equal((await c.post('/api/customers/verify-email', { token: { $ne: null } })).status, 400);
  assert.equal((await c.req('POST', '/api/customers/login', { raw: '{"login": "x", ', headers: { 'Content-Type': 'application/json' } })).status, 400, 'malformed JSON');
  assert.equal((await c.post('/api/customers/register', { name: 'x'.repeat(300000) })).status, 413, 'oversized');
});

// ---------------------------------------------------------------- password reset
test('password reset: generic answer, strong-password rules, confirmation, single-use link, other devices signed out', async () => {
  const owner = await verifiedCustomer('reset.me@example.test', '0712000400');
  const ghost = await anon().post('/api/customers/forgot-password', { email: 'ghost@example.test' });
  const real = await anon().post('/api/customers/forgot-password', { email: 'Reset.Me@example.test' });
  assert.equal(ghost.json.message, real.json.message, 'same answer');
  await flushMail();
  const token = linkToken(mailTo('reset.me@example.test').at(-1), 'reset-password');
  assert.ok(token);
  assert.equal((await anon().post('/api/customers/reset-password', { token, password: 'weakpass', confirmPassword: 'weakpass' })).status, 400);
  assert.equal((await anon().post('/api/customers/reset-password', { token, password: 'New-Strong-2026', confirmPassword: 'Other-Strong-2026' })).status, 400);
  const ok = await anon().post('/api/customers/reset-password', { token, password: 'New-Strong-2026', confirmPassword: 'New-Strong-2026' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await anon().post('/api/customers/reset-password', { token, password: 'New-Strong-2027', confirmPassword: 'New-Strong-2027' })).status, 400, 'single use');
  assert.equal((await owner.client.get('/api/customers/me')).status, 401, 'the old session was signed out');
  assert.equal((await anon().post('/api/customers/login', { login: 'reset.me@example.test', password: PASS })).status, 401, 'old password no longer works');
  assert.equal((await anon().post('/api/customers/login', { login: 'reset.me@example.test', password: 'New-Strong-2026' })).status, 200);
});

// ---------------------------------------------------------------- Google (OpenID Connect ID token, checked on the server)
test('Google: a new account is created verified and logged in; a bad token is refused', async () => {
  const bad = await anon().post('/api/customers/oauth/google', { credential: 'not-a-real-google-token-xxxxxx' });
  assert.equal(bad.status, 401);
  const c = anon();
  const res = await c.post('/api/customers/oauth/google', { credential: 'google:akinyi.g@example.test:sub-akinyi-1234567' });
  assert.equal(res.status, 201, res.text);
  assert.ok(c.jar.os_sid, 'session started');
  const saved = await Customer.findOne({ email: 'akinyi.g@example.test' }).lean();
  assert.equal(saved.emailVerified, true);
  assert.equal(saved.authProvider, 'google');
});

test('Google: linking to an unverified account removes the password someone else may have set (takeover protection)', async () => {
  // an attacker signs up with the victim's email and never verifies it
  await signUp(anon(), { email: 'victim@example.test', phone: '0712000500', name: 'Attacker Person' });
  // the real owner signs in with Google
  const owner = anon();
  const res = await owner.post('/api/customers/oauth/google', { credential: 'google:victim@example.test:sub-victim-7654321' });
  assert.equal(res.status, 200, res.text);
  const saved = await Customer.findOne({ email: 'victim@example.test' }).select('+password').lean();
  assert.equal(saved.emailVerified, true);
  assert.ok(!saved.password, 'the unverified password is gone');
  const attacker = await anon().post('/api/customers/login', { login: 'victim@example.test', password: PASS });
  assert.equal(attacker.status, 401, 'the attacker’s password no longer works');
});

// ---------------------------------------------------------------- roles & permissions (RBAC on the server)
test('every protected endpoint needs a login', async () => {
  for (const [method, url] of [['GET', '/api/customers/me'], ['GET', '/api/orders/mine'], ['GET', '/api/orders/sales'], ['GET', '/api/market/mine'], ['GET', '/api/work/jobs'], ['PUT', '/api/work/location'], ['GET', '/api/notifications'], ['GET', '/api/auth/users'], ['GET', '/api/admin/stats'], ['GET', '/api/auth/audit']]) {
    const res = await anon().req(method, url, method === 'GET' ? {} : { body: {} });
    assert.equal(res.status, 401, `${method} ${url} → ${res.status}`);
  }
});

test('customers can’t reach staff routes; riders’ routes need an approved rider; a buyer can’t act as a rider', async () => {
  const buyer = await verifiedCustomer('plain.buyer@example.test', '0712000600');
  for (const url of ['/api/auth/users', '/api/admin/stats', '/api/auth/audit', '/api/orders/admin/list', '/api/work/admin/workers']) {
    const res = await buyer.client.get(url);
    assert.ok([401, 403].includes(res.status), `buyer → ${url}: ${res.status}`);
  }
  assert.equal((await buyer.client.get('/api/work/jobs')).status, 403, 'not a rider');
  assert.equal((await buyer.client.put('/api/work/location', { lat: -1.3, lng: 36.8 })).status, 403, 'can’t share a rider location');
  // applying makes them a *pending* rider: still no jobs until staff approve
  await buyer.client.post('/api/work/apply', { role: 'rider', idNumber: '12345678', vehicle: 'Motorbike', plate: 'KMFA 123B', baseArea: 'Imara stage', lat: -1.3296, lng: 36.8876, radiusKm: 5, mpesaPhone: '0712000600' });
  assert.equal((await buyer.client.get('/api/work/jobs')).status, 403, 'pending rider: no jobs');
  // a customer can't approve themselves (staff route)
  const me = await Customer.findOne({ email: 'plain.buyer@example.test' }).lean();
  const self = await buyer.client.post(`/api/work/admin/workers/${me._id}`, { action: 'approve' });
  assert.ok([401, 403].includes(self.status), `self-approval refused: ${self.status}`);
});

test('staff roles: a moderator only reaches the areas they were given; only an admin manages the team', async () => {
  await User.create({ name: 'Mod Support', email: 'mod.support@example.test', password: 'Mod-Strong-2026', role: 'moderator', perms: ['support'] });
  await User.create({ name: 'Admin Boss', email: 'admin.boss@example.test', password: 'Admin-Strong-2026', role: 'admin' });
  const login = async (email, password) => {
    const c = anon();
    const res = await c.post('/api/auth/login', { email, password }, { headers: { 'X-Staff-Gate': gate } });
    assert.equal(res.status, 200, res.text);
    return c;
  };
  const mod = await login('mod.support@example.test', 'Mod-Strong-2026');
  const admin = await login('admin.boss@example.test', 'Admin-Strong-2026');
  assert.equal((await mod.get('/api/support')).status, 200, 'moderator reaches support');
  assert.equal((await mod.get('/api/orders/admin/list')).status, 403, 'moderator without "orders" can’t see orders');
  assert.equal((await mod.get('/api/auth/users')).status, 403, 'moderator can’t manage the team');
  assert.equal((await mod.get('/api/auth/audit')).status, 403, 'moderator can’t read the audit log');
  assert.equal((await admin.get('/api/auth/users')).status, 200);
  assert.equal((await admin.get('/api/auth/audit')).status, 200);
  // a staff login without the private staff link is refused
  const noGate = await anon().post('/api/auth/login', { email: 'admin.boss@example.test', password: 'Admin-Strong-2026' });
  assert.ok([403, 404].includes(noGate.status), `staff login without the staff link: ${noGate.status}`);
  // a customer session is not a staff session
  const buyer = await verifiedCustomer('not.staff@example.test', '0712000700');
  assert.ok([401, 403].includes((await buyer.client.get('/api/auth/me')).status));
});

test('important auth events are in the audit log', async () => {
  const AuditLog = require('../security/audit').AuditLog;
  const actions = await AuditLog.distinct('action');
  for (const action of ['customer.register', 'customer.email_verified', 'customer.login_unverified', 'customer.login_failed', 'customer.locked', 'customer.password_reset', 'customer.unverified_password_removed']) {
    assert.ok(actions.includes(action), `audit has ${action}`);
  }
});
