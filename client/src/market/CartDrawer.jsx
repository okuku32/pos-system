import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useShop } from '../shop/ShopContext';
import { api, minOrder, priceText, unitFor } from './marketApi';
import { AdImage } from './ListingCard';
import './market.css';

// Is everything in the cart still available? The cart keeps a copy of each item from when it was added,
// so items that sold out since then are checked whenever the cart or checkout is open.
//   → { <id>: { state: 'ok' | 'low' | 'out', stock, reason } }
export function useCartCheck(cart, active = true) {
  const [check, setCheck] = useState({});
  const key = Object.entries(cart).map(([id, value]) => `${id}:${value.qty}`).join(',');
  useEffect(() => {
    if (!active || !key) return undefined;
    let live = true;
    const run = () =>
      api
        .post('/market/cart-check', { lines: Object.entries(cart).map(([id, value]) => ({ id, qty: value.qty, deal: !!value.item.offerId })) })
        .then((response) => live && setCheck(response.data.items))
        .catch(() => {});
    run();
    const timer = setInterval(run, 60000); // someone else may buy the last one while this is open
    return () => {
      live = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  const outIds = Object.keys(cart).filter((id) => check[id]?.state === 'out');
  const lowIds = Object.keys(cart).filter((id) => check[id]?.state === 'low');
  return { check, outIds, lowIds };
}

// Cart for items that can be bought online, grouped by seller (each seller delivers their own items)
export function groupBySeller(cart) {
  const groups = new Map();
  for (const [id, { qty, item }] of Object.entries(cart)) {
    const sellerId = item.sellerId || 'x';
    if (!groups.has(sellerId)) groups.set(sellerId, { sellerId: sellerId, sellerName: item.sellerName, area: [item.area, item.county].filter(Boolean).join(', '), lines: [] });
    groups.get(sellerId).lines.push({ id, qty, item });
  }
  return [...groups.values()].map((item) => ({
    ...item,
    subtotal: item.lines.reduce((total, line) => total + unitFor(line.item, line.qty) * line.qty, 0),
    deliveryFee: Math.max(0, ...item.lines.map((line) => (line.item.delivery?.available ? line.item.delivery.fee || 0 : 0))),
    canDeliver: item.lines.every((line) => line.item.delivery?.available !== false),
    canPickup: item.lines.every((line) => line.item.delivery?.pickup !== false),
  }));
}

export default function CartDrawer() {
  const { cart, cartCount, setQty, removeFromCart, cartOpen, setCartOpen, customer } = useShop();
  const navigate = useNavigate();
  const groups = useMemo(() => groupBySeller(cart), [cart]);
  const { check, outIds, lowIds } = useCartCheck(cart, cartOpen);
  // out-of-stock items don't count towards the total
  const subtotal = groups.reduce((total, group) => total + group.lines.filter((line) => !outIds.includes(line.id)).reduce((sum, item) => sum + unitFor(item.item, item.qty) * item.qty, 0), 0);
  const removeOut = () => outIds.forEach((id) => removeFromCart(id));

  useEffect(() => {
    if (!cartOpen) return undefined;
    const onKey = (error) => error.key === 'Escape' && setCartOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cartOpen, setCartOpen]);

  const checkout = () => {
    setCartOpen(false);
    navigate(customer ? '/checkout' : '/login?next=checkout');
  };
  // keep the cart, close it and go back to the products
  const keepShopping = () => {
    setCartOpen(false);
    navigate('/market/search?buyNow=1');
  };

  return (
    <div className={`os-drawer-wrap ${cartOpen ? 'open' : ''}`} aria-hidden={!cartOpen}>
      <div className="os-overlay" onClick={() => setCartOpen(false)} />
      <aside className="os-drawer" aria-label="Cart">
        <div className="os-drawer-head">
          <span className="mk-cart-icon">🛒</span>
          <h3>Your cart{cartCount ? ` (${cartCount})` : ''}</h3>
          <button className="os-icon-btn" onClick={() => setCartOpen(false)} aria-label="Close cart">✕</button>
        </div>
        {cartCount === 0 ? (
          <div className="os-empty">
            <div className="os-empty-art">🛒</div>
            <h4>Your cart is empty</h4>
            <p>Look for <b>“Buy online”</b> on ads: those items can be ordered and delivered.</p>
            <Link to="/market/search?buyNow=1" className="os-btn os-btn-brand" onClick={() => setCartOpen(false)}>Browse items you can buy online</Link>
          </div>
        ) : (
          <>
            <div className="mk-cart-body">
              {(outIds.length > 0 || lowIds.length > 0) && (
                <div className="mk-stock-alert" role="alert">
                  <span>⚠️ {outIds.length > 0 ? `${outIds.length} item${outIds.length === 1 ? ' is' : 's are'} out of stock` : ''}{outIds.length && lowIds.length ? ' · ' : ''}{lowIds.length > 0 ? `${lowIds.length} item${lowIds.length === 1 ? ' has' : 's have'} fewer left than you want` : ''}</span>
                  {outIds.length > 0 && <button type="button" className="os-btn os-btn-dark" onClick={removeOut}>Remove {outIds.length > 1 ? 'all out of stock' : 'it'}</button>}
                </div>
              )}
              {groups.map((group) => (
                <section key={group.sellerId} className="mk-cart-group">
                  <header>
                    <span>Sold by <b>{group.sellerName}</b></span>
                    <small>{group.canDeliver ? (group.deliveryFee ? `Delivery ${priceText(group.deliveryFee)}` : 'Free delivery') : 'Pickup only'} · {group.area}</small>
                  </header>
                  {group.lines.map(({ id, qty, item }) => {
                    const st = check[id];
                    const out = st?.state === 'out';
                    const low = st?.state === 'low';
                    return (
                      <div key={id} className={`mk-cart-line ${out ? 'out' : ''}`}>
                        <Link to={`/market/item/${item.slug}`} className="mk-cart-img" onClick={() => setCartOpen(false)}><AdImage ad={{ ...item, image: item.image, category: item.category }} /></Link>
                        <div className="mk-cart-info">
                          <Link to={`/market/item/${item.slug}`} onClick={() => setCartOpen(false)}>{item.title}</Link>
                          {out && <span className="mk-stock-badge out">Out of stock</span>}
                          {low && <span className="mk-stock-badge low">Only {st.stock} left</span>}
                          <b>{priceText(unitFor(item, qty))}{unitFor(item, qty) < item.price && <small className="mk-bulk-note"> bulk price</small>}</b>
                          {item.wholesale?.enabled && <small className="os-muted">{item.wholesale.tiers.map((tier) => `${tier.minQty}+ ${priceText(tier.price)}`).join(' · ')}</small>}
                          {out ? (
                            <div className="mk-cart-qty">
                              <small className="os-muted">{st.reason}</small>
                              <button className="os-btn os-btn-dark mk-remove-out" onClick={() => removeFromCart(id)}>Remove</button>
                            </div>
                          ) : (
                          <div className="mk-cart-qty">
                            {low && <button className="os-btn os-btn-ghost mk-remove-out" onClick={() => setQty(id, st.stock)}>Change to {st.stock}</button>}
                            <div className="mk-stepper">
                              <button onClick={() => setQty(id, qty - 1 < minOrder(item) ? 0 : qty - 1)} aria-label="One less">−</button>
                              <span aria-live="polite">{qty}</span>
                              <button onClick={() => setQty(id, qty + 1)} aria-label="One more" disabled={qty >= (st?.stock ?? item.stock)}>+</button>
                            </div>
                            <button className="os-linkbtn mk-remove" onClick={() => removeFromCart(id)}>Remove</button>
                          </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
            <div className="mk-cart-foot">
              <div className="mk-cart-row"><span>Items</span><b>{priceText(subtotal)}</b></div>
              <small className="os-muted">Delivery is added per seller at checkout. Pay with M-Pesa or cash on delivery.</small>
              <div className="mk-cart-actions">
                <button type="button" className="os-btn os-btn-ghost os-btn-lg mk-cart-continue" onClick={keepShopping}>Continue shopping</button>
                <button className="os-btn os-btn-brand os-btn-lg" onClick={checkout} disabled={outIds.length > 0 || lowIds.length > 0}>
                  {outIds.length ? 'Remove out-of-stock items first' : lowIds.length ? 'Lower the quantities first' : customer ? 'Checkout →' : 'Log in to checkout →'}
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
