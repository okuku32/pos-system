// 📦 My deliveries: everything our riders and on-foot delivery agents bring me (plus shops' walking deliveries,
// couriers and errands): where each one is now (packed → dispatched → on the way → arrived → delivered),
// how many items are on the way, and my delivery history with us.
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { embedSrc, GMap, openInMaps, useMaps } from './Maps';
import { useRoadLine } from './roadLine';
import { RideContact } from '../shop/Calls';
import './market.css';
import { SiteName } from '../components/BrandName';

const when = (date) => (date ? new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const day = (date) => (date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const clock = (date) => new Date(date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const kmLeftText = (km) => (km == null ? '' : km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`);
const agoText = (date) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  return seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.round(seconds / 60)} min ago` : `at ${clock(date)}`;
};

// ⏱️ "~12 min (about 15:42)": the estimate was made at eta.at; count down from there
export function etaText(eta) {
  if (!eta?.minutes && eta?.minutes !== 0) return '';
  const arrive = new Date(new Date(eta.at || Date.now()).getTime() + eta.minutes * 60000);
  const left = Math.round((arrive.getTime() - Date.now()) / 60000);
  if (left <= 1) return 'any minute now';
  return `~${left} min (about ${clock(arrive)})`;
}

export const Stars = ({ rating, small }) => (rating?.count ? <span className={`mk-stars-inline ${small ? 'sm' : ''}`} title={`${rating.avg.toFixed(1)} out of 5 from ${rating.count} rating${rating.count === 1 ? '' : 's'}`}>⭐ {rating.avg.toFixed(1)} <small>({rating.count})</small></span> : <span className={`mk-stars-inline new ${small ? 'sm' : ''}`}>🆕 New rider</span>);

// 🛵 where the rider is now, how far, and when they'll arrive (updates live as the rider moves)
export function RiderLive({ person, live, eta, kmLeft, kmToYou, stage, dest, task }) {
  const maps = useMaps();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 30000); // the countdown moves on its own
    return () => clearInterval(timer);
  }, []);
  // the road the rider takes to you (asked before the early return below: React's rule for hooks)
  const roadLine = useRoadLine(person && live && dest?.lat != null ? [live, dest] : null, { mode: person?.vehicle === 'On foot' ? 'walk' : 'motorbike' });
  if (!person) return null;
  const onFoot = person.vehicle === 'On foot';
  const markers = live ? [{ lat: live.lat, lng: live.lng, title: `${person.name} (${onFoot ? 'on foot' : 'rider'})` }, ...(dest?.lat != null ? [{ lat: dest.lat, lng: dest.lng, title: 'You' }] : [])] : [];
  return (
    <div className="mk-rider-live" aria-live="polite">
      <div className="mk-rider-live-who">
        <span className="mk-rider-live-icon" aria-hidden="true">{onFoot ? '🚶' : '🏍️'}</span>
        <div>
          <b>{person.name}</b> <Stars rating={person.stars} small />
          <small>{onFoot ? 'On foot' : person.vehicle || 'Rider'}{person.plate ? ` · ${person.plate}` : ''} · ID-checked &amp; trained</small>
        </div>
      </div>
      {/* the rider's number, WhatsApp and a free in-app call: once they've accepted the delivery */}
      {(person.phone || task) && <div className="mk-rider-live-contact"><RideContact task={task} name={person.name} phone={person.phone} who="rider" /></div>}
      {(eta || kmLeft != null || kmToYou != null) && (
        <p className="mk-rider-live-eta">
          {eta && <span>⏱️ {stage === 'to_shop' ? 'Picks up your order' : 'Arriving'} <b>{etaText(eta)}</b></span>}
          {kmToYou != null ? (
            <span className="mk-rider-live-far">📍 <b>{kmLeftText(kmToYou).replace(' away', '')}</b> from you{stage === 'to_shop' && kmLeft != null ? <small> · collecting your order first ({kmLeftText(kmLeft).replace(' away', '')} to the shop)</small> : null}</span>
          ) : kmLeft != null && <span>📍 {stage === 'to_shop' ? `${kmLeftText(kmLeft).replace(' away', '')} to the shop, then to you` : kmLeftText(kmLeft)}</span>}
        </p>
      )}
      {live && (
        <>
          {maps ? <GMap center={{ lat: live.lat, lng: live.lng }} zoom={15} markers={markers} route={roadLine?.source === 'osm' ? roadLine.line : null} className="mk-rider-live-map" /> : <iframe className="mk-rider-live-map" title={`Where ${person.name} is now`} src={embedSrc(live.lat, live.lng, 15)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
          <small className="os-muted">📡 Live location, updated {agoText(live.at)} · <a href={openInMaps(live.lat, live.lng)} target="_blank" rel="noopener noreferrer">Open in Google Maps</a></small>
        </>
      )}
    </div>
  );
}

// ⭐ rate the rider / delivery agent (once, after delivery); shown on their profile and used to match riders
export function RateRider({ taskId, name, rated, onDone, what = 'delivery', who = 'your rider' }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(rated || 0);
  if (!taskId) return null;
  if (done) return <p className="mk-rate-rider done">⭐ You rated {name?.split(' ')[0] || who} {done}/5. Thank you!</p>;
  const send = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`/work/tasks/${taskId}/rate`, { stars, comment });
      setDone(stars);
      toast.success('Thanks for rating!');
      onDone?.();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-rate-rider" onSubmit={send}>
      <b>How was {name?.split(' ')[0] || who}’s {what}?</b>
      <div className="mk-star-pick" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} role="radio" aria-checked={stars === value} aria-label={`${value} star${value === 1 ? '' : 's'}`} className={value <= stars ? 'on' : ''} onClick={() => setStars(value)}>★</button>)}
      </div>
      {stars > 0 && <textarea rows={2} maxLength={300} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={stars >= 4 ? 'What went well? (optional)' : 'What went wrong? (optional)'} />}
      <button className="os-btn os-btn-brand" disabled={busy || !stars}>{busy ? 'Sending…' : 'Rate'}</button>
    </form>
  );
}

