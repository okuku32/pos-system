// Wholesalers and importers (sign-up and My account): tapping "Wholesaler" or "Importer" opens a pop-up to choose
// the categories they deal in (our market categories) and, for importers, the countries they import from.
// Importers who tick Vehicles are asked the makes and models; Spare parts, the kinds of parts. A "Your imports" box at
// the top reads it all back, rewritten after every tap.
// The chosen trade shows as a card under the seller kinds, with "Edit". Rules: tradeRules.js (unit-tested).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { pickTrade, findCountries, importSummary, vehicleMakes, spareTypes, MAX_COUNTRIES, MAX_VEHICLES } from './tradeRules';
import { MAX_CATEGORIES } from './sellerItems';

const KIND = {
  wholesaler: { icon: '🏭', name: 'Wholesaler', field: 'wholesale', ask: 'What do you sell wholesale (jumla)?', hint: 'Buyers looking for wholesalers of these find you first.', none: 'I’m not a wholesaler' },
  importer: { icon: '🌍', name: 'Importer', field: 'imports', ask: 'What do you import?', hint: 'Buyers looking for importers of these find you first.', none: 'I’m not an importer' },
};

// what an importer still has to answer ('' when complete)
const importerMissing = (trade) => (!trade.imports.length ? 'Choose at least one category'
  : trade.imports.includes('vehicles') && !trade.vehicles.length ? 'Choose the vehicle models you import'
    : trade.imports.includes('spare-parts') && !trade.spares.length ? 'Choose the types of spare parts you import'
      : !trade.importFrom.length ? 'Choose at least one country' : '');

// Vehicles: tap a make, then tick its models (or "All models")
function VehicleModels({ makes, chosen, onPick }) {
  const [make, setMake] = useState(() => chosen[0]?.split('/')[0] || '');
  const count = (name) => chosen.filter((key) => key.startsWith(`${name}/`)).length;
  const all = chosen.includes(`${make}/*`);
  return (
    <>
      <div className="os-types-list os-trade-makes" role="group" aria-label="Vehicle makes">
        {Object.keys(makes).map((name) => (
          <button type="button" key={name} className={[make === name ? 'open' : '', count(name) ? 'on' : ''].join(' ').trim()} aria-expanded={make === name} onClick={() => setMake(make === name ? '' : name)}>
            {name}{count(name) ? <b className="os-types-count">{chosen.includes(`${name}/*`) ? 'all' : count(name)}</b> : null}
          </button>
        ))}
      </div>
      {make && makes[make] && (
        <div className="os-trade-models">
          <p>{make} models you import or have:</p>
          <div className="os-types-list" role="group" aria-label={`${make} models`}>
            <button type="button" className={`os-types-all ${all ? 'on' : ''}`} aria-pressed={all} onClick={() => onPick('vehicles', `${make}/*`, MAX_VEHICLES)}>{all ? '✓ ' : ''}All {make} models</button>
            {makes[make].map((model) => {
              const on = chosen.includes(`${make}/${model}`);
              return <button type="button" key={model} className={on ? 'on' : ''} aria-pressed={on} onClick={() => onPick('vehicles', `${make}/${model}`, MAX_VEHICLES)}>{on ? '✓ ' : ''}{model}</button>;
            })}
          </div>
        </div>
      )}
    </>
  );
}

