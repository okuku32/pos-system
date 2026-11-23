import { io } from 'socket.io-client';

// Same origin in dev (Vite proxies /socket.io); otherwise the API host from VITE_API_URL
const ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '') || undefined;

// auth: { token } for staff, { customerToken } for a shop customer, or { track } for one order.
// The connection starts on the next tick: React StrictMode (dev) mounts every effect twice and the first
// one is torn down immediately. Deferring means that throwaway mount never opens a socket, so Vite's
// proxy no longer logs "ws proxy socket error: ECONNABORTED" on every page load.
export function connectSocket(auth) {
  // tryAllTransports: if the WebSocket can't connect (some proxies, e.g. Vercel forwarding to our server, don't pass
  // it), fall back to long-polling (ordinary HTTP requests) instead of failing
  const socket = io(ORIGIN, { auth, transports: ['websocket', 'polling'], tryAllTransports: true, autoConnect: false, withCredentials: true });
  let closed = false;
  const timer = setTimeout(() => {
    if (!closed) socket.connect();
  }, 0);
  const disconnect = socket.disconnect.bind(socket);
  socket.disconnect = () => {
    closed = true;
    clearTimeout(timer);
    return disconnect();
  };
  return socket;
}

// Short two-tone chime made with Web Audio, so no sound file is needed
export function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const time = ctx.currentTime + index * 0.18;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.25, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio blocked: the visual notification still shows */
  }
}

// Desktop (OS-level) notification, shown even when the tab is in the background
export function desktopNotify(title, body, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, { body, tag: title + body });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
