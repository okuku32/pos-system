const r = require('express').Router();
const c = require('../controllers/mpesaController');
const { protect, adminOnly } = require('../middleware/auth');

r.post('/callback', c.callback); // public - called by Safaricom
r.get('/status/:saleId', protect, c.status);
r.post('/cancel/:saleId', protect, c.cancel);
r.get('/test', protect, adminOnly, c.testAuth);

module.exports = r;
