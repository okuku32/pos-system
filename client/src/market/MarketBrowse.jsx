import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errMsg, fieldsOf, findCat, findSub, priceText, useCategories, useSeo, adultOk, confirmAdult } from './marketApi';
import SearchBox from './SearchBox';
import ListingCard, { CardSkeletons } from './ListingCard';
import AdultGate from './AdultGate';
import './market.css';

const SORTS = [['newest', 'Newest first'], ['price-asc', 'Lowest price'], ['price-desc', 'Highest price'], ['popular', 'Most viewed']];

// One filter control, built from the category's field definition
function FieldFilter({ f, params, set }) {
  if (f.type === 'make') {
    const makes = Object.keys(f.makes);
    const make = params.get('make') || '';
    const models = make ? f.makes[make] || [] : [];
    return (
      <>
        <label className="mk-filter">
          <span>{f.label.replace(/^Fits /, '')}</span>
          <select value={make} onChange={(e) => set({ make: e.target.value, model: '' })}>
            <option value="">Any</option>
            {makes.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        {models.length > 0 && (
          <label className="mk-filter">
            <span>Model</span>
            <select value={params.get('model') || ''} onChange={(e) => set({ model: e.target.value })}>
              <option value="">Any {make}</option>
              {models.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
        )}
      </>
    );
  }
  if (f.filter === 'select' && f.options) {
    return (
      <label className="mk-filter">
        <span>{f.label}</span>
        <select value={params.get(f.key) || ''} onChange={(e) => set({ [f.key]: e.target.value })}>
          <option value="">Any</option>
          {f.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (f.filter === 'range' || f.filter === 'max') {
    return (
      <div className="mk-filter">
        <span>{f.label}</span>
        <div className="mk-range">
          {f.filter === 'range' && <NumberInput placeholder="Min" value={params.get(`${f.key}_min`)} onCommit={(v) => set({ [`${f.key}_min`]: v })} />}
          <NumberInput placeholder={f.filter === 'max' ? 'Up to' : 'Max'} value={params.get(`${f.key}_max`)} onCommit={(v) => set({ [`${f.key}_max`]: v })} />
        </div>
      </div>
    );
  }
  if (f.filter === 'text') {
    return (
      <label className="mk-filter">
        <span>{f.label}</span>
        <TextInput value={params.get(f.key)} onCommit={(v) => set({ [f.key]: v })} placeholder="Any" />
      </label>
    );
  }
  return null;
}

// Inputs that only apply when you leave the box or press Enter (no search on every keystroke)
function NumberInput({ value, onCommit, placeholder }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return <input inputMode="numeric" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))} onBlur={() => v !== (value || '') && onCommit(v)} onKeyDown={(e) => e.key === 'Enter' && onCommit(v)} />;
}
function TextInput({ value, onCommit, placeholder }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return <input placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value || '') && onCommit(v.trim())} onKeyDown={(e) => e.key === 'Enter' && onCommit(v.trim())} />;
}

