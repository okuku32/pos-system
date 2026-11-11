import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, timeAgo, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { AdImage } from './ListingCard';
import './market.css';

const TABS = [['active', 'Live'], ['sold', 'Sold'], ['hidden', 'Taken down']];

export default function MyAds() {
  const { customer, ready } = useShop();
  const [ads, setAds] = useState(null);
  const [tab, setTab] = useState('active');
  useSeo({ title: 'My ads', noindex: true });

  useEffect(() => {
    if (!customer) return;
    api.get('/market/mine').then((r) => setAds(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [customer]);

  if (ready && !customer) return <Navigate to="/shop/login?next=%2Fmarket%2Fmy" replace />;

  const setStatus = async (ad, status) => {
    try {
      await api.patch(`/market/listings/${ad._id}/status`, { status });
      setAds((list) => list.map((a) => (a._id === ad._id ? { ...a, status } : a)));
      toast.success(status === 'sold' ? 'Marked as sold. Congratulations! 🎉' : 'Your ad is live again');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const remove = async (ad) => {
    if (!window.confirm(`Delete "${ad.title}"? This can’t be undone.`)) return;
    try {
      await api.delete(`/market/listings/${ad._id}`);
      setAds((list) => list.filter((a) => a._id !== ad._id));
      toast.success('Ad deleted');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const shown = (ads || []).filter((a) => a.status === tab);
  const count = (s) => (ads || []).filter((a) => a.status === s).length;

  return (
    <div className="mk">
      <div className="mk-wrap mk-narrow">
        <div className="mk-section-head">
          <h1>My ads</h1>
          <Link to="/market/sell" className="os-btn os-btn-brand">+ Post an ad</Link>
        </div>
        <div className="mk-tabs" role="tablist">
          {TABS.map(([k, l]) => (k !== 'hidden' || count('hidden') > 0) && (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {l} <small>{count(k)}</small>
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
        <div className="mk-mine">
          {shown.map((ad) => (
            <article key={ad._id} className="mk-mine-row">
              <Link to={`/market/item/${ad.slug}`} className="mk-mine-img"><AdImage ad={ad} /></Link>
              <div className="mk-mine-info">
                <Link to={`/market/item/${ad.slug}`}><b>{ad.title}</b></Link>
                <span className="mk-price-sm">{priceText(ad.price)}</span>
                <small className="os-muted">📍 {[ad.area, ad.county].filter(Boolean).join(', ')} · {timeAgo(ad.createdAt)} · 👁 {ad.views} · 💬 {ad.chats}</small>
                {ad.status === 'hidden' && <small className="mk-err-text">Taken down by the marketplace team{ad.hiddenReason ? `: ${ad.hiddenReason}` : ''}</small>}
              </div>
              <div className="mk-mine-actions">
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
