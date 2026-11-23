// Smart seller search: "cheapest rice wholesaler", "best supplier of cement in Nakuru", "most reliable phone dealer near me".
// Instead of a list of ads, the buyer gets the sellers ranked on four things, weighted by what they asked for:
//   price        how the seller's best matching offer compares with the usual price for the same kind of item
//   reliability  orders completed (not cancelled by the seller), buyers' stars, how fast they deliver, verified ID
//   deliveries   how many orders they have actually delivered
//   location     how far their shop is from the buyer (their pin, else the same county)
// "cheapest" leans on price, "best"/"top" on reliability and deliveries, "trusted" on reliability, "near me" on location.
// The pure functions (intent, weights, scores) are unit-tested; rank() reads the database.
const { COUNTIES } = require('./categories');

// ---------------------------------------------------------------- what the buyer asked for
// nouns that always mean "a seller who sells in bulk"
const TRADE_NOUNS = /\b(?:wholesalers?|suppliers?|distributors?|stockists?|msambazaji|wasambazaji|wauzaji wa jumla|muuzaji wa jumla)\b/i;
// nouns that mean "a seller" only together with a ranking word ("best phone dealer", not "shoe shop")
const SELLER_NOUNS = /\b(?:dealers?|sellers?|vendors?|shops?|traders?|merchants?|stores?|wauzaji|muuzaji|maduka|duka)\b/i;
const WANTS = {
  price: /\b(?:cheapest|cheap|cheaper|lowest(?: price)?|low(?:est)? cost|affordable|best price|good price|budget|bei (?:rahisi|nafuu|ya chini)|rahisi|nafuu)\b/i,
  quality: /\b(?:best|top|top[- ]rated|highest[- ]rated|best[- ]rated|recommended|good|great|leading|popular|bora|mzuri|wazuri)\b/i,
  reliability: /\b(?:reliable|most reliable|trusted|trustworthy|dependable|honest|legit|genuine|safe|verified|wa kuaminika|waaminifu|mwaminifu)\b/i,
  deliveries: /\b(?:delivers?|delivery|deliveries|fast(?:est)? delivery|on time|quick(?:est)?|experienced|most (?:sales|orders)|anayefikisha)\b/i,
  location: /\b(?:nearest|closest|near(?: me| here)?|nearby|around (?:me|here)|close to me|in my area|karibu(?: nami)?|jirani)\b/i,
};
const BULK = /\b(?:wholesal\w*|jumla|bulk|suppliers?|distributors?|stockists?|msambazaji|wasambazaji|cartons?|bales?|crates?)\b/i;
const FILLER = /\b(?:who|which|is|are|the|a|an|of|for|that|sells?|selling|with|has|have|in kenya|kenya|find|show|me|give|i|want|need|looking|please|most|nipe|nataka|natafuta|tafuta|ya|wa|la|za|anayeuza|wanaouza)\b/gi;

// is this a question about sellers rather than items?
function isSellerQuery(text) {
  const input = String(text || '');
  if (TRADE_NOUNS.test(input)) return true;
  return SELLER_NOUNS.test(input) && Object.values(WANTS).some((rx) => rx.test(input));
}

// what matters to the buyer, as weights that add up to 1
const BASE = { price: 0.25, reliability: 0.3, deliveries: 0.25, location: 0.2 };
function weightsFor(text, priorities = []) {
  const input = String(text || '');
  const want = new Set(priorities);
  if (WANTS.price.test(input)) want.add('price');
  if (WANTS.quality.test(input)) want.add('quality');
  if (WANTS.reliability.test(input)) want.add('reliability');
  if (WANTS.deliveries.test(input)) want.add('deliveries');
  if (WANTS.location.test(input)) want.add('location');
  const weight = { ...BASE };
  if (want.has('price')) weight.price += 0.6;
  if (want.has('quality')) { weight.reliability += 0.2; weight.deliveries += 0.15; }
  if (want.has('reliability')) weight.reliability += 0.35;
  if (want.has('deliveries')) weight.deliveries += 0.3;
  if (want.has('location')) weight.location += 0.4;
  const sum = Object.values(weight).reduce((total, item) => total + item, 0);
  const out = Object.fromEntries(Object.entries(weight).map(([key, item]) => [key, Math.round((item / sum) * 1000) / 1000]));
  // the label for the results: what the buyer leaned on most ("best" when nothing in particular)
  const lead = want.has('price') ? 'cheapest' : want.has('location') && want.size === 1 ? 'nearest' : want.has('reliability') ? 'reliable' : 'best';
  return { weights: out, lead, wants: [...want] };
}

