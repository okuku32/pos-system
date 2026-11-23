// Audit log: who did what sensitive thing, when, from where, and whether it was allowed.
// Logins (ok / failed / locked), logouts, password changes and resets, sessions revoked, staff actions,
// money events (M-Pesa results, payouts), refused requests (401/403, CSRF, rate limits).
// Kept 1 year. Never stores passwords, tokens or secrets.
const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    action: { type: String, required: true }, // e.g. customer.login, staff.login_failed, access.denied
    outcome: { type: String, enum: ['ok', 'failed', 'denied'], default: 'ok' },
    actorKind: { type: String, enum: ['staff', 'customer', 'system', 'anonymous'], default: 'anonymous' },
    actor: { type: mongoose.Schema.Types.ObjectId },
    actorName: String,
    target: String, // "order:6650…", "user:…", "payout:…"
    detail: String,
    method: String,
    path: String,
    status: Number,
    ip: String,
    ua: String,
  },
  { versionKey: false }
);
auditSchema.index({ at: -1 });
auditSchema.index({ action: 1, at: -1 });
auditSchema.index({ actor: 1, at: -1 });
auditSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);

const ipOf = (req) => String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 60);
// never log secrets that may sit in a URL (reset tokens, the M-Pesa callback key, support tokens)
const safePath = (path) =>
  String(path || '')
    .split('?')[0]
    .replace(/(\/api\/mpesa\/(?:callback|b2c\/result|b2c\/timeout))\/[^/]+/, '$1/[key]')
    .replace(/(\/support\/threads)\/[a-f0-9]{16,}/, '$1/[token]')
    .slice(0, 200);
const redactText = (url) => String(url ?? '').replace(/(password|token|secret|passkey|credential)=[^&\s]+/gi, '$1=[hidden]').slice(0, 300);

function audit(req, action, { outcome = 'ok', target, detail, actor, status } = {}) {
  const who = actor || (req?.user ? { kind: 'staff', id: req.user._id, name: req.user.email } : req?.customer ? { kind: 'customer', id: req.customer._id, name: req.customer.email || req.customer.phone } : null);
  const doc = {
    action, outcome, target: target ? String(target).slice(0, 120) : undefined, detail: detail ? redactText(detail) : undefined,
    actorKind: who?.kind || (req ? 'anonymous' : 'system'), actor: who?.id, actorName: who?.name ? String(who.name).slice(0, 120) : undefined,
    method: req?.method, path: req ? safePath(req.originalUrl || req.url) : undefined, status, ip: req ? ipOf(req) : undefined,
    ua: req?.get ? String(req.get('user-agent') || '').slice(0, 160) : undefined,
  };
  if (mongoose.connection.readyState !== 1) return; // tests / start-up before the database is ready
  AuditLog.create(doc).catch((error) => console.error('Audit log:', error.message));
}

// Every staff change (POST/PUT/PATCH/DELETE) and every refused request (401/403/429) is logged automatically.
// Refusals are limited to one entry per IP + path per minute so a scanner can't flood the log.
const seen = new Map();
function auditTrail(req, res, next) {
  res.on('finish', () => {
    const path = safePath(req.originalUrl);
    if (!path.startsWith('/api/')) return;
    const statusCode = res.statusCode;
    if ([401, 403, 429].includes(statusCode)) {
      const key = `${ipOf(req)}|${path}|${statusCode}`;
      const now = Date.now();
      if (now - (seen.get(key) || 0) < 60000) return;
      seen.set(key, now);
      if (seen.size > 5000) seen.clear();
      audit(req, statusCode === 429 ? 'rate_limited' : statusCode === 401 ? 'access.unauthenticated' : 'access.denied', { outcome: 'denied', status: statusCode });
      return;
    }
    if (req.user && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const id = (path.match(/\/([a-f0-9]{24})(?:\/|$)/) || [])[1];
      audit(req, `staff.${req.method.toLowerCase()}`, { outcome: statusCode < 400 ? 'ok' : 'failed', status: statusCode, target: id ? `id:${id}` : undefined, detail: path });
    }
  });
  next();
}

module.exports = { audit, auditTrail, AuditLog, safePath };
