import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, downloadCSV } from '../api';

// Admin → Security log: logins, failed logins, lockouts, logouts, password changes, staff actions,
// blocked requests (CSRF, no access, rate limits), fake M-Pesa callbacks, rejected uploads.
const FILTERS = [
  ['', 'Everything'],
  ['customer.login', 'Customer logins'],
  ['staff.', 'Staff activity'],
  ['customer.password', 'Password changes & resets'],
  ['csrf', 'Blocked: forged requests'],
  ['access', 'Blocked: no access'],
  ['rate_limited', 'Blocked: too many attempts'],
  ['mpesa', 'M-Pesa callbacks'],
  ['upload', 'Rejected uploads'],
];
const OUTCOME = { ok: 'completed', failed: 'pending', denied: 'cancelled' };
const when = (date) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function AdminAudit() {
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.get('/auth/audit', { params: { action, outcome, actor, page } }).then((response) => setData(response.data)).catch((error) => toast.error(errMsg(error)));
    }, 250);
    return () => clearTimeout(timer);
  }, [action, outcome, actor, page]);

  const rows = data?.items || [];
  return (
    <div>
      <div className="page-head">
        <h2>Security log</h2>
        <button className="btn ghost sm" disabled={!rows.length} onClick={() => downloadCSV('security-log.csv', [
          { label: 'When', value: (row) => new Date(row.at).toISOString() }, { label: 'Action', value: (row) => row.action }, { label: 'Outcome', value: (row) => row.outcome },
          { label: 'Who', value: (row) => row.actorName || row.actorKind }, { label: 'Target', value: (row) => row.target }, { label: 'Detail', value: (row) => row.detail },
          { label: 'Request', value: (row) => `${row.method || ''} ${row.path || ''}` }, { label: 'IP', value: (row) => row.ip },
        ], rows)}>⬇ CSV</button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Sign-ins, password changes, staff actions and blocked requests, kept for one year. Passwords and keys are never recorded.</p>
      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} aria-label="What">
          {FILTERS.map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>
        <select value={outcome} onChange={(event) => { setOutcome(event.target.value); setPage(1); }} aria-label="Outcome">
          <option value="">Any outcome</option><option value="ok">OK</option><option value="failed">Failed</option><option value="denied">Blocked</option>
        </select>
        <input value={actor} onChange={(event) => { setActor(event.target.value); setPage(1); }} placeholder="Email, phone or id" aria-label="Who" style={{ flex: 1, minWidth: 160 }} />
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>What</th><th>Who</th><th>Details</th><th>From</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={5} className="muted">Loading…</td></tr>}
            {data && !rows.length && <tr><td colSpan={5} className="muted">Nothing recorded yet.</td></tr>}
            {rows.map((row) => (
              <tr key={row._id}>
                <td style={{ whiteSpace: 'nowrap' }}>{when(row.at)}</td>
                <td><b>{row.action}</b> <span className={`badge ${OUTCOME[row.outcome] || ''}`}>{row.outcome === 'denied' ? 'blocked' : row.outcome}</span></td>
                <td>{row.actorName || <span className="muted">{row.actorKind}</span>}</td>
                <td style={{ maxWidth: 360 }}>{row.detail || row.target || ''}<div className="muted" style={{ fontSize: 12 }}>{row.method} {row.path}{row.status ? ` → ${row.status}` : ''}</div></td>
                <td className="muted" style={{ fontSize: 12 }}>{row.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
          <span className="muted">Page {page} of {data.pages} · {data.total} entries</span>
          <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      )}
    </div>
  );
}
