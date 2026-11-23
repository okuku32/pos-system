import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearRecent, imgUrl, priceText, recentSearches, rememberSearch } from './marketApi';
import { catIcon } from './ListingCard';

// Search box with instant suggestions: categories, makes & models, places, and matching ads.
// Works with the keyboard (↑ ↓ Enter Esc) and remembers recent searches.
export default function SearchBox({ initial = '', big = false, autoFocus = false, placeholder }) {
  const navigate = useNavigate();
  const [currentInitial, setCurrentInitial] = useState(initial);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ terms: [], ads: [] });
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState(recentSearches);
  const box = useRef(null);
  const input = useRef(null);

  useEffect(() => setCurrentInitial(initial), [initial]);

  // fetch suggestions as they type (debounced)
  useEffect(() => {
    const text = currentInitial.trim();
    if (text.length < 2) {
      setData({ terms: [], ads: [] });
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.get('/market/suggest', { params: { q: text } }).then((response) => live && setData(response.data)).catch(() => {});
    }, 140);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [currentInitial]);

  useEffect(() => {
    const close = (event) => box.current && !box.current.contains(event.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const showRecent = currentInitial.trim().length < 2;
  const items = showRecent
    ? recent.map((item) => ({ kind: 'recent', label: item, href: `/market/search?q=${encodeURIComponent(item)}` }))
    : [
        ...data.terms.map((term) => ({ kind: 'term', ...term })),
        ...data.ads.map((ad) => ({ kind: 'ad', label: ad.title, href: `/market/item/${ad.slug}`, ad: ad })),
      ];

  const go = (href, remember) => {
    if (remember) rememberSearch(remember);
    setRecent(recentSearches());
    setOpen(false);
    input.current?.blur();
    navigate(href);
  };

  const submit = (event) => {
    event?.preventDefault();
    if (active >= 0 && items[active]) return go(items[active].href, items[active].kind === 'ad' ? null : currentInitial.trim() || items[active].label);
    const text = currentInitial.trim();
    if (!text) return input.current?.focus();
    go(`/market/search?q=${encodeURIComponent(text)}`, text);
  };

  const onKey = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((previousActive) => Math.min(items.length - 1, previousActive + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((previousActive) => Math.max(-1, previousActive - 1));
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const listOpen = open && items.length > 0;
  return (
    <form className={`mk-search ${big ? 'big' : ''}`} onSubmit={submit} role="search" ref={box}>
      <span className="mk-search-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </span>
      <input
        ref={input}
        type="search"
        value={currentInitial}
        onChange={(event) => {
          setCurrentInitial(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder || 'Search cars, plots, phones, sofas, spare parts…'}
        aria-label="Search the marketplace"
        autoComplete="off"
        enterKeyHint="search"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls="mk-suggest"
      />
      {currentInitial && (
        <button type="button" className="mk-search-clear" onClick={() => { setCurrentInitial(''); input.current?.focus(); }} aria-label="Clear search">✕</button>
      )}
      <button className="mk-search-btn" aria-label="Search">{big ? 'Search' : '→'}</button>

      {listOpen && (
        <div className="mk-suggest" id="mk-suggest" role="listbox">
          {showRecent && (
            <div className="mk-suggest-head">
              Recent searches
              <button type="button" onClick={() => { clearRecent(); setRecent([]); }}>Clear</button>
            </div>
          )}
          {items.map((it, index) => (
            <button
              type="button"
              key={`${it.kind}-${it.href}`}
              role="option"
              aria-selected={index === active}
              className={`mk-suggest-item ${index === active ? 'on' : ''} ${it.kind}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(it.href, it.kind === 'ad' ? null : it.kind === 'recent' ? it.label : currentInitial.trim())}
            >
              {it.kind === 'ad' ? (
                it.ad.image ? <img src={imgUrl(it.ad.image)} alt="" /> : <span className="mk-suggest-icon">{catIcon(it.ad.category)}</span>
              ) : (
                <span className="mk-suggest-icon">{it.kind === 'recent' ? '🕘' : it.icon}</span>
              )}
              <span className="mk-suggest-text">
                <b>{it.label}</b>
                {it.kind === 'ad' && <small>{priceText(it.ad.price)}</small>}
                {it.hint && <small>in {it.hint}</small>}
              </span>
            </button>
          ))}
          {!showRecent && (
            <button type="button" className="mk-suggest-all" onClick={() => submit()}>
              See all results for “{currentInitial.trim()}” →
            </button>
          )}
        </div>
      )}
    </form>
  );
}
