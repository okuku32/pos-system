// Example discounts on the DEMO sellers' ads (emails ending @demo.kapu.test), so the home page's
// "🏷️ Best discounts" row has something to show. Real sellers' ads are never touched.
//   node utils/demoDeals.js            add example discounts (original price shown crossed out, 30 days)
//   node utils/demoDeals.js --remove   take them off again
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const { percentOff, SHOW_DAYS } = require('../market/discount');

// how much off each example gets (a spread, so the ranking has something to rank)
const PERCENTS = [45, 40, 35, 30, 30, 25, 25, 20, 20, 20, 15, 15, 12, 10, 10, 8];
// a believable original price: rounded to a "price-tag" number
const tag = (amount) => (amount >= 10000 ? Math.round(amount / 500) * 500 : amount >= 1000 ? Math.round(amount / 50) * 50 : Math.round(amount / 10) * 10);

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const demo = await Customer.find({ email: /@demo\.kapu\.test$/ }).distinct('_id');
  if (!demo.length) {
    console.log('No demo sellers in this database: nothing to do.');
    return mongoose.disconnect();
  }
  if (process.argv.includes('--remove')) {
    const result = await Listing.updateMany({ seller: { $in: demo }, wasPrice: { $ne: null } }, { $set: { wasPrice: null, discountPercent: 0, discountUntil: null } });
    console.log(`Removed example discounts from ${result.modifiedCount} demo ads.`);
    return mongoose.disconnect();
  }
  // one ad per category first (variety on the home page), then more until we have enough
  const ads = await Listing.find({ seller: { $in: demo }, status: 'active', price: { $gte: 100 } }).sort({ views: -1, createdAt: -1 }).select('price category title').lean();
  const picked = [];
  const seen = new Set();
  for (const ad of ads) if (!seen.has(ad.category) && picked.length < PERCENTS.length) { seen.add(ad.category); picked.push(ad); }
  for (const ad of ads) if (picked.length < PERCENTS.length && !picked.includes(ad)) picked.push(ad);
  let count = 0;
  for (const [index, ad] of picked.entries()) {
    const wasPrice = tag(ad.price / (1 - PERCENTS[index] / 100));
    const percent = percentOff(wasPrice, ad.price);
    if (percent < 5 || percent > 70) continue;
    // staggered start dates, so some deals are "fresh" and some have been running a while
    const until = new Date(Date.now() + (SHOW_DAYS - (index % 6) * 2) * 86400000);
    await Listing.updateOne({ _id: ad._id }, { $set: { wasPrice, discountPercent: percent, discountUntil: until } });
    console.log(`  -${percent}%  ${ad.title}: KSh ${wasPrice.toLocaleString('en-KE')} → KSh ${ad.price.toLocaleString('en-KE')}`);
    count += 1;
  }
  console.log(`Added example discounts to ${count} demo ads (the price stays the same; the original price is shown crossed out).`);
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
