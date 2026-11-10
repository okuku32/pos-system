const r = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const c = require('../controllers/supportController');
const { protect } = require('../middleware/auth');

const opts = { standardHeaders: 'draft-8', legacyHeaders: false };
// Public chat endpoints: generous for normal chatting, tight enough to stop spam
const startLimit = rateLimit({ ...opts, windowMs: 60 * 60 * 1000, limit: 8, message: { message: 'You’ve started several conversations recently. Please continue an existing one or try again later.' } });
const msgLimit = rateLimit({ ...opts, windowMs: 60 * 1000, limit: 20, message: { message: 'You’re sending messages too quickly. Please wait a moment.' } });
const readLimit = rateLimit({ ...opts, windowMs: 60 * 1000, limit: 120 });

// customer (no login needed)
r.post('/threads', startLimit, c.start);
r.get('/threads/:token', readLimit, c.get);
r.post('/threads/:token/messages', msgLimit, c.customerMessage);
r.post('/threads/:token/read', readLimit, c.customerRead);

// staff (any logged-in staff member)
r.get('/', protect, c.list);
r.get('/:id', protect, c.staffGet);
r.post('/:id/reply', protect, c.reply);
r.patch('/:id', protect, c.setStatus);

module.exports = r;
