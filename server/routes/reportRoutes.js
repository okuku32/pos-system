const r = require('express').Router();
const c = require('../controllers/reportController');
const { protect, adminOnly } = require('../middleware/auth');

r.get('/summary', protect, adminOnly, c.summary);

module.exports = r;
