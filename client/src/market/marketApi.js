import { useEffect, useState } from 'react';
import shopApi, { store } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';

export { default as api, errMsg, ksh, store, firstName } from '../shop/shopApi';

const ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
// the API answer the server's page already asked for (item pages: see server/market/seo.js), used once; else null
export function takePrefetch(path) {
  const early = typeof window !== 'undefined' ? window.__PREFETCH__ : null;
  if (!early || early.path !== path) return null;
  window.__PREFETCH__ = null;
  return early.data.then((data) => (data ? { data } : shopApi.get(path)));
}

// a photo's address: through the CDN (STORE_INFO.imageCdn), resized to `width`:
//   your own CDN (IMAGE_CDN_URL, resizing with IMAGE_CDN_RESIZE), or wsrv.nl (free image CDN on Cloudflare: WebP, never
//   enlarged) when the site is on a public https address. If the CDN fails, main.jsx loads the photo from us instead.
const viaWsrv = (cdn, url, width) => `https://wsrv.nl/?url=${encodeURIComponent(cdn.origin + url)}&w=${Math.round(width || 1280)}&output=webp&q=78&we&il`;
export const imgUrl = (url, width) => {
  if (!url) return '';
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  const cdn = STORE_INFO.imageCdn;
  if (cdn?.proxy === 'wsrv' && cdn.origin && url.startsWith('/uploads/')) return viaWsrv(cdn, url, width);
  if (cdn?.url && url.startsWith('/uploads/')) {
    if (width && cdn.resize) return cdn.resize.replace('{url}', `${cdn.url}${url}`).replace('{path}', url).replace('{w}', String(Math.round(width)));
    return `${cdn.url}${url}`;
  }
  return `${ORIGIN}${url}`;
};
// several sizes of a photo (only when the CDN can resize): the phone picks the one that fits the screen
export const imgSrcSet = (url, widths = [320, 480, 720, 1080]) =>
  (STORE_INFO.imageCdn?.resize || STORE_INFO.imageCdn?.proxy === 'wsrv') && url?.startsWith('/uploads/') ? widths.map((width) => `${imgUrl(url, width)} ${width}w`).join(', ') : undefined;

// ---------------------------------------------------------------- categories (downloaded once, kept for instant start-up)
const CAT_KEY = 'kapu_market_cats';
let catData = store.get(CAT_KEY, null);
let catPromise = null;
const listeners = new Set();

