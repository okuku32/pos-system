const r = require('express').Router();
const c = require('../controllers/authController');
const { protect, adminOnly } = require('../middleware/auth');

r.get('/setup', c.setupStatus);
r.post('/setup', c.setup);
r.post('/login', c.login);
r.get('/oauth-config', c.oauthConfig);
r.post('/oauth/google', c.google);
r.get('/me', protect, c.me);
r.route('/users').get(protect, adminOnly, c.listUsers).post(protect, adminOnly, c.createUser);
r.route('/users/:id').put(protect, adminOnly, c.updateUser).delete(protect, adminOnly, c.deleteUser);

module.exports = r;
