// Discounts: an ad's "was" price, so buyers see real price drops ("KSh 12,000 → KSh 9,500 · -21%").
//  · the seller can type the old price when posting / editing ("Was price")
//  · or simply lower the price of an existing ad: the old price is kept as the "was" price automatically
// A discount shows for 30 days after it's set, and must be believable (5% to 70% off), so the "Best discounts"
// row can't be gamed with a made-up KSh 1,000,000 → KSh 500 "deal".
const MIN_PERCENT = 5;
const MAX_PERCENT = 70;
const SHOW_DAYS = 30;

const percentOff = (wasPrice, price) => (wasPrice > 0 && price > 0 && wasPrice > price ? Math.round(((wasPrice - price) / wasPrice) * 100) : 0);

// works out { wasPrice, discountPercent, discountUntil } for an ad being saved
//   body.wasPrice: typed by the seller ('' or 0 = no discount; undefined = not sent)
//   previous: the ad before this edit (null when posting)
function discountFor(body, price, previous, httpError) {
  const none = { wasPrice: null, discountPercent: 0, discountUntil: null };
  const typed = body.wasPrice;
  let wasPrice = null;
  let explicit = false;
  if (typed !== undefined && typed !== null && typed !== '' && Number(typed) !== 0) {
    wasPrice = Math.round(Number(typed));
    explicit = true;
    if (!(wasPrice > 0 && wasPrice <= 1e9)) throw httpError('Was price: enter the old price in KSh, or leave it empty');
  } else if (typed === undefined && previous) {
    // the price came down on an edit: remember the old price (or keep the earlier "was" price if it's higher)
    if (previous.price > 0 && price > 0 && price < previous.price) wasPrice = Math.max(previous.price, previous.wasPrice || 0);
    else if (previous.wasPrice > price) wasPrice = previous.wasPrice;
  }
  if (!wasPrice || !(price > 0)) return none;
  const percent = percentOff(wasPrice, price);
  if (explicit) {
    if (wasPrice <= price) throw httpError('Was price must be higher than the price now');
    if (percent < MIN_PERCENT) throw httpError(`That’s under ${MIN_PERCENT}% off: leave “Was price” empty, or lower the price`);
    if (percent > MAX_PERCENT) throw httpError(`A ${percent}% discount looks too big to be real. Check the prices (up to ${MAX_PERCENT}% off).`);
  } else if (percent < MIN_PERCENT || percent > MAX_PERCENT) return none; // a tiny change or a typo fix: no "deal"
  // a new or bigger discount starts a fresh 30 days; the same discount keeps its end date
  const same = previous && previous.wasPrice === wasPrice && previous.price === price && previous.discountUntil;
  return { wasPrice, discountPercent: percent, discountUntil: same ? previous.discountUntil : new Date(Date.now() + SHOW_DAYS * 86400000) };
}

const isActive = (listing) => listing.discountPercent >= MIN_PERCENT && listing.wasPrice > listing.price && listing.discountUntil && new Date(listing.discountUntil) > new Date();
const activeFilter = () => ({ discountPercent: { $gte: MIN_PERCENT }, discountUntil: { $gt: new Date() } });

module.exports = { discountFor, isActive, activeFilter, percentOff, MIN_PERCENT, MAX_PERCENT, SHOW_DAYS };

// ---------------------------------------------------------------- ranking the deals
// "Best discounts" isn't only the biggest %: 30% off a KSh 60,000 phone beats 50% off a KSh 40 sachet.
// dealScore = % off  +  8 × log10(shillings saved)  +  up to 10 for a fresh deal (first 3 days)  +  3 for a verified seller
// e.g. -30% on KSh 60,000 (saves 18,000): 30 + 34 = 64 · -50% on KSh 40 (saves 40): 50 + 13 = 63
const dealScore = () => ({
  $add: [
    '$discountPercent',
    { $multiply: [8, { $log10: { $max: [1, { $subtract: ['$wasPrice', '$price'] }] } }] },
    // set = discountUntil − 30 days; fresh for 3 days, fading to 0
    { $max: [0, { $multiply: [10, { $subtract: [1, { $divide: [{ $subtract: ['$$NOW', { $subtract: ['$discountUntil', SHOW_DAYS * 86400000] }] }, 3 * 86400000] }] }] }] },
    { $cond: ['$sellerVerified', 3, 0] },
  ],
});

// the best deals on the platform right now (plain listing objects with dealScore), best first
async function topDeals(Listing, { limit = 12, match = {}, fields } = {}) {
  const project = fields ? Object.fromEntries(fields.split(/\s+/).filter(Boolean).map((field) => [field, 1])) : null;
  return Listing.aggregate([
    { $match: { status: 'active', ...activeFilter(), ...match } },
    { $addFields: { dealScore: dealScore() } },
    { $sort: { dealScore: -1, discountPercent: -1, _id: 1 } },
    { $limit: limit },
    ...(project ? [{ $project: { ...project, dealScore: 1 } }] : []),
  ]);
}

module.exports.dealScore = dealScore;
module.exports.topDeals = topDeals;
