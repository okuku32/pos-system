// 🛵 Ride with us: parcel delivery around Nairobi, priced and booked the way Uber and Bolt do it.
//
//   1. The customer pins where to pick the parcel up and where it goes (both in Nairobi).
//   2. We work out the route on the actual roads (Google's Routes API with live traffic when a key is set, otherwise
//      OpenStreetMap's router, otherwise a straight-line estimate) → its km and minutes.
//   3. Every vehicle (bike, 4-seater car, pickup) gets an upfront fare: base + per km + per minute, never below its
//      minimum, times a surge multiplier when traffic is heavy or demand is high (see surgeFor), plus how far away
//      the nearest free rider with that vehicle is.
//   4. The customer picks a vehicle and books at the price they saw. If the price went UP in between (surge), the
//      booking is refused with the new price so they can confirm it; never charged more than they agreed to.
//      Only riders with that vehicle are offered the job (riders.matchAt).
//
// No inspection, no hub, no pickup points: a rider goes straight from the pick-up to the drop-off.
//
// Standard rates (Nairobi), from the ride-hailing apps' published prices:
//   4-seater car: KSh 100 base + 42 per km + 3 per minute, minimum KSh 300 (Uber's published Nairobi UberX rates).
//   Bike: KSh 70 base + 20 per km + 2 per minute, minimum KSh 100 (Uber's published boda structure, KSh 55 base /
//     14 per km / 1 per minute / 60 minimum in 2018, brought up to today's fuel prices: an estimate).
//   Pickup: KSh 500 base + 80 per km + 5 per minute, minimum KSh 800 (no app publishes one: an estimate for a light
//     goods vehicle).
// Admins can override any of them in the site settings: fieldwork.ride.<bike | car | pickup> { base, perKm, perMin,
// min }, and the surge rules in fieldwork.ride.surge (see SURGE_DEFAULTS).
const { site } = require('../config/site');
const { distanceKm } = require('./geo');

const ROAD_FACTOR = 1.35; // a straight line × this ≈ the road distance in Nairobi (used only when no router answers)
const SAME_PLACE_KM = 0.2; // closer than this, there's nothing to deliver
const FREE_FLOW_KM_PER_HOUR = 35; // a car's speed in Nairobi on empty roads: live times far above it mean traffic
const DEMAND_RADIUS_KM = 5; // requests and riders this close to the pick-up count as "the same area"
const DEMAND_WINDOW_MS = 20 * 60 * 1000; // requests still waiting for a rider, made in the last 20 minutes
const roundToTen = (amount) => Math.round(amount / 10) * 10;
const roundToTenth = (value) => Math.round(value * 10) / 10;

// The vehicles a customer can choose. key: stored on the booking (motorbike / car / van, kept for earlier bookings).
// riderVehicles: what riders pick in their profile that counts as this vehicle ('' = none recorded: a bike rider,
// the default). sizes: the parcels it can carry. kmPerHour: average speed in town when the route has no live time.
const VEHICLES = [
  { key: 'motorbike', settingsKey: 'bike', label: 'Bike', icon: '🏍️', note: 'Fastest through traffic · small parcels', riderVehicles: ['Motorbike', ''], sizes: ['small', 'medium'], kmPerHour: 24, defaults: { base: 70, perKm: 20, perMin: 2, min: 100 } },
  { key: 'car', settingsKey: 'car', label: '4-seater car', icon: '🚗', note: 'Fragile or bulky items, any weather', riderVehicles: ['Car'], sizes: ['small', 'medium', 'large'], kmPerHour: 20, defaults: { base: 100, perKm: 42, perMin: 3, min: 300 } },
  { key: 'van', settingsKey: 'pickup', label: 'Pickup', icon: '🛻', note: 'Furniture, appliances, moving', riderVehicles: ['Van / pickup'], sizes: ['small', 'medium', 'large'], kmPerHour: 18, defaults: { base: 500, perKm: 80, perMin: 5, min: 800 } },
];
const vehicleByKey = (key) => VEHICLES.find((vehicle) => vehicle.key === key) || null;

// Surge, like Uber and Bolt: the fare is multiplied when it's harder to get a rider.
//   traffic: rush hour (Monday to Saturday, 6:30–9:30 am and 4:30–7:30 pm) or a live route much slower than empty roads
//   demand:  more open requests near the pick-up than free riders with that vehicle
// The two multiply, never above `cap`. Rounded to 0.1 (1.0 = no surge).
const SURGE_DEFAULTS = {
  enabled: true,
  rushHour: 1.2, // weekday rush hour
  slowTraffic: 1.15, // the live route takes 1.5× the empty-road time
  jammedTraffic: 1.3, // …2× or more
  // requests per free rider nearby → multiplier (the first step that fits). No free rider nearby counts as one, so
  // prices rise step by step (while the rider network is small, many areas have nobody online at a given moment)
  demandSteps: [[1, 1], [1.5, 1.2], [2, 1.4], [3, 1.6], [Infinity, 1.8]],
  cap: 2.5,
};

