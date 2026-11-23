// Riders (delivery) and shopping agents (inspection): prices and pay.
// Everything here reads the admin's settings (Admin → Settings → Riders & agents).
const { site } = require('../config/site');
const { distanceKm } = require('./geo');

const ROAD = 1.3; // roads aren't straight lines
const round10 = (number) => Math.round(number / 10) * 10;
const fw = () => site().fieldwork;

// the fare, like Uber and Bolt: a base fare + a price per km + a price per minute of the trip, never below the
// minimum fare (all set in Admin → Settings → Riders). km and minutes are the real road when Google's Routes API
// answered, otherwise the straight line × 1.3 at a city motorbike speed. The parts are returned, so the buyer sees
// how the price is made up.
function riderFare(km, minutes) {
  const fieldwork = fw();
  const perKm = Math.max(0, Number(fieldwork.riderPerKm) || 0);
  const perMin = Math.max(0, Number(fieldwork.riderPerMin) || 0);
  const base = Math.max(0, Number(fieldwork.riderBase) || 0);
  const min = Math.max(0, Number(fieldwork.riderMin) || 0);
  const distance = Math.round(perKm * km);
  const time = Math.round(perMin * minutes);
  return { total: Math.max(min, round10(base + distance + time)), base, distance, time, perKm, perMin, min, km: Math.round(km * 10) / 10, minutes };
}

// what the buyer pays for a rider from the shop to them, or why it isn't possible
// road: the real route from Google's Routes API (riderQuoteByRoad); without it, the straight line × 1.3
function riderQuote(shopPoint, to, road) {
  const fieldwork = fw();
  if (!fieldwork.riderEnabled) return { ok: false, reason: 'Rider delivery is switched off for now' };
  if (!shopPoint?.coordinates) return { ok: false, reason: 'This seller hasn’t put their shop on the map, so riders can’t find it' };
  if (!to) return { ok: false, reason: 'Share your location so we can price the delivery' };
  const km = distanceKm(to, shopPoint);
  if (km > fieldwork.riderMaxKm) return { ok: false, km, reason: `You’re ${km} km from the shop; riders go up to ${fieldwork.riderMaxKm} km` };
  const byRoad = road?.source === 'google';
  const minutes = byRoad ? road.minutes : require('./riders').minutesFor(km, 'Motorbike');
  const fare = riderFare(byRoad ? road.km : km * ROAD, minutes);
  return { ok: true, km: byRoad ? road.km : km, fee: fare.total, fare, minutes, pay: require('./payouts').split(fare.total).net, ...(byRoad ? { byRoad: true } : {}) };
}
// the same, priced on the real road (Google Routes API, cached; falls back to the straight line)
async function riderQuoteByRoad(shopPoint, to) {
  if (!shopPoint?.coordinates || !to) return riderQuote(shopPoint, to);
  const road = await require('./googleMaps').road({ lat: shopPoint.coordinates[1], lng: shopPoint.coordinates[0] }, to, 'motorbike');
  return riderQuote(shopPoint, to, road);
}

// our agent inspects AND delivers (the buyer chose both): free within 1 km for parcels under 5 kg,
// otherwise KSh 100 for the first 2 km, then the rider rate per km (all set in Admin → Settings)
function agentQuote(shopPoint, to, weightKg) {
  const fieldwork = fw();
  if (!fieldwork.riderEnabled) return { ok: false, reason: 'Delivery by our team is switched off for now' };
  if (!shopPoint?.coordinates) return { ok: false, reason: 'This seller hasn’t put their shop on the map, so our agents can’t find it' };
  if (!to) return { ok: false, reason: 'Share your location so we can price the delivery' };
  const km = distanceKm(to, shopPoint);
  if (km > fieldwork.riderMaxKm) return { ok: false, km, reason: `You’re ${km} km from the shop; our agents go up to ${fieldwork.riderMaxKm} km` };
  const light = weightKg != null && weightKg < fieldwork.inspectFreeKg;
  if (km <= fieldwork.inspectFreeKm && light) return { ok: true, km, fee: 0, free: true, weightKg };
  const extra = Math.max(0, km - fieldwork.inspectBaseKm);
  const fee = fieldwork.inspectBaseFee + (extra > 0 ? round10(fieldwork.riderPerKm * extra * ROAD) : 0);
  return { ok: true, km, fee, free: false, weightKg, why: km <= fieldwork.inspectFreeKm ? (weightKg == null ? 'weight unknown' : `${weightKg} kg`) : '' };
}

// the inspection ("verify my goods"): a flat KSh 200, by our agent or our rider. Optional: only when the buyer asks
// for it (highly recommended). AGENT_MIN_FEE is the same KSh 200 (the agent's payment-verification fee).
const INSPECTION_FEE = 200;
const AGENT_MIN_FEE = INSPECTION_FEE;
function inspectionQuote(subtotal, shopPoint) { // eslint-disable-line no-unused-vars
  const fieldwork = fw();
  if (!fieldwork.inspectEnabled) return { ok: false, reason: 'Inspection is switched off for now' };
  if (!shopPoint?.coordinates) return { ok: false, reason: 'This seller hasn’t put their shop on the map, so our agents can’t find it' };
  const fee = INSPECTION_FEE; // the same for every order, whatever it costs
  return { ok: true, fee, pay: require('./payouts').split(fee).net };
}

// pay weeks run Monday to Sunday, Kenya time: "2026-W46"
function weekOf(day = new Date()) {
  const when = new Date(new Date(day).getTime() + 3 * 3600000); // Kenya time
  const date = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3); // the Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
// "Mon 10 Nov – Sun 16 Nov"
function weekLabel(key) {
  const [year, width] = key.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (width - 1) * 604800000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const field = (date) => date.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  return `${field(monday)} – ${field(sunday)}`;
}

module.exports = { INSPECTION_FEE, AGENT_MIN_FEE, riderFare, riderQuote, riderQuoteByRoad, inspectionQuote, agentQuote, weekOf, weekLabel, ROAD };
