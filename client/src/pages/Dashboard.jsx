import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, money } from '../api';

export default function Dashboard() {
  const [s, setS] = useState(null);

  useEffect(() => {
    api.get('/sales/stats').then((r) => setS(r.data)).catch((e) => toast.error(errMsg(e)));
  }, []);

  if (!s) return <p className="muted">Loading…</p>;

  const method = (m) => s.byMethod.find((x) => x._id === m) || { revenue: 0, count: 0 };

  // Build last 7 days so missing days show as zero
  const days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    const row = s.daily.find((x) => x._id === key);
    return { key, label: d.toLocaleDateString(undefined, { weekday: 'short' }), revenue: row?.revenue || 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.revenue));

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="stats">
        <div className="card stat"><span className="muted">Total sales today</span><b>{money(s.today.revenue)}</b></div>
        <div className="card stat"><span className="muted">Total profit today</span><b className={s.today.profit < 0 ? 'error-text' : ''}>{money(s.today.profit)}</b></div>
        <div className="card stat"><span className="muted">Transactions today</span><b>{s.today.count}</b></div>
        <div className="card stat"><span className="muted">Open orders</span><b>{s.openOrders}</b></div>
        <div className="card stat"><span className="muted">Cash today</span><b>{money(method('cash').revenue)}</b></div>
        <div className="card stat"><span className="muted">M-Pesa today</span><b>{money(method('mpesa').revenue)}</b></div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Revenue — last 7 days</h3>
          <div className="bars">
            {days.map((d) => (
              <div key={d.key} className="bar-col" title={money(d.revenue)}>
                <div className="bar" style={{ height: `${(d.revenue / max) * 100}%` }} />
                <small>{d.label}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Top products (7 days)</h3>
          <table className="table">
            <tbody>
              {s.topProducts.map((p) => (
                <tr key={p._id}><td>{p._id}</td><td className="right">{p.qty} sold</td><td className="right">{money(p.revenue)}</td></tr>
              ))}
              {!s.topProducts.length && <tr><td className="muted">No sales yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Low stock ({s.lowStock.length})</h3>
        <table className="table">
          <tbody>
            {s.lowStock.map((p) => (
              <tr key={p._id}><td>{p.name}</td><td className="muted">{p.category}</td><td className="right error-text">{p.stock} left</td></tr>
            ))}
            {!s.lowStock.length && <tr><td className="muted">All products are well stocked.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
