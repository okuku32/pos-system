import { Link } from 'react-router-dom';
import { imgUrl, priceText, timeAgo, tint } from './marketApi';

const ICONS = { vehicles: '🚗', electronics: '📱', 'land-property': '🏡', beddings: '🛏️', furniture: '🛋️', stationery: '✏️', packaging: '📦', liquor: '🍷', 'spare-parts': '🔧', bicycles: '🚲', 'kitchen-equipment': '🍳', utensils: '🍽️', 'clothes-shoes': '👗', bags: '👜', beauty: '💄', 'detergents-cleaning': '🧼', 'cooking-products': '🫒', beverages: '🥤', other: '🛍️' };
export const catIcon = (slug) => ICONS[slug] || '🛍️';

// Picture of the ad, or a tinted tile with the category icon when the seller added no photo
export function AdImage({ ad, src, className = '', eager = false, alt }) {
  const url = src ?? ad.image;
  const [a, b] = tint(ad.category);
  if (url) {
    return <img className={`mk-img ${className}`} src={imgUrl(url)} alt={alt ?? ad.title} loading={eager ? 'eager' : 'lazy'} decoding="async" width="400" height="300" />;
  }
  return (
    <div className={`mk-img mk-noimg ${className}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} role="img" aria-label={alt ?? ad.title}>
      <span>{catIcon(ad.category)}</span>
    </div>
  );
}

export default function ListingCard({ ad, index = 0 }) {
  return (
    <Link to={`/market/item/${ad.slug}`} className="mk-card" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
      <div className="mk-card-img">
        <AdImage ad={ad} eager={index < 4} />
        {ad.photos > 1 && <span className="mk-photos">📷 {ad.photos}</span>}
        {ad.status === 'sold' && <span className="mk-sold">SOLD</span>}
      </div>
      <div className="mk-card-body">
        <div className="mk-price">
          {priceText(ad.price)}
          {ad.negotiable && ad.price > 0 && <small>Negotiable</small>}
        </div>
        <h3 className="mk-card-title">{ad.title}</h3>
        {ad.facts?.length > 0 && (
          <div className="mk-facts">
            {ad.facts.map((f) => <span key={f}>{f}</span>)}
          </div>
        )}
        <div className="mk-card-meta">
          <span>📍 {[ad.area, ad.county].filter(Boolean).join(', ')}</span>
          <span>{timeAgo(ad.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export function CardSkeletons({ n = 8 }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="mk-card mk-skel" aria-hidden="true">
      <div className="mk-card-img" />
      <div className="mk-card-body"><i /><i /><i /></div>
    </div>
  ));
}
