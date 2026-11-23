// 🛣️ Routes along the actual roads (OpenStreetMap): the path a rider takes through their stops, with the road km and
// time of each leg. Uses an OSRM server: by default FOSSGIS's public one (routing.openstreetmap.de, the one
// openstreetmap.org uses for directions); set OSM_ROUTER_URL for your own. At most one request a second (their usage
// policy), with our app's name, cached for an hour. Never throws: null when the road route isn't available, and the app
// draws a straight line instead.
const ROUTER_ADDRESS = (process.env.OSM_ROUTER_URL || 'https://routing.openstreetmap.de/routed-car').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.OSM_ROUTER_TIMEOUT_MS || 12000); // the free server can be slow: the map shows a straight line until the road arrives
const GAP_MS = Number(process.env.OSM_ROUTER_GAP_MS ?? 1100);
const MAX_POINTS = 400; // enough for a smooth line on a phone; fewer bytes to send
const CITY_KMH = { motorbike: 24, car: 20, walk: 5 }; // in town, with traffic (OSRM's own times assume empty roads)
const inKenya = (lat, lng) => lat >= -5.2 && lat <= 5.5 && lng >= 33.4 && lng <= 42.4;
const userAgent = () => `KapuMarketplace/1.0 (+${require('../config/site').site().url})`;

const routeCache = new Map(); // "lat,lng;lat,lng" → { value, at }
const CACHE_LIFETIME_MS = 60 * 60 * 1000; // an hour: roads don’t change, and the free router asks us to cache
// undefined = not asked yet (or expired); null = asked, and there was no road (also worth remembering)
const fromCache = (cacheKey) => {
  const cached = routeCache.get(cacheKey);
  if (!cached) return undefined;
  if (Date.now() - cached.at > CACHE_LIFETIME_MS) { routeCache.delete(cacheKey); return undefined; }
  return cached.value;
};
const toCache = (cacheKey, value) => {
  // a Map keeps insertion order, so its first key is the oldest entry: drop it when full (a simple size cap)
  if (routeCache.size > 2000) routeCache.delete(routeCache.keys().next().value);
  routeCache.set(cacheKey, { value, at: Date.now() });
};

let fetchFunction = (...fetchArguments) => fetch(...fetchArguments); // replaced by a stand-in in the tests (configure)
// One request at a time, at least GAP_MS apart (the free router's usage policy): every request waits for the one before
// it on this promise chain. The chain swallows errors (requestQueue), but each caller still gets its own result or error.
let requestQueue = Promise.resolve();
let lastRequestAt = 0;
function askRouter(address) {
  const thisRequest = requestQueue.then(async () => {
    const waitMs = lastRequestAt + GAP_MS - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    const response = await fetchFunction(address, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  requestQueue = thisRequest.catch(() => {});
  return thisRequest;
}

// every nth point, always keeping the first and the last
function thin(points) {
  if (points.length <= MAX_POINTS) return points;
  const step = (points.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (unused, index) => points[Math.round(index * step)]);
}

// points: [{ lat, lng }, …] (2 to 6), in order → { km, minutes, legs: [{ km, minutes }], line: [[lat, lng], …] } | null
async function roadRoute(points, mode = 'motorbike') {
  if (!Array.isArray(points) || points.length < 2 || points.length > 6 || !points.every((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng) && inKenya(point.lat, point.lng))) return null;
  const cacheKey = points.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join(';');
  const cached = fromCache(cacheKey);
  const speed = CITY_KMH[mode] || CITY_KMH.motorbike;
  // the road is cached without times: the same road gives different minutes on a motorbike, in a car or on foot
  const withMinutes = (value) => value && { ...value, minutes: value.legs.reduce((sum, leg) => sum + Math.max(1, Math.round((leg.km / speed) * 60)), 0), legs: value.legs.map((leg) => ({ km: leg.km, minutes: Math.max(1, Math.round((leg.km / speed) * 60)) })) };
  if (cached !== undefined) return withMinutes(cached);
  try {
    // OSRM wants "lng,lat;lng,lat" (longitude first), and gives the line back as [lng, lat] pairs
    const coordinates = points.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');
    const data = await askRouter(`${ROUTER_ADDRESS}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`);
    const route = data?.code === 'Ok' ? data.routes?.[0] : null;
    if (!route?.geometry?.coordinates?.length) { toCache(cacheKey, null); return null; }
    const value = {
      km: Math.round(route.distance / 100) / 10,
      legs: (route.legs || []).map((leg) => ({ km: Math.round(leg.distance / 100) / 10 })),
      line: thin(route.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5])),
    };
    toCache(cacheKey, value);
    return withMinutes(value);
  } catch {
    return null; // not cached: try again next time
  }
}

// for tests: use a stand-in instead of the real router, and start with an empty cache
function configure({ fetch: replacementFetch } = {}) {
  if (replacementFetch) fetchFunction = replacementFetch;
  routeCache.clear();
  lastRequestAt = 0;
}

module.exports = { roadRoute, configure, ROUTER_ADDRESS };