export default function MarketBrowse() {
  const { cat: catSlug, sub: subSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const data = useCategories();
  const cat = findCat(data, catSlug);
  const sub = findSub(cat, subSlug);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adult, setAdult] = useState(adultOk);
  const q = params.get('q') || '';
  const page = Number(params.get('page') || 1);
  const key = `${catSlug || ''}/${subSlug || ''}?${params.toString()}`;

  useEffect(() => {
    let live = true;
    setError('');
    setRes((r) => (r ? { ...r, loading: true } : null));
    api
      .get('/market/listings', { params: { ...Object.fromEntries(params), category: catSlug, sub: subSlug } })
      .then((r) => live && setRes(r.data))
      .catch((e) => live && setError(errMsg(e)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // change filters in the address (so every filtered page has a shareable link) and go back to page 1
  const set = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v === '' || v === null || v === undefined ? next.delete(k) : next.set(k, v)));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: false });
  };
  const pageHref = (p) => {
    const next = new URLSearchParams(params);
    if (p > 1) next.set('page', p);
    else next.delete('page');
    const s = next.toString();
    return `${catSlug ? `/market/${catSlug}${subSlug ? `/${subSlug}` : ''}` : '/market/search'}${s ? `?${s}` : ''}`;
  };

  const make = params.get('make') || '';
  const model = params.get('model') || '';
  const county = params.get('county') || '';
  const what = [make, model, sub?.name || cat?.name].filter(Boolean).join(' ');
  const heading = q ? `Results for “${q}”` : what ? (/for (sale|rent|lease)/i.test(what) ? what : `${what} for sale`) : 'All ads';
  const where = county ? `in ${county}` : 'in Kenya';

  useSeo({
    title: q ? `${q}: ads for sale in Kenya` : `${heading} ${where}${page > 1 ? ` (page ${page})` : ''}`,
    description: res ? `${res.total.toLocaleString('en-KE')} ${(what || 'ads').toLowerCase()} ${where}. ${cat?.blurb || 'Search and chat with sellers.'}` : cat?.blurb,
    noindex: !!q || !catSlug,
    path: canonicalPath(),
  });

  // the canonical address keeps only what makes this a distinct page: make, model, county and page number
  function canonicalPath() {
    const c = new URLSearchParams();
    if (make) c.set('make', make);
    if (model) c.set('model', model);
    if (county) c.set('county', county);
    if (page > 1) c.set('page', page);
    const s = c.toString();
    return `${window.location.pathname}${s ? `?${s}` : ''}`;
  }

  const fields = useMemo(() => fieldsOf(cat, sub).filter((f) => f.filter || f.type === 'make'), [cat, sub]);
  const activeCount = [...params.keys()].filter((k) => !['q', 'sort', 'page'].includes(k)).length;
  const crumbs = [{ name: 'Marketplace', to: '/market' }];
  if (cat) crumbs.push({ name: cat.name, to: `/market/${cat.slug}` });
  if (sub) crumbs.push({ name: sub.name, to: `/market/${cat.slug}/${sub.slug}` });

  if (catSlug && data && !cat) {
    return (
      <div className="mk mk-wrap mk-empty-page">
        <h1>Category not found</h1>
        <p><Link to="/market">Back to the marketplace</Link></p>
      </div>
    );
  }
  if (cat?.adult && !adult) return <AdultGate onYes={() => { confirmAdult(); setAdult(true); }} />;

  const detected = res?.detected && !catSlug ? findSub(findCat(data, res.detected.category), res.detected.sub) : null;
  const detectedCat = res?.detected && !catSlug ? findCat(data, res.detected.category) : null;

  return (
    <div className="mk">
      <div className="mk-topsearch">
        <div className="mk-wrap"><SearchBox initial={q} /></div>
      </div>
      <div className="mk-wrap">
        <nav className="mk-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={c.to}>{i > 0 && ' › '}{i < crumbs.length - 1 || make ? <Link to={c.to}>{c.name}</Link> : c.name}</span>
          ))}
          {make && <span> › {[make, model].filter(Boolean).join(' ')}</span>}
        </nav>

        <div className="mk-browse-head">
          <div>
            <h1>{heading} <span className="mk-where">{where}</span></h1>
            <p className="mk-count" aria-live="polite">
              {res ? `${res.total.toLocaleString('en-KE')} ad${res.total === 1 ? '' : 's'}` : 'Searching…'}
              {res?.priceFromText && (res.priceFromText.min || res.priceFromText.max) && (
                <span className="mk-chip">
                  Price {res.priceFromText.min ? `from ${priceText(res.priceFromText.min)}` : ''} {res.priceFromText.max ? `up to ${priceText(res.priceFromText.max)}` : ''}
                </span>
              )}
            </p>
          </div>
          <div className="mk-browse-tools">
            <button className="os-btn os-btn-ghost mk-filter-btn" onClick={() => setFiltersOpen(true)}>⚙️ Filters{activeCount ? ` (${activeCount})` : ''}</button>
            <label className="mk-sort">
              <span className="sr-only">Sort</span>
              <select value={params.get('sort') || 'newest'} onChange={(e) => set({ sort: e.target.value === 'newest' ? '' : e.target.value })}>
                {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
        </div>

        {(detected || detectedCat) && (
          <Link className="mk-detected" to={`/market/${detectedCat.slug}${detected ? `/${detected.slug}` : ''}?q=${encodeURIComponent(q)}`}>
            {detectedCat.icon} Search only in <b>{detected?.name || detectedCat.name}</b> →
          </Link>
        )}

        <div className="mk-browse">
          <aside className={`mk-filters ${filtersOpen ? 'open' : ''}`} aria-label="Filters">
            <div className="mk-filters-head">
              <b>Filters</b>
              <button className="os-icon-btn" onClick={() => setFiltersOpen(false)} aria-label="Close filters">✕</button>
            </div>

            <div className="mk-filter-group">
              <span className="mk-filter-title">{cat ? (sub ? cat.name : 'Category') : 'Categories'}</span>
              <div className="mk-cat-list">
                {!cat && data?.categories.map((c) => (
                  <Link key={c.slug} to={`/market/${c.slug}${q ? `?q=${encodeURIComponent(q)}` : ''}`}>{c.icon} {c.name} <small>{c.count || ''}</small></Link>
                ))}
                {cat && (
                  <>
                    <Link to={`/market/${cat.slug}`} className={!sub ? 'on' : ''}>All {cat.name.toLowerCase()} <small>{cat.count || ''}</small></Link>
                    {cat.subs.map((s) => (
                      <Link key={s.slug} to={`/market/${cat.slug}/${s.slug}${q ? `?q=${encodeURIComponent(q)}` : ''}`} className={sub?.slug === s.slug ? 'on' : ''}>
                        {s.name} <small>{s.count || ''}</small>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="mk-filter-group">
              <label className="mk-filter">
                <span>County</span>
                <select value={county} onChange={(e) => set({ county: e.target.value })}>
                  <option value="">All of Kenya</option>
                  {data?.counties.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <div className="mk-filter">
                <span>Price (KSh)</span>
                <div className="mk-range">
                  <NumberInput placeholder="Min" value={params.get('minPrice')} onCommit={(v) => set({ minPrice: v })} />
                  <NumberInput placeholder="Max" value={params.get('maxPrice')} onCommit={(v) => set({ maxPrice: v })} />
                </div>
              </div>
              {cat?.condition && (
                <label className="mk-filter">
                  <span>Condition</span>
                  <select value={params.get('condition') || ''} onChange={(e) => set({ condition: e.target.value })}>
                    <option value="">Any</option>
                    {cat.condition.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {sub && fields.map((f) => <FieldFilter key={f.key} f={f} params={params} set={set} />)}
              {!sub && cat && <p className="mk-hint">Pick a type above for more filters (make, model, size…)</p>}
              <label className="mk-check">
                <input type="checkbox" checked={params.get('photos') === '1'} onChange={(e) => set({ photos: e.target.checked ? '1' : '' })} /> With photos only
              </label>
            </div>

            <div className="mk-filters-foot">
              {activeCount > 0 && <button className="os-btn os-btn-ghost" onClick={() => setParams(q ? { q } : {})}>Clear all</button>}
              <button className="os-btn os-btn-dark mk-only-mobile" onClick={() => setFiltersOpen(false)}>Show {res ? res.total.toLocaleString('en-KE') : ''} ads</button>
            </div>
          </aside>
          {filtersOpen && <div className="mk-filters-backdrop" onClick={() => setFiltersOpen(false)} />}

          <section className="mk-results" aria-busy={!res || res.loading}>
            {res?.relaxed && <p className="mk-note">No ad matches every word of “{q}”. Here are the closest matches.</p>}
            {error && <p className="mk-error">{error}</p>}
            <div className={`mk-grid ${res?.loading ? 'loading' : ''}`}>
              {res ? res.items.map((ad, i) => <ListingCard key={ad._id} ad={ad} index={i} />) : <CardSkeletons n={8} />}
            </div>
            {res && res.total === 0 && (
              <div className="os-empty">
                <div className="os-empty-art">🔎</div>
                <h4>No ads found</h4>
                <p>Try fewer words, another spelling, or remove some filters.</p>
                <div className="os-row center">
                  {activeCount > 0 && <button className="os-btn os-btn-ghost" onClick={() => setParams(q ? { q } : {})}>Clear filters</button>}
                  <Link className="os-btn os-btn-brand" to="/market/sell">Post an ad</Link>
                </div>
              </div>
            )}
            {res && res.pages > 1 && (
              <nav className="mk-pages" aria-label="Pages">
                {page > 1 && <Link to={pageHref(page - 1)} rel="prev">‹ Previous</Link>}
                {Array.from({ length: res.pages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === res.pages || Math.abs(p - page) <= 2)
                  .map((p, i, arr) => (
                    <span key={p}>
                      {i > 0 && p - arr[i - 1] > 1 && <span className="mk-dots">…</span>}
                      {p === page ? <b aria-current="page">{p}</b> : <Link to={pageHref(p)}>{p}</Link>}
                    </span>
                  ))}
                {page < res.pages && <Link to={pageHref(page + 1)} rel="next">Next ›</Link>}
              </nav>
            )}
          </section>
        </div>

        {cat && !sub && (
          <section className="mk-seo-text">
            <h2>About {cat.name.toLowerCase()} on the marketplace</h2>
            <p>{cat.blurb} Browse by type: {cat.subs.map((s, i) => <span key={s.slug}>{i > 0 && ', '}<Link to={`/market/${cat.slug}/${s.slug}`}>{s.name.toLowerCase()}</Link></span>)}.</p>
          </section>
        )}
      </div>
    </div>
  );
}
