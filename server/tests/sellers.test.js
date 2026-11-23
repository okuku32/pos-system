// Seller sign-up (kind, categories, location are required) and seller contacts on "near me" pages:   cd server && npm run test:sellers
// Real server on a throw-away database. Google's ID-token check is a stand-in ("google:<email>:<sub>").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const PORT = 5195;
const BASE = `http://127.0.0.1:${PORT}`;
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
Object.assign(process.env, {
  MONGO_URI: 'mongodb://127.0.0.1:27017/kapu_sellers_test', PORT: String(PORT), NODE_ENV: 'test', SERVE_CLIENT: 'false', SMTP_HOST: '', REDIS_URL: '',
  MPESA_CONSUMER_KEY: '', ANTHROPIC_API_KEY: '', JWT_SECRET: process.env.JWT_SECRET || 'q'.repeat(48), AUTH_RATE_LIMIT: '400',
});
const mongoose = require('mongoose');
const oauth = require('../utils/oauth');
oauth.verifyGoogleCredential = async (credential) => {
  const [kind, email, sub] = String(credential).split(':');
  if (kind !== 'google') throw Object.assign(new Error('Google sign-in failed'), { status: 401 });
  return { googleId: sub, email, name: 'Google Seller', avatar: '' };
};

const PASS = 'Kenya-Market-2026';
let ip = 0;
const api = async (method, url, body, who) => {
  const res = await fetch(BASE + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': who?.ip || `10.40.0.${(ip = (ip % 250) + 1)}`, ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
let Customer;
let Listing;
const NAIROBI = { lat: -1.2864, lng: 36.8219 };
const PAY = { payDetails: { method: 'till', till: '512345', name: 'Test Shop' } };
const PROFILE = { ...PAY, sellerTypes: ['wholesaler'], sellerCategories: ['cooking-products'], trade: { wholesale: ['cooking-products'] }, location: { county: 'Nairobi', area: 'Gikomba', lat: NAIROBI.lat, lng: NAIROBI.lng } };
const ok201 = (res) => assert.equal(res.status, 201, JSON.stringify(res.json));
const signUp = (data) => api('POST', '/customers/register', { name: 'Seller Tester', password: PASS, confirmPassword: PASS, accountType: 'seller', ...PAY, ...data });
async function loginAs(email) {
  await Customer.updateOne({ email }, { $set: { emailVerified: true } });
  const res = await api('POST', '/customers/login', { login: email, password: PASS });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  ip += 1;
  return { token: res.json.token, id: res.json.customer._id, me: res.json.customer, ip: `10.41.${ip}.1` };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  require('../server');
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && mongoose.connection.readyState === 1) break; } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  Customer = require('../models/Customer');
  Listing = require('../models/Listing');
  await Customer.syncIndexes();
});
after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
});

