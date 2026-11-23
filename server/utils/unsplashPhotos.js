// Real photos from Unsplash (free to use, https://unsplash.com/license) for ads and products that have none or that
// only have a drawn placeholder picture. Uses the official Unsplash API and follows its rules:
//   • the photos are shown from Unsplash's own servers (hotlinked: images.unsplash.com), never copied
//   • every photo is credited: "Photo by <name> on Unsplash", with links (see photoCredit / imageCredit)
//   • each photo we start using is reported to Unsplash (its download_location), once
// Set UNSPLASH_ACCESS_KEY in server/.env (free: https://unsplash.com/oauth/applications → New application).
//   npm run photos -- --dry          show which search each ad / product gets (no API calls)
//   npm run photos                   fill ads without photos, then products with a drawn picture or none
//   npm run photos -- --listings     ads only          --products   products only
//   npm run photos -- --remove       take every Unsplash photo off again (back to no photo)
// A free ("demo") Unsplash app may make 50 requests an hour: searches are cached (uploads/unsplash-cache.json) and the
// script stops politely when the hour's limit is reached. Run it again later and it carries on where it stopped.
// Ask Unsplash for "production" access (5,000 an hour) to do it all in one go.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const KEY = String(process.env.UNSPLASH_ACCESS_KEY || '').trim();
const APP = 'kapu'; // utm_source for the credit links (Unsplash asks for it)
const CACHE = path.join(__dirname, '..', 'uploads', 'unsplash-cache.json');
const PER_TERM = 4; // different photos used for ads that share a search (6 tomato sellers ≠ one tomato photo)
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

