import { useEffect, useMemo, useState } from 'react';
import { COLOUR_HEX, priceText } from './marketApi';
import { Sheet } from './Trust';

// Quick "select" buttons above the results: pick colours, or a price range with a slider, presets or exact amounts.
// Everything is kept in the web address (colour, minPrice, maxPrice), so results are shareable.

// prices go from KSh 50 to millions: the slider moves on a log scale so every part of the range is usable
const SLIDER_MAX = 1000;
const nice = (number) => {
  if (number <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(number)) - 1); // keep 2 significant figures
  return Math.round(number / step) * step;
};
function scale(min, max) {
  const lo = Math.log(Math.max(1, min));
  const hi = Math.log(Math.max(min + 1, max));
  return {
    toPrice: (value) => (value <= 0 ? min : value >= SLIDER_MAX ? max : nice(Math.exp(lo + ((hi - lo) * value) / SLIDER_MAX))),
    toSlider: (value) => Math.round(((Math.log(Math.max(1, Math.min(max, Math.max(min, value)))) - lo) / (hi - lo || 1)) * SLIDER_MAX),
  };
}
const short = (number) => (number >= 1e6 ? `${(number / 1e6).toFixed(number % 1e6 ? 1 : 0)}M` : number >= 1e3 ? `${Math.round(number / 1e3)}k` : String(number));

