import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useShop } from './ShopContext';
import { firstName } from './shopApi';
import Logo from './Logo';
import CartDrawer from './CartDrawer';
import SupportChat, { openSupportChat } from './SupportChat';
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
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/shop/orders'); }}>📦 My orders</button>
          <button role="menuitem" onClick={() => { setOpen(false); logout(); navigate('/shop'); }}>↩ Log out</button>
        </div>
      )}
    </div>
  );
}

export default function ShopLayout() {
  const { cart, setCartOpen, bump, customer, activeOrder } = useShop();
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const [pop, setPop] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!bump) return undefined;
    setPop(true);
    const t = setTimeout(() => setPop(false), 400);
    return () => clearTimeout(t);
  }, [bump]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="os">
      <header className="os-header">
        <div className="os-header-inner">
          <Link to="/shop" aria-label="Ordersasa home"><Logo /></Link>
          <nav className="os-nav">
            <NavLink to="/shop" end>Shop</NavLink>
            {customer && (
              <NavLink to="/shop/orders">
                My orders{activeOrder && <span className="os-dot-live" title="You have an order in progress" />}
              </NavLink>
            )}
            <NavLink to="/shop/help">Help</NavLink>
          </nav>
          <div className="os-header-actions">
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
        <a className="os-footer-loc" href={directionsUrl} target="_blank" rel="noreferrer">📍 {STORE_INFO.address}</a>
        <div className="os-footer-links">
          <Link to="/shop/help">Help &amp; contact</Link>
          <button className="os-linkbtn" onClick={openSupportChat}>Chat with us</button>
        </div>
        <small>© {new Date().getFullYear()} Ordersasa</small>
      </footer>

      <CartDrawer />
      <SupportChat />
    </div>
  );
}
