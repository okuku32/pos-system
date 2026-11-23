import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useShop } from './ShopContext';
import { useCategories } from '../market/marketApi';

// "+ Sell" pop-up: pick what you're selling in two taps, then go straight to the form
export default function SellSheet({ open, onClose }) {
  const data = useCategories();
  const { customer } = useShop();
  const navigate = useNavigate();
  const [cat, setCat] = useState(null);
  const [text, setText] = useState('');
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return;
    setCat(null);
    setText('');
    const esc = (error) => error.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    setTimeout(() => panel.current?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  // typing "sofa" or "phone" finds the right type in any category
  const matches = useMemo(() => {
    const input = text.trim().toLowerCase();
    if (!input || !data) return [];
    const out = [];
    for (const category of data.categories) {
      for (const sub of category.subs) if (`${sub.name} ${category.name}`.toLowerCase().includes(input)) out.push({ c: category, s: sub });
    }
    return out.slice(0, 12);
  }, [text, data]);

  const go = (value, input) => {
    onClose();
    navigate(`/market/sell?category=${value.slug}&sub=${input.slug}`);
  };

  return (
    <div className={`os-sellsheet-wrap ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="os-overlay" onClick={onClose} />
      <div className="os-sellsheet" role="dialog" aria-modal="true" aria-label="Post an ad" tabIndex={-1} ref={panel}>
        <div className="os-sellsheet-grab" aria-hidden="true" />
        <div className="os-sellsheet-head">
          {cat ? (
            <button type="button" className="os-sellsheet-back" onClick={() => setCat(null)} aria-label="Back to categories">←</button>
          ) : <span />}
          <h3>{cat ? <>{cat.icon} {cat.name}</> : 'What are you selling?'}</h3>
          <button type="button" className="os-sellsheet-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="os-sellsheet-body">
          {!cat && (
            <>
              <input className="os-sellsheet-search" type="search" placeholder="Type it: sofa, iPhone, plot, tyres…" value={text} onChange={(event) => setText(event.target.value)} />
              {text.trim() ? (
                <div className="os-sellsheet-subs">
                  {matches.map(({ c: match, s: found }) => (
                    <button type="button" key={match.slug + found.slug} onClick={() => go(match, found)}>
                      <span>{match.icon}</span><b>{found.name}</b><small>{match.name}</small>
                    </button>
                  ))}
                  {!matches.length && <p className="os-muted">Nothing matches. Pick a category below instead.</p>}
                </div>
              ) : null}
              {!text.trim() && (
                <div className="os-sellsheet-cats">
                  {data?.categories.map((value) => (
                    <button type="button" key={value.slug} onClick={() => setCat(value)}>
                      <span>{value.icon}</span>{value.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {cat && (
            <div className="os-sellsheet-subs">
              {cat.subs.map((sub) => (
                <button type="button" key={sub.slug} onClick={() => go(cat, sub)}>
                  <b>{sub.name}</b><span className="os-sellsheet-arrow">›</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="os-sellsheet-foot">
          {customer ? (
            <>
              <Link to="/market/my" onClick={onClose}>📋 My ads</Link>
              {customer.accountType === 'seller' && <Link to="/sales" onClick={onClose}>🏪 Seller dashboard</Link>}
            </>
          ) : (
            <span className="os-muted">Posting is free. You'll log in or sign up next.</span>
          )}
        </div>
      </div>
    </div>
  );
}
