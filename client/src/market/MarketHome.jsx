import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, useCategories, useSeo } from './marketApi';
import { STORE_INFO } from '../shop/storeInfo';
import SearchBox from './SearchBox';
import ListingCard, { CardSkeletons } from './ListingCard';
import { Stars } from './Trust';
import InstallApp from '../shop/InstallApp';
import './market.css';

// 🐟 Samaki: the six kinds Kenyans ask for, then the latest fish ads
const SAMAKI_TYPES = [
  ['fried-victoria-fish', '🍽️', 'Deep-fried Victoria fish', 'Ngege & mbuta, wet or dry fry'],
  ['fresh-victoria-fish', '🐟', 'Fresh Victoria fish', 'Ngege, mbuta, minofu, mgongo wazi'],
  ['lake-fish', '🏞️', 'Fresh water lake fish', 'Naivasha, Turkana, mumi, fish farms'],
  ['seafood', '🦐', 'Sea foods', 'Kamba, pweza, ngisi, changu'],
  ['fried-omena', '🔥', 'Deep-fried omena', 'Crispy dagaa, ready to eat'],
  ['fresh-omena', '🐠', 'Fresh omena', 'Fresh & sun-dried dagaa, no sand'],
];
// Lake Victoria fish by name
const VICTORIA = [['Mbuta (Nile perch)', 'Mbuta', 'Nile perch'], ['Ngege (tilapia)', 'Ngege', 'Tilapia'], ['Obambo (dried / smoked)', 'Obambo', 'Dried / smoked'], ['Mumi (catfish)', 'Mumi', 'Catfish']];
function SamakiSection() {
  const [fish, setFish] = useState(null);
  useEffect(() => {
    api.get('/market/listings', { params: { category: 'samaki', sort: 'newest', limit: 10 } }).then((response) => setFish(response.data)).catch(() => setFish({ items: [] }));
  }, []);
  return (
    <section aria-labelledby="mk-samaki-h" className="mk-samaki">
      <div className="mk-section-head">
        <h2 id="mk-samaki-h">🐟 Samaki<small>Fish fresh from the lake and the sea</small></h2>
        <Link to="/market/samaki" className="mk-more">All samaki{fish?.total ? ` (${fish.total})` : ''} →</Link>
      </div>
      <div className="mk-samaki-types">
        {SAMAKI_TYPES.map(([sub, icon, name, hint]) => (
          <Link key={sub} to={`/market/samaki/${sub}`} className="mk-samaki-type"><span>{icon}</span><b>{name}</b><small>{hint}</small></Link>
        ))}
      </div>
      <div className="mk-victoria" role="group" aria-label="Lake Victoria fish by name">
        <span>Lake Victoria fish:</span>
        {VICTORIA.map(([value, name, english]) => <Link key={value} to={`/market/samaki/fresh-victoria-fish?fish=${encodeURIComponent(value)}`}><b>{name}</b><small>{english}</small></Link>)}
      </div>
      {fish?.items?.length > 0 && <div className="mk-rail mk-mt">{fish.items.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>}
    </section>
  );
}

// ⭐ what buyers and sellers say about us (public reviews of Kapu), for trust at a glance
function CustomersSay() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/reviews', { params: { limit: 3 } }).then((response) => setData(response.data)).catch(() => {});
  }, []);
  if (!data) return null;
  return (
    <section className="mk-customers-say" aria-labelledby="mk-say-h">
      <div className="mk-section-head">
        <h2 id="mk-say-h">⭐ {data.count ? <>Rated {data.avg.toFixed(1)}/5 by {data.count} customer{data.count === 1 ? '' : 's'}</> : 'What our customers say'}</h2>
        <Link to="/reviews" className="mk-more">{data.count ? 'All reviews →' : 'Rate us →'}</Link>
      </div>
      {data.count > 0 ? (
        <div className="mk-say-list">
          {data.reviews.map((review) => (
            <Link key={review._id} to="/reviews" className="mk-say">
              <Stars value={review.rating} label={false} size={14} />
              <p>“{review.comment.length > 140 ? `${review.comment.slice(0, 137)}…` : review.comment}”</p>
              <small>{review.name} · {review.role === 'seller' ? 'Seller' : review.role === 'both' ? 'Buyer & seller' : 'Buyer'}{review.verified ? ' · ✔ verified' : ''}</small>
            </Link>
          ))}
        </div>
      ) : <p className="os-muted">Bought or sold on {STORE_INFO.name}? <Link to="/reviews#rate">Be the first to rate us</Link>.</p>}
    </section>
  );
}

// 🔥 Featured: the ads sellers paid to promote, then the platform's top 3 deals (biggest real savings), no repeats
const featuredRow = (home) => {
  const ids = new Set((home.featured || []).map((ad) => ad._id));
  return [...(home.featured || []).slice(0, 9), ...(home.deals || []).filter((ad) => ad.topDeal && !ids.has(ad._id))];
};

