// What a wholesaler sells / what an importer brings in: groups of ad categories.
// A seller belongs to a group when they have ads in it (worked out from their ads, so it's always up to date).
//   /wholesalers-near-me?trade=cereals · /wholesale?trade=electronics · /importers-near-me?trade=vehicles · /imports?trade=clothes
const WHOLESALE_TRADES = [
  { key: 'cereals', name: 'Cereals & food', label: 'Cereal wholesalers', icon: '🌾', about: 'Rice, flour, sugar, beans, cooking oil and drinks by the bag, bale or carton', cats: ['cooking-products', 'fresh-produce', 'beverages'] },
  { key: 'electronics', name: 'Electronics', label: 'Electronic wholesalers', icon: '📱', about: 'Phones, accessories, TVs, solar and appliances in bulk', cats: ['electronics', 'appliances'] },
  { key: 'packaging', name: 'Packaging', label: 'Packaging wholesalers', icon: '📦', about: 'Carrier bags, boxes, containers, cling film and labels', cats: ['packaging'] },
  { key: 'stationery', name: 'Stationery', label: 'Stationery wholesalers', icon: '✏️', about: 'Exercise books, pens, printing paper and school supplies', cats: ['stationery'] },
  { key: 'malimali', name: 'Malimali', label: 'Malimali wholesalers', icon: '🧺', about: 'Household goods: sufurias, plastics, cleaning, cosmetics, toys and assorted items', cats: ['utensils', 'detergents-cleaning', 'beauty', 'baby-kids', 'beddings', 'other'] },
  { key: 'clothes', name: 'Clothes', label: 'Clothes wholesalers', icon: '👕', about: 'Mitumba bales, new clothes, shoes and bags in bulk', cats: ['clothes-shoes', 'bags'] },
];
const IMPORT_TRADES = [
  { key: 'vehicles', name: 'Cars & spare parts', label: 'Car & spare parts importers', icon: '🚗', about: 'Ex-Japan and ex-UK cars, motorbikes, bicycles and spare parts', cats: ['vehicles', 'spare-parts', 'bicycles'] },
  { key: 'electronics', name: 'Electronics', label: 'Electronics importers', icon: '📱', about: 'Phones, laptops, TVs and appliances from Dubai, China, the UK and USA', cats: ['electronics', 'appliances'] },
  { key: 'clothes', name: 'Clothes & mitumba', label: 'Clothes & mitumba importers', icon: '👕', about: 'Mitumba bales, ex-UK clothes, shoes and bags', cats: ['clothes-shoes', 'bags'] },
  { key: 'furniture', name: 'Furniture & home', label: 'Furniture importers', icon: '🛋️', about: 'Ex-UK and China furniture, mattresses and bedding', cats: ['furniture', 'beddings'] },
  { key: 'household', name: 'Household & beauty', label: 'Household & beauty importers', icon: '🧴', about: 'Kitchenware, cleaning, cosmetics, baby goods and more', cats: ['utensils', 'detergents-cleaning', 'beauty', 'baby-kids', 'other'] },
  { key: 'food', name: 'Food & drinks', label: 'Food & drinks importers', icon: '🍫', about: 'Imported food, drinks, wines and spirits', cats: ['cooking-products', 'beverages', 'liquor'] },
];
const LISTS = { wholesale: WHOLESALE_TRADES, importer: IMPORT_TRADES };

const tradeOf = (kind, key) => (LISTS[kind] || []).find((item) => item.key === key) || null;
// the ad filter for one trade: { category: { $in: [...] } }
const tradeFilter = (kind, key) => {
  const tradeOfResult = tradeOf(kind, key);
  return tradeOfResult ? { category: tradeOfResult.cats.length === 1 ? tradeOfResult.cats[0] : { $in: tradeOfResult.cats } } : null;
};
// which trades a set of ad categories falls in
const tradesOfCats = (kind, cats) => (LISTS[kind] || []).filter((item) => item.cats.some((cat) => cats.includes(cat))).map((item) => item.key);
// what the browser needs (no ad categories)
const publicTrades = (kind) => (LISTS[kind] || []).map(({ key, name, label, icon, about }) => ({ key, name, label, icon, about }));

module.exports = { WHOLESALE_TRADES, IMPORT_TRADES, tradeOf, tradeFilter, tradesOfCats, publicTrades };
