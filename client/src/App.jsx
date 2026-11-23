import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { staffLoginPath } from './api';

// Every page is its own small download, fetched the first time it's opened: a buyer never downloads
// the admin area, and the home page doesn't download the checkout.
// Right after the site opens, the public pages are downloaded quietly in the background (and at once on the
// first touch), so every later tap opens its page instantly instead of waiting for a download.
const PUBLIC_PAGES = new Set();
const page = (load) => {
  PUBLIC_PAGES.add(load);
  return lazy(load);
};
const named = (load, name) => {
  PUBLIC_PAGES.add(load);
  return lazy(() => load().then((result) => ({ default: result[name] })));
};
const ADMIN_LOADERS = new Set();
const adminPage = (load) => { // staff pages: never downloaded for shoppers
  ADMIN_LOADERS.add(load);
  return lazy(load);
};
let adminPreloading = false;
function preloadAdmin() {
  if (adminPreloading) return;
  adminPreloading = true;
  const list = [...ADMIN_LOADERS];
  let index = 0;
  const next = () => {
    const load = list[index++];
    if (load) load().catch(() => {}).finally(next);
  };
  for (let key = 0; key < 3; key++) next();
}
let preloading = false;
function preloadPages() {
  if (preloading) return;
  preloading = true;
  const list = [...PUBLIC_PAGES];
  let index = 0;
  const next = () => {
    const load = list[index++];
    if (load) load().catch(() => {}).finally(next);
  };
  for (let key = 0; key < 3; key++) next(); // three at a time: the page you're on keeps the network first
}

// a thin bar at the top from the moment a link is tapped until the new page is on screen
function RouteProgress() {
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [location.pathname, location.search]);
  useEffect(() => {
    const onTap = (event) => {
      if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const element = event.target.closest?.('a[href]');
      if (!element || element.target === '_blank' || element.hasAttribute('download')) return;
      const url = new URL(element.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      setBusy(true);
    };
    const onNav = () => setBusy(true);
    // the first touch: get everything now (staff: the admin panel)
    const start = () => {
      const net = navigator.connection;
      if (net && (net.saveData === true || /(^|-)2g$/.test(net.effectiveType || ''))) return; // Data saver / 2G: only what's opened
      return /^\/(staff|admin)(\/|$)/.test(window.location.pathname) ? preloadAdmin() : preloadPages();
    };
    document.addEventListener('click', onTap, true);
    window.addEventListener('kapu:navigating', onNav);
    window.addEventListener('pointerdown', start, { once: true, passive: true });
    window.addEventListener('touchstart', start, { once: true, passive: true });
    window.addEventListener('keydown', start, { once: true });
    // otherwise as soon as the browser is idle after the first page has loaded; not on phones that asked to save data
    // (Data saver) or on 2G: there each page's code is fetched when it's opened (or on the first tap)
    const staff = /^\/(staff|admin)(\/|$)/.test(window.location.pathname);
    const conn = navigator.connection;
    const saveData = !!conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || ''));
    if (!saveData) {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
      // staff: the admin panel (so it opens instantly after signing in); everyone else: the shop pages
      const go = () => idle(staff ? preloadAdmin : preloadPages, { timeout: 2500 });
      if (document.readyState === 'complete') go();
      else window.addEventListener('load', go, { once: true });
    }
    return () => {
      document.removeEventListener('click', onTap, true);
      window.removeEventListener('kapu:navigating', onNav);
    };
  }, []);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => setBusy(false), 10000);
    return () => clearTimeout(timer);
  }, [busy]);
  return <div className={`route-progress ${busy ? 'on' : ''}`} aria-hidden="true"><i /></div>;
}

