import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, fieldsOf, priceText, SOLD_BY_UNIT, timeAgo, unitShort, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { AdImage } from './ListingCard';
import { BoostSheet } from './Trust';
import SellerTrends from './SellerTrends';
import './market.css';

// Today's price, in one tap (mama mbogas, fish sellers): KSh 5 or 10 a kifungu, tomatoes per kg or per piece… the seller decides
function QuickPrice({ ad, onSaved }) {
  useCategories();
  const units = fieldsOf(ad.category, ad.sub).find((field) => field.key === 'unit')?.options || [];
  const [price, setPrice] = useState(String(ad.price || ''));
  const [unit, setUnit] = useState(ad.unit || '');
  const [busy, setBusy] = useState(false);
  const dirty = Number(price) !== ad.price || unit !== (ad.unit || '');
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.patch(`/market/listings/${ad._id}/price`, { price: Number(price), ...(unit ? { unit } : {}) });
      toast.success(`${ad.title}: ${priceText(response.data.price)}${response.data.unit ? ` / ${unitShort(response.data.unit)}` : ''}`);
      onSaved(response.data);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-quick-price" onSubmit={save} aria-label={`Today’s price for ${ad.title}`}>
      <span>Today’s price</span>
      <input type="number" inputMode="numeric" min="1" value={price} onChange={(event) => setPrice(event.target.value)} aria-label="Price in KSh" />
      {units.length > 0 && (
        <select value={unit} onChange={(event) => setUnit(event.target.value)} aria-label="Sold per">
          {!unit && <option value="">per…</option>}
          {units.map((option) => <option key={option} value={option}>per {unitShort(option)}</option>)}
        </select>
      )}
      {unitShort(unit) === 'kifungu' && [5, 10].map((amount) => <button type="button" key={amount} className={Number(price) === amount ? 'on' : ''} onClick={() => setPrice(String(amount))}>{amount}</button>)}
      <button className="os-btn os-btn-brand" disabled={busy || !dirty || !(Number(price) >= 1)}>{busy ? '…' : 'Save'}</button>
    </form>
  );
}

// sold ads are deleted; "Sold" only lists ones waiting for an order in progress to finish
const TABS = [['active', 'Live'], ['sold', 'Sold (finishing)'], ['hidden', 'Taken down']];

export default function MyAds() {
  const { customer, ready } = useShop();
  const [ads, setAds] = useState(null);
  const [tab, setTab] = useState('active');
  const [boosting, setBoosting] = useState(null);
  useSeo({ title: 'My ads', noindex: true });

  useEffect(() => {
    if (!customer) return;
    api.get('/market/mine').then((response) => setAds(response.data)).catch((error) => toast.error(errMsg(error)));
  }, [customer]);

  if (ready && !customer) return <Navigate to="/login?as=seller&next=%2Fmarket%2Fmy" replace />;

  const setStatus = async (ad, status) => {
    if (status === 'sold' && !window.confirm(`Mark "${ad.title}" as sold?

Sold ads are removed from Kapu for good, so buyers stop asking about it.`)) return;
    try {
      const { data } = await api.patch(`/market/listings/${ad._id}/status`, { status });
      // sold → deleted (or hidden until the order in progress is complete)
      if (data.deleted) setAds((list) => list.filter((item) => item._id !== ad._id));
      else setAds((list) => list.map((item) => (item._id === ad._id ? { ...item, status } : item)));
      toast.success(data.message || (status === 'sold' ? 'Marked as sold. Congratulations! 🎉' : 'Your ad is live again'), { duration: 5000 });
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const remove = async (ad) => {
    if (!window.confirm(`Delete "${ad.title}"? This can’t be undone.`)) return;
    try {
      await api.delete(`/market/listings/${ad._id}`);
      setAds((list) => list.filter((item) => item._id !== ad._id));
      toast.success('Ad deleted');
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const shown = (ads || []).filter((ad) => ad.status === tab);
  const count = (text) => (ads || []).filter((ad) => ad.status === text).length;

  return (
    <div className="mk">
      <div className="mk-wrap mk-narrow">
        <div className="mk-section-head">
          <h1>My ads</h1>
          <Link to="/market/sell" className="os-btn os-btn-brand">+ Post an ad</Link>
        </div>
        <SellerTrends />
        <div className="mk-tabs" role="tablist">
          {TABS.map(([key, value]) => (key === 'active' || count(key) > 0) && (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
              {value} <small>{count(key)}</small>
            </button>
          ))}
        </div>
        {!ads && <div className="page-loading"><span className="page-spinner" /></div>}
        {ads && shown.length === 0 && (
          <div className="os-empty">
            <div className="os-empty-art">{tab === 'active' ? '📢' : '📦'}</div>
            <h4>{tab === 'active' ? 'No live ads yet' : tab === 'sold' ? 'Nothing sold yet' : 'Nothing here'}</h4>
            {tab === 'active' && <><p>Post your first ad free; it takes about 2 minutes.</p><Link className="os-btn os-btn-brand" to="/market/sell">Post an ad</Link></>}
          </div>
        )}
        {boosting && <BoostSheet ad={boosting} onClose={() => setBoosting(null)} onDone={() => api.get('/market/mine').then((response) => setAds(response.data))} />}
        <div className="mk-mine">
          {shown.map((ad) => (
            <article key={ad._id} className="mk-mine-row">
              <Link to={`/market/item/${ad.slug}`} className="mk-mine-img"><AdImage ad={ad} /></Link>
              <div className="mk-mine-info">
                <Link to={`/market/item/${ad.slug}`}><b>{ad.title}</b></Link>
                <span className="mk-price-sm">{priceText(ad.price)}{ad.unit ? <small> / {unitShort(ad.unit)}</small> : null}</span>
                <small className="os-muted">📍 {[ad.area, ad.county].filter(Boolean).join(', ')} · {timeAgo(ad.createdAt)} · 👁 {ad.views} · 💬 {ad.chats}</small>
                {ad.buyNow && <small className="mk-online-tag">🛒 Sold online · {ad.stock} in stock</small>}
                {ad.status === 'active' && SOLD_BY_UNIT.includes(ad.category) && <QuickPrice ad={ad} onSaved={(updated) => setAds((previous) => previous.map((item) => (item._id === ad._id ? { ...item, ...updated, views: item.views, chats: item.chats } : item)))} />}
                {ad.status === 'hidden' && <small className="mk-err-text">Taken down by the marketplace team{ad.hiddenReason ? `: ${ad.hiddenReason}` : ''}</small>}
              </div>
              <div className="mk-mine-actions">
                {ad.status === 'active' && <button className="os-btn os-btn-brand" onClick={() => setBoosting(ad)}>{ad.featured ? '🔥 Featured: add days' : '🔥 Boost'}</button>}
                {ad.status !== 'hidden' && <Link className="os-btn os-btn-ghost" to={`/market/edit/${ad._id}`}>Edit</Link>}
                {ad.status === 'active' && <button className="os-btn os-btn-ghost" onClick={() => setStatus(ad, 'sold')}>Mark sold</button>}
                {ad.status === 'sold' && <button className="os-btn os-btn-ghost" onClick={() => setStatus(ad, 'active')}>Sell again</button>}
                <button className="os-btn os-btn-ghost mk-danger" onClick={() => remove(ad)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
