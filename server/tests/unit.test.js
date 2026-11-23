// Unit tests: pure functions, no server or database.   cd server && npm run test:unit
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { v: value, normalizeEmail, validEmail } = require('../security/validate');
const riders = require('../market/riders');
const transit = require('../market/transit');
const search = require('../market/search');
const discount = require('../market/discount');

// ---------------------------------------------------------------- authentication input
test('emails are normalised: trimmed, lowercase, Unicode-normalised', () => {
  assert.equal(normalizeEmail('  Akinyi.Otieno@GMAIL.com '), 'akinyi.otieno@gmail.com');
  assert.equal(normalizeEmail('ｗａｎｊｉｋｕ@example.com'), 'wanjiku@example.com', 'full-width letters (NFKC)');
  assert.equal(normalizeEmail(undefined), '');
});

test('email shape: sensible addresses pass, broken ones fail', () => {
  for (const ok of ['wanjiku@kapu.co.ke', 'a.b+shop@example.com', 'x@sub.domain.ke']) assert.ok(validEmail(ok), ok);
  for (const bad of ['', 'plain', 'a@b', 'a..b@example.com', '.a@example.com', 'a.@example.com', 'a@-example.com', 'a b@example.com', `${'x'.repeat(65)}@example.com`, `a@${'x'.repeat(250)}.com`, '<script>@x.com']) assert.ok(!validEmail(bad), bad);
});

test('strong passwords: length, upper, lower, number, not common, not personal', () => {
  const check = (password, who) => { try { value.newPassword(who)(password); return 'ok'; } catch (error) { return error.message; } };
  assert.equal(check('Kenya-Market-2026'), 'ok');
  assert.match(check('Short1A'), /at least 10/);
  assert.match(check('alllowercase123'), /uppercase/);
  assert.match(check('ALLUPPERCASE123'), /lowercase/);
  assert.match(check('NoNumbersHereAtAll'), /number/);
  assert.match(check('Password12345'), /too easy/);
  assert.match(check('Wanjiku-2026x', { name: 'Wanjiku Kamau' }), /name or email/);
  assert.match(check('Otieno-Pass-99', { email: 'otieno@example.com' }), /name or email/);
  assert.equal(check('Kamau-Pass-99', { name: 'Jo Ka' }), 'ok', 'short name parts (under 4 letters) are not checked');
  assert.match(check(undefined), /choose a password/i);
  assert.match(check('A1' + 'a'.repeat(250)), /at least 10/, 'over 200 characters is refused');
});

