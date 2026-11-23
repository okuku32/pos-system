// 🗺️ Our maps: Leaflet with OpenStreetMap (free, no API key, detailed for Kenyan estates, markets and streets).
// Leaflet is loaded only on pages that show a map. The same props as the old Google map component:
//   center { lat, lng } · zoom · markers [{ id, lat, lng, title, me, draggable, label }] · onDrag(lat, lng) · onPick(id)
//   accuracy { lat, lng, meters }: the GPS's accuracy circle around a fix
//   route [{ lat, lng } | [lat, lng], …]: the path (along the roads: solid) · routeStraight: a straight fallback (dashed)
// A draggable pin can also be moved by tapping the map (easier than dragging on a phone).
import { useEffect, useRef, useState } from 'react';
import { STORE_INFO } from '../shop/storeInfo';
import './LeafletMap.css';

let leaflet = null;
export function loadLeaflet() {
  leaflet = leaflet || Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([module]) => module.default || module);
  return leaflet;
}
// the map images: OpenStreetMap's own, unless another provider is set (Admin / server: mapTiles { url, attribution })
const tiles = () => STORE_INFO.mapTiles?.url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const attribution = () => (STORE_INFO.mapTiles?.attribution ? esc(STORE_INFO.mapTiles.attribution) : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors');

// pins drawn with CSS (no image files to load): the orange pin, the blue "you", numbered stops
function iconFor(L, marker) {
  if (marker.me) return L.divIcon({ className: 'kp-me', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
  const label = marker.label ? `<b>${esc(String(marker.label).slice(0, 3))}</b>` : '';
  return L.divIcon({ className: `kp-pin${marker.draggable ? ' kp-pin-drag' : ''}${marker.label ? ' kp-pin-num' : ''}`, html: `<span>${label}</span>`, iconSize: [30, 42], iconAnchor: [15, 40], tooltipAnchor: [0, -36] });
}

export default function LeafletMap({ center, zoom = 14, markers = [], onDrag, onPick, accuracy, route: routeIn, routeStraight = false, className = '', ariaLabel = 'Map' }) {
  const route = Array.isArray(routeIn) ? routeIn.map((point) => (Array.isArray(point) ? { lat: point[0], lng: point[1] } : point)) : null;
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const L = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const cbs = useRef({ onDrag, onPick });
  cbs.current = { onDrag, onPick };
  const draggable = markers.some((marker) => marker.draggable);
  const dragRef = useRef(draggable);
  dragRef.current = draggable;

  // the map, once
  useEffect(() => {
    let live = true;
    loadLeaflet().then((lib) => {
      if (!live || !el.current || map.current) return;
      L.current = lib;
      const start = center || markers[0] || { lat: -1.2864, lng: 36.8219 };
      map.current = lib.map(el.current, { center: [start.lat, start.lng], zoom, zoomControl: true, scrollWheelZoom: false, attributionControl: true, tap: true });
      lib.tileLayer(tiles(), { maxZoom: 19, attribution: attribution(), crossOrigin: true }).addTo(map.current);
      layer.current = lib.layerGroup().addTo(map.current);
      // tap the map to move the pin there (a draggable pin only)
      map.current.on('click', (event) => { if (dragRef.current && cbs.current.onDrag) cbs.current.onDrag(event.latlng.lat, event.latlng.lng); });
      setTimeout(() => map.current?.invalidateSize(), 60); // the box may have been sized after the map was made
      setReady(true);
    }).catch(() => live && setFailed(true));
    return () => {
      live = false;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // markers, the accuracy circle and the route, whenever they change; the view fits them
  const key = JSON.stringify([markers.map((marker) => [marker.id, marker.lat, marker.lng, marker.me, marker.draggable, marker.label]), accuracy && [accuracy.lat, accuracy.lng, accuracy.meters], route?.length || 0, route?.[0] && [route[0].lat, route[0].lng], route?.length && [route[route.length - 1].lat, route[route.length - 1].lng], routeStraight]);
  const fitted = useRef('');
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !map.current) return;
    layer.current.clearLayers();
    if (accuracy?.meters > 0 && Number.isFinite(accuracy.lat)) {
      lib.circle([accuracy.lat, accuracy.lng], { radius: Math.min(accuracy.meters, 3000), color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(layer.current);
    }
    if (route?.length > 1) {
      // along the roads: a white casing under the orange line (readable over any street); a straight fallback: dashed
      if (!routeStraight) lib.polyline(route.map((point) => [point.lat, point.lng]), { color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(layer.current);
      lib.polyline(route.map((point) => [point.lat, point.lng]), { color: '#ea580c', weight: 5, opacity: 0.9, interactive: false, ...(routeStraight ? { dashArray: '10 8' } : {}) }).addTo(layer.current);
    }
    for (const marker of markers) {
      if (!Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) continue;
      const pin = lib.marker([marker.lat, marker.lng], { icon: iconFor(lib, marker), draggable: !!marker.draggable, keyboard: true, title: marker.title || '', alt: marker.title || 'Pin', zIndexOffset: marker.me ? 1000 : 0 });
      if (marker.title) pin.bindTooltip(esc(marker.title), { direction: 'top' });
      if (marker.draggable) pin.on('dragend', () => { const at = pin.getLatLng(); cbs.current.onDrag?.(at.lat, at.lng); });
      if (marker.id) pin.on('click', () => cbs.current.onPick?.(marker.id));
      pin.addTo(layer.current);
    }
    // fit the view when what's shown changes (not on every small move of the "you" dot)
    const shape = JSON.stringify([markers.length, !!route?.length, markers.filter((marker) => !marker.me).map((marker) => [marker.id || '', Math.round(marker.lat * 1e3), Math.round(marker.lng * 1e3)])]);
    const points = [...markers, ...(route || [])].filter((point) => Number.isFinite(point.lat));
    if (shape !== fitted.current) {
      fitted.current = shape;
      if (points.length > 1) map.current.fitBounds(lib.latLngBounds(points.map((point) => [point.lat, point.lng])), { padding: [36, 36], maxZoom: 17 });
      else if (points.length === 1) map.current.setView([points[0].lat, points[0].lng], Math.max(map.current.getZoom(), zoom));
    } else if (draggable && points.length === 1) map.current.panTo([points[0].lat, points[0].lng]); // the pin moved (tap / GPS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  // a new center without markers (e.g. "where you are")
  useEffect(() => {
    if (ready && map.current && center && !markers.length) map.current.setView([center.lat, center.lng], zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center?.lat, center?.lng]);

  return (
    <div className={`kp-map ${className}`} role="region" aria-label={ariaLabel}>
      <div ref={el} className="kp-map-canvas" />
      {!ready && <div className="kp-map-wait" aria-hidden="true">{failed ? '🗺️ The map couldn’t load. Check your connection.' : '🗺️ Loading the map…'}</div>}
    </div>
  );
}
