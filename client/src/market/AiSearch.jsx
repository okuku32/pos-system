// ✨ AI search: ask in your own words ("cheapest Samsung phone under 20k", "sofa between 30k and 50k in Nairobi",
// "bei rahisi ya mchele chini ya elfu 5") — the cheapest matches pop up with their prices.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg, imgUrl, priceText } from './marketApi';
import { catIcon } from './ListingCard';

export const EXAMPLES = ['Cheapest Samsung phone under 50k', 'Best rice wholesaler near me', 'Track my order', 'Sofa between 30,000 and 80,000', 'I want to sell my car', 'TV under 30k', 'Bei rahisi ya sufuria chini ya elfu 2', 'Where are my chats?'];

// where the buyer is, if they shared it recently (saved by Maps.jsx); "near me" questions ask for it
const HERE_KEY = 'kapu_here';
function savedHere() {
  try {
    const here = JSON.parse(sessionStorage.getItem(HERE_KEY) || 'null');
    return here && Date.now() - here.at < 6 * 3600 * 1000 ? here : null;
  } catch {
    return null;
  }
}
const NEAR_WORDS = /\b(?:near(?:est| me| here)?|closest|nearby|around me|close to me|karibu)\b/i;
const SELLER_WORDS = /\b(?:wholesalers?|suppliers?|distributors?|stockists?|dealers?|sellers?|vendors?|shops?|traders?|msambazaji|wasambazaji|wauzaji|muuzaji)\b/i;
const METRICS = [['price', '🏷️', 'Price'], ['reliability', '✅', 'Reliability'], ['deliveries', '🚚', 'Deliveries'], ['location', '📍', 'Distance']];
const LEADS = { cheapest: 'price', best: 'reliability', reliable: 'reliability', nearest: 'location' };

// one ranked seller: overall score, why (badges), the four scores as bars, and their best matching offer
function SellerResult({ entry, rank, lead, lowest, onOpen }) {
  const { seller, best, scores, reasons } = entry;
  return (
    <li className={`mk-ai-seller ${rank === 1 ? 'top' : ''}`}>
      <div className="mk-ai-seller-head">
        <span className="mk-ai-rank">{rank}</span>
        <span className="mk-ai-avatar" aria-hidden="true">{seller.avatar ? <img src={imgUrl(seller.avatar)} alt="" /> : (seller.name || '?').slice(0, 1).toUpperCase()}</span>
        <span className="mk-ai-seller-name">
          <Link to={`/market/seller/${seller._id}`} onClick={onOpen}><b>{seller.name}</b>{seller.verified && <em className="mk-ai-verified" title="Verified seller">✔</em>}</Link>
          <small>{[seller.area, seller.county].filter(Boolean).join(', ')}{entry.items > 1 ? ` · ${entry.items} matching items` : ''}</small>
        </span>
        <span className="mk-ai-score" title="Overall score out of 100"><b>{entry.score}</b><small>/100</small></span>
      </div>
      <div className="mk-ai-tags">
        {rank === 1 && <span className="mk-ai-tag top">🏆 Best match</span>}
        {lowest && <span className="mk-ai-tag low">💰 Lowest price</span>}
        {reasons.slice(0, 5).map((reason) => <span key={reason.text} className={`mk-ai-tag ${reason.key === 'warning' ? 'warn' : ''} ${LEADS[lead] === reason.key ? 'lead' : ''}`}>{reason.text}</span>)}
      </div>
      <div className="mk-ai-bars">
        {METRICS.filter(([key]) => scores[key] != null).map(([key, icon, label]) => (
          <div key={key} className={`mk-ai-bar ${LEADS[lead] === key ? 'lead' : ''}`}>
            <span>{icon} {label}</span>
            <i role="meter" aria-label={`${label} score`} aria-valuenow={scores[key]} aria-valuemin={0} aria-valuemax={100}><s style={{ width: `${scores[key]}%` }} /></i>
            <b>{scores[key]}</b>
          </div>
        ))}
      </div>
      <Link to={`/market/item/${best.slug}`} className="mk-ai-offer" onClick={onOpen}>
        <span className="mk-ai-img">{best.image ? <img src={imgUrl(best.image)} alt="" loading="lazy" /> : catIcon(best.category)}</span>
        <span className="mk-ai-title"><small>Best offer</small><b>{best.title}</b></span>
        <span className="mk-ai-price">{best.unitPrice ? `${priceText(best.unitPrice)}${best.unit ? ` / ${best.unit}` : ''}` : priceText(best.price)}{best.fromQty && <small>from {best.fromQty} {best.unit}s</small>}</span>
      </Link>
    </li>
  );
}

