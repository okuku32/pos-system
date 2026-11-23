import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg, money, downloadCSV } from '../api';
import { useRealtime } from '../context/RealtimeContext';
import { saveReceipt } from '../market/receipt';
import AdminShopRide from './AdminShopRide';

// All marketplace orders, plus the money side: seller payouts and buyer refunds for M-Pesa orders
const STATUS = { awaiting_payment: 'Unpaid', placed: 'Placed', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const BADGE = { placed: 'pending', confirmed: 'pending', shipped: 'online', delivered: 'completed', cancelled: 'cancelled', awaiting_payment: 'pending' };
// the payment ID first (search by it, or by the M-Pesa code), then how it was paid
const payText = (order) => (order.payment.ref ? `${order.payment.ref} · ` : '') + (order.payment.method === 'cod' ? (order.payment.status === 'paid' ? 'Cash (collected)' : 'Cash on delivery') : { paid: `M-Pesa ${order.payment.receipt || ''}${order.payment.direct ? ' (to the seller)' : ''}`, pending: 'M-Pesa pending', failed: 'M-Pesa failed', refund_due: '⚠️ Refund due', refunded: 'Refunded' }[order.payment.status]);

export default function AdminOrders() {
  const location = useLocation();
  const [view, setView] = useState('all'); // all | payouts | refunds
  const [query, setQuery] = useState(location.state?.searchOrder || new URLSearchParams(location.search).get('q') || ''); // ?q= from the new-order email
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [planRefunds, setPlanRefunds] = useState([]);
  const [agreements, setAgreements] = useState([]);
  useEffect(() => {
    api.get('/agreements/admin/list').then((response) => setAgreements(response.data)).catch(() => {});
  }, []);
  const loadPlans = () => api.get('/plans/admin/list', { params: { refunds: 1 } }).then((response) => setPlanRefunds(response.data)).catch(() => {});
  // errands (parcels / shop for me): unspent shopping budgets and cancelled paid errands to refund
  const [errandRefunds, setErrandRefunds] = useState([]);
  const loadErrands = () => api.get('/errands/admin/list', { params: { refunds: 1 } }).then((response) => setErrandRefunds(response.data)).catch(() => {});
  useEffect(() => {
    loadPlans();
    loadErrands();
  }, []);
  const { onOrderChange, refreshAttention } = useRealtime();

  const load = useCallback(() => {
    const params = { q: query || undefined, status: status || undefined, page, payout: view === 'payouts' ? 'due' : undefined, refunds: view === 'refunds' ? '1' : undefined };
    api.get('/orders/admin/list', { params }).then((response) => setRes(response.data)).catch((error) => toast.error(errMsg(error)));
  }, [query, status, page, view]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => onOrderChange(() => load()), [onOrderChange, load]);

  const action = async (order, action, prompt) => {
    let extra = {};
    if (prompt) {
      const value = window.prompt(prompt);
      if (value === null) return;
      extra = action === 'cancel' ? { reason: value } : { ref: value };
    }
    try {
      await api.post(`/orders/admin/${order._id}`, { action, ...extra });
      toast.success({ payout: 'Payout recorded', refunded: 'Refund recorded', cancel: 'Order cancelled' }[action]);
      load();
      refreshAttention();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const stats = res?.stats || {};
  const exportCsv = () =>
    downloadCSV(`orders-${view}.csv`, [
      { label: 'Order', value: (row) => row.orderNo },
      { label: 'Payment ID', value: (row) => row.payment.ref || '' },
      { label: 'M-Pesa code', value: (row) => row.payment.receipt || '' },
      { label: 'Date', value: (row) => new Date(row.createdAt).toLocaleString() },
      { label: 'Buyer', value: (row) => row.buyer.name },
      { label: 'Buyer phone', value: (row) => row.buyer.phone },
      { label: 'Seller', value: (row) => row.seller.name },
      { label: 'Total', value: (row) => row.total },
      { label: 'Commission', value: (row) => row.commission },
      { label: 'Payout', value: (row) => row.payout?.amount || '' },
      { label: 'Payout status', value: (row) => row.payout?.status || '' },
      { label: 'Payment', value: payText },
      { label: 'Status', value: (row) => STATUS[row.status] },
    ], res?.orders || []);

  return (
    <div>
      <div className="page-head">
        <h2>Orders &amp; payouts</h2>
        <div className="toolbar">
          <input placeholder="Payment ID, M-Pesa code, order no, buyer or seller…" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} />
          <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </select>
          <button className="btn ghost" onClick={exportCsv} disabled={!res?.orders.length}>Export CSV</button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 14 }}>
        <button className={`card stat stat-link ${view === 'all' ? 'stat-on' : ''}`} onClick={() => { setPage(1); setView('all'); }}><span className="muted">All orders</span><b>{stats.orders ?? '–'}</b><small className="muted">{stats.open ?? 0} in progress</small></button>
        <button className={`card stat stat-link ${view === 'payouts' ? 'stat-on' : ''} ${stats.payoutsDueCount ? 'stat-warn' : ''}`} onClick={() => { setPage(1); setView('payouts'); }}><span className="muted">Seller payouts due</span><b>{money(stats.payoutsDue)}</b><small className="muted">{stats.payoutsDueCount || 0} orders · send via M-Pesa or bank, then record</small></button>
        <button className={`card stat stat-link ${view === 'refunds' ? 'stat-on' : ''} ${stats.refundsDue ? 'stat-bad' : ''}`} onClick={() => { setPage(1); setView('refunds'); }}><span className="muted">Buyer refunds due</span><b>{stats.refundsDue ?? 0}</b><small className="muted">paid M-Pesa orders that were cancelled</small></button>
        <button className={`card stat stat-link ${view === 'shopride' ? 'stat-on' : ''}`} onClick={() => setView('shopride')}><span className="muted">🛍️ Shop &amp; ride</span><b>Bookings</b><small className="muted">hub, pickup points, door delivery</small></button>
        <div className="card stat"><span className="muted">Delivered sales</span><b>{money(stats.gmv)}</b><small className="muted">commission {money(stats.commission)}</small></div>
      </div>

      {view === 'shopride' && <AdminShopRide />}
      <div className="card table-wrap" style={view === 'shopride' ? { display: 'none' } : undefined}>
        <table className="table">
          <thead>
            <tr><th>Order</th><th>Buyer</th><th>Seller</th><th className="right">Total</th><th>Payment</th><th>Status</th><th className="right">Seller gets</th><th></th></tr>
          </thead>
          <tbody>
            {res?.orders.map((order) => (
              <tr key={order._id}>
                <td>
                  <b>{order.orderNo}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{new Date(order.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {order.items.map((item) => `${item.qty}× ${item.title}`).join(', ').slice(0, 70)}</div>
                </td>
                <td>{order.buyer.name}<div className="muted" style={{ fontSize: 12 }}>{order.buyer.phone}</div></td>
                <td>{order.seller.name}</td>
                <td className="right">{money(order.total)}</td>
                <td>{payText(order)}</td>
                <td><span className={`badge ${BADGE[order.status]}`}>{STATUS[order.status]}</span></td>
                <td className="right">
                  {order.payment.method === 'mpesa' ? money(order.total - (order.commission || 0)) : <span className="muted">cash</span>}
                  {order.payout?.status === 'paid' && <div className="muted" style={{ fontSize: 12 }}>paid {order.payout.ref}</div>}
                </td>
                <td className="right nowrap">
                  <button className="btn ghost sm" title="Download the order receipt (PDF)" onClick={() => saveReceipt(api, `/orders/admin/${order._id}/receipt.pdf`, order.orderNo)}>🧾 Receipt</button>
                  {order.payout?.status === 'due' && <button className="btn sm" onClick={() => action(order, 'payout', `M-Pesa / bank reference for paying ${order.seller.name} ${money(order.payout.amount)}:`)}>Record payout</button>}
                  {order.payment.status === 'refund_due' && <button className="btn sm" onClick={() => action(order, 'refunded', `M-Pesa reference for refunding ${order.buyer.name} ${money(order.total)}:`)}>Record refund</button>}
                  {!['delivered', 'cancelled'].includes(order.status) && <button className="btn ghost sm danger-text" onClick={() => action(order, 'cancel', 'Reason for cancelling (the buyer and seller see this):')}>Cancel</button>}
                </td>
              </tr>
            ))}
            {res && !res.orders.length && <tr><td colSpan={8} className="center muted">No orders here.</td></tr>}
            {!res && <tr><td colSpan={8} className="center muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      {errandRefunds.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>🛒 Errand refunds due</b> <span className="muted">(shopping budget not spent, or a paid errand cancelled)</span>
          <table className="table" style={{ marginTop: 8 }}>
            <tbody>
              {errandRefunds.map((errandRefund) => (
                <tr key={errandRefund._id}>
                  <td><b>{errandRefund.no}</b> · {errandRefund.kind === 'shopping' ? 'Shop for me' : 'Parcel'}<div className="muted" style={{ fontSize: 12 }}>{errandRefund.status === 'cancelled' ? `Cancelled: ${errandRefund.cancelReason}` : `Budget ${money(errandRefund.shopping?.budget)}, spent ${money(errandRefund.shopping?.spent)}`}</div></td>
                  <td>{errandRefund.customerName}<div className="muted" style={{ fontSize: 12 }}>{errandRefund.customerPhone}</div></td>
                  <td className="right">{money(errandRefund.refund.amount)}</td>
                  <td className="right"><button className="btn sm" onClick={async () => {
                    const ref = window.prompt(`M-Pesa code of the ${money(errandRefund.refund.amount)} refund to ${errandRefund.customerName}:`);
                    if (ref === null) return;
                    try {
                      await api.post(`/errands/admin/${errandRefund._id}`, { action: 'refunded', ref });
                      toast.success('Refund recorded');
                      loadErrands();
                    } catch (err) {
                      toast.error(errMsg(err));
                    }
                  }}>Record refund</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {planRefunds.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>🐢 Lipa Pole Pole refunds due</b>
          <table className="table" style={{ marginTop: 8 }}>
            <tbody>
              {planRefunds.map((planRefund) => (
                <tr key={planRefund._id}>
                  <td><b>{planRefund.planNo}</b> · {planRefund.title}<div className="muted" style={{ fontSize: 12 }}>{planRefund.cancelReason}</div></td>
                  <td>{planRefund.buyer.name}<div className="muted" style={{ fontSize: 12 }}>{planRefund.buyer.phone}</div></td>
                  <td className="right">{money(planRefund.refundDue)}</td>
                  <td className="right"><button className="btn sm" onClick={async () => {
                    if (!window.confirm(`Mark ${money(planRefund.refundDue)} as refunded to ${planRefund.buyer.name}?`)) return;
                    try {
                      await api.post(`/plans/admin/${planRefund._id}`, { action: 'refunded' });
                      toast.success('Refund recorded');
                      loadPlans();
                    } catch (error) {
                      toast.error(errMsg(error));
                    }
                  }}>Record refund</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {agreements.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>📝 Lipa Pole Pole sale agreements</b> <span className="muted">(paid directly between buyer and seller; not held by the marketplace)</span>
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>Agreement</th><th>Seller</th><th>Buyer</th><th className="right">Price</th><th className="right">Paid</th><th className="right">Balance</th><th>Deadline</th><th>Status</th></tr></thead>
            <tbody>
              {agreements.map((agreement) => (
                <tr key={agreement._id}>
                  <td><b>{agreement.agreementNo}</b><div className="muted" style={{ fontSize: 12 }}>{agreement.item.title}</div></td>
                  <td>{agreement.seller.name}<div className="muted" style={{ fontSize: 12 }}>{agreement.seller.phone} · ID {agreement.seller.idNumber || '–'}</div></td>
                  <td>{agreement.buyer.name}<div className="muted" style={{ fontSize: 12 }}>{agreement.buyer.phone} · ID {agreement.buyer.idNumber || '–'}</div></td>
                  <td className="right">{money(agreement.price)}</td>
                  <td className="right">{money(agreement.paid)}</td>
                  <td className="right">{money(agreement.balance)}</td>
                  <td>{new Date(agreement.deadline).toLocaleDateString('en-GB')}{agreement.overdue && <span className="badge failed" style={{ marginLeft: 4 }}>overdue</span>}</td>
                  <td><span className={`badge ${agreement.status === 'active' ? 'online' : agreement.status === 'completed' ? 'completed' : agreement.status === 'cancelled' ? 'cancelled' : 'pending'}`}>{agreement.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res?.pages > 1 && (
        <div className="toolbar" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Previous</button>
          <span className="muted">Page {page} of {res.pages}</span>
          <button className="btn ghost sm" disabled={page >= res.pages} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
