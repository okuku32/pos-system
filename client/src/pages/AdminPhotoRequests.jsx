// 📸 Photo requests: items buyers couldn't find in a seller's ads, sent as a photo. Our team follows up on the ones
// a seller hasn't answered (call the seller, or point the buyer to another seller). Opening a photo is audited.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import PrivateFile from '../components/PrivateFile';

const money = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
const when = (date) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const age = (date) => {
  const hours = Math.floor((Date.now() - new Date(date)) / 3600000);
  return hours < 1 ? 'just now' : hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
};
const BADGE = { open: 'pending', answered: 'completed', declined: 'cancelled', cancelled: '' };

export default function AdminPhotoRequests() {
  const [status, setStatus] = useState('open');
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/market/admin/photo-requests', { params: { status: status === 'all' ? undefined : status } }).then((response) => setData(response.data)).catch((err) => toast.error(errMsg(err))), [status]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div>
      <div className="page-head"><h2>📸 Photo requests</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>Buyers send a seller a photo of an item that isn’t in their ads. Sellers answer by posting it (the buyer can then add it to the cart) or saying they don’t have it. Follow up on requests waiting more than a day.</p>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        {[['open', 'Waiting for the seller'], ['answered', 'Answered'], ['declined', 'Not available'], ['cancelled', 'Withdrawn'], ['all', 'All']].map(([key, label]) => (
          <button key={key} className={`btn ${status === key ? '' : 'ghost'} sm`} onClick={() => setStatus(key)}>{label}{data?.counts?.[key] ? ` (${data.counts[key]})` : ''}</button>
        ))}
        <button className="btn ghost sm" onClick={load}>↻ Refresh</button>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Photos</th><th>Request</th><th>Buyer → seller</th><th>Answer</th><th>Status</th></tr></thead>
          <tbody>
            {data?.requests.map((request) => (
              <tr key={request._id}>
                <td><div className="pr-thumbs">{request.photos.map((path, index) => <PrivateFile key={path} client={api} path={path} alt={`${request.what} ${index + 1}`} height={64} />)}</div></td>
                <td><b>{request.what}</b><div className="muted" style={{ fontSize: 12 }}>{request.no} · {request.qty} wanted{request.budget ? ` · budget ${money(request.budget)}` : ''} · {when(request.createdAt)}</div>{request.note && <div className="muted" style={{ fontSize: 12 }}>“{request.note}”</div>}</td>
                <td>{request.buyer.name} → <Link to={`/market/seller/${request.seller._id}`} target="_blank">{request.seller.name}</Link></td>
                <td>{request.answer?.listingSlug ? <><Link to={`/market/item/${request.answer.listingSlug}`} target="_blank">{request.answer.listingTitle}</Link><div className="muted" style={{ fontSize: 12 }}>{money(request.answer.price)}{request.answer.created ? ' · new ad' : ''}</div></> : request.answer?.note ? <span className="muted">“{request.answer.note}”</span> : <span className="muted">–</span>}</td>
                <td><span className={`badge ${BADGE[request.status]}`}>{request.status}</span>{request.status === 'open' && <div className={Date.now() - new Date(request.createdAt) > 86400000 ? 'danger-text' : 'muted'} style={{ fontSize: 12 }}>{age(request.createdAt)}</div>}</td>
              </tr>
            ))}
            {data && !data.requests.length && <tr><td colSpan={5} className="center muted">Nothing here.</td></tr>}
            {!data && <tr><td colSpan={5} className="center muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
