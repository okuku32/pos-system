import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import shopApi, { SHOP_TOKEN, store, signedIn, setSignedIn } from './shopApi';
import { connectSocket, chime } from '../realtime';
import { appToken, isNative, saveAppToken } from '../platform';
import { startPush, stopPush } from '../push';

// The signed-in buyer/seller, their cart, and live updates (chats, orders as buyer, sales as seller)
const ShopContext = createContext(null);
const CART_KEY = 'kapu_market_cart';
const NOTE_LANG_KEY = 'kapu_note_lang'; // 'both' | 'en' | 'sw'

// one notification in the chosen language(s): English, Kiswahili, or both
export function NoteText({ n: request, lang = 'both' }) {
  const en = lang !== 'sw';
  const sw = lang !== 'en' && request.title?.sw;
  return (
    <>
      {en && <b className="os-note-title">{request.title.en}</b>}
      {sw && (en ? <i className="os-note-sw">{request.title.sw}</i> : <b className="os-note-title">{request.title.sw}</b>)}
      {en && request.body?.en && <small className="os-note-body">{request.body.en}</small>}
      {sw && request.body?.sw && <small className="os-note-body os-note-sw">{request.body.sw}</small>}
    </>
  );
}

// open a page inside the app from a toast (outside React Router's components)
const go = (path) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export function ShopProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [ready, setReady] = useState(false);
  // cart: { [listingId]: { qty, item: { _id, slug, title, price, image, stock, sellerId, sellerName, delivery, area, county } } }
  const [cart, setCart] = useState(() => store.get(CART_KEY, {}));
  const [cartOpen, setCartOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const [orders, setOrders] = useState([]); // my orders as a buyer
  const ordersRef = useRef([]); // the same, readable at once inside live-update handlers
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  const [counts, setCounts] = useState({ toHandle: 0, onTheWay: 0 }); // badges
  const [chatUnread, setChatUnread] = useState(0);
  // 🔔 notifications (English & Kiswahili)
  const [notes, setNotes] = useState([]);
  const [notesUnread, setNotesUnread] = useState(0);
  const [socket, setSocket] = useState(null); // the live connection (📞 in-app calls use it too)
  const [noteLang, setNoteLangState] = useState(() => store.get(NOTE_LANG_KEY, 'both'));
  const noteLangRef = useRef(noteLang);
  const setNoteLang = useCallback((listing) => {
    noteLangRef.current = listing;
    setNoteLangState(listing);
    store.set(NOTE_LANG_KEY, listing);
  }, []);
  const awayShown = useRef(false);
  const refreshNotes = useCallback(() => {
    if (!signedIn()) return;
    shopApi.get('/notifications').then((response) => {
      setNotes(response.data.notifications);
      setNotesUnread(response.data.unread);
      // back online: tell them once what they missed (buyers who picked their items, orders…)
      if (!awayShown.current && response.data.unread > 0) {
        awayShown.current = true;
        const carts = response.data.notifications.filter((notification) => !notification.read && notification.kind === 'cart').length;
        const orders = response.data.notifications.filter((notification) => !notification.read && notification.kind === 'order').length;
        const parts = [carts && `${carts} buyer${carts === 1 ? '' : 's'} picked your items`, orders && `${orders} order update${orders === 1 ? '' : 's'}`].filter(Boolean);
        if (parts.length) toast(`While you were away: ${parts.join(' · ')}. Tap 🔔 to see them.`, { icon: '🔔', duration: 7000 });
      }
    }).catch(() => {});
  }, []);
  const markNotesRead = useCallback(() => {
    setNotesUnread(0);
    setNotes((list) => list.map((item) => ({ ...item, read: true })));
    shopApi.post('/notifications/read', {}).catch(() => {});
  }, []);
  // swiped away / ✕ in the 🔔 list
  const removeNote = useCallback((noteId) => {
    const gone = notes.find((item) => item._id === noteId);
    if (gone && !gone.read) setNotesUnread((count) => Math.max(0, count - 1));
    setNotes((list) => list.filter((item) => item._id !== noteId));
    shopApi.delete(`/notifications/${noteId}`).catch(() => {});
  }, [notes]);
  const clearNotes = useCallback(() => {
    setNotes([]);
    setNotesUnread(0);
    shopApi.delete('/notifications').catch(() => {});
  }, []);
  const orderListeners = useRef(new Set());
  const chatListeners = useRef(new Set());

  // ----- session
  useEffect(() => {
    let legacy = false;
    try {
      legacy = !!localStorage.getItem(SHOP_TOKEN);
    } catch {
      /* storage unavailable */
    }
    if (!signedIn() && !legacy) return setReady(true);
    shopApi
      .get('/customers/me')
      .then((response) => {
        setSignedIn(true);
        setCustomer(response.data);
      })
      .catch(() => setSignedIn(false))
      .finally(() => setReady(true));
  }, []);

  // the server set the session cookie; the token in the answer is for API clients and isn't kept here
  const startSession = ({ customer: session, token }) => {
    if (isNative && token) saveAppToken(token); // the Android app keeps the token itself (no cross-site cookies)
    setSignedIn(true);
    setCustomer(session);
    return session;
  };
  const login = async (loginId, password) => startSession((await shopApi.post('/customers/login', { login: loginId, password })).data);
  // creates the account (unverified) and sends the confirmation email; nobody is logged in until they confirm and log in
  const signup = async (data) => (await shopApi.post('/customers/register', data)).data;
  const resendVerification = async (email) => (await shopApi.post('/customers/resend-verification', { email })).data;
  const requestPasswordReset = async (email) => (await shopApi.post('/customers/forgot-password', { email })).data;
  const resetPassword = async (token, password) => {
    const { data } = await shopApi.post('/customers/reset-password', { token, password });
    startSession(data);
    return data;
  };
  // profile: a new seller's { sellerTypes, sellerCategories, location }
  const loginWithGoogle = async (credential, accountType, profile = {}) => {
    const { data } = await shopApi.post('/customers/oauth/google', { credential, accountType, ...(accountType === 'seller' ? profile : {}) });
    startSession(data);
    return data;
  };
  // "I want to buy / sell": remembered on the account (decides where they land, what's shown first)
  const setAccountType = async (accountType) => {
    const { data } = await shopApi.put('/customers/me', { accountType });
    setCustomer(data);
    return data;
  };
  const logout = () => {
    stopPush(shopApi); // this phone stops getting my notifications (Android app)
    shopApi.post('/customers/logout', {}).catch(() => {}).finally(() => saveAppToken(null)); // ends the session on the server too
    setSignedIn(false);
    setCustomer(null);
    setOrders([]);
    setChatUnread(0);
    setNotes([]);
    setNotesUnread(0);
    setCounts({ toHandle: 0, onTheWay: 0 });
    toast('You’ve been logged out. See you soon!', { icon: '👋' });
  };

  // the session ended elsewhere (logged out on another device, password changed, expired): forget it here too
  useEffect(() => {
    const ended = () => {
      setCustomer(null);
      setOrders([]);
      setChatUnread(0);
      setNotes([]);
      setNotesUnread(0);
      setCounts({ toHandle: 0, onTheWay: 0 });
      toast('Your session ended. Please log in again.', { icon: '🔒', id: 'session-ended' });
    };
    window.addEventListener('kapu:signed-out', ended);
    return () => window.removeEventListener('kapu:signed-out', ended);
  }, []);

  // ----- badges and my orders
  const refreshChatUnread = useCallback(() => {
    if (!signedIn()) return Promise.resolve(0);
    return shopApi.get('/market/conversations/unread').then((response) => {
      setChatUnread(response.data.unread);
      return response.data.unread;
    }).catch(() => 0);
  }, []);
  const refreshCounts = useCallback(() => {
    if (!signedIn()) return;
    shopApi.get('/orders/counts').then((response) => setCounts(response.data)).catch(() => {});
  }, []);
  const refreshOrders = useCallback(() => {
    if (!signedIn()) return Promise.resolve([]);
    return shopApi.get('/orders/mine').then((response) => {
      setOrders(response.data);
      return response.data;
    });
  }, []);

  const onChat = useCallback((fn) => {
    chatListeners.current.add(fn);
    return () => chatListeners.current.delete(fn);
  }, []);
  const workListeners = useRef(new Set());
  const onWork = useCallback((fn) => {
    workListeners.current.add(fn);
    return () => workListeners.current.delete(fn);
  }, []);
  const onOrder = useCallback((fn) => {
    orderListeners.current.add(fn);
    return () => orderListeners.current.delete(fn);
  }, []);

  // ----- live connection
  useEffect(() => {
    if (!customer) return undefined;
    refreshOrders().catch(() => {});
    startPush(shopApi); // Android app: push notifications to this phone (when switched on)
    const socket = connectSocket(isNative ? { customerToken: appToken() } : {}); // web: the session cookie identifies me · app: the token
    setSocket(socket);
    const onBack = () => { refreshOrders().catch(() => {}); refreshChatUnread(); refreshCounts(); };
    window.addEventListener('kapu:reconnected', onBack);
    socket.on('connect', () => {
      refreshOrders().catch(() => {});
      refreshChatUnread();
      refreshCounts();
      refreshNotes();
    });
    // 🔔 a live notification: someone put my item in their cart, a new order, my order moved on…
    socket.on('notify', (request) => {
      setNotes((list) => [request, ...list.filter((item) => item._id !== request._id)].slice(0, 40));
      setNotesUnread((previousNotesUnread) => previousNotesUnread + 1);
      const here = request.link && window.location.pathname === request.link.split('?')[0];
      if (here && request.kind === 'order') return; // already looking at it (the page updates by itself)
      chime();
      if (request.kind === 'order' && 'vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
      toast(
        (entryValue) => (
          <span role="button" tabIndex={0} className="os-note-toast" onClick={() => { toast.dismiss(entryValue.id); if (request.link) go(request.link); }}>
            <NoteText n={request} lang={noteLangRef.current} />
          </span>
        ),
        { icon: request.icon || '🔔', duration: request.kind === 'order' ? 9000 : 7000, id: `note-${request._id}` }
      );
      try {
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const listing = noteLangRef.current;
          const title = listing === 'sw' ? request.title.sw : request.title.en;
          const body = listing === 'en' ? request.body.en : listing === 'sw' ? request.body.sw : `${request.body.en}\n${request.title.sw}. ${request.body.sw}`;
          new Notification(title, { body, tag: `note-${request._id}` });
        }
      } catch {
        /* notifications not available */
      }
    });
    socket.on('market:read', () => refreshChatUnread());
    socket.on('market:message', (data) => {
      chatListeners.current.forEach((fn) => fn(data));
      if (String(data.message.from) === String(customer._id)) return;
      refreshChatUnread();
      if (!window.location.pathname.endsWith(`/market/messages/${data.conversation._id}`)) {
        chime();
        toast(
          (entryValue) => (
            <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => { toast.dismiss(entryValue.id); go(`/market/messages/${data.conversation._id}`); }}>
              <b>{data.conversation.other.name}</b>: {data.message.text.slice(0, 80)}
              <br />
              <small style={{ opacity: 0.7 }}>{data.conversation.listing.title} · tap to reply</small>
            </span>
          ),
          { icon: '💬', duration: 7000, id: `chat-${data.conversation._id}` }
        );
      }
    });
    // a job near me (riders & shopping agents)
    socket.on('work:new', (task) => {
      workListeners.current.forEach((fn) => fn(task));
      chime();
      if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200, 100, 300]);
      const text = task.kind === 'delivery' ? `New delivery: ${task.shop} → ${task.to || task.area}${task.km ? ` (${task.km} km)` : ''}` : task.kind === 'verification' ? `🛡️ Safe deal ${task.orderNo}: a seller is bringing an item to verify` : `New inspection at ${task.shop}`;
      const pay = task.collectCash ? `collect KSh ${task.collectCash.toLocaleString('en-KE')} cash` : `pays KSh ${Number(task.pay).toLocaleString('en-KE')}`;
      toast(
        (entryValue) => (
          <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => { toast.dismiss(entryValue.id); go('/work'); }}>
            <b>{text}</b>
            <br />
            <small style={{ opacity: 0.75 }}>{pay} · {task.kind === 'verification' ? 'tap to see it' : 'tap to accept'}</small>
          </span>
        ),
        { icon: task.kind === 'delivery' ? '🏍️' : '🔍', duration: 15000, id: `job-${task._id}` }
      );
      try {
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(text, { body: `${pay}. Open Kapu to accept.`, tag: `job-${task._id}` });
      } catch {
        /* notifications not available */
      }
    });
    // a partner shop needs a shopping agent's help with a verification (agents near it)
    socket.on('work:help', (ask) => {
      chime();
      toast(
        (entryValue) => (
          <span>
            <b>🛡️ {ask.shop} needs help verifying an item</b>
            <br />
            <small style={{ opacity: 0.8 }}>{ask.note} · {ask.address || ask.area}</small>
            <br />
            {ask.phone && <a href={`tel:+${ask.phone}`} onClick={() => toast.dismiss(entryValue.id)}>📞 Call the shop</a>}
          </span>
        ),
        { icon: '🤝', duration: 30000, id: `help-${ask.task}` }
      );
    });
    socket.on('work:confirmed', (order) => {
      workListeners.current.forEach((fn) => fn(order));
      if (order.done) toast.success(`${order.orderNo}: the buyer confirmed. Job complete 🎉`, { duration: 7000 });
      else toast(`${order.orderNo}: the buyer confirmed they got it. Tap “Delivered” to finish.`, { icon: '✅', duration: 7000 });
    });
    socket.on('work:tip', (order) => {
      workListeners.current.forEach((fn) => fn(order));
      chime();
      toast.success(`🙏 ${order.from} tipped you KSh ${Number(order.amount).toLocaleString('en-KE')} for ${order.orderNo}. Check your M-Pesa!`, { duration: 10000 });
    });
    socket.on('work:paid', (payload) => {
      workListeners.current.forEach((fn) => fn(payload));
      chime();
      toast.success(payload.amount ? `KSh ${Number(payload.amount).toLocaleString('en-KE')} sent to your M-Pesa for ${payload.jobs} job${payload.jobs === 1 ? '' : 's'}${payload.ref ? ` (${payload.ref})` : ''} 🎉` : 'Your pay has been sent by M-Pesa 🎉', { duration: 10000 });
    });
    socket.on('plan:update', (payload) => orderListeners.current.forEach((fn) => fn({ ...payload, isPlan: true })));
    socket.on('agreement:update', (payload) => orderListeners.current.forEach((fn) => fn(payload)));
    socket.on('order:update', (payload) => {
      orderListeners.current.forEach((fn) => fn(payload));
      refreshCounts();
      if (payload.role === 'buyer') {
        // compare with what we knew before this update (read straight away: a state updater may run later)
        const prev = ordersRef.current.find((item) => item._id === payload._id);
        const changed = !prev || prev.status !== payload.status;
        ordersRef.current = prev ? ordersRef.current.map((item) => (item._id === payload._id ? payload : item)) : [payload, ...ordersRef.current];
        setOrders((list) => (list.some((item) => item._id === payload._id) ? list.map((item) => (item._id === payload._id ? payload : item)) : [payload, ...list]));
        void changed; // the 🔔 "notify" event tells the buyer (in English & Kiswahili)
      }
    });
    return () => {
      window.removeEventListener('kapu:reconnected', onBack);
      setSocket(null);
      socket.disconnect();
    };
  }, [customer, refreshOrders, refreshChatUnread, refreshCounts, refreshNotes]);

  // ----- cart (items that can be bought online)
  useEffect(() => {
    store.set(CART_KEY, cart);
  }, [cart]);
  const addToCart = useCallback((item, qty = 1) => {
    if (item?._id && qty > 0) shopApi.post('/notifications/cart', { listingId: item._id, qty }).catch(() => {}); // the seller hears about it
    setCart((previousCart) => {
      const have = previousCart[item._id]?.qty || 0;
      const want = Math.min(item.stock, have + qty);
      if (have + qty > item.stock) toast.error(`Only ${item.stock} available`, { id: `stock-${item._id}` });
      return { ...previousCart, [item._id]: { qty: want, item } };
    });
    setBump((previousBump) => previousBump + 1);
  }, []);
  const setQty = useCallback((id, qty) => {
    setCart((previousCart) => {
      if (!previousCart[id]) return previousCart;
      const number = { ...previousCart };
      const max = previousCart[id].item.stock;
      if (qty > max) toast.error(`Only ${max} available`, { id: `stock-${id}` });
      const amount = Math.max(0, Math.min(qty, max));
      if (amount === 0) delete number[id];
      else number[id] = { ...previousCart[id], qty: amount };
      return number;
    });
  }, []);
  const removeFromCart = useCallback((id) => setQty(id, 0), [setQty]);
  const clearCart = (ids) => setCart((previousCart) => {
    if (!ids) return {};
    const number = { ...previousCart };
    ids.forEach((id) => delete number[id]);
    return number;
  });
  const cartCount = useMemo(() => Object.values(cart).reduce((total, entryValue) => total + entryValue.qty, 0), [cart]);
  const activeOrder = useMemo(() => orders.find((order) => ['placed', 'confirmed', 'shipped'].includes(order.status)), [orders]);

  const value = {
    ready, customer, setCustomer, login, signup, resendVerification, loginWithGoogle, requestPasswordReset, resetPassword, logout, setAccountType,
    cart, cartCount, addToCart, setQty, removeFromCart, clearCart, cartOpen, setCartOpen, bump,
    orders, activeOrder, refreshOrders, onOrder, counts, refreshCounts,
    chatUnread, refreshChatUnread, onChat, onWork,
    notes, notesUnread, refreshNotes, markNotesRead, removeNote, clearNotes, noteLang, setNoteLang, socket,
  };
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export const useShop = () => useContext(ShopContext);
