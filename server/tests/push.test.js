// Push notifications (Android app, Firebase Cloud Messaging):   cd server && npm run test:push
// Real server on a throw-away database; Firebase is a stand-in (records what would be sent).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');

const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_push_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  MPESA_CONSUMER_KEY: '', ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 'z'.repeat(48), AUTH_RATE_LIMIT: '400', FIREBASE_SERVICE_ACCOUNT_FILE: '', FIREBASE_SERVICE_ACCOUNT: '',
});
const mongoose = require('mongoose');
const PASS = 'Kenya-Market-2026';
const api = async (method, url, body, token) => {
  const res = await fetch(BASE + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
let Customer;
let PushDevice;
const people = {};
async function person(key, email, phone) {
  assert.equal((await api('POST', '/customers/register', { name: 'Push Tester', email, phone, password: PASS, confirmPassword: PASS })).status, 201);
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const login = await api('POST', '/customers/login', { login: email, password: PASS });
  people[key] = { token: login.json.token, id: login.json.customer._id };
}

// Firebase stand-in: Google's token endpoint + FCM
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = { project_id: 'kapu-test', client_email: 'push@kapu-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.example.test/token' };
const calls = [];
let fcmReply = () => ({ status: 200, body: { name: 'projects/x/messages/1' } });
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  if (url === serviceAccount.token_uri) return new Response(JSON.stringify({ access_token: 'ya29.test-token', expires_in: 3600 }), { status: 200 });
  const reply = fcmReply(JSON.parse(init.body).message.token);
  return new Response(JSON.stringify(reply.body), { status: reply.status });
};

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
  PushDevice = require('../models/PushDevice');
  await PushDevice.syncIndexes();
  await require('../utils/jobs').stop(); // the test runs the queued pushes itself
  await person('a', 'push.a@example.test', '0713000001');
  await person('b', 'push.b@example.test', '0713000002');
});
after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

const TOKEN_A = `fcm-token-a:${'x'.repeat(40)}`;
const TOKEN_B = `fcm-token-b:${'y'.repeat(40)}`;

test('registering a phone needs a login and a valid token / platform', async () => {
  assert.equal((await api('POST', '/notifications/devices', { token: TOKEN_A, platform: 'android' })).status, 401);
  assert.equal((await api('POST', '/notifications/devices', { token: 'short', platform: 'android' }, people.a.token)).status, 400);
  assert.equal((await api('POST', '/notifications/devices', { token: TOKEN_A, platform: 'blackberry' }, people.a.token)).status, 400);
  assert.equal((await api('POST', '/notifications/devices', { token: '<script>alert(1)</script>'.padEnd(30, 'x'), platform: 'android' }, people.a.token)).status, 400);
  assert.equal((await api('POST', '/notifications/devices', { token: TOKEN_A, platform: 'android' }, people.a.token)).status, 200);
  assert.equal((await api('POST', '/notifications/devices', { token: TOKEN_A, platform: 'android' }, people.a.token)).status, 200, 'again: no duplicate');
  assert.equal(await PushDevice.countDocuments({ token: TOKEN_A }), 1);
});

test('one phone, one person: logging in as someone else moves it; nobody can remove someone else’s phone', async () => {
  await api('POST', '/notifications/devices', { token: TOKEN_B, platform: 'android' }, people.a.token);
  await api('POST', '/notifications/devices', { token: TOKEN_B, platform: 'android' }, people.b.token);
  assert.equal(String((await PushDevice.findOne({ token: TOKEN_B })).customer), people.b.id, 'B’s now');
  await api('DELETE', '/notifications/devices', { token: TOKEN_B }, people.a.token);
  assert.equal(await PushDevice.countDocuments({ token: TOKEN_B }), 1, 'A can’t remove B’s phone');
  assert.equal((await api('DELETE', '/notifications/devices', { token: TOKEN_B }, people.b.token)).status, 200);
  assert.equal(await PushDevice.countDocuments({ token: TOKEN_B }), 0);
});

test('push is off without Firebase set up: notifications still work in the app', async () => {
  const push = require('../utils/push');
  assert.equal(push.enabled(), false);
  const alerts = require('../market/alerts');
  await alerts.send(people.a.id, { kind: 'order', title: { en: 'Order confirmed', sw: 'Oda imethibitishwa' }, body: { en: 'Grace confirmed it', sw: '' }, link: '/orders' });
  assert.equal(await mongoose.connection.collection('jobs').countDocuments({ type: 'push' }), 0, 'no push queued');
  assert.equal(await mongoose.connection.collection('notifications').countDocuments({ to: new mongoose.Types.ObjectId(people.a.id) }), 1, 'the in-app notification is there');
});

test('with Firebase: an in-app notification is queued as a push and sent to the person’s phones', async () => {
  const push = require('../utils/push');
  push.configure({ serviceAccount, fetch: fakeFetch });
  assert.equal(push.enabled(), true);
  await require('../market/alerts').send(people.a.id, { kind: 'order', icon: '🛵', title: { en: 'Otieno is on the way', sw: 'Otieno yuko njiani' }, body: { en: 'Keep your phone near', sw: '' }, link: '/orders/abc' });
  await new Promise((resolve) => setTimeout(resolve, 300)); // queued in the background (send() doesn't wait for it)
  const job = await mongoose.connection.collection('jobs').findOne({ type: 'push' });
  assert.ok(job && job.payload.to === people.a.id, 'queued in the background');
  const result = await push.deliver(job.payload);
  assert.equal(result.sent, 1);
  const tokenCall = calls.find((call) => call.url === serviceAccount.token_uri);
  const assertion = new URLSearchParams(tokenCall.init.body).get('assertion');
  const [head, body, sig] = assertion.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claims.iss, serviceAccount.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const publicKey = crypto.createPublicKey(serviceAccount.private_key);
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, 'base64url')), 'the service-account sign-in is signed with its key');
  const fcm = calls.find((call) => /fcm\.googleapis\.com\/v1\/projects\/kapu-test\/messages:send/.test(call.url));
  assert.equal(fcm.init.headers.Authorization, 'Bearer ya29.test-token');
  const message = JSON.parse(fcm.init.body).message;
  assert.deepEqual([message.token, message.notification.title, message.notification.body, message.data.link, message.android.notification.channel_id], [TOKEN_A, '🛵 Otieno is on the way', 'Keep your phone near', '/orders/abc', 'kapu']);
});

test('a phone that uninstalled the app is forgotten; a busy Firebase is retried later', async () => {
  const push = require('../utils/push');
  fcmReply = () => ({ status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } });
  const gone = await push.deliver({ to: people.a.id, title: 'x', body: 'y', link: '/' });
  assert.equal(gone.removed, 1);
  assert.equal(await PushDevice.countDocuments({ token: TOKEN_A }), 0);
  await api('POST', '/notifications/devices', { token: TOKEN_A, platform: 'android' }, people.a.token);
  fcmReply = () => ({ status: 503, body: { error: { status: 'UNAVAILABLE' } } });
  await assert.rejects(push.deliver({ to: people.a.id, title: 'x', body: 'y', link: '/' }), /busy/, 'thrown, so the job queue tries again later');
  assert.equal(await PushDevice.countDocuments({ token: TOKEN_A }), 1, 'kept for the retry');
  push.configure({ serviceAccount: null });
});