// ----- public marketplace
const ShopProvider = named(() => import('./shop/ShopContext'), 'ShopProvider');
const ShopLayout = page(() => import('./shop/ShopLayout'));
const loadHome = () => import('./market/MarketHome');
const loadBrowse = () => import('./market/MarketBrowse');
const loadListing = () => import('./market/ListingPage');
// "/" is the welcome page (visitors who haven't signed up) or the marketplace (members, or visitors who chose to browse):
// fetch the one this visitor will see at once, with the landing (read straight from storage: no extra code needed first)
const seesWelcome = () => {
  try {
    return localStorage.getItem('kapu_signed_in') !== '1' && localStorage.getItem('kapu_browse_market') !== '1';
  } catch {
    return true;
  }
};
const loadLanding = () => Promise.all([import('./shop/Landing'), seesWelcome() ? import('./shop/AboutPage') : loadHome()]);
const MarketBrowse = page(loadBrowse);
const ListingPage = page(loadListing);
const SellPage = page(() => import('./market/SellPage'));
const MyAds = page(() => import('./market/MyAds'));
const Messages = page(() => import('./market/Messages'));
const PhotoRequests = page(() => import('./market/PhotoRequest')); // 📸 items buyers couldn’t find in a seller’s ads
const SellerPage = page(() => import('./market/SellerPage'));
const Checkout = page(() => import('./market/Checkout'));
const SplitPayPage = page(() => import('./market/SplitPay'));
const RideWithUs = page(() => import('./market/RideWithUs')); // 🛵 parcel delivery around Nairobi (replaced Shop & ride)
const MyOrders = named(() => import('./market/Orders'), 'MyOrders');
const Sales = named(() => import('./market/Orders'), 'Sales');
const SellerHub = page(() => import('./market/SellerHub'));
const OrderDetail = named(() => import('./market/Orders'), 'OrderDetail');
const Account = page(() => import('./market/Account'));
const PlanPage = named(() => import('./market/Plans'), 'PlanPage');
const AgreementForm = named(() => import('./market/Agreement'), 'AgreementForm');
const AgreementPage = named(() => import('./market/Agreement'), 'AgreementPage');
const PolePolePolicy = named(() => import('./market/Agreement'), 'PolePolePolicy');
const NearbySellers = named(() => import('./market/Maps'), 'NearbySellers');
const Importers = page(() => import('./market/Importers'));
const VerifyCentres = page(() => import('./market/VerifyCentres'));
const KapuReviews = page(() => import('./market/KapuReviews'));
const Deliveries = page(() => import('./market/Deliveries'));
const Errands = page(() => import('./market/Errands'));
const ErrandPage = named(() => import('./market/Errands'), 'ErrandPage');
const MarketsNear = named(() => import('./market/Markets'), 'MarketsNear');
const MarketPage = named(() => import('./market/Markets'), 'MarketPage');
const Fashion = page(() => import('./market/Fashion'));
const HelpPage = page(() => import('./shop/HelpPage'));
const AboutPage = page(() => import('./shop/AboutPage'));
const Landing = page(() => import('./shop/Landing')); // "/": who we are + join before launch (visitors), the marketplace (members)
const ContactPage = page(() => import('./shop/ContactPage'));
const AuthPage = page(() => import('./shop/AuthPage'));
const PasswordReset = page(() => import('./shop/PasswordReset'));
const VerifyEmail = page(() => import('./shop/VerifyEmail'));

// ----- admin area (/admin)
// each admin address → its page's code (also used to start downloading it early)
const ADMIN_PAGES = {
  '': () => import('./pages/AdminDashboard'),
  ads: () => import('./pages/Marketplace'),
  orders: () => import('./pages/AdminOrders'),
  sellers: () => import('./pages/AdminSellers'),
  markets: () => import('./pages/AdminMarkets'),
  'field-team': () => import('./pages/FieldTeam'),
  'photo-requests': () => import('./pages/AdminPhotoRequests'),
  promotions: () => import('./pages/AdminPromotions'),
  people: () => import('./pages/AdminPeople'),
  audit: () => import('./pages/AdminAudit'),
  reviews: () => import('./pages/AdminReviews'),
  support: () => import('./pages/Support'),
  team: () => import('./pages/Users'),
  settings: () => import('./pages/AdminSettings'),
  password: () => import('./pages/ChangePassword'),
};
const loadLayout = () => import('./components/Layout');
const Layout = adminPage(loadLayout);
const Login = adminPage(() => import('./pages/Login'));
const ChangePassword = adminPage(ADMIN_PAGES.password);
const AdminDashboard = adminPage(ADMIN_PAGES['']);
const AdminAds = adminPage(ADMIN_PAGES.ads);
const AdminOrders = adminPage(ADMIN_PAGES.orders);
const Support = adminPage(ADMIN_PAGES.support);
const Team = adminPage(ADMIN_PAGES.team);
const AdminSettings = adminPage(ADMIN_PAGES.settings);
const AdminSellers = adminPage(ADMIN_PAGES.sellers);
const AdminMarkets = adminPage(ADMIN_PAGES.markets);
const FieldTeam = adminPage(ADMIN_PAGES['field-team']);
const AdminPhotoRequests = adminPage(ADMIN_PAGES['photo-requests']);
const AdminPromotions = adminPage(ADMIN_PAGES.promotions);
const AdminPeople = adminPage(ADMIN_PAGES.people);
const AdminAudit = adminPage(ADMIN_PAGES.audit);
const AdminReviews = adminPage(ADMIN_PAGES.reviews);
const Work = page(() => import('./market/Work'));

