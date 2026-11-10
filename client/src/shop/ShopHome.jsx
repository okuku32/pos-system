import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import shopApi, { errMsg, firstName, ksh, store, STAGE, orderKey, unitPrice, isDiscounted } from './shopApi';
import { useShop } from './ShopContext';
import ProductImage from '../components/ProductImage';

const CAT_ICON = { Beverages: '🥤', Dairy: '🥛', Bakery: '🍞', Groceries: '🧺', Household: '🧴', Snacks: '🍪', General: '🛍️' };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function ShopHome() {
  const { customer, cart, setQty, activeOrder } = useShop();
  const [products, setProducts] = useState(() => store.get('ordersasa_products', []));
  const [loading, setLoading] = useState(!products.length);
  const [category, setCategory] = useState('All');
  const [q, setQ] = useState('');
  const gridRef = useRef();

  useEffect(() => {
    document.title = 'Ordersasa · Shop online, delivered sasa hivi';
    shopApi
      .get('/shop/products')
      .then((r) => {
        setProducts(r.data);
        store.set('ordersasa_products', r.data);
      })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => (category === 'All' || p.category === category) && (!s || p.name.toLowerCase().includes(s) || p.category.toLowerCase().includes(s)));
  }, [products, q, category]);

  const scrollToGrid = () => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <>
      <section className="os-hero">
        <div className="os-hero-inner">
          <div className="os-hero-copy os-fade-up">
            {customer ? (
              <>
                <span className="os-eyebrow">{greeting()} 👋</span>
                <h1>Welcome back, {firstName(customer.name)}!</h1>
                <p>What can we get for you today? Your favourites are in stock and ready to go, delivered to your door sasa hivi.</p>
              </>
            ) : (
              <>
                <span className="os-eyebrow">Karibu Ordersasa 👋</span>
                <h1>Your everyday shopping, <span className="os-hl">delivered sasa hivi.</span></h1>
                <p>Fresh groceries, drinks and household essentials from our shelves to your door. Order in minutes, follow every step live, and pay with M-Pesa or cash when it arrives.</p>
              </>
            )}
            <div className="os-search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                placeholder="Search milk, bread, sugar…"
                value={q}
                onChange={(e) => { setQ(e.target.value); if (category !== 'All') setCategory('All'); }}
                onKeyDown={(e) => e.key === 'Enter' && scrollToGrid()}
                aria-label="Search products"
              />
            </div>
            {!customer && (
              <div className="os-hero-cta">
                <button className="os-btn os-btn-brand os-btn-lg" onClick={scrollToGrid}>Start shopping</button>
                <Link className="os-btn os-btn-light os-btn-lg" to="/shop/signup">Create free account</Link>
              </div>
            )}
          </div>
          <div className="os-hero-art os-fade-up delay" aria-hidden="true">
            {products.filter((p) => p.image).slice(0, 6).map((p, i) => (
              <div key={p._id} className={`os-float f${i}`}><ProductImage product={p} size={96} /></div>
            ))}
          </div>
        </div>
        <div className="os-perks">
          <div><span>⚡</span><b>Fast delivery</b><small>Straight from our shelves</small></div>
          <div><span>📍</span><b>Live tracking</b><small>Every step, in real time</small></div>
          <div><span>💳</span><b>Pay on delivery</b><small>M-Pesa or cash</small></div>
        </div>
      </section>

      {activeOrder && (
        <Link to={`/track/${activeOrder.trackingToken}`} className="os-active-order os-fade-up">
          <span className="os-ao-icon">{STAGE[orderKey(activeOrder)]?.icon}</span>
          <span className="os-ao-text">
            <small>Order {activeOrder.orderNo}</small>
            <b>{STAGE[orderKey(activeOrder)]?.label}</b>
          </span>
          <span className="os-ao-cta">Track →</span>
        </Link>
      )}

      <section className="os-shop" ref={gridRef}>
        <div className="os-cats" role="tablist" aria-label="Categories">
          {['All', ...categories].map((c) => (
            <button key={c} role="tab" aria-selected={category === c} className={`os-cat ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>
              <span>{c === 'All' ? '✨' : CAT_ICON[c] || '🛍️'}</span>{c}
            </button>
          ))}
        </div>

        <div className="os-shop-head">
          <h2>{q ? `Results for “${q}”` : category === 'All' ? 'Everything in stock' : category}</h2>
          <span className="os-muted">{loading ? '' : `${visible.length} item${visible.length === 1 ? '' : 's'}`}</span>
        </div>

        <div className="os-grid">
          {loading && !products.length
            ? [...Array(10)].map((_, i) => <div key={i} className="os-card os-skeleton"><div /><span /><span /></div>)
            : visible.map((p, i) => {
                const qty = cart[p._id] || 0;
                return (
                  <article key={p._id} className="os-card" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                    <div className="os-card-img"><ProductImage product={p} size={160} /></div>
                    <span className="os-card-cat">{p.category}</span>
                    <h3 className="os-card-name">{p.name}</h3>
                    <div className="os-card-foot">
                      <span className="os-price-wrap">
                        <b className={`os-price ${isDiscounted(p) ? 'deal' : ''}`}>{ksh(unitPrice(p))}</b>
                        {isDiscounted(p) && <s className="os-was">{ksh(p.price)}</s>}
                      </span>
                      {qty === 0 ? (
                        <button className="os-add" onClick={() => setQty(p, 1)} aria-label={`Add ${p.name} to cart`}>
                          <span>+</span> Add
                        </button>
                      ) : (
                        <div className="os-stepper">
                          <button onClick={() => setQty(p, qty - 1)} aria-label={`Remove one ${p.name}`}>−</button>
                          <span>{qty}</span>
                          <button onClick={() => setQty(p, qty + 1)} aria-label={`Add one ${p.name}`}>+</button>
                        </div>
                      )}
                    </div>
                    {p.stock <= 5 && <span className="os-low">Only {p.stock} left</span>}
                    {isDiscounted(p) && <span className="os-deal-badge">−{p.discountPercent}%</span>}
                  </article>
                );
              })}
        </div>
        {!loading && !visible.length && (
          <div className="os-empty">
            <div className="os-empty-art">🔍</div>
            <h4>Nothing matches “{q}”</h4>
            <p>Try another word, or browse a category above.</p>
            <button className="os-btn os-btn-ghost" onClick={() => { setQ(''); setCategory('All'); }}>Clear search</button>
          </div>
        )}
      </section>
    </>
  );
}
