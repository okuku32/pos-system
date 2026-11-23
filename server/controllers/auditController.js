// Admin → audit log: sensitive activity, newest first, with simple filters.
const { AuditLog } = require('../security/audit');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/auth/audit?action=customer.login&outcome=failed&actor=<email|id>&page=1
exports.list = asyncHandler(async (req, res) => {
  const query = {};
  const action = String(req.query.action || '').replace(/[^a-z_.]/gi, '').slice(0, 60);
  if (action) query.action = new RegExp(`^${action.replace(/\./g, '\\.')}`);
  if (['ok', 'failed', 'denied'].includes(req.query.outcome)) query.outcome = req.query.outcome;
  const actor = String(req.query.actor || '').trim().slice(0, 120);
  if (/^[a-f0-9]{24}$/i.test(actor)) query.actor = actor;
  else if (actor) query.actorName = new RegExp(actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const page = Math.max(1, Math.min(200, parseInt(req.query.page, 10) || 1));
  const [items, total] = await Promise.all([
    AuditLog.find(query).sort({ at: -1 }).skip((page - 1) * 50).limit(50).lean(),
    AuditLog.countDocuments(query),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / 50) });
});
