// 🔍 "Kapu rider" at the checkout: we scan for riders near each seller's shop and show how many are free, the nearest
// one, when the delivery reaches the buyer (rider → shop, collecting it, shop → buyer) and how the fare is made up
// (like Uber / Bolt: base + per km + per minute). The nearest rider is booked with the order: they're told at once and
// get the job first when the seller has packed it. Riders' locations are never shown.
const priceText = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
const clock = (date) => new Date(date).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
const VEHICLE_ICON = { Motorbike: '🏍️', Bicycle: '🚲', 'Tuk-tuk': '🛺', Car: '🚗', 'Van / pickup': '🚐', 'On foot': '🚶' };

export default function RiderScan({ scan, groups, onRescan }) {
  if (!scan) return null;
  if (scan.status === 'scanning') {
    return (
      <div className="mk-rscan scanning" role="status" aria-live="polite">
        <span className="mk-radar" aria-hidden="true"><i /><i /><i /><b>🏍️</b></span>
        <div><b>Looking for riders near {groups.length > 1 ? 'the shops' : groups[0]?.sellerName || 'the shop'}…</b><small>Checking who’s free, how close they are and how long the delivery takes</small></div>
      </div>
    );
  }
  if (scan.status === 'error') {
    return (
      <div className="mk-rscan none" role="status">
        <div><b>We couldn’t search for riders just now</b><small>{scan.message}</small></div>
        <button type="button" className="os-btn os-btn-ghost" onClick={onRescan}>Try again</button>
      </div>
    );
  }
  const sellers = scan.data?.sellers || {};
  return (
    <div className="mk-rscan-list" aria-live="polite">
      {groups.map((group) => {
        const found = sellers[group.sellerId];
        if (!found) return null;
        if (!found.ok) return <div key={group.sellerId} className="mk-rscan none"><div><b>{group.sellerName}</b><small>{found.reason}</small></div></div>;
        const shop = found.shop?.name || group.sellerName;
        const fare = found.fare;
        return (
          <div key={group.sellerId} className={`mk-rscan ${found.available ? 'found' : 'none'}`}>
            {found.available ? (
              <>
                <div className="mk-rscan-head">
                  <span className="mk-rscan-ok" aria-hidden="true">✓</span>
                  <div>
                    <b>{found.available} rider{found.available === 1 ? '' : 's'} available near {shop}</b>
                    {found.nearest && (
                      <small>
                        Nearest: <b>{found.nearest.firstName}</b> · {VEHICLE_ICON[found.nearest.vehicle] || '🏍️'} {found.nearest.vehicle || 'Motorbike'}
                        {found.nearest.rating ? ` · ★ ${Number(found.nearest.rating.avg).toFixed(1)}` : ''} · {found.nearest.km < 0.2 ? 'at the shop now' : `${found.nearest.km} km from the shop`}
                      </small>
                    )}
                  </div>
                </div>
                {found.eta && (
                  <div className="mk-rscan-eta">
                    <div className="mk-rscan-big"><span>⏱️ Delivered in about</span><b>{found.eta.total} min</b><small>around {clock(found.eta.arriveAt)} if the seller packs it now</small></div>
                    <ol className="mk-rscan-steps">
                      <li><b>{found.eta.toShop} min</b><small>rider to the shop</small></li>
                      <li><b>{found.eta.atShop} min</b><small>collecting it</small></li>
                      <li><b>{found.eta.trip} min</b><small>to you (~{fare?.km ?? found.km} km{found.byRoad ? ' by road' : ''})</small></li>
                    </ol>
                  </div>
                )}
                <p className="mk-rscan-booked">🤝 <b>{found.nearest?.firstName || 'The nearest rider'}</b> is booked with your order: they’re told now and get the job first when the seller has packed it. If they can’t, the next nearest rider takes it.</p>
              </>
            ) : (
              <div className="mk-rscan-head">
                <span className="mk-rscan-ok wait" aria-hidden="true">…</span>
                <div>
                  <b>No riders free near {shop} right now</b>
                  <small>You can still order: the job goes to the nearest rider as soon as one is free. Or choose pickup or another delivery.</small>
                </div>
              </div>
            )}
            {fare && (
              <details className="mk-rscan-fare">
                <summary>💰 Fare <b>{priceText(fare.total)}</b> <small>(distance and time, like Uber / Bolt)</small></summary>
                <ul>
                  <li><span>Base fare</span><b>{priceText(fare.base)}</b></li>
                  <li><span>{fare.km} km × {priceText(fare.perKm)}</span><b>{priceText(fare.distance)}</b></li>
                  <li><span>{fare.minutes} min × {priceText(fare.perMin)}</span><b>{priceText(fare.time)}</b></li>
                  {fare.total > fare.base + fare.distance + fare.time + 9 && <li><span>Minimum fare</span><b>{priceText(fare.min)}</b></li>}
                  <li className="total"><span>Paid to the rider on delivery</span><b>{priceText(fare.total)}</b></li>
                </ul>
              </details>
            )}
          </div>
        );
      })}
      <button type="button" className="os-linkbtn mk-rscan-again" onClick={onRescan}>↻ Scan again</button>
    </div>
  );
}
