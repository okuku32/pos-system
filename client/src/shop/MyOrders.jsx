import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useShop } from './ShopContext';
import { STAGE, ksh, orderKey, stepsFor } from './shopApi';

export default function MyOrders() {
  const { customer, ready, orders, refreshOrders } = useShop();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'My orders · Ordersasa';
    refreshOrders().catch(() => {}).finally(() => setLoading(false));
  }, [refreshOrders]);

  if (ready && !customer) return <Navigate to="/shop/login" replace />;

  const active = orders.filter((o) => o.status === 'open');
  const past = orders.filter((o) => o.status !== 'open');

  const Card = ({ o }) => {
    const key = orderKey(o);
    const steps = stepsFor(o);
    const idx = o.status === 'completed' ? steps.length - 1 : steps.findIndex((s) => s.key === o.stage);
    const pct = o.status === 'cancelled' ? 0 : Math.max(8, (idx / (steps.length - 1)) * 100);
    return (
      <Link to={`/track/${o.trackingToken}`} className={`os-order-card ${o.status}`}>
        <div className="os-oc-top">
          <span className="os-oc-icon">{STAGE[key]?.icon}</span>
          <div className="os-grow">
            <b>{STAGE[key]?.label}</b>
            <small>{o.orderNo} · {new Date(o.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
          </div>
          <b className="os-oc-total">{ksh(o.total)}</b>
        </div>
        {o.status !== 'cancelled' && <div className="os-progress"><i style={{ width: `${pct}%` }} /></div>}
        <p className="os-oc-items">
          {o.type === 'delivery' ? '🛵 Delivery' : '🏪 Pickup'} · {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
        </p>
      </Link>
    );
  };

  return (
    <div className="os-page">
      <div className="os-page-head">
        <h1>My orders</h1>
        <p className="os-muted">Updates appear here live, no need to refresh.</p>
      </div>
      {loading && !orders.length ? (
        <div className="os-list">{[0, 1].map((i) => <div key={i} className="os-order-card os-skeleton-block" />)}</div>
      ) : !orders.length ? (
        <div className="os-empty">
          <div className="os-empty-art">📦</div>
          <h4>No orders yet</h4>
          <p>When you place an order, you can follow it here.</p>
          <Link className="os-btn os-btn-brand" to="/shop">Start shopping</Link>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <h2 className="os-section-title">In progress</h2>
              <div className="os-list">{active.map((o) => <Card key={o.orderNo} o={o} />)}</div>
            </>
          )}
          {past.length > 0 && (
            <>
              <h2 className="os-section-title">Past orders</h2>
              <div className="os-list">{past.map((o) => <Card key={o.orderNo} o={o} />)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}
