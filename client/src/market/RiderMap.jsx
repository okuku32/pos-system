// 🗺️ The rider's map: where they are now (live, from the phone's GPS), the named place they're near, and the route
// for their current job (to the shop, then to the buyer), with distance and time for the next stop and one tap to
// start turn-by-turn navigation in the phone's maps app. The map is Leaflet + OpenStreetMap: the live "you" dot,
// the numbered stops and the route along the actual roads (OpenStreetMap routing; a straight line until it arrives).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './marketApi';
import { GMap, kmText } from './Maps';
import { useRoadLine } from './roadLine';

const point = (lat, lng) => (lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null);
const pair = (place) => `${place.lat},${place.lng}`;
const kmBetween = (a, b) => {
  const rad = (deg) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const MODE = { Bicycle: 'bicycling', 'On foot': 'walking', Motorbike: 'two-wheeler' };

// the stops still ahead on a job, in order
export function stopsOf(job) {
  const pickup = point(job.pickup?.lat, job.pickup?.lng);
  const dropoff = point(job.dropoff?.lat, job.dropoff?.lng);
  const toBuyer = (job.kind === 'delivery' && !job.courier) || job.kind === 'shopping';
  const stops = [];
  if (job.status === 'assigned' && pickup) stops.push({ ...pickup, kind: 'pickup', label: job.kind === 'shopping' ? 'Shop at' : job.kind === 'delivery' ? 'Pick up at' : 'Inspect at', name: job.pickup.name, area: job.pickup.area });
  if (toBuyer && dropoff && ['assigned', 'picked_up'].includes(job.status)) stops.push({ ...dropoff, kind: 'dropoff', label: 'Deliver to', name: job.dropoff.name || job.dropoff.address, area: job.dropoff.area });
  return stops;
}

export default function RiderMap({ here, near, jobs = [], vehicle, sharing }) {
  const active = useMemo(() => jobs.filter((job) => job.mine && ['assigned', 'picked_up'].includes(job.status) && stopsOf(job).length), [jobs]);
  const [pick, setPick] = useState('');
  const job = active.find((item) => item._id === pick) || active[0] || null;
  const stops = useMemo(() => (job ? stopsOf(job) : []), [job]);
  const next = stops[0] || null;
  // the path along the actual roads: you → the stops (the next stop's km and time come from its first leg)
  const roadLine = useRoadLine(here && stops.length ? [here, ...stops] : null, { mode: vehicle === 'Car' || vehicle === 'Van / pickup' ? 'car' : vehicle === 'On foot' ? 'walk' : 'motorbike' });
  const firstLeg = roadLine?.source === 'osm' ? roadLine.legs?.[0] : null;

  // the road to the next stop (Google Routes through our server, or an estimate): asked again after moving ~300 m
  const [road, setRoad] = useState(null);
  const asked = useRef(null);
  useEffect(() => {
    if (!here || !next) { setRoad(null); return; }
    const key = `${job?._id}:${next.kind}`;
    if (asked.current && asked.current.key === key && kmBetween(asked.current.from, here) < 0.3) return;
    asked.current = { key, from: here };
    let live = true;
    api.get('/geo/route', { params: { from: pair(here), to: pair(next), mode: vehicle === 'Car' || vehicle === 'Van / pickup' ? 'car' : vehicle === 'On foot' ? 'walk' : 'motorbike' } })
      .then((response) => live && setRoad(response.data))
      .catch(() => live && setRoad({ km: Math.round(kmBetween(here, next) * 13) / 10, minutes: Math.max(1, Math.round(kmBetween(here, next) * 1.3 * 2.6)), source: 'estimate' }));
    return () => { live = false; };
  }, [here, next, job?._id, vehicle]);

  const navUrl = useMemo(() => {
    if (!stops.length) return '';
    const last = stops[stops.length - 1];
    const middle = stops.slice(0, -1).map(pair).join('|');
    return `https://www.google.com/maps/dir/?api=1${here ? `&origin=${pair(here)}` : ''}&destination=${pair(last)}${middle ? `&waypoints=${encodeURIComponent(middle)}` : ''}&travelmode=${MODE[vehicle] || 'driving'}`;
  }, [stops, here, vehicle]);

  return (
    <section className="mk-box mk-rider-map" aria-label="Where you are and your route">
      <div className="mk-rider-map-head">
        <div>
          <h2>🗺️ {job ? 'Your route' : 'Where you are'}</h2>
          <p className="mk-rider-here">
            <span className={`mk-live-dot ${sharing === 'on' ? 'on' : ''}`} aria-hidden="true" />
            {here
              ? near ? <>You’re near <b>{near.name}</b>{near.area && near.area !== near.name ? `, ${near.area}` : ''} <small>({kmText(near.km).replace(' away', '')} from it)</small></> : <>You’re at <b>{here.lat.toFixed(4)}, {here.lng.toFixed(4)}</b></>
              : sharing === 'denied' ? 'Location is blocked: allow it so we can show where you are' : 'Finding where you are…'}
          </p>
        </div>
        {active.length > 1 && (
          <div className="mk-chips" role="tablist" aria-label="Choose a job">
            {active.map((item) => <button key={item._id} type="button" role="tab" aria-selected={item._id === job?._id} className={item._id === job?._id ? 'on' : ''} onClick={() => setPick(item._id)}>{item.orderNo}</button>)}
          </div>
        )}
      </div>

      {job && (
        <ol className="mk-route-steps">
          <li className="me"><span>📍</span><div><b>You</b><small>{near ? `near ${near.name}` : here ? 'your location now' : 'waiting for GPS'}</small></div></li>
          {stops.map((stop, index) => (
            <li key={stop.kind} className={index === 0 ? 'next' : ''}>
              <span>{stop.kind === 'pickup' ? '🏪' : '🏠'}</span>
              <div>
                <b>{stop.label}: {stop.name}</b>
                <small>{stop.area}{index === 0 && firstLeg ? ` · ${firstLeg.km} km by road · about ${firstLeg.minutes} min` : index === 0 && road ? ` · ${road.km} km · about ${road.minutes} min${road.source === 'estimate' ? ' (estimate)' : ''}` : index === 0 && here ? ` · ${kmText(kmBetween(here, stop))}` : ''}</small>
              </div>
            </li>
          ))}
        </ol>
      )}

      {here ? <RouteMap here={here} stops={stops} roadLine={roadLine} /> : <div className="mk-rider-map-empty">🛰️ Turn on location to see the map</div>}

      {navUrl && <a className="os-btn os-btn-brand os-block mk-rider-nav" href={navUrl} target="_blank" rel="noopener noreferrer">🧭 Start navigation{next ? ` to ${next.name}` : ''}</a>}
      {!job && <p className="mk-hint">When you take a job, the route to the shop and on to the buyer shows here.</p>}
    </section>
  );
}

// the map itself (Leaflet + OpenStreetMap): you (the live blue dot), the stops numbered in order, and a line through them
function RouteMap({ here, stops, roadLine }) {
  const markers = [{ lat: here.lat, lng: here.lng, title: 'You', me: true }, ...stops.map((stop, index) => ({ lat: stop.lat, lng: stop.lng, title: `${stop.label}: ${stop.name}`, label: index + 1 }))];
  const road = roadLine?.source === 'osm' ? roadLine.line : null; // along the actual roads
  const route = road || (stops.length ? [here, ...stops] : null); // until it arrives (or if it can't): a straight dashed line
  return <GMap center={here} zoom={15} markers={markers} route={route} routeStraight={!road} className="mk-rider-map-frame" />;
}
