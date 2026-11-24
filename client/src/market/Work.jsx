// Field team: riders (deliveries) and shopping agents (they shop for buyers: check items at the shop before dispatch).
// Apply here; once our team approves you, jobs near you show up with the pay, pickup and destination.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useSeo } from './marketApi';

const priceText = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';
import { directionsTo, getHere, inKenya, kmText, lastHere } from './Maps';
import { etaText, Stars } from './Deliveries';
import { RideContact } from '../shop/Calls';
import WorkerDocs from './WorkerDocs';
import PrivateFile from '../components/PrivateFile';
import RiderMap from './RiderMap';
import './market.css';
import { KapuName, SiteName } from '../components/BrandName';

const VEHICLES = ['Motorbike', 'Bicycle', 'Tuk-tuk', 'Car', 'Van / pickup', 'On foot'];
const navTo = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
const ATTR_NAMES = { item: 'Type', size: 'Size', shoeSize: 'Shoe size', colour: 'Colour', brand: 'Brand', storage: 'Storage', model: 'Model', make: 'Make', gender: 'For', pack: 'Pack', unit: 'Sold per' };

export default function Work() {
  const { customer, ready } = useShop();
  const [me, setMe] = useState(null);
  const load = useCallback(() => api.get('/work/me').then((response) => setMe(response.data)).catch((error) => toast.error(errMsg(error))), []);
  useSeo({ title: 'Ride or shop with us: earn on every job', description: `Join ${STORE_INFO.name}’s field team: deliver orders as a rider, or become a shopping agent and check items at shops and markets for buyers. Jobs near you, paid to your M-Pesa after each job.`, path: '/work' });
  useEffect(() => {
    if (customer) load();
  }, [customer, load]);

  if (ready && !customer) return <Intro loggedOut />;
  if (!me) return <div className="mk"><div className="mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div></div>;
  const worker = me.worker;
  if (!worker || worker.status === 'rejected') return <Intro worker={worker} onApplied={load} />;
  if (worker.status === 'pending') {
    return (
      <div className="mk"><div className="mk-wrap mk-narrow">
          <div className="mk-box mk-work-status">
            <div className="mk-pay-icon">⏳</div>
            <h1>Application received</h1>
            <p>Thanks{customer?.name ? `, ${customer.name.split(' ')[0]}` : ''}! Our team will call you on <b>{prettyPhone(customer?.phone || '')}</b> to check your ID{worker.role === 'rider' ? ' and your ride' : ''}. Once you’re approved, jobs near <b>{worker.baseArea}</b> show up here.</p>
            <p className="mk-hint">Upload your documents below{worker.role === 'rider' ? ' (ID, driving licence and insurance)' : ''} so we can approve you faster.</p>
          </div>
          <WorkerDocs open />
        </div></div>
    );
  }
  if (worker.status === 'suspended') return <div className="mk"><div className="mk-wrap mk-narrow"><div className="mk-box mk-work-status"><div className="mk-pay-icon">⛔</div><h1>Account suspended</h1><p>{worker.reviewNote || 'Please contact support.'}</p><Link to="/help" className="os-btn os-btn-brand">Contact support</Link></div></div></div>;
  return <Board me={me} reload={load} />;
}

// ---------------------------------------------------------------- join
function Intro({ loggedOut, worker, onApplied }) {
  const [role, setRole] = useState(null);
  const text = STORE_INFO;
  return (
    <div className="mk"><div className="mk-wrap mk-work">
        <section className="mk-work-hero">
          <h1>Earn with <SiteName light /></h1>
          <p>Ride or shop with us: jobs near you, the pay shown upfront, and your money by M-Pesa {STORE_INFO.fieldwork?.payoutDelayMin ?? 30} minutes after each job.</p>
        </section>
        {worker?.status === 'rejected' && <p className="mk-chem wait">Your last application wasn’t approved: {worker.reviewNote || 'we couldn’t confirm your details'}. You can apply again.</p>}
        <div className="mk-work-roles">
          <article className={`mk-box mk-work-role ${role === 'rider' ? 'on' : ''}`}>
            <span className="mk-work-icon">🏍️</span>
            <h2>Rider</h2>
            <ul>
              <li>See deliveries from shops near your stage, with the <b>pay and destination</b> before you accept</li>
              <li>The buyer pays the delivery fee; you keep {100 - (text.fieldwork?.commissionPercent ?? 10) - (text.fieldwork?.taxPercent ?? 5)}% of it (the rest is our commission and tax)</li>
              <li>Pay-on-delivery orders: collect your fee in cash or M-Pesa at the door</li>
            </ul>
            {!loggedOut && <button className="os-btn os-btn-brand" onClick={() => setRole('rider')}>Apply as a rider</button>}
          </article>
          <article className={`mk-box mk-work-role ${role === 'agent' ? 'on' : ''}`}>
            <span className="mk-work-icon">🛍️</span>
            <h2>Shopping agent</h2>
            <ul>
              <li>Shop for buyers in your market or area: check their items at the shop <b>before they’re sent</b></li>
              <li>You do the inspections: the right item, size, colour and quality the buyer ordered</li>
              <li>Take nearby orders to the buyer, and far ones to the bus or courier office</li>
              <li>Earn on every job, paid to your M-Pesa {text.fieldwork?.payoutDelayMin ?? 30} minutes after it’s done</li>
            </ul>
            {!loggedOut && <button className="os-btn os-btn-brand" onClick={() => setRole('agent')}>Apply as a shopping agent</button>}
          </article>
          <article className={`mk-box mk-work-role ${role === 'partner' ? 'on' : ''}`}>
            <span className="mk-work-icon">🛡️</span>
            <h2>Partner shop</h2>
            <ul>
              <li>Have a <b>physical shop</b> in Nairobi? Become a <KapuName /> verification centre</li>
              <li>Sellers of second-hand items drop them at your shop; you check they match the ad, work and are genuine</li>
              <li>Earn a commission on every item you verify, paid to your M-Pesa; our shopping agents help when you need them</li>
              <li>One partner per area: shops are at least 2 km apart</li>
            </ul>
            {!loggedOut && <button className="os-btn os-btn-brand" onClick={() => setRole('partner')}>Apply as a partner shop</button>}
          </article>
        </div>
        {loggedOut && <p className="mk-center"><Link className="os-btn os-btn-brand os-btn-lg" to="/login?next=work">Log in or sign up to apply</Link></p>}
        {role && <ApplyForm role={role} onApplied={onApplied} />}
      </div></div>
  );
}

