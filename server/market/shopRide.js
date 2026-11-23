// 🛍️ Shop & ride with us: our agent inspects what the buyer bought (anywhere in Nairobi), repackages it if needed and
// delivers it, through our CBD hub and pickup points in every area. Prices (Admin → Settings → fieldwork.shopRide):
//   inspection           KSh 200 (optional; on top of delivery)
//   delivery, ≤ 5 kg     KSh 150 from the CBD to any part of Nairobi · KSh 250 when bought outside the CBD (it comes to
//                        the CBD hub first, then goes out to the buyer's area)
//   delivery, > 5 kg     the same base + a rate per extra kg, times the traffic at that hour and the urgency
//   repackaging          on request (fee set by admins; free by default)
//   door delivery        from the pickup point in the buyer's area to their live location, Bolt Send style:
//                        base + per km + per minute (minutes from the distance and the traffic), with a minimum
// Where we work: sellers in the CBD, or in (or right next to) a market where we have trained shopping agents, are
// "covered": our agents are there, so the KSh 200 inspection is optional. Sellers anywhere else are "far": the
// KSh 200 verification is required (our agent checks the right item, quality and quantity before it's bought and
// delivered). Admins set how close to a market counts (fieldwork.shopRide.marketRadiusKm, default 1 km).
// Pure functions (no database): unit-tested in tests/unit.test.js, benchmarked in tests/shopride.test.js.
const geo = require('./geo');

const DEFAULTS = {
  inspectFee: 200, cbdFee: 150, outsideFee: 250, lightKg: 5, perExtraKg: 20, maxKg: 200, repackFee: 0,
  urgency: { standard: 1, express: 1.5 },
  traffic: { normal: 1, peak: 1.3, night: 1.15 },
  door: { base: 100, perKm: 30, perMin: 4, min: 150, kmh: { normal: 24, peak: 13, night: 30 } },
  cbdRadiusKm: 1.6, nairobiRadiusKm: 28, marketRadiusKm: 1,
};
const CBD = { lat: -1.2841, lng: 36.8233 }; // Moi Avenue / Kenyatta Avenue
const ROAD = 1.3; // roads aren't straight lines
const round10 = (value) => Math.round(value / 10) * 10;

// the rates in force: defaults, overridden by what admins saved
function rates(saved) {
  const own = saved && typeof saved === 'object' ? saved : {};
  return { ...DEFAULTS, ...own, urgency: { ...DEFAULTS.urgency, ...(own.urgency || {}) }, traffic: { ...DEFAULTS.traffic, ...(own.traffic || {}) }, door: { ...DEFAULTS.door, ...(own.door || {}), kmh: { ...DEFAULTS.door.kmh, ...(own.door?.kmh || {}) } } };
}

// Nairobi traffic by the hour (Kenya time): weekday rush hours are "peak", late night is "night"
function trafficAt(at = new Date()) {
  const kenya = new Date(new Date(at).getTime() + 3 * 3600 * 1000);
  const day = kenya.getUTCDay(); // 0 Sunday
  const minutes = kenya.getUTCHours() * 60 + kenya.getUTCMinutes();
  if (minutes >= 21 * 60 || minutes < 6 * 60) return 'night';
  const weekday = day >= 1 && day <= 5;
  const rush = (minutes >= 6 * 60 + 30 && minutes < 9 * 60 + 30) || (minutes >= 16 * 60 + 30 && minutes < 19 * 60 + 30);
  return (weekday || day === 6) && rush ? 'peak' : 'normal';
}

const kmBetween = (a, b) => geo.distanceKm(a, { type: 'Point', coordinates: [b.lng, b.lat] });
const inCbd = (place, r = rates()) => !!place && kmBetween(place, CBD) <= r.cbdRadiusKm;
const inNairobi = (place, r = rates()) => !!place && kmBetween(place, CBD) <= r.nairobiRadiusKm;

// is the seller where our trained shopping agents are? markets: [{ _id, name, lat, lng }] that have approved agents;
// marketId: the market the seller registered their stall in (counts even without an exact pin)
function coverage(place, markets = [], r = rates(), { marketId } = {}) {
  if (place && inCbd(place, r)) return { covered: true, zone: 'cbd', name: 'Nairobi CBD' };
  const own = marketId && markets.find((market) => String(market._id) === String(marketId));
  if (own) return { covered: true, zone: 'market', name: own.name, km: 0, marketId: own._id };
  let best = null;
  if (place) {
    for (const market of markets) {
      const km = kmBetween(place, market);
      if (km <= r.marketRadiusKm && (!best || km < best.km)) best = { name: market.name, km: Math.round(km * 10) / 10, marketId: market._id };
    }
  }
  return best ? { covered: true, zone: 'market', ...best } : { covered: false, zone: 'far' };
}

