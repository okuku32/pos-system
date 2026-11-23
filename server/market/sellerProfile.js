// What a seller is and sells, from sign-up (and My account). Pure functions: no database.
//   sellerTypes       what kind of seller (wholesaler, importer, retailer, mama mboga…), up to 5
//   sellerCategories  market categories they sell in (electronics, fresh-produce…), up to 6
//   sellerItems       the types inside those categories, "category/type" (electronics/phones…), up to 40;
//                     picked in the pop-up that opens when a seller taps a category
//   location          county + town/area (required); an exact pin in Kenya is optional
//   trade             wholesalers: the categories they sell wholesale; importers: the categories they import and the
//                     countries they import from (ISO codes, market/importCountries.js). Only kept while the seller is
//                     that kind; every trade category is also one of sellerCategories (one list, no duplicates).
//                     Importers of vehicles also say which models ("Toyota/Vitz", or "Toyota/*" for every model) and
//                     importers of spare parts which kinds of parts (Brakes, Engine & gearbox…).
const { CATEGORIES, COUNTIES, getSub, VEHICLE_MAKES, SPARE_PART_TYPES } = require('./categories');
const geo = require('./geo');
const httpError = require('../utils/httpError');
const { getCountry } = require('./importCountries');

const KINDS = ['shop', 'wholesaler', 'boutique', 'mama-mboga', 'samaki', 'market-stall', 'chemist', 'electronics', 'spares', 'baby-shop', 'grocery', 'importer'];
const MAX = { types: 5, categories: 6, items: 40, countries: 10, vehicles: 40, spares: SPARE_PART_TYPES.length };
// "Toyota/Vitz" or "Toyota/*": a make we know and one of its models (or all of them)
const isVehicle = (key) => { const [make, model, extra] = key.split('/'); return extra === undefined && !!VEHICLE_MAKES[make] && (model === '*' || VEHICLE_MAKES[make].includes(model)); };
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []);
const unique = (list) => [...new Set(list)];

const sellerTypesFrom = (list) => unique(strings(list).filter((kind) => KINDS.includes(kind))).slice(0, MAX.types);

function sellerCategoriesFrom(list) {
  const slugs = new Set(CATEGORIES.map((category) => category.slug));
  return unique(strings(list).filter((slug) => slugs.has(slug))).slice(0, MAX.categories);
}

// raw: { wholesale: [category], imports: [category], importFrom: ['CN', 'AE'…] } → only what fits these seller kinds.
// required (sign-up, or when the seller sends it): a wholesaler / importer must fill their part in.
function tradeFrom(raw, sellerTypes = [], { required = true } = {}) {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const trade = {};
  if (sellerTypes.includes('wholesaler')) {
    const wholesale = sellerCategoriesFrom(body.wholesale);
    if (wholesale.length) trade.wholesale = wholesale;
    else if (required) throw httpError('Wholesaler: choose the categories of goods you sell wholesale');
  }
  if (sellerTypes.includes('importer')) {
    const imports = sellerCategoriesFrom(body.imports);
    if (imports.length) trade.imports = imports;
    else if (required) throw httpError('Importer: choose the categories of goods you import');
    if (imports.includes('vehicles')) {
      const vehicles = unique(strings(body.vehicles).filter(isVehicle)).slice(0, MAX.vehicles);
      if (vehicles.length) trade.vehicles = vehicles;
      else if (required) throw httpError('Importer: choose the vehicle makes and models you import');
    }
    if (imports.includes('spare-parts')) {
      const spares = unique(strings(body.spares).filter((type) => SPARE_PART_TYPES.includes(type))).slice(0, MAX.spares);
      if (spares.length) trade.spares = spares;
      else if (required) throw httpError('Importer: choose the types of spare parts you import');
    }
    const importFrom = unique(strings(body.importFrom).map((code) => code.trim().toUpperCase()).filter((code) => getCountry(code))).slice(0, MAX.countries);
    if (importFrom.length) trade.importFrom = importFrom;
    else if (required) throw httpError('Importer: choose the countries you import from');
  }
  if (Object.keys(trade).length) trade.updatedAt = new Date();
  return trade;
}