test('validation strips unknown fields and refuses wrong types', () => {
  const run = (schema, body) => {
    const req = { body };
    let status = 200;
    let message = '';
    const res = { status(code) { status = code; return { json: (data) => { message = data.message; } }; } };
    // like Express: a refused request goes to the error handler (next(error)), which answers with its status
    require('../security/validate').validate(schema)(req, res, (error) => { if (error) { status = error.status || 500; message = error.message; } });
    return { status, message, body: req.body };
  };
  const schema = { email: value.email(), accountType: value.oneOf(['buyer', 'seller'], { optional: true }) };
  const ok = run(schema, { email: ' A@Example.com ', role: 'admin', isAdmin: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { email: 'a@example.com' }, 'unknown fields (role, isAdmin) are dropped');
  assert.equal(run(schema, { email: 'a@example.com', accountType: 'admin' }).status, 400, 'a role can’t be smuggled in as an account type');
  assert.equal(run(schema, { email: { $gt: '' } }).status, 400, 'objects are not strings');
});

// ---------------------------------------------------------------- riders
test('rider capacity: by vehicle unless the rider chose; always 1–6', () => {
  assert.equal(riders.capacityOf({ vehicle: 'On foot' }), 2);
  assert.equal(riders.capacityOf({ vehicle: 'Motorbike' }), 3);
  assert.equal(riders.capacityOf({ vehicle: 'Van / pickup' }), 6);
  assert.equal(riders.capacityOf({ vehicle: 'Motorbike', capacity: 5 }), 5);
  assert.equal(riders.capacityOf({ vehicle: 'Motorbike', capacity: 99 }), 6);
  assert.equal(riders.capacityOf({}), 3);
});

test('rider ETA: to the shop then the buyer before pick-up; straight to the buyer after', () => {
  const task = { status: 'assigned', pickup: { point: { type: 'Point', coordinates: [36.8876, -1.3296] } }, dropoff: { lat: -1.3160, lng: 36.8790 } };
  const before = riders.etaFor(task, { lat: -1.3296, lng: 36.8876 }, 'Motorbike');
  assert.equal(before.stage, 'to_shop');
  assert.ok(before.minutes >= 5 + 1, `includes the time at the shop (${before.minutes} min)`);
  const after = riders.etaFor({ ...task, status: 'picked_up' }, { lat: -1.3200, lng: 36.8800 }, 'Motorbike');
  assert.equal(after.stage, 'to_you');
  assert.ok(after.minutes < before.minutes && after.kmLeft < 1);
  assert.ok(riders.minutesFor(3, 'On foot') > riders.minutesFor(3, 'Motorbike'), 'walking is slower');
  assert.equal(riders.etaFor({ ...task, status: 'picked_up', dropoff: {} }, { lat: -1.32, lng: 36.88 }, 'Motorbike'), null, 'no drop-off pin: no guess');
});

test('a rider’s live location is used only while fresh', () => {
  const base = { type: 'Point', coordinates: [36.8, -1.3] };
  const live = { type: 'Point', coordinates: [36.9, -1.2] };
  assert.equal(riders.positionOf({ base, live, liveAt: new Date() }).live, true);
  assert.equal(riders.positionOf({ base, live, liveAt: new Date(Date.now() - 60 * 60 * 1000) }).live, false, 'an hour-old location falls back to their stage');
  assert.equal(riders.positionOf({}), null);
});

// ---------------------------------------------------------------- delivery stages
test('delivery stages fill in steps a rider skipped, and cancelled orders say so', () => {
  const at = new Date('2026-11-15T10:00:00Z');
  const order = { delivery: { method: 'rider' }, status: 'shipped', history: [{ status: 'confirmed', at }], rider: { pickedUpAt: at, arrivedAt: at } };
  const result = transit.forOrder(order);
  assert.equal(result.current, 'arrived');
  assert.ok(result.steps.find((step) => step.key === 'on_the_way').done, '“on the way” counts as done once they arrived');
  assert.equal(transit.forOrder({ ...order, status: 'cancelled' }).current, 'cancelled');
  assert.equal(transit.forOrder({ delivery: { method: 'pickup' } }), null, 'pick-up orders have no delivery steps');
});

// ---------------------------------------------------------------- search
test('search: categories from whole words (plurals, Kiswahili), never from parts of words', () => {
  assert.equal(search.detectCategory('cheapest car').category, 'vehicles');
  assert.equal(search.detectCategory('gari').category, 'vehicles');
  assert.equal(search.detectCategory(search.tokens('phones').join(' ')).sub, 'phones');
  assert.notEqual(search.detectCategory('carrots')?.category, 'vehicles', '“car” is not in “carrots”');
  assert.equal(search.stem('mattresses'), 'mattress');
  assert.equal(search.stem('batteries'), 'battery');
});

test('search price phrases: under / above / ranges', () => {
  assert.deepEqual([search.parsePrice('plot under 1.5m').max, search.parsePrice('tv above 30k').min], [1500000, 30000]);
  const range = search.parsePrice('sofa 30k-50k');
  assert.deepEqual([range.min, range.max], [30000, 50000]);
});

// ---------------------------------------------------------------- discounts
test('discounts: percent off, and only real, current discounts count', () => {
  assert.equal(discount.percentOff(1000, 700), 30, '(was 1000, now 700)');
  assert.equal(discount.percentOff(700, 1000), 0, 'a higher price is not a discount');
  const now = Date.now();
  assert.ok(discount.isActive({ price: 700, wasPrice: 1000, discountPercent: 30, discountUntil: new Date(now + 86400000) }));
  assert.ok(!discount.isActive({ price: 700, wasPrice: 1000, discountPercent: 30, discountUntil: new Date(now - 1000) }), 'expired');
  assert.ok(!discount.isActive({ price: 1000, wasPrice: 900, discountPercent: 0 }), 'a “was” price lower than the price is not a discount');
});

// ---------------------------------------------------------------- Google ID tokens (OpenID Connect), checked offline
test('Google ID tokens: signature, audience, issuer, expiry and verified email are all checked', async () => {
  const crypto = require('crypto');
  const oauth = require('../utils/oauth');
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  oauth.useFetch(async () => new Response(JSON.stringify({ k1: pem }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } }));
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims, key = privateKey, kid = 'k1') => {
    const head = b64({ alg: 'RS256', typ: 'JWT', kid });
    const body = b64({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: '1234567890', email: 'Akinyi@Example.com', email_verified: true, name: 'Akinyi', iat: now - 10, exp: now + 3600, ...claims });
    const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const who = await oauth.verifyGoogleCredential(sign({}));
  assert.deepEqual([who.googleId, who.email], ['1234567890', 'akinyi@example.com'], 'valid token: identity returned, email normalised');
  const refused = async (token) => { try { await oauth.verifyGoogleCredential(token); return 0; } catch (error) { return error.status; } };
  assert.equal(await refused(sign({ aud: 'someone-elses-app' })), 401, 'wrong audience');
  assert.equal(await refused(sign({ iss: 'https://evil.example.com' })), 401, 'wrong issuer');
  assert.equal(await refused(sign({ exp: now - 600, iat: now - 4000 })), 401, 'expired');
  assert.equal(await refused(sign({}, other.privateKey)), 401, 'signed by someone else');
  assert.equal(await refused(sign({ email_verified: false })), 401, 'Google email not verified');
  const token = sign({});
  assert.equal(await refused(`${token.split('.')[0]}.${b64({ ...JSON.parse(Buffer.from(token.split('.')[1], 'base64url')), sub: 'attacker' })}.${token.split('.')[2]}`), 401, 'tampered claims');
  oauth.useFetch((...args) => fetch(...args));
});

