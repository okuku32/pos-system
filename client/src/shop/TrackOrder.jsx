import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import shopApi, { STAGE, errMsg, firstName, ksh, orderKey, stepsFor } from './shopApi';
import { useShop } from './ShopContext';
import { connectSocket, chime } from '../realtime';

const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function useNow(ms) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function TrackOrder() {
  const { token } = useParams();
  const [params, setParams] = useSearchParams();
  const { orders, customer } = useShop();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [justPlaced] = useState(params.get('placed') === '1');
  const [pulse, setPulse] = useState(false);
  const prevKey = useRef(null);
  const now = useNow(15000);

  useEffect(() => {
    document.title = 'Track your order · Ordersasa';
    if (params.get('placed')) setParams({}, { replace: true });
    shopApi.get(`/shop/orders/${token}`).then((r) => setOrder(r.data)).catch((e) => setError(errMsg(e)));
    const socket = connectSocket({ track: token });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('order:status', (o) => setOrder(o));
    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Animate + chime when the status changes while the page is open
  useEffect(() => {
    if (!order) return;
    const k = orderKey(order);
    if (prevKey.current && prevKey.current !== k) {
      setPulse(true);
      chime();
      if ('vibrate' in navigator) navigator.vibrate?.(200);
      setTimeout(() => setPulse(false), 1200);
    }
    prevKey.current = k;
  }, [order]);

  if (error) {
    return (
      <div className="os-page">
        <div className="os-empty">
          <div className="os-empty-art">🔎</div>
          <h4>We couldn’t find that order</h4>
          <p>{error}. Check the link, or see all your orders.</p>
          <div className="os-row center">
            <Link className="os-btn os-btn-ghost" to="/shop/orders">My orders</Link>
            <Link className="os-btn os-btn-brand" to="/shop">Back to shop</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!order) return <div className="os-page"><div className="os-track-hero os-skeleton-block" style={{ height: 260 }} /></div>;

  const key = orderKey(order);
  const steps = stepsFor(order);
  const idx = order.status === 'completed' ? steps.length - 1 : order.status === 'cancelled' ? -1 : steps.findIndex((s) => s.key === order.stage);
  const pct = idx < 0 ? 0 : (idx / (steps.length - 1)) * 100;
  const isDelivery = order.type === 'delivery';
  const reached = (k) => (order.stageHistory || []).find((h) => h.stage === k);
  const mine = orders.find((o) => o.orderNo === order.orderNo); // owner-only info (address)

  let etaText = '';
  if (order.eta && order.status === 'open') {
    const mins = Math.round((new Date(order.eta) - now) / 60000);
    etaText = mins > 1 ? `Arriving in about ${mins} min` : 'Arriving any minute now';
  }

  return (
    <div className="os-page os-track">
      {justPlaced && (
        <div className="os-placed os-fade-up">
          <span className="os-confetti" aria-hidden="true">🎉</span>
          <div>
            <b>Asante{customer ? `, ${firstName(customer.name)}` : ''}! Your order is in.</b>
            <p>We’ve sent it to the shop. Keep this page open to watch it move, live.</p>
          </div>
        </div>
      )}

      <section className={`os-track-hero ${order.status} ${pulse ? 'pulse' : ''}`}>
        <div className="os-track-top">
          <span className="os-muted">Order {order.orderNo}</span>
          <span className={`os-live ${live ? 'on' : ''}`}>{live ? 'Live' : 'Reconnecting…'}</span>
        </div>
        <div className="os-status">
          <span className="os-status-icon" key={key}>{STAGE[key]?.icon}</span>
          <div>
            <h1 key={`h-${key}`} className="os-fade-up">{steps[idx]?.label || STAGE[key]?.label}</h1>
            <p>{STAGE[key]?.msg}</p>
            {etaText && <span className="os-eta">⏱ {etaText} · by {fmtTime(order.eta)}</span>}
          </div>
        </div>

        {order.status !== 'cancelled' && (
          <div className="os-route" aria-hidden="true">
            <span className="os-route-end">🏪</span>
            <div className="os-route-line">
              <i style={{ width: `${pct}%` }} />
              <span className={`os-rider ${key === 'out-for-delivery' ? 'moving' : ''}`} style={{ left: `${pct}%` }}>
                {isDelivery ? '🛵' : '🛍️'}
              </span>
            </div>
            <span className="os-route-end">{isDelivery ? '🏠' : '🙋'}</span>
          </div>
        )}
      </section>

      <div className="os-track-grid">
        <section className="os-panel">
          <h3>Progress</h3>
          {order.status === 'cancelled' ? (
            <p className="os-cancelled">This order was cancelled{reached('cancelled') ? ` at ${fmtTime(reached('cancelled').at)}` : ''}.</p>
          ) : (
            <ol className="os-timeline">
              {steps.map((s, i) => {
                const h = reached(s.key);
                const state = i < idx ? 'done' : i === idx ? 'current' : '';
                return (
                  <li key={s.key} className={state}>
                    <span className="os-tl-dot">{i < idx || (i === idx && order.status === 'completed') ? '✓' : s.icon}</span>
                    <div>
                      <b>{s.label}</b>
                      <small>{h ? fmtTime(h.at) : i === idx ? 'Now' : 'Pending'}</small>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="os-panel">
          <h3>{isDelivery ? 'Delivery details' : 'Pickup details'}</h3>
          <div className="os-detail">
            <span>{isDelivery ? '🏠' : '🏪'}</span>
            <div>
              <b>{isDelivery ? 'Delivering to' : 'Collect from'}</b>
              <small>{isDelivery ? mine?.address || `${order.customer?.name || 'You'} (address on file)` : 'Ordersasa shop counter'}</small>
            </div>
          </div>
          <div className="os-detail">
            <span>💳</span>
            <div><b>Payment</b><small>M-Pesa or cash on {isDelivery ? 'delivery' : 'pickup'}</small></div>
          </div>

          <div className="os-summary">
            <div className="os-summary-head">{order.items.reduce((n, i) => n + i.quantity, 0)} items</div>
            {order.items.map((i, k) => (
              <div key={k} className="os-sum sm"><span>{i.quantity} × {i.name}</span><span>{i.listPrice > i.price && <s className="os-was">{ksh(i.listPrice * i.quantity)}</s>} {ksh(i.subtotal)}</span></div>
            ))}
            {(order.savings || 0) + (order.discount || 0) > 0 && (
              <div className="os-sum sm save"><span>🎉 You saved</span><span>{ksh((order.savings || 0) + (order.discount || 0))}</span></div>
            )}
            <div className="os-sum total"><span>Total</span><b>{ksh(order.total)}</b></div>
          </div>
          <small className="os-muted">Placed {new Date(order.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small>
        </section>
      </div>

      <div className="os-row center os-track-actions">
        {customer && <Link className="os-btn os-btn-ghost" to="/shop/orders">All my orders</Link>}
        <Link className="os-btn os-btn-brand" to="/shop">Continue shopping</Link>
      </div>
    </div>
  );
}
