import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { money } from '../api';
import { connectSocket, chime, desktopNotify } from '../realtime';

// Live connection for logged-in staff: new-order alerts, a badge count, and a way for pages to refresh
const RealtimeContext = createContext(null);

export function RealtimeProvider({ children }) {
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [newOnline, setNewOnline] = useState(0); // online orders still at stage "new"
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const listeners = useRef(new Set());
  const [supportUnread, setSupportUnread] = useState(0);
  const supportListeners = useRef(new Set());
  const saleListeners = useRef(new Set());
  const onSale = useCallback((fn) => {
    saleListeners.current.add(fn);
    return () => saleListeners.current.delete(fn);
  }, []);
  const viewingSupport = useRef(null); // id of the conversation open on screen (no alert for it)

  const refreshCount = useCallback(() => {
    api.get('/orders', { params: { status: 'open', source: 'online' } })
      .then((r) => setNewOnline(r.data.newOnline || 0))
      .catch(() => {});
  }, []);

  const refreshSupport = useCallback(() => {
    api.get('/support', { params: { status: 'open' } }).then((r) => setSupportUnread(r.data.unread || 0)).catch(() => {});
  }, []);
  const onSupportChange = useCallback((fn) => {
    supportListeners.current.add(fn);
    return () => supportListeners.current.delete(fn);
  }, []);
  const setViewingSupport = useCallback((id) => { viewingSupport.current = id; }, []);

  // Pages (e.g. Orders) subscribe to be told when any order changes
  const onOrderChange = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  useEffect(() => {
    const socket = connectSocket({ token: localStorage.getItem('pos_token') });
    const notifyAll = (evt, order) => listeners.current.forEach((fn) => fn(evt, order));

    socket.on('connect', () => {
      setConnected(true);
      refreshCount(); // catch up on anything missed while disconnected
      refreshSupport();
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('order:new', (order) => {
      notifyAll('new', order);
      if (order.source !== 'online') return; // orders made at the counter don't need an alert
      refreshCount();
      chime();
      const who = order.customer?.name || 'A customer';
      const kind = order.type === 'delivery' ? 'Delivery' : 'Pickup';
      desktopNotify(`New online order ${order.orderNo}`, `${who} · ${kind} · ${money(order.total)}`, () => navigate('/orders'));
      toast(
        (t) => (
          <div className="order-toast">
            <b>🛒 New online order</b>
            <span>{order.orderNo} · {who}</span>
            <span className="muted">{kind} · {order.items.length} item(s) · {money(order.total)}</span>
            <button
              className="btn sm"
              onClick={() => {
                toast.dismiss(t.id);
                navigate('/orders', { state: { openOrder: order._id } });
              }}
            >
              View order
            </button>
          </div>
        ),
        { duration: 15000, id: `order-${order._id}` }
      );
    });

    // Support chat
    const onSupport = (kind) => (t) => {
      supportListeners.current.forEach((fn) => fn(kind, t));
      refreshSupport();
      const fromCustomer = t.lastMessage?.from === 'customer' && (kind === 'new' || kind === 'message');
      if (!fromCustomer || viewingSupport.current === t._id) return;
      chime();
      const who = t.customer?.name || 'A customer';
      desktopNotify(kind === 'new' ? `New support chat from ${who}` : `${who} replied`, t.lastMessage.text.slice(0, 120), () => navigate('/support', { state: { openThread: t._id } }));
      toast(
        (tt) => (
          <div className="order-toast">
            <b>💬 {kind === 'new' ? 'New support chat' : 'New message'}</b>
            <span>{who}</span>
            <span className="muted">{t.lastMessage.text.slice(0, 90)}</span>
            <button className="btn sm" onClick={() => { toast.dismiss(tt.id); navigate('/support', { state: { openThread: t._id } }); }}>Reply</button>
          </div>
        ),
        { duration: 12000, id: `support-${t._id}` }
      );
    };
    socket.on('sale:completed', (s) => saleListeners.current.forEach((fn) => fn(s)));
    socket.on('support:new', onSupport('new'));
    socket.on('support:message', onSupport('message'));
    socket.on('support:read', onSupport('read'));

    socket.on('order:updated', (order) => {
      notifyAll('updated', order);
      if (order.source === 'online') refreshCount();
    });

    return () => socket.disconnect();
  }, [navigate, refreshCount, refreshSupport]);

  const enableDesktop = async () => {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === 'granted') desktopNotify('Notifications enabled', 'You will be alerted about new online orders.');
  };

  return (
    <RealtimeContext.Provider value={{ connected, newOnline, permission, enableDesktop, onOrderChange, supportUnread, onSupportChange, setViewingSupport, onSale }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);