export function loadCategories(force = false) {
  if (!catPromise || force) {
    catPromise = shopApi
      .get('/market/categories')
      .then((response) => {
        catData = response.data;
        store.set(CAT_KEY, catData);
        listeners.forEach((fn) => fn(catData));
        return catData;
      })
      .catch((error) => {
        catPromise = null;
        if (catData) return catData;
        throw error;
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

export const findCat = (data, slug) => data?.categories.find((value) => value.slug === slug) || null;
export const findSub = (cat, slug) => cat?.subs.find((text) => text.slug === slug) || null;
// a type's own details first, then the category-wide ones (a detail in both is shown once)
// what a fresh-food price is per: "Kifungu (bunch)" → "kifungu", "Fungu (heap)" → "fungu", "Kg" → "kg", "Plate (portion)" → "plate"
export const unitShort = (unit) => (unit ? String(unit).replace(/\s*\(.*\)/, '').replace('Bag / sack', 'bag').replace('Crate / box', 'crate').trim().toLowerCase() : '');
export const SOLD_BY_UNIT = ['fresh-produce', 'samaki']; // priced per kifungu, kg, piece, fungu, plate…

export const fieldsOf = (cat, sub) => {
  if (!cat || !sub) return [];
  const out = [];
  for (const item of [...(sub.fields || []), ...(cat.commonFields || [])]) if (!out.some((element) => element.key === item.key)) out.push(item);
  return out;
};

// ---------------------------------------------------------------- formatting
export const priceText = (text) => (text > 0 ? `KSh ${Number(text).toLocaleString('en-KE')}` : 'Contact for price');
export const shortPrice = (value) => {
  if (!(value > 0)) return 'Ask';
  if (value >= 1e6) return `KSh ${(value / 1e6).toFixed(value % 1e6 ? 2 : 0).replace(/\.?0+$/, '')}M`;
  return `KSh ${Number(value).toLocaleString('en-KE')}`;
};
export function timeAgo(date) {
  const amount = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (amount < 60) return 'just now';
  const sum = Math.round(amount / 60);
  if (sum < 60) return `${sum} min ago`;
  const figure = Math.round(sum / 60);
  if (figure < 24) return `${figure} hr${figure > 1 ? 's' : ''} ago`;
  const days = Math.round(figure / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const clockTime = (date) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// a colour per category for photo-less ads
const TINTS = {
  vehicles: ['#fff1ea', '#ffd9c7'], electronics: ['#eaf2ff', '#cfe0ff'], 'land-property': ['#eaf7ee', '#c9ecd5'], beddings: ['#f3eefe', '#e0d4fb'],
  furniture: ['#fdf3e7', '#f6dfc0'], stationery: ['#eef7ff', '#d5eafc'], packaging: ['#f6f1ea', '#e7dccb'], liquor: ['#fbecef', '#f3cfd7'],
  'spare-parts': ['#eef0f3', '#d9dee6'], bicycles: ['#e9f8f6', '#c8eee8'], appliances: ['#fff6e5', '#ffe6b3'], utensils: ['#f1f5ea', '#dbe7c8'],
  'clothes-shoes': ['#fdeef6', '#f8d2e6'], bags: ['#f5efe9', '#e6d6c6'], beauty: ['#fcedf3', '#f6cfe0'], 'detergents-cleaning': ['#e9f6fd', '#c9e9f9'],
  'cooking-products': ['#fbf6e6', '#f2e4b0'], beverages: ['#eaf8f0', '#c5ecd6'], 'baby-kids': ['#eef6ff', '#d3e6ff'], 'african-crafts': ['#fbf1e6', '#f0d9bd'], 'fresh-produce': ['#ecf8e8', '#cdeec2'], samaki: ['#e8f4fb', '#c4e2f3'], other: ['#f2f0ed', '#e2ded8'],
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
    const element = document.createElement('meta');
    element.setAttribute(attr, key);
    return element;
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
      const element = document.createElement('link');
      element.setAttribute('rel', 'canonical');
      return element;
    });
    link.setAttribute('href', url);
    const script = upsert('script#seo-jsonld', () => {
      const currentScript = document.createElement('script');
      currentScript.id = 'seo-jsonld';
      currentScript.type = 'application/ld+json';
      return currentScript;
    });
    script.textContent = ld;
  }, [title, description, path, noindex, image, ld]);
}

// ---------------------------------------------------------------- photos: shrink big phone photos before upload
export async function shrinkImage(file, max = 1280, quality = 0.8) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    // WebP where the browser can make it (smaller), else JPEG
    let blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const webp = blob.type === 'image/webp';
    return new File([blob], file.name.replace(/\.\w+$/, '') + (webp ? '.webp' : '.jpg'), { type: webp ? 'image/webp' : 'image/jpeg' });
  } catch {
    return file;
  }
}

// ---------------------------------------------------------------- recent searches
const RECENT = 'kapu_recent_searches';
export const recentSearches = () => store.get(RECENT, []);
export const rememberSearch = (query) => {
  const text = String(query || '').trim();
  if (text.length < 2) return;
  store.set(RECENT, [text, ...recentSearches().filter((item) => item.toLowerCase() !== text.toLowerCase())].slice(0, 6));
};
export const clearRecent = () => store.set(RECENT, []);

export const POPULAR = ['Wholesale', 'Toyota Vitz', 'iPhone', 'Plots in Kitengela', 'Boda boda', 'Sofa set', 'Mattress 5x6', 'Laptop core i5', 'Smart TV', 'Stroller', 'Ankara dress', 'Cooking oil 20L', 'Car parts'];

export const adultOk = () => store.get('kapu_18plus', false);
export const confirmAdult = () => store.set('kapu_18plus', true);

