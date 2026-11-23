// Our pickup points (Shop & ride with us): read from the database, kept in memory for a minute (every quote uses them).
// A fresh database gets a starter set (approximate spots in each area: admins replace them with the real addresses).
const PickupPoint = require('../models/PickupPoint');

const STARTERS = [
  ['Kapu CBD hub', 'CBD', 'Moi Avenue, Nairobi CBD', -1.2841, 36.8233, true],
  ['Westlands pickup point', 'Westlands', 'Westlands, near Sarit Centre', -1.2615, 36.8025],
  ['Kilimani pickup point', 'Kilimani', 'Argwings Kodhek Road, near Yaya Centre', -1.2925, 36.7870],
  ['Kawangware pickup point', 'Kawangware', 'Naivasha Road, Kawangware', -1.2835, 36.7480],
  ['Eastleigh pickup point', 'Eastleigh', 'First Avenue, Eastleigh', -1.2730, 36.8500],
  ['Donholm pickup point', 'Donholm', 'Outer Ring Road, Donholm', -1.2960, 36.8880],
  ['Embakasi pickup point', 'Embakasi', 'Pipeline, Embakasi', -1.3170, 36.8930],
  ['South C pickup point', 'South C', 'Mugoya, South C', -1.3190, 36.8270],
  ["Lang'ata pickup point", "Lang'ata", "Lang'ata Road, near T-Mall", -1.3105, 36.8130],
  ['Karen pickup point', 'Karen', 'Karen shopping centre', -1.3190, 36.7080],
  ['Kasarani pickup point', 'Kasarani', 'Thika Road, Roysambu', -1.2190, 36.8960],
  ['Githurai pickup point', 'Githurai', 'Githurai 45 stage', -1.2010, 36.9120],
  ['Kahawa pickup point', 'Kahawa', 'Kahawa Sukari', -1.1830, 36.9300],
].map(([name, area, address, lat, lng, hub]) => ({ name, area, address, hours: 'Mon–Sat 8am–8pm', point: { type: 'Point', coordinates: [lng, lat] }, ...(hub ? { hub: true } : {}) }));

// Areas with exact stages and landmarks, each list in this order (approximate locations: admins correct them on the map)
const EMBAKASI = [
  ['Fedha stage', 'Fedha stage, Outer Ring Road', -1.3178, 36.8936],
  ['Nyayo gate B', 'Nyayo Estate Embakasi, gate B', -1.3290, 36.9040],
  ['Kwa Ndege stage', 'Kwa Ndege stage, Embakasi', -1.3240, 36.9110],
  ['Pipeline stage', 'Pipeline stage, Outer Ring Road', -1.3125, 36.8905],
  ['Transami stage', 'Transami stage, Embakasi', -1.3300, 36.9160],
  ['Tajmall stage', 'Taj Mall stage, Outer Ring Road', -1.3225, 36.8962],
  ['Utawala Astrol', 'Astrol petrol station, Utawala', -1.2960, 36.9610],
  ['Utawala Shooters', 'Shooters, Utawala', -1.2895, 36.9665],
  ['Utawala near Benedicta', 'Near Benedicta, Utawala', -1.2930, 36.9740],
  ['Ruai stage', 'Ruai stage, Kangundo Road', -1.2760, 37.0110],
  ['Bee Centre', 'Bee Centre, Utawala', -1.2840, 36.9520],
  ['Donholm next to Greenspan', 'Next to Greenspan Mall, Donholm', -1.2968, 36.8885],
  ['Kayole junction', 'Kayole junction', -1.2780, 36.9070],
  ['Mutindwa stage', 'Mutindwa stage, Umoja', -1.2840, 36.8960],
  ['Umoja kwa Chief', 'Kwa Chief, Umoja', -1.2825, 36.8930],
  ['Mowlem stage', 'Mowlem stage', -1.2760, 36.9180],
  ['Njiru stage', 'Njiru stage', -1.2600, 36.9370],
  ['Imara Daima stage', 'Imara Daima stage, Mombasa Road', -1.3260, 36.8780],
];
const EASTLEIGH = [
  ['Madina Mall', 'Madina Mall, First Avenue, Eastleigh', -1.2742, 36.8490],
  ['18th Street', '18th Street, Eastleigh', -1.2775, 36.8560],
  ['Mlango', 'Mlango, Eastleigh', -1.2660, 36.8505],
  ['BBS Mall', 'BBS Mall, Eastleigh', -1.2715, 36.8470],
];
const exact = (area, list) => list.map(([name, address, lat, lng], index) => ({ name, area, address, order: index + 1, hours: 'Mon–Sat 8am–8pm', point: { type: 'Point', coordinates: [lng, lat] } }));
const EXACT = [...exact('Embakasi', EMBAKASI), ...exact('Eastleigh', EASTLEIGH)];
// the two broad starter points these replace (switched off unless admins changed them)
const REPLACED = [['Embakasi pickup point', 'Pipeline, Embakasi'], ['Donholm pickup point', 'Outer Ring Road, Donholm'], ['Eastleigh pickup point', 'First Avenue, Eastleigh']];

let cache = null;
let cachedAt = 0;
const TTL = 60 * 1000;

const plain = (doc) => ({ _id: String(doc._id), name: doc.name, area: doc.area, address: doc.address || '', landmark: doc.landmark || '', hours: doc.hours || '', phone: doc.phone || '', lat: doc.point.coordinates[1], lng: doc.point.coordinates[0], hub: !!doc.hub });

// one at a time (start-up and a first request may both ask): never inserted twice by this server
let seeding = null;
function ensureStarters() {
  seeding = seeding || (async () => {
    let added = 0;
    if (!(await PickupPoint.exists({}))) {
      await PickupPoint.insertMany(STARTERS.filter((point) => !REPLACED.some(([name]) => name === point.name)));
      added += STARTERS.length - REPLACED.length;
    }
    // the exact points (Embakasi, Eastleigh…): added once (by name), never overwriting what admins changed
    if (EXACT.length) added += (await PickupPoint.bulkWrite(EXACT.map((point) => ({ updateOne: { filter: { name: point.name, area: point.area }, update: { $setOnInsert: point }, upsert: true } })), { ordered: false })).upsertedCount || 0;
    if (REPLACED.length) await PickupPoint.bulkWrite(REPLACED.map(([name, address]) => ({ updateOne: { filter: { name, address, active: true }, update: { $set: { active: false } } } })), { ordered: false });
    cache = null;
    return added;
  })().finally(() => { seeding = null; });
  return seeding;
}

// active points, the hub first
async function all() {
  if (seeding) await seeding.catch(() => {}); // being filled in (start-up): wait, so a half-made list is never cached
  if (cache && Date.now() - cachedAt < TTL) return cache;
  let list = await PickupPoint.find({ active: true }).sort({ hub: -1, area: 1, order: 1, name: 1 }).lean();
  // a fresh database (asked before start-up finished): add the starter set now; an empty list is never cached
  if (!list.length && (await ensureStarters())) list = await PickupPoint.find({ active: true }).sort({ hub: -1, area: 1, order: 1, name: 1 }).lean();
  if (!list.length) return [];
  cache = list.map(plain);
  cachedAt = Date.now();
  return cache;
}
const reset = () => { cache = null; };

module.exports = { all, ensureStarters, reset, plain, STARTERS, EXACT };
