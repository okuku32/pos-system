// A seller's contacts (the number to call, WhatsApp), shown beside the seller's name on "near me" cards (wholesalers, importers, mama mbogas,
// boutiques… every kind) and on the seller's page. The number is fetched only when someone taps "Contact", and only
// for logged-in people (GET /api/market/sellers/:id/contact, rate-limited) so it can't be scraped from the lists.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg } from './marketApi';
import { useShop } from '../shop/ShopContext';

export default function SellerContact({ sellerId, available = true, compact = false }) {
  const { customer } = useShop();
  const navigate = useNavigate();
  const location = useLocation();
  const [contact, setContact] = useState(null);
  const [busy, setBusy] = useState(false);
  // logged out: the number goes off the screen straight away (it's only for signed-in people)
  useEffect(() => {
    if (!customer) setContact(null);
  }, [customer]);
  if (!available) return <span className="mk-contact-chat">💬 Contact by chat (open one of their ads)</span>;
  const show = async () => {
    if (!customer) {
      toast('Log in to see the seller’s phone number', { icon: '📞' });
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setBusy(true);
    try {
      setContact((await api.get(`/market/sellers/${sellerId}/contact`)).data);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  if (!contact) {
    return <button type="button" className={`os-btn mk-show-number mk-contact-show ${compact ? 'compact' : ''}`} disabled={busy} onClick={show}>{busy ? 'Getting contacts…' : customer ? '📞 Show contacts' : '🔒 Log in to see contacts'}</button>;
  }
  // the button turns into the contacts, in the same place: the number (tap to call) and WhatsApp
  return (
    <span className={`mk-contact inline ${compact ? 'compact' : ''}`} aria-label={`Contacts of ${contact.name}`}>
      <a className="os-btn mk-contact-num" href={contact.call}>📞 {contact.display}</a>
      <a className="os-btn mk-contact-wa" href={contact.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>
    </span>
  );
}