// start downloading the page someone opened (or reloaded) before React even asks for it
export function preloadRoute(path) {
  const text = path.replace(/\/+$/, '') || '/';
  const pre = (...loaders) => loaders.forEach((load) => load().catch(() => {}));
  // admin: the panel's frame and this page, while "who's signed in?" is being asked
  if (text === '/admin' || text.startsWith('/admin/')) return pre(loadLayout, ADMIN_PAGES[text.split('/')[2] || ''] || ADMIN_PAGES['']);
  if (text.startsWith('/staff/')) return pre(() => import('./pages/Login'));
  pre(() => import('./shop/ShopContext'), () => import('./shop/ShopLayout'));
  const go = text === '/' ? loadLanding : text.startsWith('/market/item/') ? loadListing : /^\/(market\/(search|[a-z-]+)|wholesale|imports)/.test(text) && !/^\/market\/(sell|edit|my|messages|seller)/.test(text) ? loadBrowse : null;
  go?.().catch(() => {});
}

// the same frame as the very first loading screen (index.html), so nothing flickers between steps;
// it shows the shop's or the admin panel's colours depending on the address
function Loading() {
  return (
    <div className="boot" role="status" aria-label="Loading">
      <div className="boot-bar"><span className="boot-logo" /><span className="boot-name"><span className="k1">K</span><span className="k2">a</span><span className="k3">p</span><span className="k4">u</span></span></div>
      <div className="boot-spin" />
    </div>
  );
}

// The admin panel: only for signed-in staff. Signed-out visitors go to the public site (or, on a staff
// member's own device, back to their private login link), so the panel's address reveals nothing.
// a category that was renamed: old links (and saved searches) open the new one
function RenamedCategory({ to }) {
  const rest = useParams()['*'];
  return <Navigate to={`/market/${to}${rest ? `/${rest}` : ''}${window.location.search}`} replace />;
}

function AdminOnly({ children, admin, area }) {
  const { user, loading, isAdmin, can } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={staffLoginPath()} replace />;
  if (user.mustChangePassword) return <ChangePassword forced />;
  if (admin && !isAdmin) return <Navigate to="/admin" replace />;
  if (area && !can(area)) return <Navigate to="/admin" replace />;
  return children;
}

