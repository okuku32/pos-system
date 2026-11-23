// 🛵 Our riders: who gets a job, how long it takes, how much they can carry, and how buyers rate them.
//
//  • Matching: riders who are approved, available and have room (workload < capacity) within reach of the shop,
//    closest first (their live location if fresh, else their stage), nudged by their rating and how busy they are.
//    The best few are offered the job first; if none takes it in 90 seconds, every rider in reach is alerted.
//  • ETA: straight-line distance × a road factor, at a city speed for the vehicle, plus time at the shop.
//  • Capacity: how many jobs a rider carries at once (they choose 1–6; the default fits their vehicle).
//  • Rating: buyers give 1–5 stars after delivery; the average shows on the rider's card and in matching.
const Task = require('../models/Task');
const Customer = require('../models/Customer');
const geo = require('./geo');

const REACH_KM = 15;
const FIRST_WAVE = 2; // offered first
const WAVE_GAP_MS = 90 * 1000; // then everyone in reach
const LIVE_FRESH_MS = 15 * 60 * 1000; // a live location older than this is ignored (use their stage)
const ROAD = 1.35; // roads aren't straight lines
const AT_SHOP_MIN = 5; // collecting the parcel
const SPEED = { 'On foot': 5, Bicycle: 12, Motorbike: 24, 'Tuk-tuk': 18, Car: 20, 'Van / pickup': 18 }; // km/h in town
const CAPACITY = { 'On foot': 2, Bicycle: 2, Motorbike: 3, 'Tuk-tuk': 4, Car: 4, 'Van / pickup': 6 };
const ACTIVE = ['assigned', 'picked_up'];

const speedOf = (vehicle) => SPEED[vehicle] || 22;
const suggestedCapacity = (vehicle) => CAPACITY[vehicle] || 3;
const capacityOf = (worker) => Math.min(6, Math.max(1, Number(worker?.capacity) || suggestedCapacity(worker?.vehicle)));
// minutes to ride `km` (straight line) in town
const minutesFor = (km, vehicle) => Math.max(1, Math.round(((km || 0) * ROAD * 60) / speedOf(vehicle)));

// where the rider is: their live location if it's fresh, otherwise their stage / base
function positionOf(worker) {
  const live = worker?.live?.coordinates;
  if (live && worker.liveAt && Date.now() - new Date(worker.liveAt).getTime() < LIVE_FRESH_MS) return { lat: live[1], lng: live[0], live: true };
  const base = worker?.base?.coordinates;
  return base ? { lat: base[1], lng: base[0], live: false } : null;
}
const pickupOf = (task) => ({ lat: task.pickup.point.coordinates[1], lng: task.pickup.point.coordinates[0] });
const dropoffOf = (task) => (task.dropoff?.lat != null && task.dropoff?.lng != null ? { lat: task.dropoff.lat, lng: task.dropoff.lng } : null);
const point = (location) => ({ type: 'Point', coordinates: [location.lng, location.lat] });
const round1 = (value) => Math.round(value * 10) / 10;

// how long the whole job takes from where the rider is now: to the shop (if not collected yet), then to the buyer
function etaFor(task, from, vehicle) {
  const pickup = pickupOf(task);
  const drop = dropoffOf(task);
  const collected = task.status === 'picked_up' || task.status === 'delivered';
  if (collected) {
    if (!from || !drop) return null;
    const kmLeft = geo.distanceKm(from, point(drop));
    return { minutes: minutesFor(kmLeft, vehicle), kmLeft: round1(kmLeft), kmToYou: round1(kmLeft), stage: 'to_you' };
  }
  const toShop = from ? geo.distanceKm(from, task.pickup.point) : 0;
  const trip = drop ? geo.distanceKm(pickup, point(drop)) : task.km || 0;
  return { minutes: minutesFor(toShop, vehicle) + AT_SHOP_MIN + minutesFor(trip, vehicle), kmLeft: round1(toShop), kmToYou: round1(toShop + trip), stage: 'to_shop' };
}
// the trip itself (shop → buyer), shown on the job before anyone accepts
function tripOf(task, vehicle) {
  const drop = dropoffOf(task);
  const km = drop ? geo.distanceKm(pickupOf(task), point(drop)) : task.km;
  return km ? { km: round1(km), minutes: minutesFor(km, vehicle) } : null;
}

