// Logins live in an httpOnly cookie set by the server: page scripts never see the session token,
// so a malicious script can't steal it. Requests that change something carry the CSRF token
// (the os_csrf cookie, which other websites can't read), and localStorage only keeps a "signed in" hint.
export const csrfToken = () => {
  try {
    const match = document.cookie.match(/(?:^|;\s*)__Host-os_csrf=([^;]+)/) || document.cookie.match(/(?:^|;\s*)os_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
};
const UNSAFE = /^(post|put|patch|delete)$/i;
// a change that may wait for a sleeping server first (see serverAwake below)
export const isChange = (config) => UNSAFE.test(config.method || 'get');
export const withCsrf = (config) => {
  if (UNSAFE.test(config.method || 'get')) {
    const token = csrfToken();
    if (token) config.headers['X-CSRF-Token'] = token;
  }
  return config;
};
// ---------------------------------------------------------------- a sleeping server (Render's free plan)
// The server sleeps after 15 idle minutes and takes up to a minute to wake; a form sent meanwhile gets a 502 from the
// proxy in front of it. Changes (sign-up, orders, payments) must never be resent automatically (they could happen
// twice), so instead: before sending a change when the server hasn't answered for a while, wait until /health answers,
// then send the change exactly once.
const API_BASE = import.meta.env.VITE_API_URL || '/api';
const AWAKE_FOR_MILLISECONDS = 10 * 60 * 1000; // a server that answered in the last 10 minutes is surely still up
const WAKE_UP_LIMIT_MILLISECONDS = 90 * 1000; // a cold start takes about a minute: give up after 90 s
let lastServerAnswerAt = 0;
let wakingUp = null; // one shared wait, however many forms are sent at once
export const noteServerAnswered = () => { lastServerAnswerAt = Date.now(); };
const serverAnswers = () =>
  fetch(`${API_BASE}/health`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) })
    .then((response) => response.ok)
    .catch(() => false);
export function serverAwake() {
  if (Date.now() - lastServerAnswerAt < AWAKE_FOR_MILLISECONDS) return Promise.resolve();
  if (wakingUp) return wakingUp;
  wakingUp = (async () => {
    const giveUpAt = Date.now() + WAKE_UP_LIMIT_MILLISECONDS;
    let shownWaitingNotice = false;
    while (Date.now() < giveUpAt) {
      if (await serverAnswers()) { noteServerAnswered(); break; }
      // tell the page once (it can show "Starting up, one moment…") instead of an error
      if (!shownWaitingNotice) { window.dispatchEvent(new CustomEvent('kapu:server-waking')); shownWaitingNotice = true; }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    // after the limit the change is sent anyway: the page then shows the server's real answer or error
  })().finally(() => { wakingUp = null; });
  return wakingUp;
}
// opening the site starts waking the server, so it's usually up by the time a form is filled in
if (typeof window !== 'undefined') serverAnswers().then((answered) => answered && noteServerAnswered());

export const flag = {
  get: (key) => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  },
  set: (key, on) => {
    try {
      if (on) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  },
};
// a token saved by the version before session cookies: swapped once for a cookie, then forgotten
export function takeLegacy(key) {
  try {
    const value = localStorage.getItem(key);
    if (value) localStorage.removeItem(key);
    return value && value !== '1' ? value : null;
  } catch {
    return null;
  }
}
