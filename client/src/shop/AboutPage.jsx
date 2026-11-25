// About us (/about, and the front page "/" before the launch): what we offer first, then how it works, why it's
// safe, and how to join. Kept short on purpose: one line per point, details live on the pages each card links to.
// Icons are Lucide line icons (lucide-react), not emojis, so they look the same on every phone.
// The figures are live (GET /api/market/about-stats) and only shown once they're big enough to impress; until then
// the strip shows our promises instead.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ShoppingBag, ShieldCheck, Truck, Package, Wallet, Factory, BadgeCheck, MapPin, Sparkles, Gift, Handshake, Flag,
  ShoppingCart, Store, Users, Star, MessageCircle, LifeBuoy, Megaphone, Smartphone, Search, Camera, MessagesSquare,
} from 'lucide-react';
import { SiteName } from '../components/BrandName';
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

// what we offer: the first thing on the page, one line each, every card opens the service
const SERVICES = [
  { Icon: ShoppingBag, title: 'Buy & sell anything', text: 'Phones, cars, land, furniture, fresh produce and more. Posting an ad is free.', to: '/market/search', cta: 'Browse the marketplace' },
  { Icon: ShieldCheck, title: 'Safe M-Pesa payment', text: 'Pay with M-Pesa or cash on delivery. Safe payment is guaranteed on every order.', to: '/help', cta: 'How payment works' },
  { Icon: Truck, title: 'Delivery to your door', text: 'Trained, ID-checked riders bring your order, with live tracking.', to: '/market/search?buyNow=1', cta: 'Shop and get it delivered' },
  { Icon: Package, title: 'Ride with us', text: 'Send a parcel anywhere in Nairobi by bike, car or pickup, priced upfront.', to: '/ride-with-us', cta: 'Send a parcel' },
  { Icon: Wallet, title: 'Lipa Pole Pole', text: 'Take home phones, TVs and furniture now and pay bit by bit.', to: '/lipa-pole-pole', cta: 'How it works' },
  { Icon: Factory, title: 'Wholesale & imports', text: 'Bulk prices from wholesalers and importers, for shops and resellers.', to: '/wholesale', cta: 'See wholesale prices' },
  { Icon: BadgeCheck, title: 'Verified second-hand', text: 'Used phones and laptops are checked at a partner shop before the seller is paid.', to: '/verify-centres', cta: 'Find a verification centre' },
  { Icon: MapPin, title: 'Shops & markets near you', text: 'Traders, chemists and markets around you, with directions and contacts.', to: '/markets-near-me', cta: 'Explore near me' },
  { Icon: Sparkles, title: 'Smart search', text: 'Ask in your own words, in English or Kiswahili, and find the best deal.', to: '/market/search', cta: 'Try it now' },
];

// markets online: three gains for traders, three for buyers (the details are on each market's page)
const TRADER_GAINS = [
  [Store, 'A free online shop, linked to your stall', 'Buyers across Kenya find you, not just those who walk past.'],
  [Smartphone, 'Paid safely, straight to you', 'M-Pesa Till, Paybill, Pochi la Biashara or cash on delivery.'],
  [Megaphone, 'We deliver while you keep selling', 'Our riders collect from your stall and take it to the buyer.'],
];
const BUYER_GAINS = [
  [Search, 'A whole market on your phone', 'Compare Gikomba, Wakulima or Toi prices stall by stall, from home.'],
  [Camera, 'Can’t find it? Send a photo', 'Snap what you want and the trader posts it for you.'],
  [Truck, 'Delivered to your door', 'From the stall to you, with live tracking.'],
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
  [BadgeCheck, 'Verified sellers', 'Our team checks sellers’ identity. Look for the badge.'],
  [Star, 'Real reviews only', 'Only buyers who received their order can leave a review.'],
  [MessageCircle, 'Chat without sharing your number', 'Talk to sellers and riders in the app, free.'],
  [Flag, 'Scams removed fast', 'Report any ad in one tap; our team checks every report.'],
  [LifeBuoy, 'Real people to help', 'Live chat and WhatsApp support, every day.'],
  [ShieldCheck, 'Your money protected', 'Safe payment is guaranteed on every order paid through us.'],
];

