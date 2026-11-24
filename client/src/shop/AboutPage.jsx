// About us (/about): who we are and everything we do, at a glance, for buyers, sellers and people who'd like to work
// with us. The figures are live (GET /api/market/about-stats) and only shown once they're big enough to impress;
// until then the strip shows our promises instead.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SiteName, TextWithSiteName } from '../components/BrandName';
import { rememberBrowse } from './browse';
import { useAboutTour } from './aboutTour';
import { STORE_INFO } from './storeInfo';
import { openSupportChat } from './SupportChat';
import { api, useSeo } from '../market/marketApi';

// the live figures: one request for the whole page (the figures and the "members" count), kept for a minute
let statsAsked = null;
let statsAt = 0;
const aboutStats = () => {
  if (!statsAsked || Date.now() - statsAt > 60000) {
    statsAt = Date.now();
    statsAsked = api.get('/market/about-stats').then((response) => response.data || {}).catch(() => { statsAsked = null; return {}; });
  }
  return statsAsked;
};

// what we do: the headline services, each with a link to try it
const SERVICES = [
  { icon: '🛍️', title: 'Buy & sell anything', text: 'Phones, cars, land, furniture, fashion, fresh produce and more. Posting an ad is free and takes a minute.', to: '/market/search', cta: 'Browse the marketplace' },
  { icon: '🔒', title: 'Pay safely with mobile banking', text: 'Pay with M-Pesa or cash on delivery. Safe mobile payment is guaranteed on every order you pay through us.', to: '/help', cta: 'How payment works' },
  { icon: '🏍️', title: 'Delivery by trained riders', text: 'ID-checked, trained riders bring your order to your door, with live tracking and an arrival time you can see.', to: '/market/search?buyNow=1', cta: 'Shop items to buy online' },
  { icon: '🛵', title: 'Ride with us', text: 'Send a parcel anywhere in Nairobi by bike, 4-seater car or pickup. See the price upfront, the nearest rider collects it, and you track it live.', to: '/ride-with-us', cta: 'Send a parcel' },
  { icon: '🛡️', title: 'Safe deal for second-hand items', text: 'Used phones, laptops and more are verified at a partner shop before the seller is paid. No more fake or faulty goods.', to: '/verify-centres', cta: 'Find a verification centre' },
  { icon: '🏭', title: 'Wholesale & importers', text: 'Bulk prices from wholesalers, and importers of goods from China, Dubai and beyond, for shops and resellers.', to: '/wholesale', cta: 'See wholesale prices' },
  { icon: '🐢', title: 'Lipa Pole Pole', text: 'Pay for phones, TVs and furniture bit by bit. Your item is reserved from the first deposit.', to: '/lipa-pole-pole', cta: 'How Lipa Pole Pole works' },
  { icon: '✨', title: 'Smart AI search', text: 'Ask in your own words, in English or Kiswahili: “cheapest rice wholesaler near me”. We rank sellers on price, reliability and successful deliveries.', to: '/market/search', cta: 'Try it now' },
  { icon: '📍', title: 'Sellers & markets near you', text: 'Mama mbogas, boutiques, chemists, wholesalers and markets around you, with distance, directions and contacts.', to: '/markets-near-me', cta: 'Explore near me' },
];