function ApplyForm({ role, onApplied }) {
  const { customer } = useShop();
  const here = lastHere(24 * 3600000);
  const [location, setLocation] = useState({ idNumber: '', vehicle: 'Motorbike', plate: '', baseArea: '', lat: here?.lat, lng: here?.lng, radiusKm: role === 'rider' ? 5 : 3, mpesaPhone: prettyPhone(customer?.phone || ''), market: '', shopName: '', shopAddress: '', permitNo: '', hours: 'Mon–Sat 8am–7pm' });
  const [markets, setMarkets] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setLocation({ ...location, [key]: event.target.value });
  useEffect(() => {
    if (role !== 'agent' || location.lat == null) return;
    api.get('/market/markets', { params: { near: `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`, km: 10 } }).then((response) => setMarkets(response.data.markets.filter((market) => market.approved))).catch(() => {});
  }, [role, location.lat, location.lng]);
  const locate = async () => {
    try {
      const position = await getHere();
      if (!inKenya(position.lat, position.lng)) throw new Error('Your location looks like it’s outside Kenya');
      setLocation((previousLocation) => ({ ...previousLocation, lat: position.lat, lng: position.lng }));
      toast.success('Got your location');
    } catch (error) {
      toast.error(error.message);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/work/apply', { role, ...location });
      toast.success('Application sent! We’ll call you.');
      onApplied();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-box mk-work-apply" onSubmit={submit}>
      <h2>{role === 'rider' ? '🏍️ Apply as a rider' : role === 'partner' ? '🛡️ Apply as a partner shop' : '🛍️ Apply as a shopping agent'}</h2>
      <div className="mk-form-grid">
        <label className="os-field"><span>National ID number *</span><input inputMode="numeric" value={location.idNumber} onChange={set('idNumber')} required maxLength={10} /></label>
        <label className="os-field"><span>M-Pesa number for your pay *</span><input inputMode="tel" value={location.mpesaPhone} onChange={set('mpesaPhone')} required /></label>
        {role === 'rider' && (
          <>
            <label className="os-field"><span>What do you ride? *</span><select value={location.vehicle} onChange={set('vehicle')}>{VEHICLES.map((vehicle) => <option key={vehicle}>{vehicle}</option>)}</select></label>
            {['Motorbike', 'Tuk-tuk', 'Car', 'Van / pickup'].includes(location.vehicle) && <label className="os-field"><span>Number plate *</span><input value={location.plate} onChange={set('plate')} placeholder="e.g. KMFA 123B" required /></label>}
          </>
        )}
        {role === 'partner' && (
          <>
            <label className="os-field"><span>Shop name *</span><input value={location.shopName} onChange={set('shopName')} required maxLength={80} placeholder="e.g. Baraka Phones & Electronics" /></label>
            <label className="os-field"><span>Business permit number *</span><input value={location.permitNo} onChange={set('permitNo')} required maxLength={30} /></label>
            <label className="os-field mk-span-all"><span>Shop address *</span><input value={location.shopAddress} onChange={set('shopAddress')} required maxLength={160} placeholder="Street, building, floor, shop number" /></label>
            <label className="os-field mk-span-all"><span>Opening hours</span><input value={location.hours} onChange={set('hours')} maxLength={80} /></label>
          </>
        )}
        <label className="os-field mk-span-all"><span>{role === 'rider' ? 'Your stage or area *' : role === 'partner' ? 'Area / centre *' : 'Your market or area *'}</span><input value={location.baseArea} onChange={set('baseArea')} placeholder={role === 'rider' ? 'e.g. Imara Daima stage' : role === 'partner' ? 'e.g. Kasarani, Mwiki' : 'e.g. Gikomba, clothes section'} required maxLength={60} /></label>
      </div>
      <div className="mk-work-loc">
        <button type="button" className="os-btn os-btn-ghost" onClick={locate}>📍 {location.lat != null ? 'Update my location' : 'Use my location'}</button>
        <span className="os-muted">{location.lat != null ? (role === 'partner' ? '✓ Shop pinned here' : '✓ Location set: jobs near here will show') : role === 'partner' ? 'Stand in your shop and tap this' : 'Stand at your stage or market and tap this'}</span>
      </div>
      {role === 'agent' && markets.length > 0 && (
        <label className="os-field"><span>The market you work in *</span><small className="os-muted">Buyers who shop at this market are linked to you.</small><select value={location.market} onChange={set('market')} required><option value="">Choose your market…</option>{markets.map((market) => <option key={market._id} value={market._id}>{market.name} · {kmText(market.km).replace(' away', '')}</option>)}</select></label>
      )}
      {role !== 'partner' && <div className="mk-work-loc">
        <span>Show me jobs within</span>
        <div className="mk-chips">{[2, 3, 5, 10, 15].map((item) => <button type="button" key={item} className={Number(location.radiusKm) === item ? 'on' : ''} onClick={() => setLocation({ ...location, radiusKm: item })}>{item} km</button>)}</div>
      </div>}
      <button className="os-btn os-btn-brand os-btn-lg" disabled={busy || location.lat == null}>{busy ? 'Sending…' : 'Send application'}</button>
      <small className="os-muted">{role === 'partner' ? 'Our team visits your shop to check your ID and business permit before you start. Partner shops are at least 2 km apart, so there’s one in each area.' : `Our team calls you to check your ID${role === 'rider' ? ', licence and ride' : ''} before you get jobs.`}</small>
    </form>
  );
}

// ---------------------------------------------------------------- the job board
function Board({ me, reload }) {
  const worker = me.worker;
  const { onWork } = useShop();
  const [notify, setNotify] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [here, setHere] = useState(() => lastHere(3 * 3600000));
  const [jobs, setJobs] = useState(null);
  const [busy, setBusy] = useState('');
  const near = here ? `${here.lat.toFixed(5)},${here.lng.toFixed(5)}` : undefined;
  const load = useCallback(() => api.get('/work/jobs', { params: { near } }).then((response) => setJobs(response.data)).catch((error) => toast.error(errMsg(error))), [near]);
  useEffect(() => onWork(() => load()), [onWork, load]); // a job near me was just posted
  useEffect(() => {
    load();
    const timer = setInterval(load, 20000); // new jobs show up on their own
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const act = async (id, path, body, ok) => {
    setBusy(id + path);
    try {
      await api.post(`/work/tasks/${id}/${path}`, body);
      toast.success(ok);
      load();
      reload();
    } catch (err) {
      toast.error(errMsg(err));
      load();
    } finally {
      setBusy('');
    }
  };
  const locate = async () => {
    try {
      const position = await getHere();
      setHere(position);
      toast.success('Showing jobs near where you are now');
    } catch (error) {
      toast.error(error.message);
    }
  };
  const toggle = async () => {
    try {
      await api.put('/work/me', { available: !worker.available });
      reload();
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const earnings = me.earnings;
  const rider = worker.role === 'rider';
  const partner = worker.role === 'partner';
  const stats = me.stats || {};
  const active = jobs?.mine?.filter((job) => ['assigned', 'picked_up'].includes(job.status)).length ?? stats.workload?.active ?? 0;
  const capacity = jobs?.capacity ?? stats.workload?.capacity ?? 3;

  // 📡 live location: buyers see where their order is and when it arrives; jobs are matched to the nearest riders
  const [sharing, setSharing] = useState('off');
  const [live, setLive] = useState(null); // every GPS fix (the map's "you" dot); the server hears every 20 s
  const [nearPlace, setNearPlace] = useState(null);
  const lastSent = useRef(0);
  const wantLive = !partner && (worker.available || active > 0);
  useEffect(() => {
    if (!wantLive || !('geolocation' in navigator)) return undefined;
    const id = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setSharing('on');
        setLive(point);
        if (Date.now() - lastSent.current < 20000) return; // every 20 seconds is enough
        lastSent.current = Date.now();
        setHere(point);
        api.put('/work/location', point).then((response) => setNearPlace(response.data?.near || null)).catch(() => {});
      },
      (error) => setSharing(error.code === 1 ? 'denied' : 'off'),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [wantLive]);
  const setCapacity = async (value) => {
    try {
      await api.put('/work/me', { capacity: value });
      toast.success(`You'll get up to ${value} job${value === 1 ? '' : 's'} at a time`);
      reload();
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="mk"><div className="mk-wrap mk-work">
        <section className="mk-work-top">
          <div>
            <h1>{rider ? '🏍️ Rider jobs' : partner ? `🛡️ ${worker.shopName || 'Verification desk'}` : '🔍 Inspection jobs'}</h1>
            <p className="os-muted">{partner ? `${worker.shopAddress || worker.baseArea} · Safe deal verification centre` : `${worker.baseArea}${worker.marketName ? ` · ${worker.marketName}` : ''} · within ${worker.radiusKm} km`}</p>
          </div>
          {!partner && <button type="button" className={`mk-work-avail ${worker.available ? 'on' : ''}`} onClick={toggle}>{worker.available ? '🟢 Available for jobs' : '⚪ Not taking jobs'}</button>}
        </section>

        {me.docs?.blocked && <a href="#docs" className="mk-docs-alert bad">⛔ {me.docs.blocked}</a>}
        {notify === 'default' && (
          <button type="button" className="mk-work-notify" onClick={() => Notification.requestPermission().then(setNotify)}>🔔 Turn on job alerts on this phone, even when the app is in the background</button>
        )}
        {!partner && (
          <section className="mk-rider-dash" aria-label="Your dashboard">
            <div><small>Today</small><b>{priceText(stats.today?.earned)}</b><small>{stats.today?.jobs || 0} job{stats.today?.jobs === 1 ? '' : 's'}</small></div>
            <div><small>This week</small><b>{priceText(stats.week?.earned)}</b><small>{stats.week?.jobs || 0} job{stats.week?.jobs === 1 ? '' : 's'}</small></div>
            <div><small>Your rating</small><b><Stars rating={stats.rating} /></b><small>{stats.rating?.count ? 'from buyers' : 'buyers rate you after delivery'}</small></div>
            <div className={active >= capacity ? 'full' : ''}><small>Workload now</small><b>{active} / {capacity}</b><small>{active >= capacity ? 'full: finish one to take more' : `room for ${capacity - active} more`}</small></div>
          </section>
        )}
        {!partner && (
          <section className="mk-box mk-rider-settings">
            <div>
              <b>How many jobs can you carry at once?</b>
              <div className="mk-chips">{[1, 2, 3, 4, 5, 6].map((value) => <button type="button" key={value} className={capacity === value ? 'on' : ''} onClick={() => setCapacity(value)}>{value}</button>)}</div>
              <small className="os-muted">We only match you with new jobs while you have room{worker.vehicle ? ` (suggested for a ${worker.vehicle.toLowerCase()}: ${stats.suggestedCapacity || capacity})` : ''}.</small>
            </div>
            <p className={`mk-live-pill ${sharing}`}>{sharing === 'on' ? '📡 Live location on: buyers see where you are and when you’ll arrive' : sharing === 'denied' ? '⚠️ Location is blocked: allow it in your browser so we can match you with jobs near you' : wantLive ? '📡 Turning on live location…' : '📡 Live location is off while you’re not taking jobs'}</p>
          </section>
        )}
        {!partner && <RiderMap here={live || here} near={nearPlace} jobs={jobs?.mine || []} vehicle={worker.vehicle} sharing={sharing} />}
        <WorkerDocs open={new URLSearchParams(window.location.search).get('docs') === '1'} onChange={reload} />
        {stats.reviews?.length > 0 && (
          <details className="mk-box mk-rider-reviews">
            <summary>⭐ What buyers say ({stats.rating?.count || stats.reviews.length})</summary>
            <ul>{stats.reviews.map((review, index) => <li key={index}><span>{'★'.repeat(review.stars)}{'☆'.repeat(5 - review.stars)}</span> {review.comment ? <q>{review.comment}</q> : <em>No comment</em>} <small>{review.orderNo} · {new Date(review.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></li>)}</ul>
          </details>
        )}
        <section className="mk-work-earn" aria-label="Earnings">
          <div><small>Earned ({earnings.jobs} job{earnings.jobs === 1 ? '' : 's'})</small><b>{priceText(earnings.earned)}</b></div>
          <div><small>Sent to your M-Pesa</small><b>{priceText(earnings.sent)}</b></div>
          <div><small>{earnings.balance < 0 ? 'You owe (cash jobs)' : 'Coming to you'}</small><b className={earnings.balance < 0 ? 'danger-text' : ''}>{priceText(Math.abs(earnings.balance))}</b></div>
          {earnings.cashCollected > 0 && <div><small>Cash you collected</small><b>{priceText(earnings.cashCollected)}</b></div>}
          {earnings.tips > 0 && <div><small>Tips from buyers</small><b>{priceText(earnings.tips)}</b></div>}
        </section>
        <p className="mk-hint">
          From each job’s fee ({priceText(earnings.fees)} so far) we keep {earnings.commissionPercent + earnings.taxPercent}%: {earnings.commissionPercent}% commission and {earnings.taxPercent}% tax ({priceText(earnings.commission + earnings.tax)}).
          {' '}Your share is sent to {prettyPhone(worker.mpesaPhone)} by M-Pesa {earnings.delayMin} minutes after each job{earnings.waiting > 0 && earnings.nextAt ? ` (next: ${priceText(earnings.waiting)} after ${new Date(earnings.nextAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` : ''}.
          {' '}Fees you collect yourself (cash or M-Pesa from the buyer) are yours to keep; our {earnings.commissionPercent + earnings.taxPercent}% is taken from your next payout.
        </p>
        {earnings.payouts?.length > 0 && (
          <ul className="mk-work-payouts">
            {earnings.payouts.map((payout) => <li key={payout._id}><span>{new Date(payout.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><b>{priceText(payout.amount)}</b><small>{payout.status === 'paid' ? `✅ ${payout.ref}` : payout.status === 'failed' ? '⚠️ failed, retrying' : '⏳ sending'}</small></li>)}
          </ul>
        )}

        {jobs?.mine?.length > 0 && (
          <section>
            <h2 className="mk-work-h">{partner ? 'Items to verify' : 'Your jobs'}</h2>
            {jobs.mine.map((item) => <JobCard key={item._id} t={item} busy={busy} act={act} />)}
          </section>
        )}

        {partner && !jobs?.mine?.length && jobs && <div className="mk-empty"><p>No items waiting. When a buyer pays for a Safe deal near you, the seller is sent here and the item shows up on this page.</p></div>}
        {partner && (
          <section className="mk-box mk-safe-howto">
            <h2>How to verify a Safe deal item</h2>
            <ol>
              <li>The seller arrives: match their name and order number, then tap <b>“Item received”</b>.</li>
              <li>Check it against the ad: same item and model, works properly, condition as described, genuine (record the serial / IMEI).</li>
              <li>Pass it and keep it safe: our rider collects it from you. Fail it and give it back to the seller.</li>
              <li>Not sure (e.g. a laptop you can’t test)? Tap <b>“Ask a shopping agent”</b>: agents near you are alerted.</li>
            </ol>
          </section>
        )}
        {!partner && <section>
          <div className="mk-work-h-row">
            <h2 className="mk-work-h">Jobs near you</h2>
            <button type="button" className="os-linkbtn" onClick={locate}>📍 {here ? 'Update my location' : 'Use where I am now'}</button>
          </div>
          {!worker.available && <p className="os-muted">You’re not taking jobs. Tap “Not taking jobs” above to start.</p>}
          {worker.available && active >= capacity && <p className="mk-chem wait">You’re carrying {active} of {capacity} jobs. Finish one (or raise your limit above) to get matched with more.</p>}
          {jobs && worker.available && !jobs.open.length && <div className="mk-empty"><p>No {rider ? 'deliveries' : 'inspections'} near you right now. New jobs show up here by themselves; keep this page open.</p></div>}
          {jobs?.open.map((value) => <JobCard key={value._id} t={value} busy={busy} act={act} />)}
          {!jobs && <div className="page-loading"><span className="page-spinner" /></div>}
        </section>}

        {worker.role === 'agent' && <MySellers />}

        {jobs?.done?.length > 0 && (
          <section>
            <h2 className="mk-work-h">Finished</h2>
            <div className="mk-work-done">
              {jobs.done.map((order) => (
                <div key={order._id}>
                  <span>{order.kind === 'delivery' ? '🏍️' : order.result?.passed ? '✅' : '❌'} {order.orderNo}{order.kind === 'verification' ? ` · ${order.items.map((item) => item.title).join(', ')}` : ` · ${order.pickup.name}`}</span>
                  <b>{order.collectCash ? `${priceText(order.collectCash)} cash` : priceText(order.pay)}{order.tips ? ` + ${priceText(order.tips)} tip` : ''}</b>
                  <small>{order.payout === 'paid' ? 'paid' : order.payout === 'unpaid' ? 'to be paid' : 'collected'}</small>
                </div>
              ))}
            </div>
          </section>
        )}
      </div></div>
  );
}

// 🛡️ partner shop: a Safe deal item the seller brings in
// a shopping agent's sellers: everyone they were linked to through an order or a job (agent ↔ seller), with contacts
function MySellers() {
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/work/sellers').then((response) => live && setList(response.data.sellers)).catch(() => live && setList([]));
    return () => { live = false; };
  }, []);
  if (!list?.length) return null;
  return (
    <section aria-labelledby="mk-my-sellers">
      <h2 className="mk-work-h" id="mk-my-sellers">🏪 Sellers you work with ({list.length})</h2>
      <div className="mk-my-sellers">
        {list.map((seller) => (
          <article key={seller._id} className="mk-my-seller">
            <div>
              <b>{seller.shop || seller.name}</b>
              <small>{[seller.shop ? seller.name : '', seller.market, seller.stall ? `stall ${seller.stall}` : '', seller.area].filter(Boolean).join(' · ')}</small>
              <small>{seller.orders} order{seller.orders === 1 ? '' : 's'}{seller.jobs ? ` · ${seller.jobs} inspection${seller.jobs === 1 ? '' : 's'} by you` : ''}</small>
            </div>
            {seller.phone && (
              <span className="mk-my-seller-reach">
                <a className="os-btn os-btn-brand" href={`tel:+${seller.phone}`}>📞 Call</a>
                <a className="os-btn os-btn-ghost" href={`https://wa.me/${seller.phone}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function VerifyCard({ task, busy, act }) {
  const [checks, setChecks] = useState({ matchesAd: false, works: false, condition: false, genuine: false });
  const [serial, setSerial] = useState('');
  const [note, setNote] = useState('');
  const allOk = Object.values(checks).every(Boolean);
  const askHelp = () => {
    const need = window.prompt('What do you need help with? (e.g. “test a laptop’s battery”, “check a phone’s ownership”)');
    if (need && need.trim().length >= 5) act(task._id, 'help', { note: need.trim() }, 'Shopping agents near you have been alerted');
  };
  return (
    <article className="mk-box mk-job mine mk-verify-job">
      <div className="mk-job-top">
        <span className="mk-job-pay">{priceText(task.pay)}<small> · your commission, to your M-Pesa</small></span>
        <span className="mk-pill ok">🛡️ Safe deal {task.orderNo}</span>
        <span className="mk-pill wait">{task.status === 'assigned' ? 'Waiting for the seller' : task.status === 'picked_up' ? 'In your shop: verify it' : task.status}</span>
      </div>
      <ul className="mk-job-items">
        {task.items.map((item, index) => (
          <li key={index}>{item.qty} × <b>{item.title}</b>{item.attrs && Object.keys(item.attrs).length > 0 && <small> · {Object.entries(item.attrs).filter(([, value]) => value !== '' && value != null && typeof value !== 'object').slice(0, 8).map(([key, value]) => `${ATTR_NAMES[key] || key}: ${value}`).join(' · ')}</small>}</li>
        ))}
      </ul>
      {task.buyerNotes && <p className="mk-job-notes">📝 {task.buyerNotes}</p>}
      <div className="mk-job-actions">
        {task.status === 'assigned' && <button className="os-btn os-btn-brand" disabled={!!busy} onClick={() => act(task._id, 'received', {}, 'Received. Now check it.')}>📥 Item received from the seller</button>}
        {['assigned', 'picked_up'].includes(task.status) && <button className="os-btn os-btn-ghost" disabled={!!busy} onClick={askHelp}>🤝 Ask a shopping agent</button>}
      </div>
      {task.status === 'picked_up' && (
        <form className="mk-inspect" onSubmit={(event) => { event.preventDefault(); act(task._id, 'verify', { checks, serial, note }, allOk ? 'Verified! The seller is paid and a rider is on the way' : 'Failed: the buyer is refunded; give the item back to the seller'); }}>
          <b>Verify the item</b>
          {[['matchesAd', 'Same item, model and specs as the ad'], ['works', 'Works properly (switched on / tested)'], ['condition', 'Condition as described (no hidden damage)'], ['genuine', 'Genuine, not stolen or fake (serial / IMEI checked)']].map(([key, label]) => (
            <label key={key} className="mk-check"><input type="checkbox" checked={checks[key]} onChange={(event) => setChecks({ ...checks, [key]: event.target.checked })} /> {label}</label>
          ))}
          <label className="os-field"><span>Serial / IMEI number</span><input value={serial} onChange={(event) => setSerial(event.target.value.toUpperCase())} maxLength={40} placeholder="e.g. 356938035643809" /></label>
          <label className="os-field"><span>{allOk ? 'Notes (optional)' : 'What’s wrong? *'}</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={allOk ? 'e.g. Battery health 88%, charger included' : 'e.g. Screen cracked; the ad says no scratches'} /></label>
          <button className={`os-btn ${allOk ? 'os-btn-brand' : 'os-btn-dark'} os-block`} disabled={!!busy || (!allOk && note.trim().length < 5)}>{allOk ? '✅ Verified: release payment & call a rider' : '❌ Failed: refund the buyer'}</button>
        </form>
      )}
      {task.status === 'done' && <p className="mk-job-notes">{task.result?.passed ? '✅ Verified. Keep it safe until our rider collects it.' : '❌ Failed. Give the item back to the seller.'}</p>}
    </article>
  );
}

// 🛒 a customer's written / photographed list: read it, agree on brands with them if needed, send the price.
// They pay it with M-Pesa; then you buy it ("I've bought it").
function ListBox({ task }) {
  if (!task.list) return null;
  return (
    <div className="mk-job-list">
      <b>🛒 The customer’s list</b>
      {task.list.text && <p>{task.list.text}</p>}
      {task.list.photos?.length > 0 && <div className="mk-errand-listphotos">{task.list.photos.map((path, index) => <PrivateFile key={path} client={api} path={path} alt={`Shopping list, photo ${index + 1}`} height={120} />)}</div>}
      {!task.mine && task.list.photoCount > 0 && <small className="os-muted">📷 {task.list.photoCount} photo{task.list.photoCount === 1 ? '' : 's'} of the list: you’ll see them once you take the job.</small>}
    </div>
  );
}
function QuoteForm({ task, busy, act }) {
  const [amount, setAmount] = useState(task.quote?.amount ? String(task.quote.amount) : '');
  const [note, setNote] = useState('');
  return (
    <form className="mk-job-bought" onSubmit={(event) => { event.preventDefault(); act(task._id, 'quote', { amount: Number(amount), note }, 'Price sent: the customer has an M-Pesa prompt'); }}>
      {task.quote?.sentAt && <p className="mk-chem wait">⏳ You sent {priceText(task.quote.amount)}. Waiting for the customer to pay: you’ll get a notification. Don’t buy yet.</p>}
      <label className="os-field"><span>Price of everything on the list (KSh) *</span><input value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="e.g. 1450" /></label>
      <label className="os-field"><span>Note to the customer (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="e.g. Fresh Fri 1 L, Pembe unga; no brown bread today" /></label>
      <small className="os-muted">Call them first if anything is unclear. They pay this + your fee with M-Pesa; you buy only after they’ve paid.</small>
      <button className="os-btn os-btn-brand" disabled={!!busy || !(Number(amount) >= 50)}>{task.quote?.sentAt ? '🧾 Send a new price' : '🧾 Send the price'}</button>
    </form>
  );
}

function JobCard({ t: task, busy, act }) {
  const [checks, setChecks] = useState({ rightItem: false, size: false, colour: false, quality: false });
  const [note, setNote] = useState('');
  const delivery = task.kind === 'delivery';
  const shopping = task.kind === 'shopping'; // an errand: buy the customer's list at any shop, then deliver
  const goesToBuyer = (delivery && !task.courier) || shopping;
  const [bought, setBought] = useState({ spent: '', receipt: '' });
  const allOk = Object.values(checks).every(Boolean);
  const both = delivery && task.inspect; // inspect at the shop, then deliver
  const cr = delivery ? task.courier : null; // far away: send it by bus / courier
  const [sent, setSent] = useState({ waybill: '', office: '', fare: '' });
  const needCheck = task.mine && task.status === 'assigned' && (task.kind === 'inspection' || (both && task.result?.passed == null));
  if (task.kind === 'verification') return <VerifyCard task={task} busy={busy} act={act} />;
  return (
    <article className={`mk-box mk-job ${task.mine ? 'mine' : ''}`}>
      <div className="mk-job-top">
        <span className="mk-job-pay">{priceText(task.pay)}<small>{task.collectCash ? (() => {
          // the cash they collect on delivery, then what's left: sent to their M-Pesa, or (cash jobs) our share charged to their account
          const rest = task.pay - task.collectCash;
          return ` · your pay: ${priceText(task.collectCash)} from the ${task.errand ? 'customer' : 'buyer'} on delivery${rest > 0 ? ` + ${priceText(rest)} to your M-Pesa` : rest < 0 ? ` (our ${priceText(-rest)} is charged to your account)` : ''}${task.kind === 'shopping' ? '; what you spend is refunded too' : ''}`;
        })() : ' · your pay, to your M-Pesa'}</small></span>
        {both && <span className="mk-pill ok">🔍 Inspect{cr ? '' : ' & deliver'}</span>}
        {cr && <span className="mk-pill ok">🚌 Courier: {cr.name}</span>}
        {shopping && <span className="mk-pill ok">🛒 Shop & deliver · {task.quote && !task.quote.paidAt ? (task.quote.sentAt ? `priced ${priceText(task.quote.amount)}, waiting for payment` : 'price the list first') : `budget ${priceText(task.budget)}`}</span>}
        {task.errand && !shopping && <span className="mk-pill ok">🛵 Parcel errand</span>}
        {task.bookedForMe && !task.mine && <span className="mk-pill ok mk-pill-booked">📌 Booked for you by the buyer</span>}
        {task.matched && !task.mine && !task.bookedForMe && <span className="mk-pill ok">🎯 Matched for you</span>}
        {task.toShop && !task.mine ? <span className="mk-job-away">📍 {kmText(task.toShop.km).replace(' away', '')} to the {task.kind === 'shopping' ? 'shop' : 'seller'} · ~{task.toShop.eta} min</span> : task.away != null && !task.mine && <span className="mk-job-away">📍 {kmText(task.away)}</span>}
        {task.mine && <span className="mk-pill wait">{task.status === 'picked_up' ? (cr ? 'Taking it to the courier' : 'On the way') : task.status === 'delivered' ? 'Waiting for the buyer' : 'Yours'}</span>}
      </div>
      {task.list && <ListBox task={task} />}
      <div className="mk-job-route">
        <div><small>{shopping ? 'Shop at' : both ? 'Inspect & pick up at' : delivery ? 'Pick up from' : 'Inspect at'}{task.leg ? ` · part ${task.leg} of a split order` : ''}</small><b>🏪 {task.pickup.name}</b><span>{task.pickup.address}{task.pickup.area ? `, ${task.pickup.area}` : ''}</span>{task.pickup.phone && <a href={`tel:+${task.pickup.phone}`}>📞 {prettyPhone(task.pickup.phone)}</a>}</div>
        {cr && <div><small>Take it to</small><b>🚌 {cr.name}</b><span>The nearest {cr.name} office or stage to the shop</span><small>Send it to</small><b>👤 {task.dropoff.name || 'The buyer'}</b><span>{cr.toTown}</span></div>}
        {goesToBuyer && <div><small>Deliver to{task.km ? ` · ${task.km} km trip` : ''}</small><b>📍 {task.dropoff.address}</b><span>{task.dropoff.area}</span>{task.dropoff.name && <span>{task.dropoff.name}</span>}</div>}
      </div>
      {task.mine && (goesToBuyer || cr) && ['assigned', 'picked_up', 'delivered'].includes(task.status) && (task.dropoff?.phone || task._id) && (
        <div className="mk-job-contact">
          <RideContact task={task._id} name={task.dropoff?.name} phone={task.dropoff?.phone} who={task.errand ? 'customer' : 'buyer'} />
        </div>
      )}
      {/* an inspection that's mine: the way to the seller's shop */}
      {task.mine && task.kind === 'inspection' && task.status === 'assigned' && task.pickup?.lat != null && (
        <a className="os-btn os-btn-ghost mk-job-directions" href={directionsTo(task.pickup.lat, task.pickup.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions to {task.pickup.name}</a>
      )}
      {/* an inspection that's mine: the seller's contacts, to find their shop / stall (call, WhatsApp, or free in-app call) */}
      {task.mine && task.kind === 'inspection' && task.status === 'assigned' && task.pickup?.phone && (
        <div className="mk-job-contact">
          <RideContact task={task._id} name={task.pickup.name} phone={task.pickup.phone} who="seller" />
        </div>
      )}
      {(task.trip || task.eta) && (
        <p className="mk-job-eta">
          {task.trip && <span>🛣️ {task.trip.km} km trip · ~{task.trip.minutes} min</span>}
          {task.mine && task.eta && <span>⏱️ {task.status === 'assigned' ? 'At the buyer' : 'Buyer expects you'} <b>{etaText(task.eta)}</b>{task.kmLeft != null ? ` · ${kmText(task.kmLeft).replace(' away', '')} to go` : ''}</span>}
          {task.qty > 0 && <span>📦 {task.qty} item{task.qty === 1 ? '' : 's'}</span>}
        </p>
      )}
      <ul className="mk-job-items">
        {task.items.map((item, index) => (
          <li key={index}>{item.qty} × {item.title}{item.attrs && Object.keys(item.attrs).some((key) => ATTR_NAMES[key]) && <small> · {Object.entries(item.attrs).filter(([key]) => ATTR_NAMES[key]).map(([key, value]) => `${ATTR_NAMES[key]}: ${value}`).join(' · ')}</small>}</li>
        ))}
      </ul>
      {task.buyerNotes && <p className="mk-job-notes">📝 {task.errand ? 'Notes' : 'Buyer asks you to check'}: <b>{task.buyerNotes}</b></p>}
      {cr && <p className="mk-job-notes">🚌 Pay {cr.name} about <b>{priceText(cr.fare)}</b> for the parcel (it’s refunded to your M-Pesa with your pay; your pay above includes it). Put the buyer’s name and phone on the parcel.</p>}
      {task.collectCash > 0 && !task.errand && <p className="mk-job-notes">💵 Collect <b>{priceText(task.collectCash)}</b> delivery fee in cash from the buyer{both ? ' (the items and inspection are already paid).' : ' (the buyer pays the seller for the items).'}</p>}
      {task.collectCash > 0 && task.errand && <p className="mk-job-notes">💵 Collect the <b>{priceText(task.collectCash)}</b> delivery fee (cash or M-Pesa){shopping ? ' from the customer on delivery. The shopping budget is already paid: you’re refunded what you spend.' : '.'}</p>}

      {!task.mine && <button className="os-btn os-btn-brand os-block" disabled={!!busy} onClick={() => act(task._id, 'accept', {}, 'Job accepted. Head to the shop.')}>Accept job</button>}
      {task.mine && (
        <div className="mk-job-actions">
          <a className="os-btn os-btn-ghost" href={navTo(task.pickup.lat, task.pickup.lng)} target="_blank" rel="noopener noreferrer">🧭 To the shop</a>
          {goesToBuyer && task.dropoff?.lat != null && <a className="os-btn os-btn-ghost" href={directionsTo(task.dropoff.lat, task.dropoff.lng)} target="_blank" rel="noopener noreferrer">🧭 To the {task.errand ? 'customer' : 'buyer'}</a>}
          {shopping && task.status === 'assigned' && task.quote && !task.quote.paidAt && <QuoteForm task={task} busy={busy} act={act} />}
          {shopping && task.status === 'assigned' && (!task.quote || task.quote.paidAt) && (
            <form className="mk-job-bought" onSubmit={(event) => { event.preventDefault(); act(task._id, 'bought', { spent: Number(bought.spent), receipt: bought.receipt }, 'Bought! The customer has been told.'); }}>
              <label className="os-field"><span>Amount spent (KSh), from the receipt *</span><input value={bought.spent} onChange={(event) => setBought({ ...bought, spent: event.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder={`up to ${task.budget}`} required /></label>
              <label className="os-field"><span>Receipt number (optional)</span><input value={bought.receipt} onChange={(event) => setBought({ ...bought, receipt: event.target.value })} maxLength={60} /></label>
              <button className="os-btn os-btn-brand" disabled={!!busy || !(Number(bought.spent) > 0)}>🛒 I’ve bought it</button>
            </form>
          )}
          {delivery && task.status === 'assigned' && !needCheck && <button className="os-btn os-btn-brand" disabled={!!busy} onClick={() => act(task._id, 'picked-up', {}, 'Picked up. The buyer has been told.')}>📦 I’ve picked it up</button>}
          {goesToBuyer && task.status === 'picked_up' && !task.onTheWayAt && <button className="os-btn os-btn-dark" disabled={!!busy} onClick={() => act(task._id, 'on-the-way', {}, `The ${task.errand ? 'customer' : 'buyer'} knows you’re on the way 🛵`)}>🛵 On my way</button>}
          {goesToBuyer && task.status === 'picked_up' && !task.arrivedAt && <button className="os-btn os-btn-dark" disabled={!!busy} onClick={() => act(task._id, 'arrived', {}, `The ${task.errand ? 'customer' : 'buyer'} knows you’ve arrived 📍`)}>📍 I’ve arrived</button>}
          {goesToBuyer && task.status === 'picked_up' && <button className="os-btn os-btn-brand" disabled={!!busy} onClick={() => act(task._id, 'delivered', {}, task.buyerConfirmed ? 'Done! Both confirmed 🎉' : 'Thanks! Waiting for the buyer to confirm')}>✅ Delivered: confirm</button>}
          {goesToBuyer && task.status === 'picked_up' && task.buyerConfirmed && <small className="ok-text">The buyer already confirmed they got it</small>}
          {goesToBuyer && task.status === 'delivered' && <span className="mk-pill wait">⏳ You confirmed. Waiting for the buyer to confirm (completes on its own after 24 hours)</span>}
          {task.status === 'assigned' && !(task.quote?.sentAt && !task.quote?.paidAt) && <button className="os-linkbtn" disabled={!!busy} onClick={() => window.confirm('Give this job back so someone else can take it?') && act(task._id, 'release', {}, 'Job given back')}>Can’t make it</button>}
        </div>
      )}
      {both && task.result?.passed && task.status === 'assigned' && <p className="mk-job-notes">✅ You passed the inspection. Pick it up and {cr ? `take it to ${cr.name}` : 'deliver'}.</p>}
      {cr && task.mine && task.status === 'picked_up' && (
        <form className="mk-inspect mk-sent" onSubmit={(event) => { event.preventDefault(); act(task._id, 'sent', sent, 'Sent! The buyer has the waybill number 🎉'); }}>
          <b>Sent it? Enter the courier’s details</b>
          <label className="os-field"><span>Waybill / receipt number *</span><input value={sent.waybill} onChange={(event) => setSent({ ...sent, waybill: event.target.value.toUpperCase() })} required minLength={3} maxLength={40} placeholder="e.g. EC123456" autoCapitalize="characters" /></label>
          <label className="os-field"><span>Office or stage you sent it from *</span><input value={sent.office} onChange={(event) => setSent({ ...sent, office: event.target.value })} required minLength={3} maxLength={120} placeholder={`e.g. ${cr.name}, Accra Road`} /></label>
          <label className="os-field"><span>Fare you paid (KSh)</span><input type="number" inputMode="numeric" min="0" max="50000" value={sent.fare} onChange={(event) => setSent({ ...sent, fare: event.target.value })} placeholder={String(cr.fare)} /></label>
          <button className="os-btn os-btn-brand os-block" disabled={!!busy || sent.waybill.trim().length < 3 || sent.office.trim().length < 3}>📦 Sent: notify the buyer</button>
        </form>
      )}
      {cr && task.status === 'done' && cr.waybill && <p className="mk-job-notes">✅ Sent by {cr.name}, waybill <b>{cr.waybill}</b></p>}
      {needCheck && (
        <form className="mk-inspect" onSubmit={(event) => { event.preventDefault(); act(task._id, 'inspect', { checks, note }, allOk ? (both ? 'Passed: pick it up and deliver' : 'Passed: the seller can send it') : 'Failed: the buyer and seller have been told'); }}>
          <b>{both ? 'Step 1: inspect before you pick up' : 'Inspection'}</b>
          {[['rightItem', 'It’s the item the buyer ordered'], ['size', 'Right size'], ['colour', 'Right colour / model'], ['quality', 'Good quality, not damaged']].map(([key, label]) => (
            <label key={key} className="mk-check"><input type="checkbox" checked={checks[key]} onChange={(event) => setChecks({ ...checks, [key]: event.target.checked })} /> {label}</label>
          ))}
          <label className="os-field"><span>{allOk ? 'Notes (optional)' : 'What’s wrong? *'}</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={allOk ? 'e.g. Checked size 42, new in the box' : 'e.g. Size 40, the buyer ordered 42'} /></label>
          <button className={`os-btn ${allOk ? 'os-btn-brand' : 'os-btn-dark'} os-block`} disabled={!!busy || (!allOk && note.trim().length < 5)}>{allOk ? (both ? '✅ Passed: I’ll deliver it' : '✅ Passed: OK to send') : '❌ Failed: report the problem'}</button>
        </form>
      )}
    </article>
  );
}
