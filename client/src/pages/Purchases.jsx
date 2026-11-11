import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg, money } from '../api';
import Modal from '../components/Modal';
import { STORE_INFO } from '../shop/storeInfo';

const STATUS = {
  draft: { label: 'Draft', cls: 'cancelled' },
  ordered: { label: 'Ordered', cls: 'pending' },
  partial: { label: 'Part received', cls: 'pending' },
  received: { label: 'Received', cls: 'completed' },
  cancelled: { label: 'Cancelled', cls: 'cancelled' },
};
const PAY = { unpaid: { label: 'Unpaid', cls: 'stock-out' }, partial: { label: 'Part paid', cls: 'stock-low' }, paid: { label: 'Paid', cls: 'stock-ok' } };
const METHODS = [['cash', 'Cash'], ['mpesa', 'M-Pesa'], ['bank', 'Bank transfer'], ['cheque', 'Cheque'], ['other', 'Other']];
const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const balanceOf = (p) => Math.max(0, (p.receivedValue > 0 ? p.receivedValue : p.total) - (p.amountPaid || 0));

// ---------------- new / edit purchase ----------------
function PurchaseForm({ initial, suppliers, onClose, onSaved }) {
  const [supplier, setSupplier] = useState(initial?.supplier || '');
  const [lines, setLines] = useState(initial?.items?.map((i) => ({ product: i.product, name: i.name, sku: i.sku, quantity: i.quantity, unitCost: i.unitCost })) || []);
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ? String(initial.expectedDate).slice(0, 10) : '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null); // product chosen from the list, waiting for Add / Enter
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [active, setActive] = useState(0); // highlighted suggestion (arrow keys)
  const [open, setOpen] = useState(false);
  const searchRef = useRef(null);
  const qtyRef = useRef(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api.get('/products', { params: { all: true } }).then((r) => setProducts(r.data)).catch(() => {});
  }, []);

  const fillFromRestock = useCallback(async (sid, quiet) => {
    if (!sid) return;
    try {
      const { data } = await api.get('/purchases/suggest', { params: { supplier: sid } });
      if (!data.length) return quiet || toast('Nothing from this supplier is low on stock right now', { icon: '👍' });
      setLines((cur) => {
        const have = new Set(cur.map((l) => String(l.product)));
        return [...cur, ...data.filter((d) => !have.has(String(d.product))).map((d) => ({ product: d.product, name: d.name, sku: d.sku, quantity: d.quantity, unitCost: d.unitCost }))];
      });
      toast.success(`Added ${data.length} item(s) that need re-ordering`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  // opened from a supplier's "Create purchase order": pre-fill their restock list
  useEffect(() => {
    if (initial?.prefill && initial.supplier) fillFromRestock(initial.supplier, true);
  }, [initial, fillFromRestock]);

  // Suggestions: what matches the typed text (exact barcode / SKU first, then this supplier's products).
  // With nothing typed, the chosen supplier's own products are listed so you can just pick one.
  const matches = useMemo(() => {
    if (picked) return [];
    const q = search.trim().toLowerCase();
    const bySupplier = (p) => (String(p.supplier?._id) === supplier ? 0 : 1);
    if (!q) return open && supplier ? products.filter((p) => String(p.supplier?._id) === supplier).slice(0, 8) : [];
    const exact = (p) => ((p.barcode || '') === q || (p.sku || '').toLowerCase() === q ? 0 : 1);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.barcode || '').includes(q))
      .sort((a, b) => exact(a) - exact(b) || bySupplier(a) - bySupplier(b) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [search, products, supplier, open, picked]);

  useEffect(() => setActive(0), [search, open]);

  const resetPicker = () => {
    setSearch('');
    setPicked(null);
    setQty('1');
    setCost('');
    setOpen(false);
    setTimeout(() => searchRef.current?.focus(), 0); // ready for the next product
  };

  // Clicking a suggestion selects it and fills in its cost; then Enter or "+ Add" puts it on the order
  const pick = (p) => {
    setPicked(p);
    setSearch(p.name);
    setCost(String(p.cost ?? 0));
    setOpen(false);
    setTimeout(() => qtyRef.current?.select(), 0);
  };

  // Add the chosen (or highlighted) product. Adding one that's already listed increases its quantity.
  const addLine = () => {
    const p = picked || matches[active] || matches[0];
    if (!p) {
      if (search.trim()) toast.error(`No product matches “${search.trim()}”`);
      else searchRef.current?.focus();
      return;
    }
    const q = Math.max(1, Math.round(Number(qty) || 1));
    const c = cost === '' ? p.cost || 0 : Math.max(0, Number(cost) || 0);
    const existing = lines.find((l) => String(l.product) === String(p._id));
    if (existing) {
      setLines(lines.map((l) => (l === existing ? { ...l, quantity: Number(l.quantity) + q, unitCost: c } : l)));
      toast(`${p.name}: quantity now ${Number(existing.quantity) + q}`, { icon: '➕' });
    } else {
      setLines([...lines, { product: p._id, name: p.name, sku: p.sku, quantity: q, unitCost: c }]);
    }
    resetPicker();
  };

  const onPickerKey = (e) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addLine();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  const setLine = (i, k) => (e) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  const save = async (status) => {
    if (!supplier) return toast.error('Choose a supplier');
    if (!lines.length) return toast.error('Add at least one product');
    setBusy(status);
    const body = { supplier, items: lines.map((l) => ({ product: l.product, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })), expectedDate: expectedDate || null, notes, status };
    try {
      const { data } = initial?._id ? await api.put(`/purchases/${initial._id}`, body) : await api.post('/purchases', body);
      toast.success(status === 'ordered' ? `${data.purchaseNo} placed with the supplier` : `${data.purchaseNo} saved as a draft`);
      onSaved(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal title={initial?._id ? `Edit ${initial.purchaseNo}` : 'New purchase'} onClose={() => !busy && onClose()} width={860}>
      <div className="form-grid">
        <label>
          Supplier
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={!!initial?._id}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </label>
        <label>Expected delivery<input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>
      </div>
      <div className="po-add" role="group" aria-label="Add a product to this purchase">
        <label className="po-add-product">
          Product
          <div style={{ position: 'relative' }}>
            <input
              ref={searchRef}
              placeholder="Type a name, SKU or scan a barcode…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPicked(null); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onPickerKey}
              autoComplete="off"
              autoFocus={!initial?._id}
            />
            {matches.length > 0 && (
              <div className="po-picker" role="listbox">
                {matches.map((p, i) => (
                  <button key={p._id} type="button" role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
                    <span><b>{p.name}</b>{p.sku && <small className="muted"> · {p.sku}</small>}{String(p.supplier?._id) === supplier && <small className="deal-text"> · this supplier</small>}</span>
                    <small className="muted">{p.stock} in stock · cost {money(p.cost)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>
        <label className="po-add-num">Qty<input ref={qtyRef} type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={onPickerKey} /></label>
        <label className="po-add-num">Unit cost<input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} onKeyDown={onPickerKey} placeholder={picked ? String(picked.cost ?? 0) : 'auto'} /></label>
        <button type="button" className="btn po-add-btn" onClick={addLine}>+ Add</button>
        <button type="button" className="btn ghost po-add-btn" disabled={!supplier} onClick={() => fillFromRestock(supplier)} title="Add this supplier's low and out-of-stock products">+ Restock list</button>
      </div>
      <p className="muted po-hint">Type a product and press <kbd>Enter</kbd> or click <b>+ Add</b>. Use <kbd>↑</kbd> <kbd>↓</kbd> to choose from the list. Adding the same product again increases its quantity.</p>

      <div className="table-wrap" style={{ maxHeight: 330, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table className="table">
          <thead><tr><th>Product</th><th className="right" style={{ width: 110 }}>Quantity</th><th className="right" style={{ width: 140 }}>Unit cost (KSh)</th><th className="right">Line total</th><th></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={String(l.product)}>
                <td>{l.name}{l.sku && <small className="muted"> · {l.sku}</small>}</td>
                <td className="right"><input className="sm-input" type="number" min="1" step="1" value={l.quantity} onChange={setLine(i, 'quantity')} /></td>
                <td className="right"><input className="sm-input" type="number" min="0" step="0.01" value={l.unitCost} onChange={setLine(i, 'unitCost')} /></td>
                <td className="right">{money((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</td>
                <td className="right"><button type="button" className="btn ghost sm danger-text" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}>✕</button></td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={5} className="center muted po-empty">No products yet. Type a product name above and press <b>Enter</b>{supplier ? <>, or click <b>+ Restock list</b> to add everything this supplier needs to send</> : <>. Choose the supplier first to see their products</>}.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row-between total" style={{ marginTop: 10 }}><span>Order total</span><span>{money(total)}</span></div>
      <label style={{ marginTop: 6 }}>Notes for this order <small className="muted">(optional)</small><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="e.g. deliver before Friday" /></label>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
        <button className="btn ghost" onClick={() => save('draft')} disabled={!!busy}>{busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
        <button className="btn" onClick={() => save('ordered')} disabled={!!busy}>{busy === 'ordered' ? 'Placing…' : 'Place order'}</button>
      </div>
    </Modal>
  );
}

// ---------------- one purchase: receive goods, pay, print ----------------
function PurchaseDetail({ id, onClose, onChanged, onEdit }) {
  const [p, setP] = useState(null);
  const [mode, setMode] = useState(''); // '' | 'receive' | 'pay'
  const [recv, setRecv] = useState({});
  const [invoiceNo, setInvoiceNo] = useState('');
  const [pay, setPay] = useState({ amount: '', method: 'mpesa', reference: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get(`/purchases/${id}`).then((r) => setP(r.data)).catch((e) => toast.error(errMsg(e))), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!p) return <Modal title="Purchase" onClose={onClose}><p className="muted">Loading…</p></Modal>;

  const open = ['draft', 'ordered', 'partial'].includes(p.status);
  const balance = balanceOf(p);
  const startReceive = () => {
    setRecv(Object.fromEntries(p.items.map((i) => [String(i.product), { quantity: i.quantity - i.received, unitCost: i.unitCost }])));
    setMode('receive');
  };
  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const { data } = await fn();
      toast.success(okMsg(data));
      setMode('');
      await load();
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const message =
    `${STORE_INFO.name}: purchase order ${p.purchaseNo}\n` +
    p.items.map((i) => `- ${i.name}${i.sku ? ` (${i.sku})` : ''}: ${i.quantity} @ KSh ${i.unitCost}`).join('\n') +
    `\nTotal: KSh ${p.total.toLocaleString()}${p.expectedDate ? `\nPlease deliver by ${day(p.expectedDate)}` : ''}${p.notes ? `\nNote: ${p.notes}` : ''}`;

  return (
    <Modal title={p.purchaseNo} onClose={onClose} width={860}>
      <div className="print-area po-print">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Purchase order from {STORE_INFO.name}</div>
            <h3 style={{ margin: '2px 0' }}>{p.supplierName}</h3>
            <div className="muted" style={{ fontSize: 13 }}>Created {day(p.createdAt)} by {p.createdBy || '–'}{p.expectedDate && ` · expected ${day(p.expectedDate)}`}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>{' '}
            {p.status !== 'cancelled' && <span className={`badge ${PAY[p.paymentStatus].cls}`}>{PAY[p.paymentStatus].label}</span>}
          </div>
        </div>
        {p.notes && <p className="supplier-notes" style={{ marginTop: 8 }}>{p.notes}</p>}

        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>Product</th><th className="right">Ordered</th><th className="right">Received</th><th className="right">Unit cost</th><th className="right">Line total</th>{mode === 'receive' && <><th className="right">Receiving now</th><th className="right">Invoice cost</th></>}</tr>
          </thead>
          <tbody>
            {p.items.map((i) => {
              const k = String(i.product);
              const left = i.quantity - i.received;
              return (
                <tr key={k}>
                  <td>{i.name}{i.sku && <small className="muted"> · {i.sku}</small>}{i.currentStock !== null && <><br /><small className="muted">now {i.currentStock} in stock</small></>}</td>
                  <td className="right">{i.quantity}</td>
                  <td className={`right ${i.received >= i.quantity ? 'deal-text' : i.received ? 'warn-text' : ''}`}>{i.received}</td>
                  <td className="right">{money(i.unitCost)}</td>
                  <td className="right">{money(i.quantity * i.unitCost)}</td>
                  {mode === 'receive' && (
                    <>
                      <td className="right">{left > 0 ? <input className="sm-input" type="number" min="0" max={left} step="1" value={recv[k]?.quantity ?? 0} onChange={(e) => setRecv({ ...recv, [k]: { ...recv[k], quantity: e.target.value } })} /> : <span className="deal-text">✓ all in</span>}</td>
                      <td className="right">{left > 0 && <input className="sm-input" type="number" min="0" step="0.01" value={recv[k]?.unitCost ?? i.unitCost} onChange={(e) => setRecv({ ...recv, [k]: { ...recv[k], unitCost: e.target.value } })} />}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="po-totals">
          <div className="row-between"><span>Order total</span><b>{money(p.total)}</b></div>
          {p.receivedValue > 0 && <div className="row-between"><span>Value received</span><span>{money(p.receivedValue)}</span></div>}
          <div className="row-between"><span>Paid</span><span>{money(p.amountPaid)}</span></div>
          {p.status !== 'cancelled' && <div className="row-between total"><span>Balance owed</span><span className={balance > 0 ? 'error-text' : 'deal-text'}>{money(balance)}</span></div>}
        </div>
      </div>

      {mode === 'receive' && (
        <div className="po-action">
          <label>Supplier invoice / delivery note no. <small className="muted">(optional)</small><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={40} /></label>
          <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>Stock goes up by the quantities received. Each product’s cost becomes the average of the stock you already had and this delivery.</p>
          <div className="modal-actions" style={{ marginTop: 0 }}>
            <button className="btn ghost" onClick={() => setMode('')}>Cancel</button>
            <button className="btn" disabled={busy} onClick={() => run(
              () => api.post(`/purchases/${p._id}/receive`, { invoiceNo, lines: Object.entries(recv).map(([product, v]) => ({ product, quantity: Number(v.quantity) || 0, unitCost: v.unitCost })) }),
              (d) => (d.status === 'received' ? 'All goods received, stock updated' : 'Delivery recorded, stock updated'),
            )}>{busy ? 'Saving…' : 'Confirm received'}</button>
          </div>
        </div>
      )}
      {mode === 'pay' && (
        <div className="po-action form-grid">
          <label>Amount (KSh)<input type="number" min="0.01" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus /></label>
          <label>Paid with<select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="span2">Reference <small className="muted">(M-Pesa code, cheque no…)</small><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value.toUpperCase() })} maxLength={60} /></label>
          <div className="modal-actions span2" style={{ marginTop: 0 }}>
            <button className="btn ghost" onClick={() => setMode('')}>Cancel</button>
            <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/purchases/${p._id}/payments`, pay), (d) => (d.paymentStatus === 'paid' ? 'Paid in full' : `Payment recorded, ${money(balanceOf(d))} still owed`))}>{busy ? 'Saving…' : 'Record payment'}</button>
          </div>
        </div>
      )}

      {(p.deliveries.length > 0 || p.payments.length > 0) && !mode && (
        <div className="po-history">
          <h4>History</h4>
          {[...p.deliveries.map((d) => ({ at: d.at, text: `📦 Received ${d.lines.reduce((n, l) => n + l.quantity, 0)} item(s)${d.invoiceNo ? `, invoice ${d.invoiceNo}` : ''}`, by: d.by })),
            ...p.payments.map((x) => ({ at: x.at, text: `💳 Paid ${money(x.amount)} by ${METHODS.find((m) => m[0] === x.method)?.[1] || x.method}${x.reference ? ` (${x.reference})` : ''}`, by: x.by }))]
            .sort((a, b) => new Date(a.at) - new Date(b.at))
            .map((h, i) => <div key={i} className="row-between"><span>{h.text}</span><small className="muted">{new Date(h.at).toLocaleString()} · {h.by}</small></div>)}
        </div>
      )}

      {!mode && (
        <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
          {['draft', 'ordered'].includes(p.status) && !p.deliveries.length && (
            <button className="btn ghost danger-text" disabled={busy} onClick={() => confirm(`Cancel ${p.purchaseNo}?`) && run(() => api.post(`/purchases/${p._id}/cancel`), () => 'Purchase cancelled')}>Cancel order</button>
          )}
          {['draft', 'ordered'].includes(p.status) && !p.deliveries.length && <button className="btn ghost" onClick={() => onEdit(p)}>Edit</button>}
          <button className="btn ghost" onClick={() => window.print()}>Print</button>
          <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Send via WhatsApp</a>
          {p.status === 'draft' && <button className="btn ghost" disabled={busy} onClick={() => run(() => api.put(`/purchases/${p._id}`, { status: 'ordered' }), () => 'Marked as ordered')}>Mark as ordered</button>}
          {p.status !== 'cancelled' && balance > 0 && <button className="btn ghost" onClick={() => { setPay({ amount: String(Math.round(balance * 100) / 100), method: 'mpesa', reference: '' }); setMode('pay'); }}>Record payment</button>}
          {open && <button className="btn" onClick={startReceive}>Receive goods</button>}
        </div>
      )}
    </Modal>
  );
}

// ---------------- list ----------------
export default function Purchases() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState({ purchases: [], count: 0, pages: 1, summary: {} });
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState({ status: '', supplier: '', payment: '', q: '', page: 1 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== null));
    return api.get('/purchases', { params: p }).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  }, [filters]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api.get('/suppliers/options').then((r) => setSuppliers(r.data)).catch(() => {});
  }, []);

  // /purchases?new=1&supplier=<id> (from the Suppliers page) opens a pre-filled order
  useEffect(() => {
    if (params.get('new')) {
      setForm({ supplier: params.get('supplier') || '', prefill: true });
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const set = (k) => (v) => setFilters({ ...filters, [k]: v, page: 1 });
  const s = data.summary || {};

  return (
    <div>
      <div className="page-head">
        <h2>Purchases</h2>
        <div className="toolbar">
          <input placeholder="Search PO no., supplier, product, invoice…" value={filters.q} onChange={(e) => set('q')(e.target.value)} />
          <button className="btn" onClick={() => (suppliers.length ? setForm({}) : navigate('/suppliers'))}>{suppliers.length ? '+ New purchase' : 'Add a supplier first'}</button>
        </div>
      </div>
      <div className="stats">
        <button className="card stat stat-link" onClick={() => set('payment')(filters.payment === 'owed' ? '' : 'owed')}><span className="muted">Owed to suppliers</span><b className={s.owed > 0 ? 'error-text' : ''}>{money(s.owed)}</b><small className="muted">for goods already received</small></button>
        <div className="card stat"><span className="muted">Purchases this month</span><b>{money(s.monthTotal)}</b><small className="muted">{s.monthCount || 0} order(s)</small></div>
        <button className="card stat stat-link" onClick={() => set('status')(filters.status === 'open' ? '' : 'open')}><span className="muted">Awaiting delivery</span><b>{s.awaiting || 0}</b><small className="muted">ordered, not fully received</small></button>
      </div>
      <div className="row-between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="chips" style={{ margin: 0 }}>
          {[['', 'All'], ['draft', 'Drafts'], ['open', 'Awaiting delivery'], ['received', 'Received'], ['cancelled', 'Cancelled']].map(([k, l]) => (
            <button key={k} className={`chip ${filters.status === k ? 'active' : ''}`} onClick={() => set('status')(k)}>{l}</button>
          ))}
          <button className={`chip ${filters.payment === 'owed' ? 'active' : ''}`} onClick={() => set('payment')(filters.payment === 'owed' ? '' : 'owed')}>Not fully paid</button>
        </div>
        <select value={filters.supplier} onChange={(e) => set('supplier')(e.target.value)} style={{ width: 'auto', minWidth: 200 }}>
          <option value="">All suppliers</option>
          {suppliers.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
        </select>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Purchase</th><th>Supplier</th><th>Date</th><th className="right">Items</th><th className="right">Total</th><th>Status</th><th>Payment</th><th className="right">Balance</th><th></th></tr></thead>
          <tbody>
            {data.purchases.map((p) => (
              <tr key={p._id}>
                <td><button className="linklike" onClick={() => setViewing(p._id)}><b>{p.purchaseNo}</b></button></td>
                <td>{p.supplierName}</td>
                <td className="nowrap">{day(p.createdAt)}{p.expectedDate && ['ordered', 'partial'].includes(p.status) && <><br /><small className={new Date(p.expectedDate) < new Date() ? 'error-text' : 'muted'}>due {day(p.expectedDate)}</small></>}</td>
                <td className="right">{p.items.reduce((n, i) => n + i.quantity, 0)}</td>
                <td className="right">{money(p.total)}</td>
                <td><span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span></td>
                <td>{p.status !== 'cancelled' && <span className={`badge ${PAY[p.paymentStatus].cls}`}>{PAY[p.paymentStatus].label}</span>}</td>
                <td className="right">{p.status === 'cancelled' ? '–' : money(balanceOf(p))}</td>
                <td className="right"><button className="btn ghost sm" onClick={() => setViewing(p._id)}>Open</button></td>
              </tr>
            ))}
            {!loading && !data.purchases.length && <tr><td colSpan={9} className="center muted">No purchases here yet. Click “+ New purchase”, or open a supplier and click “Create purchase order”.</td></tr>}
            {loading && !data.purchases.length && <tr><td colSpan={9} className="center muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      {data.pages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Prev</button>
          <span>Page {filters.page} of {data.pages}</span>
          <button className="btn ghost sm" disabled={filters.page >= data.pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next</button>
        </div>
      )}

      {form && (
        <PurchaseForm initial={form} suppliers={suppliers} onClose={() => setForm(null)} onSaved={(p) => { setForm(null); load(); setViewing(p._id); }} />
      )}
      {viewing && !form && (
        <PurchaseDetail id={viewing} onClose={() => setViewing(null)} onChanged={load} onEdit={(p) => setForm({ ...p, supplier: String(p.supplier) })} />
      )}
    </div>
  );
}
