const r = require('express').Router();
const c = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/auth');

r.route('/').get(protect, c.list).post(protect, c.create);
r.route('/:id').get(protect, c.get).put(protect, c.update).delete(protect, adminOnly, c.remove);
r.post('/:id/cancel', protect, c.cancel);
r.patch('/:id/stage', protect, c.setStage);

module.exports = r;
