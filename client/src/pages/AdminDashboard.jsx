import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getAdminStats, errMsg, money } from '../api';
import { useRealtime } from '../context/RealtimeContext';

// Admin home: how the marketplace is doing and what needs attention
export default function AdminDashboard() {
  const [text, setText] = useState(null);
  const [error, setError] = useState('');
  const { onOrderChange } = useRealtime();
  const load = () => getAdminStats().then((response) => setText(response.data)).catch((innerError) => setError(errMsg(innerError)));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => onOrderChange(() => load()), [onOrderChange]);

  if (error) return <p className="error-text">{error}</p>;
  if (!text) return <p className="muted">Loading…</p>;
  const max = Math.max(1, ...text.adsPerDay.map((item) => item.n));
  const todo = [
    text.ads.reported > 0 && { to: '/admin/ads', text: `${text.ads.reported} reported ad${text.ads.reported > 1 ? 's' : ''} to review`, tone: 'bad' },
    text.orders.refundsDue > 0 && { to: '/admin/orders', text: `${text.orders.refundsDue} M-Pesa refund${text.orders.refundsDue > 1 ? 's' : ''} to send`, tone: 'bad' },
    text.orders.payoutsDue > 0 && { to: '/admin/orders', text: `${money(text.orders.payoutsDue)} to pay out to sellers`, tone: 'warn' },
    text.verifyPending > 0 && { to: '/admin/sellers', text: `${text.verifyPending} seller${text.verifyPending > 1 ? 's' : ''} waiting to be verified`, tone: 'warn' },
    text.supportOpen > 0 && { to: '/admin/support', text: `${text.supportOpen} open support chat${text.supportOpen > 1 ? 's' : ''}`, tone: 'warn' },
  ].filter(Boolean);

  return (
    <div>
      <div className="page-head"><h2>Dashboard</h2><a className="btn ghost" href="/market/sell" target="_blank" rel="noreferrer">Post an ad ↗</a></div>

      {todo.length > 0 ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <b>Needs attention</b>
          <ul className="todo-list">
            {todo.map((item) => <li key={item.text} className={item.tone}><Link to={item.to}>{item.text} →</Link></li>)}
          </ul>
        </div>
      ) : (
        <div className="card stat-good" style={{ marginBottom: 14 }}>✅ All caught up: no reports, refunds or payouts waiting.</div>
      )}

      <div className="stats">
        <div className="card stat"><span className="muted">Live ads</span><b>{text.ads.active.toLocaleString()}</b><small className="muted">+{text.ads.newThisWeek} this week · {text.ads.sold} sold</small></div>
        <div className="card stat"><span className="muted">Users</span><b>{text.users.total.toLocaleString()}</b><small className="muted">+{text.users.newThisWeek} this week</small></div>
        <div className="card stat"><span className="muted">Buyer–seller chats</span><b>{text.chats.toLocaleString()}</b></div>
        <div className="card stat"><span className="muted">Online orders</span><b>{text.orders.total}</b><small className="muted">{text.orders.open} in progress</small></div>
        {/* the business's money: owners and admins only (the server leaves it out for moderators: money = false) */}
        {text.money !== false && <div className="card stat"><span className="muted">Sales delivered (GMV)</span><b>{money(text.orders.gmv)}</b></div>}
        {text.money !== false && <div className="card stat stat-good"><span className="muted">Commission earned</span><b>{money(text.orders.commission)}</b><small className="muted">from M-Pesa orders</small></div>}
        {text.money !== false && <div className="card stat stat-good"><span className="muted">🔥 Boost revenue</span><b>{money(text.boosts?.revenue)}</b><small className="muted">{text.boosts?.count || 0} paid boosts</small></div>}
        <div className="card stat"><span className="muted">🐢 Lipa Pole Pole</span><b>{text.plans?.active?.n || 0} paying</b><small className="muted">{text.plans?.completed?.n || 0} completed{text.money !== false ? ` · ${money(text.plans?.active?.paid || 0)} collected so far` : ''}</small></div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <b>New ads per day (last 14 days)</b>
        <div className="mini-bars" role="img" aria-label="New ads per day">
          {text.adsPerDay.map((item) => (
            <div key={item.day} title={`${item.day}: ${item.n} ads`}>
              <span style={{ height: `${(item.n / max) * 100}%` }} />
              <small>{item.day.slice(8)}</small>
            </div>
          ))}
          {!text.adsPerDay.length && <p className="muted">No new ads in the last 14 days.</p>}
        </div>
      </div>
    </div>
  );
}