const BUY_STEPS = [
  ['Find it', 'Search, browse or just ask in your own words.'],
  ['Pay safely', 'M-Pesa or cash on delivery.'],
  ['Get it delivered', 'Track your rider live, or pick it up.'],
];
const SELL_STEPS = [
  ['Post for free', 'Photos, a price and your location: live in minutes.'],
  ['Sell online', 'Buyers order and pay straight away.'],
  ['Get paid', 'Cash on delivery, or M-Pesa sent to you after delivery.'],
];

// the parts of the page the tour glides through, in order
const TOUR_SECTIONS = '.os-about-figures, .os-about-section, .os-about-mission, .os-about-join, .os-launch-join, .os-about-contact';

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
    stats.ads >= 100 && [ShoppingCart, roundDown(stats.ads), 'live ads'],
    stats.sellers >= 20 && [Store, roundDown(stats.sellers), 'sellers'],
    stats.delivered >= 50 && [Package, roundDown(stats.delivered), 'orders delivered'],
    stats.counties >= 5 && [MapPin, String(stats.counties), 'counties'],
    stats.markets >= 3 && [Store, roundDown(stats.markets), 'markets listed'],
    stats.team >= 5 && [Users, roundDown(stats.team), 'riders & agents'],
  ].filter(Boolean) : [];
  // a young marketplace: our promises instead of small numbers
  const promises = [
    [Gift, 'Free', 'to post an ad'],
    [ShieldCheck, 'Safe', 'mobile payment guaranteed'],
    [Handshake, 'Trust us', 'with your shopping: we deliver it to your door'],
    [MapPin, '47', 'counties to buy & sell in'],
  ];
  const list = figures.length >= 3 ? figures.slice(0, 4) : promises;
  return (
    <section className="os-about-figures" aria-label={figures.length >= 3 ? 'Our marketplace in numbers' : 'Our promises'}>
      {list.map(([FigureIcon, value, label]) => (
        <div key={label}><span aria-hidden="true"><FigureIcon size={24} /></span><b>{value}</b><small>{label}</small></div>
      ))}
    </section>
  );
}

