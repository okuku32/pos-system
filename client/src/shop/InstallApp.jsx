// "📲 Get the app": installs Kapu on the phone or computer (Android, iPhone, Windows, Mac).
// variant: 'footer' | 'menu' | 'home' (the big button on the home page: shown to everyone who hasn't installed it)
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { installState, onInstallChange, promptInstall } from '../pwa';
import { STORE_INFO } from './storeInfo';

const isAndroid = () => /android/i.test(navigator.userAgent);

export default function InstallApp({ variant = 'footer' }) {
  const [state, setState] = useState(installState);
  const [help, setHelp] = useState(null); // 'ios' | 'android' | 'desktop'
  useEffect(() => onInstallChange(setState), []);
  if (state.installed) return null; // already using the app
  if (!state.canPrompt && !state.ios && variant !== 'home') return null; // small buttons: only where the browser can install
  const install = async () => {
    if (state.canPrompt) {
      const promptInstallResult = await promptInstall();
      if (promptInstallResult === 'accepted') toast.success(`${STORE_INFO.name} is on your home screen 🎉`);
      return;
    }
    setHelp(state.ios ? 'ios' : isAndroid() ? 'android' : 'desktop'); // the browser can't show its own box: show the steps
  };
  const steps = {
    ios: ['Tap the Share button ⬆️ at the bottom of Safari.', 'Scroll and tap Add to Home Screen ➕.', `Tap Add. The ${STORE_INFO.name} icon appears on your home screen.`],
    android: ['Open this page in Chrome.', 'Tap the menu ⋮ at the top right.', 'Tap Install app (or Add to Home screen), then Install.'],
    desktop: ['Open this page in Chrome or Edge.', 'Click the install icon ⊕ at the right end of the address bar (or menu ⋮ → Install Kapu).', `Click Install. ${STORE_INFO.name} opens in its own window.`],
  };
  return (
    <>
      {variant === 'home' ? (
        <section className="os-install-home" aria-label="Get the app">
          <span className="os-install-home-icon" aria-hidden="true"><img src="/icon-192.png" alt="" width="56" height="56" /></span>
          <span className="os-install-home-text">
            <b>Get the {STORE_INFO.name} app</b>
            <small>Free · opens instantly from your home screen · live order updates</small>
          </span>
          <button type="button" className="os-btn os-btn-brand" onClick={install}>📲 Download</button>
        </section>
      ) : (
        <button type="button" className={`os-install os-install-${variant}`} onClick={install}>
          <span aria-hidden="true">📲</span>
          <span><b>Get the {STORE_INFO.name} app</b><small>Free · opens instantly from your home screen</small></span>
        </button>
      )}
      {help && createPortal(
        <div className="os os-portal">
          <div className="os-install-sheet" role="dialog" aria-modal="true" aria-label="Install the app">
            <button type="button" className="os-install-backdrop" aria-label="Close" onClick={() => setHelp(null)} />
            <section>
              <h3>Add {STORE_INFO.name} to your {help === 'desktop' ? 'computer' : 'phone'}</h3>
              <ol>{steps[help].map((item) => <li key={item}>{item}</li>)}</ol>
              <button type="button" className="os-btn os-btn-brand os-block" onClick={() => setHelp(null)}>Got it</button>
            </section>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
