import { useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useShop } from './ShopContext';
import { STORE_INFO } from './storeInfo';
import Logo from './Logo';
import { openSupportChat } from './SupportChat';
import InstallApp from './InstallApp';
import { openWhatsApp } from './WhatsAppSupport';
import AccountSwitch from './AccountSwitch';
import { useCategories } from '../market/marketApi';

// Phone menu (☰, and "Categories" in the bottom bar): every category, my account pages and help
export default function MobileMenu({ open, onClose }) {
  const navigate = useNavigate();
  const { customer, logout, chatUnread, counts, activeOrder } = useShop();
  const market = useCategories();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (error) => error.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
          <>
            <div className="os-mm-hello">Hi, <b>{customer.name.split(' ')[0]}</b> 👋</div>
            <AccountSwitch variant="menu" onGo={onClose} />
          </>
        ) : (
          <>
            <div className="os-mm-auth">
              <Link className="os-btn os-btn-ghost os-grow" to="/login" onClick={onClose}>Log in</Link>
              <Link className="os-btn os-btn-brand os-grow" to="/signup" onClick={onClose}>Sign up</Link>
            </div>
            <Link className="os-mm-seller-link" to="/signup?as=seller" onClick={onClose}>🏪 Want to sell? Create a seller account →</Link>
          </>
        )}

        <Link className="os-btn os-btn-brand os-mm-sell" to="/market/sell" onClick={onClose}>+ Post a free ad</Link>

        <div className="os-mm-star">
          <button onClick={() => go('/ride-with-us')}><span>🛵</span><b>Ride with us</b><small>Send a parcel anywhere in Nairobi</small></button>
        </div>

        <div className="os-mm-label">Categories</div>
        <div className="os-mm-section os-mm-cats">
          <button onClick={() => go('/market/search')}><span>✨ All ads</span><small>{market?.categories.reduce((value, entryValue) => value + (entryValue.count || 0), 0) || ''}</small></button>
          <button onClick={() => go('/market/search?buyNow=1')}><span>🛒 Buy online (delivered)</span><small /></button>
          <button onClick={() => go('/wholesale')}><span>🏭 Wholesale &amp; bulk</span><small /></button>
          <button onClick={() => go('/imports')}><span>🌍 Imports (ex-UK, China, USA…)</span><small /></button>
          <button onClick={() => go('/sellers-near-me')}><span>📍 Sellers near me</span><small /></button>
          <button onClick={() => go('/wholesalers-near-me')}><span>🏭 Wholesalers near me</span><small /></button>
          <button onClick={() => go('/boutiques-near-me')}><span>👗 Boutiques near me</span><small /></button>
          <button onClick={() => go('/markets-near-me')}><span>🧺 Markets near me</span><small /></button>
          <button onClick={() => go('/chemists-near-me')}><span>💊 Chemists near me</span><small /></button>
          <button onClick={() => go('/electronics-shops-near-me')}><span>📱 Electronics shops near me</span><small /></button>
          <button onClick={() => go('/spare-parts-shops-near-me')}><span>🔧 Motor & spares near me</span><small /></button>
          <button onClick={() => go('/baby-shops-near-me')}><span>🧸 Baby shops near me</span><small /></button>
          <button onClick={() => go('/errands?type=parcel')}><span>🛵 Send a parcel</span><small /></button>
          <button onClick={() => go('/errands?type=shopping')}><span>🛒 Shop for me</span><small /></button>
          {/* food, side by side: mama mboga, samaki, cereals */}
          <button onClick={() => go('/mama-mboga-near-me')}><span>🥬 Mama mboga near me</span><small /></button>
          <button onClick={() => go('/market/samaki')}><span>🐟 Samaki (fish &amp; seafood)</span><small>{market?.categories.find((category) => category.slug === 'samaki')?.count || ''}</small></button>
          <button onClick={() => go('/groceries-near-me')}><span>🌾 Cereals & groceries near me</span><small /></button>
          <button onClick={() => go('/importers')}><span>🚢 Importers: China, ex-UK, Dubai…</span><small /></button>
          <button onClick={() => go('/importers-near-me')}><span>🌍 Importers near me</span><small /></button>
          <button onClick={() => go('/fashion')}><span>👗 Fashion by type</span><small /></button>
          <button onClick={() => go('/work')}><span>🛍️ Ride or shop with us</span><small /></button>
          {(market?.categories || []).map((category) => (
            <button key={category.slug} onClick={() => go(`/market/${category.slug}`)}>
              <span>{category.icon} {category.name}</span>
              <small>{category.count || ''}</small>
            </button>
          ))}
        </div>

        <div className="os-mm-label">My account</div>
        <div className="os-mm-section">
          <NavLink to="/" end onClick={onClose}>🏠 Home</NavLink>
          <NavLink to="/market/messages" onClick={onClose}>💬 Messages{chatUnread > 0 && <span className="os-mm-count">{chatUnread}</span>}</NavLink>
          <NavLink to="/orders" onClick={onClose}>📦 My orders{activeOrder && <span className="os-dot-live" />}</NavLink>
          <NavLink to="/deliveries" onClick={onClose}>🛵 My deliveries</NavLink>
          <NavLink to="/seller" onClick={onClose}>🏪 Seller hub: today’s orders & sales, stock</NavLink>
          <NavLink to="/sales" onClick={onClose}>🧾 Orders to fulfil{counts.toHandle > 0 && <span className="os-mm-count">{counts.toHandle}</span>}</NavLink>
          <NavLink to="/market/my" onClick={onClose}>📢 My ads</NavLink>
          <NavLink to="/market/requests" onClick={onClose}>📸 Photo requests</NavLink>
          {customer && <NavLink to="/account" onClick={onClose}>⚙️ Account settings</NavLink>}
        </div>

        <div className="os-mm-install"><InstallApp variant="menu" /></div>
        <div className="os-mm-label">Need help?</div>
        <div className="os-mm-section">
          <NavLink to="/about" onClick={onClose}>🌍 About us: what we do</NavLink>
          <NavLink to="/contact" onClick={onClose}>📬 Contact us &amp; follow us</NavLink>
          <NavLink to="/help" onClick={onClose}>❓ Help &amp; safety tips</NavLink>
          <button onClick={() => { onClose(); openWhatsApp(); }}>🟢 WhatsApp us</button>
          <button onClick={() => { onClose(); openSupportChat(); }}>💬 Live chat</button>
          {STORE_INFO.phone && <a href={`tel:${STORE_INFO.phone.replace(/\s/g, '')}`}>📞 Call {STORE_INFO.phone}</a>}
        </div>

        {customer && <button className="os-mm-logout" onClick={() => { onClose(); logout(); navigate('/'); }}>Log out</button>}
        {STORE_INFO.address && <p className="os-mm-foot">📍 {STORE_INFO.address}</p>}
      </nav>
    </div>
  );
}
