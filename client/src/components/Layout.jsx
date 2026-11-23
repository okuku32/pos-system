import { Suspense } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BrandName from './BrandName';
import { RealtimeProvider, useRealtime } from '../context/RealtimeContext';

// Admin area frame (/admin): the owner, admins and moderators. Each sees only their menus; the badge says who they are.
const ROLE_LOOK = {
  owner: { icon: '👑', name: 'Owner', panel: 'Owner panel' },
  admin: { icon: '🛡️', name: 'Admin', panel: 'Admin' },
  moderator: { icon: '🧭', name: 'Moderator', panel: 'Moderation' },
};
function TopBar() {
  const { user, isAdmin, logout, can } = useAuth();
  const { connected, permission, enableDesktop, supportUnread, attention } = useRealtime();
  const links = [
    { to: '/admin', label: 'Dashboard', end: true },
    ...(can('ads') ? [{ to: '/admin/ads', label: 'Ads', badge: attention.reported }] : []),
    ...(can('sellers') ? [{ to: '/admin/sellers', label: 'Sellers', badge: attention.verifyPending }, { to: '/admin/markets', label: 'Markets' }, { to: '/admin/people', label: 'People' }] : []),
    ...(can('orders') ? [{ to: '/admin/orders', label: 'Orders & payouts', badge: attention.refundsDue }, { to: '/admin/field-team', label: 'Field team' }, { to: '/admin/photo-requests', label: 'Photo requests' }, { to: '/admin/promotions', label: 'Promotions' }] : []),
    ...(can('support') ? [{ to: '/admin/support', label: 'Support', badge: supportUnread }, { to: '/admin/reviews', label: 'Reviews of us' }] : []),
    ...(isAdmin ? [{ to: '/admin/team', label: 'Team' }, { to: '/admin/settings', label: 'Settings' }, { to: '/admin/security', label: 'Security log' }] : []),
  ];

  return (
    <header className="topbar no-print">
      <div className="brand"><BrandName /> <small style={{ fontWeight: 500, opacity: 0.6, fontSize: 13 }}>{(ROLE_LOOK[user.role] || ROLE_LOOK.moderator).panel}</small></div>
      <nav>
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end}>
            {link.label}
            {link.badge > 0 && <span className="nav-badge" aria-label={`${link.badge} need attention`}>{link.badge}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="userbox">
        <a className="btn ghost sm" href="/" target="_blank" rel="noreferrer" title="Open the public marketplace">View site ↗</a>
        {permission === 'default' && (
          <button className="btn ghost sm" onClick={enableDesktop} title="Get desktop alerts for support chats and orders">🔔 Enable alerts</button>
        )}
        <span className={`live-dot ${connected ? 'on' : ''}`} title={connected ? 'Live updates connected' : 'Reconnecting…'} />
        <Link to="/admin/password" className="staff-me" title="Change my password">{user.name} <span className={`role-badge role-${user.role}`}>{(ROLE_LOOK[user.role] || ROLE_LOOK.moderator).icon} {(ROLE_LOOK[user.role] || ROLE_LOOK.moderator).name}</span></Link>
        <button className="btn ghost sm" onClick={logout}>Log out</button>
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
          <Suspense fallback={<div className="page-loading" role="status" aria-label="Loading"><span className="page-spinner" /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </RealtimeProvider>
  );
}