// the five steps, with the time each one happened
export function Transit({ transit, compact = false }) {
  if (!transit) return null;
  const cancelled = transit.current === 'cancelled';
  return (
    <ol className={`mk-transit ${compact ? 'compact' : ''} ${cancelled ? 'cancelled' : ''}`} aria-label={`Delivery: ${transit.currentLabel}`}>
      {transit.steps.map((step) => (
        <li key={step.key} className={`${step.done ? 'done' : ''} ${transit.current === step.key ? 'now' : ''}`} aria-current={transit.current === step.key ? 'step' : undefined}>
          <span className="mk-transit-dot" aria-hidden="true">{step.icon}</span>
          <b>{step.label}</b>
          {!compact && <small>{step.at ? when(step.at) : step.note || ''}</small>}
        </li>
      ))}
    </ol>
  );
}

function DeliveryCard({ delivery }) {
  return (
    <article className="mk-box mk-delivery">
      <div className="mk-delivery-top">
        <Link to={delivery.link}><b>{delivery.no}</b></Link>
        <span className={`mk-pill ${delivery.transit.current === 'delivered' ? 'ok' : delivery.transit.current === 'cancelled' ? 'bad' : 'wait'}`}>{delivery.transit.currentLabel}</span>
      </div>
      <p className="mk-delivery-what">{delivery.title}</p>
      <p className="mk-delivery-meta">
        <span>📦 <b>{delivery.qty}</b> item{delivery.qty === 1 ? '' : 's'}</span>
        <span>{delivery.method}</span>
        {delivery.fee > 0 && <span>Delivery {priceText(delivery.fee)}</span>}
      </p>
      {(delivery.from || delivery.to) && <p className="mk-delivery-route"><small>From</small> {delivery.from || '—'} <small>to</small> {delivery.to || 'you'}</p>}
      <Transit transit={delivery.transit} />
      {delivery.person && <RiderLive person={delivery.person} live={delivery.live} eta={delivery.eta} kmLeft={delivery.kmLeft} kmToYou={delivery.kmToYou} stage={delivery.stage} dest={delivery.dest} />}
      {!delivery.person && delivery.matching && <p className="mk-delivery-person">🔎 {delivery.matching}</p>}
      <Link className="os-btn os-btn-ghost" to={delivery.link}>Open {delivery.kind === 'errand' ? 'errand' : 'order'} →</Link>
    </article>
  );
}

