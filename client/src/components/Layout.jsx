import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BrandName from './BrandName';
import { RealtimeProvider, useRealtime } from '../context/RealtimeContext';

function TopBar() {
  const { user, isAdmin, logout } = useAuth();
  const { connected, newOnline, permission, enableDesktop, supportUnread } = useRealtime();
  const links = [
    { to: '/', label: 'Checkout', end: true },
    { to: '/orders', label: 'Orders', badge: newOnline },
    { to: '/support', label: 'Support', badge: supportUnread },
    { to: '/sales', label: 'Sales' },
    ...(isAdmin
      ? [
          { to: '/dashboard', label: 'Dashboard' },
          { to: '/reports', label: 'Reports' },
          { to: '/products', label: 'Products' },
          { to: '/suppliers', label: 'Suppliers' },
          { to: '/purchases', label: 'Purchases' },
          { to: '/expenses', label: 'Expenses' },
          { to: '/marketplace', label: 'Marketplace' },
          { to: '/users', label: 'Users' },
          { to: '/settings', label: 'Settings' },
        ]
      : []),
  ];

  return (
    <header className="topbar no-print">
      <div className="brand"><BrandName /> <small style={{ fontWeight: 500, opacity: 0.6, fontSize: 13 }}>POS</small></div>
      <nav>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            {l.label}
            {l.badge > 0 && <span className="nav-badge" aria-label={`${l.badge} new`}>{l.badge}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="userbox">
        <a className="btn ghost sm" href="/market" target="_blank" rel="noreferrer" title="Open the public marketplace">Market ↗</a>
        <a className="btn ghost sm" href="/shop" target="_blank" rel="noreferrer" title="Open the customer shop page">
          Shop ↗
        </a>
        {permission === 'default' && (
          <button className="btn ghost sm" onClick={enableDesktop} title="Get desktop alerts for new online orders">
            🔔 Enable alerts
          </button>
        )}
        <span className={`live-dot ${connected ? 'on' : ''}`} title={connected ? 'Live updates connected' : 'Reconnecting…'} />
        <span>
          {user.name} <small className="muted">({user.role})</small>
        </span>
        <button className="btn ghost sm" onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  );
}

export default function Layout() {
  return (
    <RealtimeProvider>
      <div className="app">
        <TopBar />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </RealtimeProvider>
  );
}
