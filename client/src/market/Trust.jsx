import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';

// Pages with a pay button near the bottom: hide the floating help buttons so they don't cover it
export function useHideFabs() {
  useEffect(() => {
    document.body.classList.add('mk-hide-fabs');
    return () => document.body.classList.remove('mk-hide-fabs');
  }, []);
}

// ---------------------------------------------------------------- small badges
export function Stars({ value = 0, size = 15, label = true, count }) {
  const full = Math.round(value * 2) / 2;
  return (
    <span className="mk-stars" style={{ fontSize: size }} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((item) => (
        <i key={item} className={full >= item ? 'on' : full >= item - 0.5 ? 'half' : ''}>★</i>
      ))}
      {label && <b>{value ? value.toFixed(1) : 'New'}</b>}
      {count !== undefined && <small>({count})</small>}
    </span>
  );
}

// tap-to-rate stars (1 to 5)
const STAR_WORDS = ['', 'Poor', 'Not great', 'OK', 'Good', 'Excellent!'];
export function StarPick({ value, onChange, label = 'Rating', small }) {
  return (
    <div className={`mk-star-pick ${small ? 'sm' : ''}`} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((item) => (
        <button type="button" key={item} role="radio" aria-checked={value === item} className={value >= item ? 'on' : ''} onClick={() => onChange(item)} aria-label={`${label}: ${item} star${item > 1 ? 's' : ''}`}>★</button>
      ))}
      {!small && <small>{STAR_WORDS[value]}</small>}
    </div>
  );
}

// the seller's service, star by star
export const SERVICE = [['described', 'Item as described'], ['communication', 'Communication'], ['delivery', 'Delivery / handover']];
export function ServiceScores({ service }) {
  const rows = SERVICE.filter(([key]) => service?.[key]);
  if (!rows.length) return null;
  return (
    <ul className="mk-service-scores" aria-label="Service ratings">
      {rows.map(([key, text]) => <li key={key}><span>{text}</span><Stars value={service[key].avg} size={14} /></li>)}
    </ul>
  );
}

export const Verified = ({ small }) => (
  <span className={`mk-verified ${small ? 'sm' : ''}`} title="Verified seller: our team checked who they are">✔{small ? '' : ' Verified'}</span>
);

export const LipaSalama = ({ compact }) => (
  <span className={`mk-salama ${compact ? 'compact' : ''}`} title={`Pay with M-Pesa through ${STORE_INFO.name}: the seller is paid only after you receive the item`}>
    🛡️ Lipa Salama{compact ? '' : <small> · safe mobile payment guaranteed</small>}
  </span>
);

const responseText = (match) => (match == null ? null : match < 60 ? 'within an hour' : match < 24 * 60 ? `within ${Math.round(match / 60)} hours` : 'within a few days');

