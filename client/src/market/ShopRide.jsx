// 🛍️ Shop & ride with us (/shop-and-ride): book our agents to inspect what you bought in Nairobi and deliver it
// Where we work: sellers in the CBD or in a market where we have trained shopping agents ("covered": inspection is
// optional); anywhere else, the KSh 200 verification is required (the server decides: market/shopRide.js coverage()).
// through our CBD hub to the pickup point in your area, or to your door. One button replaces "Shop with our agents"
// and "Deliver with us"; buying for you and sending a parcel are linked from here.
//   · one booking, one or more sellers: each seller has their own block (item, price, where, stall, phone)
//   · a seller's phone that matches a seller on Kapu fills in their details; erasing it clears what was filled in
//   · paid now: only the inspection. After our agent passes a seller's item: that seller's goods (+ delivery for a
//     pickup point), paid to us; we pay the seller. Door delivery: the delivery fee when it arrives.
// Prices come from the server (GET /api/errands/pickup-points, POST /api/errands/shopride/quote): market/shopRide.js.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { getHere, AddressInput } from './Maps';
import { PayNumber } from './Checkout';
import ItemSuggest from './ItemSuggest';
import { ChosenAgentCard, clearChosenAgent, useChosenAgent } from './ChosenAgent';
import './market.css';

