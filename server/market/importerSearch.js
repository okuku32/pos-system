// Importer search: "chinese latest importer", "ex-UK furniture importers in Mombasa", "Dubai electronics new arrivals",
// "waagizaji wa nguo kutoka China" → which countries, which trade, newest first or not, where, and any product words.
// The traders found are the ones whose OWN ads match (so a seller and the items shown with them always belong together).
const { ORIGINS } = require('./origins');
const { COUNTIES } = require('./categories');
const trades = require('./trades');

// someone looking for importers / traders rather than one item
const IMPORTER_WORDS = /\b(importers?|imports?|imported|importing|import(?:ation)?s?|waagizaji|muagizaji|bidhaa za nje)\b/i;
const TRADER_WORDS = /\b(traders?|dealers?|sellers?|suppliers?|shops?|vendors?|wholesalers?|stockists?|wauzaji|maduka)\b/i;
const LATEST = /\b(latest|newest|new arrivals?|new stock|fresh stock|just (?:arrived|landed|in)|recent(?:ly)?|arrivals?|this week|mpya|zimefika|zimeingia)\b/i;
const CHEAP = /\b(cheapest|cheap|lowest price|bei (?:rahisi|nafuu)|affordable)\b/i;

// general words for a trade (specific products like "phone" or "sofa" stay as search words instead)
const TRADE_WORDS = [
  ['electronics', /\b(electronics?|gadgets?|appliances?|vifaa vya umeme)\b/i],
  ['clothes', /\b(clothes|clothing|mitumba|fashion|apparel|nguo|shoes?|bags?|viatu)\b/i],
  ['vehicles', /\b(cars?|vehicles?|motor ?vehicles?|spare ?parts?|spares|motorbikes?|magari|bicycles?)\b/i],
  ['furniture', /\b(furniture|home ?ware|beddings?|mattress(?:es)?|samani)\b/i],
  ['household', /\b(household|kitchenware|utensils|cosmetics|beauty|baby (?:goods|items)|toys|malimali)\b/i],
  ['food', /\b(food(?:stuffs?)?|drinks?|beverages?|wines?|spirits|liquor|chakula|vinywaji)\b/i],
];

// country words, longest first ("ex uk" before "uk"). Bare "us" only after "from" / "ex" (it's also an ordinary word).
const ORIGIN_WORDS = ORIGINS.filter((origin) => origin.key !== 'local')
  .flatMap((item) => item.words.filter((word) => word !== 'us').map((element) => [item.key, element]))
  .concat([['usa', 'from us'], ['usa', 'ex us'], ['china', 'kutoka china'], ['china', 'uchina'], ['japan', 'japani'], ['ex-uk', 'uingereza'], ['dubai', 'arabuni']])
  .sort((first, second) => second[1].length - first[1].length);

const STOP = new Set('a an the of for from in at near me my show find get i want need looking with and or to by any some all best top good kenya ksh goods products items stuff things bidhaa za wa ya kutoka us na who which that sell sells selling selling brings bring'.split(' '));

function parseImporterQuery(text) {
  let input = ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ')} `;
  const origins = [];
  for (const [key, value] of ORIGIN_WORDS) {
    const rx = new RegExp(`\\b${value.replace(/[-\s]+/g, '[-\\s]?')}\\b`, 'i');
    if (rx.test(input)) {
      if (!origins.includes(key)) origins.push(key);
      input = input.replace(rx, ' ');
    }
  }
  const latest = LATEST.test(input);
  const cheapest = CHEAP.test(input);
  let trade = null;
  for (const [key, rx] of TRADE_WORDS) {
    if (rx.test(input)) {
      trade = trade || key;
      input = input.replace(new RegExp(rx.source, 'gi'), ' ');
    }
  }
  let county = '';
  for (const currentCounty of COUNTIES) {
    const rx = new RegExp(`\\b${currentCounty.toLowerCase().replace(/[-\s]/g, '[-\\s]')}\\b`);
    if (rx.test(input)) {
      county = currentCounty;
      input = input.replace(rx, ' ');
      break;
    }
  }
  input = input.replace(new RegExp(IMPORTER_WORDS.source, 'gi'), ' ').replace(new RegExp(TRADER_WORDS.source, 'gi'), ' ')
    .replace(new RegExp(LATEST.source, 'gi'), ' ').replace(new RegExp(CHEAP.source, 'gi'), ' ');
  const terms = input.split(/\s+/).filter((item) => item.length > 1 && !STOP.has(item) && !/^\d+$/.test(item)).slice(0, 5).join(' ');
  return { origins, trade, latest, cheapest, county, terms };
}

// does a search look like it's for importers (and not just one item)?
const isImporterQuery = (text) => {
  const input = String(text || '');
  if (IMPORTER_WORDS.test(input)) return true;
  const importerQuery = parseImporterQuery(input);
  return !!importerQuery.origins.length && (TRADER_WORDS.test(input) || LATEST.test(input));
};

function describe(url) {
  const order = url.origins.map((origin) => ORIGINS.find((currentOrigin) => currentOrigin.key === origin)).filter(Boolean);
  const from = order.length ? order.map((item) => item.name).join(' & ') : 'abroad';
  const currentOf = url.trade ? trades.tradeOf('importer', url.trade) : null;
  const what = [url.terms, currentOf ? currentOf.name.toLowerCase() : ''].filter(Boolean).join(' ');
  const head = what ? `${what[0].toUpperCase()}${what.slice(1)} importers` : 'Importers';
  return `${head} from ${from}${url.county ? ` in ${url.county}` : ''}${url.latest ? ' · latest arrivals first' : url.cheapest ? ' · cheapest first' : ''}`;
}

module.exports = { parseImporterQuery, isImporterQuery, describe };