// ---------------------------------------------------------------- what to search for
// Kenyan names first (sukuma, omena, sufuria…), so the search finds the real thing. First match wins.
const TERMS = [
  // vegetables & fruit
  [/sukuma|\bkales?\b/, 'kale leaves'], [/managu|terere|traditional greens|nightshade|kunde|saga/, 'african leafy vegetables'], [/spinach|mchicha/, 'fresh spinach'],
  [/carrot/, 'fresh carrots'], [/cabbage/, 'cabbage vegetable'], [/tomato paste/, 'tomato paste'], [/tomato/, 'fresh tomatoes market'], [/onion/, 'red onions'],
  [/dhania|garlic|ginger(?! ale)/, 'garlic ginger herbs'], [/sweet potato|arrow ?root|nduma|cassava/, 'sweet potatoes'], [/crisps|potato chips/, 'potato chips snack'], [/potato|waru/, 'potatoes'],
  [/mango juice|pick n peel/, 'mango juice'], [/mango/, 'mangoes'], [/banana bread/, 'banana bread'], [/banana|ndizi|matoke|plantain chips/, 'bananas'], [/avocado/, 'avocado'],
  [/orange juice/, 'orange juice'], [/orange soda|lemon soda|soda crate|\bsoda\b|\bcola\b|coca-cola/, 'soda bottles'], [/orange/, 'oranges fruit'], [/pawpaw|papaya/, 'papaya'],
  [/watermelon/, 'watermelon'], [/passion/, 'passion fruit'], [/pineapple/, 'pineapple'], [/apple juice/, 'apple juice'],
  // cereals, groceries
  [/coffee/, 'coffee beans'], [/baked beans/, 'baked beans'], [/njahi|rosecoco|dry beans|\bbeans\b/, 'dry beans'], [/ndengu|green grams|lentil/, 'lentils legumes'], [/dry maize/, 'dried corn kernels'],
  [/maize flour|wheat flour|\bflour\b/, 'flour bag'], [/pishori|basmati|\brice\b(?! cooker)/, 'rice grains'], [/sugar/, 'sugar'], [/\bsalt\b/, 'salt'],
  [/cooking oil|cooking fat|ghee/, 'cooking oil bottle'], [/pilau masala|masala|turmeric|manjano|cardamom|iliki|cinnamon|mdalasini|pepper/, 'spices'],
  [/spaghetti|macaroni/, 'pasta'], [/\boats\b|corn flakes|granola/, 'breakfast cereal'], [/peanut butter/, 'peanut butter'], [/peanuts|cashew/, 'roasted nuts'],
  [/kienyeji chicks|chicks/, 'baby chicks'], [/egg/, 'eggs tray'], [/kienyeji chicken|chicken/, 'whole chicken'], [/beef|goat meat|\bmeat\b/, 'raw meat butcher'],
  [/ice cream/, 'ice cream'], [/drinking chocolate|malt drink/, 'hot chocolate drink'], [/chocolate|toffee|lollipop|chewing gum|cheese puffs|popcorn/, 'sweets snacks'],
  [/milk|yoghurt|yogurt|cream(?! biscuits)/, 'milk dairy'], [/\bbutter\b(?!.*lotion)|margarine/, 'butter'], [/cheese(?! puffs)/, 'cheese'],
  [/bread|baguette|buns|rolls|croissant/, 'fresh bread bakery'], [/mandazi|doughnut|scone|queen cake|cake/, 'pastries bakery'], [/chapati/, 'chapati flatbread'],
  [/biscuit|cookie|wafer/, 'biscuits cookies'],
  [/tea leaves|black tea|iced tea/, 'tea'],
  [/\bwater\b(?! resistant)|dasani/, 'bottled water'], [/energy drink|ginger ale|tonic/, 'drink cans'], [/squash|juice/, 'fruit juice'],
  // fish
  [/omena|dagaa/, 'small dried fish'], [/tilapia|ngege/, 'tilapia fish'], [/nile perch|mbuta|obambo|mgongo wazi/, 'fish fillet'], [/catfish|mumi/, 'catfish'],
  [/prawn|kamba/, 'prawns'], [/octopus|pweza/, 'octopus'], [/fish/, 'fresh fish market'],
  // drinks
  [/tusker|lager|beer/, 'beer bottles'], [/wine/, 'red wine bottle'], [/whisky|whiskey|johnnie walker/, 'whisky bottle'], [/\bgin\b/, 'gin bottle'],
  // clothes, shoes, accessories
  [/mitumba bale|mtumba bale|\bbale\b/, 'second hand clothes market'], [/jersey/, 'football jersey'], [/jeans|denim|chinos/, 'jeans'], [/sweater|hoodie/, 'sweaters'],
  [/jacket|coat/, 'jacket'], [/t-?shirt|polo/, 't-shirts'], [/suit/, 'men suit'], [/\bkitenge shirt/, 'african print shirt'], [/shirt/, 'men shirts'],
  [/shuka/, 'maasai shuka'], [/lesso|kanga|kikoi/, 'kanga fabric'], [/\bkitenge\b|ankara/, 'african print fabric'], [/dress/, 'dress fashion'], [/blouse/, 'women blouse'], [/skirt/, 'skirt'],
  [/baby clothes/, 'baby clothes'], [/sneaker/, 'sneakers'], [/\bheels?\b/, 'high heels'], [/akala|sandal/, 'sandals'], [/boot/, 'ankle boots'], [/shoe/, 'leather shoes'],
  [/smart ?watch/, 'smart watch'], [/watch/, 'wrist watch'], [/sunglass/, 'sunglasses'], [/necklace|earring|gold plated/, 'gold jewelry'],
  // crafts
  [/mask/, 'african mask'], [/soapstone/, 'soapstone carving'], [/giraffe|elephant family|carving|carved|ebony|olive wood/, 'african wood carving'],
  [/bead/, 'maasai beads'], [/kiondo|basket|woven/, 'woven baskets'], [/painting|canvas|batik|tinga|sand art/, 'african painting'],
  [/quilt|embroider|cushion/, 'handmade textile'], [/journal/, 'leather journal'], [/messenger bag/, 'leather bag'],
  // bags
  [/backpack/, 'backpack'], [/suitcase/, 'suitcase'], [/handbag|tote|\bbag\b(?!s)/, 'handbag'],
  // electronics
  [/solar/, 'solar panel'], [/iphone.*screen|replacement screen/, 'phone repair'], [/iphone/, 'iphone'], [/galaxy|samsung (?!.*tv)/, 'samsung smartphone'], [/tecno|infinix|redmi|xiaomi|smartphone|\bphone(?! covers| chargers)/, 'smartphone'],
  [/macbook/, 'macbook'], [/laptop|elitebook/, 'laptop'], [/\btv\b|television/, 'smart tv'], [/partybox|speaker/, 'bluetooth speaker'],
  [/earbud|earphone/, 'earbuds'], [/power bank/, 'power bank'], [/charger/, 'phone charger'], [/phone covers?|phone case/, 'phone case'], [/playstation|ps5/, 'playstation controller'],
  [/batteries/, 'batteries'],
  // appliances & kitchen
  [/air fryer/, 'air fryer'], [/kettle/, 'electric kettle'], [/rice cooker/, 'rice cooker'], [/fridge|freezer/, 'refrigerator'], [/cooker|oven/, 'kitchen stove'],
  [/microwave/, 'microwave'], [/blender/, 'blender'], [/gas cylinder|k-gas/, 'gas cylinder'], [/deep fryer/, 'commercial kitchen'], [/chafing/, 'buffet catering'],
  [/sufuria|\bpots?\b|cookware/, 'cooking pots'], [/basin/, 'plastic basin'], [/flask|thermos/, 'thermos flask'], [/paper cups|paper plates|\bstraws?\b/, 'disposable cups plates'], [/\bcups?\b|\bmugs?\b/, 'cups'], [/dinner set|plates/, 'dinner plates'],
  // home
  [/\bcot\b/, 'baby crib'], [/mattress/, 'mattress'], [/mosquito net/, 'mosquito net'], [/bed sheets|duvet|blanket/, 'bed linen'], [/\bbed\b/, 'wooden bed'], [/dining table/, 'dining table'],
  [/sofa/, 'sofa'], [/wardrobe/, 'wardrobe'], [/office chair/, 'office chair'],
  // cleaning
  [/bar soap|jamaa|laundry bar/, 'bar soap'], [/washing powder|laundry powder|omo/, 'laundry detergent'], [/mop/, 'mop bucket'], [/bleach|jik|toilet cleaner|floor cleaner|dishwashing|softener/, 'cleaning products'],
  [/toilet paper|tissue|kitchen towel/, 'toilet paper'], [/air freshener|insect spray/, 'spray can'], [/sponge|steel wool/, 'cleaning sponge'], [/trash bags|carrier bags/, 'plastic bags'],
  [/matchbox|candle|lighter/, 'candles matches'],
  // beauty, health, baby
  [/perfume|oud/, 'perfume bottle'], [/lotion|shea/, 'body lotion'], [/petroleum jelly/, 'skincare jar'], [/hair .*oil|hair growth/, 'hair oil'], [/wig/, 'wig'],
  [/glucometer/, 'glucose meter'], [/blood pressure/, 'blood pressure monitor'], [/syrup/, 'cough syrup'], [/tablets|capsules|panadol|amoxicillin/, 'medicine pills'],
  [/pregnancy test/, 'pregnancy test'], [/first aid/, 'first aid kit'], [/vitamin/, 'vitamins'], [/pampers|diaper/, 'diapers'], [/stroller/, 'baby stroller'],
  [/high chair/, 'baby high chair'], [/ride-on|kids electric car/, 'kids electric car'], [/toys/, 'kids toys'],
  // stationery, packaging
  [/textbook|cbc/, 'school textbooks'], [/exercise book/, 'exercise books'], [/\bpens?\b|ballpoint|\bbic\b/, 'ballpoint pens'], [/printing paper|ream/, 'printer paper'],
  [/mathematical set/, 'geometry set'], [/paper bags/, 'paper bags'], [/carton|shipping cartons/, 'cardboard boxes'], [/takeaway/, 'takeaway food containers'],
  [/pet bottles|bottles with caps/, 'plastic bottles'], [/cling film|aluminium foil|packing tape/, 'kitchen foil wrap'],
  // transport, land, building
  [/bicycle|mountain bike|kids bike|roadmaster/, 'bicycle'], [/tractor|massey/, 'tractor'], [/hiace|matatu|minibus/, 'minibus'], [/isuzu|truck|lorry/, 'truck'],
  [/bajaj|boxer|tvs|motorbike|boda/, 'motorcycle'], [/tyres?/, 'car tyres'], [/brake pads/, 'brake pads'], [/shocks|shock absorber/, 'car suspension'], [/gearbox/, 'car gearbox'],
  [/engine/, 'car engine'], [/chain and sprocket/, 'motorcycle chain'], [/mabati|iron sheets/, 'corrugated metal roof'],
  [/beach plot/, 'beach land'], [/acre|plot/, 'green farmland'], [/maisonette|house/, 'house exterior'], [/apartment/, 'apartment interior'],
];
// the type of ad, when the title says nothing we know
const BY_SUB = { cars: 'car', vehicles: 'car', 'fresh-produce': 'fresh vegetables market', samaki: 'fresh fish market', 'clothes-shoes': 'clothes rack', electronics: 'electronics', furniture: 'furniture', beauty: 'cosmetics', pharmacy: 'pharmacy', 'african-crafts': 'african crafts', utensils: 'kitchen utensils', appliances: 'home appliances', stationery: 'stationery', packaging: 'packaging', beverages: 'drinks', 'cooking-products': 'groceries' };
const CAR = /\b(toyota|nissan|mazda|subaru|honda|mercedes|bmw|volkswagen|mitsubishi)\b/;

