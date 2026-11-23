// Push notifications to the Android app, through Firebase Cloud Messaging (FCM, HTTP v1).
//
// Setup (once): Firebase console → your project → Project settings → Service accounts → "Generate new private key".
// Keep that JSON file on the server only (never in the app or in git) and point to it:
//     FIREBASE_SERVICE_ACCOUNT_FILE=/secure/path/firebase-service-account.json
// (or FIREBASE_SERVICE_ACCOUNT=<the JSON, base64-encoded>). Without it, push is off and everything else works.
//
// Every in-app notification (market/alerts.js → send) is also pushed to the person's phones, in the background
// (the job queue: retried if Firebase is busy). Phones that uninstalled the app are forgotten automatically.
const crypto = require('crypto');
const fs = require('fs');
const PushDevice = require('../models/PushDevice');

let account;
let accessToken = null; // { value, until }
let fetchImpl = (...args) => fetch(...args);

function serviceAccount() {
  if (account !== undefined) return account;
  account = null;
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_FILE
      ? fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8')
      : process.env.FIREBASE_SERVICE_ACCOUNT ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8') : '';
    if (raw) {
      const json = JSON.parse(raw);
      if (json.client_email && json.private_key && json.project_id) account = json;
      else console.error('[push] the Firebase service account is missing client_email / private_key / project_id');
    }
  } catch (error) {
    console.error('[push] could not read the Firebase service account:', error.message);
  }
  return account;
}
const enabled = () => !!serviceAccount();

// an OAuth access token for FCM: a JWT signed with the service account's key, swapped at Google (cached ~55 min)
async function token() {
  if (accessToken && accessToken.until > Date.now()) return accessToken.value;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')}`;
  const res = await fetchImpl(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Firebase sign-in failed (${res.status})`);
  accessToken = { value: data.access_token, until: Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000 };
  return accessToken.value;
}

// what the phone shows: title, text, and the page to open when tapped
const message = (deviceToken, note) => ({
  message: {
    token: deviceToken,
    notification: { title: String(note.title || 'Kapu').slice(0, 120), body: String(note.body || '').slice(0, 240) },
    data: { link: String(note.link || '/'), kind: String(note.kind || '') },
    android: { priority: 'high', notification: { channel_id: 'kapu', ...(note.tag ? { tag: String(note.tag) } : {}) } }, // the app's own icon
  },
});

// send one notification to every phone of one person (run by the job queue)
async function deliver({ to, title, body, link, kind }) {
  if (!enabled()) return { sent: 0, skipped: 'push is not set up' };
  const devices = await PushDevice.find({ customer: to }).select('token').limit(10).lean();
  if (!devices.length) return { sent: 0 };
  const auth = await token();
  const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount().project_id}/messages:send`;
  let sent = 0;
  let retry = false;
  const gone = [];
  await Promise.all(devices.map(async (device) => {
    const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(message(device.token, { title, body, link, kind })) });
    if (res.ok) { sent += 1; return; }
    const error = await res.json().catch(() => ({}));
    const code = error?.error?.details?.find?.((item) => item.errorCode)?.errorCode || error?.error?.status;
    if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT')) gone.push(device._id); // the app was removed
    else if (res.status === 401) accessToken = null; // token expired early: get a new one next try
    if (res.status >= 500 || res.status === 429 || res.status === 401) retry = true;
  }));
  if (gone.length) await PushDevice.deleteMany({ _id: { $in: gone } });
  if (retry && !sent) throw new Error('Firebase is busy; trying again later');
  return { sent, removed: gone.length };
}

// from market/alerts.js: queue a push for an in-app notification (English text; no-op when push is off)
function notify(to, note) {
  if (!enabled()) return null;
  const text = (value) => (value && typeof value === 'object' ? value.en || value.sw || '' : value || '');
  return require('./jobs').enqueue('push', { to: String(to), title: `${note.icon ? `${note.icon} ` : ''}${text(note.title)}`.trim(), body: text(note.body), link: note.link || '/', kind: note.kind || '' }, { maxAttempts: 4 }).catch(() => null);
}

function startPushWorker() {
  require('./jobs').handle('push', deliver);
}

// tests
function configure({ serviceAccount: sa, fetch: fn } = {}) {
  if (sa !== undefined) account = sa;
  if (fn) fetchImpl = fn;
  accessToken = null;
}

module.exports = { enabled, notify, deliver, startPushWorker, message, configure };
