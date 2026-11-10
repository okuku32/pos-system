import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import { useRealtime } from '../context/RealtimeContext';

const TOPIC = { order: '📦 Order', delivery: '🛵 Delivery', payment: '💳 Payment', product: '🛍️ Product', other: '💬 Other' };
const QUICK = [
  'Hi! Thanks for reaching out. Let me check that for you right away.',
  'Your order is being packed and will be on its way shortly.',
  'Your rider is on the way. Please keep your phone nearby.',
  'You can pay with M-Pesa or cash when your order arrives.',
  'We’re at Imara Mall, Mombasa Road. You’re welcome to pick up your order anytime during opening hours.',
];
const when = (d) => {
  const dt = new Date(d);
  const today = new Date().toDateString() === dt.toDateString();
  return today ? dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const prettyPhone = (p = '') => (/^254\d{9}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

export default function Support() {
  const { onSupportChange, setViewingSupport } = useRealtime();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [list, setList] = useState({ threads: [], unread: 0, open: 0 });
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const msgRef = useRef();
  const activeRef = useRef(null);
  activeRef.current = activeId;

  const loadList = useCallback(
    () => api.get('/support', { params: { status: status || undefined, q: q || undefined } }).then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e))),
    [status, q]
  );
  const loadThread = useCallback((id) => api.get(`/support/${id}`).then((r) => setThread(r.data)).catch((e) => toast.error(errMsg(e))), []);

  useEffect(() => {
    const t = setTimeout(loadList, 200);
    return () => clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    setViewingSupport(activeId);
    if (activeId) loadThread(activeId).then(loadList);
    return () => setViewingSupport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // From a notification's "Reply" button
  useEffect(() => {
    const id = location.state?.openThread;
    if (!id) return;
    setActiveId(id);
    navigate('.', { replace: true, state: null });
  }, [location.state, navigate]);

  // Live updates
  useEffect(
    () =>
      onSupportChange((kind, t) => {
        loadList();
        if (t._id === activeRef.current && kind !== 'read') loadThread(t._id);
      }),
    [onSupportChange, loadList, loadThread]
  );

  useEffect(() => {
    msgRef.current?.scrollTo({ top: msgRef.current.scrollHeight, behavior: 'smooth' });
  }, [thread?.messages?.length]);

  const send = async (e) => {
    e?.preventDefault();
    const text = reply.trim();
    if (!text || !activeId) return;
    setSending(true);
    try {
      const { data } = await api.post(`/support/${activeId}/reply`, { message: text });
      setThread(data);
      setReply('');
      loadList();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSending(false);
    }
  };

  const setThreadStatus = async (s) => {
    try {
      const { data } = await api.patch(`/support/${activeId}`, { status: s });
      setThread(data);
      toast.success(s === 'closed' ? 'Marked as resolved' : 'Reopened');
      loadList();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="support">
      <div className="page-head">
        <h2>Customer support</h2>
        <span className="muted">{list.open} open · {list.unread} unread message{list.unread === 1 ? '' : 's'}</span>
      </div>

      <div className="support-grid card">
        <aside className="support-list">
          <div className="support-filters">
            <input placeholder="Search name, phone, email, ticket…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="chips" style={{ margin: '8px 0 0' }}>
              {[['open', 'Open'], ['closed', 'Resolved'], ['', 'All']].map(([k, l]) => (
                <button key={k} className={`chip ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="support-items">
            {list.threads.map((t) => (
              <button key={t._id} className={`support-item ${activeId === t._id ? 'active' : ''} ${t.unreadByStaff ? 'unread' : ''}`} onClick={() => setActiveId(t._id)}>
                <div className="row-between">
                  <b>{t.customer?.name || 'Customer'}</b>
                  <small className="muted">{when(t.lastMessageAt)}</small>
                </div>
                <div className="row-between">
                  <span className="support-preview">{t.lastMessage?.from === 'staff' ? 'You: ' : ''}{t.lastMessage?.text}</span>
                  {t.unreadByStaff > 0 && <span className="nav-badge">{t.unreadByStaff}</span>}
                </div>
                <small className="muted">{TOPIC[t.topic]}{t.orderNo ? ` · ${t.orderNo}` : ''}{t.status === 'closed' ? ' · resolved' : ''}</small>
              </button>
            ))}
            {!list.threads.length && <p className="muted center" style={{ padding: 20 }}>No conversations here.</p>}
          </div>
        </aside>

        <section className="support-thread">
          {!thread || thread._id !== activeId ? (
            <div className="support-empty">
              <div style={{ fontSize: 40 }}>💬</div>
              <p className="muted">{activeId ? 'Loading…' : 'Select a conversation to read and reply.'}</p>
            </div>
          ) : (
            <>
              <header className="support-thread-head">
                <div>
                  <b>{thread.customer?.name}</b> {thread.hasAccount && <span className="badge online">account</span>}
                  <div className="muted" style={{ fontSize: 13 }}>
                    {thread.customer?.phone && <a href={`tel:+${thread.customer.phone}`}>{prettyPhone(thread.customer.phone)}</a>}
                    {thread.customer?.phone && thread.customer?.email && ' · '}
                    {thread.customer?.email && <a href={`mailto:${thread.customer.email}`}>{thread.customer.email}</a>}
                    {' · '}{thread.ticketNo} · {TOPIC[thread.topic]}
                  </div>
                </div>
                <div className="toolbar">
                  {thread.orderNo && (
                    <button className="btn ghost sm" onClick={() => navigate('/orders', { state: { searchOrder: thread.orderNo } })} title="Find this order">
                      {thread.orderNo}
                    </button>
                  )}
                  {thread.status === 'open' ? (
                    <button className="btn ghost sm" onClick={() => setThreadStatus('closed')}>✓ Mark resolved</button>
                  ) : (
                    <button className="btn ghost sm" onClick={() => setThreadStatus('open')}>Reopen</button>
                  )}
                </div>
              </header>

              <div className="support-messages" ref={msgRef}>
                {thread.messages.map((m) => (
                  <div key={m._id} className={`support-msg ${m.from}`}>
                    <div className="support-bubble">
                      {m.from === 'staff' && <b>{m.staffName}</b>}
                      <span>{m.text}</span>
                      <small>{new Date(m.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                    </div>
                  </div>
                ))}
              </div>

              <div className="support-quick">
                {QUICK.map((t) => (
                  <button key={t} className="chip" onClick={() => setReply(t)} title={t}>{t.slice(0, 34)}…</button>
                ))}
              </div>
              <form className="support-compose" onSubmit={send}>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={`Reply to ${thread.customer?.name || 'the customer'}…  (Enter to send, Shift+Enter for a new line)`}
                  rows={2}
                  maxLength={2000}
                />
                <button className="btn" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send'}</button>
              </form>
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                The customer sees your reply instantly in their chat{thread.customer?.email ? ', and we also email it to them' : ''}.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
