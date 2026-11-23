// Cross-site request forgery (CSRF) protection.
//  1. Origin check: a browser request that changes something (POST/PUT/PATCH/DELETE) must come from one of
//     our own sites (Origin / Referer header). This also stops "login CSRF".
//  2. Signed double-submit token: when the login comes from the session cookie, the request must also carry
//     the X-CSRF-Token header, equal to the os_csrf cookie and signed by the server. Another site can neither
//     read that cookie nor set the header.
// Requests authenticated with "Authorization: Bearer" can't be forged by another site and skip step 2.
// Safaricom's callbacks (server to server, no browser) are exempt; they carry their own secret key.
const crypto = require('crypto');
const { readCookie, nameFor, POLICY, secureReq } = require('./session');

const COOKIE = 'os_csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT = /^\/api\/mpesa\//;

const sign = (value) => crypto.createHmac('sha256', String(process.env.JWT_SECRET)).update(`csrf:${value}`).digest('base64url').slice(0, 32);
const make = () => {
  const text = crypto.randomBytes(18).toString('base64url');
  return `${text}.${sign(text)}`;
};
const valid = (value) => {
  if (typeof value !== 'string' || value.length > 100) return false;
  const [entryValue, text] = value.split('.');
  if (!entryValue || !text) return false;
  const want = Buffer.from(sign(entryValue));
  const got = Buffer.from(text);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

// make sure the browser has a CSRF cookie (readable by our page script, not by other sites)
function ensureCsrf(req, res, fresh = false) {
  if (!fresh && valid(readCookie(req, COOKIE))) return;
  const secure = secureReq(req);
  res.cookie(nameFor(COOKIE, secure), make(), { httpOnly: false, sameSite: 'strict', secure, path: '/', maxAge: 30 * 24 * 3600e3 });
}

// the sites allowed to send us requests: this server itself plus CLIENT_URL / SHOP_URL / PUBLIC_API_URL / CORS_ORIGINS
function allowedOrigins() {
  const list = [process.env.CLIENT_URL, process.env.SHOP_URL, process.env.PUBLIC_API_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
    .map((item) => String(item || '').trim().replace(/\/+$/, ''))
    .filter((item) => /^https?:\/\//.test(item));
  // the Android app (Capacitor) runs the same React front end from https://localhost inside the phone; it logs in
  // with a Bearer token, so these origins only get CORS, never a cookie login without the CSRF token. APP_ORIGINS=off removes them.
  const app = String(process.env.APP_ORIGINS ?? 'https://localhost,capacitor://localhost').split(',').map((item) => item.trim().replace(/\/+$/, '')).filter((item) => item && item !== 'off');
  return [...new Set([...list.map((item) => new URL(item).origin), ...app])];
}
const sameHost = (req, origin) => {
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
};
const originOk = (req, origin) => sameHost(req, origin) || allowedOrigins().includes(origin);

function csrfGuard(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  ensureCsrf(req, res);
  if (!UNSAFE.has(req.method) || EXEMPT.test(req.path)) return next();
  const deny = (why) => {
    require('./audit').audit(req, 'csrf.blocked', { outcome: 'denied', detail: why, status: 403 });
    return res.status(403).json({ message: 'This request was blocked for your security. Please reload the page and try again.', code: 'CSRF' });
  };
  // 1. where did it come from?
  const origin = req.get('origin') || (req.get('referer') ? (() => { try { return new URL(req.get('referer')).origin; } catch { return 'invalid'; } })() : '');
  if (origin && origin !== 'null' && !originOk(req, origin)) return deny(`origin ${String(origin).slice(0, 80)}`);
  if (origin === 'null') return deny('opaque origin');
  // 2. cookie-based login → the CSRF header must match
  const bearer = (req.headers.authorization || '').startsWith('Bearer ');
  const cookieAuth = !bearer && (readCookie(req, POLICY.customer.cookie) || readCookie(req, POLICY.staff.cookie));
  if (cookieAuth) {
    const reqEntry = req.get('x-csrf-token');
    if (!reqEntry || reqEntry !== readCookie(req, COOKIE) || !valid(reqEntry)) return deny('missing or wrong CSRF token');
  }
  next();
}

module.exports = { csrfGuard, ensureCsrf, allowedOrigins, originOk, COOKIE };
