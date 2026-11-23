// 🛵 Ride with us: the pricing rules (no database, no internet). The booking journey is in tests/maps.test.js.
// Run: cd server && node --test tests/ride.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ride = require('../market/rideWithUs');

const NAIROBI_CBD = { lat: -1.2864, lng: 36.8219 };
const KILIMANI = { lat: -1.2925, lng: 36.7876 };
const KISUMU = { lat: -0.0917, lng: 34.768 };
// a time in Kenya (UTC+3): KE('2026-11-18T08:00') = Wednesday 8 am in Nairobi
const KE = (localTime) => new Date(new Date(`${localTime}:00Z`).getTime() - 3 * 3600 * 1000);
const RULES = ride.SURGE_DEFAULTS;

test('the vehicles: bike, 4-seater car and pickup at standard ride-hailing rates', () => {
  const bike = ride.vehicleByKey('motorbike');
  const car = ride.vehicleByKey('car');
  const pickup = ride.vehicleByKey('van');
  assert.deepEqual([bike.label, car.label, pickup.label], ['Bike', '4-seater car', 'Pickup']);
  assert.deepEqual(ride.ratesFor(car), { base: 100, perKm: 42, perMin: 3, min: 300 }, 'Uber’s published Nairobi UberX rates');
  assert.deepEqual(ride.ratesFor(bike), { base: 70, perKm: 20, perMin: 2, min: 100 });
  assert.deepEqual(ride.ratesFor(pickup), { base: 500, perKm: 80, perMin: 5, min: 800 });
  assert.deepEqual(bike.sizes, ['small', 'medium'], 'no large parcels on a bike');
  assert.ok(car.sizes.includes('large') && pickup.sizes.includes('large'));
  assert.ok(bike.riderVehicles.includes(''), 'riders without a vehicle recorded count as bike riders');
  assert.equal(ride.vehicleByKey('helicopter'), null);
});

test('the fare: base + per km + per minute, rounded to KSh 10, never below the minimum; surge multiplies it', () => {
  const car = { base: 100, perKm: 42, perMin: 3, min: 300 };
  // 6.2 km, 29 min: 100 + 260 + 87 = 447 → 450
  const normal = ride.fareFor(car, 6.2, 29);
  assert.deepEqual([normal.total, normal.base, normal.distance, normal.time, normal.surge], [450, 100, 260, 87, 1]);
  // × 1.3: 447 × 1.3 = 581.1 → 580, and "normally 450" for the receipt
  const surged = ride.fareFor(car, 6.2, 29, 1.3);
  assert.deepEqual([surged.total, surged.standard, surged.surge], [580, 450, 1.3]);
  // a short hop: the minimum, and a surged minimum when it's busy
  assert.equal(ride.fareFor(car, 1, 4).total, 300);
  assert.equal(ride.fareFor(car, 1, 4).minimumApplies, true);
  assert.equal(ride.fareFor(car, 1, 4, 1.5).total, 450);
  // more distance or more time (traffic) always costs more
  assert.ok(ride.fareFor(car, 10, 30).total > ride.fareFor(car, 8, 30).total);
  assert.ok(ride.fareFor(car, 8, 45).total > ride.fareFor(car, 8, 30).total);
});

test('traffic surge: rush hour, and a live route much slower than empty roads (the higher one counts)', () => {
  const emptyRoads = { km: 7, minutes: 12 }; // ~ free-flow (35 km/h)
  const slow = { km: 7, minutes: 19 }; // 1.6× free-flow
  const jammed = { km: 7, minutes: 30 }; // 2.5× free-flow
  const noLiveTime = { km: 7, minutes: null };
  const wednesdayMidday = KE('2026-11-18T11:00');
  const wednesdayRush = KE('2026-11-18T08:00');
  assert.deepEqual(ride.trafficSurge(emptyRoads, wednesdayMidday, RULES), { multiplier: 1, reason: '' });
  assert.deepEqual(ride.trafficSurge(emptyRoads, wednesdayRush, RULES), { multiplier: 1.2, reason: 'rush hour' });
  assert.deepEqual(ride.trafficSurge(slow, wednesdayMidday, RULES), { multiplier: 1.15, reason: 'slow traffic' });
  assert.deepEqual(ride.trafficSurge(slow, wednesdayRush, RULES), { multiplier: 1.2, reason: 'rush hour' }, 'the higher of the two, not both');
  assert.deepEqual(ride.trafficSurge(jammed, wednesdayRush, RULES), { multiplier: 1.3, reason: 'heavy traffic' });
  assert.deepEqual(ride.trafficSurge(noLiveTime, wednesdayMidday, RULES), { multiplier: 1, reason: '' }, 'no live time: only rush hour can apply');
  assert.deepEqual(ride.trafficSurge(emptyRoads, KE('2026-11-22T08:00'), RULES).multiplier, 1, 'Sunday morning: no rush hour');
  assert.deepEqual(ride.trafficSurge(emptyRoads, KE('2026-11-18T17:30'), RULES).multiplier, 1.2, 'evening rush');
});

