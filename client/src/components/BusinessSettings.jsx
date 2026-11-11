import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';

const MASK = '••••••••';

// One section of the client's own settings, saved independently
function Section({ title, intro, children, onSave, busy }) {
  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <h3>{title}</h3>
      {intro && <p className="muted" style={{ marginTop: -4 }}>{intro}</p>}
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        {children}
        <div className="modal-actions span2" style={{ marginTop: 4 }}>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

// Secret field: shows "saved" instead of the value; typing replaces it
function Secret({ label, value, onChange }) {
  const saved = value === MASK;
  return (
    <label>
      {label} {saved && <small className="success-text">✓ saved</small>}
      <input type="password" value={saved ? '' : value} placeholder={saved ? 'Leave empty to keep the saved one' : ''} onChange={(e) => onChange(e.target.value || (saved ? MASK : ''))} autoComplete="new-password" />
    </label>
  );
}

export default function BusinessSettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => api.get('/tenant/settings').then((r) => setS(r.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  if (!s) return <p className="muted">Loading business settings…</p>;

  const set = (section, field) => (e) => setS({ ...s, [section]: { ...s[section], [field]: e.target.value } });
  const save = async (key, body) => {
    setBusy(key);
    try {
      await api.put('/tenant/settings', body);
      toast.success('Saved. Changes apply right away');
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };
  const hours = s.shop.hours?.length ? s.shop.hours : [['', '']];
  const setHour = (i, j) => (e) => {
    const h = hours.map((r) => [...r]);
    h[i][j] = e.target.value;
    setS({ ...s, shop: { ...s.shop, hours: h } });
  };

  return (
    <>
      <div className="card" style={{ maxWidth: 680 }}>
        <div className="row-between">
          <div>
            <h3 style={{ margin: 0 }}>{s.branding.storeName}</h3>
            <small className="muted">Your system: <a href={s.shopUrl} target="_blank" rel="noreferrer">{s.shopUrl.replace(/^https?:\/\//, '')}</a> · online shop at <a href={`${s.shopUrl}/shop`} target="_blank" rel="noreferrer">/shop</a></small>
          </div>
          <span className={`badge ${s.status === 'active' ? 'completed' : 'pending'}`}>{s.status}{s.status === 'trial' && s.trialEndsAt ? ` until ${new Date(s.trialEndsAt).toLocaleDateString()}` : ''}</span>
        </div>
      </div>

      <Section title="Business details" intro="Shown on receipts, the online shop, the Help page and customer emails." busy={busy === 'biz'}
        onSave={() => save('biz', { branding: { storeName: s.branding.storeName, logoUrl: s.branding.logoUrl }, shop: { ...s.shop, hours: hours.filter((r) => r[0]) } })}>
        <label className="span2">Business name<input value={s.branding.storeName} onChange={set('branding', 'storeName')} required maxLength={80} /></label>
        <label className="span2">Logo image URL <small className="muted">(optional, square image)</small><input value={s.branding.logoUrl || ''} onChange={set('branding', 'logoUrl')} placeholder="https://…/logo.png" /></label>
        <label className="span2">Address<input value={s.shop.address} onChange={set('shop', 'address')} placeholder="e.g. Imara Mall, Mombasa Road, Nairobi" /></label>
        <label>Short location name<input value={s.shop.location} onChange={set('shop', 'location')} placeholder="e.g. Imara Mall" /></label>
        <label>Map search text <small className="muted">(optional)</small><input value={s.shop.mapQuery} onChange={set('shop', 'mapQuery')} placeholder="Defaults to the address" /></label>
        <label>Phone<input value={s.shop.phone} onChange={set('shop', 'phone')} placeholder="0712 345 678" /></label>
        <label>WhatsApp number<input value={s.shop.whatsapp} onChange={set('shop', 'whatsapp')} placeholder="254712345678" /></label>
        <label className="span2">Contact email<input type="email" value={s.shop.email} onChange={set('shop', 'email')} /></label>
        <div className="span2">
          <small className="muted">Opening hours</small>
          {hours.map((r, i) => (
            <div key={i} className="toolbar" style={{ marginTop: 6 }}>
              <input value={r[0]} onChange={setHour(i, 0)} placeholder="Mon – Sat" />
              <input value={r[1]} onChange={setHour(i, 1)} placeholder="8:00 am – 9:00 pm" />
            </div>
          ))}
          {hours.length < 7 && <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setS({ ...s, shop: { ...s.shop, hours: [...hours, ['', '']] } })}>+ Add row</button>}
        </div>
      </Section>

      <Section title="M-Pesa (Daraja)" intro="Payments go straight to your own Paybill or Till. Get these from developer.safaricom.co.ke." busy={busy === 'mpesa'}
        onSave={() => save('mpesa', { mpesa: { env: s.mpesa.env, consumerKey: s.mpesa.consumerKey, consumerSecret: s.mpesa.consumerSecret, shortcode: s.mpesa.shortcode, passkey: s.mpesa.passkey, transactionType: s.mpesa.transactionType } })}>
        <label>Environment
          <select value={s.mpesa.env} onChange={set('mpesa', 'env')}>
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Production (real money)</option>
          </select>
        </label>
        <label>Type
          <select value={s.mpesa.transactionType} onChange={set('mpesa', 'transactionType')}>
            <option value="CustomerPayBillOnline">Paybill</option>
            <option value="CustomerBuyGoodsOnline">Till (Buy Goods)</option>
          </select>
        </label>
        <label>Shortcode<input value={s.mpesa.shortcode} onChange={set('mpesa', 'shortcode')} /></label>
        <label>Consumer key<input value={s.mpesa.consumerKey} onChange={set('mpesa', 'consumerKey')} autoComplete="off" /></label>
        <Secret label="Consumer secret" value={s.mpesa.consumerSecret} onChange={(v) => setS({ ...s, mpesa: { ...s.mpesa, consumerSecret: v } })} />
        <Secret label="Passkey" value={s.mpesa.passkey} onChange={(v) => setS({ ...s, mpesa: { ...s.mpesa, passkey: v } })} />
        <p className="muted span2" style={{ fontSize: 12, margin: 0 }}>Payment confirmations come back to: <code>{s.mpesa.callbackUrl || 'not configured (ask your provider)'}</code></p>
      </Section>

      <Section title="KRA eTIMS" intro="Your own KRA PIN, branch and device from the KRA eTIMS (OSCU) registration." busy={busy === 'etims'}
        onSave={() => save('etims', { etims: s.etims })}>
        <label>Mode
          <select value={s.etims.mode} onChange={set('etims', 'mode')}>
            <option value="off">Off</option>
            <option value="mock">Test mode (receipts marked TEST)</option>
            <option value="sandbox">KRA sandbox</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label>KRA PIN<input value={s.etims.tin} onChange={set('etims', 'tin')} placeholder="P051234567X" /></label>
        <label>Branch ID<input value={s.etims.bhfId} onChange={set('etims', 'bhfId')} placeholder="00" /></label>
        <label>Device serial<input value={s.etims.deviceSerial} onChange={set('etims', 'deviceSerial')} /></label>
        <label className="span2">Name on tax invoices<input value={s.etims.traderName} onChange={set('etims', 'traderName')} /></label>
      </Section>

      <Section title="Email & tax" intro="Customer emails are sent for you automatically. Add your own email account only if you want them to come from your address." busy={busy === 'email'}
        onSave={() => save('email', { email: s.email, taxRate: s.taxRate })}>
        <label className="span2">Sender <small className="muted">(optional)</small><input value={s.email.from} onChange={set('email', 'from')} placeholder={`${s.branding.storeName} <orders@yourshop.co.ke>`} /></label>
        <label>SMTP server<input value={s.email.smtpHost} onChange={set('email', 'smtpHost')} placeholder="smtp.gmail.com" /></label>
        <label>Port<input type="number" value={s.email.smtpPort} onChange={set('email', 'smtpPort')} /></label>
        <label>Username<input value={s.email.smtpUser} onChange={set('email', 'smtpUser')} autoComplete="off" /></label>
        <Secret label="Password / app password" value={s.email.smtpPass} onChange={(v) => setS({ ...s, email: { ...s.email, smtpPass: v } })} />
        <label className="span2">Tax added at checkout (%) <small className="muted">(0 if your prices already include VAT)</small>
          <input type="number" min="0" max="30" step="0.5" value={s.taxRate} onChange={(e) => setS({ ...s, taxRate: e.target.value })} />
        </label>
      </Section>
    </>
  );
}
