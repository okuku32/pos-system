import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';

// Your platform console: manage every client from one place. Uses its own login (not a shop login).
const TOKEN = 'platform_token';
const papi = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || '/api'}/platform` });
papi.interceptors.request.use((c) => {
  const t = localStorage.getItem(TOKEN);
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});
const err = (e) => e.response?.data?.message || e.message || 'Something went wrong';
const ksh = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
const ago = (d) => {
  if (!d) return 'never';
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
const STATUS = { active: 'completed', trial: 'pending', suspended: 'cancelled' };

function Auth({ onDone }) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    papi.get('/setup').then((r) => setNeedsSetup(r.data.needsSetup)).catch(() => {});
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await papi.post(needsSetup ? '/setup' : '/login', f);
      localStorage.setItem(TOKEN, data.token);
      onDone(data.admin);
    } catch (e2) {
      toast.error(err(e2));
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="center-screen">
      <form className="card login" onSubmit={submit}>
        <h1>Platform console</h1>
        <p className="muted">{needsSetup ? 'Create your owner account. This is only asked once.' : 'Manage all your clients.'}</p>
        {needsSetup && <label>Your name<input value={f.name} onChange={set('name')} required /></label>}
        <label>Email<input type="email" value={f.email} onChange={set('email')} required autoFocus /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} required minLength={8} /></label>
        <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : needsSetup ? 'Create owner account' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function NewClient({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', slug: '', plan: 'standard', trialDays: 14, adminName: '', adminEmail: '', adminPassword: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [touchedSlug, setTouchedSlug] = useState(false);
  const set = (k) => (e) => {
    const v = e.target.value;
    setF((p) => {
      const n = { ...p, [k]: v };
      if (k === 'name' && !touchedSlug) n.slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
      return n;
    });
    if (k === 'slug') setTouchedSlug(true);
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await papi.post('/tenants', {
        name: f.name,
        slug: f.slug,
        plan: f.plan,
        trialDays: Number(f.trialDays),
        contact: { phone: f.phone },
        admin: { name: f.adminName, email: f.adminEmail, password: f.adminPassword },
      });
      onCreated(data, f);
    } catch (e2) {
      toast.error(err(e2));
    } finally {
      setBusy(false);
    }
  };
  const host = window.location.host.replace(/^[^.]+\.(?=.+\.)/, '');
  return (
    <Modal title="New client" onClose={onClose} width={560}>
      <form className="form-grid" onSubmit={submit}>
        <label className="span2">Business name<input value={f.name} onChange={set('name')} required autoFocus placeholder="e.g. Mama Mboga Supermarket" /></label>
        <label className="span2">
          Web address
          <input value={f.slug} onChange={set('slug')} required pattern="[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?" placeholder="mama-mboga" />
          <small className="muted">Their system will be at <b>{f.slug || 'address'}.{host}</b></small>
        </label>
        <label>Plan
          <select value={f.plan} onChange={set('plan')}>
            <option value="starter">Starter</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        <label>Free trial (days)<input type="number" min="0" max="90" value={f.trialDays} onChange={set('trialDays')} /></label>
        <h4 className="span2" style={{ margin: '8px 0 4px' }}>Their first admin login</h4>
        <label>Name<input value={f.adminName} onChange={set('adminName')} required /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} placeholder="07XX XXX XXX" /></label>
        <label>Email<input type="email" value={f.adminEmail} onChange={set('adminEmail')} required /></label>
        <label>Temporary password<input value={f.adminPassword} onChange={set('adminPassword')} required minLength={6} /></label>
        <div className="modal-actions span2">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create client'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ClientPanel({ t, onClose, onSaved }) {
  const [f, setF] = useState({
    name: t.name,
    status: t.status,
    plan: t.plan,
    trialEndsAt: t.trialEndsAt ? String(t.trialEndsAt).slice(0, 10) : '',
    domains: (t.domains || []).join(', '),
    notes: t.notes || '',
    contactName: t.contact?.name || '',
    contactEmail: t.contact?.email || '',
    contactPhone: t.contact?.phone || '',
  });
  const [busy, setBusy] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    setBusy('save');
    try {
      const { data } = await papi.patch(`/tenants/${t.slug}`, {
        name: f.name,
        status: f.status,
        plan: f.plan,
        trialEndsAt: f.trialEndsAt || null,
        domains: f.domains,
        notes: f.notes,
        contact: { name: f.contactName, email: f.contactEmail, phone: f.contactPhone },
      });
      toast.success('Saved');
      onSaved(data);
    } catch (e2) {
      toast.error(err(e2));
    } finally {
      setBusy('');
    }
  };
  const supportLogin = async () => {
    if (!confirm(`Open ${t.name}'s system as a support admin for 1 hour? This is recorded in the activity log.`)) return;
    setBusy('support');
    try {
      const { data } = await papi.post(`/tenants/${t.slug}/support-login`);
      window.open(data.url, '_blank', 'noopener');
    } catch (e2) {
      toast.error(err(e2));
    } finally {
      setBusy('');
    }
  };
  const u = t.usage || {};
  return (
    <Modal title={t.name} onClose={onClose} width={640}>
      <div className="platform-usage">
        <div><span>Today</span><b>{ksh(u.revenueToday)}</b><small>{u.salesToday || 0} sales</small></div>
        <div><span>This month</span><b>{ksh(u.revenueMonth)}</b><small>{u.salesMonth || 0} sales</small></div>
        <div><span>Users · products</span><b>{u.users ?? '–'} · {u.products ?? '–'}</b><small>last sale {ago(u.lastSaleAt)}</small></div>
      </div>
      {u.etimsFailed > 0 && <p className="error-text">⚠ {u.etimsFailed} sale(s) not accepted by KRA eTIMS. Open their system to resend.</p>}
      {u.error && <p className="error-text">Could not read usage: {u.error}</p>}
      <div className="toolbar wrap" style={{ margin: '8px 0 14px' }}>
        <a className="btn ghost sm" href={t.shopUrl} target="_blank" rel="noreferrer">Open POS ↗</a>
        <a className="btn ghost sm" href={`${t.shopUrl}/shop`} target="_blank" rel="noreferrer">Open shop ↗</a>
        <button className="btn sm" onClick={supportLogin} disabled={!!busy || t.status === 'suspended'}>{busy === 'support' ? 'Opening…' : '🛟 Support login'}</button>
      </div>
      <form className="form-grid" onSubmit={save}>
        <label className="span2">Business name<input value={f.name} onChange={set('name')} /></label>
        <label>Status
          <select value={f.status} onChange={set('status')} disabled={t.isDefault}>
            <option value="trial">Trial</option>
            <option value="active">Active (paying)</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label>Plan
          <select value={f.plan} onChange={set('plan')}>
            <option value="starter">Starter</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        <label>Trial ends<input type="date" value={f.trialEndsAt} onChange={set('trialEndsAt')} /></label>
        <label>Own domain(s) <small className="muted">(optional)</small><input value={f.domains} onChange={set('domains')} placeholder="shop.client.co.ke" /></label>
        <label>Contact name<input value={f.contactName} onChange={set('contactName')} /></label>
        <label>Contact phone<input value={f.contactPhone} onChange={set('contactPhone')} /></label>
        <label className="span2">Contact email<input type="email" value={f.contactEmail} onChange={set('contactEmail')} /></label>
        <label className="span2">Private notes<textarea rows={3} value={f.notes} onChange={set('notes')} placeholder="Billing, agreements, anything to remember…" style={{ font: 'inherit', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }} /></label>
        <p className="muted span2" style={{ fontSize: 12, margin: 0 }}>Address: <b>{t.slug}</b> · database <code>{t.dbName}</code> · client since {new Date(t.createdAt).toLocaleDateString()}</p>
        <div className="modal-actions span2">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function PlatformApp() {
  const [admin, setAdmin] = useState(null);
  const [checked, setChecked] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [created, setCreated] = useState(null);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState('clients');

  useEffect(() => {
    document.title = 'Platform console';
    if (!localStorage.getItem(TOKEN)) return setChecked(true);
    papi.get('/me').then((r) => setAdmin(r.data)).catch(() => localStorage.removeItem(TOKEN)).finally(() => setChecked(true));
  }, []);

  const load = useCallback(() => {
    papi.get('/tenants').then((r) => setTenants(r.data)).catch((e) => toast.error(err(e)));
    papi.get('/audit').then((r) => setAudit(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tenants.filter((t) => !s || t.name.toLowerCase().includes(s) || t.slug.includes(s) || (t.contact?.email || '').toLowerCase().includes(s));
  }, [tenants, q]);
  const totals = useMemo(() => ({
    clients: tenants.length,
    active: tenants.filter((t) => t.status === 'active').length,
    trial: tenants.filter((t) => t.status === 'trial').length,
    suspended: tenants.filter((t) => t.status === 'suspended').length,
    revenueToday: tenants.reduce((n, t) => n + (t.usage?.revenueToday || 0), 0),
  }), [tenants]);

  if (!checked) return <div className="center-screen muted">Loading…</div>;
  if (!admin) return <Auth onDone={setAdmin} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Platform <small style={{ fontWeight: 500, opacity: 0.6, fontSize: 13 }}>console</small></div>
        <nav>
          <a href="#" className={tab === 'clients' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('clients'); }}>Clients</a>
          <a href="#" className={tab === 'activity' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('activity'); }}>Activity log</a>
        </nav>
        <div className="userbox">
          <span>{admin.name}</span>
          <button className="btn ghost sm" onClick={() => { localStorage.removeItem(TOKEN); setAdmin(null); }}>Log out</button>
        </div>
      </header>
      <main className="content">
        {tab === 'clients' ? (
          <>
            <div className="stats">
              <div className="card stat"><span className="muted">Clients</span><b>{totals.clients}</b><small className="muted">{totals.active} active · {totals.trial} on trial · {totals.suspended} suspended</small></div>
              <div className="card stat"><span className="muted">Sales across all clients today</span><b>{ksh(totals.revenueToday)}</b></div>
            </div>
            <div className="page-head">
              <h2>Clients</h2>
              <div className="toolbar">
                <input placeholder="Search name, address, email…" value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="btn" onClick={() => setCreating(true)}>+ New client</button>
              </div>
            </div>
            <div className="card table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Client</th><th>Status</th><th>Plan</th><th className="right">Today</th><th className="right">This month</th><th className="right">Users</th><th>Last sale</th><th></th></tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.slug}>
                      <td>
                        <b>{t.name}</b>{t.isDefault && <span className="badge online" style={{ marginLeft: 6 }}>main</span>}
                        <br /><small className="muted">{t.shopUrl.replace(/^https?:\/\//, '')}</small>
                      </td>
                      <td>
                        <span className={`badge ${STATUS[t.status]}`}>{t.status}</span>
                        {t.status === 'trial' && t.trialEndsAt && <><br /><small className={new Date(t.trialEndsAt) < new Date() ? 'error-text' : 'muted'}>ends {new Date(t.trialEndsAt).toLocaleDateString()}</small></>}
                      </td>
                      <td>{t.plan}</td>
                      <td className="right">{ksh(t.usage?.revenueToday)}<br /><small className="muted">{t.usage?.salesToday || 0} sales</small></td>
                      <td className="right">{ksh(t.usage?.revenueMonth)}</td>
                      <td className="right">{t.usage?.users ?? '–'}</td>
                      <td>
                        {ago(t.usage?.lastSaleAt)}
                        {t.usage?.etimsFailed > 0 && <><br /><small className="error-text">⚠ {t.usage.etimsFailed} eTIMS failed</small></>}
                      </td>
                      <td className="right"><button className="btn ghost sm" onClick={() => setOpen(t)}>Manage</button></td>
                    </tr>
                  ))}
                  {!shown.length && <tr><td colSpan={8} className="center muted">No clients yet. Click “+ New client”.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <h2>Activity log</h2>
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>What</th><th>Client</th><th>By</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a._id}><td className="nowrap">{new Date(a.at).toLocaleString()}</td><td>{a.action.replace('tenant.', '')}</td><td>{a.tenant}</td><td>{a.by}</td></tr>
                  ))}
                  {!audit.length && <tr><td colSpan={4} className="center muted">Nothing yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {creating && (
        <NewClient
          onClose={() => setCreating(false)}
          onCreated={(t, form) => {
            setCreating(false);
            setCreated({ t, form });
            load();
          }}
        />
      )}
      {created && (
        <Modal title="Client created 🎉" onClose={() => setCreated(null)} width={520}>
          <p>Send these details to <b>{created.t.name}</b>:</p>
          <div className="card" style={{ background: '#f8fafc' }}>
            <div className="row-between"><span className="muted">Their POS</span><a href={created.t.shopUrl} target="_blank" rel="noreferrer">{created.t.shopUrl}</a></div>
            <div className="row-between"><span className="muted">Their online shop</span><a href={`${created.t.shopUrl}/shop`} target="_blank" rel="noreferrer">{created.t.shopUrl}/shop</a></div>
            <div className="row-between"><span className="muted">Admin email</span><span>{created.form.adminEmail}</span></div>
            <div className="row-between"><span className="muted">Temporary password</span><code>{created.form.adminPassword}</code></div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>Ask them to change the password, then add their business details, M-Pesa keys and KRA eTIMS details under <b>Settings</b>.</p>
          <div className="modal-actions"><button className="btn" onClick={() => setCreated(null)}>Done</button></div>
        </Modal>
      )}
      {open && (
        <ClientPanel
          t={open}
          onClose={() => setOpen(null)}
          onSaved={(t) => {
            setOpen(t);
            load();
          }}
        />
      )}
    </div>
  );
}
