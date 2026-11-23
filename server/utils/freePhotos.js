// Real, freely licensed photos from Wikimedia Commons for demo ads and products that have no photo (or only a drawn
// placeholder). No key needed: Commons' public API (https://commons.wikimedia.org/w/api.php).
//   • only free licences: public domain, CC0, CC BY, CC BY-SA (they allow use with credit)
//   • only real photos (JPEG/PNG, big enough, not maps / logos / drawings / diagrams)
//   • shown from Wikimedia's servers (thumbnails, 800 px wide), as Commons allows
//   • every photo is credited on the ad's page: "Photo: <author> (<licence>) via Wikimedia Commons", with links
// Searches: "<item> Kenya" first (local photos), then just "<item>". Results are cached (uploads/free-photos-cache.json).
//   npm run photos:free -- --dry      which search each ad / product gets (no requests)
//   npm run photos:free                fill ads without photos, then the old shop's products with drawn pictures
//   npm run photos:free -- --remove   take these photos off again
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { termFor } = require('./unsplashPhotos');

const API = 'https://commons.wikimedia.org/w/api.php';
const AGENT = 'KapuDemoPhotos/1.0 (marketplace demo images; node fetch)'; // Wikimedia asks every script to name itself
const CACHE = path.join(__dirname, '..', 'uploads', 'free-photos-cache-v2.json'); // v2: relevance-checked
const PER_TERM = 4; // different photos for ads that share a search
const SOURCE = 'Wikimedia Commons';
const FREE = /^(cc0|public domain|pd\b|pd-|cc[- ]by(-sa)?[- ]\d(\.\d)?)/i;
const NOT_A_PHOTO = /\b(map|logo|diagram|drawing|icon|flag|coat of arms|chart|graph|illustration|sketch|stamp|poster|cover|signature|svg|clipart|cartoon|screenshot|plan|scheme|symbol|emblem|label|advert|manuscript|engraving|lithograph|herbarium|specimen|x-ray|microscope)s?\b/i;
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

async function search(query) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '40',
    prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '800', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT } });
    if (res.status === 429 || res.status >= 500) { // busy: wait as long as Wikimedia asks (or longer each time)
      const wait = Math.max(Number(res.headers.get('retry-after')) * 1000 || 0, 5000 * 2 ** attempt);
      console.log(`  Wikimedia asked us to slow down: waiting ${Math.round(wait / 1000)} s…`);
      await pause(Math.min(wait, 120000));
      continue;
    }
    if (!res.ok) throw new Error(`Wikimedia Commons ${res.status}`);
    const data = await res.json();
    return (data.query?.pages || []).sort((first, second) => (first.index || 0) - (second.index || 0));
  }
  throw new Error('Wikimedia Commons is busy: try again in a few minutes');
}

// relevance: the photo's title must name the item ("iphone" → a title with "iPhone"), best matches first.
// Words that say nothing about the item itself don't count.
const STOP = new Set(['fresh', 'market', 'kenya', 'african', 'small', 'whole', 'raw', 'green', 'red', 'big', 'men', 'women', 'products', 'fashion', 'interior', 'exterior', 'leaves', 'snacks', 'set']);
const stem = (word) => word.replace(/ies$/, 'y').replace(/(?<=[^s])es$|(?<=[^s])s$/, '');
const keysOf = (term) => String(term || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !STOP.has(word)).map(stem);
const relevance = (title, term) => {
  const text = String(title).toLowerCase().replace(/[_-]+/g, ' ');
  return keysOf(term).filter((key) => new RegExp(`\\b${key}`).test(text)).length;
};

// a usable photo: free licence, real photo, big enough, not too tall (and, with a term, about that item)
function pick(page, term) {
  const info = page.imageinfo?.[0];
  if (!info?.thumburl || !/^image\/(jpeg|png)$/.test(info.mime || '')) return null;
  if (info.width < 640 || info.height < 400 || info.width / info.height < 0.75 || info.width / info.height > 2.2) return null;
  if (NOT_A_PHOTO.test(page.title)) return null;
  const score = term ? relevance(page.title.replace(/^File:/, ''), term) : 1;
  if (!score) return null;
  const meta = info.extmetadata || {};
  const licence = meta.LicenseShortName?.value || '';
  if (!FREE.test(licence)) return null;
  return {
    id: page.pageid, score, image: info.thumburl, title: page.title.replace(/^File:/, ''), link: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    name: plain(meta.Artist?.value) || plain(meta.Credit?.value) || 'Wikimedia Commons contributor', licence, licenceUrl: meta.LicenseUrl?.value || '',
  };
}

const loadCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } };
const saveCache = (cache) => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
async function photosFor(term, cache) {
  if (cache[term]) return cache[term];
  const found = [];
  // the plain search first (most relevant), then a Kenyan one if that wasn't enough
  for (const query of [term, `${term} Kenya`]) {
    for (const page of await search(query)) {
      const photo = pick(page, term);
      if (photo && !found.some((item) => item.id === photo.id)) found.push(photo);
    }
    await pause(1000); // gentle on a free service: one search a second
    if (found.length >= PER_TERM) break;
  }
  // the best matches first (most of the item's words in the title), keeping Commons' own order otherwise
  cache[term] = found.map((photo, index) => ({ ...photo, index })).sort((first, second) => second.score - first.score || first.index - second.index).slice(0, PER_TERM);
  found.length = 0;
  saveCache(cache);
  return found;
}
const creditOf = (photo, term) => ({ source: SOURCE, name: photo.name, license: photo.licence, licenseUrl: photo.licenceUrl, link: photo.link, profile: photo.link, photoId: String(photo.id), term });

async function main() {
  await connectDB();
  const Listing = require('../models/Listing');
  const Product = require('../models/Product');
  if (has('--remove')) {
    const ads = await Listing.updateMany({ 'photoCredit.source': SOURCE }, { $set: { images: [] }, $unset: { photoCredit: 1 } });
    const products = await Product.updateMany({ 'imageCredit.source': SOURCE }, { $set: { image: '' }, $unset: { imageCredit: 1 } });
    console.log(`Removed the free photos from ${ads.modifiedCount} ads and ${products.modifiedCount} products.`);
    return;
  }
  // ads with no photo, and (to improve them) ads whose photo came from here before
  const ads = !has('--products') ? await Listing.find({ $or: [{ images: { $size: 0 } }, { images: { $exists: false } }, { 'photoCredit.source': SOURCE }] }).select('title category sub photoCredit').lean() : [];
  const products = !has('--listings') ? await Product.find({ key: { $exists: false }, $or: [{ image: '' }, { image: { $exists: false } }, { image: /^\/uploads\/products\// }, { 'imageCredit.source': SOURCE }] }).select('name category sub imageCredit').lean() : [];
  const jobs = [
    ...ads.map((ad) => ({ kind: 'ad', doc: ad, term: termFor(ad) })),
    ...products.map((product) => ({ kind: 'product', doc: product, term: termFor({ title: product.name, category: product.category, sub: product.sub }) })),
  ].filter((job) => job.term);
  const terms = [...new Set(jobs.map((job) => job.term))];
  if (has('--dry')) {
    console.log(`${ads.length} ads + ${products.length} products → ${terms.length} searches on ${SOURCE}.`);
    return;
  }
  const cache = loadCache();
  let done = 0;
  for (const term of terms) {
    await photosFor(term, cache);
    done += 1;
    if (done % 20 === 0) console.log(`  ${done}/${terms.length} searches…`);
  }
  const used = new Map();
  const adOps = [];
  const productOps = [];
  const missing = new Set();
  for (const job of jobs) {
    const photos = cache[job.term] || [];
    if (!photos.length) {
      missing.add(job.term);
      // nothing about this item: back to its placeholder rather than a wrong photo
      if (job.kind === 'ad' && job.doc.photoCredit?.source === SOURCE) adOps.push({ updateOne: { filter: { _id: job.doc._id, 'photoCredit.source': SOURCE }, update: { $set: { images: [] }, $unset: { photoCredit: 1 } } } });
      if (job.kind === 'product' && job.doc.imageCredit?.source === SOURCE) productOps.push({ updateOne: { filter: { _id: job.doc._id }, update: { $set: { image: '' }, $unset: { imageCredit: 1 } } } });
      continue;
    }
    const index = used.get(job.term) || 0;
    used.set(job.term, index + 1);
    const photo = photos[index % photos.length];
    if (job.kind === 'ad') adOps.push({ updateOne: { filter: { _id: job.doc._id, $or: [{ images: { $size: 0 } }, { 'photoCredit.source': SOURCE }] }, update: { $set: { images: [photo.image], photoCredit: creditOf(photo, job.term) } } } });
    else productOps.push({ updateOne: { filter: { _id: job.doc._id }, update: { $set: { image: photo.image, imageCredit: creditOf(photo, job.term) } } } });
  }
  // one write each
  if (adOps.length) await Listing.bulkWrite(adOps, { ordered: false });
  if (productOps.length) await Product.bulkWrite(productOps, { ordered: false });
  // catalogue products take their picture from their ads
  if (adOps.length) await require('../market/catalog').refresh((await Listing.distinct('product', { _id: { $in: adOps.map((op) => op.updateOne.filter._id) }, product: { $exists: true } })).map(String));
  console.log(`Real photos added: ${adOps.length} ads, ${productOps.length} products (${terms.length} searches on ${SOURCE}).`);
  if (missing.size) console.log(`No free photo found for: ${[...missing].join(', ')} (those keep their placeholder).`);
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
module.exports = { pick, relevance };
