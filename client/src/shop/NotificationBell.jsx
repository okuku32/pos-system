// 🔔 Notifications: carts, new orders and order updates, in English, Kiswahili or both
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShop, NoteText } from './ShopContext';
import Swipeable from './Swipeable';

const ago = (date) => {
  const amount = Math.max(1, Math.round((Date.now() - new Date(date)) / 1000));
  if (amount < 60) return 'just now · sasa hivi';
  const sum = Math.round(amount / 60);
  if (sum < 60) return `${sum} min ago · dakika ${sum}`;
  const figure = Math.round(sum / 60);
  if (figure < 24) return `${figure} h ago · saa ${figure}`;
  const dd = Math.round(figure / 24);
  return `${dd} d ago · siku ${dd}`;
};
const LANGS = [['both', 'EN + SW'], ['en', 'English'], ['sw', 'Kiswahili']];

export default function NotificationBell() {
  const { customer, notes, notesUnread, markNotesRead, refreshNotes, removeNote, clearNotes, noteLang, setNoteLang } = useShop();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (customer) refreshNotes();
  }, [customer, refreshNotes]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => box.current && !box.current.contains(event.target) && setOpen(false);
    const esc = (error) => error.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!customer) return null;
  const toggle = () => {
    if (!open && notesUnread) markNotesRead();
    setOpen(!open);
  };
  return (
    <div className="os-bell" ref={box}>
      <button type="button" className="os-bell-btn" onClick={toggle} aria-expanded={open} aria-label={`Notifications${notesUnread ? `, ${notesUnread} new` : ''}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {notesUnread > 0 && <span className="os-cart-count">{notesUnread > 99 ? '99+' : notesUnread}</span>}
      </button>
      {open && (
        <div className="os-bell-panel" role="dialog" aria-label="Notifications">
          <div className="os-bell-head">
            <b>Notifications <span>· Arifa</span></b>
            <div className="os-bell-langs" role="group" aria-label="Language">
              {LANGS.map(([key, label]) => <button key={key} type="button" className={noteLang === key ? 'on' : ''} aria-pressed={noteLang === key} onClick={() => setNoteLang(key)}>{label}</button>)}
            </div>
          </div>
          {notes.length > 0 && (
            <div className="os-bell-tools">
              <small>Swipe left or right, or tap ✕, to remove</small>
              <button type="button" onClick={clearNotes}>Clear all</button>
            </div>
          )}
          {!notes.length ? (
            <p className="os-bell-empty">No notifications yet.<br /><i>Hakuna arifa bado.</i></p>
          ) : (
            <ul className="os-bell-list">
              {notes.map((note) => (
                <Swipeable as="li" key={note._id} className={note.read ? '' : 'new'} label="Remove this notification" onDismiss={() => removeNote(note._id)}>
                  <button type="button" onClick={() => { setOpen(false); if (note.link) navigate(note.link); }}>
                    <span className="os-bell-icon" aria-hidden="true">{note.icon}</span>
                    <span className="os-bell-text"><NoteText n={note} lang={noteLang} /><small className="os-bell-time">{ago(note.createdAt)}</small></span>
                  </button>
                </Swipeable>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
