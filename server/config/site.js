// Marketplace settings in one place: what admins edit (SiteSettings in the database) on top of server/.env.
// site() is synchronous (cached in memory); call loadSite() once at start-up and after an admin edits settings.
// M-Pesa callback addresses end in a secret key (security/callbackKey.js), so fake "paid" results are ignored
function withKey(url) {
  if (!url) return url;
  const key = require('../security/callbackKey').callbackKey();
  const text = String(url).replace(/\/+$/, '');
  const match = text.match(/^(.*\/api\/mpesa\/(?:callback|b2c\/result|b2c\/timeout))(?:\/.*)?$/);
  return match ? `${match[1]}/${key}` : `${text}/${key}`;
}
const SiteSettings = require('../models/SiteSettings');

const DEFAULTS = {
  name: 'Kapu',
  tagline: 'Sell fast. Buy smart. Pay safe.',
  address: 'Imara Mall, Mombasa Road, Imara Daima, Nairobi',
  phone: '0768507798', // shown on the About & Help pages and the footer (Admin → Settings can change it)
  whatsapp: '',
  email: '',
  hours: [],
  commissionPercent: 5,
  campaign: { active: false },
  // social media pages (Admin → Settings → Social media). Empty = not shown.
  social: {
    tiktok: 'https://www.tiktok.com/@kapu',
    instagram: 'https://www.instagram.com/kapu',
    facebook: 'https://www.facebook.com/kapu',
    x: 'https://x.com/kapu',
    youtube: 'https://www.youtube.com/@kapu',
  },
  fieldwork: {
    // rider fares, like Uber / Bolt: base + per km + per minute of the trip, never below the minimum fare
    riderEnabled: true, riderBase: 100, riderPerKm: 30, riderPerMin: 2, riderMin: 150, riderMaxKm: 40, riderSharePercent: 90,
    inspectEnabled: true, inspectPercent: 2, inspectMin: 200, // our agent's fee starts from KSh 200 (see AGENT_MIN_FEE) inspectMax: 500, agentSharePercent: 80,
    // our agent inspects AND delivers: free within inspectFreeKm for parcels under inspectFreeKg, otherwise
    // inspectBaseFee for the first inspectBaseKm, then the rider rate per km
    inspectFreeKm: 1, inspectFreeKg: 5, inspectBaseFee: 100, inspectBaseKm: 2,
    // what Kapu keeps from every agent fee (commission + tax = 15%), and how long after a job the agent is paid
    commissionPercent: 10, taxPercent: 5, payoutDelayMin: 30,
    // split payments (several sellers, each paid directly): what the buyer pays us per seller for our agent to verify
    // the payment and inspect the goods; it's added to that order's inspection fee (the agent's job)
    directFee: 200, // our agent verifies the payment (and checks the item): from KSh 200
  },
};

let saved = {};

async function loadSite() {
  const doc = await SiteSettings.findOne({ key: 'site' }).lean();
  saved = doc || {};
  return site();
}

async function updateSite(changes) {
  const doc = await SiteSettings.findOneAndUpdate({ key: 'site' }, { $set: changes }, { upsert: true, returnDocument: 'after', runValidators: true }).lean();
  saved = doc;
  return site();
}

const pick = (key) => (saved[key] !== undefined && saved[key] !== null && saved[key] !== '' ? saved[key] : DEFAULTS[key]);
const env = (key, fallback = '') => process.env[key] || fallback;

// only an https address, without a trailing slash; the resize template must keep {w} and {url} / {path}
function imageCdnFrom(url, resize) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(base)) return null;
  const template = String(resize || '').trim();
  const okResize = /\{w\}/.test(template) && /\{(url|path)\}/.test(template) && /^(https:\/\/|\{url\})/.test(template);
  return { url: base, ...(okResize ? { resize: template } : {}) };
}

// no CDN of your own: wsrv.nl (free, open source, on Cloudflare: resized WebP photos from servers near the buyer), when
// the photos are on a public https address it can fetch them from. Never for localhost / private addresses.
function freeImageCdn(choice, publicUrl) {
  if (String(choice || '').toLowerCase() === 'off') return null;
  let origin;
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.endsWith('.local')) return null;
    origin = url.origin;
  } catch {
    return null;
  }
  return { proxy: 'wsrv', origin };
}

