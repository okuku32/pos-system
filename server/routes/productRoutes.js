const r = require('express').Router();
const c = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/auth');
const { productImage } = require('../middleware/upload');

r.get('/categories', protect, c.categories);
r.route('/').get(protect, c.list).post(protect, adminOnly, c.create);
r.route('/:id/image').post(protect, adminOnly, productImage, c.uploadImage).delete(protect, adminOnly, c.removeImage);
r.route('/:id').put(protect, adminOnly, c.update).delete(protect, adminOnly, c.remove);

module.exports = r;