// ---------------------------------------------------------------- seller profile (sign-up / My account)
const sellerProfile = require('../market/sellerProfile');

test('seller kinds and categories: only known ones, no duplicates, capped', () => {
  assert.deepEqual(sellerProfile.sellerTypesFrom(['wholesaler', 'importer', 'wholesaler', 'astronaut', 7, null]), ['wholesaler', 'importer']);
  assert.deepEqual(sellerProfile.sellerTypesFrom('wholesaler'), [], 'not a list');
  assert.equal(sellerProfile.sellerTypesFrom(sellerProfile.KINDS).length, sellerProfile.MAX.types);
  assert.deepEqual(sellerProfile.sellerCategoriesFrom(['electronics', 'samaki', 'bogus', 'electronics']), ['electronics', 'samaki']);
});

test('types picked in the pop-up: real types of the chosen categories only', () => {
  const items = sellerProfile.sellerItemsFrom(['electronics/phones', 'electronics/phones', 'electronics/not-a-type', 'samaki/fresh-omena', 'beddings/mattresses', 'electronics', 'electronics/phones/extra', 42], ['electronics', 'samaki']);
  assert.ok(items.includes('electronics/phones'));
  assert.equal(items.filter((item) => item === 'electronics/phones').length, 1, 'no duplicates');
  assert.ok(!items.some((item) => item.startsWith('beddings/')), 'a category not chosen');
  assert.ok(!items.includes('electronics/not-a-type') && !items.includes('electronics') && !items.includes('electronics/phones/extra'));
  const { getCategory } = require('../market/categories');
  const every = getCategory('electronics').subs.map((sub) => `electronics/${sub.slug}`);
  assert.deepEqual(sellerProfile.sellerItemsFrom(every, ['electronics']), every, 'every real type is kept');
  const many = require('../market/categories').CATEGORIES.flatMap((category) => category.subs.map((sub) => `${category.slug}/${sub.slug}`));
  assert.equal(sellerProfile.sellerItemsFrom(many, require('../market/categories').CATEGORIES.map((category) => category.slug)).length, sellerProfile.MAX.items, 'capped');
});

test('a new seller’s profile: each missing part named; types kept with their categories; pin only inside Kenya', () => {
  const message = (body) => { try { sellerProfile.sellerProfileFrom(body); return 'ok'; } catch (error) { assert.equal(error.status || error.statusCode || 400, 400); return error.message; } };
  assert.match(message({}), /kind of seller/);
  assert.match(message({ sellerTypes: ['shop'] }), /category/);
  assert.match(message({ sellerTypes: ['shop'], sellerCategories: ['samaki'] }), /county/);
  assert.match(message({ sellerTypes: ['shop'], sellerCategories: ['samaki'], location: { county: 'Mombasa', area: 'x' } }), /town or area/);
  const profile = sellerProfile.sellerProfileFrom({ sellerTypes: ['samaki'], sellerCategories: ['samaki'], sellerItems: ['samaki/fresh-omena', 'electronics/phones'], location: { county: 'Kisumu', area: ' Dunga  beach <b>', lat: -0.1, lng: 34.75 } });
  assert.deepEqual(profile.sellerItems, ['samaki/fresh-omena'], 'a type from a category not chosen is dropped');
  assert.deepEqual([profile.county, profile.shopLocation.area, profile.shopLocation.public, profile.shopLocation.point.coordinates], ['Kisumu', 'Dunga beach b', true, [34.75, -0.1]]);
  const noPin = sellerProfile.sellerProfileFrom({ sellerTypes: ['shop'], sellerCategories: ['samaki'], location: { county: 'Kisumu', area: 'Kibuye', lat: 48.8, lng: 2.3 } });
  assert.equal(noPin.shopLocation.point, undefined, 'outside Kenya');
  assert.equal(noPin.sellerItems, undefined, 'no types picked: nothing stored');
});

// ---------------------------------------------------------------- 🛍️ Shop & ride prices (market/shopRide.js)
const shopRide = require('../market/shopRide');
const KE = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000); // a Kenya-time clock reading → the instant
const WESTLANDS = { _id: 'w', name: 'Westlands pickup point', area: 'Westlands', lat: -1.2615, lng: 36.8025 };
const CBD_SHOP = { lat: -1.2850, lng: 36.8250 };
const KASARANI = { lat: -1.2190, lng: 36.8960 };

test('Nairobi traffic by the hour (Kenya time): weekday rush hours, late night, and the rest', () => {
  assert.equal(shopRide.trafficAt(KE('2026-11-18T08:00:00Z')), 'peak', 'Wednesday 8 am');
  assert.equal(shopRide.trafficAt(KE('2026-11-18T17:45:00Z')), 'peak', 'Wednesday 5:45 pm');
  assert.equal(shopRide.trafficAt(KE('2026-11-18T11:00:00Z')), 'normal', 'Wednesday 11 am');
  assert.equal(shopRide.trafficAt(KE('2026-11-22T08:00:00Z')), 'normal', 'Sunday 8 am');
  assert.equal(shopRide.trafficAt(KE('2026-11-18T22:30:00Z')), 'night');
  assert.equal(shopRide.trafficAt(KE('2026-11-18T05:59:00Z')), 'night');
});

