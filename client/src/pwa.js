// Kapu as an app: the service worker (installable, fast, works on a weak connection) and "Install the app".
// Android / desktop Chrome & Edge: the browser's own install prompt. iPhone / iPad (Safari): Share → Add to Home Screen.
import { isNative } from './platform';
const listeners = new Set();
let deferred = null; // the browser's install prompt, kept until the person taps "Install"

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const installState = () => ({ canPrompt: !isNative && !!deferred, installed: isNative || isStandalone(), ios: !isNative && isIOS() && !isStandalone() });
export const onInstallChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const tell = () => listeners.forEach((fn) => fn(installState()));

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  tell();
  return outcome; // 'accepted' | 'dismissed'
}

export function startPwa() {
  if (isNative) return; // the Android app ships its files inside the app: no service worker, no install prompt
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // show our own "Install the app" button instead of the browser's banner
    deferred = event;
    tell();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    tell();
  });
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      // a new version was published: switch to it on the next page change (no interruption)
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) next.postMessage('skipWaiting');
        });
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000); // check for a new version every hour
    }).catch(() => {});
  });
  watchForNewVersion();
}

// A new version of the site was published while this tab (or the installed app) was open: the page would keep
// showing the old screens. Every few minutes and whenever the app comes back to the front, compare the app code
// this page runs with the code the server now sends; if it changed, the next page change loads the new version
// (and coming back to the app refreshes it straight away, unless someone is in the middle of a form).
const BUSY_PAGES = /^\/(checkout|market\/sell|market\/edit|login|signup|register|reset|staff|admin)/;
const BUNDLE = /\/assets\/index-[\w-]+\.js/;
function currentBundle() {
  return [...document.scripts].map((script) => script.src).find((src) => BUNDLE.test(src))?.match(BUNDLE)?.[0] || null;
}
function watchForNewVersion() {
  const mine = currentBundle();
  if (!mine) return;
  let stale = false;
  const check = async () => {
    if (stale || document.hidden) return;
    try {
      const html = await (await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } })).text();
      const latest = html.match(BUNDLE)?.[0];
      if (latest && latest !== mine) stale = true;
    } catch {
      /* offline: try again later */
    }
  };
  // the next page change is a full load of the new version (to the page they asked for)
  const original = window.history.pushState.bind(window.history);
  window.history.pushState = (state, title, url) => {
    if (stale && url) return window.location.assign(url);
    return original(state, title, url);
  };
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    await check();
    if (stale && !BUSY_PAGES.test(window.location.pathname)) window.location.reload();
  });
  setInterval(check, 5 * 60 * 1000);
  setTimeout(check, 30 * 1000);
}
