const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const adminController = require('../controllers/adminController');
const { protect, adminOnly, can } = require('../middleware/auth');

router.get('/stats', protect, adminController.stats);
// the people tables: buyers, retailers, wholesalers, importers, riders, shopping agents
const people = require('../controllers/directoryController');
router.get('/people', protect, can('sellers'), people.counts);
router.post('/people/refresh', protect, can('sellers'), people.refresh);
router.get('/people/:kind', protect, can('sellers'), people.list);
// paid promotions (ad boosts): earnings by day, week or month
router.get('/promotions', protect, can('orders'), require('../controllers/promotionsController').report);
router.get('/settings', protect, adminController.getSettings);
router.put('/settings', protect, adminOnly, adminController.putSettings);
router.post('/email-test', protect, adminOnly, adminController.emailTest);

// sellers: verification requests, verify / suspend
const trust = require('../controllers/trustController');
router.get('/sellers', protect, can('sellers'), trust.adminSellers);
router.post('/sellers/:id', protect, can('sellers'), trust.adminSellerAction);

module.exports = router;
