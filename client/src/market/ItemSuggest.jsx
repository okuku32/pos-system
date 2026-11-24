// "What did you buy?" with suggestions as they type (Shop & ride): kinds of items (Women's shoes, TVs…) and matching
// ads on Kapu with their seller. While it's in use, the field moves to the top of the screen so the list stays in
// view above a phone's keyboard; ↑ ↓ Enter and Esc work too. GET /api/errands/shopride/items?q=
// With a seller (found from their phone or an ad): only what that seller sells on Kapu, listed as soon as the
// field is tapped (&seller=<id>).
import { useEffect, useRef, useState } from 'react';
import { api, priceText } from './marketApi';

export default function ItemSuggest({ value, onChange, onPickItem, onPickAd, placeholder, id, sellerId = '', sellerName = '' }) {
  const [data, setData] = useState({ items: [], ads: [] });
  const [loaded, setLoaded] = useState(''); // the query (and seller) the list belongs to
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const input = useRef(null);
  const timer = useRef(null);
  const list = useRef(null);
  // a finger or mouse is on the list (scrolling it, or about to tap): don't close it when the field loses focus
  const pressing = useRef(false);
  // a known seller: their own products first, then the kinds of things they sell; otherwise kinds first
  const itemOptions = data.items.map((item) => ({ kind: 'item', item }));
  const adOptions = data.ads.map((ad) => ({ kind: 'ad', ad }));
  const options = sellerId ? [...adOptions, ...itemOptions] : [...itemOptions, ...adOptions];

  useEffect(() => {
    clearTimeout(timer.current);
    const text = value.trim();
    // a known seller: their list even before typing; otherwise from two letters
    if (!sellerId && text.length < 2) { setData({ items: [], ads: [] }); setLoaded(''); return undefined; }
    let live = true;
    timer.current = setTimeout(() => {
      api.get('/errands/shopride/items', { params: { q: text, ...(sellerId ? { seller: sellerId } : {}) } })
        .then((response) => { if (live) { setData(response.data); setActive(-1); setLoaded(`${sellerId}|${text}`); } })
        .catch(() => {});
    }, sellerId ? 120 : 200);
    return () => { live = false; clearTimeout(timer.current); };
  }, [value, sellerId]);
  // close when tapping elsewhere
  useEffect(() => {
    const away = (event) => { if (!box.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);

  // in use on a phone: bring the field to the top so the list isn't hidden behind the keyboard
  const bringUp = () => {
    if (window.matchMedia?.('(max-width: 720px)').matches) setTimeout(() => input.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
  };
  const pick = (option) => {
    pressing.current = false;
    if (option.kind === 'item') onPickItem?.(option.item);
    else onPickAd?.(option.ad);
    setOpen(false);
  };
  useEffect(() => {
    if (active >= 0) list.current?.querySelector(`#${CSS.escape(`${id}-o${active}`)}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);
  const onKey = (event) => {
    if (!open || !options.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index <= 0 ? options.length - 1 : index - 1)); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(options[active]); }
    else if (event.key === 'Escape') setOpen(false);
  };
  // a known seller with nothing matching: say so (they can still type what they bought)
  const empty = open && sellerId && loaded === `${sellerId}|${value.trim()}` && !options.length;
  const show = open && (options.length > 0 || empty);
  return (
    <div className={`mk-isug ${show ? 'open' : ''}`} ref={box}>
      <input
        ref={input} id={id} value={value} placeholder={placeholder} maxLength={160} required minLength={2} autoComplete="off"
        role="combobox" aria-expanded={show} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); bringUp(); }}
        onBlur={() => setTimeout(() => { if (!pressing.current && document.activeElement !== input.current) setOpen(false); }, 150)} // moved on (Tab, the next field): the list goes
        onKeyDown={onKey}
      />
      {show && (
        <ul
          ref={list} className={`mk-isug-list ${sellerId ? 'seller' : ''}`} id={`${id}-list`} role="listbox"
          onPointerDown={(event) => { pressing.current = true; if (event.pointerType === 'mouse') event.preventDefault(); }} // the mouse keeps the field focused
          onPointerUp={() => setTimeout(() => { pressing.current = false; }, 400)}
          onPointerCancel={() => setTimeout(() => { pressing.current = false; }, 400)}
        >
          {sellerId && <li className="mk-isug-head mk-isug-seller" role="presentation">🏪 Sold by {data.seller?.name || sellerName || 'this seller'}{data.seller?.products ? <small>{value.trim() ? `${data.ads.length} of ${data.seller.products} products` : `${data.seller.products} product${data.seller.products === 1 ? '' : 's'}: scroll or type to find yours`}</small> : null}</li>}
          {empty && <li className="mk-isug-empty" role="presentation">{value.trim() ? `Nothing like “${value.trim()}” listed by ${data.seller?.name || sellerName || 'this seller'}: just type what you bought.` : `${data.seller?.name || sellerName || 'This seller'} hasn’t listed products yet: type what you bought.`}</li>}
          {options.map((option, index) => {
            const head = index === 0 || options[index - 1].kind !== option.kind;
            const title = option.kind === 'ad' ? (sellerId ? <>Their products on <KapuName /></> : <>On <KapuName />: we’ll fill in the seller</>) : sellerId ? 'Other things they sell' : 'Items';
            const rows = [];
            if (head) rows.push(<li key={`h${option.kind}`} className="mk-isug-head" role="presentation">{title}</li>);
            if (option.kind === 'item') {
              const { item } = option;
              rows.push(
                <li key={`i${item.label}`} id={`${id}-o${index}`} role="option" aria-selected={active === index} className={active === index ? 'on' : ''} onClick={() => pick(option)}>
                  <span aria-hidden="true">{item.icon}</span><b>{item.label}</b><small>{item.hint}</small>
                </li>
              );
            } else {
              const { ad } = option;
              rows.push(
                <li key={`a${ad._id}`} id={`${id}-o${index}`} role="option" aria-selected={active === index} className={`ad ${active === index ? 'on' : ''}`} onClick={() => pick(option)}>
                  {ad.image ? <img src={ad.image} alt="" loading="lazy" /> : <span aria-hidden="true">🛍️</span>}
                  <b>{ad.title}</b><small>{sellerId ? 'Tap to choose' : `${priceText(ad.price)} · ${ad.seller.name}${ad.seller.area ? `, ${ad.seller.area}` : ''}`}</small>{sellerId && <em className="mk-isug-price">{priceText(ad.price)}</em>}
                </li>
              );
            }
            return rows;
          })}
        </ul>
      )}
    </div>
  );
}
