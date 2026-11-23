const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const errandController = require('../controllers/errandController');
const { protectCustomer } = require('../middleware/customerAuth');
const { protect, can } = require('../middleware/auth');

// Errands: book our riders (parcels) or shopping agents (shopping) without buying from a seller
const booking = rateLimit({ ...require('../security/rateStore')(), windowMs: 10 * 60 * 1000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many bookings. Please wait a few minutes.' } });
router.get('/admin/list', protect, can('orders'), errandController.adminList);
router.get('/admin/pickup-points', protect, can('orders'), errandController.adminPoints);
router.post('/admin/pickup-points', protect, can('orders'), errandController.adminSavePoint);
router.put('/admin/pickup-points/:id', protect, can('orders'), errandController.adminSavePoint);
router.post('/admin/:id', protect, can('orders'), errandController.adminAction);
router.get('/admin/:id/list-photos/:n', protect, can('orders'), errandController.adminListPhoto);
router.post('/quote', protectCustomer, errandController.quote);
// 🛍️ Shop & ride with us: pickup points and prices are public (the page shows them before logging in)
const quoting = rateLimit({ ...require('../security/rateStore')(), windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many price checks. Please wait a minute.' } });
router.get('/pickup-points', errandController.pickupPoints);
router.post('/shopride/quote', quoting, errandController.shopRideQuote);
// 🛵 Ride with us: the price of every vehicle for a trip, before logging in (like Uber and Bolt); booking needs a login
router.post('/ride/quote', quoting, errandController.rideQuote);
// "What did you buy?" suggestions, and a seller on Kapu by phone (logged in) or id
// suggestions come with every keystroke in every item field: their own, roomier limit (not shared with price checks)
const suggesting = rateLimit({ ...require('../security/rateStore')(), windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many searches. Please wait a minute.' } });
router.get('/shopride/items', suggesting, errandController.shopRideItems);
const sellerLookup = rateLimit({ ...require('../security/rateStore')(), windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many seller look-ups. Please wait a few minutes.' } });
router.get('/shopride/seller', sellerLookup, require('../middleware/customerAuth').optionalCustomer, errandController.shopRideSeller);
router.post('/', booking, protectCustomer, errandController.create);
router.post('/list', booking, protectCustomer, errandController.listUpload, errandController.createList); // 🛒 the quick way: a written / photographed list
router.get('/mine', protectCustomer, errandController.mine);
router.get('/:id', protectCustomer, errandController.get);
router.get('/:id/list-photos/:n', protectCustomer, errandController.listPhoto);
router.post('/:id/cancel', protectCustomer, errandController.cancel);
router.post('/:id/received', protectCustomer, errandController.received);
router.post('/:id/pay-goods', booking, protectCustomer, errandController.payGoods);
router.post('/:id/pay', booking, protectCustomer, errandController.payAgain);

module.exports = router;
