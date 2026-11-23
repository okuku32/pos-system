// ✨ Ask AI for sellers: "what sells best in Nairobi under 5k?" → the best-selling commodities from the last 90 days
// (units sold, buyers who added them to a cart, ads competing, average price), with a short tip.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg, priceText } from './marketApi';
import { catIcon } from './ListingCard';

const EXAMPLES = ['What sells best in Nairobi?', 'Best selling phones under 30k', 'Which clothes sell fast?', 'Bidhaa gani zinauzika Mombasa?', 'Fresh produce demand in Kiambu'];

export default function SellerTrends() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const ask = async (text = input) => {
    const content = text.trim();
    setInput(content);
    setBusy(true);
    setError('');
    setAll(false);
    try {
      setRes((await api.get('/market/ai-trends', { params: content ? { q: content } : {} })).data);
    } catch (innerError) {
      setError(errMsg(innerError));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    ask('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const items = res?.items || [];
  const shown = all ? items : items.slice(0, 5);
  return (
    <section className="mk-trends" aria-label="What sells best">
      <div className="mk-trends-head">
        <b>✨ What sells best?</b>
        <small>Ask AI about demand before you stock or post</small>
      </div>
      <form className="mk-ai-form in-card" onSubmit={(event) => { event.preventDefault(); ask(); }} role="search" aria-label="Ask AI what sells best">
        <span className="mk-ai-badge" aria-hidden="true">✨ AI</span>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="e.g. best selling phones in Nairobi under 30k" aria-label="Ask what sells best" maxLength={200} />
        <button className="os-btn os-btn-brand" disabled={busy}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
      <div className="mk-ai-examples in-card" aria-label="Try">
        {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => ask(example)}>{example}</button>)}
      </div>
      <div aria-live="polite">
        {error && <p className="mk-err-text">{error}</p>}
        {busy && !res && <div className="page-loading"><span className="page-spinner" /></div>}
        {res && (
          <div className={busy ? 'mk-trends-busy' : ''}>
            <p className="mk-trends-summary">{res.summary}</p>
            {res.tip && <p className="mk-trends-tip">💡 {res.tip}</p>}
            {items.length === 0 ? (
              <p className="os-muted">No sales or interest for that yet. Try a wider area or price range.</p>
            ) : (
              <ol className="mk-trends-list">
                {shown.map((item, index) => (
                  <li key={`${item.category}/${item.sub}`}>
                    <Link to={`/market/${item.category}/${item.sub}`}>
                      <span className="mk-trends-rank">{index + 1}</span>
                      <span className="mk-trends-icon" aria-hidden="true">{catIcon(item.category)}</span>
                      <span className="mk-trends-name">
                        <b>{item.name}{item.tag === 'hot' && <em className="hot">🔥 Hot</em>}{item.tag === 'gap' && <em className="gap">🎯 Few sellers</em>}{item.mine && <em>You sell this</em>}</b>
                        <small>
                          {[item.units ? `${item.units} sold` : '', item.carts ? `${item.carts} in carts` : '', `${item.ads} ad${item.ads === 1 ? '' : 's'}`, item.views ? `${item.views.toLocaleString()} views` : ''].filter(Boolean).join(' · ')}
                        </small>
                        <span className="mk-trends-bar" aria-hidden="true"><i style={{ width: `${item.score}%` }} /></span>
                      </span>
                      <span className="mk-trends-price">{item.avgPrice ? <><small>avg</small>{priceText(item.avgPrice)}</> : ''}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            {items.length > 5 && (
              <button type="button" className="os-linkbtn mk-trends-more" onClick={() => setAll((previousAll) => !previousAll)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
