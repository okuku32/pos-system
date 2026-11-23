// Courier for far deliveries (60 km and more): one of our agents picks the parcel up from the seller, takes it to a
// courier / bus parcel office (Easy Coach, Modern Coast, a matatu Sacco…), pays and sends it, and gives the buyer the
// waybill number. The buyer collects it at the courier's office in their town.
// What the buyer pays = the courier's fare (estimated from distance and weight; it differs by company) + our agent's
// handling fee. Admins edit the companies and prices in Admin → Settings.
const { distanceKm } = require('./geo');

// Starting fares: estimates for the demo — admins should set each company's real rates
const DEFAULT_COMPANIES = [
  { id: 'easy-coach', name: 'Easy Coach Parcels', base: 300, perKm: 1, perKg: 20, min: 400, eta: 'Same or next day', note: 'Bus parcel service. Collect at the Easy Coach office in your town.', active: true },
  { id: 'modern-coast', name: 'Modern Coast Courier', base: 350, perKm: 1, perKg: 25, min: 450, eta: 'Next day', note: 'Bus parcel service. Collect at the Modern Coast office.', active: true },
  { id: 'matatu-sacco', name: 'Matatu Sacco parcel', base: 200, perKm: 0.8, perKg: 15, min: 300, eta: 'Same day', note: 'Sent on a matatu headed your way. Collect at the stage or Sacco office.', active: true },
  { id: 'g4s', name: 'G4S Courier', base: 500, perKm: 1.5, perKg: 50, min: 650, eta: '1–2 days', note: 'Courier company with offices in most towns.', active: true },
];
const DEFAULTS = { enabled: true, minKm: 60, maxKm: 1200, handlingFee: 250, agentSharePercent: 80, assumeKg: 2, companies: DEFAULT_COMPANIES };

const round10 = (number) => Math.round(number / 10) * 10;

function settings() {
  const courier = require('../config/site').site().courier || {};
  return { ...DEFAULTS, ...courier, companies: courier.companies?.length ? courier.companies : DEFAULT_COMPANIES };
}

// one company's fare for this distance and weight
const fareOf = (value, km, kg) => round10(Math.max(value.min || 0, (value.base || 0) + (value.perKm || 0) * km + (value.perKg || 0) * Math.max(0, kg - 1)));

// → { ok, km, kg, assumedKg, handling, options: [{ id, name, fare, total, eta, note }] } or { ok: false, reason }
function courierQuote(shopPoint, to, weightKg) {
  const settingsResult = settings();
  if (!settingsResult.enabled) return { ok: false, reason: 'Courier delivery is switched off for now' };
  if (!shopPoint?.coordinates) return { ok: false, reason: 'This seller hasn’t put their shop on the map, so our agents can’t collect it' };
  if (!to) return { ok: false, reason: 'Pin your delivery address on the map so we can price the courier' };
  const km = distanceKm(to, shopPoint);
  if (km < settingsResult.minKm) return { ok: false, km, reason: `Courier is for deliveries ${settingsResult.minKm} km or more away (you’re ${km} km from the shop)` };
  if (km > settingsResult.maxKm) return { ok: false, km, reason: `You’re ${km} km away: too far for our courier partners` };
  const kg = weightKg > 0 ? weightKg : settingsResult.assumeKg;
  const options = settingsResult.companies.filter((company) => company.active !== false).map((item) => {
    const fare = fareOf(item, km, kg);
    return { id: item.id, name: item.name, fare, total: fare + settingsResult.handlingFee, eta: item.eta || '', note: item.note || '' };
  }).sort((first, second) => first.fare - second.fare);
  if (!options.length) return { ok: false, km, reason: 'No courier companies are set up yet' };
  return { ok: true, km, kg, assumedKg: !(weightKg > 0), handling: settingsResult.handlingFee, agentPay: require('./payouts').split(settingsResult.handlingFee).net, options };
}

// admin input → clean settings (throws a message on bad input)
function cleanCourier(courier, httpError) {
  const num = (value, lo, hi, label) => {
    const entryValue = Number(value);
    if (!(entryValue >= lo && entryValue <= hi)) throw httpError(`${label} must be between ${lo} and ${hi}`);
    return entryValue;
  };
  const list = Array.isArray(courier.companies) ? courier.companies.slice(0, 12) : [];
  if (!list.length) throw httpError('Add at least one courier company');
  const seen = new Set();
  const companies = list.map((item, index) => {
    const name = String(item.name || '').trim().slice(0, 60);
    if (name.length < 2) throw httpError(`Courier ${index + 1}: enter the company name`);
    let id = String(item.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `courier-${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id, name, active: item.active !== false && item.active !== 'false',
      base: num(item.base, 0, 20000, `${name}: base fare`), perKm: num(item.perKm, 0, 100, `${name}: per km`), perKg: num(item.perKg, 0, 2000, `${name}: per kg`), min: num(item.min, 0, 20000, `${name}: lowest fare`),
      eta: String(item.eta || '').trim().slice(0, 40), note: String(item.note || '').trim().slice(0, 140),
    };
  });
  return {
    enabled: courier.enabled !== false && courier.enabled !== 'false',
    minKm: num(courier.minKm, 5, 1000, 'Courier from (km)'), maxKm: num(courier.maxKm ?? DEFAULTS.maxKm, 50, 3000, 'Courier up to (km)'),
    handlingFee: num(courier.handlingFee, 0, 10000, 'Agent handling fee'), agentSharePercent: num(courier.agentSharePercent, 0, 100, 'Agent’s share'),
    assumeKg: num(courier.assumeKg ?? DEFAULTS.assumeKg, 0.1, 100, 'Weight to assume (kg)'), companies,
  };
}

module.exports = { courierQuote, cleanCourier, settings, DEFAULT_COMPANIES, DEFAULTS, fareOf };
