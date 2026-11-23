import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import { useRealtime } from '../context/RealtimeContext';

// Sellers: verification requests (call them, check their ID, then verify), plus suspend accounts that scam
const prettyPhone = (phone = '') => (/^254\d{9}$/.test(phone) ? `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : phone);

export default function AdminSellers() {
  const [view, setView] = useState('pending'); // pending | chemists | verified | all
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const { refreshAttention } = useRealtime();

  const load = useCallback(() => {
    api.get('/admin/sellers', { params: { q: text || undefined, pending: view === 'pending' ? 1 : undefined, chemists: view === 'chemists' ? 1 : undefined, verified: view === 'verified' ? 1 : undefined } })
      .then((response) => setRes(response.data))
      .catch((error) => toast.error(errMsg(error)));
  }, [text, view]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const act = async (value, action) => {
    let note = '';
    if (action === 'reject') {
      note = window.prompt(`Why can’t ${value.name} be verified? (they will see this)`, 'We could not reach you on your phone number');
      if (note === null) return;
    }
    if (action === 'disable') {
      note = window.prompt(`Suspend ${value.name}? Their ads are taken down and they can’t log in. Reason:`, 'Reported for fraud');
      if (note === null) return;
    }
    if (action === 'chemist-reject' || action === 'chemist-revoke') {
      note = window.prompt(action === 'chemist-reject' ? `Why can’t ${value.name}’s licence be verified? (they will see this)` : `Remove ${value.name}’s licensed-chemist status? Their medicine ads come down. Reason:`, 'We could not confirm the licence with the Pharmacy and Poisons Board');
      if (note === null) return;
    }
    if (action === 'chemist-approve' && !window.confirm(`Approve ${value.chemist?.premises}? Only after you’ve checked licence ${value.chemist?.licenceNo} with the Pharmacy and Poisons Board and spoken to them.`)) return;
    if (action === 'verify' && !window.confirm(`Verify ${value.name}? Only do this after you’ve spoken to them and checked their ID.`)) return;
    try {
      await api.post(`/admin/sellers/${value._id}`, { action, note });
      toast.success({ verify: '✔ Verified', unverify: 'Badge removed', reject: 'Request declined', 'chemist-approve': '✔ Licensed chemist', 'chemist-reject': 'Licence declined', 'chemist-revoke': 'Chemist status removed', disable: 'Account suspended', enable: 'Account restored' }[action]);
      load();
      refreshAttention();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Sellers</h2>
        <div className="toolbar">
          <input placeholder="Name, email or phone…" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
      </div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        {[['pending', `Verification requests${res?.pending ? ` (${res.pending})` : ''}`], ['chemists', `💊 Chemist licences${res?.chemistsPending ? ` (${res.chemistsPending})` : ''}`], ['verified', 'Verified'], ['all', 'All users']].map(([key, value]) => (
          <button key={key} className={`btn ${view === key ? '' : 'ghost'} sm`} onClick={() => setView(key)}>{value}</button>
        ))}
      </div>
      {view === 'chemists' && <p className="muted" style={{ marginTop: 0 }}>Check each licence number with the Pharmacy and Poisons Board (premises register), call the chemist, then approve. Only approved chemists can post medicines and show in “Chemists near me”.</p>}
      {view === 'pending' && <p className="muted" style={{ marginTop: 0 }}>Call each seller on their phone number, ask for their name as on their national ID (and shop location if they have one), then verify. The ✔ badge appears on all their ads.</p>}

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr><th>Seller</th><th>Phone</th><th>Ads</th><th>Rating · sales</th><th>Warnings</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {res?.sellers.map((customer) => (
              <tr key={customer._id}>
                <td>
                  <b>{customer.name}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{customer.email} · joined {new Date(customer.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{customer.county ? ` · ${customer.county}` : ''}</div>
                  {customer.verifyRequest?.status === 'pending' && customer.verifyRequest.note && <div style={{ fontSize: 13 }}>“{customer.verifyRequest.note}”</div>}
                  {customer.chemist?.licenceNo && view === 'chemists' && (
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      💊 <b>{customer.chemist.premises}</b> · licence <code>{customer.chemist.licenceNo}</code> · in charge: {customer.chemist.pharmacist}
                      {customer.shopLocation?.address && <div className="muted">📍 {customer.shopLocation.address}</div>}
                    </div>
                  )}
                </td>
                <td>{customer.phone ? <a href={`tel:+${customer.phone}`}>{prettyPhone(customer.phone)}</a> : <span className="muted">none</span>}</td>
                <td>{customer.activeAds} live / {customer.ads}</td>
                <td>{customer.rating?.count ? `★ ${customer.rating.avg} (${customer.rating.count})` : <span className="muted">no reviews</span>} · {customer.completedSales || 0}</td>
                <td>
                  {customer.reports > 0 && <span className="badge failed" style={{ marginRight: 4 }}>🚩 {customer.reports} reports</span>}
                  {customer.scamFlags > 0 && <span className="badge pending" title="Chat messages asking for money first">⚠️ {customer.scamFlags} risky msgs</span>}
                  {!customer.reports && !customer.scamFlags && <span className="muted">–</span>}
                </td>
                <td>
                  {view === 'chemists' && customer.chemist && <div style={{ marginBottom: 4 }}><span className={`badge ${customer.chemist.status === 'verified' ? 'completed' : customer.chemist.status === 'pending' ? 'pending' : 'cancelled'}`}>💊 {customer.chemist.status === 'verified' ? 'licensed' : customer.chemist.status === 'pending' ? 'licence to check' : 'licence declined'}</span></div>}
                  {!customer.active ? <span className="badge cancelled">suspended</span> : customer.verified ? <span className="badge completed">✔ verified</span> : customer.verifyRequest?.status === 'pending' ? <span className="badge pending">waiting</span> : <span className="muted">–</span>}
                </td>
                <td className="right nowrap">
                  {view === 'chemists' && customer.chemist?.status === 'pending' && <><button className="btn sm" onClick={() => act(customer, 'chemist-approve')}>💊 Approve licence</button><button className="btn ghost sm" onClick={() => act(customer, 'chemist-reject')}>Decline</button></>}
                  {view === 'chemists' && customer.chemist?.status === 'verified' && <button className="btn ghost sm" onClick={() => act(customer, 'chemist-revoke')}>Remove licence</button>}
                  {view === 'chemists' && customer.chemist?.status === 'rejected' && <button className="btn ghost sm" onClick={() => act(customer, 'chemist-approve')}>Approve</button>}
                  {customer.active && !customer.verified && <button className="btn sm" onClick={() => act(customer, 'verify')}>✔ Verify</button>}
                  {customer.active && customer.verifyRequest?.status === 'pending' && <button className="btn ghost sm" onClick={() => act(customer, 'reject')}>Decline</button>}
                  {customer.verified && <button className="btn ghost sm" onClick={() => act(customer, 'unverify')}>Remove badge</button>}
                  {customer.active ? <button className="btn ghost sm danger-text" onClick={() => act(customer, 'disable')}>Suspend</button> : <button className="btn ghost sm" onClick={() => act(customer, 'enable')}>Restore</button>}
                </td>
              </tr>
            ))}
            {res && !res.sellers.length && <tr><td colSpan={7} className="center muted">{view === 'pending' ? 'No verification requests waiting. 🎉' : view === 'chemists' ? 'No chemist licences yet.' : 'Nobody here.'}</td></tr>}
            {!res && <tr><td colSpan={7} className="center muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
