import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, money, downloadCSV, today, daysAgo } from '../api';
import Modal from '../components/Modal';

const METHODS = [['cash', 'Cash'], ['mpesa', 'M-Pesa'], ['bank', 'Bank'], ['cheque', 'Cheque'], ['other', 'Other']];
const methodLabel = (m) => METHODS.find((x) => x[0] === m)?.[1] || m;
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
};
const EMPTY = () => ({ date: today(), category: '', amount: '', description: '', paymentMethod: 'cash', reference: '', paidTo: '' });

export default function Expenses() {
  const [data, setData] = useState({ expenses: [], count: 0, pages: 1, summary: { total: 0, byCategory: [] } });
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ from: firstOfMonth(), to: today(), category: '', q: '', page: 1 });
  const [form, setForm] = useState(EMPTY());
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef(null);
  const categoryRef = useRef(null);

  const load = useCallback(() => {
    const p = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
    return api.get('/expenses', { params: p }).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [filters]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api.get('/expenses/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  const save = async (e) => {
    e?.preventDefault();
    if (!form.category.trim()) return categoryRef.current?.focus();
    if (!(Number(form.amount) > 0)) return amountRef.current?.focus();
    setBusy(true);
    try {
      await api.post('/expenses', form);
      toast.success(`${form.category}: ${money(form.amount)} recorded`);
      setForm({ ...EMPTY(), date: form.date, paymentMethod: form.paymentMethod }); // keep date & method for the next one
      if (!categories.includes(form.category)) setCategories([...categories, form.category]);
      load();
      setTimeout(() => categoryRef.current?.focus(), 0);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/expenses/${editing._id}`, editing);
      toast.success('Expense updated');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (x) => {
    if (!confirm(`Delete this ${x.category} expense of ${money(x.amount)}?`)) return;
    try {
      await api.delete(`/expenses/${x._id}`);
      toast.success('Expense deleted');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const exportCSV = async () => {
    const p = Object.fromEntries(Object.entries({ ...filters, page: 1, limit: 200 }).filter(([, v]) => v !== ''));
    const { data: all } = await api.get('/expenses', { params: p });
    downloadCSV(`expenses-${filters.from || 'all'}_to_${filters.to || 'now'}.csv`, [
      { label: 'Date', value: (x) => new Date(x.date).toLocaleDateString('en-CA') },
      { label: 'Category', value: (x) => x.category },
      { label: 'Description', value: (x) => x.description || '' },
      { label: 'Paid to', value: (x) => x.paidTo || '' },
      { label: 'Method', value: (x) => methodLabel(x.paymentMethod) },
      { label: 'Reference', value: (x) => x.reference || '' },
      { label: 'Amount', value: (x) => x.amount },
    ], all.expenses);
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  const enterSaves = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  };
  const max = Math.max(1, ...data.summary.byCategory.map((c) => c.total));

  return (
    <div>
      <div className="page-head">
        <h2>Expenses</h2>
        <div className="toolbar wrap">
          {[['This month', firstOfMonth(), today()], ['Last 30 days', daysAgo(29), today()], ['All time', '', '']].map(([l, f, t]) => (
            <button key={l} className={`chip ${filters.from === f && filters.to === t ? 'active' : ''}`} onClick={() => setFilters({ ...filters, from: f, to: t, page: 1 })}>{l}</button>
          ))}
          <input type="date" value={filters.from} onChange={setF('from')} />
          <input type="date" value={filters.to} onChange={setF('to')} />
        </div>
      </div>

      <form className="card expense-add" onSubmit={save}>
        <label>Date<input type="date" value={form.date} max={today()} onChange={set('date')} /></label>
        <label>
          Category
          <input ref={categoryRef} list="expense-cats" value={form.category} onChange={set('category')} onKeyDown={enterSaves} placeholder="e.g. Rent" autoFocus />
          <datalist id="expense-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label>Amount (KSh)<input ref={amountRef} type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} onKeyDown={enterSaves} /></label>
        <label className="grow2">What for <small className="muted">(optional)</small><input value={form.description} onChange={set('description')} onKeyDown={enterSaves} maxLength={200} placeholder="e.g. November shop rent" /></label>
        <label>Paid with<select value={form.paymentMethod} onChange={set('paymentMethod')}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Reference<input value={form.reference} onChange={set('reference')} onKeyDown={enterSaves} maxLength={60} placeholder="M-Pesa code" /></label>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : '+ Add expense'}</button>
      </form>

      <div className="two-col">
        <div className="card">
          <div className="row-between"><h3 style={{ margin: 0 }}>Total for this period</h3><b style={{ fontSize: 22 }}>{money(data.summary.total)}</b></div>
          <div className="expense-bars">
            {data.summary.byCategory.map((c) => (
              <button key={c.category} type="button" className={`expense-bar ${filters.category === c.category ? 'on' : ''}`} onClick={() => setFilters({ ...filters, category: filters.category === c.category ? '' : c.category, page: 1 })} title="Show only this category">
                <span className="row-between"><span>{c.category} <small className="muted">({c.count})</small></span><b>{money(c.total)}</b></span>
                <i style={{ width: `${(c.total / max) * 100}%` }} />
              </button>
            ))}
            {!data.summary.byCategory.length && <p className="muted">No expenses recorded for these dates.</p>}
          </div>
        </div>
        <div className="card">
          <h3>Tips</h3>
          <ul className="muted" style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0, fontSize: 14 }}>
            <li>Record running costs here: rent, salaries, electricity, transport, M-Pesa charges…</li>
            <li>Don’t record stock bought from suppliers here: use <b>Purchases</b>. Its cost is already counted when the items sell.</li>
            <li>Press <kbd>Enter</kbd> in any box to save. The date and payment method stay for the next one.</li>
            <li>The Reports page subtracts these from gross profit to show your <b>net profit</b>.</li>
          </ul>
        </div>
      </div>

      <div className="page-head" style={{ marginTop: 6 }}>
        <h3 style={{ margin: 0 }}>{filters.category ? `${filters.category} expenses` : 'All expenses'} <small className="muted">({data.count})</small></h3>
        <div className="toolbar">
          {filters.category && <button className="btn ghost sm" onClick={() => setFilters({ ...filters, category: '', page: 1 })}>Show all categories</button>}
          <input placeholder="Search description, paid to, reference…" value={filters.q} onChange={setF('q')} />
          <button className="btn ghost" onClick={exportCSV} disabled={!data.count}>Export CSV</button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid with</th><th className="right">Amount</th><th></th></tr></thead>
          <tbody>
            {data.expenses.map((x) => (
              <tr key={x._id}>
                <td className="nowrap">{new Date(x.date).toLocaleDateString()}</td>
                <td>{x.category}</td>
                <td>{x.description || <span className="muted">–</span>}{x.paidTo && <><br /><small className="muted">to {x.paidTo}</small></>}</td>
                <td>{methodLabel(x.paymentMethod)}{x.reference && <><br /><small className="muted">{x.reference}</small></>}</td>
                <td className="right"><b>{money(x.amount)}</b></td>
                <td className="right"><button className="btn ghost sm" onClick={() => setEditing({ ...x, date: new Date(x.date).toLocaleDateString('en-CA') })}>Edit</button></td>
              </tr>
            ))}
            {!data.expenses.length && <tr><td colSpan={6} className="center muted">No expenses for these dates. Add one above.</td></tr>}
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

      {editing && (
        <Modal title="Edit expense" onClose={() => !busy && setEditing(null)}>
          <form className="form-grid" onSubmit={saveEdit}>
            <label>Date<input type="date" value={editing.date} max={today()} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></label>
            <label>Amount (KSh)<input type="number" min="0.01" step="0.01" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} required /></label>
            <label className="span2">Category<input list="expense-cats" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} required /></label>
            <label className="span2">What for<input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
            <label>Paid to<input value={editing.paidTo || ''} onChange={(e) => setEditing({ ...editing, paidTo: e.target.value })} /></label>
            <label>Paid with<select value={editing.paymentMethod} onChange={(e) => setEditing({ ...editing, paymentMethod: e.target.value })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="span2">Reference<input value={editing.reference || ''} onChange={(e) => setEditing({ ...editing, reference: e.target.value })} /></label>
            <div className="modal-actions span2">
              <button type="button" className="btn ghost danger-text" onClick={() => remove(editing)}>Delete</button>
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
