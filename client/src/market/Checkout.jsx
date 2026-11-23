import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, unitFor, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import { STORE_INFO } from '../shop/storeInfo';
import { groupBySeller, useCartCheck } from './CartDrawer';
import { AdImage } from './ListingCard';
import { useHideFabs } from './Trust';
import { AddressPin, getHere, inKenya, lastHere, AddressInput } from './Maps';
import { SplitPayWait } from './SplitPay';
import { ChosenAgentCard, clearChosenAgent, useChosenAgent } from './ChosenAgent';
import RiderScan from './RiderScan';
import './market.css';

// a Safaricom number: 07XX… / 01XX… / 2547… / +2547…
const validPhone = (phone) => /^(?:\+?254|0)?[17]\d{8}$/.test(String(phone || '').replace(/[\s-]/g, ''));

// The M-Pesa number the prompt goes to: shown by the Pay button, with ✎ change, ⌫ (delete the last digit) and clear
export function PayNumber({ phone, setPhone, label = 'M-Pesa number' }) {
  const [editing, setEditing] = useState(false);
  const input = useRef(null);
  const ok = validPhone(phone);
  useEffect(() => {
    if (editing) setTimeout(() => input.current?.focus(), 30);
  }, [editing]);
  return (
    <div className={`mk-paynum ${ok ? '' : 'bad'}`}>
      <span className="mk-paynum-label">📱 {label}</span>
      {editing || !String(phone || '').trim() ? (
        <div className="mk-paynum-edit">
          <input ref={input} value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d+\s-]/g, '').slice(0, 16))} inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" aria-label={label} aria-invalid={!ok}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (ok) setEditing(false); } }} />
          <button type="button" className="mk-paynum-key" onClick={() => { setPhone(phone.trimEnd().slice(0, -1)); input.current?.focus(); }} aria-label="Delete the last digit" title="Delete the last digit">⌫</button>
          <button type="button" className="mk-paynum-key" onClick={() => { setPhone(''); input.current?.focus(); }} aria-label="Clear the number" title="Clear">✕</button>
          <button type="button" className="os-btn os-btn-dark mk-paynum-done" disabled={!ok} onClick={() => setEditing(false)}>Done</button>
        </div>
      ) : (
        <div className="mk-paynum-show">
          <b>{phone}</b>
          <button type="button" className="os-linkbtn" onClick={() => setEditing(true)}>✎ Change number</button>
        </div>
      )}
      {!ok && <small className="mk-err-text">Enter a Safaricom number, e.g. 0712 345 678</small>}
      {ok && editing && <small className="os-muted">The M-Pesa prompt goes to this number.</small>}
    </div>
  );
}

