import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useShop } from './ShopContext';
import { firstName } from './shopApi';
import Logo from './Logo';
import CartDrawer from '../market/CartDrawer';
import SupportChat, { openSupportChat } from './SupportChat';
import WhatsAppSupport, { openWhatsApp } from './WhatsAppSupport';
import TradeAsk from '../market/TradeAsk';
import MobileMenu from './MobileMenu';
import SellSheet from './SellSheet';
import { STORE_INFO, directionsUrl } from './storeInfo';
import { useCategories } from '../market/marketApi';

// the "Popular" strip under the top bar: straight to the busiest sections
const POPULAR_SECTIONS = [
  ['🏭', 'Wholesalers', '/wholesale'],
  ['🚢', 'Importers', '/importers'],
  ['🥬', 'Mama mbogas', '/mama-mboga-near-me'],
  ['🆕', 'Latest arrivals', '/market/search?sort=newest'],
  ['🏷️', 'Best deals', '/market/search?sort=discount'],
  ['🌾', 'Cereals & grains', '/market/cooking-products'],
  ['📱', 'Electronics', '/market/electronics'],
  ['🐟', 'Samaki', '/market/samaki'],
  ['🚗', 'Cars & motorbikes', '/market/vehicles'],
  ['👗', 'Fashion', '/fashion'],
  ['🛋️', 'Furniture', '/market/furniture'],
  ['🏡', 'Land & plots', '/market/land-property'],
  ['🧸', 'Baby & kids', '/market/baby-kids'],
  ['🛒', 'Buy online', '/market/search?buyNow=1'],
];
import AiSearch, { EXAMPLES as AI_EXAMPLES } from '../market/AiSearch';
import SearchBox from '../market/SearchBox';
import AccountSwitch from './AccountSwitch';
import NetworkStatus from './NetworkStatus';
import './shop.css';
import './polish.css'; // app polish: smooth pages, instant taps, clear focus (after shop.css)
import '../market/market.css'; // every shop page uses it: load it with the shop's frame, not later
import NotificationBell from './NotificationBell';
import CallManager from './Calls';
import Welcome from './Welcome';
import InstallApp from './InstallApp';

// 🔎 search on every page (✨ Ask AI is in the top bar), pinned under the top bar. Not on the home page (it's in the hero),
// not where it gets in the way (signing in, paying, a full-screen chat); pages with their own search bar hide this one (CSS)
const NO_SEARCH = [/^\/$/, /^\/(login|signup|forgot-password|reset-password|checkout)(\/|$)/, /^\/market\/messages/];
function GlobalSearch() {
  const { pathname, search } = useLocation();
  if (NO_SEARCH.some((pattern) => pattern.test(pathname))) return null;
  const q = new URLSearchParams(search).get('q') || '';
  return (
    <div className="mk os-global-search">
      <div className="mk-topsearch">
        <div className="mk-wrap"><SearchBox initial={q} /></div>
      </div>
    </div>
  );
}

// the slim row under the top bar: popular searches and "ask AI" examples (they used to sit under the home search)
function HeaderChips() {
  const navigate = useNavigate();
  const ask = (text) => {
    // the AI box on the page answers it; on pages without one, a normal search
    const handled = !window.dispatchEvent(new CustomEvent('os:ai-ask', { detail: text, cancelable: true }));
    if (!handled) navigate(`/market/search?q=${encodeURIComponent(text)}`);
  };
  return (
    <div className="os-header-chips">
      <div className="os-header-chips-inner">
        <nav className="os-chips-star" aria-label="Our services">
          <Link to="/ride-with-us">🛵 Ride with us</Link>
        </nav>
        <nav aria-label="Popular searches">
          <span>🔥 Popular</span>
          {POPULAR_SECTIONS.map(([icon, label, to]) => <Link key={to} to={to}><span aria-hidden="true">{icon}</span> {label}</Link>)}
        </nav>
        <div className="os-chips-ai" aria-label="Ask AI">
          <span>✨ Ask AI</span>
          {AI_EXAMPLES.map((example) => <button key={example} type="button" onClick={() => ask(example)}>{example}</button>)}
        </div>
      </div>
    </div>
  );
}