// the product words left once seller, ranking and filler words are taken out ("cheapest rice wholesaler" → "rice")
function productWords(text) {
  let input = ` ${String(text || '').toLowerCase()} `;
  for (const rx of [TRADE_NOUNS, SELLER_NOUNS, BULK, ...Object.values(WANTS)]) input = input.replace(new RegExp(rx.source, 'gi'), ' ');
  input = input.replace(FILLER, ' ').replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return input ? require('./aiSearch').parseRules(input).terms : ''; // drops place names ("in Kisumu") and prices
}

// ---------------------------------------------------------------- scores (each 0 to 1)
const clamp = (value) => Math.max(0, Math.min(1, value));
const median = (list) => {
  const sorted = [...list].sort((first, second) => first - second);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// the price a buyer pays per unit: the lowest bulk price for wholesale ads, else the normal price
function unitPriceOf(listing, bulk) {
  const tiers = listing.wholesale?.enabled ? listing.wholesale.tiers || [] : [];
  if (bulk && tiers.length) return Math.min(...tiers.map((tier) => tier.price).filter((price) => price > 0));
  return listing.price > 0 ? listing.price : null;
}

// relative price: 0.8 = 20% below the usual price of the same kind of item (same category and type) in the results
function relativePrices(listings, bulk) {
  const groups = new Map();
  for (const listing of listings) {
    const unit = unitPriceOf(listing, bulk);
    if (!unit) continue;
    const key = `${listing.category}/${listing.sub}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(unit);
  }
  const usual = new Map([...groups].map(([key, list]) => [key, median(list)]));
  return new Map(listings.map((listing) => {
    const unit = unitPriceOf(listing, bulk);
    const typical = usual.get(`${listing.category}/${listing.sub}`);
    return [String(listing._id), unit && typical ? unit / typical : null];
  }));
}
// 25% or more below the usual price → 1, the usual price → 0.5, 25% or more above → 0. No price shown → 0.3
const priceScore = (relative) => (relative == null ? 0.3 : clamp(0.5 + (1 - relative) * 2));

// many orders cancelled by the seller: pushed down whatever the price (and the buyer is told)
const unreliable = ({ orders = 0, successRate = null }) => orders >= 5 && successRate != null && successRate < 60;

// delivered orders on a log scale: 0 → 0, 10 → 0.52, 100 → 1
const deliveriesScore = (delivered) => clamp(Math.log10(1 + Math.max(0, delivered || 0)) / Math.log10(101));

// completed vs. cancelled by the seller (with a small prior, so 1 of 1 isn't "100%"), stars, speed and a checked ID
function reliabilityScore({ delivered = 0, sellerCancelled = 0, rating = { avg: 0, count: 0 }, medianHours = null, verified = false }) {
  const success = (delivered + 3 * 0.85) / (delivered + sellerCancelled + 3);
  const stars = rating.count ? ((rating.avg * rating.count + 4 * 3) / (rating.count + 3)) / 5 : 0.8;
  const speed = medianHours == null ? 0.6 : medianHours <= 24 ? 1 : medianHours <= 72 ? 0.8 : medianHours <= 168 ? 0.55 : 0.3;
  return clamp(0.45 * success + 0.3 * stars + 0.1 * speed + 0.15 * (verified ? 1 : 0));
}

// distance when both pins are known (10 km → 0.5), else the same county; unknown buyer location → null (not used)
function locationScore({ km = null, sellerCounty = '', buyerCounty = '', buyerKnown = false }) {
  if (km != null) return clamp(1 / (1 + km / 10));
  if (!buyerKnown) return null;
  if (buyerCounty && sellerCounty === buyerCounty) return 0.75;
  return 0.2;
}

// one number out of 100; a missing score (no buyer location) hands its weight to the others
function overall(scores, weights, { penalty = false } = {}) {
  let total = 0;
  let used = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (scores[key] == null) continue;
    total += weight * scores[key];
    used += weight;
  }
  return used ? Math.round((total / used) * 100 * (penalty ? 0.75 : 1)) : 0;
}

// short reasons for the card, strongest first
function reasonsFor({ relative, unit, unitName, delivered, orders, successRate, rating, verified, km, county, buyerCounty, medianHours }) {
  const out = [];
  if (relative != null && relative <= 0.92) out.push({ key: 'price', text: `🏷️ ${Math.round((1 - relative) * 100)}% below the usual price` });
  else if (unit) out.push({ key: 'price', text: `🏷️ From KSh ${Number(unit).toLocaleString('en-KE')}${unitName ? ` / ${unitName}` : ''}` });
  out.push(delivered ? { key: 'deliveries', text: `🚚 ${delivered} successful deliver${delivered === 1 ? 'y' : 'ies'}` } : { key: 'deliveries', text: '🆕 New on Kapu: no deliveries yet' });
  if (unreliable({ orders, successRate })) out.push({ key: 'warning', text: `⚠️ Cancelled ${100 - successRate}% of recent orders` });
  else if (orders >= 3) out.push({ key: 'reliability', text: `✅ ${successRate}% of orders completed` });
  if (rating?.count) out.push({ key: 'reliability', text: `⭐ ${rating.avg.toFixed(1)} from ${rating.count} review${rating.count === 1 ? '' : 's'}` });
  if (medianHours != null && medianHours <= 24) out.push({ key: 'reliability', text: '⚡ Usually delivers within a day' });
  if (verified) out.push({ key: 'reliability', text: '✔ Verified seller' });
  if (km != null) out.push({ key: 'location', text: `📍 ${km < 1 ? 'Under 1' : km} km away` });
  else if (county) out.push({ key: 'location', text: `📍 ${county}${buyerCounty && county === buyerCounty ? ' (your county)' : ''}` });
  return out;
}

// ---------------------------------------------------------------- the search
// question: the buyer's words; hints: what the AI understood ({ terms, county, minPrice, maxPrice, priorities });
// here: { lat, lng } when the buyer shared their location; buyerCounty: from their account
async function rank(question, hints = {}, { here = null, buyerCounty = '' } = {}) {
  const Listing = require('../models/Listing');
  const Order = require('../models/Order');
  const Customer = require('../models/Customer');
  const search = require('./search');
  const geo = require('./geo');
  const mongoose = require('mongoose');

  const bulk = BULK.test(question);
  const { weights, lead, wants } = weightsFor(question, hints.priorities);
  const terms = productWords(hints.terms != null && hints.engine === 'ai' ? hints.terms : question);
  const county = hints.county && COUNTIES.includes(hints.county) ? hints.county : '';
  const homeCounty = county || buyerCounty || '';

  // the ads that match: every word, else any word, else the category the words point at
  const base = { status: 'active', ...(bulk ? { 'wholesale.enabled': true } : {}) };
  if (hints.minPrice || hints.maxPrice) base.price = { ...(hints.minPrice ? { $gte: hints.minPrice } : {}), ...(hints.maxPrice ? { $lte: hints.maxPrice } : {}) };
  const FIELDS = 'slug title price images category sub county area geo seller wholesale buyNow attrs';
  const find = (where) => Listing.find(where).select(FIELDS).limit(400).lean();
  let listings = [];
  let matched = 'all';
  if (terms) {
    listings = await find({ ...base, ...search.wordFilter(terms, 'all').filter });
    if (!listings.length) {
      const detected = search.detectCategory(terms);
      if (detected?.category) {
        listings = await find({ ...base, category: detected.category, ...(detected.sub ? { sub: detected.sub } : {}) });
        matched = 'category';
      }
    }
    if (!listings.length) {
      listings = await find({ ...base, ...search.wordFilter(terms, 'any').filter });
      matched = 'some';
    }
  } else {
    listings = await find(base);
  }
  // "in Nakuru": that county's sellers, unless it has none
  let widened = false;
  if (county) {
    const local = listings.filter((listing) => listing.county === county);
    if (local.length) listings = local;
    else widened = true;
  }
  const locationUsed = here ? 'pin' : homeCounty ? 'county' : 'none';
  if (!listings.length) return { sellers: [], total: 0, terms, bulk, weights, lead, wants, county, widened, matched, locationUsed };

  // each seller's best matching offer (lowest price compared with the usual price)
  const relative = relativePrices(listings, bulk);
  const bySeller = new Map();
  for (const listing of listings) {
    const id = String(listing.seller);
    const entry = bySeller.get(id) || { listings: [], best: null, bestRel: null, point: null };
    entry.listings.push(listing);
    const rel = relative.get(String(listing._id));
    if (entry.best == null || (rel != null && (entry.bestRel == null || rel < entry.bestRel))) {
      entry.best = listing;
      entry.bestRel = rel;
    }
    if (!entry.point && listing.geo?.coordinates) entry.point = listing.geo; // the shop pin (only on ads of sellers who show it)
    bySeller.set(id, entry);
  }
  const ids = [...bySeller.keys()].slice(0, 300).map((id) => new mongoose.Types.ObjectId(id));

  // track record over the last year: delivered, cancelled by the seller, and how long delivery took
  const since = new Date(Date.now() - 365 * 86400000);
  const [people, records] = await Promise.all([
    Customer.find({ _id: { $in: ids }, active: { $ne: false } }).select('name avatar verified rating completedSales county shopLocation.area shopLocation.county createdAt').lean(),
    Order.aggregate([
      { $match: { seller: { $in: ids }, createdAt: { $gte: since }, status: { $in: ['delivered', 'cancelled'] } } },
      {
        $project: {
          seller: 1, status: 1, cancelledBy: 1,
          hours: {
            $let: {
              vars: { done: { $arrayElemAt: [{ $filter: { input: { $ifNull: ['$history', []] }, as: 'step', cond: { $eq: ['$$step.status', 'delivered'] } } }, 0] } },
              in: { $cond: [{ $ifNull: ['$$done.at', false] }, { $divide: [{ $subtract: ['$$done.at', '$createdAt'] }, 3600000] }, null] },
            },
          },
        },
      },
      {
        $group: {
          _id: '$seller',
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          sellerCancelled: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: ['$cancelledBy', 'seller'] }] }, 1, 0] } },
          hours: { $push: '$hours' },
        },
      },
    ]),
  ]);
  const record = new Map(records.map((item) => [String(item._id), item]));
  const buyerKnown = !!homeCounty; // by county when a pin can't be compared (the seller hides theirs)

  const sellers = people.map((person) => {
    const id = String(person._id);
    const entry = bySeller.get(id);
    const stats = record.get(id) || { delivered: 0, sellerCancelled: 0, hours: [] };
    const delivered = Math.max(stats.delivered, person.completedSales || 0); // all-time sales count when it's higher
    const orders = stats.delivered + stats.sellerCancelled;
    const medianHours = median((stats.hours || []).filter((hour) => hour != null && hour >= 0));
    const successRate = orders ? Math.round((stats.delivered / orders) * 100) : null;
    const sellerCounty = entry.best.county || person.shopLocation?.county || person.county || '';
    const km = here && entry.point ? geo.distanceKm(here, entry.point) : null;
    const scores = {
      price: priceScore(entry.bestRel),
      reliability: reliabilityScore({ delivered: stats.delivered, sellerCancelled: stats.sellerCancelled, rating: person.rating, medianHours, verified: person.verified }),
      deliveries: deliveriesScore(delivered),
      location: locationScore({ km, sellerCounty, buyerCounty: homeCounty, buyerKnown }),
    };
    const unit = unitPriceOf(entry.best, bulk);
    const tier = entry.best.wholesale?.enabled ? entry.best.wholesale.tiers?.[entry.best.wholesale.tiers.length - 1] : null;
    return {
      seller: { _id: person._id, name: person.name, avatar: person.avatar || '', verified: !!person.verified, county: sellerCounty, area: entry.best.area || person.shopLocation?.area || '' },
      score: overall(scores, weights, { penalty: unreliable({ orders, successRate }) }),
      scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, value == null ? null : Math.round(value * 100)])),
      stats: { delivered, orders, successRate, rating: person.rating || { avg: 0, count: 0 }, medianHours: medianHours == null ? null : Math.round(medianHours), km, priceVsUsual: entry.bestRel == null ? null : Math.round(entry.bestRel * 100) },
      best: {
        _id: entry.best._id, slug: entry.best.slug, title: entry.best.title, image: entry.best.images?.[0] || '', price: entry.best.price, category: entry.best.category,
        unitPrice: unit, unit: entry.best.wholesale?.enabled ? entry.best.wholesale.unit || 'unit' : '', ...(tier ? { fromQty: tier.minQty } : {}), buyNow: !!entry.best.buyNow,
      },
      items: entry.listings.length,
      reasons: reasonsFor({ relative: entry.bestRel, unit, unitName: entry.best.wholesale?.enabled ? entry.best.wholesale.unit : '', delivered, orders, successRate, rating: person.rating, verified: person.verified, km, county: sellerCounty, buyerCounty, medianHours }), // "your county" only from the buyer's own account
    };
  });
  // best score first; ties: more deliveries, then the lower price
  sellers.sort((first, second) => second.score - first.score || second.stats.delivered - first.stats.delivered || (first.best.unitPrice || Infinity) - (second.best.unitPrice || Infinity));
  return { sellers: sellers.slice(0, 10), total: sellers.length, terms, bulk, weights, lead, wants, county, widened, matched, locationUsed };
}

// "Cheapest rice wholesalers in Nakuru"
function describe({ lead, terms, bulk, county }) {
  const who = bulk ? 'wholesalers' : 'sellers';
  const word = { cheapest: 'Cheapest', nearest: 'Nearest', reliable: 'Most reliable', best: 'Best' }[lead] || 'Best';
  return `${word} ${terms ? `${terms} ` : ''}${who}${county ? ` in ${county}` : ''}`;
}

module.exports = { unreliable, isSellerQuery, weightsFor, productWords, unitPriceOf, relativePrices, priceScore, deliveriesScore, reliabilityScore, locationScore, overall, reasonsFor, rank, describe };
