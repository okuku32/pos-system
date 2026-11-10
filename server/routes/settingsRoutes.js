const r = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { emailMode } = require('../utils/mailer');
const notify = require('../utils/notify');

// GET /api/settings/email -> which email mode is active
r.get('/email', protect, adminOnly, (req, res) => {
  res.json({
    mode: emailMode(), // 'smtp' | 'ethereal' | 'disabled'
    host: process.env.SMTP_HOST || null,
    from: process.env.MAIL_FROM || 'Ordersasa <no-reply@ordersasa.co.ke>',
    shopUrl: process.env.SHOP_URL || 'http://localhost:5173',
  });
});

// POST /api/settings/email/test { to } -> sends a test email
r.post('/email/test', protect, adminOnly, asyncHandler(async (req, res) => {
  const to = String(req.body.to || req.user.email || '').trim();
  if (!/^[^s@]+@[^s@]+.[^s@]{2,}$/.test(to)) return res.status(400).json({ message: 'Enter a valid email address' });
  const result = await notify.sendTest(to);
  if (!result.sent) return res.status(502).json({ message: 'Email failed: ' + result.reason });
  res.json({ message: 'Test email sent to ' + to, preview: result.preview });
}));

module.exports = r;