export function TradePopup({ kind, categories, countries, trade, onPick, onRemove, onClose }) {
  const info = KIND[kind];
  const panel = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [text, setText] = useState('');
  // once when it opens: Esc closes, focus moves in, the page behind doesn't scroll
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector('.os-types-list button')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []);
  const chosen = trade[info.field];
  const importer = kind === 'importer';
  const askVehicles = importer && chosen.includes('vehicles');
  const askSpares = importer && chosen.includes('spare-parts');
  // Vehicles / Spare parts just ticked: bring its question into view
  const vehiclesRef = useRef(null);
  const sparesRef = useRef(null);
  const asked = useRef({ vehicles: askVehicles, spares: askSpares });
  useEffect(() => {
    if (askVehicles && !asked.current.vehicles) vehiclesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (askSpares && !asked.current.spares) sparesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    asked.current = { vehicles: askVehicles, spares: askSpares };
  }, [askVehicles, askSpares]);
  const shown = findCountries(countries, text, trade.importFrom);
  const parts = askSpares ? spareTypes(categories) : [];
  const missing = importer ? importerMissing(trade) : !chosen.length ? 'Choose at least one category' : '';
  return createPortal(
    <div className="os os-types-pop os-trade-pop" role="dialog" aria-modal="true" aria-labelledby="os-trade-title">
      <button type="button" className="os-types-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <section className="os-types-panel" ref={panel}>
        <header>
          <h2 id="os-trade-title"><span>{info.icon}</span> {info.name}</h2>
          <p>{info.hint}</p>
          {importer && (
            <label className="os-trade-summary">
              <span>Your imports</span>
              <textarea readOnly rows={2} value={importSummary(trade, categories, countries)} placeholder="Tap what you import below: it shows here" aria-live="polite" />
            </label>
          )}
        </header>
        <div className="os-trade-body">
          <h3>{info.ask} <small>{chosen.length ? `${chosen.length} chosen` : `up to ${MAX_CATEGORIES}`}</small></h3>
          <div className="os-types-list os-trade-cats">
            {categories.filter((category) => category.slug !== 'other').map((category) => {
              const on = chosen.includes(category.slug);
              return <button type="button" key={category.slug} className={on ? 'on' : ''} aria-pressed={on} onClick={() => onPick(info.field, category.slug, MAX_CATEGORIES)}><span>{category.icon}</span> {category.name}</button>;
            })}
          </div>
          {askVehicles && (
            <div ref={vehiclesRef} className="os-trade-ask-more">
              <h3>🚗 Which vehicles do you import? <small>{trade.vehicles.length ? `${trade.vehicles.length} chosen` : 'tap a make, then its models'}</small></h3>
              <VehicleModels makes={vehicleMakes(categories)} chosen={trade.vehicles} onPick={onPick} />
            </div>
          )}
          {askSpares && (
            <div ref={sparesRef} className="os-trade-ask-more">
              <h3>🔧 Which spare parts do you import? <small>{trade.spares.length ? `${trade.spares.length} chosen` : 'tick all that apply'}</small></h3>
              <div className="os-types-list os-trade-spares">
                {parts.map((part) => {
                  const on = trade.spares.includes(part);
                  return <button type="button" key={part} className={on ? 'on' : ''} aria-pressed={on} onClick={() => onPick('spares', part, parts.length)}>{on ? '✓ ' : ''}{part}</button>;
                })}
              </div>
            </div>
          )}
          {importer && (
            <>
              <h3>Which countries do you import from? <small>{trade.importFrom.length ? `${trade.importFrom.length} chosen` : `up to ${MAX_COUNTRIES}`}</small></h3>
              <input className="os-trade-search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Search a country: China, Dubai, UK, Japan…" aria-label="Search a country" />
              <div className="os-types-list os-trade-countries">
                {shown.map((country) => {
                  const on = trade.importFrom.includes(country.code);
                  return <button type="button" key={country.code} className={on ? 'on' : ''} aria-pressed={on} onClick={() => onPick('importFrom', country.code, MAX_COUNTRIES)}><span>{country.flag}</span> {country.name}</button>;
                })}
                {!shown.length && <p className="os-muted">No country called “{text}” in our list.</p>}
              </div>
            </>
          )}
        </div>
        <footer>
          <button type="button" className="os-btn os-btn-ghost os-types-remove" onClick={onRemove}>{info.none}</button>
          <button type="button" className="os-btn os-btn-brand os-types-done" onClick={onClose} title={missing}>{missing ? 'Later' : 'Done'}</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

// types: the seller kinds chosen · trade: { wholesale, imports, importFrom, vehicles, spares } · what: { categories, items }
// open: 'wholesaler' | 'importer' | null · onRemoveKind(kind): untick that kind (its trade goes too)
export default function SellerTrade({ types, trade, onTrade, what, onWhat, open, setOpen, onRemoveKind, categories = [], countries = [] }) {
  const kinds = Object.keys(KIND).filter((kind) => types.includes(kind));
  const catName = (slug) => categories.find((category) => category.slug === slug)?.name || slug;
  const pick = (field, key, max) => {
    const result = pickTrade(trade, what.categories, field, key, max);
    if (result.error) return toast.error(result.error);
    if (result.categories !== what.categories) onWhat({ ...what, categories: result.categories });
    onTrade(result.trade);
    return undefined;
  };
  if (!kinds.length && !open) return null;
  return (
    <>
      {kinds.map((kind) => {
        const info = KIND[kind];
        const cats = trade[info.field];
        const done = kind === 'importer' ? !importerMissing(trade) : cats.length > 0;
        return (
          <div key={kind} className={`os-trade-card ${done ? '' : 'missing'}`}>
            <span className="os-trade-icon">{info.icon}</span>
            <div>
              <b>{kind === 'wholesaler' ? 'Wholesale' : 'Imports'}</b>
              <p>{kind === 'importer' ? importSummary(trade, categories, countries) || 'Choose what you import and where from' : cats.length ? cats.map(catName).join(', ') : 'Choose the categories you deal in'}</p>
            </div>
            <button type="button" className="os-btn os-btn-ghost" onClick={() => setOpen(kind)} aria-haspopup="dialog">{done ? '✎ Edit' : 'Choose'}</button>
          </div>
        );
      })}
      {open && KIND[open] && (
        <TradePopup kind={open} categories={categories} countries={countries} trade={trade} onPick={pick} onClose={() => setOpen(null)} onRemove={() => { onRemoveKind(open); setOpen(null); }} />
      )}
    </>
  );
}
