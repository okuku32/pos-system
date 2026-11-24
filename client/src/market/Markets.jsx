// Markets: markets near me (Gikomba, Wakulima, Kongowea…) and each market's page with the mama mbogas and
// traders registered there.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useSeo } from './marketApi';
import { STORE_INFO } from '../shop/storeInfo';
import ListingCard, { CardSkeletons } from './ListingCard';
import { GMap, PinMap, PlaceSearch, ShopBadges, WalkLine, directionsTo, distanceFromMe, embedSrc, getHere, inKenya, kmText, lastHere, useMaps } from './Maps';
import Basket from './Basket';
import SellerContact from './SellerContact';
import { CallButton } from '../shop/Calls';
import { useShop } from '../shop/ShopContext';
import { setChosenAgent, useChosenAgent } from './ChosenAgent';
import './market.css';

// mama mbogas & fish sellers: their produce and prices show right on their card (per kifungu, kg, piece, fungu…)
const sellsFood = (seller) => (seller.shop?.kinds || []).includes('mama-mboga') || (seller.categories || []).some((category) => ['fresh-produce', 'samaki'].includes(category.slug));

const KIND_ICON = { 'fresh-produce': '🥬', mitumba: '👕', mixed: '🧺', wholesale: '🏭' };
const RADII = [2, 5, 10, 25, 50];

