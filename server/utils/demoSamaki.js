// Adds the demo 🐟 samaki ads (utils/demoFishAds.js) to an existing database, from the DEMO sellers only
// (emails ending @demo.kapu.test), without re-seeding anything else. Safe to run twice.
//   node utils/demoSamaki.js            add the missing demo fish ads
//   node utils/demoSamaki.js --remove   delete the demo fish ads again
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const { keywordsFor, normalize } = require('../market/search');
const geo = require('../market/geo');
const ADS = require('./demoFishAds');
const WEIGHT = { 'fried-victoria-fish': 0.6, 'fresh-victoria-fish': 1, 'lake-fish': 1, seafood: 1, 'fried-omena': 0.3, 'fresh-omena': 1 };

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const users = [...new Set(ADS.map(([user]) => user))];
  const sellers = new Map((await Customer.find({ email: { $in: users.map((user) => `${user}@demo.kapu.test`) } })).map((customer) => [customer.email.split('@')[0], customer]));
  if (process.argv.includes('--remove')) {
    const result = await Listing.deleteMany({ seller: { $in: [...sellers.values()].map((customer) => customer._id) }, category: 'samaki', title: { $in: ADS.map((ad) => ad[3]) } });
    console.log(`Removed ${result.deletedCount} demo fish ads.`);
    return mongoose.disconnect();
  }
  let added = 0;
  for (const [index, [user, category, sub, title, price, , condition, attrs, description, extra]] of ADS.entries()) {
    const customer = sellers.get(user);
    if (!customer?.shopLocation) { console.log(`  skipped “${title}”: demo seller ${user} not found`); continue; }
    if (await Listing.exists({ seller: customer._id, title })) continue;
    const { county, area } = customer.shopLocation;
    const doc = {
      category, sub, title, price, county, area, condition, attrs, description, negotiable: false, seller: customer._id, sellerName: customer.name, sellerVerified: !!customer.verified, status: 'active',
      views: 20 + ((index * 37) % 200), buyNow: true, stock: 200, delivery: { available: true, fee: 100, pickup: true, days: 'Same day' }, origin: 'local', weightKg: WEIGHT[sub] ?? 1,
      ...(extra || {}),
    };
    doc.slug = `${normalize(`${title} ${area}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}-${crypto.randomBytes(3).toString('hex')}`;
    const pin = geo.pinFor(customer, county);
    if (pin) doc.geo = pin;
    doc.keywords = keywordsFor(doc);
    await Listing.create(doc);
    console.log(`  + ${title} (${customer.shopLocation.name}) KSh ${price}`);
    added += 1;
  }
  if (added) await require('../market/directory').rebuild().catch(() => {}); // the people tables (sellers' ad counts)
  console.log(`Added ${added} demo fish ads.`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
