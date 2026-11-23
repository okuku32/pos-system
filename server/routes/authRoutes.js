const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const authController = require('../controllers/authController');
const { protect, adminOnly } = require('../middleware/auth');
const { requireGate } = require('../middleware/staffGate');
const { rateLimit } = require('express-rate-limit');
const { v: value, validate } = require('../security/validate');
const { requirePermission } = require('../security/rbac');
const staffLimit = rateLimit({ ...require('../security/rateStore')(), windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many attempts. Please wait a few minutes.' } });

// signing in only works from the private staff link (its key comes in the X-Staff-Gate header)
router.get('/gate', requireGate, authController.gate);
router.get('/setup', requireGate, authController.setupStatus);
router.post('/setup', staffLimit, requireGate, validate({ name: value.string({ min: 2, max: 60 }), email: value.email(), password: value.string({ max: 200, trim: false }) }), authController.setup);
router.post('/login', staffLimit, requireGate, validate({ email: value.email(), password: value.string({ max: 200, trim: false }) }), authController.login);
router.get('/oauth-config', requireGate, authController.oauthConfig);
router.post('/oauth/google', staffLimit, requireGate, validate({ credential: value.string({ min: 20, max: 5000 }) }), authController.google);

router.get('/me', protect, authController.me);
router.post('/password', staffLimit, protect, validate({ current: value.string({ max: 200, trim: false }), next: value.string({ max: 200, trim: false }) }), authController.changePassword);
router.post('/logout', protect, authController.logout);
router.post('/session', protect, authController.session);

// admins: the team of moderators, the sign-in log, and the private link itself
router.route('/users').get(protect, adminOnly, authController.listUsers).post(protect, adminOnly, authController.createUser);
router.route('/users/:id').put(protect, adminOnly, authController.updateUser).delete(protect, adminOnly, authController.deleteUser);
router.post('/users/:id/signout', protect, adminOnly, authController.signOutUser);
router.get('/events', protect, adminOnly, authController.events);
// the audit log (admins only): GET /api/auth/audit?action=&outcome=&actor=&page=
router.get('/audit', protect, requirePermission('audit.read'), require('../controllers/auditController').list);
router.route('/staff-link').get(protect, adminOnly, authController.staffLink).post(protect, adminOnly, authController.newStaffLink);

module.exports = router;
