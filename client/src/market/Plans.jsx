import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import { AdImage } from './ListingCard';
import { Sheet, useHideFabs, usePoll } from './Trust';
import './market.css';

const STATUS = {
  pending_deposit: ['⏳', 'Waiting for deposit'],
  active: ['🟢', 'Paying'],
  completed: ['🎉', 'Fully paid'],
  cancelled: ['✖️', 'Cancelled'],
  defaulted: ['⚠️', 'Closed (not paid in time)'],
};

// ---------------------------------------------------------------- start a plan (from the ad page)
export function PolePoleSheet({ listing, price, offerId, onClose }) {
  const { customer } = useShop();
  const navigate = useNavigate();
  const data = useCategories();
  const lw = listing.layaway;
  const [method, setMethod] = useState(listing.delivery?.available ? 'delivery' : 'pickup');
  const fee = method === 'delivery' ? listing.delivery?.fee || 0 : 0;
  const total = price + fee;
  const minDeposit = Math.ceil((total * lw.minDepositPercent) / 100);
  const [deposit, setDeposit] = useState(minDeposit);
  const [weeks, setWeeks] = useState(Math.min(4, lw.maxWeeks));
  const [county, setCounty] = useState(customer?.county || '');
  const [address, setAddress] = useState(customer?.address || '');
  const [phone, setPhone] = useState(prettyPhone(customer?.phone || ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDeposit((previousDeposit) => Math.max(previousDeposit, minDeposit)), [minDeposit]);
  if (!customer) return <Navigate to={`/login?next=${encodeURIComponent(`/market/item/${listing.slug}`)}`} replace />;
  const weekly = Math.ceil((total - deposit) / weeks);

  const start = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.post('/plans', { listingId: listing._id, deposit, weeks, offerId, phone, delivery: { method, county, address } });
      toast(response.data.message, { icon: '📲' });
      navigate(`/plans/${response.data.plan._id}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Lipa Pole Pole: pay bit by bit" onClose={onClose}>
      <form className="mk-sheet-body" onSubmit={start}>
        <p className="os-muted">Pay a deposit today and the item is <b>reserved for you</b>. Pay the rest with M-Pesa over {lw.maxWeeks > 1 ? `up to ${lw.maxWeeks} weeks` : 'a week'}, any amount, any time. It’s delivered when fully paid.</p>
        <div className="mk-choice mk-choice-sm">
          {listing.delivery?.available && <label className={method === 'delivery' ? 'on' : ''}><input type="radio" checked={method === 'delivery'} onChange={() => setMethod('delivery')} /><span><b>🚚 Delivery</b><small>{fee ? priceText(fee) : 'Free'}</small></span></label>}
          {listing.delivery?.pickup !== false && <label className={method === 'pickup' ? 'on' : ''}><input type="radio" checked={method === 'pickup'} onChange={() => setMethod('pickup')} /><span><b>📍 Pick up</b><small>Free</small></span></label>}
        </div>
        {method === 'delivery' && (
          <div className="mk-form-grid mk-mt">
            <label className="os-field"><span>County</span>
              <select value={county} onChange={(event) => setCounty(event.target.value)} required><option value="">Choose…</option>{data?.counties.map((value) => <option key={value}>{value}</option>)}</select>
            </label>
            <label className="os-field"><span>Delivery address</span><input value={address} onChange={(event) => setAddress(event.target.value)} required minLength={5} placeholder="Estate, street, house" /></label>
          </div>
        )}
        <label className="os-field mk-mt">
          <span>Deposit today: {priceText(deposit)} <em>(min {lw.minDepositPercent}% = {priceText(minDeposit)})</em></span>
          <input type="range" min={minDeposit} max={Math.max(minDeposit, total - 100)} step={50} value={deposit} onChange={(event) => setDeposit(Number(event.target.value))} />
        </label>
        <div className="mk-chips">
          {Array.from({ length: lw.maxWeeks }, (_, index) => index + 1).map((item) => <button type="button" key={item} className={weeks === item ? 'on' : ''} onClick={() => setWeeks(item)}>{item} week{item > 1 ? 's' : ''}</button>)}
        </div>
        <div className="mk-pp-summary">
          <div><small>Total</small><b>{priceText(total)}</b></div>
          <div><small>Today</small><b>{priceText(deposit)}</b></div>
          <div><small>Then about</small><b>{priceText(weekly)}/week</b></div>
        </div>
        <label className="os-field mk-mt"><span>M-Pesa number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" required placeholder="07XX XXX XXX" /></label>
        <button className="os-btn os-btn-brand os-btn-lg os-block mk-mt" disabled={busy}>{busy ? 'Sending…' : `Pay deposit ${priceText(deposit)} with M-Pesa`}</button>
        <p className="mk-hint mk-center">Changed your mind? Cancel any time before it’s fully paid and your money is refunded.</p>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- list (My orders → Lipa Pole Pole)
export function PlanRows({ plans, seller }) {
  if (!plans?.length) return null;
  return (
    <div className="mk-order-list">
      {plans.map((plan) => (
        <Link key={plan._id} to={`/plans/${plan._id}`} className="mk-order-row">
          <span className="mk-order-img"><AdImage ad={plan} /></span>
          <span className="mk-order-info">
            <b>{plan.title}</b>
            <small>{plan.planNo} · {seller ? `buyer ${plan.buyer.name}` : `from ${plan.seller.name}`}</small>
            <span className="mk-progress" aria-label={`${plan.progress}% paid`}><i style={{ width: `${plan.progress}%` }} /></span>
            <small>{priceText(plan.paid)} of {priceText(plan.total)} paid</small>
          </span>
          <span className="mk-order-side"><span className="mk-pill">{STATUS[plan.status][0]} {STATUS[plan.status][1]}</span></span>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- one plan
export function PlanPage() {
  const { id } = useParams();
  const { customer, ready } = useShop();
  const [listing, setListing] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  useSeo({ title: listing ? `Lipa Pole Pole ${listing.planNo}` : 'Lipa Pole Pole', noindex: true });
  useHideFabs();
  const load = () => api.get(`/plans/${id}`).then((response) => setListing(response.data)).catch((error) => toast.error(errMsg(error)));
  useEffect(() => {
    if (customer) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, customer]);
  usePoll(`/plans/${id}`, !!listing?.paying, (ad) => {
    const was = listing?.paid;
    setListing(ad);
    if (ad.paid > (was || 0)) toast.success('Payment received. Asante!');
    return !ad.paying;
  });
  useEffect(() => {
    if (listing && !amount) setAmount(String(listing.nextAmount || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.nextAmount]);

  if (ready && !customer) return <Navigate to={`/login?next=${encodeURIComponent(`/plans/${id}`)}`} replace />;
  if (!listing) return <div className="mk mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div>;
  const buyer = listing.role === 'buyer';
  const payNow = async () => {
    setBusy(true);
    try {
      const response = await api.post(`/plans/${listing._id}/pay`, { amount: Number(amount) });
      setListing(response.data.plan);
      toast(response.data.message, { icon: '📲' });
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!window.confirm('Cancel this Lipa Pole Pole plan? The item is released and the money you paid is refunded.')) return;
    try {
      setListing((await api.post(`/plans/${listing._id}/cancel`)).data);
      toast.success('Plan cancelled. Your refund is on its way.');
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const due = listing.dueBy && new Date(listing.dueBy);

  return (
    <div className="mk"><div className="mk-wrap mk-narrow mk-order">
        <Link to={buyer ? '/orders' : '/sales'} className="mk-back">← {buyer ? 'My orders' : 'Orders to fulfil'}</Link>
        <div className="mk-order-head">
          <div>
            <h1>Lipa Pole Pole</h1>
            <p className="os-muted">{listing.planNo} · {buyer ? `Seller: ${listing.seller.name}` : `Buyer: ${listing.buyer.name}`}</p>
          </div>
          <span className="mk-pill">{STATUS[listing.status][0]} {STATUS[listing.status][1]}</span>
        </div>

        <Link to={`/market/item/${listing.slug}`} className="mk-box mk-pp-item">
          <span className="mk-order-img"><AdImage ad={listing} /></span>
          <span><b>{listing.title}</b><small>{priceText(listing.price)}{listing.deliveryFee ? ` + delivery ${priceText(listing.deliveryFee)}` : ''}</small></span>
        </Link>

        <section className="mk-box mk-pp-progress">
          <div className="mk-pp-nums"><b>{priceText(listing.paid)}</b><span>of {priceText(listing.total)} paid</span></div>
          <span className="mk-progress big"><i style={{ width: `${listing.progress}%` }} /></span>
          <div className="mk-pp-nums"><span>{listing.progress}%</span><span>{listing.remaining > 0 ? `${priceText(listing.remaining)} to go` : 'Fully paid 🎉'}</span></div>
          {listing.status === 'active' && due && <p className="mk-hint">Item reserved for you. Finish paying by <b>{due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b> (about {priceText(listing.weekly)} a week).</p>}
          {listing.status === 'pending_deposit' && <p className="mk-hint">Pay the deposit of {priceText(listing.deposit)} to reserve the item. Unpaid requests expire after 30 minutes.</p>}
          {listing.status === 'completed' && listing.order && <p className="mk-hint">The seller is now preparing it. <Link to={`/${buyer ? 'orders' : 'sales'}/${listing.order}`}>Track the order →</Link></p>}
          {['cancelled', 'defaulted'].includes(listing.status) && <p className="mk-hint">{listing.cancelReason}. {listing.refundStatus === 'due' ? `Refund of ${priceText(listing.refundDue)} on its way.` : listing.refundStatus === 'refunded' ? `${priceText(listing.refundDue)} refunded.` : ''}</p>}
        </section>

        {buyer && ['pending_deposit', 'active'].includes(listing.status) && (
          <section className="mk-box mk-actions">
            {listing.paying ? (
              <div className="mk-pay-spinner"><span className="page-spinner" /> Check your phone and enter your M-Pesa PIN…</div>
            ) : (
              <>
                <b>{listing.status === 'pending_deposit' ? `Pay the deposit: ${priceText(listing.deposit)}` : 'Pay now: any amount from KSh 100'}</b>
                {listing.status === 'active' && (
                  <div className="mk-chips">
                    {[...new Set([Math.min(listing.weekly, listing.remaining), Math.min(Math.round(listing.remaining / 2), listing.remaining), listing.remaining])].filter((item) => item >= 100 || item === listing.remaining).map((item) => (
                      <button type="button" key={item} className={Number(amount) === item ? 'on' : ''} onClick={() => setAmount(String(item))}>{item === listing.remaining ? `All ${priceText(item)}` : priceText(item)}</button>
                    ))}
                  </div>
                )}
                {listing.status === 'active' && <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} aria-label="Amount to pay" />}
                <button className="os-btn os-btn-brand os-btn-lg" disabled={busy} onClick={payNow}>{busy ? 'Sending…' : `Pay ${priceText(listing.status === 'pending_deposit' ? listing.deposit : Number(amount) || 0)} with M-Pesa`}</button>
              </>
            )}
          </section>
        )}

        <section className="mk-box">
          <h2>Payments</h2>
          {!listing.payments.length && <p className="os-muted">No payments yet.</p>}
          <ul className="mk-pay-list">
            {listing.payments.slice().reverse().map((item) => (
              <li key={item._id} className={item.status}>
                <span>{new Date(item.paidAt || item.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                <b>{priceText(item.amount)}</b>
                <small>{item.status === 'paid' ? `✓ ${item.receipt || 'paid'}` : item.status === 'pending' ? '⏳ waiting' : `✕ ${item.failReason || 'not paid'}`}</small>
              </li>
            ))}
          </ul>
        </section>
        {buyer && ['pending_deposit', 'active'].includes(listing.status) && <button className="os-linkbtn mk-report" onClick={cancel}>Cancel this plan</button>}
      </div></div>
  );
}
