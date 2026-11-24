// 📸 "Can't find it? Send a photo": a buyer photographs an item a seller has but hasn't posted (so it can't go in the
// cart) and sends it to the seller through Kapu. The seller answers on /market/requests: "it's this ad", "post it now"
// (an ad made in one step, with the buyer's photo) or "I don't have it". The buyer then opens the ad and adds it to
// the cart as usual. The photos are private: only the buyer, that seller and our team can see them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { Sheet } from './Trust';
import PrivateFile from '../components/PrivateFile';
import './market.css';

const priceText = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
const MAX = 3;
const when = (date) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// the box on a seller's page
export function PhotoRequestBox({ seller }) {
  const { customer } = useShop();
  const [open, setOpen] = useState(false);
  return (
    <section className="mk-photoreq-box">
      <div>
        <b>📸 Can’t find what you want here?</b>
        <p>Take a photo of the item (on their shelf, or one like it) and send it to {seller.name}. They’ll post it so you can add it to your cart.</p>
      </div>
      {customer
        ? <button type="button" className="os-btn os-btn-brand" onClick={() => setOpen(true)}>📸 Send a photo</button>
        : <Link to={`/login?next=${encodeURIComponent(window.location.pathname)}`} className="os-btn os-btn-brand">Log in to send a photo</Link>}
      {open && <PhotoRequestSheet seller={seller} onClose={() => setOpen(false)} />}
    </section>
  );
}

