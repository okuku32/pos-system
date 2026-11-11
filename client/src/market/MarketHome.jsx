import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, POPULAR, useCategories, useSeo } from './marketApi';
import { STORE_INFO } from '../shop/storeInfo';
import SearchBox from './SearchBox';
import ListingCard, { CardSkeletons } from './ListingCard';
import './market.css';

export default function MarketHome() {
  const cats = useCategories();
  const [home, setHome] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/market/home').then((r) => setHome(r.data)).catch(() => setError('Couldn’t load the latest ads. Check your connection and refresh.'));
  }, []);

  const total = home?.total ?? cats?.categories.reduce((a, c) => a + (c.count || 0), 0) ?? 0;
  useSeo({
    title: `${STORE_INFO.name} Marketplace: buy & sell cars, land, phones, furniture and more in Kenya`,
    description: `Kenya’s easy marketplace: ${total.toLocaleString('en-KE')} ads for vehicles, land & plots, electronics, furniture, beddings, spare parts, clothes, beauty and more. Search, chat with sellers and buy safely.`,
    path: '/market',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: `${STORE_INFO.name} Marketplace`,
      url: `${window.location.origin}/market`,
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${window.location.origin}/market/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
    },
  });

  return (
    <div className="mk">
      <section className="mk-hero">
        <div className="mk-hero-inner">
          <h1>Buy &amp; sell <span>anything</span> in Kenya</h1>
          <p>Cars, plots, phones, furniture, spare parts and more, from {total > 0 ? `${total.toLocaleString('en-KE')} ads` : 'sellers'} near you. Chat with sellers in one tap.</p>
          <SearchBox big />
          <div className="mk-popular" aria-label="Popular searches">
            <span>Popular:</span>
            {POPULAR.map((p) => (
              <Link key={p} to={`/market/search?q=${encodeURIComponent(p)}`}>{p}</Link>
            ))}
          </div>
        </div>
      </section>

      <div className="mk-wrap">
        <section aria-labelledby="mk-cats-h">
          <div className="mk-section-head">
            <h2 id="mk-cats-h">Browse categories</h2>
            <Link to="/market/sell" className="os-btn os-btn-brand">+ Post a free ad</Link>
          </div>
          <div className="mk-cat-grid">
            {(cats?.categories || []).map((c, i) => (
              <Link key={c.slug} to={`/market/${c.slug}`} className="mk-cat-tile" style={{ animationDelay: `${i * 25}ms` }}>
                <span className="mk-cat-icon">{c.icon}</span>
                <b>{c.name}</b>
                <small>{c.count ? `${c.count.toLocaleString('en-KE')} ads` : 'Be the first to post'}</small>
              </Link>
            ))}
            {!cats && Array.from({ length: 12 }, (_, i) => <div key={i} className="mk-cat-tile mk-skel" />)}
          </div>
        </section>

        {error && <p className="mk-error">{error}</p>}

        <section aria-labelledby="mk-latest-h">
          <div className="mk-section-head">
            <h2 id="mk-latest-h">Fresh ads</h2>
            <Link to="/market/search?sort=newest" className="mk-more">See all →</Link>
          </div>
          <div className="mk-grid">
            {home ? home.latest.map((ad, i) => <ListingCard key={ad._id} ad={ad} index={i} />) : <CardSkeletons n={8} />}
          </div>
        </section>

        {home?.popular?.length > 0 && (
          <section aria-labelledby="mk-pop-h">
            <div className="mk-section-head">
              <h2 id="mk-pop-h">Most viewed</h2>
              <Link to="/market/search?sort=popular" className="mk-more">See all →</Link>
            </div>
            <div className="mk-grid">
              {home.popular.map((ad, i) => <ListingCard key={ad._id} ad={ad} index={i} />)}
            </div>
          </section>
        )}

        <section className="mk-sell-cta">
          <div>
            <h2>Got something to sell?</h2>
            <p>Post it free in under 2 minutes. Buyers find it on {STORE_INFO.name} and on Google, then chat with you directly.</p>
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