test('where our shopping agents are: the CBD, a market with agents (nearby, or the seller’s own stall), else far', () => {
  const markets = [{ _id: 'gikomba', name: 'Gikomba market', lat: -1.2850, lng: 36.8380 }];
  assert.deepEqual(shopRide.coverage(CBD_SHOP, markets), { covered: true, zone: 'cbd', name: 'Nairobi CBD' });
  assert.equal(shopRide.coverage({ lat: -1.2855, lng: 36.8385 }, markets).name, 'Gikomba market', 'a few hundred metres from the market');
  assert.equal(shopRide.coverage(KASARANI, markets).covered, false, 'far from any market with agents');
  assert.equal(shopRide.coverage(KASARANI, markets, shopRide.rates(), { marketId: 'gikomba' }).covered, true, 'registered stall in that market');
  assert.equal(shopRide.coverage(KASARANI, []).covered, false, 'no agents anywhere: only the CBD counts');
  assert.equal(shopRide.coverage(KASARANI, markets, shopRide.rates({ marketRadiusKm: 20 })).covered, true, 'admins can widen the area');
});

test('in the CBD, in Nairobi', () => {
  assert.equal(shopRide.inCbd(CBD_SHOP), true);
  assert.equal(shopRide.inCbd(KASARANI), false);
  assert.equal(shopRide.inNairobi(KASARANI), true);
  assert.equal(shopRide.inNairobi({ lat: -0.0917, lng: 34.768 }), false, 'Kisumu');
});

test('up to 5 kg: KSh 150 from the CBD, KSh 250 from outside it, at any hour; inspection KSh 200 on top', () => {
  const at = KE('2026-11-18T08:00:00Z'); // rush hour changes nothing for light parcels
  const cbd = shopRide.quote({ from: CBD_SHOP, weightKg: 5, inspect: true, mode: 'point', point: WESTLANDS, at });
  assert.deepEqual([cbd.ok, cbd.fromCbd, cbd.delivery.fee, cbd.inspection, cbd.total, cbd.estimate], [true, true, 150, 200, 350, false]);
  // far from the CBD and our agents' markets: verification is recommended, but only charged when the buyer ticks it
  const outside = shopRide.quote({ from: KASARANI, weightKg: 2, inspect: false, mode: 'point', point: WESTLANDS, at });
  assert.deepEqual([outside.fromCbd, outside.delivery.fee, outside.inspection, outside.total, outside.verifyRequired, outside.verifyRecommended], [false, 250, 0, 250, false, true]);
  const outsideTicked = shopRide.quote({ from: KASARANI, weightKg: 2, inspect: true, mode: 'point', point: WESTLANDS, at });
  assert.deepEqual([outsideTicked.inspection, outsideTicked.total], [200, 450], 'ticked: KSh 200');
  // in a market where we have trained shopping agents: covered, so the inspection stays optional
  const market = shopRide.coverage(KASARANI, [{ _id: 'm1', name: 'Kasarani market', lat: KASARANI.lat + 0.002, lng: KASARANI.lng }]);
  assert.deepEqual([market.covered, market.zone, market.name], [true, 'market', 'Kasarani market']);
  const atMarket = shopRide.quote({ from: KASARANI, weightKg: 2, inspect: false, mode: 'point', point: WESTLANDS, at, coverage: market });
  assert.deepEqual([atMarket.inspection, atMarket.total, atMarket.verifyRequired], [0, 250, false]);
});

test('above 5 kg: base + KSh 20 per extra kg, times traffic and urgency (rounded to KSh 10)', () => {
  const calm = shopRide.deliveryFee({ fromCbd: true, weightKg: 10, at: KE('2026-11-18T11:00:00Z') });
  assert.deepEqual([calm.fee, calm.extraKg, calm.traffic, calm.heavy], [250, 5, 'normal', true]); // 150 + 5×20
  const rush = shopRide.deliveryFee({ fromCbd: true, weightKg: 10, at: KE('2026-11-18T08:00:00Z') });
  assert.equal(rush.fee, 330); // 250 × 1.3 = 325 → 330
  const urgent = shopRide.deliveryFee({ fromCbd: false, weightKg: 5.2, urgency: 'express', at: KE('2026-11-18T08:00:00Z') });
  assert.deepEqual([urgent.extraKg, urgent.fee, urgent.multiplier], [1, 530, 1.95]); // (250 + 20) × 1.3 × 1.5 = 526.5
  assert.equal(shopRide.deliveryFee({ fromCbd: true, weightKg: 10, urgency: 'whenever', at: KE('2026-11-18T11:00:00Z') }).fee, 250, 'unknown urgency = standard');
});

