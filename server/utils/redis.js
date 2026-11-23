// Redis, optional. Set REDIS_URL (e.g. redis://localhost:6379 or rediss://user:pass@host:port) to run several
// copies of the server behind a load balancer. Redis then shares between them:
//   • the cache (and its invalidation)          utils/cache.js
//   • rate limits                                security/rateStore.js
//   • live messages (Socket.IO)                  utils/realtime.js
//   • who is online                              utils/presence.js
// Without REDIS_URL everything works on one server, in memory, exactly as before.
let factory = (url) => {
  const Redis = require('ioredis');
  return new Redis(url, { maxRetriesPerRequest: 2, enableAutoPipelining: true, connectionName: 'kapu' });
};
let injected = false;
let main = null;
const subs = [];
let warned = false;

const enabled = () => injected || !!process.env.REDIS_URL;

function watch(connection, label) {
  connection.on('error', (error) => {
    if (warned) return;
    warned = true; // once: Redis being down must not flood the log (the app falls back to memory)
    console.error(`[redis] ${label}: ${error.message}`);
  });
  connection.on('ready', () => { warned = false; });
  return connection;
}

// the shared connection for commands
function client() {
  if (!enabled()) return null;
  if (!main) main = watch(factory(process.env.REDIS_URL), 'connection');
  return main;
}
// a separate connection for subscribing (Redis requires it)
function subscriber() {
  if (!enabled()) return null;
  const connection = watch(client().duplicate(), 'subscriber');
  subs.push(connection);
  return connection;
}
// is it connected right now? (callers fall back to memory when not)
const ready = () => !!main && main.status === 'ready';

// tests: use an in-memory Redis
function useFactory(fn) {
  factory = fn;
  injected = true;
  main = null;
}
async function quit() {
  await Promise.all([main, ...subs].filter(Boolean).map((connection) => connection.quit().catch(() => {})));
  main = null;
  subs.length = 0;
}

module.exports = { enabled, client, subscriber, ready, useFactory, quit };