function AccountMenu() {
  const { customer, logout, counts } = useShop();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    const close = (event) => ref.current && !ref.current.contains(event.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!customer) {
    return (
      <div className="os-auth-links">
        <Link to="/login" className="os-btn os-btn-ghost">Log in</Link>
        <Link to="/signup" className="os-btn os-btn-dark">Sign up</Link>
      </div>
    );
  }
  const initials = customer.name.split(/\s+/).slice(0, 2).map((item) => item[0]).join('').toUpperCase();
  const goto = (value) => {
    setOpen(false);
    navigate(value);
  };
  return (
    <div className="os-account" ref={ref}>
      <button className="os-avatar-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="My account">
        <span className="os-avatar">{initials}</span>
        <span className="os-hide-sm">Hi, {firstName(customer.name)}</span>
        {counts.toHandle > 0 && <span className="os-avatar-dot" aria-label={`${counts.toHandle} new orders`} />}
      </button>
      {open && (
        <div className="os-menu" role="menu">
          <div className="os-menu-head">
            <b>{customer.name}</b>
            <small>{customer.email}</small>
          </div>
          <AccountSwitch onGo={() => setOpen(false)} />
          {customer.accountType === 'seller' && <button role="menuitem" className="os-menu-primary" onClick={() => goto('/seller')}>🏪 Seller hub{counts.toHandle > 0 && <span className="os-menu-badge">{counts.toHandle}</span>}</button>}
          <button role="menuitem" onClick={() => goto('/orders')}>📦 My orders</button>
          <button role="menuitem" onClick={() => goto('/sales')}>🧾 Orders to fulfil{counts.toHandle > 0 && <span className="os-menu-badge">{counts.toHandle}</span>}</button>
          <button role="menuitem" onClick={() => goto('/market/my')}>📢 My ads</button>
          <button role="menuitem" onClick={() => goto('/market/messages')}>💬 Messages</button>
          <button role="menuitem" onClick={() => goto('/account')}>⚙️ Account</button>
          <button role="menuitem" onClick={() => { setOpen(false); logout(); navigate('/'); }}>↩ Log out</button>
        </div>
      )}
    </div>
  );
}

// Phone: app-style bar along the bottom of the screen, always one tap from the main pages
function BottomNav({ onCategories, onSell }) {
  const { customer, chatUnread, counts } = useShop();
  const { pathname } = useLocation();
  const on = (value) => (value === '/' ? pathname === '/' : pathname.startsWith(value));
  const Item = ({ to, label, icon, badge, active, onClick }) => {
    const inner = (
      <>
        <span className="os-bn-icon" aria-hidden="true">{icon}{badge > 0 && <i>{badge > 9 ? '9+' : badge}</i>}</span>
        <span>{label}</span>
      </>
    );
    return onClick ? (
      <button type="button" className={active ? 'on' : ''} onClick={onClick}>{inner}</button>
    ) : (
      <Link to={to} className={active ? 'on' : ''} aria-current={active ? 'page' : undefined}>{inner}</Link>
    );
  };
  const index = {
    home: <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /></svg>,
    cats: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></svg>,
    chat: <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>,
    me: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 20.5c1.6-3.6 4.6-5.5 8-5.5s6.4 1.9 8 5.5" /></svg>,
  };
  return (
    <nav className="os-bottom-nav" aria-label="Main">
      <Item to="/" label="Home" icon={index.home} active={on('/')} />
      <Item label="Categories" icon={index.cats} onClick={onCategories} active={pathname.startsWith('/market/') && !/\/market\/(sell|my|messages|edit)/.test(pathname)} />
      <button type="button" className="os-bn-sell" onClick={onSell} aria-label="Sell: post an ad" aria-haspopup="dialog"><span aria-hidden="true">+</span><b>Sell</b></button>
      <Item to="/market/messages" label="Chats" icon={index.chat} badge={chatUnread} active={on('/market/messages')} />
      <Item to={customer ? (customer.accountType === 'seller' ? '/seller' : '/account') : '/login'} label={customer ? (customer.accountType === 'seller' ? 'My shop' : 'Account') : 'Log in'} icon={index.me} badge={counts.toHandle} active={on('/account') || on('/orders') || on('/sales') || on('/seller') || on('/market/my') || on('/login')} />
    </nav>
  );
}