function PriceSheet({ stats, params, set, onClose, total, countWith }) {
  const min = stats.min;
  const max = stats.max;
  const sc = useMemo(() => scale(min, max), [min, max]);
  const [lo, setLo] = useState(Number(params.get('minPrice')) || min);
  const [hi, setHi] = useState(Number(params.get('maxPrice')) || max);
  const apply = (value = lo, other = hi) => {
    set({ minPrice: value > min ? String(value) : '', maxPrice: other < max ? String(other) : '' });
    onClose();
  };
  const tLo = sc.toSlider(lo);
  const tHi = sc.toSlider(hi);
  const [exact, setExact] = useState(null);
  useEffect(() => {
    if (!countWith) return undefined;
    setExact(null);
    const timer = setTimeout(() => {
      countWith({ minPrice: lo > min ? lo : '', maxPrice: hi < max ? hi : '', colour: '' }).then(setExact).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [lo, hi, min, max, countWith]);
  return (
    <Sheet title="💰 Price range" onClose={onClose}>
      <div className="mk-sheet-body">
        {params.get('colour') && <p className="os-muted mk-pr-note">Filtering by price replaces your colour filter.</p>}
        <div className="mk-pr-values">
          <label className="os-field"><span>Min (KSh)</span><input inputMode="numeric" value={lo} onChange={(event) => setLo(Number(event.target.value.replace(/\D/g, '')) || 0)} onBlur={() => setLo((previousLo) => Math.min(Math.max(previousLo, 0), hi))} /></label>
          <span className="mk-pr-dash">–</span>
          <label className="os-field"><span>Max (KSh)</span><input inputMode="numeric" value={hi} onChange={(event) => setHi(Number(event.target.value.replace(/\D/g, '')) || 0)} onBlur={() => setHi((previousHi) => Math.max(previousHi, lo))} /></label>
        </div>
        <div className="mk-range-slider" style={{ '--a': `${(tLo / SLIDER_MAX) * 100}%`, '--b': `${(tHi / SLIDER_MAX) * 100}%` }}>
          <div className="mk-range-track"><i /></div>
          <input type="range" min="0" max={SLIDER_MAX} value={tLo} aria-label="Lowest price" onChange={(event) => setLo(Math.min(sc.toPrice(Number(event.target.value)), hi))} />
          <input type="range" min="0" max={SLIDER_MAX} value={tHi} aria-label="Highest price" onChange={(event) => setHi(Math.max(sc.toPrice(Number(event.target.value)), lo))} />
        </div>
        <div className="mk-pr-ends"><span>{priceText(min)}</span><span>{priceText(max)}</span></div>
        {stats.buckets.length > 1 && (
          <>
            <b className="mk-pr-label">Popular ranges</b>
            <div className="mk-pr-presets">
              {stats.buckets.map((bk, index) => {
                const from = index === 0 ? min : nice(bk.from);
                const to = index === stats.buckets.length - 1 ? max : nice(bk.to);
                const on = lo === from && hi === to;
                return (
                  <button type="button" key={index} className={on ? 'on' : ''} onClick={() => { setLo(from); setHi(to); }}>
                    <b>{index === 0 ? `Under ${priceText(to)}` : index === stats.buckets.length - 1 ? `${priceText(from)}+` : `${priceText(from)} – ${short(to)}`}</b>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="mk-sheet-actions">
          <button type="button" className="os-btn os-btn-ghost" onClick={() => { setLo(min); setHi(max); set({ minPrice: '', maxPrice: '' }); onClose(); }}>Any price</button>
          <button type="button" className="os-btn os-btn-brand os-grow" disabled={exact === 0} onClick={() => apply()}>{exact === null ? 'Counting…' : exact === 0 ? 'No ads in this range' : `Show ${exact} ad${exact === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </Sheet>
  );
}

function ColourSheet({ colours, params, set, onClose }) {
  const [chosen, setChosen] = useState((params.get('colour') || '').split('|').filter(Boolean));
  const toggle = (value) => setChosen((previousChosen) => (previousChosen.includes(value) ? previousChosen.filter((item) => item !== value) : [...previousChosen, value]));
  const count = colours.filter((colour) => chosen.includes(colour.name)).reduce((total, item) => total + item.n, 0);
  return (
    <Sheet title="🎨 Colour" onClose={onClose}>
      <div className="mk-sheet-body">
        <p className="os-muted">Choose one or more colours.{(params.get('minPrice') || params.get('maxPrice')) ? ' This replaces your price filter.' : ''}</p>
        <div className="mk-colour-grid">
          {colours.map((colour) => (
            <button type="button" key={colour.name} className={`mk-colour-opt ${chosen.includes(colour.name) ? 'on' : ''}`} aria-pressed={chosen.includes(colour.name)} onClick={() => toggle(colour.name)}>
              <i style={{ background: COLOUR_HEX[colour.name] || '#ddd' }}>{chosen.includes(colour.name) && <em>✓</em>}</i>
              <b>{colour.name}</b>
              <small>{colour.n}</small>
            </button>
          ))}
        </div>
        <div className="mk-sheet-actions">
          <button type="button" className="os-btn os-btn-ghost" onClick={() => { set({ colour: '' }); onClose(); }}>Any colour</button>
          <button type="button" className="os-btn os-btn-brand os-grow" disabled={!chosen.length} onClick={() => { set({ colour: chosen.join('|') }); onClose(); }}>
            {chosen.length ? `Show ${count} ad${count === 1 ? '' : 's'}` : 'Pick a colour'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export default function QuickFilters({ res, params, set, countWith }) {
  const [open, setOpen] = useState(null); // 'price' | 'colour'
  // keep the last known colours / price range while new results load
  const [stats, setStats] = useState(null);
  const [colours, setColours] = useState([]);
  useEffect(() => {
    if (res?.priceStats !== undefined) setStats(res.priceStats);
    if (res?.colours) setColours(res.colours);
  }, [res]);

  const minP = Number(params.get('minPrice')) || 0;
  const maxP = Number(params.get('maxPrice')) || 0;
  const chosenColours = (params.get('colour') || '').split('|').filter(Boolean);
  const priceLabel = minP && maxP ? `${priceText(minP)} – ${short(maxP)}` : minP ? `From ${priceText(minP)}` : maxP ? `Up to ${priceText(maxP)}` : 'Price';
  if (!stats && !colours.length && !chosenColours.length && !minP && !maxP) return null;

  return (
    <div className="mk-quick-filters" role="toolbar" aria-label="Quick filters">
      {(colours.length > 0 || chosenColours.length > 0) && (
        <button type="button" className={`mk-qf ${chosenColours.length ? 'on' : ''}`} onClick={() => setOpen('colour')}>
          {chosenColours.length ? (
            <span className="mk-qf-dots">{chosenColours.slice(0, 4).map((item) => <i key={item} style={{ background: COLOUR_HEX[item] || '#ddd' }} />)}</span>
          ) : '🎨'}
          {chosenColours.length ? (chosenColours.length <= 2 ? chosenColours.join(', ') : `${chosenColours.length} colours`) : 'Colour'} ▾
        </button>
      )}
      {chosenColours.length > 0 && <button type="button" className="mk-qf mk-qf-x" aria-label="Remove colour filter" onClick={() => set({ colour: '' })}>✕</button>}
      {(colours.length > 0 || chosenColours.length > 0) && stats && <span className="mk-qf-sep" aria-hidden="true" />}
      {stats && (
        <button type="button" className={`mk-qf ${minP || maxP ? 'on' : ''}`} onClick={() => setOpen('price')}>💰 {priceLabel} ▾</button>
      )}
      {(minP > 0 || maxP > 0) && <button type="button" className="mk-qf mk-qf-x" aria-label="Remove price filter" onClick={() => set({ minPrice: '', maxPrice: '' })}>✕</button>}
      {open === 'price' && stats && <PriceSheet stats={stats} params={params} set={set} total={res?.total ?? stats.count} countWith={countWith} onClose={() => setOpen(null)} />}
      {open === 'colour' && <ColourSheet colours={colours.length ? colours : chosenColours.map((name) => ({ name, n: 0 }))} params={params} set={set} onClose={() => setOpen(null)} />}
    </div>
  );
}
