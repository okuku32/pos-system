import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import shopApi, { SHOP_TOKEN, STAGE, orderKey, store } from './shopApi';
import { connectSocket, chime } from '../realtime';

// Customer session, cart, and live updates for the customer's own orders
const ShopContext = createContext(null);
const CART_KEY = 'ordersasa_cart';

export function ShopProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState(() => store.get(CART_KEY, {})); // { productId: qty }
  const [cartOpen, setCartOpen] = useState(false);
  const [bump, setBump] = useState(0); // animates the cart button when something is added
  const [orders, setOrders] = useState([]); // the customer's orders, kept live
  const listeners = useRef(new Set());

  // ----- session
  useEffect(() => {
    let token = null;
    try {
      token = localStorage.getItem(SHOP_TOKEN);
    } catch {
      /* storage unavailable */
    }
    if (!token) return setReady(true);
    shopApi
      .get('/customers/me')
      .then((r) => setCustomer(r.data))
      .catch(() => localStorage.removeItem(SHOP_TOKEN))
      .finally(() => setReady(true));
  }, []);

  const startSession = ({ token, customer: c }) => {
    localStorage.setItem(SHOP_TOKEN, token);
    setCustomer(c);
  };
  const login = async (loginId, password) => startSession((await shopApi.post('/customers/login', { login: loginId, password })).data);
  const signup = async (data) => startSession((await shopApi.post('/customers/register', data)).data);
  const loginWithGoogle = async (credential) => {
    const { data } = await shopApi.post('/customers/oauth/google', { credential });
    startSession(data);
    return data;
  };
  const logout = () => {
    localStorage.removeItem(SHOP_TOKEN);
    setCustomer(null);
    setOrders([]);
    toast('You’ve been logged out. See you soon!', { icon: '👋' });
  };

  // ----- my orders + live updates
  const refreshOrders = useCallback(() => {
    if (!localStorage.getItem(SHOP_TOKEN)) return Promise.resolve([]);
    return shopApi.get('/customers/orders').then((r) => {
      setOrders(r.data);
      return r.data;
    });
  }, []);

  const onOrderStatus = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  useEffect(() => {
    if (!customer) return undefined;
    refreshOrders().catch(() => {});
    const socket = connectSocket({ customerToken: localStorage.getItem(SHOP_TOKEN) });
    socket.on('connect', () => refreshOrders().catch(() => {}));
    socket.on('order:status', (o) => {
      let changed = false;
      setOrders((list) => {
        const prev = list.find((x) => x.orderNo === o.orderNo);
        changed = prev && orderKey(prev) !== orderKey(o);
        return prev ? list.map((x) => (x.orderNo === o.orderNo ? { ...x, ...o } : x)) : [o, ...list];
      });
      listeners.current.forEach((fn) => fn(o));
      // A gentle heads-up on whatever page they're on
      setTimeout(() => {
        if (!changed) return;
        const s = STAGE[orderKey(o)];
        chime();
        if ('vibrate' in navigator) navigator.vibrate?.(150);
        toast(`${o.orderNo}: ${s?.label || 'updated'}`, { icon: s?.icon || '🔔', duration: 6000, id: `st-${o.orderNo}` });
      }, 0);
    });
    return () => socket.disconnect();
  }, [customer, refreshOrders]);

  // ----- cart
  useEffect(() => {
    store.set(CART_KEY, cart);
  }, [cart]);
  const setQty = useCallback((product, qty) => {
    const v = Math.max(0, Math.min(qty, product.stock));
    if (qty > product.stock) toast.error(`Only ${product.stock} available`, { id: `stock-${product._id}` });
    setCart((c) => {
      const n = { ...c };
      if (v === 0) delete n[product._id];
      else n[product._id] = v;
      return n;
    });
    if (v > 0) setBump((b) => b + 1);
  }, []);
  const clearCart = () => setCart({});

  const activeOrder = useMemo(() => orders.find((o) => o.status === 'open'), [orders]);

  const value = {
    ready, customer, login, signup, loginWithGoogle, logout, setCustomer,
    cart, setQty, clearCart, cartOpen, setCartOpen, bump,
    orders, activeOrder, refreshOrders, onOrderStatus,
  };
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export const useShop = () => useContext(ShopContext);
