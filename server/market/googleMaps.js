// Google Maps Platform from the server: Places API (New) for address suggestions, and the Routes API for the real
// road distance and travel time (delivery prices, ETAs).
//
// Key: GOOGLE_MAPS_SERVER_KEY (a server key: restrict it by IP to Places API (New) + Routes API), or else the site's
// browser key (Admin → Settings → Google Maps key / GOOGLE_MAPS_API_KEY). No key, a refused key, a timeout:
// suggestions come from our own places (pickup points, markets, stores) and distances fall back to the straight line
// × 1.3, so checkout and prices never break.
//
// Everything is cached (same address text → same suggestions for 10 min; same two points ~11 m apart → same route for
// 20 min), so a buyer typing or a quote then a checkout costs one Google call, and both see the same price.
const axios = require('axios');
const { site } = require('../config/site');
const { distanceKm } = require('./geo');

const ROAD = 1.3;
const TIMEOUT = 3500;
const SPEED = { motorbike: 22, car: 18, walk: 4.5 }; // km/h in town, for the fallback estimate
const MODE = { motorbike: 'TWO_WHEELER', car: 'DRIVE', walk: 'WALK' };

const key = () => process.env.GOOGLE_MAPS_SERVER_KEY || site().mapsKey || '';
const configured = () => !!key();

// ---------------------------------------------------------------- tiny TTL cache
function cache(max, ttl) {
  const map = new Map();
  return {
    get(name) {
      const hit = map.get(name);
      if (!hit) return undefined;
      if (hit.until < Date.now()) { map.delete(name); return undefined; }
      return hit.value;
    },
    set(name, value) {
      if (map.size >= max) map.delete(map.keys().next().value); // oldest first
      map.set(name, { value, until: Date.now() + ttl });
    },
    clear: () => map.clear(),
  };
}
const suggestCache = cache(2000, 10 * 60 * 1000);
const placeCache = cache(2000, 60 * 60 * 1000);
const routeCache = cache(5000, 20 * 60 * 1000);
// after Google refuses the key, don't keep asking for a minute
let downUntil = 0;
const usable = () => configured() && Date.now() > downUntil;
const failed = (error) => {
  const status = error?.response?.status;
  if (status === 401 || status === 403) downUntil = Date.now() + 60 * 1000;
  if (process.env.NODE_ENV !== 'test') console.error('Google Maps:', status || '', error?.response?.data?.error?.message || error.message);
};
const headers = (fieldMask) => ({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': key(), ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) });
const validPoint = (point) => point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
const round = (value, places = 4) => Number(Number(value).toFixed(places));

// ---------------------------------------------------------------- Places API (New)
// suggestions for what someone typed: [{ placeId, main, secondary, text, distanceMeters }]
async function autocomplete(input, { sessionToken, near } = {}) {
  const text = String(input || '').trim().slice(0, 120);
  if (text.length < 3 || !usable()) return null;
  const bias = validPoint(near) ? { lat: round(near.lat, 2), lng: round(near.lng, 2) } : null; // ~1 km: shared across nearby people
  const name = `${text.toLowerCase()}|${bias ? `${bias.lat},${bias.lng}` : ''}`;
  const hit = suggestCache.get(name);
  if (hit) return hit;
  try {
    const { data } = await axios.post('https://places.googleapis.com/v1/places:autocomplete', {
      input: text, includedRegionCodes: ['ke'], languageCode: 'en', regionCode: 'ke',
      ...(sessionToken ? { sessionToken: String(sessionToken).slice(0, 64) } : {}),
      ...(bias ? { locationBias: { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 30000 } }, origin: { latitude: bias.lat, longitude: bias.lng } } : {}),
    }, { headers: headers(), timeout: TIMEOUT });
    const list = (data?.suggestions || []).map((item) => item.placePrediction).filter(Boolean).slice(0, 6).map((prediction) => ({
      placeId: prediction.placeId,
      main: prediction.structuredFormat?.mainText?.text || prediction.text?.text || '',
      secondary: (prediction.structuredFormat?.secondaryText?.text || '').replace(/,\s*Kenya$/, ''),
      text: (prediction.text?.text || '').replace(/,\s*Kenya$/, ''),
      ...(prediction.distanceMeters != null ? { distanceMeters: prediction.distanceMeters } : {}),
    }));
    suggestCache.set(name, list);
    return list;
  } catch (error) {
    failed(error);
    return null;
  }
}

// county & area from Google's address parts
function partsFrom(components = [], counties = []) {
  const get = (type) => components.find((item) => item.types?.includes(type))?.longText || '';
  const raw = get('administrative_area_level_1').replace(/\s*County$/i, '').trim();
  const county = counties.find((item) => item.toLowerCase() === raw.toLowerCase()) || counties.find((item) => raw.toLowerCase().includes(item.toLowerCase())) || '';
  return { county, area: get('neighborhood') || get('sublocality_level_1') || get('sublocality') || get('locality') || '', street: [get('street_number'), get('route')].filter(Boolean).join(' ') };
}

// one suggestion → the exact spot: { placeId, lat, lng, name, address, text, county, area, street }
async function placeDetails(placeId, { sessionToken } = {}) {
  const id = String(placeId || '');
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id) || !usable()) return null;
  const hit = placeCache.get(id);
  if (hit) return hit;
  try {
    const { data } = await axios.get(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
      params: { languageCode: 'en', regionCode: 'ke', ...(sessionToken ? { sessionToken: String(sessionToken).slice(0, 64) } : {}) },
      headers: headers('id,displayName,formattedAddress,location,addressComponents'), timeout: TIMEOUT,
    });
    const lat = data?.location?.latitude;
    const lng = data?.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const address = String(data.formattedAddress || '').replace(/,\s*Kenya$/, '');
    const name = data.displayName?.text || '';
    const { COUNTIES } = require('./categories');
    const place = { placeId: data.id || id, lat, lng, name, address, text: name && address && !address.startsWith(name) ? `${name}, ${address}` : address || name, ...partsFrom(data.addressComponents, COUNTIES) };
    placeCache.set(id, place);
    return place;
  } catch (error) {
    failed(error);
    return null;
  }
}

