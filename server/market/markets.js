// Markets: the starting list, slugs, and shared helpers.
// The pins are approximate (the market's general location). Staff can correct any of them in Admin → Markets.
const KINDS = {
  'fresh-produce': 'Fresh produce',
  mitumba: 'Mitumba & clothes',
  mixed: 'General market',
  wholesale: 'Wholesale market',
};

// [name, kind, area, county, lat, lng, about]
const DEFAULT_MARKETS = [
  ['Gikomba Market', 'mitumba', 'Gikomba', 'Nairobi', -1.2849, 36.8396, 'East Africa’s biggest mitumba market: clothes, shoes, fabric, furniture and fresh food.'],
  ['Wakulima Market (Marikiti)', 'fresh-produce', 'CBD', 'Nairobi', -1.2876, 36.8303, 'Nairobi’s main fresh produce market: vegetables and fruit, wholesale and retail.'],
  ['Muthurwa Market', 'mixed', 'Muthurwa', 'Nairobi', -1.2894, 36.8334, 'Vegetables, fruit, clothes and household goods near the Muthurwa bus terminus.'],
  ['City Market', 'fresh-produce', 'CBD', 'Nairobi', -1.2826, 36.8193, 'Fresh fish, meat, fruit, flowers and curios in the city centre.'],
  ['Kenyatta Market', 'mixed', 'Kenyatta / Golf Course', 'Nairobi', -1.3048, 36.8022, 'Nyama choma, salons, tailors, vegetables and household goods.'],
  ['Toi Market', 'mitumba', 'Kibera', 'Nairobi', -1.3108, 36.7796, 'Mitumba clothes and shoes, household goods and fresh food.'],
  ['Ngara Market', 'mixed', 'Ngara', 'Nairobi', -1.2766, 36.8266, 'Clothes, shoes, fabric and fresh food.'],
  ['Kangemi Market', 'fresh-produce', 'Kangemi', 'Nairobi', -1.2658, 36.7482, 'Vegetables, fruit and household goods along Waiyaki Way.'],
  ['Kawangware Market', 'mixed', 'Kawangware', 'Nairobi', -1.2856, 36.7515, 'Vegetables, fruit, mitumba and household goods.'],
  ['Burma Market', 'mixed', 'Maringo / Jogoo Road', 'Nairobi', -1.2849, 36.8526, 'Meat, vegetables and household goods off Jogoo Road.'],
  ['Kariokor Market', 'mixed', 'Kariokor', 'Nairobi', -1.2758, 36.8352, 'Leather sandals, crafts, kiondos and fresh food.'],
  ['Githurai Market', 'fresh-produce', 'Githurai 45', 'Nairobi', -1.2045, 36.9131, 'Busy fresh produce and mitumba market off Thika Road.'],
  ['Kongowea Market', 'fresh-produce', 'Kongowea', 'Mombasa', -4.0279, 39.6928, 'Mombasa’s biggest fresh produce market.'],
  ['Mackinnon Market', 'fresh-produce', 'Mombasa Island', 'Mombasa', -4.0618, 39.6702, 'Fruit, vegetables and spices in Mombasa’s Old Town.'],
  ['Wakulima Market Nakuru', 'fresh-produce', 'Nakuru Town', 'Nakuru', -0.2869, 36.07, 'Nakuru’s main fresh produce market.'],
  ['Kibuye Market', 'mixed', 'Kibuye', 'Kisumu', -0.0904, 34.7638, 'One of the largest open-air markets in East Africa: food, clothes and household goods.'],
  ['Eldoret Municipal Market', 'mixed', 'Eldoret Town', 'Uasin Gishu', 0.5185, 35.273, 'Fresh produce, clothes and household goods.'],
  ['Madaraka Market Thika', 'fresh-produce', 'Thika Town', 'Kiambu', -1.0393, 37.0717, 'Fresh produce and household goods in Thika.'],
];

const slugify = (text) => String(text).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// what everyone sees of a market
const publicMarket = (market, extra = {}) =>
  market && {
    _id: market._id, name: market.name, slug: market.slug, kind: market.kind, kindName: KINDS[market.kind] || 'Market', area: market.area || '', county: market.county,
    days: market.days || '', about: market.about || '', lat: market.point.coordinates[1], lng: market.point.coordinates[0], approved: market.approved !== false, ...extra,
  };

// first start: fill in the real markets
async function ensureMarkets(Market) {
  if (await Market.estimatedDocumentCount()) return;
  await Market.insertMany(DEFAULT_MARKETS.map(([name, kind, area, county, lat, lng, about]) => ({ name, slug: slugify(name), kind, area, county, about, days: 'Daily', point: { type: 'Point', coordinates: [lng, lat] }, approved: true })));
}

module.exports = { KINDS, DEFAULT_MARKETS, slugify, publicMarket, ensureMarkets };
