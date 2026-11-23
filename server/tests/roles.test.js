// Staff roles, end to end:   cd server && npm run test:roles
// The real server on a throw-away database (kapu_roles_test). Checks every boundary between the three staff roles:
//   owner     → everything; the only one who manages admins / owners and changes money settings
//   admin     → the marketplace, moderators and other settings; never admins, owners or money
//   moderator → only the areas they were given
// plus: the first account is the owner, there's always an owner, and customers are never staff.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5196;
const BASE_ADDRESS = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_roles_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false',
  MPESA_CONSUMER_KEY: '', SMTP_HOST: '', SMTP_USER: '', ANTHROPIC_API_KEY: '', REDIS_URL: '',
  JWT_SECRET: process.env.JWT_SECRET || 'r'.repeat(48), AUTH_RATE_LIMIT: '400',
});
const mongoose = require('mongoose');

// a small HTTP client that keeps its cookies (a staff session is an httpOnly cookie + a CSRF token)
class Client {
  constructor() { this.cookies = {}; }
  async request(method, url, body, headers = {}) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    const cookieHeader = Object.entries(this.cookies).map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookieHeader) requestHeaders.Cookie = cookieHeader;
    if (this.cookies.os_csrf && method !== 'GET') requestHeaders['X-CSRF-Token'] = decodeURIComponent(this.cookies.os_csrf);
    const response = await fetch(BASE_ADDRESS + url, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /expires=Thu, 01 Jan 1970/i.test(setCookie)) delete this.cookies[name];
      else this.cookies[name] = value;
    }
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text };
  }
  get(url) { return this.request('GET', url); }
  post(url, body, headers) { return this.request('POST', url, body, headers); }
  put(url, body) { return this.request('PUT', url, body); }
  delete(url) { return this.request('DELETE', url); }
}

