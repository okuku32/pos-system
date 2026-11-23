const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const orderController = require('../controllers/orderController');
const { protectCustomer } = require('../middleware/customerAuth');
const { protect, can } = require('../middleware/auth');

const limit = (windowMs, number, message) => rateLimit({ ...require('../security/rateStore')(), windowMs, limit: number, standardHeaders: 'draft-8', legacyHeaders: false, message: { message } });
const checkoutLimit = limit(15 * 60 * 1000, 15, 'Too many checkouts from this device. Please wait a few minutes.');
const payLimit = limit(10 * 60 * 1000, 10, 'Too many payment attempts. Please wait a few minutes.');

// admin / moderators (before the "/:id" routes)
router.get('/admin/list', protect, can('orders'), orderController.adminList);
router.post('/admin/:id', protect, can('orders'), orderController.adminAction);
router.get('/admin/:id/receipt.pdf', protect, can('orders'), orderController.adminReceipt);

// buyers & sellers (logged-in customers)
router.post('/checkout', checkoutLimit, protectCustomer, orderController.checkout);
router.post('/walk-quote', protectCustomer, orderController.walkQuote);
router.post('/extras-quote', protectCustomer, orderController.extrasQuote);
const scanLimit = limit(10 * 60 * 1000, 40, 'Too many rider searches. Please wait a moment.');
router.post('/rider-scan', scanLimit, protectCustomer, orderController.riderScan); // 🔍 riders near the shop, ETA and fare
router.post('/:id/recheck', protectCustomer, require('../controllers/workController').recheck);
router.post('/:id/call-rider', protectCustomer, require('../controllers/workController').callRider);
// delivery records: one per store the order ships from (split fulfilment)
router.get('/:id/deliveries', protectCustomer, orderController.deliveriesOf);
router.post('/:id/deliveries/:deliveryId/status', protectCustomer, orderController.deliveryStatus);
router.post('/:id/deliveries/:deliveryId/received', protectCustomer, orderController.deliveryReceived);
router.post('/:id/deliveries/:deliveryId/call-rider', protectCustomer, require('../controllers/workController').callRiderLeg);
router.post('/:id/tip', protectCustomer, require('../controllers/workController').tip);
router.get('/checkout/:checkoutId', protectCustomer, orderController.checkoutStatus);
router.post('/checkout/:checkoutId/pay', payLimit, protectCustomer, orderController.retryPayment);
router.post('/checkout/:checkoutId/cod', protectCustomer, orderController.switchToCod);
// split payments (several sellers, each paid directly): the buyer's M-Pesa code, one receipt for the checkout,
// and the seller confirming the money arrived
router.post('/checkout/:checkoutId/code', payLimit, protectCustomer, orderController.claimPayment);
router.get('/checkout/:checkoutId/receipt.pdf', protectCustomer, orderController.checkoutReceipt);
router.post('/:id/payment', payLimit, protectCustomer, orderController.confirmPayment);
router.get('/mine', protectCustomer, orderController.mine);
router.get('/deliveries', protectCustomer, orderController.deliveries); // my deliveries: where each is now, items, history
router.get('/sales', protectCustomer, orderController.sales);
router.get('/counts', protectCustomer, orderController.counts);
router.get('/:id/receipt.pdf', protectCustomer, orderController.receipt);
router.get('/:id', protectCustomer, orderController.get);
router.get('/:id/review', protectCustomer, require('../controllers/trustController').getOrderReview);
router.post('/:id/review', protectCustomer, require('../controllers/trustController').reviewOrder);
router.post('/:id/status', protectCustomer, orderController.setStatus);
router.post('/:id/hide', protectCustomer, orderController.hide);

module.exports = router;