// 🏬 physical market digitisation: what a market trader gets, what a buyer gets, and how a market goes online
const TRADER_GAINS = [
  ['🏪', 'A free online shop in minutes', 'Snap your stock, set your prices, and your stall is pinned inside your market, so buyers know exactly where to find you.'],
  ['📣', 'Customers far beyond your stall', 'Your shop shows on your market’s page, in “sellers near me” and in search across Kenya: not just to the people who walk past.'],
  ['📲', 'Paid safely, straight to you', 'M-Pesa Till, Paybill, Pochi la Biashara or cash on delivery. Safe mobile payment is guaranteed on every order.'],
  ['🛵', 'We deliver for you', 'Our trained riders collect from your stall and bring it to the buyer. You keep selling while they ride.'],
  ['📈', 'Run your business like a pro', 'Today’s orders and sales in your Seller hub, and a free POS dashboard: best sellers, busy hours and stock alerts.'],
  ['⭐', 'Stand out from the crowd', 'Boost your whole business for KSh 200 a month: every ad first in search, and your stall first on your market’s page.'],
];
const BUYER_GAINS = [
  ['🔎', 'A whole market on your phone', 'Walk Gikomba, Wakulima or Toi from home: compare prices stall by stall, without the crowds or the bargaining in the sun.'],
  ['🧑‍💼', 'A trusted eye in the market', 'Our shopping agent stationed in that market checks the item, size and quality before it’s sent (optional, KSh 200).'],
  ['📸', 'Can’t see it listed? Send a photo', 'Snap what you want and send it to the trader: they post it for you to add to your cart.'],
  ['🏍️', 'Delivered to your door', 'From the stall to you, with live tracking and a fare by distance, like Uber or Bolt.'],
];
const MARKET_STEPS = [
  ['We list the market', 'Its name, location and sections go on Kapu, with its own page buyers can search and share.'],
  ['Traders join for free', 'Each trader opens a shop, pins their stall and posts their stock in minutes, from their phone.'],
  ['Agents are stationed', 'Trained shopping agents in the market check orders and help traders get online.'],
  ['Buyers shop, we deliver', 'Orders come from across the city and the country; our riders bring them to the buyer’s door.'],
];

// the live figures of markets online (only once they're big enough to say), and a few markets to visit
function MarketsOnline() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    aboutStats().then(setStats);
  }, []);
  const figures = stats ? [
    stats.markets >= 3 && [roundDown(stats.markets), 'markets online'],
    stats.marketSellers >= 20 && [roundDown(stats.marketSellers), 'market traders selling'],
    stats.marketAgents >= 5 && [roundDown(stats.marketAgents), 'agents in the markets'],
  ].filter(Boolean) : [];
  const list = stats?.marketList || [];
  if (!figures.length && !list.length) return null;
  return (
    <div className="os-about-markets-live">
      {figures.length > 0 && <div className="os-about-markets-figures">{figures.map(([value, label]) => <div key={label}><b>{value}</b><small>{label}</small></div>)}</div>}
      {list.length > 0 && (
        <p className="os-about-markets-list">
          <span>Visit a market:</span>
          {list.map((market) => <Link key={market.slug} to={`/markets/${market.slug}`}>{market.name}</Link>)}
        </p>
      )}
    </div>
  );
}

const TRUST = [
  ['✔', 'Verified sellers', 'Our team checks sellers’ identity. Look for the ✔ badge.'],
  ['⭐', 'Real reviews only', 'Only buyers whose order was delivered can review a seller, so ratings can’t be faked.'],
  ['📞', 'Contacts protected', 'Sellers’ numbers are shown only to signed-in members, never to bots or scrapers.'],
  ['💬', 'Chat & call in the app', 'Talk to sellers and riders in the app, free over the internet, without sharing your number.'],
  ['🚩', 'Scams removed fast', 'Report any ad in one tap. Our team reviews every report.'],
  ['🆘', 'Real people to help', 'Live chat and WhatsApp support, every day.'],
];

const BUY_STEPS = [
  ['Find it', 'Search, browse or just ask our AI in your own words.'],
  ['Pay safely', 'M-Pesa or cash on delivery. Safe mobile payment is guaranteed.'],
  ['Get it delivered', 'Track your rider live, or pick it up. Not right? We’ve got your back.'],
];
const SELL_STEPS = [
  ['Post for free', 'Photos, a price and your location. Your ad is live in minutes.'],
  ['Sell online', 'Tick “Sell online” and buyers can order and pay straight away.'],
  ['Get paid', 'Cash on delivery goes straight to you; M-Pesa is sent to you after delivery.'],
];

