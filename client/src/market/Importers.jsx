// 🚢 Importers: "chinese latest importer", "ex-UK furniture importers in Mombasa", "Dubai electronics new arrivals".
// The traders shown are worked out from their own live ads, and each comes with their latest matching items,
// so the seller and the goods always belong together.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errMsg, priceText, timeAgo, useSeo } from './marketApi';
import ListingCard, { CardSkeletons, AdImage } from './ListingCard';
import { Verified } from './Trust';
import Presence from './Presence';
import './market.css';

const EXAMPLES = ['Chinese latest importer', 'Ex-UK furniture importers in Mombasa', 'Dubai electronics new arrivals', 'Japanese car importers', 'Waagizaji wa nguo kutoka China'];

// does a search look like it's for importers? (same idea as the server's check)
const IMPORTER = /\b(importers?|imports?|imported|importing|waagizaji|muagizaji)\b/i;
const ORIGIN = /\b(chin(a|ese)|uchina|ex[- ]?uk|british|japan(ese)?|ex[- ]?japan|dubai|uae|american|usa|europe(an)?|turkish|italian|german)\b/i;
const TRADER = /\b(traders?|dealers?|sellers?|suppliers?|shops?|vendors?|stockists?|latest|new arrivals?|newest|just arrived)\b/i;
export const isImporterQuery = (importerQuery) => IMPORTER.test(importerQuery || '') || (ORIGIN.test(importerQuery || '') && TRADER.test(importerQuery || ''));

// one importer: who, where, what's new, and their latest matching items
function ImporterCard({ s: text }) {
  return (
    <article className="mk-imp-card">
      <header className="mk-imp-head">
        <Link to={`/market/seller/${text._id}`} className="mk-imp-who">
          <span className="mk-avatar">{(text.shop?.name || text.name).slice(0, 1)}</span>
          <span>
            <b>{text.shop?.name || text.name} {text.verified && <Verified small />}</b>
            <small>{text.shop?.name ? `${text.name} · ` : ''}📍 {[text.area, text.county].filter(Boolean).join(', ') || 'Kenya'}</small>
          </span>
        </Link>
        <Presence id={text._id} />
      </header>
      <div className="mk-imp-tags">
        {text.importer && <span className="mk-imp-tag imp">🚢 Importer</span>}
        {text.origins.map((origin) => <span key={origin.key} className="mk-imp-tag">{origin.flag} {origin.name}</span>)}
        {text.fresh > 0 && <span className="mk-imp-tag new">🆕 {text.fresh} new this week</span>}
        <span className="mk-imp-tag muted">Last arrival {timeAgo(text.newest)}</span>
      </div>
      <ul className="mk-imp-items">
        {text.items.map((item) => (
          <li key={item._id}>
            <Link to={`/market/item/${item.slug}`}>
              <AdImage ad={item} className="mk-imp-img" />
              <span className="mk-imp-title">{item.title}</span>
              <b>{priceText(item.price)}</b>
            </Link>
          </li>
        ))}
      </ul>
      <footer className="mk-imp-foot">
        <span>{text.ads} matching item{text.ads === 1 ? '' : 's'}{text.minPrice ? ` · from ${priceText(text.minPrice)}` : ''}</span>
        <Link to={`/market/seller/${text._id}`} className="os-btn os-btn-ghost">See all their goods →</Link>
      </footer>
    </article>
  );
}

