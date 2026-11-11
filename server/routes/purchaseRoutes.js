const r = require('express').Router();
const c = require('../controllers/purchaseController');
const { protect, adminOnly } = require('../middleware/auth');

// Purchases include cost prices and supplier balances: admins only
r.use(protect, adminOnly);
r.get('/suggest', c.suggest);
r.route('/').get(c.list).post(c.create);
r.route('/:id').get(c.get).put(c.update);
r.post('/:id/receive', c.receive);
r.post('/:id/payments', c.addPayment);
r.post('/:id/cancel', c.cancel);

module.exports = r;
