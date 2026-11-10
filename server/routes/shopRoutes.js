const r = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const c = require('../controllers/shopController');
const { protectCustomer } = require('../middleware/customerAuth');

// Public endpoints: limit how fast one IP can hit them
const browseLimit = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const orderLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10, // max 10 orders per 15 minutes per IP
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many orders from this device. Please wait a few minutes and try again.' },
});

r.get('/products', browseLimit, c.products);
r.get('/categories', browseLimit, c.categories);
r.post('/orders', orderLimit, protectCustomer, c.placeOrder); // must be logged in to order
r.get('/orders/:token', browseLimit, c.track);

module.exports = r;
