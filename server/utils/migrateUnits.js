// One-off: the Kiswahili units for fresh food. "Bunch" → "Kifungu (bunch)", "Heap (fungu)" → "Fungu (heap)" on every ad.
// With --demo-prices, the DEMO mama mbogas' greens are also set to the usual KSh 10 a kifungu (dhania KSh 5);
// real sellers' prices are never touched: they set their own.
//   node utils/migrateUnits.js                 rename the units
//   node utils/migrateUnits.js --demo-prices   …and the demo greens' prices
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');

const RENAME = { Bunch: 'Kifungu (bunch)', 'Heap (fungu)': 'Fungu (heap)' };

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (const [from, to] of Object.entries(RENAME)) {
    const result = await Listing.updateMany({ 'attrs.unit': from }, { $set: { 'attrs.unit': to } });
    console.log(`  ${from} → ${to}: ${result.modifiedCount} ads`);
  }
  if (process.argv.includes('--demo-prices')) {
    const demo = await Customer.find({ email: /@demo\.kapu\.test$/ }).distinct('_id');
    const greens = await Listing.find({ seller: { $in: demo }, category: 'fresh-produce', 'attrs.unit': 'Kifungu (bunch)' });
    let changed = 0;
    for (const ad of greens) {
      const price = /dhania|coriander/i.test(ad.title) ? 5 : 10;
      if (ad.price === price) continue;
      ad.price = price;
      ad.title = ad.title.replace(/\bbunch\b/i, 'kifungu');
      await ad.save();
      console.log(`  ${ad.title}: KSh ${price} / kifungu`);
      changed += 1;
    }
    console.log(`Demo greens priced per kifungu: ${changed}`);
  }
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
