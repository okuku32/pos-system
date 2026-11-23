// Addresses and road distances (Google Places API (New) + Routes API, through the server; see market/googleMaps.js)
const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const geo = require('../controllers/geoController');

const limit = (windowMs, number) => rateLimit({ ...require('../security/rateStore')(), windowMs, limit: number, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many address searches. Please wait a moment.' } });
const typing = limit(60 * 1000, 120); // suggestions while typing (debounced in the app)
const picking = limit(60 * 1000, 40);
const routing = limit(60 * 1000, 60);

router.get('/status', geo.status);
router.get('/autocomplete', typing, geo.autocomplete);
router.get('/place/:placeId', picking, geo.place);
router.get('/route', routing, geo.route);
router.get('/road-line', routing, geo.roadLine); // 🛣️ the path along the actual roads (OpenStreetMap)
const looking = limit(60 * 1000, 30); // a spot's address / a typed address (OpenStreetMap: shared fairly)
router.get('/reverse', looking, geo.reverse);
router.get('/search', looking, geo.search);

module.exports = router;
