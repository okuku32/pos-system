const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const customerController = require('../controllers/customerController');
const { protectCustomer } = require('../middleware/customerAuth');
const { v: value, validate } = require('../security/validate');

// Slow down password guessing and mass sign-ups
const authLimit = rateLimit({ ...require('../security/rateStore')(),
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20, // per IP per 15 minutes
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
});

router.post('/register', authLimit, validate({ name: value.string({ min: 2, max: 60, label: 'your name' }), email: value.email(), phone: value.string({ min: 9, max: 16, label: 'your phone number', pattern: /^\+?[\d\s-]+$/, message: 'Please enter a valid Kenyan mobile number, e.g. 0712 345 678' }), password: value.string({ max: 200, trim: false }), confirmPassword: (val) => (typeof val === 'string' ? val.slice(0, 200) : undefined), accountType: value.oneOf(['buyer', 'seller'], { optional: true }), sellerTypes: (val) => (Array.isArray(val) ? val.filter((item) => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 20)) : undefined), sellerCategories: (val) => (Array.isArray(val) ? val.filter((item) => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 40)) : undefined), sellerItems: (val) => (Array.isArray(val) ? val.filter((item) => typeof item === 'string').slice(0, 60).map((item) => item.slice(0, 60)) : undefined), trade: (val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(['wholesale', 'imports', 'importFrom', 'vehicles', 'spares'].map((key) => [key, Array.isArray(val[key]) ? val[key].filter((item) => typeof item === 'string').slice(0, 60).map((item) => item.slice(0, 40)) : []])) : undefined), payDetails: (val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(['method', 'till', 'paybill', 'account', 'phone', 'name'].map((key) => [key, String(val[key] ?? '').slice(0, 60)])) : undefined), location: (val) => (val && typeof val === 'object' && !Array.isArray(val) ? { county: String(val.county ?? '').slice(0, 40), area: String(val.area ?? '').slice(0, 60), address: String(val.address ?? '').slice(0, 200), placeId: String(val.placeId ?? '').slice(0, 300), lat: Number(val.lat), lng: Number(val.lng) } : undefined) }), customerController.register);
router.post('/login', authLimit, validate({ login: value.string({ min: 3, max: 120, label: 'your email or phone' }), password: value.string({ max: 200, trim: false }) }), customerController.login);
router.post('/verify-email', authLimit, validate({ token: value.string({ max: 64, pattern: /^[a-f0-9]{64}$/, message: 'This link is invalid. Ask for a new one from the log-in page.' }) }), customerController.verifyEmail);
router.post('/resend-verification', authLimit, validate({ email: value.email() }), customerController.resendVerification);
router.post('/forgot-password', authLimit, validate({ email: value.email() }), customerController.forgotPassword);
router.post('/reset-password', authLimit, validate({ token: value.string({ max: 64, pattern: /^[a-f0-9]{64}$/, message: 'This reset link is invalid. Please request a new one.' }), password: value.string({ max: 200, trim: false }), confirmPassword: (val) => (typeof val === 'string' ? val.slice(0, 200) : undefined) }), customerController.resetPassword);
router.get('/oauth-config', (req, res) => res.json({ google: require('../utils/oauth').googleClientId() })); // Google's public client id for the sign-in button
router.post('/oauth/google', authLimit, validate({ credential: value.string({ min: 20, max: 5000 }), accountType: value.oneOf(['buyer', 'seller'], { optional: true }), sellerTypes: (val) => (Array.isArray(val) ? val.filter((item) => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 20)) : undefined), sellerCategories: (val) => (Array.isArray(val) ? val.filter((item) => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 40)) : undefined), sellerItems: (val) => (Array.isArray(val) ? val.filter((item) => typeof item === 'string').slice(0, 60).map((item) => item.slice(0, 60)) : undefined), trade: (val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(['wholesale', 'imports', 'importFrom', 'vehicles', 'spares'].map((key) => [key, Array.isArray(val[key]) ? val[key].filter((item) => typeof item === 'string').slice(0, 60).map((item) => item.slice(0, 40)) : []])) : undefined), payDetails: (val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(['method', 'till', 'paybill', 'account', 'phone', 'name'].map((key) => [key, String(val[key] ?? '').slice(0, 60)])) : undefined), location: (val) => (val && typeof val === 'object' && !Array.isArray(val) ? { county: String(val.county ?? '').slice(0, 40), area: String(val.area ?? '').slice(0, 60), address: String(val.address ?? '').slice(0, 200), placeId: String(val.placeId ?? '').slice(0, 300), lat: Number(val.lat), lng: Number(val.lng) } : undefined) }), customerController.google);
// sessions: swap an old login for a session cookie, log out, see / end my other sessions, change my password
router.post('/session', authLimit, customerController.session);
router.post('/logout', protectCustomer, customerController.logout);
router.get('/me/sessions', protectCustomer, customerController.sessions);
router.delete('/me/sessions', protectCustomer, customerController.signOutOthers);
router.post('/me/password', authLimit, protectCustomer, validate({ current: value.string({ max: 200, trim: false }), next: value.string({ max: 200, trim: false }) }), customerController.changePassword);
router.route('/me').get(protectCustomer, customerController.me).put(protectCustomer, customerController.updateMe);
router.put('/me/mpesa-connect', authLimit, protectCustomer, customerController.connectMpesa);
router.delete('/me/mpesa-connect', protectCustomer, customerController.disconnectMpesa);
router.post('/me/map-link', protectCustomer, customerController.mapLink);
router.post('/me/verify', protectCustomer, require('../controllers/trustController').requestVerification);
router.post('/me/chemist', protectCustomer, require('../controllers/customerController').requestChemist);
router.post('/me/open-status', protectCustomer, require('../controllers/customerController').openStatus);

module.exports = router;
