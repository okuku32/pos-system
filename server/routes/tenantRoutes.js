const r = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const c = require('../controllers/tenantSettingsController');

// A client's own business settings (their admin only)
r.get('/settings', protect, adminOnly, c.get);
r.put('/settings', protect, adminOnly, c.update);

module.exports = r;
