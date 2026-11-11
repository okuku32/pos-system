// Marketplace search: forgiving on purpose, so people find things however they type them.
//  - words can be partial ("toyo vit" finds Toyota Vitz) and in any order
//  - plurals and simple endings don't matter ("sofas" = "sofa", "mattresses" = "mattress")
//  - Swahili / everyday words work through category synonyms ("gari", "pikipiki", "shamba", "simu")
//  - price phrases are understood: "under 500k", "below 1.2m", "above 50,000", "50k-80k"
//  - nothing found with every word? It falls back to ads matching most of the words
const { CATEGORIES, COUNTIES, getCategory, getSub, fieldsFor } = require('./categories');

const STOP = new Set(['a', 'an', 'the', 'for', 'of', 'in', 'on', 'and', 'with', 'to', 'at', 'by', 'from', 'sale', 'selling', 'sell', 'buy', 'cheap', 'used', 'new', 'kenya', 'ya', 'na', 'kwa', 'za', 'la', 'is', 'my', 'i', 'want', 'looking', 'need']);

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9.+]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .trim();

// Very light stemming so singular/plural forms meet
function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

const tokens = (s) => normalize(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);

// The words an ad can be found by: title, category names and their synonyms, details (make, model, year...),
// condition and location. Stored on the ad (indexed) so searching is a fast index lookup.
function keywordsFor(listing) {
  const cat = getCategory(listing.category);
  const sub = getSub(listing.category, listing.sub);
  const parts = [listing.title, cat?.name, ...(cat?.synonyms || []), sub?.name, ...(sub?.synonyms || []), listing.condition, listing.county, listing.area];
  for (const f of fieldsFor(listing.category, listing.sub)) {
    const v = listing.attrs?.[f.key];
    if (v !== undefined && v !== null && v !== '' && f.type !== 'number') parts.push(String(v));
    if (f.key === 'year' && v) parts.push(String(v));
  }
  // a bit of the description too, so specific words ("leather", "sunroof", "beach") are findable
  parts.push(String(listing.description || '').slice(0, 600));
  return [...new Set(parts.flatMap((p) => tokens(p)).filter((w) => w.length > 1 || /\d/.test(w)))].slice(0, 400);
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "500k" -> 500000, "1.2m" -> 1200000, "50,000" -> 50000
function money(v) {
  const m = String(v).replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(k|m|mn|million|thousand|bob|ksh|kes|\/=)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || '';
  if (unit === 'k' || unit === 'thousand') return Math.round(n * 1000);
  if (unit.startsWith('m')) return Math.round(n * 1000000);
  return Math.round(n);
}

// Pull price phrases out of the query text
function parsePrice(raw) {
  let text = ` ${String(raw || '').toLowerCase().replace(/ksh\.?|kes|\/=/g, ' ')} `;
  let min = null;
  let max = null;
  const take = (rx, fn) => {
    text = text.replace(rx, (all, ...g) => {
      const ok = fn(...g);
      return ok ? ' ' : all;
    });
  };
  const N = '(\\d[\\d,]*(?:\\.\\d+)?\\s?(?:k|m|mn|million|thousand)?)';
  take(new RegExp(`\\b${N}\\s*(?:-|to)\\s*${N}\\b`, 'g'), (a, b) => {
    const x = money(a.replace(/\s/g, ''));
    const y = money(b.replace(/\s/g, ''));
    if (x === null || y === null || y < 100) return false;
    min = Math.min(x, y);
    max = Math.max(x, y);
    return true;
  });
  take(new RegExp(`\\b(?:under|below|less than|max|maximum|upto|up to|chini ya|<)\\s*${N}`, 'g'), (a) => {
    const v = money(a.replace(/\s/g, ''));
    if (v === null) return false;
    max = v;
    return true;
  });
  take(new RegExp(`\\b(?:above|over|more than|min|minimum|from|juu ya|>)\\s*${N}`, 'g'), (a) => {
    const v = money(a.replace(/\s/g, ''));
    if (v === null) return false;
    min = v;
    return true;
  });
  return { text: text.replace(/\s+/g, ' ').trim(), min, max };
}

// Which category / sub-category the words point at (used to suggest, and to rank)
function detectCategory(q) {
  const n = ` ${normalize(q)} `;
  // score = total length of the matching names/synonyms, so "soda crate" beats "crate" alone
  const score = (words) => words.reduce((sum, w) => {
    const t = normalize(w);
    return t && n.includes(` ${t} `) ? sum + t.length : sum;
  }, 0);
  let best = null;
  for (const c of CATEGORIES) {
    const cs = score([c.name, ...(c.synonyms || [])]);
    for (const s of c.subs) {
      const ss = score([s.name, ...(s.synonyms || [])]);
      if (ss && (!best || ss + cs > best.score)) best = { category: c.slug, sub: s.slug, score: ss + cs };
    }
    if (cs && (!best || cs > best.score)) best = { category: c.slug, sub: null, score: cs };
  }
  return best && { category: best.category, sub: best.sub };
}

// Mongo conditions for the words: every word must match the start of one of the ad's keywords
function wordFilter(q, mode = 'all') {
  const words = [...new Set(tokens(q))].slice(0, 8);
  if (!words.length) return { filter: {}, words };
  const rx = words.map((w) => new RegExp(`^${escapeRx(w)}`));
  if (mode === 'all') return { filter: { keywords: { $all: rx } }, words };
  // relaxed: any word, with long words cut short to forgive typos ("mattrass" -> "matt")
  const loose = words.map((w) => new RegExp(`^${escapeRx(w.length >= 6 ? w.slice(0, 4) : w)}`));
  return { filter: { keywords: { $in: loose } }, words };
}

// Search-box suggestions: categories, makes & models, counties
function suggestTerms(q, limit = 8) {
  const n = normalize(q);
  if (n.length < 2) return [];
  const words = n.split(' ');
  const out = [];
  const seen = new Set();
  const push = (s) => {
    const key = s.type === 'make' || s.type === 'model' ? `${s.type}|${s.label}` : `${s.label}|${s.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  };
  const starts = (text) => {
    const t = normalize(text);
    return words.every((w) => t.split(' ').some((x) => x.startsWith(w)));
  };
  for (const c of CATEGORIES) {
    if (starts(c.name) || (c.synonyms || []).some(starts)) push({ type: 'category', label: c.name, icon: c.icon, href: `/market/${c.slug}` });
    for (const s of c.subs) {
      if (starts(s.name) || (s.synonyms || []).some(starts)) push({ type: 'category', label: s.name, hint: c.name, icon: c.icon, href: `/market/${c.slug}/${s.slug}` });
      const makeField = (s.fields || []).find((f) => f.type === 'make');
      if (!makeField || makeField.label.startsWith('Fits')) continue;
      for (const [mk, models] of Object.entries(makeField.makes)) {
        if (mk === 'Other') continue;
        if (starts(mk)) push({ type: 'make', label: `${mk}`, hint: s.name, icon: c.icon, href: `/market/${c.slug}/${s.slug}?make=${encodeURIComponent(mk)}` });
        for (const md of models) {
          if (starts(`${mk} ${md}`) || starts(md)) push({ type: 'model', label: `${mk} ${md}`, hint: s.name, icon: c.icon, href: `/market/${c.slug}/${s.slug}?make=${encodeURIComponent(mk)}&model=${encodeURIComponent(md)}` });
          if (out.length >= limit * 3) break;
        }
      }
    }
  }
  for (const county of COUNTIES) if (starts(county)) push({ type: 'place', label: `Ads in ${county}`, icon: '📍', href: `/market/search?county=${encodeURIComponent(county)}` });
  // exact category names first, then makes, then models
  const order = { category: 0, make: 1, model: 2, place: 3 };
  return out.sort((a, b) => order[a.type] - order[b.type]).slice(0, limit);
}

module.exports = { normalize, tokens, keywordsFor, wordFilter, parsePrice, detectCategory, suggestTerms, stem };
