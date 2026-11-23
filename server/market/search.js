// Marketplace search: forgiving on purpose, so people find things however they type them.
//  - words can be partial ("toyo vit" finds Toyota Vitz) and in any order
//  - plurals and simple endings don't matter ("sofas" = "sofa", "mattresses" = "mattress")
//  - Swahili / everyday words work through category synonyms ("gari", "pikipiki", "shamba", "simu")
//  - price phrases are understood: "under 500k", "below 1.2m", "above 50,000", "50k-80k"
//  - nothing found with every word? It falls back to ads matching most of the words
const { CATEGORIES, COUNTIES, getCategory, getSub, fieldsFor } = require('./categories');

const STOP = new Set(['a', 'an', 'the', 'for', 'of', 'in', 'on', 'and', 'with', 'to', 'at', 'by', 'from', 'sale', 'selling', 'sell', 'buy', 'cheap', 'used', 'new', 'kenya', 'ya', 'na', 'kwa', 'za', 'la', 'is', 'my', 'i', 'want', 'looking', 'need']);

const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9.+]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .trim();

// Very light stemming so singular/plural forms meet
function stem(word) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (/(sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

const tokens = (text) => normalize(text).split(' ').filter((item) => item && !STOP.has(item)).map(stem);

// The words an ad can be found by: title, category names and their synonyms, details (make, model, year...),
// condition and location. Stored on the ad (indexed) so searching is a fast index lookup.
function keywordsFor(listing) {
  const cat = getCategory(listing.category);
  const sub = getSub(listing.category, listing.sub);
  const parts = [listing.title, cat?.name, ...(cat?.synonyms || []), sub?.name, ...(sub?.synonyms || []), listing.condition, listing.county, listing.area];
  for (const field of fieldsFor(listing.category, listing.sub)) {
    const attr = listing.attrs?.[field.key];
    if (attr !== undefined && attr !== null && attr !== '' && field.type !== 'number') parts.push(String(attr));
    if (field.key === 'year' && attr) parts.push(String(attr));
  }
  if (listing.wholesale?.enabled) parts.push('wholesale bulk jumla wholesaler', listing.wholesale.unit || '');
  const origin = require('./origins').getOrigin(listing.origin);
  if (origin) parts.push(origin.name, origin.label, ...origin.words, origin.key === 'local' ? '' : 'imported import imports');
  // a bit of the description too, so specific words ("leather", "sunroof", "beach") are findable
  parts.push(String(listing.description || '').slice(0, 600));
  return [...new Set(parts.flatMap((part) => tokens(part)).filter((item) => item.length > 1 || /\d/.test(item)))].slice(0, 400);
}

const escapeRx = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "500k" -> 500000, "1.2m" -> 1200000, "50,000" -> 50000
function money(amount) {
  const match = String(amount).replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(k|m|mn|million|thousand|bob|ksh|kes|\/=)?$/);
  if (!match) return null;
  const number = parseFloat(match[1]);
  const unit = match[2] || '';
  if (unit === 'k' || unit === 'thousand') return Math.round(number * 1000);
  if (unit.startsWith('m')) return Math.round(number * 1000000);
  return Math.round(number);
}

// Pull price phrases out of the query text
function parsePrice(raw) {
  let text = ` ${String(raw || '').toLowerCase().replace(/ksh\.?|kes|\/=/g, ' ')} `;
  let min = null;
  let max = null;
  const take = (rx, fn) => {
    text = text.replace(rx, (all, ...group1) => {
      const ok = fn(...group1);
      return ok ? ' ' : all;
    });
  };
  const input = '(\\d[\\d,]*(?:\\.\\d+)?\\s?(?:k|m|mn|million|thousand)?)';
  take(new RegExp(`\\b${input}\\s*(?:-|to)\\s*${input}\\b`, 'g'), (value, other) => {
    const amount = money(value.replace(/\s/g, ''));
    const sum = money(other.replace(/\s/g, ''));
    if (amount === null || sum === null || sum < 100) return false;
    min = Math.min(amount, sum);
    max = Math.max(amount, sum);
    return true;
  });
  take(new RegExp(`\\b(?:under|below|less than|max|maximum|upto|up to|chini ya|<)\\s*${input}`, 'g'), (value) => {
    const amount = money(value.replace(/\s/g, ''));
    if (amount === null) return false;
    max = amount;
    return true;
  });
  take(new RegExp(`\\b(?:above|over|more than|min|minimum|from|juu ya|>)\\s*${input}`, 'g'), (value) => {
    const amount = money(value.replace(/\s/g, ''));
    if (amount === null) return false;
    min = amount;
    return true;
  });
  return { text: text.replace(/\s+/g, ' ').trim(), min, max };
}

// Which category / sub-category the words point at (used to suggest, and to rank)
function detectCategory(query) {
  const text = ` ${normalize(query)} `;
  // score = total length of the matching names/synonyms, so "soda crate" beats "crate" alone
  const score = (words) => words.reduce((sum, word) => {
    const normalizeResult = normalize(word);
    return normalizeResult && text.includes(` ${normalizeResult} `) ? sum + normalizeResult.length : sum;
  }, 0);
  let best = null;
  for (const category of CATEGORIES) {
    const cs = score([category.name, ...(category.synonyms || [])]);
    for (const sub of category.subs) {
      const ss = score([sub.name, ...(sub.synonyms || [])]);
      if (ss && (!best || ss + cs > best.score)) best = { category: category.slug, sub: sub.slug, score: ss + cs };
    }
    if (cs && (!best || cs > best.score)) best = { category: category.slug, sub: null, score: cs };
  }
  return best && { category: best.category, sub: best.sub };
}

// Mongo conditions for the words: every word must match the start of one of the ad's keywords
function wordFilter(query, mode = 'all') {
  const words = [...new Set(tokens(query))].slice(0, 8);
  if (!words.length) return { filter: {}, words };
  const rx = words.map((word) => new RegExp(`^${escapeRx(word)}`));
  if (mode === 'all') return { filter: { keywords: { $all: rx } }, words };
  // relaxed: any word, with long words cut short to forgive typos ("mattrass" -> "matt")
  const loose = words.map((word) => new RegExp(`^${escapeRx(word.length >= 6 ? word.slice(0, 4) : word)}`));
  return { filter: { keywords: { $in: loose } }, words };
}

// Search-box suggestions: categories, makes & models, counties
function suggestTerms(query, limit = 8) {
  const normalizeResult = normalize(query);
  if (normalizeResult.length < 2) return [];
  const words = normalizeResult.split(' ');
  const out = [];
  const seen = new Set();
  const push = (text) => {
    const key = text.type === 'make' || text.type === 'model' ? `${text.type}|${text.label}` : `${text.label}|${text.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  };
  const starts = (text) => {
    const currentNormalizeResult = normalize(text);
    return words.every((word) => currentNormalizeResult.split(' ').some((item) => item.startsWith(word)));
  };
  for (const category of CATEGORIES) {
    if (starts(category.name) || (category.synonyms || []).some(starts)) push({ type: 'category', label: category.name, icon: category.icon, href: `/market/${category.slug}` });
    for (const sub of category.subs) {
      if (starts(sub.name) || (sub.synonyms || []).some(starts)) push({ type: 'category', label: sub.name, hint: category.name, icon: category.icon, href: `/market/${category.slug}/${sub.slug}` });
      const makeField = (sub.fields || []).find((field) => field.type === 'make');
      if (!makeField || makeField.label.startsWith('Fits')) continue;
      for (const [mk, models] of Object.entries(makeField.makes)) {
        if (mk === 'Other') continue;
        if (starts(mk)) push({ type: 'make', label: `${mk}`, hint: sub.name, icon: category.icon, href: `/market/${category.slug}/${sub.slug}?make=${encodeURIComponent(mk)}` });
        for (const md of models) {
          if (starts(`${mk} ${md}`) || starts(md)) push({ type: 'model', label: `${mk} ${md}`, hint: sub.name, icon: category.icon, href: `/market/${category.slug}/${sub.slug}?make=${encodeURIComponent(mk)}&model=${encodeURIComponent(md)}` });
          if (out.length >= limit * 3) break;
        }
      }
    }
  }
  for (const county of COUNTIES) if (starts(county)) push({ type: 'place', label: `Ads in ${county}`, icon: '📍', href: `/market/search?county=${encodeURIComponent(county)}` });
  // exact category names first, then makes, then models
  const order = { category: 0, make: 1, model: 2, place: 3 };
  return out.sort((first, second) => order[first.type] - order[second.type]).slice(0, limit);
}

module.exports = { normalize, tokens, keywordsFor, wordFilter, parsePrice, detectCategory, suggestTerms, stem };
