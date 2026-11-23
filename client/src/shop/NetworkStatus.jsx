// The "you're offline" banner: shown when the phone / computer loses its connection or our server can't be reached,
// and "Back online" when it returns (live updates reconnect by themselves and the page refreshes its data).
import { useEffect, useRef, useState } from 'react';

export default function NetworkStatus() {
  const [state, setState] = useState(() => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'));
  const timer = useRef(null);
  useEffect(() => {
    const set = (online) => {
      if (!online) clearTimeout(timer.current); // (successful requests while "Back online" shows must not keep it up)
      setState((current) => {
        if (online && current === 'offline') {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState('online'), 2500);
          window.dispatchEvent(new Event('kapu:reconnected')); // pages reload what they show
          return 'back';
        }
        return online ? (current === 'back' ? 'back' : 'online') : 'offline';
      });
    };
    const onOnline = () => set(true);
    const onOffline = () => set(false);
    const onNetwork = (event) => set(!!event.detail?.online);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('kapu:network', onNetwork);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('kapu:network', onNetwork);
      clearTimeout(timer.current);
    };
  }, []);
  if (state === 'online') return null;
  return (
    <div className={`os-network ${state}`} role="status" aria-live="polite">
      {state === 'offline' ? '📡 You’re offline. We’ll reconnect by ourselves; what you see may be out of date.' : '✅ Back online'}
    </div>
  );
}
