// Fashion: clothes by type (dresses, shirts, watches, shoes…), with boutiques near me.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useSeo } from './marketApi';
import ListingCard, { CardSkeletons } from './ListingCard';
import { getHere, inKenya, lastHere } from './Maps';
import './market.css';

export default function Fashion() {
  const [near, setNear] = useState(null); // { lat, lng }
  const [km, setKm] = useState(10);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useSeo({
    title: 'Fashion: dresses, shirts, shoes, watches & more',
    description: 'Shop clothes by type in Kenya: dresses, shirts, t-shirts, suits, jeans, kitenge, heels, sneakers, watches and jewellery, from boutiques and mitumba sellers near you.',
    path: '/fashion',
  });
  useEffect(() => {
    let live = true;
    api.get('/market/fashion', { params: near ? { near: `${near.lat.toFixed(5)},${near.lng.toFixed(5)}`, km } : {} }).then((response) => live && setRes(response.data)).catch((error) => live && toast.error(errMsg(error)));
    return () => {
      live = false;
    };
  }, [near, km]);
  const toggleNear = async () => {
    if (near) return setNear(null);
    setBusy(true);
    try {
      const location = lastHere(30 * 60 * 1000) || (await getHere());
      if (!inKenya(location.lat, location.lng)) throw new Error('Your location looks like it’s outside Kenya');
      setNear(location);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  const nearQs = near ? `near=${near.lat.toFixed(5)},${near.lng.toFixed(5)}&km=${km}&sort=nearest` : '';
  const withNear = (link) => (nearQs ? `${link}${link.includes('?') ? '&' : '?'}${nearQs}` : link);
  const sections = res?.groups.flatMap((group) => group.sections) || [];
  const rows = sections.filter((section) => section.items.length && !section.key.endsWith('-wear')); // the "All …" tiles link out; rows show the types

  return (
    <div className="mk">
      <div className="mk-wrap mk-fashion">
        <section className="mk-fashion-hero">
          <div>
            <h1>👗 Fashion</h1>
            <p>Dresses, shirts, suits, shoes, watches and more, new and mtumba. Pick a type, or find a boutique near you.</p>
          </div>
          <div className="mk-fashion-near">
            <Link to="/boutiques-near-me/women" className="os-btn os-btn-light">👗 Women’s boutiques near me</Link>
            <Link to="/boutiques-near-me/men" className="os-btn os-btn-light">👔 Men’s boutiques near me</Link>
          </div>
        </section>

        <div className="mk-fashion-tools">
          <button type="button" className={`mk-qf ${near ? 'on' : ''}`} onClick={toggleNear} disabled={busy}>{busy ? '📍 Finding you…' : near ? '📍 Near me ✕' : '📍 Only near me'}</button>
          {near && (
            <label className="mk-qf on">
              Within
              <select value={km} onChange={(event) => setKm(Number(event.target.value))} aria-label="Distance">
                {[2, 5, 10, 25, 50].map((item) => <option key={item} value={item}>{item} km</option>)}
              </select>
            </label>
          )}
        </div>

        {!res && <CardSkeletons n={8} />}
        {res?.groups.map((group) => (
          <section key={group.group} className="mk-fashion-group" aria-label={group.group}>
            <h2>{group.icon} {group.group}</h2>
            <div className="mk-fashion-tiles">
              {group.sections.map((section) => (
                <Link key={section.key} to={withNear(section.link)} className={`mk-fashion-tile ${section.count ? '' : 'empty'}`}>
                  <span>{section.icon}</span>
                  <b>{section.name}</b>
                  <small>{section.count ? `${section.count.toLocaleString('en-KE')} item${section.count === 1 ? '' : 's'}` : near ? 'None near you yet' : 'Be the first to post'}</small>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {rows.map((row) => (
          <section key={row.key} aria-labelledby={`fx-${row.key}`} className="mk-fashion-row">
            <div className="mk-section-head">
              <h2 id={`fx-${row.key}`}>{row.icon} {row.name}</h2>
              <Link to={withNear(row.link)} className="mk-more">See all {row.count} →</Link>
            </div>
            <div className="mk-grid">{row.items.slice(0, 4).map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>
          </section>
        ))}
        {res && !rows.length && <p className="os-muted">{near ? 'No clothes posted within this distance yet. Try a bigger distance.' : 'No clothes posted yet.'}</p>}

        <section className="mk-sell-cta">
          <div>
            <h2>Run a boutique or sell mitumba?</h2>
            <p>Post your clothes free, put your shop on the map, and offer walking delivery to buyers close by.</p>
          </div>
          <Link to="/market/sell?category=clothes-shoes" className="os-btn os-btn-brand os-btn-lg">+ Post clothes</Link>
        </section>
      </div>
    </div>
  );
}