// header: a "✨ Ask AI" button in the top bar that opens a small question box (the answers pop up as usual)
export default function AiSearch({ compact = false, header = false }) {
  const [input, setInput] = useState('');
  const [pop, setPop] = useState(false);
  const wrap = useRef(null);
  const field = useRef(null);
  useEffect(() => {
    if (!pop) return undefined;
    setTimeout(() => field.current?.focus(), 30);
    const close = (event) => wrap.current && !wrap.current.contains(event.target) && setPop(false);
    const onKey = (event) => event.key === 'Escape' && setPop(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [pop]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const closeBtn = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (innerError) => innerError.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => closeBtn.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = before;
    };
  }, [open]);
  const ask = async (text) => {
    const content = (text ?? input).trim();
    if (content.length < 2) return;
    setInput(content);
    setPop(false);
    setOpen(true);
    setBusy(true);
    setError('');
    setRes(null);
    try {
      // seller questions use the buyer's location for distance; "near me" asks for it once
      let here = savedHere();
      if (!here && NEAR_WORDS.test(content) && SELLER_WORDS.test(content)) here = await import('./Maps').then((maps) => maps.getHere()).catch(() => null);
      const data = (await api.get('/market/ai-search', { params: { q: content, ...(here ? { lat: here.lat, lng: here.lng } : {}) } })).data;
      // one page asked for ("track my order"): go straight there
      if (data.mode === 'go' && data.pages?.length === 1) {
        setOpen(false);
        setInput('');
        navigate(data.pages[0].to);
        return;
      }
      setRes(data);
    } catch (innerError) {
      setError(errMsg(innerError));
    } finally {
      setBusy(false);
    }
  };
  // the "Ask AI" chips in the top bar ask here (when this box is on the page)
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const onAsk = (event) => { event.preventDefault(); askRef.current(event.detail); };
    window.addEventListener('os:ai-ask', onAsk);
    return () => window.removeEventListener('os:ai-ask', onAsk);
  }, []);
  const understood = res?.understood;
  const exact = res?.items.filter((index) => index.match === 'exact') || [];
  const related = res?.items.filter((index) => index.match !== 'exact') || [];
  const row = (listing, number, best) => (
    <li key={listing._id} className={best ? 'best' : ''}>
      <Link to={`/market/item/${listing.slug}`} onClick={() => setOpen(false)}>
        <span className="mk-ai-rank">{number}</span>
        <span className="mk-ai-img">{listing.image ? <img src={imgUrl(listing.image)} alt="" loading="lazy" /> : catIcon(listing.category)}</span>
        <span className="mk-ai-title"><b>{listing.title}</b><small>{[listing.area, listing.county].filter(Boolean).join(', ')}{listing.buyNow ? ' · 🛒 buy online' : ''}</small>{listing.aiReason && <small className="mk-ai-reason">✨ {listing.aiReason}</small>}</span>
        <span className="mk-ai-price">{priceText(listing.price)}{best && <small>cheapest</small>}</span>
      </Link>
    </li>
  );
  const form = (
    <form className="mk-ai-form" onSubmit={(event) => { event.preventDefault(); ask(); }} role="search" aria-label="AI search">
      <span className="mk-ai-badge" aria-hidden="true">✨ AI</span>
      <input ref={field} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask: cheapest TV under 30k, or “track my order”" aria-label="Ask in your own words" maxLength={200} />
      <button className="os-btn os-btn-brand" disabled={busy || input.trim().length < 2}>{busy ? 'Thinking…' : 'Ask'}</button>
    </form>
  );
  return (
    <div className={`mk-ai ${compact ? 'compact' : ''} ${header ? 'in-header' : ''}`} ref={wrap}>
      {header ? (
        <>
          <button type="button" className={`os-ai-btn ${pop ? 'on' : ''}`} aria-expanded={pop} aria-haspopup="dialog" onClick={() => setPop((value) => !value)} title="Ask AI: search in your own words">
            <span aria-hidden="true">✨</span><span className="os-ai-btn-text">Ask AI</span>
          </button>
          {pop && (
            <div className="os-ai-pop" role="dialog" aria-label="Ask AI">
              {form}
              <small>Ask in your own words: “cheapest car”, “TV under 30k”, “bei rahisi ya mchele”, “track my order”</small>
            </div>
          )}
        </>
      ) : form}
      {open && createPortal(
        <div className="os os-portal">
          <div className="mk mk-ai-sheet" role="dialog" aria-modal="true" aria-label="AI search results">
            <button type="button" className="mk-ai-backdrop" aria-label="Close" tabIndex={-1} onClick={() => setOpen(false)} />
            <section className="mk-ai-panel">
              <header className="mk-ai-head">
                <div>
                  <small>✨ You asked: “{input}”</small>
                  <b>{busy ? 'Looking for the best prices…' : understood ? understood.summary : 'Search'}</b>
                </div>
                <button type="button" ref={closeBtn} className="mk-nearsheet-close" onClick={() => setOpen(false)}>✕ Close</button>
              </header>
              <div className="mk-ai-body" aria-live="polite">
                {busy && <div className="page-loading"><span className="page-spinner" /></div>}
                {error && <p className="mk-err-text">{error}</p>}
                {res?.pages?.length > 0 && (
                  <div className="mk-ai-go">
                    <p className="mk-ai-sub">{res.mode === 'go' ? 'Open a page' : 'Or go to'}</p>
                    {res.pages.map((page) => (
                      <Link key={page.key} to={page.to} className="mk-ai-golink" onClick={() => setOpen(false)}>
                        <span aria-hidden="true">{page.icon}</span><b>{page.label}</b><span aria-hidden="true">→</span>
                      </Link>
                    ))}
                  </div>
                )}
                {res && res.mode === 'sellers' && (
                  <>
                    <div className="mk-chips mk-ai-understood">
                      {understood.terms && <span>🔎 {understood.terms}</span>}
                      <span>{res.ranking.bulk ? '📦 Wholesalers' : '🏪 Sellers'}</span>
                      {understood.county && <span>📍 {understood.county}</span>}
                      {(understood.minPrice || understood.maxPrice) && <span>💰 {understood.minPrice && understood.maxPrice ? `${priceText(understood.minPrice)} – ${priceText(understood.maxPrice)}` : understood.maxPrice ? `under ${priceText(understood.maxPrice)}` : `over ${priceText(understood.minPrice)}`}</span>}
                    </div>
                    <p className="mk-ai-how">
                      Ranked by {METRICS.filter(([key]) => res.ranking.weights[key] && (key !== 'location' || res.ranking.locationUsed !== 'none')).sort((first, second) => res.ranking.weights[second[0]] - res.ranking.weights[first[0]]).map(([key, , label]) => `${label.toLowerCase()} ${Math.round(res.ranking.weights[key] * 100)}%`).join(' · ')}.
                      {' '}Reliability counts orders completed, buyers’ stars, delivery speed and a verified ID.
                      {res.ranking.locationUsed === 'none' && <> <button type="button" className="os-linkbtn" onClick={() => import('./Maps').then((maps) => maps.getHere()).then(() => ask(input)).catch(() => {})}>📍 Use my location</button> to add distance.</>}
                      {res.ranking.locationUsed === 'county' && ' Distance is judged by county.'}
                    </p>
                    {understood.widened && <p className="mk-ai-sub">No sellers in {understood.county} yet. These are the best from other counties.</p>}
                    {res.sellers.length > 0 ? (
                      <ol className="mk-ai-sellers">
                        {(() => {
                          const prices = res.sellers.map((entry) => entry.best.unitPrice).filter(Boolean);
                          const lowest = prices.length > 1 ? Math.min(...prices) : null;
                          return res.sellers.map((entry, index) => <SellerResult key={entry.seller._id} entry={entry} rank={index + 1} lead={res.ranking.lead} lowest={lowest != null && entry.best.unitPrice === lowest} onOpen={() => setOpen(false)} />);
                        })()}
                      </ol>
                    ) : (
                      <p className="os-muted">No {res.ranking.bulk ? 'wholesalers' : 'sellers'} found{understood.terms ? ` for “${understood.terms}”` : ''}. Try other words, or browse all wholesalers.</p>
                    )}
                  </>
                )}
                {res && res.mode === 'search' && (
                  <>
                    <div className="mk-chips mk-ai-understood">
                      {understood.terms && <span>🔎 {understood.terms}</span>}
                      {understood.categoryName && <span>📂 {understood.categoryName}</span>}
                      {(understood.minPrice || understood.maxPrice) && <span>💰 {understood.minPrice && understood.maxPrice ? `${priceText(understood.minPrice)} – ${priceText(understood.maxPrice)}` : understood.maxPrice ? `under ${priceText(understood.maxPrice)}` : `over ${priceText(understood.minPrice)}`}</span>}
                      {understood.county && <span>📍 {understood.county}</span>}
                      <span>↕ {{ cheapest: 'cheapest first', dearest: 'dearest first', newest: 'newest first', popular: 'most popular' }[understood.sort]}</span>
                    </div>
                    {understood.widened && <p className="mk-ai-sub">Nothing listed in that category right now. These are the closest matches from other categories.</p>}
                    {res.cheapest && (
                      <Link to={`/market/item/${res.cheapest.slug}`} className="mk-ai-best" onClick={() => setOpen(false)}>
                        <span className="mk-ai-img">{res.cheapest.image ? <img src={imgUrl(res.cheapest.image)} alt="" /> : catIcon(res.cheapest.category)}</span>
                        <span><small>🏷️ Cheapest match</small><b>{res.cheapest.title}</b><small>{[res.cheapest.area, res.cheapest.county].filter(Boolean).join(', ')}</small></span>
                        <strong>{priceText(res.cheapest.price)}</strong>
                      </Link>
                    )}
                    {exact.length > 0 && (
                      <>
                        <p className="mk-ai-sub">{res.exact} match{res.exact === 1 ? '' : 'es'}{res.range && exact.length > 1 ? `, from ${priceText(exact[0].price)} to ${priceText(exact[exact.length - 1].price)}` : ''}</p>
                        <ol className="mk-ai-list">{exact.map((item, index) => row(item, index + 1, !!res.cheapest && item._id === res.cheapest._id))}{/* by id: the AI may have reordered the list */}</ol>
                      </>
                    )}
                    {!exact.length && res.outside && (
                      <>
                        <p className="mk-ai-sub">Nothing {understood.maxPrice ? `under ${priceText(understood.maxPrice)}` : 'in that price range'}. The closest {res.outside.items.length === 1 ? 'one is' : 'ones are'}:</p>
                        <ol className="mk-ai-list">{res.outside.items.map((item, index) => row(item, index + 1, false))}</ol>
                      </>
                    )}
                    {related.length > 0 && (
                      <>
                        <p className="mk-ai-sub">Related{exact.length ? '' : ` (no exact “${understood.terms}” in this range)`}</p>
                        <ol className="mk-ai-list related">{related.slice(0, 6).map((item, index) => row(item, index + 1, false))}</ol>
                      </>
                    )}
                    {!res.items.length && !res.outside && <p className="os-muted">Nothing found. Try other words, or a wider price range.</p>}
                  </>
                )}
              </div>
              {res && res.mode !== 'go' && (
                <footer className="mk-nearsheet-foot">
                  <button type="button" className="os-btn os-btn-ghost" onClick={() => setOpen(false)}>← Back</button>
                  <Link className="os-btn os-btn-dark" to={res.link} onClick={() => setOpen(false)}>{res.mode === 'sellers' ? (res.ranking.bulk ? 'Browse all wholesale →' : 'See all items →') : `See all ${res.total} results →`}</Link>
                </footer>
              )}
            </section>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
