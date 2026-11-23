import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, COLOUR_HEX, errMsg, fieldsOf, findCat, findSub, originBy, originsOf, priceText, useCategories, useSeo, adultOk, confirmAdult } from './marketApi';
import SearchBox from './SearchBox';
import { STORE_INFO } from '../shop/storeInfo';
import ListingCard, { CardSkeletons } from './ListingCard';
import AdultGate from './AdultGate';
import QuickFilters from './QuickFilters';
import { NearMeBar } from './Maps';
import { ImporterResults, isImporterQuery } from './Importers';
import './market.css';

const SORTS = [['newest', 'Newest first'], ['price-asc', 'Lowest price'], ['price-desc', 'Highest price'], ['popular', 'Most viewed'], ['discount', 'Biggest discount']];

// One filter control, built from the category's field definition
function FieldFilter({ f: field, params, set }) {
  if (field.key === 'colour') return null; // shown as colour swatches instead
  if (field.type === 'make') {
    const makes = Object.keys(field.makes);
    const make = params.get('make') || '';
    const models = make ? field.makes[make] || [] : [];
    return (
      <>
        <label className="mk-filter">
          <span>{field.label.replace(/^Fits /, '')}</span>
          <select value={make} onChange={(event) => set({ make: event.target.value, model: '' })}>
            <option value="">Any</option>
            {makes.map((currentMake) => <option key={currentMake}>{currentMake}</option>)}
          </select>
        </label>
        {models.length > 0 && (
          <label className="mk-filter">
            <span>Model</span>
            <select value={params.get('model') || ''} onChange={(event) => set({ model: event.target.value })}>
              <option value="">Any {make}</option>
              {models.map((model) => <option key={model}>{model}</option>)}
            </select>
          </label>
        )}
      </>
    );
  }
  if (field.filter === 'select' && field.options) {
    return (
      <label className="mk-filter">
        <span>{field.label}</span>
        <select value={params.get(field.key) || ''} onChange={(event) => set({ [field.key]: event.target.value })}>
          <option value="">Any</option>
          {field.options.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  if (field.filter === 'range' || field.filter === 'max') {
    return (
      <div className="mk-filter">
        <span>{field.label}</span>
        <div className="mk-range">
          {field.filter === 'range' && <NumberInput placeholder="Min" value={params.get(`${field.key}_min`)} onCommit={(event) => set({ [`${field.key}_min`]: event })} />}
          <NumberInput placeholder={field.filter === 'max' ? 'Up to' : 'Max'} value={params.get(`${field.key}_max`)} onCommit={(event) => set({ [`${field.key}_max`]: event })} />
        </div>
      </div>
    );
  }
  if (field.filter === 'text') {
    return (
      <label className="mk-filter">
        <span>{field.label}</span>
        <TextInput value={params.get(field.key)} onCommit={(event) => set({ [field.key]: event })} placeholder="Any" />
      </label>
    );
  }
  return null;
}

// Inputs that only apply when you leave the box or press Enter (no search on every keystroke)
function NumberInput({ value, onCommit, placeholder }) {
  const [entryValue, setEntryValue] = useState(value || '');
  useEffect(() => setEntryValue(value || ''), [value]);
  return <input inputMode="numeric" placeholder={placeholder} value={entryValue} onChange={(event) => setEntryValue(event.target.value.replace(/[^\d]/g, ''))} onBlur={() => entryValue !== (value || '') && onCommit(entryValue)} onKeyDown={(event) => event.key === 'Enter' && onCommit(entryValue)} />;
}
function TextInput({ value, onCommit, placeholder }) {
  const [entryValue, setEntryValue] = useState(value || '');
  useEffect(() => setEntryValue(value || ''), [value]);
  return <input placeholder={placeholder} value={entryValue} onChange={(event) => setEntryValue(event.target.value)} onBlur={() => entryValue !== (value || '') && onCommit(entryValue.trim())} onKeyDown={(event) => event.key === 'Enter' && onCommit(entryValue.trim())} />;
}

export default function MarketBrowse({ preset }) {
  const isWholesale = preset === 'wholesale';
  const isImports = preset === 'imports';
  const { origin: originParam } = useParams();
  const presetOrigin = isImports && originParam && originBy(originParam) ? originParam : '';
  const { cat: catSlug, sub: subSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const data = useCategories();
  const cat = findCat(data, catSlug);
  const sub = findSub(cat, subSlug);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adult, setAdult] = useState(adultOk);
  const value = params.get('q') || '';
  const page = Number(params.get('page') || 1);
  const key = `${preset || ''}:${presetOrigin}:${catSlug || ''}/${subSlug || ''}?${params.toString()}`;

  useEffect(() => {
    let live = true;
    setError('');
    setRes((previousRes) => (previousRes ? { ...previousRes, loading: true } : null));
    api
      .get('/market/listings', { params: { ...Object.fromEntries(params), category: catSlug, sub: subSlug, ...(isWholesale ? { wholesale: '1' } : {}), ...(isImports ? (presetOrigin ? { origin: presetOrigin } : { imported: '1' }) : {}) } })
      .then((response) => live && setRes(response.data))
      .catch((innerError) => live && setError(errMsg(innerError)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // change filters in the address (so every filtered page has a shareable link) and go back to page 1
  const set = (input) => {
    // colour and price are separate filters, never combined: choosing one clears the other
    const changes = { ...input };
    if (changes.colour) Object.assign(changes, { minPrice: '', maxPrice: '' });
    else if (changes.minPrice || changes.maxPrice) changes.colour = '';
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([entryKey, entryValue]) => (entryValue === '' || entryValue === null || entryValue === undefined ? next.delete(entryKey) : next.set(entryKey, entryValue)));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: false });
  };
  // how many ads a change of filters would give (for the price picker's button)
  const countWith = useCallback(
    (changes) => api.get('/market/listings', { params: { ...Object.fromEntries(params), ...changes, category: catSlug, sub: subSlug, ...(isWholesale ? { wholesale: '1' } : {}), ...(isImports ? (presetOrigin ? { origin: presetOrigin } : { imported: '1' }) : {}), limit: 1 } }).then((response) => response.data.total),
    [params, catSlug, subSlug, isWholesale, isImports, presetOrigin]
  );
  const pageHref = (entryValue) => {
    const next = new URLSearchParams(params);
    if (entryValue > 1) next.set('page', entryValue);
    else next.delete('page');
    const text = next.toString();
    return `${catSlug ? `/market/${catSlug}${subSlug ? `/${subSlug}` : ''}` : isWholesale ? '/wholesale' : isImports ? `/imports${presetOrigin ? `/${presetOrigin}` : ''}` : '/market/search'}${text ? `?${text}` : ''}`;
  };

  const make = params.get('make') || '';
  const model = params.get('model') || '';
  const county = params.get('county') || '';
  const colourWords = (params.get('colour') || '').split('|').filter(Boolean);
  const what = [colourWords.length && colourWords.length <= 2 ? colourWords.join(' & ') : '', make, model, sub?.name || cat?.name].filter(Boolean).join(' ');
  const heading = value ? `Results for “${value}”` : what ? (/for (sale|rent|lease)/i.test(what) ? what : `${what} for sale`) : isImports ? (presetOrigin ? (presetOrigin === 'local' ? 'Made in Kenya' : originBy(presetOrigin).label) : 'Imported goods') : params.get('origin') && originBy(params.get('origin')) ? `${originBy(params.get('origin')).label}${what ? ` · ${what}` : ''}` : isWholesale ? (res?.trade && res.trades ? `${res.trades.find((trade) => trade.key === res.trade.key)?.label || 'Wholesale & bulk deals'}` : 'Wholesale & bulk deals') : params.get('wholesale') === '1' ? 'Wholesale & bulk deals' : params.get('buyNow') === '1' ? 'Buy online' : params.get('sort') === 'discount' ? '🏷️ Best deals' : params.get('sort') === 'newest' ? '🆕 Latest arrivals' : 'All ads';
  const where = params.get('near') ? `within ${params.get('km') || 10} km of you` : county ? `in ${county}` : 'in Kenya';

  useSeo({
    title: value ? `${value}: ads for sale in Kenya` : isImports ? `${heading} in Kenya: ex-UK, China, Europe, USA, Japan & Dubai imports` : isWholesale ? `Wholesale & bulk deals in Kenya: buy at jumla prices${page > 1 ? ` (page ${page})` : ''}` : `${heading} ${where}${page > 1 ? ` (page ${page})` : ''}`,
    description: res ? `${res.total.toLocaleString('en-KE')} ${(what || 'ads').toLowerCase()} ${where}. ${cat?.blurb || 'Search and chat with sellers.'}` : cat?.blurb,
    noindex: !!value || (!catSlug && !isWholesale && !isImports),
    path: canonicalPath(),
  });

  // the canonical address keeps only what makes this a distinct page: make, model, county and page number
  function canonicalPath() {
    const currentParams = new URLSearchParams();
    if (make) currentParams.set('make', make);
    if (model) currentParams.set('model', model);
    if (county) currentParams.set('county', county);
    if (page > 1) currentParams.set('page', page);
    const text = currentParams.toString();
    return `${window.location.pathname}${text ? `?${text}` : ''}`;
  }

  const fields = useMemo(() => fieldsOf(cat, sub).filter((item) => item.filter || item.type === 'make'), [cat, sub]);
  const activeCount = [...params.keys()].filter((item) => !['q', 'sort', 'page'].includes(item)).length;
  const crumbs = [{ name: 'Home', to: '/' }];
  if (cat) crumbs.push({ name: cat.name, to: `/market/${cat.slug}` });
  if (sub) crumbs.push({ name: sub.name, to: `/market/${cat.slug}/${sub.slug}` });

  if (catSlug && data && !cat) {
    return (
      <div className="mk mk-wrap mk-empty-page">
        <h1>Category not found</h1>
        <p><Link to="/">Back to the marketplace</Link></p>
      </div>
    );
  }
  if (cat?.adult && !adult) return <AdultGate onYes={() => { confirmAdult(); setAdult(true); }} />;

  const detected = res?.detected && !catSlug ? findSub(findCat(data, res.detected.category), res.detected.sub) : null;
  const detectedCat = res?.detected && !catSlug ? findCat(data, res.detected.category) : null;

  return (
    <div className="mk">
      <div className="mk-topsearch">
        <div className="mk-wrap"><SearchBox initial={value} /></div>
      </div>
      <div className="mk-wrap">
        <nav className="mk-crumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
            <span key={crumb.to}>{index > 0 && ' › '}{index < crumbs.length - 1 || make ? <Link to={crumb.to}>{crumb.name}</Link> : crumb.name}</span>
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
              <select value={params.get('sort') || 'newest'} onChange={(event) => set({ sort: event.target.value === 'newest' ? '' : event.target.value })}>
                {(params.get('near') ? [['nearest', 'Nearest first'], ...SORTS] : SORTS).map(([entryKey, entryValue]) => <option key={entryKey} value={entryKey}>{entryValue}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* a type everyone asks for by name (Victoria fish: mbuta, ngege, obambo, mumi…): one tap to filter */}
        {fields.filter((field) => field.chips && field.options).map((field) => (
          <nav key={field.key} className="mk-origin-tabs mk-name-chips" aria-label={field.label}>
            <button type="button" className={!params.get(field.key) ? 'on' : ''} aria-pressed={!params.get(field.key)} onClick={() => set({ [field.key]: '' })}>All</button>
            {field.options.filter((option) => option !== 'Other').map((option) => (
              <button key={option} type="button" className={params.get(field.key) === option ? 'on' : ''} aria-pressed={params.get(field.key) === option} onClick={() => set({ [field.key]: option })}>
                <b>{option.replace(/\s*\(.*\)/, '')}</b>{/\(/.test(option) ? <small> {option.match(/\((.*)\)/)[1]}</small> : null}
              </button>
            ))}
          </nav>
        ))}

        {(isWholesale || isImports) && !catSlug && (
          <nav className="mk-origin-tabs mk-trade-tabs" aria-label={isWholesale ? 'What wholesalers sell' : 'What importers bring in'}>
            <button type="button" className={!params.get('trade') ? 'on' : ''} onClick={() => set({ trade: '' })}>{isWholesale ? '🏭 All wholesale' : '📦 All goods'}</button>
            {(res?.trades || (isWholesale ? STORE_INFO.trades?.wholesale : STORE_INFO.trades?.importer) || []).map((trade) => (
              <button key={trade.key} type="button" className={params.get('trade') === trade.key ? 'on' : ''} title={trade.about} onClick={() => set({ trade: trade.key })}>
                {trade.icon} {isWholesale ? trade.label : trade.name}{trade.n != null ? <small> {trade.n}</small> : null}
              </button>
            ))}
          </nav>
        )}
        {isImports && (
          <nav className="mk-origin-tabs" aria-label="Where it comes from">
            <Link to={`/importers${presetOrigin && presetOrigin !== 'local' ? `?origin=${presetOrigin}&latest=1` : ''}`} className="mk-imp-link">🚢 See the importers →</Link>
            <Link to="/imports" className={!presetOrigin ? 'on' : ''}>🌍 All imports</Link>
            {originsOf(data).map((item) => (
              <Link key={item.key} to={`/imports/${item.key}`} className={presetOrigin === item.key ? 'on' : ''}>{item.flag} {item.name}</Link>
            ))}
          </nav>
        )}
        {catSlug === 'spare-parts' && (!subSlug || ['car-parts', 'motorbike-parts', 'truck-parts'].includes(subSlug)) && <PartsFinder cat={cat} sub={subSlug} params={params} set={set} />}
        <NearMeBar params={params} set={set} wholesale={isWholesale} />
        <QuickFilters res={res} params={params} set={set} countWith={countWith} />

        {isWholesale && (
          <div className="mk-wholesale-intro">
            <span>🏭</span>
            <div>
              <b>Buy in bulk at bei ya jumla</b>
              <small>Cartons, bales, crates and bulk packs from wholesalers across Kenya. The more you buy, the lower the price per unit, applied automatically in your cart.</small>
            </div>
            <div className="mk-wholesale-intro-actions">
              <Link to="/wholesalers-near-me" className="os-btn os-btn-brand">📍 Wholesalers near me</Link>
              <Link to="/signup?as=seller" className="os-btn os-btn-light">Sell wholesale</Link>
            </div>
          </div>
        )}
        {value && isImporterQuery(value) && <ImporterResults q={value} preview />}
        {(detected || detectedCat) && (
          <Link className="mk-detected" to={`/market/${detectedCat.slug}${detected ? `/${detected.slug}` : ''}?q=${encodeURIComponent(value)}`}>
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
                {!cat && data?.categories.map((entryValue) => (
                  <Link key={entryValue.slug} to={`/market/${entryValue.slug}${value ? `?q=${encodeURIComponent(value)}` : ''}`}>{entryValue.icon} {entryValue.name} <small>{entryValue.count || ''}</small></Link>
                ))}
                {cat && (
                  <>
                    <Link to={`/market/${cat.slug}`} className={!sub ? 'on' : ''}>All {cat.name.toLowerCase()} <small>{cat.count || ''}</small></Link>
                    {cat.subs.map((subcategory) => (
                      <Link key={subcategory.slug} to={`/market/${cat.slug}/${subcategory.slug}${value ? `?q=${encodeURIComponent(value)}` : ''}`} className={sub?.slug === subcategory.slug ? 'on' : ''}>
                        {subcategory.name} <small>{subcategory.count || ''}</small>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="mk-filter-group">
              <label className="mk-filter">
                <span>County</span>
                <select value={county} onChange={(event) => set({ county: event.target.value })}>
                  <option value="">All of Kenya</option>
                  {data?.counties.map((entryValue) => <option key={entryValue}>{entryValue}</option>)}
                </select>
              </label>
              <div className="mk-filter">
                <span>Price (KSh)</span>
                <div className="mk-range">
                  <NumberInput placeholder="Min" value={params.get('minPrice')} onCommit={(event) => set({ minPrice: event })} />
                  <NumberInput placeholder="Max" value={params.get('maxPrice')} onCommit={(event) => set({ maxPrice: event })} />
                </div>
              </div>
              {cat?.condition && (
                <label className="mk-filter">
                  <span>Condition</span>
                  <select value={params.get('condition') || ''} onChange={(event) => set({ condition: event.target.value })}>
                    <option value="">Any</option>
                    {cat.condition.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              )}
              {!isImports && (!cat || cat.slug !== 'land-property') && (
                <label className="mk-filter">
                  <span>Where it’s from</span>
                  <select value={params.get('origin') || ''} onChange={(event) => set({ origin: event.target.value })}>
                    <option value="">Anywhere</option>
                    {originsOf(data).map((item) => <option key={item.key} value={item.key}>{item.flag} {item.label}</option>)}
                  </select>
                </label>
              )}
              {(res?.colours?.length > 0 || params.get('colour')) && (
                <div className="mk-filter">
                  <span>Colour{params.get('colour') ? ` · ${params.get('colour').split('|').length} chosen` : ''}</span>
                  <div className="mk-swatches" role="group" aria-label="Filter by colour">
                    {(res?.colours?.length ? res.colours : params.get('colour').split('|').map((name) => ({ name, n: 0 }))).map((colour) => {
                      const chosen = (params.get('colour') || '').split('|').filter(Boolean);
                      const on = chosen.includes(colour.name);
                      const next = on ? chosen.filter((item) => item !== colour.name) : [...chosen, colour.name];
                      return (
                        <button type="button" key={colour.name} className={`mk-swatch ${on ? 'on' : ''}`} aria-pressed={on} title={`${colour.name}${colour.n ? ` (${colour.n})` : ''}`} onClick={() => set({ colour: next.join('|') })}>
                          <i style={{ background: COLOUR_HEX[colour.name] || '#ddd' }} />
                          <span>{colour.name}</span>
                          {colour.n > 0 && <small>{colour.n}</small>}
                        </button>
                      );
                    })}
                  </div>
                  {params.get('colour') && <button type="button" className="os-linkbtn mk-swatch-clear" onClick={() => set({ colour: '' })}>Any colour</button>}
                </div>
              )}
              {sub && fields.map((field) => <FieldFilter key={field.key} f={field} params={params} set={set} />)}
              {!sub && cat && <p className="mk-hint">Pick a type above for more filters (make, model, size…)</p>}
              <label className="mk-check">
                <input type="checkbox" checked={params.get('buyNow') === '1'} onChange={(event) => set({ buyNow: event.target.checked ? '1' : '' })} /> 🛒 Buy online only (delivered)
              </label>
              {!isWholesale && (
                <label className="mk-check">
                  <input type="checkbox" checked={params.get('wholesale') === '1'} onChange={(event) => set({ wholesale: event.target.checked ? '1' : '' })} /> 🏭 Wholesale / bulk prices
                </label>
              )}
              <label className="mk-check">
                <input type="checkbox" checked={params.get('photos') === '1'} onChange={(event) => set({ photos: event.target.checked ? '1' : '' })} /> With photos only
              </label>
            </div>

            <div className="mk-filters-foot">
              {activeCount > 0 && <button className="os-btn os-btn-ghost" onClick={() => setParams(value ? { q: value } : {})}>Clear all</button>}
              <button className="os-btn os-btn-dark mk-only-mobile" onClick={() => setFiltersOpen(false)}>Show {res ? res.total.toLocaleString('en-KE') : ''} ads</button>
            </div>
          </aside>
          {filtersOpen && <div className="mk-filters-backdrop" onClick={() => setFiltersOpen(false)} />}

          <section className="mk-results" aria-busy={!res || res.loading}>
            {res?.relaxed && <p className="mk-note">No ad matches every word of “{value}”. Here are the closest matches.</p>}
            {error && <p className="mk-error">{error}</p>}
            <div className={`mk-grid ${res?.loading ? 'loading' : ''}`}>
              {res ? res.items.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />) : <CardSkeletons n={8} />}
            </div>
            {res && res.total === 0 && (
              <div className="os-empty">
                <div className="os-empty-art">🔎</div>
                <h4>No ads found</h4>
                <p>Try fewer words, another spelling, or remove some filters.</p>
                <div className="os-row center">
                  {activeCount > 0 && <button className="os-btn os-btn-ghost" onClick={() => setParams(value ? { q: value } : {})}>Clear filters</button>}
                  <Link className="os-btn os-btn-brand" to="/market/sell">Post an ad</Link>
                </div>
              </div>
            )}
            {res && res.pages > 1 && (
              <nav className="mk-pages" aria-label="Pages">
                {page > 1 && <Link to={pageHref(page - 1)} rel="prev">‹ Previous</Link>}
                {Array.from({ length: res.pages }, (_, index) => index + 1)
                  .filter((item) => item === 1 || item === res.pages || Math.abs(item - page) <= 2)
                  .map((item, index, arr) => (
                    <span key={item}>
                      {index > 0 && item - arr[index - 1] > 1 && <span className="mk-dots">…</span>}
                      {item === page ? <b aria-current="page">{item}</b> : <Link to={pageHref(item)}>{item}</Link>}
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
            <p>{cat.blurb}</p>
            <h3>Browse by type</h3>
            <nav className="mk-seo-links" aria-label={`${cat.name} types`}>
              {cat.subs.map((subcategory) => <Link key={subcategory.slug} to={`/market/${cat.slug}/${subcategory.slug}`}>{subcategory.name}</Link>)}
            </nav>
          </section>
        )}
      </div>
    </div>
  );
}

// Spare parts: pick your vehicle (make, model, year of manufacture) and see only the parts that fit it
function PartsFinder({ cat, sub, params, set }) {
  const field = (cat?.subs.find((text) => text.slug === (sub || 'car-parts'))?.fields || []).find((currentField) => currentField.key === 'make');
  const makes = field?.makes || {};
  const make = params.get('make') || '';
  const model = params.get('model') || '';
  const year = params.get('fitYear') || '';
  const years = Array.from({ length: new Date().getFullYear() + 1 - 1985 }, (_, index) => new Date().getFullYear() + 1 - index);
  const what = sub === 'motorbike-parts' ? 'motorbike' : sub === 'truck-parts' ? 'truck or bus' : 'car';
  const fitting = make && (model || year);
  return (
    <section className={`mk-parts-finder ${fitting ? 'on' : ''}`} aria-label={`Find parts for my ${what}`}>
      <b>🔧 Find parts for my {what}</b>
      <div className="mk-parts-row">
        <select value={make} onChange={(event) => set({ make: event.target.value, model: '' })} aria-label="Make">
          <option value="">Make</option>
          {Object.keys(makes).filter((key) => key !== 'Other').map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={model} onChange={(event) => set({ model: event.target.value })} disabled={!make || !makes[make]?.length} aria-label="Model">
          <option value="">Model</option>
          {(makes[make] || []).map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={year} onChange={(event) => set({ fitYear: event.target.value })} aria-label="Year of manufacture">
          <option value="">Year</option>
          {years.map((currentYear) => <option key={currentYear}>{currentYear}</option>)}
        </select>
        {(make || year) && <button type="button" className="os-linkbtn" onClick={() => set({ make: '', model: '', fitYear: '' })}>Clear</button>}
      </div>
      {fitting && <small>Showing parts that fit a {[year, make, model].filter(Boolean).join(' ')}. Check the part number with the seller before you buy.</small>}
    </section>
  );
}
