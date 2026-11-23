// Pieces that show the marketplace's relationships:
//   CompareSellers   the ad page: the same product from other sellers and stores, cheapest first
//   DeliveryParts    an order page: its delivery records (one per store when it's sent in parts), with the seller's and
//                    buyer's actions for each part
//   StorePicker      the Sell form: which of my stores the item is sold from
//   ProductHint      the Sell form: "others sell this product" (links the ad to the catalogue product)
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, imgUrl } from './marketApi';

const ksh = (amount) => `KSh ${Math.round(Number(amount || 0)).toLocaleString('en-KE')}`;

// ---------------------------------------------------------------- compare sellers of one product
export function CompareSellers({ product, current }) {
  const [offers, setOffers] = useState(null);
  useEffect(() => {
    if (!product?._id || product.offers < 2) return undefined;
    let live = true;
    api.get(`/market/products/${product._id}`).then((response) => live && setOffers(response.data.offers)).catch(() => {});
    return () => { live = false; };
  }, [product?._id, product?.offers]);
  if (!product || product.offers < 2 || !offers?.length) return null;
  return (
    <section className="mk-box mk-compare" aria-label="Compare sellers">
      <h2>🏷️ {product.sellers > 1 ? `${product.sellers} sellers` : `${product.offers} offers`} sell this <small className="os-muted">{ksh(product.minPrice)}{product.maxPrice > product.minPrice ? ` – ${ksh(product.maxPrice)}` : ''}</small></h2>
      <ul>
        {offers.map((offer) => (
          <li key={offer._id} className={offer._id === current ? 'mine' : ''}>
            <Link to={`/market/item/${offer.slug}`}>
              {offer.images?.[0] ? <img src={imgUrl(offer.images[0])} alt="" loading="lazy" /> : <span className="mk-hub-noimg">📦</span>}
              <span className="mk-compare-who"><b>{offer.sellerName}</b><small>{offer.store ? `🏬 ${offer.store.name}, ${offer.store.area || offer.store.county}` : offer.area || offer.county}{offer.condition ? ` · ${offer.condition}` : ''}</small></span>
              <span className="mk-compare-price"><b>{ksh(offer.price)}</b>{offer._id === current ? <small>This ad</small> : offer.buyNow && offer.stock > 0 ? <small>In stock</small> : null}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- an order's delivery records
const STEP = { pending: 'Being prepared', ready: 'Packed', assigned: 'Rider coming', picked_up: 'Picked up', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
export function DeliveryParts({ order, seller, onOrder }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});
  const load = useCallback(() => api.get(`/orders/${order._id}/deliveries`).then((response) => setData(response.data)).catch(() => {}), [order._id]);
  useEffect(() => { load(); }, [load, order.status, order.rider?.status]);
  if (!data || !data.split) return null; // one delivery: the order page already shows it
  const ourTeam = ['rider', 'courier', 'verified'].includes(order.delivery?.method);
  const run = async (key, request, done) => {
    setBusy(key);
    try {
      const response = await request();
      if (response.data.deliveries) setData((previous) => ({ ...previous, deliveries: response.data.deliveries }));
      else load();
      if (response.data.order) onOrder?.(response.data.order);
      toast.success(done);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy('');
    }
  };
  const live = ['confirmed', 'shipped'].includes(order.status);
  return (
    <section className="mk-box mk-parts" aria-label="Deliveries">
      <h2>📦 Sent in {data.deliveries.length} parts</h2>
      <p className="os-muted">{seller ? 'These items are in different stores, so each store sends its part.' : `The seller sends your order from ${data.deliveries.length} stores. Each part may arrive separately.`}{seller && data.splitDeliveryFee ? ` Extra riders: ${ksh(data.splitDeliveryFee)} (taken off your payment).` : ''}</p>
      <ol>
        {data.deliveries.map((part) => (
          <li key={part._id} className={`mk-part ${part.status}`}>
            <div className="mk-part-head">
              <b>Part {part.seq} of {part.of}{part.storeName ? `: 🏬 ${part.storeName}` : ''}</b>
              <span className={`mk-pill ${part.status === 'delivered' ? 'ok' : part.status === 'cancelled' ? '' : 'wait'}`}>{STEP[part.status] || part.status}</span>
            </div>
            <ul className="mk-part-items">{part.items.map((item) => <li key={`${item.listing}-${item.title}`}>{item.qty} × {item.title}</li>)}</ul>
            {(part.riderName || part.note) && <small className="os-muted">{part.riderName ? `🏍️ ${part.riderName}${part.riderPhone ? ` · ${part.riderPhone}` : ''}` : ''}{part.riderName && part.note ? ' · ' : ''}{part.note}</small>}
            {seller && live && !ourTeam && !['delivered', 'cancelled'].includes(part.status) && (
              <div className="mk-part-actions">
                <input value={notes[part._id] || ''} onChange={(event) => setNotes({ ...notes, [part._id]: event.target.value })} maxLength={200} placeholder="Who’s bringing it? e.g. Kevin, 0712 000 111" aria-label={`Note for part ${part.seq}`} />
                {part.status === 'pending' && <button type="button" className="os-btn os-btn-ghost" disabled={!!busy} onClick={() => run(part._id, () => api.post(`/orders/${order._id}/deliveries/${part._id}/status`, { status: 'ready', note: notes[part._id] }), `Part ${part.seq} packed`)}>📦 Packed</button>}
                {['pending', 'ready'].includes(part.status) && <button type="button" className="os-btn os-btn-brand" disabled={!!busy} onClick={() => run(part._id, () => api.post(`/orders/${order._id}/deliveries/${part._id}/status`, { status: 'on_the_way', note: notes[part._id] }), `Part ${part.seq} sent`)}>🚚 Sent</button>}
                {order.payment?.method === 'cod' && ['on_the_way', 'picked_up'].includes(part.status) && <button type="button" className="os-btn os-btn-dark" disabled={!!busy} onClick={() => run(part._id, () => api.post(`/orders/${order._id}/deliveries/${part._id}/status`, { status: 'delivered' }), `Part ${part.seq} delivered`)}>✅ Delivered</button>}
              </div>
            )}
            {seller && live && order.delivery?.method === 'rider' && part.seq > 1 && !part.hasRider && !['delivered', 'cancelled'].includes(part.status) && (
              <div className="mk-part-actions">
                <button type="button" className="os-btn os-btn-brand" disabled={!!busy} onClick={() => run(part._id, () => api.post(`/orders/${order._id}/deliveries/${part._id}/call-rider`), `Riders near ${part.storeName || 'the store'} alerted`)}>📣 Call a rider for this part</button>
                <small className="os-muted">Collected at {part.storeName || 'this store'}. The buyer paid for one delivery, so this rider is on you.</small>
              </div>
            )}
            {seller && order.delivery?.method === 'rider' && part.seq === 1 && part.status === 'pending' && <small className="os-muted">Use “Call a rider” above for this part.</small>}
            {!seller && live && ['on_the_way', 'picked_up'].includes(part.status) && (
              <div className="mk-part-actions">
                <button type="button" className="os-btn os-btn-brand" disabled={!!busy} onClick={() => run(part._id, () => api.post(`/orders/${order._id}/deliveries/${part._id}/received`), `Thanks! Part ${part.seq} received`)}>✅ I got this part</button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- the Sell form: which store
export function StorePicker({ value, onChange }) {
  const [list, setList] = useState(null);
  useEffect(() => { api.get('/seller/stores').then((response) => setList(response.data.stores.filter((store) => store.active))).catch(() => setList([])); }, []);
  useEffect(() => {
    if (list?.length && !value) onChange(list.find((store) => store.isMain)?._id || list[0]._id);
  }, [list, value, onChange]);
  if (!list || list.length < 2) return null; // one store: everything goes in it
  return (
    <label className="os-field mk-mt">
      <span>Sold from which store?</span>
      <select value={value || ''} onChange={(event) => onChange(event.target.value)}>
        {list.map((store) => <option key={store._id} value={store._id}>🏬 {store.name}{store.isMain ? ' (main)' : ''} · {store.area}</option>)}
      </select>
      <small className="os-muted">Buyers near this store find it; riders collect it from here. <Link to="/seller?tab=stores">Manage stores</Link></small>
    </label>
  );
}

// ---------------------------------------------------------------- the Sell form: others sell this product
export function ProductHint({ title, category, sub, value, onChange }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!category || !sub || String(title || '').trim().length < 4) return undefined;
    const timer = setTimeout(() => {
      api.get(`/market/products?${new URLSearchParams({ q: title, category, sub })}`).then((response) => setList(response.data.products.filter((item) => item.offers > 0).slice(0, 3))).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [title, category, sub]);
  if (!list.length || String(title || '').trim().length < 4) return null;
  return (
    <div className="mk-product-hint" role="group" aria-label="Same product">
      <b>🏷️ Others sell this. Is yours the same product?</b>
      {list.map((product) => (
        <label key={product._id} className={value === product._id ? 'on' : ''}>
          <input type="radio" name="same-product" checked={value === product._id} onChange={() => onChange(product._id)} />
          <span>{product.name}<small>{product.sellers || product.offers} seller{(product.sellers || product.offers) === 1 ? '' : 's'} · from {ksh(product.minPrice)}</small></span>
        </label>
      ))}
      <label className={!value ? 'on' : ''}><input type="radio" name="same-product" checked={!value} onChange={() => onChange('')} /><span>No, it’s different<small>We’ll match it by its brand, model and title</small></span></label>
    </div>
  );
}
