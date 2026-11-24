import axios from 'axios';
import { flag, takeLegacy, withCsrf, isChange, serverAwake, noteServerAnswered } from '../session';
import { isNative, tokenReady, saveAppToken } from '../platform';

// API client for buyers and sellers. The login is an httpOnly session cookie (separate from the admin one);
// localStorage only remembers "signed in" so visitors don't make a pointless /me request.
export const SHOP_TOKEN = 'kapu_token'; // older versions kept the token here: upgraded once, then removed
const SIGNED_IN = 'kapu_signed_in';
export const signedIn = () => flag.get(SIGNED_IN);
export const setSignedIn = (on) => flag.set(SIGNED_IN, on);
export { STORE_INFO } from './storeInfo';

const BASE = import.meta.env.VITE_API_URL || '/api';
const shopApi = axios.create({ baseURL: BASE, withCredentials: true, timeout: 25000 });

// ---------------------------------------------------------------- weak or lost connections
// Reading (GET) is retried by itself: up to 2 more tries, 0.8 s then 2.4 s apart, when the connection dropped, timed out or
// the server was briefly unavailable (502 / 503 / 504). Changes (POST, PUT…) are never retried automatically, so an
// order or a payment can't happen twice. The page hears about it ("kapu:network") to show the offline banner.
const RETRY_STATUS = [502, 503, 504];
const tell = (online) => window.dispatchEvent(new CustomEvent('kapu:network', { detail: { online } }));
export const isNetworkError = (error) => !error.response && (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || /network|timeout/i.test(error.message || ''));
shopApi.interceptors.response.use(
  (res) => {
    tell(true);
    noteServerAnswered(); // the server is up: changes in the next minutes go straight through
    return res;
  },
  async (error) => {
    const config = error.config;
    const retryable = config && (config.method || 'get').toLowerCase() === 'get' && (isNetworkError(error) || RETRY_STATUS.includes(error.response?.status));
    if (isNetworkError(error)) tell(false);
    if (!retryable || (config.__tries || 0) >= 2 || (typeof navigator !== 'undefined' && navigator.onLine === false && (config.__tries || 0) >= 1)) return Promise.reject(error);
    config.__tries = (config.__tries || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 800 * 3 ** (config.__tries - 1)));
    return shopApi(config);
  }
);

// one time: a token from before session cookies becomes a cookie (the browser stays logged in)
let upgrade = null;
const upgradeOldLogin = () => {
  if (upgrade) return upgrade;
  const old = takeLegacy(SHOP_TOKEN);
  upgrade = !old
    ? Promise.resolve()
    : axios
        .post(`${BASE}/customers/session`, {}, { withCredentials: true, headers: { Authorization: `Bearer ${old}` } })
        .then(() => setSignedIn(true))
        .catch(() => setSignedIn(false));
  return upgrade;
};

shopApi.interceptors.request.use(async (config) => {
  if (isChange(config)) await serverAwake(); // a sleeping server is woken first; the change itself is sent only once
  if (isNative) {
    // the Android app: the login token from the app's private storage (see platform.js)
    const token = await tokenReady();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  }
  await upgradeOldLogin();
  return withCsrf(config);
});
shopApi.interceptors.response.use(
  (res) => res,
  (err) => {
    // the session ended (logged out elsewhere, password changed, expired)
    if (err.response?.status === 401 && !/\/customers\/(login|register|oauth|reset|forgot|session)/.test(err.config?.url || '')) {
      const was = signedIn();
      setSignedIn(false);
      if (isNative) saveAppToken(null);
      if (was) window.dispatchEvent(new Event('kapu:signed-out')); // the app forgets the account at once
    }
    return Promise.reject(err);
  }
);

export const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === undefined || value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

export const errMsg = (err) => err.response?.data?.message || (isNetworkError(err) ? 'No internet connection. Check your connection and try again.' : err.message) || 'Something went wrong';
export const ksh = (amount) => 'KSh ' + Number(amount || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
export const firstName = (name = '') => name.trim().split(/\s+/)[0] || '';
// 254712345678 -> 0712 345 678
export const prettyPhone = (phone = '') => (/^254\d{9}$/.test(phone) ? `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : phone);

// Marketplace order statuses, as buyers and sellers see them
export const ORDER_STATUS = {
  awaiting_payment: { label: 'Waiting for payment', short: 'Unpaid', icon: '⏳', tone: 'wait' },
  placed: { label: 'Order placed', short: 'Placed', icon: '🧾', tone: 'new' },
  confirmed: { label: 'Confirmed by the seller', short: 'Confirmed', icon: '👍', tone: 'go' },
  shipped: { label: 'On the way', short: 'Shipped', icon: '🚚', tone: 'go' },
  delivered: { label: 'Delivered', short: 'Delivered', icon: '🎉', tone: 'done' },
  cancelled: { label: 'Cancelled', short: 'Cancelled', icon: '✖️', tone: 'off' },
};
export const statusLabel = (order) => (order.status === 'shipped' && order.delivery?.method === 'pickup' ? 'Ready for pickup' : ORDER_STATUS[order.status]?.label || order.status);
export const isOpenOrder = (order) => ['placed', 'confirmed', 'shipped'].includes(order.status);

export default shopApi;