// a list of [Icon, title, text] points (trust, market gains)
const IconPoints = ({ points, iconSize = 20 }) => points.map(([PointIcon, title, text]) => (
  <li key={title}><span aria-hidden="true"><PointIcon size={iconSize} /></span><div><b>{title}</b><small>{text}</small></div></li>
));

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
          {/* kept to the one promise on purpose, straight into the buttons; the details come further down the page */}
          <h1>Your online marketplace that <em>guarantees quality</em> for your money, time and product.</h1>
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

        {/* what we offer: first, so visitors see at once everything they can do here */}
        <section className="os-about-section" id="offer" aria-labelledby="about-what">
          <div className="os-about-head">
            <span className="os-about-kicker">What we offer</span>
            <h2 id="about-what">Everything you need, in one place</h2>
          </div>
          <div className="os-about-services">
            {SERVICES.map(({ Icon: ServiceIcon, title, text, to, cta }) => (
              <Link key={title} to={to} className="os-about-service">
                <span className="os-about-service-icon" aria-hidden="true"><ServiceIcon size={24} /></span>
                <b>{title}</b>
                <p>{text}</p>
                <span className="os-about-service-cta">{cta} →</span>
              </Link>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section className="os-about-section" aria-labelledby="about-how">
          <div className="os-about-head">
            <span className="os-about-kicker">How it works</span>
            <h2 id="about-how">Simple for buyers. Simple for sellers.</h2>
          </div>
          <div className="os-about-how">
            {[[ShoppingCart, 'For buyers', BUY_STEPS, '/market/search', 'Start shopping'], [Store, 'For sellers', SELL_STEPS, '/market/sell', 'Post your first ad']].map(([HeadingIcon, title, steps, to, cta]) => (
              <div key={title} className="os-about-howcol">
                <h3><HeadingIcon size={20} aria-hidden="true" className="os-about-h3-icon" />{title}</h3>
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
          <ul><IconPoints points={TRUST} /></ul>
        </section>

        {/* physical markets online */}
        <section className="os-about-section os-about-markets" id="markets" aria-labelledby="about-markets">
          <div className="os-about-head">
            <span className="os-about-kicker">Markets online</span>
            <h2 id="about-markets">We’re bringing Kenya’s markets online</h2>
          </div>
          <div className="os-about-markets-intro">
            <p>Gikomba, Wakulima, Toi, Kongowea… Every trader gets a free online shop linked to their stall, so buyers across Kenya can shop the market from their phones.</p>
          </div>
          <div className="os-about-markets-cols">
            <div className="os-about-markets-col">
              <h3><Store size={20} aria-hidden="true" className="os-about-h3-icon" />For market traders</h3>
              <ul><IconPoints points={TRADER_GAINS} /></ul>
            </div>
            <div className="os-about-markets-col">
              <h3><ShoppingCart size={20} aria-hidden="true" className="os-about-h3-icon" />For buyers</h3>
              <ul><IconPoints points={BUYER_GAINS} /></ul>
            </div>
          </div>
          <MarketsOnline />
          <div className="os-about-markets-ctas">
            <Link className="os-btn os-btn-brand os-btn-lg" to="/signup?as=seller"><Store size={18} aria-hidden="true" /> Open your free market shop</Link>
            <Link className="os-btn os-btn-dark os-btn-lg" to="/markets-near-me"><MapPin size={18} aria-hidden="true" /> Explore markets near you</Link>
          </div>
        </section>

        {/* why we exist: short, after the visitor has seen what we offer */}
        <section className="os-about-mission">
          <div>
            <span className="os-about-kicker">Why we exist</span>
            <h2>Buying online in Kenya should never mean being conned.</h2>
          </div>
          <div className="os-about-why">
            <p className="os-about-why-lead">Too many Kenyans have paid for goods that never arrived, or that were not what they ordered. We understand our local market, and that is exactly why we created{' '}
              <Link to="/" className="os-about-namelink" title={`Go to the ${name} marketplace`} onClick={(event) => { rememberBrowse(); if (launch && onExplore) { event.preventDefault(); onExplore(); } }}><SiteName /></Link>.</p>
            <figure className="os-about-promise">
              <figcaption>Our promise</figcaption>
              <blockquote>Entrust us with your shopping and delivery, and we guarantee that your goods reach you <b>on time and safely</b>.</blockquote>
              <span className="os-about-promise-sign">The <SiteName /> team</span>
            </figure>
          </div>
        </section>

        {/* work with us */}
        <section className="os-about-join">
          <div>
            <span className="os-about-kicker light">Grow with us</span>
            <h2>Earn as a rider, shopping agent or partner shop</h2>
            <p>Deliver orders, shop for our customers, or verify second-hand items at your shop. Weekly pay to your M-Pesa.</p>
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
              <div><span aria-hidden="true"><ShoppingBag size={28} /></span><b>Buyers</b><small>Save deals, follow sellers near you and be first to know when we launch.</small><Link className="os-btn os-btn-brand" to="/signup">Join as a buyer</Link></div>
              <div><span aria-hidden="true"><Store size={28} /></span><b>Sellers</b><small>Open your shop, post your items for free and get buyers from day one.</small><Link className="os-btn os-btn-dark" to="/signup?as=seller">Join as a seller</Link></div>
              <div><span aria-hidden="true"><Truck size={28} /></span><b>Riders & agents</b><small>Deliver orders or check goods for buyers. Weekly pay to your M-Pesa.</small><Link className="os-btn os-btn-ghost" to="/work">Join our team</Link></div>
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
            <button type="button" className="os-btn os-btn-ghost os-btn-lg" onClick={openSupportChat}><MessagesSquare size={18} aria-hidden="true" /> Live chat</button>
          </div>
        </section>
      </div>
    </div>
  );
}
