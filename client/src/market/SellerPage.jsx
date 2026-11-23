import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import ListingCard, { CardSkeletons } from './ListingCard';
import { SERVICE, SellerStats, ServiceScores, Stars, Verified } from './Trust';
import Presence from './Presence';
import SellerContact from './SellerContact';
import { CallButton } from '../shop/Calls';
import { ShopMapCard } from './Maps';
import { PhotoRequestBox } from './PhotoRequest';
import './market.css';

export default function SellerPage() {
  const { id } = useParams();
  const { customer } = useShop();
  const [res, setRes] = useState(null);
  const [rev, setRev] = useState(null);
  const [error, setError] = useState('');
  const [replying, setReplying] = useState(null);
  const [reply, setReply] = useState('');
  const loadReviews = () => api.get(`/market/sellers/${id}/reviews`).then((response) => setRev(response.data)).catch(() => {});
  useEffect(() => {
    api.get(`/market/sellers/${id}`).then((response) => setRes(response.data)).catch((innerError) => setError(errMsg(innerError)));
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const seller = res?.seller;
  const mine = customer && String(customer._id) === String(id);
  useSeo({ title: seller ? `${seller.name}’s ads (${res.items.length})` : 'Seller', description: seller ? `See all ads by ${seller.name}${seller.rating?.count ? `, rated ${seller.rating.avg}/5 by ${seller.rating.count} buyers` : ''}.` : '', noindex: !res?.items.length });

  const sendReply = async (currentReply, reviewId) => {
    currentReply.preventDefault();
    try {
      await api.post(`/market/reviews/${reviewId}/reply`, { text: reply });
      setReplying(null);
      setReply('');
      loadReviews();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (error) return <div className="mk mk-wrap"><p className="mk-error">{error}</p><Link to="/">Back to the marketplace</Link></div>;
  const total = rev?.distribution.reduce((value, date) => value + date.n, 0) || 0;
  return (
    <div className="mk">
      <div className="mk-wrap">
        <div className="mk-seller-hero">
          <span className="mk-avatar big">{seller?.name.slice(0, 1) || '…'}</span>
          <div>
            <div className="mk-seller-titlerow">
              <h1>{seller ? seller.name : 'Loading…'} {seller?.verified && <Verified />}</h1>
              {seller && !mine && (
                <div className="mk-seller-reach">
                  <CallButton person={{ _id: seller._id, name: seller.name, avatar: seller.avatar }} />
                  <SellerContact sellerId={seller._id} available={seller.contact !== false} />
                </div>
              )}
            </div>
            {seller && <Presence id={seller._id} />}
            {seller?.about && <p className="mk-seller-about">{seller.about}</p>}
            {seller?.trade?.wholesale?.length > 0 && <p className="mk-seller-trade">🏭 <b>Wholesale:</b> {seller.trade.wholesale.map((cat) => cat.name).join(', ')}</p>}
            {seller?.trade?.imports?.length > 0 && <p className="mk-seller-trade">🌍 <b>Imports:</b> {seller.trade.imports.map((cat) => cat.name).join(', ')}{seller.trade.importFrom?.length ? <> from {seller.trade.importFrom.map((country) => `${country.flag} ${country.name}`).join(', ')}</> : null}</p>}
            <SellerStats s={seller} />
          </div>
        </div>
        {seller?.shop && <ShopMapCard shop={seller.shop} sellerName={seller.name} />}
        <h2 className="mk-subhead">{seller ? `${seller.activeAds} live ad${seller.activeAds === 1 ? '' : 's'}` : 'Ads'}</h2>
        <div className="mk-grid">
          {res ? res.items.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />) : <CardSkeletons n={4} />}
        </div>
        {res && !res.items.length && <p className="os-muted">No live ads right now.</p>}
        {seller && !mine && res?.items.length > 0 && <PhotoRequestBox seller={seller} />}

        <section className="mk-reviews" id="reviews">
          <h2 className="mk-subhead">Reviews {total ? `(${total})` : ''}</h2>
          {total === 0 && <p className="os-muted">No reviews yet. Reviews come only from buyers whose order was delivered.</p>}
          {total > 0 && (
            <div className="mk-review-summary">
              <div className="mk-review-big"><b>{seller?.rating?.avg?.toFixed(1)}</b><Stars value={seller?.rating?.avg || 0} label={false} size={20} /><small>{total} verified review{total === 1 ? '' : 's'}</small></div>
              <ServiceScores service={rev.service} />
              <div className="mk-review-bars">
                {rev.distribution.map((item) => (
                  <div key={item.stars}><span>{item.stars}★</span><i><em style={{ width: `${(item.n / total) * 100}%` }} /></i><small>{item.n}</small></div>
                ))}
              </div>
            </div>
          )}
          {rev?.reviews.map((order) => (
            <article key={order._id} className="mk-review">
              <div className="mk-review-top"><Stars value={order.rating} label={false} /><b>{order.buyerName}</b><small>bought {order.itemTitle} · {new Date(order.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
              {order.comment && <p>{order.comment}</p>}
              {Object.values(order.aspects || {}).some(Boolean) && <small className="mk-review-aspects">{SERVICE.filter(([key]) => order.aspects[key]).map(([key, text]) => `${text} ${order.aspects[key]}★`).join(' · ')}</small>}
              {order.reply && <p className="mk-review-reply"><b>Seller’s reply:</b> {order.reply}</p>}
              {mine && !order.reply && (replying === order._id ? (
                <form className="mk-card-actions" onSubmit={(event) => sendReply(event, order._id)}>
                  <input value={reply} onChange={(event) => setReply(event.target.value)} maxLength={500} placeholder="Thank the buyer or answer their comment" autoFocus />
                  <button className="os-btn os-btn-brand">Reply</button>
                </form>
              ) : <button className="os-linkbtn" onClick={() => setReplying(order._id)}>Reply publicly</button>)}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