// ---------------------------------------------------------------- wholesale (bulk price tiers), same rules as the server
// price per unit when buying `qty` of an ad / cart item that has wholesale prices
export function unitFor(item, qty) {
  const wholesale = item?.wholesale;
  if (!wholesale?.enabled || !wholesale.tiers?.length || item.offerId) return item.price; // an agreed offer price wins
  let price = wholesale.retail === false ? wholesale.tiers[0].price : item.price;
  for (const tier of wholesale.tiers) if (qty >= tier.minQty) price = tier.price;
  return price;
}
// smallest order allowed (bulk-only sellers)
export const minOrder = (item) => (item?.wholesale?.enabled && item.wholesale.retail === false && item.wholesale.tiers?.length ? item.wholesale.tiers[0].minQty : 1);
export const unitName = (item, number = 2) => {
  const unit = item?.wholesale?.unit || '';
  return unit ? (number === 1 ? unit : `${unit}s`) : number === 1 ? 'unit' : 'units';
};

// ---------------------------------------------------------------- colours (swatches in filters and the sell form)
export const COLOUR_HEX = {
  Black: '#1f2328', White: '#ffffff', Grey: '#9ca3af', Silver: 'linear-gradient(135deg, #e5e7eb, #9ca3af 55%, #f3f4f6)', Blue: '#2563eb', Navy: '#1e3a8a',
  Red: '#dc2626', Maroon: '#7f1d1d', Green: '#16a34a', Brown: '#8b5a2b', Beige: '#e8d9b5', Cream: '#fbf3dc', Gold: 'linear-gradient(135deg, #fde68a, #d4a017 55%, #fef3c7)',
  Orange: '#f97316', Yellow: '#facc15', Purple: '#7c3aed', Pink: '#f472b6',
  'Multi-colour': 'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)', Other: 'repeating-linear-gradient(45deg, #e5e7eb 0 4px, #ffffff 4px 8px)',
};

// ---------------------------------------------------------------- where items come from (imports)
export const ORIGIN_FALLBACK = [
  { key: 'china', name: 'China', label: 'Chinese goods', flag: '🇨🇳' },
  { key: 'ex-uk', name: 'Ex-UK', label: 'Ex-UK goods', flag: '🇬🇧' },
  { key: 'europe', name: 'Europe', label: 'European goods', flag: '🇪🇺' },
  { key: 'usa', name: 'USA', label: 'US goods', flag: '🇺🇸' },
  { key: 'japan', name: 'Japan', label: 'Japanese goods', flag: '🇯🇵' },
  { key: 'dubai', name: 'Dubai / UAE', label: 'Goods from Dubai', flag: '🇦🇪' },
  { key: 'local', name: 'Made in Kenya', label: 'Made in Kenya', flag: '🇰🇪' },
];
export const originsOf = (data) => data?.origins?.length ? data.origins : ORIGIN_FALLBACK;
export const originBy = (key) => ORIGIN_FALLBACK.find((item) => item.key === key) || null;
// food (vegetables, fruit, cereals, fish) isn't "made": locally grown is 🌱 Home grown, local fish a 🌊 Local catch,
// and imported food is known by its brand ("🇿🇦 Ceres · Imported from South Africa")
export const FOOD_CATS = ['fresh-produce', 'cooking-products', 'samaki'];
export const originTag = (ad) => {
  const origin = originBy(ad?.origin);
  if (!origin) return null;
  if (!FOOD_CATS.includes(ad.category)) return { flag: origin.flag, text: origin.name, long: origin.label };
  if (origin.key === 'local') return ad.category === 'samaki' ? { flag: '🌊', text: 'Local catch', long: 'Local catch (Kenyan waters)' } : { flag: '🌱', text: 'Home grown', long: 'Home grown in Kenya' };
  const brand = ad.brand || ad.attrs?.brand || '';
  return { flag: origin.flag, text: brand ? `${brand} · imported` : `Imported (${origin.name})`, long: `${brand ? `${brand}, imported` : 'Imported'} from ${origin.name}`, brand };
};
// the "Where is it from?" choices, in words that fit the category
export const originChoice = (origin, category) => (FOOD_CATS.includes(category) ? (origin.key === 'local' ? (category === 'samaki' ? '🌊 Local catch (Kenyan waters)' : '🌱 Home grown (Kenya)') : `${origin.flag} Imported from ${origin.name}`) : `${origin.flag} ${origin.label}`);
export const hasOrigin = (category, sub) => !!category && category !== 'land-property' && sub !== 'services';
