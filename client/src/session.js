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
export const withCsrf = (config) => {
  if (UNSAFE.test(config.method || 'get')) {
    const token = csrfToken();
    if (token) config.headers['X-CSRF-Token'] = token;
  }
  return config;
};
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
