// One React app, four ways to run it: desktop web, mobile web, installed PWA and the native Android app (Capacitor).
// Everything platform-specific lives here, so pages and components never need to know where they run.
//
//  • Web / PWA: the login is an httpOnly session cookie (page scripts can't read it).
//  • Android app: the page is served from https://localhost inside the app, so the API is another site and the
//    WebView may drop its cookies. There the login token is kept in the app's private storage (Capacitor
//    Preferences) and sent as "Authorization: Bearer"; the server accepts that (and CSRF doesn't apply to it).
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'
export const isStandalonePwa = () => !isNative && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

// ---------------------------------------------------------------- the app's login token (native only)
const TOKEN_KEY = 'kapu_app_token';
let token = null;
let loaded = null;
// (wrapped in an object: a Capacitor plugin returned straight from an async function is mistaken for a promise)
async function prefs() {
  const { Preferences } = await import('@capacitor/preferences');
  return { store: Preferences };
}
// read once at start-up; requests wait for it so the first call after opening the app is already logged in
export function tokenReady() {
  if (!isNative) return Promise.resolve(null);
  if (!loaded) loaded = prefs().then(({ store }) => store.get({ key: TOKEN_KEY })).then(({ value }) => { token = value || null; return token; }).catch(() => null);
  return loaded;
}
export const appToken = () => token;
export async function saveAppToken(value) {
  if (!isNative) return;
  token = value || null;
  loaded = Promise.resolve(token);
  try {
    const { store } = await prefs();
    if (token) await store.set({ key: TOKEN_KEY, value: token });
    else await store.remove({ key: TOKEN_KEY });
  } catch {
    /* storage unavailable: the token still works until the app closes */
  }
}

// ---------------------------------------------------------------- Android: the hardware back button
// back through the app's pages; on the home page it closes the app (what Android users expect)
export async function setupNativeShell() {
  if (!isNative) return;
  document.documentElement.classList.add('is-native', `is-${platform}`);
  tokenReady();
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      // an open sheet / menu closes first (they listen for Escape)
      const open = document.querySelector('.os-menu-wrap.open, .os-sellsheet-wrap.open, .mk-ai-sheet, .os-ai-pop, [role="dialog"][aria-modal="true"]');
      if (open) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      if (canGoBack && window.location.pathname !== '/') window.history.back();
      else App.exitApp();
    });
  } catch {
    /* plugin missing: Android's default back behaviour */
  }
}
