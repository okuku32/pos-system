import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// "Continue with Google" using Google Identity Services. Renders nothing until the server has a
// GOOGLE_CLIENT_ID configured. onCredential receives Google's signed ID token for the server to verify.
let configPromise = null;
let scriptPromise = null;

const getConfig = () => {
  configPromise =
    configPromise ||
    axios.get(`${import.meta.env.VITE_API_URL || '/api'}/auth/oauth-config`).then((r) => r.data).catch(() => ({ google: null }));
  return configPromise;
};

const loadScript = () => {
  scriptPromise =
    scriptPromise ||
    new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error('Could not load Google sign-in'));
      };
      document.head.appendChild(s);
    });
  return scriptPromise;
};

export default function GoogleButton({ onCredential, text = 'continue_with', width = 320, onUnavailable }) {
  const ref = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [state, setState] = useState('loading'); // loading | ready | off | error

  useEffect(() => {
    let alive = true;
    getConfig()
      .then(({ google: clientId }) => {
        if (!clientId) {
          if (alive) setState('off');
          onUnavailable?.();
          return null;
        }
        return loadScript().then(() => {
          if (!alive || !ref.current) return;
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (resp) => resp?.credential && cb.current(resp.credential),
            ux_mode: 'popup',
            context: 'signin',
          });
          ref.current.innerHTML = '';
          window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text, width, logo_alignment: 'left' });
          setState('ready');
        });
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, width]);

  if (state === 'off') return null;
  return (
    <div className="google-btn-wrap">
      <div ref={ref} className="google-btn" />
      {state === 'error' && <small className="muted">Google sign-in couldn’t load. Check your internet connection.</small>}
    </div>
  );
}

// Lets a page know whether to show an "or" divider
export const googleEnabled = () => getConfig().then((c) => !!c.google);