function termFor({ title = '', category = '', sub = '' }) {
  const text = String(title).toLowerCase();
  if (category === 'vehicles' && CAR.test(text) && !/hiace|truck|isuzu|tractor/.test(text)) return `${text.match(CAR)[1]} car`;
  if (category === 'spare-parts' && /toyota|nissan|subaru|mazda/.test(text) && !/brake|shock|gearbox|engine|tyre/.test(text)) return 'car parts';
  for (const [pattern, term] of TERMS) if (pattern.test(text)) return term;
  return BY_SUB[sub] || BY_SUB[category] || null;
}

// ---------------------------------------------------------------- Unsplash API (official, with our key)
let remaining = Infinity;
class LimitReached extends Error {}
async function unsplash(url) {
  if (remaining <= 1) throw new LimitReached();
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${KEY}`, 'Accept-Version': 'v1' } });
  remaining = Number(res.headers.get('x-ratelimit-remaining') ?? remaining);
  if (res.status === 403 && remaining <= 1) throw new LimitReached();
  if (res.status === 401) throw new Error('Unsplash refused the key: check UNSPLASH_ACCESS_KEY in server/.env');
  if (!res.ok) throw new Error(`Unsplash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const loadCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return { searches: {}, reported: [] }; } };
const saveCache = (cache) => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));

