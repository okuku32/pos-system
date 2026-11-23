// Unit tests (no database, no internet):
//   1. an item page's ready-made first screen (server/market/firstScreen.js): the photo address is exactly the app's
//      (so the phone downloads it once), the server's copies of the app's values haven't drifted, and nothing in an ad
//      (title, category) can inject HTML into the page
//   2. routes along the actual roads (server/market/osmRoute.js), against a stand-in for the OpenStreetMap router
// Run: cd server && node --test tests/firstscreen-road.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { itemFirstScreen, photoAddress, photoSizeChoices, GALLERY_PHOTO, PHOTOLESS_TINTS } = require('../market/firstScreen');
const osmRoute = require('../market/osmRoute');

const CLIENT_SOURCE = path.join(__dirname, '..', '..', 'client', 'src', 'market');
const readClientFile = (fileName) => fs.readFileSync(path.join(CLIENT_SOURCE, fileName), 'utf8');
const sampleListing = (overrides = {}) => ({ title: 'Apple iPhone 11', category: 'electronics', sub: 'phones', price: 45000, images: ['/uploads/listings/abc123.jpg'], ...overrides });

// ---------------------------------------------------------------- 1. the item's first screen

test('photo address: our own server without a CDN, wsrv.nl when the site is public, your own CDN with resizing', () => {
  const photoPath = '/uploads/listings/abc123.jpg';
  assert.equal(photoAddress(photoPath, 1080, null), photoPath, 'no CDN: the same relative address the app uses');
  assert.equal(
    photoAddress(photoPath, 720, { proxy: 'wsrv', origin: 'https://kapu.co.ke' }),
    'https://wsrv.nl/?url=https%3A%2F%2Fkapu.co.ke%2Fuploads%2Flistings%2Fabc123.jpg&w=720&output=webp&q=78&we&il',
  );
  const ownCdn = { url: 'https://cdn.kapu.co.ke', resize: 'https://cdn.kapu.co.ke/cdn-cgi/image/width={w}{path}' };
  assert.equal(photoAddress(photoPath, 480, ownCdn), 'https://cdn.kapu.co.ke/cdn-cgi/image/width=480/uploads/listings/abc123.jpg');
  assert.equal(photoAddress(photoPath, 480, { url: 'https://cdn.kapu.co.ke' }), 'https://cdn.kapu.co.ke/uploads/listings/abc123.jpg', 'a CDN that can’t resize: the original');
  assert.equal(photoAddress('https://images.example.com/x.jpg', 480, ownCdn), 'https://images.example.com/x.jpg', 'full addresses are left alone');
  assert.equal(photoAddress('', 480, null), '');
});

test('size choices (srcset): only when the CDN can resize, one address per width', () => {
  assert.equal(photoSizeChoices('/uploads/listings/a.jpg', null), undefined);
  assert.equal(photoSizeChoices('/uploads/listings/a.jpg', { url: 'https://cdn.kapu.co.ke' }), undefined);
  const choices = photoSizeChoices('/uploads/listings/a.jpg', { proxy: 'wsrv', origin: 'https://kapu.co.ke' });
  assert.deepEqual(choices.split(', ').map((choice) => choice.split(' ').pop()), ['320w', '480w', '720w', '1080w']);
});

