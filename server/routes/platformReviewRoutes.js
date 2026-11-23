const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const reviews = require('../controllers/platformReviewController');
const { protectCustomer } = require('../middleware/customerAuth');
const { protect, can } = require('../middleware/auth');

const limit = (windowMs, number, message) => rateLimit({ ...require('../security/rateStore')(), windowMs, limit: number, standardHeaders: 'draft-8', legacyHeaders: false, message: { message } });

// "Rate Kapu": public reviews of the platform by its buyers and sellers
router.get('/', limit(60 * 1000, 120, 'Too many requests. Please slow down a little.'), reviews.list);
router.get('/mine', protectCustomer, reviews.mine);
router.post('/', limit(60 * 60 * 1000, 10, 'Too many review changes. Please try again later.'), protectCustomer, reviews.save);
router.delete('/mine', protectCustomer, reviews.remove);
// the team: reply publicly, hide abuse (never for being negative; logged)
router.get('/admin', protect, can('support'), reviews.adminList);
router.post('/admin/:id', protect, can('support'), reviews.adminAction);

module.exports = router;
