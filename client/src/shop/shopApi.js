import axios from 'axios';

// Separate API client for the customer shop: its own token, and no redirect to the staff login
export const SHOP_TOKEN = 'ordersasa_token';
export const STORE = import.meta.env.VITE_STORE_NAME || 'Ordersasa';

const shopApi = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

shopApi.interceptors.request.use((config) => {
  try {
    const t = localStorage.getItem(SHOP_TOKEN);
    if (t) config.headers.Authorization = `Bearer ${t}`;
  } catch {
    /* storage unavailable */
  }
  return config;
});

export const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      if (v === undefined || v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

export const errMsg = (err) => err.response?.data?.message || err.message || 'Something went wrong';
export const ksh = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
// Price the customer pays (product discount applied by the server); falls back for old cached data
export const unitPrice = (p) => (p.salePrice ?? p.price);
export const isDiscounted = (p) => p.discountPercent > 0 && unitPrice(p) < p.price;

export const firstName = (name = '') => name.trim().split(/\s+/)[0] || '';
// 254712345678 -> 0712 345 678
export const prettyPhone = (p = '') => (/^254\d{9}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

export const STAGE = {
  new: { label: 'Order received', short: 'Received', icon: '🧾', msg: 'We’ve got your order and will confirm it in a moment.' },
  accepted: { label: 'Order confirmed', short: 'Confirmed', icon: '👍', msg: 'Your order is confirmed. We’re on it!' },
  preparing: { label: 'Packing your items', short: 'Packing', icon: '🛍️', msg: 'We’re picking and packing your items.' },
  ready: { label: 'Ready for pickup', short: 'Ready', icon: '✅', msg: 'Your order is ready! Come collect it and pay at the counter.' },
  'out-for-delivery': { label: 'On the way', short: 'On the way', icon: '🛵', msg: 'Your rider is on the way to you.' },
  completed: { label: 'Delivered', short: 'Done', icon: '🎉', msg: 'All done, thank you for shopping with Ordersasa!' },
  cancelled: { label: 'Cancelled', short: 'Cancelled', icon: '✖️', msg: 'This order was cancelled. Please contact us if this is unexpected.' },
};

// The status key a customer cares about
export const orderKey = (o) => (o.status === 'open' ? o.stage : o.status);

export function stepsFor(order) {
  const last = order.type === 'delivery' ? 'out-for-delivery' : 'ready';
  return ['new', 'accepted', 'preparing', last, 'completed'].map((k) => ({
    key: k,
    ...STAGE[k],
    label: k === 'completed' ? (order.type === 'delivery' ? 'Delivered' : 'Collected') : STAGE[k].label,
  }));
}

export default shopApi;
