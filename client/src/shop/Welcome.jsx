// Shown once, on the first page after signing up: "Welcome to Kapu, <name>!"
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STORE_INFO } from './storeInfo';
import { KapuName } from '../components/BrandName';

export default function Welcome() {
  const [width, setWidth] = useState(null);
  useEffect(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem('kapu_welcome') || 'null');
      if (parsed?.name) setWidth(parsed);
    } catch {
      /* nothing saved */
    }
  }, []);
  if (!width) return null;
  const close = () => {
    try {
      sessionStorage.removeItem('kapu_welcome');
    } catch {
      /* private mode */
    }
    setWidth(null);
  };
  return (
    <div className="mk-wrap">
      <section className="mk-welcome" role="status" aria-live="polite">
        <span className="mk-welcome-emoji" aria-hidden="true">🎉</span>
        <div>
          <h2>Welcome to <KapuName />, {width.name}!</h2>
          <p>{STORE_INFO.tagline} {width.seller ? 'Post your first ad in a minute and reach buyers across Kenya.' : 'Find great deals near you, chat with sellers and pay safely with M-Pesa.'}</p>
        </div>
        <div className="mk-welcome-actions">
          {width.seller ? <Link to="/market/sell" className="os-btn os-btn-brand" onClick={close}>➕ Post your first ad</Link> : <Link to="/market/search" className="os-btn os-btn-brand" onClick={close}>🛍️ Start shopping</Link>}
          <Link to="/account" className="os-btn os-btn-ghost" onClick={close}>Complete your profile</Link>
        </div>
        <button type="button" className="mk-welcome-close" onClick={close} aria-label="Close">✕</button>
      </section>
    </div>
  );
}
