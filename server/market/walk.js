// Walking delivery: a shop close to the buyer sends someone on foot.
// The seller sets how far they walk, a fee for the first item plus a little per extra item (bigger orders take more
// carrying), an optional cap, and when it's free: always ("after-sale service") or above an order amount.
const { distanceKm } = require('./geo');

const WALK_KMH = 4.5; // a normal walking pace
const DETOUR = 1.3; // streets aren't straight lines
const MAX_KM = 3;

// checks and cleans what the seller entered (throws a friendly message)
function cleanWalk(walk, httpError) {
  if (!walk || !(walk.enabled === true || walk.enabled === 'true')) return { enabled: false };
  const num = (value, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(value) || 0)));
  const maxKm = Math.round(Math.min(MAX_KM, Math.max(0.2, Number(walk.maxKm) || 1)) * 10) / 10;
  const afterSale = walk.afterSale === true || walk.afterSale === 'true';
  const out = {
    enabled: true, maxKm, afterSale,
    fee: afterSale ? 0 : num(walk.fee, 0, 2000),
    perItem: afterSale ? 0 : num(walk.perItem, 0, 1000),
    maxFee: afterSale ? 0 : num(walk.maxFee, 0, 5000),
    freeOver: afterSale ? 0 : num(walk.freeOver, 0, 1000000),
    note: String(walk.note || '').replace(/[<>]/g, '').trim().slice(0, 120),
  };
  if (out.maxFee && out.maxFee < out.fee) throw httpError('The most you charge for walking delivery can’t be less than the fee for one item');
  return out;
}

// the price for this order (units = items in the order, subtotal in KSh)
function walkFee(width, units, subtotal) {
  if (width.afterSale) return { fee: 0, free: 'after-sale' };
  if (width.freeOver && subtotal >= width.freeOver) return { fee: 0, free: 'over' };
  let fee = (width.fee || 0) + (width.perItem || 0) * Math.max(0, units - 1);
  if (width.maxFee) fee = Math.min(fee, width.maxFee);
  return { fee, free: fee === 0 ? 'free' : '' };
}

const minutesFor = (km) => Math.max(3, Math.ceil(((km * DETOUR) / WALK_KMH) * 60));

// can this seller walk an order to the buyer at { lat, lng }? → { ok, km, minutes, fee, free, reason }
function walkQuote(shopLocation, buyer, units, subtotal) {
  const walk = shopLocation?.walk;
  if (!walk?.enabled || !shopLocation?.public || !shopLocation.point?.coordinates) return { ok: false, reason: 'This seller doesn’t do walking delivery' };
  if (!buyer) return { ok: false, reason: 'Share your location to check' };
  const km = distanceKm(buyer, shopLocation.point);
  if (km > walk.maxKm) return { ok: false, km, reason: `You’re ${km} km away; they walk up to ${walk.maxKm} km` };
  return { ok: true, km, minutes: minutesFor(km), ...walkFee(walk, units, subtotal) };
}

// what buyers see on the seller's shop
const publicWalk = (walk) => (walk?.enabled ? { maxKm: walk.maxKm, fee: walk.fee || 0, perItem: walk.perItem || 0, maxFee: walk.maxFee || 0, freeOver: walk.freeOver || 0, afterSale: !!walk.afterSale, note: walk.note || '' } : null);

module.exports = { cleanWalk, walkFee, walkQuote, publicWalk, minutesFor, MAX_KM };
