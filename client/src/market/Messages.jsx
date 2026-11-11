import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, clockTime, errMsg, imgUrl, priceText, timeAgo, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { catIcon } from './ListingCard';
import './market.css';

// Buyer ↔ seller inbox. Messages arrive live (Socket.IO) on every open tab and phone.
export default function Messages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { customer, ready, onChat, refreshChatUnread } = useShop();
  const [list, setList] = useState(null);
  const [thread, setThread] = useState(null); // { conversation, messages, listingStatus }
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef(null);
  const openId = useRef(id);
  openId.current = id;
  useSeo({ title: 'Messages', noindex: true });

  // the floating help buttons would cover the message box
  useEffect(() => {
    document.body.classList.add('mk-hide-fabs');
    return () => document.body.classList.remove('mk-hide-fabs');
  }, []);

  const loadList = () => api.get('/market/conversations').then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e)));

  useEffect(() => {
    if (customer) loadList();
  }, [customer]);

  useEffect(() => {
    if (!customer || !id) {
      setThread(null);
      return;
    }
    let live = true;
    setThread(null);
    api
      .get(`/market/conversations/${id}/messages`)
      .then((r) => {
        if (!live) return;
        setThread(r.data);
        setList((l) => l?.map((c) => (c._id === id ? { ...c, unread: 0 } : c)));
        refreshChatUnread();
      })
      .catch((e) => {
        toast.error(errMsg(e));
        navigate('/market/messages', { replace: true });
      });
    return () => {
      live = false;
    };
  }, [id, customer, navigate, refreshChatUnread]);

  // live messages
  useEffect(
    () =>
      onChat(({ conversation, message }) => {
        setList((l) => {
          if (!l) return l;
          const rest = l.filter((c) => c._id !== conversation._id);
          const mineOpen = openId.current === conversation._id;
          return [{ ...conversation, unread: mineOpen ? 0 : conversation.unread }, ...rest];
        });
        if (openId.current === conversation._id) {
          setThread((t) => (t && !t.messages.some((m) => m._id === message._id) ? { ...t, messages: [...t.messages, message] } : t));
          if (String(message.from) !== String(customer?._id)) api.post(`/market/conversations/${conversation._id}/read`).then(refreshChatUnread).catch(() => {});
        }
      }),
    [onChat, customer, refreshChatUnread]
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages?.length]);

  if (ready && !customer) return <Navigate to={`/shop/login?next=${encodeURIComponent(id ? `/market/messages/${id}` : '/market/messages')}`} replace />;

  const send = async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || !thread) return;
    setSending(true);
    setText('');
    try {
      const r = await api.post(`/market/conversations/${id}/messages`, { text: t });
      setThread((th) => (th.messages.some((m) => m._id === r.data.message._id) ? th : { ...th, messages: [...th.messages, r.data.message] }));
    } catch (err) {
      setText(t);
      toast.error(errMsg(err));
    } finally {
      setSending(false);
    }
  };

  const c = thread?.conversation;
  const me = String(customer?._id || '');
  return (
    <div className="mk">
      <div className={`mk-wrap mk-inbox ${id ? 'has-thread' : ''}`}>
        <aside className="mk-inbox-list" aria-label="Conversations">
          <h1>Messages</h1>
          {!list && <div className="page-loading"><span className="page-spinner" /></div>}
          {list && list.length === 0 && (
            <div className="os-empty">
              <div className="os-empty-art">💬</div>
              <h4>No messages yet</h4>
              <p>When you chat with a seller, or a buyer contacts you about your ad, it shows up here.</p>
              <Link className="os-btn os-btn-brand" to="/market">Browse ads</Link>
            </div>
          )}
          {list?.map((cv) => (
            <Link key={cv._id} to={`/market/messages/${cv._id}`} className={`mk-conv ${cv._id === id ? 'on' : ''} ${cv.unread ? 'unread' : ''}`}>
              {cv.listing.image ? <img src={imgUrl(cv.listing.image)} alt="" /> : <span className="mk-conv-icon">{catIcon(cv.listing.category)}</span>}
              <span className="mk-conv-text">
                <b>{cv.other.name}<small>{cv.role === 'seller' ? ' · buyer' : ' · seller'}</small></b>
                <span className="mk-conv-ad">{cv.listing.title}</span>
                <span className="mk-conv-last">{String(cv.lastMessage?.from) === me ? 'You: ' : ''}{cv.lastMessage?.text}</span>
              </span>
              <span className="mk-conv-side">
                <small>{cv.lastMessage?.at ? timeAgo(cv.lastMessage.at) : ''}</small>
                {cv.unread > 0 && <span className="mk-badge">{cv.unread}</span>}
              </span>
            </Link>
          ))}
        </aside>

        <section className="mk-thread" aria-label="Conversation">
          {!id && list?.length > 0 && <div className="mk-thread-empty">Choose a conversation</div>}
          {id && !thread && <div className="page-loading"><span className="page-spinner" /></div>}
          {thread && (
            <>
              <header className="mk-thread-head">
                <Link to="/market/messages" className="os-icon-btn mk-only-mobile" aria-label="Back to messages">←</Link>
                <Link to={`/market/item/${c.listing.slug}`} className="mk-thread-ad">
                  {c.listing.image ? <img src={imgUrl(c.listing.image)} alt="" /> : <span className="mk-conv-icon">{catIcon(c.listing.category)}</span>}
                  <span>
                    <b>{c.other.name}</b>
                    <small>{c.listing.title} · {priceText(c.listing.price)}</small>
                  </span>
                </Link>
              </header>
              {thread.listingStatus !== 'active' && (
                <div className="mk-banner sold">{thread.listingStatus === 'sold' ? 'This item has been marked as sold.' : 'This ad is no longer available.'}</div>
              )}
              <div className="mk-msgs">
                <p className="mk-safe-note">🔒 Keep chats here. Never send money before you see the item.</p>
                {thread.messages.map((m, i) => {
                  const mine = String(m.from) === me;
                  const day = new Date(m.at).toDateString();
                  const showDay = i === 0 || new Date(thread.messages[i - 1].at).toDateString() !== day;
                  return (
                    <div key={m._id}>
                      {showDay && <div className="mk-day">{new Date(m.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>}
                      <div className={`mk-msg ${mine ? 'me' : 'them'}`}>
                        {m.text}
                        <small>{clockTime(m.at)}</small>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              <form className="mk-compose" onSubmit={send}>
                <textarea
                  rows={1}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Type a message"
                  aria-label="Message"
                  maxLength={2000}
                />
                <button className="os-send" disabled={!text.trim() || sending} aria-label="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M2 21 23 12 2 3v7l15 2-15 2z" /></svg>
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
