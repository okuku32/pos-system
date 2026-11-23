import { useEffect, useState } from 'react';
import PayMethodFields from './PayMethodFields';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';
import SellerTypesPicker from './SellerTypesPicker';
import SellerTrade from './SellerTrade';
import { TRADE_KINDS, tradeOf, dropKind, tradeMissing, tradePayload } from './tradeRules';
import { Stars, Verified } from './Trust';
import { ShopLocationEditor, AddressInput } from './Maps';
import './market.css';

// My account: profile (also shown to buyers on my seller page) and shortcuts to everything I use
export default function Account() {
  const { customer, ready, setCustomer, logout, chatUnread, counts, setAccountType } = useShop();
  const navigate = useNavigate();
  const data = useCategories();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [verifyNote, setVerifyNote] = useState('');
  useSeo({ title: 'My account', noindex: true });

  useEffect(() => {
    if (customer) setForm({ name: customer.name, phone: prettyPhone(customer.phone || ''), county: customer.county || '', address: customer.address || '', about: customer.about || '' });
  }, [customer]);

  if (ready && !customer) return <Navigate to="/login?next=%2Faccount" replace />;
  if (!form) return <div className="mk mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div>;
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.put('/customers/me', form);
      setCustomer(response.data);
      toast.success('Saved');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const requestVerify = async () => {
    try {
      await api.post('/customers/me/verify', { note: verifyNote });
      setCustomer({ ...customer, verifyRequest: 'pending' });
      toast.success('Request sent. Our team will call you to confirm your details.');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const sellerFirst = customer.accountType === 'seller';
  const tiles0 = [
    ['/orders', '📦', 'My orders', 'Track what you bought'],
    ['/sales', '🧾', 'Orders to fulfil', counts.toHandle ? `${counts.toHandle} waiting for you` : 'Orders from your buyers', counts.toHandle],
    ['/market/my', '📢', 'My ads', 'Edit, mark sold, delete'],
    ['/market/messages', '💬', 'Messages', chatUnread ? `${chatUnread} unread` : 'Chats with buyers & sellers', chatUnread],
    [`/market/seller/${customer._id}`, '🪪', 'My seller page', 'What buyers see'],
    ['/market/sell', '➕', 'Post an ad', 'Free, in 2 minutes'],
  ];
  const sellerKeys = ['/sales', '/market/my', '/market/sell'];
  const tiles = sellerFirst ? [...tiles0.filter((item) => sellerKeys.includes(item[0])), ...tiles0.filter((item) => !sellerKeys.includes(item[0]))] : tiles0;

  return (
    <div className="mk"><div className="mk-wrap mk-narrow">
        <div className="mk-account-head">
          <span className="mk-avatar big">{customer.name.slice(0, 1)}</span>
          <div>
            <h1>{customer.name} {customer.verified && <Verified />}</h1>
            <p className="os-muted">{customer.email} · member since {new Date(customer.createdAt || Date.now()).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
          </div>
        </div>

        <div className="os-role os-role-inline" role="radiogroup" aria-label="I mainly want to">
          {[['buyer', '🛍️', 'I mainly buy'], ['seller', '🏪', 'I mainly sell']].map(([key, icon, label]) => (
            <button key={key} type="button" role="radio" aria-checked={customer.accountType === key} className={customer.accountType === key ? 'on' : ''} onClick={() => setAccountType(key).then(() => toast.success(key === 'seller' ? 'Seller tools now come first' : 'Shopping now comes first'))}>
              <span>{icon}</span><b>{label}</b>
            </button>
          ))}
        </div>

        {customer.rating?.count > 0 && <p className="mk-account-rating"><Stars value={customer.rating.avg} count={customer.rating.count} /> · {customer.completedSales} completed sale{customer.completedSales === 1 ? '' : 's'}</p>}

        {!customer.verified && (
          <section className={`mk-box mk-verify ${customer.verifyRequest}`}>
            <h2>✔ Get verified</h2>
            {customer.verifyRequest === 'pending' ? (
              <p>⏳ Your request is with our team. We’ll call you on {prettyPhone(customer.phone) || 'your phone'} to confirm your details, then the ✔ Verified badge appears on all your ads.</p>
            ) : (
              <>
                <p>Verified sellers get a ✔ badge on every ad. Buyers trust them more, so they sell faster. Our team will call you and check your ID.</p>
                {customer.verifyRequest === 'rejected' && <p className="mk-err-text">Last request: {customer.verifyNote || 'not approved'}. You can try again.</p>}
                <div className="mk-card-actions">
                  <input value={verifyNote} onChange={(event) => setVerifyNote(event.target.value)} maxLength={300} placeholder="What do you sell? Shop location? (optional)" />
                  <button className="os-btn os-btn-brand" onClick={requestVerify}>Request verification</button>
                </div>
              </>
            )}
          </section>
        )}

        <div className="mk-tiles">
          {tiles.map(([to, icon, detail, extra, badge]) => (
            <Link key={to} to={to} className="mk-tile">
              <span>{icon}</span>
              <b>{detail}{badge > 0 && <i className="mk-badge">{badge}</i>}</b>
              <small>{extra}</small>
            </Link>
          ))}
        </div>

        <SellerProfileEditor key={`${customer?._id || ''}:${JSON.stringify([customer?.sellerTypes, customer?.sellerCategories, customer?.trade])}`} /> {/* fresh once the account (or a save) arrives */}
        <ShopLocationEditor />
        <PayDetailsEditor />
        <MpesaConnect />

        <form className="mk-box mk-mt" onSubmit={save}>
          <h2>Profile</h2>
          <div className="mk-form-grid">
            <label className="os-field"><span>Name</span><input value={form.name} onChange={set('name')} required minLength={2} maxLength={60} /></label>
            <label className="os-field"><span>Phone</span><input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="07XX XXX XXX" /></label>
            <label className="os-field">
              <span>County</span>
              <select value={form.county} onChange={set('county')}>
                <option value="">Choose…</option>
                {data?.counties.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="os-field"><span>Delivery address</span><AddressInput value={form.address} onChange={(text) => setForm((previous) => ({ ...previous, address: text }))} onPlace={(place) => setForm((previous) => ({ ...previous, address: place.text, county: place.county || previous.county }))} maxLength={200} placeholder="Start typing: estate, street, building" /></label>
          </div>
          <label className="os-field mk-mt">
            <span>About you / your shop <em>(shown on your seller page)</em></span>
            <textarea rows={3} value={form.about} onChange={set('about')} maxLength={300} placeholder="e.g. Genuine phone accessories in Nairobi CBD. Delivery countrywide." />
          </label>
          <div className="mk-sell-submit"><button className="os-btn os-btn-brand" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
        </form>

        <div className="mk-account-foot">
          <Link to="/help" className="os-btn os-btn-ghost">Help &amp; safety</Link>
          <Link to="/forgot-password" className="os-btn os-btn-ghost">Change password</Link>
          <button className="os-btn os-btn-ghost mk-danger" onClick={() => { logout(); navigate('/'); }}>Log out</button>
        </div>
      </div></div>
  );
}

// What kind of seller I am and what I sell (asked at sign-up; buyers' "near me" pages and search use it)
const SELLER_KINDS = [['shop', '🏪', 'Retailer / shop'], ['wholesaler', '🏭', 'Wholesaler'], ['importer', '🌍', 'Importer'], ['mama-mboga', '🥬', 'Mama mboga'], ['samaki', '🐟', 'Samaki dealer'], ['market-stall', '🧺', 'Market stall'], ['grocery', '🌾', 'Cereals & groceries'], ['boutique', '👗', 'Boutique'], ['electronics', '📱', 'Electronics'], ['spares', '🔧', 'Motor & spares'], ['baby-shop', '🧸', 'Baby shop'], ['chemist', '💊', 'Chemist']];
function SellerProfileEditor() {
  const { customer, setCustomer } = useShop();
  const navigate = useNavigate();
  const data = useCategories();
  const [types, setTypes] = useState(customer?.sellerTypes || []);
  const [trade, setTrade] = useState(() => tradeOf(customer?.trade));
  const [tradeOpen, setTradeOpen] = useState(null);
  const [what, setWhat] = useState({ categories: customer?.sellerCategories || [], items: customer?.sellerItems || [] });
  const cats = what.categories;
  const [busy, setBusy] = useState(false);
  if (!customer || customer.accountType !== 'seller') return null;
  const flip = (list, set, key, max) => set(list.includes(key) ? list.filter((item) => item !== key) : [...list, key].slice(-max));
  const save = async () => {
    if (!types.length || !cats.length) return toast.error('Choose at least one kind of seller and one category');
    if (tradeMissing(types, trade)) { setTradeOpen(types.includes('wholesaler') && !trade.wholesale.length ? 'wholesaler' : 'importer'); return toast.error(tradeMissing(types, trade)); }
    setBusy(true);
    try {
      const response = await api.put('/customers/me', { sellerTypes: types, sellerCategories: cats, sellerItems: what.items, trade: tradePayload(types, trade) });
      setCustomer(response.data);
      toast.success('Saved. Here’s your seller hub 🏪');
      navigate('/seller'); // all saved: straight to the seller dashboard
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  const missing = !(customer.sellerTypes || []).length || !(customer.sellerCategories || []).length;
  return (
    <section className={`mk-box mk-mt mk-seller-profile ${missing ? 'missing' : ''}`} id="seller-profile" aria-label="What you sell">
      <h2>🏷️ What kind of seller you are</h2>
      {missing && <p className="mk-split-note bad">Tell buyers what you sell: it puts you on the right “near me” pages (wholesalers, importers, mama mbogas…).</p>}
      <div className="os-seller-types"><div>
        {SELLER_KINDS.map(([key, icon, name]) => <button type="button" key={key} className={types.includes(key) ? 'on' : ''} aria-pressed={types.includes(key)} onClick={() => { const on = types.includes(key); flip(types, setTypes, key, 5); if (on) setTrade(dropKind(trade, key)); else if (TRADE_KINDS.includes(key)) setTradeOpen(key); }}><span>{icon}</span> {name}</button>)}
      </div></div>
      <SellerTrade types={types} trade={trade} onTrade={setTrade} what={what} onWhat={setWhat} open={tradeOpen} setOpen={setTradeOpen} onRemoveKind={(kind) => { setTypes(types.filter((item) => item !== kind)); setTrade(dropKind(trade, kind)); }} categories={data?.categories || []} countries={data?.importCountries || []} />
      <h3 className="mk-mt">What you sell</h3>
      <SellerTypesPicker categories={data?.categories || []} value={what} onChange={setWhat} />
      <div className="mk-sell-submit"><button type="button" className="os-btn os-btn-brand" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
    </section>
  );
}

// M-Pesa prompts straight to me: a buyer paying several sellers at once gets a prompt that pays my Till / Paybill
// directly. Needs my own Daraja app (developer.safaricom.co.ke → Go Live). The keys are checked with Safaricom,
// stored encrypted on the server and never shown again.
function MpesaConnect() {
  const { customer, setCustomer } = useShop();
  const pay = customer?.payDetails;
  const link = customer?.payConnect;
  const [open, setOpen] = useState(false);
  const [field, setField] = useState({ shortcode: '', consumerKey: '', consumerSecret: '', passkey: '', env: 'production', password: '' });
  const [busy, setBusy] = useState(false);
  if (!customer || (customer.accountType !== 'seller' && !pay)) return null;
  const set = (key) => (event) => setField({ ...field, [key]: event.target.value });
  const promptable = pay?.method === 'till' || pay?.method === 'paybill';
  const connect = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.put('/customers/me/mpesa-connect', { ...field, shortcode: pay.method === 'paybill' ? pay.paybill : field.shortcode });
      setCustomer({ ...customer, payConnect: response.data.payConnect });
      setField({ shortcode: '', consumerKey: '', consumerSecret: '', passkey: '', env: 'production', password: '' });
      setOpen(false);
      toast.success('Connected: buyers paying several sellers get an M-Pesa prompt that pays you directly');
    } catch (err) {
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect M-Pesa prompts? Buyers will pay you from their M-Pesa menu and you confirm each code.')) return;
    try {
      const response = await api.delete('/customers/me/mpesa-connect');
      setCustomer({ ...customer, payConnect: response.data.payConnect });
      toast.success('Disconnected');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <section className="mk-box mk-mt mk-mpesa-connect" aria-label="M-Pesa prompts">
      <h2>📲 M-Pesa prompts to your Till / Paybill <small className="os-muted">(optional)</small></h2>
      <p className="os-muted">When a buyer orders from you and other sellers at once, they pay each seller directly. With M-Pesa prompts connected, they get a prompt on their phone that pays you straight away. Without it, they pay from their M-Pesa menu and you confirm their code.</p>
      {link?.connected ? (
        <>
          <p className="mk-paydetails-now">✅ Connected: shortcode <b>{link.shortcode}</b>{link.env === 'sandbox' ? ' (sandbox: test money only)' : ''}</p>
          <div className="os-row"><button type="button" className="os-btn os-btn-ghost" onClick={() => setOpen(!open)}>Replace keys</button><button type="button" className="os-btn os-btn-ghost mk-danger" onClick={disconnect}>Disconnect</button></div>
        </>
      ) : !promptable ? (
        <p className="mk-hint">Prompts work with a Till (Buy Goods) or Paybill. With Pochi la Biashara or Send Money, buyers pay from their M-Pesa menu and give you the code.</p>
      ) : !open && <button type="button" className="os-btn os-btn-brand" onClick={() => setOpen(true)}>Connect M-Pesa prompts</button>}
      {open && promptable && (
        <form onSubmit={connect} className="mk-mt" autoComplete="off">
          <p className="mk-hint">From your app on <b>developer.safaricom.co.ke</b> (after “Go Live” for Lipa Na M-Pesa Online). Your keys are checked with Safaricom, stored encrypted and never shown again.</p>
          <div className="mk-form-grid">
            {pay.method === 'till'
              ? <label className="os-field"><span>Store number (head office shortcode) *</span><input inputMode="numeric" value={field.shortcode} onChange={set('shortcode')} placeholder="e.g. 174379" required /></label>
              : <label className="os-field"><span>Paybill</span><input value={pay.paybill} disabled /></label>}
            <label className="os-field"><span>Consumer key *</span><input value={field.consumerKey} onChange={set('consumerKey')} required spellCheck={false} /></label>
            <label className="os-field"><span>Consumer secret *</span><input type="password" value={field.consumerSecret} onChange={set('consumerSecret')} required autoComplete="new-password" /></label>
            <label className="os-field"><span>Lipa Na M-Pesa passkey *</span><input type="password" value={field.passkey} onChange={set('passkey')} required autoComplete="new-password" /></label>
            <label className="os-field"><span>Environment</span><select value={field.env} onChange={set('env')}><option value="production">Live</option><option value="sandbox">Sandbox (testing)</option></select></label>
            <label className="os-field"><span>Your {STORE_INFO.name} password (if you have one)</span><input type="password" value={field.password} onChange={set('password')} autoComplete="current-password" /></label>
          </div>
          <div className="mk-sell-submit"><button type="button" className="os-btn os-btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="os-btn os-btn-brand" disabled={busy}>{busy ? 'Checking with Safaricom…' : 'Connect'}</button></div>
        </form>
      )}
    </section>
  );
}

// How buyers pay me on delivery: M-Pesa Till, Paybill + account, Pochi la Biashara or Send Money
function PayDetailsEditor() {
  const { customer, setCustomer } = useShop();
  const saved = customer?.payDetails;
  const [field, setField] = useState(() => ({ method: saved?.method || 'till', till: saved?.till || '', paybill: saved?.paybill || '', account: saved?.account || '', phone: saved?.phone ? prettyPhone(saved.phone) : prettyPhone(customer?.phone || ''), name: saved?.name || customer?.shopLocation?.name || customer?.name || '' }));
  const [busy, setBusy] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.put('/customers/me', { payDetails: field });
      setCustomer(response.data);
      toast.success('Saved. Buyers see this on their orders.');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-box mk-mt mk-paydetails" id="pay-details" onSubmit={save}>
      <h2>💵 How buyers pay you on delivery <small className="os-muted">(for sellers)</small></h2>
      <p className="os-muted">Buyers who choose “pay on delivery” see this on their order, in the order email and at checkout, so they pay you straight by M-Pesa.</p>
      {saved && <p className="mk-paydetails-now">Buyers see: <b>{saved.text}</b></p>}
      <PayMethodFields value={field} onChange={setField} idPrefix="account-pay" />
      <div className="mk-sell-submit"><button className="os-btn os-btn-brand" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}