// old links (from the earlier shop, emails, bookmarks) keep working
function OldOrderLink() {
  const { id } = useParams();
  return <Navigate to={id ? `/orders/${id}` : '/orders'} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <RouteProgress />
      <Routes>
        {/* buyers and sellers: one session for the whole public site */}
        <Route element={<ShopProvider><Outlet /></ShopProvider>}>
          <Route element={<ShopLayout />}>
            <Route index element={<Landing />} />
            <Route path="market" element={<Navigate to="/" replace />} />
            <Route path="market/search" element={<MarketBrowse />} />
            <Route path="wholesale" element={<MarketBrowse preset="wholesale" />} />
            <Route path="imports" element={<MarketBrowse preset="imports" />} />
            <Route path="sellers-near-me" element={<NearbySellers />} />
            <Route path="wholesalers-near-me" element={<NearbySellers mode="wholesale" />} />
            <Route path="boutiques-near-me" element={<NearbySellers mode="boutique" />} />
            <Route path="boutiques-near-me/men" element={<NearbySellers mode="boutique" wear="men" key="men" />} />
            <Route path="boutiques-near-me/women" element={<NearbySellers mode="boutique" wear="women" key="women" />} />
            <Route path="mama-mboga-near-me" element={<NearbySellers mode="mama-mboga" />} />
            <Route path="chemists-near-me" element={<NearbySellers mode="chemist" key="chemist" />} />
            <Route path="electronics-shops-near-me" element={<NearbySellers mode="electronics" key="electronics" />} />
            <Route path="spare-parts-shops-near-me" element={<NearbySellers mode="spares" key="spares" />} />
            <Route path="baby-shops-near-me" element={<NearbySellers mode="baby" key="baby" />} />
            <Route path="groceries-near-me" element={<NearbySellers mode="grocery" key="grocery" />} />
            <Route path="importers" element={<Importers />} />
            <Route path="verify-centres" element={<VerifyCentres />} />
            <Route path="reviews" element={<KapuReviews />} />
            <Route path="ride-with-us" element={<RideWithUs />} />
            {/* the old address (shared links, saved bookmarks) goes to Ride with us */}
            <Route path="shop-and-ride" element={<Navigate to="/ride-with-us" replace />} />
            <Route path="errands" element={<Errands />} />
            <Route path="deliveries" element={<Deliveries />} />
            <Route path="errands/:id" element={<ErrandPage />} />
            <Route path="importers-near-me" element={<NearbySellers mode="importer" key="importer" />} />
            <Route path="markets-near-me" element={<MarketsNear />} />
            <Route path="markets/:slug" element={<MarketPage />} />
            <Route path="fashion" element={<Fashion />} />
            <Route path="work" element={<Work />} />
            <Route path="imports/:origin" element={<MarketBrowse preset="imports" />} />
            <Route path="lipa-pole-pole" element={<PolePolePolicy />} />
            <Route path="agreements/new" element={<AgreementForm />} />
            <Route path="agreements/:id" element={<AgreementPage />} />
            <Route path="market/item/:slug" element={<ListingPage />} />
            <Route path="market/sell" element={<SellPage />} />
            <Route path="market/edit/:id" element={<SellPage />} />
            <Route path="market/my" element={<MyAds />} />
            <Route path="market/messages" element={<Messages />} />
            <Route path="market/requests" element={<PhotoRequests />} />
            <Route path="market/messages/:id" element={<Messages />} />
            <Route path="market/seller/:id" element={<SellerPage />} />
            <Route path="market/kitchen-equipment/*" element={<RenamedCategory to="appliances" />} />
            <Route path="market/:cat" element={<MarketBrowse />} />
            <Route path="market/:cat/:sub" element={<MarketBrowse />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="pay/:checkoutId" element={<SplitPayPage />} />
            <Route path="orders" element={<MyOrders />} />
            <Route path="orders/:id" element={<OrderDetail as="buyer" />} />
            <Route path="sales" element={<Sales />} />
            <Route path="seller" element={<SellerHub />} />
            <Route path="sales/:id" element={<OrderDetail as="seller" />} />
            <Route path="account" element={<Account />} />
            <Route path="plans/:id" element={<PlanPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="contact" element={<ContactPage />} />
          </Route>
          <Route path="login" element={<AuthPage mode="login" />} />
          <Route path="signup" element={<AuthPage mode="signup" />} />
          <Route path="forgot-password" element={<PasswordReset mode="forgot" />} />
          <Route path="reset-password" element={<PasswordReset mode="reset" />} />
          <Route path="verify-email" element={<VerifyEmail />} />
        </Route>

        {/* marketplace team */}
        <Route path="/staff/:key" element={<Login />} />
        <Route path="/staff" element={<Login />} />
        <Route path="/admin/login" element={<Navigate to="/" replace />} />
        <Route path="/admin" element={<AdminOnly><Layout /></AdminOnly>}>
          <Route index element={<AdminDashboard />} />
          <Route path="ads" element={<AdminOnly area="ads"><AdminAds /></AdminOnly>} />
          <Route path="orders" element={<AdminOnly area="orders"><AdminOrders /></AdminOnly>} />
          <Route path="sellers" element={<AdminOnly area="sellers"><AdminSellers /></AdminOnly>} />
          <Route path="markets" element={<AdminOnly area="sellers"><AdminMarkets /></AdminOnly>} />
          <Route path="field-team" element={<AdminOnly area="orders"><FieldTeam /></AdminOnly>} />
          <Route path="photo-requests" element={<AdminOnly area="orders"><AdminPhotoRequests /></AdminOnly>} />
          <Route path="people" element={<AdminOnly area="sellers"><AdminPeople /></AdminOnly>} />
          <Route path="promotions" element={<AdminOnly area="orders"><AdminPromotions /></AdminOnly>} />
          <Route path="support" element={<AdminOnly area="support"><Support /></AdminOnly>} />
          <Route path="reviews" element={<AdminOnly area="support"><AdminReviews /></AdminOnly>} />
          <Route path="password" element={<ChangePassword />} />
          <Route path="team" element={<AdminOnly admin><Team /></AdminOnly>} />
          <Route path="settings" element={<AdminOnly admin><AdminSettings /></AdminOnly>} />
          <Route path="security" element={<AdminOnly admin><AdminAudit /></AdminOnly>} />
        </Route>

        {/* addresses from the earlier version */}
        <Route path="/shop/login" element={<Navigate to="/login" replace />} />
        <Route path="/shop/signup" element={<Navigate to="/signup" replace />} />
        <Route path="/shop/forgot-password" element={<Navigate to="/forgot-password" replace />} />
        <Route path="/shop/reset-password" element={<Navigate to={`/reset-password${window.location.search}`} replace />} />
        <Route path="/shop/help" element={<Navigate to={`/help${window.location.search}`} replace />} />
        <Route path="/shop/orders" element={<OldOrderLink />} />
        <Route path="/track/:token" element={<OldOrderLink />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
