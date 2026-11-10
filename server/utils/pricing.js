// Single source of truth for selling prices. A product's discountPercent (0–90) gives a sale price,
// rounded to whole shillings. Used by POS sales, online orders and the shop catalogue.
const clampPct = (d) => Math.min(90, Math.max(0, Math.round(Number(d) || 0)));

function salePrice(p) {
  const pct = clampPct(p.discountPercent);
  if (!pct) return p.price;
  return Math.max(0, Math.round((p.price * (100 - pct)) / 100));
}

// Product as JSON plus its computed sale price
function withPricing(p) {
  const o = typeof p.toObject === 'function' ? p.toObject() : { ...p };
  o.discountPercent = clampPct(o.discountPercent);
  o.salePrice = salePrice(o);
  return o;
}

module.exports = { salePrice, withPricing, clampPct };
