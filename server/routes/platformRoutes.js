const r = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const c = require('../controllers/platformController');

// Your platform console. Kept separate from every client's own logins.
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many attempts, wait a few minutes' } });

r.get('/setup', c.setupStatus);
r.post('/setup', loginLimit, c.setup);
r.post('/login', loginLimit, c.login);
r.get('/me', c.protectPlatform, c.me);
r.route('/tenants').get(c.protectPlatform, c.listTenants).post(c.protectPlatform, c.createTenant);
r.patch('/tenants/:slug', c.protectPlatform, c.updateTenant);
r.post('/tenants/:slug/support-login', c.protectPlatform, c.supportLogin);
r.get('/audit', c.protectPlatform, c.auditLog);

module.exports = r;
