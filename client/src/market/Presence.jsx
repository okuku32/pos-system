// 🟢 Online / ⚪ Offline badge for sellers. All the sellers on a page are asked about in one request,
// refreshed every 45 seconds (and when the tab comes back into view).
import { useEffect, useState } from 'react';
import { api, timeAgo } from './marketApi';

const cache = new Map(); // seller id → { online, lastSeen, at }
const subs = new Map(); // seller id → Set of setState
let queue = new Set();
let timer = null;
const FRESH = 45 * 1000;

function flush() {
  timer = null;
  const ids = [...queue];
  queue = new Set();
  if (!ids.length) return;
  api.get('/market/presence', { params: { ids: ids.join(',') } }).then((response) => {
    const now = Date.now();
    for (const id of ids) {
      const value = response.data[id] ? { ...response.data[id], at: now } : { none: true, at: now }; // not a seller: no badge
      cache.set(id, value);
      for (const set of subs.get(id) || []) set(value);
    }
  }).catch(() => {});
}
function ask(id) {
  queue.add(id);
  if (!timer) timer = setTimeout(flush, 60);
}

export function usePresence(id) {
  const [value, setValue] = useState(() => (id ? cache.get(id) : null) || null);
  useEffect(() => {
    if (!id) return undefined;
    if (!subs.has(id)) subs.set(id, new Set());
    subs.get(id).add(setValue);
    const cacheEntry = cache.get(id);
    if (cacheEntry) setValue(cacheEntry);
    if (!cacheEntry || Date.now() - cacheEntry.at > FRESH) ask(id);
    const tick = setInterval(() => document.visibilityState === 'visible' && ask(id), FRESH);
    const onShow = () => document.visibilityState === 'visible' && Date.now() - (cache.get(id)?.at || 0) > 15000 && ask(id);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      subs.get(id)?.delete(setValue);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [id]);
  return value && !value.none ? value : null;
}

// compact: just the dot (lists); otherwise a small pill with the words
export default function Presence({ id, compact = false }) {
  const presence = usePresence(id);
  if (!presence) return null;
  // shops / wholesalers / sellers with opening hours: open right now by their normal hours?
  const shop = presence.open; // { open, label } or null (no hours set)
  const offline = presence.lastSeen ? `Offline · seen ${timeAgo(presence.lastSeen)}` : 'Offline';
  if (compact) {
    const on = presence.online || shop?.open;
    const label = [presence.online ? 'Online now' : offline, shop?.label].filter(Boolean).join(' · ');
    return <span className={`mk-dot ${on ? 'on' : 'off'}`} title={label} aria-label={label} role="img" />;
  }
  const pills = [];
  if (presence.online) pills.push(['on', 'Online now', 'Has the site open right now: expect a quick reply']);
  if (shop) pills.push([shop.open ? 'on' : 'off', shop.open ? shop.label.replace(/^Open ·/, 'Open now ·') : shop.label, shop.open ? 'Open now by their normal opening hours' : 'Outside their opening hours: you can still message them']);
  if (!pills.length) pills.push(['off', offline, 'You can still message or call; they’ll see it when they’re back']);
  return (
    <span className="mk-presence-set">
      {pills.map(([cls, text, title]) => (
        <span key={text} className={`mk-presence ${cls}`} title={title}><i aria-hidden="true" />{text}</span>
      ))}
    </span>
  );
}

// for an offline seller: a reassuring line next to the contact buttons
export function OfflineHint({ id, name }) {
  const presence = usePresence(id);
  if (!presence || presence.online) return null;
  const who = name ? name.split(' ')[0] : 'The seller';
  if (presence.open?.open) {
    return (
      <p className="mk-offline-hint">🏪 The shop is open now ({presence.open.label.replace(/^Open · /, '')}). {who}isn’t on the site at the moment: call, visit, or send a message and they’ll reply soon.
              </p>
    );
  }
  return (
    <p className="mk-offline-hint">
      💤 {who} is offline right now. You can still send a message, make an offer or call:
      we’ll notify them, and they’ll reply when they’re back.
    </p>
  );
}
