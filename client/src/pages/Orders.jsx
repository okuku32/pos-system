import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg, money } from '../api';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'online', label: 'Online' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
];
const TYPE_LABEL = { pickup: 'Pickup', delivery: 'Delivery', 'walk-in': 'Held' };
const STAGE_LABEL = {
  new: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  'out-for-delivery': 'Out for delivery',
};
// What the next step button does for an open order
const nextStage = (o) => {
  if (o.stage === 'new') return 'accepted';
  if (o.stage === 'accepted') return 'preparing';
  if (o.stage === 'preparing') return o.type === 'delivery' ? 'out-for-delivery' : 'ready';
  return null;
};
const NEXT_LABEL = { accepted: 'Accept', preparing: 'Start preparing', ready: 'Mark ready', 'out-for-delivery': 'Send out' };

const statusBadge = (o) => (o.status === 'open' ? (o.stage === 'new' ? 'new' : 'pending') : o.status);
const statusText = (o) => (o.status === 'open' ? STAGE_LABEL[o.stage] || 'Open' : o.status);

export default function Orders() {
  const { isAdmin } = useAuth();
  const { onOrderChange } = useRealtime();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [data, setData] = useState({ orders: [], counts: {}, newOnline: 0 });
  const [view, setView] = useState(null);
  const [flash, setFlash] = useState(new Set()); // rows that just arrived/changed
  const viewRef = useRef(null);
  viewRef.current = view;

  const load = useCallback(() => {
    const params = { q: q || undefined };
    if (status === 'online') Object.assign(params, { source: 'online', status: 'open' });
    else if (status) params.status = status;
    return api
      .get('/orders', { params })
      .then((r) => {
        setData(r.data);
        return r.data;
      })
      .catch((e) => toast.error(errMsg(e)));
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Live: refresh the list and the open details view whenever any order changes
  useEffect(
    () =>
      onOrderChange((evt, order) => {
        load();
        setFlash((s) => new Set(s).add(order._id));
        setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(order._id); return n; }), 4000);
        if (viewRef.current?._id === order._id) setView((v) => ({ ...v, ...order }));
      }),
    [onOrderChange, load]
  );

  // Arrived from a support conversation: search for that order number
  useEffect(() => {
    const no = location.state?.searchOrder;
    if (!no) return;
    setStatus('');
    setQ(no);
    navigate('.', { replace: true, state: null });
  }, [location.state, navigate]);

  // Arrived from the "View order" button on a notification
  useEffect(() => {
    const id = location.state?.openOrder;
    if (!id) return;
    navigate('.', { replace: true, state: null });
    api.get(`/orders/${id}`).then((r) => setView(r.data)).catch(() => {});
  }, [location.state, navigate]);

  const checkout = (order) => navigate('/', { state: { order } });

  const setStage = async (order, stage) => {
    let etaMinutes;
    if (stage === 'out-for-delivery' || (stage === 'ready' && order.source === 'online')) {
      if (stage === 'out-for-delivery') {
        const ans = window.prompt('Estimated delivery time in minutes? (shown to the customer as a live countdown)', '30');
        if (ans === null) return; // cancelled
        etaMinutes = Number(ans) || undefined;
      }
    }
    try {
      const { data: updated } = await api.patch(`/orders/${order._id}/stage`, { stage, etaMinutes });
      toast.success(`${updated.orderNo}: ${STAGE_LABEL[stage]}`);
      if (view?._id === order._id) setView(updated);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const cancel = async (order) => {
    if (!confirm(`Cancel order ${order.orderNo}?${order.source === 'online' ? ' The customer will see it as cancelled.' : ''}`)) return;
    try {
      await api.post(`/orders/${order._id}/cancel`);
      toast.success('Order cancelled');
      setView(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const remove = async (order) => {
    if (!confirm(`Delete order ${order.orderNo} permanently?`)) return;
    try {
      await api.delete(`/orders/${order._id}`);
      setView(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const tabCount = (k) => (k === 'online' ? data.newOnline : k ? data.counts[k] || 0 : total);

  return (
    <div>
      <div className="page-head">
        <h2>Orders</h2>
        <div className="toolbar">
          <input placeholder="Search order no, customer, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => navigate('/')}>+ New order</button>
        </div>
      </div>
      <div className="chips">
        {TABS.map((t) => (
          <button key={t.key} className={`chip ${status === t.key ? 'active' : ''}`} onClick={() => setStatus(t.key)}>
            {t.label}{' '}
            {t.key === 'online' ? (
              data.newOnline > 0 && <span className="nav-badge">{data.newOnline} new</span>
            ) : (
              <small>({tabCount(t.key)})</small>
            )}
          </button>
        ))}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Order</th><th>Created</th><th>Customer</th><th>Type</th><th>Items</th>
              <th className="right">Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map((o) => {
              const next = o.status === 'open' && nextStage(o);
              return (
                <tr key={o._id} className={`${flash.has(o._id) ? 'row-flash' : ''} ${o.status === 'open' && o.stage === 'new' && o.source === 'online' ? 'row-new' : ''}`}>
                  <td>
                    {o.orderNo}
                    {o.source === 'online' && <><br /><span className="badge online">online</span></>}
                  </td>
                  <td className="nowrap">{new Date(o.createdAt).toLocaleString()}</td>
                  <td>
                    {o.customer?.name || '-'}
                    {o.customer?.phone && <><br /><small className="muted">{o.customer.phone}</small></>}
                  </td>
                  <td>
                    {TYPE_LABEL[o.type]}
                    {o.type === 'delivery' && o.customer?.address && <><br /><small className="muted">{o.customer.address}</small></>}
                  </td>
                  <td>{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
                  <td className="right">{money(o.total)}</td>
                  <td><span className={`badge ${statusBadge(o)}`}>{statusText(o)}</span></td>
                  <td className="right nowrap">
                    <button className="btn ghost sm" onClick={() => setView(o)}>View</button>
                    {next && <button className="btn ghost sm" onClick={() => setStage(o, next)}>{NEXT_LABEL[next]}</button>}
                    {o.status === 'open' && <button className="btn sm" onClick={() => checkout(o)}>Checkout</button>}
                  </td>
                </tr>
              );
            })}
            {!data.orders.length && <tr><td colSpan={8} className="center muted">No orders here.</td></tr>}
          </tbody>
        </table>
      </div>

      {view && (
        <Modal title={`Order ${view.orderNo}`} onClose={() => setView(null)} width={540}>
          <div className="row-between"><span className="muted">Status</span><span className={`badge ${statusBadge(view)}`}>{statusText(view)}</span></div>
          <div className="row-between"><span className="muted">Source</span><span>{view.source === 'online' ? 'Online shop' : 'Counter'}</span></div>
          <div className="row-between"><span className="muted">Customer</span><span>{view.customer?.name || '-'} {view.customer?.phone && `· ${view.customer.phone}`}</span></div>
          <div className="row-between"><span className="muted">Type</span><span>{TYPE_LABEL[view.type]}</span></div>
          {view.type === 'delivery' && <div className="row-between"><span className="muted">Deliver to</span><span>{view.customer?.address || '-'}</span></div>}
          {view.createdBy?.name && <div className="row-between"><span className="muted">Created by</span><span>{view.createdBy.name}</span></div>}
          {view.notes && <div className="row-between"><span className="muted">Notes</span><span>{view.notes}</span></div>}
          {view.sale && (
            <div className="row-between"><span className="muted">Paid with</span><span>{view.sale.receiptNo} ({view.sale.paymentMethod === 'mpesa' ? 'M-Pesa' : 'Cash'})</span></div>
          )}
          <table className="table" style={{ marginTop: 12 }}>
            <tbody>
              {view.items.map((i, idx) => (
                <tr key={idx}><td>{i.name}</td><td>{i.quantity} × {money(i.price)}</td><td className="right">{money(i.subtotal)}</td></tr>
              ))}
            </tbody>
          </table>
          {view.discount > 0 && <div className="row-between"><span>Discount</span><span>-{money(view.discount)}</span></div>}
          <div className="row-between total"><span>Total</span><span>{money(view.total)}</span></div>

          {view.status === 'open' && view.source === 'online' && (
            <div className="stage-steps">
              {['accepted', 'preparing', view.type === 'delivery' ? 'out-for-delivery' : 'ready'].map((s) => (
                <button key={s} className={`chip ${view.stage === s ? 'active' : ''}`} onClick={() => setStage(view, s)}>
                  {STAGE_LABEL[s]}
                </button>
              ))}
            </div>
          )}

          <div className="modal-actions">
            {isAdmin && view.status !== 'completed' && <button className="btn ghost danger-text" onClick={() => remove(view)}>Delete</button>}
            {view.status === 'open' && <button className="btn ghost" onClick={() => cancel(view)}>Cancel order</button>}
            {view.status === 'open' && <button className="btn" onClick={() => checkout(view)}>Checkout &amp; pay</button>}
          </div>
        </Modal>
      )}
    </div>
  );
}