// Appears once you've scrolled down a bit; takes you back to the top
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700);
    const first = requestAnimationFrame(onScroll); // not straight away: reading the scroll position then forces a full layout of the page
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(first); window.removeEventListener('scroll', onScroll); };
  }, []);
  return (
    <button className={`os-top-btn ${show ? 'show' : ''}`} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top" tabIndex={show ? 0 : -1}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg>
    </button>
  );
}

function Footer() {
  const cats = useCategories();
  const { customer } = useShop();
  return (
    <footer className="os-footer">
      <div className="os-footer-grid">
        <div className="os-footer-brand">
          <Logo size={30} />
          <p><b>{STORE_INFO.tagline}</b> Buy and sell anything effortlessly, seamlessly and securely. Post ads free, chat with sellers, and buy online with M-Pesa or cash on delivery.</p>
          {STORE_INFO.address && <a className="os-footer-loc" href={directionsUrl} target="_blank" rel="noreferrer">📍 {STORE_INFO.address}</a>}
          <Link className="os-footer-follow" to="/contact#follow">Follow us on social media →</Link>
          <InstallApp />
        </div>
        <nav aria-label="Popular categories">
          <h4>Categories</h4>
          {(cats?.categories || []).slice(0, 10).map((item) => <Link key={item.slug} to={`/market/${item.slug}`}>{item.name}</Link>)}
          <Link to="/market/search">All ads →</Link>
        </nav>
        <nav aria-label="Buying and selling">
          <h4>Buy &amp; sell</h4>
          <Link to="/market/sell">Post a free ad</Link>
          {!customer && <Link to="/signup?as=seller">Become a seller</Link>}
          <Link to="/market/search?buyNow=1">Buy online</Link>
          <Link to="/wholesale">Wholesale &amp; bulk</Link>
          <Link to="/imports">Imports: ex-UK, China, USA…</Link>
          <Link to="/sellers-near-me">Sellers near me</Link>
          <Link to="/wholesalers-near-me">Wholesalers near me</Link>
          <Link to="/boutiques-near-me">Boutiques near me</Link>
          <Link to="/mama-mboga-near-me">Mama mboga near me</Link>
          <Link to="/markets-near-me">Markets near me</Link>
          <Link to="/chemists-near-me">Chemists near me</Link>
          <Link to="/electronics-shops-near-me">Electronics shops near me</Link>
          <Link to="/spare-parts-shops-near-me">Motor & spares dealers near me</Link>
          <Link to="/baby-shops-near-me">Baby shops near me</Link>
          <Link to="/groceries-near-me">Cereals & groceries near me</Link>
          <Link to="/importers">Importers</Link>
          <Link to="/importers-near-me">Importers near me</Link>
          <Link to="/fashion">Fashion</Link>
          <Link to="/errands?type=parcel">Send a parcel</Link>
          <Link to="/errands?type=shopping">Shop for me</Link>
          <Link to="/errands">My errands</Link>
          <Link to="/work">Ride, shop or partner with us</Link>
          <Link to="/lipa-pole-pole">Lipa Pole Pole</Link>
          <Link to="/market/my">My ads</Link>
          <Link to="/sales">Orders to fulfil</Link>
          <Link to="/orders">My orders</Link>
          <Link to="/deliveries">My deliveries</Link>
          <Link to="/market/messages">Messages</Link>
        </nav>
        <nav aria-label="Help">
          <h4>Help</h4>
          <Link to="/about">About us</Link>
          <Link to="/contact">Contact us</Link>
          <Link to="/help">Help &amp; contact</Link>
          <button className="os-linkbtn" onClick={openSupportChat}>Chat with us</button>
          <button className="os-linkbtn" onClick={() => openWhatsApp()}>WhatsApp us</button>
          <Link to="/help#safety">Stay safe</Link>
          <Link to="/verify-centres">Safe deal: verification centres</Link>
          <Link to="/reviews">⭐ Reviews: rate Kapu</Link>
          {customer ? <Link to="/account">My account</Link> : <Link to="/signup">Create an account</Link>}
        </nav>
      </div>
      <div className="os-footer-bottom">
        <small>© {new Date().getFullYear()} {STORE_INFO.name}. All rights reserved.</small>
        <button className="os-linkbtn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top ↑</button>
      </div>
    </footer>
  );
}

