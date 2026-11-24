import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, timeAgo, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { ORDER_STATUS, prettyPhone, statusLabel } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';
import { AdImage } from './ListingCard';
import { openSupportChat } from '../shop/SupportChat';
import { PlanRows } from './Plans';
import { AgreementRows } from './Agreement';
import { SERVICE, ServiceScores, StarPick, Stars } from './Trust';
import { RateRider, RiderLive, Transit } from './Deliveries';
import { RideContact } from '../shop/Calls';
import SellerTrends from './SellerTrends';
import { saveReceipt } from './receipt';
import Swipeable from '../shop/Swipeable';

// Rate the seller (buyer, after delivery). Reviews can only come from delivered orders, so they can't be faked.
function ReviewBox({ orderId, sellerName }) {
  const [review, setReview] = useState(undefined);
  const [rating, setRating] = useState(0);
  const [aspects, setAspects] = useState({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/orders/${orderId}/review`).then((response) => setReview(response.data)).catch(() => setReview(null));
  }, [orderId]);
  if (review === undefined) return null;
  if (review) {
    return (
      <div className="mk-box mk-review-done">
        <b>Your review of {sellerName}</b> <Stars value={review.rating} label={false} />
        <ServiceScores service={Object.fromEntries(Object.entries(review.aspects || {}).filter(([, value]) => value).map(([key, value]) => [key, { avg: value }]))} />
        {review.comment && <p>{review.comment}</p>}
        {review.reply && <p className="mk-review-reply"><b>Seller’s reply:</b> {review.reply}</p>}
      </div>
    );
  }
  const send = async (event) => {
    event.preventDefault();
    if (!rating) return toast.error('Tap the stars to rate the seller');
    setBusy(true);
    try {
      setReview((await api.post(`/orders/${orderId}/review`, { rating, comment, aspects })).data);
      toast.success('Thanks for your review! It helps other buyers.');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-box mk-actions mk-review-form" onSubmit={send}>
      <b>How was your experience with {sellerName}?</b>
      <StarPick value={rating} onChange={setRating} label="Overall" />
      {rating > 0 && (
        <div className="mk-aspect-pick">
          <small className="os-muted">Rate their service (optional, shown on their page):</small>
          {SERVICE.map(([key, text]) => (
            <div key={key}><span>{text}</span><StarPick small value={aspects[key] || 0} onChange={(value) => setAspects({ ...aspects, [key]: value })} label={text} /></div>
          ))}
        </div>
      )}
      <textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} placeholder="Was the item as described? Was delivery on time? (optional)" />
      <div className="os-row"><button className="os-btn os-btn-brand" disabled={busy}>{busy ? 'Sending…' : 'Post review'}</button></div>
    </form>
  );
}
import './market.css';
import { DeliveryParts } from './Relations';

const when = (date) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function StatusPill({ o: order }) {
  const orderStatus = ORDER_STATUS[order.status] || {};
  return <span className={`mk-pill ${orderStatus.tone || ''}`}>{orderStatus.icon} {order.status === 'shipped' && order.delivery?.method === 'pickup' ? 'Ready for pickup' : orderStatus.short}</span>;
}

function payText(order) {
  if (order.payment.method === 'cod') return order.payment.status === 'paid' ? 'Paid on delivery' : 'Pay on delivery';
  if (order.payment.direct) {
    // paid straight to the seller (a checkout with several sellers)
    if (order.payment.status === 'paid') return `Paid to the seller with M-Pesa${order.payment.receipt ? ` (${order.payment.receipt})` : ''}`;
    if (order.payment.mismatch) return 'M-Pesa codes don’t match';
    if (order.payment.claimed) return order.payment.claimCode ? `M-Pesa ${order.payment.claimCode}: matching codes` : 'Buyer paid: enter your M-Pesa code';
    if (order.payment.status === 'paid' && order.status === 'awaiting_payment') return 'Seller paid: waiting for the verification fee';
    if (order.payment.status === 'refund_due') return 'Refund due from the seller';
  }
  return { paid: `Paid with M-Pesa${order.payment.receipt ? ` (${order.payment.receipt})` : ''}`, pending: 'M-Pesa payment pending', failed: 'M-Pesa payment failed', refund_due: 'Refund on its way', refunded: 'Refunded' }[order.payment.status] || 'M-Pesa';
}

const FINISHED = ['delivered', 'cancelled'];

// take a finished order off my list, with a moment to undo it
function hideOrder(order, onChange) {
  onChange(order._id, true);
  api.post(`/orders/${order._id}/hide`, { hidden: true }).catch((error) => { onChange(order._id, false); toast.error(errMsg(error)); });
  toast((shown) => (
    <span className="mk-undo-toast">
      Order {order.orderNo} removed
      <button type="button" onClick={() => {
        toast.dismiss(shown.id);
        onChange(order._id, false);
        api.post(`/orders/${order._id}/hide`, { hidden: false }).catch((error) => { onChange(order._id, true); toast.error(errMsg(error)); });
      }}>Undo</button>
    </span>
  ), { icon: '🗑️', duration: 5000 });
}

// finished orders (delivered / cancelled) can be swiped away or closed with ✕
function OrderRow({ o: order, to, onHide }) {
  const row = <OrderLink o={order} to={to} />;
  if (!onHide || !FINISHED.includes(order.status)) return row;
  return <Swipeable className="mk-order-swipe" label={`Remove order ${order.orderNo} from the list`} onDismiss={() => hideOrder(order, onHide)}>{row}</Swipeable>;
}

function OrderLink({ o: order, to }) {
  return (
    <Link to={to} className="mk-order-row">
      <span className="mk-order-img"><AdImage ad={{ ...order.items[0], image: order.items[0]?.image }} /></span>
      <span className="mk-order-info">
        <b>{order.items[0]?.title}{order.items.length > 1 ? ` + ${order.items.length - 1} more` : ''}</b>
        <small>{order.orderNo} · {order.role === 'seller' ? `to ${order.buyer.name}` : `from ${order.seller.name}`} · {timeAgo(order.createdAt)}</small>
        <small>{order.delivery.method === 'pickup' ? '📍 Pickup' : order.delivery.method === 'verified' ? '🛡️ Safe deal · verified, then our rider' : order.delivery.method === 'courier' ? `🚌 Courier${order.rider?.courier?.name ? ` · ${order.rider.courier.name}` : ''}` : order.delivery.method === 'rider' ? `🏍️ Rider · ${order.delivery.km} km` : order.delivery.method === 'walk' ? `🚶 Walking delivery · ${order.delivery.km} km` : `🚚 ${order.delivery.county}`} · {payText(order)}{order.payment.ref ? ` · ${order.payment.ref}` : ''}</small>
      </span>
      <span className="mk-order-side">
        <b>{priceText(order.total)}</b>
        <StatusPill o={order} />
        {order.status !== 'awaiting_payment' && (
          <span
            role="button"
            tabIndex={0}
            className="mk-receipt-link"
            title="Download the receipt (PDF)"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); saveReceipt(api, `/orders/${order._id}/receipt.pdf`, order.orderNo); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); saveReceipt(api, `/orders/${order._id}/receipt.pdf`, order.orderNo); } }}
          >🧾 Receipt</span>
        )}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- my orders (buyer)
export function MyOrders() {
  const { customer, ready, orders, refreshOrders } = useShop();
  const [params] = useSearchParams();
  const [loaded, setLoaded] = useState(false);
  const [plans, setPlans] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [hidden, setHidden] = useState(() => new Set()); // removed from the list just now
  const onHide = (orderId, hide) => setHidden((previous) => { const next = new Set(previous); if (hide) next.add(orderId); else next.delete(orderId); return next; });
  useSeo({ title: 'My orders', noindex: true });
  useEffect(() => {
    if (customer) refreshOrders().finally(() => setLoaded(true));
    if (customer) api.get('/plans/mine').then((response) => setPlans(response.data)).catch(() => {});
    if (customer) api.get('/agreements/mine').then((response) => setAgreements(response.data)).catch(() => {});
  }, [customer, refreshOrders]);
  if (ready && !customer) return <Navigate to="/login?next=%2Forders" replace />;
  const shown = orders.filter((order) => !hidden.has(order._id) && (order.status !== 'awaiting_payment' || Date.now() - new Date(order.createdAt) < 30 * 60000));

  return (
    <div className="mk"><div className="mk-wrap mk-narrow">
        <div className="mk-section-head"><h1>My orders</h1><Link to="/market/search?buyNow=1" className="mk-more">Shop more →</Link></div>
        {params.get('new') && <div className="mk-success">🎉 Your orders are placed! Each seller will confirm theirs; we’ll keep you posted here and by email.</div>}
        {!loaded && !orders.length && <div className="page-loading"><span className="page-spinner" /></div>}
        {agreements.length > 0 && (
          <section className="mk-mt">
            <h2 className="mk-subhead">📝 Lipa Pole Pole agreements</h2>
            <AgreementRows list={agreements} />
          </section>
        )}
        {plans.length > 0 && (
          <section className="mk-mt">
            <h2 className="mk-subhead">🐢 Lipa Pole Pole</h2>
            <PlanRows plans={plans} />
            <h2 className="mk-subhead mk-mt">Orders</h2>
          </section>
        )}
        {loaded && !shown.length && !plans.length && !agreements.length && (
          <div className="os-empty">
            <div className="os-empty-art">📦</div>
            <h4>No orders yet</h4>
            <p>Items marked “Buy online” can be ordered and delivered to you.</p>
            <Link className="os-btn os-btn-brand" to="/market/search?buyNow=1">Find items to buy online</Link>
          </div>
        )}
        {shown.some((item) => FINISHED.includes(item.status)) && <p className="mk-hint mk-swipe-hint">Swipe a delivered or cancelled order left or right, or tap ✕, to remove it from your list.</p>}
        <div className="mk-order-list">{shown.map((item) => <OrderRow key={item._id} o={item} to={`/orders/${item._id}`} onHide={onHide} />)}</div>
      </div></div>
  );
}

// ---------------------------------------------------------------- orders to fulfil (seller)
const TABS = [['', 'All'], ['payment', '💵 Confirm M-Pesa'], ['placed', 'New'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['plans', '🐢 Pole Pole']];

export function Sales() {
  const { customer, ready, onOrder, refreshCounts } = useShop();
  const [tab, setTab] = useState('');
  const [res, setRes] = useState(null);
  useSeo({ title: 'My sales', noindex: true });
  const [plans, setPlans] = useState([]);
  const [hidden, setHidden] = useState(() => new Set());
  const onHide = (orderId, hide) => setHidden((previous) => { const next = new Set(previous); if (hide) next.add(orderId); else next.delete(orderId); return next; });
  const listed = res?.orders.filter((order) => !hidden.has(order._id)) || [];
  const load = () => {
    if (tab === 'plans') return api.get('/plans/sales').then((response) => setPlans(response.data)).catch((error) => toast.error(errMsg(error)));
    return api.get('/orders/sales', { params: { status: tab || undefined } }).then((response) => setRes(response.data)).catch((error) => toast.error(errMsg(error)));
  };
  useEffect(() => {
    if (customer) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, tab]);
  useEffect(() => onOrder((order) => order.role === 'seller' && load()), [onOrder, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (customer) refreshCounts();
  }, [customer, refreshCounts]);
  if (ready && !customer) return <Navigate to="/login?as=seller&next=%2Fsales" replace />;
  const summary = res?.summary;

  return (
    <div className="mk"><div className="mk-wrap mk-narrow">
        <div className="mk-section-head"><h1>Orders to fulfil</h1><Link to="/market/my" className="mk-more">My ads →</Link></div>
        {summary && (
          <div className="mk-stats">
            <div className={summary.toHandle ? 'hot' : ''}><small>To confirm / ship</small><b>{summary.toHandle}</b></div>
            <div><small>Delivered</small><b>{summary.delivered}</b></div>
            <div><small>Sales (delivered)</small><b>{priceText(summary.revenue)}</b></div>
            <div><small>M-Pesa payout due</small><b>{priceText(summary.payoutDue)}</b><em>Paid out so far {priceText(summary.paidOut)}</em></div>
          </div>
        )}
        <SellerTrends />
        <div className="mk-tabs" role="tablist">
          {TABS.map(([key, value]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{value}</button>)}
        </div>
        {tab === 'plans' && (
          <>
            <p className="mk-hint">Buyers paying for your items bit by bit. The item is reserved while they pay; you get a normal order to ship once it’s fully paid.</p>
            {plans.length ? <PlanRows plans={plans} seller /> : <p className="os-muted">No Lipa Pole Pole plans yet. Turn it on in an ad’s “Sell online” settings.</p>}
          </>
        )}
        {tab !== 'plans' && !res && <div className="page-loading"><span className="page-spinner" /></div>}
        {tab !== 'plans' && res && !listed.length && (
          <div className="os-empty">
            <div className="os-empty-art">🧾</div>
            <h4>{tab ? 'Nothing here' : 'No orders yet'}</h4>
            <p>Tick <b>“Sell online”</b> when you post an ad, and buyers can order and pay straight away. You’ll get an alert for every order.</p>
            <Link className="os-btn os-btn-brand" to="/market/my">Go to my ads</Link>
          </div>
        )}
        {tab !== 'plans' && listed.some((order) => FINISHED.includes(order.status)) && <p className="mk-hint mk-swipe-hint">Swipe a delivered or cancelled order left or right, or tap ✕, to remove it from this list. Your sales totals don’t change.</p>}
        {tab !== 'plans' && <div className="mk-order-list">{listed.map((order) => <OrderRow key={order._id} o={order} to={`/sales/${order._id}`} onHide={onHide} />)}</div>}
        <p className="mk-hint">Cash-on-delivery money goes straight to you. For M-Pesa orders, <SiteName /> pays you after delivery, minus a {STORE_INFO.commissionPercent}% service fee. When a buyer orders from several sellers at once, they pay you directly on your Till, Paybill or Pochi (no fee); connect M-Pesa prompts in <Link to="/account#pay-details">My account</Link> so they pay with one tap.</p>
      </div></div>
  );
}

// ---------------------------------------------------------------- one order (buyer or seller view)
const STEPS = ['placed', 'confirmed', 'shipped', 'delivered'];

export function OrderDetail({ as }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { customer, ready, onOrder, refreshCounts } = useShop();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  useSeo({ title: order ? `Order ${order.orderNo}` : 'Order', noindex: true });

  useEffect(() => {
    if (!customer) return;
    api.get(`/orders/${id}`).then((response) => setOrder(response.data)).catch((innerError) => setError(errMsg(innerError)));
  }, [id, customer]);
  useEffect(() => onOrder((currentOrder) => currentOrder._id === id && setOrder(currentOrder)), [onOrder, id]);

  if (ready && !customer) return <Navigate to={`/login?next=${encodeURIComponent(`/${as === 'seller' ? 'sales' : 'orders'}/${id}`)}`} replace />;
  if (error) return <div className="mk"><div className="mk-wrap mk-narrow"><p className="mk-error">{error}</p><Link to={as === 'seller' ? '/sales' : '/orders'}>← Back</Link></div></div>;
  if (!order) return <div className="mk"><div className="mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div></div>;

  const seller = order.role === 'seller';
  const act = async (status, extra = {}) => {
    setBusy(true);
    try {
      const response = await api.post(`/orders/${order._id}/status`, { status, ...extra });
      setOrder(response.data);
      refreshCounts();
      toast.success({ confirmed: 'Order confirmed. The buyer has been told.', shipped: order.delivery.method === 'pickup' ? 'Buyer told it’s ready for pickup' : 'Marked as shipped. The buyer has been told.', delivered: 'Marked as delivered 🎉', cancelled: 'Order cancelled' }[status]);
      setCancelling(false);
    } catch (innerError) {
      toast.error(errMsg(innerError));
    } finally {
      setBusy(false);
    }
  };
  const stepIndex = STEPS.indexOf(order.status);
  const pickup = order.delivery.method === 'pickup';
  const label = (key) => (key === 'shipped' && pickup ? 'Ready for pickup' : key === 'delivered' && pickup ? 'Collected' : ORDER_STATUS[key].label);
  const at = (key) => order.history?.find((height) => height.status === key)?.at;
  const canCancel = seller ? ['placed', 'confirmed'].includes(order.status) : ['placed', 'awaiting_payment'].includes(order.status) || (order.inspection?.status === 'failed' && order.status === 'confirmed');
  const byRider = ['rider', 'courier', 'verified'].includes(order.delivery.method); // one of our riders / agents handles it
  const safe = order.delivery.method === 'verified' ? order.verification : null; // Safe deal: checked at our partner shop first
  const courier = order.delivery.method === 'courier' ? order.rider?.courier : null; // far away: sent by bus / courier
  const combined = !!order.rider?.combined; // our agent inspects at the shop, then delivers
  const waitInspect = order.inspection && !['passed', 'cancelled'].includes(order.inspection.status) && !(combined && order.inspection.status !== 'failed');
  const cashOnDelivery = order.payment.method === 'mpesa' ? order.payOnDelivery || 0 : 0;
  const callRider = async () => {
    setBusy(true);
    try {
      const response = await api.post(`/orders/${order._id}/call-rider`);
      setOrder(response.data.order);
      const who = order.rider?.combined ? 'agent' : 'rider';
      toast.success(response.data.ridersAlerted ? `${response.data.ridersAlerted} ${who}${response.data.ridersAlerted === 1 ? '' : 's'} near you alerted` : `${who[0].toUpperCase()}${who.slice(1)}s alerted. We’ll tell you when one accepts.`);
    } catch (innerError) {
      toast.error(errMsg(innerError));
    } finally {
      setBusy(false);
    }
  };
  const recheck = async () => {
    setBusy(true);
    try {
      const response = await api.post(`/orders/${order._id}/recheck`);
      setOrder(response.data);
      toast.success('Our agent will check it again');
    } catch (innerError) {
      toast.error(errMsg(innerError));
    } finally {
      setBusy(false);
    }
  };
  const phone = order.buyer.phone;

  return (
    <div className="mk"><div className="mk-wrap mk-narrow mk-order">
        <Link to={seller ? '/sales' : '/orders'} className="mk-back">← {seller ? 'Orders to fulfil' : 'My orders'}</Link>
        {params.get('new') && <div className="mk-success">🎉 Order placed!{order.payment.ref ? <> Payment ID <b className="mk-payref">{order.payment.ref}</b>.</> : ''} {order.payment.method === 'cod' ? (order.sellerPay?.text ? `Pay on delivery: ${order.sellerPay.text}.` : 'Pay when you receive it.') : ''} The seller will confirm it shortly.
          {order.status !== 'awaiting_payment' && <><br /><button type="button" className="os-btn os-btn-brand mk-mt" onClick={() => saveReceipt(api, `/orders/${order._id}/receipt.pdf`, order.orderNo)}>🧾 Save your receipt</button> <small>to check the items when they arrive.</small></>}
        </div>}
        {order.payment.method === 'cod' && !['cancelled', 'delivered'].includes(order.status) && (seller ? !order.sellerPay && <SellerPayPrompt /> : <PayOnDelivery o={order} />)}
        {seller && order.payment.direct && order.payment.channel === 'manual' && ['pending', 'failed'].includes(order.payment.status) && order.status === 'awaiting_payment' && <ConfirmDirectPay o={order} onDone={(next) => { setOrder(next); refreshCounts(); }} />}
        {!seller && order.payment.direct && order.status === 'awaiting_payment' && (
          <div className="mk-box mk-paybox">
            <b>💵 {order.payment.mismatch ? 'Your M-Pesa code doesn’t match the seller’s: check it' : order.payment.claimCode ? `Matching your M-Pesa code ${order.payment.claimCode} with ${order.seller.name}’s` : `Pay ${order.seller.name} ${priceText(order.payment.amount)}`}</b>
            <small>This order is one of several sellers you’re paying directly.</small>
            <Link className="os-btn os-btn-brand" to={`/pay/${order.checkoutId}`}>Open the payment page for all sellers</Link>
          </div>
        )}
        {!seller && cashOnDelivery > 0 && !['cancelled', 'delivered', 'awaiting_payment'].includes(order.status) && (
          <div className="mk-box mk-paybox">
            <b>💵 Pay on delivery: {priceText(cashOnDelivery)} delivery fee</b>
            <small>The items{order.inspection?.fee ? ' and inspection' : ''} are paid. Pay the delivery fee (cash or M-Pesa) to {byRider ? (order.rider?.name || 'our rider') : 'the seller’s delivery person'} when it arrives, not before.</small>
          </div>
        )}
        <div className="mk-order-head">
          <div>
            <h1>Order {order.orderNo}</h1>
            <p className="os-muted">Placed {when(order.createdAt)} · {seller ? `Buyer: ${order.buyer.name}` : `Seller: ${order.seller.name}`}</p>
          </div>
          <StatusPill o={order} />
        </div>
        {order.status !== 'awaiting_payment' && (
          <div className="mk-receipt-bar">
            <button type="button" className="os-btn os-btn-dark" onClick={() => saveReceipt(api, `/orders/${order._id}/receipt.pdf`, order.orderNo)}>🧾 Download receipt (PDF)</button>
            <small className="os-muted">{seller ? 'Items, buyer, delivery address and payment, for your records.' : 'Keep it to check the items when they arrive, and quote the order number if anything goes wrong.'}</small>
          </div>
        )}

        {order.status === 'cancelled' ? (
          <div className="mk-banner hidden">Cancelled{order.cancelledBy ? ` by the ${order.cancelledBy === 'system' ? 'system' : order.cancelledBy}` : ''}{order.cancelReason ? `: ${order.cancelReason}` : ''}. {order.payment.status === 'refund_due' ? 'The M-Pesa payment will be refunded.' : order.payment.status === 'refunded' ? 'The M-Pesa payment was refunded.' : ''}</div>
        ) : order.status === 'awaiting_payment' ? (
          <div className="mk-banner sold">{order.payment.claimed ? (seller ? 'The buyer says they paid you: enter the M-Pesa code you received (up to 48 hours).' : 'Matching your M-Pesa code with the seller’s (the seller has up to 48 hours).') : 'Waiting for M-Pesa payment. Unpaid orders are cancelled after 30 minutes.'}</div>
        ) : (
          <ol className="mk-steps">
            {STEPS.map((step, index) => (
              <li key={step} className={index < stepIndex ? 'done' : index === stepIndex ? 'now' : ''}>
                <span>{index <= stepIndex ? '✓' : index + 1}</span>
                <b>{label(step)}</b>
                {at(step) && <small>{when(at(step))}</small>}
              </li>
            ))}
          </ol>
        )}

        {order.transit && order.status !== 'cancelled' && (
          <section className="mk-box mk-order-transit" aria-label="Where your delivery is">
            <div className="mk-delivery-top"><b>🛵 Where it is: {order.transit.currentLabel}</b>{!seller && <Link to="/deliveries" className="mk-more">All my deliveries →</Link>}</div>
            <Transit transit={order.transit} />
          </section>
        )}
        {safe && order.status !== 'awaiting_payment' && <SafeDeal order={order} seller={seller} />}

        {(order.inspection || order.rider) && order.status !== 'cancelled' && order.status !== 'awaiting_payment' && (
          <div className="mk-field">
            {order.inspection && (
              <div className={`mk-field-row ${order.inspection.status}`}>
                <span className="mk-field-icon">🔍</span>
                <div>
                  <b>{order.inspection.free ? 'Free check by our rider' : 'Inspection'}: {{ waiting: 'starts when the seller confirms', open: order.inspection.free ? 'our rider checks it when collecting' : 'looking for an agent near the shop', assigned: `${order.inspection.agentName || (order.inspection.free ? 'our rider' : 'our agent')} is on the way to check it`, passed: '✅ passed', failed: '❌ failed' }[order.inspection.status] || order.inspection.status}</b>
                  {/* the agent doing it (the one who took the job, else the one linked to the order), with their phone:
                      the buyer and the seller can both call them */}
                  {(() => {
                    const linked = order.inspection.chosenAgent;
                    const took = order.inspection.agentName ? { name: order.inspection.agentName, phone: order.inspection.agentPhone, marketName: linked?.name === order.inspection.agentName ? linked.marketName : '' } : null;
                    const who = took || linked;
                    if (!who?.name || order.inspection.free) return null;
                    return (
                      <small className="mk-insp-agent">
                        🧑‍💼 Inspection agent: <b>{who.name}</b>{who.marketName ? ` · ${who.marketName}` : ''}
                        {who.phone && <> · <a href={`tel:+${who.phone}`}>📞 {prettyPhone(who.phone)}</a> · <a href={`https://wa.me/${who.phone}`} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a></>}
                        {seller && who.phone && <em className="mk-insp-agent-note"> They may call you to find your shop.</em>}
                      </small>
                    );
                  })()}
                  {!seller && !order.inspection.free && ['passed', 'failed'].includes(order.inspection.status) && order.inspection.taskId && (
                    <RateRider taskId={order.inspection.taskId} name={order.inspection.agentName || order.inspection.chosenAgent?.name} rated={order.inspection.rated} what="inspection" who="your agent" />
                  )}
                  {order.inspection.notes && <small>{seller ? 'The buyer asked' : 'You asked'}: {order.inspection.notes}</small>}
                  {order.inspection.result && <small>{order.inspection.free ? 'Rider’s' : 'Agent’s'} report: {order.inspection.result}</small>}
                  {order.inspection.status === 'failed' && !seller && <small>Not what you ordered? You can cancel below for a full refund, or wait for the seller to fix it.</small>}
                  {order.inspection.status === 'failed' && seller && (order.inspection.rechecks || 0) < 1 && <button className="os-btn os-btn-brand" disabled={busy} onClick={recheck}>Fixed it: inspect again</button>}
                </div>
              </div>
            )}
            {order.rider && courier && (
              <div className={`mk-field-row ${order.rider.status}`}>
                <span className="mk-field-icon">🚌</span>
                <div>
                  <b>Courier, {courier.name}: {{ waiting: waitInspect ? 'our agent is called once the inspection passes' : 'the seller calls our agent when it’s packed', open: 'agents near the shop have been alerted', assigned: `${order.rider.name} is going to the shop`, picked_up: `${order.rider.name} is taking it to ${courier.name}`, sent: '✅ sent', done: 'collected ✅', cancelled: 'cancelled' }[order.rider.status] || order.rider.status}</b>
                  {order.rider.name && <span className="mk-trusted">✔ Sent for you by our trained agent, {order.rider.name}</span>}
                  {order.rider.phone && ['assigned', 'picked_up'].includes(order.rider.status) && <RideContact task={seller ? undefined : order.rider.task} name={order.rider.name} phone={order.rider.phone} who="rider" />}
                  {courier.waybill ? (
                    <div className="mk-waybill">
                      <span>Waybill</span><b>{courier.waybill}</b>
                      <button type="button" className="os-linkbtn" onClick={() => navigator.clipboard?.writeText(courier.waybill).then(() => toast.success('Waybill copied'), () => {})}>Copy</button>
                    </div>
                  ) : <small>{seller ? 'The waybill number shows here once our agent sends it.' : 'You’ll get the waybill number here once it’s sent.'}</small>}
                  {courier.office && <small>Sent from {courier.office}{courier.sentAt ? `, ${when(courier.sentAt)}` : ''}</small>}
                  {!seller && <small>📍 Collect it at the {courier.name} office in {order.delivery.county || 'your town'}{courier.eta ? ` (${courier.eta.toLowerCase()})` : ''}. Bring your ID and the waybill number.</small>}
                  <small>Courier fare {priceText(courier.fare)} + our agent {priceText(courier.handling)}, paid</small>
                </div>
              </div>
            )}
            {order.rider && !courier && (
              <div className={`mk-field-row ${order.rider.status}`}>
                <span className="mk-field-icon">🏍️</span>
                <div>
                  <b>{combined && order.rider.courier ? 'Our agent (checks & sends)' : combined ? 'Our rider (checks it, then delivers)' : order.rider.vehicle === 'On foot' ? 'Delivery agent' : 'Rider'}: {{ waiting: safe ? 'called once our partner shop verifies it' : waitInspect ? 'called once the inspection passes' : 'the seller calls one when it’s packed', open: safe ? 'riders near the partner shop have been alerted' : combined && order.rider.courier ? 'agents near the shop have been alerted' : 'riders near the shop have been alerted', assigned: `${order.rider.name} is going to the shop`, picked_up: `${order.rider.name} has your order and is on the way`, delivered: seller ? `${order.rider.name} says it’s delivered; waiting for the buyer to confirm` : `${order.rider.name} says it’s delivered. Got it? Confirm below`, done: 'delivered ✅ (confirmed by both)', cancelled: 'cancelled' }[order.rider.status] || order.rider.status}</b>
                  {order.rider.status === 'open' && order.rider.matching && <small>🔎 {order.rider.matching}</small>}
                  {!order.rider.name && order.rider.booked && <small className="mk-rider-booked">🤝 {seller ? 'The buyer booked' : 'Booked for you:'} <b>{order.rider.booked.name}</b>{order.rider.booked.vehicle ? ` (${order.rider.booked.vehicle})` : ''}. They get the job first {seller ? 'when you call a rider' : 'when the seller has packed it'}; if they can’t, the next nearest rider takes it.</small>}
                  {order.rider.name && ['assigned', 'picked_up', 'delivered'].includes(order.rider.status) ? (
                    <RiderLive person={{ name: order.rider.name, phone: order.rider.phone, vehicle: order.rider.vehicle, plate: order.rider.plate, stars: order.rider.stars }} live={order.rider.live} eta={order.rider.status === 'delivered' ? null : order.rider.eta} kmLeft={order.rider.status === 'delivered' ? null : order.rider.kmLeft} kmToYou={order.rider.status === 'delivered' ? null : order.rider.kmToYou} stage={order.rider.stage} dest={order.delivery?.lat != null ? { lat: order.delivery.lat, lng: order.delivery.lng } : null} task={seller ? undefined : order.rider.task} />
                  ) : order.rider.name ? (
                    <>
                      <span className="mk-trusted">✔ Trusted &amp; trained: ID-checked and trained by our team</span>
                      <small>{order.rider.vehicle === 'On foot' ? '🚶 On foot' : `🏍️ ${order.rider.vehicle || 'Rider'}`}{order.rider.plate ? ` · ${order.rider.plate}` : ''}</small>
                    </>
                  ) : null}
                  <small>{combined ? (order.rider.fee ? `Delivery fee ${priceText(order.rider.fee)}, paid in cash on delivery` : 'Free delivery (nearby, light parcel)') : <>{order.rider.vehicle === 'On foot' ? 'Delivery' : 'Rider’s'} fee {priceText(order.rider.fee)}{order.payment.method === 'cod' ? ', paid in cash to the rider' : ', paid'}</>}</small>
                </div>
              </div>
            )}
          </div>
        )}

        {/* what can be done now */}
        {seller && order.status === 'placed' && (
          <div className="mk-box mk-actions">
            <b>New order! Confirm it so the buyer knows you’re on it.</b>
            <div className="os-row"><button className="os-btn os-btn-brand" disabled={busy} onClick={() => act('confirmed')}>✅ Confirm order</button></div>
          </div>
        )}
        <DeliveryParts order={order} seller={seller} onOrder={setOrder} />
        {seller && order.status === 'confirmed' && !safe && (waitInspect || byRider) && (
          <div className="mk-box mk-actions">
            {waitInspect ? (
              <>
                <b>{order.inspection.status === 'failed' ? 'The items failed inspection.' : (order.inspection.free ? 'Keep the items ready: our rider checks them when collecting (free for the buyer).' : 'Keep the items ready: our agent comes to check them before they’re sent.')}</b>
                {byRider && order.inspection.status !== 'failed' && <small className="os-muted">Once it passes, you can call a rider.</small>}
              </>
            ) : !order.rider?.status || ['waiting', 'cancelled'].includes(order.rider.status) ? (
              <>
                <b>{courier ? `Packed and ready? Call our agent: they collect it${combined ? ', inspect it' : ''} and send it by ${courier.name}.` : combined ? 'Packed and ready? Call our agent: they inspect the items here, then deliver them.' : 'Packed and ready? Call a rider to pick it up.'}</b>
                <small className="os-muted">{courier ? 'Agents and riders near your shop are alerted and one accepts. The buyer has paid the courier fare. ' : combined ? 'Agents and riders near your shop are alerted and one accepts. ' : 'Riders near your shop are alerted and one accepts. '}{order.rider?.fee ? `The buyer pays the ${priceText(order.rider.fee)} delivery fee to the rider on delivery.` : 'Delivery is free for the buyer.'}</small>
                <div className="os-row"><button className="os-btn os-btn-brand" disabled={busy} onClick={callRider}>{courier ? '📣 Call an agent to send by courier' : combined ? '📣 Call a rider (checks it first, free)' : '📣 Call a rider'}</button></div>
              </>
            ) : order.rider.status === 'open' ? (
              <b>📣 {combined || courier ? 'Agents' : 'Riders'} near you have been alerted. Waiting for one to accept…</b>
            ) : (
              <b>🏍️ {order.rider.name} is coming to pick it up{order.rider.phone ? <> · <a href={`tel:+${order.rider.phone}`}>call {order.rider.phone.replace(/^254/, '0')}</a></> : ''}</b>
            )}
          </div>
        )}
        {seller && order.status === 'confirmed' && !waitInspect && !byRider && (
          <div className="mk-box mk-actions">
            <b>{pickup ? 'Ready? Let the buyer know they can collect it.' : 'Send it, then mark it as shipped.'}</b>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder={pickup ? 'Pickup place & time, e.g. Kilimani, Yaya Centre gate, 2pm' : order.delivery.method === 'walk' ? 'Who is walking it over, e.g. Kevo 0712 000 111' : 'Rider / courier and phone, e.g. Rider Tom 0712 000 111'} />
            <div className="os-row"><button className="os-btn os-btn-brand" disabled={busy} onClick={() => act('shipped', { note })}>{pickup ? '📦 Ready for pickup' : '🚚 Mark as shipped'}</button></div>
          </div>
        )}
        {order.status === 'shipped' && (
          <div className="mk-box mk-actions">
            {order.shipNote && <p>📝 {order.shipNote}</p>}
            <b>{courier ? (seller ? (order.rider?.status === 'sent' ? `Sent by ${courier.name}, waybill ${courier.waybill}. Waiting for the buyer to collect it.` : `${order.rider?.name || 'Our agent'} is taking it to ${courier.name}.`) : order.rider?.status === 'sent' ? `Collected your parcel from ${courier.name}? Check it, then confirm.` : `Our agent is taking it to ${courier.name}. You’ll get the waybill number here.`) : seller ? (byRider ? (order.rider?.status === 'delivered' ? `${order.rider.name} says it’s delivered; waiting for the buyer to confirm.` : `${order.rider?.name || 'Our rider'} is taking it to the buyer.`) : order.payment.method === 'mpesa' ? 'Sent. The buyer confirms when it arrives (or it completes on its own 3 days after sending), then your M-Pesa payout is released.' : 'Delivered? Mark it so the order is complete.') : pickup ? 'Collected it? Let the seller know.' : byRider ? (order.rider?.status === 'delivered' ? `${order.rider.name} says it’s delivered. Did you get everything?` : 'Got your order? Confirm when it’s in your hands.') : 'Got your order? Let the seller know.'}</b>
            {!(seller && (byRider || order.payment.method === 'mpesa')) && <div className="os-row"><button className="os-btn os-btn-brand" disabled={busy} onClick={() => act('delivered')}>{seller ? '🎉 Mark as delivered' : '✅ Yes, I received it'}</button></div>}
            {!seller && courier && <small className="os-muted">Collect it at the {courier.name} office with your ID and waybill number. Something wrong? Don’t confirm: contact us with your order number.</small>}
            {!seller && byRider && !courier && <small className="os-muted">The delivery is complete once you and the rider have both confirmed. If you don’t, it completes on its own 24 hours after the rider’s confirmation.</small>}
          </div>
        )}

        {!seller && order.status === 'delivered' && order.rider?.taskId && <div className="mk-box"><RateRider taskId={order.rider.taskId} name={order.rider.name} rated={order.rider.rated} /></div>}
        {!seller && order.status === 'delivered' && order.rider?.tipPhone && <TipBox o={order} onDone={setOrder} />}
        {!seller && order.status === 'delivered' && <ReviewBox orderId={order._id} sellerName={order.seller.name} />}
        {order.status === 'delivered' && <Link to="/reviews#rate" className="mk-box mk-rate-prompt"><span>⭐</span><span><b>How did <SiteName /> serve you?</b><small>Rate us and leave a comment for everyone to see</small></span><span className="mk-more">Rate us →</span></Link>}

        <div className="mk-order-grid">
          <section className="mk-box">
            <h2>Items</h2>
            {order.items.map((it) => (
              <Link key={it.listing} to={`/market/item/${it.slug}`} className="mk-sum-line">
                <span className="mk-sum-img"><AdImage ad={it} /></span>
                <span className="mk-sum-title">{it.qty} × {it.title}</span>
                <b>{priceText(it.subtotal)}</b>
              </Link>
            ))}
            <div className="mk-sum-line fee"><span>{order.delivery.method === 'walk' ? '🚶 Walking delivery' : courier ? `🚌 ${courier.name} + our agent` : byRider ? (combined ? '🏍️ Agent delivery' : '🏍️ Rider') : 'Delivery'}{cashOnDelivery > 0 ? ' · on delivery' : ''}</span><b>{order.deliveryFee ? priceText(order.deliveryFee) : pickup ? 'Pickup' : order.delivery.free === 'after-sale' ? 'Free (after-sale service)' : 'Free'}</b></div>
            {safe && <div className="mk-sum-line fee"><span>🛡️ Verification at {safe.partnerName}</span><b>{priceText(safe.fee)}</b></div>}
            {order.inspection && <div className="mk-sum-line fee"><span>🔍 {order.inspection.free ? 'Checked by our rider' : 'Inspection by our agent'}</span><b>{order.inspection.free ? 'Free' : priceText(order.inspection.fee)}</b></div>}
            <div className="mk-sum-total"><span>Total</span><b>{priceText(order.total)}</b></div>
            {cashOnDelivery > 0 && (
              <div className="mk-sum-split">
                <div><span>📱 Paid with M-Pesa <small>items{order.inspection ? ' + inspection' : ''}{safe ? ' + verification, held by us' : ''}</small></span><b>{priceText(order.total - cashOnDelivery)}</b></div>
                <div><span>💵 On delivery <small>delivery fee, cash or M-Pesa</small></span><b>{priceText(cashOnDelivery)}</b></div>
              </div>
            )}
            {seller && order.payment.direct && order.payment.method === 'mpesa' && (
              <p className="mk-hint">Paid straight to your M-Pesa ({order.payment.to || 'your Till / Pochi'}): {priceText(order.payment.amount)}, no service fee.{order.payment.receipt ? ` M-Pesa code ${order.payment.receipt}.` : ''}</p>
            )}
            {seller && !order.payment.direct && order.payment.method === 'mpesa' && (
              <p className="mk-hint">Service fee {order.commissionPercent}%: {priceText(order.commission)} · You receive {priceText(order.total - order.commission - (order.inspection?.fee || 0) - (safe?.fee || 0) - (byRider ? order.rider?.fee || 0 : cashOnDelivery))}{!byRider && cashOnDelivery > 0 ? ` + ${priceText(cashOnDelivery)} delivery fee in cash` : ''}{order.payout?.status === 'paid' ? ` (paid out${order.payout.ref ? `, ref ${order.payout.ref}` : ''})` : order.payout?.status === 'due' ? (order.payout.early ? ' (released before delivery: our team has the goods)' : ' (payout on its way)') : safe ? ' as soon as our partner shop verifies it (before delivery)' : ['rider', 'courier'].includes(order.delivery?.method) && order.payment.method === 'mpesa' ? ' as soon as our rider collects it (before delivery)' : order.delivery?.method === 'walk' && order.inspection?.status && order.payment.method === 'mpesa' ? ' once our agent’s inspection passes (before delivery)' : ' after delivery'}</p>
            )}
          </section>
          <section className="mk-box">
            <h2>{pickup ? 'Pickup' : 'Delivery'} &amp; payment</h2>
            <dl className="mk-kv">
              <dt>{pickup ? 'Pick up from' : 'Deliver to'}</dt><dd>{pickup ? order.delivery.pickupArea : [order.delivery.address, order.delivery.county].filter(Boolean).join(', ')}</dd>
              {order.delivery.method === 'walk' && (
                <><dt>Walking delivery</dt><dd>🚶 {order.delivery.km} km, about {order.delivery.minutes} min on foot{order.delivery.lat != null && order.role !== 'buyer' && <> · <a href={`https://www.google.com/maps/dir/?api=1&destination=${order.delivery.lat},${order.delivery.lng}&travelmode=walking`} target="_blank" rel="noopener noreferrer">🧭 Walking directions to the buyer</a></>}</dd></>
              )}
              {order.delivery.notes && <><dt>Note</dt><dd>{order.delivery.notes}</dd></>}
              <dt>Payment</dt><dd>{payText(order)}</dd>
              {order.payment.ref && <><dt>Payment ID</dt><dd><b className="mk-payref">{order.payment.ref}</b> <small className="os-muted">quote it to track this order</small></dd></>}
              {seller && phone && <><dt>Buyer phone</dt><dd><a href={`tel:+${phone}`}>{prettyPhone(phone)}</a></dd></>}
            </dl>
            <div className="mk-order-links">
              {seller && phone && <a className="os-btn os-btn-ghost" href={`https://wa.me/${phone}?text=${encodeURIComponent(`Hi ${order.buyer.name.split(' ')[0]}, about your order ${order.orderNo} on ${STORE_INFO.name}`)}`} target="_blank" rel="noreferrer">WhatsApp buyer</a>}
              {!seller && <Link className="os-btn os-btn-ghost" to={`/market/item/${order.items[0]?.slug}#contact`}>💬 Chat with seller</Link>}
              <button className="os-btn os-btn-ghost" onClick={openSupportChat}>Get help</button>
            </div>
          </section>
        </div>

        {canCancel && (
          <div className="mk-cancel">
            {!cancelling ? (
              <button className="os-linkbtn mk-report" onClick={() => setCancelling(true)}>Cancel this order</button>
            ) : (
              <div className="mk-box mk-actions">
                <b>Cancel order {order.orderNo}?</b>
                <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder={seller ? 'Reason for the buyer (required), e.g. out of stock' : 'Reason (optional)'} />
                <div className="os-row">
                  <button className="os-btn os-btn-ghost" onClick={() => setCancelling(false)}>Keep it</button>
                  <button className="os-btn os-btn-dark" disabled={busy} onClick={() => act('cancelled', { reason })}>Yes, cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div></div>
  );
}

// 🛡️ Safe deal: where the item is checked, and how far along it is
const SAFE_STEPS = ['awaiting_dropoff', 'received', 'passed'];
function SafeDeal({ order, seller }) {
  const safe = order.verification;
  const map = safe.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${safe.lat},${safe.lng}` : '';
  const step = SAFE_STEPS.indexOf(safe.status);
  const checks = [['matchesAd', 'Matches the ad'], ['works', 'Works properly'], ['condition', 'Condition as described'], ['genuine', 'Genuine (serial / IMEI checked)']];
  const daysLeft = safe.dropoffBy ? Math.max(0, Math.ceil((new Date(safe.dropoffBy) - Date.now()) / 86400000)) : null;
  return (
    <section className={`mk-box mk-safe-deal ${safe.status}`} aria-label="Safe deal verification">
      <h2>🛡️ Safe deal: verified at our partner shop</h2>
      <div className="mk-safe-shop">
        <b>{safe.partnerName}</b>
        <small>{[safe.address, safe.area].filter(Boolean).join(' · ')}{safe.hours ? ` · open ${safe.hours}` : ''}</small>
        <div className="os-row">
          {map && <a className="os-btn" href={map} target="_blank" rel="noopener noreferrer">🗺️ Directions</a>}
          {seller && safe.partnerPhone && <a className="os-btn" href={`tel:+${safe.partnerPhone}`}>📞 Call the shop</a>}
        </div>
      </div>
      {['waiting', 'awaiting_dropoff', 'received', 'passed'].includes(safe.status) && (
        <ol className="mk-safe-steps">
          <li className={step >= 0 || safe.status === 'waiting' ? 'on' : ''}>{seller ? 'You take the item to the partner shop' : 'The seller takes the item to the partner shop'}</li>
          <li className={step >= 1 ? 'on' : ''}>The partner checks it</li>
          <li className={step >= 2 ? 'on' : ''}>Verified: {seller ? 'you’re paid' : 'the seller is paid'} and our rider brings it{seller ? ' to the buyer' : ' to you'}</li>
        </ol>
      )}
      {safe.status === 'waiting' && <p>{seller ? 'Confirm the order, then take the item to this shop.' : 'Waiting for the seller to confirm. Your money is held by us until the item is verified.'}</p>}
      {safe.status === 'awaiting_dropoff' && (
        <p>{seller ? <><b>Take the item to {safe.partnerName}{daysLeft != null ? ` within ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : ''}.</b> Bring its accessories, box and papers. You’re paid as soon as it passes.</> : <>The seller is taking the item to {safe.partnerName}. Your money is held by us; {daysLeft != null ? `if they don’t drop it off within ${daysLeft} day${daysLeft === 1 ? '' : 's'}, you get a full refund.` : 'if they don’t drop it off, you get a full refund.'}</>}</p>
      )}
      {safe.status === 'received' && <p>📥 The item is at {safe.partnerName}, being checked now.</p>}
      {['passed', 'failed'].includes(safe.status) && (
        <>
          <ul className="mk-safe-checks">
            {checks.map(([key, text]) => <li key={key} className={safe.checks?.[key] ? 'yes' : 'no'}>{safe.checks?.[key] ? '✅' : '❌'} {text}</li>)}
          </ul>
          {safe.serial && <small>Serial / IMEI recorded: <b>{safe.serial}</b></small>}
          {safe.note && <small>Partner’s note: {safe.note}</small>}
        </>
      )}
      {safe.status === 'passed' && <p className="mk-safe-ok">✅ Verified. {seller ? 'Your payment has been released. Our rider collects it from the partner shop.' : 'Our rider collects it from the partner shop and brings it to you.'}</p>}
      {safe.status === 'failed' && <p className="mk-safe-bad">❌ It didn’t pass. {seller ? `Collect your item from ${safe.partnerName}.` : `The order is cancelled and ${priceText(safe.refund || order.subtotal)} (the item price) is being refunded to your M-Pesa.`}</p>}
      {safe.status === 'cancelled' && <p>This Safe deal was cancelled{order.payment.status === 'refund_due' || order.payment.status === 'refunded' ? ': your money is being refunded' : ''}.</p>}
    </section>
  );
}