// ---------------------------------------------------------------- Routes API
const parseSeconds = (duration) => {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(duration || ''));
  return match ? Number(match[1]) : null;
};
async function askRoutes(from, to, travelMode) {
  const { data } = await axios.post('https://routes.googleapis.com/directions/v2:computeRoutes', {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode, ...(travelMode === 'WALK' ? {} : { routingPreference: 'TRAFFIC_AWARE' }),
    regionCode: 'ke', languageCode: 'en', units: 'METRIC',
  }, { headers: headers('routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'), timeout: TIMEOUT });
  const route = data?.routes?.[0];
  const seconds = parseSeconds(route?.duration);
  if (!route || !(route.distanceMeters >= 0) || seconds == null) return null;
  return { meters: route.distanceMeters, seconds, polyline: route.polyline?.encodedPolyline || '' };
}

// the road between two points: { km, minutes, source: 'google' | 'estimate', polyline? }. Never throws.
// mode: motorbike (riders) · car · walk
async function road(from, to, mode = 'motorbike') {
  if (!validPoint(from) || !validPoint(to)) return null;
  const a = { lat: round(from.lat), lng: round(from.lng) };
  const b = { lat: round(to.lat), lng: round(to.lng) };
  const estimate = () => {
    const km = Math.round(distanceKm(a, b) * ROAD * 10) / 10;
    return { km, minutes: Math.max(1, Math.round((km / (SPEED[mode] || SPEED.motorbike)) * 60)), source: 'estimate' };
  };
  if (!usable()) return estimate();
  const name = `${a.lat},${a.lng}>${b.lat},${b.lng}|${mode}`;
  const hit = routeCache.get(name);
  if (hit) return hit;
  try {
    let found = null;
    try {
      found = await askRoutes(a, b, MODE[mode] || 'TWO_WHEELER');
    } catch (error) {
      if (mode !== 'motorbike' || error?.response?.status !== 400) throw error;
      found = await askRoutes(a, b, 'DRIVE'); // motorbike routes not offered there: a car's route
    }
    if (!found) return estimate();
    const result = { km: Math.round(found.meters / 100) / 10, minutes: Math.max(1, Math.round(found.seconds / 60)), source: 'google', ...(found.polyline ? { polyline: found.polyline } : {}) };
    routeCache.set(name, result);
    return result;
  } catch (error) {
    failed(error);
    return estimate();
  }
}

const reset = () => { suggestCache.clear(); placeCache.clear(); routeCache.clear(); downUntil = 0; };

module.exports = { configured, autocomplete, placeDetails, road, partsFrom, reset, ROAD };
