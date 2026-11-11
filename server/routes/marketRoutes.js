const r = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const c = require('../controllers/marketController');
const { protectCustomer, optionalCustomer } = require('../middleware/customerAuth');
const { protect, adminOnly } = require('../middleware/auth');
const { listingImages } = require('../middleware/upload');

const limit = (windowMs, n, message) =>
  rateLimit({ windowMs, limit: n, standardHeaders: 'draft-8', legacyHeaders: false, message: { message } });
const browse = limit(60 * 1000, 240, 'Too many requests. Please slow down a little.');
const posting = limit(60 * 60 * 1000, 20, 'You’ve posted a lot of ads in a short time. Please wait a while and try again.');
const chatting = limit(60 * 1000, 40, 'You’re sending messages too fast. Please wait a moment.');
const reveal = limit(60 * 60 * 1000, 60, 'Too many phone number requests. Please use chat instead.');

// ----- public (anyone can browse and search)
r.get('/categories', browse, c.categories);
r.get('/home', browse, c.home);
r.get('/suggest', browse, c.suggest);
r.get('/listings', browse, c.list);
r.get('/listings/:slug', browse, optionalCustomer, c.get);
r.get('/sellers/:id', browse, c.seller);

// ----- staff moderation (must come before the customer routes below)
r.get('/admin/listings', protect, adminOnly, c.adminList);
r.patch('/admin/listings/:id', protect, adminOnly, c.adminSetStatus);
r.delete('/admin/listings/:id', protect, adminOnly, c.adminRemove);

// ----- logged-in customers: sell, manage, report, chat
r.get('/listings/:id/phone', reveal, protectCustomer, c.phone);
r.post('/listings', posting, protectCustomer, listingImages, c.create);
r.put('/listings/:id', protectCustomer, listingImages, c.update);
r.patch('/listings/:id/status', protectCustomer, c.setStatus);
r.delete('/listings/:id', protectCustomer, c.remove);
r.post('/listings/:id/report', protectCustomer, c.report);
r.get('/mine', protectCustomer, c.mine);
r.get('/mine/:id', protectCustomer, c.mineOne);

r.get('/conversations', protectCustomer, c.conversations);
r.get('/conversations/unread', protectCustomer, c.unread);
r.post('/conversations', chatting, protectCustomer, c.startChat);
r.get('/conversations/:id/messages', protectCustomer, c.messages);
r.post('/conversations/:id/messages', chatting, protectCustomer, c.send);
r.post('/conversations/:id/read', protectCustomer, c.markRead);

module.exports = r;