const validPhone = (phone) => /^(?:\+?254|0)?[17]\d{8}$/.test(String(phone || '').replace(/[\s-]/g, ''));
const digits = (value) => String(value || '').replace(/\D/g, '').replace(/^254/, '0');
const DRAFT = 'kapu_shopride_draft'; // kept only while they log in to book
const MAX_SELLERS = 5;
let nextKey = 0;
const newItem = () => ({ key: `i${Date.now()}-${(nextKey += 1)}`, name: '', qty: '1', price: '' });
const MAX_ITEMS = 20;
// the goods from one seller: quantity × price of each item
const goodsOf = (seller) => seller.items.reduce((sum, item) => sum + Math.max(1, Math.floor(Number(item.qty) || 1)) * Math.max(0, Math.round(Number(item.price) || 0)), 0);
const itemsFor = (seller, forQuote) => seller.items.filter((item) => forQuote || item.name.trim().length >= 2).map((item) => ({ name: item.name.trim() || 'item', qty: Math.max(1, Math.floor(Number(item.qty) || 1)), price: Math.max(0, Math.round(Number(item.price) || 0)) }));
const newSeller = () => ({ key: `s${Date.now()}-${(nextKey += 1)}`, items: [newItem()], weightKg: '1', inspect: false, sellerPhone: '', sellerId: '', sellerName: '', address: '', stall: '', fromArea: '', pin: null, found: null, filled: null });
// what a seller found on Kapu fills in (remembered, so erasing the phone can clear exactly that)
const AUTO = ['sellerId', 'sellerName', 'address', 'stall', 'fromArea', 'pin'];
const free = (price) => (price ? priceText(price) : 'Free');
// [[area, [points…]], …]: the CBD hub first, then the areas; an area like Embakasi has several exact spots
const byArea = (points) => {
  const groups = new Map();
  for (const point of points) {
    const key = point.hub ? 'Nairobi CBD' : point.area;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  return [...groups.entries()];
};
// a select with one option per point, grouped by area when an area has several
const PointOptions = ({ points }) => byArea(points).map(([area, list]) => (list.length === 1
  ? <option key={list[0]._id} value={list[0]._id}>{area}</option>
  : <optgroup key={area} label={area}>{list.map((point) => <option key={point._id} value={point._id}>{area}: {point.name}</option>)}</optgroup>));

// ---------------------------------------------------------------- one seller
function SellerBlock({ index, seller, many, points, customer, update, remove, quotePart, cover, chosenAgent }) {
  const [looking, setLooking] = useState(false);
  const [locating, setLocating] = useState(false);
  const lookedUp = useRef(seller.found?.found ? digits(seller.sellerPhone) : '');
  const set = (key) => (event) => update({ [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const id = `ride-what-${seller.key}`;
  const setItem = (key, patch) => update({ items: seller.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) });

  // fill in from a seller on Kapu; remember what was filled in
  const fill = (found) => {
    const values = {
      sellerId: String(found._id), sellerName: found.shopName || found.name,
      address: found.address || [found.market, found.area].filter(Boolean).join(', ') || seller.address,
      stall: found.stall || seller.stall, fromArea: found.fromArea?._id || seller.fromArea, pin: found.pin || null,
    };
    update({ ...values, ...(found.phone ? { sellerPhone: found.phone.replace(/^254/, '0') } : {}), found, filled: values });
  };
  // erase what the lookup filled in (fields they changed themselves are kept)
  const clearFilled = (extra = {}) => {
    const reset = {};
    for (const key of AUTO) if (seller.filled && JSON.stringify(seller[key]) === JSON.stringify(seller.filled[key])) reset[key] = key === 'pin' ? null : '';
    lookedUp.current = '';
    update({ ...reset, found: null, filled: null, ...extra });
  };
  const lookUp = async (value) => {
    const number = digits(value);
    if (!validPhone(value) || lookedUp.current === number) return;
    lookedUp.current = number;
    if (!customer) { update({ found: { found: false, login: true } }); return; }
    setLooking(true);
    try {
      const response = await api.get('/errands/shopride/seller', { params: { phone: value } });
      if (response.data.found) { fill(response.data); toast.success(`Found ${response.data.shopName || response.data.name} on Kapu: details filled in`); }
      else update({ found: { found: false } });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLooking(false);
    }
  };
  const onPhone = (event) => {
    const value = event.target.value;
    // erased, or a different number than the seller we found: their details go
    if (seller.found?.found && digits(value) !== digits(seller.found.phone || seller.sellerPhone)) clearFilled({ sellerPhone: value });
    else update({ sellerPhone: value, ...(seller.found && !seller.found.found && digits(value) !== lookedUp.current ? { found: null } : {}) });
    if (!value.trim()) lookedUp.current = '';
    if (validPhone(value)) lookUp(value);
  };
  // an ad picked in the suggestions: its title, price, weight and seller
  const pickAd = (itemKey) => async (ad) => {
    update({ items: seller.items.map((item) => (item.key === itemKey ? { ...item, name: ad.title, ...(ad.price ? { price: String(ad.price) } : {}) } : item)), ...(ad.weightKg && seller.items.length === 1 ? { weightKg: String(ad.weightKg) } : {}) });
    if (seller.sellerId && String(ad.seller._id) === String(seller.sellerId)) return; // already this seller
    try {
      const response = await api.get('/errands/shopride/seller', { params: { id: ad.seller._id } });
      if (response.data.found) { fill(response.data); toast.success(`Seller filled in: ${response.data.shopName || response.data.name}`); }
    } catch {
      /* they fill it in themselves */
    }
  };
  const pinShop = async () => {
    setLocating(true);
    try {
      const here = await getHere();
      update({ pin: { lat: here.lat, lng: here.lng } });
      toast.success('Shop location added');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLocating(false);
    }
  };
  const found = seller.found;
  return (
    <fieldset className="mk-ride-set mk-ride-seller-block">
      <legend>{many ? `Seller ${index + 1}` : 'What and where'}{many && <button type="button" className="os-linkbtn mk-ride-remove" onClick={remove}>Remove</button>}</legend>
      <label className="os-field"><span>Seller’s phone <em>(paste it first: we fill in the rest and list what they sell)</em></span><input value={seller.sellerPhone} onChange={onPhone} onBlur={(event) => lookUp(event.target.value)} inputMode="tel" placeholder="07XX XXX XXX" /></label>
      {looking && <p className="mk-ride-seller"><span className="page-spinner" /> Looking for the seller…</p>}
      {!looking && found?.found && (
        <p className="mk-ride-seller ok">✅ <b>{found.shopName || found.name}</b> is on Kapu{found.area || found.market ? ` · ${[found.market, found.area].filter(Boolean).join(', ')}` : ''}{found.stall ? ` · ${found.stall}` : ''}{found.pin ? ' · exact location on the map' : ''}. Details filled in: check them below.
          <button type="button" className="os-linkbtn mk-ride-notthis" onClick={() => clearFilled({ sellerPhone: '' })}>✕ Not this seller: clear</button>
        </p>
      )}
      {!looking && found && !found.found && validPhone(seller.sellerPhone) && <p className="mk-ride-seller">{found.login ? 'Log in to find the seller by their number, or fill in the details below.' : 'This number isn’t a seller on Kapu yet: fill in where they are below.'}</p>}
      <div className="mk-ride-items" role="group" aria-label="What did you buy?">
        <span className="mk-ride-items-title">What did you buy{seller.sellerName ? ` from ${seller.sellerName}` : ''}?</span>
        {seller.items.map((item, position) => (
          <div className="mk-ride-item" key={item.key}>
            <div className="mk-ride-item-name">
              <label htmlFor={`${id}-${item.key}`} className="mk-sr">Item {position + 1}</label>
              <ItemSuggest id={`${id}-${item.key}`} value={item.name} onChange={(value) => setItem(item.key, { name: value })} onPickItem={(picked) => setItem(item.key, { name: picked.label })} onPickAd={pickAd(item.key)} sellerId={seller.sellerId} sellerName={seller.sellerName} placeholder={seller.sellerId ? `Tap to see what ${seller.sellerName || 'this seller'} sells` : 'Start typing: shoes, TV, rice, mattress…'} />
            </div>
            <label className="mk-ride-item-qty"><span>Qty</span><input type="number" inputMode="numeric" min="1" max="999" step="1" value={item.qty} onChange={(event) => setItem(item.key, { qty: event.target.value })} /></label>
            <label className="mk-ride-item-price"><span>Price each (KSh)</span><input type="number" inputMode="numeric" min="0" step="1" value={item.price} onChange={(event) => setItem(item.key, { price: event.target.value })} placeholder="e.g. 1500" /></label>
            {seller.items.length > 1 && <button type="button" className="mk-ride-item-x" aria-label={`Remove item ${position + 1}`} onClick={() => update({ items: seller.items.filter((other) => other.key !== item.key) })}>✕</button>}
          </div>
        ))}
        <div className="mk-ride-items-foot">
          {seller.items.length < MAX_ITEMS && <button type="button" className="os-btn os-btn-ghost mk-ride-additem" onClick={() => update({ items: [...seller.items, newItem()] })}>➕ Add another item{seller.sellerName ? ` from ${seller.sellerName}` : ''}</button>}
          {goodsOf(seller) > 0 && <b className="mk-ride-goods-sum">Goods: {priceText(goodsOf(seller))}</b>}
        </div>
      </div>
      <label className="os-field mk-ride-kg"><span>All together, about how heavy? (kg)</span><input type="number" inputMode="decimal" min="0.1" max="200" step="0.1" value={seller.weightKg} onChange={set('weightKg')} required /></label>
      <label className={`mk-ride-check ${seller.inspect ? 'on' : ''}`}><input type="checkbox" checked={!!seller.inspect} onChange={set('inspect')} /> <span><b>Verify my goods</b> (KSh 200, optional) <span className="mk-reco-tag">Highly recommended</span>: our agent checks the right item, quality and quantity before you pay for it</span></label>
      {/* the shopping agent of this seller's market: suggested automatically (a booked agent takes over) */}
      {cover?.agent && !chosenAgent && (
        <p className="mk-ride-agent">🧑‍💼 Your agent here: <b>{cover.agent.name}</b>{cover.agent.marketName ? ` · ${cover.agent.marketName}` : ''}{cover.agent.rating ? ` · ★ ${Number(cover.agent.rating.avg).toFixed(1)}` : ''}. They check it and collect it from the seller.{cover.agent.marketSlug && <> <Link to={`/markets/${cover.agent.marketSlug}?back=${encodeURIComponent('/shop-and-ride#book')}#agents`}>Change</Link></>}</p>
      )}
      {cover && (cover.covered ? (
        <p className="mk-ride-cover ok">✅ <b>{cover.coverName || 'Covered area'}</b>: our trained shopping agents work here, so the inspection is up to you.</p>
      ) : (
        <p className="mk-ride-cover far">📍 <b>Outside the CBD and our agents’ markets.</b> We recommend verifying it ({priceText(200)}, optional): our agent goes to the seller and checks it’s the right item, quality and quantity before anything is paid. {!seller.pin && 'In a market? Add the shop’s exact location: it may be covered.'}</p>
      ))}

      <label className="os-field"><span>Area</span>
        <select value={seller.fromArea} onChange={set('fromArea')}>
          <option value="">Choose the area…</option>
          <PointOptions points={points} />
        </select>
      </label>
      <label className="os-field"><span>Shop or market (name, building, street)</span><AddressInput value={seller.address} onChange={(text) => update({ address: text })} onPlace={(place) => update({ address: place.text, pin: { lat: place.lat, lng: place.lng } })} maxLength={200} placeholder="e.g. Gikomba market" required minLength={3} /></label>
      <div className="mk-ride-two">
        <label className="os-field"><span>Stall / shop number</span><input value={seller.stall} onChange={set('stall')} maxLength={40} placeholder="e.g. Stall 14, near gate B" /></label>
        <label className="os-field"><span>Seller’s name <em>(optional)</em></span><input value={seller.sellerName} onChange={set('sellerName')} maxLength={80} /></label>
      </div>
      <button type="button" className="os-btn os-btn-ghost mk-ride-gps" disabled={locating} onClick={pinShop}>{locating ? 'Getting the location…' : seller.pin ? (found?.found && found.pin ? '✅ The seller’s exact location (from Kapu)' : '✅ Shop location added') : '📍 I’m at the shop: use my location'}</button>
      {quotePart && <p className="mk-ride-partprice">{quotePart.inspection ? `Inspection ${priceText(quotePart.inspection)} · ` : ''}delivery {priceText(quotePart.delivery.fee)}{quotePart.goods ? ` · goods ${priceText(quotePart.goods)}` : ''}</p>}
    </fieldset>
  );
}

// ---------------------------------------------------------------- the page
export default function ShopRide() {
  const { customer } = useShop();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useSeo({ title: 'Shop & ride with us', description: 'Not sure, or afraid of being conned? Book Kapu for professional inspection and delivery in Nairobi: our trained shopping agents in the CBD and markets, optional KSh 200 inspection, delivery from KSh 150.' });
  // a draft is kept only while they log in to book; any other visit starts fresh
  const [saved] = useState(() => {
    try {
      const draft = params.get('resume') ? JSON.parse(sessionStorage.getItem(DRAFT) || 'null') : null;
      sessionStorage.removeItem(DRAFT);
      return draft;
    } catch {
      return null;
    }
  });
  const [info, setInfo] = useState(null); // { points, rates }
  const [sellers, setSellers] = useState(() => (saved?.sellers || [newSeller()]).map((seller) => (seller.items ? seller : { ...seller, items: [{ ...newItem(), name: seller.what || '', price: seller.goodsAmount || '' }] })));
  const [form, setForm] = useState(saved?.form || { repack: false, urgency: 'standard', mode: 'point', pointId: '', dropAddress: '', notes: '' });
  const [me, setMe] = useState(saved?.me || null); // the buyer's live location (door delivery / nearest point)
  const [phone, setPhone] = useState(customer?.phone ? customer.phone.replace(/^254/, '0') : '');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const timer = useRef(null);
  const agent = useChosenAgent(); // booked on a market's page: filled in here
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#book') setTimeout(() => document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [hash]);
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const updateSeller = (key) => (patch) => setSellers((list) => list.map((seller) => (seller.key === key ? { ...seller, ...patch } : seller)));

  useEffect(() => {
    api.get('/errands/pickup-points').then((response) => setInfo(response.data)).catch((err) => toast.error(errMsg(err)));
  }, []);
  useEffect(() => {
    if (customer?.phone && !phone) setPhone(customer.phone.replace(/^254/, '0'));
  }, [customer, phone]);

  const quoteBody = () => ({
    sellers: sellers.map((seller) => ({ fromArea: seller.fromArea, ...(seller.pin ? { from: seller.pin } : {}), ...(seller.sellerId ? { sellerId: seller.sellerId } : {}), weightKg: Number(seller.weightKg), inspect: seller.inspect, items: itemsFor(seller, true) })),
    repack: form.repack, urgency: form.urgency, mode: form.mode, ...(form.pointId ? { pointId: form.pointId } : {}), ...(me ? { to: { lat: me.lat, lng: me.lng } } : {}),
  });
  // the live price (every seller, and when each part is paid)
  const priceKey = JSON.stringify([quoteBody(), Boolean(info)]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!info || sellers.some((seller) => !seller.fromArea && !seller.pin)) { setQuote(null); return undefined; }
    timer.current = setTimeout(() => {
      api.post('/errands/shopride/quote', quoteBody()).then((response) => setQuote(response.data)).catch(() => {});
    }, 300);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  const locateMe = async () => {
    setLocating(true);
    try {
      const here = await getHere();
      setMe({ lat: here.lat, lng: here.lng });
      toast.success(form.mode === 'door' ? 'Live location shared' : 'Found the pickup point nearest you');
      if (form.mode === 'point') setForm((previous) => ({ ...previous, pointId: '', pointArea: '' }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLocating(false);
    }
  };

  const book = async (event) => {
    event.preventDefault();
    if (!customer) {
      try { sessionStorage.setItem(DRAFT, JSON.stringify({ sellers, form, me })); } catch { /* private mode */ }
      toast('Log in to book: your details are kept', { icon: '🔐' });
      navigate(`/login?next=${encodeURIComponent('/shop-and-ride?resume=1')}`);
      return;
    }
    setBusy(true);
    try {
      const response = await api.post('/errands', {
        kind: 'shopride', ...quoteBody(), dropAddress: form.dropAddress, notes: form.notes, phone, ...(agent ? { agentId: agent._id } : {}),
        sellers: sellers.map((seller) => ({ items: itemsFor(seller, false), weightKg: Number(seller.weightKg), inspect: seller.inspect, sellerPhone: seller.sellerPhone, sellerName: seller.sellerName, address: seller.address, stall: seller.stall, fromArea: seller.fromArea, ...(seller.pin ? { from: seller.pin } : {}), ...(seller.sellerId ? { sellerId: seller.sellerId } : {}) })),
      });
      const paidNow = response.data.payment?.status === 'paid';
      toast.success(paidNow ? 'Booked and paid! Our agent is on the way 🛍️' : response.data.payment?.amount ? 'Check your phone and enter your M-Pesa PIN' : 'Booked! Our agent is on the way 🛍️');
      navigate(`/errands/${response.data._id}`);
    } catch (err) {
      if (err.response?.status === 409 && agent) clearChosenAgent(); // that agent can't take jobs any more
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const rates = info?.rates;
  const points = info?.points || [];
  const areas = points.filter((point) => !point.hub);
  const areaGroups = byArea(areas);
  // the buyer's area: chosen, or the area of the point chosen / found nearest
  const pointArea = form.pointArea || areas.find((point) => point._id === form.pointId)?.area || '';
  const spots = areaGroups.find(([area]) => area === pointArea)?.[1] || [];
  const heavy = sellers.some((seller) => Number(seller.weightKg) > (rates?.lightKg || 5));
  const many = sellers.length > 1;
  const now = quote?.ok ? quote.schedule.now : 0;
  return (
    <div className="mk">
      <div className="mk-wrap mk-narrow mk-ride">
        <section className="mk-ride-hero">
          <span className="mk-ride-badge">🛍️ Shop &amp; ride with us</span>
          <h1>Not sure, or afraid of being conned out of your money?</h1>
          <p>Book us for <b>professional inspection and delivery</b>, so you get the right <b>quality and quantity</b> of what you ordered. We also guarantee <b>timely delivery</b>.</p>
          <a className="os-btn os-btn-brand os-btn-lg" href="#book">Book inspection &amp; delivery</a>
        </section>

        <section className="mk-box mk-ride-where" aria-label="Where we shop">
          <h2>Where our shopping agents work</h2>
          <div className="mk-ride-where-grid">
            <div className="ok"><b>✅ The CBD{info?.agentMarkets?.length ? ` and ${info.agentMarkets.length} market${info.agentMarkets.length === 1 ? '' : 's'}` : ''}</b><small>Our trained agents are there. Inspection is optional.</small>{info?.agentMarkets?.length > 0 && <span className="mk-ride-where-list">{info.agentMarkets.join(' · ')}</span>}</div>
            <div className="far"><b>📍 Anywhere else in Nairobi</b><small>Inspection is optional but highly recommended: {priceText(rates?.inspectFee ?? 200)} per seller, only if you tick it. Our agent checks the right item, quality and quantity, and makes sure it’s delivered on time.</small></div>
          </div>
        </section>

        <section className="mk-ride-prices" aria-label="Prices">
          <div><span>🔍</span><b>{priceText(rates?.inspectFee ?? 200)}</b><small>Inspection, optional: only if you ask for it, paid when you book. Right item, quality and quantity. Otherwise you pay only for the goods and delivery</small></div>
          <div><span>💵</span><b>Goods: when collected</b><small>You pay for the goods only once our agent has them (and passed them, if you asked for an inspection); we pay the seller</small></div>
          <div><span>🏙️</span><b>{priceText(rates?.cbdFee ?? 150)}</b><small>Delivery from the CBD to any part of Nairobi, up to {rates?.lightKg ?? 5} kg</small></div>
          <div><span>🗺️</span><b>{priceText(rates?.outsideFee ?? 250)}</b><small>Bought outside the CBD: it comes to our CBD hub first, then out to your area (up to {rates?.lightKg ?? 5} kg)</small></div>
          <div><span>⚖️</span><b>Over {rates?.lightKg ?? 5} kg</b><small>Priced by weight, the time of day (traffic) and how urgent it is</small></div>
          <div><span>🚪</span><b>To your door</b><small>From the pickup point in your area, Bolt Send-style. The delivery fee is paid when it arrives</small></div>
        </section>

        <section className="mk-ride-how">
          <h2>How it works</h2>
          <ol>
            <li><b>Book</b>: what you bought, from which seller(s). Asked for an inspection? Pay it now with M-Pesa.</li>
            <li>Our agent <b>collects</b> it at the seller (and <b>inspects</b> it, if you asked). Ready? You get an M-Pesa prompt for the <b>goods</b>{form.mode === 'point' ? ' and delivery' : ''}; we pay the seller.</li>
            <li>It comes to our <b>CBD hub</b>, then to the <b>pickup point in your area</b>{form.mode === 'door' ? ' and on to your door (pay the delivery fee when it arrives)' : ''}.</li>
            <li>We <b>message you</b> where to collect it. If an inspection fails, we don’t buy it, and you don’t pay for the goods.</li>
          </ol>
          {points.length > 0 && <p className="mk-ride-areas">📍 Pickup points: {areaGroups.map(([area, list]) => (list.length > 1 ? `${area} (${list.length} points)` : area)).join(' · ')}</p>}
        </section>

        <form id="book" className="mk-box mk-ride-form" onSubmit={book}>
          <h2>Book inspection &amp; delivery</h2>
          {agent ? (
            <ChosenAgentCard agent={agent} back="/shop-and-ride#book" note={`${agent.name.split(' ')[0]} gets your job first. If they can’t take it within 10 minutes, the nearest agent does.`} />
          ) : (
            <p className="mk-hint mk-chosen-agent-hint">🧑‍💼 Want a particular shopping agent? <Link to="/markets-near-me">Pick one at their market</Link>, or leave it to us: the nearest agent takes it.</p>
          )}
          {sellers.map((seller, index) => (
            <SellerBlock key={seller.key} index={index} seller={seller} many={many} points={points} customer={customer} update={updateSeller(seller.key)} remove={() => setSellers((list) => list.filter((item) => item.key !== seller.key))} quotePart={many && quote?.ok ? quote.parts[index] : null} cover={quote?.ok ? quote.parts[index] : null} chosenAgent={agent} />
          ))}
          {sellers.length < MAX_SELLERS && <button type="button" className="os-btn os-btn-ghost mk-ride-add" onClick={() => setSellers((list) => [...list, newSeller()])}>➕ Add another seller</button>}

          <fieldset className="mk-ride-set">
            <legend>Extras</legend>
            <label className="mk-ride-check"><input type="checkbox" checked={form.repack} onChange={set('repack')} /> <span><b>Repackage</b> what isn’t packed well ({rates?.repackFee ? priceText(rates.repackFee) : 'free'})</span></label>
            {heavy && (
              <div className="mk-choice mk-ride-urgency" role="radiogroup" aria-label="How urgent?">
                <label className={form.urgency === 'standard' ? 'on' : ''}><input type="radio" name="urgency" checked={form.urgency === 'standard'} onChange={() => setForm({ ...form, urgency: 'standard' })} /><span><b>Standard</b><small>Best price</small></span></label>
                <label className={form.urgency === 'express' ? 'on' : ''}><input type="radio" name="urgency" checked={form.urgency === 'express'} onChange={() => setForm({ ...form, urgency: 'express' })} /><span><b>Express</b><small>As fast as possible</small></span></label>
              </div>
            )}
          </fieldset>

          <fieldset className="mk-ride-set">
            <legend>How do you want to get it?</legend>
            <div className="mk-choice" role="radiogroup">
              <label className={form.mode === 'point' ? 'on' : ''}><input type="radio" name="mode" checked={form.mode === 'point'} onChange={() => setForm({ ...form, mode: 'point' })} /><span><b>📍 Collect at a pickup point</b><small>In your area: we message you where</small></span></label>
              <label className={form.mode === 'door' ? 'on' : ''}><input type="radio" name="mode" checked={form.mode === 'door'} onChange={() => setForm({ ...form, mode: 'door' })} /><span><b>🚪 To my door</b><small>Share your live location; pay delivery on arrival</small></span></label>
            </div>
            {form.mode === 'point' && (
              <>
                <label className="os-field"><span>Your area</span>
                  <select value={pointArea} onChange={(event) => { const list = areaGroups.find(([area]) => area === event.target.value)?.[1] || []; setForm({ ...form, pointArea: event.target.value, pointId: list.length === 1 ? list[0]._id : '' }); }}>
                    <option value="">{me ? 'The one nearest to me' : 'Choose your area…'}</option>
                    {areaGroups.map(([area, list]) => <option key={area} value={area}>{area}{list.length > 1 ? ` (${list.length} pickup points)` : ''}</option>)}
                  </select>
                </label>
                {spots.length > 1 && (
                  <label className="os-field mk-ride-spot"><span>Exact pickup point in {pointArea}</span>
                    <select value={form.pointId} onChange={set('pointId')} required>
                      <option value="">Choose the stage or landmark…</option>
                      {spots.map((point) => <option key={point._id} value={point._id}>{point.name}{point.address && point.address !== point.name ? ` · ${point.address}` : ''}</option>)}
                    </select>
                  </label>
                )}
              </>
            )}
            {form.mode === 'door' && <label className="os-field"><span>Your door (estate, street, house number or landmark)</span><AddressInput value={form.dropAddress} onChange={(text) => setForm((previous) => ({ ...previous, dropAddress: text }))} onPlace={(place) => { setForm((previous) => ({ ...previous, dropAddress: place.text })); setMe({ lat: place.lat, lng: place.lng }); }} maxLength={200} required minLength={5} placeholder="Start typing: estate, street, building" /></label>}
            <button type="button" className={`os-btn ${me ? 'os-btn-ghost' : 'os-btn-dark'} mk-ride-gps mk-ride-me`} disabled={locating} onClick={locateMe}>{locating ? 'Getting your location…' : me ? '✅ Location shared (tap to update)' : form.mode === 'door' ? '📍 Share my live location' : '📍 Find the pickup point nearest me'}</button>
          </fieldset>

          <div className="mk-ride-quote" aria-live="polite">
            {!quote && <p className="os-muted">Choose where {many ? 'each seller is' : 'the items are'} to see the price.</p>}
            {quote && !quote.ok && <p className="mk-split-note bad">{quote.reason}</p>}
            {quote?.ok && (
              <>
                {quote.totals.goods > 0 && <div className="mk-sum-line fee"><span>🛍️ Goods{many ? ` (${sellers.length} sellers)` : ''}</span><b>{priceText(quote.totals.goods)}</b></div>}
                {quote.totals.inspection > 0 && <div className="mk-sum-line fee"><span>🔍 Inspection{many ? ` × ${quote.parts.filter((part) => part.inspection).length}` : ''}</span><b>{priceText(quote.totals.inspection)}</b></div>}
                <div className="mk-sum-line fee"><span>🛵 Delivery to {quote.point.area}{quote.parts.some((part) => part.delivery.heavy) ? ' (over 5 kg: priced for the traffic now)' : ''}</span><b>{priceText(quote.totals.delivery)}</b></div>
                {quote.door && <div className="mk-sum-line fee"><span>🚪 Door delivery from {quote.point.area} ({quote.door.km} km, ~{quote.door.minutes} min)</span><b>{priceText(quote.door.fare)}</b></div>}
                {form.repack && <div className="mk-sum-line fee"><span>📦 Repackaging</span><b>{free(quote.totals.repack)}</b></div>}
                <div className="mk-sum-total"><span>Total</span><b>{priceText(quote.totals.total)}</b></div>
                <ol className="mk-ride-schedule" aria-label="When you pay">
                  <li className="now"><span>Now, to book</span><b>{now ? priceText(now) : 'Nothing'}</b><small>{now ? 'the inspection' : 'no inspection chosen'}</small></li>
                  {quote.schedule.afterInspection > 0 && <li><span>{quote.totals.inspection > 0 ? 'After inspection passes' : 'When our agent collects it'}</span><b>{priceText(quote.schedule.afterInspection)}</b><small>the goods{form.mode === 'point' ? ' + delivery' : ''}{many ? ', per seller as each passes' : ''}: we pay the seller</small></li>}
                  {quote.schedule.onDelivery > 0 && <li><span>When it reaches your door</span><b>{priceText(quote.schedule.onDelivery)}</b><small>the delivery fee</small></li>}
                </ol>
                {quote.mode === 'point' && <p className="mk-hint">📍 You’ll collect it at <b>{quote.point.name}</b>. We message you when it’s there.</p>}
              </>
            )}
          </div>
          {customer && now > 0 && <PayNumber phone={phone} setPhone={setPhone} label="Pay with M-Pesa number" />}
          <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy || !quote?.ok || (customer && now > 0 && !validPhone(phone))}>{busy ? 'Booking…' : !customer ? 'Log in to book' : now > 0 ? `Book & pay ${priceText(now)} inspection` : 'Book'}</button>
          <small className="os-muted mk-center">{quote?.totals?.inspection > 0 ? 'You pay for the goods only after our agent passes the inspection. If it fails, we don’t buy it.' : 'No inspection chosen: you pay only for the goods and delivery, once our agent collects them.'}</small>
        </form>

        <section className="mk-ride-more">
          <Link to="/errands?type=shopping" className="mk-errand-type"><span className="mk-errand-icon" aria-hidden="true">🛒</span><span><b>Want us to buy it for you?</b><small>A shopping agent buys your list at any shop or market</small></span><span className="mk-errand-go" aria-hidden="true">→</span></Link>
          <Link to="/errands?type=parcel" className="mk-errand-type"><span className="mk-errand-icon" aria-hidden="true">🛵</span><span><b>Send a parcel</b><small>A rider picks it up and delivers it anywhere</small></span><span className="mk-errand-go" aria-hidden="true">→</span></Link>
        </section>
      </div>
    </div>
  );
}
