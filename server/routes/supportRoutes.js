const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const supportController = require('../controllers/supportController');
const { protect, can } = require('../middleware/auth');

const opts = { standardHeaders: 'draft-8', legacyHeaders: false };
// Public chat endpoints: generous for normal chatting, tight enough to stop spam
const startLimit = rateLimit({ ...require('../security/rateStore')(), ...opts, windowMs: 60 * 60 * 1000, limit: 8, message: { message: 'You’ve started several conversations recently. Please continue an existing one or try again later.' } });
const msgLimit = rateLimit({ ...require('../security/rateStore')(), ...opts, windowMs: 60 * 1000, limit: 20, message: { message: 'You’re sending messages too quickly. Please wait a moment.' } });
const readLimit = rateLimit({ ...require('../security/rateStore')(), ...opts, windowMs: 60 * 1000, limit: 120 });

// customer (no login needed)
router.post('/threads', startLimit, supportController.start);
router.post('/session', readLimit, supportController.session); // move a conversation's secret into the httpOnly cookie
// ":token" may be "me": the secret then comes from the httpOnly cookie, never from the page
router.get('/threads/:token', readLimit, supportController.useCookieToken, supportController.get);
router.post('/threads/:token/messages', msgLimit, supportController.useCookieToken, supportController.customerMessage);
router.post('/threads/:token/read', readLimit, supportController.useCookieToken, supportController.customerRead);

// staff (any logged-in staff member)
router.get('/', protect, can('support'), supportController.list);
router.get('/:id', protect, can('support'), supportController.staffGet);
router.post('/:id/reply', protect, can('support'), supportController.reply);
router.patch('/:id', protect, can('support'), supportController.setStatus);

module.exports = router;
