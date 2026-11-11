import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useShop } from './ShopContext';
import { store } from './shopApi';
import { STORE_INFO } from './storeInfo';
import Logo from './Logo';
import { openSupportChat } from './SupportChat';
import { openWhatsApp } from './WhatsAppSupport';
import { useCategories } from '../market/marketApi';

export const CAT_ICON = { Beverages: '🥤', Dairy: '🥛', Bakery: '🍞', Groceries: '🧺', Household: '🧴', Snacks: '🍪', General: '🛍️' };

// Phone menu (☰): pages, every category with its product count, and support options.
export default function MobileMenu({ open, onClose }) {
  const navigate = useNavigate();
  const { customer, activeOrder, logout, chatUnread } = useShop();
  const market = useCategories();
  const [products, setProducts] = useState(() => store.get('ordersasa_products', []));

  useEffect(() => {
    if (!open) return undefined;
    setProducts(store.get('ordersasa_products', []));
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const categories = useMemo(() => {
    const counts = {};
    products.forEach((p) => (counts[p.category] = (counts[p.category] || 0) + 1));
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);

  const go = (path) => {
    onClose();
    navigate(path);
  };

  return (
    <div className={`os-menu-wrap ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="os-overlay" onClick={onClose} />
      <nav className="os-mobile-menu" aria-label="Menu">
        <div className="os-mm-head">
          <Logo size={30} />
          <button className="os-icon-btn" onClick={onClose} aria-label="Close menu">✕</button>
        </div>

        {customer ? (
          <div className="os-mm-hello">Hi, <b>{customer.name.split(' ')[0]}</b> 👋</div>
        ) : (
          <div className="os-mm-auth">
            <Link className="os-btn os-btn-ghost os-grow" to="/shop/login" onClick={onClose}>Log in</Link>
            <Link className="os-btn os-btn-brand os-grow" to="/shop/signup" onClick={onClose}>Sign up</Link>
          </div>
        )}

        <Link className="os-btn os-btn-brand os-mm-sell" to="/market/sell" onClick={onClose}>+ Post a free ad</Link>

        <div className="os-mm-section">
          <NavLink to="/market" end onClick={onClose}>🏪 Marketplace</NavLink>
          {customer && <NavLink to="/market/messages" onClick={onClose}>💬 Messages{chatUnread > 0 && <span className="os-mm-count">{chatUnread}</span>}</NavLink>}
          {customer && <NavLink to="/market/my" onClick={onClose}>📢 My ads</NavLink>}
          <NavLink to="/shop" end onClick={onClose}>🛒 Shop (groceries)</NavLink>
          {customer && <NavLink to="/shop/orders" onClick={onClose}>📦 My orders{activeOrder && <span className="os-dot-live" />}</NavLink>}
          <NavLink to="/shop/help" onClick={onClose}>❓ Help &amp; contact</NavLink>
        </div>

        <div className="os-mm-label">Marketplace categories</div>
        <div className="os-mm-section os-mm-cats">
          {(market?.categories || []).map((c) => (
            <button key={c.slug} onClick={() => go(`/market/${c.slug}`)}>
              <span>{c.icon} {c.name}</span>
              <small>{c.count || ''}</small>
            </button>
          ))}
        </div>

        <div className="os-mm-label">Shop by category</div>
        <div className="os-mm-section os-mm-cats">
          <button onClick={() => go('/shop?category=All')}><span>✨ All products</span><small>{products.length}</small></button>
          {categories.map(([c, n]) => (
            <button key={c} onClick={() => go(`/shop?category=${encodeURIComponent(c)}`)}>
              <span>{CAT_ICON[c] || '🛍️'} {c}</span>
              <small>{n}</small>
            </button>
          ))}
        </div>

        <div className="os-mm-label">Need help?</div>
        <div className="os-mm-section">
          <button onClick={() => { onClose(); openWhatsApp(); }}>🟢 WhatsApp us</button>
          <button onClick={() => { onClose(); openSupportChat(); }}>💬 Live chat</button>
          {STORE_INFO.phone && <a href={`tel:${STORE_INFO.phone.replace(/\s/g, '')}`}>📞 Call {STORE_INFO.phone}</a>}
        </div>

        {customer && <button className="os-mm-logout" onClick={() => { onClose(); logout(); navigate('/shop'); }}>Log out</button>}
        {STORE_INFO.address && <p className="os-mm-foot">📍 {STORE_INFO.address}</p>}
      </nav>
    </div>
  );
}