// the results for a question; preview = a short version for the normal search page
export function ImporterResults({ q: query, preview = false, params = {} }) {
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const key = JSON.stringify([query, params]);
  useEffect(() => {
    let live = true;
    setError('');
    api.get('/market/importers', { params: { q: query, ...params } }).then((response) => live && setRes(response.data)).catch((innerError) => live && setError(errMsg(innerError)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (error) return <p className="mk-error">{error}</p>;
  if (!res) return preview ? null : <div className="mk-imp-list"><CardSkeletons n={3} /></div>;
  const list = preview ? res.sellers.slice(0, 3) : res.sellers;
  if (preview && !list.length) return null;
  return (
    <section className={`mk-imp ${preview ? 'preview' : ''}`} aria-label="Importers">
      <div className="mk-imp-summary">
        <b>🚢 {res.understood.summary}</b>
        <small>{res.total} trader{res.total === 1 ? '' : 's'} with matching goods{res.relaxed ? ` · nothing for “${res.understood.terms}” exactly, so here are the closest` : ''}</small>
      </div>
      {!preview && res.arrivals.length > 0 && (
        <>
          <h2 className="mk-subhead">🆕 Latest arrivals</h2>
          <div className="mk-grid mk-imp-arrivals">{res.arrivals.slice(0, 8).map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>
          <h2 className="mk-subhead">Importers</h2>
        </>
      )}
      {list.length ? (
        <div className="mk-imp-list">{list.map((item) => <ImporterCard key={item._id} s={item} />)}</div>
      ) : (
        <div className="os-empty"><div className="os-empty-art">🚢</div><h4>No importers found</h4><p>Try another country or trade, or remove the town.</p></div>
      )}
      {preview && res.total > list.length && (
        <Link to={`/importers?q=${encodeURIComponent(query)}`} className="os-btn os-btn-dark mk-imp-more">See all {res.total} importers →</Link>
      )}
      {!preview && res.pages > 1 && <Pager page={res.page} pages={res.pages} />}
    </section>
  );
}

function Pager({ page, pages }) {
  const [params, setParams] = useSearchParams();
  const go = (value) => { params.set('page', String(value)); setParams(params); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return (
    <nav className="mk-pager" aria-label="Pages">
      <button className="os-btn os-btn-ghost" disabled={page <= 1} onClick={() => go(page - 1)}>← Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="os-btn os-btn-ghost" disabled={page >= pages} onClick={() => go(page + 1)}>Next →</button>
    </nav>
  );
}

export default function Importers() {
  const [params, setParams] = useSearchParams();
  const value = params.get('q') || '';
  const [text, setText] = useState(value);
  const [chips, setChips] = useState(null);
  useEffect(() => setText(value), [value]);
  useSeo({
    title: value ? `${value}: importers in Kenya` : 'Importers in Kenya: Chinese, ex-UK, Dubai, ex-Japan goods',
    description: 'Find importers and traders of goods from China, the UK, Dubai, Japan, the USA and Europe, with their latest arrivals and prices.',
  });
  const filters = Object.fromEntries(['origin', 'trade', 'latest', 'county', 'page'].filter((item) => params.get(item) !== null).map((item) => [item, params.get(item)]));
  // chip counts (countries & trades) come with every answer
  useEffect(() => {
    api.get('/market/importers', { params: { q: value, ...filters, page: 1 } }).then((response) => setChips({ origins: response.data.origins, trades: response.data.trades, understood: response.data.understood })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);
  const set = (changes) => {
    const currentParams = new URLSearchParams(params);
    for (const [key, entryValue] of Object.entries(changes)) (entryValue === '' || entryValue == null ? currentParams.delete(key) : currentParams.set(key, entryValue));
    currentParams.delete('page');
    setParams(currentParams);
  };
  const understood = chips?.understood;
  // 'all' = the chip overrides what the words said
  const pick = (key, fromWords) => (params.get(key) === 'all' ? '' : params.get(key) ?? fromWords);
  const origin = pick('origin', understood?.origins?.length === 1 ? understood.origins[0] : '');
  const trade = pick('trade', understood?.trade || '');
  const latest = params.get('latest') ? params.get('latest') === '1' : !!understood?.latest;
  return (
    <div className="mk">
      <div className="mk-wrap">
        <div className="mk-imp-hero">
          <h1>🚢 Importers</h1>
          <p>Traders bringing in goods from China, the UK, Dubai, Japan, the USA and Europe, with their newest stock.</p>
          <form className="mk-ai-form in-card" role="search" onSubmit={(event) => { event.preventDefault(); setParams(text.trim() ? { q: text.trim() } : {}); }}>
            <span className="mk-ai-badge" aria-hidden="true">🔎</span>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="e.g. Chinese latest importer, ex-UK furniture Mombasa" aria-label="Search importers" maxLength={120} />
            <button className="os-btn os-btn-brand">Search</button>
          </form>
          <div className="mk-ai-examples in-card">{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setParams({ q: example })}>{example}</button>)}</div>
        </div>
        {chips && (
          <>
            <nav className="mk-origin-tabs" aria-label="Where the goods come from">
              <button type="button" className={!origin ? 'on' : ''} onClick={() => set({ origin: 'all' })}>🌍 All countries</button>
              {chips.origins.map((currentOrigin) => (
                <button key={currentOrigin.key} type="button" className={origin === currentOrigin.key ? 'on' : ''} onClick={() => set({ origin: currentOrigin.key })}>{currentOrigin.flag} {currentOrigin.name} <small>{currentOrigin.sellers}</small></button>
              ))}
            </nav>
            <nav className="mk-origin-tabs mk-trade-tabs" aria-label="What they import">
              <button type="button" className={!trade ? 'on' : ''} onClick={() => set({ trade: 'all' })}>📦 All goods</button>
              {chips.trades.map((currentTrade) => (
                <button key={currentTrade.key} type="button" className={trade === currentTrade.key ? 'on' : ''} title={currentTrade.about} onClick={() => set({ trade: currentTrade.key })}>{currentTrade.icon} {currentTrade.name} <small>{currentTrade.sellers}</small></button>
              ))}
            </nav>
            <label className="mk-imp-latest">
              <input type="checkbox" checked={latest} onChange={(event) => set({ latest: event.target.checked ? '1' : '0' })} /> 🆕 Latest arrivals first
            </label>
          </>
        )}
        <ImporterResults q={value} params={filters} />
      </div>
    </div>
  );
}

export { ImporterCard };