// Seller trust numbers (ad page, seller page)
export function SellerStats({ s: seller }) {
  if (!seller) return null;
  return (
    <ul className="mk-seller-stats">
      <li><Stars value={seller.rating?.avg || 0} count={seller.rating?.count || 0} /></li>
      <li>✅ {seller.completedSales || 0} sale{seller.completedSales === 1 ? '' : 's'} completed</li>
      {seller.responseRate != null && <li>💬 Replies to {seller.responseRate}% of chats{seller.responseMinutes != null ? `, usually ${responseText(seller.responseMinutes)}` : ''}</li>}
      <li>📅 On <SiteName /> since {new Date(seller.memberSince).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</li>
    </ul>
  );
}

// ---------------------------------------------------------------- dialog shell
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const key = (error) => error.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="mk-sheet-wrap" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="mk-sheet" role="dialog" aria-label={title}>
        <div className="mk-sheet-head"><h3>{title}</h3><button className="os-icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- make an offer
export function OfferSheet({ listing, onClose }) {
  const navigate = useNavigate();
  const [amount, setAmount] = useState(String(Math.round((listing.price * 0.9) / 100) * 100));
  const [busy, setBusy] = useState(false);
  const pct = (value) => Math.round((listing.price * (100 - value)) / 100 / 100) * 100;
  const number = Number(String(amount).replace(/\D/g, ''));
  const low = number && number < listing.price * 0.3;
  const send = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.post('/market/offers', { listingId: listing._id, amount: number });
      toast.success('Offer sent! The seller will reply in the chat.');
      navigate(`/market/messages/${response.data.conversationId}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Make an offer" onClose={onClose}>
      <form onSubmit={send} className="mk-sheet-body">
        <p className="os-muted">Asking price <b>{priceText(listing.price)}</b>. Offer what you think is fair; the seller can accept, counter or decline.</p>
        <div className="mk-chips">
          {[5, 10, 15, 20].map((item) => <button type="button" key={item} className={number === pct(item) ? 'on' : ''} onClick={() => setAmount(String(pct(item)))}>−{item}% · {priceText(pct(item))}</button>)}
        </div>
        <label className="os-field">
          <span>Your offer (KSh)</span>
          <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))} required autoFocus />
          {low && <small className="mk-err-text">Too low: offers must be at least {priceText(Math.ceil(listing.price * 0.3))}</small>}
        </label>
        <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy || !number || low || number >= listing.price}>{busy ? 'Sending…' : `Send offer of ${priceText(number)}`}</button>
        <p className="mk-hint mk-center">{listing.buyNow ? 'If the seller agrees, you can buy at this price for 48 hours.' : 'If the seller agrees, arrange where to meet in the chat.'}</p>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- seller: set the price agreed with this buyer
export function AgreeSheet({ conversationId, listing, onClose }) {
  const [amount, setAmount] = useState(listing.price > 0 ? String(listing.price) : '');
  const [qty, setQty] = useState('1');
  const [pickup, setPickup] = useState(true);
  const [deliver, setDeliver] = useState(!!listing.delivery?.available && listing.delivery?.fee > 0);
  const [fee, setFee] = useState(String(listing.delivery?.fee || ''));
  const [busy, setBusy] = useState(false);
  const sum = Number(amount || 0);
  const figure = Math.max(1, Number(qty || 1));
  const tooHigh = listing.price > 0 && sum > listing.price;
  const send = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/market/offers/agree', { conversationId, amount: sum, qty: figure, ...(listing.buyNow ? {} : { delivery: { pickup, available: deliver, fee: Number(fee || 0) } }) });
      toast.success('Done! The buyer can now add it to their cart at this price.');
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="🤝 Agree a price" onClose={onClose}>
      <form onSubmit={send} className="mk-sheet-body">
        <p className="os-muted">Agreed on a price in the chat or on the phone? Set it here. The buyer gets an <b>Add to cart</b> button at this price, valid for 48 hours, and pays through <SiteName /> (safe mobile payment guaranteed, or cash on delivery).</p>
        <div className="mk-form-grid">
          <label className="os-field">
            <span>Agreed price per item (KSh)</span>
            <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} required autoFocus />
            {tooHigh && <small className="mk-err-text">Can’t be more than your ad’s price ({priceText(listing.price)})</small>}
          </label>
          <label className="os-field">
            <span>How many</span>
            <input inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value.replace(/\D/g, ''))} required />
            {listing.buyNow && <small className="os-muted">{listing.stock} in stock</small>}
          </label>
        </div>
        {!listing.buyNow && (
          <fieldset className="mk-agree-how">
            <legend>How will they get it?</legend>
            <label className="mk-check"><input type="checkbox" checked={pickup} onChange={(event) => setPickup(event.target.checked)} /> They pick it up from me</label>
            <label className="mk-check"><input type="checkbox" checked={deliver} onChange={(event) => setDeliver(event.target.checked)} /> I deliver it</label>
            {deliver && <label className="os-field"><span>Delivery fee (KSh, 0 = free)</span><input inputMode="numeric" value={fee} onChange={(event) => setFee(event.target.value.replace(/\D/g, ''))} placeholder="0" /></label>}
          </fieldset>
        )}
        <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy || !sum || tooHigh || (!listing.buyNow && !pickup && !deliver)}>{busy ? 'Sending…' : `Send agreed price: ${priceText(sum * figure)}${figure > 1 ? ` for ${figure}` : ''}`}</button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- book a site visit
export function VisitSheet({ listing, onClose }) {
  const navigate = useNavigate();
  const tomorrow = new Date(Date.now() + 86400000);
  const [day, setDay] = useState(tomorrow.toLocaleDateString('en-CA'));
  const [time, setTime] = useState('10:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const at = new Date(`${day}T${time}:00`);
      const response = await api.post('/market/visits', { listingId: listing._id, at: at.toISOString(), note });
      toast.success('Visit request sent to the seller');
      navigate(`/market/messages/${response.data.conversation._id}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={listing.category === 'land-property' ? 'Book a site visit' : 'Book a viewing'} onClose={onClose}>
      <form onSubmit={send} className="mk-sheet-body">
        <p className="os-muted">Pick a day and time to {listing.category === 'land-property' ? 'see the property' : 'see the item'}. The seller confirms in the chat.</p>
        <div className="mk-form-grid">
          <label className="os-field"><span>Day</span><input type="date" value={day} min={new Date().toLocaleDateString('en-CA')} onChange={(event) => setDay(event.target.value)} required /></label>
          <label className="os-field"><span>Time</span><input type="time" value={time} min="07:00" max="18:00" onChange={(event) => setTime(event.target.value)} required /></label>
        </div>
        <label className="os-field mk-mt"><span>Note <em>(optional)</em></span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="e.g. I’ll come with my surveyor / mechanic" /></label>
        <button className="os-btn os-btn-brand os-btn-lg os-block mk-mt" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
        <p className="mk-hint mk-center">{listing.category === 'land-property' ? 'Tip: do an official land search before paying anything.' : 'Tip: bring a mechanic and check the logbook on NTSA.'}</p>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- M-Pesa wait helper (polls until paid / failed)
export function usePoll(url, active, onDone) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active || !url) return undefined;
    const started = Date.now();
    ref.current = setInterval(async () => {
      try {
        const response = await api.get(url);
        if (onDone(response.data) || Date.now() - started > 3 * 60000) clearInterval(ref.current);
      } catch {
        /* keep trying */
      }
    }, 3000);
    return () => clearInterval(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, active]);
}