test('door delivery, Bolt Send style: base + per km + per minute from the area’s pickup point, with a minimum', () => {
  const near = shopRide.doorFare(WESTLANDS, { lat: -1.2620, lng: 36.8030 }, KE('2026-11-18T11:00:00Z'));
  assert.equal(near.fare, 150, 'the minimum');
  const far = shopRide.doorFare(WESTLANDS, { lat: -1.2300, lng: 36.7800 }, KE('2026-11-18T11:00:00Z'));
  const rush = shopRide.doorFare(WESTLANDS, { lat: -1.2300, lng: 36.7800 }, KE('2026-11-18T08:00:00Z'));
  assert.ok(far.km > 4 && far.fare > 150, JSON.stringify(far));
  assert.ok(rush.minutes > far.minutes && rush.fare > far.fare, 'slower in traffic, so dearer');
  assert.equal(far.fare % 10, 0);
  const total = shopRide.quote({ from: CBD_SHOP, weightKg: 1, inspect: true, mode: 'door', point: WESTLANDS, to: { lat: -1.2300, lng: 36.7800 }, at: KE('2026-11-18T11:00:00Z') });
  assert.equal(total.total, 200 + 150 + far.fare);
});

test('repackaging: free unless admins set a fee; admins can change every rate', () => {
  const free = shopRide.quote({ from: CBD_SHOP, weightKg: 1, repack: true, mode: 'point', point: WESTLANDS });
  assert.deepEqual([free.repack, free.repackFree], [0, true]);
  const own = shopRide.rates({ repackFee: 50, inspectFee: 250, door: { min: 200 } });
  assert.deepEqual([own.repackFee, own.inspectFee, own.cbdFee, own.door.min, own.door.base], [50, 250, 150, 200, 100], 'the rest keep their defaults');
  assert.equal(shopRide.quote({ from: CBD_SHOP, weightKg: 1, repack: true, inspect: true, mode: 'point', point: WESTLANDS }, own).total, 250 + 150 + 50);
});

test('what can’t be priced is refused with a reason', () => {
  const reason = (input) => shopRide.quote({ from: CBD_SHOP, weightKg: 1, mode: 'point', point: WESTLANDS, ...input }).reason;
  assert.match(reason({ from: { lat: -0.0917, lng: 34.768 } }), /Nairobi/);
  assert.match(reason({ weightKg: 0 }), /heavy/);
  assert.match(reason({ weightKg: 500 }), /truck/);
  assert.match(reason({ point: null }), /pickup point/);
  assert.match(reason({ mode: 'door' }), /live location/);
  assert.match(reason({ mode: 'door', to: { lat: -0.0917, lng: 34.768 } }), /within Nairobi/);
});

test('the nearest pickup point to the buyer (never the CBD hub when areas exist)', () => {
  const points = [{ _id: 'h', name: 'Hub', area: 'CBD', lat: -1.2841, lng: 36.8233, hub: true }, WESTLANDS, { _id: 'k', name: 'Kasarani point', area: 'Kasarani', ...KASARANI }];
  assert.equal(shopRide.nearestPoint(points, { lat: -1.2240, lng: 36.8900 })._id, 'k');
  assert.equal(shopRide.nearestPoint(points, { lat: -1.2845, lng: 36.8230 })._id, 'w', 'standing at the hub: the nearest area point');
  assert.equal(shopRide.nearestPoint([points[0]], KASARANI)._id, 'h', 'only the hub: the hub');
  assert.equal(shopRide.nearestPoint([], KASARANI), null);
});

test('wholesaler / importer trade: only what fits the kinds, each once, real categories and countries', () => {
  const { tradeFrom, withTradeCategories, normalizeTrade, publicTrade } = sellerProfile;
  const trade = tradeFrom({ wholesale: ['beverages', 'beverages', 'bogus'], imports: ['electronics'], importFrom: ['cn', 'CN', 'XX', 3] }, ['wholesaler', 'importer']);
  assert.deepEqual([trade.wholesale, trade.imports, trade.importFrom], [['beverages'], ['electronics'], ['CN']]);
  assert.deepEqual(tradeFrom({ wholesale: ['beverages'], imports: ['electronics'], importFrom: ['CN'] }, ['shop']), {}, 'a retailer has no trade');
  assert.throws(() => tradeFrom({}, ['wholesaler']), /sell wholesale/);
  assert.throws(() => tradeFrom({ imports: ['electronics'] }, ['importer']), /countries/);
  assert.deepEqual(tradeFrom({}, ['importer'], { required: false }), {});
  assert.deepEqual(withTradeCategories(['samaki', 'beverages'], trade), ['samaki', 'beverages', 'electronics']);
  assert.throws(() => withTradeCategories(['a', 'b', 'c', 'd', 'e', 'f'], trade), /Up to 6/);
  // the model's last check: kinds changed → the trade follows; its categories are in sellerCategories
  const doc = { sellerTypes: ['importer'], sellerCategories: ['samaki'], trade: { wholesale: ['beverages'], imports: ['furniture', 'furniture'], importFrom: ['GB', 'GB'] } };
  normalizeTrade(doc);
  assert.deepEqual([doc.trade.wholesale, doc.trade.imports, doc.trade.importFrom, doc.sellerCategories], [undefined, ['furniture'], ['GB'], ['samaki', 'furniture']]);
  const none = { sellerTypes: ['shop'], sellerCategories: ['samaki'], trade: { imports: ['furniture'], importFrom: ['GB'] } };
  normalizeTrade(none);
  assert.equal(none.trade, undefined);
  assert.deepEqual(publicTrade({ imports: ['electronics'], importFrom: ['AE'] }).importFrom, [{ code: 'AE', name: 'United Arab Emirates (Dubai)', flag: '🇦🇪' }]);
  assert.equal(publicTrade(null), null);
});

