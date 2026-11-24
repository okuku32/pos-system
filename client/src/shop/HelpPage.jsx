import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { STORE_INFO, directionsUrl, mapEmbedUrl } from './storeInfo';
import { openSupportChat } from './SupportChat';
import { openWhatsApp } from './WhatsAppSupport';
import { useSeo } from '../market/marketApi';
import { TextWithSiteName } from '../components/BrandName';

const FAQ = [
  ['How do I buy something?', 'Items marked “Buy online” can be added to your cart and paid for with M-Pesa or cash on delivery; the seller delivers it or you pick it up. For everything else (cars, land, big items), tap “Chat with seller” or show their phone number and agree directly.'],
  ['How does M-Pesa payment work?', `You get a prompt on your phone for the whole cart. The money is held by ${STORE_INFO.name} and only passed to the seller after the order is delivered, so you’re protected if something goes wrong.`],
  ['How do I sell?', 'Tap “+ Sell”, choose a category, add photos, a price and your location. It’s free. Tick “Sell online” to let buyers order and pay straight away; you’ll get an alert to confirm each order.'],
  ['When do sellers get paid?', `Cash-on-delivery money goes straight to the seller. For M-Pesa orders, ${STORE_INFO.name} sends the money to the seller after delivery, minus a ${STORE_INFO.commissionPercent}% service fee.`],
  ['How do I track my order?', 'Open “My orders”: every order updates live as the seller confirms, ships and delivers it, and we email you at each step.'],
  ['Can I cancel an order?', 'Yes, until the seller confirms it. After that, chat with the seller or contact us. If you paid with M-Pesa, cancelled orders are refunded.'],
  ['Something is wrong with an order or an ad', 'Report the ad (🚩 on the ad page) or chat with us with your order number. Our team reviews every report.'],
];

const SAFETY = [
  ['🤝', 'Meet in a safe public place', 'For items you buy by chatting, meet in a busy place in daylight, and bring a friend for expensive items.'],
  ['🔍', 'Check before you pay', 'Inspect the item before paying. For “Buy online” orders, safe mobile payment is guaranteed.'],
  ['💸', 'Never pay a deposit to strangers', 'Don’t send money in advance to someone you haven’t met, especially for items far away.'],
  ['📄', 'Verify land and vehicles', 'Do an official land search at the Lands registry and confirm a logbook on NTSA eCitizen before paying.'],
  ['🚩', 'Report anything suspicious', 'Use “Report ad” or chat with us. We remove scams quickly.'],
];

export default function HelpPage() {
  const [openFaq, setOpenFaq] = useState(0);
  const { hash } = useLocation();
  useSeo({ title: `Help & contact`, description: `Get help with buying and selling on ${STORE_INFO.name}: contact us, live chat, safety tips and answers to common questions.`, path: '/help' });
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  return (
    <div className="os-page os-help">
      <section className="os-help-hero os-fade-up">
        <span className="os-eyebrow dark">Help &amp; contact</span>
        <h1>We’re here to help 👋</h1>
        <p>Questions about buying, selling, an order or an ad? Chat with our team (no account needed) or visit us{STORE_INFO.location ? ` at ${STORE_INFO.location}` : ''}.</p>
        <div className="os-row">
          <button className="os-btn os-btn-brand os-btn-lg" onClick={openSupportChat}>💬 Chat with us</button>
          <button className="os-btn os-btn-wa os-btn-lg" onClick={() => openWhatsApp()}>WhatsApp us</button>
          {directionsUrl && <a className="os-btn os-btn-ghost os-btn-lg" href={directionsUrl} target="_blank" rel="noreferrer">📍 Get directions</a>}
        </div>
      </section>

      <div className="os-help-grid">
        <section className="os-panel">
          <h3>Common questions</h3>
          <div className="os-faq">
            {FAQ.map(([key, value], index) => (
              <div key={key} className={`os-faq-item ${openFaq === index ? 'open' : ''}`}>
                <button onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index}>
                  <span>{key}</span><i aria-hidden="true">+</i>
                </button>
                <p><TextWithSiteName text={value} /></p>
              </div>
            ))}
          </div>
          <div className="os-help-cta">
            <b>Still need help?</b>
            <p>Our team replies right here in the chat, and by email if you leave one.</p>
            <button className="os-btn os-btn-brand" onClick={openSupportChat}>Start a conversation</button>
          </div>
        </section>

        <section className="os-panel os-location">
          <h3>Contact us</h3>
          {STORE_INFO.address && <div className="os-detail"><span>📍</span><div><b>{STORE_INFO.location}</b><small>{STORE_INFO.address}</small></div></div>}
          {STORE_INFO.phone && <div className="os-detail"><span>📞</span><div><b>Call us</b><small><a href={`tel:${STORE_INFO.phone.replace(/\s/g, '')}`}>{STORE_INFO.phone}</a></small></div></div>}
          {STORE_INFO.email && <div className="os-detail"><span>✉️</span><div><b>Email</b><small><a href={`mailto:${STORE_INFO.email}`}>{STORE_INFO.email}</a></small></div></div>}
          {STORE_INFO.hours.length > 0 && (
            <div className="os-detail"><span>🕘</span><div><b>Office hours</b>{STORE_INFO.hours.map(([key, value]) => <small key={key}>{key}: {value}</small>)}</div></div>
          )}
          {mapEmbedUrl && (
            <div className="os-map">
              <iframe title={`Map of ${STORE_INFO.location}`} src={mapEmbedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
            </div>
          )}
        </section>
      </div>

      <section className="os-panel os-safety" id="safety">
        <h3>Buy and sell safely</h3>
        <div className="os-safety-grid">
          {SAFETY.map(([icon, value, detail]) => (
            <div key={value}><span>{icon}</span><b>{value}</b><p>{detail}</p></div>
          ))}
        </div>
      </section>
      <Link to="/" className="os-back">← Back to the marketplace</Link>
    </div>
  );
}