export function MarketsNear() {
  const maps = useMaps();
  const [here, setHere] = useState(() => lastHere());
  const [km, setKm] = useState(10);
  const [placeName, setPlaceName] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useSeo({ title: 'Markets near you: mama mbogas and market traders', description: 'Find markets near you in Kenya, like Gikomba, Wakulima (Marikiti), Toi and Kongowea, with the mama mbogas and traders who sell there, distance and directions.', path: '/markets-near-me' });

  useEffect(() => {
    let live = true;
    const params = here ? { near: `${here.lat.toFixed(5)},${here.lng.toFixed(5)}`, km } : {};
    api.get('/market/markets', { params }).then((response) => live && setRes(response.data)).catch((error) => live && toast.error(errMsg(error)));
    return () => {
      live = false;
    };
  }, [here, km]);

  const locate = async () => {
    setBusy(true);
    try {
      const position = await getHere();
      if (!inKenya(position.lat, position.lng)) throw new Error('Your location looks like it’s outside Kenya. Search for a place instead.');
      setPlaceName('');
      setHere(position);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  const markets = (res?.markets || []).filter((market) => market.approved);
  // no location yet: every market, by county
  const byCounty = !here ? markets.reduce((total, market) => ({ ...total, [market.county]: [...(total[market.county] || []), market] }), {}) : null;

  return (
    <div className="mk">
      <div className="mk-wrap mk-near">
        <div className="mk-near-head">
          <h1>🧺 Markets near you</h1>
          <p className="os-muted">Open-air and fresh produce markets around you, and the mama mbogas and traders who sell there. See what they have, chat, order or walk over.</p>
          <div className="mk-near-modes" role="tablist" aria-label="What to show">
            <Link role="tab" to="/mama-mboga-near-me">🥬 Mama mboga near me</Link>
            <Link role="tab" aria-selected="true" className="on" to="/markets-near-me">🧺 Markets</Link>
            <Link role="tab" to="/market/fresh-produce">🛒 Fresh produce</Link>
          </div>
        </div>

        <div className="mk-box mk-near-where">
          <button type="button" className="os-btn os-btn-brand" onClick={locate} disabled={busy}>{busy ? 'Finding you…' : here && !placeName ? '📍 Update my location' : '📍 Use my location'}</button>
          {maps && <PlaceSearch placeholder="Or search a place: Kawangware, Githurai, Nyali…" onPlace={(event) => { setPlaceName(event.name || event.address); setHere({ lat: event.lat, lng: event.lng, at: Date.now() }); }} />}
          {here ? <span className="mk-near-from">{placeName ? <>Around <b>{placeName}</b></> : 'Around your current location'}</span> : <span className="os-muted">Or browse all markets by county below.</span>}
        </div>

        {here && (
          <div className="mk-near-tools">
            <div className="mk-chips" role="group" aria-label="Distance">
              {RADII.map((item) => <button type="button" key={item} className={km === item ? 'on' : ''} onClick={() => setKm(item)}>{item} km</button>)}
            </div>
          </div>
        )}

        {here ? (
          <div className="mk-near-layout">
            <div className="mk-near-map">
              {maps ? <GMap center={{ lat: here.lat, lng: here.lng }} zoom={12} markers={[{ lat: here.lat, lng: here.lng, title: 'You', me: true }, ...markets.map((market, index) => ({ lat: market.lat, lng: market.lng, title: market.name, label: String(index + 1) }))]} className="mk-near-gmap" />
                : <iframe className="mk-gmap mk-near-gmap" title="Map around you" src={embedSrc(here.lat, here.lng, km <= 2 ? 15 : km <= 5 ? 14 : km <= 10 ? 13 : 11)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
            </div>
            <div className="mk-near-list" aria-live="polite">
              <p className="mk-count">{res ? `${markets.length} market${markets.length === 1 ? '' : 's'} within ${km} km` : 'Looking around you…'}</p>
              {markets.map((market, index) => <MarketCard key={market._id} m={market} n={index + 1} />)}
              {res && !markets.length && (
                <div className="mk-empty">
                  <p>No markets we know of within {km} km.</p>
                  {km < 50 && <button type="button" className="os-btn os-btn-ghost" onClick={() => setKm(RADII[RADII.indexOf(km) + 1])}>Look further ({RADII[RADII.indexOf(km) + 1]} km)</button>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mk-markets-all">
            {!res && <CardSkeletons n={4} />}
            {byCounty && Object.entries(byCounty).map(([county, list]) => (
              <section key={county}>
                <h2>{county}</h2>
                <div className="mk-markets-grid">{list.map((item) => <MarketCard key={item._id} m={item} />)}</div>
              </section>
            ))}
          </div>
        )}

        <p className="mk-near-sellers os-muted">Sell in a market? <Link to="/account#shop-location">Register your stall</Link> so buyers find you. Your market isn’t listed? You can add it there too.</p>
      </div>
    </div>
  );
}

// 0712345678 / 254712345678 → "0712 345 678", "tel:+254712345678", "https://wa.me/254712345678"
const localPhone = (phone) => String(phone || '').replace(/\D/g, '').replace(/^254/, '0');
const prettyPhone = (phone) => localPhone(phone).replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const intlPhone = (phone) => `254${localPhone(phone).replace(/^0/, '')}`;

// the shopping agents of one market: opened from "Find a shopping agent here" on the market's page
// back: the checkout they came from to change their agent (the new one goes straight back there)
function MarketAgents({ slug, marketName, back }) {
  const { customer } = useShop();
  const navigate = useNavigate();
  const chosen = useChosenAgent();
  const book = (agent) => {
    setChosenAgent(agent, res.market);
    toast.success(`${agent.name.split(' ')[0]} is your shopping agent: they’ll check your order when you choose “Inspect my goods” at the checkout`);
    if (back) navigate(back); // came from the checkout to change agent: straight back there (otherwise stay on the market)
  };
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const me = customer?._id || '';
  useEffect(() => {
    let live = true;
    setRes(null);
    api.get(`/market/markets/${encodeURIComponent(slug)}/agents`).then((response) => live && setRes(response.data)).catch((innerError) => live && setError(errMsg(innerError)));
    return () => { live = false; };
  }, [slug, me]); // signed in now: fetched again, with their numbers
  if (error) return <p className="os-muted">{error}</p>;
  if (!res) return <div className="mk-agents-loading"><span className="os-spinner dark" /> Finding the shopping agents at {marketName}…</div>;
  if (!res.agents.length) return <p className="os-muted">No shopping agents at {marketName} yet. To move something you bought here, <Link to="/ride-with-us">book Ride with us</Link>.</p>;
  return (
    <>
      <p className="mk-agents-lead">{res.agents.length} trained shopping agent{res.agents.length === 1 ? '' : 's'} at {marketName}: they check the right item, quality and quantity before you pay, then send it to you.</p>
      <div className="mk-agents">
        {res.agents.map((agent) => (
          <article key={agent._id} className={`mk-agent ${chosen?._id === agent._id ? 'chosen' : ''}`}>
            <span className="mk-agent-face" aria-hidden="true">{agent.avatar ? <img src={agent.avatar} alt="" /> : agent.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
            <div className="mk-agent-body">
              <b>{agent.name}{chosen?._id === agent._id && <span className="mk-agent-yours">✓ Your agent</span>}</b>
              <small>
                <span className={`mk-agent-dot ${agent.available ? 'on' : ''}`} aria-hidden="true" />{agent.available ? 'Available now' : 'Busy'}
                {agent.rating ? ` · ★ ${agent.rating.avg.toFixed(1)} (${agent.rating.count})` : ''}
                {agent.jobs ? ` · ${agent.jobs} job${agent.jobs === 1 ? '' : 's'} done` : ''}
              </small>
              {agent.phone ? (
                <span className="mk-agent-phone">📞 {prettyPhone(agent.phone)}</span>
              ) : (
                <Link className="mk-agent-lock" to={`/login?next=${encodeURIComponent(`/markets/${slug}#agents`)}`}>🔒 Log in to see contacts</Link>
              )}
            </div>
            <div className="mk-agent-actions">
              {agent.phone && <a className="os-btn os-btn-brand" href={`tel:+${intlPhone(agent.phone)}`}>📞 Call</a>}
              {agent.phone && <a className="os-btn os-btn-ghost" href={`https://wa.me/${intlPhone(agent.phone)}?text=${encodeURIComponent(`Hello ${agent.name.split(' ')[0]}, I found you on ${STORE_INFO.name}. I'd like you to shop for me at ${marketName}.`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
              <button type="button" className="os-btn os-btn-dark" onClick={() => book(agent)}>{chosen?._id === agent._id ? (back ? 'Keep this agent' : 'Book again') : 'Book this agent'}</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function MarketCard({ m: location, n: number }) {
  return (
    <article className={`mk-near-card mk-market-card ${number ? "" : "no-num"}`}>
      {number && <span className="mk-near-num">{number}</span>}
      <div className="mk-near-body">
        <Link to={`/markets/${location.slug}`} className="mk-near-name"><b>{KIND_ICON[location.kind]} {location.name}</b></Link>
        <small>{location.kindName} · {[location.area, location.county].filter(Boolean).join(', ')}{location.days ? ` · ${location.days}` : ''}</small>
        {location.about && <span className="mk-near-addr">{location.about}</span>}
        <span className="mk-near-bulk">{location.traders ? <>🧑‍🌾 {location.traders} trader{location.traders === 1 ? '' : 's'} on <SiteName /></> : 'No traders registered yet'}{location.agents ? ` · 🧑‍💼 ${location.agents} shopping agent${location.agents === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div className="mk-near-side">
        {location.km != null && <b className="mk-near-km">{kmText(location.km)}</b>}
        <a className="os-btn os-btn-brand" href={directionsTo(location.lat, location.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions</a>
        <Link className="os-btn os-btn-dark" to={`/markets/${location.slug}`}>See traders</Link>
      </div>
    </article>
  );
}

export function MarketPage() {
  const { slug } = useParams();
  const [search] = useSearchParams();
  const back = (search.get('back') || '').startsWith('/') && !(search.get('back') || '').startsWith('//') ? search.get('back') : ''; // only our own pages
  const [open, setOpen] = useState({}); // whose price list is folded away
  const [showAgents, setShowAgents] = useState(() => typeof window !== 'undefined' && window.location.hash === '#agents');
  const openAgents = () => {
    setShowAgents(true);
    setTimeout(() => document.getElementById('agents')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const market = res?.market;
  useSeo({
    title: market ? `${market.name}, ${market.county}: mama mbogas & traders` : 'Market',
    description: market ? `${market.name} in ${[market.area, market.county].filter(Boolean).join(', ')}: ${market.about || market.kindName}. See the traders and mama mbogas who sell here, their prices, and get directions.` : '',
    path: `/markets/${slug}`,
  });
  useEffect(() => {
    let live = true;
    setRes(null);
    api.get(`/market/markets/${encodeURIComponent(slug)}`).then((response) => live && setRes(response.data)).catch((innerError) => live && setError(errMsg(innerError)));
    return () => {
      live = false;
    };
  }, [slug]);

  if (error) return <div className="mk"><div className="mk-wrap mk-narrow"><div className="os-empty"><div className="os-empty-art">🧺</div><h4>{error}</h4><Link to="/markets-near-me" className="os-btn os-btn-brand">Markets near me</Link></div></div></div>;
  if (!res) return <div className="mk"><div className="mk-wrap"><CardSkeletons n={4} /></div></div>;
  const km = distanceFromMe(market);
  return (
    <div className="mk">
      <div className="mk-wrap mk-market-page">
        <nav className="mk-crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link> › <Link to="/markets-near-me">Markets</Link> › <span>{market.name}</span></nav>
        <section className="mk-box mk-shopcard">
          <div className="mk-shopcard-text">
            <h1>{KIND_ICON[market.kind]} {market.name}</h1>
            <p>{market.kindName} · 📍 {[market.area, market.county].filter(Boolean).join(', ')}{market.days ? ` · 🗓️ ${market.days}` : ''}</p>
            <p className="mk-market-people">🧑‍🌾 {market.traders || 0} trader{market.traders === 1 ? '' : 's'} · 🧑‍💼 {market.agents || 0} shopping agent{market.agents === 1 ? '' : 's'}</p>
            {market.about && <p>{market.about}</p>}
            <p className="mk-shopcard-km">{km != null ? `🚶 About ${kmText(km)} from you` : ''}</p>
            <div className="mk-shopcard-actions">
              <a className="os-btn os-btn-brand" href={directionsTo(market.lat, market.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions</a>
              <button type="button" className="os-btn os-btn-dark" aria-expanded={showAgents} aria-controls="agents" onClick={openAgents}>🧑‍💼 Find a shopping agent here</button>
              <Link className="os-btn os-btn-ghost" to="/account#shop-location">I sell here: register my stall</Link>
            </div>
          </div>
          <PinMap lat={market.lat} lng={market.lng} title={market.name} />
        </section>

        {showAgents && (
          <section id="agents" className="mk-box mk-agents-box" aria-labelledby="mk-agents-h">
            <div className="mk-section-head">
              <h2 id="mk-agents-h">🧑‍💼 Shopping agents at {market.name}</h2>
              <button type="button" className="os-btn os-btn-ghost" onClick={() => setShowAgents(false)} aria-label="Close the shopping agents">✕</button>
            </div>
            {back && <p className="mk-hint">Pick the agent you want: you go straight back to your checkout.</p>}
            <MarketAgents slug={slug} marketName={market.name} back={back} />
          </section>
        )}

        <section aria-labelledby="mk-traders-h">
          <div className="mk-section-head"><h2 id="mk-traders-h">🧑‍🌾 Traders &amp; mama mbogas here ({res.sellers.length})</h2></div>
          {!res.sellers.length && <p className="os-muted">No traders from {market.name} have joined yet. Do you sell here? <Link to="/account#shop-location">Register your stall</Link> and buyers nearby will find you.</p>}
          <div className="mk-traders">
            {res.sellers.map((seller) => (
              <article key={seller._id} className="mk-near-card no-num">
                <div className="mk-near-body">
                  <div className="mk-near-head">
                    <Link to={`/market/seller/${seller._id}`} className="mk-near-name"><b>{seller.shop?.name || seller.name}</b> {seller.boosted && <span className="mk-featured-biz" title="This business is boosted">⭐ Featured business</span>} {seller.verified && <span className="mk-verified-tick" title="Verified seller">✔</span>}</Link>
                    <span className="mk-near-reach">
                      <CallButton person={{ _id: seller._id, name: seller.name }} compact />
                      <SellerContact sellerId={seller._id} available={seller.contact !== false} compact />
                    </span>
                  </div>
                  <small>{seller.shop?.name ? `${seller.name} · ` : ''}{seller.shop?.stall ? `📍 ${seller.shop.stall} · ` : ''}{seller.ads} ad{seller.ads === 1 ? '' : 's'}{seller.rating?.count ? ` · ★ ${seller.rating.avg.toFixed(1)}` : ''}</small>
                  <ShopBadges shop={{ ...seller.shop, market: null }} />
                  <WalkLine walk={seller.shop?.walk} km={distanceFromMe(seller.shop)} />
                  <span className="mk-near-cats">{seller.categories.map((category) => <span key={category.slug}>{category.icon} {category.name}</span>)}</span>
                </div>
                <div className="mk-near-side">
                  {seller.shop?.lat != null && seller.shop?.lng != null && <a className="os-btn os-btn-ghost" href={directionsTo(seller.shop.lat, seller.shop.lng)} target="_blank" rel="noopener noreferrer">🧭 Directions</a>}
                  {sellsFood(seller) ? <button type="button" className="os-btn os-btn-brand" aria-expanded={open[seller._id] !== false} onClick={() => setOpen({ ...open, [seller._id]: open[seller._id] === false })}>{open[seller._id] === false ? 'See prices' : 'Hide prices'}</button> : <Link className="os-btn os-btn-brand" to={`/market/seller/${seller._id}`}>See prices</Link>}
                </div>
                {sellsFood(seller) && open[seller._id] !== false && <div className="mk-trader-basket"><Basket sellerId={seller._id} here={lastHere()} type="mama-mboga" compact /></div>}
              </article>
            ))}
          </div>
        </section>

        {res.items.length > 0 && (
          <section aria-labelledby="mk-mitems-h">
            <div className="mk-section-head"><h2 id="mk-mitems-h">What’s for sale at {market.name}</h2></div>
            <div className="mk-grid">{res.items.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>
          </section>
        )}

        {res.nearby.length > 0 && (
          <section aria-labelledby="mk-nearby-h">
            <div className="mk-section-head"><h2 id="mk-nearby-h">Other markets nearby</h2></div>
            <div className="mk-market-strip">
              {res.nearby.map((item) => <Link key={item._id} to={`/markets/${item.slug}`} className="mk-market-chip"><b>{KIND_ICON[item.kind]} {item.name}</b><small>{item.km} km from {market.name}</small></Link>)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