test('importers of vehicles say which models, importers of spare parts which kinds of parts', () => {
  const { tradeFrom, normalizeTrade, publicTrade } = sellerProfile;
  const base = { importFrom: ['JP'] };
  assert.throws(() => tradeFrom({ ...base, imports: ['vehicles'] }, ['importer']), /vehicle makes and models/);
  assert.throws(() => tradeFrom({ ...base, imports: ['spare-parts'] }, ['importer']), /types of spare parts/);
  const trade = tradeFrom({ ...base, imports: ['vehicles', 'spare-parts'], vehicles: ['Toyota/Vitz', 'Toyota/Vitz', 'Nissan/*', 'Toyota/Bogus', 'Nope/*', 'Toyota/Vitz/x'], spares: ['Brakes', 'Brakes', 'Flux capacitor'] }, ['importer']);
  assert.deepEqual([trade.vehicles, trade.spares], [['Toyota/Vitz', 'Nissan/*'], ['Brakes']]);
  // models and parts only stay while vehicles / spare parts are imported
  assert.deepEqual(Object.keys(tradeFrom({ ...base, imports: ['electronics'], vehicles: ['Toyota/Vitz'], spares: ['Brakes'] }, ['importer'])).sort(), ['importFrom', 'imports', 'updatedAt']);
  const doc = { sellerTypes: ['importer'], sellerCategories: [], trade: { imports: ['electronics'], importFrom: ['JP'], vehicles: ['Toyota/Vitz'] } };
  normalizeTrade(doc);
  assert.equal(doc.trade.vehicles, undefined);
  assert.deepEqual(publicTrade(trade).vehicles.map((vehicle) => vehicle.name), ['Toyota Vitz', 'All Nissan models']);
});

test('real photos: each demo ad / product gets a sensible Unsplash search (Kenyan names understood, no word clashes)', () => {
  const { termFor } = require('../utils/unsplashPhotos');
  const cases = [
    [{ title: 'Sukuma wiki, fresh kifungu', category: 'fresh-produce' }, 'kale leaves'],
    [{ title: 'Omena (dagaa), dry', category: 'samaki' }, 'small dried fish'],
    [{ title: 'Sufurias (set of 7), carton of 6 sets', category: 'utensils' }, 'cooking pots'],
    [{ title: 'Toyota Axio 2016 hybrid, low mileage', category: 'vehicles' }, 'toyota car'],
    [{ title: 'Toyota Hiace 2015 matatu, 14 seater', category: 'vehicles' }, 'minibus'],
    [{ title: '1/8 acre plot in Kitengela, ready title', category: 'land-property' }, 'green farmland'],
    [{ title: 'Mtumba jackets and coats', category: 'clothes-shoes' }, 'jacket'],
    [{ title: 'Kids bicycle 16" with training wheels', category: 'bicycles' }, 'bicycle'],
    [{ title: 'Milk Chocolate 100g' }, 'sweets snacks'],
    [{ title: 'Kenya AA coffee beans 1kg' }, 'coffee beans'],
    [{ title: 'Something unusual', category: 'electronics', sub: 'gadgets' }, 'electronics'],
  ];
  for (const [input, term] of cases) assert.equal(termFor(input), term, input.title);
});

