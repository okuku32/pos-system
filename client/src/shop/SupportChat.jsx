import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import shopApi, { errMsg, firstName, prettyPhone, store } from './shopApi';
import { useShop } from './ShopContext';
import { connectSocket, chime } from '../realtime';
import { STORE_INFO } from './storeInfo';

// Floating customer support chat. Works without an account: the conversation is remembered in this
// browser by a secret token. Open it from anywhere with window.dispatchEvent(new Event('ordersasa:chat')).
const KEY = 'ordersasa_support';
const TOPICS = [
  ['order', '📦 My order'],
  ['delivery', '🛵 Delivery'],
  ['payment', '💳 Payment'],
  ['product', '🛍️ A product'],
  ['other', '💬 Something else'],
];
const fmt = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export const openSupportChat = () => window.dispatchEvent(new Event('ordersasa:chat'));

export default function SupportChat() {
  const { customer, orders } = useShop();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(() => store.get(KEY, null));
  const [thread, setThread] = useState(null);
  const [form, setForm] = useState({ name: '', contact: '', topic: 'order', orderNo: '', message: '' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState(0);
  const listRef = useRef();
  const openRef = useRef(open);
  openRef.current = open;

  // Open from anywhere (Help page buttons) and from email links: /shop/help?chat=<token>
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('ordersasa:chat', onOpen);
    return () => window.removeEventListener('ordersasa:chat', onOpen);
  }, []);
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('chat');
    if (t && /^[a-f0-9]{32}$/.test(t)) {
      store.set(KEY, t);
      setToken(t);
      setOpen(true);
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  // Pre-fill from the customer's account
  useEffect(() => {
    if (customer) setForm((f) => ({ ...f, name: f.name || customer.name, contact: f.contact || customer.email }));
  }, [customer]);

  const markRead = useCallback(() => {
    if (token) shopApi.post(`/support/threads/${token}/read`).catch(() => {});
    setUnread(0);
  }, [token]);

  // Load the conversation and follow it live
  const threadRef = useRef(null);
  threadRef.current = thread;
  useEffect(() => {
    if (!token) return undefined;
    shopApi
      .get(`/support/threads/${token}`)
      .then((r) => {
        setThread(r.data);
        setUnread(r.data.unread || 0);
      })
      .catch((e) => {
        if (e.response?.status === 404) {
          store.set(KEY, null);
          setToken(null);
          setThread(null);
        }
      });
    const socket = connectSocket({ support: token });
    socket.on('support:update', (t) => {
      // New staff replies = staff messages we haven't seen before (side effects kept out of setState)
      const seen = new Set((threadRef.current?.messages || []).map((m) => String(m.id)));
      const fresh = threadRef.current ? t.messages.filter((m) => m.from === 'staff' && !seen.has(String(m.id))) : [];
      setThread((prev) => (prev ? { ...prev, ...t } : prev));
      if (!fresh.length) return;
      chime();
      if (!openRef.current) {
        setUnread((u) => u + fresh.length);
        const last = fresh[fresh.length - 1];
        toast(`${last.staffName || 'Ordersasa'}: ${last.text.slice(0, 80)}`, { icon: '💬', duration: 6000, id: 'support-reply' });
      }
    });
    return () => socket.disconnect();
  }, [token]);

  useEffect(() => {
    if (open && unread) markRead();
  }, [open, unread, markRead]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [thread?.messages?.length, open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    const c = form.contact.trim();
    try {
      const { data } = await shopApi.post('/support/threads', {
        name: form.name,
        email: c.includes('@') ? c : '',
        phone: c.includes('@') ? '' : c,
        topic: form.topic,
        orderNo: form.orderNo,
        message: form.message,
      });
      store.set(KEY, data.token);
      setToken(data.token);
      setThread(data);
      setForm((f) => ({ ...f, message: '' }));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !token) return;
    setDraft('');
    // optimistic message
    setThread((t) => ({ ...t, status: 'open', messages: [...t.messages, { id: `tmp-${Date.now()}`, from: 'customer', text, at: new Date().toISOString(), pending: true }] }));
    try {
      const { data } = await shopApi.post(`/support/threads/${token}/messages`, { message: text });
      setThread(data);
    } catch (err) {
      toast.error(errMsg(err));
      setDraft(text);
      setThread((t) => ({ ...t, messages: t.messages.filter((m) => !m.pending) }));
    }
  };

  const newConversation = () => {
    store.set(KEY, null);
    setToken(null);
    setThread(null);
  };

  const recentOrders = orders.slice(0, 5);

  return (
    <>
      <button className={`os-chat-fab ${open ? 'hidden' : ''}`} onClick={() => setOpen(true)} aria-label="Chat with customer support">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" /></svg>
        <span className="os-chat-fab-label">Need help?</span>
        {unread > 0 && <span className="os-cart-count">{unread}</span>}
      </button>

      <section className={`os-chat ${open ? 'open' : ''}`} aria-label="Customer support chat" aria-hidden={!open}>
        <header className="os-chat-head">
          <div className="os-chat-agent">
            <span className="os-chat-avatar">🛍️<i /></span>
            <div>
              <b>Ordersasa support</b>
              <small>📍 {STORE_INFO.location} · we usually reply within minutes</small>
            </div>
          </div>
          <button className="os-icon-btn dark" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
        </header>

        {!thread ? (
          <form className="os-chat-body os-chat-start" onSubmit={start}>
            <div className="os-chat-bubble staff intro">
              Hi{customer ? ` ${firstName(customer.name)}` : ''} 👋 Karibu Ordersasa! Ask us anything about an order, delivery, payment or a product.
              You don’t need an account.
            </div>
            <div className="os-chat-topics" role="radiogroup" aria-label="What is it about?">
              {TOPICS.map(([k, label]) => (
                <button type="button" key={k} role="radio" aria-checked={form.topic === k} className={form.topic === k ? 'on' : ''} onClick={() => setForm({ ...form, topic: k })}>{label}</button>
              ))}
            </div>
            {(form.topic === 'order' || form.topic === 'delivery' || form.topic === 'payment') && (
              recentOrders.length ? (
                <label className="os-field"><span>Which order? <em>(optional)</em></span>
                  <select value={form.orderNo} onChange={set('orderNo')}>
                    <option value="">Not about a specific order</option>
                    {recentOrders.map((o) => <option key={o.orderNo} value={o.orderNo}>{o.orderNo} · {new Date(o.createdAt).toLocaleDateString()}</option>)}
                  </select>
                </label>
              ) : (
                <label className="os-field"><span>Order number <em>(optional)</em></span><input value={form.orderNo} onChange={set('orderNo')} maxLength={30} placeholder="e.g. ORD-261110-AB12" /></label>
              )
            )}
            {!customer && (
              <>
                <label className="os-field"><span>Your name</span><input value={form.name} onChange={set('name')} required minLength={2} maxLength={60} autoComplete="name" /></label>
                <label className="os-field"><span>Phone or email (so we can reply)</span><input value={form.contact} onChange={set('contact')} required maxLength={120} placeholder="07XX XXX XXX or you@example.com" /></label>
              </>
            )}
            {customer && <p className="os-fine">Chatting as <b>{customer.name}</b> · {prettyPhone(customer.phone)}</p>}
            <label className="os-field"><span>Your message</span><textarea rows={3} value={form.message} onChange={set('message')} required maxLength={2000} placeholder="How can we help?" /></label>
            <button className="os-btn os-btn-brand os-block" disabled={busy}>{busy ? <span className="os-spinner" /> : 'Start chat'}</button>
          </form>
        ) : (
          <>
            <div className="os-chat-body" ref={listRef}>
              <div className="os-chat-meta">Conversation {thread.ticketNo}{thread.orderNo ? ` · about ${thread.orderNo}` : ''}</div>
              {thread.messages.map((m) => (
                <div key={m.id} className={`os-chat-row ${m.from}`}>
                  <div className={`os-chat-bubble ${m.from} ${m.pending ? 'pending' : ''}`}>
                    {m.from === 'staff' && <b className="os-chat-name">{m.staffName || 'Ordersasa'}</b>}
                    <span>{m.text}</span>
                    <small>{m.pending ? 'Sending…' : fmt(m.at)}</small>
                  </div>
                </div>
              ))}
              {thread.messages.every((m) => m.from === 'customer') && (
                <div className="os-chat-wait">✅ Message sent. A member of our team will reply here shortly, and you can close this window; we’ll keep the conversation.</div>
              )}
              {thread.status === 'closed' && (
                <div className="os-chat-wait">This conversation was marked as resolved. Send a message to reopen it, or <button type="button" className="os-linkbtn" onClick={newConversation}>start a new one</button>.</div>
              )}
            </div>
            <form className="os-chat-compose" onSubmit={send}>
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Type a message…"
                maxLength={2000}
                aria-label="Message"
              />
              <button className="os-send" disabled={!draft.trim()} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 14-7-5 14-2.5-5.5L5 12Z" /></svg>
              </button>
            </form>
          </>
        )}
      </section>
    </>
  );
}
