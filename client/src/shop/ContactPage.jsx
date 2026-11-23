// Contact us (/contact): every way to reach us (phone, email, WhatsApp, live chat, our office) and our social media
// pages, in one place. Everything comes from Admin → Settings; a channel that isn't set up yet isn't shown.
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { STORE_INFO, directionsUrl } from './storeInfo';
import { openSupportChat } from './SupportChat';
import { openWhatsApp } from './WhatsAppSupport';
import { SOCIAL_KEYS, SOCIAL_NAMES, SocialIcon } from './Social';
import { useSeo } from '../market/marketApi';

// 0768507798 / 254768507798 → "0768 507 798" (to read) and "tel:+254768507798" (to dial)
const local = (phone) => String(phone || '').replace(/\D/g, '').replace(/^254/, '0');
const prettyNumber = (phone) => local(phone).replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const dialNumber = (phone) => `tel:+254${local(phone).replace(/^0/, '')}`;
// "https://www.instagram.com/kapu" → "@kapu"
const handleOf = (url) => {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return last ? `@${last.replace(/^@/, '')}` : new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const SOCIAL_LINES = {
  tiktok: 'Short videos: deals, new arrivals and how-tos',
  instagram: 'Photos of the best deals and our sellers',
  facebook: 'News, offers and our community',
  x: 'Quick updates and announcements',
  youtube: 'Guides: buying, selling and staying safe',
};

export default function ContactPage() {
  const name = STORE_INFO.name;
  const { hash } = useLocation();
  const socials = SOCIAL_KEYS.filter((key) => STORE_INFO.social?.[key]);
  useSeo({
    title: `Contact ${name}`,
    description: `Contact ${name}: call ${prettyNumber(STORE_INFO.phone)}${STORE_INFO.email ? `, email ${STORE_INFO.email}` : ''}, live chat or WhatsApp, and follow us on social media.`,
    path: '/contact',
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Organization', name, url: typeof window !== 'undefined' ? window.location.origin : undefined, areaServed: 'KE',
      contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'KE', availableLanguage: ['English', 'Swahili'], ...(STORE_INFO.phone ? { telephone: dialNumber(STORE_INFO.phone).replace('tel:', '') } : {}), ...(STORE_INFO.email ? { email: STORE_INFO.email } : {}) }],
      sameAs: socials.map((key) => STORE_INFO.social[key]),
    },
  });
  // /contact#follow (the footer's "Follow us"): straight to the social media pages
  useEffect(() => {
    if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [hash]);

  return (
    <div className="os-contact">
      <section className="os-contact-hero">
        <div className="os-about-wrap">
          <span className="os-about-eyebrow">Contact us</span>
          <h1>Let’s talk.</h1>
          <p className="os-about-lead">Questions about an order, selling, deliveries, partnerships or the press: our team is happy to help, in English or Kiswahili.</p>
        </div>
      </section>

      <div className="os-about-wrap">
        {/* the ways to reach us */}
        <section className="os-contact-channels" aria-label="Ways to reach us">
          {STORE_INFO.phone && (
            <a className="os-contact-card main" href={dialNumber(STORE_INFO.phone)}>
              <span className="os-contact-icon" aria-hidden="true">📞</span>
              <small>Phone</small>
              <b>{prettyNumber(STORE_INFO.phone)}</b>
              <span className="os-contact-cta">Tap to call</span>
            </a>
          )}
          {STORE_INFO.email && (
            <a className="os-contact-card" href={`mailto:${STORE_INFO.email}`}>
              <span className="os-contact-icon" aria-hidden="true">✉️</span>
              <small>Email</small>
              <b>{STORE_INFO.email}</b>
              <span className="os-contact-cta">Write to us</span>
            </a>
          )}
          {STORE_INFO.whatsapp && (
            <button type="button" className="os-contact-card wa" onClick={() => openWhatsApp()}>
              <span className="os-contact-icon" aria-hidden="true">🟢</span>
              <small>WhatsApp</small>
              <b>{prettyNumber(STORE_INFO.whatsapp)}</b>
              <span className="os-contact-cta">Message us</span>
            </button>
          )}
          <button type="button" className="os-contact-card" onClick={openSupportChat}>
            <span className="os-contact-icon" aria-hidden="true">💬</span>
            <small>Live chat</small>
            <b>Chat with our team</b>
            <span className="os-contact-cta">No account needed</span>
          </button>
          {STORE_INFO.address && (
            <a className="os-contact-card" href={directionsUrl || undefined} target="_blank" rel="noreferrer">
              <span className="os-contact-icon" aria-hidden="true">📍</span>
              <small>Visit us</small>
              <b>{STORE_INFO.address}</b>
              <span className="os-contact-cta">Get directions</span>
            </a>
          )}
        </section>
        {STORE_INFO.hours?.length > 0 && <p className="os-contact-hours">🕘 Open {STORE_INFO.hours.map(([days, time]) => `${days}: ${time}`).join(' · ')}</p>}

        {/* social media */}
        {socials.length > 0 && (
          <section className="os-contact-follow" id="follow" aria-labelledby="contact-follow">
            <div className="os-about-head center">
              <span className="os-about-kicker">Follow us</span>
              <h2 id="contact-follow">Join the {name} community</h2>
              <p>Deals, new arrivals, selling tips and safety guides, every week.</p>
            </div>
            <div className="os-contact-socials">
              {socials.map((key) => (
                <a key={key} href={STORE_INFO.social[key]} target="_blank" rel="noopener noreferrer" className={`os-contact-social os-social-${key}`} aria-label={`${name} on ${SOCIAL_NAMES[key]}`}>
                  <span className="os-contact-social-icon"><SocialIcon name={key} size={24} /></span>
                  <span className="os-contact-social-text">
                    <b>{SOCIAL_NAMES[key]}</b>
                    <small>{handleOf(STORE_INFO.social[key])}</small>
                    <em>{SOCIAL_LINES[key]}</em>
                  </span>
                  <span className="os-contact-social-go" aria-hidden="true">Follow →</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="os-contact-more">
          <div>
            <b>Looking for quick answers?</b>
            <small>Buying, selling, payments, deliveries and staying safe.</small>
          </div>
          <div className="os-contact-more-links">
            <Link className="os-btn os-btn-dark" to="/help">Help centre</Link>
            <Link className="os-btn os-btn-ghost" to="/about">About {name}</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
