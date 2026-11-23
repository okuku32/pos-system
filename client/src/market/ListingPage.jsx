import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, takePrefetch, SOLD_BY_UNIT, unitShort, fieldsOf, findCat, findSub, imgUrl, originTag, minOrder, priceText, timeAgo, unitFor, unitName, useCategories, useSeo, adultOk, confirmAdult } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import ListingCard, { AdImage } from './ListingCard';
import AdultGate from './AdultGate';
import Presence, { OfflineHint } from './Presence';
import { BoostSheet, LipaSalama, OfferSheet, PriceGuide, SellerStats, ServiceScores, Stars, Verified, VisitSheet } from './Trust';
import { ShopLine } from './Maps';
import { PolePoleSheet } from './Plans';
import { CompareSellers } from './Relations';
import { CallButton } from '../shop/Calls';
import './market.css';

const QUICK = ['Is this still available?', 'What’s your last price?', 'Where can I view it?', 'Can you deliver?'];

// what buyers said about this seller's service (verified reviews from delivered orders)
function BuyersSay({ sellerId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api.get(`/market/sellers/${sellerId}/reviews`).then((response) => live && setData(response.data)).catch(() => {});
    return () => {
      live = false;
    };
  }, [sellerId]);
  const latest = (data?.reviews || []).filter((review) => review.comment).slice(0, 2);
  if (!data) return null;
  return (
    <div className="mk-buyers-say">
      <b>What buyers say</b>
      <ServiceScores service={data.service} />
      {latest.map((review) => (
        <blockquote key={review._id}><Stars value={review.rating} label={false} size={13} /> “{review.comment}” <cite>— {review.buyerName}, bought {review.itemTitle}</cite></blockquote>
      ))}
      <Link to={`/market/seller/${sellerId}#reviews`}>All {data.reviews.length} review{data.reviews.length === 1 ? '' : 's'} ›</Link>
    </div>
  );
}

