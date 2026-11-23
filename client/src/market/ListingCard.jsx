import { Link } from 'react-router-dom';
import { imgSrcSet, imgUrl, originTag, priceText, timeAgo, tint, unitShort } from './marketApi';

const ICONS = { 'african-crafts': '🎨', 'fresh-produce': '🥬', samaki: '🐟', vehicles: '🚗', electronics: '📱', 'land-property': '🏡', beddings: '🛏️', furniture: '🛋️', stationery: '✏️', packaging: '📦', liquor: '🍷', 'spare-parts': '🔧', bicycles: '🚲', appliances: '🔌', utensils: '🍽️', 'clothes-shoes': '👗', bags: '👜', beauty: '💄', 'detergents-cleaning': '🧼', 'cooking-products': '🫒', beverages: '🥤', 'baby-kids': '🧸', other: '🛍️' };
export const catIcon = (slug) => ICONS[slug] || '🛍️';

// Picture of the ad, or a tinted tile with the category icon when the seller added no photo
// An ad's photo (or, without one, its category's emoji on the category's colour).
//   photoWidth / sizes: how big the photo is shown. Cards are small (half a phone screen); the item page's gallery passes
//   its own (full width), and the server's ready-made first screen (server/market/firstScreen.js) uses the same values,
//   so the phone downloads the gallery photo once, at a sharp size.
export function AdImage({ ad, src, className = '', eager = false, alt, photoWidth = 480, sizes = '(max-width: 600px) 50vw, 240px', highPriority = false }) {
  const url = src ?? ad.image;
  const [value, other] = tint(ad.category);
  if (url) {
    return <img className={`mk-img ${className}`} src={imgUrl(url, photoWidth)} srcSet={imgSrcSet(url)} sizes={sizes} alt={alt ?? ad.title} loading={eager ? 'eager' : 'lazy'} fetchPriority={highPriority ? 'high' : undefined} decoding="async" width="400" height="300" />;
  }
  return (
    <div className={`mk-img mk-noimg ${className}`} style={{ background: `linear-gradient(135deg, ${value}, ${other})` }} role="img" aria-label={alt ?? ad.title}>
      <span>{catIcon(ad.category)}</span>
    </div>
  );
}

export default function ListingCard({ ad, index = 0 }) {
  const from = originTag(ad);
  const live = ad.status === 'active';
  const facts = (ad.facts || []).filter((fact) => !from?.brand || fact !== from.brand); // the brand is already in the origin tag
  return (
    <Link to={`/market/item/${ad.slug}`} className={`mk-card ${ad.featured ? 'is-featured' : ''} ${ad.topDeal ? 'is-top-deal' : ''}`} style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
      {/* 🔥 Featured / 🏆 Top deal / 🏷️ discount: a slim strip just above the picture (with the % off), never over it */}
      {live && (ad.featured || ad.topDeal || ad.discount > 0) && (
        <div className={`mk-card-ribbon ${ad.featured ? '' : ad.topDeal ? 'top' : 'deal'}`} aria-label={ad.discount > 0 ? `${ad.discount}% off` : undefined}>
          <span>{ad.featured ? '🔥' : ad.topDeal ? '🏆' : '🏷️'} <em className="mk-ribbon-name">{ad.featured ? 'Featured' : ad.topDeal ? 'Top deal' : 'Deal'}</em></span>
          {ad.discount > 0 && <b className="mk-ribbon-off">Save {ad.discount}%</b>}
        </div>
      )}
      <div className="mk-card-img">
        <AdImage ad={ad} eager={index < 4} />
        {ad.photos > 1 && <span className="mk-photos">📷 {ad.photos}</span>}
        {ad.status === 'sold' && <span className="mk-sold">{ad.buyNow ? 'SOLD OUT' : 'SOLD'}</span>}
      </div>
      <div className="mk-card-body">
        <div className="mk-price">
          <span className="mk-amount">{priceText(ad.price)}</span>
          {ad.unit && ad.price > 0 && <small className="mk-per">/ {unitShort(ad.unit)}</small>}
          {ad.discount > 0 && <s className="mk-was">{priceText(ad.wasPrice)}</s>}
          {ad.negotiable && ad.price > 0 && !ad.discount && <small>Negotiable</small>}
        </div>
        <h3 className="mk-card-title">{ad.title}</h3>
        {live && ad.buyNow && (
          <div className="mk-card-badges">
            <span className="mk-buy-badge static">🛒 Buy online</span>
          </div>
        )}
        {ad.wholesale && (
          <div className="mk-card-bulk">
            🏭 <b>{priceText(ad.wholesale.from)}</b>/{ad.wholesale.unit} at {ad.wholesale.fromQty}+{!ad.wholesale.retail && <em> · min {ad.wholesale.minQty}</em>}
          </div>
        )}
        {from && <span className={`mk-origin-tag ${from.flag === '🌱' || from.flag === '🌊' ? 'home' : ''}`}>{from.flag} {from.text}</span>}
        {(ad.verified || ad.polePole || (ad.buyNow && ad.freeDelivery)) && ad.status === 'active' && (
          <div className="mk-card-tags">
            {ad.verified && <span className="mk-tag-verified">✔ Verified seller</span>}
            {ad.buyNow && ad.freeDelivery && <span className="mk-free">🚚 Free delivery</span>}
            {ad.polePole && <span className="mk-tag-pole">🐢 Lipa Pole Pole</span>}
          </div>
        )}
        {facts.length > 0 && (
          <div className="mk-facts">
            {facts.map((fact) => <span key={fact}>{fact}</span>)}
          </div>
        )}
        <div className="mk-card-meta">
          <span>📍 {ad.km != null ? <b className="mk-card-km">{ad.km < 1 ? `${Math.max(50, Math.round(ad.km * 20) * 50)} m` : `${ad.km < 10 ? ad.km.toFixed(1) : Math.round(ad.km)} km`} away</b> : [ad.area, ad.county].filter(Boolean).join(', ')}</span>
          <span>{timeAgo(ad.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export function CardSkeletons({ n: number = 8 }) {
  return Array.from({ length: number }, (_, index) => (
    <div key={index} className="mk-card mk-skel" aria-hidden="true">
      <div className="mk-card-img" />
      <div className="mk-card-body"><i /><i /><i /></div>
    </div>
  ));
}
