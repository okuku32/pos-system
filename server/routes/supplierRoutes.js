const r = require('express').Router();
const c = require('../controllers/supplierController');
const { protect, adminOnly } = require('../middleware/auth');

// Suppliers include cost prices, so they're for admins only
r.get('/options', protect, adminOnly, c.options);
r.route('/').get(protect, adminOnly, c.list).post(protect, adminOnly, c.create);
r.route('/:id').get(protect, adminOnly, c.get).put(protect, adminOnly, c.update).delete(protect, adminOnly, c.remove);

module.exports = r;
