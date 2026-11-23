// Our team's Shop & ride board: bookings from collection to the buyer, and our pickup points.
// Steps after the agent's job: at the CBD hub → at the buyer's pickup point (the buyer is messaged where) or out for
// delivery → collected / delivered. The server checks every step (POST /api/errands/admin/:id).
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, money } from '../api';

const LABEL = { awaiting_payment: 'Awaiting payment', open: 'Finding an agent', assigned: 'Agent on the way to the seller', picked_up: 'Collected, coming to the hub', at_hub: 'At the CBD hub', at_point: 'At the pickup point', out_for_delivery: 'Out for delivery', delivered: 'Delivered (door)', done: 'Done', cancelled: 'Cancelled' };
// the next steps our team can take, by status and mode
const NEXT = (booking) => {
  const door = booking.shopride?.mode === 'door';
  return {
    assigned: [['at_hub', 'Arrived at the hub']],
    picked_up: [['at_hub', 'Arrived at the hub']],
    at_hub: door ? [['out_for_delivery', 'Send out for delivery']] : [['at_point', `At ${booking.shopride?.point?.area || 'the'} pickup point: tell the buyer`]],
    out_for_delivery: [['delivered', 'Delivered to the door']],
    at_point: [['collected', 'Collected by the buyer']],
  }[booking.status] || [];
};

function Points() {
  const [points, setPoints] = useState(null);
  const [form, setForm] = useState({ name: '', area: '', address: '', hours: 'Mon–Sat 8am–8pm', lat: '', lng: '' });
  const load = () => api.get('/errands/admin/pickup-points').then((response) => setPoints(response.data)).catch((err) => toast.error(errMsg(err)));
  useEffect(() => { load(); }, []);
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const add = async (event) => {
    event.preventDefault();
    try {
      await api.post('/errands/admin/pickup-points', { ...form, lat: Number(form.lat), lng: Number(form.lng) });
      toast.success('Pickup point added');
      setForm({ name: '', area: '', address: '', hours: 'Mon–Sat 8am–8pm', lat: '', lng: '' });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const toggle = async (point) => {
    try {
      await api.put(`/errands/admin/pickup-points/${point._id}`, { active: !point.active });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3>📍 Pickup points</h3>
      <p className="muted">The starter points are approximate: add your real ones (with their exact location) and switch the starters off.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Area</th><th>Name</th><th>Address</th><th>Hours</th><th>Location</th><th></th></tr></thead>
          <tbody>
            {points?.map((point) => (
              <tr key={point._id} style={point.active ? undefined : { opacity: 0.5 }}>
                <td>{point.hub ? '🏢 ' : ''}{point.area}</td><td>{point.name}</td><td>{point.address}</td><td>{point.hours}</td>
                <td><a href={`https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`} target="_blank" rel="noopener noreferrer">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</a></td>
                <td>{!point.hub && <button className="btn ghost sm" onClick={() => toggle(point)}>{point.active ? 'Switch off' : 'Switch on'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={add} className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        <input placeholder="Name (e.g. Ruai pickup point)" value={form.name} onChange={set('name')} required />
        <input placeholder="Area" value={form.area} onChange={set('area')} required />
        <input placeholder="Address / landmark" value={form.address} onChange={set('address')} />
        <input placeholder="Hours" value={form.hours} onChange={set('hours')} />
        <input placeholder="Latitude (e.g. -1.2600)" value={form.lat} onChange={set('lat')} required inputMode="decimal" />
        <input placeholder="Longitude (e.g. 36.9900)" value={form.lng} onChange={set('lng')} required inputMode="decimal" />
        <button className="btn">Add pickup point</button>
      </form>
    </div>
  );
}

export default function AdminShopRide() {
  const [list, setList] = useState(null);
  const [status, setStatus] = useState('');
  const load = useCallback(() => api.get('/errands/admin/list', { params: { kind: 'shopride', ...(status === 'sellers_due' ? { sellersDue: 1 } : { status: status || undefined }) } }).then((response) => setList(response.data)).catch((err) => toast.error(errMsg(err))), [status]);
  useEffect(() => { load(); }, [load]);
  const step = async (booking, action, extra = {}) => {
    try {
      await api.post(`/errands/admin/${booking._id}`, { action, ...extra });
      toast.success(action === 'at_point' ? 'Done: the buyer has been told where to collect it' : 'Updated');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <>
      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
          <h3>🛍️ Shop &amp; ride bookings</h3>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Every status</option>
            <option value="sellers_due">💵 Sellers to pay</option>
            {Object.entries(LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Booking</th><th>Buyer</th><th>What</th><th>From</th><th>To</th><th className="right">Paid</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list?.map((booking) => (
                <tr key={booking._id}>
                  <td><b>{booking.no}</b><br /><small className="muted">{new Date(booking.createdAt).toLocaleString()}</small></td>
                  <td>{booking.customerName}<br /><small className="muted">{booking.customerPhone}</small></td>
                  <td>{booking.shopride?.what}<br /><small className="muted">{booking.shopride?.weightKg} kg{booking.shopride?.inspect ? ' · inspect' : ''}{booking.shopride?.repack ? ' · repack' : ''}{booking.shopride?.urgency === 'express' ? ' · express' : ''}</small></td>
                  <td>{booking.pickup?.address}<br /><small className="muted">{booking.shopride?.fromCbd ? 'CBD' : booking.shopride?.fromArea}</small></td>
                  <td>{booking.shopride?.mode === 'door' ? `🚪 ${booking.dropoff?.address}` : `📍 ${booking.shopride?.point?.name}`}</td>
                  <td className="right">{money(booking.payment?.amount)}<br /><small className="muted">inspection {booking.payment?.status}</small>
                    {booking.shopride?.goods?.amount > 0 && <><br /><small>goods {money(booking.shopride.goods.amount)}: {booking.shopride.goods.status}</small></>}
                    {booking.shopride?.onDelivery > 0 && <><br /><small className="muted">{booking.shopride.deliveryCollected ? 'delivery collected' : `collect ${money(booking.shopride.onDelivery)} at the door`}</small></>}
                  </td>
                  <td>{LABEL[booking.status] || booking.status}{booking.worker?.name ? <><br /><small className="muted">{booking.worker.name}</small></> : null}</td>
                  <td>
                    {NEXT(booking).map(([action, label]) => <button key={action} className="btn sm" style={{ marginBottom: 4 }} onClick={() => step(booking, action)}>{label}</button>)}
                    {booking.shopride?.goods?.seller?.status === 'due' && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        💵 Pay {booking.shopride.sellerName || 'the seller'} {money(booking.shopride.goods.amount)} on {booking.pickup?.phone ? String(booking.pickup.phone).replace(/^254/, '0') : 'their M-Pesa'}
                        <br /><button className="btn sm" onClick={() => { const ref = window.prompt('M-Pesa code of the payment to the seller'); if (ref !== null) step(booking, 'seller_paid', { ref }); }}>Seller paid</button>
                      </div>
                    )}
                    {booking.shopride?.goods?.seller?.status === 'paid' && <div className="muted" style={{ fontSize: 12 }}>Seller paid{booking.shopride.goods.seller.ref ? ` (${booking.shopride.goods.seller.ref})` : ''}</div>}
                  </td>
                </tr>
              ))}
              {list && !list.length && <tr><td colSpan={8} className="muted">No bookings{status ? ` ${LABEL[status].toLowerCase()}` : ''} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Points />
    </>
  );
}
