// Errands: book our riders or shopping agents directly, without buying from a seller on Kapu.
//   🛵 Send a parcel — a rider picks it up anywhere and delivers it (pay the rider on delivery)
//   🛒 Shop for me   — a shopping agent buys your list at any shop or market, checks it and brings it
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, timeAgo, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { AddressInput, AddressPin } from './Maps';
import { PayNumber } from './Checkout';
import { RateRider, RiderLive } from './Deliveries';
import PrivateFile from '../components/PrivateFile';
import './market.css';
import { KapuName } from '../components/BrandName';

const validPhone = (phone) => /^(?:\+?254|0)?[17]\d{8}$/.test(String(phone || '').replace(/[\s-]/g, ''));
const STATUS = {
  awaiting_payment: ['💳', 'Waiting for your M-Pesa payment'],
  open: ['📣', 'Finding someone near you'],
  assigned: ['🛵', 'On the way'],
  picked_up: ['📦', 'Collected, on the way to you'],
  at_hub: ['🏢', 'At our CBD hub'],
  at_point: ['📍', 'Ready to collect at your pickup point'],
  out_for_delivery: ['🛵', 'On the way to your door'],
  delivered: ['✅', 'Delivered: please confirm'],
  done: ['🎉', 'Done'],
  cancelled: ['✖', 'Cancelled'],
};
const TYPES = {
  parcel: { icon: '🛵', title: 'Ride with us', who: 'rider', about: 'Send a parcel anywhere in Nairobi by bike, 4-seater car or pickup, at a price you see upfront.' },
  shopping: { icon: '🛒', title: 'Shop for me', who: 'shopping agent', about: 'Write your shopping list or take a photo of it. A shopping agent near you buys it and brings it.' },
  shopride: { icon: '🛍️', title: 'Shop & ride (earlier booking)', who: 'agent', about: 'An earlier Shop & ride booking.', retired: true },
};
// Shop & ride: collected and inspected → our CBD hub → your area's pickup point (or your door) → done
const stepsFor = (task) => (task.kind === 'shopride' ? ['open', 'picked_up', 'at_hub', task.shopride?.mode === 'door' ? 'out_for_delivery' : 'at_point', 'done'] : ['open', 'assigned', 'picked_up', 'delivered', 'done']);
const confirmable = (task) => (task.kind === 'shopride' ? ['at_point', 'out_for_delivery', 'delivered'] : ['picked_up', 'delivered']).includes(task.status);

// Shop & ride: the booking payment (inspection), for the whole booking; "Pay again" when it didn't go through
function PayBooking({ task, busy, onPay }) {
  const [phone, setPhone] = useState('');
  const amount = task.dueNow || task.payment.amount;
  const failed = task.payment.status === 'failed';
  return (
    <div className={`mk-ride-goods ${failed ? 's-failed' : 's-pending'}`}>
      {failed
        ? <small className="bad">The payment didn’t go through{task.payment.failReason ? `: ${task.payment.failReason}` : ''}. Pay again below.</small>
        : <small>📲 Enter your M-Pesa PIN to pay {priceText(amount)}{task.group?.parts?.length > 1 ? ` for the inspection of all ${task.group.parts.length} sellers` : ' for the inspection'}. This page updates by itself.</small>}
      <div className="mk-ride-goods-pay">
        <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="M-Pesa number (optional)" />
        <button type="button" className={`os-btn ${failed ? 'os-btn-brand' : 'os-btn-ghost'}`} disabled={busy} onClick={() => onPay(phone.trim())}>📲 {failed ? `Pay ${priceText(amount)} again` : 'Didn’t get it? Send again'}</button>
      </div>
    </div>
  );
}

// 🛒 a priced list: the agent's price, and paying it with M-Pesa (the prompt was sent; "pay again" if it didn't arrive)
function PayList({ task, busy, onPay }) {
  const [phone, setPhone] = useState('');
  const quote = task.shopping.quote || {};
  const failed = task.payment.status === 'failed';
  return (
    <div className={`mk-ride-goods mk-list-quote ${failed ? 's-failed' : 's-pending'}`}>
      <b>🧾 {quote.by || 'Your agent'} priced your list</b>
      <div className="mk-sum-line"><span>Goods</span><b>{priceText(quote.amount)}</b></div>
      <div className="mk-sum-line fee"><span>Agent’s fee</span><b>{priceText(quote.service)}</b></div>
      <div className="mk-sum-line"><span><b>Pay now with M-Pesa</b></span><b>{priceText(task.payment.amount)}</b></div>
      <div className="mk-sum-line fee"><span>🛵 Delivery, paid on delivery (by distance)</span><b>{priceText(quote.delivery)}</b></div>
      {quote.note && <small>“{quote.note}”</small>}
      {failed ? <small className="bad">The payment didn’t go through{task.payment.failReason ? `: ${task.payment.failReason}` : ''}. Pay below.</small> : <small>📲 Enter your M-Pesa PIN on your phone. They buy your list once it’s paid. Anything not spent comes back to you.</small>}
      <div className="mk-ride-goods-pay">
        <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="M-Pesa number (optional)" />
        <button type="button" className={`os-btn ${failed ? 'os-btn-brand' : 'os-btn-ghost'}`} disabled={busy} onClick={() => onPay(phone.trim())}>📲 {failed ? `Pay ${priceText(task.payment.amount)}` : 'Didn’t get it? Send the prompt again'}</button>
      </div>
    </div>
  );
}

