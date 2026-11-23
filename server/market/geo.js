// Seller shop locations & "near me" search. Points are GeoJSON [lng, lat] with a 2dsphere index.
const mongoose = require('mongoose');

const EARTH_KM = 6378.1;
const RADII = [1, 2, 5, 10, 25, 50, 100]; // "near me" starts within 1 km

// a GeoJSON point that is only stored when it has coordinates (an empty one would break the index)
const pointSchema = new mongoose.Schema(
  { type: { type: String, enum: ['Point'], required: true }, coordinates: { type: [Number], required: true, default: undefined } },
  { _id: false }
);

// Kenya, with a little room at the borders
const inKenya = (lat, lng) => lat >= -5.2 && lat <= 5.5 && lng >= 33.4 && lng <= 42.4;

function toPoint(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || !inKenya(la, ln)) return null;
  return { type: 'Point', coordinates: [Math.round(ln * 1e6) / 1e6, Math.round(la * 1e6) / 1e6] };
}

// "near=-1.31,36.89&km=10" → { lat, lng, km } or null
function parseNear(params) {
  const [lat, lng] = String(params.near || '').split(',').map(Number);
  if (!toPoint(lat, lng)) return null;
  const km = Math.min(200, Math.max(0.5, Number(params.km) || 10));
  return { lat, lng, km };
}

const within = (location) => ({ $geoWithin: { $centerSphere: [[location.lng, location.lat], location.km / EARTH_KM] } });
const nearest = (location) => ({ $nearSphere: { $geometry: { type: 'Point', coordinates: [location.lng, location.lat] }, $maxDistance: location.km * 1000 } });

function distanceKm(location, point) {
  if (!point?.coordinates) return null;
  const [lng, lat] = point.coordinates;
  const result = (date) => (date * Math.PI) / 180;
  const height = Math.sin(result(lat - location.lat) / 2) ** 2 + Math.cos(result(location.lat)) * Math.cos(result(lat)) * Math.sin(result(lng - location.lng) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(height)) * 10) / 10;
}

// what buyers see of a seller's shop (only when the seller chose to show it)
function publicShop(shop) {
  const shopLocation = shop?.shopLocation;
  if (!shopLocation?.public || !shopLocation.point?.coordinates) return null;
  return {
    name: shopLocation.name || '', address: shopLocation.address || '', area: shopLocation.area || '', county: shopLocation.county || '', lat: shopLocation.point.coordinates[1], lng: shopLocation.point.coordinates[0],
    kinds: shopLocation.kinds || [], wear: shopLocation.wear || [], stall: shopLocation.stall || '',
    market: shopLocation.market && shopLocation.marketSlug ? { _id: shopLocation.market, name: shopLocation.marketName, slug: shopLocation.marketSlug } : null,
    walk: require('./walk').publicWalk(shopLocation.walk),
    hours: require('./hours').publicHours(shopLocation.hours),
    licensedChemist: shop.chemist?.status === 'verified',
  };
}

// an ad is "at the shop" when it's in the same county as the seller's public shop pin
const pinFor = (customer, county) => {
  const shopLocation = customer?.shopLocation;
  return shopLocation?.public && shopLocation.point?.coordinates && shopLocation.county && shopLocation.county === county ? shopLocation.point : null;
};
// put the shop pin on (or take it off) all of a seller's ads
// (ads in the seller's branches keep their branch's pin: market/stores.js syncBranchAds)
async function syncSellerAds(Listing, customer) {
  const shopLocation = customer.shopLocation;
  const branches = await require('../models/Store').find({ seller: customer._id, isMain: false }).distinct('_id');
  const mine = { seller: customer._id, ...(branches.length ? { store: { $nin: branches } } : {}) };
  const pin = shopLocation?.public && shopLocation.point?.coordinates ? shopLocation.point : null;
  if (pin && shopLocation.county) {
    await Listing.updateMany({ ...mine, county: shopLocation.county }, { $set: { geo: pin } });
    await Listing.updateMany({ ...mine, county: { $ne: shopLocation.county } }, { $unset: { geo: 1 } });
  } else await Listing.updateMany(mine, { $unset: { geo: 1 } });
}

module.exports = { pinFor, syncSellerAds, pointSchema, toPoint, parseNear, within, nearest, distanceKm, publicShop, RADII };

// ---------------------------------------------------------------- Google Maps share links → a pin
// Works without an API key: "Share" in the Google Maps app (maps.app.goo.gl/…), a WhatsApp live/current
// location (maps.google.com/?q=lat,lng), or any google.com/maps/... address. Only Google's own hosts are fetched.
const MAP_HOSTS = /^(?:www\.)?(?:google\.(?:com|co\.ke)|maps\.google\.(?:com|co\.ke)|maps\.app\.goo\.gl|goo\.gl)$/i;

function coordsFrom(text) {
  const decodeURIComponentResult = decodeURIComponent(String(text));
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|query|destination|ll|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /\/maps\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/, /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/];
  for (const pat of pats) {
    const match = decodeURIComponentResult.match(pat);
    if (match && toPoint(match[1], match[2])) return { lat: Number(match[1]), lng: Number(match[2]) };
  }
  return null;
}
const placeName = (url) => {
  const match = decodeURIComponent(String(url)).match(/\/maps\/place\/([^/@?]+)/);
  return match ? match[1].replace(/\+/g, ' ').trim().slice(0, 80) : '';
};

async function resolveMapLink(input) {
  const raw = String(input || '').trim().slice(0, 600);
  const direct = /^\s*-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/.test(raw) ? coordsFrom(raw) : null; // "-1.2836, 36.8339" typed or pasted
  if (direct) return { ...direct, name: '' };
  let url;
  try {
    url = new URL(raw.match(/https?:\/\/\S+/)?.[0] || raw);
  } catch {
    return null;
  }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol) || !MAP_HOSTS.test(url.hostname)) return null;
    const found = coordsFrom(url.href);
    if (found) return { ...found, name: placeName(url.href) };
    const response = await fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kapu)' } }).catch(() => null);
    if (!response) return null;
    const next = response.headers.get('location');
    if (next) {
      url = new URL(next, url);
      continue;
    }
    // some pages put the pin in the HTML instead of the address
    const html = (await response.text().catch(() => '')).slice(0, 400000);
    const inPage = coordsFrom((html.match(/https:\/\/www\.google\.com\/maps\/[^"'\s]+/) || [])[0] || '') || (html.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/) && toPoint(RegExp.$1, RegExp.$2) ? { lat: Number(RegExp.$1), lng: Number(RegExp.$2) } : null);
    return inPage ? { ...inPage, name: placeName(url.href) } : null;
  }
  return null;
}

module.exports.resolveMapLink = resolveMapLink;
module.exports.coordsFrom = coordsFrom;