// ---------------------------------------------------------------- boost an ad
// ad: the ad to boost (single-ad plans). Sellers in one of our markets boost their whole business instead (KSh 200 / month).
export function BoostSheet({ ad, onClose, onDone }) {
  const { customer, setCustomer } = useShop();
  const trader = !!customer?.shopLocation?.market;
  const [allPlans, setPlans] = useState([]);
  const plans = allPlans.filter((item) => (trader ? item.kind === 'business' : item.kind !== 'business'));
  const [plan, setPlan] = useState(trader ? 'business' : 'twoweeks');
  const [phone, setPhone] = useState(prettyPhone(customer?.phone || ''));
  const [boost, setBoost] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/market/boosts/plans').then((response) => setPlans(response.data)).catch(() => {});
  }, []);
  usePoll(boost ? `/market/boosts/${boost._id}` : null, boost?.status === 'pending', (other) => {
    setBoost(other);
    if (other.status === 'paid') {
      toast.success(other.kind === 'business' ? 'Your business is boosted ⭐' : 'Your ad is now Featured 🔥');
      if (other.kind === 'business') setCustomer?.((previous) => (previous ? { ...previous, businessBoostUntil: other.endsAt } : previous));
      onDone?.();
    }
    return other.status !== 'pending';
  });
  const start = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.post('/market/boosts', { plan, phone, ...(trader ? {} : { listingId: ad?._id }) });
      setBoost(response.data.boost);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={trader ? '⭐ Boost my business' : '🔥 Boost your ad'} onClose={onClose}>
      <div className="mk-sheet-body">
        {!boost ? (
          <form onSubmit={start}>
            {trader ? (
              <div className="mk-boost-business">
                <p>You sell in <b>{customer.shopLocation.market.name}</b>. Reach many more buyers: for <b>{priceText(200)} a month</b>,</p>
                <ul>
                  <li>🔥 <b>all your ads</b> show first in search and on the home page, including new ads you post this month;</li>
                  <li>⭐ <b>your business</b> shows first on {customer.shopLocation.market.name}’s page and in “sellers near me”, with a “Featured business” badge.</li>
                </ul>
                {customer.businessBoostUntil && <p className="mk-hint">Boosted until {new Date(customer.businessBoostUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. Paying again adds a month.</p>}
              </div>
            ) : (
              <p className="os-muted">Featured ads show <b>first in search</b> and on the home page, with a 🔥 badge. Boosting again adds days.</p>
            )}
            <div className="mk-boost-plans">
              {plans.map((currentPlan) => (
                <label key={currentPlan.key} className={plan === currentPlan.key ? 'on' : ''}>
                  <input type="radio" name="plan" checked={plan === currentPlan.key} onChange={() => setPlan(currentPlan.key)} />
                  <b>{currentPlan.label}</b>
                  <span>{priceText(currentPlan.amount)}</span>
                  <small>{currentPlan.note}</small>
                </label>
              ))}
            </div>
            <label className="os-field mk-mt"><span>M-Pesa number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" required placeholder="07XX XXX XXX" /></label>
            <button className="os-btn os-btn-brand os-btn-lg os-block mk-mt" disabled={busy}>{busy ? 'Sending…' : `Pay ${priceText(plans.find((currentPlan) => currentPlan.key === plan)?.amount || 0)} with M-Pesa`}</button>
          </form>
        ) : boost.status === 'pending' ? (
          <div className="mk-center">
            <div className="mk-pay-icon">📲</div>
            <h3>Check your phone</h3>
            <p>Enter your M-Pesa PIN to pay {priceText(boost.amount)}.</p>
            <div className="mk-pay-spinner"><span className="page-spinner" /> Waiting for M-Pesa…</div>
          </div>
        ) : boost.status === 'paid' ? (
          <div className="mk-center">
            <div className="mk-pay-icon">🔥</div>
            <h3>{boost.kind === 'business' ? 'Your business is boosted!' : 'Your ad is Featured!'}</h3>
            <p>Until {new Date(boost.endsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}. M-Pesa ref {boost.receipt}.</p>
            <button className="os-btn os-btn-brand" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div className="mk-center">
            <div className="mk-pay-icon">⚠️</div>
            <h3>Payment not completed</h3>
            <p>{boost.failReason}</p>
            <button className="os-btn os-btn-brand" onClick={() => setBoost(null)}>Try again</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- fair price guide (vehicles)
export function PriceGuide({ listing, attrs, compact }) {
  const value = attrs || listing?.attrs || {};
  const cat = listing?.category;
  const sub = listing?.sub;
  const [group, setGroup] = useState(null);
  useEffect(() => {
    if (cat !== 'vehicles' || !value.make || !value.model) return setGroup(null);
    api.get('/market/price-guide', { params: { category: cat, sub, make: value.make, model: value.model, year: value.year || undefined } }).then((response) => setGroup(response.data)).catch(() => setGroup(null));
  }, [cat, sub, value.make, value.model, value.year]);
  if (!group) return null;
  const price = listing?.price;
  const where = price > 0 ? (price < group.low ? 'below' : price > group.high ? 'above' : 'within') : null;
  return (
    <div className={`mk-guide ${compact ? 'compact' : ''}`}>
      <b>📊 Price guide: {group.make} {group.model}{group.years ? ` (${group.years})` : ''}</b>
      <div className="mk-guide-bar">
        <span>{priceText(group.low)}</span>
        <i />
        <span>{priceText(group.high)}</span>
      </div>
      <small>Typical asking price on <SiteName />, from {group.count} similar ads (median {priceText(group.median)}).{where && !compact ? ` This ad is ${where} the usual range.` : ''}</small>
    </div>
  );
}
