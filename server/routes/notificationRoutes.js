const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { protectCustomer, optionalCustomer } = require('../middleware/customerAuth');
const Notification = require('../models/Notification');
const Listing = require('../models/Listing');
const alerts = require('../market/alerts');

const cartLimit = rateLimit({ ...require('../security/rateStore')(), windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Slow down a little' } });

// 📲 POST /api/notifications/devices { token, platform }  (the app, after log-in: "push notifications to this phone")
//    DELETE /api/notifications/devices { token }           (log-out: stop pushing to this phone)
const PushDevice = require('../models/PushDevice');
const deviceLimit = rateLimit({ ...require('../security/rateStore')(), windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many requests' } });
const { v: value, validate } = require('../security/validate');
const deviceBody = { token: value.string({ min: 20, max: 4096, pattern: /^[\w:.-]+$/, label: 'the device token' }), platform: value.oneOf(['android', 'ios', 'web']) };
router.post('/devices', deviceLimit, protectCustomer, validate(deviceBody), asyncHandler(async (req, res) => {
  await PushDevice.updateOne({ token: req.body.token }, { $set: { customer: req.customer._id, platform: req.body.platform, lastSeenAt: new Date() } }, { upsert: true });
  res.json({ ok: true });
}));
router.delete('/devices', deviceLimit, protectCustomer, validate({ token: deviceBody.token }), asyncHandler(async (req, res) => {
  await PushDevice.deleteOne({ token: req.body.token, customer: req.customer._id }); // only my own phone
  res.json({ ok: true });
}));

// GET /api/notifications  → the latest 40 and how many are unread
router.get('/', protectCustomer, asyncHandler(async (req, res) => {
  const [list, unread] = await Promise.all([
    Notification.find({ to: req.customer._id }).sort({ createdAt: -1 }).limit(40).lean(),
    Notification.countDocuments({ to: req.customer._id, read: false }),
  ]);
  res.json({ notifications: list.map(alerts.view), unread });
}));

// POST /api/notifications/read { ids? }  (none: all)
router.post('/read', protectCustomer, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => mongoose.isValidObjectId(id)).slice(0, 100) : null;
  await Notification.updateMany({ to: req.customer._id, read: false, ...(ids ? { _id: { $in: ids } } : {}) }, { $set: { read: true } });
  res.json({ ok: true });
}));

// DELETE /api/notifications/:id  (swiped away / ✕)   DELETE /api/notifications  (clear all)
router.delete('/:id', protectCustomer, asyncHandler(async (req, res) => {
  await Notification.deleteOne({ _id: req.params.id, to: req.customer._id });
  res.json({ ok: true });
}));
router.delete('/', protectCustomer, asyncHandler(async (req, res) => {
  await Notification.deleteMany({ to: req.customer._id });
  res.json({ ok: true });
}));

// POST /api/notifications/cart { listingId, qty }  a buyer put an item in their cart → tell the seller
router.post('/cart', cartLimit, optionalCustomer, asyncHandler(async (req, res) => {
  const id = req.body?.listingId;
  if (!mongoose.isValidObjectId(id)) return res.json({ ok: false });
  const listing = await Listing.findOne({ _id: id, status: 'active' }).select('seller title slug price').lean();
  if (!listing) return res.json({ ok: false });
  const who = req.customer ? String(req.customer._id) : req.ip;
  const cart = await alerts.addedToCart({ listing, qty: req.body.qty, buyer: req.customer || null, who });
  res.json({ ok: true, sent: !!cart });
}));

module.exports = router;
