// One-off: fish ads posted under Fresh produce → "Fish & meat" (now "Meat (nyama)") move to the new 🐟 Samaki category,
// into the right type (fried / fresh Victoria fish, lake fish, sea foods, fried / fresh omena). Meat ads stay where they are.
//   node utils/migrateFish.js           show what would move
//   node utils/migrateFish.js --apply   move them
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const { keywordsFor } = require('../market/search');

const FISH = /\b(fish|samaki|tilapia|ngege|sato|nile perch|mbuta|omena|dagaa|fulu|mumi|catfish|kamongo|prawns?|kamba|pweza|octopus|ngisi|squid|crab|lobster|seafood|changu|nguru|tuna|jodari)\b/i;
const MEAT = /\b(beef|goat|mbuzi|mutton|pork|nguruwe|chicken|kuku|matumbo|mutura|liver|maini)\b/i;

function placeOf(text) {
  const fried = /\b(fried|fry|kukaanga|wet fry|dry fry)\b/i.test(text);
  if (/\b(omena|dagaa)\b/i.test(text)) return { sub: fried ? 'fried-omena' : 'fresh-omena', attrs: {} };
  if (/\b(prawns?|kamba|pweza|octopus|ngisi|squid|crab|lobster|seafood|changu|nguru|tuna|jodari|coast|mombasa|kilifi|lamu|sea)\b/i.test(text)) return { sub: 'seafood', attrs: { kind: /prawn|kamba/i.test(text) ? 'Prawns (kamba)' : /pweza|octopus/i.test(text) ? 'Octopus (pweza)' : /ngisi|squid/i.test(text) ? 'Squid (ngisi)' : /crab/i.test(text) ? 'Crab (kaa)' : /lobster/i.test(text) ? 'Lobster (kamba mti)' : 'Fish (nguru, changu, tafi, jodari…)' } };
  if (/\b(naivasha|turkana|baringo|jipe|masinga|trout|fish farm|pond|farmed)\b/i.test(text)) return { sub: 'lake-fish', attrs: { fish: /catfish|mumi/i.test(text) ? 'Catfish (mumi)' : /kamongo/i.test(text) ? 'Lungfish (kamongo)' : /trout/i.test(text) ? 'Trout' : /tilapia/i.test(text) ? 'Tilapia' : 'Other' } };
  const fish = /obambo|obambla|dried|smoked/i.test(text) ? 'Obambo (dried / smoked)' : /mbuta|nile perch/i.test(text) ? 'Mbuta (Nile perch)' : /tilapia|ngege|sato/i.test(text) ? 'Ngege (tilapia)' : /mumi|catfish/i.test(text) ? 'Mumi (catfish)' : /fulu/i.test(text) ? 'Fulu' : 'Other';
  return { sub: fried ? 'fried-victoria-fish' : 'fresh-victoria-fish', attrs: { fish } };
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const apply = process.argv.includes('--apply');
  const ads = await Listing.find({ category: 'fresh-produce', sub: 'fish-meat' });
  let moved = 0;
  for (const ad of ads) {
    const text = `${ad.title} ${ad.description || ''}`;
    if (!FISH.test(text) || (MEAT.test(ad.title) && !FISH.test(ad.title))) continue;
    const { sub, attrs } = placeOf(text);
    console.log(`  ${apply ? 'moved' : 'would move'}: “${ad.title}” → samaki / ${sub}`);
    if (apply) {
      ad.category = 'samaki';
      ad.sub = sub;
      ad.attrs = { ...attrs, ...(ad.attrs?.unit ? { unit: ad.attrs.unit } : {}) };
      ad.markModified('attrs');
      ad.keywords = keywordsFor(ad);
      await ad.save();
    }
    moved += 1;
  }
  console.log(`${moved} fish ad${moved === 1 ? '' : 's'} ${apply ? 'moved to Samaki' : 'to move (run with --apply)'}.`);
  // Victoria fish by their Kenyan names: older labels → mbuta, ngege, mumi, kamongo
  const { getCategory } = require('../market/categories');
  const aliases = getCategory('samaki').subs.find((sub) => sub.slug === 'fresh-victoria-fish').fields.find((field) => field.key === 'fish').aliases;
  for (const [from, to] of Object.entries(aliases).filter(([key]) => key.includes('('))) {
    const where = { category: 'samaki', sub: { $in: ['fresh-victoria-fish', 'fried-victoria-fish'] }, 'attrs.fish': from };
    const count = await Listing.countDocuments(where);
    if (count && apply) await Listing.updateMany(where, { $set: { 'attrs.fish': to } });
    if (count) console.log(`  ${apply ? 'renamed' : 'would rename'} ${count} × “${from}” → “${to}”`);
  }
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