// the parts of the page the tour glides through, in order
const TOUR_SECTIONS = '.os-about-figures, .os-about-mission, .os-about-section, .os-about-join, .os-launch-join, .os-about-contact';

// "1,234" → "1,200+": a round, honest figure
const roundDown = (value) => {
  const step = value >= 10000 ? 1000 : value >= 1000 ? 100 : value >= 100 ? 10 : 1;
  return `${(Math.floor(value / step) * step).toLocaleString('en-KE')}${value >= 10 ? '+' : ''}`;
};

function Figures() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    aboutStats().then(setStats);
  }, []);
  // only the figures that are big enough to be worth saying
  const figures = stats ? [
    stats.ads >= 100 && ['🛒', roundDown(stats.ads), 'live ads'],
    stats.sellers >= 20 && ['🏪', roundDown(stats.sellers), 'sellers'],
    stats.delivered >= 50 && ['📦', roundDown(stats.delivered), 'orders delivered'],
    stats.counties >= 5 && ['🗺️', String(stats.counties), 'counties'],
    stats.markets >= 3 && ['🏬', roundDown(stats.markets), 'markets listed'],
    stats.team >= 5 && ['🏍️', roundDown(stats.team), 'riders & agents'],
  ].filter(Boolean) : [];
  // a young marketplace: our promises instead of small numbers
  const promises = [
    ['🆓', 'Free', 'to post an ad'],
    ['🔒', 'Safe', 'mobile payment guaranteed'],
    // the promise that wins people over: hand us the shopping, we bring it home (replaces the old "optional inspection")
    ['🤝', 'Trust us', 'with your shopping: we deliver it to your door'],
    ['🇰🇪', '47', 'counties to buy & sell in'],
  ];
  const list = figures.length >= 3 ? figures.slice(0, 4) : promises;
  return (
    <section className="os-about-figures" aria-label={figures.length >= 3 ? 'Our marketplace in numbers' : 'Our promises'}>
      {list.map(([icon, value, label]) => (
        <div key={label}><span aria-hidden="true">{icon}</span><b>{value}</b><small>{label}</small></div>
      ))}
    </section>
  );
}

