// Maps through the server:   cd server && npm run test:maps
//   addresses: OpenStreetMap (Photon + Nominatim) · road distances: Google's Routes API when a server key is set
// Real server on a throw-away database; Google and OpenStreetMap are stand-ins that record every request and answer like
// the real services (the tests never reach the internet).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_maps_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  MPESA_CONSUMER_KEY: '', ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 'm'.repeat(48), AUTH_RATE_LIMIT: '400',
  GOOGLE_MAPS_SERVER_KEY: 'AIzaTestServerKey1234567890', GOOGLE_MAPS_API_KEY: '',
  OSM_NOMINATIM_GAP_MS: '300', // Nominatim's "one request a second", shortened for the tests
});
const mongoose = require('mongoose');

// ---------------------------------------------------------------- OpenStreetMap stand-in (Photon + Nominatim)
const osmCalls = [];
let osmDown = false;
async function fakeOsm(url, options) {
  osmCalls.push({ url: String(url), at: Date.now(), agent: options?.headers?.['User-Agent'] || '' });
  if (osmDown) throw new Error('getaddrinfo ENOTFOUND');
  const u = new URL(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (u.pathname === '/api/') { // Photon: a Kenyan place, and one abroad (filtered out)
    return json({ features: [
      { geometry: { coordinates: [36.9007, -1.2182] }, properties: { name: 'Kasarani Mwiki Road', district: 'Kasarani', city: 'Nairobi', county: 'Nairobi County', countrycode: 'KE' } },
      { geometry: { coordinates: [-0.1276, 51.5072] }, properties: { name: 'Kasarani London Road', city: 'London', countrycode: 'GB' } },
    ] });
  }
  if (u.pathname === '/reverse') return json({ name: 'Gikomba Market', address: { road: 'Meru Road', suburb: 'Bondeni', city: 'Nairobi', county: 'Nairobi County' } });
  if (u.pathname === '/search') return json(/nowhere/i.test(u.searchParams.get('q')) ? [] : [{ lat: '-1.2863', lon: '36.8414', display_name: 'Gikomba Market, Meru Road, Bondeni, Nairobi, Kenya', address: { suburb: 'Bondeni', county: 'Nairobi County' } }]);
  return { ok: false, status: 404, json: async () => ({}) };
}

// ---------------------------------------------------------------- Google stand-in
const axios = require('axios');
const realGet = axios.get;
const realPost = axios.post;
const calls = [];
let routeReply = () => ({ data: { routes: [{ distanceMeters: 6200, duration: '1080s', polyline: { encodedPolyline: 'abc' } }] } });
let refuse = null; // (url) => status, to make Google refuse
const google = (url) => /googleapis\.com/.test(url);
axios.post = async (url, body, cfg) => {
  if (!google(url)) return realPost(url, body, cfg);
  calls.push({ url, body, headers: cfg.headers });
  const status = refuse?.(url, body);
  if (status) throw Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { error: { message: 'refused' } } } });
  if (/places:autocomplete/.test(url)) {
    return { data: { suggestions: [
      { placePrediction: { placeId: 'ChIJ_yaya_centre_0001', text: { text: 'Yaya Centre, Argwings Kodhek Road, Nairobi, Kenya' }, structuredFormat: { mainText: { text: 'Yaya Centre' }, secondaryText: { text: 'Argwings Kodhek Road, Nairobi, Kenya' } }, distanceMeters: 2300 } },
      { placePrediction: { placeId: 'ChIJ_yaya_towers_0002', text: { text: 'Yaya Towers, Nairobi, Kenya' }, structuredFormat: { mainText: { text: 'Yaya Towers' }, secondaryText: { text: 'Nairobi, Kenya' } } } },
    ] } };
  }
  if (/computeRoutes/.test(url)) return routeReply(body);
  throw new Error('unexpected Google call ' + url);
};
axios.get = async (url, cfg) => {
  if (!google(url)) return realGet(url, cfg);
  calls.push({ url, params: cfg.params, headers: cfg.headers });
  const status = refuse?.(url);
  if (status) throw Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
  if (/places\/ChIJ_yaya_centre_0001/.test(url)) {
    return { data: { id: 'ChIJ_yaya_centre_0001', displayName: { text: 'Yaya Centre' }, formattedAddress: 'Argwings Kodhek Rd, Nairobi, Kenya', location: { latitude: -1.2925, longitude: 36.7876 },
      addressComponents: [{ longText: 'Argwings Kodhek Road', types: ['route'] }, { longText: 'Kilimani', types: ['sublocality_level_1', 'sublocality'] }, { longText: 'Nairobi', types: ['locality'] }, { longText: 'Nairobi County', types: ['administrative_area_level_1'] }] } };
  }
  if (/places\/ChIJ_london_0003/.test(url)) return { data: { id: 'ChIJ_london_0003', displayName: { text: 'Big Ben' }, formattedAddress: 'London, UK', location: { latitude: 51.5, longitude: -0.12 } } };
  throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
};
const googleCalls = (re) => calls.filter((call) => re.test(call.url)).length;