// the delivery fee to the buyer's area (to our pickup point there)
function deliveryFee({ fromCbd, weightKg = 1, urgency = 'standard', at = new Date() }, r = rates()) {
  const base = fromCbd ? r.cbdFee : r.outsideFee;
  const kg = Math.max(0.1, Number(weightKg) || 0.1);
  if (kg <= r.lightKg) return { fee: base, base, extraKg: 0, traffic: 'flat', multiplier: 1, heavy: false };
  const traffic = trafficAt(at);
  const extraKg = Math.ceil(kg - r.lightKg);
  const multiplier = (r.traffic[traffic] || 1) * (r.urgency[urgency] || 1);
  return { fee: round10((base + extraKg * r.perExtraKg) * multiplier), base, extraKg, traffic, urgency: r.urgency[urgency] ? urgency : 'standard', multiplier: Math.round(multiplier * 100) / 100, heavy: true };
}

// from the pickup point in the buyer's area to their door, Bolt Send style
// road: the real route and travel time from Google's Routes API (traffic included); else estimated from the straight line
function doorFare(from, to, at = new Date(), r = rates(), road = null) {
  const traffic = trafficAt(at);
  const byRoad = road?.source === 'google';
  const km = byRoad ? road.km : Math.round(kmBetween(to, from) * ROAD * 10) / 10;
  const minutes = byRoad ? Math.max(3, road.minutes) : Math.max(3, Math.round((km / (r.door.kmh[traffic] || r.door.kmh.normal)) * 60));
  const fare = Math.max(r.door.min, round10(r.door.base + r.door.perKm * km + r.door.perMin * minutes));
  return { km, minutes, traffic, fare };
}

// the nearest pickup point to a place (points: [{ _id, name, area, lat, lng, hub }])
function nearestPoint(points, place) {
  let best = null;
  for (const point of points) {
    if (point.hub && points.length > 1) continue; // the CBD hub isn't a buyer's local pickup point (unless it's all we have)
    const km = kmBetween(place, point);
    if (!best || km < best.km) best = { ...point, km: Math.round(km * 10) / 10 };
  }
  return best;
}

// the whole price. input: { from: {lat,lng} | null, fromCbd?: boolean, weightKg, inspect, repack, urgency,
//   mode: 'point' | 'door', point: pickup point (where it's dropped / collected), to: buyer {lat,lng} (door), at,
//   coverage (from coverage(); else worked out from the CBD alone) }
function quote(input, r = rates()) {
  const from = input.from || null;
  if (from && !inNairobi(from, r)) return { ok: false, reason: 'We collect within Nairobi for now. Choose where in Nairobi the items are.' };
  const fromCbd = from ? inCbd(from, r) : !!input.fromCbd;
  const kg = Number(input.weightKg);
  if (!(kg > 0)) return { ok: false, reason: 'About how heavy is it? (kg)' };
  if (kg > r.maxKg) return { ok: false, reason: `More than ${r.maxKg} kg needs a truck: call us for a price` };
  if (!input.point) return { ok: false, reason: 'Choose the pickup point in your area' };
  const delivery = deliveryFee({ fromCbd, weightKg: kg, urgency: input.urgency, at: input.at }, r);
  // inspection: only when the buyer asks for it (recommended far from the CBD and our agents' markets, never forced)
  const cover = input.coverage || coverage(from, [], r);
  const verifyRecommended = !cover.covered;
  const verifyRequired = false;
  const inspection = input.inspect ? r.inspectFee : 0;
  const repack = input.repack ? r.repackFee : 0;
  let door = null;
  if (input.mode === 'door') {
    if (!input.to) return { ok: false, reason: 'Share your live location for door delivery' };
    if (!inNairobi(input.to, r)) return { ok: false, reason: 'Door delivery is within Nairobi for now' };
    door = doorFare(input.point, input.to, input.at, r, input.road);
  }
  const total = inspection + delivery.fee + repack + (door?.fare || 0);
  return {
    ok: true, fromCbd, weightKg: kg, inspection, repack, repackFree: !!input.repack && repack === 0,
    covered: cover.covered, zone: cover.zone, coverName: cover.name || '', verifyRequired, verifyRecommended,
    delivery, door, mode: door ? 'door' : 'point', point: { _id: input.point._id, name: input.point.name, area: input.point.area }, total,
    estimate: delivery.heavy, // above 5 kg: priced by the hour's traffic and the urgency
  };
}

module.exports = { DEFAULTS, CBD, rates, trafficAt, inCbd, inNairobi, coverage, deliveryFee, doorFare, nearestPoint, quote };
