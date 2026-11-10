const r = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const c = require('../controllers/customerController');
const { protectCustomer } = require('../middleware/customerAuth');

// Slow down password guessing and mass sign-ups
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
});

r.post('/register', authLimit, c.register);
r.post('/login', authLimit, c.login);
r.post('/oauth/google', authLimit, c.google);
r.route('/me').get(protectCustomer, c.me).put(protectCustomer, c.updateMe);
r.get('/orders', protectCustomer, c.myOrders);

module.exports = r;