test('the server’s copies of the app’s values match the app (otherwise the photo would download twice)', () => {
  const marketApi = readClientFile('marketApi.js');
  const listingPage = readClientFile('ListingPage.jsx');

  // the gallery's <AdImage …> in ListingPage.jsx asks for the same width and `sizes` as the first screen
  const galleryTag = listingPage.match(/<AdImage[^>]*className="mk-gallery-main"/)?.[0] || '';
  assert.match(galleryTag, new RegExp(`photoWidth=\\{${GALLERY_PHOTO.width}\\}`), 'gallery photo width');
  assert.ok(galleryTag.includes(`sizes="${GALLERY_PHOTO.sizes}"`), 'gallery `sizes`');

  // imgSrcSet's default widths
  const appWidths = marketApi.match(/export const imgSrcSet = \(url, widths = \[([\d, ]+)\]\)/)?.[1];
  assert.equal(appWidths, GALLERY_PHOTO.sizeChoices.join(', '));

  // the wsrv.nl address: the app's template, filled in, equals ours
  const appTemplate = marketApi.match(/const viaWsrv = \(cdn, url, width\) => `([^`]+)`/)?.[1];
  assert.ok(appTemplate, 'viaWsrv found in marketApi.js');
  const filledIn = appTemplate
    .replace('${encodeURIComponent(cdn.origin + url)}', encodeURIComponent('https://kapu.co.ke/uploads/a.jpg'))
    .replace('${Math.round(width || 1280)}', '1080');
  assert.equal(filledIn, photoAddress('/uploads/a.jpg', 1080, { proxy: 'wsrv', origin: 'https://kapu.co.ke' }));

  // the photo-less colours: TINTS in marketApi.js, read as data (the text between the braces, parsed as JSON)
  const tintsText = marketApi.match(/const TINTS = \{([\s\S]*?)\n\};/)?.[1];
  // JavaScript object text → JSON: wrap in braces first (so the first key also follows a "{"), single → double quotes,
  // quote the bare keys (vehicles: → "vehicles":), and drop a trailing comma
  const appTints = JSON.parse(`{${tintsText}}`.replace(/'/g, '"').replace(/([{,]\s*)([a-z][\w-]*)\s*:/gi, '$1"$2":').replace(/,\s*}$/, '}'));
  assert.deepEqual(appTints, PHOTOLESS_TINTS);
});

test('first screen: the photo first in line (high priority), the trail, title and price', () => {
  const html = itemFirstScreen(sampleListing(), { imageCdn: null, categoryName: 'Electronics', subName: 'Mobile phones', priceText: 'KSh 45,000' });
  assert.match(html, /<img class="bi-photo" src="\/uploads\/listings\/abc123\.jpg"[^>]*fetchpriority="high"/);
  assert.ok(!html.includes('srcset'), 'no size choices without a resizing CDN');
  assert.ok(html.includes('Home › Electronics › Mobile phones › Apple iPhone 11'));
  assert.ok(html.includes('<p class="bi-price">KSh 45,000</p>'));
  assert.match(html, /^<div class="boot-item" aria-hidden="true">/);
});

test('first screen without a photo: the category’s emoji on its colours', () => {
  const html = itemFirstScreen(sampleListing({ images: [], category: 'clothes-shoes' }), { priceText: 'KSh 800' });
  assert.ok(html.includes('linear-gradient(135deg, #fdeef6, #f8d2e6)'));
  assert.match(html, /<div class="bi-photo bi-nophoto"[^>]*><span>[^<]+<\/span><\/div>/);
  const unknownCategory = itemFirstScreen(sampleListing({ images: [], category: 'no-such-category' }), { priceText: '' });
  assert.ok(unknownCategory.includes('#f2f0ed'), 'unknown category: the neutral colours');
});

test('security: an ad’s title, category names and photo address can’t inject HTML or scripts', () => {
  const attack = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
  const html = itemFirstScreen(
    sampleListing({ title: attack, images: [`/uploads/listings/a.jpg"><script>alert(3)</script>`] }),
    { categoryName: attack, subName: '<b>x</b>', priceText: '<i>KSh</i>' },
  );
  assert.ok(!/<script/i.test(html), 'no script tag gets through');
  assert.ok(!/<img src=x/i.test(html), 'no injected image');
  assert.ok(!html.includes('<b>x</b>') && !html.includes('<i>KSh</i>'));
  assert.ok(html.includes('&lt;script&gt;'), 'shown as text instead');
  // the only tags are the ones we write
  const tags = [...html.matchAll(/<([a-z]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(tags)].sort(), ['div', 'img', 'p']);
});

test('the HTML page keeps a "$" in an ad’s title exactly (not read as a text-replace pattern)', () => {
  // seo.js puts the first screen into the page with String.replace and a function, so "$&", "$1"… stay literal
  const template = '<div class="boot-spin"></div>';
  const firstScreen = itemFirstScreen(sampleListing({ title: 'Price $& more $1' }), { priceText: '' });
  const page = template.replace('<div class="boot-spin"></div>', () => `<div class="boot-spin"></div>${firstScreen}`);
  assert.ok(page.includes('Price $&amp; more $1'));
});

// ---------------------------------------------------------------- 2. routes along the actual roads

// a stand-in for the OSRM router: records each request; answers with a road that has `pointCount` points
function fakeRouter({ pointCount = 50, fail = false, answer } = {}) {
  const requests = [];
  const handler = async (url, options) => {
    requests.push({ url: String(url), userAgent: options?.headers?.['User-Agent'] || '' });
    if (fail) throw new Error('connect ETIMEDOUT');
    const body = answer || {
      code: 'Ok',
      routes: [{
        distance: 11437, // metres
        legs: [{ distance: 4120 }, { distance: 7317 }],
        geometry: { coordinates: Array.from({ length: pointCount }, (_, index) => [36.80 + index * 0.0005, -1.28 - index * 0.0003]) }, // [lng, lat]
      }],
    };
    return { ok: true, status: 200, json: async () => body };
  };
  return { requests, handler };
}
const NAIROBI_STOPS = [{ lat: -1.2864, lng: 36.8172 }, { lat: -1.2921, lng: 36.8219 }, { lat: -1.3032, lng: 36.8473 }];