// what a seller sells = their categories + their trade categories (each once)
function withTradeCategories(categories = [], trade = {}) {
  const all = unique([...strings(categories), ...(trade.wholesale || []), ...(trade.imports || [])]);
  if (all.length > MAX.categories) throw httpError(`Up to ${MAX.categories} categories in all (what you sell, wholesale and import). Remove some first.`);
  return all;
}

// the model's last check before every save (models/Customer.js): whatever path wrote it, the trade matches the
// seller's kinds, has no duplicates or unknown values, and its categories are in sellerCategories
function normalizeTrade(doc) {
  const types = [...(doc.sellerTypes || [])];
  const raw = doc.trade ? (typeof doc.trade.toObject === 'function' ? doc.trade.toObject() : doc.trade) : null;
  if (!raw) return;
  const trade = tradeFrom(raw, types, { required: false });
  if (!trade.wholesale && !trade.imports && !trade.importFrom) {
    doc.trade = undefined;
    return;
  }
  if (raw.updatedAt) trade.updatedAt = raw.updatedAt;
  doc.trade = trade;
  const cats = [...(doc.sellerCategories || [])];
  const missing = [...(trade.wholesale || []), ...(trade.imports || [])].filter((slug) => !cats.includes(slug));
  if (missing.length) doc.sellerCategories = unique([...cats, ...missing]);
}

// for the seller's public page and cards: names and flags
function publicTrade(trade) {
  if (!trade) return null;
  const cat = (slug) => { const found = CATEGORIES.find((category) => category.slug === slug); return found ? { slug, name: found.name, icon: found.icon } : null; };
  const out = {
    wholesale: (trade.wholesale || []).map(cat).filter(Boolean),
    imports: (trade.imports || []).map(cat).filter(Boolean),
    importFrom: (trade.importFrom || []).map((code) => getCountry(code)).filter(Boolean).map(({ code, name, flag }) => ({ code, name, flag })),
    vehicles: (trade.vehicles || []).map((key) => { const [make, model] = key.split('/'); return { key, make, model: model === '*' ? '' : model, name: model === '*' ? `All ${make} models` : `${make} ${model}` }; }),
    spares: [...(trade.spares || [])],
  };
  return out.wholesale.length || out.imports.length || out.importFrom.length ? out : null;
}

// "electronics/phones": a real type of one of the chosen categories (anything else is dropped)
function sellerItemsFrom(list, categories) {
  const allowed = new Set(categories);
  return unique(strings(list).filter((item) => {
    const [category, sub, extra] = item.split('/');
    return extra === undefined && allowed.has(category) && !!getSub(category, sub);
  })).slice(0, MAX.items);
}

// A new seller's details; throws a friendly message for whatever is missing
function sellerProfileFrom(body = {}) {
  const sellerTypes = sellerTypesFrom(body.sellerTypes);
  if (!sellerTypes.length) throw httpError('Choose what kind of seller you are: wholesaler, importer, retailer, mama mboga, samaki dealer…');
  const trade = tradeFrom(body.trade, sellerTypes); // wholesalers / importers: what they deal in (and from where)
  const sellerCategories = withTradeCategories(sellerCategoriesFrom(body.sellerCategories), trade);
  if (!sellerCategories.length) throw httpError('Choose at least one category of what you sell');
  const sellerItems = sellerItemsFrom(body.sellerItems, sellerCategories);
  const where = body.location && typeof body.location === 'object' ? body.location : {};
  const county = clean(where.county, 40);
  if (!COUNTIES.includes(county)) throw httpError('Choose the county where you sell');
  const area = clean(where.area, 60);
  if (area.length < 2) throw httpError('Enter your town or area (e.g. Gikomba, Kawangware, Nakuru town)');
  const point = geo.toPoint(where.lat, where.lng);
  const address = clean(where.address, 200);
  return {
    sellerTypes, sellerCategories, ...(sellerItems.length ? { sellerItems } : {}), ...(Object.keys(trade).length ? { trade } : {}), county,
    shopLocation: {
      area, county, address: address || area, kinds: sellerTypes, updatedAt: new Date(),
      ...(point ? { point, public: true, placeId: clean(where.placeId, 300) || undefined } : {}),
    },
  };
}

module.exports = { sellerTypesFrom, sellerCategoriesFrom, sellerItemsFrom, sellerProfileFrom, tradeFrom, withTradeCategories, normalizeTrade, publicTrade, KINDS, MAX };
