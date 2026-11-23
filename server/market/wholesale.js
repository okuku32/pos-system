// Wholesale ("bei ya jumla"): bulk price tiers on an ad.
//   wholesale: { enabled, unit: 'carton', retail: true, tiers: [{ minQty: 10, price: 1200 }, { minQty: 50, price: 1100 }] }
// The ad's normal price is the single-unit price. A tier's price applies from its minimum quantity up.
// When retail is false the seller only sells in bulk: the smallest tier's quantity is the minimum order.

// unit price for buying `qty` of this ad
function unitPrice(listing, qty) {
  const wholesale = listing.wholesale;
  if (!wholesale?.enabled || !wholesale.tiers?.length) return listing.price;
  let price = wholesale.retail === false ? wholesale.tiers[0].price : listing.price;
  for (const tier of wholesale.tiers) if (qty >= tier.minQty) price = tier.price;
  return price;
}

// smallest quantity a buyer may order
const minOrder = (listing) => (listing.wholesale?.enabled && listing.wholesale.retail === false && listing.wholesale.tiers?.length ? listing.wholesale.tiers[0].minQty : 1);

// checks and cleans what the seller entered (throws a friendly message)
function cleanWholesale(body, retailPrice, httpError) {
  const wholesale = body.wholesale;
  if (!wholesale || !(wholesale.enabled === true || wholesale.enabled === 'true')) return { enabled: false, retail: true, unit: '', tiers: [] };
  const unit = String(wholesale.unit || '').replace(/[<>]/g, '').trim().slice(0, 30);
  const retail = !(wholesale.retail === false || wholesale.retail === 'false');
  const tiers = (Array.isArray(wholesale.tiers) ? wholesale.tiers : [])
    .map((tier) => ({ minQty: Math.floor(Number(tier.minQty)), price: Math.round(Number(tier.price)) }))
    .filter((item) => item.minQty > 0 && item.price > 0)
    .sort((first, second) => first.minQty - second.minQty)
    .slice(0, 4);
  if (!tiers.length) throw httpError('Add at least one bulk price, e.g. 10 or more at KSh …');
  if (tiers[0].minQty < 2) throw httpError('Bulk prices start from 2 or more units');
  for (let index = 0; index < tiers.length; index++) {
    if (index > 0 && tiers[index].minQty === tiers[index - 1].minQty) throw httpError('Each bulk price needs a different quantity');
    if (index > 0 && tiers[index].price >= tiers[index - 1].price) throw httpError('Bigger quantities should have a lower price per unit');
    if (retail && retailPrice > 0 && tiers[index].price >= retailPrice) throw httpError(`Bulk prices must be lower than the single-unit price (KSh ${retailPrice.toLocaleString('en-KE')})`);
    if (tiers[index].minQty > 100000) throw httpError('That quantity is too large');
  }
  return { enabled: true, unit, retail, tiers };
}

// what an ad card shows: "from KSh 1,100 / carton · min 10"
const summary = (order) => {
  const wholesale = order.wholesale;
  if (!wholesale?.enabled || !wholesale.tiers?.length) return null;
  const best = wholesale.tiers[wholesale.tiers.length - 1];
  return { from: best.price, fromQty: best.minQty, minQty: minOrder(order), unit: wholesale.unit || 'unit', tiers: wholesale.tiers.length, retail: wholesale.retail !== false };
};

module.exports = { unitPrice, minOrder, cleanWholesale, summary };