// how many jobs each worker is carrying right now
async function workloads(ids) {
  if (!ids.length) return new Map();
  const rows = await Task.aggregate([{ $match: { worker: { $in: ids }, status: { $in: ACTIVE } } }, { $group: { _id: '$worker', n: { $sum: 1 } } }]);
  return new Map(rows.map((row) => [String(row._id), row.n]));
}
const workloadOf = async (id) => Task.countDocuments({ worker: id, status: { $in: ACTIVE } });

// the riders who should get this job, best first: [{ _id, name, km, eta, active, capacity, rating, score }]
const match = (task, options) => matchAt(pickupOf(task), { ...options, vehicles: task.vehicles });
// the same around any place (the scan at the checkout: riders near the seller's shop)
//   vehicles: only riders with one of these (Ride with us: the vehicle the customer chose; '' = none recorded)
async function matchAt(at, { roles = ['rider'], exclude = [], vehicles } = {}) {
  const reach = geo.within({ ...at, km: REACH_KM });
  const people = await Customer.find({
    'worker.role': { $in: roles }, 'worker.status': 'approved', 'worker.available': true,
    $or: [{ 'worker.base': reach }, { 'worker.live': reach }],
    ...(exclude.length ? { _id: { $nin: exclude } } : {}),
  }).select('name worker').lean();
  const busy = await workloads(people.map((person) => person._id));
  const out = [];
  for (const person of people) {
    if (vehicles?.length && !vehicles.includes(person.worker.vehicle || '')) continue; // not the vehicle the customer chose
    const where = positionOf(person.worker);
    if (!where) continue;
    const km = geo.distanceKm(where, point(at));
    const reachKm = Math.max(person.worker.radiusKm || 5, where.live ? 5 : 0) + 2; // a little past their own radius
    if (km > Math.min(REACH_KM, reachKm)) continue;
    const active = busy.get(String(person._id)) || 0;
    const capacity = capacityOf(person.worker);
    if (active >= capacity) continue; // full: no new jobs until they finish one
    const rating = person.worker.rating?.count ? person.worker.rating : null;
    // lower is better: distance, plus a little for each job they already carry, minus a little for great ratings
    const score = km + active * 1.5 - (rating && rating.count >= 3 ? (rating.avg - 4) * 1.5 : 0) + (where.live ? 0 : 0.5);
    out.push({ _id: person._id, name: person.name, vehicle: person.worker.vehicle || '', km: round1(km), eta: minutesFor(km, person.worker.vehicle), live: where.live, active, capacity, rating: rating ? { avg: round1(rating.avg), count: rating.count } : null, score });
  }
  return out.sort((first, second) => first.score - second.score);
}

// 🔍 the scan at the checkout ("Find a rider"): available riders with room near the seller's shop, the nearest one,
// and how long the delivery takes: the rider to the shop + collecting it + the trip to the buyer.
// tripMinutes: the shop → buyer trip (the real road when known). Never returns where a rider is.
async function scan(shopPoint, to, tripMinutes) {
  const at = { lat: shopPoint.coordinates[1], lng: shopPoint.coordinates[0] };
  const found = await matchAt(at);
  const best = found[0] || null;
  const trip = tripMinutes != null ? tripMinutes : to ? minutesFor(geo.distanceKm(to, shopPoint), best?.vehicle || 'Motorbike') : null;
  return {
    available: found.length,
    best,
    nearest: best ? { firstName: String(best.name || '').split(' ')[0], vehicle: best.vehicle, rating: best.rating, km: best.km, minutesToShop: best.eta, live: best.live } : null,
    eta: best && trip != null ? { toShop: best.eta, atShop: AT_SHOP_MIN, trip, total: best.eta + AT_SHOP_MIN + trip } : null,
  };
}

// a buyer's stars: kept on the task, averaged on the rider
async function rate(task, stars, comment) {
  task.rating = { stars, comment, at: new Date() };
  await task.save();
  const [row] = await Task.aggregate([{ $match: { worker: task.worker, 'rating.stars': { $gte: 1 } } }, { $group: { _id: null, avg: { $avg: '$rating.stars' }, count: { $sum: 1 } } }]);
  const rating = { avg: row ? round1(row.avg) : stars, count: row?.count || 1 };
  await Customer.updateOne({ _id: task.worker }, { $set: { 'worker.rating': rating } });
  return rating;
}

module.exports = { scan, matchAt, AT_SHOP_MIN, REACH_KM, FIRST_WAVE, WAVE_GAP_MS, LIVE_FRESH_MS, SPEED, CAPACITY, speedOf, suggestedCapacity, capacityOf, minutesFor, positionOf, etaFor, tripOf, workloads, workloadOf, match, rate };