test('free photos: only freely licensed real photos are used (no maps, drawings, non-free licences or odd shapes)', () => {
  const { pick } = require('../utils/freePhotos');
  const page = (title, licence, extra = {}) => ({ pageid: 1, title: `File:${title}`, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/800px-a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:a.jpg', mime: 'image/jpeg', width: 4000, height: 3000, extmetadata: { LicenseShortName: { value: licence }, Artist: { value: '<a href="#">Jane <b>Doe</b></a>' } }, ...extra }] });
  const ok = pick(page('Tomatoes at Gikomba market.jpg', 'CC BY-SA 4.0'));
  assert.equal(ok.name, 'Jane Doe', 'the author, without the HTML');
  assert.equal(ok.licence, 'CC BY-SA 4.0');
  assert.ok(pick(page('Sukuma wiki.jpg', 'Public domain')));
  assert.ok(pick(page('Maple syrup.jpg', 'CC0')), '"maple" isn’t "map"');
  assert.equal(pick(page('Map of Nairobi markets.jpg', 'CC BY 4.0')), null, 'not a map');
  assert.equal(pick(page('Coca-Cola logo.png', 'Public domain')), null, 'not a logo');
  assert.equal(pick(page('Tomatoes.jpg', 'All rights reserved')), null, 'free licences only');
  assert.equal(pick(page('Tomatoes.jpg', 'CC BY 4.0', { width: 300, height: 200 })), null, 'big enough');
  assert.equal(pick(page('Tomatoes.jpg', 'CC BY 4.0', { width: 1000, height: 3000 })), null, 'not too tall');
  assert.equal(pick(page('Tomatoes.svg', 'CC BY 4.0', { mime: 'image/svg+xml' })), null, 'photos only');
});

test('free photos: a photo must be about the item (its title names it), best matches first', () => {
  const { pick, relevance } = require('../utils/freePhotos');
  const page = (title) => ({ pageid: 2, title: `File:${title}`, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x.jpg', mime: 'image/jpeg', width: 1600, height: 1200, extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } } }] });
  assert.equal(pick(page('Domino game at Lamu, Kenya.jpg'), 'iphone'), null, 'not an iPhone');
  assert.equal(pick(page('A banana sprout in Western Kenya.jpg'), 'mattress'), null, 'not a mattress');
  assert.ok(pick(page('Macbook Air.jpg'), 'macbook'));
  assert.ok(relevance('Tusker beer bottle with beer glass', 'beer bottles') > relevance('Beer festival', 'beer bottles'), 'more of the item’s words: shown first');
});

test('our shopping agent’s fee starts from KSh 200 (inspection and payment verification), whatever the settings say', () => {
  const { inspectionQuote, AGENT_MIN_FEE } = require('../market/fieldwork');
  assert.equal(AGENT_MIN_FEE, 200);
  const shop = { type: 'Point', coordinates: [36.82, -1.28] };
  assert.equal(inspectionQuote(500, shop).fee, 200, 'cheap items: KSh 200');
  assert.equal(inspectionQuote(100000, shop).fee, 200, 'a flat KSh 200, whatever the order costs');
  assert.equal(require('../market/fieldwork').INSPECTION_FEE, 200);
  const site = require('../config/site').site();
  const saved = site.fieldwork.inspectMin;
  site.fieldwork.inspectMin = 20; // even if someone set it lower
  try { assert.equal(inspectionQuote(500, shop).fee, 200); } finally { site.fieldwork.inspectMin = saved; }
});

// ---------------------------------------------------------------- 🔍 the inspection choice: "Inspect my goods" / "Don't inspect"
test('inspection choice: only “Inspect my goods” adds the fixed KSh 200; “Don’t inspect” or no choice adds nothing', () => {
  const { readChoice, inspectionFee, CHOICES } = require('../market/inspectionChoice');
  assert.deepEqual(CHOICES, ['inspect', 'none']);
  assert.deepEqual(readChoice({ choice: 'inspect' }), { inspect: true, choice: 'inspect', explicit: true });
  assert.deepEqual(readChoice({ choice: 'none' }), { inspect: false, choice: 'none', explicit: true });
  assert.equal(inspectionFee('inspect'), 200);
  assert.equal(inspectionFee('none'), 0, '“Don’t inspect”: no fee');
  // no choice (an older app, or nothing sent): never charged by default
  for (const input of [undefined, null, {}, { notes: 'size 42' }]) assert.equal(readChoice(input).choice, 'none', JSON.stringify(input));
  // older apps: only a real boolean true asks for an inspection
  assert.equal(readChoice({ wanted: true }).choice, 'inspect');
  for (const wanted of ['true', 1, 'yes', 'on', false]) assert.equal(readChoice({ wanted }).choice, 'none', `wanted: ${JSON.stringify(wanted)}`);
});

test('inspection choice: anything ambiguous or tampered is refused, and the fee can never come from the request', () => {
  const { readChoice, inspectionFee } = require('../market/inspectionChoice');
  const refused = (input) => assert.throws(() => readChoice(input), (error) => error.status === 400, JSON.stringify(input));
  for (const choice of ['INSPECT', 'Inspect', 'yes', 'no', '', ' inspect', true, 1, null, ['inspect'], { $ne: 'none' }]) refused({ choice });
  refused({ choice: 'none', wanted: true }); // “Don’t inspect” and “inspect” at once
  refused('inspect');
  refused(['inspect']);
  refused(true);
  // a fee in the request is ignored: the choice decides, and the amount is the server's constant
  const tampered = readChoice({ choice: 'none', fee: 200, amount: 200 });
  assert.equal(inspectionFee(tampered.choice), 0);
  const cheap = readChoice({ choice: 'inspect', fee: 1 });
  assert.equal(inspectionFee(cheap.choice), 200);
  assert.equal(inspectionFee('__proto__'), 0);
  assert.equal(inspectionFee(undefined), 0);
});

test('inspection choice: an order saved with “Don’t inspect” can never carry an inspection fee (model check)', async () => {
  const Order = require('../models/Order');
  const errorsOf = (fields) => new Order(fields).validate().then(() => ({}), (error) => error.errors || {});
  const fine = await errorsOf({ inspectionChoice: 'none', total: 1500 });
  assert.ok(!fine['inspection.fee'], '“Don’t inspect” without a fee is fine');
  assert.match((await errorsOf({ inspectionChoice: 'none', inspection: { fee: 200, status: 'waiting' } }))['inspection.fee']?.message || '', /Inspect my goods/);
  assert.ok((await errorsOf({ inspectionChoice: 'none', inspection: { status: 'waiting' } }))['inspection.fee'], 'not even a free one');
  assert.ok(!(await errorsOf({ inspectionChoice: 'inspect', inspection: { fee: 200, status: 'waiting' } }))['inspection.fee'], '“Inspect my goods”: KSh 200');
  assert.ok((await errorsOf({ inspectionChoice: 'inspect', inspection: { fee: 50, status: 'waiting' } }))['inspection.fee'], 'never a different amount');
  assert.ok((await errorsOf({ inspectionChoice: 'maybe' })).inspectionChoice, 'only the two choices are stored');
  assert.ok(!(await errorsOf({ inspection: { fee: 150, status: 'passed' } }))['inspection.fee'], 'orders from before the two buttons are left as they were');
});

// ---------------------------------------------------------------- 🚀 speed: image CDN settings
test('image CDN: only an https address; the resize template must have {w} and {url} or {path}', () => {
  const site = require('../config/site');
  const saved = [process.env.IMAGE_CDN_URL, process.env.IMAGE_CDN_RESIZE, process.env.IMAGE_CDN];
  try {
    // the free fallback (wsrv.nl) is switched off here, so a rejected address means "no CDN" (tested on its own below)
    process.env.IMAGE_CDN = 'off';
    process.env.IMAGE_CDN_URL = 'https://cdn.kapu.example/';
    process.env.IMAGE_CDN_RESIZE = '{url}?width={w}';
    assert.deepEqual(site.site().imageCdn, { url: 'https://cdn.kapu.example', resize: '{url}?width={w}' });
    assert.deepEqual(site.publicSite().imageCdn, { url: 'https://cdn.kapu.example', resize: '{url}?width={w}' }, 'the app gets it');
    process.env.IMAGE_CDN_RESIZE = 'https://cdn.kapu.example/cdn-cgi/image/width={w},format=auto{path}';
    assert.equal(site.site().imageCdn.resize, 'https://cdn.kapu.example/cdn-cgi/image/width={w},format=auto{path}');
    for (const bad of ['javascript:{w}{url}', '{url}', 'https://evil.example/{w}']) {
      process.env.IMAGE_CDN_RESIZE = bad;
      assert.equal(site.site().imageCdn.resize, undefined, `a bad resize template is ignored: ${bad}`);
    }
    for (const bad of ['http://cdn.kapu.example', 'javascript:alert(1)', 'https://cdn.kapu.example/"><script>', '']) {
      process.env.IMAGE_CDN_URL = bad;
      assert.equal(site.site().imageCdn, null, `not a safe https address: ${bad}`);
    }
  } finally {
    [process.env.IMAGE_CDN_URL, process.env.IMAGE_CDN_RESIZE, process.env.IMAGE_CDN] = [saved[0] || '', saved[1] || '', saved[2] || ''];
  }
});

test('image CDN without one of your own: wsrv.nl for a public https site; never for localhost, private addresses or http', () => {
  const site = require('../config/site');
  const saved = ['IMAGE_CDN_URL', 'IMAGE_CDN', 'PUBLIC_API_URL', 'SHOP_URL', 'SITE_URL'].map((name) => [name, process.env[name]]);
  try {
    Object.assign(process.env, { IMAGE_CDN_URL: '', IMAGE_CDN: '', SHOP_URL: '', SITE_URL: '' });
    process.env.PUBLIC_API_URL = 'https://kapu.co.ke/some/path';
    assert.deepEqual(site.site().imageCdn, { proxy: 'wsrv', origin: 'https://kapu.co.ke' }, 'only the origin: wsrv adds the photo’s path');
    assert.deepEqual(site.publicSite().imageCdn, { proxy: 'wsrv', origin: 'https://kapu.co.ke' }, 'the app gets it');
    for (const notPublic of ['http://kapu.co.ke', 'https://localhost:5000', 'https://127.0.0.1', 'https://192.168.1.20', 'https://10.0.0.5', 'https://172.20.1.1', 'https://shop.local', 'not an address']) {
      process.env.PUBLIC_API_URL = notPublic;
      assert.equal(site.site().imageCdn, null, `wsrv.nl can’t (or mustn’t) fetch from ${notPublic}`);
    }
    process.env.PUBLIC_API_URL = 'https://kapu.co.ke';
    process.env.IMAGE_CDN = 'off';
    assert.equal(site.site().imageCdn, null, 'IMAGE_CDN=off switches it off');
    process.env.IMAGE_CDN = '';
    process.env.IMAGE_CDN_URL = 'https://cdn.kapu.example';
    assert.deepEqual(site.site().imageCdn, { url: 'https://cdn.kapu.example' }, 'your own CDN comes first');
  } finally {
    for (const [name, value] of saved) process.env[name] = value || '';
  }
});
