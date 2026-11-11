// Tiny in-memory cache, separate per client (tenant), for hot read-only data like the shop catalogue.
// Entries expire after `ttlMs` and are cleared immediately when the underlying data changes (invalidate()).
// For several servers behind a load balancer, swap this for Redis with the same get/set/invalidate calls.
const { currentTenant } = require('../tenancy/context');

const store = new Map(); // "<tenant>|<key>" -> { value, expires }
const MAX_ENTRIES = 5000;

const fullKey = (key) => `${currentTenant()?.slug || '-'}|${key}`;

async function cached(key, ttlMs, compute) {
  const k = fullKey(key);
  const hit = store.get(k);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await compute();
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // drop the oldest entry
  store.set(k, { value, expires: Date.now() + ttlMs });
  return value;
}

// Clear one client's entries whose key starts with `prefix` (e.g. 'catalog')
function invalidate(prefix = '') {
  clearPrefix(fullKey(prefix));
}
function clearPrefix(start) {
  for (const k of store.keys()) if (k.startsWith(start)) store.delete(k);
}

// Same as invalidate(), but works out the client NOW and clears later (e.g. after the response is sent,
// when the request's client context may no longer be available)
function invalidator(prefix = '') {
  const start = fullKey(prefix);
  return () => clearPrefix(start);
}

module.exports = { cached, invalidate, invalidator };
