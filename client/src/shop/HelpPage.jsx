import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STORE_INFO, directionsUrl, mapEmbedUrl } from './storeInfo';
import { openSupportChat } from './SupportChat';

const FAQ = [
  ['How do I track my order?', 'After you place an order you land on its tracking page, which updates live. You can also find every order under “My orders”, and we email you when it’s on the way.'],
  ['How do I pay?', 'Pay with M-Pesa or cash when your order is delivered or when you collect it. We email you a receipt as soon as the payment is received.'],
  ['Can I collect my order myself?', `Yes. Choose “Pickup” at checkout and collect it from our shop at ${STORE_INFO.location}. We’ll email you when it’s ready.`],
  ['Something is wrong with my order', 'Sorry about that! Start a chat with us and include your order number. We’ll sort it out quickly.'],
  ['Do I need an account to contact you?', 'No. Anyone can chat with us. An account just lets us link the conversation to your orders.'],
];

export default function HelpPage() {
  const [openFaq, setOpenFaq] = useState(0);
  useEffect(() => {
    document.title = 'Help & contact · Ordersasa';
  }, []);

  return (
    <div className="os-page os-help">
      <section className="os-help-hero os-fade-up">
        <span className="os-eyebrow dark">Help &amp; contact</span>
        <h1>We’re here to help 👋</h1>
        <p>Questions about an order, a delivery or a product? Chat with our team, no account needed, or come say hello at our shop in {STORE_INFO.location}.</p>
        <div className="os-row">
          <button className="os-btn os-btn-brand os-btn-lg" onClick={openSupportChat}>💬 Chat with us</button>
          <a className="os-btn os-btn-ghost os-btn-lg" href={directionsUrl} target="_blank" rel="noreferrer">📍 Get directions</a>
        </div>
      </section>

      <div className="os-help-grid">
        <section className="os-panel os-location">
          <h3>Visit us</h3>
          <div className="os-detail">
            <span>📍</span>
            <div><b>{STORE_INFO.location}</b><small>{STORE_INFO.address}</small></div>
          </div>
          {STORE_INFO.hours.length > 0 && (
            <div className="os-detail">
              <span>🕘</span>
              <div>
                <b>Opening hours</b>
                {STORE_INFO.hours.map(([d, h]) => <small key={d}>{d}: {h}</small>)}
              </div>
            </div>
          )}
          {STORE_INFO.phone && (
            <div className="os-detail"><span>📞</span><div><b>Call us</b><small><a href={`tel:${STORE_INFO.phone.replace(/\s/g, '')}`}>{STORE_INFO.phone}</a></small></div></div>
          )}
          {STORE_INFO.whatsapp && (
            <div className="os-detail"><span>🟢</span><div><b>WhatsApp</b><small><a href={`https://wa.me/${STORE_INFO.whatsapp}`} target="_blank" rel="noreferrer">Message us on WhatsApp</a></small></div></div>
          )}
          {STORE_INFO.email && (
            <div className="os-detail"><span>✉️</span><div><b>Email</b><small><a href={`mailto:${STORE_INFO.email}`}>{STORE_INFO.email}</a></small></div></div>
          )}
          <div className="os-map">
            <iframe title={`Map of ${STORE_INFO.location}`} src={mapEmbedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
          </div>
          <a className="os-btn os-btn-dark os-block" href={directionsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a>
        </section>

        <section className="os-panel">
          <h3>Common questions</h3>
          <div className="os-faq">
            {FAQ.map(([q, a], i) => (
              <div key={q} className={`os-faq-item ${openFaq === i ? 'open' : ''}`}>
                <button onClick={() => setOpenFaq(openFaq === i ? -1 : i)} aria-expanded={openFaq === i}>
                  <span>{q}</span><i aria-hidden="true">+</i>
                </button>
                <p>{a}</p>
              </div>
            ))}
          </div>
          <div className="os-help-cta">
            <b>Still need help?</b>
            <p>Our team replies right here in the chat, and by email if you leave one.</p>
            <button className="os-btn os-btn-brand" onClick={openSupportChat}>Start a conversation</button>
          </div>
          <Link to="/shop" className="os-back">← Back to the shop</Link>
        </section>
      </div>
    </div>
  );
}