// Checkout: delivery or pickup, then M-Pesa (one prompt for the whole cart) or cash on delivery
export default function Checkout() {
  const { customer, ready, cart, clearCart, refreshOrders, removeFromCart, setQty } = useShop();
  const { check: stock, outIds, lowIds } = useCartCheck(cart);
  const navigate = useNavigate();
  const data = useCategories();
  const groups = useMemo(() => groupBySeller(cart), [cart]);
  const canDeliver = groups.every((group) => group.canDeliver);
  const canPickup = groups.every((group) => group.canPickup);
  const [method, setMethod] = useState(canDeliver ? 'delivery' : 'pickup');
  const [county, setCounty] = useState(customer?.county || '');
  const [address, setAddress] = useState(customer?.address || '');
  const [notes, setNotes] = useState('');
  const [phone, setPhone] = useState(prettyPhone(customer?.phone || ''));
  const [pay, setPay] = useState('mpesa'); // mpesa · cod · pole (Lipa Pole Pole)
  // Lipa Pole Pole works for one item whose seller offers it
  const onlyLine = groups.length === 1 && groups[0].lines.length === 1 ? groups[0].lines[0] : null;
  const poleItem = onlyLine && onlyLine.qty === 1 && onlyLine.item.layaway?.enabled ? onlyLine : null;
  const poleWhyNot = !onlyLine ? 'Works for one item at a time' : onlyLine.qty > 1 ? 'Works for a single item (quantity 1)' : !onlyLine.item.layaway?.enabled ? 'The seller doesn’t offer it for this item' : '';
  const [poleDeposit, setPoleDeposit] = useState(0);
  const [poleWeeks, setPoleWeeks] = useState(4);
  const [busy, setBusy] = useState(false);
  // walking delivery: where the buyer is, and each shop's answer { ok, km, minutes, fee, free, reason }
  const [here, setHere] = useState(() => lastHere(30 * 60 * 1000));
  const [walk, setWalk] = useState(null);
  const [walkBusy, setWalkBusy] = useState(false);
  const cartKey = groups.map((group) => group.lines.map((line) => `${line.id}x${line.qty}`).join(',')).join(';');
  useEffect(() => {
    if (!here || !groups.length) return;
    let live = true;
    api
      .post('/orders/walk-quote', { lat: here.lat, lng: here.lng, items: groups.flatMap((group) => group.lines.map((line) => ({ listingId: line.id, qty: line.qty }))) })
      .then((response) => live && setWalk(response.data.sellers))
      .catch(() => live && setWalk({}));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, cartKey]);
  // our riders & shopping agents: prices per seller (rider needs the buyer's location)
  const [extras, setExtras] = useState(null);
  // 🔍 the rider scan ("Kapu rider"): riders near each shop, the delivery time and the fare; { status, data, key }
  const [riderScan, setRiderScan] = useState(null);
  const agent = useChosenAgent(); // booked on a market's page: filled in here, and the inspection is ticked for them
  // the buyer's choice: 'inspect' (“Inspect my goods”: KSh 200 added at once) or 'none' (“Don't inspect”: no fee).
  // '' = not chosen yet: they choose before paying (the server never charges without the choice)
  const [inspectChoice, setInspectChoice] = useState('');
  const inspect = inspectChoice === 'inspect';
  const setInspect = (on) => setInspectChoice(on ? 'inspect' : 'none');
  const [inspectNotes, setInspectNotes] = useState('');
  useEffect(() => {
    if (!groups.length) return;
    let live = true;
    api
      .post('/orders/extras-quote', { ...(here ? { lat: here.lat, lng: here.lng } : {}), ...(agent?._id ? { agentId: agent._id } : {}), items: groups.flatMap((group) => group.lines.map((line) => ({ listingId: line.id, qty: line.qty }))) })
      .then((response) => live && setExtras({ ...response.data, at: here })) // remember which location these prices are for
      .catch(() => live && setExtras({ sellers: {} }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, cartKey, agent?._id]); // a newly booked agent: their contacts
  const inspectFor = (group) => extras?.sellers?.[group.sellerId]?.inspection;
  const scanKey = here ? `${here.lat.toFixed(4)},${here.lng.toFixed(4)}|${cartKey}` : '';
  const scanRiders = async () => {
    if (!here || !groups.length) return;
    const key = scanKey;
    setRiderScan({ status: 'scanning', key });
    const started = Date.now();
    try {
      const response = await api.post('/orders/rider-scan', { lat: here.lat, lng: here.lng, items: groups.flatMap((group) => group.lines.map((line) => ({ listingId: line.id, qty: line.qty }))) });
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1400 - (Date.now() - started)))); // long enough to see it scan
      setRiderScan({ status: 'done', data: response.data, key });
    } catch (err) {
      setRiderScan({ status: 'error', message: errMsg(err), key });
    }
  };
  // the shopping agent at each seller's market, linked automatically when the buyer asks for an inspection
  const marketAgentFor = (group) => extras?.sellers?.[group.sellerId]?.inspectionAgent || null;
  const inspectRef = useRef(null);
  const canInspect = groups.length > 0 && groups.every((group) => inspectFor(group)?.ok);
  const inspectFeeTotal = groups.reduce((sum, group) => sum + (inspectFor(group)?.fee || 0), 0); // KSh 200 per seller
  const askInspect = STORE_INFO.fieldwork?.inspectEnabled !== false && method !== 'verified' && canInspect; // the two buttons are shown
  // our rider checks the items at the shop for FREE; the inspection fee is only for a shopping agent
  // (pickup / the seller's own delivery / walking) and for far deliveries sent by courier
  const riderCheck = inspect && canInspect && method === 'rider';
  const paidInspect = inspect && canInspect; // KSh 200, by our rider (rider delivery) or our agent: only when the buyer asks
  const agentInspect = paidInspect && method !== 'rider';
  const scannedFor = (group) => (riderScan?.status === 'done' ? riderScan.data?.sellers?.[group.sellerId] : null);
  const riderFor = (group) => {
    const quick = extras?.sellers?.[group.sellerId]?.rider;
    const scanned = scannedFor(group);
    return quick?.ok && scanned?.ok ? { ...quick, fee: scanned.fee, km: scanned.km, minutes: scanned.minutes, byRoad: scanned.byRoad } : quick;
  };
  const canRider = !!here && groups.length > 0 && groups.every((group) => riderFor(group)?.ok);
  // far away (60 km+): our agent sends it by courier (bus / matatu parcel); fares differ by company
  const courierOn = STORE_INFO.courier?.enabled !== false;
  const courierFor = (group) => extras?.sellers?.[group.sellerId]?.courier;
  const canCourier = courierOn && !!here && groups.length > 0 && groups.every((group) => courierFor(group)?.ok);
  const courierOpts = canCourier ? courierFor(groups[0]).options : [];
  const [courierPick, setCourierPick] = useState('');
  const courierKey = courierOpts.map((courierOpt) => courierOpt.id).join(',');
  useEffect(() => {
    if (courierOpts.length && !courierOpts.some((courierOpt) => courierOpt.id === courierPick)) setCourierPick(courierOpts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courierKey]);
  const courierLine = (group) => {
    const courierForResult = courierFor(group);
    const order = courierForResult?.options?.find((item) => item.id === courierPick);
    return order ? { ...order, handling: courierForResult.handling, km: courierForResult.km } : null;
  };
  const courierTotal = (id) => groups.reduce((sum, group) => sum + (courierFor(group)?.options?.find((item) => item.id === id)?.total || 0), 0);
  // the address from the map fills the address box, unless the buyer typed their own
  const autoAddr = useRef('');
  // a Google suggestion picked in the address field: the exact spot goes on the map (and prices the delivery)
  const placePicked = (place) => {
    setHere({ lat: place.lat, lng: place.lng, at: Date.now(), source: 'search', placeId: place.placeId });
    if (place.county) setCounty(place.county);
  };
  const fillAddress = (text, source) => {
    setAddress((previousAddress) => (source === 'search' || !previousAddress || previousAddress === autoAddr.current ? text : previousAddress));
    autoAddr.current = text;
  };
  // 🛡️ Safe deal (second-hand items): verified at our nearest partner shop before the seller is paid, then our rider delivers
  const safeFor = (group) => extras?.sellers?.[group.sellerId]?.verified;
  const safeShown = STORE_INFO.fieldwork?.riderEnabled !== false && !!extras && groups.some((group) => { const quote = safeFor(group); return quote && (quote.ok || !/second-hand/.test(quote.reason || '')); });
  const canSafe = !!here && groups.length > 0 && groups.every((group) => safeFor(group)?.ok && safeFor(group)?.riderFee != null);
  const [safeBusy, setSafeBusy] = useState(false);
  const chooseSafe = async () => {
    if (here) return setMethod('verified');
    setSafeBusy(true);
    try {
      const position = await getHere();
      if (!inKenya(position.lat, position.lng)) throw new Error('Your location looks like it’s outside Kenya');
      setHere(position);
      setMethod('verified');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSafeBusy(false);
    }
  };
  const [riderBusy, setRiderBusy] = useState(false);
  const chooseRider = async () => {
    if (here) return setMethod('rider');
    setRiderBusy(true);
    try {
      const position = await getHere();
      if (!inKenya(position.lat, position.lng)) throw new Error('Your location looks like it’s outside Kenya');
      setHere(position);
      setMethod('rider');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRiderBusy(false);
    }
  };
  // came from a mama mboga's basket: start with the delivery it priced
  const [params] = useSearchParams();
  const wanted = useRef(params.get('method'));
  useEffect(() => {
    const match = wanted.current;
    if (!match || !groups.length) return;
    if (match === 'rider' && here && extras && canRider) {
      setMethod('rider');
      wanted.current = null;
    } else if (match === 'walk' && here && walk && groups.every((group) => walk[group.sellerId]?.ok)) {
      setMethod('walk');
      wanted.current = null;
    } else if (!here && (match === 'rider' || match === 'walk')) {
      getHere().then((location) => inKenya(location.lat, location.lng) && setHere(location)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, extras, walk, canRider, groups.length]);
  useEffect(() => {
    if (method === 'rider' && extras && here && extras.at === here && !canRider) setMethod(canDeliver ? 'delivery' : 'pickup');
  }, [method, extras, here, canRider, canDeliver]);
  useEffect(() => {
    if ((paidInspect || method === 'courier' || method === 'verified') && pay !== 'mpesa') setPay('mpesa'); // a paid inspection and courier are paid with M-Pesa
  }, [paidInspect, pay, method]);
  useEffect(() => {
    if (method === 'courier' && extras && here && extras.at === here && !canCourier) setMethod(canDeliver ? 'delivery' : 'pickup');
  }, [method, extras, here, canCourier, canDeliver]);
  useEffect(() => {
    if (method === 'verified' && extras && here && extras.at === here && !canSafe) setMethod(canDeliver ? 'delivery' : 'pickup');
    if (method === 'verified' && inspect) setInspect(false); // the partner shop checks it fully
  }, [method, extras, here, canSafe, canDeliver, inspect]);
  const walkFor = (group) => walk?.[group.sellerId];
  const canWalk = !!walk && groups.length > 0 && groups.every((group) => walkFor(group)?.ok);
  const someWalk = !!walk && groups.some((group) => walkFor(group)?.ok);
  const chooseWalk = async () => {
    if (here) return setMethod('walk');
    setWalkBusy(true);
    try {
      const position = await getHere();
      if (!inKenya(position.lat, position.lng)) throw new Error('Your location looks like it’s outside Kenya');
      setHere(position);
      setMethod('walk');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setWalkBusy(false);
    }
  };
  useEffect(() => {
    if (method === 'walk' && walk && !canWalk) setMethod(canDeliver ? 'delivery' : 'pickup');
  }, [method, walk, canWalk, canDeliver]);
  const [waiting, setWaiting] = useState(null); // { checkoutId, amount, status, failReason, orders }
  const poll = useRef(null);
  useSeo({ title: 'Checkout', noindex: true });
  useHideFabs();

  useEffect(() => {
    if (customer) {
      setCounty((previousCounty) => previousCounty || customer.county || '');
      setAddress((previousAddress) => previousAddress || customer.address || '');
      setPhone((previousPhone) => previousPhone || prettyPhone(customer.phone || ''));
    }
  }, [customer]);
  useEffect(() => () => clearInterval(poll.current), []);
  // "Kapu rider" chosen: scan for riders near the shop(s) (again when the place or the cart changes)
  useEffect(() => {
    if (method === 'rider' && canRider && scanKey && riderScan?.key !== scanKey && riderScan?.status !== 'scanning') scanRiders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, canRider, scanKey]);
  useEffect(() => {
    if (pay === 'pole' && (!poleItem || method === 'walk' || method === 'rider' || method === 'courier' || method === 'verified')) setPay('mpesa');
  }, [pay, poleItem, method]);

  if (ready && !customer) return <Navigate to="/login?next=checkout" replace />;
  const poleTotal = poleItem ? poleItem.item.price + (method === 'delivery' && poleItem.item.delivery?.available ? poleItem.item.delivery.fee || 0 : 0) : 0;
  const poleMin = poleItem ? Math.ceil((poleTotal * (poleItem.item.layaway.minDepositPercent || 30)) / 100) : 0;
  const poleDepositNow = Math.min(Math.max(poleDeposit || poleMin, poleMin), Math.max(poleMin, poleTotal - 100));
  const poleWeeksNow = poleItem ? Math.min(poleWeeks, poleItem.item.layaway.maxWeeks || 4) : 0;
  const feeOf = (group) => (method === 'delivery' ? group.deliveryFee : method === 'walk' ? walkFor(group)?.fee || 0 : method === 'rider' ? riderFor(group)?.fee || 0 : method === 'courier' ? courierLine(group)?.total || 0 : method === 'verified' ? safeFor(group)?.riderFee || 0 : 0);
  const deliveryTotal = groups.reduce((sum, group) => sum + feeOf(group), 0);
  const itemsTotal = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const inspectTotal = paidInspect ? groups.reduce((sum, group) => sum + (inspectFor(group)?.fee || 0), 0) : 0;
  const verifyTotal = method === 'verified' ? groups.reduce((sum, group) => sum + (safeFor(group)?.fee || 0), 0) : 0;
  // M-Pesa from ONE seller: paid straight to that seller's Till / Paybill / Pochi, plus our agent's verification fee
  // (the server decides: a seller without M-Pesa details or a shop on the map is paid through Kapu instead)
  // M-Pesa from SEVERAL sellers: one payment to the Kapu wallet for the goods and the delivery fees
  const directFee = Number(STORE_INFO.fieldwork?.directFee ?? 200) || 0;
  const manySellers = groups.length > 1;
  const splitFee = 0; // no automatic fee: inspection is optional (KSh 200 when the buyer asks for it)
  void directFee;
  const total = itemsTotal + deliveryTotal + inspectTotal + verifyTotal + splitFee;
  // ⬆️ on a phone, what the buyer just chose comes up to the top of the screen (no scrolling all the way down)
  const gotSection = useRef(null);
  const detailsRef = useRef(null);
  const paySection = useRef(null);
  const summaryRef = useRef(null);
  const jumpBar = useRef(null);
  const picked = useRef(0); // when the buyer last tapped a way to get it
  const bringUp = (ref, always = false) => {
    if (!always && !window.matchMedia?.('(max-width: 1000px)').matches) return;
    const el = ref.current;
    if (!el) return;
    const header = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--mk-header-h'), 10) || 64;
    const top = el.getBoundingClientRect().top + window.scrollY - header - (jumpBar.current?.offsetHeight || 0) - 10;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };
  // "Full summary & pay": the summary comes up to the top of the screen and glows for a moment, so it's easy to spot
  const showSummary = () => {
    bringUp(summaryRef, true);
    const box = summaryRef.current;
    if (!box) return;
    box.classList.remove('flash');
    void box.offsetWidth; // restart the glow when tapped again
    box.classList.add('flash');
    setTimeout(() => box.classList.remove('flash'), 1600);
  };
  // a way to get it was chosen: its county / address / details come up (once they show; rider and safe deal wait for the location)
  useEffect(() => {
    if (!picked.current || Date.now() - picked.current > 15000) return undefined;
    const timer = setTimeout(() => {
      if (!detailsRef.current?.childElementCount) return;
      picked.current = 0;
      bringUp(detailsRef);
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, canRider, canSafe, canWalk, canCourier]);
  // typing an address on a phone: the field (and its suggestions) come up above the keyboard
  const fieldUp = (event) => {
    if (event.target.matches?.('input:not([type=radio]):not([type=checkbox])')) setTimeout(() => bringUp({ current: event.target.closest('label') || event.target }), 250);
  };
  const METHOD_NAMES = { delivery: 'Delivery', pickup: 'Pickup', walk: 'Walking delivery', rider: 'Rider', verified: 'Safe deal', courier: 'Courier' };
  const PAY_NAMES = { mpesa: 'M-Pesa', cod: 'Pay on delivery', pole: 'Lipa Pole Pole' };
  // the goods (and a paid inspection) are paid now; the delivery fee is paid on delivery, to the rider or the seller's
  // delivery person, except: courier (our agent pays the fare) and several sellers by M-Pesa (paid with the goods)
  const onDelivery = method === 'courier' || (pay === 'mpesa' && manySellers) ? 0 : deliveryTotal;
  const payNow = total - onDelivery;
  const fw = STORE_INFO.fieldwork || {};

  const finish = (orders) => {
    clearCart(groups.flatMap((group) => group.lines.map((line) => line.id)));
    refreshOrders().catch(() => {});
    navigate(orders.length === 1 ? `/orders/${orders[0]._id}?new=1` : '/orders?new=1', { replace: true });
  };

  const watch = (checkoutId) => {
    clearInterval(poll.current);
    const started = Date.now();
    poll.current = setInterval(async () => {
      try {
        const response = await api.get(`/orders/checkout/${checkoutId}`);
        setWaiting((previousWaiting) => ({ ...previousWaiting, status: response.data.status, failReason: response.data.failReason, orders: response.data.orders }));
        if (response.data.status === 'paid') {
          clearInterval(poll.current);
          toast.success('Payment received. Asante! 🎉');
          setTimeout(() => finish(response.data.orders), 900);
        } else if (response.data.status === 'failed' || Date.now() - started > 3 * 60 * 1000) clearInterval(poll.current);
      } catch {
        /* keep trying */
      }
    }, 3000);
  };

  const startPolePole = async () => {
    setBusy(true);
    try {
      const response = await api.post('/plans', { listingId: poleItem.id, deposit: poleDepositNow, weeks: poleWeeksNow, offerId: poleItem.item.offerId, phone, delivery: { method, county, address, notes } });
      clearCart([poleItem.id]);
      toast(response.data.message || 'Check your phone to pay the deposit', { icon: '📲' });
      navigate(`/plans/${response.data.plan._id}`, { replace: true });
    } catch (err) {
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const place = async (event) => {
    event.preventDefault();
    if (pay === 'pole') return startPolePole();
    if (!groups.length) return toast.error('Your cart is empty');
    if (askInspect && !inspectChoice) {
      inspectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast.error('Choose “Inspect my goods” or “Don’t inspect” first');
    }
    setBusy(true);
    try {
      const response = await api.post('/orders/checkout', {
        items: groups.flatMap((group) => group.lines.map((line) => ({ listingId: line.id, qty: line.qty, offerId: line.item.offerId }))),
        delivery: {
          method, county, address, notes,
          ...(here && method !== 'pickup' ? { lat: here.lat, lng: here.lng, pin: here.source || 'gps', placeId: here.placeId || undefined, accuracy: here.accuracy || undefined } : {}),
          ...(method === 'courier' ? { courier: courierPick } : {}),
        },
        payment: { method: pay, phone },
        ...(method === 'rider' && riderScan?.status === 'done' ? { riderPicks: Object.fromEntries(Object.entries(riderScan.data?.sellers || {}).filter(([, found]) => found.pick).map(([sellerId, found]) => [sellerId, found.pick])) } : {}),
        inspection: inspect && canInspect ? { choice: 'inspect', notes: inspectNotes } : { choice: 'none' }, // the buyer's explicit choice
        ...(agentInspect && agent ? { agentId: agent._id } : {}), // the agent they booked does the inspection
      });
      if (response.data.payment.split) {
        // several sellers: each is paid directly, one M-Pesa payment per seller
        setWaiting({ split: true, checkoutId: response.data.checkoutId, initial: { ...response.data.payment, checkoutId: response.data.checkoutId, orders: response.data.orders } });
      } else if (response.data.payment.status === 'paid') {
        toast.success(response.data.payment.demo ? 'Demo payment: marked paid (M-Pesa isn’t connected yet)' : 'Paid!');
        finish(response.data.orders);
      } else if (pay === 'cod') {
        toast.success(response.data.orders.length > 1 ? `${response.data.orders.length} orders placed!` : 'Order placed!');
        finish(response.data.orders);
      } else {
        setWaiting({ checkoutId: response.data.checkoutId, amount: response.data.payment.amount, status: 'pending', orders: response.data.orders, message: response.data.payment.message });
        watch(response.data.checkoutId);
      }
    } catch (err) {
      if (err.response?.status === 409 && agent && /shopping agent/i.test(errMsg(err))) clearChosenAgent(); // that agent can't take jobs any more
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    try {
      await api.post(`/orders/checkout/${waiting.checkoutId}/pay`, { phone });
      setWaiting((previousWaiting) => ({ ...previousWaiting, status: 'pending', failReason: '' }));
      watch(waiting.checkoutId);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const useCod = async () => {
    try {
      const response = await api.post(`/orders/checkout/${waiting.checkoutId}/cod`);
      clearInterval(poll.current);
      toast.success('Done: you’ll pay cash on delivery');
      finish(response.data.orders);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (waiting?.split) {
    return (
      <div className="mk"><div className="mk-wrap mk-narrow">
        <SplitPayWait checkoutId={waiting.checkoutId} initial={waiting.initial} phone={phone} onFinished={finish} onCod={useCod} />
      </div></div>
    );
  }
  if (waiting) {
    const failed = waiting.status === 'failed';
    return (
      <div className="mk"><div className="mk-wrap mk-narrow">
        <div className={`mk-pay-wait ${failed ? 'failed' : ''}`}>
          <div className="mk-pay-icon">{failed ? '⚠️' : waiting.status === 'paid' ? '✅' : '📲'}</div>
          {waiting.status === 'paid' ? <h1>Payment received!</h1> : failed ? <h1>Payment not completed</h1> : <h1>Check your phone</h1>}
          {!failed && waiting.status !== 'paid' && (
            <>
              <p>We sent an M-Pesa request for <b>{priceText(waiting.amount)}</b> to <b>{phone}</b>. Enter your M-Pesa PIN to pay.</p>
              <details className="mk-paynum-wrong">
                <summary>Wrong number? Change it</summary>
                <PayNumber phone={phone} setPhone={setPhone} label="Send the M-Pesa prompt to" />
                <button type="button" className="os-btn os-btn-brand" disabled={!validPhone(phone)} onClick={retry}>📲 Send to this number</button>
              </details>
              <div className="mk-pay-spinner"><span className="page-spinner" /> Waiting for M-Pesa…</div>
              <small className="os-muted">Your money is held by {STORE_INFO.name} and passed to the seller only after delivery.</small>
            </>
          )}
          {failed && (
            <>
              <p>{waiting.failReason || 'The payment was cancelled or timed out.'} Your items are reserved for 30 minutes.</p>
              <PayNumber phone={phone} setPhone={setPhone} label="Try again with M-Pesa number" />
              <div className="os-row center">
                <button className="os-btn os-btn-brand" onClick={retry}>Try M-Pesa again</button>
                <button className="os-btn os-btn-ghost" onClick={useCod}>Pay cash on delivery instead</button>
              </div>
            </>
          )}
          {!failed && waiting.status !== 'paid' && (
            <div className="os-row center mk-mt">
              <button className="os-btn os-btn-ghost" onClick={retry}>Didn’t get it? Send again</button>
              <button className="os-btn os-btn-ghost" onClick={useCod}>Pay cash on delivery instead</button>
            </div>
          )}
        </div>
      </div></div>
    );
  }

  if (!groups.length) {
    return (
      <div className="mk"><div className="mk-wrap mk-narrow">
        <div className="os-empty">
          <div className="os-empty-art">🛒</div>
          <h4>Your cart is empty</h4>
          <Link to="/market/search?buyNow=1" className="os-btn os-btn-brand">Find items to buy online</Link>
        </div>
      </div></div>
    );
  }

  return (
    <div className="mk">
      <nav className="mk-co-jump" ref={jumpBar} aria-label="Checkout steps">
        <div className="mk-wrap mk-co-jump-row">
          <button type="button" onClick={() => bringUp(gotSection, true)}><span className="mk-step">1</span> {METHOD_NAMES[method] || 'Get it'}</button>
          <button type="button" onClick={() => bringUp(paySection, true)}><span className="mk-step">2</span> {PAY_NAMES[pay] || 'Payment'}</button>
          <button type="button" className="sum" onClick={showSummary} aria-label={`Order summary and pay, total ${priceText(total)}`}>🧾 Pay {priceText(total)}</button>
        </div>
      </nav>
      <form className="mk-wrap mk-checkout" onSubmit={place}>
        <div className="mk-checkout-main">
          <div className="mk-checkout-head">
            <h1>Checkout</h1>
            <Link to="/market/search?buyNow=1" className="os-btn os-btn-ghost mk-continue-shop">← Continue shopping</Link>
          </div>
          {/* phones: what's in the order, right at the top (the full summary and the pay button are further down) */}
          <OrderGlance groups={groups} total={total} onMore={showSummary} />
          {(outIds.length > 0 || lowIds.length > 0) && (
            <div className="mk-box mk-stock-alert big" role="alert">
              <b>⚠️ Some items changed since you added them</b>
              <ul>
                {outIds.map((id) => <li key={id}><span className="mk-stock-badge out">Out of stock</span> {cart[id].item.title} <button type="button" className="os-btn os-btn-dark" onClick={() => removeFromCart(id)}>Remove</button></li>)}
                {lowIds.map((id) => <li key={id}><span className="mk-stock-badge low">Only {stock[id].stock} left</span> {cart[id].item.title} <button type="button" className="os-btn os-btn-ghost" onClick={() => setQty(id, stock[id].stock)}>Change to {stock[id].stock}</button></li>)}
              </ul>
              {outIds.length > 1 && <button type="button" className="os-btn os-btn-dark" onClick={() => outIds.forEach((id) => removeFromCart(id))}>Remove all out-of-stock items</button>}
            </div>
          )}

          <section className="mk-box" ref={gotSection} onFocus={fieldUp}>
            <h2><span className="mk-step">1</span> How do you want to get it?</h2>
            {method !== 'pickup' && <AddressPin here={here} onPin={setHere} address={address} onAddress={fillAddress} onCounty={setCounty} fieldSearch />}
            <div className="mk-choice" onChange={() => { picked.current = Date.now(); }}>
              <label className={method === 'delivery' ? 'on' : ''} aria-disabled={!canDeliver}>
                <input type="radio" name="method" checked={method === 'delivery'} disabled={!canDeliver} onChange={() => setMethod('delivery')} />
                <span>🚚 <b>Delivery</b><small>{canDeliver ? (deliveryTotal || groups.some((group) => group.deliveryFee) ? `From the seller${groups.length > 1 ? 's' : ''}: ${priceText(groups.reduce((sum, group) => sum + group.deliveryFee, 0))}` : 'Free delivery') : 'Not available for every item'}</small></span>
              </label>
              <label className={method === 'pickup' ? 'on' : ''} aria-disabled={!canPickup}>
                <input type="radio" name="method" checked={method === 'pickup'} disabled={!canPickup} onChange={() => setMethod('pickup')} />
                <span>📍 <b>Pick up</b><small>{canPickup ? `From the seller${groups.length > 1 ? 's' : ''} (free)` : 'Not available for every item'}</small></span>
              </label>
              <label className={`${method === 'walk' ? 'on' : ''} mk-choice-walk`} aria-disabled={!!walk && !canWalk}>
                <input type="radio" name="method" checked={method === 'walk'} disabled={walkBusy || (!!walk && !canWalk)} onChange={chooseWalk} />
                <span>🚶 <b>Walking delivery</b><small>{walkBusy ? 'Finding you…' : !here ? 'Shops close to you can walk it over. Tap to check with your location' : !walk ? 'Checking…' : canWalk ? (deliveryTotal || groups.some((group) => walkFor(group)?.fee) ? `${priceText(groups.reduce((sum, group) => sum + (walkFor(group)?.fee || 0), 0))}, about ${Math.max(...groups.map((group) => walkFor(group).minutes))} min` : `Free${groups.every((group) => walkFor(group)?.free === 'after-sale') ? ': after-sale service' : ''}, about ${Math.max(...groups.map((group) => walkFor(group).minutes))} min`) : someWalk ? 'Not every seller in your cart is close enough' : (groups.map((group) => walkFor(group)?.reason).find(Boolean) || 'Not available here')}</small></span>
              </label>
              {STORE_INFO.fieldwork?.riderEnabled !== false && (
                <label className={`${method === 'rider' ? 'on' : ''} mk-choice-rider`} aria-disabled={!!here && !!extras && !canRider}>
                  <input type="radio" name="method" checked={method === 'rider'} disabled={riderBusy || (!!here && !!extras && !canRider)} onChange={chooseRider} />
                  <span>🏍️ <b>{`${STORE_INFO.name} rider`}</b><span className="mk-trusted">✔ Trusted &amp; trained: ID-checked and trained by our team</span><small>{riderBusy ? 'Finding you…' : !here ? 'A rider near the shop brings it to your door. Tap to price it with your location' : !extras ? 'Checking…' : canRider ? `${priceText(groups.reduce((sum, group) => sum + (riderFor(group)?.fee || 0), 0))}, about ${Math.max(...groups.map((group) => riderFor(group).km))} km${groups.every((group) => riderFor(group).byRoad) ? ` by road, ~${Math.max(...groups.map((group) => riderFor(group).minutes))} min` : ''}. Priced by distance and time, like Uber / Bolt; paid to the rider on delivery, not now.` : (groups.map((group) => riderFor(group)?.reason).find(Boolean) || 'Not available here')}</small></span>
                </label>
              )}
              {safeShown && (
                <label className={`${method === 'verified' ? 'on' : ''} mk-choice-safe`} aria-disabled={!!here && !canSafe}>
                  <input type="radio" name="method" checked={method === 'verified'} disabled={safeBusy || (!!here && !canSafe)} onChange={chooseSafe} />
                  <span>🛡️ <b>Safe deal: verified at a partner shop</b><span className="mk-trusted">✔ For second-hand items: checked before the seller is paid</span><small>{safeBusy ? 'Finding you…' : !here ? 'The seller drops it at our partner shop; once verified, our rider brings it to you. Tap to price it with your location' : canSafe ? `Verification ${priceText(groups.reduce((sum, group) => sum + (safeFor(group)?.fee || 0), 0))} now, rider ${priceText(groups.reduce((sum, group) => sum + (safeFor(group)?.riderFee || 0), 0))} on delivery. Checked at ${safeFor(groups[0]).partner.name}, ${safeFor(groups[0]).partner.area}.` : (groups.map((group) => safeFor(group)?.reason).find(Boolean) || 'Not available here')}</small></span>
                </label>
              )}
              {courierOn && (
                <label className={`${method === 'courier' ? 'on' : ''} mk-choice-courier`} aria-disabled={!canCourier}>
                  <input type="radio" name="method" checked={method === 'courier'} disabled={!canCourier} onChange={() => setMethod('courier')} />
                  <span>🚌 <b>Courier: bus or matatu parcel</b><span className="mk-trusted">✔ Sent for you by our trained agent</span><small>{!here ? `For deliveries ${STORE_INFO.courier?.minKm || 60} km or more away. Pin your location above to check` : !extras ? 'Checking…' : canCourier ? `From ${priceText(Math.min(...courierOpts.map((courierOpt) => courierTotal(courierOpt.id))))} · you’re about ${Math.round(courierFor(groups[0]).km)} km away. Collect it at the courier’s office in your town.` : (groups.map((group) => courierFor(group)?.reason).find(Boolean) || 'Not available here')}</small></span>
                </label>
              )}
            </div>
            <div ref={detailsRef} className="mk-co-details">
            {method === 'courier' && canCourier && (
              <div className="mk-courier mk-mt">
                <b className="mk-courier-title">Choose a courier <small>(fares differ by company)</small></b>
                <div className="mk-courier-list" role="radiogroup" aria-label="Courier company">
                  {courierOpts.map((courierOpt) => (
                    <label key={courierOpt.id} className={courierPick === courierOpt.id ? 'on' : ''}>
                      <input type="radio" name="courier" checked={courierPick === courierOpt.id} onChange={() => setCourierPick(courierOpt.id)} />
                      <span className="mk-courier-name"><b>{courierOpt.name}</b><small>{courierOpt.eta}{courierOpt.note ? ` · ${courierOpt.note}` : ''}</small></span>
                      <span className="mk-courier-price"><b>{priceText(courierTotal(courierOpt.id))}</b><small>fare {priceText(groups.reduce((sum, group) => sum + (courierFor(group)?.options?.find((item) => item.id === courierOpt.id)?.fare || 0), 0))} + agent {priceText(groups.reduce((sum, group) => sum + (courierFor(group)?.handling || 0), 0))}</small></span>
                    </label>
                  ))}
                </div>
                <div className="mk-form-grid mk-mt">
                  <label className="os-field">
                    <span>Your county *</span>
                    <select value={county} onChange={(event) => setCounty(event.target.value)} required>
                      <option value="">Choose…</option>
                      {data?.counties.map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="os-field mk-span2">
                    <span>Your town / estate (where you’ll collect it) *</span>
                    <AddressInput value={address} onChange={setAddress} onPlace={placePicked} required minLength={3} placeholder="e.g. Kisumu town, Milimani estate" autoComplete="address-level2" />
                  </label>
                </div>
                <ol className="mk-courier-steps">
                  <li>The seller packs your order{inspect && canInspect ? ' and our agent inspects it' : ''}.</li>
                  <li>Our agent takes it to {courierOpts.find((courierOpt) => courierOpt.id === courierPick)?.name || 'the courier'}, pays the fare and sends it.</li>
                  <li>You get the <b>waybill number</b> here and as a notification.</li>
                  <li>Collect it at their office in {county || 'your town'} with your ID, then tap “I received it”.</li>
                </ol>
                <small className="os-muted">Fares are estimates for about {courierFor(groups[0]).kg} kg{courierFor(groups[0]).assumedKg ? ' (the seller didn’t give a weight)' : ''}. Paid now with M-Pesa; our agent pays the courier for you.</small>
              </div>
            )}
            {method === 'rider' && canRider && (
              <div className="mk-form-grid mk-mt">
                <div className="mk-span-all"><RiderScan scan={riderScan} groups={groups} onRescan={scanRiders} /></div>
                <label className="os-field mk-span-all">
                  <span>Where should the rider bring it? *</span>
                  <AddressInput value={address} onChange={setAddress} onPlace={placePicked} required minLength={5} placeholder="Start typing: estate, building, street or a landmark" />
                </label>
                <small className="os-muted mk-span-all">{riderCheck ? 'Our rider checks the items at the shop (KSh 200), then brings them to you' : 'A rider near the shop picks it up once the seller confirms'}, and you’ll see their name and phone here. {onDelivery > 0 ? `You pay the rider the ${priceText(onDelivery)} delivery fee when it arrives (cash or M-Pesa), not now.` : ''}</small>
              </div>
            )}
            {method === 'verified' && canSafe && (
              <div className="mk-safe mk-mt">
                <ol className="mk-courier-steps">
                  <li>You pay for the item and the verification now with M-Pesa. <b>We hold the money</b>; the seller isn’t paid yet.</li>
                  <li>The seller takes the item to our partner shop: <b>{safeFor(groups[0]).partner.name}</b>, {safeFor(groups[0]).partner.address || safeFor(groups[0]).partner.area}.</li>
                  <li>The partner checks it matches the ad, works, is in the condition described and is genuine (serial / IMEI recorded).</li>
                  <li><b>Passed:</b> the seller is paid and our rider brings it to you; you pay the rider’s {priceText(deliveryTotal)} on delivery. <b>Failed:</b> you get the item price back.</li>
                </ol>
                <label className="os-field mk-mt">
                  <span>Where should the rider bring it? *</span>
                  <AddressInput value={address} onChange={setAddress} onPlace={placePicked} required minLength={5} placeholder="Start typing: estate, building, street or a landmark" />
                </label>
                <small className="os-muted"><Link to="/verify-centres">See all our partner shops</Link></small>
              </div>
            )}
            {method === 'walk' && canWalk && (
              <div className="mk-form-grid mk-mt">
                <label className="os-field mk-span-all">
                  <span>Where should they bring it? *</span>
                  <AddressInput value={address} onChange={setAddress} onPlace={placePicked} required minLength={5} placeholder="Start typing: estate, building, street or a landmark" />
                </label>
                <small className="os-muted mk-span-all">The shop sees your pin on Google Maps, so they can find you. Someone walks it over in about {Math.max(...groups.map((group) => walkFor(group).minutes))} minutes after they confirm.</small>
              </div>
            )}
            {method === 'delivery' && (
              <div className="mk-form-grid mk-mt">
                <label className="os-field">
                  <span>County *</span>
                  <select value={county} onChange={(event) => setCounty(event.target.value)} required>
                    <option value="">Choose…</option>
                    {data?.counties.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="os-field mk-span2">
                  <span>Delivery address *</span>
                  <AddressInput value={address} onChange={setAddress} onPlace={placePicked} required minLength={5} placeholder="Start typing: estate, street, building" />
                </label>
              </div>
            )}
            {method === 'pickup' && (
              <ul className="mk-pickup-list">
                {groups.map((group) => <li key={group.sellerId}>📍 <b>{group.sellerName}</b>: {group.area}. The seller will share the exact place in chat.</li>)}
              </ul>
            )}
            </div>
            <label className="os-field mk-mt">
              <span>Note for the seller <em>(optional)</em></span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} placeholder="e.g. call when you reach the gate" />
            </label>
            {/* 🔍 the choice: “Inspect my goods” (KSh 200 added at once) or “Don’t inspect” (no inspection fee) */}
            {STORE_INFO.fieldwork?.inspectEnabled !== false && method !== 'verified' && (
              <div ref={inspectRef} className={`mk-inspect-opt ${inspect ? 'on' : ''}`} aria-disabled={!!extras && !canInspect}>
                <div className="mk-inspect-q">
                  <span className="mk-verify-ask-icon" aria-hidden="true">🔍</span>
                  <div>
                    <b id="mk-inspect-q">Do you want your goods inspected before they’re sent? {canInspect && <span className="mk-reco-tag">Highly recommended</span>}</b>
                    <small>{!extras ? 'Checking…' : !canInspect ? groups.map((group) => inspectFor(group)?.reason).find(Boolean) : `${method === 'rider' ? 'Our rider checks it at the shop before collecting' : method === 'courier' ? 'Our agent checks it before sending it by courier' : groups.map(marketAgentFor).find(Boolean) ? `Our shopping agent at ${groups.map(marketAgentFor).find(Boolean).marketName || 'the seller’s market'} checks it` : 'Our shopping agent near the shop checks it'}: the right item, size, colour and quality. If it fails, you can cancel for a full refund.`}</small>
                  </div>
                </div>
                {canInspect && (
                  <div className="mk-inspect-choice" role="radiogroup" aria-labelledby="mk-inspect-q">
                    <button type="button" role="radio" aria-checked={inspectChoice === 'inspect'} className={`mk-inspect-btn yes ${inspectChoice === 'inspect' ? 'on' : ''}`} onClick={() => setInspectChoice('inspect')}>
                      <b>🔍 Inspect my goods</b>
                      <small>+{priceText(inspectFeeTotal)} added to your order{groups.length > 1 ? ` (${priceText(inspectFeeTotal / groups.length)} per seller)` : ''}</small>
                    </button>
                    <button type="button" role="radio" aria-checked={inspectChoice === 'none'} className={`mk-inspect-btn no ${inspectChoice === 'none' ? 'on' : ''}`} onClick={() => setInspectChoice('none')}>
                      <b>Don’t inspect</b>
                      <small>No inspection fee: KSh 0</small>
                    </button>
                  </div>
                )}
                {canInspect && !inspectChoice && <p className="mk-hint">Choose one to continue.</p>}
                {canInspect && inspectChoice === 'none' && <p className="mk-hint mk-inspect-none">✓ No inspection. You pay only for your items{deliveryTotal ? ' and delivery' : ''}: no KSh 200 fee. You can change your mind before paying.</p>}
                {agentInspect && agent && <ChosenAgentCard agent={{ ...agent, phone: agent.phone || (extras?.bookedAgent?._id === agent._id ? extras.bookedAgent.phone : '') }} back="/checkout" note={`${agent.name.split(' ')[0]} inspects it first; the seller sees this number on the order too. If they can’t within 10 minutes, the nearest agent does.`} />}
                {/* no agent booked: each seller's market agent is filled in automatically (changeable) */}
                {agentInspect && !agent && groups.map((group) => {
                  const marketAgent = marketAgentFor(group);
                  if (!marketAgent) return <p key={group.sellerId} className="mk-hint">🧑‍💼 {group.sellerName || 'This seller'} isn’t in one of our agents’ markets yet: the nearest available shopping agent will inspect it.</p>;
                  return (
                    <ChosenAgentCard key={group.sellerId} agent={{ _id: marketAgent._id, name: marketAgent.name, phone: marketAgent.phone || '', rating: marketAgent.rating, market: { name: marketAgent.marketName || 'their market', slug: marketAgent.marketSlug } }} back="/checkout" auto
                      note={`Linked automatically: ${marketAgent.name.split(' ')[0]} works at ${marketAgent.marketName || 'the market'} where ${group.sellerName || 'the seller'} sells. ${group.sellerName || 'The seller'} sees this number on the order, so they can reach each other.${groups.length > 1 ? ` For ${group.sellerName || 'this seller'}.` : ''}`} />
                  );
                })}
                {inspect && canInspect && method === 'rider' && agent && <p className="mk-hint">Our rider does the inspection with this delivery. Your agent {agent.name.split(' ')[0]} is used when an agent inspects it (pickup, the seller’s delivery or courier).</p>}
                {inspect && canInspect && (
                  <label className="os-field">
                    <span>What should the agent check? <em>(optional)</em></span>
                    <input value={inspectNotes} onChange={(event) => setInspectNotes(event.target.value)} maxLength={300} placeholder="e.g. size 42, black, no scratches, original box" />
                  </label>
                )}
              </div>
            )}
          </section>

          <section className="mk-box" ref={paySection} onFocus={fieldUp}>
            <h2><span className="mk-step">2</span> Payment</h2>
            <div className="mk-choice" onChange={() => setTimeout(() => bringUp(paySection), 80)}>
              <label className={pay === 'mpesa' ? 'on' : ''}>
                <input type="radio" name="pay" checked={pay === 'mpesa'} onChange={() => setPay('mpesa')} />
                <span><span className="mk-mpesa">M-PESA</span> <b>Pay now with M-Pesa</b><small>{manySellers ? `One M-Pesa payment to ${STORE_INFO.name} for all ${groups.length} sellers: goods + delivery. Held safely until delivery.` : `Paid straight to the seller’s Till, Paybill or Pochi la Biashara.`}</small></span>
              </label>
              <label className={pay === 'cod' ? 'on' : ''} aria-disabled={paidInspect || method === 'courier' || method === 'verified'}>
                <input type="radio" name="pay" checked={pay === 'cod'} disabled={paidInspect || method === 'courier' || method === 'verified'} onChange={() => setPay('cod')} />
                <span>💵 <b>Pay on delivery</b><small>{method === 'verified' ? 'Not with Safe deal: we hold your money until the item is verified' : method === 'courier' ? 'Not with courier: our agent pays the courier, so it’s paid upfront' : paidInspect ? 'Not with inspection: pay with M-Pesa so our agent can be paid' : method === 'rider' ? 'Items to the seller, delivery fee in cash to the rider' : 'Cash or M-Pesa to the seller when you get it'}</small></span>
              </label>
              <label className={`${pay === 'pole' ? 'on' : ''} mk-choice-pole`} aria-disabled={!poleItem}>
                <input type="radio" name="pay" checked={pay === 'pole'} disabled={!poleItem || method === 'walk' || method === 'rider' || method === 'courier' || method === 'verified' || inspect} onChange={() => setPay('pole')} />
                <span>🐢 <b>Lipa Pole Pole</b><small>{poleItem ? `Pay ${priceText(poleMin)} deposit now, the rest over up to ${poleItem.item.layaway.maxWeeks} weeks` : poleWhyNot}</small></span>
              </label>
            </div>
            {pay === 'pole' && poleItem && (
              <div className="mk-pole-checkout">
                <label className="os-field">
                  <span>Deposit today: {priceText(poleDepositNow)} <em>(min {poleItem.item.layaway.minDepositPercent}%)</em></span>
                  <input type="range" min={poleMin} max={Math.max(poleMin, poleTotal - 100)} step={50} value={poleDepositNow} onChange={(event) => setPoleDeposit(Number(event.target.value))} />
                </label>
                <div className="mk-chips">
                  {Array.from({ length: poleItem.item.layaway.maxWeeks || 4 }, (_, index) => index + 1).map((item) => (
                    <button type="button" key={item} className={poleWeeksNow === item ? 'on' : ''} onClick={() => setPoleWeeks(item)}>{item} week{item > 1 ? 's' : ''}</button>
                  ))}
                </div>
                <div className="mk-pp-summary">
                  <div><small>Total</small><b>{priceText(poleTotal)}</b></div>
                  <div><small>Today</small><b>{priceText(poleDepositNow)}</b></div>
                  <div><small>Then about</small><b>{priceText(Math.ceil((poleTotal - poleDepositNow) / poleWeeksNow))}/week</b></div>
                </div>
                <small className="os-muted">The item is reserved for you once the deposit is paid, and delivered when it’s fully paid. <Link to="/lipa-pole-pole">How Lipa Pole Pole works</Link></small>
              </div>
            )}
            <label className="os-field mk-mt">
              <span>{pay === 'cod' ? 'Your phone number (for the seller) *' : 'M-Pesa phone number *'}</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} required inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" />
            </label>
          </section>
        </div>

        <aside className="mk-checkout-side">
          <div className="mk-box mk-co-summary" ref={summaryRef} id="order-summary">
            <h2>🧾 Order summary</h2>
            {groups.length > 1 && (
              <p className="mk-multi-note">🧾 Your cart has items from <b>{groups.length} sellers</b>: each seller is a separate order{pay === 'cod' ? ', paid to that seller' : ''}. Remove anything you don’t want before you pay.</p>
            )}
            {groups.map((group) => (
              <div key={group.sellerId} className="mk-sum-group">
                <div className="mk-sum-seller">
                  <small className="os-muted">Sold by <b>{group.sellerName}</b></small>
                  {groups.length > 1 && <button type="button" className="os-linkbtn mk-sum-remove-seller" onClick={() => group.lines.forEach((line) => removeFromCart(line.id))}>Remove this seller’s items</button>}
                </div>
                {group.lines.map(({ id, qty, item }) => (
                  <div key={id} className="mk-sum-line">
                    <span className="mk-sum-img"><AdImage ad={item} /></span>
                    <span className="mk-sum-title">{qty} × {item.title}</span>
                    <b>{priceText(unitFor(item, qty) * qty)}</b>
                    {groups.length > 1 && <button type="button" className="mk-sum-x" onClick={() => removeFromCart(id)} aria-label={`Remove ${item.title}`} title="Remove">✕</button>}
                  </div>
                ))}
                {method === 'delivery' && <div className="mk-sum-line fee"><span>Delivery{group.deliveryFee > 0 ? ' · paid on delivery' : ''}</span><b>{group.deliveryFee ? priceText(group.deliveryFee) : 'Free'}</b></div>}
                {method === 'courier' && courierLine(group) && <div className="mk-sum-line fee"><span>🚌 {courierLine(group).name} + our agent ({Math.round(courierLine(group).km)} km)</span><b>{priceText(courierLine(group).total)}</b></div>}
                {method === 'rider' && riderFor(group)?.ok && <div className="mk-sum-line fee"><span>🏍️ Rider ({riderFor(group).km} km){riderFor(group).fee > 0 ? ' · paid on delivery' : ''}</span><b>{riderFor(group).fee ? priceText(riderFor(group).fee) : 'Free'}</b></div>}
                {method === 'verified' && safeFor(group)?.ok && <div className="mk-sum-line fee"><span>🛡️ Verification at {safeFor(group).partner.name}</span><b>{priceText(safeFor(group).fee)}</b></div>}
                {method === 'verified' && safeFor(group)?.ok && <div className="mk-sum-line fee"><span>🏍️ Rider from the partner shop ({safeFor(group).km} km) · paid on delivery</span><b>{priceText(safeFor(group).riderFee)}</b></div>}
                {paidInspect && <div className="mk-sum-line fee"><span>🔍 Inspection by {riderCheck ? 'our rider' : agent?.name || marketAgentFor(group)?.name || 'our agent'}{!riderCheck && (agent?.market?.name || marketAgentFor(group)?.marketName) ? <small className="mk-sum-agent"> · {agent?.market?.name || marketAgentFor(group)?.marketName}</small> : null}</span><b>{priceText(inspectFor(group).fee)}</b></div>}
                {extras && (
                  <PayeeCard group={group} payTo={extras.sellers?.[group.sellerId]?.payTo} pay={pay} method={method} manySellers={manySellers}
                    direct={pay === 'mpesa' && !manySellers && !['courier', 'verified'].includes(method) && !riderCheck && !!extras.sellers?.[group.sellerId]?.payTo?.method} /* the same rule as the server (market/splitPay.js splittable) */
                    riderFee={method === 'rider' && riderFor(group)?.ok ? riderFor(group).fee || 0 : 0}
                    inspectFee={paidInspect ? inspectFor(group)?.fee || 0 : 0} inspectBy={riderCheck ? 'rider' : 'agent'}
                    sellerDelivery={method === 'delivery' ? group.deliveryFee || 0 : 0} />
                )}
                {method === 'walk' && walkFor(group)?.ok && <div className="mk-sum-line fee"><span>🚶 Walking delivery ({walkFor(group).km} km){walkFor(group).fee > 0 ? ' · paid on delivery' : ''}</span><b>{walkFor(group).fee ? priceText(walkFor(group).fee) : walkFor(group).free === 'after-sale' ? 'Free (after-sale)' : 'Free'}</b></div>}
              </div>
            ))}
            {splitFee > 0 && <div className="mk-sum-line fee mk-sum-splitfee"><span>🛡️ Payment verification &amp; inspection by our agent <small>paid to {STORE_INFO.name}; the goods are paid straight to the seller</small></span><b>{priceText(splitFee)}</b></div>}
            <div className="mk-sum-total"><span>Total</span><b>{priceText(total)}</b></div>
            {onDelivery > 0 && pay === 'mpesa' && (
              <div className="mk-sum-split">
                <div><span>📱 Pay now with M-Pesa <small>{verifyTotal ? 'item + verification, held by us' : inspectTotal ? 'goods + inspection' : 'the goods only'}</small></span><b>{priceText(payNow)}</b></div>
                <div><span>💵 Pay on delivery <small>delivery fee, cash or M-Pesa to the rider</small></span><b>{priceText(onDelivery)}</b></div>
              </div>
            )}
            {paidInspect && onDelivery === 0 && pay === 'mpesa' && <p className="mk-hint mk-center">✔ Checked by our agent before it leaves the shop. Nothing to pay on delivery.</p>}
            {riderCheck && <p className="mk-hint mk-center">✔ Your rider checks it at the shop for free. Happy with the service? You can tip them after delivery.</p>}
            {pay === 'mpesa' && STORE_INFO.demoPayments && <p className="mk-hint mk-center">🧪 Demo payments are on: M-Pesa orders are marked paid without money.</p>}
            {pay !== 'cod' && <PayNumber phone={phone} setPhone={setPhone} label="Pay with M-Pesa number" />}
            <button className="os-btn os-btn-brand os-btn-lg os-block mk-co-paybtn" disabled={busy || outIds.length > 0 || lowIds.length > 0 || (pay !== 'cod' && !validPhone(phone))}>
              {busy ? 'Placing order…' : pay === 'pole' ? `Pay deposit ${priceText(poleDepositNow)} with M-Pesa` : pay === 'mpesa' ? `Pay ${priceText(payNow)} with M-Pesa` : `Place order (${priceText(total)})`}
            </button>
            <p className="mk-hint mk-center">{groups.length > 1 ? `Your cart becomes ${groups.length} orders, one per seller.` : 'You can cancel until the seller confirms.'}</p>
            <Link to="/market/search?buyNow=1" className="os-btn os-btn-ghost mk-continue-shop wide">🛍️ Continue shopping</Link>
          </div>
        </aside>
      </form>
    </div>
  );
}

// 🧾 the order at a glance (phones, top of checkout): items, quantities, prices and the total; long carts fold up
function OrderGlance({ groups, total, onMore }) {
  const [all, setAll] = useState(false);
  const lines = groups.flatMap((group) => group.lines.map((line) => ({ ...line, sellerName: group.sellerName })));
  const units = lines.reduce((sum, line) => sum + line.qty, 0);
  const shown = all ? lines : lines.slice(0, 3);
  return (
    <section className="mk-box mk-co-glance" aria-label="Your order">
      <div className="mk-co-glance-head">
        <b>🧾 Your order</b>
        <span>{units} item{units === 1 ? '' : 's'}{groups.length > 1 ? ` · ${groups.length} sellers` : ''}</span>
      </div>
      <ul>
        {shown.map(({ id, qty, item, sellerName }) => (
          <li key={id}>
            <span className="mk-sum-img"><AdImage ad={item} /></span>
            <span className="mk-co-glance-title">{qty} × {item.title}<small>{sellerName}</small></span>
            <b>{priceText(unitFor(item, qty) * qty)}</b>
          </li>
        ))}
      </ul>
      {lines.length > 3 && <button type="button" className="os-linkbtn" onClick={() => setAll(!all)}>{all ? 'Show less' : `+ ${lines.length - 3} more item${lines.length - 3 === 1 ? '' : 's'}`}</button>}
      <div className="mk-co-glance-total"><span>Total</span><b>{priceText(total)}</b></div>
      <button type="button" className="os-btn os-btn-brand os-block mk-co-glance-more" onClick={onMore}>🧾 Full summary &amp; pay <span aria-hidden="true">↓</span></button>
    </section>
  );
}

// ---------------------------------------------------------------- "How <seller> is paid": who gets what, how and when
const PAY_METHOD = { till: 'M-Pesa Till (Buy Goods)', paybill: 'M-Pesa Paybill', pochi: 'Pochi la Biashara', phone: 'M-Pesa Send Money' };
const localPhone = (phone) => String(phone || '').replace(/\D/g, '').replace(/^254/, '0').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
function PayeeCard({ group, payTo, pay, method, manySellers, direct, riderFee, inspectFee, inspectBy = 'agent', sellerDelivery }) {
  const seller = payTo?.seller || group.sellerName || 'the seller';
  const payee = payTo?.name || seller;
  const goods = group.subtotal + (sellerDelivery || 0);
  const held = pay === 'pole' || (pay === 'mpesa' && !direct);
  const when = pay === 'cod' ? 'On delivery' : pay === 'pole' ? 'Bit by bit (Lipa Pole Pole)' : direct ? 'Now, with M-Pesa' : 'Now, with M-Pesa (held by us)';
  const how = pay === 'cod'
    ? (payTo?.method ? `${PAY_METHOD[payTo.method]} or cash` : 'Cash or M-Pesa (the seller shares their number)')
    : held ? `${STORE_INFO.name} holds it safely, then pays ${seller}${payTo?.method ? ` by ${PAY_METHOD[payTo.method]}` : ''} after delivery`
      : payTo?.method ? PAY_METHOD[payTo.method] : 'M-Pesa';
  return (
    <div className="mk-payee" aria-label={`How ${seller} is paid`}>
      <div className="mk-payee-head"><span aria-hidden="true">💳</span><b>How {seller} is paid</b></div>
      <dl className="mk-payee-rows">
        <div><dt>Pay to</dt><dd><b>{payee}</b>{payee !== seller && <small>{seller}</small>}</dd></div>
        <div><dt>Method</dt><dd>
          {payTo?.method && !held ? (
            <span className="mk-payee-method">
              <span className="mk-mpesa">M-PESA</span>
              <span>{PAY_METHOD[payTo.method]}</span>
              {payTo.method === 'till' && <b>Till {payTo.till}</b>}
              {payTo.method === 'paybill' && <b>Paybill {payTo.paybill} · Account {payTo.account}</b>}
              {(payTo.method === 'pochi' || payTo.method === 'phone') && <b>{localPhone(payTo.phone)}</b>}
            </span>
          ) : <span>{how}</span>}
          {pay === 'cod' && payTo?.method && <small>Or pay cash to whoever delivers it.</small>}
        </dd></div>
        <div><dt>When</dt><dd>{when}</dd></div>
        <div className="mk-payee-amount"><dt>To {seller}</dt><dd><b>{priceText(goods)}</b><small>{sellerDelivery ? 'items + their delivery fee' : 'for the items'}</small></dd></div>
        {riderFee > 0 && <div><dt>To our rider</dt><dd><b>{priceText(riderFee)}</b><small>delivery fee, paid on delivery</small></dd></div>}
        {inspectFee > 0 && <div><dt>Inspection</dt><dd><b>{priceText(inspectFee)}</b><small>by our {inspectBy}, paid now to {STORE_INFO.name} (we pay the {inspectBy})</small></dd></div>}
      </dl>
      {!manySellers && held && pay === 'mpesa' && <p className="mk-payee-note">🔒 Your money is released to {seller} only after you get your order.</p>}
    </div>
  );
}
