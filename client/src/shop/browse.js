// "I want to see the marketplace": remembered on this device, so the front page ("/") shows the marketplace home
// instead of the welcome page for visitors who haven't signed up (see Landing.jsx).
export const BROWSE_KEY = 'kapu_browse_market';
export const browsing = () => { try { return localStorage.getItem(BROWSE_KEY) === '1'; } catch { return false; } };
export const rememberBrowse = () => { try { localStorage.setItem(BROWSE_KEY, '1'); } catch { /* private mode: this visit only */ } };
