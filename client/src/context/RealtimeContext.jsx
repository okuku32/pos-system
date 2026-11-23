import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getAdminStats, money } from '../api';
import { connectSocket, chime, desktopNotify } from '../realtime';

// Live connection for admins and moderators: support chats and marketplace orders
const RealtimeContext = createContext(null);

export function RealtimeProvider({ children }) {
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [supportUnread, setSupportUnread] = useState(0);
  const [attention, setAttention] = useState({ reported: 0, payoutsDue: 0, refundsDue: 0, verifyPending: 0 });
  const supportListeners = useRef(new Set());
  const orderListeners = useRef(new Set());
  const viewingSupport = useRef(null); // conversation open on screen (no alert for it)

  const refreshSupport = useCallback(() => {
    api.get('/support', { params: { status: 'open' } }).then((response) => setSupportUnread(response.data.unread || 0)).catch(() => {});
  }, []);
  const refreshAttention = useCallback(() => {
    getAdminStats().then((response) => setAttention({ reported: response.data.ads.reported, payoutsDue: response.data.orders.payoutsDue, refundsDue: response.data.orders.refundsDue, verifyPending: response.data.verifyPending || 0 })).catch(() => {});
  }, []);
  const onSupportChange = useCallback((fn) => {
    supportListeners.current.add(fn);
    return () => supportListeners.current.delete(fn);
  }, []);
  const onOrderChange = useCallback((fn) => {
    orderListeners.current.add(fn);
    return () => orderListeners.current.delete(fn);
  }, []);
  const setViewingSupport = useCallback((id) => {
    viewingSupport.current = id;
  }, []);

  useEffect(() => {
    const socket = connectSocket({}); // the staff session cookie identifies me
    socket.on('connect', () => {
      setConnected(true);
      refreshSupport();
      refreshAttention();
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('order:update', (order) => {
      orderListeners.current.forEach((fn) => fn(order));
      if (order.status === 'delivered' || order.payment?.status === 'refund_due') refreshAttention();
      if (order.status === 'placed' && order.history?.length <= 2) {
        desktopNotify(`New order ${order.orderNo}`, `${order.buyer.name} → ${order.seller.name} · ${money(order.total)}`, () => navigate('/admin/orders'));
      }
    });

    const onSupport = (kind) => (value) => {
      supportListeners.current.forEach((fn) => fn(kind, value));
      refreshSupport();
      const fromCustomer = value.lastMessage?.from === 'customer' && (kind === 'new' || kind === 'message');
      if (!fromCustomer || viewingSupport.current === value._id) return;
      chime();
      const who = value.customer?.name || 'A customer';
      desktopNotify(kind === 'new' ? `New support chat from ${who}` : `${who} replied`, value.lastMessage.text.slice(0, 120), () => navigate('/admin/support', { state: { openThread: value._id } }));
      toast(
        (tt) => (
          <div className="order-toast">
            <b>💬 {kind === 'new' ? 'New support chat' : 'New message'}</b>
            <span>{who}</span>
            <span className="muted">{value.lastMessage.text.slice(0, 90)}</span>
            <button className="btn sm" onClick={() => { toast.dismiss(tt.id); navigate('/admin/support', { state: { openThread: value._id } }); }}>Reply</button>
          </div>
        ),
        { duration: 12000, id: `support-${value._id}` }
      );
    };
    socket.on('seller:verify-request', (payload) => {
      refreshAttention();
      toast(`✔ ${payload.name} asked to be verified`, { duration: 8000 });
    });
    socket.on('support:new', onSupport('new'));
    socket.on('support:message', onSupport('message'));
    socket.on('support:read', onSupport('read'));
    return () => socket.disconnect();
  }, [navigate, refreshSupport, refreshAttention]);

  const enableDesktop = async () => {
    if (!('Notification' in window)) return;
    setPermission(await Notification.requestPermission());
  };

  return (
    <RealtimeContext.Provider value={{ connected, permission, enableDesktop, supportUnread, onSupportChange, setViewingSupport, onOrderChange, attention, refreshAttention }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);
