import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg, money, downloadCSV } from '../api';
import Modal from '../components/Modal';
import { STORE_INFO } from '../shop/storeInfo';

const EMPTY = { name: '', contactPerson: '', phone: '', email: '', kraPin: '', address: '', paymentTerms: '', notes: '', active: true };
const TERMS = ['Cash on delivery', 'M-Pesa on delivery', 'Net 7', 'Net 14', 'Net 30', 'Consignment'];
const prettyPhone = (p = '') => (/^254\d{9}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

// Contact buttons: call, WhatsApp, email
function Contact({ s, message }) {
  const wa = s.phone ? `https://wa.me/${s.phone}${message ? `?text=${encodeURIComponent(message)}` : ''}` : null;
  return (
    <span className="supplier-contact">
      {s.phone && <a className="btn ghost sm" href={`tel:+${s.phone}`} title="Call">📞</a>}
      {wa && <a className="btn ghost sm" href={wa} target="_blank" rel="noreferrer" title="WhatsApp">💬</a>}
      {s.email && <a className="btn ghost sm" href={`mailto:${s.email}${message ? `?subject=${encodeURIComponent(`Order from ${STORE_INFO.name}`)}&body=${encodeURIComponent(message)}` : ''}`} title="Email">✉️</a>}
    </span>
  );
}

function SupplierForm({ value, onClose, onSaved }) {
  const [f, setF] = useState({ ...EMPTY, ...value, phone: prettyPhone(value.phone || '') });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, f[k]]));
      const { data } = value._id ? await api.put(`/suppliers/${value._id}`, body) : await api.post('/suppliers', body);
      toast.success('Supplier saved');
      onSaved(data);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={value._id ? `Edit ${value.name}` : 'New supplier'} onClose={() => !busy && onClose()} width={560}>
      <form className="form-grid" onSubmit={save}>
        <label className="span2">Supplier name<input value={f.name} onChange={set('name')} required minLength={2} maxLength={100} autoFocus placeholder="e.g. Bidco Africa" /></label>
        <label>Contact person<input value={f.contactPerson} onChange={set('contactPerson')} maxLength={80} /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="0712 345 678" /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} /></label>
        <label>KRA PIN<input value={f.kraPin} onChange={(e) => setF({ ...f, kraPin: e.target.value.toUpperCase() })} maxLength={11} placeholder="P051234567X" /></label>
        <label className="span2">Address<input value={f.address} onChange={set('address')} maxLength={200} placeholder="e.g. Industrial Area, Nairobi" /></label>
        <label className="span2">
          Payment terms
          <input value={f.paymentTerms} onChange={set('paymentTerms')} list="supplier-terms" maxLength={60} placeholder="e.g. Net 30" />
          <datalist id="supplier-terms">{TERMS.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="span2">Notes<textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={1000} placeholder="Delivery days, minimum order, rep's details…" style={{ font: 'inherit', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }} /></label>
        {value._id && <label className="check span2"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active (untick to archive)</label>}
        <div className="modal-actions span2">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onEdit, onChanged }) {
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  const [tab, setTab] = useState('restock');
  const load = useCallback(() => api.get(`/suppliers/${id}`).then((r) => setS(r.data)).catch((e) => toast.error(errMsg(e))), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!s) return <Modal title="Supplier" onClose={onClose}><p className="muted">Loading…</p></Modal>;

  const orderMessage = s.restock.length
    ? `Hello${s.contactPerson ? ` ${s.contactPerson.split(' ')[0]}` : ''}, ${STORE_INFO.name} would like to order:\n` +
      s.restock.map((p) => `- ${p.name}${p.sku ? ` (${p.sku})` : ''}: ${p.suggestedOrder}`).join('\n') +
      '\nThank you.'
    : '';

  const remove = async () => {
    if (!confirm(`Delete ${s.name}? This can't be undone.`)) return;
    try {
      await api.delete(`/suppliers/${s._id}`);
      toast.success('Supplier deleted');
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const exportRestock = () =>
    downloadCSV(`restock-${s.name.replace(/\W+/g, '-').toLowerCase()}.csv`, [
      { label: 'Product', value: (p) => p.name },
      { label: 'SKU', value: (p) => p.sku || '' },
      { label: 'In stock', value: (p) => p.stock },
      { label: 'Alert level', value: (p) => p.lowStockThreshold },
      { label: 'Suggested order', value: (p) => p.suggestedOrder },
      { label: 'Unit cost', value: (p) => p.cost || 0 },
      { label: 'Line cost', value: (p) => (p.cost || 0) * p.suggestedOrder },
    ], s.restock);

  const rows = tab === 'restock' ? s.restock : s.products;
  const openPurchase = () => navigate(`/purchases?new=1&supplier=${s._id}`);
  return (
    <Modal title={s.name} onClose={onClose} width={760}>
      <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {s.contactPerson && <div>👤 {s.contactPerson}</div>}
          {s.phone && <div>📞 {prettyPhone(s.phone)}</div>}
          {s.email && <div>✉️ {s.email}</div>}
          {s.address && <div>📍 {s.address}</div>}
          {s.kraPin && <div>KRA PIN: {s.kraPin}</div>}
          {s.paymentTerms && <div>Terms: <b>{s.paymentTerms}</b></div>}
          {!s.active && <span className="badge cancelled">archived</span>}
        </div>
        <Contact s={s} message={orderMessage} />
      </div>
      {s.notes && <p className="supplier-notes">{s.notes}</p>}

      <div className="platform-usage">
        <div><span>Products</span><b>{s.stats.products}</b><small>{s.stats.out} out · {s.stats.low} low</small></div>
        <div><span>Stock value (cost)</span><b>{money(s.stats.stockValue)}</b><small>currently on the shelf</small></div>
        <div><span>Suggested order</span><b>{money(s.stats.restockCost)}</b><small>{s.restock.length} item(s) to re-order</small></div>
        <div><span>You owe them</span><b className={s.owed > 0 ? 'error-text' : ''}>{money(s.owed)}</b><small>{s.purchases.length} recent purchase(s)</small></div>
      </div>

      <div className="row-between" style={{ margin: '6px 0' }}>
        <div className="chips" style={{ margin: 0 }}>
          <button className={`chip ${tab === 'restock' ? 'active' : ''}`} onClick={() => setTab('restock')}>Needs ordering ({s.restock.length})</button>
          <button className={`chip ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All products ({s.products.length})</button>
          <button className={`chip ${tab === 'purchases' ? 'active' : ''}`} onClick={() => setTab('purchases')}>Purchases ({s.purchases.length})</button>
        </div>
        {tab === 'restock' && s.restock.length > 0 && <button className="btn ghost sm" onClick={exportRestock}>Export CSV</button>}
      </div>
      {tab === 'purchases' ? (
        <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="table">
            <thead><tr><th>Purchase</th><th>Date</th><th>Status</th><th className="right">Total</th><th className="right">Paid</th></tr></thead>
            <tbody>
              {s.purchases.map((p) => (
                <tr key={p._id}><td>{p.purchaseNo}</td><td>{new Date(p.createdAt).toLocaleDateString()}</td><td>{p.status}</td><td className="right">{money(p.total)}</td><td className="right">{money(p.amountPaid)}</td></tr>
              ))}
              {!s.purchases.length && <tr><td colSpan={5} className="center muted">No purchases from this supplier yet.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table className="table">
          <thead>
            <tr><th>Product</th><th className="right">In stock</th>{tab === 'restock' ? <><th className="right">Order</th><th className="right">Est. cost</th></> : <><th className="right">Cost</th><th className="right">Price</th></>}<th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id} style={p.active ? undefined : { opacity: 0.5 }}>
                <td>{p.name}{p.sku && <small className="muted"> · {p.sku}</small>}</td>
                <td className={`right ${p.status === 'out' ? 'error-text' : p.status === 'low' ? 'warn-text' : ''}`}><b>{p.stock}</b></td>
                {tab === 'restock'
                  ? <><td className="right"><b>{p.suggestedOrder}</b></td><td className="right">{money((p.cost || 0) * p.suggestedOrder)}</td></>
                  : <><td className="right muted">{money(p.cost)}</td><td className="right">{money(p.salePrice)}</td></>}
                <td><span className={`badge stock-${p.status}`}>{p.status === 'out' ? 'Out of stock' : p.status === 'low' ? 'Low' : 'In stock'}</span></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="center muted">
                {tab === 'restock' ? 'Nothing to re-order from this supplier right now 👍' : <>No products linked yet. Set the supplier on a product in <Link to="/products">Products</Link>.</>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      <div className="modal-actions">
        {!s.products.length && !s.purchases.length && <button className="btn ghost danger-text" onClick={remove}>Delete</button>}
        <button className="btn ghost" onClick={() => onEdit(s)}>Edit details</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
        {s.active && <button className="btn" onClick={openPurchase}>{s.restock.length ? `Create purchase order (${s.restock.length})` : 'Create purchase order'}</button>}
      </div>
    </Modal>
  );
}

export default function Suppliers() {
  const [data, setData] = useState({ suppliers: [], count: 0, pages: 1, unassigned: 0 });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get('/suppliers', { params: { q: q || undefined, status, page, limit: 50 } })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
  }, [q, status, page]);

  useEffect(() => {
    const t = setTimeout(load, 200); // wait for typing to pause before searching
    return () => clearTimeout(t);
  }, [load]);

  const needAttention = data.suppliers.filter((s) => s.stats.low + s.stats.out > 0).length;

  return (
    <div>
      <div className="page-head">
        <h2>Suppliers</h2>
        <div className="toolbar">
          <input placeholder="Search name, contact, phone, PIN…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <button className="btn" onClick={() => setEditing({ ...EMPTY })}>+ Add supplier</button>
        </div>
      </div>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="chips" style={{ margin: 0 }}>
          {[['active', 'Active'], ['archived', 'Archived'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={`chip ${status === k ? 'active' : ''}`} onClick={() => { setStatus(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        <small className="muted">
          {data.count} supplier(s){needAttention > 0 && <> · <span className="warn-text">{needAttention} with items to re-order</span></>}
          {data.unassigned > 0 && <> · <Link to="/products">{data.unassigned} product(s) have no supplier</Link></>}
        </small>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr><th>Supplier</th><th>Contact</th><th>Terms</th><th className="right">Products</th><th className="right">Stock value</th><th className="right">Owed</th><th>Re-order</th><th></th></tr>
          </thead>
          <tbody>
            {data.suppliers.map((s) => (
              <tr key={s._id} style={s.active ? undefined : { opacity: 0.6 }}>
                <td>
                  <button className="linklike" onClick={() => setViewing(s._id)}><b>{s.name}</b></button>
                  {!s.active && <span className="badge cancelled" style={{ marginLeft: 6 }}>archived</span>}
                  {s.address && <><br /><small className="muted">{s.address}</small></>}
                </td>
                <td>
                  {s.contactPerson || <span className="muted">–</span>}
                  {s.phone && <><br /><small className="muted">{prettyPhone(s.phone)}</small></>}
                </td>
                <td>{s.paymentTerms || <span className="muted">–</span>}</td>
                <td className="right">{s.stats.products}</td>
                <td className="right">{money(s.stats.stockValue)}</td>
                <td className={`right ${s.owed > 0 ? 'error-text' : 'muted'}`}>{s.owed > 0 ? money(s.owed) : '–'}</td>
                <td>
                  {s.stats.out > 0 && <span className="badge stock-out">{s.stats.out} out</span>}{' '}
                  {s.stats.low > 0 && <span className="badge stock-low">{s.stats.low} low</span>}
                  {!s.stats.out && !s.stats.low && <span className="muted">–</span>}
                </td>
                <td className="right nowrap">
                  <Contact s={s} />
                  <button className="btn ghost sm" onClick={() => setViewing(s._id)}>Open</button>
                </td>
              </tr>
            ))}
            {!loading && !data.suppliers.length && (
              <tr><td colSpan={8} className="center muted">{q ? 'No suppliers match your search.' : 'No suppliers yet. Click “+ Add supplier”.'}</td></tr>
            )}
            {loading && !data.suppliers.length && <tr><td colSpan={8} className="center muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      {data.pages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {data.pages}</span>
          <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {editing && <SupplierForm value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {viewing && !editing && (
        <SupplierDetail id={viewing} onClose={() => setViewing(null)} onEdit={(s) => setEditing(s)} onChanged={load} />
      )}
    </div>
  );
}
