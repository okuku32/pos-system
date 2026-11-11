import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useShop } from './ShopContext';
import { firstName } from './shopApi';
import Logo from './Logo';
import CartDrawer from './CartDrawer';
import SupportChat, { openSupportChat } from './SupportChat';
import WhatsAppSupport from './WhatsAppSupport';
import MobileMenu from './MobileMenu';
import { STORE_INFO, directionsUrl } from './storeInfo';
import './shop.css';

function AccountMenu() {
  const { customer, logout } = useShop();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!customer) {
    return (
      <div className="os-auth-links">
        <Link to="/shop/login" className="os-btn os-btn-ghost">Log in</Link>
        <Link to="/shop/signup" className="os-btn os-btn-dark">Sign up</Link>
      </div>
    );
  }
  const initials = customer.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className="os-account" ref={ref}>
      <button className="os-avatar-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="os-avatar">{initials}</span>
        <span className="os-hide-sm">Hi, {firstName(customer.name)}</span>
      </button>
      {open && (
        <div className="os-menu" role="menu">
          <div className="os-menu-head">
            <b>{customer.name}</b>
            <small>{customer.email}</small>
          </div>
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/market/my'); }}>📢 My ads</button>
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/market/messages'); }}>💬 Messages</button>
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/shop/orders'); }}>📦 My orders</button>
          <button role="menuitem" onClick={() => { setOpen(false); logout(); navigate('/shop'); }}>↩ Log out</button>
        </div>
      )}
    </div>
  );
}

export default function ShopLayout() {
  const { cart, setCartOpen, bump, customer, activeOrder, chatUnread } = useShop();
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const [pop, setPop] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // phone menu
  const location = useLocation();

  useEffect(() => {
    if (!bump) return undefined;
    setPop(true);
    const t = setTimeout(() => setPop(false), 400);
    return () => clearTimeout(t);
  }, [bump]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    // marketplace pages set their own title and search tags; everywhere else gets the shop's defaults
    if (!location.pathname.startsWith('/market')) {
      document.title = location.pathname.startsWith('/shop') ? `${STORE_INFO.name} Shop: groceries & household items delivered` : STORE_INFO.name;
      document.head.querySelector('meta[name="robots"]')?.setAttribute('content', (location.pathname === '/shop' || location.pathname === '/shop/') ? 'index, follow' : 'noindex, follow');
    }
  }, [location.pathname]);

  return (
    <div className="os">
      <header className="os-header">
        <div className="os-header-inner">
          <button className="os-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <Link to="/market" aria-label="Home"><Logo /></Link>
          <nav className="os-nav">
            <NavLink to="/market" end>Marketplace</NavLink>
            <NavLink to="/shop" end>Shop</NavLink>
            {customer && (
              <NavLink to="/market/messages">
                Messages{chatUnread > 0 && <span className="os-nav-badge">{chatUnread}</span>}
              </NavLink>
            )}
            {customer && (
              <NavLink to="/shop/orders">
                My orders{activeOrder && <span className="os-dot-live" title="You have an order in progress" />}
              </NavLink>
            )}
            <NavLink to="/shop/help">Help</NavLink>
          </nav>
          <div className="os-header-actions">
            <Link to="/market/sell" className="os-btn os-btn-brand os-sell-btn" aria-label="Post an ad">
              <span aria-hidden="true">+</span> Sell
            </Link>
            {customer && (
              <Link to="/market/messages" className="os-msg-btn" aria-label={`Messages${chatUnread ? `, ${chatUnread} unread` : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
                {chatUnread > 0 && <span className="os-cart-count">{chatUnread}</span>}
              </Link>
            )}
            <AccountMenu />
            <button className={`os-cart-btn ${pop ? 'pop' : ''}`} onClick={() => setCartOpen(true)} aria-label={`Cart, ${count} items`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /></svg>
              {count > 0 && <span className="os-cart-count">{count}</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="os-main">
        <Outlet />
      </main>

      <footer className="os-footer">
        <Logo size={26} />
        <p>Your neighbourhood shop, delivered sasa hivi. Pay with M-Pesa or cash when your order arrives.</p>
        {STORE_INFO.address && <a className="os-footer-loc" href={directionsUrl} target="_blank" rel="noreferrer">📍 {STORE_INFO.address}</a>}
        <div className="os-footer-links">
          <Link to="/market">Marketplace</Link>
          <Link to="/market/sell">Post an ad</Link>
          <Link to="/shop">Shop</Link>
          <Link to="/shop/help">Help &amp; contact</Link>
          <Link to="/login">Staff login</Link>
          <button className="os-linkbtn" onClick={openSupportChat}>Chat with us</button>
        </div>
        <small>© {new Date().getFullYear()} {STORE_INFO.name}</small>
      </footer>

      <CartDrawer />
      <SupportChat />
      <WhatsAppSupport />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
