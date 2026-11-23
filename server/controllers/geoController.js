// Address suggestions and road distances for the app. Addresses come from OpenStreetMap (market/osm.js: Photon for
// suggestions, Nominatim for a spot's address and typed addresses), with our own places first. Road distances use
// Google's Routes API only when a server key is set (market/googleMaps.js), otherwise they're estimated.
//   GET /api/geo/status                         { places, routes }: what's available
//   GET /api/geo/autocomplete?q=&lat=&lng=      suggestions as someone types (our places, then OpenStreetMap)
//   GET /api/geo/reverse?lat=&lng=              the address of a spot (a GPS fix, a dragged pin)
//   GET /api/geo/search?q=                      a typed address → a spot on the map
//   GET /api/geo/place/:placeId?session=        a picked suggestion → exact spot, county and area
//   GET /api/geo/route?from=lat,lng&to=lat,lng&mode=motorbike|car|walk   road km and minutes
//   GET /api/geo/road-line?points=lat,lng;lat,lng;…   the path along the actual roads through 2–6 stops (OpenStreetMap)
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const maps = require('../market/googleMaps');
const osm = require('../market/osm');
const { inKenya } = require('../market/geoKenya');

const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const pointFrom = (lat, lng) => {
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && inKenya(point.lat, point.lng) ? point : null;
};
const pair = (text) => {
  const [lat, lng] = String(text || '').split(',');
  return pointFrom(lat, lng);
};
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// our own places, when Google isn't available: pickup points and markets whose name or area matches
async function localPlaces(text) {
  const words = text.toLowerCase().split(' ').filter((word) => word.length > 1).slice(0, 4);
  if (!words.length) return [];
  const match = (fields) => ({ $and: words.map((word) => ({ $or: fields.map((field) => ({ [field]: new RegExp(escape(word), 'i') })) })) });
  const [allPoints, markets] = await Promise.all([
    require('../market/pickupPoints').all(), // active points (cached; filled in on a fresh database)
    require('../models/Market').find({ approved: true, ...match(['name', 'area', 'county']) }).limit(5).lean(),
  ]);
  const has = (item) => words.every((word) => [item.name, item.area, item.address, item.landmark].some((field) => String(field || '').toLowerCase().includes(word)));
  const points = allPoints.filter(has).slice(0, 5);
  const at = (item) => ({ lat: item.point.coordinates[1], lng: item.point.coordinates[0] });
  return [
    ...points.map((item) => ({ main: item.name, secondary: [item.address !== item.name ? item.address : '', item.area].filter(Boolean).join(', '), text: `${item.name}, ${item.area}`, lat: item.lat, lng: item.lng, area: item.area, county: 'Nairobi' })),
    ...markets.map((item) => ({ main: item.name, secondary: [item.area, item.county].filter(Boolean).join(', '), text: [item.name, item.area, item.county].filter(Boolean).join(', '), ...at(item), area: item.area || '', county: item.county })),
  ].slice(0, 6);
}

exports.status = (req, res) => {
  const on = maps.configured();
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ places: true, provider: 'openstreetmap', routes: on });
};

exports.autocomplete = asyncHandler(async (req, res) => {
  const text = clean(req.query.q, 120);
  if (text.length < 3) return res.json({ source: 'none', suggestions: [] });
  const near = pointFrom(req.query.lat, req.query.lng);
  // our pickup points and markets first, then OpenStreetMap's places (estates, buildings, streets, landmarks)
  const [ours, map] = await Promise.all([localPlaces(text), osm.suggest(text, near)]);
  const seen = new Set(ours.map((item) => item.main.toLowerCase()));
  const suggestions = [...ours.slice(0, 3), ...map.filter((item) => !seen.has(item.main.toLowerCase()))].slice(0, 7);
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ source: map.length ? 'osm' : 'local', suggestions });
});

// the address of a spot: a GPS fix or a dragged pin → { address, street, area, county }
exports.reverse = asyncHandler(async (req, res) => {
  const at = pointFrom(req.query.lat, req.query.lng);
  if (!at) throw httpError('A spot in Kenya, please (lat, lng)');
  const found = await osm.reverse(Math.round(at.lat * 1e5) / 1e5, Math.round(at.lng * 1e5) / 1e5);
  if (!found) throw httpError('No address found for that spot', 404);
  res.set('Cache-Control', 'private, max-age=600');
  res.json(found);
});

// a typed address → a spot: { lat, lng, address, area, county }
exports.search = asyncHandler(async (req, res) => {
  const text = clean(req.query.q, 160);
  if (text.length < 4) throw httpError('Type a longer address');
  const found = await osm.search(text);
  if (!found) throw httpError('That address wasn’t found on the map', 404);
  res.set('Cache-Control', 'private, max-age=600');
  res.json(found);
});

exports.place = asyncHandler(async (req, res) => {
  const place = await maps.placeDetails(req.params.placeId, { sessionToken: clean(req.query.session, 64) });
  if (!place) throw httpError('That place couldn’t be found. Try another one.', 404);
  if (!inKenya(place.lat, place.lng)) throw httpError('Please pick a place in Kenya');
  res.json(place);
});

// the path along the actual roads through the stops (the rider's map): OpenStreetMap routing; a straight line if
// the road route isn't available (source: 'straight'), so the map always has something to draw
exports.roadLine = asyncHandler(async (req, res) => {
  const points = String(req.query.points || '').split(';').slice(0, 7).map(pair);
  if (points.length < 2 || points.length > 6 || points.some((point) => !point)) throw httpError('2 to 6 places in Kenya, please (points=lat,lng;lat,lng)');
  const mode = ['motorbike', 'car', 'walk'].includes(req.query.mode) ? req.query.mode : 'motorbike';
  const road = await require('../market/osmRoute').roadRoute(points, mode);
  res.set('Cache-Control', 'private, max-age=300');
  if (road) return res.json({ source: 'osm', ...road });
  res.json({ source: 'straight', line: points.map((point) => [point.lat, point.lng]) });
});

exports.route = asyncHandler(async (req, res) => {
  const from = pair(req.query.from);
  const to = pair(req.query.to);
  if (!from || !to) throw httpError('Two places in Kenya, please (from=lat,lng&to=lat,lng)');
  const mode = ['motorbike', 'car', 'walk'].includes(req.query.mode) ? req.query.mode : 'motorbike';
  res.json(await maps.road(from, to, mode));
});