// an https tile address with {z}, {x} and {y} (and optionally {s} / {r}); the credit line is plain text
function mapTilesFrom(url, credit) {
  const template = String(url || '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(template) || !['{z}', '{x}', '{y}'].every((part) => template.includes(part))) return null;
  return { url: template, attribution: String(credit || '').replace(/[<>]/g, '').trim().slice(0, 200) || '© OpenStreetMap contributors' };
}

function site() {
  const publicApi = env('PUBLIC_API_URL').replace(/\/$/, '');
  return {
    name: pick('name'),
    tagline: pick('tagline'),
    social: { ...DEFAULTS.social, ...(saved.social || {}) },
    address: pick('address'),
    phone: pick('phone'),
    whatsapp: String(pick('whatsapp') || '').replace(/\D/g, ''),
    email: pick('email'),
    hours: pick('hours') || [],
    commissionPercent: Number(pick('commissionPercent')),
    mapsKey: saved.mapsKey || env('GOOGLE_MAPS_API_KEY'),
    // photos through a CDN (a "pull zone" whose origin is this server): IMAGE_CDN_URL=https://cdn.example.com
    // and, when the CDN can resize, IMAGE_CDN_RESIZE with {url} (the CDN address of the photo) or {path}, and {w}:
    //   Cloudflare: https://cdn.example.com/cdn-cgi/image/width={w},format=auto,quality=78{path}
    //   Bunny / ImageKit and most others: {url}?width={w}
    imageCdn: imageCdnFrom(env('IMAGE_CDN_URL'), env('IMAGE_CDN_RESIZE')) || freeImageCdn(env('IMAGE_CDN'), env('PUBLIC_API_URL') || env('SHOP_URL', env('SITE_URL', ''))),
    // the maps' images (Leaflet): OpenStreetMap's own unless a provider is set, e.g. MapTiler / Stadia / Carto:
    //   MAP_TILE_URL=https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=…  MAP_TILE_ATTRIBUTION=© MapTiler © OpenStreetMap contributors
    mapTiles: mapTilesFrom(env('MAP_TILE_URL'), env('MAP_TILE_ATTRIBUTION')),
    campaign: saved.campaign || DEFAULTS.campaign,
    courier: saved.courier?.companies?.length ? { ...require('../market/courier').DEFAULTS, ...saved.courier } : require('../market/courier').DEFAULTS,
    fieldwork: { ...DEFAULTS.fieldwork, ...Object.fromEntries(Object.entries(saved.fieldwork || {}).filter(([, value]) => value !== undefined && value !== null)) },
    // M-Pesa is connected when its keys are in .env; until then an admin may switch on demo payments for testing
    mpesaReady: !!(env('MPESA_CONSUMER_KEY') && env('MPESA_CONSUMER_SECRET') && env('MPESA_SHORTCODE')),
    demoPayments: !!saved.demoPayments && !(env('MPESA_CONSUMER_KEY') && env('MPESA_CONSUMER_SECRET') && env('MPESA_SHORTCODE')),
    url: env('SHOP_URL', env('SITE_URL', 'http://localhost:5173')).replace(/\/$/, ''),
    mpesa: {
      env: env('MPESA_ENV', 'sandbox'),
      consumerKey: env('MPESA_CONSUMER_KEY'),
      consumerSecret: env('MPESA_CONSUMER_SECRET'),
      shortcode: env('MPESA_SHORTCODE'),
      passkey: env('MPESA_PASSKEY'),
      transactionType: env('MPESA_TRANSACTION_TYPE', 'CustomerPayBillOnline'),
      callbackUrl: withKey(publicApi ? `${publicApi}/api/mpesa/callback` : env('MPESA_CALLBACK_URL')),
      // paying riders & agents (B2C): from Safaricom when you apply for a B2C shortcode
      b2cShortcode: env('MPESA_B2C_SHORTCODE', env('MPESA_SHORTCODE')),
      initiatorName: env('MPESA_INITIATOR_NAME'),
      securityCredential: env('MPESA_SECURITY_CREDENTIAL'),
      b2cResultUrl: withKey(publicApi ? `${publicApi}/api/mpesa/b2c/result` : env('MPESA_B2C_RESULT_URL')),
      b2cTimeoutUrl: withKey(publicApi ? `${publicApi}/api/mpesa/b2c/timeout` : env('MPESA_B2C_TIMEOUT_URL')),
    },
  };
}

// What the browser may know (no secrets)
const publicSite = () => {
  const settings = site();
  return { name: settings.name, tagline: settings.tagline, social: settings.social, address: settings.address, phone: settings.phone, whatsapp: settings.whatsapp, email: settings.email, hours: settings.hours, commissionPercent: settings.commissionPercent, mapsKey: settings.mapsKey || '', imageCdn: settings.imageCdn, mapTiles: settings.mapTiles, campaign: settings.campaign?.active ? settings.campaign : null, fieldwork: settings.fieldwork, courier: settings.courier, trades: { wholesale: require('../market/trades').publicTrades('wholesale'), importer: require('../market/trades').publicTrades('importer') }, mpesaReady: settings.mpesaReady, demoPayments: settings.demoPayments };
};

module.exports = { site, publicSite, loadSite, updateSite, DEFAULTS };