// Shop & ride: the goods, paid once our agent passes the inspection (we pay the seller)
function GoodsBox({ task, busy, onPay }) {
  const goods = task.shopride.goods;
  const [phone, setPhone] = useState('');
  const due = goods.amount + (goods.delivery || 0);
  const what = `${priceText(goods.amount)} for the goods${goods.delivery ? ` + ${priceText(goods.delivery)} delivery` : ''}`;
  return (
    <div className={`mk-ride-goods s-${goods.status}`}>
      <div className="mk-sum-line fee"><span>🛍️ Goods{goods.delivery ? ' + delivery' : ''}, paid after inspection</span><b>{priceText(due)}</b></div>
      {goods.status === 'waiting' && <small>You pay {what} only once our agent passes the inspection. We then pay {task.shopride.sellerName || 'the seller'}.</small>}
      {goods.status === 'pending' && <small>📲 Check your phone: enter your M-Pesa PIN to pay {what}.</small>}
      {goods.status === 'paid' && <small className="ok">✅ Paid{goods.receipt ? ` (M-Pesa ${goods.receipt})` : ''}. {goods.seller?.status === 'paid' ? `${task.shopride.sellerName || 'The seller'} has been paid.` : `We’re paying ${task.shopride.sellerName || 'the seller'}.`}</small>}
      {goods.status === 'cancelled' && <small>Not bought: you don’t pay for the goods.</small>}
      {(goods.status === 'failed' || goods.status === 'pending') && (
        <div className="mk-ride-goods-pay">
          {goods.status === 'failed' && <small className="bad">{goods.failReason || 'The payment didn’t go through.'}</small>}
          <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="M-Pesa number (optional)" />
          <button type="button" className="os-btn os-btn-brand" disabled={busy} onClick={() => onPay(phone.trim())}>📲 {goods.status === 'failed' ? `Pay ${priceText(due)} now` : 'Send the prompt again'}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- landing + my errands
export default function Errands() {
  const { customer, ready } = useShop();
  const [params] = useSearchParams();
  const type = params.get('type');
  const [list, setList] = useState(null);
  useSeo({ title: type ? TYPES[type]?.title || 'Errands' : 'Send a parcel or shop for me', description: 'Book a Kapu rider to deliver a parcel anywhere, or a shopping agent to buy and bring your shopping from any shop or market.' });
  useEffect(() => {
    if (customer && !type) api.get('/errands/mine').then((response) => setList(response.data)).catch(() => setList([]));
  }, [customer, type]);
  if (ready && !customer) return <Navigate to={`/login?next=${encodeURIComponent(`/errands${type ? `?type=${type}` : ''}`)}`} replace />;
  if (type === 'shopride' || type === 'parcel') return <Navigate to="/ride-with-us" replace />; // parcels are booked on Ride with us
  if (type === 'shopping' && params.get('detailed') !== '1') return <ShoppingListForm />;
  if (type && TYPES[type]) return <ErrandForm kind={type} />;
  return (
    <div className="mk">
      <div className="mk-wrap mk-narrow">
        <div className="mk-errand-hero">
          <h1>Our riders & shopping agents, at your service</h1>
          <p>No need to buy from a seller on <KapuName />: book our trained, ID-checked team for your own errands.</p>
        </div>
        <div className="mk-errand-types">
          {Object.entries(TYPES).filter(([, value]) => !value.retired).map(([key, value]) => (
            <Link key={key} to={key === 'parcel' ? '/ride-with-us' : `/errands?type=${key}`} className="mk-errand-type">
              <span className="mk-errand-icon" aria-hidden="true">{value.icon}</span>
              <span><b>{value.title}</b><small>{value.about}</small></span>
              <span className="mk-errand-go" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
        <h2 className="mk-subhead">My errands</h2>
        {!list && <div className="page-loading"><span className="page-spinner" /></div>}
        {list && !list.length && <p className="os-muted">Nothing yet. Your parcels and shopping errands will show here.</p>}
        <ul className="mk-errand-list">
          {list?.map((error) => (
            <li key={error._id}>
              <Link to={`/errands/${error._id}`}>
                <span aria-hidden="true">{TYPES[error.kind].icon}</span>
                <span><b>{error.kind === 'shopride' ? error.shopride?.what : error.kind === 'parcel' ? error.parcel?.what : error.shopping?.mode === 'list' ? `🛒 Shopping list${error.shopping.text ? `: ${error.shopping.text.split('\n')[0].slice(0, 40)}${error.shopping.text.length > 40 || error.shopping.text.includes('\n') ? '…' : ''}` : ' (photo)'}` : `${error.shopping?.list?.length} item${error.shopping?.list?.length === 1 ? '' : 's'}${error.shopping?.shopName ? ` from ${error.shopping.shopName}` : ''}`}</b><small>{error.no} · {timeAgo(error.createdAt)}</small></span>
                <span className={`mk-errand-status s-${error.status}`}>{STATUS[error.status][0]} {STATUS[error.status][1]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the booking form
function Place({ title, here, setHere, address, setAddress, name, setName, phone, setPhone, nameLabel, phoneLabel, phoneRequired = true }) {
  return (
    <section className="mk-box">
      <h2>{title}</h2>
      <label className="os-field"><span>Address and landmark *</span><AddressInput value={address} onChange={setAddress} onPlace={(place) => setHere({ lat: place.lat, lng: place.lng, at: Date.now(), source: 'search', placeId: place.placeId })} placeholder="Start typing: estate, street, building, landmark" /></label>
      <AddressPin here={here} onPin={setHere} address={address} onAddress={setAddress} onCounty={() => {}} fieldSearch title="📍 On the map" />
      {setName && (
        <div className="mk-errand-two">
          <label className="os-field"><span>{nameLabel}</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
          <label className="os-field"><span>{phoneLabel}{phoneRequired ? ' *' : ''}</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="07XX XXX XXX" /></label>
        </div>
      )}
    </section>
  );
}

function ErrandForm({ kind }) {
  const { customer } = useShop();
  const navigate = useNavigate();
  const type = TYPES[kind];
  const [from, setFrom] = useState(null);
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromPhone, setFromPhone] = useState('');
  const [to, setTo] = useState(null);
  const [toAddress, setToAddress] = useState(customer?.address || '');
  const [toName, setToName] = useState(customer?.name || '');
  const [toPhone, setToPhone] = useState(customer?.phone ? `0${String(customer.phone).slice(-9)}` : '');
  const [what, setWhat] = useState('');
  const [size, setSize] = useState('small');
  const [payer, setPayer] = useState('recipient');
  const [shopName, setShopName] = useState('');
  const [items, setItems] = useState([{ name: '', qty: '1', note: '' }]);
  const [budget, setBudget] = useState('');
  const [notes, setNotes] = useState('');
  const [phone, setPhone] = useState(customer?.phone ? `0${String(customer.phone).slice(-9)}` : '');
  const [query, setQuery] = useState(null);
  const [busy, setBusy] = useState(false);
  const budgetN = Math.round(Number(budget) || 0);

  // price it as soon as both pins are set (and the budget changes)
  const key = JSON.stringify([from && [from.lat, from.lng], to && [to.lat, to.lng], kind === 'shopping' ? budgetN : 0]);
  useEffect(() => {
    if (!from || !to) return setQuery(null);
    const tm = setTimeout(() => api.post('/errands/quote', { kind, pickup: from, dropoff: to, budget: budgetN }).then((response) => setQuery(response.data)).catch(() => setQuery(null)), 300);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setItem = (index, entryKey, value) => setItems((previousItems) => previousItems.map((previousItem, position) => (position === index ? { ...previousItem, [entryKey]: value } : previousItem)));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        kind, notes,
        pickup: { ...from, address: kind === 'shopping' ? fromAddress || shopName : fromAddress, name: fromName, phone: fromPhone },
        dropoff: { ...to, address: toAddress, name: toName, phone: toPhone },
        ...(kind === 'parcel' ? { parcel: { what, size, payer } } : { shopping: { list: items.filter((item) => item.name.trim()), budget: budgetN, shopName }, phone }),
      };
      const { data } = await api.post('/errands', body);
      toast.success(kind === 'parcel' ? 'Booked! We’re finding a rider near the pick-up point 🛵' : data.payment?.status === 'paid' ? 'Paid! We’re finding a shopping agent 🛒' : 'Check your phone and enter your M-Pesa PIN');
      navigate(`/errands/${data._id}`, { replace: true });
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <div className="mk">
      <form className="mk-wrap mk-narrow mk-errand-form" onSubmit={submit}>
        <Link to="/errands" className="mk-back">← Errands</Link>
        <h1>{type.icon} {type.title}</h1>
        <p className="os-muted">{type.about}</p>

        {kind === 'parcel' ? (
          <>
            <Place title="1. Pick up from" here={from} setHere={setFrom} address={fromAddress} setAddress={setFromAddress} name={fromName} setName={setFromName} phone={fromPhone} setPhone={setFromPhone} nameLabel="Contact name there" phoneLabel="Phone there" />
            <section className="mk-box">
              <h2>2. What are we carrying?</h2>
              <label className="os-field"><span>Item *</span><input value={what} onChange={(event) => setWhat(event.target.value)} maxLength={120} placeholder="e.g. a bag of clothes, documents, a 32” TV" /></label>
              <div className="mk-errand-chips" role="radiogroup" aria-label="Size">
                {[['small', '✉️ Small', 'fits in a bag'], ['medium', '📦 Medium', 'a box, up to ~10 kg'], ['large', '🛋️ Large', 'big or heavy']].map(([entryKey, value, detail]) => (
                  <button type="button" key={entryKey} role="radio" aria-checked={size === entryKey} className={size === entryKey ? 'on' : ''} onClick={() => setSize(entryKey)}><b>{value}</b><small>{detail}</small></button>
                ))}
              </div>
            </section>
            <Place title="3. Deliver to" here={to} setHere={setTo} address={toAddress} setAddress={setToAddress} name={toName} setName={setToName} phone={toPhone} setPhone={setToPhone} nameLabel="Recipient’s name" phoneLabel="Recipient’s phone" />
            <section className="mk-box">
              <h2>4. Who pays the rider?</h2>
              <div className="mk-errand-chips" role="radiogroup" aria-label="Who pays">
                {[['recipient', '📍 The recipient', 'on delivery'], ['sender', '🏠 The sender', 'at pick-up']].map(([entryKey, value, detail]) => (
                  <button type="button" key={entryKey} role="radio" aria-checked={payer === entryKey} className={payer === entryKey ? 'on' : ''} onClick={() => setPayer(entryKey)}><b>{value}</b><small>{detail}, cash or M-Pesa</small></button>
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="mk-box">
              <h2>1. Your shopping list</h2>
              {items.map((it, index) => (
                <div key={index} className="mk-errand-item">
                  <input value={it.name} onChange={(event) => setItem(index, 'name', event.target.value)} maxLength={80} placeholder={['e.g. Unga, 2 kg', 'e.g. Cooking oil, 1 litre', 'e.g. Sukuma wiki'][index % 3]} aria-label={`Item ${index + 1}`} />
                  <input value={it.qty} onChange={(event) => setItem(index, 'qty', event.target.value)} maxLength={20} aria-label="How many" className="qty" />
                  <input value={it.note} onChange={(event) => setItem(index, 'note', event.target.value)} maxLength={120} placeholder="Brand, size… (optional)" aria-label="Note" />
                  {items.length > 1 && <button type="button" className="os-icon-btn" onClick={() => setItems((previousItems) => previousItems.filter((_, position) => position !== index))} aria-label="Remove">✕</button>}
                </div>
              ))}
              {items.length < 30 && <button type="button" className="os-btn os-btn-ghost" onClick={() => setItems((previousItems) => [...previousItems, { name: '', qty: '1', note: '' }])}>+ Add another item</button>}
              <label className="os-field"><span>Budget: the most the agent may spend (KSh) *</span><input value={budget} onChange={(event) => setBudget(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="e.g. 2500" /></label>
              <small className="os-muted">You pay the budget now with M-Pesa so the agent never uses their own money. Whatever isn’t spent comes back to your M-Pesa.</small>
            </section>
            <section className="mk-box">
              <h2>2. Where should they shop?</h2>
              <label className="os-field"><span>Shop or market (optional)</span><input value={shopName} onChange={(event) => setShopName(event.target.value)} maxLength={100} placeholder="e.g. Naivas Imara, Wakulima Market, or ‘any shop nearby’" /></label>
              <label className="os-field"><span>Shop’s address or area</span><AddressInput value={fromAddress} onChange={setFromAddress} onPlace={(place) => { setFrom({ lat: place.lat, lng: place.lng, at: Date.now(), source: 'search', placeId: place.placeId }); if (!shopName && place.name) setShopName(place.name); }} placeholder="Start typing: Naivas Imara, Wakulima Market…" /></label>
              <AddressPin here={from} onPin={setFrom} address={fromAddress} onAddress={setFromAddress} onCounty={() => {}} fieldSearch title="📍 The shop on the map" />
            </section>
            <Place title="3. Deliver to" here={to} setHere={setTo} address={toAddress} setAddress={setToAddress} name={toName} setName={setToName} phone={toPhone} setPhone={setToPhone} nameLabel="Recipient’s name" phoneLabel="Recipient’s phone" />
          </>
        )}

        <section className="mk-box">
          <label className="os-field"><span>Anything else they should know? (optional)</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} placeholder="e.g. call when you’re at the gate; fragile" /></label>
        </section>

        <section className="mk-box mk-errand-sum" aria-live="polite">
          <h2>Price</h2>
          {!from || !to ? <p className="os-muted">Pin {!from ? (kind === 'shopping' ? 'the shop or market' : 'the pick-up point') : 'the delivery address'} on the map to see the price.</p>
            : !query ? <p className="os-muted">Pricing…</p>
            : !query.ok ? <p className="mk-err-text">{query.reason}</p>
            : (
              <>
                {kind === 'shopping' && <div className="mk-sum-line"><span>🛒 Shopping budget</span><b>{priceText(budgetN)}</b></div>}
                {kind === 'shopping' && <div className="mk-sum-line fee"><span>🧾 Shopping agent’s fee</span><b>{priceText(query.service)}</b></div>}
                <div className="mk-sum-line fee"><span>🛵 Delivery ({query.km} km) · paid on delivery</span><b>{priceText(query.delivery)}</b></div>
                {kind === 'shopping' ? (
                  <div className="mk-sum-split">
                    <div><span>📱 Pay now with M-Pesa <small>budget + agent’s fee</small></span><b>{priceText(query.payNow)}</b></div>
                    <div><span>💵 Pay on delivery <small>delivery fee, cash or M-Pesa</small></span><b>{priceText(query.delivery)}</b></div>
                  </div>
                ) : <p className="mk-hint">Nothing to pay now. {payer === 'sender' ? 'The sender pays the rider at pick-up.' : 'The recipient pays the rider on delivery.'}</p>}
              </>
            )}
          {kind === 'shopping' && <PayNumber phone={phone} setPhone={setPhone} label="Pay with M-Pesa number" />}
          <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy || !query?.ok || (kind === 'shopping' && (!validPhone(phone) || budgetN < 100))}>
            {busy ? 'Booking…' : kind === 'parcel' ? '🛵 Book a rider' : query?.ok ? `Pay ${priceText(query.payNow)} with M-Pesa` : 'Pay with M-Pesa'}
          </button>
          <p className="mk-hint mk-center">✔ Our riders and agents are ID-checked and trained. You’ll see who’s coming and can call them.</p>
        </section>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- 🛒 Shop for me, the quick way
// Write the list or take a photo of it, then your contacts and the delivery address. Nothing to pay now: a shopping
// agent near you checks the list and sends the price; you pay it with M-Pesa; they buy it and bring it.
function ShoppingListForm() {
  const { customer } = useShop();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]); // { file, url }
  const [to, setTo] = useState(null);
  const [address, setAddress] = useState(customer?.address || '');
  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(customer?.phone ? `0${String(customer.phone).slice(-9)}` : '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const camera = useRef(null);
  const gallery = useRef(null);
  useEffect(() => () => photos.forEach((photo) => URL.revokeObjectURL(photo.url)), [photos]);
  const addPhotos = (event) => {
    const chosen = [...(event.target.files || [])].filter((file) => /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 8 * 1024 * 1024);
    if (chosen.length < (event.target.files?.length || 0)) toast.error('Photos only (JPG, PNG or WEBP), up to 8 MB each');
    setPhotos((previous) => [...previous, ...chosen.slice(0, 4 - previous.length).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    event.target.value = '';
  };
  const hasList = text.trim().length >= 3 || photos.length > 0;
  const submit = async (event) => {
    event.preventDefault();
    if (!hasList) return toast.error('Write your shopping list, or take a photo of it');
    if (!to) return toast.error('Pin your delivery address on the map');
    if (!validPhone(phone)) return toast.error('Enter your phone number: the agent calls you about prices');
    const form = new FormData();
    Object.entries({ text, name, phone, address, notes, lat: to.lat, lng: to.lng }).forEach(([key, value]) => form.append(key, value ?? ''));
    photos.forEach((photo) => form.append('photos', photo.file));
    setBusy(true);
    try {
      const { data } = await api.post('/errands/list', form);
      toast.success('Sent! A shopping agent near you will price your list 🛒');
      navigate(`/errands/${data._id}`, { replace: true });
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };
  return (
    <div className="mk">
      <form className="mk-wrap mk-narrow mk-errand-form" onSubmit={submit}>
        <Link to="/errands" className="mk-back">← Errands</Link>
        <h1>🛒 Shop for me</h1>
        <p className="os-muted">Write your shopping list or take a photo of it. A shopping agent near you prices it, you pay with M-Pesa, and they buy it and bring it to your door.</p>
        <section className="mk-box">
          <h2>1. Your shopping list</h2>
          <label className="os-field"><span>Write it down</span><textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} placeholder={'e.g.\nUnga 2 kg\nSukuma wiki, 3 bunches\nCooking oil 1 litre (Fresh Fri)\nBread'} /></label>
          <div className="mk-list-or" aria-hidden="true"><span>or</span></div>
          <div className="mk-photoreq-shots">
            {photos.map((photo, index) => (
              <figure key={photo.url}><img src={photo.url} alt={`List photo ${index + 1}`} /><button type="button" onClick={() => setPhotos((previous) => previous.filter((item) => item !== photo))} aria-label={`Remove photo ${index + 1}`}>✕</button></figure>
            ))}
            {photos.length < 4 && (
              <div className="mk-photoreq-add">
                <button type="button" className="os-btn os-btn-dark" onClick={() => camera.current?.click()}>📷 Take a photo of the list</button>
                <button type="button" className="os-btn os-btn-ghost" onClick={() => gallery.current?.click()}>🖼️ From gallery</button>
              </div>
            )}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={addPhotos} />
            <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addPhotos} />
          </div>
          <small className="os-muted">A clear photo of a handwritten list works fine. Only you, your agent and our team can see it.</small>
        </section>
        <Place title="2. Your contacts and delivery address" here={to} setHere={setTo} address={address} setAddress={setAddress} name={name} setName={setName} phone={phone} setPhone={setPhone} nameLabel="Your name" phoneLabel="Your phone" />
        <section className="mk-box">
          <label className="os-field"><span>Anything else? (optional)</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} placeholder="e.g. call when you’re at the gate; a shop you prefer" /></label>
          <ol className="mk-list-steps">
            <li><b>Nothing to pay now.</b> A shopping agent near you checks your list and sends you the price (they may call you).</li>
            <li>You pay the goods + their fee with M-Pesa. Anything not spent comes back to you.</li>
            <li>They buy it and bring it. Delivery is priced by distance and paid on delivery.</li>
          </ol>
          <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy}>{busy ? 'Sending…' : '🛒 Send my list'}</button>
          <p className="mk-hint mk-center">Prefer to set a budget and a shop yourself? <Link to="/errands?type=shopping&amp;detailed=1">Use the detailed form</Link></p>
        </section>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- one errand, live
export function ErrandPage() {
  const { id } = useParams();
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const load = () => api.get(`/errands/${id}`).then((response) => setTask(response.data)).catch((err) => toast.error(errMsg(err)));
  useEffect(() => {
    load();
    // updates come live too (🔔); a light refresh keeps the page right on weak connections
    timer.current = setInterval(load, 8000);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (task && ['done', 'cancelled'].includes(task.status)) clearInterval(timer.current);
  }, [task]);
  const memo = useMemo(() => task && TYPES[task.kind], [task]);
  useSeo({ title: task ? `${memo.title} ${task.no}` : 'Errand', noindex: true });
  if (!task) return <div className="page-loading"><span className="page-spinner" /></div>;
  const act = async (path, body, msg) => {
    setBusy(true);
    try {
      setTask((await api.post(`/errands/${id}/${path}`, body || {})).data);
      if (msg) toast.success(msg);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const steps = stepsFor(task);
  const at = Math.max(steps.indexOf(task.status), task.kind === 'shopride' && task.status === 'assigned' ? 0 : task.kind === 'shopride' && task.status === 'delivered' ? 3 : -1);
  return (
    <div className="mk">
      <div className="mk-wrap mk-narrow">
        <Link to="/errands" className="mk-back">← My errands</Link>
        <h1>{memo.icon} {memo.title}</h1>
        <p className="os-muted">{task.no} · booked {timeAgo(task.createdAt)}</p>
        <div className={`mk-box mk-errand-now s-${task.status}`}>
          <b>{STATUS[task.status][0]} {task.status === 'picked_up' && task.kind === 'shopping' ? 'Bought, on the way to you' : task.status === 'picked_up' && task.kind === 'shopride' ? `Collected${task.shopride.inspect ? ' and inspected' : ''}, on the way to our CBD hub` : task.status === 'assigned' && task.kind === 'shopride' ? 'Our agent is on the way to the seller' : STATUS[task.status][1]}</b>
          {task.status === 'at_point' && task.shopride && <small className="mk-ride-ready">Collect it at <b>{task.shopride.point.name}</b>: {task.shopride.point.address}{task.shopride.point.hours ? ` (${task.shopride.point.hours})` : ''}. Show booking <b>{task.no}</b>. <a href={`https://www.google.com/maps/dir/?api=1&destination=${task.shopride.point.lat},${task.shopride.point.lng}`} target="_blank" rel="noopener noreferrer">🧭 Directions</a></small>}
          {task.status === 'awaiting_payment' && task.kind === 'shopride' && <PayBooking task={task} busy={busy} onPay={(phone) => act('pay', phone ? { phone } : {}, 'Check your phone and enter your M-Pesa PIN')} />}
          {task.status === 'awaiting_payment' && task.shopping?.mode === 'list' && <PayList task={task} busy={busy} onPay={(phone) => act('pay', phone ? { phone } : {}, 'Check your phone and enter your M-Pesa PIN')} />}
          {task.shopping?.mode === 'list' && task.status === 'assigned' && task.payment.status !== 'paid' && <small>🧾 {task.worker?.name || 'Your agent'} is checking your list and will send you the price. They may call you to agree on brands and sizes.</small>}
          {task.shopping?.mode === 'list' && task.status === 'open' && <small>📣 Finding a shopping agent near you. Nothing to pay until they send you the price.</small>}
          {task.status === 'awaiting_payment' && task.kind !== 'shopride' && task.shopping?.mode !== 'list' && <small>{task.payment.status === 'failed' ? `The payment didn’t go through: ${task.payment.failReason}. Cancel and book again.` : `Enter your M-Pesa PIN to pay ${priceText(task.payment.amount)}. This page updates by itself.`}</small>}
          {task.worker && !['done', 'cancelled'].includes(task.status) && (
            <RiderLive person={{ ...task.worker, vehicle: task.worker.role === 'rider' ? task.worker.vehicle : task.worker.vehicle || 'Shopping agent' }} live={task.worker.live} eta={task.status === 'delivered' ? null : task.worker.eta} kmLeft={task.status === 'delivered' ? null : task.worker.kmLeft} kmToYou={task.status === 'delivered' ? null : task.worker.kmToYou} stage={task.worker.stage} dest={task.dropoff?.lat != null ? { lat: task.dropoff.lat, lng: task.dropoff.lng } : null} task={task.taskId || undefined} />
          )}
          {task.status === 'done' && task.worker && task.taskId && <RateRider taskId={task.taskId} name={task.worker.name} rated={task.rated} />}
          {at >= 0 && <ol className="mk-errand-steps">{steps.map((step, index) => <li key={step} className={index <= at ? 'on' : ''}>{task.kind === 'shopride' && step === 'picked_up' ? (task.shopride?.inspect ? 'Collected and inspected' : 'Collected') : STATUS[step][1].replace(': please confirm', '')}</li>)}</ol>}
          {confirmable(task) && <button type="button" className="os-btn os-btn-brand" disabled={busy} onClick={() => act('received', {}, 'Thanks! Errand complete 🎉')}>✅ Yes, I received it</button>}
          {(['awaiting_payment', 'open'].includes(task.status) || (task.shopping?.mode === 'list' && task.status === 'assigned' && task.payment.status !== 'paid')) && <button type="button" className="os-btn os-btn-ghost" disabled={busy} onClick={() => window.confirm('Cancel this errand?') && act('cancel', { reason: 'Cancelled by the customer' }, 'Cancelled')}>Cancel errand</button>}
        </div>

        <section className="mk-box">
          {task.kind === 'shopride' ? (
            <>
              {task.shopride.items?.length > 1 && <ul className="mk-ride-itemlist">{task.shopride.items.map((item, index) => <li key={index}><span>{item.qty} × {item.name}</span>{item.price ? <b>{priceText(item.qty * item.price)}</b> : null}</li>)}</ul>}
              <p>🛍️ <b>{task.shopride.items?.length > 1 ? `${task.shopride.items.length} items` : task.shopride.what}</b> · about {task.shopride.weightKg} kg{task.shopride.inspect ? ' · inspected' : ''}{task.shopride.repack ? ' · repackaged if needed' : ''}</p>
              <p>🏪 From: {task.pickup.address}{task.pickup.name ? ` · ${task.pickup.name}` : ''}{task.shopride.fromArea ? ` (${task.shopride.fromArea})` : ''}</p>
              <p>{task.shopride.mode === 'door' ? <>🚪 To your door: {task.dropoff.address}</> : <>📍 Collect at: <b>{task.shopride.point.name}</b>, {task.shopride.point.address}</>}</p>
              {task.shopride.price.inspection > 0 && <div className="mk-sum-line fee"><span>🔍 Inspection</span><b>{priceText(task.shopride.price.inspection)}</b></div>}
              <div className="mk-sum-line fee"><span>🛵 Delivery {task.shopride.fromCbd ? 'from the CBD' : 'via our CBD hub'} to {task.shopride.point.area}{task.shopride.price.estimate ? ` (over 5 kg${task.shopride.urgency === 'express' ? ', express' : ''})` : ''}</span><b>{priceText(task.shopride.price.delivery)}</b></div>
              {task.shopride.price.door > 0 && <div className="mk-sum-line fee"><span>🚪 Door delivery from {task.shopride.point.area} ({task.shopride.price.doorKm} km)</span><b>{priceText(task.shopride.price.door)}</b></div>}
              {task.shopride.repack && <div className="mk-sum-line fee"><span>📦 Repackaging</span><b>{task.shopride.price.repack ? priceText(task.shopride.price.repack) : 'Free'}</b></div>}
              {task.payment.amount > 0 && <div className="mk-sum-line fee mk-ride-paid"><span>{task.payment.status === 'paid' ? 'Paid when booking' : 'To pay now'} (inspection{task.shopride.price.repack ? ' + repacking' : ''})</span><b>{priceText(task.payment.amount)}</b></div>}
              {task.shopride.inspection?.at && <p className={`mk-split-note ${task.shopride.inspection.passed ? 'ok' : 'bad'}`}>{task.shopride.inspection.passed ? '✅ Inspection passed' : '❌ Inspection failed'}{task.shopride.inspection.note ? `: ${task.shopride.inspection.note}` : ''}</p>}
              {task.shopride.goods?.amount > 0 && <GoodsBox task={task} busy={busy} onPay={(phone) => act('pay-goods', phone ? { phone } : {}, 'Check your phone: the M-Pesa prompt for the goods')} />}
              {task.shopride.onDelivery > 0 && <p className="mk-hint">🚪 {task.shopride.deliveryCollected ? `${priceText(task.shopride.onDelivery)} delivery fee paid on arrival` : `Pay ${priceText(task.shopride.onDelivery)} delivery when it reaches your door`}</p>}
              {task.group?.parts?.length > 1 && (
                <div className="mk-ride-group"><b>Part of one booking from {task.group.parts.length} sellers</b>
                  <ul>{task.group.parts.map((part) => <li key={part._id}>{String(part._id) === String(task._id) ? <b>{part.what}</b> : <Link to={`/errands/${part._id}`}>{part.what}</Link>}<small> · {part.sellerName || 'seller'} · {STATUS[part.status]?.[1] || part.status}{part.goods ? ` · goods ${priceText(part.goods)}${part.goodsStatus === 'paid' ? ' paid' : ''}` : ''}</small></li>)}</ul>
                </div>
              )}
            </>
          ) : task.kind === 'parcel' ? (
            <>
              <p>📦 <b>{task.parcel.what}</b> ({task.parcel.size}){task.parcel.vehicle ? ` · by ${{ motorbike: '🏍️ bike', car: '🚗 4-seater car', van: '🛻 pickup' }[task.parcel.vehicle] || task.parcel.vehicle}` : ''}</p>
              <p>🏠 From: {task.pickup.address}{task.pickup.name ? ` · ${task.pickup.name}` : ''}</p>
            </>
          ) : (
            <>
              <p>🛒 <b>Shopping list</b>{task.shopping.shopName ? ` from ${task.shopping.shopName}` : ''}</p>
              {task.shopping.mode === 'list' && task.shopping.text && <p className="mk-errand-listtext">{task.shopping.text}</p>}
              {task.shopping.mode === 'list' && task.shopping.photos?.length > 0 && <div className="mk-errand-listphotos">{task.shopping.photos.map((path, index) => <PrivateFile key={path} client={api} path={path} alt={`Shopping list, photo ${index + 1}`} height={110} />)}</div>}
              <ul className="mk-errand-shoplist">{task.shopping.list.map((item, index) => <li key={index}>{item.qty} × {item.name}{item.note ? <small> ({item.note})</small> : ''}</li>)}</ul>
              <p>{task.shopping.mode === 'list' ? (task.shopping.quote ? 'Price of the goods' : 'Price') : 'Budget'} <b>{task.shopping.mode === 'list' && !task.shopping.quote ? 'coming from your agent' : priceText(task.shopping.budget)}</b>{task.shopping.spent != null ? <> · spent <b>{priceText(task.shopping.spent)}</b>{task.shopping.receipt ? ` (receipt ${task.shopping.receipt})` : ''}</> : ''}</p>
            </>
          )}
          {task.kind !== 'shopride' && <p>📍 To: {task.dropoff.address} · {task.dropoff.name}</p>}
          {task.kind !== 'shopride' && task.fee.delivery > 0 && <div className="mk-sum-line fee"><span>🛵 Delivery{task.km > 0 ? ` (${task.km} km)` : ''} · paid on delivery</span><b>{priceText(task.fee.delivery)}</b></div>}
          {task.kind === 'shopping' && task.payment.amount > 0 && <div className="mk-sum-line fee"><span>{task.payment.status === 'paid' ? 'Paid' : 'To pay'} with M-Pesa ({task.shopping?.mode === 'list' ? 'goods' : 'budget'} + agent’s fee)</span><b>{priceText(task.payment.amount)}</b></div>}
          {task.refund && <p className="mk-hint">💸 {priceText(task.refund.amount)} {task.refund.status === 'refunded' ? `refunded to your M-Pesa${task.refund.ref ? ` (${task.refund.ref})` : ''}` : 'is being refunded to your M-Pesa'}</p>}
        </section>

        <section className="mk-box">
          <h2>Updates</h2>
          <ul className="mk-errand-history">{[...task.history].reverse().map((item, index) => <li key={index}><small>{new Date(item.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>{item.note || item.status}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