// After a delivery by our rider / delivery agent: tip them straight to their M-Pesa, then let them know
function TipBox({ o: order, onDone }) {
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);
  const rider = order.rider;
  const phone = String(rider.tipPhone).replace(/^254/, '0');
  const pretty = phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
  const copy = () => navigator.clipboard?.writeText(phone).then(() => toast.success('Number copied'), () => toast.error('Copy failed: note it down'));
  const sent = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/orders/${order._id}/tip`, { amount });
      onDone(res.data);
      toast.success(`Thank you! ${rider.name.split(' ')[0]} has been told 🙏`);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mk-box mk-tip" aria-label="Tip your rider">
      <h2>🙏 Happy with {rider.name.split(' ')[0]}’s service? Leave a tip</h2>
      {rider.tip > 0 && <p className="mk-tip-thanks">You tipped {priceText(rider.tip)}. Asante sana!</p>}
      <p>Tips go <b>straight to {rider.name}</b> by M-Pesa, all of it. {rider.vehicle === 'On foot' ? 'Our delivery agent' : 'Our rider'} is ID-checked and trained by our team.</p>
      <div className="mk-tip-phone">
        <span>M-Pesa → Send Money → <b>{pretty}</b> ({rider.name})</span>
        <button type="button" className="os-btn os-btn-ghost" onClick={copy}>Copy number</button>
      </div>
      <div className="mk-chips" role="group" aria-label="Tip amount">
        {[20, 50, 100, 200].map((item) => <button type="button" key={item} className={amount === item ? 'on' : ''} onClick={() => setAmount(item)}>{priceText(item)}</button>)}
      </div>
      <button type="button" className="os-btn os-btn-brand" disabled={busy} onClick={sent}>I’ve sent {priceText(amount)}: let {rider.name.split(' ')[0]} know</button>
      <small className="os-muted">Tipping is optional. We don’t take any of it.</small>
    </section>
  );
}

// Pay on delivery: the seller's M-Pesa Till / Paybill / Pochi la Biashara, copied when the order was placed
function PayOnDelivery({ o: order }) {
  const sellerPay = order.sellerPay;
  const riderCash = order.delivery?.method === 'rider' && order.deliveryFee ? order.deliveryFee : 0;
  const forSeller = order.total - riderCash;
  const copy = (value, what) => navigator.clipboard?.writeText(value).then(() => toast.success(`${what} copied`), () => toast.error('Copy failed: note it down'));
  const phone = sellerPay?.phone ? sellerPay.phone.replace(/^254(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3') : '';
  return (
    <section className="mk-box mk-paybox" aria-label="How to pay on delivery">
      <h2>💵 Pay on delivery: {priceText(forSeller)}</h2>
      {sellerPay ? (
        <>
          <p>Pay <b>{order.seller.name}</b> by M-Pesa when you get your order{sellerPay.name ? <> ({sellerPay.name})</> : ''}:</p>
          <div className="mk-paybox-how">
            {sellerPay.method === 'till' && <><span>M-Pesa → Lipa na M-Pesa → <b>Buy Goods</b></span><span className="mk-paybox-num">Till <b>{sellerPay.till}</b> <button type="button" className="os-linkbtn" onClick={() => copy(sellerPay.till, 'Till number')}>Copy</button></span></>}
            {sellerPay.method === 'paybill' && <><span>M-Pesa → Lipa na M-Pesa → <b>Pay Bill</b></span><span className="mk-paybox-num">Business no. <b>{sellerPay.paybill}</b> <button type="button" className="os-linkbtn" onClick={() => copy(sellerPay.paybill, 'Paybill number')}>Copy</button></span><span className="mk-paybox-num">Account no. <b>{sellerPay.account}</b> <button type="button" className="os-linkbtn" onClick={() => copy(sellerPay.account, 'Account number')}>Copy</button></span></>}
            {sellerPay.method === 'pochi' && <><span>M-Pesa → Lipa na M-Pesa → <b>Pochi la Biashara</b></span><span className="mk-paybox-num">Phone <b>{phone}</b> <button type="button" className="os-linkbtn" onClick={() => copy(phone.replace(/\s/g, ''), 'Number')}>Copy</button></span></>}
            {sellerPay.method === 'phone' && <><span>M-Pesa → <b>Send Money</b></span><span className="mk-paybox-num">Phone <b>{phone}</b> <button type="button" className="os-linkbtn" onClick={() => copy(phone.replace(/\s/g, ''), 'Number')}>Copy</button></span></>}
          </div>
        </>
      ) : <p>Pay {order.seller.name} in cash or by M-Pesa when you get it. Ask the seller in the chat for their Till or number.</p>}
      {riderCash > 0 && <p className="mk-paybox-rider">🏍️ Plus <b>{priceText(riderCash)}</b> delivery fee in cash to our rider.</p>}
      <small className="os-muted">Pay only when you have the items in your hands and they’re what you ordered.</small>
    </section>
  );
}

// split payment paid from the M-Pesa menu: the seller types the M-Pesa code they received (from their SMS or
// statement). We compare it with the code the buyer sent us; the seller never sees the buyer's code.
function ConfirmDirectPay({ o: order, onDone }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const payment = order.payment;
  const send = async (body) => {
    setBusy(true);
    try {
      const response = await api.post(`/orders/${order._id}/payment`, body);
      onDone(response.data.order);
      setCode('');
      const outcome = response.data.outcome;
      if (outcome === 'matched') toast.success('Codes match: the order is placed');
      else if (outcome === 'mismatch') toast.error('That code doesn’t match the buyer’s. Check your M-Pesa SMS; the buyer has been asked to check theirs.', { duration: 7000 });
      else if (outcome === 'rejected') toast.success('The buyer has been told');
      else toast.success('Saved. The order starts once the buyer sends the same code.');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const none = () => window.confirm('Say NO M-Pesa payment arrived for this order? The buyer will be asked to check or pay again.') && send({ received: false });
  return (
    <section className="mk-box mk-paybox mk-confirm-pay" aria-label="Enter the M-Pesa code you received">
      <h2>💵 Enter the M-Pesa code for {priceText(payment.amount)}</h2>
      <p><b>{order.buyer.name}</b> {payment.claimed ? 'says they paid you' : 'is paying you'} directly{payment.to ? ` (${payment.to})` : ''}. Type the code from the M-Pesa SMS you received for this payment. We compare it with the buyer’s code; the order starts when they match.</p>
      {payment.mismatch && <p className="mk-split-note bad">⚠️ The code you entered ({payment.sellerCode}) doesn’t match the buyer’s. Check your SMS and enter it again; the buyer was asked to check theirs.</p>}
      {payment.sellerCode && !payment.mismatch && <p className="mk-split-note">You entered <b className="mk-code">{payment.sellerCode}</b>. Waiting for the buyer’s code.</p>}
      <form className="mk-split-code" onSubmit={(event) => { event.preventDefault(); send({ code: clean }); }}>
        <label><span>M-Pesa code you received</span><input value={code} onChange={(event) => setCode(event.target.value)} maxLength={14} placeholder="e.g. SFG3K7QX2P" autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
        <button className="os-btn os-btn-brand" disabled={busy || clean.length !== 10}>Check the code</button>
      </form>
      {payment.claimed && <button type="button" className="os-btn os-btn-ghost mk-mt" disabled={busy} onClick={none}>No payment arrived</button>}
    </section>
  );
}

function SellerPayPrompt() {
  return (
    <div className="mk-box mk-actions">
      <b>💵 The buyer pays you on delivery. Add your M-Pesa Till, Paybill or Pochi la Biashara so they know how.</b>
      <div className="os-row"><Link className="os-btn os-btn-brand" to="/account#pay-details">Add how buyers pay me</Link></div>
    </div>
  );
}
