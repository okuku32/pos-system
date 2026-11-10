import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, money, downloadCSV } from '../api';
import { useAuth } from '../context/AuthContext';
import Receipt from '../components/Receipt';

export default function Sales() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState({ sales: [], count: 0, pages: 1, summary: {} });
  const [cashiers, setCashiers] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', status: '', paymentMethod: '', cashier: '', q: '', page: 1 });
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    if (isAdmin) api.get('/auth/users').then((r) => setCashiers(r.data)).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
    api.get('/sales', { params }).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [filters]);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  const summary = data.summary || {};

  // Export every sale matching the current filters (up to 1000), not just this page
  const exportCSV = async () => {
    try {
      const params = Object.fromEntries(Object.entries({ ...filters, page: 1, limit: 1000 }).filter(([, v]) => v !== ''));
      const { data: all } = await api.get('/sales', { params });
      const cols = [
        { label: 'Receipt', value: (s) => s.receiptNo },
        { label: 'Date', value: (s) => new Date(s.createdAt).toLocaleString() },
        { label: 'Cashier', value: (s) => s.cashier?.name || '' },
        { label: 'Order', value: (s) => s.order?.orderNo || '' },
        { label: 'Items', value: (s) => s.items.map((i) => `${i.quantity}x ${i.name}`).join('; ') },
        { label: 'Method', value: (s) => s.paymentMethod },
        { label: 'M-Pesa Ref', value: (s) => s.mpesa?.receiptNumber || '' },
        { label: 'Subtotal', value: (s) => s.subtotal },
        { label: 'Discount', value: (s) => s.discount },
        { label: 'Total', value: (s) => s.total },
        ...(isAdmin ? [{ label: 'Cost', value: (s) => s.totalCost }, { label: 'Profit', value: (s) => s.profit }] : []),
        { label: 'Status', value: (s) => s.status },
      ];
      downloadCSV(`sales-${new Date().toLocaleDateString('en-CA')}.csv`, cols, all.sales);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Sales</h2>
        <div className="toolbar wrap">
          <input placeholder="Receipt, M-Pesa ref, phone…" value={filters.q} onChange={set('q')} />
          <input type="date" value={filters.from} onChange={set('from')} />
          <input type="date" value={filters.to} onChange={set('to')} />
          <select value={filters.paymentMethod} onChange={set('paymentMethod')}>
            <option value="">All methods</option>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
          </select>
          <select value={filters.status} onChange={set('status')}>
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {isAdmin && (
            <select value={filters.cashier} onChange={set('cashier')}>
              <option value="">All cashiers</option>
              {cashiers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          )}
          <button className="btn ghost" onClick={exportCSV} disabled={!data.count}>Export CSV</button>
        </div>
      </div>
      <div className="stats">
        <div className="card stat"><span className="muted">Matching sales</span><b>{data.count}</b><small className="muted">{summary.count || 0} completed</small></div>
        <div className="card stat"><span className="muted">Revenue (completed)</span><b>{money(summary.revenue)}</b></div>
        {isAdmin && <div className="card stat"><span className="muted">Profit (completed)</span><b className={summary.profit < 0 ? 'error-text' : ''}>{money(summary.profit)}</b></div>}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Receipt</th><th>Date</th><th>Cashier</th><th>Items</th><th>Method</th>
              <th>M-Pesa Ref</th><th className="right">Total</th>{isAdmin && <th className="right">Profit</th>}<th>Status</th><th>eTIMS</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.sales.map((s) => (
              <tr key={s._id}>
                <td>{s.receiptNo}{s.order && <><br /><small className="muted">{s.order.orderNo}</small></>}</td>
                <td className="nowrap">{new Date(s.createdAt).toLocaleString()}</td>
                <td>{s.cashier?.name || '-'}</td>
                <td>{s.items.reduce((n, i) => n + i.quantity, 0)}</td>
                <td>{s.paymentMethod === 'mpesa' ? 'M-Pesa' : 'Cash'}</td>
                <td className="muted">{s.mpesa?.receiptNumber || '-'}</td>
                <td className="right">{money(s.total)}</td>
                {isAdmin && <td className={`right ${s.profit < 0 ? 'error-text' : ''}`}>{money(s.profit)}</td>}
                <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                <td>{s.etims ? <span className={`badge etims-${s.etims.status}`} title={s.etims.error || ''}>{s.etims.status === 'submitted' ? (s.etims.mode === 'mock' ? 'test' : 'sent') : s.etims.status}</span> : <span className="muted">–</span>}</td>
                <td><button className="btn ghost sm" onClick={() => setReceipt(s)}>View</button></td>
              </tr>
            ))}
            {!data.sales.length && <tr><td colSpan={isAdmin ? 11 : 10} className="center muted">No sales found.</td></tr>}
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
      {receipt && <Receipt sale={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