function PhotoRequestSheet({ seller, onClose }) {
  const [photos, setPhotos] = useState([]); // { file, url }
  const [form, setForm] = useState({ what: '', note: '', qty: '1', budget: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const camera = useRef(null);
  const gallery = useRef(null);
  useEffect(() => () => photos.forEach((photo) => URL.revokeObjectURL(photo.url)), [photos]);
  const add = (event) => {
    const chosen = [...(event.target.files || [])].filter((file) => /^image\/(jpeg|png|webp)$/.test(file.type));
    if (chosen.length < (event.target.files?.length || 0)) toast.error('Only JPG, PNG or WEBP photos');
    const big = chosen.find((file) => file.size > 8 * 1024 * 1024);
    if (big) toast.error('A photo is too large (max 8 MB)');
    const room = MAX - photos.length;
    setPhotos((previous) => [...previous, ...chosen.filter((file) => file.size <= 8 * 1024 * 1024).slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    event.target.value = '';
  };
  const removeAt = (index) => setPhotos((previous) => previous.filter((photo, i) => i !== index));
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!photos.length) return toast.error('Add a photo of the item');
    const data = new FormData();
    data.append('sellerId', seller._id);
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    photos.forEach((photo) => data.append('photos', photo.file));
    setBusy(true);
    try {
      const response = await api.post('/market/photo-requests', data);
      setSent(response.data);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={`📸 Send ${seller.name} a photo`} onClose={onClose}>
      <div className="mk-sheet-body">
        {sent ? (
          <div className="mk-photoreq-sent">
            <div className="mk-pay-icon">✅</div>
            <h3>Sent to {seller.name}</h3>
            <p>Request <b>{sent.no}</b>. We’ll tell you as soon as they answer, usually with an ad you can add to your cart.</p>
            <div className="mk-card-actions"><Link to="/market/requests" className="os-btn os-btn-brand">See my requests</Link><button type="button" className="os-btn os-btn-ghost" onClick={onClose}>Close</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="mk-photoreq-form">
            <div className="mk-photoreq-shots">
              {photos.map((photo, index) => (
                <figure key={photo.url}><img src={photo.url} alt={`Photo ${index + 1}`} /><button type="button" onClick={() => removeAt(index)} aria-label={`Remove photo ${index + 1}`}>✕</button></figure>
              ))}
              {photos.length < MAX && (
                <div className="mk-photoreq-add">
                  <button type="button" className="os-btn os-btn-dark" onClick={() => camera.current?.click()}>📷 Take a photo</button>
                  <button type="button" className="os-btn os-btn-ghost" onClick={() => gallery.current?.click()}>🖼️ From gallery</button>
                  <small>{photos.length}/{MAX} photos</small>
                </div>
              )}
              <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={add} />
              <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={add} />
            </div>
            <label>What is it?<input value={form.what} onChange={set('what')} required minLength={3} maxLength={120} placeholder="e.g. Black school shoes, size 38" /></label>
            <div className="mk-photoreq-row">
              <label>How many?<input type="number" min={1} max={999} value={form.qty} onChange={set('qty')} required /></label>
              <label>Your budget (optional)<input type="number" min={1} value={form.budget} onChange={set('budget')} placeholder="KSh" /></label>
            </div>
            <label>Anything else? (optional)<textarea value={form.note} onChange={set('note')} maxLength={500} rows={2} placeholder="Colour, size, brand, where you saw it in the shop…" /></label>
            <p className="mk-hint">🔒 Only {seller.name} and the <KapuName /> team see your photos.</p>
            <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy}>{busy ? 'Sending…' : `Send to ${seller.name}`}</button>
          </form>
        )}
      </div>
    </Sheet>
  );
}

const STATUS = { open: ['wait', '⏳ Waiting for the seller'], answered: ['ok', '✅ The seller has it'], declined: ['bad', '❌ Not available'], cancelled: ['bad', 'Withdrawn'] };

// /market/requests: requests I sent (buyer) and received (seller)
export default function PhotoRequestsPage() {
  useSeo({ title: 'Photo requests', noindex: true });
  const { customer, ready } = useShop();
  const [params, setParams] = useSearchParams();
  const box = params.get('box') === 'received' ? 'received' : 'sent';
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/market/photo-requests', { params: { box } }).then((response) => setData(response.data)).catch((err) => toast.error(errMsg(err))), [box]);
  useEffect(() => {
    if (customer) load();
  }, [customer, load]);
  if (ready && !customer) return <div className="mk"><div className="mk-wrap mk-narrow"><p>Please <Link to="/login?next=/market/requests">log in</Link> to see your photo requests.</p></div></div>;
  return (
    <div className="mk"><div className="mk-wrap mk-narrow mk-photoreqs">
      <h1>📸 Photo requests</h1>
      <p className="os-muted">Items buyers couldn’t find in a seller’s ads, sent as a photo.</p>
      <div className="mk-tabs" role="tablist">
        {[['sent', 'I sent'], ['received', 'Sent to my shop']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={box === key} className={box === key ? 'on' : ''} onClick={() => { setData(null); setParams(key === 'sent' ? {} : { box: key }, { replace: true }); }}>
            {label}{data?.waiting?.[key] ? <span className="mk-tab-count">{data.waiting[key]}</span> : null}
          </button>
        ))}
      </div>
      {!data && <div className="page-loading"><span className="page-spinner" /></div>}
      {data && !data.requests.length && (
        <div className="mk-empty"><p>{box === 'sent' ? 'No requests yet. On any seller’s page, tap “📸 Send a photo” for an item you can’t find in their ads.' : 'No requests yet. When a buyer sends your shop a photo of something they want, it shows up here.'}</p></div>
      )}
      {data?.requests.map((request) => <RequestCard key={request._id} request={request} seller={box === 'received'} onChange={load} />)}
    </div></div>
  );
}

function RequestCard({ request, seller, onChange }) {
  const [tone, label] = STATUS[request.status] || ['wait', request.status];
  const cancel = async () => {
    if (!window.confirm('Withdraw this request?')) return;
    try {
      await api.post(`/market/photo-requests/${request._id}/cancel`);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <article className="mk-box mk-photoreq-card">
      <div className="mk-photoreq-photos">{request.photos.map((path, index) => <PrivateFile key={path} client={api} path={path} alt={`${request.what}, photo ${index + 1}`} height={96} />)}</div>
      <div className="mk-photoreq-info">
        <div className="mk-photoreq-top"><b>{request.what}</b><span className={`mk-pill ${tone}`}>{label}</span></div>
        <small className="os-muted">{request.no} · {seller ? `from ${request.buyer.name}` : `to ${request.seller.name}`} · {when(request.createdAt)}</small>
        <p>Wants <b>{request.qty}</b>{request.budget ? <> · budget up to <b>{priceText(request.budget)}</b></> : null}</p>
        {request.note && <p className="mk-photoreq-note">“{request.note}”</p>}
        {request.status === 'answered' && request.answer && (
          <div className="mk-photoreq-answer ok">
            <span>{request.answer.created ? 'Posted for you' : 'In the shop'}: <b>{request.answer.listingTitle}</b> · {priceText(request.answer.price)}</span>
            {request.answer.note && <small>“{request.answer.note}”</small>}
            <Link to={`/market/item/${request.answer.listingSlug}`} className="os-btn os-btn-brand">{seller ? 'View the ad' : '🛒 View & add to cart'}</Link>
          </div>
        )}
        {request.status === 'declined' && <p className="mk-photoreq-answer bad">{request.answer?.note ? `“${request.answer.note}”` : 'The seller doesn’t have it.'}{!seller && ' Try another seller in the same market.'}</p>}
        {!seller && request.status === 'open' && <button type="button" className="os-linkbtn" onClick={cancel}>Withdraw request</button>}
        {seller && request.status === 'open' && <AnswerForm request={request} onDone={onChange} />}
      </div>
    </article>
  );
}

// the seller's answer: post it now · it's one of my ads · I don't have it
function AnswerForm({ request, onDone }) {
  const [mode, setMode] = useState('create');
  const [form, setForm] = useState({ title: request.what.length >= 5 ? request.what : '', price: request.budget || '', stock: String(request.qty), usePhoto: true, note: '', listingId: '' });
  const [ads, setAds] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (mode === 'listing' && !ads) api.get('/market/mine').then((response) => setAds(response.data.filter((ad) => ad.status === 'active'))).catch(() => setAds([]));
  }, [mode, ads]);
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = mode === 'create'
        ? { action: 'create', title: form.title, price: Number(form.price), stock: Number(form.stock), usePhoto: form.usePhoto, note: form.note }
        : mode === 'listing' ? { action: 'listing', listingId: form.listingId, note: form.note } : { action: 'decline', note: form.note };
      await api.post(`/market/photo-requests/${request._id}/answer`, body);
      toast.success(mode === 'decline' ? 'The buyer has been told' : 'Sent! The buyer can now add it to their cart');
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-photoreq-reply" onSubmit={submit}>
      <div className="mk-chips" role="radiogroup" aria-label="Your answer">
        {[['create', '＋ I have it: post it now'], ['listing', '📦 It’s one of my ads'], ['decline', 'I don’t have it']].map(([key, text]) => (
          <button key={key} type="button" role="radio" aria-checked={mode === key} className={mode === key ? 'on' : ''} onClick={() => setMode(key)}>{text}</button>
        ))}
      </div>
      {mode === 'create' && (
        <>
          <label>Ad title<input value={form.title} onChange={set('title')} required minLength={5} maxLength={90} /></label>
          <div className="mk-photoreq-row">
            <label>Price (KSh)<input type="number" min={1} value={form.price} onChange={set('price')} required /></label>
            <label>In stock<input type="number" min={1} value={form.stock} onChange={set('stock')} required /></label>
          </div>
          <label className="mk-check"><input type="checkbox" checked={form.usePhoto} onChange={set('usePhoto')} /> Use the buyer’s photo{request.photos.length > 1 ? 's' : ''} in the ad</label>
          <small className="os-muted">Posted under “Other”, ready to buy online. You can edit it later in My ads.</small>
        </>
      )}
      {mode === 'listing' && (
        <label>Which ad?
          <select value={form.listingId} onChange={set('listingId')} required>
            <option value="">{ads ? 'Choose one of your live ads…' : 'Loading your ads…'}</option>
            {ads?.map((ad) => <option key={ad._id} value={ad._id}>{ad.title} · {priceText(ad.price)}</option>)}
          </select>
        </label>
      )}
      <label>Message to the buyer (optional)<input value={form.note} onChange={set('note')} maxLength={300} placeholder={mode === 'decline' ? 'e.g. Out of stock, try next week' : 'e.g. Yes, we have it in black and brown'} /></label>
      <button className={`os-btn ${mode === 'decline' ? 'os-btn-dark' : 'os-btn-brand'}`} disabled={busy}>{busy ? 'Sending…' : mode === 'decline' ? 'Tell the buyer' : 'Send to the buyer'}</button>
    </form>
  );
}
