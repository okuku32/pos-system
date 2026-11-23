// Maps: seller shop locations, "near me" search, delivery pins, directions.
// The maps are Leaflet with OpenStreetMap (LeafletMap.jsx: free, no API key). Addresses (suggestions as you type, the
// address of a pin, a typed address on the map) come from OpenStreetMap through our server (/api/geo). Your location
// is the phone's GPS, read until it's as accurate as it gets, shown with its accuracy circle; pins can always be
// dragged (or the map tapped) to put them exactly right. "Directions" opens the phone's maps app.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { STORE_INFO } from '../shop/storeInfo';
import Basket from './Basket';
import Presence from './Presence';
import SellerContact from './SellerContact';
import { CallButton } from '../shop/Calls';
import LeafletMap from './LeafletMap';

// ---------------------------------------------------------------- helpers
// your location: kept only for this browser session (personal data; not stored after the browser closes)
const HERE_KEY = 'kapu_here';
try {
  localStorage.removeItem(HERE_KEY); // older versions kept it for good
} catch { /* private mode */ }
export function lastHere(maxAgeMs = 6 * 3600 * 1000) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(HERE_KEY) || 'null');
    return parsed && Date.now() - parsed.at < maxAgeMs ? parsed : null;
  } catch {
    return null;
  }
}
// the phone's / computer's location (asks permission the first time). The first GPS reading is often rough (from
// Wi-Fi or mobile towers, hundreds of metres off), so we keep listening for up to `maxMs` and return the most accurate
// fix, as soon as one is within `goodMeters`. Never an old saved reading. → { lat, lng, accuracy (m), at }
export function getHere({ goodMeters = 25, maxMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser can’t share your location'));
    let best = null;
    let watch = null;
    let timer = null;
    const finish = () => {
      if (watch != null) navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      if (!best) return reject(new Error('We couldn’t get your location. Turn on location (GPS) and try again.'));
      try {
        sessionStorage.setItem(HERE_KEY, JSON.stringify(best));
      } catch { /* private mode */ }
      resolve(best);
    };
    watch = navigator.geolocation.watchPosition(
      (position) => {
        const fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Math.round(position.coords.accuracy), at: Date.now() };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (best.accuracy <= goodMeters) finish();
      },
      (error) => {
        if (best) return finish(); // we already have a reading: use it
        if (watch != null) navigator.geolocation.clearWatch(watch);
        clearTimeout(timer);
        reject(new Error(error.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings, then try again.' : 'We couldn’t get your location. Turn on location (GPS) and try again.'));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: Math.max(maxMs, 15000) }
    );
    timer = setTimeout(finish, maxMs);
  });
}
export const inKenya = (lat, lng) => lat >= -5.2 && lat <= 5.5 && lng >= 33.4 && lng <= 42.4;
export const directionsTo = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const openInMaps = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const embedSrc = (lat, lng, zoom = 16) => {
  const span = 0.01 * 2 ** (15 - zoom);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - span},${lat - span / 2},${lng + span},${lat + span / 2}&layer=mapnik&marker=${lat},${lng}`;
};
export const kmText = (km) => (km == null ? '' : km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`);
function kmBetween(location, currentLocation) {
  const result = (date) => (date * Math.PI) / 180;
  const height = Math.sin(result(currentLocation.lat - location.lat) / 2) ** 2 + Math.cos(result(location.lat)) * Math.cos(result(currentLocation.lat)) * Math.sin(result(currentLocation.lng - location.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(height));
}
export const distanceFromMe = (shop) => {
  const lastHereResult = lastHere();
  return lastHereResult && shop ? kmBetween(lastHereResult, shop) : null;
};

// ---------------------------------------------------------------- maps are always on (Leaflet + OpenStreetMap)
// kept for the pages that ask "can we show an interactive map?": yes, always
export function useMaps() {
  return true;
}

// the address of a spot (a GPS fix, a dragged pin): { address, street, area, county } or null
async function reverseGeocode(group, lat, lng) {
  try {
    const { data } = await api.get('/geo/reverse', { params: { lat: lat.toFixed(6), lng: lng.toFixed(6) } });
    return data?.address ? { ...data, placeId: '' } : null;
  } catch {
    return null;
  }
}

// a place search box (our places + OpenStreetMap). Calls onPlace({ lat, lng, name, address, county, area })
export function PlaceSearch({ onPlace, placeholder = 'Search for a place in Kenya' }) {
  const [text, setText] = useState('');
  return (
    <div className="mk-place-search">
      <AddressInput value={text} onChange={setText} placeholder={placeholder} ariaLabel={placeholder} autoComplete="off"
        onPlace={(place) => onPlace({ lat: place.lat, lng: place.lng, name: place.name, address: place.address, placeId: '', county: place.county || '', area: place.area || '' })} />
    </div>
  );
}

// 🔎 An address field with suggestions as you type: pick one and we get the exact spot (and its street, area, county).
//   through our server (/api/geo/autocomplete): our own pickup points and markets first, then OpenStreetMap's places
// Kenya only, nearest first (biased to where the person is).
// onChange(text) as they type · onPlace({ lat, lng, name, address, text, placeId, county, area, street }) when they pick one
const newSession = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
export function AddressInput({ value, onChange, onPlace, placeholder, required, minLength, maxLength = 200, autoComplete = 'street-address', near, id, ariaLabel }) {
  const [list, setList] = useState([]); // [{ key, main, secondary, distanceMeters, raw? (browser) | placeId / lat,lng (server) }]
  const [source, setSource] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(''); // the text of the last pick: don't search it again
  const session = useRef(newSession());
  const justPicked = useRef(false); // the page may tidy the picked text (e.g. just the area): that's a pick too, not a search
  const box = useRef(null);
  const cb = useRef({ onChange, onPlace });
  cb.current = { onChange, onPlace };
  const listId = useRef(`mk-addr-${Math.random().toString(36).slice(2, 8)}`).current;

  // suggestions as they type (debounced)
  useEffect(() => {
    const text = (value || '').trim();
    if (justPicked.current) {
      justPicked.current = false;
      setPicked(value || '');
      setList([]);
      return undefined;
    }
    if (text.length < 3 || text === (picked || '').trim()) {
      setList([]);
      return undefined;
    }
    // only while the person is typing in this box: text filled in by the app (an address from the GPS or the pin)
    // doesn't open suggestions over the map
    if (box.current && !box.current.contains(document.activeElement)) {
      setList([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const center = near || lastHere(6 * 3600000);
      try {
        const response = await api.get('/geo/autocomplete', { params: { q: text, session: session.current, ...(center ? { lat: center.lat, lng: center.lng } : {}) } });
          if (!live) return;
          setList((response.data.suggestions || []).map((item, index) => ({ ...item, key: item.placeId || `${item.main}-${index}` })));
          setSource(response.data.source);
        setActive(-1);
        setOpen(true);
      } catch {
        if (live) setList([]);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value, picked, near]);

  useEffect(() => {
    const close = (event) => box.current && !box.current.contains(event.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, []);

  const done = (place) => {
    if (!inKenya(place.lat, place.lng)) return toast.error('Please pick a place in Kenya');
    setPicked(place.text);
    justPicked.current = true;
    cb.current.onChange?.(place.text);
    cb.current.onPlace?.(place);
    return undefined;
  };
  const pick = async (item) => {
    setOpen(false);
    setBusy(true);
    try {
      if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
        done({ lat: item.lat, lng: item.lng, name: item.main, address: item.secondary || '', text: item.text || item.main, placeId: '', county: item.county || '', area: item.area || '', street: '' }); // one of our own places
      } else {
        const response = await api.get(`/geo/place/${encodeURIComponent(item.placeId)}`, { params: { session: session.current } });
        session.current = newSession(); // the session ends with the pick
        done(response.data);
      }
    } catch (error) {
      toast.error(error?.response ? errMsg(error) : 'That place couldn’t be loaded. Try another one.');
    } finally {
      setBusy(false);
    }
  };
  const onKey = (event) => {
    if (!open || !list.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % list.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index <= 0 ? list.length - 1 : index - 1)); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(list[active]); }
    else if (event.key === 'Escape') setOpen(false);
  };
  const showList = open && list.length > 0;
  return (
    <div className={`mk-addr ${busy ? 'busy' : ''} ${picked && picked === value ? 'found' : ''}`} ref={box}>
      <input
        id={id} value={value} onChange={(event) => { justPicked.current = false; setPicked(''); cb.current.onChange?.(event.target.value); }} onKeyDown={onKey} onFocus={() => list.length && setOpen(true)}
        required={required} minLength={minLength} maxLength={maxLength} placeholder={placeholder} autoComplete={showList || list.length ? 'off' : autoComplete} aria-label={ariaLabel}
        role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
      />
      {busy && <span className="mk-addr-spin" aria-hidden="true" />}
      {picked && picked === value && !busy && <span className="mk-addr-ok" title="Found on the map">✓ On the map</span>}
      {showList && (
        <ul className="mk-addr-list" id={listId} role="listbox">
          {list.map((item, index) => (
            <li key={item.key} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? 'on' : ''} onMouseDown={(event) => { event.preventDefault(); pick(item); }} onMouseEnter={() => setActive(index)}>
              <span aria-hidden="true">{source === 'local' ? '🏷️' : '📍'}</span>
              <span><b>{item.main}</b><small>{item.secondary || ''}</small></span>
              {item.distanceMeters != null && <em>{item.distanceMeters < 1000 ? `${Math.round(item.distanceMeters / 50) * 50} m` : `${(item.distanceMeters / 1000).toFixed(item.distanceMeters < 10000 ? 1 : 0)} km`}</em>}
            </li>
          ))}
          {source === 'osm' && <li className="mk-addr-google" aria-hidden="true">© OpenStreetMap contributors</li>}
        </ul>
      )}
    </div>
  );
}

// an interactive map (Leaflet + OpenStreetMap): markers [{ id, lat, lng, title, me, draggable, label }]
export function GMap({ center, zoom = 14, markers = [], onDrag, onPick, className = '', accuracy, route, routeStraight }) {
  return <LeafletMap center={center} zoom={zoom} markers={markers} onDrag={onDrag} onPick={onPick} accuracy={accuracy} route={route} routeStraight={routeStraight} className={`mk-gmap ${className}`} />;
}

// a pin on a map; draggable: drag it (or tap the map) to move it · accuracy: the GPS accuracy circle (metres)
export function PinMap({ lat, lng, title, draggable, onDrag, accuracy }) {
  return <LeafletMap center={{ lat, lng }} zoom={17} markers={[{ lat, lng, title, draggable }]} onDrag={onDrag} accuracy={accuracy ? { lat, lng, meters: accuracy } : null} className="mk-pinmap" ariaLabel={title || 'Map'} />;
}

// a typed address → a place on the map (OpenStreetMap, through our server): { lat, lng, address, area, county } or null
export async function geocodeText(group, text) {
  try {
    const { data } = await api.get('/geo/search', { params: { q: text } });
    return data && inKenya(data.lat, data.lng) ? { ...data, placeId: '' } : null;
  } catch {
    return null;
  }
}

// The buyer's delivery location at checkout: address search, "use my current location" (live GPS that keeps improving
// for a while, shown with its accuracy circle), a pin you can drag or move by tapping the map, and the typed address
// placed on the map automatically. Addresses come from OpenStreetMap through our server.
// onPin({ lat, lng, accuracy, at, source: 'gps' | 'search' | 'pin' | 'typed', placeId }) · onAddress(text, source) · onCounty(county)
export function AddressPin({ here, onPin, address, onAddress, onCounty, fieldSearch = false, title = '📍 Delivery location' }) {
  const maps = useMaps();
  const data = useCategories();
  const counties = data?.counties || [];
  const [label, setLabel] = useState('');
  const [live, setLive] = useState(false);
  const watchId = useRef(null);
  const stopTimer = useRef(null);
  const cbs = useRef({});
  cbs.current = { onPin, onAddress, onCounty, here };
  const stopLive = () => {
    if (watchId.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    clearTimeout(stopTimer.current);
    setLive(false);
  };
  useEffect(() => stopLive, []);
  const named = async (lat, lng, source) => {
    if (!maps) return;
    const reverseGeocodeResult = await reverseGeocode(maps, lat, lng);
    if (!reverseGeocodeResult) return;
    setLabel(reverseGeocodeResult.address);
    cbs.current.onAddress?.(reverseGeocodeResult.address, source);
    if (reverseGeocodeResult.county) cbs.current.onCounty?.(reverseGeocodeResult.county);
  };
  const startLive = () => {
    if (!navigator.geolocation) return toast.error('This browser can’t share your location');
    stopLive();
    setLive(true);
    let best = null;
    let first = true;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Math.round(position.coords.accuracy), at: Date.now(), source: 'gps' };
        if (!inKenya(location.lat, location.lng)) {
          toast.error('Your location looks like it’s outside Kenya');
          return stopLive();
        }
        if (best && location.accuracy >= best.accuracy) return; // only better fixes
        best = location;
        try {
          sessionStorage.setItem(HERE_KEY, JSON.stringify(location));
        } catch { /* private mode */ }
        cbs.current.onPin(location);
        if (first) {
          first = false;
          named(location.lat, location.lng, 'gps');
        }
        if (location.accuracy <= 15) stopLive(); // good enough
      },
      (position) => {
        toast.error(position.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings, then try again.' : 'We couldn’t get your location. Turn on location (GPS) and try again.');
        stopLive();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    stopTimer.current = setTimeout(stopLive, 45000); // keeps improving for up to 45 seconds
  };
  const onDrag = (lat, lng) => {
    stopLive();
    cbs.current.onPin({ lat, lng, at: Date.now(), source: 'pin' });
    setLabel('');
    named(lat, lng, 'pin');
  };
  // a typed address goes on the map by itself (OpenStreetMap), unless the pin came from GPS / search / dragging
  useEffect(() => {
    const position = cbs.current.here;
    if (!maps || !address || address.trim().length < 6 || (position?.source && position.source !== 'typed')) return undefined;
    const timer = setTimeout(async () => {
      const text = await geocodeText(maps, address);
      if (!text) return;
      cbs.current.onPin({ lat: text.lat, lng: text.lng, at: Date.now(), source: 'typed', placeId: text.placeId });
      setLabel(text.address);
      if (text.county) cbs.current.onCounty?.(text.county);
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, address]);
  const how = { gps: live ? '📡 Live location' : '📍 Your location', search: '🔎 From the map search', pin: '📌 Pin moved', typed: '🏠 From your address' }[here?.source] || '📍 Your location';
  return (
    <div className="mk-addrpin">
      <div className="mk-addrpin-head">
        <b>{title}</b>
        <small>{maps ? (fieldSearch ? 'Type the address below and pick it from the suggestions, or use where you are now. Drag the pin (or tap the map) if it’s not exact.' : 'Search your address, use where you are now, or drag the pin (or tap the map) to the exact spot.') : 'Share where you are now so the rider or courier can find you.'}</small>
      </div>
      <div className="mk-addrpin-tools">
        {maps && !fieldSearch && <PlaceSearch placeholder="Search your estate, building or street" onPlace={(event) => {
          stopLive();
          cbs.current.onPin({ lat: event.lat, lng: event.lng, at: Date.now(), source: 'search', placeId: event.placeId });
          const text = event.name && event.address && !event.address.startsWith(event.name) ? `${event.name}, ${event.address}` : event.address || event.name;
          setLabel(text);
          cbs.current.onAddress?.(text, 'search');
          if (event.county) cbs.current.onCounty?.(event.county);
        }} />}
        <button type="button" className={`os-btn ${live ? 'os-btn-dark' : 'os-btn-ghost'} mk-addrpin-gps`} onClick={live ? stopLive : startLive}>
          {live ? '📡 Finding you… (tap to stop)' : here?.source === 'gps' ? '📍 Update my location' : '📍 Use my current location'}
        </button>
      </div>
      {here ? (
        <>
          <PinMap lat={here.lat} lng={here.lng} title="Delivery location" draggable onDrag={onDrag} accuracy={here.source === 'gps' ? here.accuracy : 0} />
          <small className="mk-addrpin-info" aria-live="polite">
            <b>{how}</b>{label ? `: ${label}` : ''}{here.source === 'gps' && here.accuracy ? ` · accurate to about ${here.accuracy} m${live ? ' (improving…)' : ''}` : ''} · not exact? Drag the pin or tap the right spot on the map
          </small>
        </>
      ) : (
        <small className="os-muted">No location yet. {maps ? 'Search above or use your location.' : 'Tap “Use my current location” (you’ll be asked to allow it).'}</small>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shop kinds & walking delivery
export const SHOP_KINDS = [
  ['shop', '🏪', 'Shop', 'A shop, kiosk or showroom'],
  ['wholesaler', '🏭', 'Wholesaler', 'You sell in bulk (cartons, bales, crates)'],
  ['boutique', '👗', 'Boutique', 'Clothes, shoes, watches & accessories'],
  ['mama-mboga', '🥬', 'Mama mboga', 'Vegetables, fruit, eggs & fresh food'],
  ['samaki', '🐟', 'Mama samaki', 'Fish: fried & fresh ngege, mbuta, omena, seafood'],
  ['market-stall', '🧺', 'Market stall', 'Your stall is inside a market'],
  ['chemist', '💊', 'Chemist', 'Licensed pharmacy (we check your licence)'],
  ['electronics', '📱', 'Electronics shop', 'Phones, TVs, laptops & accessories'],
  ['spares', '🔧', 'Motor & spares dealer', 'Cars, bodas & spare parts'],
  ['baby-shop', '🧸', 'Baby shop', 'Baby gear, diapers, toys & kids’ clothes'],
  ['grocery', '🌾', 'Cereals & groceries', 'Rice, beans, flour, oil, sugar & soap'],
  ['importer', '🌍', 'Importer', 'Ex-Japan, ex-UK, Dubai & China goods'],
];
const WEAR_NAMES = { men: 'Men’s wear', women: 'Women’s wear', kids: 'Kids’ wear' };

// what walking delivery costs for an order
export function walkPrice(width, units = 1, subtotal = 0) {
  if (!width) return null;
  if (width.afterSale) return 0;
  if (width.freeOver && subtotal >= width.freeOver) return 0;
  let fee = (width.fee || 0) + (width.perItem || 0) * Math.max(0, units - 1);
  if (width.maxFee) fee = Math.min(fee, width.maxFee);
  return fee;
}
const ksh = (amount) => `KSh ${Number(amount).toLocaleString('en-KE')}`;
// "KSh 50, +KSh 20 per extra item (max KSh 150) · free over KSh 3,000"
export function walkSummary(width) {
  if (!width) return '';
  if (width.afterSale) return 'Free: after-sale service';
  if (!width.fee && !width.perItem) return 'Free';
  const parts = [`${width.fee ? ksh(width.fee) : 'Free'} for one item`];
  if (width.perItem) parts.push(`+${ksh(width.perItem)} per extra item${width.maxFee ? ` (max ${ksh(width.maxFee)})` : ''}`);
  if (width.freeOver) parts.push(`free on orders over ${ksh(width.freeOver)}`);
  return parts.join(', ');
}
const walkMinutes = (km) => Math.max(3, Math.ceil(((km * 1.3) / 4.5) * 60));

// "🚶 Walks orders to you: KSh 50 · 0.4 km, about 7 min"
export function WalkLine({ walk, km }) {
  if (!walk) return null;
  const close = km != null && km <= walk.maxKm;
  const price = walkPrice(walk);
  return (
    <span className={`mk-walk ${close ? 'close' : ''}`}>
      🚶 {close ? <><b>Can walk your order to you</b> ({walk.afterSale ? 'free, after-sale service' : price ? `from ${ksh(price)}` : 'free'}, about {walkMinutes(km)} min)</> : <>Walking delivery within {walk.maxKm} km{walk.afterSale ? ': free (after-sale service)' : price ? ` from ${ksh(price)}` : ': free'}</>}
    </span>
  );
}

// little labels: 👗 Boutique (Women's wear) · 🧺 Gikomba Market, stall 18
// only: on a "near me" page, just the badge for that kind of shop (a spares page doesn't say "🌾 Cereals & groceries")
export function ShopBadges({ shop, only }) {
  if (!shop) return null;
  const kinds = (shop.kinds || []).filter((kind) => kind !== 'shop' && kind !== 'market-stall' && (kind !== 'chemist' || shop.licensedChemist) && (!only || kind === only));
  if (!kinds.length && !shop.market) return null;
  return (
    <span className="mk-shop-badges">
      {shop.licensedChemist && <span className="mk-shop-badge k-licensed" title="Pharmacy licence checked by our team">✔ Licensed chemist</span>}
      {kinds.map((kind) => {
        const kd = SHOP_KINDS.find((shopKind) => shopKind[0] === kind);
        if (kind === 'chemist') return null;
        return <span key={kind} className={`mk-shop-badge k-${kind}`}>{kd[1]} {kd[2]}{kind === 'boutique' && shop.wear?.length ? `: ${shop.wear.map((item) => WEAR_NAMES[item]).join(', ')}` : ''}</span>;
      })}
      {shop.market && <Link to={`/markets/${shop.market.slug}`} className="mk-shop-badge k-market">🧺 {shop.market.name}{shop.stall ? `, ${shop.stall}` : ''}</Link>}
    </span>
  );
}

// seller's settings: what kind of shop, which market, walking delivery
function ShopKindSettings({ f: location, setF, counties }) {
  const [markets, setMarkets] = useState(null);
  const [adding, setAdding] = useState(null); // { name, kind }
  const inMarket = location.kinds.includes('mama-mboga') || location.kinds.includes('market-stall');
  const pinKey = location.lat != null ? `${location.lat.toFixed(4)},${location.lng.toFixed(4)}` : '';
  useEffect(() => {
    if (!inMarket || !pinKey) return;
    let live = true;
    api.get('/market/markets', { params: { near: pinKey, km: 5 } }).then((response) => live && setMarkets(response.data.markets)).catch(() => live && setMarkets([]));
    return () => {
      live = false;
    };
  }, [inMarket, pinKey]);
  const toggle = (key, entryKey) => setF((previous) => ({ ...previous, [key]: previous[key].includes(entryKey) ? previous[key].filter((item) => item !== entryKey) : [...previous[key], entryKey], ...(key === 'kinds' && entryKey === 'chemist' && !previous.hours ? { hours: { always: false, days: defaultWeek() } } : {}) }));
  const suggest = async () => {
    try {
      const response = await api.post('/market/markets', { name: adding.name, kind: adding.kind, county: location.county, area: location.area, lat: location.lat, lng: location.lng });
      setMarkets((previousMarkets) => [response.data.market, ...(previousMarkets || [])]);
      setF((previous) => ({ ...previous, market: response.data.market._id }));
      setAdding(null);
      toast.success(response.data.message, { duration: 6000 });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <div className="mk-shopkind">
      <h3>What do you run?</h3>
      <div className="mk-kind-grid">
        {SHOP_KINDS.map(([key, icon, name, hint]) => (
          <label key={key} className={`mk-kind ${location.kinds.includes(key) ? 'on' : ''}`}>
            <input type="checkbox" checked={location.kinds.includes(key)} onChange={() => toggle('kinds', key)} />
            <span className="mk-kind-icon">{icon}</span>
            <b>{name}</b>
            <small>{hint}</small>
          </label>
        ))}
      </div>
      {location.kinds.includes('boutique') && (
        <fieldset className="mk-kind-wear">
          <legend>Your boutique sells *</legend>
          {Object.entries(WEAR_NAMES).map(([key, value]) => (
            <label key={key} className="mk-check"><input type="checkbox" checked={location.wear.includes(key)} onChange={() => toggle('wear', key)} /> {value}</label>
          ))}
        </fieldset>
      )}
      {inMarket && (
        <div className="mk-kind-market">
          <label className="os-field">
            <span>Which market are you in?</span>
            <select value={location.market} onChange={(event) => (event.target.value === '+' ? setAdding({ name: '', kind: location.kinds.includes('mama-mboga') ? 'fresh-produce' : 'mixed' }) : setF((previous) => ({ ...previous, market: event.target.value })))}>
              <option value="">{markets === null ? 'Loading markets near your pin…' : markets.length ? 'Choose your market…' : 'No markets within 5 km of your pin'}</option>
              {markets?.map((match) => <option key={match._id} value={match._id}>{match.name}{match.km != null ? ` · ${kmText(match.km).replace(' away', '')}` : ''}{match.approved ? '' : ' (waiting for approval)'}</option>)}
              <option value="+">➕ My market isn’t listed</option>
            </select>
          </label>
          {location.market && <label className="os-field"><span>Stall number or where to find you</span><input value={location.stall} onChange={(event) => setF((previous) => ({ ...previous, stall: event.target.value }))} maxLength={40} placeholder="e.g. Stall 112, vegetable section" /></label>}
          {adding && (
            <div className="mk-kind-add">
              <label className="os-field"><span>Market name</span><input value={adding.name} onChange={(event) => setAdding({ ...adding, name: event.target.value })} maxLength={80} placeholder="e.g. Kiamaiko Market" autoFocus /></label>
              <label className="os-field">
                <span>Mostly sells</span>
                <select value={adding.kind} onChange={(event) => setAdding({ ...adding, kind: event.target.value })}>
                  <option value="fresh-produce">Fresh produce</option><option value="mitumba">Mitumba & clothes</option><option value="mixed">A bit of everything</option><option value="wholesale">Wholesale</option>
                </select>
              </label>
              <small className="os-muted">We use your shop pin as the market’s location{location.county ? ` (${location.county})` : ''}. Our team checks it before others see it.</small>
              <div className="os-row">
                <button type="button" className="os-btn os-btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
                <button type="button" className="os-btn os-btn-brand" onClick={suggest} disabled={adding.name.trim().length < 3 || !counties?.includes(location.county)}>Add market</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WalkSettings({ f: field, setF }) {
  const walk = field.walk;
  const set = (key, value) => setF((previous) => ({ ...previous, walk: { ...previous.walk, [key]: value } }));
  const num = (key) => (event) => set(key, event.target.value === '' ? '' : Number(event.target.value));
  const number = (value) => Number(value) || 0;
  const example = walkPrice({ ...walk, fee: number(walk.fee), perItem: number(walk.perItem), maxFee: number(walk.maxFee), freeOver: 0 }, 3);
  return (
    <div className="mk-walkset">
      <label className="mk-check mk-walkset-on">
        <input type="checkbox" checked={!!walk.enabled} onChange={(event) => set('enabled', event.target.checked)} />
        <span>🚶 <b>Walking delivery</b>: I can send someone on foot to buyers close to my shop</span>
      </label>
      {walk.enabled && (
        <>
          <div className="mk-walkset-row">
            <span>How far will you walk?</span>
            <div className="mk-chips">
              {[0.5, 1, 1.5, 2, 3].map((item) => <button type="button" key={item} className={Number(walk.maxKm) === item ? 'on' : ''} onClick={() => set('maxKm', item)}>{item < 1 ? `${item * 1000} m` : `${item} km`}</button>)}
            </div>
          </div>
          <div className="mk-choice mk-walkset-mode">
            <label className={!walk.afterSale ? 'on' : ''}><input type="radio" checked={!walk.afterSale} onChange={() => set('afterSale', false)} /><span>💵 <b>Charge a delivery fee</b><small>Depends on how many items they buy</small></span></label>
            <label className={walk.afterSale ? 'on' : ''}><input type="radio" checked={!!walk.afterSale} onChange={() => set('afterSale', true)} /><span>🤝 <b>Free: after-sale service</b><small>You deliver free to keep customers coming back</small></span></label>
          </div>
          {!walk.afterSale && (
            <div className="mk-form-grid mk-walkset-fees">
              <label className="os-field"><span>Fee for one item (KSh)</span><input type="number" min={0} max={2000} value={walk.fee} onChange={num('fee')} placeholder="e.g. 50" /></label>
              <label className="os-field"><span>+ each extra item (KSh)</span><input type="number" min={0} max={1000} value={walk.perItem} onChange={num('perItem')} placeholder="e.g. 20" /></label>
              <label className="os-field"><span>Most you’ll charge (KSh) <em>optional</em></span><input type="number" min={0} max={5000} value={walk.maxFee} onChange={num('maxFee')} placeholder="e.g. 150" /></label>
              <label className="os-field"><span>Free for orders over (KSh) <em>optional</em></span><input type="number" min={0} value={walk.freeOver} onChange={num('freeOver')} placeholder="e.g. 3000" /></label>
            </div>
          )}
          <label className="os-field"><span>Note for buyers <em>optional</em></span><input value={walk.note || ''} onChange={(event) => set('note', event.target.value)} maxLength={120} placeholder="e.g. Deliveries 8am to 7pm, not on Sundays" /></label>
          <small className="os-muted mk-walkset-eg">{walk.afterSale ? 'Buyers within your distance see “Free walking delivery: after-sale service” at checkout.' : `Example: 3 items cost ${example ? ksh(example) : 'nothing'} to deliver${number(walk.freeOver) ? `, and orders over ${ksh(number(walk.freeOver))} are free` : ''}.`}</small>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- opening hours (shops & chemists)
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // shown Monday first, stored Sunday first
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const prettyTime = (date) => {
  const [height, match] = String(date || '').split(':').map(Number);
  if (!Number.isFinite(height)) return '';
  if (height === 0 && match === 0) return 'midnight';
  return `${height % 12 || 12}:${String(match).padStart(2, '0')} ${height < 12 ? 'AM' : 'PM'}`;
};
const defaultWeek = () => [{ closed: true, open: '', close: '' }, ...Array.from({ length: 6 }, () => ({ closed: false, open: '08:00', close: '18:00' }))];

// "🟢 Open · closes 9:00 PM" / "🔴 Closed · opens 8:00 AM tomorrow"
export function OpenBadge({ hours, big = false }) {
  const st = hours?.status;
  if (!st) return null;
  return <span className={`mk-open ${st.open ? 'on' : 'off'} ${big ? 'big' : ''}`}><i aria-hidden="true" />{st.label}</span>;
}

// the week's hours, today in bold
export function HoursTable({ hours }) {
  if (!hours) return null;
  if (hours.always) return <p className="mk-hours-always">🕒 Open 24 hours, every day</p>;
  const today = new Date(Date.now() + 3 * 3600000).getUTCDay(); // Kenya time
  return (
    <table className="mk-hours">
      <tbody>
        {WEEK_ORDER.map((item) => (
          <tr key={item} className={item === today ? 'today' : ''}>
            <th>{DAY_NAMES[item]}</th>
            <td>{hours.days[item]?.closed ? 'Closed' : `${prettyTime(hours.days[item]?.open)} – ${prettyTime(hours.days[item]?.close)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// seller: their weekly hours
function HoursSettings({ f: field, setF, required }) {
  const hours = field.hours;
  const on = !!hours;
  const setDay = (date, key, value) => setF((previous) => ({ ...previous, hours: { ...previous.hours, days: previous.hours.days.map((day, index) => (index === date ? { ...day, [key]: value, ...(key === 'closed' && !value && !day.open ? { open: '08:00', close: '18:00' } : {}) } : day)) } }));
  const copyMonday = () => setF((previous) => ({ ...previous, hours: { ...previous.hours, days: previous.hours.days.map((day, index) => (index === 0 || index === 6 ? day : { ...previous.hours.days[1] })) } }));
  return (
    <div className="mk-hoursset" id="opening-hours">
      <label className="mk-check mk-walkset-on">
        <input type="checkbox" checked={on} onChange={(event) => setF((previous) => ({ ...previous, hours: event.target.checked ? { always: false, days: defaultWeek() } : null }))} disabled={required && on} />
        <span>🕒 <b>Opening hours</b>: show buyers when you’re open{required ? ' (needed for chemists)' : ''}</span>
      </label>
      {on && (
        <>
          <div className="mk-choice mk-walkset-mode">
            <label className={!hours.always ? 'on' : ''}><input type="radio" checked={!hours.always} onChange={() => setF((previous) => ({ ...previous, hours: { always: false, days: previous.hours.days?.length === 7 ? previous.hours.days : defaultWeek() } }))} /><span>🕘 <b>Set hours</b><small>Different times on different days</small></span></label>
            <label className={hours.always ? 'on' : ''}><input type="radio" checked={!!hours.always} onChange={() => setF((previous) => ({ ...previous, hours: { ...previous.hours, always: true } }))} /><span>🌙 <b>Open 24 hours</b><small>Every day, day and night</small></span></label>
          </div>
          {!hours.always && (
            <div className="mk-hours-edit">
              {WEEK_ORDER.map((item) => {
                const day = hours.days[item];
                return (
                  <div key={item} className={`mk-hours-row ${day.closed ? 'closed' : ''}`}>
                    <b>{DAY_NAMES[item].slice(0, 3)}</b>
                    {day.closed ? <span className="os-muted">Closed</span> : (
                      <span className="mk-hours-times">
                        <input type="time" value={day.open} onChange={(event) => setDay(item, 'open', event.target.value)} aria-label={`${DAY_NAMES[item]} opens`} />
                        <span>–</span>
                        <input type="time" value={day.close} onChange={(event) => setDay(item, 'close', event.target.value)} aria-label={`${DAY_NAMES[item]} closes`} />
                      </span>
                    )}
                    <label className="mk-hours-closed"><input type="checkbox" checked={!!day.closed} onChange={(event) => setDay(item, 'closed', event.target.checked)} /> Closed</label>
                  </div>
                );
              })}
              <button type="button" className="os-linkbtn" onClick={copyMonday}>Use Monday’s hours for Tuesday to Friday</button>
              <small className="os-muted">Open past midnight? Set the closing time after midnight, e.g. 18:00 – 02:00.</small>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// seller: "closed right now" / "open right now" / back to the usual hours (saves at once)
function OpenNowControl() {
  const { customer, setCustomer } = useShop();
  const hours = customer?.shopLocation?.hours;
  const [busy, setBusy] = useState(false);
  if (!hours) return null;
  const set = async (state, until = '') => {
    setBusy(true);
    try {
      const response = await api.post('/customers/me/open-status', { state, until });
      setCustomer(response.data);
      toast.success(response.data.shopLocation.hours.status.label);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-opennow">
      <div className="mk-opennow-now"><span>Buyers see right now:</span> <OpenBadge hours={hours} big /></div>
      <div className="mk-chips">
        {hours.override ? <button type="button" className="on" onClick={() => set('auto')} disabled={busy}>↩ Back to my usual hours</button> : null}
        <button type="button" onClick={() => set('closed', 'today')} disabled={busy}>🔴 Closed for the rest of today</button>
        <button type="button" onClick={() => set('closed')} disabled={busy}>⛔ Closed until I reopen</button>
        <button type="button" onClick={() => set('open', 'today')} disabled={busy}>🟢 Open now (rest of today)</button>
      </div>
      <small className="os-muted">“Rest of today” switches back to your usual hours at midnight.</small>
    </div>
  );
}

// chemist: send the premises licence for our team to check
function ChemistLicence() {
  const { customer, setCustomer } = useShop();
  const ch = customer?.chemist || { status: 'none' };
  const [values, setValues] = useState({ licenceNo: ch.licenceNo || '', premises: ch.premises || customer?.shopLocation?.name || '', pharmacist: ch.pharmacist || '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const response = await api.post('/customers/me/chemist', values);
      setCustomer(response.data);
      toast.success('Sent! Our team will check your licence and call you.');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  if (ch.status === 'verified') return <div className="mk-chem ok">✔ <b>Licensed chemist, verified by our team.</b> You can post medicines and you show up in “Chemists near me”.</div>;
  if (ch.status === 'pending') return <div className="mk-chem wait">⏳ <b>We’re checking your licence ({ch.licenceNo}).</b> Our team will call you. Until then you don’t show in “Chemists near me” and can’t post medicines.</div>;
  return (
    <div className="mk-chem">
      <b>💊 Verify your chemist</b>
      <p className="os-muted">Only licensed chemists can sell medicines here. Enter your Pharmacy and Poisons Board premises licence; our team checks it and calls you.</p>
      {ch.status === 'rejected' && <p className="mk-err-text">Not verified: {ch.reviewNote}</p>}
      <div className="mk-form-grid">
        <label className="os-field"><span>Premises licence number</span><input value={values.licenceNo} onChange={(event) => setValues({ ...values, licenceNo: event.target.value })} maxLength={40} /></label>
        <label className="os-field"><span>Registered premises name</span><input value={values.premises} onChange={(event) => setValues({ ...values, premises: event.target.value })} maxLength={80} /></label>
        <label className="os-field mk-span-all"><span>Pharmacist / pharm-tech in charge</span><input value={values.pharmacist} onChange={(event) => setValues({ ...values, pharmacist: event.target.value })} maxLength={80} /></label>
      </div>
      <button type="button" className="os-btn os-btn-brand" onClick={send} disabled={busy || values.licenceNo.trim().length < 4 || !customer?.shopLocation}>{busy ? 'Sending…' : 'Send for checking'}</button>
      {!customer?.shopLocation && <small className="os-muted"> Save your shop location first.</small>}
    </div>
  );
}

// ---------------------------------------------------------------- seller's shop on their pages
export function ShopMapCard({ shop, sellerName }) {
  const [km, setKm] = useState(() => distanceFromMe(shop));
  if (!shop) return null;
  const findMe = () => getHere().then(() => setKm(distanceFromMe(shop))).catch((error) => toast.error(error.message));
  return (
    <section className="mk-box mk-shopcard" aria-label="Shop location">
      <div className="mk-shopcard-text">
        <h2>🏪 {shop.name || `${sellerName}’s shop`}</h2>
        <ShopBadges shop={shop} />
        <OpenBadge hours={shop.hours} big />
        <p>📍 {shop.address}{shop.area && !shop.address.includes(shop.area) ? `, ${shop.area}` : ''}{shop.county && !shop.address.includes(shop.county) ? `, ${shop.county}` : ''}</p>
        {shop.walk && <p className="mk-shopcard-walk"><WalkLine walk={shop.walk} km={km} /><small>{walkSummary(shop.walk)}{shop.walk.note ? `. ${shop.walk.note}` : ''}</small></p>}
        <p className="mk-shopcard-km">{km != null ? `🚶 About ${kmText(km)} from you` : <button type="button" className="os-linkbtn" onClick={findMe}>How far is it from me?</button>}</p>
        <div className="mk-shopcard-actions">
          <a className="os-btn os-btn-brand" href={directionsTo(shop.lat, shop.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions</a>
          <a className="os-btn os-btn-ghost" href={openInMaps(shop.lat, shop.lng)} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
        </div>
        {shop.hours && <details className="mk-hours-box" open={!!shop.licensedChemist}><summary>🕒 Opening hours{shop.hours.status?.today ? `: today ${shop.hours.status.today}` : ''}</summary><HoursTable hours={shop.hours} /></details>}
        <small className="os-muted">Location and hours set by the seller. Meet in daylight and check the item before paying.</small>
      </div>
      <PinMap lat={shop.lat} lng={shop.lng} title={shop.name || sellerName} />
    </section>
  );
}

// one line in the seller box of an ad
export function ShopLine({ shop }) {
  if (!shop) return null;
  const km = distanceFromMe(shop);
  return (
    <div className="mk-shopline">
      <span>🏪 {shop.name ? <b>{shop.name}</b> : 'Shop'}: {shop.address}{km != null ? ` · ${kmText(km)}` : ''}</span>
      <a href={directionsTo(shop.lat, shop.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions</a>
      {(shop.market || shop.walk || shop.hours || shop.licensedChemist) && <span className="mk-shopline-more"><ShopBadges shop={shop} /><OpenBadge hours={shop.hours} /><WalkLine walk={shop.walk} km={km} /></span>}
    </div>
  );
}

// ---------------------------------------------------------------- seller sets their shop (My account)
export function ShopLocationEditor() {
  const { customer, setCustomer } = useShop();
  const data = useCategories();
  const maps = useMaps();
  const saved = customer?.shopLocation;
  const blank = {
    name: '', address: '', area: '', county: customer?.county || '', placeId: '', lat: null, lng: null, public: true, kinds: customer?.sellerTypes?.length ? [...customer.sellerTypes] : [], wear: [], market: '', stall: '', hours: null,
    walk: { enabled: false, maxKm: 1, fee: '', perItem: '', maxFee: '', freeOver: '', afterSale: false, note: '' },
  };
  const fromSaved = (currentSaved) => ({ ...blank, ...currentSaved, hours: currentSaved.hours ? { always: !!currentSaved.hours.always, days: currentSaved.hours.always ? [] : currentSaved.hours.days } : null, market: currentSaved.market?._id || '', walk: { ...blank.walk, ...(currentSaved.walk?.enabled === false ? {} : currentSaved.walk ? { ...currentSaved.walk, enabled: true } : {}) } });
  const [location, setLocation] = useState(saved ? fromSaved(saved) : blank);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (customer?.shopLocation) setLocation(fromSaved(customer.shopLocation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.shopLocation]);
  const set = (key) => (event) => setLocation({ ...location, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const hasPin = location.lat != null && location.lng != null;

  // fill the address from the map (OpenStreetMap) when we know where the pin is
  const pinAt = async (lat, lng, extra = {}) => {
    setLocation((previousLocation) => ({ ...previousLocation, lat, lng, ...extra }));
    if (maps && !extra.address) {
      const reverseGeocodeResult = await reverseGeocode(maps, lat, lng);
      if (reverseGeocodeResult) setLocation((previousLocation) => ({ ...previousLocation, address: previousLocation.address && previousLocation.placeId === reverseGeocodeResult.placeId ? previousLocation.address : reverseGeocodeResult.address, placeId: reverseGeocodeResult.placeId, county: reverseGeocodeResult.county || previousLocation.county, area: reverseGeocodeResult.area || previousLocation.area }));
    }
  };
  const useGps = async () => {
    setBusy('gps');
    try {
      const here = await getHere();
      if (!inKenya(here.lat, here.lng)) throw new Error('Your location looks like it’s outside Kenya');
      await pinAt(here.lat, here.lng);
      toast.success(here.accuracy > 200 ? `Pinned (accurate to about ${here.accuracy} m). Drag or paste a link to fine-tune.` : 'Pinned your current location');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };
  const useLink = async (event) => {
    event?.preventDefault();
    if (!link.trim()) return;
    setBusy('link');
    try {
      const response = await api.post('/customers/me/map-link', { url: link });
      await pinAt(response.lat, response.lng, response.name ? { name: location.name || response.name } : {});
      setLink('');
      toast.success('Pinned from your Google Maps link');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      const number = (value) => Number(value) || 0;
      const response = await api.put('/customers/me', { shopLocation: { ...location, walk: { ...location.walk, fee: number(location.walk.fee), perItem: number(location.walk.perItem), maxFee: number(location.walk.maxFee), freeOver: number(location.walk.freeOver) } } });
      setCustomer(response.data);
      toast.success(location.public ? 'Shop location saved. Buyers nearby can now find you 📍' : 'Saved (hidden from buyers)');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!window.confirm('Remove your shop from the map?')) return;
    setBusy('save');
    try {
      const response = await api.put('/customers/me', { shopLocation: null });
      setCustomer(response.data);
      setLocation(blank);
      toast.success('Removed from the map');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="mk-box mk-mt mk-shopedit" id="shop-location">
      <h2>📍 Shop location <small className="os-muted">(for sellers)</small></h2>
      <p className="os-muted">Put your shop or pick-up point on Google Maps so buyers near you can find you and get directions. Your ads in the same county show up in “near me” searches.</p>

      <div className="mk-shopedit-ways">
        <button type="button" className="os-btn os-btn-brand" onClick={useGps} disabled={!!busy}>{busy === 'gps' ? 'Finding you…' : '📍 Use my current location'}</button>
        <span className="os-muted">I’m at my shop now</span>
      </div>
      {maps && <PlaceSearch placeholder="Or search: your shop, building or street" onPlace={(event) => pinAt(event.lat, event.lng, { name: location.name || event.name, address: event.address, placeId: event.placeId, county: event.county || location.county, area: event.area || location.area })} />}
      <form className="mk-shopedit-link" onSubmit={useLink}>
        <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Or paste a Google Maps link (Share → Copy link)" aria-label="Google Maps link" />
        <button className="os-btn os-btn-ghost" disabled={!!busy || !link.trim()}>{busy === 'link' ? 'Reading…' : 'Use link'}</button>
      </form>
      <small className="os-muted mk-shopedit-tip">Tip: in the Google Maps app, find your shop (or long-press to drop a pin), tap <b>Share</b>, copy the link and paste it here. A WhatsApp location link works too.</small>

      {hasPin && (
        <>
          <PinMap lat={location.lat} lng={location.lng} title={location.name || 'Your shop'} draggable onDrag={(lat, lng) => pinAt(lat, lng)} />
          {maps && <small className="os-muted">Drag the pin to the exact door if it’s a little off.</small>}
          <div className="mk-form-grid mk-mt">
            <label className="os-field"><span>Shop name</span><input value={location.name} onChange={set('name')} maxLength={80} placeholder="e.g. Faith Furniture Kahawa" /></label>
            <label className="os-field">
              <span>County *</span>
              <select value={location.county} onChange={set('county')} required>
                <option value="">Choose…</option>
                {data?.counties.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="os-field mk-span-all"><span>Address / nearest landmark *</span><input value={location.address} onChange={set('address')} maxLength={200} placeholder="e.g. Kahawa West, opposite Total petrol station, 1st floor" /></label>
            <label className="os-field"><span>Area / estate</span><input value={location.area} onChange={set('area')} maxLength={60} placeholder="e.g. Kahawa West" /></label>
          </div>
          <ShopKindSettings f={location} setF={setLocation} counties={data?.counties} />
          <HoursSettings f={location} setF={setLocation} required={location.kinds.includes('chemist')} />
          {saved?.hours && <OpenNowControl />}
          {location.kinds.includes('chemist') && <ChemistLicence />}
          <WalkSettings f={location} setF={setLocation} />
          <label className="mk-check mk-mt">
            <input type="checkbox" checked={location.public} onChange={set('public')} />
            Show my shop on the map so buyers nearby can find me
          </label>
          <div className="mk-sell-submit">
            {saved && <button type="button" className="os-btn os-btn-ghost mk-danger" onClick={remove} disabled={!!busy}>Remove</button>}
            <button type="button" className="os-btn os-btn-brand" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save shop location'}</button>
          </div>
        </>
      )}
      {saved && !hasPin && null}
    </section>
  );
}

// ---------------------------------------------------------------- buyers: sellers around me
const RADII = [1, 2, 5, 10, 25, 50, 100]; // "near me" starts within 1 km
// the kinds of "near me" pages
export const NEAR_MODES = {
  all: { path: '/sellers-near-me', tab: '📍 All sellers', title: '📍 Sellers near you', lead: 'Find shops and sellers around you, see how far they are, and get directions on Google Maps.', noun: ['seller', 'sellers'], items: () => '/market/search', itemsText: '🛍️ See items for sale' },
  wholesale: { path: '/wholesalers-near-me', tab: '🏭 Wholesalers', title: '🏭 Wholesalers near you', lead: 'Wholesale shops around you selling cartons, bales and crates at bei ya jumla. See how far they are and get directions on Google Maps.', noun: ['wholesaler', 'wholesalers'], items: () => '/wholesale', itemsText: '🏭 See wholesale deals' },
  boutique: { path: '/boutiques-near-me', tab: '👗 Boutiques', title: '👗 Boutiques near you', lead: 'Boutiques and clothes shops around you: dresses, shirts, suits, shoes, watches and more. Many deliver on foot if you’re close.', noun: ['boutique', 'boutiques'], items: (wear) => (wear === 'men' ? '/market/clothes-shoes/mens-clothes' : wear === 'women' ? '/market/clothes-shoes/womens-clothes' : '/market/clothes-shoes'), itemsText: '👗 See clothes' },
  chemist: { path: '/chemists-near-me', tab: '💊 Chemists', title: '💊 Chemists near you', lead: 'Licensed chemists only: our team checks every pharmacy licence. See who’s open now, their opening and closing times, medicines and directions.', noun: ['chemist', 'chemists'], items: () => '/market/pharmacy', itemsText: '💊 See medicines & health products', openFirst: true },
  electronics: { path: '/electronics-shops-near-me', tab: '📱 Electronics', title: '📱 Electronics shops near you', lead: 'Phone, TV, laptop and accessories shops around you, with distance and directions.', noun: ['electronics shop', 'electronics shops'], items: () => '/market/electronics', itemsText: '📱 See electronics' },
  spares: { path: '/spare-parts-shops-near-me', tab: '🔧 Motor & spares', title: '🔧 Motor & spare parts dealers near you', lead: 'Car dealers and car, boda boda, truck and machinery spare parts shops around you. Only motor and spares sellers are listed.', noun: ['spare parts shop', 'spare parts shops'], items: () => '/market/spare-parts', itemsText: '🔧 See spare parts' },
  baby: { path: '/baby-shops-near-me', tab: '🧸 Baby shops', title: '🧸 Baby shops near you', lead: 'Strollers, cots, diapers, feeding, toys and kids’ clothes from shops around you.', noun: ['baby shop', 'baby shops'], items: () => '/market/baby-kids', itemsText: '🧸 See baby items' },
  importer: { path: '/importers-near-me', tab: '🌍 Importers', title: '🌍 Importers near you', lead: 'Shops near you selling imported goods: ex-Japan and ex-UK spares, Dubai and China electronics, ex-UK household items and more.', noun: ['importer', 'importers'], items: () => '/imports', itemsText: '🌍 See imported items' },
  grocery: { path: '/groceries-near-me', tab: '🌾 Groceries', title: '🌾 Cereals & groceries near you', lead: 'Rice, beans, flour, cooking oil, sugar, drinks and soap from shops and wholesalers around you.', noun: ['grocery shop', 'grocery shops'], items: () => '/market/cooking-products', itemsText: '🌾 See groceries' },
  'mama-mboga': { path: '/mama-mboga-near-me', tab: '🥬 Mama mboga', title: '🥬 Mama mbogas & markets near you', lead: 'Fresh sukuma, tomatoes, fruit and eggs from mama mbogas and market traders around you. Some walk your order to your door.', noun: ['mama mboga', 'mama mbogas'], items: () => '/market/fresh-produce', itemsText: '🥬 See fresh produce' },
};
// the shop kind that matches each "near me" page
const PAGE_KIND = { wholesale: 'wholesaler', boutique: 'boutique', chemist: 'chemist', electronics: 'electronics', spares: 'spares', baby: 'baby-shop', importer: 'importer', grocery: 'grocery', 'mama-mboga': 'mama-mboga' };
const WEARS = [['', 'All boutiques'], ['men', '👔 Men’s wear'], ['women', '👗 Women’s wear']];

export function NearbySellers({ mode: modeProp, wholesale = false, wear = '' }) {
  const mode = modeProp || (wholesale ? 'wholesale' : 'all');
  const nearMode = NEAR_MODES[mode];
  const maps = useMaps();
  const navigate = useNavigate();
  const [here, setHere] = useState(() => lastHere());
  const [km, setKm] = useState(1); // start close (1 km); widened step by step when nobody is that close
  const autoWiden = useRef(true); // until the buyer picks a distance themselves
  const [widened, setWidened] = useState(false);
  const chooseKm = (value) => {
    autoWiden.current = false;
    setWidened(false);
    setKm(value);
  };
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');
  const [res, setRes] = useState(null);
  const [markets, setMarkets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);
  const [placeName, setPlaceName] = useState('');
  const [openNow, setOpenNow] = useState(false);
  const [basketOf, setBasketOf] = useState(null); // seller whose items are open
  const [sheet, setSheet] = useState(false); // the results pop up after choosing a distance / location
  const closeBtn = useRef(null);
  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (error) => error.key === 'Escape' && setSheet(false);
    window.addEventListener('keydown', onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // the page behind doesn't scroll
    setTimeout(() => closeBtn.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = before;
    };
  }, [sheet]);
  const pickKm = (result) => {
    chooseKm(result);
    setSheet(true);
  };
  const canBasket = true; // every near-me page: see the seller's items and add them to the cart
  // wholesalers by trade (cereals, electronics…), importers by what they import (?trade=…)
  const [params, setParams] = useSearchParams();
  const tradeList = mode === 'wholesale' ? STORE_INFO.trades?.wholesale || [] : mode === 'importer' ? STORE_INFO.trades?.importer || [] : [];
  const trade = tradeList.some((currentTradeItem) => currentTradeItem.key === params.get('trade')) ? params.get('trade') : '';
  const tradeItem = tradeList.find((currentTradeItem) => currentTradeItem.key === trade);
  const pickTrade = (key) => {
    const next = new URLSearchParams(params);
    if (key) next.set('trade', key);
    else next.delete('trade');
    setParams(next, { replace: true });
    setBasketOf(null);
  };
  const tradeCount = (key) => res?.trades?.find((value) => value.key === key)?.sellers;
  // the chosen trade tab stays in view (they scroll sideways on phones)
  useEffect(() => {
    document.querySelectorAll('.mk-near-trades').forEach((row) => {
      const on = row.querySelector('.on');
      if (on) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
    });
  }, [trade, sheet, res]);
  const tradeChips = tradeList.length > 0 && (
    <div className="mk-chips mk-near-trades" role="group" aria-label={mode === 'wholesale' ? 'What they sell' : 'What they import'}>
      <button type="button" className={!trade ? 'on' : ''} aria-pressed={!trade} onClick={() => pickTrade('')}>{mode === 'wholesale' ? '🏭 All wholesalers' : '🌍 All importers'}</button>
      {tradeList.map((currentTradeItem) => (
        <button key={currentTradeItem.key} type="button" className={trade === currentTradeItem.key ? 'on' : ''} aria-pressed={trade === currentTradeItem.key} title={currentTradeItem.about} onClick={() => pickTrade(currentTradeItem.key)}>
          {currentTradeItem.icon} {currentTradeItem.name}{tradeCount(currentTradeItem.key) != null ? <small> {tradeCount(currentTradeItem.key)}</small> : null}
        </button>
      ))}
    </div>
  );
  const title = tradeItem ? `${tradeItem.icon} ${tradeItem.label} near you` : mode === 'boutique' && wear ? (wear === 'men' ? '👔 Men’s boutiques near you' : '👗 Women’s boutiques near you') : nearMode.title;
  useSeo({ title: title.replace(/^\W+/, ''), description: tradeItem ? `${tradeItem.label} near you in Kenya: ${tradeItem.about}. See how far they are, their prices and directions.` : nearMode.lead, path: mode === 'boutique' && wear ? `${nearMode.path}/${wear}` : `${nearMode.path}${trade ? `?trade=${trade}` : ''}` });

  useEffect(() => {
    if (!here) return;
    let live = true;
    const near = `${here.lat.toFixed(5)},${here.lng.toFixed(5)}`;
    setRes((previousRes) => (previousRes ? { ...previousRes, loading: true } : null));
    api
      .get('/market/sellers-near', { params: { near, km, q: text || undefined, type: mode === 'all' ? undefined : mode, wear: wear || undefined, trade: trade || undefined, openNow: openNow ? '1' : undefined } })
      .then((response) => live && setRes(response.data))
      .catch((error) => live && toast.error(errMsg(error)));
    if (mode === 'mama-mboga') api.get('/market/markets', { params: { near, km: Math.max(km, 10) } }).then((response) => live && setMarkets(response.data.markets)).catch(() => {});
    return () => {
      live = false;
    };
  }, [here, km, text, mode, wear, openNow, trade]);

  const locate = async () => {
    setBusy(true);
    try {
      const position = await getHere();
      if (!inKenya(position.lat, position.lng)) throw new Error('Your location looks like it’s outside Kenya. Search for a place instead.');
      setPlaceName('');
      setHere(position);
      setSheet(true);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  // nobody within 1 km: look a little further by itself (2, 5, then 10 km), once per location
  useEffect(() => {
    autoWiden.current = true;
  }, [here, trade, text, wear]); // a new place, trade or search: start close again
  useEffect(() => {
    if (!res || res.loading || !autoWiden.current) return;
    if (!(res.sellers || []).length && km < 10 && !text && !openNow) {
      setWidened(true);
      setKm(RADII[RADII.indexOf(km) + 1]);
    } else autoWiden.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  const sellers = res?.sellers || [];
  const near = here ? `${here.lat.toFixed(5)},${here.lng.toFixed(5)}` : '';
  const markers = here ? [{ lat: here.lat, lng: here.lng, title: 'You', me: true }, ...sellers.filter((seller) => seller.shop).map((item, index) => ({ id: item._id, lat: item.shop.lat, lng: item.shop.lng, title: item.shop.name || item.name, label: String(index + 1) }))] : [];
  const noun = tradeItem ? (sellers.length === 1 ? tradeItem.label.replace(/s$/, '') : tradeItem.label).toLowerCase() : nearMode.noun[sellers.length === 1 ? 0 : 1];
  // on a phone the tabs scroll sideways: show the chosen one
  const tabs = useRef(null);
  useEffect(() => {
    const el = tabs.current?.querySelector('.on');
    if (el) tabs.current.scrollLeft = el.offsetLeft - (tabs.current.clientWidth - el.offsetWidth) / 2;
  }, [mode]);

  const list = (
    <div className="mk-near-list" aria-live="polite">
      <p className="mk-count">{res ? `${sellers.length} ${noun}${openNow ? ' open now' : ''} within ${km} km${text ? ` selling “${text}”` : ''}${widened && km > 1 && sellers.length ? ' (nobody within 1 km yet, so we looked a little further)' : ''}` : 'Looking around you…'}</p>
      {sellers.map((seller, index) => (
        <div key={seller._id} className={`mk-near-item ${basketOf === seller._id ? 'open' : ''}`}>
        <article className={`mk-near-card ${picked === seller._id ? 'on' : ''}`} id={`seller-${seller._id}`}>
          <span className="mk-near-num">{index + 1}</span>
          <div className="mk-near-body">
            <div className="mk-near-head">
              <Link to={`/market/seller/${seller._id}`} className="mk-near-name"><b>{seller.shop?.name || seller.name}</b> {seller.boosted && <span className="mk-featured-biz" title="This business is boosted">⭐ Featured business</span>} {seller.verified && <span className="mk-verified-tick" title="Verified seller">✔</span>} <Presence id={seller._id} /></Link>
              <span className="mk-near-reach">
                <CallButton person={{ _id: seller._id, name: seller.name }} compact />
                <SellerContact sellerId={seller._id} available={seller.contact !== false} compact />
              </span>
            </div>
            <small>{seller.shop?.name ? `${seller.name} · ` : ''}{seller.rating?.count ? `★ ${seller.rating.avg.toFixed(1)} (${seller.rating.count}) · ` : ''}{seller.ads} {mode === 'wholesale' && seller.wholesale > 0 ? 'wholesale ' : ''}ad{seller.ads === 1 ? '' : 's'}</small>
            <ShopBadges shop={seller.shop} only={PAGE_KIND[mode]} />
            {/* open now / closed: shown in the seller badge next to the name */}
            {mode !== 'wholesale' && seller.wholesale > 0 && <span className="mk-near-bulk">🏭 Wholesale prices on {seller.wholesale} item{seller.wholesale === 1 ? '' : 's'}</span>}
            <span className="mk-near-addr">📍 {seller.shop?.address}</span>
            <WalkLine walk={seller.shop?.walk} km={seller.km} />
            {!trade && seller.trades?.length > 0 && <span className="mk-near-tradetags">{seller.trades.map((currentTrade) => tradeList.find((currentTradeItem) => currentTradeItem.key === currentTrade)).filter(Boolean).map((item) => <span key={item.key} className={trade === item.key ? 'on' : ''}>{item.icon} {item.name}</span>)}</span>}
            <span className="mk-near-cats">{seller.categories.map((category) => <span key={category.slug}>{category.icon} {category.name}</span>)}</span>
          </div>
          <div className="mk-near-side">
            <b className="mk-near-km">{kmText(seller.km)}</b>
            <a className="os-btn os-btn-ghost" href={directionsTo(seller.shop.lat, seller.shop.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions</a>
            {canBasket && (
              <button type="button" className={`os-btn ${basketOf === seller._id ? 'os-btn-dark' : 'os-btn-brand'} mk-basket-toggle ${basketOf === seller._id ? 'open' : ''}`} aria-expanded={basketOf === seller._id} onClick={() => setBasketOf(basketOf === seller._id ? null : seller._id)}>{basketOf === seller._id ? 'Close items' : mode === 'mama-mboga' ? '🧺 See items & order' : '🛒 See items & add to cart'}</button>
            )}
            <Link className="mk-near-shoplink" to={`/market/seller/${seller._id}`}>{mode === 'wholesale' ? 'All prices' : 'View shop'} →</Link>
          </div>
        </article>
        {basketOf === seller._id && <Basket sellerId={seller._id} here={here} type={mode || ''} wear={mode === 'boutique' ? wear || '' : ''} trade={trade} />}
        </div>
      ))}
      {res && !sellers.length && (
        <div className="mk-empty">
          <p>{openNow ? `No ${tradeItem ? tradeItem.label.toLowerCase() : nearMode.noun[1]} within ${km} km are open right now.` : `No ${tradeItem ? tradeItem.label.toLowerCase() : nearMode.noun[1]} have pinned a shop within ${km} km yet.`}</p>
          {trade && <button type="button" className="os-btn os-btn-ghost" onClick={() => pickTrade('')}>Show all {mode === 'wholesale' ? 'wholesalers' : 'importers'}</button>}
          {openNow && <button type="button" className="os-btn os-btn-ghost" onClick={() => setOpenNow(false)}>Show closed ones too</button>}
          {km < 100 && <button type="button" className="os-btn os-btn-ghost" onClick={() => chooseKm(RADII[RADII.indexOf(km) + 1])}>Look further ({RADII[RADII.indexOf(km) + 1]} km)</button>}
        </div>
      )}
    </div>
  );

  return (
    <div className="mk">
      {sheet && here && createPortal(
        <div className="os os-portal">
          <div className="mk mk-nearsheet" role="dialog" aria-modal="true" aria-label={`${nearMode.noun[1]} near you`}>
            <button type="button" className="mk-nearsheet-backdrop" aria-label="Close" tabIndex={-1} onClick={() => setSheet(false)} />
            <section className="mk-nearsheet-panel">
              <header className="mk-nearsheet-head">
                <div>
                  <b>{title}</b>
                  <small>{res ? `${sellers.length} ${noun}${openNow ? ' open now' : ''} within ${km} km${placeName ? ` of ${placeName}` : ''}` : 'Looking around you…'}</small>
                </div>
                <button type="button" ref={closeBtn} className="mk-nearsheet-close" onClick={() => setSheet(false)}>✕ Close</button>
              </header>
              <div className="mk-chips mk-nearsheet-km" role="group" aria-label="Distance">
                {RADII.map((item) => <button type="button" key={item} className={km === item ? 'on' : ''} onClick={() => chooseKm(item)}>{item} km</button>)}
                <button type="button" className={`mk-opennow-chip ${openNow ? 'on' : ''}`} aria-pressed={openNow} onClick={() => setOpenNow(!openNow)}>🟢 Open now</button>
              </div>
              {tradeChips && <div className="mk-nearsheet-trades">{tradeChips}</div>}
              <div className="mk-nearsheet-body">{list}</div>
              <footer className="mk-nearsheet-foot">
                <button type="button" className="os-btn os-btn-ghost" onClick={() => setSheet(false)}>← Back to the map</button>
                <Link className="os-btn os-btn-dark" to={`${nearMode.items(wear)}?near=${near}&km=${km}&sort=nearest${trade ? `&trade=${trade}` : ''}`}>{nearMode.itemsText} →</Link>
              </footer>
            </section>
          </div>
        </div>,
        document.body
      )}
      <div className="mk-wrap mk-near">
        <div className="mk-near-head">
          <h1>{title}</h1>
          <p className="os-muted">{nearMode.lead}</p>
          <div className="mk-near-modes" role="tablist" aria-label="Who to show" ref={tabs}>
            {Object.entries(NEAR_MODES).map(([key, value]) => (
              <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? 'on' : ''} onClick={() => navigate(value.path)}>{value.tab}</button>
            ))}
            <button type="button" role="tab" aria-selected={false} onClick={() => navigate('/markets-near-me')}>🧺 Markets</button>
          </div>
          {tradeChips}
          {tradeItem && <p className="mk-near-tradeabout">{tradeItem.about}</p>}
          {mode === 'boutique' && (
            <div className="mk-chips mk-near-wear" role="group" aria-label="Men’s or women’s wear">
              {WEARS.map(([key, label]) => <button key={key} type="button" className={wear === key ? 'on' : ''} onClick={() => navigate(key ? `/boutiques-near-me/${key}` : '/boutiques-near-me')}>{label}</button>)}
            </div>
          )}
        </div>

        <div className="mk-box mk-near-where">
          <button type="button" className="os-btn os-btn-brand" onClick={locate} disabled={busy}>{busy ? 'Finding you…' : here && !placeName ? '📍 Update my location' : '📍 Use my location'}</button>
          {maps && <PlaceSearch placeholder="Or search a place: Westlands, Kahawa, Nyali…" onPlace={(event) => { setPlaceName(event.name || event.address); setHere({ lat: event.lat, lng: event.lng, at: Date.now() }); setSheet(true); }} />}
          {here && <span className="mk-near-from">{placeName ? <>Around <b>{placeName}</b></> : 'Around your current location'}</span>}
          {!here && !maps && <span className="os-muted">We’ll ask your browser for your location. It isn’t shown to anyone.</span>}
        </div>

        {here && (
          <>
            <div className="mk-near-tools">
              <div className="mk-chips" role="group" aria-label="Distance">
                {RADII.map((item) => <button type="button" key={item} className={km === item ? 'on' : ''} onClick={() => pickKm(item)}>{item} km</button>)}
                <button type="button" className={`mk-opennow-chip ${openNow ? 'on' : ''}`} aria-pressed={openNow} onClick={() => { setOpenNow(!openNow); setSheet(true); }}>🟢 Open now</button>
              </div>
              {res && <button type="button" className="os-btn os-btn-brand mk-near-showlist" onClick={() => setSheet(true)}>📋 Show {sellers.length} {noun} within {km} km</button>}
              <form className="mk-near-q" onSubmit={(event) => { event.preventDefault(); setText(typed.trim()); setSheet(true); }}>
                <input type="search" value={typed} onChange={(event) => { setTyped(event.target.value); if (!event.target.value) setText(''); }} placeholder={mode === 'mama-mboga' ? 'Looking for something? e.g. sukuma, eggs, avocado' : mode === 'boutique' ? 'Looking for something? e.g. dress, suit, watch' : 'Looking for something? e.g. sofa, phone, cement'} aria-label="What are you looking for" />
                <button className="os-btn os-btn-dark">Search</button>
              </form>
            </div>

            {mode === 'mama-mboga' && markets?.length > 0 && (
              <section className="mk-near-markets" aria-label="Markets near you">
                <div className="mk-section-head"><h2>🧺 Markets near you</h2><Link to="/markets-near-me" className="mk-more">All markets →</Link></div>
                <div className="mk-market-strip">
                  {markets.filter((market) => market.approved).slice(0, 8).map((item) => (
                    <Link key={item._id} to={`/markets/${item.slug}`} className="mk-market-chip">
                      <b>{item.name}</b>
                      <small>{kmText(item.km)} · {item.traders ? `${item.traders} trader${item.traders === 1 ? '' : 's'} here` : item.kindName}</small>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <div className="mk-near-layout">
              <div className="mk-near-map">
                {maps ? <GMap center={{ lat: here.lat, lng: here.lng }} zoom={13} markers={markers} onPick={setPicked} className="mk-near-gmap" />
                  : <iframe className="mk-gmap mk-near-gmap" title="Map around you" src={embedSrc(here.lat, here.lng, km <= 2 ? 15 : km <= 5 ? 14 : km <= 10 ? 13 : km <= 25 ? 12 : 10)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
                <Link className="os-btn os-btn-ghost mk-near-items" to={`${nearMode.items(wear)}?near=${near}&km=${km}&sort=nearest${text ? `&q=${encodeURIComponent(text)}` : ''}`}>{nearMode.itemsText} within {km} km →</Link>
              </div>

              {!sheet && list}
            </div>
          </>
        )}

        <p className="mk-near-sellers os-muted">
          {mode === 'chemist' ? 'A chemist? Verify your pharmacy licence and ' : mode === 'wholesale' ? 'A wholesaler? Add bulk prices to your ads and ' : mode === 'boutique' ? 'Run a boutique? ' : mode === 'mama-mboga' ? 'A mama mboga or market trader? Post your produce, ' : 'Selling something? '}
          <Link to="/account#shop-location">{mode === 'mama-mboga' ? 'register your stall and market' : 'put your shop on the map'}</Link> so buyers near you can find you.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- "Near me" on search & category pages
export function NearMeBar({ params, set, wholesale = false }) {
  const nearLink = wholesale ? <Link to="/wholesalers-near-me" className="mk-nearbar-link">🏭 Wholesalers near me →</Link> : <Link to="/sellers-near-me" className="mk-nearbar-link">Sellers near me →</Link>;
  const [busy, setBusy] = useState(false);
  const near = params.get('near');
  const km = Number(params.get('km') || 10);
  const go = async () => {
    setBusy(true);
    try {
      const here = await getHere();
      if (!inKenya(here.lat, here.lng)) throw new Error('Your location looks like it’s outside Kenya');
      set({ near: `${here.lat.toFixed(5)},${here.lng.toFixed(5)}`, km: String(km || 10), sort: 'nearest' });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  if (!near) {
    return (
      <div className="mk-nearbar">
        <button type="button" className="mk-qf" onClick={go} disabled={busy}>{busy ? '📍 Finding you…' : '📍 Near me'}</button>
        {nearLink}
      </div>
    );
  }
  return (
    <div className="mk-nearbar on">
      <label className="mk-qf on">
        📍 Within
        <select value={km} onChange={(event) => set({ km: event.target.value })} aria-label="Distance">
          {RADII.map((item) => <option key={item} value={item}>{item} km</option>)}
        </select>
        of you
      </label>
      <button type="button" className="mk-qf mk-qf-x" onClick={() => set({ near: '', km: '', sort: params.get('sort') === 'nearest' ? '' : params.get('sort') })} aria-label="Stop searching near me">✕</button>
      {nearLink}
    </div>
  );
}
