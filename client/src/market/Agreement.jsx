import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';
import { AdImage } from './ListingCard';
import './market.css';
import { SiteName, TextWithSiteName } from '../components/BrandName';

const fmtDate = (date) => (date ? new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '–');
const fmtTime = (date) => (date ? new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–');
const METHOD = { cash: 'Cash', mpesa: 'M-Pesa (to the seller)', bank: 'Bank transfer', other: 'Other' };
const maskId = (id = '') => (id.length > 4 ? `${'•'.repeat(id.length - 3)}${id.slice(-3)}` : id);

// ---------------------------------------------------------------- the policy (both parties accept it)
export const POLICY = [
  'This agreement is made directly between the buyer and the seller, who live near each other (same county). Kapu provides the form and keeps a record of it, but is not a party to the sale.',
  'Money paid under this agreement (cash or M-Pesa straight to the seller) is NOT held by Kapu and is not covered by Lipa Salama. For protected payments, use Lipa Pole Pole at checkout.',
  'The deposit must be at least 10% of the agreed price, and the full balance must be paid by the deadline (at most 90 days).',
  'Every payment should be recorded here. The seller confirms each payment received; the balance shown here is the agreed record.',
  'If the buyer takes the item before paying in full, the buyer is responsible for it and must pay the balance by the deadline.',
  'If the item stays with the seller, the seller must keep it in the same condition and not sell it to anyone else while this agreement is active.',
  'If either party cancels, any refund or return of the item is settled between them according to this agreement.',
  'Anything the parties agree or do outside these terms and the Kapu Lipa Pole Pole policy is at their own risk. Kapu may help resolve disputes but is not liable for them.',
];

export function PolePolePolicy() {
  useSeo({ title: 'Lipa Pole Pole: pay bit by bit', description: `How Lipa Pole Pole works on ${STORE_INFO.name}: pay a deposit and the rest in instalments, online with M-Pesa or with a sale agreement for nearby furniture.`, path: '/lipa-pole-pole' });
  return (
    <div className="os-page mk-policy">
      <h1>🐢 Lipa Pole Pole</h1>
      <p className="mk-lead">Pay for what you need bit by bit. There are two ways to do it on <SiteName />:</p>
      <div className="mk-policy-ways">
        <section className="mk-box">
          <h2>1. At checkout (protected)</h2>
          <p>For phones, TVs, laptops, furniture and more from sellers who offer it. Choose <b>Lipa Pole Pole</b> next to M-Pesa and cash, pay a deposit with M-Pesa and the item is reserved for you. Pay the rest any time with M-Pesa; it’s delivered when fully paid.</p>
          <p className="mk-green">🛡️ Your money is held by <SiteName /> (Lipa Salama) and refunded if the plan is cancelled.</p>
        </section>
        <section className="mk-box">
          <h2>2. Sale agreement (nearby furniture)</h2>
          <p>When the buyer and seller live in the same county, they can agree directly: open the chat about a furniture ad and tap <b>📝 Lipa Pole Pole agreement</b>. Fill in both people’s details, the agreed price, the deposit, the balance and the deadline. The other person accepts it in the app, and payments are recorded as they’re made. The buyer can take the item now if the seller agrees.</p>
          <p className="mk-err-text">⚠️ Money paid directly to the seller is not held by <SiteName />.</p>
        </section>
      </div>
      <section className="mk-box">
        <h2>Lipa Pole Pole sale agreement policy</h2>
        <ol className="mk-policy-list">{POLICY.map((item) => <li key={item}><TextWithSiteName text={item} /></li>)}</ol>
      </section>
      <Link to="/" className="os-back">← Back to the marketplace</Link>
    </div>
  );
}

// ---------------------------------------------------------------- your details (ID, county, estate)
function PartyFields({ form, setForm, data }) {
  return (
    <div className="mk-form-grid">
      <label className="os-field"><span>National ID / passport number *</span><input value={form.idNumber} onChange={(event) => setForm({ ...form, idNumber: event.target.value })} required minLength={6} maxLength={12} placeholder="e.g. 12345678" autoComplete="off" /></label>
      <label className="os-field">
        <span>County *</span>
        <select value={form.county} onChange={(event) => setForm({ ...form, county: event.target.value })} required>
          <option value="">Choose…</option>
          {data?.counties.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label className="os-field mk-span-all"><span>Estate / town *</span><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required minLength={3} maxLength={200} placeholder="e.g. Kahawa West, near Quickmart" /></label>
    </div>
  );
}

// ---------------------------------------------------------------- new agreement (from a chat)
export function AgreementForm() {
  const [params] = useSearchParams();
  const conversationId = params.get('c');
  const navigate = useNavigate();
  const { customer, ready } = useShop();
  const data = useCategories();
  const [conv, setConv] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inDays = (number) => new Date(Date.now() + number * 86400000).toLocaleDateString('en-CA');
  const [values, setValues] = useState({ price: '', deposit: '', depositMethod: 'cash', depositRef: '', deadline: inDays(30), schedule: '', possession: 'after_payment', notes: '', idNumber: '', county: '', address: '', agree: false });
  useSeo({ title: 'Lipa Pole Pole agreement', noindex: true });

  useEffect(() => {
    if (!customer || !conversationId) return;
    setValues((previousValues) => ({ ...previousValues, county: previousValues.county || customer.county || '', address: previousValues.address || customer.address || '' }));
    api.get(`/market/conversations/${conversationId}/messages`).then((response) => {
      setConv(response.data);
      setValues((previousValues) => ({ ...previousValues, price: previousValues.price || String(response.data.listing?.price || '') }));
    }).catch((innerError) => setError(errMsg(innerError)));
  }, [customer, conversationId]);

  if (ready && !customer) return <Navigate to={`/login?next=${encodeURIComponent(`/agreements/new?c=${conversationId}`)}`} replace />;
  if (error) return <div className="mk mk-wrap mk-narrow"><p className="mk-error">{error}</p></div>;
  if (!conv) return <div className="mk mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div>;
  const conversation = conv.conversation;
  const role = conversation.role;
  const price = Number(values.price) || 0;
  const deposit = Number(values.deposit) || 0;
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.post('/agreements', { ...values, conversationId, price, deposit });
      toast.success('Agreement sent. The other person will review and accept it.');
      navigate(`/agreements/${response.data._id}`, { replace: true });
    } catch (err) {
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk"><form className="mk-wrap mk-narrow mk-agree-form" onSubmit={submit}>
        <Link to={`/market/messages/${conversationId}`} className="mk-back">← Back to the chat</Link>
        <h1>📝 Lipa Pole Pole sale agreement</h1>
        <p className="os-muted">Between you and {conversation.other.name}, for buyers and sellers who live near each other. {conversation.other.name.split(' ')[0]} will review and accept it in the app.</p>
        <div className="mk-box mk-pp-item">
          <span className="mk-order-img"><AdImage ad={{ ...conversation.listing, category: conversation.listing.category }} /></span>
          <span><b>{conversation.listing.title}</b><small>Listed at {priceText(conversation.listing.price)} · you are the {role}</small></span>
        </div>

        <section className="mk-box">
          <h2><span className="mk-step">1</span> Your details ({role})</h2>
          <p className="mk-hint">{customer.name} · {prettyPhone(customer.phone)} · {customer.email}. Your ID number is shown only to {conversation.other.name.split(' ')[0]} and our team.</p>
          <PartyFields form={values} setForm={setValues} data={data} />
        </section>

        <section className="mk-box">
          <h2><span className="mk-step">2</span> The deal</h2>
          <div className="mk-form-grid">
            <label className="os-field"><span>Total agreed price (KSh) *</span><input inputMode="numeric" value={values.price} onChange={(event) => setValues({ ...values, price: event.target.value.replace(/\D/g, '') })} required /></label>
            <label className="os-field"><span>Deposit paid now (KSh) * <em>(min 10%)</em></span><input inputMode="numeric" value={values.deposit} onChange={(event) => setValues({ ...values, deposit: event.target.value.replace(/\D/g, '') })} required placeholder={price ? String(Math.ceil(price * 0.1)) : ''} /></label>
            <label className="os-field">
              <span>Deposit paid by</span>
              <select value={values.depositMethod} onChange={set('depositMethod')}>{Object.entries(METHOD).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
            </label>
            <label className="os-field"><span>M-Pesa code / receipt <em>(optional)</em></span><input value={values.depositRef} onChange={set('depositRef')} maxLength={40} placeholder="e.g. TK12AB34CD" /></label>
            <label className="os-field"><span>Balance to be paid by *</span><input type="date" value={values.deadline} min={inDays(1)} max={inDays(90)} onChange={set('deadline')} required /></label>
            <label className="os-field"><span>How the balance will be paid</span><input value={values.schedule} onChange={set('schedule')} maxLength={200} placeholder="e.g. KSh 5,000 every Friday" /></label>
          </div>
          <div className="mk-pp-summary mk-mt">
            <div><small>Total</small><b>{priceText(price)}</b></div>
            <div><small>Deposit</small><b>{priceText(deposit)}</b></div>
            <div><small>Balance</small><b>{priceText(Math.max(0, price - deposit))}</b></div>
          </div>
          <span className="mk-filter-title mk-mt">Who keeps the item until it’s fully paid?</span>
          <div className="mk-choice">
            <label className={values.possession === 'after_payment' ? 'on' : ''}><input type="radio" checked={values.possession === 'after_payment'} onChange={() => setValues({ ...values, possession: 'after_payment' })} /><span><b>The seller</b><small>Buyer collects it after the last payment</small></span></label>
            <label className={values.possession === 'buyer_now' ? 'on' : ''}><input type="radio" checked={values.possession === 'buyer_now'} onChange={() => setValues({ ...values, possession: 'buyer_now' })} /><span><b>The buyer takes it now</b><small>Only if the seller agrees; the buyer is responsible for it</small></span></label>
          </div>
          <label className="os-field mk-mt"><span>Other terms <em>(optional)</em></span><textarea rows={2} value={values.notes} onChange={set('notes')} maxLength={500} placeholder="e.g. Seller delivers to Kahawa West after the last payment" /></label>
        </section>

        <section className="mk-box">
          <h2><span className="mk-step">3</span> Policy</h2>
          <ol className="mk-policy-list small">{POLICY.map((item) => <li key={item}><TextWithSiteName text={item} /></li>)}</ol>
          <label className="mk-check mk-mt"><input type="checkbox" checked={values.agree} onChange={set('agree')} required /> I have read and agree to this agreement and the Lipa Pole Pole sale policy.</label>
        </section>
        <div className="mk-sell-submit"><button className="os-btn os-btn-brand os-btn-lg" disabled={busy}>{busy ? 'Sending…' : 'Send agreement to ' + conversation.other.name.split(' ')[0]}</button></div>
      </form></div>
  );
}

// ---------------------------------------------------------------- the agreement (printable)
const STATUS = {
  waiting_buyer: ['⏳', 'Waiting for the buyer to accept'],
  waiting_seller: ['⏳', 'Waiting for the seller to accept'],
  active: ['🟢', 'Active'],
  completed: ['🎉', 'Fully paid'],
  cancelled: ['✖️', 'Cancelled'],
};

export function AgreementPage() {
  const { id } = useParams();
  const { customer, ready, onOrder } = useShop();
  const data = useCategories();
  const [agreement, setAgreement] = useState(null);
  const [error, setError] = useState('');
  const [mine, setMine] = useState({ idNumber: '', county: '', address: '', agree: false });
  const [pay, setPay] = useState({ amount: '', method: 'cash', ref: '', date: new Date().toLocaleDateString('en-CA') });
  const [busy, setBusy] = useState(false);
  useSeo({ title: agreement ? `Agreement ${agreement.agreementNo}` : 'Agreement', noindex: true });
  const load = () => api.get(`/agreements/${id}`).then((response) => setAgreement(response.data)).catch((innerError) => setError(errMsg(innerError)));
  useEffect(() => {
    if (!customer) return;
    load();
    setMine((previousMine) => ({ ...previousMine, county: previousMine.county || customer.county || '', address: previousMine.address || customer.address || '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, customer]);
  useEffect(() => onOrder?.((currentAgreement) => currentAgreement._id === id && currentAgreement.agreementNo && setAgreement(currentAgreement)), [onOrder, id]);

  if (ready && !customer) return <Navigate to={`/login?next=${encodeURIComponent(`/agreements/${id}`)}`} replace />;
  if (error) return <div className="mk mk-wrap mk-narrow"><p className="mk-error">{error}</p></div>;
  if (!agreement) return <div className="mk mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div>;
  const me = agreement.role;
  const waitingMe = (agreement.status === 'waiting_buyer' && me === 'buyer') || (agreement.status === 'waiting_seller' && me === 'seller');
  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      setAgreement((await fn()).data);
      if (okMsg) toast.success(okMsg);
    } catch (err) {
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };
  const Party = ({ p: value, label }) => (
    <div className="mk-agree-party">
      <small>{label}</small>
      <b>{value.name}</b>
      <span>📞 {prettyPhone(value.phone) || '–'}</span>
      <span>✉️ {value.email || '–'}</span>
      <span>🪪 ID / passport: {value.idNumber ? (me === 'admin' || String(value.customer) === String(customer._id) ? value.idNumber : maskId(value.idNumber)) : 'to be added'}</span>
      <span>📍 {[value.address, value.county].filter(Boolean).join(', ') || '–'}</span>
      <span className={value.acceptedAt ? 'mk-green' : 'os-muted'}>{value.acceptedAt ? `✔ Accepted electronically ${fmtTime(value.acceptedAt)}` : 'Not yet accepted'}</span>
    </div>
  );

  return (
    <div className="mk"><div className="mk-wrap mk-narrow mk-agree">
        <div className="mk-agree-tools no-print">
          <Link to={agreement.conversation ? `/market/messages/${agreement.conversation}` : '/orders'} className="mk-back">← Back</Link>
          <button className="os-btn os-btn-ghost" onClick={() => window.print()}>🖨️ Print / save as PDF</button>
        </div>

        <article className="mk-agree-doc">
          <header>
            <div>
              <small><SiteName /> · Lipa Pole Pole</small>
              <h1>Sale agreement</h1>
              <span>No. <b>{agreement.agreementNo}</b> · Date of agreement: <b>{fmtDate(agreement.agreementDate)}</b></span>
            </div>
            <span className={`mk-pill ${agreement.status === 'active' ? 'done' : agreement.status === 'cancelled' ? '' : 'wait'}`}>{STATUS[agreement.status][0]} {STATUS[agreement.status][1]}{agreement.overdue ? ' · overdue' : ''}</span>
          </header>

          <section className="mk-agree-parties">
            <Party p={agreement.seller} label="SELLER (VENDOR)" />
            <Party p={agreement.buyer} label="BUYER" />
          </section>

          <section>
            <h2>Item</h2>
            <p><b>{agreement.item.title}</b>{agreement.item.description ? ` — ${agreement.item.description}` : ''}</p>
          </section>

          <section>
            <h2>Payment terms</h2>
            <table className="mk-agree-table">
              <tbody>
                <tr><th>Total agreed price</th><td>{priceText(agreement.price)}</td></tr>
                <tr><th>Deposit</th><td>{priceText(agreement.deposit)}</td></tr>
                <tr><th>Paid so far (confirmed)</th><td>{priceText(agreement.paid)}</td></tr>
                <tr className="mk-agree-balance"><th>Balance to be paid</th><td>{priceText(agreement.balance)}</td></tr>
                <tr><th>Deadline for full payment</th><td>{fmtDate(agreement.deadline)}{agreement.overdue && <b className="mk-err-text"> · OVERDUE</b>}</td></tr>
                {agreement.schedule && <tr><th>Instalments</th><td>{agreement.schedule}</td></tr>}
                <tr><th>Item kept by</th><td>{agreement.possession === 'buyer_now' ? 'The buyer (took it at the start of the agreement)' : 'The seller, until the balance is fully paid'}</td></tr>
                {agreement.notes && <tr><th>Other terms</th><td>{agreement.notes}</td></tr>}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Payments</h2>
            {!agreement.payments.length ? <p className="os-muted">No payments yet.</p> : (
              <table className="mk-agree-table pays">
                <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Ref</th><th>Status</th></tr></thead>
                <tbody>
                  {agreement.payments.map((payment) => (
                    <tr key={payment._id}>
                      <td>{new Date(payment.date).toLocaleDateString('en-GB')}</td>
                      <td>{priceText(payment.amount)}</td>
                      <td>{METHOD[payment.method]}</td>
                      <td>{payment.ref || '–'}</td>
                      <td>
                        {payment.status === 'confirmed' ? '✔ confirmed' : 'awaiting seller'}
                        {payment.status === 'pending' && me === 'seller' && agreement.status === 'active' && (
                          <span className="no-print"> · <button className="os-linkbtn" disabled={busy} onClick={() => act(() => api.post(`/agreements/${agreement._id}/payments/${payment._id}/confirm`, {}), 'Payment confirmed')}>Confirm</button> / <button className="os-linkbtn" disabled={busy} onClick={() => act(() => api.post(`/agreements/${agreement._id}/payments/${payment._id}/confirm`, { reject: true }))}>Not received</button></span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2>Policy</h2>
            <ol className="mk-policy-list small">{POLICY.map((item) => <li key={item}><TextWithSiteName text={item} /></li>)}</ol>
            {agreement.cancelReason && agreement.status === 'cancelled' && <p className="mk-err-text">Cancelled by the {agreement.cancelledBy}: {agreement.cancelReason}</p>}
          </section>

          <footer>
            <div><small>Seller</small><b>{agreement.seller.name}</b><span>{agreement.seller.acceptedAt ? `Accepted ${fmtTime(agreement.seller.acceptedAt)}` : '________________'}</span></div>
            <div><small>Buyer</small><b>{agreement.buyer.name}</b><span>{agreement.buyer.acceptedAt ? `Accepted ${fmtTime(agreement.buyer.acceptedAt)}` : '________________'}</span></div>
          </footer>
        </article>

        {/* actions */}
        {waitingMe && (
          <form className="mk-box mk-actions no-print" onSubmit={(event) => { event.preventDefault(); act(() => api.post(`/agreements/${agreement._id}/accept`, mine), 'Agreement accepted. It’s now active.'); }}>
            <b>Review the agreement above, add your details and accept it</b>
            <PartyFields form={mine} setForm={setMine} data={data} />
            <label className="mk-check"><input type="checkbox" checked={mine.agree} onChange={(event) => setMine({ ...mine, agree: event.target.checked })} required /> I accept this agreement and the Lipa Pole Pole sale policy{me === 'seller' && agreement.deposit > 0 ? `, and confirm I received the deposit of ${priceText(agreement.deposit)}` : ''}.</label>
            <div className="os-row"><button className="os-btn os-btn-brand" disabled={busy}>✔ Accept agreement</button></div>
          </form>
        )}
        {agreement.status === 'active' && (
          <form className="mk-box mk-actions no-print" onSubmit={(event) => { event.preventDefault(); act(() => api.post(`/agreements/${agreement._id}/payments`, pay), me === 'seller' ? 'Payment recorded' : 'Payment reported. The seller will confirm it.').then(() => setPay((previousPay) => ({ ...previousPay, amount: '', ref: '' }))); }}>
            <b>{me === 'seller' ? 'Record money you received' : 'Report a payment you made'}</b>
            <div className="mk-form-grid">
              <label className="os-field"><span>Amount (KSh)</span><input inputMode="numeric" value={pay.amount} onChange={(event) => setPay({ ...pay, amount: event.target.value.replace(/\D/g, '') })} required placeholder={`max ${agreement.balance}`} /></label>
              <label className="os-field"><span>Date</span><input type="date" value={pay.date} onChange={(event) => setPay({ ...pay, date: event.target.value })} required /></label>
              <label className="os-field"><span>Method</span><select value={pay.method} onChange={(event) => setPay({ ...pay, method: event.target.value })}>{Object.entries(METHOD).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
              <label className="os-field"><span>M-Pesa code / receipt</span><input value={pay.ref} onChange={(event) => setPay({ ...pay, ref: event.target.value })} maxLength={40} /></label>
            </div>
            <div className="os-row"><button className="os-btn os-btn-brand" disabled={busy}>{me === 'seller' ? 'Record payment' : 'Report payment'}</button></div>
          </form>
        )}
        {!['completed', 'cancelled'].includes(agreement.status) && (
          <button className="os-linkbtn mk-report no-print" onClick={() => {
            const reason = window.prompt(agreement.status === 'active' ? 'Why are you cancelling this agreement? (the other person will see it)' : 'Reason (optional)', '');
            if (reason !== null) act(() => api.post(`/agreements/${agreement._id}/cancel`, { reason }), 'Agreement cancelled');
          }}>Cancel this agreement</button>
        )}
      </div></div>
  );
}

// ---------------------------------------------------------------- list (My orders)
export function AgreementRows({ list }) {
  if (!list?.length) return null;
  return (
    <div className="mk-order-list">
      {list.map((item) => (
        <Link key={item._id} to={`/agreements/${item._id}`} className="mk-order-row">
          <span className="mk-order-img"><AdImage ad={{ ...item.item, image: item.item.image }} /></span>
          <span className="mk-order-info">
            <b>{item.item.title}</b>
            <small>{item.agreementNo} · {item.role === 'seller' ? `buyer ${item.buyer.name}` : `seller ${item.seller.name}`} · due {new Date(item.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
            <span className="mk-progress" aria-label={`${Math.round((item.paid / item.price) * 100)}% paid`}><i style={{ width: `${Math.round((item.paid / item.price) * 100)}%` }} /></span>
            <small>{priceText(item.paid)} of {priceText(item.price)} paid</small>
          </span>
          <span className="mk-order-side"><span className="mk-pill">{STATUS[item.status][0]} {STATUS[item.status][1].replace('Waiting for the ', 'Awaiting ').replace(' to accept', '')}</span></span>
        </Link>
      ))}
    </div>
  );
}