// a price drop the seller made (shown for 30 days)
const onOffer = (listing) => listing.discountPercent >= 5 && listing.wasPrice > listing.price && listing.discountUntil && new Date(listing.discountUntil) > new Date();
export default function ListingPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { customer, addToCart, setCartOpen, cart } = useShop();
  const [qty, setQty] = useState(1);
  const data = useCategories();
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(0);
  const [phone, setPhone] = useState('');
  // the seller's number is only for signed-in people: logging out takes it off the screen
  useEffect(() => {
    if (!customer) setPhone('');
  }, [customer]);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [adult, setAdult] = useState(adultOk);
  const [sheet, setSheet] = useState(null); // 'offer' | 'visit' | 'boost' | 'pole'
  const [deal, setDeal] = useState(null); // my latest offer on this ad
  const listingId = res?.listing?._id;
  useEffect(() => {
    setDeal(null);
    if (!customer || !listingId || res?.listing?.mine) return;
    api.get(`/market/offers/for/${listingId}`).then((response) => setDeal(response.data)).catch(() => {});
  }, [customer, listingId, res?.listing?.mine]);

  // lift the floating help buttons above the sticky Chat / Call bar on phones
  useEffect(() => {
    document.body.classList.add('mk-sticky-on');
    return () => document.body.classList.remove('mk-sticky-on');
  }, []);

  useEffect(() => {
    let live = true;
    setRes(null);
    setError('');
    setPhoto(0);
    setPhone('');
    (takePrefetch(`/market/listings/${slug}`) || api.get(`/market/listings/${slug}`)).then((response) => live && setRes(response.data)).catch((innerError) => live && setError(innerError.response?.status === 404 ? 'gone' : errMsg(innerError)));
    // back to the top for the new item, but only if needed: scrollTo() forces a full layout straight away (slow at start-up)
    if (window.scrollY !== 0) window.scrollTo({ top: 0 });
    return () => {
      live = false;
    };
  }, [slug, customer?._id]);

  const listing = res?.listing;
  const cat = findCat(data, listing?.category);
  const sub = findSub(cat, listing?.sub);
  const where = listing ? [listing.area, listing.county].filter(Boolean).join(', ') : '';

  useSeo({
    title: listing ? `${listing.title}${listing.price > 0 ? ` – ${priceText(listing.price)}` : ''} | ${where}` : error === 'gone' ? 'Ad not found' : '',
    description: listing ? `${priceText(listing.price)}${listing.negotiable ? ' (negotiable)' : ''} · ${where}. ${listing.description.slice(0, 120)}` : '',
    image: listing?.images?.[0],
    noindex: error === 'gone' || listing?.status === 'hidden',
    path: `/market/item/${slug}`,
    jsonLd: listing
      ? {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: listing.title,
          description: listing.description,
          image: (listing.images || []).map((image) => `${window.location.origin}${image}`),
          offers: { '@type': 'Offer', priceCurrency: 'KES', ...(listing.price > 0 ? { price: listing.price } : {}), availability: listing.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' },
        }
      : null,
  });

  const needLogin = (why) => {
    toast(why, { icon: '🔐' });
    navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
  };

  const showPhone = async () => {
    if (!customer) return needLogin('Log in or sign up (free) to see the seller’s number');
    try {
      const response = await api.get(`/market/listings/${listing._id}/phone`);
      setPhone(response.data.phone);
    } catch (innerError) {
      toast.error(errMsg(innerError));
    }
  };

  const sendChat = async (text) => {
    const input = (text ?? msg).trim();
    if (!input) return;
    if (!customer) return needLogin('Log in or sign up (free) to chat with the seller');
    setSending(true);
    try {
      const response = await api.post('/market/conversations', { listingId: listing._id, text: input });
      toast.success('Message sent to the seller');
      navigate(`/market/messages/${response.data.conversation._id}`);
    } catch (innerError) {
      toast.error(errMsg(innerError));
    } finally {
      setSending(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: listing.title, text: `${listing.title} – ${priceText(listing.price)}`, url }).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success('Link copied');
    }
  };

  const report = async (reason) => {
    if (!customer) return needLogin('Log in to report an ad');
    try {
      const response = await api.post(`/market/listings/${listing._id}/report`, { reason });
      toast.success(response.data.alreadyReported ? 'You already reported this ad' : 'Thanks, our team will review this ad');
      setReporting(false);
    } catch (innerError) {
      toast.error(errMsg(innerError));
    }
  };

  const setStatus = async (status) => {
    try {
      await api.patch(`/market/listings/${listing._id}/status`, { status });
      setRes((previousRes) => ({ ...previousRes, listing: { ...previousRes.listing, status } }));
      toast.success(status === 'sold' ? 'Marked as sold' : 'Your ad is live again');
    } catch (innerError) {
      toast.error(errMsg(innerError));
    }
  };

  if (error === 'gone') {
    return (
      <div className="mk mk-wrap">
        <div className="os-empty">
          <div className="os-empty-art">🕵️</div>
          <h4>This ad is no longer available</h4>
          <p>It may have been sold or removed by the seller.</p>
          <Link className="os-btn os-btn-brand" to="/">Browse the marketplace</Link>
        </div>
      </div>
    );
  }
  if (error) return <div className="mk mk-wrap"><p className="mk-error">{error}</p></div>;
  if (!res) {
    return (
      <div className="mk mk-wrap">
        {/* min-height: while the ad loads, the footer stays below the screen instead of flashing up */}
        <div className="mk-ad mk-skel-page" style={{ minHeight: '100vh' }}><div className="mk-gallery mk-skel" /><div className="mk-side"><i /><i /><i /></div></div>
      </div>
    );
  }
  if (cat?.adult && !adult) return <AdultGate onYes={() => { confirmAdult(); setAdult(true); }} />;

  const images = listing.images || [];
  const facts = fieldsOf(cat, sub).filter((item) => listing.attrs?.[item.key] !== undefined && listing.attrs[item.key] !== '');
  const fmt = (field, value) => (field.type === 'number' && (field.key === 'mileage' || field.key === 'litres' || field.key === 'watts') ? Number(value).toLocaleString('en-KE') : String(value));
  const seller = res.seller;
  const buyable = listing.buyNow && listing.status === 'active' && !listing.mine && listing.stock > 0;
  const cartItem = { _id: listing._id, slug: listing.slug, title: listing.title, price: listing.price, image: listing.images?.[0] || '', category: listing.category, stock: listing.stock, sellerId: listing.sellerId, sellerName: seller?.name || listing.sellerName, delivery: listing.delivery, area: listing.area, county: listing.county, wholesale: listing.wholesale?.enabled ? listing.wholesale : undefined, layaway: listing.layaway?.enabled ? listing.layaway : undefined };
  const moq = minOrder(cartItem);
  const amount = Math.max(qty, moq);
  const unit = unitFor(cartItem, amount);
  const inCart = cart[listing._id]?.qty || 0;
  const dealOk = deal && deal.status === 'accepted';
  const buyDeal = (now = true) => {
    const dq = deal.qty || 1;
    const delivery = listing.buyNow ? listing.delivery : { available: !!deal.delivery?.available, fee: deal.delivery?.available ? deal.delivery.fee || 0 : 0, pickup: deal.delivery?.pickup !== false };
    addToCart({ ...cartItem, price: deal.amount, offerId: deal._id, delivery, stock: listing.buyNow ? Math.min(listing.stock, dq) : dq, wholesale: undefined }, dq);
    if (now) navigate(customer ? '/checkout' : '/login?next=checkout');
    else {
      toast.success('Added to your cart at the agreed price');
      setCartOpen(true);
    }
  };
  // ads not sold online can still be paid for at a price agreed in the chat (not vehicles, land or services)
  const dealBox = !buyable && dealOk && !listing.mine && listing.status === 'active' && !['vehicles', 'land-property'].includes(listing.category) && listing.sub !== 'services' && (
    <div className="mk-box mk-buybox" id="buy">
      <div className="mk-deal">
        <span>🤝 Your agreed price: <b>{priceText(deal.amount)}</b>{deal.qty > 1 ? ` × ${deal.qty}` : ''}</span>
        <small>{[deal.delivery?.pickup !== false ? '📍 Pick up' : '', deal.delivery?.available ? `🚚 Delivery ${deal.delivery.fee ? priceText(deal.delivery.fee) : 'free'}` : ''].filter(Boolean).join(' · ')} · valid until {new Date(deal.expiresAt).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>
        <button className="os-btn os-btn-brand os-block" onClick={() => buyDeal(false)}>🛒 Add to cart at {priceText(deal.amount)}</button>
        <button className="os-btn os-btn-dark os-block" onClick={() => buyDeal(true)}>Buy now</button>
      </div>
      <LipaSalama />
    </div>
  );
  const buy = (now) => {
    addToCart(cartItem, amount);
    if (now) navigate(customer ? '/checkout' : '/login?next=checkout');
    else {
      toast.success('Added to your cart');
      setCartOpen(true);
    }
  };
  const buyBox = buyable && (
    <div className="mk-box mk-buybox" id="buy">
      <div className="mk-buy-top">
        <span className="mk-buy-badge static">🛒 Buy online</span>
        <small className={listing.stock <= 3 ? 'mk-low' : 'os-muted'}>{listing.stock <= 3 ? `Only ${listing.stock} left!` : `${listing.stock} in stock`}</small>
      </div>
      <ul className="mk-buy-facts">
        {listing.delivery?.available && <li>🚚 {listing.delivery.fee ? `Delivery ${priceText(listing.delivery.fee)}` : 'Free delivery'}{listing.delivery.days ? ` · ${listing.delivery.days}` : ''}</li>}
        {listing.delivery?.pickup && <li>📍 Free pickup in {[listing.area, listing.county].filter(Boolean).join(', ')}</li>}
        <li>💳 M-Pesa or pay on delivery</li>
      </ul>
      <LipaSalama />
      {dealOk && (
        <div className="mk-deal">
          <span>🤝 Your agreed price: <b>{priceText(deal.amount)}</b></span>
          <small>Valid until {new Date(deal.expiresAt).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>
          <div className="mk-deal-actions">
            <button className="os-btn os-btn-brand" onClick={() => buyDeal(false)}>🛒 Add to cart at {priceText(deal.amount)}</button>
            <button className="os-btn os-btn-dark" onClick={() => buyDeal(true)}>Buy now</button>
          </div>
        </div>
      )}
      <div className="mk-buy-row">
        <div className="mk-stepper" aria-label="Quantity">
          <button onClick={() => setQty(Math.max(moq, amount - 1))} aria-label="One less" disabled={amount <= moq}>−</button>
          <input className="mk-qty-input" inputMode="numeric" value={amount} onChange={(event) => setQty(Math.min(listing.stock, Math.max(1, Number(event.target.value.replace(/\D/g, '')) || 1)))} aria-label="Quantity" />
          <button onClick={() => setQty(Math.min(listing.stock, amount + 1))} aria-label="One more" disabled={amount >= listing.stock}>+</button>
        </div>
        <button className="os-btn os-btn-dark os-grow" onClick={() => buy(false)}>Add to cart</button>
      </div>
      {unit < listing.price && <p className="mk-bulk-saving">🏭 Bulk price {priceText(unit)} per {unitName(cartItem, 1)}: you save {priceText((listing.price - unit) * amount)}</p>}
      <button className="os-btn os-btn-brand os-btn-lg os-block" onClick={() => buy(true)}>Buy now · {priceText(unit * amount)}</button>
      {listing.layaway?.enabled && (
        <button className="mk-pole-btn" onClick={() => (customer ? setSheet('pole') : navigate(`/login?next=${encodeURIComponent(location.pathname)}`))}>
          <b>🐢 Lipa Pole Pole</b>
          <span>Pay {priceText(Math.ceil(((dealOk ? deal.amount : listing.price) * listing.layaway.minDepositPercent) / 100))} today, the rest over {listing.layaway.maxWeeks} week{listing.layaway.maxWeeks > 1 ? 's' : ''}</span>
        </button>
      )}
      {inCart > 0 && <button className="os-linkbtn mk-incart" onClick={() => setCartOpen(true)}>{inCart} in your cart: view cart</button>}
    </div>
  );
  const canOffer = !listing.mine && listing.status === 'active' && listing.price > 0;
  const canVisit = !listing.mine && listing.status === 'active' && ['land-property', 'vehicles'].includes(listing.category);
  const needLoginFor = (what) => (customer ? setSheet(what) : needLogin('Log in or sign up (free) to continue'));
  const waNumber = phone && phone.replace(/\D/g, '');

  return (
    <div className="mk">
      <div className="mk-wrap">
        <nav className="mk-crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link> › {cat && <><Link to={`/market/${cat.slug}`}>{cat.name}</Link> › </>}
          {sub && <><Link to={`/market/${cat.slug}/${sub.slug}`}>{sub.name}</Link> › </>}
          <span>{listing.title}</span>
        </nav>

        {listing.status === 'sold' && <div className="mk-banner sold">This item has been sold.</div>}
        {listing.status === 'hidden' && <div className="mk-banner hidden">This ad was taken down by the marketplace team{listing.hiddenReason ? `: ${listing.hiddenReason}` : ''}. Only you can see it.</div>}

        <div className="mk-ad">
          <div className="mk-ad-main">
            <div className="mk-gallery">
              <AdImage ad={listing} src={images[photo] || ''} eager highPriority photoWidth={1080} sizes="(max-width: 760px) 100vw, 800px" className="mk-gallery-main" alt={`${listing.title}${images.length > 1 ? `, photo ${photo + 1}` : ''}`} />
              {images.length > 1 && (
                <>
                  <button className="mk-gal-nav prev" onClick={() => setPhoto((previousPhoto) => (previousPhoto - 1 + images.length) % images.length)} aria-label="Previous photo">‹</button>
                  <button className="mk-gal-nav next" onClick={() => setPhoto((previousPhoto) => (previousPhoto + 1) % images.length)} aria-label="Next photo">›</button>
                  <span className="mk-gal-count">{photo + 1} / {images.length}</span>
                </>
              )}
            </div>
            {listing.photoCredit?.source && /^https:\/\//.test(images[photo] || '') && (
              <p className="mk-photo-credit">
                Stock photo: <a href={listing.photoCredit.profile || listing.photoCredit.link} target="_blank" rel="noopener noreferrer">{listing.photoCredit.name}</a>
                {listing.photoCredit.license && <> ({listing.photoCredit.licenseUrl ? <a href={listing.photoCredit.licenseUrl} target="_blank" rel="noopener noreferrer license">{listing.photoCredit.license}</a> : listing.photoCredit.license})</>}
                {' '}via <a href={listing.photoCredit.link} target="_blank" rel="noopener noreferrer">{listing.photoCredit.source}</a>. The seller’s item may look different.
              </p>
            )}
            {images.length > 1 && (
              <div className="mk-thumbs">
                {images.map((image, index) => (
                  <button key={image} className={index === photo ? 'on' : ''} onClick={() => setPhoto(index)} aria-label={`Photo ${index + 1}`}>
                    <img src={imgUrl(image)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            <div className="mk-ad-head mk-only-mobile">
              <h1>{listing.title}</h1>
              <div className="mk-ad-price">{priceText(listing.price)}{SOLD_BY_UNIT.includes(listing.category) && listing.attrs?.unit && listing.price > 0 && <span className="mk-per">/ {unitShort(listing.attrs.unit)}</span>}{onOffer(listing) && <><s className="mk-was">{priceText(listing.wasPrice)}</s><span className="mk-discount-pill">Save {listing.discountPercent}% · {priceText(listing.wasPrice - listing.price)}</span></>}{listing.negotiable && listing.price > 0 && <small>Negotiable</small>}</div>
              <p className="mk-ad-meta">📍 {where} · {timeAgo(listing.createdAt)} · 👁 {listing.views} views</p>
              {seller && <a href="#contact" className="mk-ad-seller-status">Seller <b>{seller.name.split(' ')[0]}</b> <Presence id={seller._id} /></a>}
            </div>

            {(listing.condition || facts.length > 0) && (
              <section className="mk-box">
                <h2>Details</h2>
                <dl className="mk-details">
                  {listing.condition && <div className="mk-detail"><dt>Condition</dt><dd>{listing.condition}</dd></div>}
                  {originTag(listing) && <div className="mk-detail"><dt>Where it’s from</dt><dd><Link to={`/imports/${listing.origin}`}>{originTag(listing).flag} {originTag(listing).long}</Link></dd></div>}
                  {facts.map((fact) => <div key={fact.key} className="mk-detail"><dt>{fact.label}</dt><dd>{fmt(fact, listing.attrs[fact.key])}</dd></div>)}
                </dl>
              </section>
            )}

            {listing.category === 'vehicles' && <PriceGuide listing={listing} />}

            {listing.wholesale?.enabled && (
              <section className="mk-box mk-bulk-box">
                <h2>🏭 Wholesale prices <small className="os-muted">(bei ya jumla)</small></h2>
                <table className="mk-bulk-table">
                  <thead><tr><th>Quantity</th><th>Price per {listing.wholesale.unit || 'unit'}</th><th>You save</th></tr></thead>
                  <tbody>
                    {listing.wholesale.retail !== false && <tr><td>1 – {listing.wholesale.tiers[0].minQty - 1}</td><td>{priceText(listing.price)}</td><td>–</td></tr>}
                    {listing.wholesale.tiers.map((tier, index) => (
                      <tr key={tier.minQty}>
                        <td>{tier.minQty}{listing.wholesale.tiers[index + 1] ? ` – ${listing.wholesale.tiers[index + 1].minQty - 1}` : '+'}</td>
                        <td><b>{priceText(tier.price)}</b></td>
                        <td className="mk-green">{listing.price > tier.price ? `${Math.round(((listing.price - tier.price) / listing.price) * 100)}%` : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {listing.wholesale.retail === false && <p className="mk-hint">Sold in bulk only: minimum order {listing.wholesale.tiers[0].minQty} {unitName(cartItem)}.</p>}
                {!listing.buyNow && <p className="mk-hint">Chat with the seller to order in bulk.</p>}
              </section>
            )}

            <section className="mk-box">
              <h2>Description</h2>
              <p className="mk-desc">{listing.description}</p>
              {res.store && !res.store.isMain && <p className="mk-hint">🏬 Sold from {res.store.name}, {res.store.area || res.store.county}{res.store.hours ? ` · ${res.store.hours}` : ''}</p>}
            </section>
            <CompareSellers product={res.product} current={listing._id} />
          </div>

          <aside className="mk-side">
            <div className="mk-box mk-ad-head mk-only-desktop">
              <h1>{listing.title}</h1>
              <div className="mk-ad-price">{priceText(listing.price)}{SOLD_BY_UNIT.includes(listing.category) && listing.attrs?.unit && listing.price > 0 && <span className="mk-per">/ {unitShort(listing.attrs.unit)}</span>}{onOffer(listing) && <><s className="mk-was">{priceText(listing.wasPrice)}</s><span className="mk-discount-pill">Save {listing.discountPercent}% · {priceText(listing.wasPrice - listing.price)}</span></>}{listing.negotiable && listing.price > 0 && <small>Negotiable</small>}</div>
              <p className="mk-ad-meta">📍 {where}<br />Posted {timeAgo(listing.createdAt)} · 👁 {listing.views} views</p>
            </div>

            {buyBox || dealBox}
            {listing.buyNow && listing.status === 'sold' && !listing.mine && <div className="mk-banner sold">Sold out online. Chat with the seller to ask about more stock.</div>}
            {listing.mine ? (
              <div className="mk-box">
                <h2>This is your ad</h2>
                <div className="mk-owner-actions">
                  <Link className="os-btn os-btn-dark" to={`/market/edit/${listing._id}`}>✏️ Edit ad</Link>
                  {listing.status === 'active' && <button className="os-btn os-btn-brand" onClick={() => setSheet('boost')}>🔥 {listing.boostedUntil && new Date(listing.boostedUntil) > new Date() ? `Featured until ${new Date(listing.boostedUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: add days` : 'Boost: show it first'}</button>}
                  {listing.status === 'active' && <button className="os-btn os-btn-ghost" onClick={() => setStatus('sold')}>✅ Mark as sold</button>}
                  {listing.status === 'sold' && <button className="os-btn os-btn-ghost" onClick={() => setStatus('active')}>↺ Sell again</button>}
                  <Link className="os-btn os-btn-ghost" to="/market/my">My ads</Link>
                </div>
              </div>
            ) : (
              <div className="mk-box mk-seller" id="contact">
                {seller && (
                  <div className="mk-seller-headrow">
                    <Link to={`/market/seller/${seller._id}`} className="mk-seller-head">
                      <span className="mk-avatar">{seller.name.slice(0, 1)}</span>
                      <span>
                        <b>{seller.name} {seller.verified && <Verified small />}</b>
                        <Presence id={seller._id} />
                        <small>{seller.activeAds} live ad{seller.activeAds === 1 ? '' : 's'}{seller.county ? ` · ${seller.county}` : ''} · see profile ›</small>
                      </span>
                    </Link>
                    {listing.status === 'active' && (
                      <span className="mk-seller-reach">
                        <CallButton person={{ _id: seller._id, name: seller.name, avatar: seller.avatar }} compact />
                        {listing.hasPhone && (phone ? (
                          <span className="mk-contact inline" aria-label="Seller’s contacts">
                            <a className="os-btn mk-contact-num" href={`tel:+${phone}`}>📞 {prettyPhone(phone)}</a>
                            <a className="os-btn mk-contact-wa" href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi, I saw your ad "${listing.title}" on Kapu: ${window.location.href}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                          </span>
                        ) : <button type="button" className="os-btn mk-show-number compact" onClick={showPhone}>{customer ? '📞 Show contacts' : '🔒 Log in to see contacts'}</button>)}
                      </span>
                    )}
                  </div>
                )}
                {seller && <SellerStats s={seller} />}
                {seller?.rating?.count > 0 && <BuyersSay sellerId={seller._id} />}
                {seller?.shop && <ShopLine shop={seller.shop} />}
                {seller && !seller.verified && <p className="mk-unverified">This seller isn’t verified yet. Meet in a public place and don’t pay before you see the item.</p>}
                {(canOffer || canVisit) && (
                  <div className="mk-deal-actions">
                    {canOffer && !dealOk && <button className="os-btn os-btn-ghost" onClick={() => needLoginFor('offer')}>💰 {deal && ['pending', 'countered'].includes(deal.status) ? `Offer: ${priceText(deal.amount)} (${deal.status === 'pending' ? 'waiting' : 'countered!'})` : 'Make an offer'}</button>}
                    {canVisit && <button className="os-btn os-btn-ghost" onClick={() => needLoginFor('visit')}>📅 {listing.category === 'land-property' ? 'Book a site visit' : 'Book a viewing'}</button>}
                  </div>
                )}
                {dealOk && !listing.buyNow && <div className="mk-deal"><span>🤝 Deal agreed at <b>{priceText(deal.amount)}</b>. Arrange the meeting in the chat.</span></div>}
                {listing.status === 'active' && (
                  <>
                    {seller && <OfflineHint id={seller._id} name={seller.name} />}
                    <div className="mk-quick">
                      {QUICK.map((qq) => <button key={qq} onClick={() => setMsg(qq)} className={msg === qq ? 'on' : ''}>{qq}</button>)}
                    </div>
                    <form className="mk-chatbox" onSubmit={(event) => { event.preventDefault(); sendChat(); }}>
                      <textarea rows={2} maxLength={2000} value={msg} onChange={(event) => setMsg(event.target.value)} placeholder={`Write to ${seller?.name.split(' ')[0] || 'the seller'}…`} aria-label="Message to the seller" />
                      <button className="os-btn os-btn-brand os-block" disabled={sending}>{sending ? 'Sending…' : '💬 Chat with seller'}</button>
                    </form>
                  </>
                )}
              </div>
            )}

            <div className="mk-box mk-tips">
              <h2>Safety tips</h2>
              <ul>
                <li>Meet in a safe public place.</li>
                <li>Check the item before you pay.</li>
                <li>Never pay a deposit or send M-Pesa in advance.</li>
                {listing.category === 'land-property' && <li>Do a land search at the Lands registry before paying anything.</li>}
                {listing.category === 'vehicles' && <li>Confirm the logbook details on NTSA eCitizen.</li>}
              </ul>
            </div>

            <div className="mk-ad-links">
              <button className="os-linkbtn" onClick={share}>🔗 Share</button>
              <a className="os-linkbtn" href={`https://wa.me/?text=${encodeURIComponent(`${listing.title} – ${priceText(listing.price)} ${window.location.href}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              {!listing.mine && <button className="os-linkbtn mk-report" onClick={() => setReporting((previousReporting) => !previousReporting)}>🚩 Report ad</button>}
            </div>
            {reporting && (
              <div className="mk-box mk-report-box">
                <b>What’s wrong with this ad?</b>
                {['It’s a scam / fraud', 'Item already sold', 'Wrong category or price', 'Prohibited item', 'Offensive content'].map((item) => (
                  <button key={item} onClick={() => report(item)}>{item}</button>
                ))}
              </div>
            )}
          </aside>
        </div>

        {res.similar?.length > 0 && (
          <section>
            <div className="mk-section-head">
              <h2>Similar {sub ? sub.name.toLowerCase() : 'ads'}</h2>
              {cat && sub && <Link className="mk-more" to={`/market/${cat.slug}/${sub.slug}`}>See all →</Link>}
            </div>
            <div className="mk-grid">{res.similar.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>
          </section>
        )}
      </div>

      {sheet === 'offer' && <OfferSheet listing={listing} onClose={() => setSheet(null)} />}
      {sheet === 'visit' && <VisitSheet listing={listing} onClose={() => setSheet(null)} />}
      {sheet === 'boost' && <BoostSheet ad={listing} onClose={() => setSheet(null)} onDone={() => setRes((previousRes) => ({ ...previousRes, listing: { ...previousRes.listing, boostedUntil: new Date(Date.now() + 86400000 * 7).toISOString() } }))} />}
      {sheet === 'pole' && <PolePoleSheet listing={listing} price={dealOk ? deal.amount : listing.price} offerId={dealOk ? deal._id : undefined} onClose={() => setSheet(null)} />}
      {!listing.mine && listing.status === 'active' && (
        <div className="mk-sticky-contact mk-only-mobile">
          {buyable ? (
            <>
              <a href="#contact" className="os-btn os-btn-ghost mk-sticky-chat" aria-label="Chat with seller" onClick={(event) => { event.preventDefault(); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}>💬</a>
              <button className="os-btn os-btn-dark os-grow" onClick={() => buy(false)}>Add to cart</button>
              <button className="os-btn os-btn-brand os-grow" onClick={() => buy(true)}>Buy now</button>
            </>
          ) : (
            <>
              <a href="#contact" className="os-btn os-btn-brand os-grow" onClick={(event) => { event.preventDefault(); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}>💬 Chat</a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
