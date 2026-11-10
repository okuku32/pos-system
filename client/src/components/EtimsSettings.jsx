import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, money } from '../api';

const MODE = {
  off: { label: 'Off: sales are not reported to KRA', cls: 'muted' },
  mock: { label: 'Test mode: simulated KRA responses, receipts marked TEST', cls: 'warn-text' },
  sandbox: { label: 'KRA sandbox (test system)', cls: 'warn-text' },
  live: { label: 'Live: reporting to KRA', cls: 'success-text' },
};

export default function EtimsSettings() {
  const [st, setSt] = useState(null);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState('');
  const [google, setGoogle] = useState(null);

  const load = useCallback(() => {
    api.get('/etims/status').then((r) => setSt(r.data)).catch(() => {});
    api.get('/etims/problems').then((r) => setProblems(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    api.get('/auth/oauth-config').then((r) => setGoogle(!!r.data.google)).catch(() => setGoogle(false));
  }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const { data } = await fn();
      toast.success(data.message || 'Done');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy('');
      load();
    }
  };

  const mode = st && (MODE[st.mode] || MODE.off);
  const c = st?.counts || {};

  return (
    <>
      <div className="card" style={{ maxWidth: 680 }}>
        <h3>KRA eTIMS</h3>
        <p className="muted">
          Every completed sale is sent to KRA as a tax invoice. The receipt then shows the KRA signature and a QR code
          customers can scan to verify it. Settings live in <code>server/.env</code> (ETIMS_MODE, ETIMS_TIN, ETIMS_BHF_ID,
          ETIMS_DEVICE_SERIAL).
        </p>
        {st && (
          <>
            <div className="row-between"><span className="muted">Mode</span><b className={mode.cls}>{mode.label}</b></div>
            {st.mode !== 'off' && st.mode !== 'mock' && (
              <>
                <div className="row-between"><span className="muted">KRA PIN (TIN)</span><span>{st.tin || <span className="error-text">not set</span>}</span></div>
                <div className="row-between"><span className="muted">Branch ID</span><span>{st.bhfId}</span></div>
                <div className="row-between"><span className="muted">Device serial</span><span>{st.deviceSerial || <span className="error-text">not set</span>}</span></div>
              </>
            )}
            {st.mode !== 'off' && (
              <>
                <div className="row-between">
                  <span className="muted">Device</span>
                  <span>{st.initialised ? <span className="success-text">Initialised{st.device?.sdcId ? ` · ${st.device.sdcId}` : ''}</span> : <span className="warn-text">Not initialised</span>}</span>
                </div>
                <div className="row-between">
                  <span className="muted">Invoices</span>
                  <span>
                    <b className="success-text">{c.submitted || 0}</b> accepted · <b className="warn-text">{(c.pending || 0) + (c.retrying || 0)}</b> waiting · <b className="error-text">{c.failed || 0}</b> failed
                  </span>
                </div>
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button className="btn" disabled={!!busy} onClick={() => run('init', () => api.post('/etims/init'))}>
                    {busy === 'init' ? 'Initialising…' : st.initialised ? 'Re-initialise device' : 'Initialise device'}
                  </button>
                  <button className="btn ghost" disabled={!!busy || !problems.length} onClick={() => run('retry', () => api.post('/etims/retry-all'))}>
                    Retry all waiting
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {problems.length > 0 && (
          <table className="table" style={{ marginTop: 14 }}>
            <thead><tr><th>Receipt</th><th className="right">Total</th><th>Status</th><th>Last error</th><th></th></tr></thead>
            <tbody>
              {problems.map((s) => (
                <tr key={s._id}>
                  <td>{s.receiptNo}<br /><small className="muted">{new Date(s.createdAt).toLocaleString()}</small></td>
                  <td className="right">{money(s.total)}</td>
                  <td><span className={`badge etims-${s.etims.status}`}>{s.etims.status}</span><br /><small className="muted">{s.etims.attempts || 0} tries</small></td>
                  <td style={{ maxWidth: 220, fontSize: 12 }}>{s.etims.error || '-'}</td>
                  <td><button className="btn ghost sm" disabled={!!busy} onClick={() => run(s._id, () => api.post(`/etims/resend/${s._id}`))}>{busy === s._id ? '…' : 'Resend'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Going live: register for eTIMS (OSCU) on the KRA portal, put your sandbox PIN, branch ID and device serial in
          <code> server/.env</code>, set <code>ETIMS_MODE=sandbox</code>, restart, click <b>Initialise device</b> and make a
          test sale. After KRA approves your sandbox tests, switch to <code>ETIMS_MODE=live</code>.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 680 }}>
        <h3>Google sign-in (OAuth)</h3>
        <div className="row-between">
          <span className="muted">Status</span>
          {google === null ? <span>…</span> : google ? <b className="success-text">On: customers and staff see “Continue with Google”</b> : <b className="warn-text">Off: set GOOGLE_CLIENT_ID in server/.env</b>}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Customers can sign up or log in with Google. Staff can only sign in with Google if their email has already been
          added under Users. Create the client ID in Google Cloud console → APIs &amp; Services → Credentials → OAuth
          client ID (Web application), and add your shop address (e.g. http://localhost:5173) as an authorised JavaScript origin.
        </p>
      </div>
    </>
  );
}