test('road route: km per leg, minutes at city speed, the line as [lat, lng], our app named in the request', async () => {
  const router = fakeRouter();
  osmRoute.configure({ fetch: router.handler });
  const road = await osmRoute.roadRoute(NAIROBI_STOPS, 'motorbike');
  assert.equal(road.km, 11.4);
  assert.deepEqual(road.legs.map((leg) => leg.km), [4.1, 7.3]);
  // motorbike in town: 24 km/h → 4.1 km ≈ 10 min, 7.3 km ≈ 18 min
  assert.deepEqual(road.legs.map((leg) => leg.minutes), [10, 18]);
  assert.equal(road.minutes, 28);
  assert.deepEqual(road.line[0], [-1.28, 36.8], 'OSRM gives [lng, lat]; we give [lat, lng]');
  assert.equal(router.requests.length, 1);
  assert.match(router.requests[0].url, /\/route\/v1\/driving\/36\.817200,-1\.286400;36\.821900,-1\.292100;36\.847300,-1\.303200\?overview=full&geometries=geojson/);
  assert.match(router.requests[0].userAgent, /^KapuMarketplace\/1\.0/);
});

test('road route: asked once, then from the cache; a car is slower in town; walking slower still', async () => {
  const router = fakeRouter();
  osmRoute.configure({ fetch: router.handler });
  const motorbike = await osmRoute.roadRoute(NAIROBI_STOPS, 'motorbike');
  const car = await osmRoute.roadRoute(NAIROBI_STOPS, 'car');
  const walk = await osmRoute.roadRoute(NAIROBI_STOPS, 'walk');
  assert.equal(router.requests.length, 1, 'the same road, different speeds: one request');
  assert.ok(motorbike.minutes < car.minutes && car.minutes < walk.minutes);
});

test('road route: a long road is thinned to at most 400 points, keeping both ends', async () => {
  osmRoute.configure({ fetch: fakeRouter({ pointCount: 5000 }).handler });
  const road = await osmRoute.roadRoute(NAIROBI_STOPS.slice(0, 2));
  assert.equal(road.line.length, 400);
  assert.deepEqual(road.line[0], [-1.28, 36.8]);
  assert.deepEqual(road.line[399], [Math.round((-1.28 - 4999 * 0.0003) * 1e5) / 1e5, Math.round((36.80 + 4999 * 0.0005) * 1e5) / 1e5]);
});

test('road route: refuses bad input without asking the router (outside Kenya, too few/many stops, not numbers)', async () => {
  const router = fakeRouter();
  osmRoute.configure({ fetch: router.handler });
  assert.equal(await osmRoute.roadRoute([{ lat: 51.5, lng: -0.12 }, NAIROBI_STOPS[0]]), null, 'London');
  assert.equal(await osmRoute.roadRoute([NAIROBI_STOPS[0]]), null, 'one stop');
  assert.equal(await osmRoute.roadRoute(Array(7).fill(NAIROBI_STOPS[0])), null, 'seven stops');
  assert.equal(await osmRoute.roadRoute([{ lat: 'x', lng: 36.8 }, NAIROBI_STOPS[0]]), null, 'not a number');
  assert.equal(await osmRoute.roadRoute('-1.28,36.81;-1.29,36.82'), null, 'not a list');
  assert.equal(router.requests.length, 0);
});

test('road route: when the router is down or finds no road, null (the app draws a straight line); a failure is retried later', async () => {
  const down = fakeRouter({ fail: true });
  osmRoute.configure({ fetch: down.handler });
  assert.equal(await osmRoute.roadRoute(NAIROBI_STOPS), null);
  assert.equal(await osmRoute.roadRoute(NAIROBI_STOPS), null);
  assert.equal(down.requests.length, 2, 'failures aren’t cached');

  const noRoad = fakeRouter({ answer: { code: 'NoRoute', routes: [] } });
  osmRoute.configure({ fetch: noRoad.handler });
  assert.equal(await osmRoute.roadRoute(NAIROBI_STOPS), null);
  assert.equal(await osmRoute.roadRoute(NAIROBI_STOPS), null);
  assert.equal(noRoad.requests.length, 1, '"no road here" is remembered (cached)');
});
