import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, money } from '../api';

// Staff moderation for the public marketplace: review reported ads, take ads down or put them back, delete.
const ago = (date) => {
  const amount = Math.round((Date.now() - new Date(date)) / 3600000);
  return amount < 1 ? 'just now' : amount < 24 ? `${amount} h ago` : `${Math.round(amount / 24)} d ago`;
};

export default function Marketplace() {
  const [filter, setFilter] = useState({ q: '', status: '', reported: '' });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);

  const load = useCallback(() => {
    api
      .get('/market/admin/listings', { params: { ...filter, page } })
      .then((response) => setRes(response.data))
      .catch((error) => toast.error(errMsg(error)));
  }, [filter, page]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const act = async (ad, body, msg) => {
    try {
      await api.patch(`/market/admin/listings/${ad._id}`, body);
      toast.success(msg);
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const takeDown = (ad) => {
    const reason = window.prompt(`Why are you taking down "${ad.title}"? The seller will see this.`, ad.reports?.[0]?.reason || 'Against the marketplace rules');
    if (reason !== null) act(ad, { status: 'hidden', reason }, 'Ad taken down');
  };
  const remove = async (ad) => {
    if (!window.confirm(`Permanently delete "${ad.title}" and its photos?`)) return;
    try {
      await api.delete(`/market/admin/listings/${ad._id}`);
      toast.success('Deleted');
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const set = (key, value) => {
    setPage(1);
    setFilter((previousFilter) => ({ ...previousFilter, [key]: value }));
  };

  const stats = res?.stats || {};
  return (
    <div>
      <div className="page-head">
        <h2>Marketplace</h2>
        <div className="toolbar">
          <input placeholder="Search ads…" value={filter.q} onChange={(event) => set('q', event.target.value)} />
          <select value={filter.status} onChange={(event) => set('status', event.target.value)} style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            <option value="active">Live</option>
            <option value="sold">Sold</option>
            <option value="hidden">Taken down</option>
          </select>
          <a className="btn ghost" href="/market" target="_blank" rel="noreferrer">Open marketplace ↗</a>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 14 }}>
        <button className={`card stat stat-link ${stats.reported ? 'stat-bad' : ''}`} onClick={() => set('reported', filter.reported ? '' : '1')}>
          <span className="muted">🚩 Reported ads to review</span><b>{stats.reported ?? '–'}</b>
          <small className="muted">{filter.reported ? 'Showing reported only. Click to show all' : 'Click to show only these'}</small>
        </button>
        <div className="card stat"><span className="muted">Live ads</span><b>{stats.active ?? '–'}</b></div>
        <div className="card stat"><span className="muted">Sold</span><b>{stats.sold ?? 0}</b></div>
        <div className="card stat"><span className="muted">Sellers</span><b>{stats.sellers ?? '–'}</b></div>
        <div className="card stat"><span className="muted">Buyer–seller chats</span><b>{stats.chats ?? '–'}</b></div>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr><th>Ad</th><th>Category</th><th>Seller</th><th className="right">Price</th><th className="right">Views / chats</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {res?.items.map((ad) => (
              <tr key={ad._id}>
                <td>
                  <a href={`/market/item/${ad.slug}`} target="_blank" rel="noreferrer"><b>{ad.title}</b></a>
                  <div className="muted" style={{ fontSize: 12 }}>📍 {[ad.area, ad.county].filter(Boolean).join(', ')} · {ago(ad.createdAt)}</div>
                  {ad.reportCount > 0 && (
                    <div className="error-text" style={{ fontSize: 12 }}>
                      🚩 {ad.reportCount} report{ad.reportCount > 1 ? 's' : ''}: {ad.reports.map((report) => report.reason).join(' · ')}
                    </div>
                  )}
                  {ad.status === 'hidden' && ad.hiddenReason && <div className="muted" style={{ fontSize: 12 }}>Reason: {ad.hiddenReason}</div>}
                </td>
                <td className="muted">{ad.category}<br /><small>{ad.sub}</small></td>
                <td>{ad.sellerName}</td>
                <td className="right">{ad.price > 0 ? money(ad.price) : '–'}</td>
                <td className="right">{ad.views} / {ad.chats}</td>
                <td><span className={`badge ${ad.status === 'active' ? 'completed' : ad.status === 'hidden' ? 'cancelled' : 'pending'}`}>{ad.status === 'hidden' ? 'taken down' : ad.status}</span></td>
                <td className="right nowrap">
                  {ad.status !== 'hidden' ? (
                    <button className="btn ghost sm danger-text" onClick={() => takeDown(ad)}>Take down</button>
                  ) : (
                    <button className="btn ghost sm" onClick={() => act(ad, { status: 'active', clearReports: true }, 'Ad restored')}>Restore</button>
                  )}
                  {ad.reportCount > 0 && ad.status !== 'hidden' && (
                    <button className="btn ghost sm" onClick={() => act(ad, { clearReports: true }, 'Reports dismissed')}>Dismiss reports</button>
                  )}
                  <button className="btn ghost sm danger-text" onClick={() => remove(ad)}>Delete</button>
                </td>
              </tr>
            ))}
            {res && !res.items.length && <tr><td colSpan={7} className="center muted">No ads match.</td></tr>}
            {!res && <tr><td colSpan={7} className="center muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      {res?.pages > 1 && (
        <div className="toolbar" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Previous</button>
          <span className="muted">Page {page} of {res.pages}</span>
          <button className="btn ghost sm" disabled={page >= res.pages} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
