// 🛣️ The path along the actual roads through some points (the rider → the shop → the buyer), from our server
// (OpenStreetMap routing). Asked again only when a point moves about 100 m or more (not on every GPS update).
// → { line: [[lat, lng], …], km, minutes, legs: [{ km, minutes }], source: 'osm' | 'straight' } | null (until it arrives)
import { useEffect, useState } from 'react';
import { api } from './marketApi';

export function useRoadLine(points, { mode = 'motorbike', enabled = true } = {}) {
  const usable = enabled && Array.isArray(points) && points.length >= 2 && points.every((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
  const key = usable ? points.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`).join(';') : '';
  const [road, setRoad] = useState(null);
  useEffect(() => {
    if (!key) { setRoad(null); return undefined; }
    let live = true;
    const exact = points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(';');
    api.get('/geo/road-line', { params: { points: exact, mode } })
      .then((response) => live && setRoad(response.data))
      .catch(() => live && setRoad(null));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode]);
  return road;
}
