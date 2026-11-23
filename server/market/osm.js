// OpenStreetMap address services (no API key), used by the app's maps (Leaflet + OpenStreetMap):
//   suggest(text, near)   suggestions as someone types   → Photon (komoot), built on OpenStreetMap, made for type-ahead
//   reverse(lat, lng)     the address of a spot (a GPS fix, a dragged pin) → Nominatim (OpenStreetMap)
//   search(text)          a typed address → a spot on the map            → Nominatim
// Kenya only. Results are cached; Nominatim is asked at most once a second (its usage policy), with our app's name.
// Never throws: on any problem the answer is null / [] and the app falls back to our own places or the GPS.
const { COUNTIES } = require('./categories');

const PHOTON = process.env.OSM_PHOTON_URL || 'https://photon.komoot.io';
const NOMINATIM = process.env.OSM_NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const KENYA_BBOX = '33.9,-4.8,41.95,5.1'; // west,south,east,north
const TIMEOUT = 4500;
const inKenya = (lat, lng) => lat >= -5.2 && lat <= 5.5 && lng >= 33.4 && lng <= 42.4;
// our app's name and website, as OpenStreetMap's usage policy asks (no personal data)
const userAgent = () => `KapuMarketplace/1.0 (+${require('../config/site').site().url})`;

// a small cache with a time limit (the same address is asked for again and again)
function cache(max, ttl) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttl) { map.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value) {
      if (map.size >= max) map.delete(map.keys().next().value);
      map.set(key, { value, at: Date.now() });
    },
    clear: () => map.clear(),
  };
}
const suggestCache = cache(3000, 30 * 60 * 1000);
const placeCache = cache(5000, 24 * 3600 * 1000);

let fetchImpl = (...args) => fetch(...args);
async function getJson(url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Nominatim: one request at a time, at least 1.1 s apart (its usage policy for the public server)
let queue = Promise.resolve();
let lastAt = 0;
const GAP_MS = Number(process.env.OSM_NOMINATIM_GAP_MS ?? 1100);
function nominatim(path) {
  const run = queue.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAt = Date.now();
    return getJson(`${NOMINATIM}${path}`);
  });
  queue = run.catch(() => {});
  return run;
}

// county and area from OpenStreetMap's address parts ("Nairobi County" → "Nairobi")
function countyOf(...names) {
  for (const raw of names) {
    const text = String(raw || '').replace(/\s*County$/i, '').trim().toLowerCase();
    if (!text) continue;
    const found = COUNTIES.find((county) => county.toLowerCase() === text) || COUNTIES.find((county) => text.includes(county.toLowerCase()));
    if (found) return found;
  }
  return '';
}
const join = (...parts) => [...new Set(parts.map((part) => String(part || '').trim()).filter(Boolean))].join(', ');

// ---------------------------------------------------------------- suggestions as someone types (Photon)
async function suggest(text, near) {
  const q = String(text || '').trim().slice(0, 120);
  if (q.length < 3) return [];
  const key = `${q.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;
  const hit = suggestCache.get(key);
  if (hit) return hit;
  try {
    const params = new URLSearchParams({ q, limit: '10', lang: 'en', bbox: KENYA_BBOX });
    if (near) { params.set('lat', String(near.lat)); params.set('lon', String(near.lng)); }
    const data = await getJson(`${PHOTON}/api/?${params}`);
    const seen = new Set();
    const out = [];
    for (const feature of data.features || []) {
      const p = feature.properties || {};
      const [lng, lat] = feature.geometry?.coordinates || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKenya(lat, lng)) continue;
      if (p.countrycode && p.countrycode.toUpperCase() !== 'KE') continue;
      const street = join(p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street);
      const main = p.name || street || p.district || p.city;
      if (!main) continue;
      const area = p.district || p.locality || p.city || '';
      const county = countyOf(p.county, p.state, p.city);
      const secondary = join(p.name && street ? street : '', area !== main ? area : '', p.city !== area && p.city !== main ? p.city : '', county && county !== p.city ? county : '');
      const dedupe = `${main}|${secondary}`.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ main, secondary, text: join(main, secondary), lat, lng, area, county, street, distanceMeters: near ? Math.round(distanceKm(near, { lat, lng }) * 1000) : null });
      if (out.length >= 6) break;
    }
    suggestCache.set(key, out);
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- the address of a spot (Nominatim reverse)
async function reverse(lat, lng) {
  if (!inKenya(lat, lng)) return null;
  const key = `r|${lat.toFixed(5)},${lng.toFixed(5)}`; // about 1 m
  const hit = placeCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const data = await nominatim(`/reverse?${new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '18', addressdetails: '1' })}`);
    const a = data.address || {};
    const street = join(a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road);
    const area = a.neighbourhood || a.suburb || a.quarter || a.village || a.town || a.city_district || '';
    const town = a.city || a.town || a.municipality || '';
    const named = data.name && data.name !== a.road ? data.name : '';
    const address = join(named, street, area, town !== area ? town : '');
    const result = address ? { address, street, area, county: countyOf(a.county, a.state, a.city), lat, lng } : null;
    placeCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- a typed address → a spot (Nominatim search)
async function search(text) {
  const q = String(text || '').trim().slice(0, 160);
  if (q.length < 4) return null;
  const key = `s|${q.toLowerCase()}`;
  const hit = placeCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const data = await nominatim(`/search?${new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'ke', limit: '1', addressdetails: '1' })}`);
    const best = data?.[0];
    const lat = Number(best?.lat);
    const lng = Number(best?.lon);
    let result = null;
    if (best && inKenya(lat, lng)) {
      const a = best.address || {};
      result = {
        lat, lng,
        address: String(best.display_name || '').replace(/,\s*Kenya$/, '').split(',').slice(0, 4).map((part) => part.trim()).join(', '),
        area: a.neighbourhood || a.suburb || a.village || a.town || '', county: countyOf(a.county, a.state, a.city),
      };
    }
    placeCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// tests: a fake fetch, and empty caches
function configure({ fetch: fn } = {}) {
  if (fn) fetchImpl = fn;
  suggestCache.clear();
  placeCache.clear();
  lastAt = 0;
}

module.exports = { suggest, reverse, search, countyOf, configure, KENYA_BBOX };
