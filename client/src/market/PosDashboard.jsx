// 📈 POS dashboard (Seller hub → POS): for shops, wholesalers and importers, switched on with one button.
// How the business is doing over 7 days, 30 days, 3 months or 12 months, each figure against the period before:
// order value, delivered sales, earnings, orders, average order, items sold, buyers; a chart; best sellers; how buyers
// pay and get their orders; busy hours and days; top buyers and places; and stock that needs attention.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg } from './marketApi';

const ksh = (amount) => `KSh ${Math.round(Number(amount || 0)).toLocaleString('en-KE')}`;
const short = (amount) => (amount >= 1e6 ? `${(amount / 1e6).toFixed(1)}M` : amount >= 1e4 ? `${Math.round(amount / 1e3)}k` : amount >= 1e3 ? `${(amount / 1e3).toFixed(1)}k` : String(Math.round(amount)));
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '3 months'], [365, '12 months']];
const METRICS = [['orderValue', 'Order value', true], ['orders', 'Orders', false], ['sales', 'Delivered sales', true]];
const STATUS = { placed: 'New', confirmed: 'Confirmed', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bucketLabel = (key, unit) => {
  if (unit === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
  const [, month, day] = key.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
};

export default function PosDashboard({ info, onChange }) {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/seller/pos', { params: { range } }).then((response) => setData(response.data)).catch((err) => toast.error(errMsg(err))), [range]);
  useEffect(() => {
    if (info?.enabled) load();
  }, [info?.enabled, load]);
  const toggle = async (enabled) => {
    if (!enabled && !window.confirm('Turn off your POS dashboard? You can turn it on again any time; nothing is lost.')) return;
    setBusy(true);
    try {
      await api.post('/seller/pos', { enabled });
      toast.success(enabled ? 'Your POS dashboard is on 📈' : 'POS dashboard turned off');
      setData(null);
      onChange?.();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <div className="page-loading"><span className="page-spinner" /></div>;
  if (!info.enabled) {
    return (
      <section className="mk-box mk-pos-intro">
        <div className="mk-pos-intro-art" aria-hidden="true">📈</div>
        <h2>Your shop’s POS dashboard</h2>
        <p>See how your business is doing, in one place: what you sold, what earned you most, how buyers pay, your busiest hours and what stock needs topping up.</p>
        <ul>
          <li>💰 Sales, earnings and orders, compared with the period before</li>
          <li>🏆 Your best sellers, and products that aren’t selling</li>
          <li>⏰ Your busiest hours and days, so you know when to be ready</li>
          <li>📦 Low-stock and sold-out alerts</li>
        </ul>
        {info.eligible ? (
          <button type="button" className="os-btn os-btn-brand os-btn-lg" disabled={busy} onClick={() => toggle(true)}>{busy ? 'Turning it on…' : '📈 Turn on my POS dashboard'}</button>
        ) : (
          <p className="mk-pos-not">{info.reason}</p>
        )}
        <small className="os-muted">Free. Only you can see it. Turn it off any time.</small>
      </section>
    );
  }
  if (!data) return <div className="page-loading"><span className="page-spinner" /></div>;
  const { kpis } = data;
  const nothing = !kpis.orders.now && !kpis.sales.now && !data.products.length;
  return (
    <div className="mk-pos">
      <div className="mk-pos-head">
        <div>
          <h2>📈 POS dashboard</h2>
          <small className="os-muted">Compared with the {data.range === 365 ? '12 months' : `${data.range} days`} before</small>
        </div>
        <div className="mk-chips" role="group" aria-label="Period">
          {RANGES.map(([days, label]) => <button key={days} type="button" className={range === days ? 'on' : ''} aria-pressed={range === days} onClick={() => { setRange(days); setData(null); }}>{label}</button>)}
        </div>
      </div>

      <div className="mk-pos-kpis">
        <Kpi label="Order value" hint="orders placed (not cancelled)" value={ksh(kpis.orderValue.now)} change={kpis.orderValue.change} />
        <Kpi label="Delivered sales" hint="orders delivered" value={ksh(kpis.sales.now)} change={kpis.sales.change} />
        <Kpi label="Your earnings" hint="after our commission" value={ksh(kpis.net.now)} change={kpis.net.change} />
        <Kpi label="Orders" value={kpis.orders.now.toLocaleString('en-KE')} change={kpis.orders.change} />
        <Kpi label="Average order" value={ksh(kpis.avgOrder.now)} change={kpis.avgOrder.change} />
        <Kpi label="Items sold" hint="delivered" value={kpis.units.now.toLocaleString('en-KE')} change={kpis.units.change} />
        <Kpi label="Buyers" hint={`${kpis.buyers.repeat} came back`} value={kpis.buyers.now.toLocaleString('en-KE')} />
        <Kpi label="Cancelled" value={`${kpis.cancelRate.now}%`} change={kpis.cancelRate.before || kpis.cancelRate.now ? kpis.cancelRate.now - kpis.cancelRate.before : 0} unit="pts" lowerIsBetter />
      </div>

      {nothing ? (
        <div className="mk-empty mk-pos-empty"><p>No orders in this period yet. When buyers order your products, your figures show up here.</p><Link to="/market/sell" className="os-btn os-btn-brand">＋ Add products</Link></div>
      ) : (
        <>
          <Trend series={data.series} unit={data.unit} />
          <div className="mk-pos-grid">
            <section className="mk-box mk-pos-card mk-pos-wide">
              <h3>🏆 Best sellers</h3>
              {data.products.length ? (
                <ol className="mk-pos-products">
                  {data.products.map((item, index) => (
                    <li key={item.key}>
                      <span className="mk-pos-rank">{index + 1}</span>
                      <div><b>{item.slug ? <Link to={`/market/item/${item.slug}`}>{item.title}</Link> : item.title}</b><small>{item.qty} sold · {item.orders} order{item.orders === 1 ? '' : 's'}</small>
                        <i className="mk-pos-bar"><em style={{ width: `${Math.max(3, (item.revenue / data.products[0].revenue) * 100)}%` }} /></i>
                      </div>
                      <b className="mk-pos-money">{ksh(item.revenue)}</b>
                    </li>
                  ))}
                </ol>
              ) : <p className="os-muted">No products sold in this period.</p>}
            </section>
            <Breakdown title="💳 How buyers pay" rows={data.payments} />
            <Breakdown title="🚚 How they get it" rows={data.deliveries} />
            <section className="mk-box mk-pos-card">
              <h3>⏰ Busiest hours</h3>
              <Bars rows={data.hours.map((row) => ({ key: row.hour, label: row.hour % 6 === 0 ? `${row.hour}h` : '', title: `${row.hour}:00–${row.hour + 1}:00`, value: row.orders }))} unit="orders" />
              <small className="os-muted">{peak(data.hours, (row) => `${row.hour}:00–${row.hour + 1}:00`)}</small>
            </section>
            <section className="mk-box mk-pos-card">
              <h3>📅 Busiest days</h3>
              <Bars rows={data.weekdays.map((row) => ({ key: row.day, label: row.day, title: `${row.day}: ${row.orders} orders, ${ksh(row.orderValue)}`, value: row.orders }))} unit="orders" />
              <small className="os-muted">{peak(data.weekdays, (row) => row.day)}</small>
            </section>
            <section className="mk-box mk-pos-card">
              <h3>🙋 Top buyers</h3>
              {data.buyers.length ? (
                <ul className="mk-pos-list">{data.buyers.map((row, index) => <li key={index}><span>{row.name}<small>{row.orders} order{row.orders === 1 ? '' : 's'}</small></span><b>{ksh(row.value)}</b></li>)}</ul>
              ) : <p className="os-muted">No buyers yet.</p>}
            </section>
            <section className="mk-box mk-pos-card">
              <h3>📍 Where they are</h3>
              {data.places.length ? (
                <ul className="mk-pos-list">{data.places.map((row) => <li key={row.key}><span>{row.label}<small>{row.orders} order{row.orders === 1 ? '' : 's'}</small></span><b>{ksh(row.value)}</b></li>)}</ul>
              ) : <p className="os-muted">Mostly pickups: no delivery places yet.</p>}
            </section>
            <section className="mk-box mk-pos-card">
              <h3>📋 Orders by status</h3>
              <ul className="mk-pos-list">{data.statuses.sort((a, b) => b.orders - a.orders).map((row) => <li key={row.status}><span>{STATUS[row.status] || row.status}</span><b>{row.orders}</b></li>)}</ul>
            </section>
          </div>
        </>
      )}

      <section className="mk-box mk-pos-card mk-pos-stock">
        <h3>📦 Stock</h3>
        <div className="mk-pos-stock-figures">
          <div><b>{data.stock.live}</b><small>products selling online</small></div>
          <div className={data.stock.out ? 'bad' : ''}><b>{data.stock.out}</b><small>sold out</small></div>
          <div className={data.stock.low.length ? 'warn' : ''}><b>{data.stock.low.length}</b><small>3 or fewer left</small></div>
          <div><b>{data.stock.notSelling}</b><small>no orders this period</small></div>
        </div>
        {data.stock.low.length > 0 && (
          <ul className="mk-pos-list">{data.stock.low.map((item) => <li key={item._id}><span><Link to={`/market/item/${item.slug}`}>{item.title}</Link></span><b className={item.stock <= 0 ? 'danger-text' : ''}>{item.stock <= 0 ? 'Sold out' : `${item.stock} left`}</b></li>)}</ul>
        )}
        <Link to="/seller?tab=inventory" className="os-btn os-btn-ghost">Update stock in Inventory →</Link>
      </section>

      <button type="button" className="os-linkbtn mk-pos-off" disabled={busy} onClick={() => toggle(false)}>Turn off the POS dashboard</button>
    </div>
  );
}

const peak = (rows, name) => {
  const best = rows.reduce((top, row) => (row.orders > (top?.orders || 0) ? row : top), null);
  return best ? `Busiest: ${name(best)}` : 'No orders yet';
};

// a headline figure and its change against the period before (▲ green when it's good news)
function Kpi({ label, hint, value, change, unit = '%', lowerIsBetter = false }) {
  const has = change !== undefined && change !== null;
  const good = has && (lowerIsBetter ? change < 0 : change > 0);
  const bad = has && (lowerIsBetter ? change > 0 : change < 0);
  return (
    <div className="mk-pos-kpi">
      <small>{label}</small>
      <b>{value}</b>
      {has ? <span className={`mk-pos-change ${good ? 'up' : bad ? 'down' : ''}`}>{change > 0 ? '▲' : change < 0 ? '▼' : '•'} {Math.abs(change)}{unit === 'pts' ? ' pts' : '%'}</span> : change === null ? <span className="mk-pos-change up">new</span> : <span className="mk-pos-change"> </span>}
      {hint && <em>{hint}</em>}
    </div>
  );
}

// the chart: one figure over the period (bars), with the value on hover / tap
function Trend({ series, unit }) {
  const [metric, setMetric] = useState('orderValue');
  const [, label, money] = METRICS.find(([key]) => key === metric);
  const values = series.map((row) => row[metric] || 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const [hover, setHover] = useState(null);
  const shown = hover != null ? series[hover] : null;
  const ticks = [max, max / 2, 0];
  const every = Math.ceil(series.length / 8); // labels under the bars: no more than ~8
  return (
    <section className="mk-box mk-pos-card mk-pos-trend">
      <div className="mk-pos-trend-head">
        <div>
          <h3>{label} by {unit}</h3>
          <b className="mk-pos-trend-total">{shown ? `${bucketLabel(shown.key, unit)}: ${money ? ksh(shown[metric]) : shown[metric]}` : `${money ? ksh(total) : total} in total`}</b>
        </div>
        <div className="mk-chips" role="group" aria-label="What to show">
          {METRICS.map(([key, name]) => <button key={key} type="button" className={metric === key ? 'on' : ''} aria-pressed={metric === key} onClick={() => setMetric(key)}>{name}</button>)}
        </div>
      </div>
      <div className="mk-pos-chart" role="img" aria-label={`${label} by ${unit}: ${series.map((row) => `${bucketLabel(row.key, unit)} ${row[metric] || 0}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        <div className="mk-pos-axis" aria-hidden="true">{ticks.map((tick, index) => <span key={index}>{money ? short(tick) : Math.round(tick)}</span>)}</div>
        <div className="mk-pos-plot">
          <div className="mk-pos-grid-lines" aria-hidden="true"><i /><i /><i /></div>
          <div className="mk-pos-cols">
            {series.map((row, index) => (
              <button type="button" key={row.key} className={`mk-pos-col ${hover === index ? 'on' : ''}`} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onClick={() => setHover(index)}
                aria-label={`${bucketLabel(row.key, unit)}: ${money ? ksh(row[metric]) : row[metric] || 0}`}>
                <i style={{ height: `${((row[metric] || 0) / max) * 100}%` }} />
                <small>{index % every === 0 ? bucketLabel(row.key, unit) : ''}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// a share bar per row (payments, delivery)
function Breakdown({ title, rows }) {
  const total = rows.reduce((sum, row) => sum + row.orders, 0) || 1;
  return (
    <section className="mk-box mk-pos-card">
      <h3>{title}</h3>
      {rows.length ? (
        <ul className="mk-pos-shares">
          {rows.map((row) => (
            <li key={row.key}>
              <span>{row.label}</span>
              <b>{Math.round((row.orders / total) * 100)}%</b>
              <i className="mk-pos-bar"><em style={{ width: `${(row.orders / total) * 100}%` }} /></i>
              <small>{row.orders} order{row.orders === 1 ? '' : 's'} · {ksh(row.value)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="os-muted">No orders yet.</p>}
    </section>
  );
}

// small column bars (hours, weekdays)
function Bars({ rows, unit }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="mk-pos-minibars" role="img" aria-label={rows.map((row) => `${row.title}: ${row.value} ${unit}`).join(', ')}>
      {rows.map((row) => (
        <span key={row.key} title={`${row.title}: ${row.value} ${unit}`}>
          <i style={{ height: `${Math.max(row.value ? 6 : 2, (row.value / max) * 100)}%` }} className={row.value === max && row.value > 0 ? 'top' : ''} />
          <small>{row.label}</small>
        </span>
      ))}
    </div>
  );
}
