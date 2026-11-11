import { useEffect } from 'react';
import { useShop } from './ShopContext';
import { ksh, unitPrice, isDiscounted } from './shopApi';
import ProductImage from '../components/ProductImage';
import { openWhatsApp } from './WhatsAppSupport';

// Product details: big picture, description, price, stock and add-to-cart. A bottom sheet on phones.
export default function ProductSheet({ product: p, onClose }) {
  const { cart, setQty, setCartOpen } = useShop();
  const qty = (p && cart[p._id]) || 0;

  useEffect(() => {
    if (!p) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [p, onClose]);

  if (!p) return null;
  return (
    <div className="os-sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="os-sheet" role="dialog" aria-label={p.name}>
        <button className="os-icon-btn os-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="os-sheet-img">
          <ProductImage product={p} size={320} />
          {isDiscounted(p) && <span className="os-deal-badge">−{p.discountPercent}%</span>}
        </div>
        <div className="os-sheet-body">
          <span className="os-card-cat">{p.category}</span>
          <h2>{p.name}</h2>
          <div className="os-sheet-price">
            <b className={isDiscounted(p) ? 'deal' : ''}>{ksh(unitPrice(p))}</b>
            {isDiscounted(p) && <s>{ksh(p.price)}</s>}
            {isDiscounted(p) && <span className="os-save-pill">Save {ksh(p.price - unitPrice(p))}</span>}
          </div>
          <p className="os-sheet-desc">{p.description || 'No description yet.'}</p>
          <p className={`os-sheet-stock ${p.stock <= 5 ? 'low' : ''}`}>{p.stock <= 5 ? `Only ${p.stock} left in stock` : '✓ In stock'}</p>

          <div className="os-sheet-actions">
            {qty === 0 ? (
              <button className="os-btn os-btn-brand os-btn-lg os-grow" onClick={() => setQty(p, 1)}>Add to cart · {ksh(unitPrice(p))}</button>
            ) : (
              <>
                <div className="os-stepper">
                  <button onClick={() => setQty(p, qty - 1)} aria-label={`Remove one ${p.name}`}>−</button>
                  <span>{qty}</span>
                  <button onClick={() => setQty(p, qty + 1)} aria-label={`Add one ${p.name}`}>+</button>
                </div>
                <button className="os-btn os-btn-dark os-btn-lg os-grow" onClick={() => { onClose(); setCartOpen(true); }}>View cart · {ksh(unitPrice(p) * qty)}</button>
              </>
            )}
          </div>
          <button className="os-linkbtn os-sheet-ask" onClick={() => openWhatsApp(`Hi, I have a question about "${p.name}" (${ksh(unitPrice(p))}).`)}>
            💬 Ask about this product on WhatsApp
          </button>
        </div>
      </section>
    </div>
  );
}
