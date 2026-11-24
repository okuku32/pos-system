import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import shopApi, { errMsg, firstName, prettyPhone, store } from './shopApi';
import { useShop } from './ShopContext';
import { connectSocket, chime } from '../realtime';
import { STORE_INFO } from './storeInfo';
import { openWhatsApp } from './WhatsAppSupport';
import { SiteName } from '../components/BrandName';

// Floating customer support chat. Works without an account: the conversation is remembered in this
// browser by a secret token. Open it from anywhere with window.dispatchEvent(new Event('kapu:chat')).
const KEY = 'kapu_support';
const TOPICS = [
  ['order', '📦 My order'],
  ['delivery', '🛵 Delivery'],
  ['payment', '💳 Payment'],
  ['product', '🛍️ A product'],
  ['other', '💬 Something else'],
];
const fmt = (date) => new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export const openSupportChat = () => window.dispatchEvent(new Event('kapu:chat'));

export default function SupportChat() {
  const { customer, orders } = useShop();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // "me": this browser has a conversation; its secret is in an httpOnly cookie the page can't read
  const [token, setToken] = useState(() => (store.get(KEY, null) === 'me' ? 'me' : null));
  // pages from before kept the secret itself in localStorage: move it into the cookie once, then forget it
  useEffect(() => {
    const old = store.get(KEY, null);
    if (typeof old === 'string' && /^[a-f0-9]{32}$/.test(old)) {
      shopApi.post('/support/session', { token: old }).then(() => { store.set(KEY, 'me'); setToken('me'); }).catch(() => store.set(KEY, null));
    }
  }, []);
  const [thread, setThread] = useState(null);
  const [form, setForm] = useState({ name: '', contact: '', topic: 'order', orderNo: '', message: '' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState(0);
  const listRef = useRef();
  const openRef = useRef(open);
  openRef.current = open;

  // Open from anywhere (Help page buttons) and from email links: /help?chat=<token>
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('kapu:chat', onOpen);
    return () => window.removeEventListener('kapu:chat', onOpen);
  }, []);
  useEffect(() => {
    const value = new URLSearchParams(location.search).get('chat');
    if (value && /^[a-f0-9]{32}$/.test(value)) {
      navigate(location.pathname, { replace: true }); // the secret leaves the address bar at once
      shopApi.post('/support/session', { token: value }).then(() => {
        store.set(KEY, 'me');
        setToken('me');
        setOpen(true);
      }).catch(() => toast.error('That conversation link is no longer valid'));
    }
  }, [location.search, location.pathname, navigate]);

  // Pre-fill from the customer's account
  useEffect(() => {
    if (customer) setForm((previousForm) => ({ ...previousForm, name: previousForm.name || customer.name, contact: previousForm.contact || customer.email }));
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
      .then((response) => {
        setThread(response.data);
        setUnread(response.data.unread || 0);
      })
      .catch((error) => {
        if (error.response?.status === 404) {
          store.set(KEY, null);
          setToken(null);
          setThread(null);
        }
      });
    const socket = connectSocket({ support: token });
    socket.on('support:update', (payload) => {
      // New staff replies = staff messages we haven't seen before (side effects kept out of setState)
      const seen = new Set((threadRef.current?.messages || []).map((message) => String(message.id)));
      const fresh = threadRef.current ? payload.messages.filter((message) => message.from === 'staff' && !seen.has(String(message.id))) : [];
      setThread((prev) => (prev ? { ...prev, ...payload } : prev));
      if (!fresh.length) return;
      chime();
      if (!openRef.current) {
        setUnread((previousUnread) => previousUnread + fresh.length);
        const last = fresh[fresh.length - 1];
        toast(`${last.staffName || STORE_INFO.name}: ${last.text.slice(0, 80)}`, { icon: '💬', duration: 6000, id: 'support-reply' });
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

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const start = async (event) => {
    event.preventDefault();
    setBusy(true);
    const text = form.contact.trim();
    try {
      const { data } = await shopApi.post('/support/threads', {
        name: form.name,
        email: text.includes('@') ? text : '',
        phone: text.includes('@') ? '' : text,
        topic: form.topic,
        orderNo: form.orderNo,
        message: form.message,
      });
      store.set(KEY, 'me'); // the server keeps the secret in an httpOnly cookie
      setToken('me');
      setThread(data);
      setForm((previousForm) => ({ ...previousForm, message: '' }));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !token) return;
    setDraft('');
    // optimistic message
    setThread((previousThread) => ({ ...previousThread, status: 'open', messages: [...previousThread.messages, { id: `tmp-${Date.now()}`, from: 'customer', text, at: new Date().toISOString(), pending: true }] }));
    try {
      const { data } = await shopApi.post(`/support/threads/${token}/messages`, { message: text });
      setThread(data);
    } catch (err) {
      toast.error(errMsg(err));
      setDraft(text);
      setThread((previousThread) => ({ ...previousThread, messages: previousThread.messages.filter((message) => !message.pending) }));
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
              <b><SiteName light /> support</b>
              <small>{STORE_INFO.location ? `📍 ${STORE_INFO.location} · ` : ''}we usually reply within minutes</small>
            </div>
          </div>
          <button className="os-icon-btn dark" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
        </header>

        {!thread ? (
          <form className="os-chat-body os-chat-start" onSubmit={start}>
            <div className="os-chat-bubble staff intro">
              Hi{customer ? ` ${firstName(customer.name)}` : ''} 👋 Karibu <SiteName />! Ask us anything about buying, selling, an order, a payment or an ad.
              You don’t need an account. Prefer WhatsApp? <button type="button" className="os-linkbtn" onClick={() => { setOpen(false); openWhatsApp(); }}>Message us there</button>.
            </div>
            <div className="os-chat-topics" role="radiogroup" aria-label="What is it about?">
              {TOPICS.map(([key, label]) => (
                <button type="button" key={key} role="radio" aria-checked={form.topic === key} className={form.topic === key ? 'on' : ''} onClick={() => setForm({ ...form, topic: key })}>{label}</button>
              ))}
            </div>
            {(form.topic === 'order' || form.topic === 'delivery' || form.topic === 'payment') && (
              recentOrders.length ? (
                <label className="os-field"><span>Which order? <em>(optional)</em></span>
                  <select value={form.orderNo} onChange={set('orderNo')}>
                    <option value="">Not about a specific order</option>
                    {recentOrders.map((recentOrder) => <option key={recentOrder.orderNo} value={recentOrder.orderNo}>{recentOrder.orderNo} · {new Date(recentOrder.createdAt).toLocaleDateString()}</option>)}
                  </select>
                </label>
              ) : (
                <label className="os-field"><span>Order number <em>(optional)</em></span><input value={form.orderNo} onChange={set('orderNo')} maxLength={30} placeholder="e.g. OS261111-AB12C3" /></label>
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
              {thread.messages.map((message) => (
                <div key={message.id} className={`os-chat-row ${message.from}`}>
                  <div className={`os-chat-bubble ${message.from} ${message.pending ? 'pending' : ''}`}>
                    {message.from === 'staff' && <b className="os-chat-name">{message.staffName || <SiteName />}</b>}
                    <span>{message.text}</span>
                    <small>{message.pending ? 'Sending…' : fmt(message.at)}</small>
                  </div>
                </div>
              ))}
              {thread.messages.every((message) => message.from === 'customer') && (
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
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
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
