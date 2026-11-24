// 🛡️ Verification centres: our partner shops across Nairobi (at least 2 km apart) where second-hand items bought with
// "Safe deal" are checked before the seller is paid. Public, so buyers and sellers can see the network and how it works.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg, useSeo } from './marketApi';
import { directionsTo, getHere, GMap, kmText, lastHere } from './Maps';
import { STORE_INFO } from '../shop/storeInfo';
import './market.css';

const NAIROBI = { lat: -1.286389, lng: 36.817223 };

export default function VerifyCentres() {
  const [here, setHere] = useState(() => lastHere(6 * 3600000));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useSeo({
    title: 'Safe deal verification centres',
    description: `Buying second-hand on ${STORE_INFO.name}? With Safe deal, the item is checked at one of our partner shops before the seller is paid, then our rider brings it to you.`,
    path: '/verify-centres',
  });
  useEffect(() => {
    let live = true;
    api
      .get('/work/partners', { params: here ? { near: `${here.lat.toFixed(4)},${here.lng.toFixed(4)}` } : {} })
      .then((response) => live && setData(response.data))
      .catch((err) => live && setError(errMsg(err)));
    return () => {
      live = false;
    };
  }, [here]);
  const partners = useMemo(() => (data?.partners || []).slice().sort((first, second) => (first.km ?? 0) - (second.km ?? 0)), [data]);
  const markers = useMemo(() => [...partners.filter((partner) => partner.lat != null).map((partner) => ({ id: partner._id, lat: partner.lat, lng: partner.lng, title: partner.name })), ...(here ? [{ lat: here.lat, lng: here.lng, me: true, title: 'You' }] : [])], [partners, here]);
  const locate = () => getHere().then(setHere).catch((err) => setError(err.message));

  return (
    <div className="mk"><div className="mk-wrap mk-verify-page">
        <section className="mk-work-hero">
          <h1>🛡️ Safe deal: buy second-hand without the risk</h1>
          <p>Your money is held by <SiteName />. The seller takes the item to our nearest partner shop, where it’s checked against the ad. Only if it passes is the seller paid and our rider sent to bring it to you.</p>
        </section>

        <ol className="mk-safe-how">
          <li><b>1. Agree and pay</b><span>Choose “Safe deal” at checkout. Pay the item and a small verification fee by M-Pesa; we hold it.</span></li>
          <li><b>2. Drop-off</b><span>The seller takes the item to the partner shop nearest them, within 3 days (or you’re refunded in full).</span></li>
          <li><b>3. Verified</b><span>Matches the ad, works, condition as described, genuine. Serial / IMEI recorded. Shopping agents help when needed.</span></li>
          <li><b>4. Delivered</b><span>Passed: the seller is paid and our rider brings it to you. Failed: you get the item price back.</span></li>
        </ol>

        <div className="mk-work-h-row">
          <h2 className="mk-work-h">Our partner shops{partners.length ? ` (${partners.length})` : ''}</h2>
          <button type="button" className="os-linkbtn" onClick={locate}>📍 {here ? 'Update my location' : 'Nearest to me'}</button>
        </div>
        {markers.length > 0 && <GMap center={here || NAIROBI} zoom={12} markers={markers} className="mk-verify-map" />}
        {error && <p className="mk-err-text">{error}</p>}
        {!data && !error && <div className="page-loading"><span className="page-spinner" /></div>}
        {data && !partners.length && <div className="mk-empty"><p>No partner shops {here ? 'near you ' : ''}yet. We’re adding one in every area of Nairobi.</p></div>}
        <div className="mk-verify-list">
          {partners.map((partner) => (
            <article key={partner._id} className="mk-box mk-verify-shop">
              <b>{partner.name}</b>
              <small>{[partner.address, partner.area].filter(Boolean).join(' · ')}</small>
              {partner.hours && <small>🕘 {partner.hours}</small>}
              <div className="os-row">
                {partner.km != null && <span className="mk-pill">{kmText(partner.km)}</span>}
                {partner.lat != null && <a className="os-btn os-btn-ghost" href={directionsTo(partner.lat, partner.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions</a>}
              </div>
            </article>
          ))}
        </div>

        <section className="mk-box mk-verify-join">
          <h2>Have a shop in Nairobi?</h2>
          <p>Become an <SiteName /> partner shop: verify second-hand items for buyers and earn a commission on each one. One partner per area: shops are at least {data?.spacingKm ?? 2} km apart.</p>
          <Link className="os-btn os-btn-brand" to="/work">Apply as a partner shop</Link>
        </section>
      </div></div>
  );
}
