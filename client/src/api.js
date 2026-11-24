import axios from 'axios';
import { flag, takeLegacy, withCsrf, isChange, serverAwake, noteServerAnswered } from './session';

// Staff login: an httpOnly session cookie (SameSite=Strict). localStorage only keeps a "signed in" hint.
const BASE = import.meta.env.VITE_API_URL || '/api';
const api = axios.create({ baseURL: BASE, withCredentials: true });
const STAFF_IN = 'kapu_staff_in';
export const staffSignedIn = () => flag.get(STAFF_IN);
export const setStaffSignedIn = (on) => flag.set(STAFF_IN, on);
// one time: the token an older admin panel kept in localStorage becomes a session cookie
let upgrade = null;
const upgradeOldLogin = () => {
  if (upgrade) return upgrade;
  const old = takeLegacy('pos_token');
  upgrade = !old
    ? Promise.resolve()
    : axios
        .post(`${BASE}/auth/session`, {}, { withCredentials: true, headers: { Authorization: `Bearer ${old}` } })
        .then(() => setStaffSignedIn(true))
        .catch(() => setStaffSignedIn(false));
  return upgrade;
};

// The staff login lives at a private link (/staff/<key>). Once opened, the server remembers the key on this device in
// an httpOnly, HTTPS-only cookie (page scripts can't read it); localStorage only keeps a "this device has the link" hint.
const GATE_HINT = 'kapu_staff_link';
const OLD_GATE_KEY = 'kapu_staff_gate'; // older versions kept the key itself here
export const staffGate = {
  has: () => {
    try {
      return localStorage.getItem(GATE_HINT) === '1';
    } catch {
      return false;
    }
  },
  set: () => {
    try {
      localStorage.setItem(GATE_HINT, '1');
    } catch { /* private mode */ }
  },
  clear: () => {
    try {
      localStorage.removeItem(GATE_HINT);
    } catch { /* private mode */ }
  },
};
// move an old key from localStorage into the cookie once, then delete it
try {
  const old = localStorage.getItem(OLD_GATE_KEY);
  if (old) {
    localStorage.removeItem(OLD_GATE_KEY);
    axios.get(`${BASE}/auth/gate`, { withCredentials: true, headers: { 'X-Staff-Gate': old } }).then(() => staffGate.set()).catch(() => {});
  }
} catch { /* private mode */ }
// where a signed-out staff member goes: their private login page (the cookie opens it), or the public site
export const staffLoginPath = () => (staffGate.has() ? '/staff' : '/');

api.interceptors.request.use(async (config) => {
  if (isChange(config)) await serverAwake(); // a sleeping server is woken first; the change itself is sent only once
  await upgradeOldLogin();
  withCsrf(config);
  return config;
});

api.interceptors.response.use(
  (res) => {
    noteServerAnswered();
    return res;
  },
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      setStaffSignedIn(false);
      if (window.location.pathname.startsWith('/admin')) window.location.href = staffLoginPath();
    }
    // a new or reset account must choose its own password first
    if (err.response?.data?.code === 'CHANGE_PASSWORD' && window.location.pathname.startsWith('/admin')) window.dispatchEvent(new Event('staff:change-password'));
    return Promise.reject(err);
  }
);

export const errMsg = (err) => err.response?.data?.message || err.message || 'Something went wrong';
export const money = (amount) =>
  'KSh ' + Number(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Download rows as a CSV file. columns: [{ label, value: (row) => any }]
export function downloadCSV(filename, columns, rows) {
  const esc = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const lines = [columns.map((column) => esc(column.label)).join(',')];
  rows.forEach((row) => lines.push(columns.map((column) => esc(column.value(row))).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const today = () => new Date().toLocaleDateString('en-CA');
export const daysAgo = (number) => {
  const date = new Date();
  date.setDate(date.getDate() - number);
  return date.toLocaleDateString('en-CA');
};

// the dashboard and the menu's badges both need the stats: share one request (fresh for 3 seconds)
let statsReq = null;
let statsAt = 0;
export function getAdminStats(fresh = false) {
  if (!fresh && statsReq && Date.now() - statsAt < 3000) return statsReq;
  statsAt = Date.now();
  statsReq = api.get('/admin/stats');
  statsReq.catch(() => {
    statsReq = null;
  });
  return statsReq;
}

export default api;
