import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import { EarningsTab, PayoutsTab } from './FieldEarnings';
import WorkerDocsModal, { DocsCell } from './WorkerDocsAdmin';

// Field team: riders and shopping agents (they do the inspections) — approve applications, follow jobs, earnings & M-Pesa payouts
const money = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
const prettyPhone = (phone = '') => (/^254\d{9}$/.test(phone) ? `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : phone);
const when = (date) => (date ? new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const STATUS = { open: ['pending', 'waiting for someone'], assigned: ['pending', 'accepted'], picked_up: ['pending', 'on the way'], done: ['completed', 'done'], cancelled: ['cancelled', 'cancelled'] };

export default function FieldTeam() {
  const [tab, setTab] = useState('people');
  const [people, setPeople] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [docsFilter, setDocsFilter] = useState(''); // expired · expiring · pending (documents to check)
  const [docsOf, setDocsOf] = useState(null); // the person whose documents are open
  const [tasks, setTasks] = useState(null);
  const [taskFilter, setTaskFilter] = useState('active');

  const loadPeople = useCallback(() => api.get('/work/admin/workers', { params: { status: filter === 'all' ? undefined : filter, docs: docsFilter || undefined } }).then((response) => setPeople(response.data)).catch((error) => toast.error(errMsg(error))), [filter, docsFilter]);
  const loadTasks = useCallback(() => api.get('/work/admin/tasks', { params: { status: taskFilter === 'all' ? undefined : taskFilter } }).then((response) => setTasks(response.data.tasks)).catch((error) => toast.error(errMsg(error))), [taskFilter]);
  useEffect(() => {
    if (tab === 'people') loadPeople();
    if (tab === 'jobs') loadTasks();
  }, [tab, loadPeople, loadTasks]);

  // our markets, for "the market this agent works in"
  const [markets, setMarkets] = useState([]);
  useEffect(() => {
    api.get('/market/markets').then((response) => setMarkets(response.data.markets || [])).catch(() => {});
  }, []);
  const setMarket = async (value, market) => {
    try {
      await api.post(`/work/admin/workers/${value._id}`, { action: 'market', market });
      toast.success('Market saved');
      loadPeople();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const act = async (value, action) => {
    let note = '';
    if (action === 'reject' || action === 'suspend') {
      note = window.prompt(action === 'reject' ? `Why can’t ${value.name} join? (they will see this)` : `Suspend ${value.name}? Their unfinished jobs go back on the board. Reason:`, '');
      if (note === null) return;
    }
    if (action === 'approve' && !window.confirm(`Approve ${value.name} as ${value.role === 'rider' ? 'a rider' : value.role === 'partner' ? 'a partner shop' : 'a shopping agent'}? Only after checking their ID${value.role === 'rider' ? ', licence and ride' : value.role === 'partner' ? ', business permit and shop' : ''}.`)) return;
    try {
      await api.post(`/work/admin/workers/${value._id}`, { action, note });
      toast.success({ approve: 'Approved', reject: 'Declined', suspend: 'Suspended', restore: 'Restored' }[action]);
      loadPeople();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  return (
    <div>
      <div className="page-head"><h2>Field team</h2></div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        {[['people', `Riders & agents${people?.pending ? ` (${people.pending} to check)` : ''}`], ['jobs', 'Jobs'], ['earnings', '💰 Earnings'], ['payouts', '📲 M-Pesa payouts']].map(([key, value]) => (
          <button key={key} className={`btn ${tab === key ? '' : 'ghost'} sm`} onClick={() => setTab(key)}>{value}</button>
        ))}
      </div>

      {tab === 'people' && (
        <>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            {[['pending', 'Applications'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['all', 'Everyone']].map(([key, value]) => <button key={key} className={`btn ${filter === key ? '' : 'ghost'} sm`} onClick={() => setFilter(key)}>{value}</button>)}
          </div>
          <div className="toolbar" style={{ marginBottom: 10 }} aria-label="Documents">
            <span className="muted" style={{ fontSize: 13 }}>🆔 Documents:</span>
            {[['', 'Any'], ['expired', '⛔ Expired'], ['expiring', '⏰ Expiring in 30 days'], ['pending', '🕓 To check']].map(([key, value]) => <button key={key || 'any'} className={`btn ${docsFilter === key ? '' : 'ghost'} sm`} onClick={() => { setDocsFilter(key); if (key) setFilter('all'); }}>{value}</button>)}
          </div>
          {filter === 'pending' && <p className="muted" style={{ marginTop: 0 }}>Call each applicant, check their national ID (and for riders, their licence and the bike’s plate) and open their 🆔 documents to check each expiry date, then approve. Approved people see jobs near them in “Ride or shop with us”.</p>}
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Role</th><th>Where</th><th>Phone · M-Pesa</th><th>Documents</th><th>Jobs</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {people?.workers.map((worker) => (
                  <tr key={worker._id}>
                    <td><b>{worker.name}</b><div className="muted" style={{ fontSize: 12 }}>ID {worker.idNumber} · applied {when(worker.appliedAt)}</div></td>
                    <td>{worker.role === 'partner' ? <>🛡️ Partner shop<div className="muted" style={{ fontSize: 12 }}>{worker.shopName} · {worker.shopAddress}{worker.permitNo ? ` · permit ${worker.permitNo}` : ''}</div></> : worker.role === 'rider' ? <>🏍️ Rider<div className="muted" style={{ fontSize: 12 }}>{worker.vehicle}{worker.plate ? ` · ${worker.plate}` : ''}</div></> : <>🛍️ Shopping agent{worker.marketName && <div className="muted" style={{ fontSize: 12 }}>{worker.marketName}</div>}</>}</td>
                    <td>{worker.role === 'agent' && (
                      <select className="sm" value={worker.market || ''} onChange={(event) => event.target.value && setMarket(worker, event.target.value)} aria-label={`Market ${worker.name} works in`} style={{ maxWidth: 200, marginBottom: 4 }}>
                        <option value="">⚠️ Choose their market…</option>
                        {markets.map((market) => <option key={market._id} value={market._id}>{market.name}</option>)}
                      </select>
                    )}{worker.baseArea}<div className="muted" style={{ fontSize: 12 }}>within {worker.radiusKm} km{worker.lat != null && <> · <a href={`https://www.google.com/maps/search/?api=1&query=${worker.lat},${worker.lng}`} target="_blank" rel="noreferrer">map ↗</a></>}</div></td>
                    <td>{worker.phone ? <a href={`tel:+${worker.phone}`}>{prettyPhone(worker.phone)}</a> : '–'}<div className="muted" style={{ fontSize: 12 }}>M-Pesa {prettyPhone(worker.mpesaPhone)}</div></td>
                    <td><DocsCell docs={worker.docs} onOpen={() => setDocsOf(worker._id)} /></td>
                    <td>{worker.done} done{worker.active ? ` · ${worker.active} active` : ''}</td>
                    <td><span className={`badge ${worker.status === 'approved' ? 'completed' : worker.status === 'pending' ? 'pending' : 'cancelled'}`}>{worker.status}</span>{worker.status === 'approved' && <div className="muted" style={{ fontSize: 12 }}>{worker.available ? 'taking jobs' : 'not taking jobs'}</div>}</td>
                    <td className="right nowrap">
                      {worker.status === 'pending' && <><button className="btn sm" onClick={() => act(worker, 'approve')}>✔ Approve</button><button className="btn ghost sm" onClick={() => act(worker, 'reject')}>Decline</button></>}
                      {worker.status === 'approved' && <button className="btn ghost sm danger-text" onClick={() => act(worker, 'suspend')}>Suspend</button>}
                      {['suspended', 'rejected'].includes(worker.status) && <button className="btn ghost sm" onClick={() => act(worker, 'restore')}>Approve</button>}
                    </td>
                  </tr>
                ))}
                {people && !people.workers.length && <tr><td colSpan={8} className="center muted">{filter === 'pending' ? 'No applications waiting.' : 'Nobody here yet.'}</td></tr>}
                {!people && <tr><td colSpan={8} className="center muted">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'jobs' && (
        <>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            {[['open', 'Waiting for someone'], ['active', 'In progress'], ['done', 'Done'], ['all', 'All']].map(([key, value]) => <button key={key} className={`btn ${taskFilter === key ? '' : 'ghost'} sm`} onClick={() => setTaskFilter(key)}>{value}</button>)}
            <button className="btn ghost sm" onClick={loadTasks}>↻ Refresh</button>
          </div>
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Job</th><th>Shop</th><th>Destination / check</th><th>Pay</th><th>Who</th><th>Status</th></tr></thead>
              <tbody>
                {tasks?.map((order) => (
                  <tr key={order._id}>
                    <td>{order.kind === 'delivery' ? '🏍️ Delivery' : '🔍 Inspection'}<div className="muted" style={{ fontSize: 12 }}>{order.orderNo} · {when(order.createdAt)}</div></td>
                    <td>{order.pickup.name}<div className="muted" style={{ fontSize: 12 }}>{order.pickup.area}</div></td>
                    <td>{order.kind === 'delivery' ? <>{order.dropoff?.address}<div className="muted" style={{ fontSize: 12 }}>{order.km} km</div></> : order.result ? <>{order.result.passed ? '✅ passed' : '❌ failed'}{order.result.note && <div className="muted" style={{ fontSize: 12 }}>{order.result.note}</div>}</> : <span className="muted">{order.buyerNotes || 'size, colour, quality'}</span>}</td>
                    <td>{money(order.fee)}<div className="muted" style={{ fontSize: 12 }}>{order.collectCash ? `collects ${money(order.collectCash)} from the buyer` : `they get ${money(order.pay)}`}</div></td>
                    <td>{order.workerName ? <>{order.workerName}<div className="muted" style={{ fontSize: 12 }}>{prettyPhone(order.workerPhone)}</div></> : <span className="muted">–</span>}</td>
                    <td><span className={`badge ${STATUS[order.status]?.[0]}`}>{STATUS[order.status]?.[1]}</span></td>
                  </tr>
                ))}
                {tasks && !tasks.length && <tr><td colSpan={6} className="center muted">No jobs here.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {docsOf && <WorkerDocsModal workerId={docsOf} onClose={() => setDocsOf(null)} onChanged={loadPeople} />}
      {tab === 'earnings' && <EarningsTab />}
      {tab === 'payouts' && <PayoutsTab />}
    </div>
  );
}
