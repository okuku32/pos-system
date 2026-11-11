import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import api, { errMsg, money, downloadCSV, today, daysAgo } from '../api';

const PRESETS = [
  { key: 'today', label: 'Today', from: () => today(), to: () => today() },
  { key: '7d', label: '7 days', from: () => daysAgo(6), to: () => today() },
  { key: '30d', label: '30 days', from: () => daysAgo(29), to: () => today() },
  {
    key: 'month',
    label: 'This month',
    from: () => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
    },
    to: () => today(),
  },
];

// Fixed categorical order (validated palette): slot 1 = revenue, slot 2 = profit
const SERIES = [
  { key: 'revenue', label: 'Revenue', color: '#2a78d6' },
  { key: 'profit', label: 'Profit', color: '#eb6834' },
];

const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

const sinceText = (days) => (days === null || days === undefined ? 'never sold' : days === 0 ? 'sold today' : days === 1 ? 'last sold yesterday' : `last sold ${days} days ago`);

const STOCK_LABEL = { ok: 'In stock', low: 'Low, restock soon', out: 'Out of stock', deleted: 'Deleted' };
function StockCell({ n, status }) {
  if (n === null || n === undefined) return <span className="muted">–</span>;
  return <b className={status === 'out' ? 'error-text' : status === 'low' ? 'warn-text' : ''}>{n}</b>;
}