// a row of ads you swipe through (phones) or see side by side (desktop)
function Rail({ id, title, sub, more, ads = [], loading }) {
  return (
    <section aria-labelledby={id} className="mk-rail-sec">
      <div className="mk-section-head">
        <h2 id={id}>{title}{sub && <small>{sub}</small>}</h2>
        {more && <Link to={more.to} className="mk-more">{more.text}</Link>}
      </div>
      <div className="mk-rail">{loading ? <CardSkeletons n={6} /> : ads.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>
    </section>
  );
}

export default function MarketHome() {
  const cats = useCategories();
  const [home, setHome] = useState(null);
  const [online, setOnline] = useState(null);
  const [bulk, setBulk] = useState(null);
  // the search box follows you down the page: once the big one in the banner scrolls away, a slim one stays under the top bar
  const heroSearch = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    // A plain scroll check works in every phone browser (incl. the WhatsApp / Facebook in-app browsers)
    let frame = 0;
    const check = () => {
      frame = 0;
      const header = document.querySelector('.os-header');
      const bottom = header ? header.getBoundingClientRect().bottom : 64;
      document.documentElement.style.setProperty('--mk-header-h', `${Math.max(0, Math.round(bottom))}px`);
      const el = heroSearch.current;
      if (el) setStuck(el.getBoundingClientRect().bottom < bottom + 4);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('orientationchange', onScroll);
    document.addEventListener('touchmove', onScroll, { passive: true }); // some phone browsers report scrolling late
    let io;
    if (heroSearch.current && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(onScroll, { threshold: [0, 1] });
      io.observe(heroSearch.current);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('orientationchange', onScroll);
      document.removeEventListener('touchmove', onScroll);
      io?.disconnect();
    };
  }, []);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/market/home').then((response) => setHome(response.data)).catch(() => setError('Couldn’t load the latest ads. Check your connection and refresh.'));
    api.get('/market/listings', { params: { buyNow: 1, sort: 'popular', limit: 8 } }).then((response) => setOnline(response.data)).catch(() => {});
    api.get('/market/listings', { params: { wholesale: 1, sort: 'popular', limit: 4 } }).then((response) => setBulk(response.data)).catch(() => {});
  }, []);

  const total = home?.total ?? cats?.categories.reduce((value, entryValue) => value + (entryValue.count || 0), 0) ?? 0;
  useSeo({
    title: `${STORE_INFO.name}: buy & sell cars, land, phones, furniture and more in Kenya`,
    description: `Kenya’s easy marketplace: ${total.toLocaleString('en-KE')} ads for vehicles, land & plots, electronics, furniture, beddings, spare parts, clothes, beauty and more. Search, chat with sellers and buy safely.`,
    path: '/',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: STORE_INFO.name,
      url: `${window.location.origin}/`,
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${window.location.origin}/market/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
    },
  });

  return (
    <div className="mk">
      {createPortal(
        <div className="os os-portal">
          <div className={`mk-sticky-search ${stuck ? 'show' : ''}`} aria-hidden={!stuck}>
            <div className="mk-wrap">{stuck && <SearchBox placeholder="Search cars, plots, phones, wholesale…" />}</div>
          </div>
        </div>,
        document.body
      )}
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <p className="mk-hero-tagline">Sell fast · Buy smart · Pay safe</p>
          <h1>Buy and sell <span>seamlessly</span> with Kapu</h1>
          <div ref={heroSearch}><SearchBox big /></div>
        </div>
      </section>

      {/* the market floor, straight under the search: boosted ads and the biggest price drops */}
      <div className="mk-wrap mk-top-deals">
        {!home && <Rail id="mk-top-h" title="🔥 Hot right now" loading />}
        {home?.deals?.length > 0 && <Rail id="mk-deals-h" title="🏷️ Best deals" sub="The biggest discounts on Kapu right now" more={{ to: '/market/search?sort=discount', text: 'See all deals →' }} ads={home.deals} />}
        {(home?.featured?.length > 0 || home?.deals?.some((ad) => ad.topDeal)) && <Rail id="mk-feat-h" title="🔥 Featured" sub="Promoted ads and today’s top deals" more={{ to: '/market/sell', text: 'Feature your ad →' }} ads={featuredRow(home)} />}
        {home && !home.featured?.length && !home.deals?.length && home.latest?.length > 0 && <Rail id="mk-just-h" title="🆕 Just listed" more={{ to: '/market/search?sort=newest', text: 'See all →' }} ads={home.latest.slice(0, 10)} />}
      </div>
      <div className="mk-wrap"><InstallApp variant="home" /></div>

      <div className="mk-wrap">
        {STORE_INFO.campaign?.title && (
          <Link to={STORE_INFO.campaign.link || '/market/search'} className="mk-campaign">
            <span className="mk-campaign-emoji">{STORE_INFO.campaign.emoji || '🎉'}</span>
            <span><b>{STORE_INFO.campaign.title}</b>{STORE_INFO.campaign.subtitle && <small>{STORE_INFO.campaign.subtitle}</small>}</span>
            <span className="os-btn os-btn-light">{STORE_INFO.campaign.cta || 'Shop now'} →</span>
          </Link>
        )}

        <section className="mk-promises" aria-label={`Why ${STORE_INFO.name}`}>
          <div><span>✔</span><b>Verified sellers</b><small>Checked by our team, rated by real buyers</small></div>
          <div><span>🛡️</span><b>Lipa Salama</b><small>Pay with M-Pesa; the seller is paid after delivery</small></div>
          <div><span>🐢</span><b>Lipa Pole Pole</b><small>Pay bit by bit for phones, TVs, furniture</small></div>
          <div><span>💰</span><b>Make an offer</b><small>Bargain right in the chat</small></div>
        </section>

        <CustomersSay />

        <section aria-labelledby="mk-cats-h">
          <div className="mk-section-head">
            <h2 id="mk-cats-h">Browse categories</h2>
            <Link to="/market/sell" className="os-btn os-btn-brand">+ Post a free ad</Link>
          </div>
          <div className="mk-cat-grid">
            {(cats?.categories || []).map((category, index) => (
              <Link key={category.slug} to={`/market/${category.slug}`} className="mk-cat-tile" style={{ animationDelay: `${index * 25}ms` }}>
                <span className="mk-cat-icon">{category.icon}</span>
                <b>{category.name}</b>
                <small>{category.count ? `${category.count.toLocaleString('en-KE')} ads` : 'Be the first to post'}</small>
              </Link>
            ))}
            {!cats && Array.from({ length: 12 }, (_, index) => <div key={index} className="mk-cat-tile mk-skel" />)}
          </div>
        </section>

        <section aria-labelledby="mk-nearyou-h">
          <div className="mk-section-head">
            <h2 id="mk-nearyou-h">📍 Near you</h2>
            <Link to="/sellers-near-me" className="mk-more">All sellers near me →</Link>
          </div>
          <div className="mk-near-tiles">
            {[
              ['/wholesalers-near-me', '🏭', 'Wholesalers', 'Bei ya jumla shops around you'],
              ['/boutiques-near-me/women', '👗', 'Women’s boutiques', 'Dresses, heels, handbags'],
              ['/boutiques-near-me/men', '👔', 'Men’s boutiques', 'Shirts, suits, shoes, watches'],
              ['/markets-near-me', '🧺', 'Markets', 'Gikomba, Wakulima, Toi & more'],
              ['/chemists-near-me', '💊', 'Chemists', 'Licensed, with opening hours'],
              ['/electronics-shops-near-me', '📱', 'Electronics shops', 'Phones, TVs & laptops'],
              ['/spare-parts-shops-near-me', '🔧', 'Motor & spares', 'Car dealers & spare parts'],
              ['/baby-shops-near-me', '🧸', 'Baby shops', 'Diapers, strollers & toys'],
              ['/importers', '🚢', 'Importers', 'China, ex-UK, Dubai & ex-Japan: latest arrivals'],
              ['/errands', '🛵', 'Send a parcel · Shop for me', 'Book our riders & shopping agents, no purchase needed'],
              // food, side by side: mama mboga, samaki, cereals
              ['/mama-mboga-near-me', '🥬', 'Mama mboga', 'Fresh greens, fruit & eggs'],
              ['/market/samaki', '🐟', 'Samaki', 'Ngege, mbuta, omena & seafood'],
              ['/groceries-near-me', '🌾', 'Cereals & groceries', 'Rice, flour, oil & sugar'],
            ].map(([to, icon, name, hint]) => (
              <Link key={to} to={to} className="mk-near-tile"><span>{icon}</span><b>{name}</b><small>{hint}</small></Link>
            ))}
          </div>
          <p className="mk-hint">🛒 Open any shop to see their items and add them to your cart. 🚶 Many shops close to you walk your order to your door, for a small fee or free as an after-sale service.</p>
        </section>

        <section aria-labelledby="mk-fashion-h">
          <div className="mk-section-head">
            <h2 id="mk-fashion-h">👗 Shop fashion by type</h2>
            <Link to="/fashion" className="mk-more">All fashion →</Link>
          </div>
          <div className="mk-origin-tiles mk-fashion-strip">
            {[
              ['/market/clothes-shoes/womens-clothes?item=Dresses', '👗', 'Dresses'],
              ['/market/clothes-shoes/mens-clothes?item=Shirts', '👔', 'Shirts'],
              ['/market/clothes-shoes/mens-clothes?item=T-shirts%20%26%20polos', '👕', 'T-shirts'],
              ['/market/clothes-shoes/womens-clothes', '👚', 'Women’s wear'],
              ['/market/clothes-shoes/mens-clothes', '🧑', 'Men’s wear'],
              ['/market/clothes-shoes/watches-jewellery?item=Men%E2%80%99s%20watches%7CWomen%E2%80%99s%20watches%7CSmart%20watches', '⌚', 'Watches'],
              ['/market/clothes-shoes/mens-clothes?item=Suits%20%26%20blazers', '🤵', 'Suits'],
              ['/market/clothes-shoes/womens-shoes', '👠', 'Women’s shoes'],
              ['/market/clothes-shoes/mens-shoes', '👞', 'Men’s shoes'],
              ['/market/bags/handbags', '👜', 'Handbags'],
            ].map(([to, icon, name]) => <Link key={to} to={to} className="mk-origin-tile"><span>{icon}</span><b>{name}</b></Link>)}
          </div>
        </section>

        <SamakiSection />

        {error && <p className="mk-error">{error}</p>}

        {online?.items?.length > 0 && (
          <section aria-labelledby="mk-online-h">
            <div className="mk-section-head">
              <h2 id="mk-online-h">🛒 Buy online, delivered to you</h2>
              <Link to="/market/search?buyNow=1" className="mk-more">See all {online.total} →</Link>
            </div>
            <div className="mk-grid">{online.items.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>
          </section>
        )}

        <section aria-labelledby="mk-latest-h">
          <div className="mk-section-head">
            <h2 id="mk-latest-h">Fresh ads</h2>
            <Link to="/market/search?sort=newest" className="mk-more">See all →</Link>
          </div>
          <div className="mk-grid">
            {home ? home.latest.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />) : <CardSkeletons n={8} />}
          </div>
        </section>

        {home?.popular?.length > 0 && (
          <section aria-labelledby="mk-pop-h">
            <div className="mk-section-head">
              <h2 id="mk-pop-h">Most viewed</h2>
              <Link to="/market/search?sort=popular" className="mk-more">See all →</Link>
            </div>
            <div className="mk-grid">
              {home.popular.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}
            </div>
          </section>
        )}


        <section aria-labelledby="mk-imp-h">
          <div className="mk-section-head">
            <h2 id="mk-imp-h">🌍 Shop by where it’s from</h2>
            <Link to="/imports" className="mk-more">All imports →</Link>
          </div>
          <div className="mk-origin-tiles">
            {[['china', '🇨🇳', 'Chinese goods'], ['ex-uk', '🇬🇧', 'Ex-UK'], ['europe', '🇪🇺', 'European goods'], ['usa', '🇺🇸', 'US goods'], ['japan', '🇯🇵', 'Ex-Japan'], ['dubai', '🇦🇪', 'Ex-Dubai'], ['local', '🇰🇪', 'Made in Kenya']].map(([key, value, detail]) => (
              <Link key={key} to={`/imports/${key}`} className="mk-origin-tile"><span>{value}</span><b>{detail}</b></Link>
            ))}
          </div>
        </section>

        {bulk?.items?.length > 0 && (
          <section aria-labelledby="mk-bulk-h" className="mk-bulk-home">
            <div className="mk-section-head">
              <h2 id="mk-bulk-h">🏭 Wholesale &amp; bulk deals</h2>
              <Link to="/wholesale" className="mk-more">See all {bulk.total} →</Link>
              <Link to="/wholesalers-near-me" className="mk-more">📍 Near me</Link>
            </div>
            <p className="mk-hint mk-bulk-lead">Buy cartons, bales and crates at bei ya jumla: the more you buy, the less you pay per unit.</p>
            <div className="mk-grid">{bulk.items.map((ad, index) => <ListingCard key={ad._id} ad={ad} index={index} />)}</div>
          </section>
        )}

        <section className="mk-sell-cta">
          <div>
            <h2>Got something to sell?</h2>
            <p>Post it free in under 2 minutes. Buyers find it on {STORE_INFO.name} and on Google, then chat with you, or order and pay online.</p>
          </div>
          <Link to="/market/sell" className="os-btn os-btn-brand os-btn-lg">+ Post a free ad</Link>
        </section>

        <section className="mk-safety" aria-labelledby="mk-safe-h">
          <h2 id="mk-safe-h">Buy and sell safely</h2>
          <ul>
            <li>🤝 Meet in a public place and inspect the item before paying.</li>
            <li>💸 Never send money or M-Pesa before you see the item.</li>
            <li>📄 For land and vehicles, verify the title deed or logbook at the Lands registry / NTSA first.</li>
            <li>🚩 Report suspicious ads; our team reviews every report.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
