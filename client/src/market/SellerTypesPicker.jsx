// "What do you sell?" for sellers (sign-up and My account): category chips; tapping one opens a pop-up with that
// category's types (Electronics → phones, TVs, laptops…) to tick what they sell. A chosen category's chip shows how
// many types are ticked; tapping it again reopens the pop-up (with "Remove this category").
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { chipCount, itemsIn, pickCategory, removeCategory, setAllIn, toggleItem, MAX_CATEGORIES } from './sellerItems';

function TypesPopup({ category, items, onItems, onRemove, onClose }) {
  const panel = useRef(null);
  const picked = itemsIn(items, category.slug);
  const subs = category.subs || [];
  const close = useRef(onClose);
  close.current = onClose;
  // once when it opens: Esc closes, focus moves in, the page behind doesn't scroll
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector('button')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []);
  const all = picked.length === subs.length && subs.length > 0;
  // on top of the page (outside forms and fieldsets, whose styles it mustn't pick up)
  return createPortal(
    <div className="os os-types-pop" role="dialog" aria-modal="true" aria-labelledby="os-types-title">
      <button type="button" className="os-types-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <section className="os-types-panel" ref={panel}>
        <header>
          <h2 id="os-types-title"><span>{category.icon}</span> {category.name}</h2>
          <p>What do you sell in {category.name.toLowerCase()}? Tick all that apply.</p>
        </header>
        <div className="os-types-list">
          <button type="button" className={`os-types-all ${all ? 'on' : ''}`} aria-pressed={all} onClick={() => onItems(setAllIn(items, category.slug, subs.map((sub) => sub.slug), !all))}>{all ? '✓ All of them' : 'All of them'}</button>
          {subs.map((sub) => {
            const on = picked.includes(sub.slug);
            return <button type="button" key={sub.slug} className={on ? 'on' : ''} aria-pressed={on} onClick={() => onItems(toggleItem(items, category.slug, sub.slug))}>{on ? '✓ ' : ''}{sub.name}</button>;
          })}
        </div>
        <footer>
          <button type="button" className="os-btn os-btn-ghost os-types-remove" onClick={onRemove}>Remove this category</button>
          <button type="button" className="os-btn os-btn-brand os-types-done" onClick={onClose}>{picked.length ? `Done (${picked.length})` : 'Done'}</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

// categories: [{ slug, name, icon, subs: [{ slug, name }] }]; value: { categories: [slug], items: ['cat/type'] }
export default function SellerTypesPicker({ categories = [], value, onChange }) {
  const [open, setOpen] = useState(null);
  const chosen = value.categories;
  const tap = (slug) => {
    const next = pickCategory(chosen, slug);
    if (next.full) return toast.error(`Up to ${MAX_CATEGORIES} categories. Remove one first.`);
    if (next.categories !== chosen) onChange({ ...value, categories: next.categories });
    setOpen(next.open);
    return undefined;
  };
  const current = categories.find((category) => category.slug === open);
  return (
    <>
      <div className="os-types-chips">
        {categories.filter((category) => category.slug !== 'other').map((category) => {
          const on = chosen.includes(category.slug);
          const count = chipCount(value.items, category.slug);
          return (
            <button type="button" key={category.slug} className={on ? 'on' : ''} aria-pressed={on} aria-haspopup="dialog" onClick={() => tap(category.slug)}>
              <span>{category.icon}</span> {category.name}{on && count ? <b className="os-types-count">{count}</b> : null}
            </button>
          );
        })}
      </div>
      {current && (
        <TypesPopup
          key={current.slug}
          category={current}
          items={value.items}
          onItems={(items) => onChange({ ...value, items })}
          onRemove={() => { onChange(removeCategory(chosen, value.items, current.slug)); setOpen(null); }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
