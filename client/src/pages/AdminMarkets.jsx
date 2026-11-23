import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import Modal from '../components/Modal';

// Admin → Markets: the markets buyers can browse (Gikomba, Wakulima…), where mama mbogas and traders register
// their stalls. Sellers can suggest a missing market; it waits here until someone approves it.
export default function AdminMarkets() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState('');
  const [counties, setCounties] = useState(['Nairobi']);
  const load = () => api.get('/market/admin/markets').then((response) => setData(response.data)).catch((error) => toast.error(errMsg(error)));
  useEffect(() => {
    load();
    api.get('/market/categories').then((response) => setCounties(response.data.counties)).catch(() => {});
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const { _id, name, kind, area, county, days, about, link, approved } = editing;
    try {
      if (_id) await api.put(`/market/admin/markets/${_id}`, { name, kind, area, county, days, about, link: link || undefined, approved });
      else await api.post('/market/admin/markets', { name, kind, area, county, days, about, link, approved: true });
      toast.success('Saved');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const approve = async (match) => {
    try {
      await api.put(`/market/admin/markets/${match._id}`, { approved: true });
      toast.success(`${match.name} is now visible to everyone`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const remove = async (match) => {
    if (!confirm(`Remove ${match.name}?${match.traders ? ` Its ${match.traders} trader${match.traders === 1 ? '' : 's'} stay on the map, just without the market.` : ''}`)) return;
    try {
      const response = await api.delete(`/market/admin/markets/${match._id}`);
      toast.success(response.data.message);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const set = (key) => (event) => setEditing({ ...editing, [key]: event.target.value });
  const kinds = data?.kinds || {};
  const list = (data?.markets || []).filter((market) => !text || `${market.name} ${market.area} ${market.county}`.toLowerCase().includes(text.toLowerCase()));
  const pending = list.filter((item) => !item.approved);

  return (
    <div>
      <div className="page-head">
        <h2>Markets</h2>
        <button className="btn" onClick={() => setEditing({ name: '', kind: 'fresh-produce', area: '', county: 'Nairobi', days: 'Daily', about: '', link: '' })}>+ Add market</button>
      </div>
      <p className="muted">Markets buyers can browse on “Markets near me”. Mama mbogas and traders pick their market when they put their shop on the map. Pins are approximate: fix one by pasting a Google Maps link.</p>

      {pending.length > 0 && (
        <div className="card table-wrap" style={{ marginBottom: 14 }}>
          <b>🕓 Suggested by sellers ({pending.length})</b>
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>Market</th><th>Where</th><th>Suggested by</th><th></th></tr></thead>
            <tbody>
              {pending.map((location) => (
                <tr key={location._id}>
                  <td><b>{location.name}</b><div className="muted" style={{ fontSize: 12 }}>{kinds[location.kind]}</div></td>
                  <td>{[location.area, location.county].filter(Boolean).join(', ')} · <a href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`} target="_blank" rel="noreferrer">map ↗</a></td>
                  <td>{location.suggestedBy}</td>
                  <td className="right staff-actions">
                    <button className="btn sm" onClick={() => approve(location)}>Approve</button>
                    <button className="btn ghost sm" onClick={() => setEditing({ ...location, link: '' })}>Edit</button>
                    <button className="btn ghost sm danger-text" onClick={() => remove(location)}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap">
        <input className="search" placeholder="Search markets…" value={text} onChange={(event) => setText(event.target.value)} style={{ maxWidth: 300, marginBottom: 8 }} />
        <table className="table">
          <thead><tr><th>Market</th><th>Where</th><th>Traders</th><th></th></tr></thead>
          <tbody>
            {list.filter((item) => item.approved).map((location) => (
              <tr key={location._id}>
                <td><b>{location.name}</b><div className="muted" style={{ fontSize: 12 }}>{kinds[location.kind]}{location.days ? ` · ${location.days}` : ''}</div></td>
                <td>{[location.area, location.county].filter(Boolean).join(', ')} · <a href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`} target="_blank" rel="noreferrer">map ↗</a></td>
                <td>{location.traders}</td>
                <td className="right staff-actions">
                  <a className="btn ghost sm" href={`/markets/${location.slug}`} target="_blank" rel="noreferrer">View ↗</a>
                  <button className="btn ghost sm" onClick={() => setEditing({ ...location, link: '' })}>Edit</button>
                  <button className="btn ghost sm danger-text" onClick={() => remove(location)}>Remove</button>
                </td>
              </tr>
            ))}
            {data && !list.length && <tr><td colSpan={4} className="muted">No markets found.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? `Edit ${editing.name}` : 'New market'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="span2">Name<input value={editing.name} onChange={set('name')} required minLength={3} maxLength={80} placeholder="e.g. Kiamaiko Market" /></label>
            <label>Mostly sells
              <select value={editing.kind} onChange={set('kind')}>{Object.entries(kinds).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
            </label>
            <label>County
              <select value={editing.county} onChange={set('county')} required>{counties.map((county) => <option key={county}>{county}</option>)}</select>
            </label>
            <label>Area<input value={editing.area} onChange={set('area')} maxLength={60} placeholder="e.g. Huruma" /></label>
            <label>Market days<input value={editing.days} onChange={set('days')} maxLength={80} placeholder="e.g. Daily, busiest on Tuesdays" /></label>
            <label className="span2">
              {editing._id ? 'Move the pin (optional)' : 'Location'}
              <input value={editing.link} onChange={set('link')} required={!editing._id} placeholder="Paste a Google Maps link, or type -1.2849, 36.8396" />
              <small className="muted">In Google Maps, find the market, tap Share and copy the link.</small>
            </label>
            <label className="span2">About<textarea value={editing.about} onChange={set('about')} maxLength={400} rows={3} placeholder="What it’s known for" /></label>
            <div className="modal-actions span2">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
