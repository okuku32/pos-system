// Paying several sellers in one checkout: each seller is paid straight to their own M-Pesa (Till, Paybill, Pochi la
// Biashara or Send Money), one payment each, each with its own M-Pesa code.
//   · first, one M-Pesa prompt for our verification & inspection fee (per seller): our agent checks each payment
//     reached the seller and the goods match the order
//   · sellers who connected M-Pesa prompts: the prompts come to the buyer's phone one after another (a phone shows one
//     M-Pesa prompt at a time), sent by the server as soon as the previous one is answered
//   · the others: "Pay from your phone" opens the M-Pesa menu (*334#) with the number copied; the buyer pays and sends
//     us the M-Pesa code; the seller types the code they received; we compare the two
// Used on the checkout page right after "Pay", and at /pay/:checkoutId to come back and finish.
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { STORE_INFO } from '../shop/storeInfo';
import { saveReceipt } from './receipt';
import './market.css';

const WAITING = ['queued', 'prompted', 'claimed', 'mismatch']; // the screen keeps checking while any part is like this (a seller may fix their code)
const BADGE = {
  paid: ['✅', 'Paid'], prompted: ['📲', 'Prompt on your phone'], queued: ['⏳', 'Next prompt'], manual: ['💵', 'Pay from your phone'], claimed: ['🔎', 'Matching codes'],
  mismatch: ['⚠️', 'Codes don’t match'], failed: ['⚠️', 'Not paid'], cancelled: ['✖', 'Cancelled'], cod: ['💵', 'Cash on delivery'], refund_due: ['↩️', 'Refund due'], refunded: ['↩️', 'Refunded'],
};
const money = (value) => (value > 0 ? priceText(value) : 'KSh 0'); // priceText(0) means “no price” elsewhere
const phoneText = (value) => String(value || '').replace(/^254(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3');
const copy = (value, what) => navigator.clipboard?.writeText(value).then(() => toast.success(`${what} copied`), () => toast.error('Copy failed: note it down'));
const onPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
// the number the buyer pays to (copied when they tap "Pay from your phone")
const payNumber = (to) => (to?.method === 'till' ? to.till : to?.method === 'paybill' ? to.paybill : phoneText(to?.phone).replace(/\s/g, ''));

// how to pay this seller from the M-Pesa menu
function PaySteps({ to, amount }) {
  if (!to) return null;
  const num = (label, value, what) => <span className="mk-paybox-num">{label} <b>{value}</b> <button type="button" className="os-linkbtn" onClick={() => copy(String(value).replace(/\s/g, ''), what)}>Copy</button></span>;
  return (
    <div className="mk-paybox-how">
      {to.method === 'till' && <><span>M-Pesa → Lipa na M-Pesa → <b>Buy Goods</b></span>{num('Till', to.till, 'Till number')}</>}
      {to.method === 'paybill' && <><span>M-Pesa → Lipa na M-Pesa → <b>Pay Bill</b></span>{num('Business no.', to.paybill, 'Paybill number')}{num('Account no.', to.account, 'Account number')}</>}
      {to.method === 'pochi' && <><span>M-Pesa → Lipa na M-Pesa → <b>Pochi la Biashara</b></span>{num('Phone', phoneText(to.phone), 'Number')}</>}
      {to.method === 'phone' && <><span>M-Pesa → <b>Send Money</b></span>{num('Phone', phoneText(to.phone), 'Number')}</>}
      <span className="mk-paybox-num">Amount <b>{priceText(amount)}</b></span>
      {to.name && <small className="os-muted">Name shown by M-Pesa: {to.name}</small>}
    </div>
  );
}

function CodeForm({ busy, onSend, label = 'M-Pesa code from your SMS', button = 'Send the code' }) {
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (
    <form className="mk-split-code" onSubmit={(event) => { event.preventDefault(); onSend(clean); }}>
      <label>
        <span>{label}</span>
        <input value={code} onChange={(event) => setCode(event.target.value)} maxLength={14} placeholder="e.g. SFG3K7QX2P" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </label>
      <button className="os-btn os-btn-brand" disabled={busy || clean.length !== 10}>{button}</button>
    </form>
  );
}

// "Pay from your phone": copies the number, opens the M-Pesa menu on a phone, then shows the steps and the code box
function PayByHand({ part, busy, onCode, feeOk, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  // on a phone the button is a real link to the M-Pesa menu (*334#); it also copies the number and shows the steps
  const menu = onPhone() ? 'tel:*334%23' : undefined;
  const go = () => {
    copy(payNumber(part.to), part.to?.method === 'till' ? 'Till number' : part.to?.method === 'paybill' ? 'Paybill number' : 'Number');
    setOpen(true);
  };
  if (!feeOk) return <p className="mk-split-note">Pay the verification fee above first, then pay {part.seller.name} here.</p>;
  return (
    <>
      {!open && <a role="button" href={menu} className="os-btn os-btn-brand mk-split-paybtn" onClick={go}>📲 Pay {priceText(part.amount)} from your phone</a>}
      {open && (
        <>
          <PaySteps to={part.to} amount={part.amount} />
          <p className="mk-split-note">Then send us the M-Pesa code from the SMS. We compare it with the code {part.seller.name} received.</p>
          <CodeForm busy={busy} onSend={(code) => onCode(part, code)} />
          {menu && <a href={menu} className="os-linkbtn mk-split-menu" onClick={go}>Open the M-Pesa menu again</a>}
        </>
      )}
    </>
  );
}

function Part({ part, index, busy, feeOk, onRetry, onCode }) {
  const [badge, label] = BADGE[part.state] || ['•', part.state];
  return (
    <li className={`mk-split-part ${part.state}`}>
      <div className="mk-split-head">
        <span className="mk-split-n">{index + 1}</span>
        <div>
          <b>{part.seller.name}</b>
          <small>Order {part.orderNo}{part.to?.text ? ` · ${part.to.text}` : ''}</small>
        </div>
        <span className={`mk-split-badge ${part.state}`}>{badge} {label}</span>
      </div>
      <ul className="mk-split-items">
        {part.items.map((item, position) => <li key={position}><span>{item.qty} × {item.title}</span><span>{priceText(item.subtotal)}</span></li>)}
      </ul>
      <div className="mk-split-amount">
        <span>To {part.seller.name}{part.payOnDelivery ? <small> (+ {priceText(part.payOnDelivery)} delivery, paid on arrival)</small> : null}</span>
        <b>{priceText(part.amount)}</b>
      </div>
      {part.state === 'paid' && <p className="mk-split-note ok">M-Pesa code <b>{part.receipt}</b>{part.ref ? <> · Payment ID <b className="mk-payref">{part.ref}</b></> : null}</p>}
      {part.state === 'prompted' && <p className="mk-split-note">Enter your M-Pesa PIN on your phone to pay <b>{part.seller.name}</b> {priceText(part.amount)}.</p>}
      {part.state === 'queued' && <p className="mk-split-note">{feeOk ? 'This prompt comes next, as soon as you’ve answered the one on your phone.' : 'This prompt comes after the verification fee.'}</p>}
      {part.state === 'claimed' && <p className="mk-split-note">You sent M-Pesa code <b>{part.claimCode}</b>. We’re matching it with the code {part.seller.name} received; your order starts as soon as they match.</p>}
      {part.state === 'manual' && <PayByHand part={part} busy={busy} feeOk={feeOk} onCode={onCode} />}
      {part.state === 'mismatch' && (
        <>
          <p className="mk-split-note bad">{part.failReason || `Your code doesn’t match the one ${part.seller.name} received.`}</p>
          <CodeForm busy={busy} onSend={(code) => onCode(part, code)} label="The M-Pesa code, exactly as in your SMS" button="Send again" />
        </>
      )}
      {part.state === 'failed' && (
        <>
          <p className="mk-split-note bad">{part.failReason || 'This payment didn’t go through.'}</p>
          {part.channel === 'stk' && <div className="os-row"><button type="button" className="os-btn os-btn-brand" disabled={busy} onClick={() => onRetry(part)}>📲 Send the prompt again</button></div>}
          <PayByHand part={part} busy={busy} feeOk={feeOk} onCode={onCode} />
        </>
      )}
    </li>
  );
}

// our verification & inspection fee: the first prompt
function FeeCard({ fee, busy, onRetry }) {
  const [badge, label] = { paid: ['✅', 'Paid'], prompted: ['📲', 'Prompt on your phone'], queued: ['⏳', 'Sending…'], failed: ['⚠️', 'Not paid'] }[fee.state] || ['•', fee.state];
  return (
    <div className={`mk-split-part mk-split-fee ${fee.state}`}>
      <div className="mk-split-head">
        <span className="mk-split-n">🛡️</span>
        <div>
          <b>Payment verification &amp; inspection</b>
          <small>Paid to {STORE_INFO.name}: our agent checks each payment reached the seller and the goods match your order</small>
        </div>
        <span className={`mk-split-badge ${fee.state}`}>{badge} {label}</span>
      </div>
      <div className="mk-split-amount">
        <span>{fee.sellers === 1 ? 'Verification fee' : `${priceText(fee.each)} × ${fee.sellers} sellers`}{fee.inspections ? ` + ${priceText(fee.inspections)} inspection you asked for` : ''}</span>
        <b>{priceText(fee.amount)}</b>
      </div>
      {fee.state === 'prompted' && <p className="mk-split-note">Enter your M-Pesa PIN on your phone to pay {priceText(fee.amount)} to {STORE_INFO.name}. The sellers come next.</p>}
      {fee.state === 'paid' && <p className="mk-split-note ok">M-Pesa code <b>{fee.receipt}</b></p>}
      {fee.state === 'failed' && (
        <>
          <p className="mk-split-note bad">{fee.failReason || 'The verification fee wasn’t paid.'} The sellers can’t be paid until it is.</p>
          <div className="os-row"><button type="button" className="os-btn os-btn-brand" disabled={busy} onClick={onRetry}>📲 Send the prompt again</button></div>
        </>
      )}
    </div>
  );
}

export function SplitPayWait({ checkoutId, initial, phone, onFinished, onCod }) {
  const [data, setData] = useState(initial || null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const started = useRef(Date.now());
  const waiting = (data?.parts || []).some((part) => WAITING.includes(part.state)) || ['queued', 'prompted'].includes(data?.fee?.state);

  const refresh = () => api.get(`/orders/checkout/${checkoutId}`).then((response) => setData(response.data)).catch(() => {});
  useEffect(() => {
    if (!initial) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutId]);
  // poll while a prompt is on the phone, one is queued, or codes are being matched (stop after 15 minutes)
  useEffect(() => {
    clearInterval(timer.current);
    if (!waiting || Date.now() - started.current > 15 * 60 * 1000) return undefined;
    timer.current = setInterval(refresh, 3000);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, checkoutId]);
  const wasPaid = useRef(false);
  useEffect(() => {
    if (data?.status === 'paid' && !wasPaid.current) {
      wasPaid.current = true;
      toast.success(data.sellers === 1 ? 'Payment complete. Asante! 🎉' : 'Every seller is paid. Asante! 🎉');
    }
  }, [data?.status]);

  const act = async (work, done) => {
    setBusy(true);
    try {
      const response = await work();
      if (response?.data?.parts) setData(response.data);
      else await refresh();
      done?.(response?.data);
    } catch (err) {
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };
  const retry = (part) => act(() => api.post(`/orders/checkout/${checkoutId}/pay`, { orderId: part.orderId, ...(phone ? { phone } : {}) }));
  const retryFee = () => act(() => api.post(`/orders/checkout/${checkoutId}/pay`, { fee: true, ...(phone ? { phone } : {}) }));
  const sendCode = (part, code) => act(() => api.post(`/orders/checkout/${checkoutId}/code`, { orderId: part.orderId, code }), (result) => {
    if (result?.outcome === 'matched') toast.success(`Codes match: ${part.seller.name} is paid`);
    else if (result?.outcome === 'mismatch') toast.error('That code doesn’t match the one the seller received. Check your SMS.');
    else toast.success(`Code sent. We’ll match it with ${part.seller.name}’s`);
  });

  if (!data) return <div className="page-loading"><span className="page-spinner" /></div>;
  const feeOk = !data.fee || data.fee.state === 'paid';
  const paid = data.parts.filter((part) => part.state === 'paid').reduce((sum, part) => sum + part.amount, 0) + (data.fee?.state === 'paid' ? data.fee.amount : 0);
  const finished = data.status === 'paid' || data.status === 'done';
  return (
    <div className="mk-split">
      <div className="mk-pay-icon">{finished ? '✅' : '🧾'}</div>
      <h1>{finished ? (data.sellers === 1 ? 'Payment complete' : 'All sellers handled') : data.sellers === 1 ? `Pay ${data.parts[0].seller.name} directly` : `Pay ${data.sellers} sellers directly`}</h1>
      <p>{data.sellers === 1 ? `You pay ${data.parts[0].seller.name} straight to their own M-Pesa. When it’s done you get a payment ID to track your order.` : `Your cart has items from ${data.sellers} sellers. You pay each one straight to their own M-Pesa, so each payment gets its own M-Pesa code.`}{data.parts.some((part) => part.channel === 'stk') ? ' The M-Pesa prompts come to your phone one after another.' : ''}</p>
      {data.demo && <p className="mk-hint">🧪 Demo payments are on: marked paid without money.</p>}
      {data.fee && <FeeCard fee={data.fee} busy={busy} onRetry={retryFee} />}
      <ol className="mk-split-list">
        {data.parts.map((part, index) => <Part key={part.orderId} part={part} index={index} busy={busy} feeOk={feeOk} onRetry={retry} onCode={sendCode} />)}
      </ol>
      <div className="mk-split-total">
        <div><span>Total goods</span><b>{priceText(data.goods)}</b></div>
        {data.onDelivery > 0 && <div><span>Delivery fees (paid on arrival)</span><b>{priceText(data.onDelivery)}</b></div>}
        <div><span>{data.sellers === 1 ? `To ${data.parts[0].seller.name}` : 'To the sellers'}</span><b>{priceText(data.sellersNow ?? data.payNow)}</b></div>
        {data.fee && <div><span>Verification &amp; inspection ({STORE_INFO.name})</span><b>{priceText(data.fee.amount)}</b></div>}
        <div className="ok"><span>Paid so far</span><b>{money(paid)}</b></div>
        <div className="grand"><span>Total</span><b>{priceText(data.total)}</b></div>
      </div>
      <div className="os-row center mk-mt">
        <button type="button" className="os-btn os-btn-dark" onClick={() => saveReceipt(api, `/orders/checkout/${checkoutId}/receipt.pdf`, `checkout-${checkoutId.slice(0, 8)}`)}>🧾 {data.sellers === 1 ? 'Receipt (PDF)' : 'Receipt for all sellers (PDF)'}</button>
        {finished ? <button type="button" className="os-btn os-btn-brand" onClick={() => onFinished?.(data.orders)}>See my orders</button>
          : onCod && data.parts.some((part) => ['failed', 'manual', 'queued'].includes(part.state)) && <button type="button" className="os-btn os-btn-ghost" onClick={() => onCod()}>Pay the unpaid sellers cash on delivery</button>}
      </div>
      {!finished && <small className="os-muted">Unpaid parts are kept for 30 minutes. When you pay from the M-Pesa menu, the seller has up to 48 hours to enter the code they received.</small>}
    </div>
  );
}

// /pay/:checkoutId: come back to finish paying the sellers
export default function SplitPayPage() {
  const { checkoutId } = useParams();
  const { customer, ready, refreshOrders } = useShop();
  const navigate = useNavigate();
  useSeo({ title: 'Pay the sellers', noindex: true });
  if (ready && !customer) return <Navigate to={`/login?next=${encodeURIComponent(`/pay/${checkoutId}`)}`} replace />;
  if (!/^[a-f0-9]{16}$/.test(checkoutId || '')) return <div className="mk"><div className="mk-wrap mk-narrow"><p className="mk-error">Payment not found.</p><Link to="/orders">← My orders</Link></div></div>;
  const cod = async () => {
    try {
      await api.post(`/orders/checkout/${checkoutId}/cod`);
      toast.success('Done: you’ll pay those sellers cash on delivery');
      refreshOrders?.().catch(() => {});
      navigate('/orders', { replace: true });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <div className="mk"><div className="mk-wrap mk-narrow">
      <Link to="/orders" className="mk-back">← My orders</Link>
      {customer && <SplitPayWait checkoutId={checkoutId} onFinished={() => navigate('/orders')} onCod={cod} />}
    </div></div>
  );
}
