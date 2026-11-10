import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import POS from './pages/POS';
import Products from './pages/Products';
import Sales from './pages/Sales';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Orders from './pages/Orders';
import Reports from './pages/Reports';
import { ShopProvider } from './shop/ShopContext';
import ShopLayout from './shop/ShopLayout';
import ShopHome from './shop/ShopHome';
import AuthPage from './shop/AuthPage';
import MyOrders from './shop/MyOrders';
import TrackOrder from './shop/TrackOrder';
import HelpPage from './shop/HelpPage';
import Support from './pages/Support';

function Protected({ children, admin }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Ordersasa customer shop (customer accounts are separate from staff logins) */}
      <Route element={<ShopProvider><ShopLayout /></ShopProvider>}>
        <Route path="/shop" element={<ShopHome />} />
        <Route path="/shop/orders" element={<MyOrders />} />
        <Route path="/shop/help" element={<HelpPage />} />
        <Route path="/track/:token" element={<TrackOrder />} />
      </Route>
      <Route path="/shop/login" element={<ShopProvider><AuthPage mode="login" /></ShopProvider>} />
      <Route path="/shop/signup" element={<ShopProvider><AuthPage mode="signup" /></ShopProvider>} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<POS />} />
        <Route path="sales" element={<Sales />} />
        <Route path="orders" element={<Orders />} />
        <Route path="support" element={<Support />} />
        <Route path="reports" element={<Protected admin><Reports /></Protected>} />
        <Route path="dashboard" element={<Protected admin><Dashboard /></Protected>} />
        <Route path="products" element={<Protected admin><Products /></Protected>} />
        <Route path="users" element={<Protected admin><Users /></Protected>} />
        <Route path="settings" element={<Protected admin><Settings /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