function settings() {
  return (site().fieldwork || {}).ride || {};
}
// a saved value wins only when it's a real, non-negative number (a blank setting keeps the default)
const usable = (value) => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;

// a vehicle's standard rates: its defaults, each overridable by admins
function ratesFor(vehicle) {
  const saved = settings()[vehicle.settingsKey] || {};
  const pick = (name) => (usable(saved[name]) ? Number(saved[name]) : vehicle.defaults[name]);
  return { base: pick('base'), perKm: pick('perKm'), perMin: pick('perMin'), min: pick('min') };
}
function surgeRules() {
  const saved = settings().surge || {};
  const rules = { ...SURGE_DEFAULTS };
  for (const name of ['rushHour', 'slowTraffic', 'jammedTraffic', 'cap']) if (usable(saved[name]) && Number(saved[name]) >= 1) rules[name] = Number(saved[name]);
  if (saved.enabled === false) rules.enabled = false;
  return rules;
}

// The fare, like Uber and Bolt: (base + km × per-km price + minutes × per-minute price) × surge, rounded to KSh 10,
// never below the minimum × surge. The parts come back too, so the customer can see how the price is made up.
function fareFor(rates, km, minutes, surgeMultiplier = 1) {
  const distancePart = Math.round(rates.perKm * km);
  const timePart = Math.round(rates.perMin * minutes);
  const standard = rates.base + distancePart + timePart;
  const minimum = roundToTen(rates.min * surgeMultiplier);
  const total = Math.max(minimum, roundToTen(standard * surgeMultiplier));
  return { total, base: rates.base, distance: distancePart, time: timePart, standard: Math.max(rates.min, roundToTen(standard)), surge: surgeMultiplier, minimum, minimumApplies: total === minimum && roundToTen(standard * surgeMultiplier) < minimum };
}

// how heavy the traffic is: { multiplier, reason } (1 = normal)
function trafficSurge(route, at, rules) {
  const steps = [{ multiplier: 1, reason: '' }];
  if (require('./shopRide').trafficAt(at) === 'peak') steps.push({ multiplier: rules.rushHour, reason: 'rush hour' });
  if (route.minutes != null && route.km > 0.5) {
    // how much slower than empty roads the live route is
    const freeFlowMinutes = (route.km / FREE_FLOW_KM_PER_HOUR) * 60;
    const slowness = route.minutes / freeFlowMinutes;
    if (slowness >= 2) steps.push({ multiplier: rules.jammedTraffic, reason: 'heavy traffic' });
    else if (slowness >= 1.5) steps.push({ multiplier: rules.slowTraffic, reason: 'slow traffic' });
  }
  return steps.reduce((highest, step) => (step.multiplier > highest.multiplier ? step : highest));
}
// how busy it is for this vehicle: { multiplier, reason }
//   waiting: requests near the pick-up still looking for a rider of this vehicle · free: free riders of it nearby
function demandSurge(waiting, free, rules) {
  if (!waiting) return { multiplier: 1, reason: '' }; // nobody else waiting: the normal price
  const requestsPerRider = (waiting + 1) / Math.max(1, free); // +1: this request · no free rider counts as one
  const [, multiplier] = rules.demandSteps.find(([upTo]) => requestsPerRider <= upTo);
  return { multiplier, reason: multiplier > 1 ? 'high demand' : '' };
}
// the surge for one vehicle: { multiplier, reasons: [] }
function surgeFor({ route, at, waiting, free, rules = surgeRules() }) {
  if (!rules.enabled) return { multiplier: 1, reasons: [] };
  const traffic = trafficSurge(route, at, rules);
  const demand = demandSurge(waiting, free, rules);
  const multiplier = Math.min(rules.cap, roundToTenth(traffic.multiplier * demand.multiplier));
  return { multiplier: Math.max(1, multiplier), reasons: [traffic.reason, demand.reason].filter(Boolean) };
}

// requests near the pick-up still waiting for a rider (the last 20 minutes), counted per vehicle.
// Deliveries of orders (no `vehicles` on the job) count as bike requests.
async function waitingRequests(from) {
  const Task = require('../models/Task');
  const jobs = await Task.find({
    kind: 'delivery', status: 'open', createdAt: { $gte: new Date(Date.now() - DEMAND_WINDOW_MS) },
    'pickup.point': require('./geo').within({ ...from, km: DEMAND_RADIUS_KM }),
  }).select('vehicles').limit(500).lean();
  const counts = Object.fromEntries(VEHICLES.map((vehicle) => [vehicle.key, 0]));
  for (const job of jobs) {
    const jobVehicles = job.vehicles?.length ? job.vehicles : ['Motorbike'];
    for (const vehicle of VEHICLES) if (vehicle.riderVehicles.some((name) => name && jobVehicles.includes(name))) counts[vehicle.key] += 1;
  }
  return counts;
}

