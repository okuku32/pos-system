import { useEffect, useState } from 'react';
import shopApi, { store } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';

export { default as api, errMsg, ksh, store, firstName } from '../shop/shopApi';

const ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
export const imgUrl = (u) => (!u ? '' : /^https?:/.test(u) ? u : `${ORIGIN}${u}`);

// ---------------------------------------------------------------- categories (downloaded once, kept for instant start-up)
const CAT_KEY = 'ordersasa_market_cats';
let catData = store.get(CAT_KEY, null);
let catPromise = null;
const listeners = new Set();

export function loadCategories(force = false) {
  if (!catPromise || force) {
    catPromise = shopApi
      .get('/market/categories')
      .then((r) => {
        catData = r.data;
        store.set(CAT_KEY, catData);
        listeners.forEach((fn) => fn(catData));
        return catData;
      })
      .catch((e) => {
        catPromise = null;
        if (catData) return catData;
        throw e;
      });
  }
  return catPromise;
}

// { categories, counties } (from cache straight away, then refreshed)
export function useCategories() {
  const [data, setData] = useState(catData);
  useEffect(() => {
    listeners.add(setData);
    loadCategories().catch(() => {});
    return () => listeners.delete(setData);
  }, []);
  return data;
}

export const findCat = (data, slug) => data?.categories.find((c) => c.slug === slug) || null;
export const findSub = (cat, slug) => cat?.subs.find((s) => s.slug === slug) || null;
export const fieldsOf = (cat, sub) => (cat && sub ? [...(sub.fields || []), ...(cat.commonFields || [])] : []);

// ---------------------------------------------------------------- formatting
export const priceText = (p) => (p > 0 ? `KSh ${Number(p).toLocaleString('en-KE')}` : 'Contact for price');
export const shortPrice = (p) => {
  if (!(p > 0)) return 'Ask';
  if (p >= 1e6) return `KSh ${(p / 1e6).toFixed(p % 1e6 ? 2 : 0).replace(/\.?0+$/, '')}M`;
  return `KSh ${Number(p).toLocaleString('en-KE')}`;
};
export function timeAgo(d) {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`;
  const days = Math.round(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const clockTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// a colour per category for photo-less ads
const TINTS = {
  vehicles: ['#fff1ea', '#ffd9c7'], electronics: ['#eaf2ff', '#cfe0ff'], 'land-property': ['#eaf7ee', '#c9ecd5'], beddings: ['#f3eefe', '#e0d4fb'],
  furniture: ['#fdf3e7', '#f6dfc0'], stationery: ['#eef7ff', '#d5eafc'], packaging: ['#f6f1ea', '#e7dccb'], liquor: ['#fbecef', '#f3cfd7'],
  'spare-parts': ['#eef0f3', '#d9dee6'], bicycles: ['#e9f8f6', '#c8eee8'], 'kitchen-equipment': ['#fff6e5', '#ffe6b3'], utensils: ['#f1f5ea', '#dbe7c8'],
  'clothes-shoes': ['#fdeef6', '#f8d2e6'], bags: ['#f5efe9', '#e6d6c6'], beauty: ['#fcedf3', '#f6cfe0'], 'detergents-cleaning': ['#e9f6fd', '#c9e9f9'],
  'cooking-products': ['#fbf6e6', '#f2e4b0'], beverages: ['#eaf8f0', '#c5ecd6'], other: ['#f2f0ed', '#e2ded8'],
};
export const tint = (cat) => TINTS[cat] || TINTS.other;

// ---------------------------------------------------------------- SEO for the page being shown
// The server already sends these tags for the first page load (see server/market/seo.js); this keeps them
// right as people move between pages inside the app (Google also reads the updated tags).
function upsert(selector, create) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  return el;
}
const meta = (attr, key, value) => {
  const el = upsert(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, key);
    return m;
  });
  if (value) el.setAttribute('content', value);
  else el.remove();
};

export function useSeo({ title, description, path, noindex, image, jsonLd }) {
  const ld = jsonLd ? JSON.stringify(jsonLd) : '';
  useEffect(() => {
    if (!title) return;
    const full = title.includes(STORE_INFO.name) ? title : `${title} | ${STORE_INFO.name}`;
    document.title = full;
    const url = `${window.location.origin}${path || window.location.pathname}`;
    meta('name', 'description', description || '');
    meta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large');
    meta('property', 'og:title', full);
    meta('property', 'og:description', description || '');
    meta('property', 'og:url', url);
    meta('property', 'og:image', image ? imgUrl(image).replace(/^\//, `${window.location.origin}/`) : '');
    meta('name', 'twitter:title', full);
    meta('name', 'twitter:description', description || '');
    const link = upsert('link[rel="canonical"]', () => {
      const l = document.createElement('link');
      l.setAttribute('rel', 'canonical');
      return l;
    });
    link.setAttribute('href', url);
    const script = upsert('script#seo-jsonld', () => {
      const s = document.createElement('script');
      s.id = 'seo-jsonld';
      s.type = 'application/ld+json';
      return s;
    });
    script.textContent = ld;
  }, [title, description, path, noindex, image, ld]);
}

// ---------------------------------------------------------------- photos: shrink big phone photos before upload
export async function shrinkImage(file, max = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// ---------------------------------------------------------------- recent searches
const RECENT = 'ordersasa_recent_searches';
export const recentSearches = () => store.get(RECENT, []);
export const rememberSearch = (q) => {
  const t = String(q || '').trim();
  if (t.length < 2) return;
  store.set(RECENT, [t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6));
};
export const clearRecent = () => store.set(RECENT, []);

export const POPULAR = ['Toyota Vitz', 'iPhone', 'Plots in Kitengela', 'Boda boda', 'Sofa set', 'Mattress 5x6', 'Laptop core i5', 'Smart TV', 'Gas cylinder', 'Ankara dress', 'Cooking oil 20L', 'Car parts'];

export const adultOk = () => store.get('ordersasa_18plus', false);
export const confirmAdult = () => store.set('ordersasa_18plus', true);
