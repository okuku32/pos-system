import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import shopApi, { errMsg, ksh, prettyPhone, store, unitPrice } from './shopApi';
import { useShop } from './ShopContext';
import ProductImage from '../components/ProductImage';

// Slide-in cart: review items -> details -> place order. Product data is cached by the shop page.
export default function CartDrawer() {
  const { cart, setQty, clearCart, cartOpen, setCartOpen, customer, refreshOrders } = useShop();
  const navigate = useNavigate();
  const location = useLocation();
  const [products, setProducts] = useState(() => store.get('ordersasa_products', []));
  const [step, setStep] = useState('cart');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ type: 'delivery', address: '', notes: '', phone: '' });

  // Re-read the product cache when opened (prices/stock may have changed)
  useEffect(() => {
    if (!cartOpen) return;
    setProducts(store.get('ordersasa_products', []));
    shopApi.get('/shop/products').then((r) => { setProducts(r.data); store.set('ordersasa_products', r.data); }).catch(() => {});
  }, [cartOpen]);

  useEffect(() => {
    if (customer) setForm((f) => ({ ...f, address: f.address || customer.address || '', phone: f.phone || prettyPhone(customer.phone) }));
  }, [customer]);

  // Returning from login with ?checkout=1 reopens the drawer at the details step
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('checkout') === '1' && customer) {
      setCartOpen(true);
      setStep('details');
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, customer, navigate, location.pathname, setCartOpen]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setCartOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCartOpen]);

  useEffect(() => { if (!cartOpen) setStep('cart'); }, [cartOpen]);

  const byId = useMemo(() => new Map(products.map((p) => [p._id, p])), [products]);
  const lines = Object.entries(cart).map(([id, qty]) => ({ p: byId.get(id), qty })).filter((l) => l.p);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((t, l) => t + l.qty * unitPrice(l.p), 0);
  const before = lines.reduce((t, l) => t + l.qty * l.p.price, 0);
  const saved = Math.max(0, before - total);
  const SavingsBanner = () => (saved > 0 ? <div className="os-savings">🎉 You’re saving <b>{ksh(saved)}</b> on this order</div> : null);

  const place = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await shopApi.post('/shop/orders', {
        items: lines.map((l) => ({ productId: l.p._id, quantity: l.qty })),
        customer: { phone: form.phone, address: form.address },
        type: form.type,
        notes: form.notes,
      });
      clearCart();
      setCartOpen(false);
      refreshOrders().catch(() => {});
      navigate(`/track/${data.trackingToken}?placed=1`);
    } catch (err) {
      if (err.response?.status === 401) {
        toast('Please log in to place your order', { icon: '🔐' });
        navigate('/shop/login?next=checkout');
      } else toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className={`os-drawer-wrap ${cartOpen ? 'open' : ''}`} aria-hidden={!cartOpen}>
      <div className="os-overlay" onClick={() => setCartOpen(false)} />
      <aside className="os-drawer" role="dialog" aria-label="Your cart">
        <div className="os-drawer-head">
          {step === 'details' ? (
            <button className="os-icon-btn" onClick={() => setStep('cart')} aria-label="Back to cart">←</button>
          ) : <span />}
          <h3>{step === 'cart' ? `Your cart${count ? ` (${count})` : ''}` : 'Delivery details'}</h3>
          <button className="os-icon-btn" onClick={() => setCartOpen(false)} aria-label="Close cart">✕</button>
        </div>

        {!lines.length ? (
          <div className="os-empty">
            <div className="os-empty-art">🛒</div>
            <h4>Your cart is empty</h4>
            <p>Browse the shop and tap <b>Add</b> on anything you like.</p>
            <button className="os-btn os-btn-brand" onClick={() => setCartOpen(false)}>Start shopping</button>
          </div>
        ) : step === 'cart' ? (
          <>
            <div className="os-drawer-body">
              {lines.map(({ p, qty }) => (
                <div key={p._id} className="os-line">
                  <ProductImage product={p} size={56} className="os-line-img" />
                  <div className="os-line-info">
                    <span className="os-line-name">{p.name}</span>
                    <span className="os-line-price">
                      {ksh(unitPrice(p))}
                      {unitPrice(p) < p.price && <> <s>{ksh(p.price)}</s> <em className="os-off">−{p.discountPercent}%</em></>}
                    </span>
                  </div>
                  <div className="os-stepper sm">
                    <button onClick={() => setQty(p, qty - 1)} aria-label={`Remove one ${p.name}`}>−</button>
                    <span>{qty}</span>
                    <button onClick={() => setQty(p, qty + 1)} aria-label={`Add one ${p.name}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="os-drawer-foot">
              <SavingsBanner />
              {saved > 0 && (
                <>
                  <div className="os-sum sm"><span>Items total</span><span>{ksh(before)}</span></div>
                  <div className="os-sum sm save"><span>Discounts</span><span>−{ksh(saved)}</span></div>
                </>
              )}
              <div className="os-sum"><span>Subtotal</span><b>{ksh(total)}</b></div>
              <p className="os-fine">Delivery fee, if any, is confirmed by the shop. Pay with M-Pesa or cash on delivery.</p>
              {customer ? (
                <button className="os-btn os-btn-brand os-btn-lg os-block" onClick={() => setStep('details')}>
                  Checkout · {ksh(total)}
                </button>
              ) : (
                <div className="os-login-prompt">
                  <p>Log in or create a free account to place your order and track it live.</p>
                  <div className="os-row">
                    <Link className="os-btn os-btn-ghost os-grow" to="/shop/login?next=checkout" onClick={() => setCartOpen(false)}>Log in</Link>
                    <Link className="os-btn os-btn-brand os-grow" to="/shop/signup?next=checkout" onClick={() => setCartOpen(false)}>Sign up</Link>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <form className="os-drawer-form" onSubmit={place}>
            <div className="os-drawer-body">
              <div className="os-segment" role="radiogroup" aria-label="How would you like to get your order?">
                {[
                  ['delivery', '🛵', 'Delivery', 'To your door'],
                  ['pickup', '🏪', 'Pickup', 'Collect at the shop'],
                ].map(([k, icon, label, sub]) => (
                  <button type="button" key={k} role="radio" aria-checked={form.type === k} className={form.type === k ? 'on' : ''} onClick={() => setForm({ ...form, type: k })}>
                    <span className="os-seg-icon">{icon}</span>
                    <span><b>{label}</b><small>{sub}</small></span>
                  </button>
                ))}
              </div>

              {form.type === 'delivery' && (
                <label className="os-field">
                  <span>Delivery address</span>
                  <textarea rows={2} value={form.address} onChange={set('address')} required minLength={5} maxLength={200} placeholder="Estate, street, house number, landmark" />
                </label>
              )}
              <label className="os-field">
                <span>Phone for this order{customer && !customer.phone && <em> (we’ll save it to your account)</em>}</span>
                <input value={form.phone} onChange={set('phone')} required inputMode="tel" placeholder="07XX XXX XXX" />
              </label>
              <label className="os-field">
                <span>Notes for the shop <em>(optional)</em></span>
                <input value={form.notes} onChange={set('notes')} maxLength={300} placeholder="e.g. Call when you’re at the gate" />
              </label>

              <div className="os-summary">
                <div className="os-summary-head">Order summary</div>
                {lines.map(({ p, qty }) => (
                  <div key={p._id} className="os-sum sm"><span>{qty} × {p.name}</span><span>{unitPrice(p) < p.price && <s className="os-was">{ksh(p.price * qty)}</s>} {ksh(unitPrice(p) * qty)}</span></div>
                ))}
              </div>
            </div>
            <div className="os-drawer-foot">
              <SavingsBanner />
              {saved > 0 && <div className="os-sum sm save"><span>Discounts applied</span><span>−{ksh(saved)}</span></div>}
              <div className="os-sum"><span>Total to pay</span><b>{ksh(total)}</b></div>
              <p className="os-fine">💳 You’ll pay with M-Pesa or cash when you {form.type === 'delivery' ? 'receive' : 'collect'} your order.</p>
              <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy}>
                {busy ? <span className="os-spinner" /> : `Place order · ${ksh(total)}`}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
