import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import { KapuName } from '../components/BrandName';

// Admin → Reviews of us: what buyers and sellers say about Kapu. Reply publicly; hide only abuse, spam or
// personal details (never because a review is negative). Hiding and showing are logged in the Security log.
const ROLE = { buyer: 'Buyer', seller: 'Seller', both: 'Buyer & seller' };
const stars = (count) => '★'.repeat(count) + '☆'.repeat(5 - count);
const when = (date) => new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AdminReviews() {
  const [filter, setFilter] = useState({ status: '', stars: '', unanswered: '' });
  const [data, setData] = useState(null);
  const [replying, setReplying] = useState(null);
  const [text, setText] = useState('');
  const load = useCallback(() => api.get('/reviews/admin', { params: filter }).then((response) => setData(response.data)).catch((error) => toast.error(errMsg(error))), [filter]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (id, body, done) => {
    try {
      await api.post(`/reviews/admin/${id}`, body);
      toast.success(done);
      setReplying(null);
      setText('');
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const hide = (review) => {
    const reason = window.prompt('Why hide this review? (abusive words, spam, a personal phone number…)\nReviews are never hidden for being negative.');
    if (reason) act(review._id, { action: 'hide', reason }, 'Hidden from the public page');
  };
  const rows = data?.reviews || [];
  return (
    <div>
      <div className="page-head"><h2>Reviews of us</h2></div>
      <p className="muted" style={{ marginTop: -6 }}>What buyers and sellers say about <KapuName /> on the public Reviews page. Reply to show you listen; hide only abuse, spam or personal details.</p>
      {data && (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat"><small>Average</small><b>{data.count ? `${data.avg.toFixed(1)} ★` : '–'}</b><small>{data.count} public reviews</small></div>
          <div className="stat"><small>Buyers</small><b>{data.buyers.count ? `${data.buyers.avg.toFixed(1)} ★` : '–'}</b><small>{data.buyers.count} review{data.buyers.count === 1 ? '' : 's'}</small></div>
          <div className="stat"><small>Sellers</small><b>{data.sellers.count ? `${data.sellers.avg.toFixed(1)} ★` : '–'}</b><small>{data.sellers.count} review{data.sellers.count === 1 ? '' : 's'}</small></div>
        </div>
      )}
      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value })} aria-label="Status"><option value="">Visible & hidden</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select>
        <select value={filter.stars} onChange={(event) => setFilter({ ...filter, stars: event.target.value })} aria-label="Stars"><option value="">Any rating</option>{[5, 4, 3, 2, 1].map((count) => <option key={count} value={count}>{count} stars</option>)}</select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={filter.unanswered === '1'} onChange={(event) => setFilter({ ...filter, unanswered: event.target.checked ? '1' : '' })} /> Not answered yet</label>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Rating</th><th>Who</th><th>Review</th><th /></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={4} className="muted">Loading…</td></tr>}
            {data && !rows.length && <tr><td colSpan={4} className="muted">No reviews here yet.</td></tr>}
            {rows.map((review) => (
              <tr key={review._id} style={review.status === 'hidden' ? { opacity: 0.6 } : undefined}>
                <td style={{ whiteSpace: 'nowrap', color: '#f59e0b' }}>{stars(review.rating)}</td>
                <td><b>{review.name}</b><div className="muted" style={{ fontSize: 12 }}>{ROLE[review.role]}{review.verified ? ' · ✔ completed an order' : ''}<br />{when(review.at)}</div></td>
                <td style={{ maxWidth: 460 }}>
                  {review.comment}
                  {review.status === 'hidden' && <div className="badge cancelled" style={{ marginTop: 4 }}>Hidden: {review.hiddenReason}</div>}
                  {review.reply && <div className="muted" style={{ marginTop: 6, fontSize: 13 }}><b>Our reply:</b> {review.reply}</div>}
                  {replying === review._id && (
                    <form style={{ display: 'flex', gap: 6, marginTop: 6 }} onSubmit={(event) => { event.preventDefault(); act(review._id, { action: 'reply', text }, 'Reply posted publicly'); }}>
                      <input value={text} onChange={(event) => setText(event.target.value)} maxLength={800} placeholder="Thank them, or say what you’re fixing" autoFocus style={{ flex: 1 }} />
                      <button className="btn sm">Post</button>
                    </form>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => { setReplying(review._id); setText(review.reply || ''); }}>{review.reply ? 'Edit reply' : 'Reply'}</button>{' '}
                  {review.status === 'hidden' ? <button className="btn ghost sm" onClick={() => act(review._id, { action: 'show' }, 'Visible again')}>Show</button> : <button className="btn ghost sm" onClick={() => hide(review)}>Hide</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
