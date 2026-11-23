// 🏪 Seller hub: everything a seller runs in one place.
//   Overview   today's orders and sales (any day, the last 14 days), orders to handle, sales and earnings (after our commission and any extra riders), payouts, best sellers
//   Inventory  every item with its store and stock (− / + / set), low and sold-out filters, move between stores,
//              and how many other sellers sell the same product (and from what price)
//   Stores     the main store and branches: add, edit, pin on the map, make main, close (moving its items first)
//   POS        (shops, wholesalers, importers; one button to turn on) sales analytics: see PosDashboard.jsx
// Orders are processed on the Sales page (/sales); new products are uploaded with the Sell form.
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, imgUrl, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { AddressInput, getHere, inKenya } from './Maps';
import { BoostSheet } from './Trust';
import PosDashboard from './PosDashboard';
import './market.css';

const ksh = (amount) => `KSh ${Math.round(Number(amount || 0)).toLocaleString('en-KE')}`;
const TABS = [['overview', '📊 Overview'], ['inventory', '📦 Inventory'], ['stores', '🏬 Stores']];
const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '3 months'], [365, '12 months']];
const PAYOUT = { not_due: 'After delivery', due: 'Being paid', paid: 'Paid' };

export default function SellerHub() {
  const { customer, ready } = useShop();
  const [params, setParams] = useSearchParams();
  const [boosting, setBoosting] = useState(false);
  const trader = !!customer?.shopLocation?.market; // sellers in one of our markets boost their whole business
  // 📈 the POS dashboard: shown to shops, wholesalers and importers (not one-off sellers of a single item)
  const [posInfo, setPosInfo] = useState(null);
  const loadPos = useCallback(() => api.get('/seller/pos', { params: { check: 1 } }).then((response) => setPosInfo(response.data)).catch(() => setPosInfo({ eligible: false, enabled: false })), []);
  useEffect(() => {
    if (customer) loadPos();
  }, [customer, loadPos]);
  const tabs = [...TABS, ...(posInfo?.eligible || posInfo?.enabled ? [['pos', '📈 POS dashboard']] : [])];
  const tab = tabs.some(([key]) => key === params.get('tab')) || params.get('tab') === 'pos' ? params.get('tab') : 'overview';
  useSeo({ title: 'Seller hub', noindex: true });
  if (ready && !customer) return <Navigate to="/login?as=seller&next=/seller" replace />;
  if (!customer) return <div className="mk"><div className="mk-wrap"><div className="page-spinner" /></div></div>;
  return (
    <div className="mk">
      <div className="mk-wrap mk-hub">
        <div className="mk-hub-head">
          <h1>🏪 Seller hub</h1>
          <div className="mk-hub-quick">
            <Link to="/market/sell" className="os-btn os-btn-brand">＋ Upload a product</Link>
            {trader && (
              <button type="button" className="os-btn os-btn-dark mk-boost-business-btn" onClick={() => setBoosting(true)}>
                {customer.businessBoostUntil ? `⭐ Boosted until ${new Date(customer.businessBoostUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '⭐ Boost my business · KSh 200/month'}
              </button>
            )}
            <Link to="/sales" className="os-btn os-btn-dark">🧾 Orders to fulfil</Link>
            <Link to="/market/requests?box=received" className="os-btn os-btn-ghost">📸 Photo requests</Link>
          </div>
        </div>
        {!customer.payDetails && (
          <Link to="/account#pay-details" className="mk-hub-paynote">💵 <b>Add how you get paid</b> (M-Pesa Till, Paybill, Pochi or Send Money) so buyers who pay on delivery can pay you. <span>Add it now →</span></Link>
        )}
        <nav className="mk-hub-tabs" role="tablist" aria-label="Seller hub">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}>{label}</button>
          ))}
        </nav>
        {tab === 'overview' && posInfo?.eligible && !posInfo.enabled && (
          <button type="button" className="mk-pos-cta" onClick={() => setParams({ tab: 'pos' })}>
            <span aria-hidden="true">📈</span>
            <span><b>Turn on your POS dashboard</b><small>Sales, earnings, best sellers, busy hours and stock alerts for your shop, in one place. Free, one tap.</small></span>
            <em>Turn on →</em>
          </button>
        )}
        {tab === 'overview' && <Overview goTo={(key, extra = {}) => setParams({ tab: key, ...extra })} />}
        {tab === 'pos' && <PosDashboard info={posInfo} onChange={loadPos} />}
        {tab === 'inventory' && <Inventory />}
        {tab === 'stores' && <Stores />}
        {boosting && <BoostSheet onClose={() => setBoosting(false)} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- today: one day's orders and sales at a glance
const STATUS = { placed: ['New', 'new'], confirmed: ['To send', 'send'], shipped: ['On the way', 'way'], delivered: ['Delivered', 'done'], cancelled: ['Cancelled', 'off'] };
const PAY = { cash: 'Cash', direct: 'Paid to you', mpesa: 'M-Pesa' };
const shiftDay = (key, by) => new Date(Date.parse(`${key}T12:00:00Z`) + by * 864e5).toISOString().slice(0, 10);
const dayName = (key, today) => (key === today ? 'Today' : key === shiftDay(today, -1) ? 'Yesterday' : new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }));
const shortDay = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const timeOf = (at) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
// "+3 vs yesterday" / "same as yesterday"
function Change({ now, before, money, label }) {
  const diff = Math.round((now || 0) - (before || 0));
  if (!diff) return <span className="mk-day-change">Same as {label}</span>;
  const text = money ? ksh(Math.abs(diff)) : Math.abs(diff);
  return <span className={`mk-day-change ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '▲' : '▼'} {text} vs {label}</span>;
}

function DailyPanel() {
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [measure, setMeasure] = useState('orders');
  const [list, setList] = useState('orders');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get(`/seller/daily${date ? `?date=${date}` : ''}`)
      .then((response) => live && setData(response.data))
      .catch((error) => toast.error(errMsg(error)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [date]);
  if (!data) return <section className="mk-box mk-day" aria-label="Today"><div className="page-spinner" /></section>;
  const { day, previous, series, today } = data;
  const name = dayName(data.date, today);
  const before = data.isToday ? 'yesterday' : 'the day before';
  const max = Math.max(1, ...series.map((point) => (measure === 'orders' ? point.orders : point.sales)));
  const rows = list === 'orders' ? data.orders : data.delivered;
  return (
    <section className={`mk-box mk-day ${loading ? 'loading' : ''}`} aria-labelledby="mk-day-title">
      <div className="mk-day-head">
        <h2 id="mk-day-title">📅 {name}{data.isToday && <small className="os-muted"> {shortDay(data.date)}</small>}</h2>
        <div className="mk-day-nav">
          <button type="button" className="os-btn os-btn-ghost" onClick={() => setDate(shiftDay(data.date, -1))} aria-label="The day before">‹</button>
          <input type="date" value={data.date} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} aria-label="Choose a day" />
          <button type="button" className="os-btn os-btn-ghost" onClick={() => setDate(shiftDay(data.date, 1))} disabled={data.isToday} aria-label="The next day">›</button>
          {!data.isToday && <button type="button" className="os-btn os-btn-dark" onClick={() => setDate('')}>Today</button>}
        </div>
      </div>

      <div className="mk-day-tiles">
        <div className="mk-day-tile"><small>Orders</small><b>{day.orders}</b><span>{ksh(day.orderValue)} ordered{day.cancelled ? ` · ${day.cancelled} cancelled` : ''}</span><Change now={day.orders} before={previous?.orders} label={before} /></div>
        <div className="mk-day-tile main"><small>Sales (delivered)</small><b>{ksh(day.sales)}</b><span>{day.delivered} order{day.delivered === 1 ? '' : 's'} delivered</span><Change now={day.sales} before={previous?.sales} money label={before} /></div>
        <div className="mk-day-tile"><small>Your earnings</small><b>{ksh(day.net)}</b><span>After commission &amp; riders</span></div>
        <div className="mk-day-tile"><small>Items sold</small><b>{day.units}</b><span>Units delivered</span></div>
      </div>

      {/* the last 14 days: one measure at a time, the chosen day highlighted */}
      <div className="mk-day-chart">
        <div className="mk-day-chart-head">
          <b>Last 14 days</b>
          <div className="mk-chips" role="radiogroup" aria-label="Show">
            {[['orders', 'Orders'], ['sales', 'Sales (KSh)']].map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={measure === key} className={measure === key ? 'on' : ''} onClick={() => setMeasure(key)}>{label}</button>)}
          </div>
        </div>
        <div className="mk-day-bars" role="list" aria-label={`${measure === 'orders' ? 'Orders' : 'Sales'} per day`}>
          {series.map((point) => {
            const value = measure === 'orders' ? point.orders : point.sales;
            const label = `${dayName(point.date, today)}: ${point.orders} order${point.orders === 1 ? '' : 's'} · ${ksh(point.sales)} sales`;
            return (
              <button key={point.date} type="button" role="listitem" className={`mk-day-bar ${point.date === data.date ? 'on' : ''}`} onClick={() => setDate(point.date === today ? '' : point.date)} aria-label={label} title={label}>
                <span className="mk-day-bar-tip" aria-hidden="true">{measure === 'orders' ? value : ksh(value)}</span>
                <span className="mk-day-bar-fill" style={{ height: `${value ? Math.max(4, (value / max) * 100) : 0}%` }} />
                <small>{new Date(`${point.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}</small>
              </button>
            );
          })}
        </div>
      </div>

      {/* the day's orders */}
      <div className="mk-day-list">
        <div className="mk-chips" role="tablist" aria-label="List">
          <button type="button" role="tab" aria-selected={list === 'orders'} className={list === 'orders' ? 'on' : ''} onClick={() => setList('orders')}>🧾 Orders placed ({data.orders.length})</button>
          <button type="button" role="tab" aria-selected={list === 'delivered'} className={list === 'delivered' ? 'on' : ''} onClick={() => setList('delivered')}>✅ Sales delivered ({data.delivered.length})</button>
        </div>
        {rows.length ? (
          <ul>
            {rows.map((order) => {
              const [statusText, statusClass] = STATUS[order.status] || [order.status, ''];
              return (
                <li key={order._id}>
                  <Link to={`/sales/${order._id}`} className="mk-day-order">
                    <span className="mk-day-time">{timeOf(list === 'delivered' ? order.deliveredAt : order.at)}</span>
                    <span className="mk-day-what">
                      <b>{order.items.map((item) => `${item.qty > 1 ? `${item.qty} × ` : ''}${item.title}`).join(', ')}{order.more ? ` +${order.more} more` : ''}</b>
                      <small>{order.orderNo} · {order.buyerName || 'Buyer'} · {PAY[order.payment]}</small>
                    </span>
                    <span className="mk-day-amount"><b>{ksh(list === 'delivered' ? order.net : order.total)}</b><span className={`mk-day-status ${statusClass}`}>{list === 'delivered' ? 'You get' : statusText}</span></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="os-muted mk-day-empty">{list === 'orders' ? (data.isToday ? 'No orders yet today.' : 'No orders that day.') : (data.isToday ? 'No deliveries yet today.' : 'No deliveries that day.')} {data.isToday && <Link to="/market/sell">Add more items →</Link>}</p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- overview: sales & earnings
function Overview({ goTo }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api.get(`/seller/overview?days=${days}`).then((response) => live && setData(response.data)).catch((error) => toast.error(errMsg(error)));
    return () => { live = false; };
  }, [days]);
  if (!data) return <div className="page-spinner" />;
  const open = data.orders.open || {};
  const toHandle = (open.placed?.orders || 0) + (open.confirmed?.orders || 0);
  return (
    <>
      <DailyPanel />
      <h2 className="mk-hub-subhead">📊 Over time</h2>
      <div className="mk-chips mk-hub-periods" role="radiogroup" aria-label="Period">
        {PERIODS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={days === value} className={days === value ? 'on' : ''} onClick={() => setDays(value)}>{label}</button>)}
      </div>
      <section className="mk-hub-tiles" aria-label="Orders">
        <Link to="/sales" className={`mk-hub-tile ${toHandle ? 'alert' : ''}`}><small>Orders to handle</small><b>{toHandle}</b><span>{open.placed?.orders || 0} new · {open.confirmed?.orders || 0} to send</span></Link>
        <Link to="/sales" className="mk-hub-tile"><small>On the way</small><b>{open.shipped?.orders || 0}</b><span>{ksh(open.shipped?.value)}</span></Link>
        <div className="mk-hub-tile"><small>Orders ({data.days} days)</small><b>{data.orders.total}</b><span>{data.sales.delivered} delivered</span></div>
        <button type="button" className={`mk-hub-tile ${data.inventory.low || data.inventory.out ? 'warn' : ''}`} onClick={() => goTo('inventory', { filter: data.inventory.out ? 'out' : 'low' })}><small>Stock alerts</small><b>{data.inventory.low + data.inventory.out}</b><span>{data.inventory.low} low · {data.inventory.out} sold out</span></button>
      </section>

      <section className="mk-box mk-hub-money" aria-label="Sales and earnings">
        <h2>💰 Sales &amp; earnings <small className="os-muted">delivered orders, last {data.days} days</small></h2>
        <div className="mk-hub-money-grid">
          <div><small>Sales</small><b>{ksh(data.sales.gross)}</b><span>{data.sales.delivered} orders · average {ksh(data.sales.average)}</span></div>
          <div><small>Our commission</small><b>− {ksh(data.sales.commission)}</b><span>On M-Pesa orders</span></div>
          <div><small>Extra riders (split orders)</small><b>− {ksh(data.sales.deliveryCosts)}</b><span>Parts sent from other stores</span></div>
          <div className="net"><small>Your earnings</small><b>{ksh(data.sales.net)}</b><span>{data.sales.cashCollected ? `${ksh(data.sales.cashCollected)} collected in cash` : 'All paid through us'}</span></div>
        </div>
        <div className="mk-hub-payouts">
          <span>✅ Paid to you: <b>{ksh(data.payouts.paid)}</b> ({data.payouts.paidOrders} orders)</span>
          <span>⏳ Being paid: <b>{ksh(data.payouts.due)}</b> ({data.payouts.dueOrders} orders)</span>
        </div>
      </section>

      <div className="mk-hub-two">
        <section className="mk-box" aria-label="Best sellers">
          <h2>🏆 Best sellers</h2>
          {data.best.length ? (
            <ol className="mk-hub-best">
              {data.best.map((item) => (
                <li key={item.slug || item.title}>
                  {item.image ? <img src={imgUrl(item.image)} alt="" /> : <span className="mk-hub-noimg">📦</span>}
                  <span>{item.slug ? <Link to={`/market/item/${item.slug}`}>{item.title}</Link> : item.title}<small>{item.units} sold</small></span>
                  <b>{ksh(item.revenue)}</b>
                </li>
              ))}
            </ol>
          ) : <p className="os-muted">No delivered sales in this period yet.</p>}
        </section>
        <section className="mk-box" aria-label="Recent earnings">
          <h2>🧾 Recent earnings</h2>
          {data.recent.length ? (
            <div className="mk-hub-table-wrap">
              <table className="mk-hub-table">
                <thead><tr><th>Order</th><th>Total</th><th>You get</th><th>Payout</th></tr></thead>
                <tbody>
                  {data.recent.map((row) => (
                    <tr key={row._id}>
                      <td><Link to={`/sales/${row._id}`}>{row.orderNo}</Link><small>{new Date(row.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {row.buyerName}</small></td>
                      <td>{ksh(row.total)}</td>
                      <td><b>{ksh(row.net)}</b>{row.commission > 0 && <small>− {ksh(row.commission)} commission</small>}{row.deliveryCosts > 0 && <small>− {ksh(row.deliveryCosts)} riders</small>}</td>
                      <td>{row.payment === 'cash' ? 'Cash to you' : row.payment === 'direct' ? 'Paid to you directly' : PAYOUT[row.payout] || row.payout}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="os-muted">Earnings show here once orders are delivered.</p>}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- inventory
function Inventory() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') || 'all';
  const storeId = params.get('store') || '';
  const [text, setText] = useState('');
  const [data, setData] = useState(null);
  const [storeList, setStoreList] = useState([]);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    const query = new URLSearchParams({ ...(filter !== 'all' ? { filter } : {}), ...(storeId ? { store: storeId } : {}), ...(text.trim() ? { q: text.trim() } : {}) });
    return api.get(`/seller/inventory?${query}`).then((response) => setData(response.data)).catch((error) => toast.error(errMsg(error)));
  }, [filter, storeId, text]);
  useEffect(() => {
    const timer = setTimeout(load, text ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, text]);
  useEffect(() => { api.get('/seller/stores').then((response) => setStoreList(response.data.stores.filter((store) => store.active))).catch(() => {}); }, []);
  const set = (key, value) => setParams({ tab: 'inventory', ...(key === 'filter' ? (value !== 'all' ? { filter: value } : {}) : filter !== 'all' ? { filter } : {}), ...(key === 'store' ? (value ? { store: value } : {}) : storeId ? { store: storeId } : {}) }, { replace: true });
  const change = async (item, body, done) => {
    setBusy(item._id);
    try {
      const response = await api.patch(`/seller/inventory/${item._id}`, body);
      setData((previous) => ({ ...previous, items: previous.items.map((row) => (row._id === item._id ? response.data : row)) }));
      if (done) toast.success(done);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy('');
    }
  };
  const summary = data?.summary;
  return (
    <>
      {summary && (
        <section className="mk-hub-tiles" aria-label="Stock">
          <div className="mk-hub-tile"><small>Items</small><b>{summary.listings}</b><span>{summary.online} sold online</span></div>
          <div className="mk-hub-tile"><small>Units in stock</small><b>{summary.units.toLocaleString('en-KE')}</b><span>Worth {ksh(summary.value)}</span></div>
          <button type="button" className={`mk-hub-tile ${summary.low ? 'warn' : ''}`} onClick={() => set('filter', 'low')}><small>Low stock</small><b>{summary.low}</b><span>{data.lowStock} or fewer left</span></button>
          <button type="button" className={`mk-hub-tile ${summary.out ? 'alert' : ''}`} onClick={() => set('filter', 'out')}><small>Sold out</small><b>{summary.out}</b><span>Add stock to sell again</span></button>
        </section>
      )}
      <div className="mk-hub-filters">
        <input type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Search your items…" aria-label="Search your items" />
        <select value={storeId} onChange={(event) => set('store', event.target.value)} aria-label="Store">
          <option value="">All stores</option>
          {storeList.map((store) => <option key={store._id} value={store._id}>{store.name}{store.isMain ? ' (main)' : ''}</option>)}
        </select>
        <div className="mk-chips" role="radiogroup" aria-label="Show">
          {[['all', 'All'], ['online', 'Sold online'], ['low', 'Low stock'], ['out', 'Sold out']].map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={filter === key} className={filter === key ? 'on' : ''} onClick={() => set('filter', key)}>{label}</button>)}
        </div>
      </div>
      {!data ? <div className="page-spinner" /> : !data.items.length ? (
        <div className="os-empty"><div className="os-empty-art">📦</div><p>{filter === 'all' && !text ? 'No items yet.' : 'Nothing matches.'}</p><Link to="/market/sell" className="os-btn os-btn-brand">＋ Upload a product</Link></div>
      ) : (
        <ul className="mk-inv">
          {data.items.map((item) => <InventoryRow key={item._id} item={item} stores={storeList} busy={busy === item._id} change={change} />)}
        </ul>
      )}
    </>
  );
}

function InventoryRow({ item, stores, busy, change }) {
  const [stock, setStock] = useState('');
  const cheaper = item.product && item.product.offers > 1 && item.product.minPrice && item.product.minPrice < item.price;
  return (
    <li className={`mk-inv-row ${item.low ? 'low' : ''} ${item.buyNow && item.stock === 0 ? 'out' : ''}`}>
      {item.image ? <img src={imgUrl(item.image)} alt="" /> : <span className="mk-hub-noimg">📦</span>}
      <div className="mk-inv-main">
        <Link to={`/market/item/${item.slug}`} className="mk-inv-title">{item.title}</Link>
        <span className="mk-inv-meta">{ksh(item.price)} · {item.soldCount} sold · {item.views} views{item.store ? ` · 🏬 ${item.store.name}` : ''}</span>
        {item.product && item.product.offers > 1 && (
          <span className={`mk-inv-compare ${cheaper ? 'warn' : ''}`}>{item.product.sellers > 1 ? `${item.product.sellers} sellers` : `${item.product.offers} offers`} sell this product, from {ksh(item.product.minPrice)}{cheaper ? ': others are cheaper' : ''}</span>
        )}
      </div>
      <div className="mk-inv-stock">
        {item.buyNow ? (
          <>
            <span className="mk-inv-count" aria-label={`${item.stock} in stock`}><b>{item.stock}</b> in stock{item.stock === 0 ? ' · sold out' : item.low ? ' · low' : ''}</span>
            <div className="mk-inv-buttons">
              <button type="button" disabled={busy || item.stock === 0} onClick={() => change(item, { add: -1 })} aria-label="One less">−</button>
              <button type="button" disabled={busy} onClick={() => change(item, { add: 1 })} aria-label="One more">＋</button>
              <form onSubmit={(event) => { event.preventDefault(); if (stock !== '') change(item, { stock: Number(stock) }, 'Stock updated').then(() => setStock('')); }}>
                <input type="number" min="0" inputMode="numeric" value={stock} onChange={(event) => setStock(event.target.value)} placeholder="Set" aria-label="Set the stock" />
              </form>
            </div>
          </>
        ) : <Link to={`/market/edit/${item._id}`} className="os-linkbtn">Not sold online · edit</Link>}
        {stores.length > 1 && (
          <select value={item.store?._id || ''} disabled={busy} onChange={(event) => change(item, { store: event.target.value }, 'Moved')} aria-label="Store">
            {!item.store && <option value="">No store</option>}
            {stores.map((store) => <option key={store._id} value={store._id}>🏬 {store.name}</option>)}
          </select>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- stores & branches
const EMPTY_STORE = { name: '', county: 'Nairobi', area: '', address: '', phone: '', hours: '', lat: null, lng: null, public: true };
function Stores() {
  const data = useCategories();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // a store being added / edited
  const [closing, setClosing] = useState(null);
  const [moveTo, setMoveTo] = useState('');
  const load = useCallback(() => api.get('/seller/stores').then((response) => setList(response.data.stores)).catch((error) => toast.error(errMsg(error))), []);
  useEffect(() => { load(); }, [load]);
  const save = async (event) => {
    event.preventDefault();
    try {
      if (editing._id) await api.put(`/seller/stores/${editing._id}`, editing);
      else await api.post('/seller/stores', editing);
      toast.success(editing._id ? 'Store saved' : 'Store added');
      setEditing(null);
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const pin = async () => {
    try {
      const here = await getHere();
      if (!inKenya(here.lat, here.lng)) throw new Error('Your location looks like it’s outside Kenya');
      setEditing((previous) => ({ ...previous, lat: here.lat, lng: here.lng }));
      toast.success('Pinned where you are');
    } catch (error) {
      toast.error(error.message || 'Couldn’t get your location');
    }
  };
  const act = async (url, body, done) => {
    try {
      await api.post(url, body);
      toast.success(done);
      setClosing(null);
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  if (!list) return <div className="page-spinner" />;
  const open = list.filter((store) => store.active);
  return (
    <>
      <div className="mk-hub-bar">
        <p className="os-muted">Each item is sold from one store. An order with items from two stores is sent as two deliveries.</p>
        <button type="button" className="os-btn os-btn-brand" onClick={() => setEditing({ ...EMPTY_STORE })}>＋ Add a store or branch</button>
      </div>
      {!list.length && <div className="os-empty"><div className="os-empty-art">🏬</div><p>Add your first store: where buyers and riders find you.</p></div>}
      <ul className="mk-stores">
        {list.map((store) => (
          <li key={store._id} className={`mk-box mk-store ${store.active ? '' : 'closed'}`}>
            <div className="mk-store-head">
              <h3>🏬 {store.name}</h3>
              {store.isMain && <span className="mk-pill ok">Main store</span>}
              {!store.active && <span className="mk-pill">Closed</span>}
            </div>
            <p className="mk-store-where">📍 {[store.address, store.area, store.county].filter(Boolean).join(', ')}{store.lat == null ? ' · not on the map yet' : ''}</p>
            {(store.phone || store.hours) && <p className="os-muted">{[store.phone && `📞 ${store.phone}`, store.hours && `🕘 ${store.hours}`].filter(Boolean).join(' · ')}</p>}
            <div className="mk-store-stats">
              <span><b>{store.listings}</b> items</span>
              <span><b>{store.units}</b> units</span>
              <span className={store.lowStock ? 'warn' : ''}><b>{store.lowStock}</b> low</span>
              <span><b>{store.openDeliveries}</b> deliveries in progress</span>
            </div>
            {store.active && (
              <div className="os-row mk-store-actions">
                <button type="button" className="os-btn os-btn-ghost" onClick={() => setEditing({ ...store })}>✎ Edit</button>
                <Link className="os-btn os-btn-ghost" to={`/seller?tab=inventory&store=${store._id}`}>📦 Items</Link>
                <Link className="os-btn os-btn-ghost" to={`/market/sell?store=${store._id}`}>＋ Product here</Link>
                {!store.isMain && <button type="button" className="os-btn os-btn-ghost" onClick={() => act(`/seller/stores/${store._id}/main`, {}, `${store.name} is now your main store`)}>★ Make main</button>}
                {!store.isMain && <button type="button" className="os-btn os-btn-ghost mk-danger" onClick={() => { setClosing(store); setMoveTo(open.find((item) => item.isMain)?._id || ''); }}>Close</button>}
              </div>
            )}
            {closing?._id === store._id && (
              <div className="mk-store-close">
                <b>Close {store.name}?</b>
                {store.listings > 0 && (
                  <label className="os-field"><span>Move its {store.listings} items to</span>
                    <select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
                      {open.filter((item) => item._id !== store._id).map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                    </select>
                  </label>
                )}
                <small className="os-muted">Past orders keep showing this store. You can’t close it while it has orders in progress.</small>
                <div className="os-row">
                  <button type="button" className="os-btn os-btn-dark" onClick={() => act(`/seller/stores/${store._id}/close`, store.listings > 0 ? { moveTo } : {}, `${store.name} closed`)}>Close the store</button>
                  <button type="button" className="os-btn os-btn-ghost" onClick={() => setClosing(null)}>Keep it open</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <form className="mk-box mk-store-form" onSubmit={save} aria-label={editing._id ? 'Edit store' : 'Add a store'}>
          <h2>{editing._id ? `Edit ${editing.name}` : 'Add a store or branch'}</h2>
          <div className="mk-form-grid">
            <label className="os-field"><span>Store name *</span><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required minLength={2} maxLength={80} placeholder="e.g. Gikomba branch" /></label>
            <label className="os-field"><span>County *</span>
              <select value={editing.county} onChange={(event) => setEditing({ ...editing, county: event.target.value })} required>
                {(data?.counties || ['Nairobi']).map((county) => <option key={county}>{county}</option>)}
              </select>
            </label>
            <label className="os-field"><span>Town / area *</span><input value={editing.area} onChange={(event) => setEditing({ ...editing, area: event.target.value })} required minLength={2} maxLength={60} placeholder="e.g. Gikomba" /></label>
            <label className="os-field"><span>Address or landmark</span><AddressInput value={editing.address} onChange={(text) => setEditing((previous) => ({ ...previous, address: text }))} onPlace={(place) => setEditing((previous) => ({ ...previous, address: place.text, area: place.area || previous.area, county: place.county || previous.county, lat: place.lat, lng: place.lng }))} maxLength={200} placeholder="Start typing: market, building, street" /></label>
            <label className="os-field"><span>Store phone</span><input value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} inputMode="tel" maxLength={20} placeholder="07XX XXX XXX" /></label>
            <label className="os-field"><span>Opening hours</span><input value={editing.hours} onChange={(event) => setEditing({ ...editing, hours: event.target.value })} maxLength={80} placeholder="e.g. Mon–Sat 8am–7pm" /></label>
          </div>
          <div className="mk-store-pin">
            <button type="button" className={`os-btn ${editing.lat != null ? 'os-btn-ghost' : 'os-btn-dark'}`} onClick={pin}>{editing.lat != null ? '✅ Pinned (tap to pin again)' : '📍 I’m at this store: pin it'}</button>
            <label className="mk-check"><input type="checkbox" checked={editing.public !== false} onChange={(event) => setEditing({ ...editing, public: event.target.checked })} /> Show it to buyers on the map</label>
          </div>
          <small className="os-muted">A pin lets riders collect from this store, and puts its items on “near me”.</small>
          <div className="os-row mk-mt">
            <button className="os-btn os-btn-brand">{editing._id ? 'Save' : 'Add store'}</button>
            <button type="button" className="os-btn os-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
    </>
  );
}
