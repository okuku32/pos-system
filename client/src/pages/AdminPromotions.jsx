import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg, downloadCSV } from '../api';

// Admin → Promotions: what sellers pay to boost their ads ("Featured"), by day, week or month
const money = (amount) => `KSh ${Math.round(Number(amount || 0)).toLocaleString('en-KE')}`;
const short = (number) => (number >= 1000 ? `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k` : String(Math.round(number)));
const when = (date) => (date ? new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const GROUPS = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']];
const NOUN = { day: 'day', week: 'week', month: 'month' };

// one series: revenue per period (thin bars, rounded tops on the baseline, hover tooltip, label on the best one)
function RevenueChart({ series, group }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const width = 960;
  const height = 260;
  const pad = { l: 56, r: 12, t: 22, b: 34 };
  const max = Math.max(1, ...series.map((seriesItem) => seriesItem.revenue));
  // a "nice" top for the axis
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const count = series.length;
  const band = (width - pad.l - pad.r) / count;
  const barW = Math.max(3, Math.min(28, band - 2)); // 2px surface gap between bars
  const year = (value) => pad.t + (height - pad.t - pad.b) * (1 - value / top);
  const best = series.reduce((total, seriesItem, index) => (seriesItem.revenue > (series[total]?.revenue || 0) ? index : total), -1);
  const every = Math.ceil(count / (group === 'day' ? 10 : 12)); // thin the x labels
  const bar = (left, yTop, boxWidth, boxHeight) => {
    const amount = Math.min(4, boxWidth / 2, boxHeight);
    return `M${left},${yTop + boxHeight} L${left},${yTop + amount} Q${left},${yTop} ${left + amount},${yTop} L${left + boxWidth - amount},${yTop} Q${left + boxWidth},${yTop} ${left + boxWidth},${yTop + amount} L${left + boxWidth},${yTop + boxHeight} Z`;
  };
  return (
    <div className="promo-chart" ref={box}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Promotion revenue per ${NOUN[group]}`} preserveAspectRatio="none">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={year(tick)} y2={year(tick)} className="promo-grid" />
            <text x={pad.l - 8} y={year(tick) + 4} className="promo-axis" textAnchor="end">{tick ? short(tick) : '0'}</text>
          </g>
        ))}
        {series.map((seriesItem, index) => {
          const offsetX = pad.l + index * band + (band - barW) / 2;
          const amount = Math.max(0, year(0) - year(seriesItem.revenue));
          return (
            <g key={seriesItem.start}>
              {seriesItem.revenue > 0 && <path d={bar(offsetX, year(seriesItem.revenue), barW, amount)} className={`promo-bar ${hover === index ? 'on' : ''} ${seriesItem.current ? 'current' : ''}`} />}
              {index === best && seriesItem.revenue > 0 && <text x={offsetX + barW / 2} y={year(seriesItem.revenue) - 6} className="promo-label" textAnchor="middle">{short(seriesItem.revenue)}</text>}
              {index % every === 0 && <text x={offsetX + barW / 2} y={height - 12} className="promo-axis" textAnchor="middle">{group === 'month' ? seriesItem.label.split(' ')[0] : seriesItem.label.split(/ –|, /)[0].replace(/^\w+ /, group === 'day' ? '' : '$&')}</text>}
              {/* the hover target: the whole column, bigger than the bar */}
              <rect x={pad.l + index * band} y={pad.t} width={band} height={height - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${seriesItem.label}: ${money(seriesItem.revenue)}, ${seriesItem.boosts} boosts`} />
            </g>
          );
        })}
        <line x1={pad.l} x2={width - pad.r} y1={year(0)} y2={year(0)} className="promo-base" />
      </svg>
      {hover != null && series[hover] && (
        <div className="promo-tip" style={{ left: `${((pad.l + hover * band + band / 2) / width) * 100}%`, top: `${(year(series[hover].revenue) / height) * 100}%` }}>
          <b>{series[hover].label}{series[hover].current ? ' (so far)' : ''}</b>
          <span>{money(series[hover].revenue)}</span>
          <small>{series[hover].boosts} boost{series[hover].boosts === 1 ? '' : 's'} · {series[hover].sellers} seller{series[hover].sellers === 1 ? '' : 's'}</small>
        </div>
      )}
    </div>
  );
}

