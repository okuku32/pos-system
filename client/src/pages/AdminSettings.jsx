import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import { applySiteInfo } from '../shop/storeInfo';
import { useAuth } from '../context/AuthContext';
import { KapuName } from '../components/BrandName';

// the settings that change what people pay or earn: only the owner changes them (the server enforces it too)
const MONEY_SETTINGS = ['commissionPercent', 'fieldwork', 'courier', 'demoPayments'];

// Marketplace details (shown on the website and in emails), commission, and a check of email & M-Pesa
export default function AdminSettings() {
  const { isOwner } = useAuth();
  const [field, setField] = useState(null);
  const [info, setInfo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    api.get('/admin/settings').then((response) => {
      setInfo(response.data);
      setField({ name: response.data.name, tagline: response.data.tagline, address: response.data.address, phone: response.data.phone, whatsapp: response.data.whatsapp, email: typeof response.data.email === 'object' ? response.data.email?.contact || '' : response.data.email || '', commissionPercent: response.data.commissionPercent, mapsKey: response.data.mapsKey || '', hours: response.data.hours?.length ? response.data.hours : [['Mon – Fri', '8:00 am – 6:00 pm']], campaign: { active: false, emoji: '🎒', title: '', subtitle: '', cta: 'Shop now', link: '/market/search', ...(response.data.campaign || {}) }, fieldwork: { ...response.data.fieldwork }, courier: JSON.parse(JSON.stringify(response.data.courier || { enabled: true, minKm: 60, maxKm: 1200, handlingFee: 250, agentSharePercent: 80, assumeKg: 2, companies: [] })), demoPayments: !!response.data.demoPayments, social: { tiktok: '', instagram: '', facebook: '', x: '', youtube: '', ...(response.data.social || {}) } });
    }).catch((error) => toast.error(errMsg(error)));
  }, []);
  if (!field) return <p className="muted">Loading…</p>;
  const set = (key) => (event) => setField({ ...field, [key]: event.target.value });

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const changes = { ...field, commissionPercent: Number(field.commissionPercent) };
      if (!isOwner) for (const key of MONEY_SETTINGS) delete changes[key]; // an admin saves everything except money
      const response = await api.put('/admin/settings', changes);
      applySiteInfo(response.data);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };
  const testEmail = async () => {
    try {
      const response = await api.post('/admin/email-test', { to: testTo });
      toast.success(response.data.message);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const setHour = (index, innerIndex, value) => setField({ ...field, hours: field.hours.map((hour, position) => (position === index ? (innerIndex === 0 ? [value, hour[1]] : [hour[0], value]) : hour)) });

  return (
    <div>
      <div className="page-head"><h2>Settings</h2></div>
      {!isOwner && <p className="card owner-only-note">👑 Commission, rider &amp; agent fares, courier fees and demo payments are set by the owner. You can see them here; everything else you can change.</p>}
      <form className="card form-grid" onSubmit={save} style={{ maxWidth: 820 }}>
        <h3 className="span2" style={{ margin: 0 }}>Marketplace details</h3>
        <label>Name<input value={field.name} onChange={set('name')} required minLength={2} maxLength={60} /></label>
        <label>Tagline<input value={field.tagline} onChange={set('tagline')} maxLength={140} /></label>
        <label className="span2">Office address (shown on Help and in emails)<input value={field.address} onChange={set('address')} maxLength={200} /></label>
        <label>Support phone<input value={field.phone} onChange={set('phone')} maxLength={30} placeholder="0712 345 678" /></label>
        <label>WhatsApp number <small className="muted">(empty = demo WhatsApp chat)</small><input value={field.whatsapp} onChange={set('whatsapp')} maxLength={30} placeholder="254712345678" /></label>
        <label>Support email<input type="email" value={field.email} onChange={set('email')} maxLength={120} /></label>
        <label>
          Commission on M-Pesa orders (%) {!isOwner && <small className="muted">👑 owner only</small>}
          <input type="number" min="0" max="50" step="0.5" value={field.commissionPercent} onChange={set('commissionPercent')} disabled={!isOwner} />
          <small className="muted">Your cut of online (M-Pesa) sales; cash-on-delivery orders are free for sellers</small>
        </label>
        <label className="span2">
          Google Routes key <small className="muted">(optional: road distances only)</small>
          <input value={field.mapsKey} onChange={set('mapsKey')} maxLength={120} placeholder="AIza…" autoComplete="off" spellCheck={false} />
          <small className="muted">Not needed for maps: the app’s maps are Leaflet with OpenStreetMap, and addresses come from OpenStreetMap too (no key). This key is used only by the server, for real road distances in delivery prices: in Google Cloud enable <b>Routes API</b> and restrict the key to your server. Without it, road distances are estimated.</small>
        </label>
        <div className="span2">
          <span className="muted" style={{ fontSize: 14 }}>Office hours</span>
          {field.hours.map((hour, index) => (
            <div key={index} className="toolbar" style={{ marginTop: 6 }}>
              <input value={hour[0]} onChange={(event) => setHour(index, 0, event.target.value)} placeholder="Days" />
              <input value={hour[1]} onChange={(event) => setHour(index, 1, event.target.value)} placeholder="Hours" />
              <button type="button" className="btn ghost sm" onClick={() => setField({ ...field, hours: field.hours.filter((_, position) => position !== index) })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setField({ ...field, hours: [...field.hours, ['', '']] })}>+ Add hours</button>
        </div>
        <fieldset className="owner-only" disabled={!isOwner}>
        <h3 className="span2" style={{ margin: '10px 0 0' }}>🏍️ Riders & 🛍️ shopping agents {!isOwner && <small className="muted">👑 owner only</small>}</h3>
        <p className="span2 muted" style={{ margin: 0, fontSize: 13 }}>Optional extras the buyer chooses and pays for at checkout. Riders and agents earn their share and are paid weekly (Field team → Weekly pay).</p>
        {(() => {
          const fw = field.fieldwork;
          const setFw = (key) => (event) => setField({ ...field, fieldwork: { ...fw, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value } });
          // like Uber / Bolt: base + per km + per minute (a city trip: ~2.6 minutes per km by road)
          const eg = (km) => Math.max(Number(fw.riderMin), Math.round((Number(fw.riderBase) + Number(fw.riderPerKm) * km * 1.3 + Number(fw.riderPerMin ?? 2) * Math.round(km * 1.3 * 2.5)) / 10) * 10);
          return (
            <>
              <label className="check span2"><input type="checkbox" checked={fw.riderEnabled !== false} onChange={setFw('riderEnabled')} /> Offer rider delivery at checkout</label>
              <label>Base fee (KSh)<input type="number" min="0" value={fw.riderBase} onChange={setFw('riderBase')} /></label>
              <label>Per km (KSh)<input type="number" min="0" value={fw.riderPerKm} onChange={setFw('riderPerKm')} /></label>
              <label>Per minute (KSh)<input type="number" min="0" value={fw.riderPerMin ?? 2} onChange={setFw('riderPerMin')} /></label>
              <label>Minimum fare (KSh)<input type="number" min="0" value={fw.riderMin} onChange={setFw('riderMin')} /></label>
              <label>Longest trip (km)<input type="number" min="1" value={fw.riderMaxKm} onChange={setFw('riderMaxKm')} /></label>

              <p className="muted" style={{ margin: 0, fontSize: 13, alignSelf: 'end' }}>e.g. 3 km ≈ KSh {eg(3)}, 8 km ≈ KSh {eg(8)}</p>
              <p className="span2 muted" style={{ margin: '6px 0 0', fontSize: 13 }}>From every rider / agent fee <KapuName /> keeps our commission + tax (e.g. 10% + 5% = 15%). The rest is sent to their M-Pesa a set time after the job; for fees they collect themselves, our share is taken from their next payout.</p>
              <label>Our commission on agent fees (%)<input type="number" min="0" max="50" step="0.5" value={fw.commissionPercent ?? 10} onChange={setFw('commissionPercent')} /></label>
              <label>Tax on agent fees (%)<input type="number" min="0" max="30" step="0.5" value={fw.taxPercent ?? 5} onChange={setFw('taxPercent')} /></label>
              <label>Pay agents after (minutes)<input type="number" min="0" max="1440" value={fw.payoutDelayMin ?? 30} onChange={setFw('payoutDelayMin')} /></label>
              <label className="check span2"><input type="checkbox" checked={fw.inspectEnabled !== false} onChange={setFw('inspectEnabled')} /> Offer inspection before dispatch</label>
              <p className="span2" style={{ margin: '4px 0 0', fontSize: 14 }}><b>Inspection fee: KSh 200 flat</b> per seller, by our agent or rider. It’s optional (the buyer ticks “Verify my goods”, marked highly recommended) and paid upfront by M-Pesa.</p>
              <p className="span2 muted" style={{ margin: '6px 0 0', fontSize: 13 }}>Inspect &amp; deliver: when the buyer asks for an inspection, the agent (or a rider) who checks the items also delivers them. Items and inspection are paid upfront by M-Pesa; only the delivery fee is paid in cash on delivery.</p>
              <label>Free delivery within (km)<input type="number" min="0" max="20" step="0.1" value={fw.inspectFreeKm ?? 1} onChange={setFw('inspectFreeKm')} /></label>
              <label>…for parcels under (kg)<input type="number" min="0" max="100" step="0.5" value={fw.inspectFreeKg ?? 5} onChange={setFw('inspectFreeKg')} /></label>
              <label>Otherwise, first stretch fee (KSh)<input type="number" min="0" value={fw.inspectBaseFee ?? 100} onChange={setFw('inspectBaseFee')} /></label>
              <label>First stretch covers (km)<input type="number" min="0" max="50" step="0.5" value={fw.inspectBaseKm ?? 2} onChange={setFw('inspectBaseKm')} /></label>
              <p className="span2 muted" style={{ margin: 0, fontSize: 13 }}>After the first stretch, each extra km costs the rider per-km rate above.</p>
              <label className="check span2">
                <input type="checkbox" checked={!!field.demoPayments} disabled={info?.mpesaReady} onChange={(event) => setField({ ...field, demoPayments: event.target.checked })} />
                🧪 Demo payments: mark M-Pesa checkouts as paid without money, for testing {info?.mpesaReady ? '(off: M-Pesa is connected)' : 'until M-Pesa is connected'}
              </label>
            </>
          );
        })()}
        <h3 className="span2" style={{ margin: '10px 0 0' }}>🚌 Courier for far deliveries</h3>
        {(() => {
          const courier = field.courier;
          const setC = (key) => (event) => setField({ ...field, courier: { ...courier, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value } });
          const setCo = (index, key, value) => setField({ ...field, courier: { ...courier, companies: courier.companies.map((company, position) => (position === index ? { ...company, [key]: value } : company)) } });
          const fare = (item, km, kg) => Math.round(Math.max(Number(item.min) || 0, (Number(item.base) || 0) + (Number(item.perKm) || 0) * km + (Number(item.perKg) || 0) * Math.max(0, kg - 1)) / 10) * 10;
          return (
            <>
              <p className="span2 muted" style={{ margin: 0, fontSize: 13 }}>Buyers {courier.minKm || 60} km or more from the seller can choose a courier (bus or matatu parcel). Our agent collects the parcel from the shop, pays the fare, sends it and enters the waybill number; the buyer collects it at the courier’s office. The buyer pays the fare + your handling fee upfront with M-Pesa; the agent is refunded the fare in their weekly pay.</p>
              <label className="check span2"><input type="checkbox" checked={courier.enabled !== false} onChange={setC('enabled')} /> Offer courier delivery at checkout</label>
              <label>Courier from (km)<input type="number" min="5" max="1000" value={courier.minKm} onChange={setC('minKm')} /></label>
              <label>Up to (km)<input type="number" min="50" max="3000" value={courier.maxKm} onChange={setC('maxKm')} /></label>
              <label>Agent handling fee (KSh)<input type="number" min="0" max="10000" value={courier.handlingFee} onChange={setC('handlingFee')} /></label>
              <label>Agent’s share of the handling fee (%)<input type="number" min="0" max="100" value={courier.agentSharePercent} onChange={setC('agentSharePercent')} /></label>
              <label>Weight to assume when unknown (kg)<input type="number" min="0.1" max="100" step="0.1" value={courier.assumeKg} onChange={setC('assumeKg')} /></label>
              <div className="span2" style={{ overflowX: 'auto' }}>
                <table className="table" style={{ minWidth: 760 }}>
                  <thead><tr><th>On</th><th>Company</th><th className="right">Base</th><th className="right">Per km</th><th className="right">Per kg</th><th className="right">Lowest</th><th>Time</th><th className="right">e.g. 300 km, 2 kg</th><th></th></tr></thead>
                  <tbody>
                    {courier.companies.map((company, index) => (
                      <tr key={index}>
                        <td><input type="checkbox" checked={company.active !== false} onChange={(event) => setCo(index, 'active', event.target.checked)} aria-label="Active" /></td>
                        <td><input value={company.name} onChange={(event) => setCo(index, 'name', event.target.value)} maxLength={60} style={{ minWidth: 170 }} /><input value={company.note || ''} onChange={(event) => setCo(index, 'note', event.target.value)} maxLength={140} placeholder="Note for buyers" style={{ minWidth: 170, marginTop: 4, fontSize: 12 }} /></td>
                        {['base', 'perKm', 'perKg', 'min'].map((item) => <td key={item} className="right"><input type="number" min="0" step={item === 'perKm' ? '0.1' : '1'} value={company[item]} onChange={(event) => setCo(index, item, event.target.value)} style={{ width: 80 }} /></td>)}
                        <td><input value={company.eta || ''} onChange={(event) => setCo(index, 'eta', event.target.value)} maxLength={40} placeholder="Next day" style={{ width: 110 }} /></td>
                        <td className="right nowrap">KSh {fare(company, 300, 2).toLocaleString('en-KE')}</td>
                        <td><button type="button" className="btn ghost sm danger-text" onClick={() => setField({ ...field, courier: { ...courier, companies: courier.companies.filter((_, position) => position !== index) } })} disabled={courier.companies.length < 2}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setField({ ...field, courier: { ...courier, companies: [...courier.companies, { name: '', base: 300, perKm: 1, perKg: 20, min: 400, eta: 'Next day', note: '', active: true }] } })} disabled={courier.companies.length >= 12}>+ Add a courier company</button>
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>Fare = base + per km × distance + per kg × (weight − 1 kg), at least the lowest fare, rounded to KSh 10. The starting fares are estimates: set each company’s real rates.</p>
              </div>
            </>
          );
        })()}
        </fieldset>
        <h3 className="span2" style={{ margin: '10px 0 0' }}>Social media</h3>
        <p className="span2 muted" style={{ margin: 0, fontSize: 13 }}>Shown as icons at the bottom of every page. Paste the full link to each page (e.g. https://www.tiktok.com/@yourname). Leave one empty to hide it.</p>
        {[['tiktok', 'TikTok', 'https://www.tiktok.com/@…'], ['instagram', 'Instagram', 'https://www.instagram.com/…'], ['facebook', 'Facebook', 'https://www.facebook.com/…'], ['x', 'X (Twitter)', 'https://x.com/…'], ['youtube', 'YouTube', 'https://www.youtube.com/@…']].map(([key, label, ph]) => (
          <label key={key}>{label}<input value={field.social?.[key] || ''} onChange={(event) => setField({ ...field, social: { ...field.social, [key]: event.target.value } })} placeholder={ph} maxLength={200} inputMode="url" /></label>
        ))}
        <h3 className="span2" style={{ margin: '10px 0 0' }}>Home page campaign banner</h3>
        <p className="span2 muted" style={{ margin: 0, fontSize: 13 }}>Seasonal promotions: back to school (January), Easter, Mashujaa Day, Black Friday, Christmas “Ni Sasa” deals…</p>
        <div className="span2 toolbar" style={{ flexWrap: 'wrap' }}>
          {[['🎒', 'Back to school deals', 'Uniforms, books, bags and shoes', '/market/stationery'], ['🖤', 'Black Friday', 'The biggest discounts of the year', '/market/search?buyNow=1'], ['🎄', 'Christmas Ni Sasa deals', 'Gifts, decor and party supplies', '/market/search?buyNow=1'], ['🚗', 'Car month', 'Find your next ride', '/market/vehicles/cars']].map(([key, value, sub, link]) => (
            <button type="button" key={value} className="btn ghost sm" onClick={() => setField({ ...field, campaign: { ...field.campaign, active: true, emoji: key, title: value, subtitle: sub, link, cta: 'Shop now' } })}>{key} {value}</button>
          ))}
        </div>
        <label className="check span2"><input type="checkbox" checked={!!field.campaign.active} onChange={(event) => setField({ ...field, campaign: { ...field.campaign, active: event.target.checked } })} /> Show the banner</label>
        <label>Emoji<input value={field.campaign.emoji || ''} onChange={(event) => setField({ ...field, campaign: { ...field.campaign, emoji: event.target.value } })} maxLength={8} /></label>
        <label>Title<input value={field.campaign.title || ''} onChange={(event) => setField({ ...field, campaign: { ...field.campaign, title: event.target.value } })} maxLength={80} /></label>
        <label className="span2">Subtitle<input value={field.campaign.subtitle || ''} onChange={(event) => setField({ ...field, campaign: { ...field.campaign, subtitle: event.target.value } })} maxLength={160} /></label>
        <label>Button text<input value={field.campaign.cta || ''} onChange={(event) => setField({ ...field, campaign: { ...field.campaign, cta: event.target.value } })} maxLength={30} /></label>
        <label>Link (a page on this site)<input value={field.campaign.link || ''} onChange={(event) => setField({ ...field, campaign: { ...field.campaign, link: event.target.value } })} maxLength={200} placeholder="/market/stationery" /></label>
        <div className="modal-actions span2"><button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>
      </form>

      <div className="stats" style={{ marginTop: 14, maxWidth: 820 }}>
        <div className={`card stat ${info.mpesa.configured ? 'stat-good' : 'stat-bad'}`}>
          <span className="muted">M-Pesa (Daraja, {info.mpesa.env})</span>
          <b>{info.mpesa.configured ? 'Set up' : 'Not set up'}</b>
          <small className="muted">Keys live in server/.env. Payment results arrive at {info.mpesa.callbackUrl || '(set PUBLIC_API_URL)'}</small>
        </div>
        <div className={`card stat ${info.email.mode === 'smtp' || info.email.mode === 'brevo' ? 'stat-good' : ''}`}>
          <span className="muted">Email</span>
          <b>{info.email.mode === 'brevo' ? 'Sending via Brevo' : info.email.mode === 'smtp' ? `Sending via ${info.email.host}` : info.email.mode === 'ethereal' ? 'Test inbox (not delivered)' : 'Off'}</b>
          <div className="toolbar" style={{ marginTop: 6 }}>
            <input type="email" placeholder="you@example.com" value={testTo} onChange={(event) => setTestTo(event.target.value)} />
            <button className="btn ghost sm" onClick={testEmail}>Send test</button>
          </div>
        </div>
      </div>
    </div>
  );
}
