// Cache for hot read-only data (category counts, home page, sitemap, search summaries, admin totals).
//
//  • Level 1, always: in this server's memory. Entries expire after `ttlMs` and are cleared at once when the data
//    changes (invalidate()).
//  • With Redis (REDIS_URL, see utils/redis.js), for several servers behind a load balancer:
//      – invalidate() reaches every server (Redis pub/sub), so no server keeps showing old data;
//      – values cached with { shared: true } are also kept in Redis, so the first server to work one out saves
//        the others the database work. Only for plain JSON results (what's sent straight to the browser):
//        dates come back as Dates, database ids come back as text.
const redis = require('./redis');

const store = new Map(); // key -> { value, expires }
const MAX_ENTRIES = 5000;
const CHANNEL = 'kapu:cache:invalidate';
const PREFIX = 'kapu:cache:';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const fullKey = (key) => String(key);
const remember = (key, value, ttlMs) => {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // drop the oldest entry
  store.set(key, { value, expires: Date.now() + ttlMs });
};

// every server listens for "clear these" (once)
let listening = false;
function listen() {
  if (listening || !redis.enabled()) return;
  listening = true;
  const sub = redis.subscriber();
  sub.subscribe(CHANNEL).catch(() => { listening = false; });
  sub.on('message', (channel, prefix) => {
    if (channel === CHANNEL) clearLocal(prefix);
  });
}

async function cached(key, ttlMs, compute, { shared = false } = {}) {
  listen();
  const entryKey = fullKey(key);
  const hit = store.get(entryKey);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (shared && redis.ready()) {
    try {
      const raw = await redis.client().get(PREFIX + entryKey);
      if (raw != null) {
        const value = JSON.parse(raw, (name, item) => (typeof item === 'string' && ISO.test(item) ? new Date(item) : item));
        const left = await redis.client().pttl(PREFIX + entryKey);
        remember(entryKey, value, left > 0 ? Math.min(left, ttlMs) : ttlMs);
        return value;
      }
    } catch {
      /* Redis unavailable: work it out here */
    }
  }
  const value = await compute();
  remember(entryKey, value, ttlMs);
  if (shared && redis.ready()) redis.client().set(PREFIX + entryKey, JSON.stringify(value), 'PX', Math.max(1, Math.round(ttlMs))).catch(() => {});
  return value;
}

function clearLocal(start) {
  for (const key of store.keys()) if (key.startsWith(start)) store.delete(key);
}

// clear entries whose key starts with `prefix` (e.g. 'market:'), here and on every other server
function clearPrefix(start) {
  clearLocal(start);
  if (!redis.ready()) return;
  const client = redis.client();
  client.publish(CHANNEL, start).catch(() => {});
  // shared copies in Redis
  const stream = client.scanStream({ match: `${PREFIX}${start.replace(/[*?[\]]/g, '\\$&')}*`, count: 200 });
  stream.on('data', (keys) => { if (keys.length) client.unlink(...keys).catch(() => {}); });
  stream.on('error', () => {});
}
function invalidate(prefix = '') {
  clearPrefix(fullKey(prefix));
}

// Same as invalidate(), but works out the key NOW and clears later (e.g. after the response is sent)
function invalidator(prefix = '') {
  const start = fullKey(prefix);
  return () => clearPrefix(start);
}

module.exports = { cached, invalidate, invalidator };
