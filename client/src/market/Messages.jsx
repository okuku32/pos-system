import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, clockTime, errMsg, imgUrl, priceText, timeAgo, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { catIcon } from './ListingCard';
import { AgreeSheet, OfferSheet, VisitSheet } from './Trust';
import Presence from './Presence';
import './market.css';

// Buyer ↔ seller inbox. Messages arrive live (Socket.IO) on every open tab and phone.
export default function Messages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { customer, ready, onChat, refreshChatUnread } = useShop();
  const [list, setList] = useState(null);
  const [thread, setThread] = useState(null); // { conversation, messages, listing, offers }
  const [sheet, setSheet] = useState(null); // 'offer' | 'visit'
  const [countering, setCountering] = useState(null); // offer id
  const [counter, setCounter] = useState('');
  const [agreement, setAgreement] = useState(null);
  useEffect(() => {
    setAgreement(null);
    if (id && customer) api.get(`/agreements/for/${id}`).then((response) => setAgreement(response.data)).catch(() => {});
  }, [id, customer, thread?.messages?.length]);
  const { addToCart, setCartOpen } = useShop();
  const reload = () => api.get(`/market/conversations/${openId.current}/messages`).then((response) => setThread(response.data)).catch(() => {});
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

  const loadList = () => api.get('/market/conversations').then((response) => setList(response.data)).catch((error) => toast.error(errMsg(error)));

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
      .then((response) => {
        if (!live) return;
        setThread(response.data);
        setList((previousList) => previousList?.map((value) => (value._id === id ? { ...value, unread: 0 } : value)));
        refreshChatUnread();
      })
      .catch((error) => {
        toast.error(errMsg(error));
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
        setList((previousList) => {
          if (!previousList) return previousList;
          const rest = previousList.filter((previousItem) => previousItem._id !== conversation._id);
          const mineOpen = openId.current === conversation._id;
          return [{ ...conversation, unread: mineOpen ? 0 : conversation.unread }, ...rest];
        });
        if (openId.current === conversation._id) {
          if (message.kind && message.kind !== 'text') reload();
          else setThread((previousThread) => (previousThread && !previousThread.messages.some((currentMessage) => currentMessage._id === message._id) ? { ...previousThread, messages: [...previousThread.messages, message] } : previousThread));
          if (String(message.from) !== String(customer?._id)) api.post(`/market/conversations/${conversation._id}/read`).then(refreshChatUnread).catch(() => {});
        }
      }),
    [onChat, customer, refreshChatUnread]
  );

  // older messages, a page at a time (the chat opens on the newest 100)
  const keepPlace = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = async () => {
    if (!thread?.messages?.length) return;
    setLoadingOlder(true);
    try {
      const { data } = await api.get(`/market/conversations/${openId.current}/messages`, { params: { before: thread.messages[0]._id } });
      keepPlace.current = true;
      setThread((current) => ({ ...current, messages: [...data.messages, ...current.messages], hasMore: data.hasMore, offers: { ...data.offers, ...current.offers } }));
    } catch {
      /* try again */
    } finally {
      setLoadingOlder(false);
    }
  };
  useEffect(() => {
    if (keepPlace.current) { keepPlace.current = false; return; } // stay where you are after loading older ones
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages?.length]);

  if (ready && !customer) return <Navigate to={`/login?next=${encodeURIComponent(id ? `/market/messages/${id}` : '/market/messages')}`} replace />;

  const send = async (event) => {
    event?.preventDefault();
    const input = text.trim();
    if (!input || !thread) return;
    setSending(true);
    setText('');
    try {
      const response = await api.post(`/market/conversations/${id}/messages`, { text: input });
      setThread((th) => (th.messages.some((message) => message._id === response.data.message._id) ? th : { ...th, messages: [...th.messages, response.data.message] }));
    } catch (err) {
      setText(input);
      toast.error(errMsg(err));
    } finally {
      setSending(false);
    }
  };

  const currentConversation = thread?.conversation;
  const me = String(customer?._id || '');

  const answerVisit = async (messageId, action) => {
    try {
      await api.post(`/market/visits/${messageId}`, { action });
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const respond = async (offerId, action, amount) => {
    try {
      await api.post(`/market/offers/${offerId}`, { action, amount });
      setCountering(null);
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  // an agreed price → the cart (ads not sold online use the delivery the seller agreed)
  const buyAtDeal = (order, now) => {
    const listing = thread.listing;
    const qty = order.qty || 1;
    const delivery = listing.buyNow ? listing.delivery : { available: !!order.delivery?.available, fee: order.delivery?.available ? order.delivery.fee || 0 : 0, pickup: order.delivery?.pickup !== false };
    addToCart({ _id: currentConversation.listing._id, slug: listing.slug, title: currentConversation.listing.title, price: order.amount, image: currentConversation.listing.image, category: listing.category, stock: listing.buyNow ? Math.min(listing.stock || 1, qty) : qty, sellerId: order.seller, sellerName: currentConversation.other.name, offerId: order._id, delivery, area: listing.area, county: listing.county }, qty);
    if (now) navigate('/checkout');
    else {
      toast.success('Added to your cart at the agreed price');
      setCartOpen(true);
    }
  };
  const payable = thread?.listing?.status === 'active' && (thread.listing.buyNow || thread.listing.canBuyOnline);

  // a price-offer card: current status plus what this person can do now
  function OfferCard({ m: match, o: offer, mine }) {
    if (!offer) return <div className={`mk-msg ${mine ? 'me' : 'them'}`}>{match.text}<small>{clockTime(match.at)}</small></div>;
    const iAmSeller = currentConversation.role === 'seller';
    const myTurn = (offer.status === 'pending' && iAmSeller) || (offer.status === 'countered' && !iAmSeller);
    const label = { pending: '⏳ Waiting for the seller', countered: `🔁 Seller countered`, accepted: '🤝 Deal agreed', declined: '✖ Declined', withdrawn: '↩ Withdrawn', used: '✅ Bought', expired: '⌛ Expired' }[offer.status];
    return (
      <div className={`mk-offer-card ${mine ? 'me' : 'them'}`}>
        <small>{offer.history?.at(-1)?.action === 'agree' ? '🤝 Agreed price' : '💰 Price offer'}{offer.listingPrice ? ` · asking ${priceText(offer.listingPrice)}` : ''}</small>
        <b>{priceText(offer.amount)}{offer.qty > 1 ? ` × ${offer.qty}` : ''}</b>
        <span className={`mk-pill ${offer.status === 'accepted' || offer.status === 'used' ? 'done' : offer.status === 'countered' || offer.status === 'pending' ? 'wait' : ''}`}>{label}</span>
        {myTurn && countering !== offer._id && (
          <div className="mk-card-actions">
            <button className="os-btn os-btn-brand" onClick={() => respond(offer._id, 'accept')}>Accept {priceText(offer.amount)}</button>
            {iAmSeller && <button className="os-btn os-btn-ghost" onClick={() => { setCountering(offer._id); setCounter(String(Math.round((offer.amount + offer.listingPrice) / 2 / 100) * 100)); }}>Counter</button>}
            <button className="os-btn os-btn-ghost" onClick={() => respond(offer._id, 'decline')}>Decline</button>
          </div>
        )}
        {countering === offer._id && (
          <form className="mk-card-actions" onSubmit={(event) => { event.preventDefault(); respond(offer._id, 'counter', Number(counter)); }}>
            <input inputMode="numeric" value={counter} onChange={(event) => setCounter(event.target.value.replace(/\D/g, ''))} aria-label="Counter-offer" autoFocus />
            <button className="os-btn os-btn-brand">Send</button>
            <button type="button" className="os-btn os-btn-ghost" onClick={() => setCountering(null)}>✕</button>
          </form>
        )}
        {!iAmSeller && offer.status === 'pending' && <button className="os-linkbtn" onClick={() => respond(offer._id, 'withdraw')}>Withdraw offer</button>}
        {offer.status === 'accepted' && !thread.listing?.buyNow && offer.delivery && payable && (
          <small>{[offer.delivery.pickup ? '📍 Pick up' : '', offer.delivery.available ? `🚚 Delivery ${offer.delivery.fee ? priceText(offer.delivery.fee) : 'free'}` : ''].filter(Boolean).join(' · ')}</small>
        )}
        {!iAmSeller && offer.status === 'accepted' && payable && (
          <div className="mk-deal-actions">
            <button className="os-btn os-btn-brand" onClick={() => buyAtDeal(offer, false)}>🛒 Add to cart at {priceText(offer.amount)}</button>
            <button className="os-btn os-btn-dark" onClick={() => buyAtDeal(offer, true)}>Buy now</button>
          </div>
        )}
        {iAmSeller && offer.status === 'accepted' && payable && <small>The buyer can add it to their cart at this price.</small>}
        {offer.status === 'accepted' && offer.expiresAt && payable && <small>Valid until {new Date(offer.expiresAt).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>}
      </div>
    );
  }
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
              <Link className="os-btn os-btn-brand" to="/">Browse ads</Link>
            </div>
          )}
          {list?.map((cv) => (
            <Link key={cv._id} to={`/market/messages/${cv._id}`} className={`mk-conv ${cv._id === id ? 'on' : ''} ${cv.unread ? 'unread' : ''}`}>
              {cv.listing.image ? <img src={imgUrl(cv.listing.image)} alt="" /> : <span className="mk-conv-icon">{catIcon(cv.listing.category)}</span>}
              <span className="mk-conv-text">
                <b>{cv.role !== 'seller' && <Presence id={cv.other._id} compact />}{cv.other.name}<small>{cv.role === 'seller' ? ' · buyer' : ' · seller'}</small></b>
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
                <Link to={`/market/item/${currentConversation.listing.slug}`} className="mk-thread-ad">
                  {currentConversation.listing.image ? <img src={imgUrl(currentConversation.listing.image)} alt="" /> : <span className="mk-conv-icon">{catIcon(currentConversation.listing.category)}</span>}
                  <span>
                    <b>{currentConversation.other.name} {currentConversation.role !== 'seller' && <Presence id={currentConversation.other._id} />}</b>
                    <small>{currentConversation.listing.title} · {priceText(currentConversation.listing.price)}</small>
                  </span>
                </Link>
              </header>
              {thread.listingStatus !== 'active' && (
                <div className="mk-banner sold">{thread.listingStatus === 'sold' ? 'This item has been marked as sold.' : 'This ad is no longer available.'}</div>
              )}
              <div className="mk-msgs">
                <p className="mk-safe-note">🔒 Keep chats here. Never send money before you see the item.</p>
                {thread.hasMore && <p className="mk-center"><button type="button" className="os-btn os-btn-ghost" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder ? 'Loading…' : '↑ Load earlier messages'}</button></p>}
                {thread.messages.map((message, index) => {
                  const mine = String(message.from) === me;
                  const day = new Date(message.at).toDateString();
                  const showDay = index === 0 || new Date(thread.messages[index - 1].at).toDateString() !== day;
                  return (
                    <div key={message._id}>
                      {showDay && <div className="mk-day">{new Date(message.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>}
                      {message.kind === 'system' ? (
                        <div className="mk-msg-system">{message.text}<small>{clockTime(message.at)}</small></div>
                      ) : message.kind === 'offer' ? (
                        OfferCard({ m: message, o: thread.offers?.[message.offer], mine })
                      ) : message.kind === 'visit' ? (
                        <div className={`mk-msg mk-card-msg ${mine ? 'me' : 'them'}`}>
                          <b>📅 {currentConversation.listing.category === 'land-property' ? 'Site visit' : 'Viewing'} request</b>
                          <span className="mk-visit-when">{new Date(message.visitAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                          {message.text.split('\n')[1] && <span>{message.text.split('\n').slice(1).join(' ')}</span>}
                          <span className={`mk-pill ${message.visitStatus === 'confirmed' ? 'done' : message.visitStatus === 'declined' ? '' : 'wait'}`}>{message.visitStatus === 'confirmed' ? '✅ Confirmed' : message.visitStatus === 'declined' ? '✖ Declined' : '⏳ Waiting for the seller'}</span>
                          {currentConversation.role === 'seller' && message.visitStatus === 'requested' && (
                            <div className="mk-card-actions">
                              <button className="os-btn os-btn-brand" onClick={() => answerVisit(message._id, 'confirm')}>Confirm</button>
                              <button className="os-btn os-btn-ghost" onClick={() => answerVisit(message._id, 'decline')}>Suggest another time</button>
                            </div>
                          )}
                          <small>{clockTime(message.at)}</small>
                        </div>
                      ) : (
                        <div className={`mk-msg ${mine ? 'me' : 'them'}`}>
                          {message.text}
                          <small>{clockTime(message.at)}</small>
                        </div>
                      )}
                      {message.flag === 'money' && !mine && (
                        <div className="mk-scam-warn" role="alert">
                          ⚠️ <b>Be careful:</b> this message asks for money first. Never send a deposit or M-Pesa before you see the item.
                          {thread.listing?.buyNow ? ' Buy through the site instead (Lipa Salama): safe mobile payment is guaranteed.' : ' Meet in a public place and pay on collection.'}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              {thread.listing?.category === 'furniture' && (agreement || thread.listing?.status === 'active') && (
                <div className="mk-compose-tools mk-agree-tools-bar">
                  {agreement && agreement.status !== 'cancelled'
                    ? <Link to={`/agreements/${agreement._id}`}>📝 Agreement {agreement.agreementNo}: {agreement.status === 'active' ? `balance KSh ${agreement.balance.toLocaleString()}` : agreement.status.startsWith('waiting') ? (((agreement.status === 'waiting_buyer') === (currentConversation.role === 'buyer')) ? 'review & accept' : 'waiting for them') : 'fully paid'}</Link>
                    : <Link to={`/agreements/new?c=${id}`}>📝 Lipa Pole Pole agreement</Link>}
                  <Link to="/lipa-pole-pole">How it works</Link>
                </div>
              )}
              {currentConversation.role === 'buyer' && thread.listing?.status === 'active' && (
                <div className="mk-compose-tools">
                  {thread.listing.price > 0 && <button type="button" onClick={() => setSheet('offer')}>💰 Make an offer</button>}
                  {['land-property', 'vehicles'].includes(thread.listing.category) && <button type="button" onClick={() => setSheet('visit')}>📅 Book a {thread.listing.category === 'land-property' ? 'site visit' : 'viewing'}</button>}
                  <Link to={`/market/item/${thread.listing.slug}`}>View ad</Link>
                </div>
              )}
              {currentConversation.role === 'seller' && thread.listing?.status === 'active' && thread.listing.canBuyOnline && (
                <div className="mk-compose-tools">
                  <button type="button" onClick={() => setSheet('agree')}>🤝 Agree a price</button>
                  <span className="mk-compose-hint">Agreed in the chat? Set it so they can add it to their cart.</span>
                </div>
              )}
              {sheet === 'agree' && <AgreeSheet conversationId={id} listing={{ price: thread.listing.price, buyNow: thread.listing.buyNow, stock: thread.listing.stock, delivery: thread.listing.delivery }} onClose={() => { setSheet(null); reload(); }} />}
              {sheet === 'offer' && <OfferSheet listing={{ _id: currentConversation.listing._id, price: thread.listing.price, buyNow: thread.listing.buyNow }} onClose={() => { setSheet(null); reload(); }} />}
              {sheet === 'visit' && <VisitSheet listing={{ _id: currentConversation.listing._id, category: thread.listing.category }} onClose={() => { setSheet(null); reload(); }} />}
              <form className="mk-compose" onSubmit={send}>
                <textarea
                  rows={1}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
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
