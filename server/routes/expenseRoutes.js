const r = require('express').Router();
const c = require('../controllers/expenseController');
const { protect, adminOnly } = require('../middleware/auth');

// Business running costs: admins only
r.use(protect, adminOnly);
r.get('/categories', c.categories);
r.route('/').get(c.list).post(c.create);
r.route('/:id').put(c.update).delete(c.remove);

module.exports = r;
