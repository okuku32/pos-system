// Wholesalers and importers at sign-up / in My account: the categories they sell wholesale or import, and the
// countries importers bring goods in from (ISO codes). Pure functions, unit-tested in tradeRules.test.js.
// The server checks everything again (server/market/sellerProfile.js tradeFrom / normalizeTrade).
import { MAX_CATEGORIES } from './sellerItems.js';

export const MAX_COUNTRIES = 10;
export const MAX_VEHICLES = 40;
export const TRADE_KINDS = ['wholesaler', 'importer'];
const FIELDS = ['wholesale', 'imports', 'importFrom', 'vehicles', 'spares'];
// vehicles: 'Toyota/Vitz', or 'Toyota/*' for every Toyota model · spares: kinds of car parts ('Brakes'…)
export const emptyTrade = () => ({ wholesale: [], imports: [], importFrom: [], vehicles: [], spares: [] });
export const tradeOf = (customerTrade) => Object.fromEntries(FIELDS.map((field) => [field, [...(customerTrade?.[field] || [])]]));

// models and part types only count while vehicles / spare parts are among the imports
export const pruneTrade = (trade) => ({
  ...trade,
  vehicles: trade.imports.includes('vehicles') ? trade.vehicles || [] : [],
  spares: trade.imports.includes('spare-parts') ? trade.spares || [] : [],
});

// tap a model ('Toyota/Vitz') or "all models" ('Toyota/*'): the two never stand together for one make
export function toggleVehicle(list, key, max = MAX_VEHICLES) {
  if (list.includes(key)) return list.filter((item) => item !== key);
  if (list.length >= max) return list;
  const [make, model] = key.split('/');
  return model === '*' ? [...list.filter((item) => !item.startsWith(`${make}/`)), key] : [...list.filter((item) => item !== `${make}/*`), key];
}
export const vehicleName = (key) => { const [make, model] = key.split('/'); return model === '*' ? `all ${make} models` : `${make} ${model}`; };

// a tap in the wholesaler / importer pop-up → { trade, categories } (what the seller sells grows with the trade), or { error }
export function pickTrade(trade, categories, field, key, max) {
  const list = field === 'vehicles' ? toggleVehicle(trade.vehicles, key, max) : toggleIn(trade[field], key, max);
  if (list === trade[field]) return { error: field === 'importFrom' ? `Up to ${max} countries` : field === 'vehicles' ? `Up to ${max} models` : `Up to ${max} categories` };
  const next = pruneTrade({ ...trade, [field]: list });
  if (field !== 'wholesale' && field !== 'imports') return { trade: next, categories };
  const merged = mergeCategories(categories, next);
  if (merged.full) return { error: `Up to ${MAX_CATEGORIES} categories in all (what you sell, wholesale and import). Remove one under “What do you sell?” first.` };
  return { trade: next, categories: merged.categories };
}

// the importer's details as one line, rewritten after every tap:
// "Vehicles (Toyota Vitz, all Nissan models); Spare parts (Brakes) from Japan, United Kingdom"
export function importSummary(trade, categories = [], countries = []) {
  const name = (slug) => categories.find((category) => category.slug === slug)?.name || slug;
  const what = trade.imports.map((slug) => {
    if (slug === 'vehicles' && trade.vehicles.length) return `${name(slug)} (${trade.vehicles.map(vehicleName).join(', ')})`;
    if (slug === 'spare-parts' && trade.spares.length) return `${name(slug)} (${trade.spares.join(', ')})`;
    return name(slug);
  }).join('; ');
  const from = trade.importFrom.map((code) => countries.find((country) => country.code === code)?.name || code).join(', ');
  return [what, from && `from ${from}`].filter(Boolean).join(' ');
}

// from the categories the client downloads: vehicle makes → models, and the kinds of car parts
export const vehicleMakes = (categories = []) => categories.find((category) => category.slug === 'vehicles')?.subs.find((sub) => sub.slug === 'cars')?.fields.find((field) => field.key === 'make')?.makes || {};
export const spareTypes = (categories = []) => categories.find((category) => category.slug === 'spare-parts')?.subs.find((sub) => sub.slug === 'car-parts')?.fields.find((field) => field.key === 'partType')?.options || [];

// tap a chip: on / off, never twice, never more than max
export function toggleIn(list, key, max) {
  if (list.includes(key)) return list.filter((item) => item !== key);
  return list.length >= max ? list : [...list, key];
}

// the seller stopped being a wholesaler / importer: that part of the trade goes
export function dropKind(trade, kind) {
  if (kind === 'wholesaler') return { ...trade, wholesale: [] };
  if (kind === 'importer') return { ...trade, imports: [], importFrom: [], vehicles: [], spares: [] };
  return trade;
}

// what a seller sells = their categories + their trade categories, each once. { categories, full }
export function mergeCategories(categories, trade) {
  const all = [...new Set([...categories, ...trade.wholesale, ...trade.imports])];
  return all.length > MAX_CATEGORIES ? { categories, full: true } : { categories: all, full: false };
}

// what's still missing for these kinds ('' when complete)
export function tradeMissing(types, trade) {
  if (types.includes('wholesaler') && !trade.wholesale.length) return 'Wholesaler: choose the categories you sell wholesale';
  if (types.includes('importer') && !trade.imports.length) return 'Importer: choose the categories you import';
  if (types.includes('importer') && trade.imports.includes('vehicles') && !trade.vehicles?.length) return 'Importer: choose the vehicle makes and models you import';
  if (types.includes('importer') && trade.imports.includes('spare-parts') && !trade.spares?.length) return 'Importer: choose the types of spare parts you import';
  if (types.includes('importer') && !trade.importFrom.length) return 'Importer: choose the countries you import from';
  return '';
}

// what's sent to the server: only the parts these kinds use
export function tradePayload(types, trade) {
  const importer = types.includes('importer');
  const kept = pruneTrade(trade);
  return {
    wholesale: types.includes('wholesaler') ? trade.wholesale : [],
    imports: importer ? trade.imports : [],
    importFrom: importer ? trade.importFrom : [],
    vehicles: importer ? kept.vehicles : [],
    spares: importer ? kept.spares : [],
  };
}

// country search in the pop-up: by name or code, the chosen ones first
export function findCountries(countries, text, chosen = []) {
  const query = String(text || '').trim().toLowerCase();
  const hits = query ? countries.filter((country) => country.name.toLowerCase().includes(query) || country.code.toLowerCase() === query) : countries;
  return [...hits.filter((country) => chosen.includes(country.code)), ...hits.filter((country) => !chosen.includes(country.code))];
}