async function photosFor(term, cache) {
  if (cache.searches[term]) return cache.searches[term];
  const data = await unsplash(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(term)}&per_page=${PER_TERM * 2}&orientation=landscape&content_filter=high`);
  // free photos only (Unsplash+ photos are not free to use)
  const photos = (data.results || []).filter((photo) => !photo.premium && !photo.plus && /^https:\/\/images\.unsplash\.com\//.test(photo.urls?.raw || '')).slice(0, PER_TERM).map((photo) => ({
    id: photo.id, raw: photo.urls.raw, alt: photo.alt_description || '', name: photo.user?.name || 'Unsplash photographer',
    profile: photo.user?.links?.html || 'https://unsplash.com', page: photo.links?.html || 'https://unsplash.com', download: photo.links?.download_location || '',
  }));
  cache.searches[term] = photos;
  saveCache(cache);
  return photos;
}
// Unsplash's rule: tell them when a photo is used (once per photo)
async function report(photo, cache) {
  if (!photo.download || cache.reported.includes(photo.id)) return;
  await unsplash(photo.download);
  cache.reported.push(photo.id);
  saveCache(cache);
}
const utm = (url) => `${url}${url.includes('?') ? '&' : '?'}utm_source=${APP}&utm_medium=referral`;
// the hotlinked picture (Unsplash serves the size we ask for) and its credit
const imageOf = (photo) => `${photo.raw}${photo.raw.includes('?') ? '&' : '?'}w=900&q=75&fit=crop&auto=format`;
const creditOf = (photo, term) => ({ source: 'Unsplash', name: photo.name, profile: utm(photo.profile), link: utm(photo.page), photoId: photo.id, term });

// ---------------------------------------------------------------- run
async function main() {
  const dry = has('--dry');
  if (!dry && !KEY) {
    console.error('Set UNSPLASH_ACCESS_KEY in server/.env first (free: https://unsplash.com/oauth/applications → New application).');
    process.exitCode = 1;
    return;
  }
  await connectDB();
  const Listing = require('../models/Listing');
  const Product = require('../models/Product');
  const cache = loadCache();

  if (has('--remove')) {
    const ads = await Listing.updateMany({ 'photoCredit.source': 'Unsplash' }, { $set: { images: [] }, $unset: { photoCredit: 1 } });
    const products = await Product.updateMany({ 'imageCredit.source': 'Unsplash' }, { $set: { image: '' }, $unset: { imageCredit: 1 } });
    console.log(`Removed Unsplash photos from ${ads.modifiedCount} ads and ${products.modifiedCount} products.`);
    return;
  }

  const doListings = !has('--products');
  const doProducts = !has('--listings');
  const ads = doListings ? await Listing.find({ $or: [{ images: { $size: 0 } }, { images: { $exists: false } }] }).select('title category sub').lean() : [];
  // products: a drawn placeholder picture (uploads/products/*.png from the old shop) or none
  // (catalogue products take theirs from their ads, so only the old shop's products are searched for)
  const products = doProducts ? await Product.find({ key: { $exists: false }, $or: [{ image: '' }, { image: { $exists: false } }, { image: /^\/uploads\/products\// }], 'imageCredit.source': { $ne: 'Unsplash' } }).select('name category sub image').lean() : [];
  const jobs = [
    ...ads.map((ad) => ({ kind: 'ad', doc: ad, term: termFor(ad) })),
    ...products.map((product) => ({ kind: 'product', doc: product, term: termFor({ title: product.name, category: product.category, sub: product.sub }) })),
  ];
  const terms = [...new Set(jobs.map((job) => job.term).filter(Boolean))];
  const noTerm = jobs.filter((job) => !job.term);
  if (dry) {
    const byTerm = new Map();
    for (const job of jobs) if (job.term) byTerm.set(job.term, [...(byTerm.get(job.term) || []), job.doc.title || job.doc.name]);
    for (const [term, titles] of [...byTerm].sort((first, second) => second[1].length - first[1].length)) console.log(`${String(titles.length).padStart(3)}  ${term.padEnd(28)} ${titles.slice(0, 3).join(' · ').slice(0, 90)}`);
    console.log(`\n${ads.length} ads + ${products.length} products → ${terms.length} searches (${terms.filter((term) => cache.searches[term]).length} already cached).`);
    if (noTerm.length) console.log(`No search found for: ${noTerm.map((job) => job.doc.title || job.doc.name).join(' · ')}`);
    return;
  }

  const used = new Map(); // term → how many of its photos are in use (spread across ads that share a search)
  const adOps = [];
  const productOps = [];
  let stopped = false;
  try {
    for (const job of jobs) {
      if (!job.term) continue;
      const photos = await photosFor(job.term, cache);
      if (!photos.length) continue;
      const index = used.get(job.term) || 0;
      used.set(job.term, index + 1);
      const photo = photos[index % photos.length];
      await report(photo, cache);
      if (job.kind === 'ad') adOps.push({ updateOne: { filter: { _id: job.doc._id, images: { $size: 0 } }, update: { $set: { images: [imageOf(photo)], photoCredit: creditOf(photo, job.term) } } } });
      else productOps.push({ updateOne: { filter: { _id: job.doc._id }, update: { $set: { image: imageOf(photo), imageCredit: creditOf(photo, job.term) } } } });
    }
  } catch (error) {
    if (!(error instanceof LimitReached)) throw error;
    stopped = true;
  }
  // one write each for everything done so far
  if (adOps.length) await Listing.bulkWrite(adOps, { ordered: false });
  if (productOps.length) await Product.bulkWrite(productOps, { ordered: false });
  // catalogue products take their picture from their ads
  if (adOps.length) await require('../market/catalog').refresh((await Listing.distinct('product', { _id: { $in: adOps.map((op) => op.updateOne.filter._id) }, product: { $exists: true } })).map(String));
  require('./cache').invalidate?.('market:');
  console.log(`Real photos added: ${adOps.length} ads, ${productOps.length} products (${terms.length} searches, ${cache.reported.length} photos in use).`);
  if (stopped) console.log('Unsplash’s hourly limit reached: run "npm run photos" again in an hour to do the rest.');
  else if (noTerm.length) console.log(`${noTerm.length} had nothing to search for (they keep their placeholder).`);
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
module.exports = { termFor };
