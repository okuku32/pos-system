// Any nearby seller's items, right on the "near me" page (mama mbogas, wholesalers, importers, shops…):
// pick quantities — or, for fresh produce, how much you want to spend — and see the total with the
// cheapest delivery for your distance before you check out.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, imgUrl, minOrder, unitFor, useCategories } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { catIcon } from './ListingCard';

const ksh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
const SPEND = [50, 100, 200, 500];
const unitName = (it) => (it.wholesale?.unit ? it.wholesale.unit : it.unit ? it.unit.replace(/\s*\(.*\)/, '').replace('Bag / sack', 'bag').toLowerCase() : 'piece');

export default function Basket({ sellerId, here, compact = false, type = '', wear = '', trade = '' }) {
  const { cart, addToCart, setQty, customer } = useShop();
  const navigate = useNavigate();
  useCategories();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    let live = true;
    api.get(`/market/sellers/${sellerId}/basket`, { params: { ...(type ? { type } : {}), ...(wear ? { wear } : {}), ...(trade ? { trade } : {}) } }).then((response) => live && setData(response.data)).catch(() => live && setError('Couldn’t load the items. Try again.'));
    return () => {
      live = false;
    };
  }, [sellerId, type, wear, trade]);

  // what's in my cart from this seller
  const lines = useMemo(() => Object.entries(cart).filter(([, value]) => String(value.item.sellerId) === String(sellerId)), [cart, sellerId]);
  const units = lines.reduce((total, [, value]) => total + value.qty, 0);
  const subtotal = lines.reduce((total, [, value]) => total + unitFor(value.item, value.qty) * value.qty, 0);

  // our walking / rider delivery for my distance
  useEffect(() => {
    if (!here || !units) return setQuote(null);
    let live = true;
    const timer = setTimeout(() => {
      api.get('/market/delivery-quote', { params: { seller: sellerId, near: `${here.lat.toFixed(5)},${here.lng.toFixed(5)}`, units, subtotal } })
        .then((response) => live && setQuote(response.data))
        .catch(() => live && setQuote({ rider: { ok: false }, walk: { ok: false } }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [here, sellerId, units, subtotal]);
  // the cheapest way to get it to me: the seller's own delivery, walking delivery, or one of our riders
  const own = lines.length && lines.every(([, value]) => value.item.delivery?.available !== false) ? { ok: true, fee: Math.max(0, ...lines.map(([, value]) => value.item.delivery?.fee || 0)) } : null;
  const ways = [
    own && ['delivery', own.fee, '🚚 Seller delivers'],
    quote?.walk?.ok && ['walk', quote.walk.fee, `🚶 Walking delivery · ${quote.walk.km} km, ~${quote.walk.minutes} min`],
    quote?.rider?.ok && ['rider', quote.rider.fee, `🏍️ Our rider · ${quote.rider.km} km`],
  ].filter(Boolean);
  const best = ways.sort((first, second) => first[1] - second[1])[0];
  const fee = best ? best[1] : 0;

  const qtyOf = (id) => cart[id]?.qty || 0;
  const setTo = (it, number) => {
    const moq = minOrder(it);
    let amount = Math.max(0, Math.min(number, it.stock));
    if (amount > 0 && amount < moq) amount = number < qtyOf(it._id) ? 0 : moq; // bulk-only items: straight to the minimum (or out)
    if (cart[it._id]) setQty(it._id, amount);
    else if (amount > 0) addToCart(it, amount);
  };
  const checkout = () => {
    const query = best ? `?method=${best[0]}` : '';
    navigate(customer ? `/checkout${query}` : `/login?next=${encodeURIComponent(`checkout${query}`)}`);
  };

  if (error) return <p className="mk-err-text">{error}</p>;
  if (!data) return <div className="mk-basket"><div className="page-loading"><span className="page-spinner" /></div></div>;
  const askList = data.ask?.length > 0 && (
    <div className="mk-basket-ask">
      <small>Ask the seller about{data.items.length ? ' these too' : ''}:</small>
      {data.ask.map((listing) => (
        <Link key={listing._id} to={`/market/item/${listing.slug}`}>
          <span className="mk-basket-img">{listing.image ? <img src={imgUrl(listing.image)} alt="" loading="lazy" /> : <span>{catIcon(listing.category)}</span>}</span>
          <span>{listing.title}</span>
          <b>{listing.price ? ksh(listing.price) : 'Ask'}</b>
        </Link>
      ))}
    </div>
  );
  if (!data.items.length) {
    return (
      <div className="mk-basket">
        <p className="os-muted">{data.kind ? `No ${data.kind} items to buy online here right now.` : 'Nothing to buy online here right now.'}{data.others ? <> They have {data.others} other ad{data.others === 1 ? '' : 's'}: <Link to={`/market/seller/${sellerId}`}>view shop</Link>.</> : ''}</p>
        {askList}
      </div>
    );
  }

  return (
    <div className={`mk-basket ${compact ? 'compact' : ''}`}>
      {data.kind && <p className="mk-basket-kind">Their {data.kind} items</p>}
      <ul className="mk-basket-items">
        {data.items.map((it) => {
          const qtyOfResult = qtyOf(it._id);
          const moq = minOrder(it);
          const fresh = it.category === 'fresh-produce' || it.category === 'samaki'; // "spend KSh 50 / 100" buttons
          const tiers = it.wholesale?.enabled && it.wholesale.tiers?.length ? it.wholesale.tiers : null;
          return (
            <li key={it._id} className={qtyOfResult ? 'on' : ''}>
              <Link to={`/market/item/${it.slug}`} className="mk-basket-img">{it.image ? <img src={imgUrl(it.image)} alt="" loading="lazy" /> : <span>{catIcon(it.category)}</span>}</Link>
              <div className="mk-basket-info">
                <b>{it.title}</b>
                <small>{ksh(unitFor(it, Math.max(qtyOfResult, moq)))} / {unitName(it)}{it.stock <= 5 ? ` · only ${it.stock} left` : ''}{moq > 1 ? ` · min ${moq}` : ''}</small>
                {(it.condition || it.fits) && <small className="mk-basket-facts">{[it.condition, it.fits && `Fits ${it.fits}`].filter(Boolean).join(' · ')}</small>}
                {tiers && <small className="mk-basket-tiers">🏭 {tiers.map((tier) => `${tier.minQty}+ ${ksh(tier.price)}`).join(' · ')}</small>}
                {fresh && (
                  <div className="mk-basket-spend" role="group" aria-label={`Spend on ${it.title}`}>
                    {SPEND.filter((item) => item >= it.price && item / it.price <= it.stock).slice(0, 3).map((item) => (
                      <button type="button" key={item} className={qtyOfResult && qtyOfResult === Math.floor(item / it.price) ? 'on' : ''} onClick={() => setTo(it, Math.floor(item / it.price))}>{ksh(item)}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mk-basket-qty">
                {qtyOfResult === 0 && !fresh ? (
                  <button type="button" className="os-btn os-btn-dark mk-basket-add" onClick={() => setTo(it, moq)} aria-label={`Add ${it.title} to cart`}>+ Add{moq > 1 ? ` ${moq}` : ''}</button>
                ) : (
                  <div className="mk-stepper">
                    <button type="button" onClick={() => setTo(it, qtyOfResult - 1)} disabled={!qtyOfResult} aria-label={`One less ${it.title}`}>−</button>
                    <span aria-live="polite">{qtyOfResult}</span>
                    <button type="button" onClick={() => setTo(it, qtyOfResult + 1)} disabled={qtyOfResult >= it.stock} aria-label={`One more ${it.title}`}>+</button>
                  </div>
                )}
                {qtyOfResult > 0 && <small>{ksh(unitFor(it, qtyOfResult) * qtyOfResult)}</small>}
              </div>
            </li>
          );
        })}
      </ul>
      {askList}
      {data.others > 0 && <p className="mk-basket-more">{data.kind ? `+ ${data.others} other item${data.others === 1 ? '' : 's'} in this shop.` : `+ ${data.others} more ad${data.others === 1 ? '' : 's'} to ask the seller about.`} <Link to={`/market/seller/${sellerId}`}>See everything they sell →</Link></p>}
      <div className="mk-basket-sum" aria-live="polite">
        <div><span>In your cart from this seller ({units})</span><b>{ksh(subtotal)}</b></div>
        <div>
          <span>{!units ? 'Delivery' : !best && !here ? 'Delivery (share your location to price it)' : !best && !quote ? 'Delivery: pricing…' : best ? best[2] : 'No delivery to you: pick up'}</span>
          <b>{best ? (fee ? ksh(fee) : 'Free') : '–'}</b>
        </div>
        <div className="mk-basket-total"><span>Total</span><b>{ksh(subtotal + fee)}</b></div>
        <button type="button" className="os-btn os-btn-brand os-btn-lg os-block" disabled={!units} onClick={checkout}>{units ? `Checkout · ${ksh(subtotal + fee)}` : 'Add items to your cart'}</button>
        {units > 0 && best?.[0] === 'rider' && <small className="os-muted"><span className="mk-trusted inline">✔ Trusted &amp; trained</span> The delivery fee is for your distance. One of our riders near the shop brings it once it’s packed.</small>}
        {units > 0 && ways.length > 1 && <small className="os-muted">Cheapest delivery shown; you can choose another at checkout.</small>}
      </div>
    </div>
  );
}
