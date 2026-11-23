const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const planController = require('../controllers/planController');
const { protectCustomer } = require('../middleware/customerAuth');
const { protect, can } = require('../middleware/auth');

const payLimit = rateLimit({ ...require('../security/rateStore')(), windowMs: 10 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many payment attempts. Please wait a few minutes.' } });

// Lipa Pole Pole (pay in instalments)
router.get('/admin/list', protect, can('orders'), planController.adminList);
router.post('/admin/:id', protect, can('orders'), planController.adminAction);
router.post('/', payLimit, protectCustomer, planController.create);
router.get('/mine', protectCustomer, planController.mine);
router.get('/sales', protectCustomer, planController.sales);
router.get('/:id', protectCustomer, planController.get);
router.post('/:id/pay', payLimit, protectCustomer, planController.pay);
router.post('/:id/cancel', protectCustomer, planController.cancel);

module.exports = router;