// Every day in the range, so days with no sales show as zero instead of disappearing
function fillDays(from, to, rows) {
  const map = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (d <= end && out.length < 400) {
    const key = d.toLocaleDateString('en-CA');
    const r = map.get(key);
    out.push({ date: key, revenue: r?.revenue || 0, cost: r?.cost || 0, profit: r?.profit || 0, count: r?.count || 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function TrendChart({ days }) {
  const [hover, setHover] = useState(null);
  const W = 760;
  const H = 240;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(1, ...days.map((d) => Math.max(d.revenue, d.profit)));
  const min = Math.min(0, ...days.map((d) => d.profit)); // profit can be negative
  const span = max - min;
  const y = (v) => pad.t + ih - ((v - min) / span) * ih;
  const band = iw / days.length;
  const barW = Math.max(2, Math.min(18, (band - 6) / 2));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + span * t);
  const labelEvery = Math.ceil(days.length / 10);
  const short = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : Math.round(n));

  // Bar path with 4px rounded data-end, square at the baseline
  const bar = (x, v) => {
    const y0 = y(0);
    const y1 = y(v);
    const h = Math.abs(y0 - y1);
    if (h < 0.5) return '';
    const r = Math.min(4, h, barW / 2);
    if (v >= 0)
      return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z`;
    return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 - r} V${y0} Z`;
  };

  const h = hover !== null ? days[hover] : null;
  return (
    <div className="chart">
      <div className="legend">
        {SERIES.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily revenue and profit" onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={Math.abs(t) < 1e-9 ? 'axis' : 'grid'} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="tick">{short(t)}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const x0 = pad.l + i * band + (band - (barW * 2 + 2)) / 2;
            return (
              <g key={d.date}>
                {hover === i && <rect x={pad.l + i * band} y={pad.t} width={band} height={ih} className="hover-band" />}
                <path d={bar(x0, d.revenue)} fill={SERIES[0].color} />
                <path d={bar(x0 + barW + 2, d.profit)} fill={SERIES[1].color} />
                {i % labelEvery === 0 && (
                  <text x={pad.l + i * band + band / 2} y={H - 8} textAnchor="middle" className="tick">
                    {new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </text>
                )}
                {/* hit target: the whole day column, bigger than the bars */}
                <rect x={pad.l + i * band} y={pad.t} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {h && (
          <div
            className="tooltip"
            style={{ left: `${((pad.l + hover * band + band / 2) / W) * 100}%` }}
          >
            <b>{new Date(`${h.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
            {SERIES.map((s) => (
              <div key={s.key} className="row-between"><span><i style={{ background: s.color }} />{s.label}</span><span>{money(h[s.key])}</span></div>
            ))}
            <div className="row-between muted"><span>Sales</span><span>{h.count}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Reports() {
  const [preset, setPreset] = useState('30d');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('products');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!from || !to || from > to) return;
    api
      .get('/reports/summary', { params: { from, to } })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(errMsg(e)));
  }, [from, to]);

  const pick = (p) => {
    setPreset(p.key);
    setFrom(p.from());
    setTo(p.to());
  };

  const days = useMemo(() => (data ? fillDays(from, to, data.daily) : []), [data, from, to]);

  if (!data) return <p className="muted">Loading…</p>;
  const t = data.totals;

  const pt = data.purchaseTotals || {};
  const tables = {
    products: {
      label: 'By product',
      rows: data.products,
      cols: [
        { label: 'Product', value: (r) => r.name },
        { label: 'Qty sold', value: (r) => r.qty, num: true },
        { label: 'Revenue', value: (r) => r.revenue, money: true },
        { label: 'Cost', value: (r) => r.cost, money: true },
        { label: 'Profit', value: (r) => r.profit, money: true },
        { label: 'Margin', value: (r) => (r.revenue ? (r.profit / r.revenue) * 100 : 0), pct: true },
        { label: 'In stock now', value: (r) => (r.stock ?? '–'), num: true, render: (r) => <StockCell n={r.stock} status={r.status} /> },
      ],
    },
    stock: {
      label: `Stock remaining${data.stockTotals?.low + data.stockTotals?.out ? ` (${data.stockTotals.low + data.stockTotals.out} need restock)` : ''}`,
      rows: data.stock || [],
      empty: 'No products yet.',
      cols: [
        { label: 'Product', value: (r) => r.name, render: (r) => <>{r.name}{!r.active && <small className="muted"> (hidden)</small>}</> },
        { label: 'Category', value: (r) => r.category },
        { label: 'Sold (period)', value: (r) => r.sold, num: true },
        { label: 'In stock now', value: (r) => r.stock, num: true, render: (r) => <StockCell n={r.stock} status={r.status} /> },
        { label: 'In open orders', value: (r) => r.reserved, num: true, render: (r) => (r.reserved ? r.reserved : <span className="muted">0</span>) },
        { label: 'Left after orders', value: (r) => r.afterOrders, num: true, render: (r) => <b className={r.afterOrders < 0 ? 'error-text' : ''}>{r.afterOrders}</b> },
        { label: 'Status', value: (r) => STOCK_LABEL[r.status], render: (r) => <span className={`badge stock-${r.status}`}>{STOCK_LABEL[r.status]}</span> },
        { label: 'Value at cost', value: (r) => r.costValue, money: true },
        { label: 'Value at selling price', value: (r) => r.retailValue, money: true },
      ],
    },
    best: {
      label: 'Best sellers',
      rows: data.bestSellers || [],
      empty: 'Nothing sold in this period.',
      cols: [
        { label: '#', value: (r) => (data.bestSellers || []).indexOf(r) + 1, num: true },
        { label: 'Product', value: (r) => r.name },
        { label: 'Units sold', value: (r) => r.qty, num: true },
        { label: 'Revenue', value: (r) => r.revenue, money: true },
        { label: 'Profit', value: (r) => r.profit, money: true },
        { label: 'In stock now', value: (r) => (r.stock ?? '–'), num: true },
      ],
    },
    slow: {
      label: 'Slow sellers',
      rows: data.slowSellers || [],
      empty: 'No products yet.',
      cols: [
        { label: 'Product', value: (r) => r.name },
        { label: 'Category', value: (r) => r.category },
        { label: 'Sold (period)', value: (r) => r.sold, num: true, render: (r) => (r.sold ? r.sold : <b className="error-text">0</b>) },
        { label: 'Last sold', value: (r) => (r.lastSoldAt ? new Date(r.lastSoldAt).toLocaleDateString() : 'never'), render: (r) => <span className={r.daysSinceSale === null || r.daysSinceSale > 30 ? 'warn-text' : ''}>{r.lastSoldAt ? new Date(r.lastSoldAt).toLocaleDateString() : 'never'}</span> },
        { label: 'In stock', value: (r) => r.stock, num: true },
        { label: 'Money tied up (cost)', value: (r) => r.costValue, money: true },
      ],
    },
    expenses: {
      label: 'Expenses',
      rows: data.expenses?.byCategory || [],
      empty: 'No expenses recorded for this period. Add them on the Expenses page.',
      cols: [
        { label: 'Category', value: (r) => r.category },
        { label: 'Entries', value: (r) => r.count, num: true },
        { label: 'Amount', value: (r) => r.total, money: true },
        { label: 'Share', value: (r) => r.share, pct: true },
      ],
    },
    debts: {
      label: `Debts${data.debts?.suppliers?.length ? ` (${data.debts.suppliers.length})` : ''}`,
      rows: data.debts?.suppliers || [],
      empty: 'You don’t owe any supplier anything right now 👍',
      cols: [
        { label: 'Owed to supplier', value: (r) => r.name },
        { label: 'Unpaid purchases', value: (r) => r.purchases, num: true },
        { label: 'Oldest unpaid since', value: (r) => new Date(r.oldest).toLocaleDateString() },
        { label: 'Days outstanding', value: (r) => r.daysOutstanding, num: true, render: (r) => <b className={r.daysOutstanding > 30 ? 'error-text' : r.daysOutstanding > 14 ? 'warn-text' : ''}>{r.daysOutstanding}</b> },
        { label: 'Amount owed', value: (r) => r.owed, money: true, render: (r) => <b className="error-text">{money(r.owed)}</b> },
      ],
    },
    purchases: {
      label: 'Purchases by supplier',
      rows: data.purchaseSuppliers || [],
      empty: 'No purchases, deliveries or supplier payments in this period.',
      cols: [
        { label: 'Supplier', value: (r) => r.name },
        { label: 'Orders placed', value: (r) => r.orders, num: true },
        { label: 'Ordered value', value: (r) => r.orderedValue, money: true },
        { label: 'Stock received', value: (r) => r.receivedValue, money: true },
        { label: 'Units received', value: (r) => r.units, num: true },
        { label: 'Paid', value: (r) => r.paid, money: true },
        { label: 'Owed now', value: (r) => r.owed, money: true, render: (r) => (r.owed > 0 ? <b className="error-text">{money(r.owed)}</b> : <span className="muted">–</span>) },
      ],
    },
    received: {
      label: 'Stock received',
      rows: data.purchaseProducts || [],
      empty: 'No stock was received in this period.',
      cols: [
        { label: 'Product', value: (r) => r.name },
        { label: 'Supplier(s)', value: (r) => (r.suppliers || []).join(', ') },
        { label: 'Qty received', value: (r) => r.qty, num: true },
        { label: 'Avg unit cost', value: (r) => r.avgCost, money: true },
        { label: 'Total cost', value: (r) => r.cost, money: true },
      ],
    },
    categories: {
      label: 'By category',
      rows: data.categories,
      cols: [
        { label: 'Category', value: (r) => r._id },
        { label: 'Qty sold', value: (r) => r.qty, num: true },
        { label: 'Revenue', value: (r) => r.revenue, money: true },
        { label: 'Cost', value: (r) => r.cost, money: true },
        { label: 'Profit', value: (r) => r.profit, money: true },
        { label: 'Margin', value: (r) => (r.revenue ? (r.profit / r.revenue) * 100 : 0), pct: true },
      ],
    },
    cashiers: {
      label: 'By cashier',
      rows: data.cashiers,
      cols: [
        { label: 'Cashier', value: (r) => r.name },
        { label: 'Sales', value: (r) => r.count, num: true },
        { label: 'Revenue', value: (r) => r.revenue, money: true },
        { label: 'Profit', value: (r) => r.profit, money: true },
        { label: 'Avg sale', value: (r) => (r.count ? r.revenue / r.count : 0), money: true },
      ],
    },
    methods: {
      label: 'By payment',
      rows: data.methods,
      cols: [
        { label: 'Method', value: (r) => (r._id === 'mpesa' ? 'M-Pesa' : 'Cash') },
        { label: 'Sales', value: (r) => r.count, num: true },
        { label: 'Revenue', value: (r) => r.revenue, money: true },
        { label: 'Share', value: (r) => (t.revenue ? (r.revenue / t.revenue) * 100 : 0), pct: true },
      ],
    },
    daily: {
      label: 'By day',
      rows: [...days].reverse(),
      cols: [
        { label: 'Date', value: (r) => r.date },
        { label: 'Sales', value: (r) => r.count, num: true },
        { label: 'Revenue', value: (r) => r.revenue, money: true },
        { label: 'Cost', value: (r) => r.cost, money: true },
        { label: 'Profit', value: (r) => r.profit, money: true },
      ],
    },
  };
  const current = tables[tab];
  const fmt = (c, v) => (c.money ? money(v) : c.pct ? pct(v) : v);

  const exportCSV = () =>
    downloadCSV(
      `report-${tab}-${from}_to_${to}.csv`,
      current.cols.map((c) => ({ label: c.label, value: (r) => (c.money || c.pct ? Number(c.value(r)).toFixed(2) : c.value(r)) })),
      current.rows
    );

  return (
    <div>
      <div className="page-head">
        <h2>Reports</h2>
        <div className="toolbar wrap">
          {PRESETS.map((p) => (
            <button key={p.key} className={`chip ${preset === p.key ? 'active' : ''}`} onClick={() => pick(p)}>{p.label}</button>
          ))}
          <input type="date" value={from} max={to} onChange={(e) => { setPreset(''); setFrom(e.target.value); }} />
          <input type="date" value={to} min={from} onChange={(e) => { setPreset(''); setTo(e.target.value); }} />
        </div>
      </div>

      <div className="stats">
        <div className="card stat"><span className="muted">Revenue</span><b>{money(t.revenue)}</b><small className="muted">{t.count} sales · avg {money(t.avgSale)}</small></div>
        <div className="card stat"><span className="muted">Cost of goods</span><b>{money(t.cost)}</b><small className="muted">{t.itemsSold} items sold</small></div>
        <div className="card stat"><span className="muted">Gross profit</span><b className={t.profit < 0 ? 'error-text' : ''}>{money(t.profit)}</b><small className="muted">Margin {pct(t.margin)}</small></div>
        <div className="card stat"><span className="muted">Discounts given</span><b>{money(t.discount)}</b><small className="muted">Tax collected {money(t.tax)}</small></div>
        {data.expenses && (
          <button className="card stat stat-link" onClick={() => setTab('expenses')} title="See expenses by category">
            <span className="muted">Total expenses</span>
            <b>{money(data.expenses.total)}</b>
            <small className="muted">{data.expenses.byCategory.length ? `${data.expenses.byCategory[0].category} is the biggest` : 'none recorded'} · <Link to="/expenses">add</Link></small>
          </button>
        )}
        {data.expenses && (
          <div className={`card stat ${data.expenses.netProfit < 0 ? 'stat-bad' : 'stat-good'}`}>
            <span className="muted">Net profit</span>
            <b className={data.expenses.netProfit < 0 ? 'error-text' : 'success-text'}>{money(data.expenses.netProfit)}</b>
            <small className="muted">gross profit {money(t.profit)} − expenses {money(data.expenses.total)}</small>
          </div>
        )}
        {data.purchaseTotals && (
          <button className="card stat stat-link" onClick={() => setTab('purchases')} title="See purchases by supplier">
            <span className="muted">Purchases (stock received)</span>
            <b>{money(pt.receivedValue)}</b>
            <small className="muted">
              Paid suppliers {money(pt.paid)} · {pt.owedNow > 0 ? <span className="error-text">owed {money(pt.owedNow)}</span> : 'nothing owed'}
            </small>
          </button>
        )}
        {data.purchaseTotals && (
          <div className="card stat">
            <span className="muted">Sales vs supplier payments</span>
            <b className={pt.netCash < 0 ? 'error-text' : 'success-text'}>{pt.netCash < 0 ? '−' : '+'}{money(Math.abs(pt.netCash))}</b>
            <small className="muted">{money(t.revenue)} in from sales − {money(pt.paid)} paid out</small>
          </div>
        )}
        {data.stockTotals && (
          <button className="card stat stat-link" onClick={() => setTab('stock')} title="See stock remaining per product">
            <span className="muted">Stock remaining</span>
            <b>{data.stockTotals.units.toLocaleString()} units</b>
            <small className="muted">
              Worth {money(data.stockTotals.costValue)} at cost ·{' '}
              {data.stockTotals.out > 0 && <span className="error-text">{data.stockTotals.out} out</span>}
              {data.stockTotals.out > 0 && data.stockTotals.low > 0 && ', '}
              {data.stockTotals.low > 0 && <span className="warn-text">{data.stockTotals.low} low</span>}
              {!data.stockTotals.out && !data.stockTotals.low && 'all well stocked'}
            </small>
          </button>
        )}
      </div>

      {/* Highlights: best sellers, slow sellers, outstanding debts */}
      <div className="report-highlights">
        <div className="card">
          <div className="row-between"><h3 style={{ margin: 0 }}>🏆 Best sellers</h3><button className="btn ghost sm" onClick={() => setTab('best')}>See all</button></div>
          <ol className="rank-list">
            {(data.bestSellers || []).slice(0, 5).map((p) => (
              <li key={p._id}><span>{p.name}</span><b>{p.qty} sold</b><small className="muted">{money(p.revenue)}</small></li>
            ))}
            {!(data.bestSellers || []).length && <p className="muted">Nothing sold in this period.</p>}
          </ol>
        </div>
        <div className="card">
          <div className="row-between"><h3 style={{ margin: 0 }}>🐢 Slow sellers</h3><button className="btn ghost sm" onClick={() => setTab('slow')}>See all</button></div>
          <ol className="rank-list slow">
            {(data.slowSellers || []).slice(0, 5).map((p) => (
              <li key={p._id}><span>{p.name}</span><b className={p.sold ? '' : 'error-text'}>{p.sold} sold</b><small className="muted">{sinceText(p.daysSinceSale)} · {p.stock} in stock</small></li>
            ))}
          </ol>
          <small className="muted">Consider a discount or a smaller re-order for these.</small>
        </div>
        <div className="card">
          <div className="row-between"><h3 style={{ margin: 0 }}>💳 Outstanding debts</h3><button className="btn ghost sm" onClick={() => setTab('debts')}>See all</button></div>
          <div className="debt-line"><span>You owe suppliers</span><b className={data.debts?.owedToSuppliers > 0 ? 'error-text' : 'success-text'}>{money(data.debts?.owedToSuppliers)}</b></div>
          {(data.debts?.suppliers || []).slice(0, 3).map((d) => (
            <div key={d._id} className="debt-line sub"><span>{d.name}</span><span>{money(d.owed)} <small className="muted">· {d.daysOutstanding}d</small></span></div>
          ))}
          <div className="debt-line" style={{ marginTop: 8 }}><span>Customers owe you <small className="muted">(unpaid open orders)</small></span><b className={data.debts?.customerOrders.total > 0 ? 'warn-text' : ''}>{money(data.debts?.customerOrders.total)}</b></div>
          {data.debts?.customerOrders.count > 0 && <small className="muted">{data.debts.customerOrders.count} order(s) · <Link to="/orders">collect payment</Link></small>}
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>Revenue and profit per day</h3>
          <button className="btn ghost sm" onClick={() => setShowTable(!showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>
        </div>
        {showTable ? (
          <table className="table">
            <thead><tr><th>Date</th><th className="right">Revenue</th><th className="right">Profit</th><th className="right">Sales</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}><td>{d.date}</td><td className="right">{money(d.revenue)}</td><td className="right">{money(d.profit)}</td><td className="right">{d.count}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <TrendChart days={days} />
        )}
      </div>

      <div className="card table-wrap">
        <div className="row-between" style={{ padding: '12px 12px 0' }}>
          <div className="chips" style={{ margin: 0 }}>
            {Object.entries(tables).map(([k, v]) => (
              <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{v.label}</button>
            ))}
          </div>
          <button className="btn ghost sm" onClick={exportCSV} disabled={!current.rows.length}>Export CSV</button>
        </div>
        <table className="table">
          <thead>
            <tr>{current.cols.map((c) => <th key={c.label} className={c.money || c.num || c.pct ? 'right' : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {current.rows.map((r, i) => (
              <tr key={i}>
                {current.cols.map((c) => {
                  const v = c.value(r);
                  return (
                    <td key={c.label} className={`${c.money || c.num || c.pct ? 'right' : ''} ${c.label === 'Profit' && v < 0 ? 'error-text' : ''}`}>
                      {c.render ? c.render(r) : fmt(c, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!current.rows.length && <tr><td colSpan={current.cols.length} className="center muted">{current.empty || 'No completed sales in this period.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted"><small>Profit = sales after discount − cost price of items sold (cost is recorded at the time of each sale). Product and category revenue are before order-level discounts. Net profit = gross profit − expenses. Stock bought from suppliers isn’t an expense here: its cost is counted as cost of goods when items sell.</small></p>
    </div>
  );
}