export default function Deliveries() {
  const { customer, ready, onOrder } = useShop();
  const [data, setData] = useState(null);
  const [showAll, setShowAll] = useState(false);
  useSeo({ title: 'My deliveries', noindex: true });
  const load = useCallback(() => api.get('/orders/deliveries').then((response) => setData(response.data)).catch(() => setData((previous) => previous || { summary: {}, active: [], history: [] })), []);
  useEffect(() => {
    if (!customer) return undefined;
    load();
    const timer = setInterval(load, 20000); // errands and riders move: keep it fresh
    return () => clearInterval(timer);
  }, [customer, load]);
  useEffect(() => onOrder?.(() => load()), [onOrder, load]); // an order moved: refresh now

  if (ready && !customer) return <Navigate to="/login?next=%2Fdeliveries" replace />;
  const summary = data?.summary || {};
  const history = data ? (showAll ? data.history : data.history.slice(0, 10)) : [];
  return (
    <div className="mk"><div className="mk-wrap mk-deliveries">
        <section className="mk-work-hero">
          <h1>📦 My deliveries</h1>
          <p>Everything <SiteName />’s riders and on-foot delivery agents bring you, and where it is right now: packed, dispatched, on the way, arrived, delivered.</p>
        </section>

        <section className="mk-delivery-stats" aria-label="Delivery summary">
          <div><small>On the way now</small><b>{summary.active ?? '–'}</b><small>{summary.itemsOnTheWay || 0} item{summary.itemsOnTheWay === 1 ? '' : 's'}</small></div>
          <div><small>Delivered with us</small><b>{summary.delivered ?? '–'}</b><small>{summary.itemsDelivered || 0} item{summary.itemsDelivered === 1 ? '' : 's'}</small></div>
          <div><small>By our team on foot</small><b>{summary.onFoot ?? '–'}</b><small>walking deliveries</small></div>
          <div><small>Delivery fees paid</small><b>{priceText(summary.fees || 0)}</b><small>{summary.since ? `since ${day(summary.since)}` : 'so far'}</small></div>
        </section>

        <section aria-labelledby="mk-dl-now">
          <h2 className="mk-work-h" id="mk-dl-now">On the way</h2>
          {!data && <div className="page-loading"><span className="page-spinner" /></div>}
          {data && !data.active.length && (
            <div className="mk-empty">
              <p>Nothing on the way right now.</p>
              <p><Link className="os-btn os-btn-brand" to="/">Shop with rider delivery</Link> <Link className="os-btn os-btn-ghost" to="/errands">Send a parcel · Shop for me</Link></p>
            </div>
          )}
          <div className="mk-delivery-list">{data?.active.map((delivery) => <DeliveryCard key={delivery.kind + delivery._id} delivery={delivery} />)}</div>
        </section>

        <section aria-labelledby="mk-dl-history">
          <h2 className="mk-work-h" id="mk-dl-history">Delivery history</h2>
          {data && !data.history.length && <p className="os-muted">Your finished deliveries will show here.</p>}
          {history.length > 0 && (
            <div className="mk-box mk-delivery-history">
              <table>
                <thead><tr><th>Date</th><th>What</th><th>Items</th><th>How</th><th>Fee</th><th>Status</th></tr></thead>
                <tbody>
                  {history.map((delivery) => (
                    <tr key={delivery.kind + delivery._id}>
                      <td>{day(delivery.deliveredAt || delivery.at)}</td>
                      <td><Link to={delivery.link}><b>{delivery.no}</b></Link><small>{delivery.title}</small>{delivery.person && <small>{delivery.onFoot ? '🚶' : '🏍️'} {delivery.person.name}</small>}</td>
                      <td>{delivery.qty}</td>
                      <td>{delivery.method}</td>
                      <td>{delivery.fee ? priceText(delivery.fee) : 'Free'}</td>
                      <td>
                        <span className={`mk-pill ${delivery.transit.current === 'cancelled' ? 'bad' : 'ok'}`}>{delivery.transit.current === 'cancelled' ? 'Cancelled' : '✅ Delivered'}</span>
                        {delivery.taskId && delivery.person && delivery.transit.current !== 'cancelled' && (delivery.rated ? <small>⭐ You rated {delivery.rated}/5</small> : <details className="mk-rate-inline"><summary>⭐ Rate {delivery.person.name.split(' ')[0]}</summary><RateRider taskId={delivery.taskId} name={delivery.person.name} onDone={load} /></details>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.history.length > 10 && !showAll && <p className="mk-center"><button type="button" className="os-btn os-btn-ghost" onClick={() => setShowAll(true)}>Show all {data.history.length}</button></p>}
        </section>
      </div></div>
  );
}