test('demand surge: more requests near the pick-up than free riders → higher; nobody waiting → normal', () => {
  assert.deepEqual(ride.demandSurge(0, 0, RULES), { multiplier: 1, reason: '' }, 'no one else waiting');
  assert.deepEqual(ride.demandSurge(0, 5, RULES), { multiplier: 1, reason: '' });
  assert.equal(ride.demandSurge(1, 3, RULES).multiplier, 1, '2 requests, 3 riders');
  assert.equal(ride.demandSurge(2, 2, RULES).multiplier, 1.2, '3 requests, 2 riders');
  assert.equal(ride.demandSurge(3, 2, RULES).multiplier, 1.4, '4 requests, 2 riders');
  assert.equal(ride.demandSurge(5, 2, RULES).multiplier, 1.6, '6 requests, 2 riders');
  assert.deepEqual(ride.demandSurge(9, 2, RULES), { multiplier: 1.8, reason: 'high demand' }, '10 requests, 2 riders');
  assert.equal(ride.demandSurge(1, 0, RULES).multiplier, 1.4, 'one waiting, no free rider (counted as one): it rises step by step');
  assert.equal(ride.demandSurge(4, 0, RULES).multiplier, 1.8, 'many waiting, no free rider');
});

test('surge: traffic × demand, rounded to 0.1, never above the cap; switched off → always 1', () => {
  const jammed = { km: 7, minutes: 30 };
  const rush = KE('2026-11-18T08:00');
  assert.deepEqual(ride.surgeFor({ route: { km: 7, minutes: 12 }, at: KE('2026-11-18T11:00'), waiting: 0, free: 3 }), { multiplier: 1, reasons: [] });
  assert.deepEqual(ride.surgeFor({ route: jammed, at: rush, waiting: 3, free: 2 }), { multiplier: 1.8, reasons: ['heavy traffic', 'high demand'] }, '1.3 × 1.4 = 1.82 → 1.8');
  assert.equal(ride.surgeFor({ route: jammed, at: rush, waiting: 20, free: 0, rules: { ...RULES, cap: 2 } }).multiplier, 2, 'capped');
  assert.deepEqual(ride.surgeFor({ route: jammed, at: rush, waiting: 20, free: 0, rules: { ...RULES, enabled: false } }), { multiplier: 1, reasons: [] });
});

test('trip time: the live traffic time when known (a car slower than a bike), else the town speed', () => {
  const bike = ride.vehicleByKey('motorbike');
  const car = ride.vehicleByKey('car');
  const pickup = ride.vehicleByKey('van');
  const withTraffic = { km: 6.2, minutes: 25 };
  assert.deepEqual([ride.tripMinutes(withTraffic, bike), ride.tripMinutes(withTraffic, car), ride.tripMinutes(withTraffic, pickup)], [25, 29, 33]);
  assert.deepEqual([ride.tripMinutes({ km: 12, minutes: null }, bike), ride.tripMinutes({ km: 12, minutes: null }, car)], [30, 36]);
  assert.equal(ride.tripMinutes({ km: 0.05, minutes: null }, bike), 1, 'never zero minutes');
});

test('trips: both ends in Nairobi, two different places', () => {
  assert.equal(ride.checkTrip(NAIROBI_CBD, KILIMANI), null);
  assert.match(ride.checkTrip(null, KILIMANI), /pick the parcel up/);
  assert.match(ride.checkTrip(NAIROBI_CBD, null), /deliver it/);
  assert.match(ride.checkTrip(KISUMU, KILIMANI), /picks up within Nairobi/);
  assert.match(ride.checkTrip(NAIROBI_CBD, KISUMU), /delivers within Nairobi/);
  assert.match(ride.checkTrip(NAIROBI_CBD, { lat: NAIROBI_CBD.lat + 0.0005, lng: NAIROBI_CBD.lng }), /same place/);
});
