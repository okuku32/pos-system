// Rate-limit counters. One server: in memory (express-rate-limit's default). Several servers (REDIS_URL): kept in
// Redis, so the limit is per visitor across all servers, not per server. Each limiter gets its own key prefix
// (they're created in the same order on every server, so the prefixes match).
const redis = require('../utils/redis');

let count = 0;
let warned = false;
module.exports = function rateStore() {
  count += 1;
  if (!redis.enabled()) return {};
  try {
    const { RedisStore } = require('rate-limit-redis');
    return {
      store: new RedisStore({ prefix: `kapu:rl:${count}:`, sendCommand: (command, ...args) => { const client = redis.client(); return typeof client.call === 'function' ? client.call(command, ...args) : client[String(command).toLowerCase()](...args); } }),
      passOnStoreError: true, // Redis down: let requests through rather than lock everyone out
    };
  } catch (error) {
    if (!warned) console.error('[rate limits] Redis store not available (run npm install), limits stay per server:', error.message);
    warned = true;
    return {};
  }
};