let ipN = 0;
const api = async (method, url, body, who) => {
  const res = await fetch(BASE + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.70.0.${(ipN = (ipN % 250) + 1)}`, ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.json)); return res.json; };
const maps = () => require('../market/googleMaps');

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  require('../server');
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && mongoose.connection.readyState === 1) break; } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  require('../market/osm').configure({ fetch: fakeOsm });
});
after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

test('addresses come from OpenStreetMap: suggestions (Kenya only, near you, our places first), a pin’s address, a typed address', async () => {
  assert.deepEqual(ok(await api('GET', '/geo/status')), { places: true, provider: 'openstreetmap', routes: true });
  const res = ok(await api('GET', '/geo/autocomplete?q=kasarani&lat=-1.2195&lng=36.8980'));
  assert.equal(res.source, 'osm');
  const road = res.suggestions.find((item) => item.main === 'Kasarani Mwiki Road');
  assert.ok(road, JSON.stringify(res.suggestions));
  assert.deepEqual([road.lat, road.lng, road.area, road.county, road.secondary], [-1.2182, 36.9007, 'Kasarani', 'Nairobi', 'Kasarani, Nairobi']);
  assert.ok(road.distanceMeters > 0 && road.distanceMeters < 1000, 'how far from them');
  assert.ok(!res.suggestions.some((item) => /London/.test(item.main)), 'Kenya only');
  assert.ok(res.suggestions[0].main.includes('Kasarani') && Number.isFinite(res.suggestions[0].lat), 'our own pickup point first');
  const photon = osmCalls.find((call) => call.url.includes('/api/'));
  const sent = new URL(photon.url);
  assert.deepEqual([sent.searchParams.get('q'), sent.searchParams.get('bbox'), sent.searchParams.get('lat'), sent.searchParams.get('lon')], ['kasarani', '33.9,-4.8,41.95,5.1', '-1.2195', '36.898']);
  assert.match(photon.agent, /^KapuMarketplace\/1\.0 \(\+/, 'our app is named (OpenStreetMap’s usage policy)');
  const asked = osmCalls.length;
  ok(await api('GET', '/geo/autocomplete?q=KASARANI&lat=-1.2196&lng=36.8981'));
  assert.equal(osmCalls.length, asked, 'the same text nearby: from the cache');
  assert.deepEqual(ok(await api('GET', '/geo/autocomplete?q=ka')).suggestions, []);
  assert.equal(osmCalls.length, asked, 'fewer than 3 letters: nobody is asked');

  // the address of a spot (GPS / a dragged pin), and a typed address on the map
  const spot = ok(await api('GET', '/geo/reverse?lat=-1.2863&lng=36.8414'));
  assert.deepEqual([spot.address, spot.street, spot.area, spot.county], ['Gikomba Market, Meru Road, Bondeni, Nairobi', 'Meru Road', 'Bondeni', 'Nairobi']);
  const found = ok(await api('GET', '/geo/search?q=Gikomba market'));
  assert.deepEqual([found.lat, found.lng, found.area, found.county], [-1.2863, 36.8414, 'Bondeni', 'Nairobi']);
  assert.equal((await api('GET', '/geo/search?q=nowhere at all')).status, 404);
  assert.equal((await api('GET', '/geo/reverse?lat=51.5&lng=-0.12')).status, 400, 'outside Kenya');
  assert.equal((await api('GET', '/geo/reverse?lat=abc&lng=1')).status, 400);
  assert.equal((await api('GET', '/geo/search?q=ab')).status, 400);
  // Nominatim: one request at a time, spaced out (its usage policy)
  const nominatim = osmCalls.filter((call) => /\/(reverse|search)/.test(call.url));
  for (let n = 1; n < nominatim.length; n += 1) assert.ok(nominatim[n].at - nominatim[n - 1].at >= 280, `spaced out (${nominatim[n].at - nominatim[n - 1].at} ms)`);
  const before = osmCalls.length;
  ok(await api('GET', '/geo/reverse?lat=-1.2863&lng=36.8414'));
  assert.equal(osmCalls.length, before, 'the same spot again: from the cache');
});

test('picking a suggestion gives the exact spot, street, area and county; bad or foreign places are refused', async () => {
  const place = ok(await api('GET', '/geo/place/ChIJ_yaya_centre_0001?session=s-123'));
  assert.deepEqual(place, { placeId: 'ChIJ_yaya_centre_0001', lat: -1.2925, lng: 36.7876, name: 'Yaya Centre', address: 'Argwings Kodhek Rd, Nairobi', text: 'Yaya Centre, Argwings Kodhek Rd, Nairobi', county: 'Nairobi', area: 'Kilimani', street: 'Argwings Kodhek Road' });
  const details = calls.find((call) => /places\/ChIJ_yaya/.test(call.url));
  assert.equal(details.headers['X-Goog-FieldMask'], 'id,displayName,formattedAddress,location,addressComponents', 'only the fields we need (cheaper)');
  assert.equal(details.params.sessionToken, 's-123', 'the pick closes the typing session');
  const before = calls.length;
  assert.equal((await api('GET', '/geo/place/..%2F..%2Fsecret')).status, 404);
  assert.equal((await api('GET', '/geo/place/x')).status, 404);
  assert.equal(calls.length, before, 'odd ids never reach Google');
  assert.equal((await api('GET', '/geo/place/ChIJ_london_0003')).status, 400, 'outside Kenya');
});

test('road distance and time come from the Routes API (motorbike, traffic-aware), cached; a car route when motorbikes aren’t offered', async () => {
  const route = ok(await api('GET', '/geo/route?from=-1.2864,36.8219&to=-1.2925,36.7876'));
  assert.deepEqual(route, { km: 6.2, minutes: 18, source: 'google', polyline: 'abc' });
  const sent = calls.filter((call) => /computeRoutes/.test(call.url)).pop();
  assert.deepEqual([sent.body.travelMode, sent.body.routingPreference, sent.headers['X-Goog-FieldMask']], ['TWO_WHEELER', 'TRAFFIC_AWARE', 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline']);
  ok(await api('GET', '/geo/route?from=-1.28641,36.82191&to=-1.29251,36.78759'));
  assert.equal(googleCalls(/computeRoutes/), 1, 'the same trip (a few metres apart): from the cache');
  // motorbike routes refused for this trip: a car's route instead
  refuse = (url, body) => (/computeRoutes/.test(url) && body.travelMode === 'TWO_WHEELER' ? 400 : 0);
  const car = ok(await api('GET', '/geo/route?from=-1.30,36.80&to=-1.25,36.85'));
  assert.equal(car.source, 'google');
  assert.equal(calls.filter((call) => /computeRoutes/.test(call.url)).pop().body.travelMode, 'DRIVE');
  refuse = null;
  assert.equal((await api('GET', '/geo/route?from=51.5,-0.1&to=-1.29,36.78')).status, 400, 'Kenya only');
});

test('delivery prices use the real road: rider fee, errands and Shop & ride door delivery', async () => {
  maps().reset();
  routeReply = () => ({ data: { routes: [{ distanceMeters: 6200, duration: '1500s' }] } });
  const email = 'shop@maps.test';
  ok(await api('POST', '/customers/register', { name: 'Map Shop', email, phone: '0711800001', password: 'Kenya-Market-2026', confirmPassword: 'Kenya-Market-2026', accountType: 'seller', payDetails: { method: 'till', till: '512345', name: 'Test Shop' }, sellerTypes: ['shop'], sellerCategories: ['electronics'], location: { county: 'Nairobi', area: 'CBD', lat: -1.2864, lng: 36.8219 } }), 201);
  const seller = await mongoose.connection.collection('customers').findOne({ email });
  // the rider, like Uber / Bolt: KSh 100 + 30 per road km (6.2 km) + 2 per minute (25 min) = 336 → 340 (straight line × 1.3 would be different)
  const quote = ok(await api('GET', `/market/delivery-quote?seller=${seller._id}&near=-1.2925,36.7876`));
  assert.deepEqual([quote.rider.km, quote.rider.fee], [6.2, 340]);
  await mongoose.connection.collection('customers').updateOne({ email }, { $set: { emailVerified: true } });
  const login = ok(await api('POST', '/customers/login', { login: email, password: 'Kenya-Market-2026' }));
  const errand = ok(await api('POST', '/errands/quote', { kind: 'parcel', pickup: { lat: -1.2864, lng: 36.8219 }, dropoff: { lat: -1.2925, lng: 36.7876 } }, { token: login.token }));
  // a parcel errand is a Ride with us trip: the bike, 70 + 20 × 6.2 + 2 × 25 = 244, × 1.3 for heavy traffic (25 min for
  // 6.2 km is over twice the empty-road time) = 317 → 320
  assert.deepEqual([errand.km, errand.delivery], [6.2, 320], 'a parcel errand: the bike fare on the road, with the traffic surge');
  // Shop & ride to the door: Bolt Send style on the road's km and Google's minutes (traffic included)
  const points = ok(await api('GET', '/errands/pickup-points')).points;
  const kilimani = points.find((item) => item.area === 'Kilimani');
  const door = ok(await api('POST', '/errands/shopride/quote', { sellers: [{ fromArea: points.find((item) => item.hub)._id, weightKg: 1, items: [{ name: 'Shoes', qty: 1, price: 1000 }] }], mode: 'door', pointId: kilimani._id, to: { lat: -1.2925, lng: 36.7876 } }));
  const rates = require('../market/shopRide').rates(require('../config/site').site().fieldwork?.shopRide);
  const expected = Math.max(rates.door.min, Math.round((rates.door.base + rates.door.perKm * 6.2 + rates.door.perMin * 25) / 10) * 10);
  assert.deepEqual([door.door?.km ?? door.parts?.[0]?.door?.km ?? door.totals?.doorKm, door.door?.fare ?? door.totals?.door], [6.2, expected], JSON.stringify(door).slice(0, 400));
});

test('when Google refuses or is down: prices are estimated, suggestions come from our own places, and nothing breaks', async () => {
  maps().reset();
  refuse = () => 403; // e.g. the key was restricted or billing is off
  const route = ok(await api('GET', '/geo/route?from=-1.2864,36.8219&to=-1.2925,36.7876'));
  assert.equal(route.source, 'estimate');
  const asked = calls.length;
  ok(await api('GET', '/geo/route?from=-1.20,36.90&to=-1.25,36.85'));
  assert.equal(calls.length, asked, 'a refused key isn’t asked again for a minute');
  refuse = null;
  // no key at all: our pickup points and markets
  maps().reset();
  const saved = process.env.GOOGLE_MAPS_SERVER_KEY;
  process.env.GOOGLE_MAPS_SERVER_KEY = '';
  try {
    assert.deepEqual(ok(await api('GET', '/geo/status')), { places: true, provider: 'openstreetmap', routes: false });
    osmDown = true; // and OpenStreetMap unreachable: our own pickup points and markets
    const local = ok(await api('GET', '/geo/autocomplete?q=fedha'));
    assert.equal(local.source, 'local');
    assert.ok(local.suggestions.some((item) => /Fedha/.test(item.main) && Number.isFinite(item.lat) && Number.isFinite(item.lng)), JSON.stringify(local.suggestions));
    const before = calls.length;
    const estimate = ok(await api('GET', '/geo/route?from=-1.2864,36.8219&to=-1.2925,36.7876'));
    assert.equal(estimate.source, 'estimate');
    assert.equal(calls.length, before, 'no key: Google is never called');
  } finally {
    process.env.GOOGLE_MAPS_SERVER_KEY = saved;
    osmDown = false;
  }
});

test('GET /geo/road-line: the path along the actual roads; a straight line when the router is down; bad input refused', async () => {
  // a stand-in for the OpenStreetMap router (OSRM), answering in its format: [lng, lat] points, metres per leg
  const osmRoute = require('../market/osmRoute');
  let routerDown = false;
  osmRoute.configure({
    fetch: async () => {
      if (routerDown) throw new Error('connect ETIMEDOUT');
      return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ distance: 6200, legs: [{ distance: 6200 }], geometry: { coordinates: [[36.8172, -1.2864], [36.8300, -1.2900], [36.8473, -1.3032]] } }] }) };
    },
  });
  const road = ok(await api('GET', '/geo/road-line?points=-1.2864,36.8172;-1.3032,36.8473&mode=car'));
  assert.equal(road.source, 'osm');
  assert.equal(road.km, 6.2);
  assert.equal(road.legs.length, 1);
  assert.deepEqual(road.line[1], [-1.29, 36.83], 'points come back as [lat, lng]');

  routerDown = true;
  osmRoute.configure(); // empty the cache, keep the stand-in
  const straight = ok(await api('GET', '/geo/road-line?points=-1.2000,36.9000;-1.2500,36.8500'));
  assert.equal(straight.source, 'straight');
  assert.deepEqual(straight.line, [[-1.2, 36.9], [-1.25, 36.85]]);

  ok(await api('GET', '/geo/road-line?points=-1.2864,36.8172'), 400); // one place
  ok(await api('GET', '/geo/road-line?points=51.5,-0.12;-1.30,36.84'), 400); // London isn't in Kenya
  ok(await api('GET', '/geo/road-line?points=abc;def'), 400);
});

test('Ride with us: public prices per vehicle with surge, size limits, Nairobi only, the price lock; a car booking goes only to car riders', async () => {
  maps().reset();
  routeReply = () => ({ data: { routes: [{ distanceMeters: 6200, duration: '1500s' }] } }); // 6.2 km, 25 min with traffic
  const cbd = { lat: -1.2864, lng: 36.8219 };
  const kilimani = { lat: -1.2925, lng: 36.7876 };
  // two free riders near the pick-up: one on a bike, one with a car
  const riders = mongoose.connection.collection('customers');
  const riderBase = (lng) => ({ type: 'Point', coordinates: [lng, cbd.lat] });
  const insertedRiders = await riders.insertMany([
    { name: 'Boda Rider', email: 'boda@maps.test', phone: '254711800101', worker: { role: 'rider', status: 'approved', available: true, vehicle: 'Motorbike', base: riderBase(36.8230), radiusKm: 5 } },
    { name: 'Car Driver', email: 'car@maps.test', phone: '254711800102', worker: { role: 'rider', status: 'approved', available: true, vehicle: 'Car', base: riderBase(36.8260), radiusKm: 5 } },
  ]);

  // prices before logging in, like Uber and Bolt
  const prices = ok(await api('POST', '/errands/ride/quote', { pickup: cbd, dropoff: kilimani, size: 'small' }));
  assert.equal(prices.km, 6.2);
  const byVehicle = Object.fromEntries(prices.options.map((option) => [option.vehicle, option]));
  // heavy traffic (25 min for 6.2 km: over twice the empty-road time) → × 1.3 for every vehicle:
  //   bike 70 + 20 × 6.2 + 2 × 25 = 244 → 317 → 320 · 4-seater car 100 + 42 × 6.2 + 3 × 29 = 447 → 581 → 580
  //   pickup 500 + 80 × 6.2 + 5 × 33 = 1161 → 1509 → 1510
  assert.deepEqual([byVehicle.motorbike.fare, byVehicle.car.fare, byVehicle.van.fare], [320, 580, 1510]);
  assert.deepEqual(byVehicle.car.surge, { multiplier: 1.3, reasons: ['heavy traffic'] });
  assert.equal(byVehicle.car.fareParts.standard, 450, 'what it costs without the surge');
  assert.deepEqual([byVehicle.motorbike.ridersNearby, byVehicle.car.ridersNearby, byVehicle.van.ridersNearby], [1, 1, 0], 'riders counted per vehicle');
  assert.ok(byVehicle.motorbike.pickupMinutes >= 1 && byVehicle.van.pickupMinutes === null);
  assert.equal(prices.recommended, 'motorbike', 'the cheapest vehicle with a rider nearby');
  assert.ok(!JSON.stringify(prices).includes('Boda Rider') && !JSON.stringify(prices).includes('36.823'), 'never who or where the riders are');

  // a large parcel: not on a boda
  const large = ok(await api('POST', '/errands/ride/quote', { pickup: cbd, dropoff: kilimani, size: 'large' }));
  assert.equal(large.options.find((option) => option.vehicle === 'motorbike').fits, false);
  assert.equal(large.recommended, 'car');
  // Nairobi only
  const kisumu = ok(await api('POST', '/errands/ride/quote', { pickup: cbd, dropoff: { lat: -0.0917, lng: 34.768 } }));
  assert.equal(kisumu.ok, false);
  assert.match(kisumu.reason, /within Nairobi/);

  // booking: the server's price for the chosen vehicle (whatever the app sends), and only car riders get the job
  const login = ok(await api('POST', '/customers/login', { login: 'shop@maps.test', password: 'Kenya-Market-2026' }));
  const parcel = { kind: 'parcel', pickup: { ...cbd, address: 'Kenyatta Avenue, CBD', name: 'Sender', phone: '0711800001' }, dropoff: { ...kilimani, address: 'Yaya Centre, Kilimani', name: 'Akinyi', phone: '0711800002' } };
  const tooBig = await api('POST', '/errands', { ...parcel, parcel: { what: 'A sofa', size: 'large', vehicle: 'motorbike' }, fee: { delivery: 1 } }, { token: login.token });
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.json.message, /Too big for a bike: choose the 4-seater car or the pickup/);
  const booked = ok(await api('POST', '/errands', { ...parcel, parcel: { what: 'A 50” TV', size: 'large', vehicle: 'car' }, fee: { delivery: 1 } }, { token: login.token }), 201);
  assert.deepEqual([booked.parcel.vehicle, booked.fee.delivery, booked.status, booked.parcel.surge], ['car', 580, 'open', 1.3]);
  const job = await mongoose.connection.collection('tasks').findOne({ errand: new mongoose.Types.ObjectId(booked._id) });
  assert.deepEqual(job.vehicles, ['Car']);
  const offered = await require('../market/riders').match(job);
  assert.deepEqual(offered.map((rider) => rider.name), ['Car Driver'], 'the bike rider isn’t offered a car job');

  // demand: that car job is still waiting and there's one free car nearby → (1 waiting + this one) / 1 rider = 2 → × 1.4,
  // on top of the traffic: 1.3 × 1.4 = 1.82 → 1.8 · 447 × 1.8 = 804.6 → 800. The bike isn't affected.
  const busier = ok(await api('POST', '/errands/ride/quote', { pickup: cbd, dropoff: kilimani, size: 'large' }));
  const busierCar = busier.options.find((option) => option.vehicle === 'car');
  assert.deepEqual([busierCar.surge.multiplier, busierCar.fare], [1.8, 800]);
  assert.deepEqual(busierCar.surge.reasons, ['heavy traffic', 'high demand']);
  assert.equal(busier.options.find((option) => option.vehicle === 'motorbike').surge.multiplier, 1.3);

  // the price lock: booking at the price seen before (580) when it's now 800 → refused with the new price
  const stale = await api('POST', '/errands', { ...parcel, parcel: { what: 'A fridge', size: 'large', vehicle: 'car', expectedFare: 580 } }, { token: login.token });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'PRICE_CHANGED');
  assert.ok(stale.json.message.includes('went up to KSh 800 (heavy traffic and high demand)'), stale.json.message);
  // accepting the new price books it, at the server's price
  const accepted = ok(await api('POST', '/errands', { ...parcel, parcel: { what: 'A fridge', size: 'large', vehicle: 'car', expectedFare: 800 } }, { token: login.token }), 201);
  assert.equal(accepted.fee.delivery, 800);
  assert.deepEqual(accepted.parcel.surgeReasons, ['heavy traffic', 'high demand']);
  await riders.deleteMany({ _id: { $in: Object.values(insertedRiders.insertedIds) } });
});