let User;
let gate; // the private staff link's key
const STRONG = 'Staff-Strong-2026';
const signIn = async (email, password = STRONG) => {
  const client = new Client();
  const response = await client.post('/api/auth/login', { email, password }, { 'X-Staff-Gate': gate });
  assert.equal(response.status, 200, response.text);
  return client;
};

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  require('../server');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${BASE_ADDRESS}/api/health`)).ok && mongoose.connection.readyState === 1) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500)); // start-up tasks
  User = require('../models/User');
  gate = await require('../middleware/staffGate').loadGate();
});
after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

let owner;
let admin;
let moderator;

test('first run: only through the private staff link, and the first account is the owner', async () => {
  const noLink = await new Client().post('/api/auth/setup', { name: 'Grace Owner', email: 'owner@kapu.test', password: STRONG });
  assert.equal(noLink.status, 404, 'without the staff link the setup doesn’t even exist');
  owner = new Client();
  const setup = await owner.post('/api/auth/setup', { name: 'Grace Owner', email: 'owner@kapu.test', password: STRONG }, { 'X-Staff-Gate': gate });
  assert.equal(setup.status, 200, setup.text);
  assert.equal(setup.json.user.role, 'owner');
  const again = await new Client().post('/api/auth/setup', { name: 'Intruder', email: 'intruder@kapu.test', password: STRONG }, { 'X-Staff-Gate': gate });
  assert.equal(again.status, 400, 'setup works only once');
});

test('the owner adds an admin and a moderator; the admin can’t add admins or owners', async () => {
  assert.equal((await owner.post('/api/auth/users', { name: 'Brian Admin', email: 'admin@kapu.test', password: STRONG, role: 'admin', mustChangePassword: false })).status, 201);
  assert.equal((await owner.post('/api/auth/users', { name: 'Mary Moderator', email: 'mod@kapu.test', password: STRONG, role: 'moderator', perms: ['ads'], mustChangePassword: false })).status, 201);
  admin = await signIn('admin@kapu.test');
  moderator = await signIn('mod@kapu.test');
  const adminAddsAdmin = await admin.post('/api/auth/users', { name: 'Sneaky Admin', email: 'sneaky@kapu.test', password: STRONG, role: 'admin' });
  assert.equal(adminAddsAdmin.status, 403, adminAddsAdmin.text);
  assert.equal((await admin.post('/api/auth/users', { name: 'Sneaky Owner', email: 'sneaky2@kapu.test', password: STRONG, role: 'owner' })).status, 403);
  assert.equal((await admin.post('/api/auth/users', { name: 'Paul Moderator', email: 'mod2@kapu.test', password: STRONG, role: 'moderator', perms: ['support'] })).status, 201, 'an admin adds moderators');
  assert.equal(await User.countDocuments({ email: /sneaky/ }), 0);
});

test('an admin can’t change, sign out, disable, promote or remove the owner or another admin', async () => {
  const ownerAccount = await User.findOne({ email: 'owner@kapu.test' });
  const moderatorAccount = await User.findOne({ email: 'mod@kapu.test' });
  assert.equal((await admin.put(`/api/auth/users/${ownerAccount._id}`, { active: false })).status, 403, 'disable the owner');
  assert.equal((await admin.put(`/api/auth/users/${ownerAccount._id}`, { password: 'Taken-Over-2026' })).status, 403, 'reset the owner’s password');
  assert.equal((await admin.put(`/api/auth/users/${ownerAccount._id}`, { role: 'moderator' })).status, 403, 'demote the owner');
  assert.equal((await admin.post(`/api/auth/users/${ownerAccount._id}/signout`)).status, 403, 'sign the owner out');
  assert.equal((await admin.delete(`/api/auth/users/${ownerAccount._id}`)).status, 403, 'remove the owner');
  assert.equal((await admin.put(`/api/auth/users/${moderatorAccount._id}`, { role: 'admin' })).status, 403, 'promote a moderator to admin');
  assert.equal((await admin.put(`/api/auth/users/${moderatorAccount._id}`, { perms: ['ads', 'support'] })).status, 200, 'but manage a moderator’s areas');
  const ownerAfter = await User.findById(ownerAccount._id);
  assert.deepEqual([ownerAfter.role, ownerAfter.active], ['owner', true], 'the owner is untouched');
});

test('money settings are the owner’s; other settings are the admin’s too; moderators have none', async () => {
  const adminMoney = await admin.put('/api/admin/settings', { commissionPercent: 1 });
  assert.equal(adminMoney.status, 403, adminMoney.text);
  assert.equal((await admin.put('/api/admin/settings', { demoPayments: true })).status, 403, 'an admin can’t switch on demo payments');
  assert.equal((await admin.put('/api/admin/settings', { tagline: 'Sell fast. Buy smart. Pay safe.' })).status, 200, 'an admin edits the tagline');
  assert.equal((await moderator.put('/api/admin/settings', { tagline: 'Hacked' })).status, 403, 'a moderator edits no settings');
  assert.equal((await owner.put('/api/admin/settings', { commissionPercent: 6 })).status, 200, 'the owner changes the commission');
  assert.equal((await owner.put('/api/admin/settings', { commissionPercent: 5 })).status, 200);
});

test('moderators never see the business’s money, and get only the public settings', async () => {
  const moderatorStats = (await moderator.get('/api/admin/stats')).json;
  assert.equal(moderatorStats.money, false);
  assert.equal(moderatorStats.orders.gmv, undefined, 'no sales total');
  assert.equal(moderatorStats.orders.commission, undefined, 'no commission');
  assert.equal(moderatorStats.boosts.revenue, undefined, 'no boost revenue');
  const adminStats = (await admin.get('/api/admin/stats')).json;
  assert.equal(typeof adminStats.orders.commission, 'number', 'admins see it');
  const moderatorSettings = (await moderator.get('/api/admin/settings')).json;
  assert.equal(moderatorSettings.mpesa, undefined, 'no M-Pesa connection details');
  assert.equal(typeof (await admin.get('/api/admin/settings')).json.mpesa, 'object');
});

test('the support email: a real address or empty, never junk', async () => {
  assert.equal((await admin.put('/api/admin/settings', { email: { mode: 'smtp' } })).status, 400, 'an object');
  assert.equal((await admin.put('/api/admin/settings', { email: 'not an email' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings', { email: 'help@kapu.test' })).status, 200);
  assert.equal((await admin.put('/api/admin/settings', { email: '' })).status, 200, 'empty hides it');
});

test('a moderator reaches only their areas, and no team or audit log', async () => {
  assert.equal((await moderator.get('/api/market/admin/listings')).status, 200, 'ads: given');
  assert.equal((await moderator.get('/api/orders/admin/list')).status, 403, 'orders: not given');
  assert.equal((await moderator.get('/api/admin/sellers')).status, 403, 'sellers: not given');
  assert.equal((await moderator.get('/api/auth/users')).status, 403, 'the team');
  assert.equal((await moderator.get('/api/auth/audit')).status, 403, 'the audit log');
  assert.equal((await moderator.get('/api/auth/staff-link')).status, 403, 'the private staff link');
  assert.equal((await admin.get('/api/auth/audit')).status, 200, 'an admin reads the audit log');
  assert.equal((await admin.get('/api/orders/admin/list')).status, 200, 'an admin reaches every area');
});

test('there is always an active owner; a second owner can be added by an owner, then the first may step down', async () => {
  const ownerAccount = await User.findOne({ email: 'owner@kapu.test' });
  assert.equal((await owner.put(`/api/auth/users/${ownerAccount._id}`, { role: 'admin' })).status, 400, 'can’t change their own role');
  const adminAccount = await User.findOne({ email: 'admin@kapu.test' });
  assert.equal((await owner.put(`/api/auth/users/${adminAccount._id}`, { role: 'owner' })).status, 200, 'the owner makes the admin a co-owner');
  const coOwner = await signIn('admin@kapu.test'); // their old session ended when the role changed
  assert.equal((await coOwner.put(`/api/auth/users/${ownerAccount._id}`, { role: 'admin' })).status, 200, 'with two owners, one can become an admin');
  const lastOwner = await User.findOne({ role: 'owner' });
  assert.equal(lastOwner.email, 'admin@kapu.test');
  const formerOwner = await signIn('owner@kapu.test');
  assert.equal((await formerOwner.delete(`/api/auth/users/${lastOwner._id}`)).status, 403, 'an admin can’t remove the owner');
  // even the database rule: the last owner can't be disabled by anyone
  assert.equal((await coOwner.put(`/api/auth/users/${lastOwner._id}`, { active: false })).status, 400, 'can’t disable yourself / the last owner');
});

test('customers are never staff, and a staff session needs the staff link to start', async () => {
  const noLink = await new Client().post('/api/auth/login', { email: 'admin@kapu.test', password: STRONG });
  assert.equal(noLink.status, 404);
  const wrongPassword = await new Client().post('/api/auth/login', { email: 'admin@kapu.test', password: 'Wrong-Pass-2026' }, { 'X-Staff-Gate': gate });
  assert.equal(wrongPassword.status, 401);
  assert.equal((await new Client().get('/api/auth/users')).status, 401, 'no session');
  assert.equal((await new Client().put('/api/admin/settings', { commissionPercent: 0 })).status, 401);
});
