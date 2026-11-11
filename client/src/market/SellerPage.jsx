import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errMsg, useSeo } from './marketApi';
import ListingCard, { CardSkeletons } from './ListingCard';
import './market.css';

export default function SellerPage() {
  const { id } = useParams();
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/market/sellers/${id}`).then((r) => setRes(r.data)).catch((e) => setError(errMsg(e)));
  }, [id]);
  const s = res?.seller;
  useSeo({ title: s ? `${s.name}’s ads (${res.items.length})` : 'Seller', description: s ? `See all ads posted by ${s.name} on the marketplace.` : '', noindex: !res?.items.length });

  if (error) return <div className="mk mk-wrap"><p className="mk-error">{error}</p><Link to="/market">Back to the marketplace</Link></div>;
  return (
    <div className="mk">
      <div className="mk-wrap">
        <div className="mk-seller-hero">
          <span className="mk-avatar big">{s?.name.slice(0, 1) || '…'}</span>
          <div>
            <h1>{s ? s.name : 'Loading…'}</h1>
            {s && <p className="os-muted">Member since {new Date(s.memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · {s.activeAds} live ad{s.activeAds === 1 ? '' : 's'}</p>}
          </div>
        </div>
        <div className="mk-grid">
          {res ? res.items.map((ad, i) => <ListingCard key={ad._id} ad={ad} index={i} />) : <CardSkeletons n={4} />}
        </div>
        {res && !res.items.length && <p className="os-muted">This seller has no live ads right now.</p>}
      </div>
    </div>
  );
}
