// What a seller sells, as picked at sign-up / in My account: categories (electronics…) and, inside each, the types
// (phones, TVs…) chosen in the pop-up that opens when a category is tapped. Items are "category/type" strings
// (the server checks them again: market/sellerProfile.js). Pure functions, unit-tested in sellerItems.test.js.
export const MAX_CATEGORIES = 6;
export const MAX_ITEMS = 40;

export const itemKey = (category, sub) => `${category}/${sub}`;
// the types picked in one category
export const itemsIn = (items, category) => items.filter((item) => item.startsWith(`${category}/`)).map((item) => item.slice(category.length + 1));

// tap a type: on / off (never more than MAX_ITEMS)
export function toggleItem(items, category, sub) {
  const key = itemKey(category, sub);
  if (items.includes(key)) return items.filter((item) => item !== key);
  return items.length >= MAX_ITEMS ? items : [...items, key];
}

// "All" / "None" in the pop-up
export function setAllIn(items, category, subs, on) {
  const rest = items.filter((item) => !item.startsWith(`${category}/`));
  return on ? [...rest, ...subs.map((sub) => itemKey(category, sub))].slice(0, MAX_ITEMS) : rest;
}

// tapping a category: it's added (and the pop-up opens). A category already chosen just reopens the pop-up.
// { categories, open }: open = the category whose pop-up to show; null when the limit is reached
export function pickCategory(categories, category) {
  if (categories.includes(category)) return { categories, open: category };
  if (categories.length >= MAX_CATEGORIES) return { categories, open: null, full: true };
  return { categories: [...categories, category], open: category };
}

// "Remove this category" in the pop-up: the category and its types go
export const removeCategory = (categories, items, category) => ({ categories: categories.filter((item) => item !== category), items: items.filter((item) => !item.startsWith(`${category}/`)) });

// the label on a chosen category's chip: "Electronics · 3"
export const chipCount = (items, category) => itemsIn(items, category).length;