export default function ShopLayout() {
  const { cartCount, setCartOpen, bump, customer, chatUnread, counts, activeOrder } = useShop();
  const [pop, setPop] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const closeSell = useCallback(() => setSellOpen(false), []); // phone menu
  const location = useLocation();

  useEffect(() => {
    if (!bump) return undefined;
    setPop(true);
    const timer = setTimeout(() => setPop(false), 400);
    return () => clearTimeout(timer);
  }, [bump]);

  useEffect(() => {
    // A new page starts at the top. Only scroll when we're not already there: scrollTo() makes the browser lay out the
    // whole page right now, in the middle of React's first render, which costs ~0.7 s on a slow phone at start-up.
    if (!location.hash && window.scrollY !== 0) window.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);

  // remember the top bar's height so search bars can stay pinned right below it while scrolling
  useEffect(() => {
    const header = document.querySelector('.os-header');
    if (!header) return undefined;
    const set = () => document.documentElement.style.setProperty('--mk-header-h', `${header.offsetHeight}px`);
    set();
    const ro = 'ResizeObserver' in window ? new ResizeObserver(set) : null;
    ro?.observe(header);
    window.addEventListener('resize', set);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', set);
    };
  }, []);

  return (
    <div className="os">
      <header className="os-header">
        <div className="os-header-inner">
          <button className="os-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <Link to="/" aria-label={`${STORE_INFO.name} home`}><Logo /></Link>
          <nav className="os-nav" aria-label="Main">
            <NavLink to="/" end>Home</NavLink>
            {/* our own delivery service: parcels anywhere in Nairobi, booked like Uber / Bolt */}
            <Link to="/ride-with-us" className={`os-nav-star ${location.pathname === '/ride-with-us' || location.pathname === '/errands' ? 'active' : ''}`}>🛵 Ride with us</Link>
            <NavLink to="/market/search?buyNow=1" data-nav="c">Buy online</NavLink>
            <NavLink to="/wholesale" data-nav="b">Wholesale</NavLink>
            <NavLink to="/imports" data-nav="b">Imports</NavLink>
            <NavLink to="/sellers-near-me" data-nav="b">Near me</NavLink>
            {customer && <NavLink to="/orders" data-nav="d">My orders{activeOrder && <span className="os-dot-live" title="An order is on its way" />}</NavLink>}
            {customer && <NavLink to="/sales" data-nav="d">My sales{counts.toHandle > 0 && <span className="os-nav-badge">{counts.toHandle}</span>}</NavLink>}
            <NavLink to="/help" data-nav="a">Help</NavLink>
          </nav>
          <div className="os-header-actions">
            <AiSearch header />
            <button type="button" className="os-btn os-btn-brand os-sell-btn" onClick={() => setSellOpen(true)} aria-label="Post an ad" aria-haspopup="dialog">
              <span aria-hidden="true">+</span> Sell
            </button>
            {customer && (
              <Link to="/market/messages" className="os-msg-btn" aria-label={`Messages${chatUnread ? `, ${chatUnread} unread` : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
                {chatUnread > 0 && <span className="os-cart-count">{chatUnread}</span>}
              </Link>
            )}
            <NotificationBell />
            <AccountMenu />
            <button className={`os-cart-btn ${pop ? 'pop' : ''}`} onClick={() => setCartOpen(true)} aria-label={`Cart, ${cartCount} items`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /></svg>
              {cartCount > 0 && <span className="os-cart-count">{cartCount}</span>}
            </button>
          </div>
        </div>
        <HeaderChips />
      </header>

      <main className="os-main">
        <NetworkStatus />
        <Welcome />
        <GlobalSearch />
        {customer && ['/orders', '/sales', '/work', '/deliveries'].includes(location.pathname) && <div className="mk-wrap os-switch-wrap"><AccountSwitch variant="bar" /></div>}
        <Suspense fallback={<div className="page-loading" role="status" aria-label="Loading"><span className="page-spinner" /></div>}>
          {/* each page fades in softly when you open it */}
          <div key={location.pathname} className="kapu-page-fade">
            <Outlet />
          </div>
        </Suspense>
      </main>

      <Footer />
      <BackToTop />
      <BottomNav onCategories={() => setMenuOpen(true)} onSell={() => setSellOpen(true)} />
      <SellSheet open={sellOpen} onClose={closeSell} />

      <CartDrawer />
      <SupportChat />
      <CallManager />
      <WhatsAppSupport />
      <TradeAsk />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
