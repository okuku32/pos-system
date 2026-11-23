// Smart seller search: pure ranking rules (no database).   cd server && node --test tests/sellerRank.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rank = require('../market/sellerRank');

test('questions about sellers are told apart from item searches', () => {
  for (const text of ['cheapest wholesaler', 'best rice wholesaler', 'most reliable cement supplier near me', 'best phone dealer in Nairobi', 'msambazaji wa sukari bei nafuu', 'trusted shop for laptops']) assert.equal(rank.isSellerQuery(text), true, text);
  for (const text of ['cheapest samsung phone under 20k', 'shoe shop', 'wholesale rice', 'sofa in Nairobi', 'track my order']) assert.equal(rank.isSellerQuery(text), false, text);
});

test('the product words are kept, seller and ranking words dropped', () => {
  assert.equal(rank.productWords('cheapest rice wholesaler'), 'rice');
  assert.equal(rank.productWords('Who is the most reliable supplier of maize flour near me?'), 'maize flour');
  assert.equal(rank.productWords('best wholesaler'), '');
});

test('weights follow what the buyer asked for and add up to 1', () => {
  const sum = (weights) => Math.round(Object.values(weights).reduce((total, item) => total + item, 0) * 100) / 100;
  const cheap = rank.weightsFor('cheapest wholesaler');
  assert.equal(cheap.lead, 'cheapest');
  assert.ok(cheap.weights.price > cheap.weights.reliability);
  assert.equal(sum(cheap.weights), 1);
  const best = rank.weightsFor('best wholesaler');
  assert.equal(best.lead, 'best');
  assert.ok(best.weights.reliability > best.weights.price && best.weights.deliveries > best.weights.price);
  const near = rank.weightsFor('nearest supplier');
  assert.equal(near.lead, 'nearest');
  assert.ok(near.weights.location > 0.4);
  assert.equal(rank.weightsFor('wholesaler', ['reliability']).lead, 'reliable'); // from the AI's reading
});

test('price is compared with the usual price for the same kind of item', () => {
  const ads = [
    { _id: 'a', category: 'food', sub: 'rice', price: 3000, wholesale: { enabled: true, tiers: [{ minQty: 10, price: 2500 }, { minQty: 50, price: 2000 }] } },
    { _id: 'b', category: 'food', sub: 'rice', price: 3000, wholesale: { enabled: true, tiers: [{ minQty: 10, price: 2800 }] } },
    { _id: 'c', category: 'food', sub: 'rice', price: 3200, wholesale: { enabled: true, tiers: [{ minQty: 10, price: 3000 }] } },
    { _id: 'd', category: 'tools', sub: 'cement', price: 800 },
  ];
  assert.equal(rank.unitPriceOf(ads[0], true), 2000); // the best bulk price
  assert.equal(rank.unitPriceOf(ads[0], false), 3000);
  const rel = rank.relativePrices(ads, true);
  assert.ok(rel.get('a') < 1 && rel.get('c') > 1);
  assert.equal(rel.get('d'), 1); // alone in its kind: the usual price
  assert.ok(rank.priceScore(rel.get('a')) > rank.priceScore(rel.get('c')));
  assert.equal(rank.priceScore(null), 0.3);
});

test('reliability rewards completed orders, stars, speed and a checked ID', () => {
  const good = rank.reliabilityScore({ delivered: 80, sellerCancelled: 2, rating: { avg: 4.8, count: 40 }, medianHours: 20, verified: true });
  const flaky = rank.reliabilityScore({ delivered: 10, sellerCancelled: 10, rating: { avg: 3, count: 8 }, medianHours: 200, verified: false });
  const fresh = rank.reliabilityScore({});
  assert.ok(good > fresh && fresh > flaky);
  assert.ok(good <= 1 && flaky >= 0);
});

test('deliveries count on a log scale, location by distance or county', () => {
  assert.equal(rank.deliveriesScore(0), 0);
  assert.equal(rank.deliveriesScore(100), 1);
  assert.ok(rank.deliveriesScore(10) > 0.4 && rank.deliveriesScore(10) < 0.6);
  assert.equal(rank.locationScore({ km: 10 }), 0.5);
  assert.ok(rank.locationScore({ km: 2 }) > rank.locationScore({ km: 30 }));
  assert.equal(rank.locationScore({ sellerCounty: 'Nairobi', buyerCounty: 'Nairobi', buyerKnown: true }), 0.75);
  assert.equal(rank.locationScore({ sellerCounty: 'Kisumu', buyerCounty: 'Nairobi', buyerKnown: true }), 0.2);
  assert.equal(rank.locationScore({ sellerCounty: 'Kisumu' }), null); // buyer's place unknown: not counted
});

test('the overall score skips a missing part and gives its weight to the rest', () => {
  const weights = { price: 0.25, reliability: 0.25, deliveries: 0.25, location: 0.25 };
  assert.equal(rank.overall({ price: 1, reliability: 1, deliveries: 1, location: null }, weights), 100);
  assert.equal(rank.overall({ price: 0, reliability: 1, deliveries: 1, location: 0 }, weights), 50);
});

test('a cheap but unreliable seller loses "best" yet can win "cheapest"', () => {
  const cheapFlaky = { price: rank.priceScore(0.6), reliability: rank.reliabilityScore({ delivered: 2, sellerCancelled: 6 }), deliveries: rank.deliveriesScore(2), location: null };
  const solid = { price: rank.priceScore(1.05), reliability: rank.reliabilityScore({ delivered: 150, sellerCancelled: 1, rating: { avg: 4.7, count: 60 }, medianHours: 24, verified: true }), deliveries: rank.deliveriesScore(150), location: null };
  const best = rank.weightsFor('best wholesaler').weights;
  const cheapest = rank.weightsFor('cheapest wholesaler').weights;
  assert.ok(rank.overall(solid, best) > rank.overall(cheapFlaky, best));
  assert.ok(rank.overall(cheapFlaky, cheapest) > rank.overall(cheapFlaky, best));
});

test('reasons say why, in plain words', () => {
  const reasons = rank.reasonsFor({ relative: 0.8, unit: 2000, unitName: 'bag', delivered: 48, orders: 50, successRate: 96, rating: { avg: 4.6, count: 12 }, verified: true, km: 3.2, county: 'Nairobi', buyerCounty: 'Nairobi', medianHours: 10 }).map((item) => item.text);
  assert.ok(reasons.includes('🏷️ 20% below the usual price'));
  assert.ok(reasons.includes('🚚 48 successful deliveries'));
  assert.ok(reasons.includes('✅ 96% of orders completed'));
  assert.ok(reasons.includes('📍 3.2 km away'));
  assert.equal(rank.describe({ lead: 'cheapest', terms: 'rice', bulk: true, county: 'Nakuru' }), 'Cheapest rice wholesalers in Nakuru');
});
