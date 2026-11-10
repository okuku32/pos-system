import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import api, { errMsg, money } from '../api';
import Receipt from '../components/Receipt';
import MpesaWaiting from '../components/MpesaWaiting';
import Modal from '../components/Modal';
import ProductImage from '../components/ProductImage';
import { useRealtime } from '../context/RealtimeContext';
import { useAuth } from '../context/AuthContext';

const unit = (p) => p.salePrice ?? p.price; // price after product discount

export default function POS() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('All');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [phone, setPhone] = useState('');
  const [kraPin, setKraPin] = useState(''); // buyer's KRA PIN for the eTIMS invoice (optional)
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [pendingSale, setPendingSale] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null); // order being checked out
  const [orderForm, setOrderForm] = useState(null); // 'save as order' modal
  const searchRef = useRef();
  const location = useLocation();
  const navigate = useNavigate();
  const { onSale } = useRealtime();
  const { isAdmin } = useAuth();
  const [today, setToday] = useState(null);
  const loadToday = useCallback(() => {
    api.get('/sales/today').then((r) => setToday(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    loadToday();
    return onSale(() => loadToday()); // any till finishing a sale refreshes the totals
  }, [loadToday, onSale]);

  const load = useCallback(() => {
    api.get('/products').then((r) => setProducts(r.data)).catch((e) => toast.error(errMsg(e)));
    api.get('/products/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  // Arriving from the Orders page with an order to check out
  useEffect(() => {
    const order = location.state?.order;
    if (!order || !products.length) return;
    const lines = [];
    order.items.forEach((i) => {
      const p = products.find((x) => x._id === String(i.product));
      if (!p) toast.error(`${i.name} is no longer available`);
      else lines.push({ ...p, quantity: Math.min(i.quantity, p.stock) });
    });
    setCart(lines.filter((l) => l.quantity > 0));
    setDiscount(order.discount ? String(order.discount) : '');
    if (order.customer?.phone) setPhone(order.customer.phone);
    setActiveOrder(order);
    navigate('.', { replace: true, state: null });
  }, [location.state, products, navigate]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === 'All' || p.category === category) &&
        (!s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.barcode?.includes(s))
    );
  }, [products, q, category]);

  const add = (p) => {
    setCart((c) => {
      const line = c.find((l) => l._id === p._id);
      const qty = (line?.quantity || 0) + 1;
      if (qty > p.stock) {
        toast.error(`Only ${p.stock} ${p.name} in stock`);
        return c;
      }
      return line ? c.map((l) => (l._id === p._id ? { ...l, quantity: qty } : l)) : [...c, { ...p, quantity: 1 }];
    });
  };

  const setQty = (id, qty) => {
    setCart((c) =>
      c
        .map((l) => (l._id === id ? { ...l, quantity: Math.min(Math.max(0, qty), l.stock) } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  // Barcode scanners type the code then press Enter
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const code = q.trim();
    const exact = products.find((p) => p.barcode === code || p.sku?.toLowerCase() === code.toLowerCase());
    const target = exact || (visible.length === 1 ? visible[0] : null);
    if (target) {
      add(target);
      setQ('');
    }
  };

  const subtotal = cart.reduce((s, l) => s + unit(l) * l.quantity, 0);
  const listTotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);
  const promoSavings = Math.max(0, listTotal - subtotal);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const total = subtotal - disc;
  const change = Number(tendered) - total;

  const reset = () => {
    setCart([]);
    setDiscount('');
    setTendered('');
    setPhone('');
    setKraPin('');
    setShowPin(false);
    setActiveOrder(null);
    load();
    loadToday();
    searchRef.current?.focus();
  };

  const checkout = async () => {
    if (!cart.length) return toast.error('Cart is empty');
    if (method === 'cash' && !(Number(tendered) >= total)) return toast.error('Amount tendered is less than total');
    if (method === 'mpesa' && !phone.trim()) return toast.error('Enter customer phone number');
    setBusy(true);
    try {
      const { data } = await api.post('/sales', {
        cart: cart.map((l) => ({ productId: l._id, quantity: l.quantity })),
        paymentMethod: method,
        discount: disc,
        amountTendered: method === 'cash' ? Number(tendered) : undefined,
        phone: method === 'mpesa' ? phone : undefined,
        orderId: activeOrder?._id,
        customerTin: kraPin.trim() || undefined,
      });
      if (method === 'cash') {
        toast.success('Sale completed');
        setReceipt(data.sale);
        reset();
      } else {
        toast.success(data.message || 'STK push sent');
        setPendingSale(data.sale);
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const saveOrder = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        cart: cart.map((l) => ({ productId: l._id, quantity: l.quantity })),
        discount: disc,
        customer: { name: orderForm.name, phone: orderForm.phone },
        type: orderForm.type,
        notes: orderForm.notes,
      };
      const { data } = activeOrder
        ? await api.put(`/orders/${activeOrder._id}`, body)
        : await api.post('/orders', body);
      toast.success(`Order ${data.orderNo} saved`);
      setOrderForm(null);
      reset();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const openOrderForm = () =>
    setOrderForm({
      name: activeOrder?.customer?.name || '',
      phone: activeOrder?.customer?.phone || phone,
      type: activeOrder?.type || 'pickup',
      notes: activeOrder?.notes || '',
    });

  const onMpesaDone = useCallback((sale) => {
    setPendingSale(null);
    setReceipt(sale);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pos">
      <section className="pos-products">
        {today && (
          <div className="today-bar">
            <div><span>Total sales today</span><b>{money(today.revenue)}</b></div>
            <div><span>Transactions</span><b>{today.count}</b></div>
            {isAdmin && <div className="profit"><span>Total profit today</span><b>{money(today.profit)}</b></div>}
            <div><span>Discounts given</span><b>{money(today.discounts)}</b></div>
          </div>
        )}
        <div className="toolbar">
          <input
            ref={searchRef}
            className="grow"
            placeholder="Search or scan barcode…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            autoFocus
          />
        </div>
        <div className="chips">
          {['All', ...categories].map((c) => (
            <button key={c} className={`chip ${c === category ? 'active' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid">
          {visible.map((p) => (
            <button key={p._id} className="product-tile" onClick={() => add(p)} disabled={p.stock <= 0}>
              <ProductImage product={p} size={64} className="tile-img" />
              <span className="name">{p.name}</span>
              <span className="price">
                {money(unit(p))}
                {unit(p) < p.price && <s className="was">{money(p.price)}</s>}
              </span>
              {p.discountPercent > 0 && <span className="tile-deal">−{p.discountPercent}%</span>}
              <span className={`stock ${p.stock <= p.lowStockThreshold ? 'low' : ''}`}>
                {p.stock <= 0 ? 'Out of stock' : `${p.stock} in stock`}
              </span>
            </button>
          ))}
          {!visible.length && <p className="muted">No products found.</p>}
        </div>
      </section>

      <aside className="pos-cart card">
        <div className="row-between">
          <h3>Cart</h3>
          {(cart.length > 0 || activeOrder) && (
            <button className="btn ghost sm" onClick={() => { setCart([]); setActiveOrder(null); setDiscount(''); }}>
              Clear
            </button>
          )}
        </div>
        {activeOrder && (
          <div className="order-banner">
            Checking out <b>{activeOrder.orderNo}</b>
            {activeOrder.customer?.name && <> · {activeOrder.customer.name}</>}
          </div>
        )}
        <div className="cart-lines">
          {cart.map((l) => (
            <div key={l._id} className="cart-line">
              <div className="grow">
                <div>{l.name}</div>
                <small className="muted">
                  {money(unit(l))}
                  {unit(l) < l.price && <> <s>{money(l.price)}</s> <span className="deal-text">−{l.discountPercent}%</span></>}
                </small>
              </div>
              <div className="qty">
                <button onClick={() => setQty(l._id, l.quantity - 1)}>−</button>
                <input
                  type="number"
                  value={l.quantity}
                  min={1}
                  onChange={(e) => setQty(l._id, parseInt(e.target.value, 10) || 0)}
                />
                <button onClick={() => setQty(l._id, l.quantity + 1)}>+</button>
              </div>
              <div className="line-total">{money(unit(l) * l.quantity)}</div>
            </div>
          ))}
          {!cart.length && <p className="muted center">Tap a product to add it.</p>}
        </div>

        <div className="totals">
          {promoSavings > 0 && (
            <div className="row-between deal-text"><span>Product discounts</span><span>−{money(promoSavings)}</span></div>
          )}
          <div className="row-between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="row-between">
            <span>Extra discount</span>
            <input className="sm-input" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
          </div>
          <div className="row-between total"><span>Total</span><span>{money(total)}</span></div>
          {promoSavings + disc > 0 && <div className="savings-note">🎉 Customer saves {money(promoSavings + disc)}</div>}
        </div>

        {showPin ? (
          <label>
            Customer KRA PIN <small className="muted">(for a business tax invoice)</small>
            <input value={kraPin} onChange={(e) => setKraPin(e.target.value.toUpperCase())} placeholder="P051234567X" maxLength={11} />
          </label>
        ) : (
          <button type="button" className="btn ghost sm" style={{ marginBottom: 10 }} onClick={() => setShowPin(true)}>+ Add customer KRA PIN</button>
        )}

        <div className="pay-tabs">
          <button className={method === 'cash' ? 'active' : ''} onClick={() => setMethod('cash')}>Cash</button>
          <button className={method === 'mpesa' ? 'active mpesa' : ''} onClick={() => setMethod('mpesa')}>M-Pesa</button>
        </div>

        {method === 'cash' ? (
          <>
            <label>
              Amount tendered
              <input type="number" min={0} value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={total.toFixed(2)} />
            </label>
            {tendered !== '' && (
              <div className={`row-between ${change < 0 ? 'error-text' : ''}`}>
                <span>Change</span>
                <b>{money(change)}</b>
              </div>
            )}
          </>
        ) : (
          <label>
            Customer phone (Safaricom)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" />
          </label>
        )}

        <button className={`btn block lg ${method === 'mpesa' ? 'mpesa' : ''}`} disabled={busy || !cart.length} onClick={checkout}>
          {busy ? 'Processing…' : method === 'mpesa' ? `Send STK Push · ${money(Math.ceil(total))}` : `Charge ${money(total)}`}
        </button>
        <button className="btn ghost block" style={{ marginTop: 8 }} disabled={busy || !cart.length} onClick={openOrderForm}>
          {activeOrder ? 'Update order (pay later)' : 'Save as order (pay later)'}
        </button>
      </aside>

      {pendingSale && <MpesaWaiting sale={pendingSale} onDone={onMpesaDone} onClose={() => setPendingSale(null)} />}
      {receipt && <Receipt sale={receipt} onClose={() => setReceipt(null)} />}
      {orderForm && (
        <Modal title={activeOrder ? `Update ${activeOrder.orderNo}` : 'Save as order'} onClose={() => setOrderForm(null)}>
          <form className="form-grid" onSubmit={saveOrder}>
            <label>Customer name<input value={orderForm.name} onChange={(e) => setOrderForm({ ...orderForm, name: e.target.value })} required autoFocus /></label>
            <label>Phone<input value={orderForm.phone} onChange={(e) => setOrderForm({ ...orderForm, phone: e.target.value })} placeholder="07XX XXX XXX" /></label>
            <label className="span2">
              Order type
              <select value={orderForm.type} onChange={(e) => setOrderForm({ ...orderForm, type: e.target.value })}>
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
                <option value="walk-in">Held at counter</option>
              </select>
            </label>
            <label className="span2">Notes<input value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} placeholder="e.g. deliver after 5pm" /></label>
            <p className="muted span2">{cart.length} item(s) · {money(total)}. Stock is only deducted when the order is paid.</p>
            <div className="modal-actions span2">
              <button type="button" className="btn ghost" onClick={() => setOrderForm(null)}>Cancel</button>
              <button className="btn" disabled={busy}>Save order</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
