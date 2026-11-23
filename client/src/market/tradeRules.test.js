// Unit tests for the wholesaler / importer details:   cd client && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleIn, toggleVehicle, pickTrade, importSummary, dropKind, mergeCategories, tradeMissing, tradePayload, findCountries, emptyTrade, tradeOf, MAX_COUNTRIES } from './tradeRules.js';
import { MAX_CATEGORIES } from './sellerItems.js';

test('a chip toggles on and off, never twice and never past the limit', () => {
  assert.deepEqual(toggleIn([], 'CN', MAX_COUNTRIES), ['CN']);
  assert.deepEqual(toggleIn(['CN'], 'CN', MAX_COUNTRIES), []);
  const full = Array.from({ length: MAX_COUNTRIES }, (_, index) => `C${index}`);
  assert.equal(toggleIn(full, 'ZZ', MAX_COUNTRIES), full);
});

test('trade categories join what the seller sells, each once; too many is refused', () => {
  const trade = { wholesale: ['electronics', 'beverages'], imports: ['electronics'], importFrom: ['CN'] };
  assert.deepEqual(mergeCategories(['electronics', 'samaki'], trade), { categories: ['electronics', 'samaki', 'beverages'], full: false });
  const many = Array.from({ length: MAX_CATEGORIES }, (_, index) => `cat${index}`);
  const out = mergeCategories(many, { ...emptyTrade(), wholesale: ['electronics'] });
  assert.equal(out.full, true);
  assert.equal(out.categories, many, 'unchanged');
});

test('what a wholesaler / importer must still fill in', () => {
  assert.equal(tradeMissing(['shop'], emptyTrade()), '');
  assert.match(tradeMissing(['wholesaler'], emptyTrade()), /sell wholesale/);
  assert.match(tradeMissing(['importer'], emptyTrade()), /categories you import/);
  assert.match(tradeMissing(['importer'], { ...emptyTrade(), imports: ['electronics'] }), /countries/);
  assert.equal(tradeMissing(['importer', 'wholesaler'], { wholesale: ['beverages'], imports: ['electronics'], importFrom: ['CN'] }), '');
});

test('no longer a wholesaler / importer: that part is dropped, and never sent', () => {
  const trade = { wholesale: ['beverages'], imports: ['electronics'], importFrom: ['CN', 'AE'], vehicles: [], spares: [] };
  assert.deepEqual(dropKind(trade, 'importer'), { wholesale: ['beverages'], imports: [], importFrom: [], vehicles: [], spares: [] });
  assert.deepEqual(dropKind(trade, 'wholesaler'), { wholesale: [], imports: ['electronics'], importFrom: ['CN', 'AE'], vehicles: [], spares: [] });
  assert.deepEqual(tradePayload(['wholesaler'], trade), { wholesale: ['beverages'], imports: [], importFrom: [], vehicles: [], spares: [] });
});

test('country search: by name or code, chosen ones first', () => {
  const countries = [{ code: 'CN', name: 'China' }, { code: 'AE', name: 'United Arab Emirates (Dubai)' }, { code: 'GB', name: 'United Kingdom' }];
  assert.deepEqual(findCountries(countries, 'dubai').map((country) => country.code), ['AE']);
  assert.deepEqual(findCountries(countries, 'gb').map((country) => country.code), ['GB']);
  assert.deepEqual(findCountries(countries, 'united').map((country) => country.code), ['AE', 'GB']);
  assert.deepEqual(findCountries(countries, '', ['GB']).map((country) => country.code), ['GB', 'CN', 'AE']);
});

test('a saved trade is copied, not shared (editing it doesn’t change the account until saved)', () => {
  const saved = { wholesale: ['beverages'], imports: [], importFrom: [] };
  const copy = tradeOf(saved);
  copy.wholesale.push('electronics');
  assert.deepEqual(saved.wholesale, ['beverages']);
  assert.deepEqual(tradeOf(undefined), emptyTrade());
});

test('vehicle importers: a model or every model of a make, never both', () => {
  let list = toggleVehicle([], 'Toyota/Vitz');
  list = toggleVehicle(list, 'Toyota/Axio');
  assert.deepEqual(list, ['Toyota/Vitz', 'Toyota/Axio']);
  list = toggleVehicle(list, 'Toyota/*');
  assert.deepEqual(list, ['Toyota/*'], 'all models replaces the single ones');
  assert.deepEqual(toggleVehicle(list, 'Toyota/Vitz'), ['Toyota/Vitz'], 'a single model replaces all models');
  assert.deepEqual(toggleVehicle(list, 'Toyota/*'), []);
});

test('vehicle models and spare types are asked for, and dropped when that category goes', () => {
  const importing = (imports, extra = {}) => ({ ...emptyTrade(), imports, importFrom: ['JP'], ...extra });
  assert.match(tradeMissing(['importer'], importing(['vehicles'])), /makes and models/);
  assert.match(tradeMissing(['importer'], importing(['spare-parts'])), /spare parts/);
  assert.equal(tradeMissing(['importer'], importing(['vehicles', 'spare-parts'], { vehicles: ['Nissan/*'], spares: ['Brakes'] })), '');
  const picked = pickTrade(importing(['vehicles', 'spare-parts'], { vehicles: ['Nissan/*'], spares: ['Brakes'] }), ['vehicles', 'spare-parts'], 'imports', 'vehicles', MAX_CATEGORIES);
  assert.deepEqual([picked.trade.imports, picked.trade.vehicles, picked.trade.spares], [['spare-parts'], [], ['Brakes']]);
  assert.deepEqual(tradePayload(['importer'], importing(['electronics'], { vehicles: ['Nissan/*'] })).vehicles, []);
});

test('the importer summary reads back every tap', () => {
  const categories = [{ slug: 'vehicles', name: 'Vehicles' }, { slug: 'spare-parts', name: 'Spare parts' }, { slug: 'electronics', name: 'Electronics' }];
  const countries = [{ code: 'JP', name: 'Japan' }, { code: 'GB', name: 'United Kingdom' }];
  const trade = { ...emptyTrade(), imports: ['vehicles', 'spare-parts', 'electronics'], importFrom: ['JP', 'GB'], vehicles: ['Toyota/Vitz', 'Nissan/*'], spares: ['Brakes', 'Cooling'] };
  assert.equal(importSummary(trade, categories, countries), 'Vehicles (Toyota Vitz, all Nissan models); Spare parts (Brakes, Cooling); Electronics from Japan, United Kingdom');
  assert.equal(importSummary(emptyTrade(), categories, countries), '');
});