// ---------------------------------------------------------------- sign-up
test('a new seller must say what kind of seller, what they sell and where (each one checked)', async () => {
  const base = { email: 'missing@sellers.test', phone: '0711500001' };
  const cases = [
    [{}, /kind of seller/],
    [{ sellerTypes: ['astronaut'] }, /kind of seller/],
    [{ ...PROFILE, payDetails: undefined }, /how you get paid/],
    [{ ...PROFILE, payDetails: { method: 'till', till: '12' } }, /Till number/],
    [{ ...PROFILE, payDetails: { method: 'paybill', paybill: '247247' } }, /account number/],
    [{ ...PROFILE, payDetails: { method: 'cheque' } }, /how buyers pay you/i],
    [{ sellerTypes: ['wholesaler'] }, /sell wholesale/],
    [{ sellerTypes: ['wholesaler'], trade: { wholesale: ['not-a-category'] } }, /sell wholesale/],
    [{ sellerTypes: ['importer'] }, /categories of goods you import/],
    [{ sellerTypes: ['importer'], trade: { imports: ['electronics'] } }, /countries you import from/],
    [{ sellerTypes: ['importer'], trade: { imports: ['electronics'], importFrom: ['XX', 'Atlantis', 42] } }, /countries you import from/],
    [{ sellerTypes: ['shop'] }, /category/],
    [{ sellerTypes: ['shop'], sellerCategories: ['not-a-category'] }, /category/],
    [{ sellerTypes: ['wholesaler'], trade: { wholesale: ['cooking-products'] } }, /county/],
    [{ sellerTypes: ['wholesaler'], trade: { wholesale: ['cooking-products'] }, location: { county: 'Atlantis', area: 'X town' } }, /county/],
    [{ sellerTypes: ['wholesaler'], trade: { wholesale: ['cooking-products'] }, location: { county: 'Nairobi', area: ' ' } }, /town or area/],
  ];
  for (const [extra, message] of cases) {
    const res = await signUp({ ...base, ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.match(res.json.message, message);
  }
  assert.equal(await Customer.countDocuments({ email: base.email }), 0, 'nothing saved');
  // buyers don't need any of it
  assert.equal((await api('POST', '/customers/register', { name: 'Buyer Tester', email: 'buyer@sellers.test', phone: '0711500002', password: PASS, confirmPassword: PASS })).status, 201);
});

test('a complete seller sign-up is saved: kinds, categories, county/area, and the shop pin (on the “near me” pages)', async () => {
  const res = await signUp({ email: 'wholesaler@sellers.test', phone: '0711500010', name: 'Gikomba Wholesalers', ...PROFILE, sellerTypes: ['wholesaler', 'importer', 'wholesaler'], trade: { wholesale: ['cooking-products'], imports: ['beverages'], importFrom: ['AE'] }, sellerCategories: ['cooking-products', 'beverages', 'bogus'], sellerItems: ['beverages/sodas', 'beverages/juices', 'electronics/phones', 'beverages/nope'] });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const saved = await Customer.findOne({ email: 'wholesaler@sellers.test' }).lean();
  assert.deepEqual(saved.sellerTypes, ['wholesaler', 'importer']);
  assert.deepEqual(saved.sellerCategories, ['cooking-products', 'beverages'], 'unknown categories dropped');
  const realBeverages = require('../market/categories').getCategory('beverages').subs.map((sub) => sub.slug);
  assert.deepEqual(saved.sellerItems, ['beverages/sodas', 'beverages/juices'].filter((item) => realBeverages.includes(item.split('/')[1])), 'the types picked in the pop-up (real ones, of chosen categories)');
  assert.equal(saved.county, 'Nairobi');
  assert.deepEqual([saved.shopLocation.area, saved.shopLocation.county, saved.shopLocation.public, saved.shopLocation.kinds], ['Gikomba', 'Nairobi', true, ['wholesaler', 'importer']]);
  assert.deepEqual(saved.shopLocation.point.coordinates, [NAIROBI.lng, NAIROBI.lat]);
  const me = await loginAs('wholesaler@sellers.test');
  assert.deepEqual([me.me.accountType, me.me.sellerCategories, me.me.sellerArea], ['seller', ['cooking-products', 'beverages'], 'Gikomba']);

  // retailer and market stall are kinds too; no pin: area and county kept, not on the map
  const retailer = await signUp({ email: 'retailer@sellers.test', phone: '0711500011', sellerTypes: ['shop', 'market-stall'], sellerCategories: ['fresh-produce'], location: { county: 'Kisumu', area: 'Kibuye market' } });
  assert.equal(retailer.status, 201);
  const shop = await Customer.findOne({ email: 'retailer@sellers.test' }).lean();
  assert.deepEqual([shop.sellerTypes, shop.shopLocation.area, shop.shopLocation.point, shop.shopLocation.public], [['shop', 'market-stall'], 'Kibuye market', undefined, false]);
  // a pin outside Kenya is ignored (the rest is kept)
  await signUp({ email: 'abroad@sellers.test', phone: '0711500012', ...PROFILE, location: { county: 'Nairobi', area: 'CBD', lat: 51.5, lng: -0.12 } });
  assert.equal((await Customer.findOne({ email: 'abroad@sellers.test' }).lean()).shopLocation.point, undefined);
});

test('a role can’t be smuggled in, and the profile fields are size-limited', async () => {
  const res = await signUp({ email: 'sneaky@sellers.test', phone: '0711500013', ...PROFILE, role: 'admin', worker: { role: 'rider', status: 'approved' }, location: { ...PROFILE.location, area: 'A'.repeat(500) } });
  assert.equal(res.status, 201);
  const saved = await Customer.findOne({ email: 'sneaky@sellers.test' }).lean();
  assert.equal(saved.role, undefined);
  assert.equal(saved.worker?.role, undefined);
  assert.ok(saved.shopLocation.area.length <= 60);
});

test('Google sign-up as a seller needs the same details; logging in later with Google doesn’t', async () => {
  const bare = await api('POST', '/customers/oauth/google', { credential: 'google:g.seller@sellers.test:g-1', accountType: 'seller' });
  assert.equal(bare.status, 400);
  assert.match(bare.json.message, /kind of seller/);
  assert.equal(await Customer.countDocuments({ email: 'g.seller@sellers.test' }), 0);
  const full = await api('POST', '/customers/oauth/google', { credential: 'google:g.seller@sellers.test:g-1', accountType: 'seller', ...PROFILE });
  assert.equal(full.status, 201, JSON.stringify(full.json));
  assert.deepEqual(full.json.customer.sellerCategories, ['cooking-products']);
  const again = await api('POST', '/customers/oauth/google', { credential: 'google:g.seller@sellers.test:g-1', accountType: 'seller' });
  assert.equal(again.status, 200, 'an existing account just logs in');
});

test('a seller can change what they sell later (My account)', async () => {
  const me = await loginAs('retailer@sellers.test');
  const res = await api('PUT', '/customers/me', { sellerTypes: ['mama-mboga', 'samaki'], sellerCategories: ['fresh-produce', 'samaki', 'nope'], sellerItems: ['samaki/fresh-omena', 'samaki/lake-fish'] }, me);
  assert.equal(res.status, 200);
  assert.deepEqual([res.json.sellerTypes, res.json.sellerCategories, res.json.sellerItems], [['mama-mboga', 'samaki'], ['fresh-produce', 'samaki'], ['samaki/fresh-omena', 'samaki/lake-fish']]);
  const dropped = await api('PUT', '/customers/me', { sellerCategories: ['fresh-produce'] }, me);
  assert.deepEqual(dropped.json.sellerItems, [], 'dropping a category drops its types');
});

// ---------------------------------------------------------------- contacts
let wholesaler;
let chatOnly;
test('“Wholesalers near me” lists a seller who said they’re a wholesaler, with contacts available (no number in the list)', async () => {
  wholesaler = await loginAs('wholesaler@sellers.test');
  await Listing.create({ title: 'Unga wa ngano 2kg bale', slug: 'unga-bale-test', category: 'cooking-products', sub: 'flour', county: 'Nairobi', price: 1800, seller: wholesaler.id, sellerName: 'Gikomba Wholesalers', status: 'active', images: [] });
  await signUp({ email: 'chatonly@sellers.test', phone: '0711500020', ...PROFILE, location: { ...PROFILE.location, lat: NAIROBI.lat + 0.002 } });
  chatOnly = await loginAs('chatonly@sellers.test');
  await Listing.create({ title: 'Rice 25kg bag wholesale', slug: 'rice-bag-test', category: 'cooking-products', sub: 'rice', county: 'Nairobi', price: 3500, seller: chatOnly.id, sellerName: 'Chat Only', status: 'active', showPhone: false, images: [] });

  const near = await api('GET', `/market/sellers-near?near=${NAIROBI.lat},${NAIROBI.lng}&km=5&type=wholesale`);
  assert.equal(near.status, 200, JSON.stringify(near.json));
  const ids = near.json.sellers.map((seller) => String(seller._id));
  assert.ok(ids.includes(wholesaler.id) && ids.includes(chatOnly.id), 'declared wholesalers are listed even without bulk-priced ads yet');
  const w = near.json.sellers.find((seller) => String(seller._id) === wholesaler.id);
  const c = near.json.sellers.find((seller) => String(seller._id) === chatOnly.id);
  assert.deepEqual([w.contact, c.contact], [true, false]);
  assert.ok(!JSON.stringify(near.json).includes('254711500010'), 'no phone numbers in the list itself');
  // every kind of "near me" page carries the same contact flag
  const all = await api('GET', `/market/sellers-near?near=${NAIROBI.lat},${NAIROBI.lng}&km=5`);
  assert.ok(all.json.sellers.every((seller) => typeof seller.contact === 'boolean'));
  const page = await api('GET', `/market/sellers/${wholesaler.id}`);
  assert.equal(page.json.seller.contact, true, 'the seller page too');
});

test('contacts: logged-in only; Call and WhatsApp links; chat-only sellers and non-sellers refused', async () => {
  assert.equal((await api('GET', `/market/sellers/${wholesaler.id}/contact`)).status, 401, 'log in first');
  const buyer = await loginAs('buyer@sellers.test');
  const res = await api('GET', `/market/sellers/${wholesaler.id}/contact`, undefined, buyer);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([res.json.phone, res.json.display, res.json.call], ['254711500010', '0711 500 010', 'tel:+254711500010']);
  assert.match(res.json.whatsapp, /^https:\/\/wa\.me\/254711500010\?text=Hello%20Gikomba%20Wholesalers/);
  const chat = await api('GET', `/market/sellers/${chatOnly.id}/contact`, undefined, buyer);
  assert.equal(chat.status, 403);
  assert.match(chat.json.message, /chat/);
  assert.equal((await api('GET', `/market/sellers/${buyer.id}/contact`, undefined, buyer)).status, 404, 'not a seller (no ads)');
  assert.equal((await api('GET', '/market/sellers/not-an-id/contact', undefined, buyer)).status, 404);
});

test('signed out, no seller number anywhere: contact and ad-phone need an account, public pages carry none, nothing is cached', async () => {
  const ad = await Listing.findOne({ slug: 'unga-bale-test' }).lean();
  const number = '254711500010';
  // signed out: both ways to get the number are refused
  for (const url of [`/market/sellers/${wholesaler.id}/contact`, `/market/listings/${ad._id}/phone`]) {
    const res = await fetch(`${BASE}/api${url}`, { headers: { 'X-Forwarded-For': `10.42.0.${(ip = (ip % 250) + 1)}` } });
    assert.equal(res.status, 401, url);
    assert.match(res.headers.get('cache-control') || '', /no-store/, `${url}: never cached`);
    assert.ok(!(await res.text()).includes(number));
  }
  // public pages: the ad, the seller's page, near-me lists, search: no number
  for (const url of [`/market/listings/${ad.slug}`, `/market/sellers/${wholesaler.id}`, `/market/sellers-near?near=${NAIROBI.lat},${NAIROBI.lng}&km=5`, '/market/listings?q=unga']) {
    const res = await api('GET', url);
    assert.equal(res.status, 200, `${url} ${JSON.stringify(res.json)}`);
    assert.ok(!JSON.stringify(res.json).includes(number) && !JSON.stringify(res.json).includes('0711500010'), `${url} has no phone number`);
  }
  // signed in: the ad's number, also never cached
  const buyer = await loginAs('buyer@sellers.test');
  const res = await fetch(`${BASE}/api/market/listings/${ad._id}/phone`, { headers: { Authorization: `Bearer ${buyer.token}`, 'X-Forwarded-For': buyer.ip } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).phone, number);
  assert.match(res.headers.get('cache-control') || '', /private, no-store/);
});

test('contacts are rate-limited (no scraping every seller’s number)', async () => {
  const buyer = await loginAs('buyer@sellers.test');
  const scraper = { ...buyer, ip: '10.99.99.99' };
  let limited = 0;
  for (let i = 0; i < 65; i++) if ((await api('GET', `/market/sellers/${wholesaler.id}/contact`, undefined, scraper)).status === 429) limited += 1;
  assert.ok(limited >= 4, `limited ${limited} of 65`);
});

// ---------------------------------------------------------------- wholesalers & importers: what they deal in, and from where
const IMPORTER = { ...PAY, sellerTypes: ['importer', 'wholesaler'], sellerCategories: ['fresh-produce'], location: { county: 'Nairobi', area: 'Eastleigh', lat: NAIROBI.lat + 0.004, lng: NAIROBI.lng } };
test('an importer’s categories and countries are saved once each, and tied to what they sell', async () => {
  const res = await signUp({ email: 'importer@sellers.test', phone: '0711500030', name: 'Eastleigh Imports', ...IMPORTER, trade: { wholesale: ['beverages', 'beverages', 'bogus'], imports: ['electronics', 'electronics'], importFrom: ['cn', 'CN', ' AE ', 'XX', 'AE', 7] } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const saved = await Customer.findOne({ email: 'importer@sellers.test' }).lean();
  assert.deepEqual([saved.trade.wholesale, saved.trade.imports, saved.trade.importFrom], [['beverages'], ['electronics'], ['CN', 'AE']], 'no duplicates, unknown values dropped, codes in capitals');
  assert.deepEqual(saved.sellerCategories, ['fresh-produce', 'beverages', 'electronics'], 'what they wholesale / import is also what they sell (once)');
  const me = await loginAs('importer@sellers.test');
  assert.deepEqual(me.me.trade, { wholesale: ['beverages'], imports: ['electronics'], importFrom: ['CN', 'AE'], vehicles: [], spares: [] });

  // one account per email / phone: joining again with the same phone is refused, nothing doubled
  const twice = await signUp({ email: 'importer2@sellers.test', phone: '0711500030', ...IMPORTER, trade: { wholesale: ['beverages'], imports: ['electronics'], importFrom: ['CN'] } });
  assert.equal(twice.status, 409);
  assert.equal(await Customer.countDocuments({ phone: '254711500030' }), 1);

  // too many categories in all (what they sell + wholesale + import) is refused
  const six = require('../market/categories').CATEGORIES.map((category) => category.slug).filter((slug) => !['electronics', 'other'].includes(slug)).slice(0, 6);
  const many = await signUp({ email: 'many@sellers.test', phone: '0711500031', ...IMPORTER, sellerCategories: six, trade: { wholesale: [six[0]], imports: ['electronics'], importFrom: ['CN'] } });
  assert.equal(many.status, 400);
  assert.match(many.json.message, /Up to 6 categories/);
  // a buyer can't carry a trade; a retailer's trade fields are ignored
  await api('POST', '/customers/register', { name: 'Buyer Two', email: 'buyer2@sellers.test', phone: '0711500032', password: PASS, confirmPassword: PASS, trade: { wholesale: ['beverages'] } });
  assert.equal((await Customer.findOne({ email: 'buyer2@sellers.test' }).lean()).trade, undefined);
  await signUp({ email: 'retail2@sellers.test', phone: '0711500033', sellerTypes: ['shop'], sellerCategories: ['fresh-produce'], location: { county: 'Nairobi', area: 'Kangemi' }, trade: { imports: ['electronics'], importFrom: ['CN'] } });
  const retail = await Customer.findOne({ email: 'retail2@sellers.test' }).lean();
  assert.deepEqual([retail.trade, retail.sellerCategories], [undefined, ['fresh-produce']]);
});

test('Google sign-up as an importer asks the same; the trade is saved', async () => {
  const bare = await api('POST', '/customers/oauth/google', { credential: 'google:g.importer@sellers.test:g-2', accountType: 'seller', ...IMPORTER, location: { county: 'Mombasa', area: 'Mombasa CBD' }, trade: { wholesale: ['beverages'], imports: ['vehicles'], vehicles: ['Toyota/Vitz'] } });
  assert.equal(bare.status, 400);
  assert.match(bare.json.message, /countries/);
  // vehicles: the makes and models are asked too
  const noModels = await api('POST', '/customers/oauth/google', { credential: 'google:g.importer@sellers.test:g-2', accountType: 'seller', ...IMPORTER, location: { county: 'Mombasa', area: 'Mombasa CBD' }, trade: { wholesale: ['beverages'], imports: ['vehicles'], importFrom: ['JP', 'GB'] } });
  assert.equal(noModels.status, 400);
  assert.match(noModels.json.message, /makes and models/);
  const full = await api('POST', '/customers/oauth/google', { credential: 'google:g.importer@sellers.test:g-2', accountType: 'seller', ...IMPORTER, location: { county: 'Mombasa', area: 'Mombasa CBD' }, trade: { wholesale: ['beverages'], imports: ['vehicles'], importFrom: ['JP', 'GB'], vehicles: ['Toyota/Vitz', 'Nissan/*', 'Bogus/X'] } });
  assert.equal(full.status, 201, JSON.stringify(full.json));
  assert.deepEqual(full.json.customer.trade, { wholesale: ['beverages'], imports: ['vehicles'], importFrom: ['JP', 'GB'], vehicles: ['Toyota/Vitz', 'Nissan/*'], spares: [] });
});

test('changing kinds later keeps the trade consistent (My account, and any other save)', async () => {
  const me = await loginAs('importer@sellers.test');
  // no longer an importer: the imports and countries go, the wholesale stays
  const dropped = await api('PUT', '/customers/me', { sellerTypes: ['wholesaler'] }, me);
  assert.equal(dropped.status, 200, JSON.stringify(dropped.json));
  assert.deepEqual(dropped.json.trade, { wholesale: ['beverages'], imports: [], importFrom: [], vehicles: [], spares: [] });
  // sent but incomplete: refused, nothing changed
  const empty = await api('PUT', '/customers/me', { trade: { wholesale: [] } }, me);
  assert.equal(empty.status, 400);
  assert.match(empty.json.message, /sell wholesale/);
  // an importer again, with new countries
  const back = await api('PUT', '/customers/me', { sellerTypes: ['wholesaler', 'importer'], trade: { wholesale: ['beverages'], imports: ['electronics', 'furniture'], importFrom: ['CN', 'TR', 'CN'] } }, me);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual(back.json.trade, { wholesale: ['beverages'], imports: ['electronics', 'furniture'], importFrom: ['CN', 'TR'], vehicles: [], spares: [] });
  assert.ok(back.json.sellerCategories.includes('furniture'), 'a new import category joins what they sell');
  // the model's own check: whatever writes it, a trade that doesn't fit is cleaned before saving
  const doc = await Customer.findOne({ email: 'importer@sellers.test' });
  doc.sellerTypes = ['importer'];
  doc.trade = { wholesale: ['beverages'], imports: ['furniture', 'furniture', 'bogus'], importFrom: ['GB', 'GB', 'ZZ'] };
  await doc.save();
  const clean = await Customer.findOne({ email: 'importer@sellers.test' }).lean();
  assert.deepEqual([clean.trade.wholesale, clean.trade.imports, clean.trade.importFrom], [undefined, ['furniture'], ['GB']]);
  // back to how the next test expects it
  await api('PUT', '/customers/me', { sellerTypes: ['importer', 'wholesaler'], trade: { wholesale: ['beverages'], imports: ['electronics'], importFrom: ['CN', 'AE'] } }, me);
});

test('buyers find importers by country and by what they import; the seller page and the Importers page show it', async () => {
  const me = await loginAs('importer@sellers.test');
  await Listing.create({ title: 'Fresh sukuma wiki bunches', slug: 'sukuma-imp-test', category: 'fresh-produce', sub: 'vegetables', county: 'Nairobi', price: 50, seller: me.id, sellerName: 'Eastleigh Imports', status: 'active', images: [] });
  const near = (extra) => api('GET', `/market/sellers-near?near=${NAIROBI.lat},${NAIROBI.lng}&km=5&type=importer${extra}`);
  const listed = async (extra) => (await near(extra)).json.sellers.map((seller) => String(seller._id));
  assert.ok((await listed('&trade=electronics')).includes(me.id), 'said they import electronics: listed under electronics importers (even before posting any)');
  assert.ok(!(await listed('&trade=vehicles')).includes(me.id), 'not under car importers');
  assert.ok((await listed('&from=CN')).includes(me.id), 'importers from China');
  assert.ok((await listed('&from=cn')).includes(me.id), 'code in any case');
  assert.ok(!(await listed('&from=JP')).includes(me.id), 'not from Japan');
  const card = (await near('&from=CN')).json.sellers.find((seller) => String(seller._id) === me.id);
  assert.deepEqual(card.importFrom.map((country) => country.code), ['CN', 'AE']);
  assert.ok(card.trades.includes('electronics'));
  // the seller page: what they wholesale / import, with flags
  const page = await api('GET', `/market/sellers/${me.id}`);
  assert.deepEqual(page.json.seller.trade.importFrom.map((country) => `${country.flag} ${country.name}`), ['🇨🇳 China', '🇦🇪 United Arab Emirates (Dubai)']);
  assert.deepEqual([page.json.seller.trade.imports[0].slug, page.json.seller.trade.wholesale[0].slug], ['electronics', 'beverages']);
  assert.ok(!JSON.stringify(page.json).includes('updatedAt"'), 'nothing internal');
  // the Importers page: their imported ads, plus the countries they said
  await Listing.create({ title: 'Infinix Hot 40 phone from China', slug: 'infinix-imp-test', category: 'electronics', sub: 'phones', county: 'Nairobi', price: 15000, origin: 'china', seller: me.id, sellerName: 'Eastleigh Imports', status: 'active', images: [] });
  const importers = await api('GET', '/market/importers?origin=china');
  const row = importers.json.sellers.find((seller) => String(seller._id) === me.id);
  assert.deepEqual(row.importFrom.map((country) => country.code), ['CN', 'AE']);
  // the list of countries comes with the categories (for the sign-up pop-up)
  const cats = await api('GET', '/market/categories');
  assert.ok(cats.json.importCountries.some((country) => country.code === 'CN' && country.flag === '🇨🇳'));
});

test('the first time someone starts selling, they are asked once: importer or wholesaler? The answer is saved and the shop says so', async () => {
  ok201(await signUp({ email: 'asked@sellers.test', phone: '0711500040', sellerTypes: ['shop'], sellerCategories: ['fresh-produce'], location: { county: 'Nairobi', area: 'Gikomba', lat: NAIROBI.lat, lng: NAIROBI.lng } }));
  const me = await loginAs('asked@sellers.test');
  assert.equal(me.me.tradeAsked, false, 'not asked yet');
  assert.deepEqual((await api('GET', '/market/mine?count=1', undefined, me)).json, { count: 0 }, 'never posted an ad: selling for the first time');
  // becomes an importer from the pop-up
  const saved = await api('PUT', '/customers/me', { sellerTypes: ['importer', 'shop'], sellerCategories: ['fresh-produce', 'electronics'], trade: { wholesale: [], imports: ['electronics'], importFrom: ['CN'] }, tradeAsked: true }, me);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual([saved.json.tradeAsked, saved.json.trade.imports, saved.json.trade.importFrom], [true, ['electronics'], ['CN']]);
  let doc = await Customer.findOne({ email: 'asked@sellers.test' }).lean();
  assert.ok(doc.tradeAskedAt instanceof Date);
  assert.ok(doc.shopLocation.kinds.includes('importer'), 'the shop is listed as an importer');
  // later: no longer an importer, the shop follows
  await api('PUT', '/customers/me', { sellerTypes: ['shop'] }, me);
  doc = await Customer.findOne({ email: 'asked@sellers.test' }).lean();
  assert.ok(!doc.shopLocation.kinds.includes('importer'));
  assert.equal(doc.trade, undefined);
  // "Neither": just the answer
  ok201(await signUp({ email: 'neither@sellers.test', phone: '0711500041', sellerTypes: ['shop'], sellerCategories: ['fresh-produce'], location: { county: 'Nairobi', area: 'Kangemi' } }));
  const other = await loginAs('neither@sellers.test');
  const answer = await api('PUT', '/customers/me', { tradeAsked: true }, other);
  assert.deepEqual([answer.status, answer.json.tradeAsked, answer.json.sellerTypes], [200, true, ['shop']]);
});

// ---------------------------------------------------------------- a market's shopping agents
test('shopping agents belong to a market: "Find a shopping agent here" lists only that market’s approved agents, phones for members only', async () => {
  const Market = require('../models/Market');
  const [gikomba, wakulima] = await Promise.all([Market.findOne({ slug: /^gikomba/ }).lean(), Market.findOne({ slug: /^wakulima-market/ }).lean()]);
  assert.ok(gikomba && wakulima, 'the starter markets are there');
  const agent = (name, phone, market, status = 'approved') => ({ name, email: `${phone}@agents.test`, phone, emailVerified: true, worker: { role: 'agent', status, market: market._id, marketName: market.name, base: market.point, available: true, rating: { avg: 4.8, count: 12 } } });
  await Customer.insertMany([
    agent('Atieno Gikomba', '254700900001', gikomba),
    agent('Kamau Gikomba', '254700900002', gikomba),
    agent('Pending Gikomba', '254700900003', gikomba, 'pending'),
    agent('Wanjiru Wakulima', '254700900004', wakulima),
  ]);
  const anon = await api('GET', `/market/markets/${gikomba.slug}/agents`);
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.json.agents.map((item) => item.name).sort(), ['Atieno Gikomba', 'Kamau Gikomba'], 'only this market’s approved agents');
  assert.ok(anon.json.agents.every((item) => !item.phone), 'no phone numbers before logging in');
  assert.equal(anon.json.signedIn, false);
  ok201(await signUp({ email: 'agentfinder@sellers.test', phone: '0711500060', sellerTypes: ['shop'], sellerCategories: ['fresh-produce'], location: { county: 'Nairobi', area: 'Gikomba' } }));
  const member = await loginAs('agentfinder@sellers.test');
  const signedIn = await api('GET', `/market/markets/${gikomba.slug}/agents`, undefined, member);
  assert.deepEqual(signedIn.json.agents.map((item) => item.phone).sort(), ['254700900001', '254700900002'], 'members see their numbers');
  const other = await api('GET', `/market/markets/${wakulima.slug}/agents`, undefined, member);
  assert.deepEqual(other.json.agents.map((item) => item.name), ['Wanjiru Wakulima']);
  assert.equal((await api('GET', '/market/markets/no-such-market/agents')).status, 404);
});