// launch: the front page for visitors who haven't signed up ("/"): an invitation to join before the official launch
export default function AboutPage({ launch = false, onExplore }) {
  const name = STORE_INFO.name;
  const { hash } = useLocation();
  // /about#contact (footer, menus): straight to the Contact us section
  useEffect(() => {
    if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [hash]);
  // a visitor who doesn't scroll is taken through the page, section by section (ease-in-out); any scroll / tap stops it
  const { touring, stop } = useAboutTour(TOUR_SECTIONS);
  const [members, setMembers] = useState(0);
  useEffect(() => {
    if (!launch) return undefined;
    let live = true;
    aboutStats().then((data) => live && setMembers(data.members || 0));
    return () => { live = false; };
  }, [launch]);
  useSeo({
    title: launch ? `${name}: Kenya’s marketplace you can trust. Join before we launch` : `About ${name}: Kenya’s marketplace you can trust`,
    description: `${name} is a Kenyan marketplace to buy and sell anything, pay safely with mobile banking, and get it delivered by trained riders. Free ads, wholesale prices, shopping you can trust us with, and Lipa Pole Pole.`,
    path: launch ? '/' : '/about',
    jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name, url: typeof window !== 'undefined' ? window.location.origin : undefined, slogan: STORE_INFO.tagline, ...(STORE_INFO.email ? { email: STORE_INFO.email } : {}), ...(STORE_INFO.phone ? { telephone: STORE_INFO.phone } : {}), areaServed: 'KE' },
  });
  return (
    <div className="os-about">
      {touring && (
        <div className="os-tour-note" role="status">
          <span className="os-tour-dot" aria-hidden="true" /><span>Showing you around <SiteName light /></span>
          <button type="button" onClick={stop}>Stop</button>
        </div>
      )}
      {/* before the official launch: the invitation */}
      {launch && (
        <div className="os-launch-bar" role="note">
          <span><span className="os-launch-dot" aria-hidden="true" /><b>Launching soon.</b> Join now: be among the first buyers and sellers on <SiteName light />{members >= 50 ? `, with ${(Math.floor(members / 10) * 10).toLocaleString('en-KE')}+ early members` : ''}.</span>
          <Link to="/signup" className="os-launch-bar-cta">Join free →</Link>
        </div>
      )}
      {/* hero */}
      <section className="os-about-hero">
        <div className="os-about-wrap">
          <span className="os-about-eyebrow">{launch ? <>Welcome to <SiteName light /> · launching soon</> : <>About <SiteName light /></>}</span>
          <h1>Kenya’s marketplace you can <em>trust</em>.</h1>
          <p className="os-about-lead">We connect buyers and sellers across Kenya, and we stand between them so every deal is protected: safe mobile payment is guaranteed, with trained riders and agents who check your goods before you pay.</p>
          <p className="os-about-kenyan"><svg className="os-about-flag" viewBox="0 0 30 20" width="30" height="20" aria-hidden="true"><rect width="30" height="20" rx="2" fill="#fff"/><rect width="30" height="5.6" fill="#111"/><rect y="7" width="30" height="6" fill="#bb0000"/><rect y="14.4" width="30" height="5.6" rx="0" fill="#006600"/><ellipse cx="15" cy="10" rx="3.2" ry="6.4" fill="#bb0000" stroke="#111" strokeWidth="0.8"/><ellipse cx="15" cy="10" rx="1" ry="4.4" fill="#fff"/></svg>By Kenyans, for Kenyans, with Kenyans.</p>
          <p className="os-about-tagline">{STORE_INFO.tagline}</p>
          {launch ? (
            <>
              <div className="os-about-ctas">
                <Link className="os-btn os-btn-brand os-btn-lg" to="/signup">Join free before launch</Link>
                <Link className="os-btn os-about-btn-light os-btn-lg" to="/signup?as=seller">I sell: open my shop early</Link>
                <button type="button" className="os-btn os-about-btn-ghost os-btn-lg" onClick={onExplore}>Explore the marketplace</button>
              </div>
              <p className="os-launch-note">Free to join · No card needed · Already a member? <Link to="/login">Log in</Link></p>
            </>
          ) : (
            <div className="os-about-ctas">
              <Link className="os-btn os-btn-brand os-btn-lg" to="/market/search">Start shopping</Link>
              <Link className="os-btn os-about-btn-light os-btn-lg" to="/market/sell">Sell for free</Link>
              <Link className="os-btn os-about-btn-ghost os-btn-lg" to="/contact">Contact us</Link>
            </div>
          )}
        </div>
      </section>

      <div className="os-about-wrap">
        <Figures />

        {/* mission */}
        <section className="os-about-mission">
          <div>
            <span className="os-about-kicker">Why we exist</span>
            <h2>Buying online in Kenya should never mean being conned.</h2>
          </div>
          <div className="os-about-why">
            <p className="os-about-why-lead">Too many Kenyans have paid for a phone that never arrived, or collected goods that were not what they ordered. <SiteName /> exists to put an end to that.</p>
            <p className="os-about-why-local">We understand the dynamics of our local market, and that is exactly why we created{' '}
              <Link to="/" className="os-about-namelink" title={`Go to the ${name} marketplace`} onClick={(event) => { rememberBrowse(); if (launch && onExplore) { event.preventDefault(); onExplore(); } }}><SiteName /></Link>.</p>
            <p>We bring every kind of seller online, from the mama mboga next door to the country’s largest wholesalers and importers, and we add the three things online shopping in Kenya has been missing:</p>
            <ul className="os-about-pillars">
              <li><span aria-hidden="true">🔒</span><div><b>Secure payment</b><small>Safe mobile payment is guaranteed on every order paid through us.</small></div></li>
              <li><span aria-hidden="true">🏍️</span><div><b>Dependable delivery</b><small>Trained, ID-checked riders, with live tracking to your door.</small></div></li>
              <li><span aria-hidden="true">🔍</span><div><b>Goods checked by people</b><small>Our shopping agents verify the item, its quality and quantity whenever you ask.</small></div></li>
            </ul>
            <p>We also bring the businesses you rely on every day within easy reach: market traders, shops, chemists and wholesalers near you, complete with directions and contacts. <b>The product you need is only one click away, without the hassle.</b></p>
            <figure className="os-about-promise">
              <figcaption>Our promise</figcaption>
              <blockquote>Entrust us with your shopping and delivery, and we guarantee that your goods reach you <b>on time and safely</b>.</blockquote>
              <span className="os-about-promise-sign">The <SiteName /> team</span>
            </figure>
          </div>
        </section>

        {/* what we do */}
        <section className="os-about-section" aria-labelledby="about-what">
          <div className="os-about-head">
            <span className="os-about-kicker">What we do</span>
            <h2 id="about-what">Everything you need to buy and sell with confidence</h2>
          </div>
          <div className="os-about-services">
            {SERVICES.map((service) => (
              <Link key={service.title} to={service.to} className="os-about-service">
                <span className="os-about-service-icon" aria-hidden="true">{service.icon}</span>
                <b>{service.title}</b>
                <p>{service.text}</p>
                <span className="os-about-service-cta">{service.cta} →</span>
              </Link>
            ))}
          </div>
        </section>

        {/* 🏬 physical market digitisation */}
        <section className="os-about-section os-about-markets" id="markets" aria-labelledby="about-markets">
          <div className="os-about-head">
            <span className="os-about-kicker">Physical market digitisation</span>
            <h2 id="about-markets">We’re bringing Kenya’s markets online</h2>
          </div>
          <div className="os-about-markets-intro">
            <p>Gikomba, Wakulima, Toi, Muthurwa, Kariakor, Kongowea… Kenya’s markets feed and clothe millions of us. Yet for generations a trader’s customers have been limited to the people who happen to walk past their stall.</p>
            <p><b><SiteName /> digitises the physical market.</b> We bring market traders on board, give every one of them a free online shop linked to their market and stall, and put them in front of a far larger audience: buyers across the city and the whole country, shopping from their phones. The market stays the market, with its prices, its variety and its people. It simply reaches everyone now.</p>
          </div>
          <div className="os-about-markets-cols">
            <div className="os-about-markets-col">
              <h3>🏪 For market traders</h3>
              <ul>{TRADER_GAINS.map(([icon, title, text]) => <li key={title}><span aria-hidden="true">{icon}</span><div><b>{title}</b><small>{text}</small></div></li>)}</ul>
            </div>
            <div className="os-about-markets-col">
              <h3>🛒 For buyers</h3>
              <ul>{BUYER_GAINS.map(([icon, title, text]) => <li key={title}><span aria-hidden="true">{icon}</span><div><b>{title}</b><small>{text}</small></div></li>)}</ul>
            </div>
          </div>
          <div className="os-about-markets-steps">
            <h3>How a market goes online</h3>
            <ol>{MARKET_STEPS.map(([step, text], index) => <li key={step}><span className="os-about-num">{index + 1}</span><div><b>{step}</b><small><TextWithSiteName text={text} /></small></div></li>)}</ol>
          </div>
          <MarketsOnline />
          <div className="os-about-markets-ctas">
            <Link className="os-btn os-btn-brand os-btn-lg" to="/signup?as=seller">🏪 Sell in a market? Open your free shop</Link>
            <Link className="os-btn os-btn-dark os-btn-lg" to="/markets-near-me">📍 Explore markets near you</Link>
          </div>
        </section>

        {/* how it works */}
        <section className="os-about-section" aria-labelledby="about-how">
          <div className="os-about-head">
            <span className="os-about-kicker">How it works</span>
            <h2 id="about-how">Simple for buyers. Simple for sellers.</h2>
          </div>
          <div className="os-about-how">
            {[['🛒 For buyers', BUY_STEPS, '/market/search', 'Start shopping'], ['🏪 For sellers', SELL_STEPS, '/market/sell', 'Post your first ad']].map(([title, steps, to, cta]) => (
              <div key={title} className="os-about-howcol">
                <h3>{title}</h3>
                <ol>
                  {steps.map(([step, text], index) => (
                    <li key={step}><span className="os-about-num">{index + 1}</span><div><b>{step}</b><small>{text}</small></div></li>
                  ))}
                </ol>
                <Link className="os-btn os-btn-dark" to={to}>{cta} →</Link>
              </div>
            ))}
          </div>
        </section>

        {/* trust */}
        <section className="os-about-section os-about-trust" aria-labelledby="about-trust">
          <div className="os-about-head">
            <span className="os-about-kicker">Your safety comes first</span>
            <h2 id="about-trust">Why people trust <SiteName /></h2>
          </div>
          <ul>
            {TRUST.map(([icon, title, text]) => (
              <li key={title}><span aria-hidden="true">{icon}</span><div><b>{title}</b><small>{text}</small></div></li>
            ))}
          </ul>
        </section>

        {/* work with us */}
        <section className="os-about-join">
          <div>
            <span className="os-about-kicker light">Grow with us</span>
            <h2>Earn as a rider, shopping agent or partner shop</h2>
            <p>Deliver orders on your motorbike or on foot, shop and inspect for our customers, or verify second-hand items at your shop. Weekly pay straight to your M-Pesa.</p>
          </div>
          <Link className="os-btn os-btn-brand os-btn-lg" to="/work">Join our team →</Link>
        </section>

        {/* before the launch: why join now */}
        {launch && (
          <section className="os-launch-join" aria-labelledby="launch-join">
            <div className="os-about-head center">
              <span className="os-about-kicker">Be part of the launch</span>
              <h2 id="launch-join">Join <SiteName /> before we open to everyone</h2>
              <p>Set up early and be ready on day one.</p>
            </div>
            <div className="os-launch-cards">
              <div><span aria-hidden="true">🛍️</span><b>Buyers</b><small>Save the deals you like, follow sellers near you and be first to know when we launch.</small><Link className="os-btn os-btn-brand" to="/signup">Join as a buyer</Link></div>
              <div><span aria-hidden="true">🏪</span><b>Sellers</b><small>Open your shop, post your items for free and get your first buyers from day one.</small><Link className="os-btn os-btn-dark" to="/signup?as=seller">Join as a seller</Link></div>
              <div><span aria-hidden="true">🏍️</span><b>Riders & agents</b><small>Deliver orders or check goods for buyers in your market. Weekly pay to your M-Pesa.</small><Link className="os-btn os-btn-ghost" to="/work">Join our team</Link></div>
            </div>
            <p className="os-launch-explore">Just looking? <button type="button" className="mk-linkbtn" onClick={onExplore}>Explore the marketplace →</button></p>
          </section>
        )}

        {/* contact us: the full page has every channel and our social media */}
        <section className="os-about-contact" id="contact" aria-labelledby="about-contact">
          <div className="os-about-head center">
            <span className="os-about-kicker">Contact us</span>
            <h2 id="about-contact">We’re here to help</h2>
            <p>Phone, email, WhatsApp, live chat and our social media pages, all in one place.</p>
          </div>
          <div className="os-about-contact-row">
            <Link className="os-btn os-btn-brand os-btn-lg" to="/contact">Contact us →</Link>
            <button type="button" className="os-btn os-btn-ghost os-btn-lg" onClick={openSupportChat}>💬 Live chat</button>
          </div>
        </section>
      </div>
    </div>
  );
}