// the route on the actual roads: { km, minutes (null when the router gives no live time), source }
async function routeBetween(from, to) {
  const googleMaps = require('./googleMaps');
  if (googleMaps.configured?.()) {
    const road = await googleMaps.road(from, to, 'motorbike');
    if (road?.source === 'google') return { km: road.km, minutes: road.minutes, source: 'google' }; // traffic included
  }
  const osmRoad = await require('./osmRoute').roadRoute([from, to], 'motorbike');
  if (osmRoad) return { km: osmRoad.km, minutes: null, source: 'osm' }; // each vehicle's time from its town speed
  return { km: Math.round(distanceKm(from, { type: 'Point', coordinates: [to.lng, to.lat] }) * ROAD_FACTOR * 10) / 10, minutes: null, source: 'estimate' };
}
// how long the trip takes in this vehicle: the live traffic time when we have it (a car is a little slower than a
// bike that filters through traffic), otherwise the distance at the vehicle's town speed
function tripMinutes(route, vehicle) {
  if (route.minutes != null) return Math.max(1, Math.round(route.minutes * (vehicle.key === 'motorbike' ? 1 : vehicle.key === 'car' ? 1.15 : 1.3)));
  return Math.max(1, Math.round((route.km / vehicle.kmPerHour) * 60));
}

// Is this a trip we do? (reason when not)
function checkTrip(from, to) {
  const shopRide = require('./shopRide');
  if (!from) return 'Pin where to pick the parcel up';
  if (!to) return 'Pin where to deliver it';
  if (!shopRide.inNairobi(from)) return 'Ride with us picks up within Nairobi for now';
  if (!shopRide.inNairobi(to)) return 'Ride with us delivers within Nairobi for now';
  if (distanceKm(from, { type: 'Point', coordinates: [to.lng, to.lat] }) < SAME_PLACE_KM) return 'The pick-up and drop-off are the same place: move one of the pins';
  return null;
}

// The quote: the route, and one option per vehicle (fare with any surge, trip time, nearest rider's ETA, fits).
//   size: 'small' | 'medium' | 'large' → vehicles that can't carry it are marked unavailable · at: the time (tests)
// → { ok, km, minutes, source, options: [{ vehicle, label, icon, note, fare, fareParts, surge: { multiplier, reasons },
//     tripMinutes, ridersNearby, pickupMinutes, fits, reason }], recommended } | { ok: false, reason }
async function quote({ from, to, size = 'small', at = new Date() }) {
  const problem = checkTrip(from, to);
  if (problem) return { ok: false, reason: problem };
  if ((site().fieldwork || {}).riderEnabled === false) return { ok: false, reason: 'Ride with us is paused for now' };
  const route = await routeBetween(from, to);
  // the free riders and the waiting requests near the pick-up, once (never sent to the customer: only counts and ETAs)
  const [nearby, waiting] = await Promise.all([
    require('./riders').matchAt(from).catch(() => []),
    waitingRequests(from).catch(() => Object.fromEntries(VEHICLES.map((vehicle) => [vehicle.key, 0]))),
  ]);
  const rules = surgeRules();
  const options = VEHICLES.map((vehicle) => {
    const minutes = tripMinutes(route, vehicle);
    const riders = nearby.filter((rider) => vehicle.riderVehicles.includes(rider.vehicle || ''));
    const surge = surgeFor({ route, at, waiting: waiting[vehicle.key], free: riders.length, rules });
    const fare = fareFor(ratesFor(vehicle), route.km, minutes, surge.multiplier);
    const fits = vehicle.sizes.includes(size);
    return {
      vehicle: vehicle.key, label: vehicle.label, icon: vehicle.icon, note: vehicle.note,
      fare: fare.total, fareParts: fare, surge, tripMinutes: minutes,
      ridersNearby: riders.length, pickupMinutes: riders.length ? riders[0].eta : null, // matchAt sorts best first
      fits, reason: fits ? '' : `Too big for a ${vehicle.label.toLowerCase()}`,
    };
  });
  // the suggestion: the cheapest vehicle that can carry it, preferring one with a rider nearby
  const usableOptions = options.filter((option) => option.fits);
  const recommended = (usableOptions.find((option) => option.ridersNearby) || usableOptions[0])?.vehicle || null;
  const bike = options.find((option) => option.vehicle === 'motorbike');
  return { ok: true, km: route.km, minutes: bike.tripMinutes, source: route.source, options, recommended };
}

module.exports = { VEHICLES, SURGE_DEFAULTS, vehicleByKey, ratesFor, surgeRules, fareFor, trafficSurge, demandSurge, surgeFor, waitingRequests, routeBetween, tripMinutes, checkTrip, quote };
