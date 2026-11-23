// Server-side sessions. Every login creates a Session record; the signed token (JWT) only carries its id.
//  - The browser gets the token in an httpOnly, Secure, SameSite cookie: page scripts (and XSS) can't read it.
//  - API clients may still send it as "Authorization: Bearer …".
//  - Logout, password change/reset, disabling an account or "sign out everywhere" revoke sessions at once.
//  - Idle timeout (no use for a while) and an absolute lifetime, different for staff and customers.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const POLICY = {
  customer: { cookie: 'os_sid', absolute: 30 * 24 * 3600e3, idle: 14 * 24 * 3600e3, sameSite: 'lax' },
  staff: { cookie: 'os_staff', absolute: 12 * 3600e3, idle: 4 * 3600e3, sameSite: 'strict' },
};
const TOUCH_EVERY = 60e3; // refresh "last seen" at most once a minute

const sessionSchema = new mongoose.Schema(
  {
    _id: String, // sha256 of the session id (the raw id only lives in the signed token)
    kind: { type: String, enum: ['customer', 'staff'], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, required: true },
    ip: String,
    ua: String,
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    idleExpiresAt: Date,
    expiresAt: Date,
    revokedAt: Date,
    revokedWhy: String,
  },
  { versionKey: false }
);
sessionSchema.index({ user: 1, kind: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }); // removed a week after they end
const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

const hash = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex');
const ipOf = (req) => String(req?.ip || '').slice(0, 60);

// ---------------------------------------------------------------- cookies (no extra package)
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const currentOf = part.indexOf('=');
    if (currentOf < 1) continue;
    const text = part.slice(0, currentOf).trim();
    if (!/^[\w.-]+$/.test(text) || text in out) continue;
    try {
      out[text] = decodeURIComponent(part.slice(currentOf + 1).trim());
    } catch {
      /* malformed */
    }
  }
  return out;
}
const cookies = (req) => (req._cookies ||= parseCookies(req.headers?.cookie));
const secureReq = (req) => !!req.secure || process.env.COOKIE_SECURE === 'true';
// Over HTTPS every cookie gets the "__Host-" prefix: the browser then only accepts it if it is Secure (sent over
// HTTPS only), set by this exact site (no Domain, so no sub-domain can plant or read it) and for the whole site.
// Plain http (local development on this computer) can't use Secure cookies, so the plain name is used there.
const nameFor = (base, secure) => (secure ? `__Host-${base}` : base);
const readCookie = (req, base) => {
  const jar = cookies(req);
  return jar[`__Host-${base}`] || (secureReq(req) ? undefined : jar[base]); // over https only the protected cookie counts
};
function setCookie(res, base, value, { maxAge, httpOnly = true, sameSite = 'lax', secure }) {
  res.cookie(nameFor(base, secure), value, { httpOnly, sameSite, secure, path: '/', maxAge });
}
function clearCookie(res, base, req) {
  res.clearCookie(`__Host-${base}`, { path: '/', httpOnly: true, secure: true });
  res.clearCookie(base, { path: '/', httpOnly: true, secure: secureReq(req) });
}

// ---------------------------------------------------------------- sessions
const cache = new Map(); // hash → { s, until }   (a few seconds, so each request isn't a database round trip)
const CACHE_MS = 5000;

async function issue(req, res, kind, user, claims = {}) {
  const response = POLICY[kind];
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await Session.create({
    _id: hash(sid), kind, user: user._id, ip: ipOf(req), ua: String(req.get?.('user-agent') || '').slice(0, 200),
    idleExpiresAt: new Date(now + response.idle), expiresAt: new Date(now + response.absolute),
  });
  const token = jwt.sign({ sid, id: String(user._id), typ: kind, ...claims }, process.env.JWT_SECRET, { expiresIn: Math.floor(response.absolute / 1000), algorithm: 'HS256' });
  if (res) {
    setCookie(res, response.cookie, token, { maxAge: response.absolute, sameSite: response.sameSite, secure: secureReq(req) });
    require('./csrf').ensureCsrf(req, res, true);
  }
  return token;
}

// the token from the Authorization header (API clients) or the session cookie (browsers)
function tokenFrom(req, kind) {
  const authorization = req.headers?.authorization || '';
  if (authorization.startsWith('Bearer ')) return { token: authorization.slice(7).trim(), via: 'bearer' };
  const cookie = readCookie(req, POLICY[kind].cookie);
  return cookie ? { token: cookie, via: 'cookie' } : { token: null, via: null };
}

// verifies the signature AND the live session; returns the decoded token or null
async function check(token, kind) {
  let date;
  try {
    date = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (date.typ !== kind || typeof date.sid !== 'string' || typeof date.id !== 'string') return null;
  const key = hash(date.sid);
  const now = Date.now();
  listenForRevocations();
  let hit = cache.get(key);
  if (!hit || hit.until < now) {
    const session = await Session.findById(key).lean();
    hit = { s: session, until: now + CACHE_MS };
    cache.set(key, hit);
    if (cache.size > 20000) cache.clear();
  }
  const text = hit.s;
  if (!text || text.revokedAt || text.kind !== kind || String(text.user) !== date.id || text.expiresAt <= new Date(now) || text.idleExpiresAt <= new Date(now)) return null;
  if (now - new Date(text.lastSeenAt).getTime() > TOUCH_EVERY) {
    const idle = new Date(Math.min(now + POLICY[kind].idle, new Date(text.expiresAt).getTime()));
    text.lastSeenAt = new Date(now);
    text.idleExpiresAt = idle;
    Session.updateOne({ _id: key }, { $set: { lastSeenAt: text.lastSeenAt, idleExpiresAt: idle } }).catch(() => {});
  }
  return { ...date, sessionKey: key };
}

// several servers (REDIS_URL): a revoked session stops working on every server at once, not after their few-second cache
const REVOKED = 'kapu:session:revoked';
let listening = false;
function listenForRevocations() {
  const redis = require('../utils/redis');
  if (listening || !redis.enabled()) return;
  listening = true;
  const sub = redis.subscriber();
  sub.subscribe(REVOKED).catch(() => { listening = false; });
  sub.on('message', (channel, keys) => { if (channel === REVOKED) for (const key of String(keys).split(',')) cache.delete(key); });
}
function tellOtherServers(keys) {
  const redis = require('../utils/redis');
  if (keys.length && redis.ready()) redis.client().publish(REVOKED, keys.join(',')).catch(() => {});
}

async function revoke(sessionKey, why = 'logout') {
  cache.delete(sessionKey);
  tellOtherServers([sessionKey]);
  await Session.updateOne({ _id: sessionKey, revokedAt: null }, { $set: { revokedAt: new Date(), revokedWhy: why } });
}
// every session of a user (optionally keeping the current one)
async function revokeAll(kind, userId, why, exceptKey) {
  const query = { kind, user: userId, revokedAt: null, ...(exceptKey ? { _id: { $ne: exceptKey } } : {}) };
  const keys = (await Session.find(query).select('_id').lean()).map((item) => item._id);
  for (const key of keys) cache.delete(key);
  await Session.updateMany(query, { $set: { revokedAt: new Date(), revokedWhy: why } });
  tellOtherServers(keys);
  return keys.length;
}
async function list(kind, userId) {
  return Session.find({ kind, user: userId, revokedAt: null, expiresAt: { $gt: new Date() }, idleExpiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).limit(20).lean();
}

module.exports = { POLICY, Session, issue, check, revoke, revokeAll, list, tokenFrom, cookies, readCookie, nameFor, parseCookies, clearCookie, setCookie, secureReq, hash };
