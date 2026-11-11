import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Every page is its own small download, fetched the first time it's opened. A customer visiting the shop
// never downloads the POS, reports or platform console, and vice versa.
const page = (load) => lazy(load);
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));

// The staff frame (top bar + live alerts) is only needed after a staff login, so the shop doesn't download it
const Layout = page(() => import('./components/Layout'));
const Login = page(() => import('./pages/Login'));
const POS = page(() => import('./pages/POS'));
const Products = page(() => import('./pages/Products'));
const Suppliers = page(() => import('./pages/Suppliers'));
const Purchases = page(() => import('./pages/Purchases'));
const Expenses = page(() => import('./pages/Expenses'));
const Sales = page(() => import('./pages/Sales'));
const Dashboard = page(() => import('./pages/Dashboard'));
const Users = page(() => import('./pages/Users'));
const Settings = page(() => import('./pages/Settings'));
const Orders = page(() => import('./pages/Orders'));
const Reports = page(() => import('./pages/Reports'));
const Support = page(() => import('./pages/Support'));
const PlatformApp = page(() => import('./platform/PlatformApp'));

const ShopProvider = named(() => import('./shop/ShopContext'), 'ShopProvider');
const ShopLayout = page(() => import('./shop/ShopLayout'));
const ShopHome = page(() => import('./shop/ShopHome'));
const AuthPage = page(() => import('./shop/AuthPage'));
const MyOrders = page(() => import('./shop/MyOrders'));
const TrackOrder = page(() => import('./shop/TrackOrder'));
const HelpPage = page(() => import('./shop/HelpPage'));
const PasswordReset = page(() => import('./shop/PasswordReset'));
const Marketplace = page(() => import('./pages/Marketplace')); // staff moderation

// Marketplace (public ads, search, buyer-seller chat)
const MarketHome = page(() => import('./market/MarketHome'));
const MarketBrowse = page(() => import('./market/MarketBrowse'));
const ListingPage = page(() => import('./market/ListingPage'));
const SellPage = page(() => import('./market/SellPage'));
const MyAds = page(() => import('./market/MyAds'));
const Messages = page(() => import('./market/Messages'));
const SellerPage = page(() => import('./market/SellerPage'));

// After a staff member logs in, quietly fetch the pages they're most likely to open next
// while the browser is idle, so switching pages feels instant.
function usePrefetchStaffPages(user) {
  useEffect(() => {
    if (!user) return undefined;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => {
      import('./pages/POS');
      import('./pages/Orders');
      import('./pages/Sales');
      if (user.role === 'admin') {
        import('./pages/Products');
        import('./pages/Dashboard');
      }
    });
    return () => cancel(id);
  }, [user]);
}

function Loading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading">
      <span className="page-spinner" />
    </div>
  );
}

function Protected({ children, admin }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  // visitors opening the site's main address get the public marketplace; staff log in at /login
  if (!user) return <Navigate to={location.pathname === '/' ? '/market' : '/login'} replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  usePrefetchStaffPages(user);
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Your platform console: manage all clients (separate login) */}
        <Route path="/platform/*" element={<PlatformApp />} />
        <Route path="/login" element={<Login />} />
        {/* Customer shop (customer accounts are separate from staff logins) */}
        <Route element={<ShopProvider><ShopLayout /></ShopProvider>}>
          <Route path="/market" element={<MarketHome />} />
          <Route path="/market/search" element={<MarketBrowse />} />
          <Route path="/market/item/:slug" element={<ListingPage />} />
          <Route path="/market/sell" element={<SellPage />} />
          <Route path="/market/edit/:id" element={<SellPage />} />
          <Route path="/market/my" element={<MyAds />} />
          <Route path="/market/messages" element={<Messages />} />
          <Route path="/market/messages/:id" element={<Messages />} />
          <Route path="/market/seller/:id" element={<SellerPage />} />
          <Route path="/market/:cat" element={<MarketBrowse />} />
          <Route path="/market/:cat/:sub" element={<MarketBrowse />} />
          <Route path="/shop" element={<ShopHome />} />
          <Route path="/shop/orders" element={<MyOrders />} />
          <Route path="/shop/help" element={<HelpPage />} />
          <Route path="/track/:token" element={<TrackOrder />} />
        </Route>
        <Route path="/shop/login" element={<ShopProvider><AuthPage mode="login" /></ShopProvider>} />
        <Route path="/shop/signup" element={<ShopProvider><AuthPage mode="signup" /></ShopProvider>} />
        <Route path="/shop/forgot-password" element={<ShopProvider><PasswordReset mode="forgot" /></ShopProvider>} />
        <Route path="/shop/reset-password" element={<ShopProvider><PasswordReset mode="reset" /></ShopProvider>} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<POS />} />
          <Route path="sales" element={<Sales />} />
          <Route path="orders" element={<Orders />} />
          <Route path="support" element={<Support />} />
          <Route path="reports" element={<Protected admin><Reports /></Protected>} />
          <Route path="dashboard" element={<Protected admin><Dashboard /></Protected>} />
          <Route path="products" element={<Protected admin><Products /></Protected>} />
          <Route path="suppliers" element={<Protected admin><Suppliers /></Protected>} />
          <Route path="purchases" element={<Protected admin><Purchases /></Protected>} />
          <Route path="expenses" element={<Protected admin><Expenses /></Protected>} />
          <Route path="marketplace" element={<Protected admin><Marketplace /></Protected>} />
          <Route path="users" element={<Protected admin><Users /></Protected>} />
          <Route path="settings" element={<Protected admin><Settings /></Protected>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
