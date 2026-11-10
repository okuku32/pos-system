const r = require('express').Router();
const c = require('../controllers/saleController');
const { protect, adminOnly } = require('../middleware/auth');

r.get('/stats', protect, adminOnly, c.stats);
r.get('/today', protect, c.today);
r.route('/').get(protect, c.list).post(protect, c.create);
r.get('/:id', protect, c.get);

module.exports = r;