export default function AdminPromotions() {
  const [group, setGroup] = useState('day');
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/admin/promotions', { params: { group, from: range.from || undefined, to: range.to || undefined } }).then((response) => live && setData(response.data)).catch((error) => toast.error(errMsg(error)));
    return () => {
      live = false;
    };
  }, [group, range.from, range.to]);
  const rows = useMemo(() => (data ? [...data.series].reverse() : []), [data]); // newest first in the table
  const exportPeriods = () => downloadCSV(`kapu-promotions-${group}.csv`, [
    { label: NOUN[group][0].toUpperCase() + NOUN[group].slice(1), value: (row) => row.label }, { label: 'Revenue (KSh)', value: (row) => row.revenue }, { label: 'Boosts', value: (row) => row.boosts }, { label: 'Sellers', value: (row) => row.sellers },
  ], rows);
  const exportPayments = () => downloadCSV('kapu-promotion-payments.csv', [
    { label: 'Paid', value: (row) => new Date(row.at).toISOString() }, { label: 'Seller', value: (row) => row.name }, { label: 'Shop', value: (row) => row.shop }, { label: 'Ad', value: (row) => row.title },
    { label: 'Package', value: (row) => row.plan }, { label: 'Amount (KSh)', value: (row) => row.amount }, { label: 'M-Pesa', value: (row) => row.receipt }, { label: 'Featured until', value: (row) => new Date(row.endsAt).toISOString() },
  ], data.payments);
  const cards = data?.cards;
  const totals = data?.totals;
  return (
    <div className="promo">
      <div className="page-head"><h2>Promotions</h2></div>
      <p className="muted" style={{ marginTop: -6 }}>What sellers pay to boost their ads to the top of search and the home page (“Featured”), paid by M-Pesa.</p>
      {cards && (
        <div className="stats" style={{ marginBottom: 14 }}>
          {[['Today', cards.today], ['This week', cards.week], ['This month', cards.month], ['All time', cards.all]].map(([key, value]) => (
            <div key={key} className="card stat"><small className="muted">{key}</small><b>{money(value.revenue)}</b><small className="muted">{value.boosts} boost{value.boosts === 1 ? '' : 's'}</small></div>
          ))}
        </div>
      )}
      <div className="toolbar" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {GROUPS.map(([key, value]) => <button key={key} className={`btn ${group === key ? '' : 'ghost'} sm`} aria-pressed={group === key} onClick={() => setGroup(key)}>{value}</button>)}
        <span className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
          From <input type="date" aria-label="From date" style={{ width: 150 }} value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
          to <input type="date" aria-label="To date" style={{ width: 150 }} value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
          {(range.from || range.to) && <button className="btn ghost sm" onClick={() => setRange({ from: '', to: '' })}>Clear dates</button>}
        </span>
      </div>
      {!data ? <p className="muted">Loading…</p> : (
        <>
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="promo-head">
              <div>
                <b style={{ fontSize: 22 }}>{money(totals.revenue)}</b>
                <span className="muted"> from {totals.boosts} boost{totals.boosts === 1 ? '' : 's'} by {totals.sellers} seller{totals.sellers === 1 ? '' : 's'} · {data.series.length} {NOUN[group]}s</span>
              </div>
              <small className="muted">
                Average {money(totals.average)} per boost{totals.best ? ` · best ${NOUN[group]}: ${totals.best.label} (${money(totals.best.revenue)})` : ''} · {data.activeNow} ad{data.activeNow === 1 ? '' : 's'} featured now
                {data.pending.n > 0 ? ` · ${data.pending.n} waiting for M-Pesa` : ''}{data.failed.n > 0 ? ` · ${data.failed.n} failed (${money(data.failed.amount)} not paid)` : ''}
              </small>
            </div>
            <RevenueChart series={data.series} group={group} />
          </div>

          <div className="promo-grid-2">
            <div className="card table-wrap">
              <div className="promo-table-head"><b>{GROUPS.find((sellerGroup) => sellerGroup[0] === group)[1]} earnings</b><button className="btn ghost sm" onClick={exportPeriods}>⬇ CSV</button></div>
              <table className="table">
                <thead><tr><th>{NOUN[group][0].toUpperCase() + NOUN[group].slice(1)}</th><th className="right">Revenue</th><th className="right">Boosts</th><th className="right">Sellers</th><th className="right">vs previous</th></tr></thead>
                <tbody>
                  {rows.map((row, index) => {
                    const prev = rows[index + 1];
                    const ch = prev && prev.revenue ? Math.round(((row.revenue - prev.revenue) / prev.revenue) * 100) : null;
                    return (
                      <tr key={row.start}>
                        <td className="nowrap">{row.label}{row.current && <small className="muted"> (so far)</small>}</td>
                        <td className="right"><b>{money(row.revenue)}</b></td>
                        <td className="right">{row.boosts}</td>
                        <td className="right">{row.sellers}</td>
                        <td className="right">{ch == null ? <span className="muted">–</span> : <span className={ch < 0 ? 'danger-text' : 'ok-text'}>{ch > 0 ? '▲' : ch < 0 ? '▼' : ''} {Math.abs(ch)}%</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><th>Total</th><th className="right">{money(totals.revenue)}</th><th className="right">{totals.boosts}</th><th className="right">{totals.sellers}</th><th></th></tr></tfoot>
              </table>
            </div>
            <div>
              <div className="card table-wrap" style={{ marginBottom: 14 }}>
                <div className="promo-table-head"><b>By package</b></div>
                <table className="table">
                  <thead><tr><th>Package</th><th className="right">Price</th><th className="right">Boosts</th><th className="right">Revenue</th><th className="right">Share</th></tr></thead>
                  <tbody>
                    {data.byPlan.map((item) => (
                      <tr key={item.plan}><td>{item.label}</td><td className="right">{money(item.price)}</td><td className="right">{item.boosts}</td><td className="right"><b>{money(item.revenue)}</b></td><td className="right">{totals.revenue ? Math.round((item.revenue / totals.revenue) * 100) : 0}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card table-wrap">
                <div className="promo-table-head"><b>Top sellers</b></div>
                <table className="table">
                  <thead><tr><th>Seller</th><th className="right">Ads</th><th className="right">Boosts</th><th className="right">Paid</th></tr></thead>
                  <tbody>
                    {data.topSellers.slice(0, 10).map((item) => (
                      <tr key={item.seller}><td><b>{item.shop || item.name}</b>{item.shop && <div className="muted" style={{ fontSize: 12 }}>{item.name}</div>}</td><td className="right">{item.ads}</td><td className="right">{item.boosts}</td><td className="right"><b>{money(item.revenue)}</b></td></tr>
                    ))}
                    {!data.topSellers.length && <tr><td colSpan={4} className="center muted">No boosts in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card table-wrap" style={{ marginTop: 14 }}>
            <div className="promo-table-head"><b>Payments ({data.payments.length}{data.payments.length === 200 ? '+' : ''})</b><button className="btn ghost sm" onClick={exportPayments} disabled={!data.payments.length}>⬇ CSV</button></div>
            <table className="table">
              <thead><tr><th>Paid</th><th>Seller</th><th>Ad</th><th>Package</th><th className="right">Amount</th><th>M-Pesa</th><th>Featured</th></tr></thead>
              <tbody>
                {data.payments.map((payment) => (
                  <tr key={payment._id}>
                    <td className="nowrap">{when(payment.at)}</td>
                    <td>{payment.shop || payment.name}{payment.shop && <div className="muted" style={{ fontSize: 12 }}>{payment.name}</div>}</td>
                    <td><Link to={`/admin/ads?q=${encodeURIComponent(payment.title || '')}`}>{payment.title}</Link></td>
                    <td>{payment.plan}</td>
                    <td className="right"><b>{money(payment.amount)}</b></td>
                    <td className="nowrap">{payment.receipt || '–'}</td>
                    <td>{payment.live ? <span className="badge completed">until {new Date(payment.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span> : <span className="muted">ended {new Date(payment.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}</td>
                  </tr>
                ))}
                {!data.payments.length && <tr><td colSpan={7} className="center muted">No paid boosts in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
