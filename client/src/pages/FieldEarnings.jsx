import { Fragment, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, downloadCSV } from '../api';

// Admin → Field team → Earnings: what every rider & shopping agent earned, the tax and our commission taken
// from their fees, cash they collected themselves, what was sent to their M-Pesa, and what's left.
const money = (amount) => `KSh ${Math.round(Number(amount || 0)).toLocaleString('en-KE')}`;
const prettyPhone = (phone = '') => (/^254\d{9}$/.test(phone) ? `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : phone);
const when = (date) => (date ? new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
const PAYOUT = { waiting: ['pending', 'on hold'], due: ['pending', 'ready'], owed: ['cancelled', 'owes us'], sending: ['pending', 'sending'], paid: ['completed', 'sent'], none: ['', '–'] };

// the balance: + we owe them / − they owe us
function Balance({ r: result }) {
  if (!result.balance) return <span className="muted">KSh 0</span>;
  if (result.balance < 0) return <><b className="danger-text">−{money(-result.balance)}</b><div className="muted" style={{ fontSize: 12 }}>owes us (cash jobs)</div></>;
  return (
    <>
      <b>{money(result.balance)}</b>
      <div className="muted" style={{ fontSize: 12 }}>
        {[result.waiting > 0 && `${money(result.waiting)} on hold`, result.ready > 0 && `${money(result.ready)} ready`, result.sending > 0 && `${money(result.sending)} sending`, result.owed < 0 && `${money(-result.owed)} owed`].filter(Boolean).join(' · ')}
      </div>
    </>
  );
}

export function EarningsTab() {
  const [period, setPeriod] = useState('week');
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null); // worker whose jobs are shown
  const [jobs, setJobs] = useState(null);
  const params = period === 'custom' ? { from: range.from || undefined, to: range.to || undefined } : { period };
  const load = useCallback(() => {
    api.get('/work/admin/earnings', { params }).then((response) => setData(response.data)).catch((error) => toast.error(errMsg(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, range.from, range.to]);
  useEffect(() => {
    load();
    setOpen(null);
  }, [load]);
  // live: refresh while the page is open (payouts go out every minute)
  useEffect(() => {
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);
  const showJobs = async (currentJobs) => {
    if (open === currentJobs.worker) return setOpen(null);
    setOpen(currentJobs.worker);
    setJobs(null);
    try {
      setJobs((await api.get(`/work/admin/earnings/${currentJobs.worker}`, { params })).data.jobs);
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const payByHand = async (result) => {
    const ref = window.prompt(`Send ${result.name} ${money(result.balance)} by M-Pesa to ${prettyPhone(result.mpesaPhone)}, then type the M-Pesa code here:`, '');
    if (!ref) return;
    try {
      toast.success((await api.post('/work/admin/payouts/manual', { worker: result.worker, ref })).data.message);
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const exportCsv = () => {
    if (!data) return;
    downloadCSV(`kapu-agent-earnings-${data.period}.csv`, [
      { label: 'Name', value: (row) => row.name }, { label: 'Role', value: (row) => row.role }, { label: 'M-Pesa', value: (row) => row.mpesaPhone }, { label: 'Jobs', value: (row) => row.jobs },
      { label: 'Agent fees (KSh)', value: (row) => row.fees }, { label: `Tax ${data.taxPercent}% (KSh)`, value: (row) => row.tax }, { label: `Our commission ${data.commissionPercent}% (KSh)`, value: (row) => row.commission },
      { label: 'Total charged (KSh)', value: (row) => row.charged }, { label: 'Earned (KSh)', value: (row) => row.earned }, { label: 'Cash they collected (KSh)', value: (row) => row.cash },
      { label: 'Courier fares refunded (KSh)', value: (row) => row.refunds }, { label: 'Sent to M-Pesa (KSh)', value: (row) => row.sent }, { label: 'Balance (KSh)', value: (row) => row.balance }, { label: 'Tips (KSh)', value: (row) => row.tips },
    ], data.rows);
  };
  const totals = data?.totals;
  const charged = (data?.commissionPercent || 0) + (data?.taxPercent || 0);
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {PERIODS.map(([key, value]) => <button key={key} className={`btn ${period === key ? '' : 'ghost'} sm`} onClick={() => setPeriod(key)}>{value}</button>)}
        <span className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
          From <input type="date" aria-label="From date" style={{ width: 150 }} value={range.from} onChange={(event) => { setRange({ ...range, from: event.target.value }); setPeriod('custom'); }} />
          to <input type="date" value={range.to} onChange={(event) => { setRange({ ...range, to: event.target.value }); setPeriod('custom'); }} aria-label="To date" style={{ width: 150 }} />
        </span>
        <button className="btn ghost sm" onClick={load}>↻ Refresh</button>
        <button className="btn ghost sm" onClick={exportCsv} disabled={!data?.rows.length}>⬇ Export CSV</button>
      </div>
      {data && (
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          From every agent fee we keep <b>{charged}%</b>: our commission {data.commissionPercent}% + tax {data.taxPercent}%. Fees paid to us are sent to the agent’s M-Pesa {data.delayMin} minutes after the job
          {data.b2cReady ? ' automatically.' : data.demoPayments ? ' (demo mode: marked sent without money).' : '. Automatic M-Pesa transfers (B2C) aren’t set up yet, so send “ready” balances by hand and record the code.'}
          {' '}Fees they collected themselves (cash / M-Pesa on delivery): our {charged}% is charged to their account and taken off their next payout.
        </p>
      )}
      {totals && (
        <div className="stats" style={{ marginBottom: 12 }}>
          {[['Agent fees', totals.fees], [`Tax (${data.taxPercent}%)`, totals.tax], [`Our commission (${data.commissionPercent}%)`, totals.commission], ['Paid to agents', totals.sent], ['Balance to send', Math.max(0, totals.balance)]].map(([key, value]) => (
            <div key={key} className="card stat"><small className="muted">{key}</small><b>{money(value)}</b></div>
          ))}
        </div>
      )}
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rider / agent</th><th className="right">Jobs</th><th className="right">Agent fees</th><th className="right">Tax{data ? ` ${data.taxPercent}%` : ''}</th><th className="right">Our commission{data ? ` ${data.commissionPercent}%` : ''}</th>
              <th className="right">Earned</th><th className="right">Cash they collected</th><th className="right">Sent to M-Pesa</th><th className="right">Balance</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((result) => (
              <Fragment key={result.worker}>
                <tr>
                  <td><b>{result.name}</b><div className="muted" style={{ fontSize: 12 }}>{result.role === 'rider' ? `🏍️ Rider${result.plate ? ` · ${result.plate}` : ''}` : result.role === 'partner' ? '🛡️ Partner shop' : '🛍️ Shopping agent'} · M-Pesa {prettyPhone(result.mpesaPhone)}</div></td>
                  <td className="right">{result.jobs}</td>
                  <td className="right">{money(result.fees)}</td>
                  <td className="right">{money(result.tax)}</td>
                  <td className="right">{money(result.commission)}<div className="muted" style={{ fontSize: 12 }}>{money(result.charged)} charged</div></td>
                  <td className="right"><b>{money(result.earned)}</b>{result.refunds > 0 && <div className="muted" style={{ fontSize: 12 }}>+ {money(result.refunds)} fares</div>}</td>
                  <td className="right">{result.cash ? money(result.cash) : <span className="muted">–</span>}</td>
                  <td className="right">{money(result.sent)}</td>
                  <td className="right"><Balance r={result} /></td>
                  <td className="right nowrap">
                    <button className="btn ghost sm" onClick={() => showJobs(result)} aria-expanded={open === result.worker}>{open === result.worker ? 'Hide jobs' : 'Jobs'}</button>
                    {result.balance > 0 && (result.ready > 0 || result.waiting > 0) && !data.b2cReady && <button className="btn sm" onClick={() => payByHand(result)}>Mark sent</button>}
                  </td>
                </tr>
                {open === result.worker && (
                  <tr className="subrow">
                    <td colSpan={10} style={{ background: '#fafafa' }}>
                      {!jobs ? <span className="muted">Loading…</span> : (
                        <table className="table" style={{ margin: 0 }}>
                          <thead><tr><th>Done</th><th>Job</th><th className="right">Fee</th><th className="right">Tax</th><th className="right">Commission</th><th className="right">Earned</th><th className="right">Cash collected</th><th className="right">Fare refund</th><th className="right">To send</th><th>Payout</th></tr></thead>
                          <tbody>
                            {jobs.map((job) => (
                              <tr key={job._id}>
                                <td className="nowrap">{when(job.doneAt)}</td>
                                <td>{job.what}<div className="muted" style={{ fontSize: 12 }}>{job.orderNo}</div></td>
                                <td className="right">{money(job.gross)}</td>
                                <td className="right">{money(job.tax)}</td>
                                <td className="right">{money(job.commission)}</td>
                                <td className="right">{money(job.net)}</td>
                                <td className="right">{job.cash ? money(job.cash) : '–'}</td>
                                <td className="right">{job.reimburse ? money(job.reimburse) : '–'}</td>
                                <td className={`right ${job.toPay < 0 ? 'danger-text' : ''}`}>{job.toPay < 0 ? `−${money(-job.toPay)}` : money(job.toPay)}</td>
                                <td><span className={`badge ${PAYOUT[job.payout]?.[0] || ''}`}>{PAYOUT[job.payout]?.[1] || job.payout}</span>{job.ref && <div className="muted" style={{ fontSize: 12 }}>{job.ref}</div>}{job.payout === 'waiting' && job.dueAt && <div className="muted" style={{ fontSize: 12 }}>after {when(job.dueAt)}</div>}</td>
                              </tr>
                            ))}
                            {!jobs.length && <tr><td colSpan={10} className="center muted">No finished jobs in this period.</td></tr>}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data && !data.rows.length && <tr><td colSpan={10} className="center muted">No finished jobs in this period.</td></tr>}
            {!data && <tr><td colSpan={10} className="center muted">Loading…</td></tr>}
          </tbody>
          {totals && data.rows.length > 0 && (
            <tfoot>
              <tr>
                <th>Total ({totals.people})</th><th className="right">{totals.jobs}</th><th className="right">{money(totals.fees)}</th><th className="right">{money(totals.tax)}</th><th className="right">{money(totals.commission)}</th>
                <th className="right">{money(totals.earned)}</th><th className="right">{money(totals.cash)}</th><th className="right">{money(totals.sent)}</th><th className="right">{money(totals.balance)}</th><th></th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

export function PayoutsTab() {
  const [status, setStatus] = useState('');
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get('/work/admin/payouts/list', { params: { status: status || undefined } }).then((response) => setList(response.data.payouts)).catch((error) => toast.error(errMsg(error))), [status]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);
  const retry = async (value) => {
    try {
      toast.success((await api.post(`/work/admin/payouts/${value._id}/retry`)).data.message);
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        {[['', 'All'], ['sending', 'Sending'], ['paid', 'Sent'], ['failed', 'Failed']].map(([key, value]) => <button key={key} className={`btn ${status === key ? '' : 'ghost'} sm`} onClick={() => setStatus(key)}>{value}</button>)}
        <button className="btn ghost sm" onClick={load}>↻ Refresh</button>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>To</th><th className="right">Jobs</th><th className="right">Fees</th><th className="right">Tax + commission</th><th className="right">Cash they had</th><th className="right">Amount sent</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list?.map((value) => (
              <tr key={value._id}>
                <td className="nowrap">{when(value.createdAt)}</td>
                <td><b>{value.name}</b><div className="muted" style={{ fontSize: 12 }}>{prettyPhone(value.phone)} · {value.method === 'b2c' ? 'automatic' : value.method === 'manual' ? `by hand${value.by ? ` (${value.by})` : ''}` : 'demo'}</div></td>
                <td className="right">{value.jobs}</td>
                <td className="right">{money(value.gross)}</td>
                <td className="right">{money((value.tax || 0) + (value.commission || 0))}</td>
                <td className="right">{value.cash ? money(value.cash) : '–'}</td>
                <td className="right"><b>{money(value.amount)}</b></td>
                <td>
                  <span className={`badge ${value.status === 'paid' ? 'completed' : value.status === 'failed' ? 'cancelled' : 'pending'}`}>{value.status === 'paid' ? 'sent' : value.status}</span>
                  {value.ref && <div className="muted" style={{ fontSize: 12 }}>{value.ref}</div>}
                  {value.error && <div className="danger-text" style={{ fontSize: 12 }}>{value.error}</div>}
                </td>
                <td className="right">{value.status === 'failed' && !value.retried && <button className="btn sm" onClick={() => retry(value)}>Try again</button>}</td>
              </tr>
            ))}
            {list && !list.length && <tr><td colSpan={9} className="center muted">No M-Pesa payouts yet.</td></tr>}
            {!list && <tr><td colSpan={9} className="center muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
