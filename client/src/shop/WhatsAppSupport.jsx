import { useEffect, useState } from 'react';
import { useShop } from './ShopContext';
import { STORE_INFO } from './storeInfo';
import { firstName } from './shopApi';

// WhatsApp support. With a WhatsApp number in Settings → Business details it opens real WhatsApp
// (wa.me) with the message pre-filled. Without one, it opens a MOCK WhatsApp chat so the flow can be
// shown and tested before the shop has a business WhatsApp number.
//
// Open it from anywhere with openWhatsApp('optional pre-filled message').
export const openWhatsApp = (message) => window.dispatchEvent(new CustomEvent('kapu:whatsapp', { detail: { message } }));

const realLink = (text) => `https://wa.me/${STORE_INFO.whatsapp}?text=${encodeURIComponent(text)}`;
const time = () => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function WaIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="#fff" d="M16 3a13 13 0 0 0-11.1 19.7L3 29l6.5-1.7A13 13 0 1 0 16 3Zm0 23.6a10.6 10.6 0 0 1-5.4-1.5l-.4-.2-3.9 1 1-3.8-.2-.4A10.6 10.6 0 1 1 16 26.6Zm5.8-7.9c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.6 3.6 0 0 0-1.1 2.7 6.3 6.3 0 0 0 1.3 3.3 14.4 14.4 0 0 0 5.5 4.9c2 .9 2.9 1 3.9.8a3.3 3.3 0 0 0 2.2-1.5 2.7 2.7 0 0 0 .2-1.5c-.1-.2-.3-.3-.6-.4Z" />
    </svg>
  );
}

export default function WhatsAppSupport() {
  const { customer, activeOrder } = useShop();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState([]);
  const isMock = !STORE_INFO.whatsapp;

  // a helpful starting message, with the customer's current order if they have one
  const defaultMessage = () =>
    `Hello ${STORE_INFO.name}${customer ? `, this is ${firstName(customer.name)}` : ''}. ${activeOrder ? `I'd like help with my order ${activeOrder.orderNo}.` : 'I need some help, please.'}`;

  useEffect(() => {
    const onOpen = (error) => {
      const text = error.detail?.message || defaultMessage();
      if (!isMock) {
        window.open(realLink(text), '_blank', 'noopener');
        return;
      }
      setDraft(text);
      setOpen(true);
    };
    window.addEventListener('kapu:whatsapp', onOpen);
    return () => window.removeEventListener('kapu:whatsapp', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMock, customer, activeOrder]);

  const send = (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setThread((previousThread) => [...previousThread, { from: 'me', text, at: time() }]);
    setDraft('');
    // simulated reply, so the mock feels like a real conversation
    setTimeout(() => {
      setThread((previousThread) => [
        ...previousThread,
        {
          from: 'shop',
          at: time(),
          text: `Hi${customer ? ` ${firstName(customer.name)}` : ''} 👋 Thanks for contacting ${STORE_INFO.name} on WhatsApp! A team member will reply shortly.${activeOrder ? ` We can see your order ${activeOrder.orderNo}.` : ''}`,
        },
      ]);
    }, 1200);
  };

  return (
    <>
      <button className="os-wa-fab" onClick={() => openWhatsApp()} aria-label="Chat with us on WhatsApp" title="Chat with us on WhatsApp">
        <WaIcon />
      </button>

      {open && (
        <div className="os-wa-wrap" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="os-wa" role="dialog" aria-label="WhatsApp chat (demo)">
            <header className="os-wa-head">
              <button className="os-wa-back" onClick={() => setOpen(false)} aria-label="Close">←</button>
              <span className="os-wa-avatar">{STORE_INFO.name.slice(0, 1)}</span>
              <div className="os-wa-title">
                <b><SiteName light /></b>
                <small>Business account · usually replies within minutes</small>
              </div>
            </header>
            <div className="os-wa-demo">🧪 Demo WhatsApp: the shop hasn’t added its WhatsApp number yet, so messages here are not sent.</div>
            <div className="os-wa-body">
              <div className="os-wa-day">Today</div>
              <div className="os-wa-msg shop">
                Karibu <SiteName />! 👋 How can we help you today?
                <small>{time()}</small>
              </div>
              {thread.map((item, index) => (
                <div key={index} className={`os-wa-msg ${item.from}`}>
                  {item.text}
                  <small>{item.at}{item.from === 'me' && <span className="os-wa-ticks"> ✓✓</span>}</small>
                </div>
              ))}
            </div>
            <form className="os-wa-compose" onSubmit={send}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message" aria-label="Message" autoFocus />
              <button className="os-wa-send" disabled={!draft.trim()} aria-label="Send">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M2 21 23 12 2 3v7l15 2-15 2z" /></svg>
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
