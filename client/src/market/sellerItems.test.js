// Unit tests for the seller's "what I sell" picker:   cd client && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemKey, itemsIn, toggleItem, setAllIn, pickCategory, removeCategory, chipCount, MAX_CATEGORIES, MAX_ITEMS } from './sellerItems.js';

test('tapping a new category adds it and opens its types pop-up', () => {
  assert.deepEqual(pickCategory([], 'electronics'), { categories: ['electronics'], open: 'electronics' });
  assert.deepEqual(pickCategory(['electronics'], 'samaki'), { categories: ['electronics', 'samaki'], open: 'samaki' });
});

test('tapping a category already chosen just reopens its pop-up (nothing removed by accident)', () => {
  assert.deepEqual(pickCategory(['electronics', 'samaki'], 'electronics'), { categories: ['electronics', 'samaki'], open: 'electronics' });
});

test('no more than the maximum categories: no pop-up, list unchanged', () => {
  const full = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.equal(full.length, MAX_CATEGORIES);
  assert.deepEqual(pickCategory(full, 'g'), { categories: full, open: null, full: true });
});

test('ticking types in the pop-up, and the count on the chip', () => {
  let items = [];
  items = toggleItem(items, 'electronics', 'phones');
  items = toggleItem(items, 'electronics', 'tvs');
  items = toggleItem(items, 'samaki', 'tilapia');
  assert.deepEqual(items, ['electronics/phones', 'electronics/tvs', 'samaki/tilapia']);
  assert.deepEqual(itemsIn(items, 'electronics'), ['phones', 'tvs']);
  assert.equal(chipCount(items, 'electronics'), 2);
  assert.equal(chipCount(items, 'beddings'), 0);
  items = toggleItem(items, 'electronics', 'phones');
  assert.deepEqual(items, ['electronics/tvs', 'samaki/tilapia'], 'tapping again unticks it');
});

test('a category whose slug starts like another is kept apart', () => {
  const items = ['bags/handbags', 'bags-and-more/x'];
  assert.deepEqual(itemsIn(items, 'bags'), ['handbags']);
  assert.deepEqual(removeCategory(['bags', 'bags-and-more'], items, 'bags'), { categories: ['bags-and-more'], items: ['bags-and-more/x'] });
});

test('“All” and “None” in the pop-up only touch that category', () => {
  const start = ['samaki/tilapia', 'electronics/phones'];
  const all = setAllIn(start, 'electronics', ['phones', 'tvs', 'laptops'], true);
  assert.deepEqual(all, ['samaki/tilapia', 'electronics/phones', 'electronics/tvs', 'electronics/laptops']);
  assert.deepEqual(setAllIn(all, 'electronics', ['phones', 'tvs', 'laptops'], false), ['samaki/tilapia']);
});

test('removing a category removes its types too', () => {
  assert.deepEqual(removeCategory(['electronics', 'samaki'], ['electronics/tvs', 'samaki/tilapia'], 'electronics'), { categories: ['samaki'], items: ['samaki/tilapia'] });
});

test('never more than the maximum types', () => {
  let items = Array.from({ length: MAX_ITEMS }, (_, index) => itemKey('cat', `t${index}`));
  items = toggleItem(items, 'other', 'one-more');
  assert.equal(items.length, MAX_ITEMS);
  assert.equal(setAllIn(items, 'x', ['a', 'b'], true).length, MAX_ITEMS);
});
