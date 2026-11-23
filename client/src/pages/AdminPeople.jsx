import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, downloadCSV } from '../api';

// Admin → People: one table per kind of person — buyers, retailers, wholesalers, importers, riders, shopping agents
const money = (amount) => `KSh ${Math.round(Number(amount || 0)).toLocaleString('en-KE')}`;
const num = (number) => Number(number || 0).toLocaleString('en-KE');
const day = (date) => (date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
const phone = (value = '') => (/^254\d{9}$/.test(value) ? `0${value.slice(3, 6)} ${value.slice(6, 9)} ${value.slice(9)}` : value);
const FLAGS = { japan: '🇯🇵 Japan', 'ex-uk': '🇬🇧 UK', dubai: '🇦🇪 Dubai', china: '🇨🇳 China', usa: '🇺🇸 USA', europe: '🇪🇺 Europe' };
const Muted = ({ children }) => <div className="muted" style={{ fontSize: 12 }}>{children}</div>;
const Chips = ({ list }) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{list.map((item) => <span key={item} className="badge" style={{ fontWeight: 600 }}>{item}</span>)}</div>;

const STATUS_BADGE = { approved: 'completed', pending: 'pending', suspended: 'cancelled', rejected: 'cancelled' };
const person = (result) => <><b>{result.name}</b><Muted>{result.email}</Muted></>;
const shop = (result) => <><b>{result.shop || result.name}</b><Muted>{result.shop ? `${result.name} · ` : ''}{phone(result.phone)}</Muted></>;
const place = (result) => <>{[result.area, result.county].filter(Boolean).join(', ') || '–'}{result.market && <Muted>🧺 {result.market}</Muted>}</>;
const sellerCols = (extra = []) => [
  { label: 'Seller', cell: shop, csv: (row) => row.shop || row.name },
  { label: 'Where', cell: place, csv: (row) => [row.area, row.county, row.market].filter(Boolean).join(', ') },
  ...extra,
  { label: 'Live ads', right: true, cell: (row) => <>{num(row.ads)}{row.allAds > row.ads && <Muted>of {row.allAds}</Muted>}</>, csv: (row) => row.ads, total: 'ads' },
  { label: 'Sales', right: true, cell: (row) => num(row.sales), csv: (row) => row.sales, total: 'sales' },
  { label: 'Revenue', right: true, cell: (row) => <b>{money(row.revenue)}</b>, csv: (row) => row.revenue, total: 'revenue', money: true },
  { label: 'Rating', right: true, cell: (row) => (row.reviews ? `★ ${row.rating.toFixed(1)} (${row.reviews})` : '–'), csv: (row) => row.rating },
  { label: 'Verified', cell: (row) => (row.verified ? <span className="badge completed">✔ verified</span> : <span className="muted">–</span>), csv: (row) => (row.verified ? 'yes' : 'no') },
  { label: 'Joined', cell: (row) => day(row.joinedAt), csv: (row) => day(row.joinedAt) },
];
const workerCols = (extra = []) => [
  { label: 'Name', cell: (row) => <><b>{row.name}</b><Muted>{phone(row.phone)}{row.mpesaPhone && row.mpesaPhone !== row.phone ? ` · M-Pesa ${phone(row.mpesaPhone)}` : ''}</Muted></>, csv: (row) => row.name },
  ...extra,
  { label: 'Base', cell: (row) => <>{row.baseArea || '–'}<Muted>within {row.radiusKm || '?'} km{row.market ? ` · ${row.market}` : ''}</Muted></>, csv: (row) => row.baseArea },
  { label: 'Status', cell: (row) => <><span className={`badge ${STATUS_BADGE[row.status] || ''}`}>{row.status}</span>{row.status === 'approved' && <Muted>{row.available ? 'taking jobs' : 'not taking jobs'}</Muted>}</>, csv: (row) => row.status },
  { label: 'Jobs', right: true, cell: (row) => <>{num(row.jobs)}{row.activeJobs > 0 && <Muted>{row.activeJobs} active</Muted>}</>, csv: (row) => row.jobs, total: 'jobs' },
  { label: 'Fees', right: true, cell: (row) => money(row.fees), csv: (row) => row.fees, total: 'fees', money: true },
  { label: 'Earned', right: true, cell: (row) => <b>{money(row.earned)}</b>, csv: (row) => row.earned, total: 'earned', money: true },
  { label: 'Sent to M-Pesa', right: true, cell: (row) => money(row.sent), csv: (row) => row.sent, total: 'sent', money: true },
  { label: 'Balance', right: true, cell: (row) => (row.balance < 0 ? <span className="danger-text">−{money(-row.balance)}</span> : money(row.balance)), csv: (row) => row.balance, total: 'balance', money: true },
  { label: 'Last job', cell: (row) => day(row.lastJobAt), csv: (row) => day(row.lastJobAt) },
];

const KINDS = [
  { key: 'buyers', label: '🛒 Buyers', about: 'Everyone who has ordered (or signed up to buy and doesn’t sell).',
    sorts: [['spent', 'Spent most'], ['orders', 'Most orders'], ['recent', 'Ordered recently'], ['newest', 'Newest'], ['name', 'Name']],
    cols: [
      { label: 'Buyer', cell: person, csv: (row) => row.name },
      { label: 'Phone', cell: (row) => phone(row.phone) || '–', csv: (row) => row.phone },
      { label: 'County', cell: (row) => row.county || '–', csv: (row) => row.county },
      { label: 'Orders', right: true, cell: (row) => <>{num(row.orders)}<Muted>{row.delivered} delivered{row.cancelled ? ` · ${row.cancelled} cancelled` : ''}</Muted></>, csv: (row) => row.orders, total: 'orders' },
      { label: 'Spent', right: true, cell: (row) => <b>{money(row.spent)}</b>, csv: (row) => row.spent, total: 'spent', money: true },
      { label: 'Average order', right: true, cell: (row) => (row.averageOrder ? money(row.averageOrder) : '–'), csv: (row) => row.averageOrder },
      { label: 'Sellers', right: true, cell: (row) => num(row.sellers), csv: (row) => row.sellers },
      { label: 'Last order', cell: (row) => day(row.lastOrderAt), csv: (row) => day(row.lastOrderAt) },
      { label: 'Joined', cell: (row) => day(row.joinedAt), csv: (row) => day(row.joinedAt) },
    ] },
  { key: 'retailers', label: '🏪 Retailers', about: 'Sellers who sell one at a time (retail).', sorts: [['revenue', 'Most revenue'], ['ads', 'Most ads'], ['sales', 'Most sales'], ['rating', 'Best rated'], ['newest', 'Newest'], ['name', 'Name']],
    cols: sellerCols([{ label: 'Sells', cell: (row, cat) => <Chips list={(row.categories || []).slice(0, 4).map(cat)} />, csv: (row) => (row.categories || []).join(' ') }]) },
  { key: 'wholesalers', label: '🏭 Wholesalers', about: 'Sellers with wholesale (bei ya jumla) prices, by what they sell.', trade: 'wholesale', sorts: [['revenue', 'Most revenue'], ['ads', 'Most wholesale ads'], ['sales', 'Most sales'], ['rating', 'Best rated'], ['newest', 'Newest'], ['name', 'Name']],
    cols: sellerCols([{ label: 'Wholesale of', cell: (row, cat, tr) => <><Chips list={(row.trades || []).map(tr)} />{row.units?.length > 0 && <Muted>by the {row.units.join(', ')}</Muted>}</>, csv: (row) => (row.trades || []).join(' ') }]) },
  { key: 'importers', label: '🌍 Importers', about: 'Sellers of imported goods, by what they import and where from.', trade: 'importer', origins: true, sorts: [['revenue', 'Most revenue'], ['ads', 'Most imported ads'], ['sales', 'Most sales'], ['rating', 'Best rated'], ['newest', 'Newest'], ['name', 'Name']],
    cols: sellerCols([{ label: 'Imports', cell: (row, cat, tr) => <><Chips list={(row.trades || []).map(tr)} /><Muted>{(row.origins || []).map((origin) => FLAGS[origin] || origin).join(' · ')}</Muted></>, csv: (row) => `${(row.trades || []).join(' ')} | ${(row.origins || []).join(' ')}` }]) },
  { key: 'riders', label: '🏍️ Riders', about: 'Our delivery riders.', status: true, sorts: [['jobs', 'Most jobs'], ['earned', 'Earned most'], ['balance', 'Balance'], ['recent', 'Worked recently'], ['newest', 'Newest'], ['name', 'Name']],
    cols: workerCols([{ label: 'Ride', cell: (row) => <>{row.vehicle || '–'}{row.plate && <Muted>{row.plate}</Muted>}</>, csv: (row) => `${row.vehicle} ${row.plate || ''}` }]) },
  { key: 'shopping-agents', label: '🛍️ Shopping agents', about: 'Our shopping agents: they inspect items for buyers (and deliver some).', status: true, sorts: [['jobs', 'Most jobs'], ['earned', 'Earned most'], ['balance', 'Balance'], ['recent', 'Worked recently'], ['newest', 'Newest'], ['name', 'Name']],
    cols: workerCols([{ label: 'Inspections', right: true, cell: (row) => num(row.inspections), csv: (row) => row.inspections, total: 'inspections' }]) },
];

export default function AdminPeople() {
  const [kind, setKind] = useState('buyers');
  const [counts, setCounts] = useState(null);
  const [trades, setTrades] = useState({ wholesale: [], importer: [] });
  const [cats, setCats] = useState({});
  const [opts, setOpts] = useState({ q: '', sort: '', trade: '', origin: '', status: '', page: 1 });
  const [typed, setTyped] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const kINDSs = KINDS.find((currentKind) => currentKind.key === kind);
  const loadCounts = () => api.get('/admin/people').then((response) => { setCounts(response.data.counts); setTrades(response.data.trades); }).catch((error) => toast.error(errMsg(error)));
  useEffect(() => {
    loadCounts();
    api.get('/market/categories').then((response) => setCats(Object.fromEntries(response.data.categories.map((category) => [category.slug, `${category.icon} ${category.name}`])))).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`/admin/people/${kind}`, { params: { ...opts, page: opts.page } }).then((response) => live && setData(response.data)).catch((error) => toast.error(errMsg(error)));
    return () => {
      live = false;
    };
  }, [kind, opts]);
  const pick = (key) => {
    setKind(key);
    setTyped('');
    setOpts({ q: '', sort: '', trade: '', origin: '', status: '', page: 1 });
  };
  const set = (order) => setOpts({ ...opts, ...order, page: order.page || 1 });
  const cat = (slug) => cats[slug] || slug;
  const tr = (key) => {
    const value = [...trades.wholesale, ...trades.importer].find((item) => item.key === key && (kINDSs.trade === 'wholesale' ? trades.wholesale.includes(item) : trades.importer.includes(item)));
    return value ? `${value.icon} ${value.name}` : key;
  };
  const refresh = async () => {
    setBusy(true);
    try {
      await api.post('/admin/people/refresh');
      toast.success('Tables refreshed');
      loadCounts();
      setOpts({ ...opts });
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = async () => {
    try {
      const response = await api.get(`/admin/people/${kind}`, { params: { ...opts, all: '1' } });
      downloadCSV(`kapu-${kind}.csv`, [...kINDSs.cols.map((col) => ({ label: col.label, value: col.csv })), { label: 'Email', value: (row) => row.email }, { label: 'Phone', value: (row) => row.phone }], response.data.rows);
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const tradeList = kINDSs.trade === 'wholesale' ? trades.wholesale : kINDSs.trade === 'importer' ? trades.importer : [];
  return (
    <div>
      <div className="page-head"><h2>People</h2></div>
      <div className="toolbar" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {KINDS.map((currentKind) => <button key={currentKind.key} className={`btn ${kind === currentKind.key ? '' : 'ghost'} sm`} aria-pressed={kind === currentKind.key} onClick={() => pick(currentKind.key)}>{currentKind.label}{counts ? ` (${num(counts[currentKind.key])})` : ''}</button>)}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{kINDSs.about} One login per person; the same seller can be a retailer, a wholesaler and an importer. Kept up to date automatically{data?.updatedAt ? ` (last change ${new Date(data.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}.</p>
      <div className="toolbar" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <form onSubmit={(event) => { event.preventDefault(); set({ q: typed.trim() }); }} style={{ display: 'flex', gap: 6 }}>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={kind === 'buyers' ? 'Name, email or phone' : 'Name, shop, phone or area'} aria-label="Search" style={{ minWidth: 220 }} />
          <button className="btn ghost sm">Search</button>
        </form>
        <span className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          Sort
          <select aria-label="Sort" value={opts.sort || kINDSs.sorts[0][0]} onChange={(event) => set({ sort: event.target.value })}>{kINDSs.sorts.map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        </span>
        {kINDSs.status && (
          <select value={opts.status} onChange={(event) => set({ status: event.target.value })} aria-label="Status">
            <option value="">Any status</option><option value="approved">Approved</option><option value="pending">Applications</option><option value="suspended">Suspended</option>
          </select>
        )}
        {kINDSs.origins && (
          <select value={opts.origin} onChange={(event) => set({ origin: event.target.value })} aria-label="Imported from">
            <option value="">From anywhere</option>{Object.entries(FLAGS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </select>
        )}
        <button className="btn ghost sm" onClick={exportCsv} disabled={!data?.rows.length}>⬇ CSV</button>
        <button className="btn ghost sm" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh tables'}</button>
      </div>
      {tradeList.length > 0 && (
        <div className="toolbar" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          <button className={`btn ${!opts.trade ? '' : 'ghost'} sm`} onClick={() => set({ trade: '' })}>All</button>
          {tradeList.map((tradeItem) => <button key={tradeItem.key} className={`btn ${opts.trade === tradeItem.key ? '' : 'ghost'} sm`} onClick={() => set({ trade: tradeItem.key })}>{tradeItem.icon} {tradeItem.name}</button>)}
        </div>
      )}
      <div className="card table-wrap">
        <table className="table">
          <thead><tr>{kINDSs.cols.map((col) => <th key={col.label} className={col.right ? 'right' : ''}>{col.label}</th>)}</tr></thead>
          <tbody>
            {data?.rows.map((result) => <tr key={result._id}>{kINDSs.cols.map((col) => <td key={col.label} className={col.right ? 'right' : ''}>{col.cell(result, cat, tr)}</td>)}</tr>)}
            {data && !data.rows.length && <tr><td colSpan={kINDSs.cols.length} className="center muted">Nobody here{opts.q || opts.trade || opts.origin || opts.status ? ' with these filters' : ' yet'}.</td></tr>}
            {!data && <tr><td colSpan={kINDSs.cols.length} className="center muted">Loading…</td></tr>}
          </tbody>
          {data?.rows.length > 0 && (
            <tfoot>
              <tr>{kINDSs.cols.map((col, index) => <th key={col.label} className={col.right ? 'right' : ''}>{index === 0 ? `${num(data.total)} in all` : col.total ? (col.money ? money(data.totals[col.total]) : num(data.totals[col.total])) : ''}</th>)}</tr>
            </tfoot>
          )}
        </table>
      </div>
      {data && data.pages > 1 && (
        <div className="toolbar" style={{ marginTop: 10, justifyContent: 'center' }}>
          <button className="btn ghost sm" disabled={opts.page <= 1} onClick={() => setOpts({ ...opts, page: opts.page - 1 })}>← Previous</button>
          <span className="muted">Page {data.page} of {data.pages}</span>
          <button className="btn ghost sm" disabled={opts.page >= data.pages} onClick={() => setOpts({ ...opts, page: opts.page + 1 })}>Next →</button>
        </div>
      )}
    </div>
  );
}
