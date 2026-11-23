// Remove the earlier POS version's data, which the marketplace no longer uses:
//   · the old grocery stock items in "products" (the ones without a catalogue key) and the photos only they use
//   · the old till / shop collections: orders (today's orders are in "marketorders"), sales, purchases, expenses,
//     suppliers, settings (today's settings are in "sitesettings")
// Staff accounts ("users") are NOT touched: they are the current admin and moderators.
//
//   npm run remove-old-pos          → shows what would be removed (changes nothing)
//   npm run remove-old-pos -- --yes → backs everything up, then removes it
//
// The backup goes to server/private/backups/old-pos-<date>/ (never in git): one .json file per collection (MongoDB
// Extended JSON, so ids and dates restore exactly: `mongoimport --jsonArray`) and the removed photos.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;
const OLD_COLLECTIONS = ['orders', 'sales', 'purchases', 'expenses', 'suppliers', 'settings'];
const OLD_PRODUCTS = { key: { $exists: false } }; // catalogue products always have a key
const PHOTOS = path.join(__dirname, '..', 'uploads', 'products');
const apply = process.argv.includes('--yes');

// a collection is only removed if it really is the old POS one (not a newer collection that reuses the name)
const LOOKS_OLD = {
  orders: (doc) => !doc || (!('orderNo' in doc && 'checkoutId' in doc) && ('stage' in doc || 'trackingToken' in doc || 'customer' in doc)),
  sales: (doc) => !doc || 'cashier' in doc || 'amountTendered' in doc || 'stockDeducted' in doc,
  purchases: (doc) => !doc || 'supplier' in doc || 'supplierName' in doc,
  expenses: () => true,
  suppliers: (doc) => !doc || 'contactPerson' in doc || 'kraPin' in doc || 'paymentTerms' in doc,
  settings: (doc) => !doc || ('key' in doc && 'value' in doc && !('demoPayments' in doc)),
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const existing = new Set((await db.listCollections().toArray()).map((item) => item.name));
  const plan = [];
  for (const name of OLD_COLLECTIONS) {
    if (!existing.has(name)) continue;
    const sample = await db.collection(name).findOne({});
    if (!LOOKS_OLD[name](sample)) {
      console.log(`⚠️  "${name}" doesn't look like the old POS data: left alone.`);
      continue;
    }
    plan.push({ name, count: await db.collection(name).countDocuments() });
  }
  const oldProducts = await db.collection('products').find(OLD_PRODUCTS).toArray();
  // photos used only by the old products (never one an ad, a catalogue product or a store still uses)
  const inUse = new Set();
  for (const listing of await db.collection('listings').find({}).project({ images: 1 }).toArray()) (listing.images || []).forEach((url) => inUse.add(path.basename(url)));
  for (const product of await db.collection('products').find({ key: { $exists: true } }).project({ image: 1 }).toArray()) if (product.image) inUse.add(path.basename(product.image));
  for (const store of await db.collection('stores').find({}).toArray()) (EJSON.stringify(store).match(/\/uploads\/[^"\\]+/g) || []).forEach((url) => inUse.add(path.basename(url)));
  const photos = [...new Set(oldProducts.map((item) => item.image).filter((url) => typeof url === 'string' && url.startsWith('/uploads/products/')).map((url) => path.basename(url)))]
    .filter((file) => /^[a-f0-9]{24}\.(png|jpe?g|webp|gif)$/i.test(file) && !inUse.has(file) && fs.existsSync(path.join(PHOTOS, file)));

  console.log(`Database: ${db.databaseName}`);
  console.log(`  products without a catalogue key (old stock items): ${oldProducts.length}`);
  for (const item of plan) console.log(`  ${item.name}: ${item.count}`);
  console.log(`  photos only the old products use: ${photos.length}`);
  console.log('  users (staff accounts): kept');
  if (!apply) {
    console.log('\nNothing changed. Run again with --yes to back up and remove these.');
    return mongoose.disconnect();
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dir = path.join(__dirname, '..', 'private', 'backups', `old-pos-${db.databaseName}-${stamp}`);
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const save = (name, docs) => fs.writeFileSync(path.join(dir, `${name}.json`), EJSON.stringify(docs, null, 1, { relaxed: false }));
  save('products', oldProducts);
  for (const item of plan) save(item.name, await db.collection(item.name).find({}).toArray());
  for (const file of photos) fs.copyFileSync(path.join(PHOTOS, file), path.join(dir, 'photos', file));
  // the backup must be complete before anything is removed
  const saved = EJSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8'));
  if (saved.length !== oldProducts.length) throw new Error('The products backup is incomplete: nothing was removed');
  for (const item of plan) if (EJSON.parse(fs.readFileSync(path.join(dir, `${item.name}.json`), 'utf8')).length !== item.count) throw new Error(`The ${item.name} backup is incomplete: nothing was removed`);
  if (fs.readdirSync(path.join(dir, 'photos')).length !== photos.length) throw new Error('The photos backup is incomplete: nothing was removed');
  console.log(`\nBacked up to ${dir}`);

  const removed = await db.collection('products').deleteMany({ _id: { $in: oldProducts.map((item) => item._id) }, ...OLD_PRODUCTS });
  console.log(`Removed ${removed.deletedCount} old products`);
  for (const item of plan) {
    await db.collection(item.name).drop();
    console.log(`Removed the "${item.name}" collection (${item.count})`);
  }
  for (const file of photos) fs.unlinkSync(path.join(PHOTOS, file));
  console.log(`Removed ${photos.length} photos`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('❌', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
