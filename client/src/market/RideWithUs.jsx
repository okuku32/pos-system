// 🛵 Ride with us: send a parcel anywhere in Nairobi, booked the way Uber and Bolt work.
//
//   1. Where from, where to: type an address (pick a suggestion, or just type it: we find it on the map when you
//      leave the field), use your location, or tap the map (A = pick-up, B = drop-off).
//   2. The route appears along the actual roads, and every vehicle (bike, 4-seater car, pickup) shows its upfront
//      price at standard ride-hailing rates, how far the nearest rider with it is, and how long the trip takes. In
//      heavy traffic or high demand the price goes up (surge, shown with the reason). Prices are seen before logging in.
//   2b. Booking locks the price they saw: if it went up meanwhile, the server says so and the new prices show here.
//   3. Pick a vehicle, add who hands it over and who receives it, and book. The nearest rider with that vehicle gets
//      the job; the booking page (/errands/:id) then tracks the rider live. The rider is paid on delivery (or at
//      pick-up), in cash or M-Pesa: nothing to pay in the app.
//
// The form is one centred column, the details first. The Book button always answers: if something is missing it says
// what, and brings that field to the middle of the screen with the cursor in it (nothing is ever silently disabled).
// The server works out every price (server/market/rideWithUs.js); this page never sends one.
// No inspection here: that's for orders from sellers on Kapu (Inspect my goods, at the checkout).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, priceText, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { AddressInput, GMap, geocodeText, getHere } from './Maps';
import { useRoadLine } from './roadLine';
import './market.css';

const NAIROBI_CBD = { lat: -1.2841, lng: 36.8233 }; // where the map starts before any pin is set
const DRAFT_KEY = 'kapu_ride_draft'; // the trip so far, kept while they log in (this browser only)
const COLLECT_MINUTES = 5; // the rider's time at the pick-up (the same allowance the server uses for ETAs)
const BLUR_LOOKUP_DELAY_MS = 400; // leaving an address field: wait, in case they were tapping one of its suggestions
const PARCEL_SIZES = [
  ['small', '✉️ Small', 'Fits in a bag'],
  ['medium', '📦 Medium', 'A box, up to ~10 kg'],
  ['large', '🛋️ Large', 'Big or heavy'],
];
// the fields the Book button can send them back to (their ids, so it can scroll to and focus them)
const FIELD = {
  pickup: 'ride-pickup', dropoff: 'ride-dropoff', item: 'ride-item', vehicle: 'ride-vehicle',
  senderPhone: 'ride-sender-phone', recipientPhone: 'ride-recipient-phone',
};
const isKenyanPhone = (phone) => /^(?:\+?254|0)?[17]\d{8}$/.test(String(phone || '').replace(/[\s-]/g, ''));
const localPhone = (phone) => (phone ? `0${String(phone).slice(-9)}` : '');

// the address of a spot on the map (a GPS fix, a tapped or dragged pin), or '' when it can't be found
async function addressOf(spot) {
  try {
    const { data } = await api.get('/geo/reverse', { params: { lat: spot.lat.toFixed(6), lng: spot.lng.toFixed(6) } });
    return data?.address || '';
  } catch {
    return '';
  }
}
function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
function saveDraft(draft) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode: the form still works */ }
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* nothing saved */ }
}
// bring a field to the middle of the screen and put the cursor in it (on a phone: right above the keyboard)
function showField(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // focus after the scroll has started, without a second jump
  setTimeout(() => field.focus?.({ preventScroll: true }), 250);
}

export default function RideWithUs() {
  const { customer } = useShop();
  const navigate = useNavigate();
  useSeo({
    title: 'Ride with us: parcel delivery in Nairobi',
    description: 'Send a parcel anywhere in Nairobi by bike, 4-seater car or pickup. See the price upfront, the nearest rider collects it, and you track it live.',
    path: '/ride-with-us',
  });

  const draft = useRef(readDraft()).current; // read once, on the first render
  const [pickup, setPickup] = useState(draft?.pickup || null); // { lat, lng }
  const [pickupAddress, setPickupAddress] = useState(draft?.pickupAddress || '');
  const [dropoff, setDropoff] = useState(draft?.dropoff || null);
  const [dropoffAddress, setDropoffAddress] = useState(draft?.dropoffAddress || '');
  const [movingPin, setMovingPin] = useState(draft?.dropoff ? 'dropoff' : 'pickup'); // the pin a tap on the map moves
  const [itemDescription, setItemDescription] = useState(draft?.itemDescription || '');
  const [parcelSize, setParcelSize] = useState(draft?.parcelSize || 'small');
  const [vehicle, setVehicle] = useState(draft?.vehicle || '');
  const [senderName, setSenderName] = useState(draft?.senderName || '');
  const [senderPhone, setSenderPhone] = useState(draft?.senderPhone || '');
  const [recipientName, setRecipientName] = useState(draft?.recipientName || '');
  const [recipientPhone, setRecipientPhone] = useState(draft?.recipientPhone || '');
  const [payer, setPayer] = useState(draft?.payer || 'recipient');
  const [notes, setNotes] = useState(draft?.notes || '');
  const [quote, setQuote] = useState(null); // the server's answer: { ok, km, options[], recommended } | { ok: false, reason }
  const [priceRefresh, setPriceRefresh] = useState(0); // +1 = ask for the prices again now (e.g. they went up)
  const [isPricing, setIsPricing] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isFinding, setIsFinding] = useState({ pickup: false, dropoff: false }); // looking up a typed address
  const [isBooking, setIsBooking] = useState(false);
  const [triedToBook, setTriedToBook] = useState(false); // after a first try, missing fields are outlined in red

  // the latest pins, for lookups that finish later (a late answer must never replace a pin set in the meantime)
  const pinsRef = useRef({ pickup, dropoff });
  pinsRef.current = { pickup, dropoff };
  // the address text each pin was placed with: typing more after it ("Yaya Centre" → "Yaya Centre, Gate B") keeps the
  // pin; typing something else means a different place, so the pin goes and is looked up again
  const pinnedTextRef = useRef({ pickup: draft?.pickupAddress || '', dropoff: draft?.dropoffAddress || '' });
  const typeAddress = (which, text) => {
    (which === 'pickup' ? setPickupAddress : setDropoffAddress)(text);
    const pinnedText = pinnedTextRef.current[which].trim().toLowerCase();
    if (!pinnedText || !text.trim().toLowerCase().startsWith(pinnedText)) (which === 'pickup' ? setPickup : setDropoff)(null);
  };

  // signed in: they're the sender unless they say otherwise
  useEffect(() => {
    if (!customer) return;
    setSenderName((current) => current || customer.name || '');
    setSenderPhone((current) => current || localPhone(customer.phone));
  }, [customer]);

  // keep the trip while they move around (e.g. to log in and come back)
  useEffect(() => {
    saveDraft({ pickup, pickupAddress, dropoff, dropoffAddress, itemDescription, parcelSize, vehicle, senderName, senderPhone, recipientName, recipientPhone, payer, notes });
  }, [pickup, pickupAddress, dropoff, dropoffAddress, itemDescription, parcelSize, vehicle, senderName, senderPhone, recipientName, recipientPhone, payer, notes]);

  // prices: asked again when a pin moves or the size changes (after a short pause, not on every drag frame)
  const tripKey = JSON.stringify([pickup && [pickup.lat.toFixed(5), pickup.lng.toFixed(5)], dropoff && [dropoff.lat.toFixed(5), dropoff.lng.toFixed(5)], parcelSize, priceRefresh]);
  useEffect(() => {
    if (!pickup || !dropoff) { setQuote(null); return undefined; }
    let isCurrent = true; // an older answer arriving late must not replace a newer one
    setIsPricing(true);
    const timer = setTimeout(() => {
      api.post('/errands/ride/quote', { pickup, dropoff, size: parcelSize })
        .then((response) => isCurrent && setQuote(response.data))
        .catch((error) => isCurrent && setQuote({ ok: false, reason: errMsg(error) }))
        .finally(() => isCurrent && setIsPricing(false));
    }, 350);
    return () => { isCurrent = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripKey]);

  // traffic and demand change: fresh prices every 2 minutes while they fill the form (like a ride-hailing app)
  useEffect(() => {
    if (!pickup || !dropoff) return undefined;
    const timer = setInterval(() => setPriceRefresh((count) => count + 1), 2 * 60 * 1000);
    return () => clearInterval(timer);
  }, [pickup, dropoff]);

  // the chosen vehicle stays chosen while it can carry the parcel; otherwise the server's suggestion
  const options = quote?.ok ? quote.options : [];
  useEffect(() => {
    if (!quote?.ok) return;
    const current = quote.options.find((option) => option.vehicle === vehicle);
    if (!current?.fits) setVehicle(quote.recommended || '');
  }, [quote, vehicle]);
  const chosenOption = options.find((option) => option.vehicle === vehicle) || null;

  // the route along the actual roads (a straight dashed line until it arrives, or if it can't be found)
  const roadLine = useRoadLine(pickup && dropoff ? [pickup, dropoff] : null, { mode: vehicle === 'motorbike' || !vehicle ? 'motorbike' : 'car' });
  const routeOnRoads = roadLine?.source === 'osm' ? roadLine.line : null;

  // set a pin (from a suggestion, the map, GPS or a typed address); its address is filled in when none was given
  const placePin = async (which, spot, knownAddress) => {
    const setSpot = which === 'pickup' ? setPickup : setDropoff;
    const setAddress = which === 'pickup' ? setPickupAddress : setDropoffAddress;
    setSpot({ lat: spot.lat, lng: spot.lng });
    if (knownAddress) { setAddress(knownAddress); pinnedTextRef.current[which] = knownAddress; return; }
    pinnedTextRef.current[which] = ''; // placed on the map: whatever they type next describes it
    const foundAddress = await addressOf(spot);
    if (foundAddress) { setAddress(foundAddress); pinnedTextRef.current[which] = foundAddress; }
  };
  // an address typed without choosing a suggestion: find it on the map. → true when it was placed
  const pinTypedAddress = async (which) => {
    const typedAddress = (which === 'pickup' ? pickupAddress : dropoffAddress).trim();
    if (pinsRef.current[which] || typedAddress.length < 3) return Boolean(pinsRef.current[which]);
    setIsFinding((current) => ({ ...current, [which]: true }));
    const found = await geocodeText(null, `${typedAddress}, Nairobi`);
    setIsFinding((current) => ({ ...current, [which]: false }));
    if (!found || pinsRef.current[which]) return Boolean(pinsRef.current[which]); // not found, or pinned meanwhile
    (which === 'pickup' ? setPickup : setDropoff)({ lat: found.lat, lng: found.lng });
    pinnedTextRef.current[which] = typedAddress;
    pinsRef.current = { ...pinsRef.current, [which]: { lat: found.lat, lng: found.lng } };
    return true;
  };
  const lookUpAfterBlur = (which) => setTimeout(() => pinTypedAddress(which), BLUR_LOOKUP_DELAY_MS);

  const useMyLocation = async () => {
    setIsLocating(true);
    try {
      const here = await getHere({ goodMeters: 40, maxMs: 10000 });
      await placePin('pickup', here);
      setMovingPin('dropoff'); // next tap on the map: where it goes
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLocating(false);
    }
  };

  const markers = [
    pickup && { id: 'pickup', lat: pickup.lat, lng: pickup.lng, label: 'A', title: 'Pick-up', draggable: movingPin === 'pickup' },
    dropoff && { id: 'dropoff', lat: dropoff.lat, lng: dropoff.lng, label: 'B', title: 'Drop-off', draggable: movingPin === 'dropoff' },
  ].filter(Boolean);
  // with no pin for the one being moved yet, a placeholder pin lets a tap on the map place it
  // (a little east of the other pin, so the two don't sit on top of each other)
  const movingSpot = movingPin === 'pickup' ? pickup : dropoff;
  const otherPin = pickup || dropoff;
  if (!movingSpot) markers.push({ id: movingPin, lat: (otherPin || NAIROBI_CBD).lat, lng: (otherPin || NAIROBI_CBD).lng + (otherPin ? 0.01 : 0), label: movingPin === 'pickup' ? 'A' : 'B', title: 'Tap the map to place it', draggable: true });

  const pickupMinutes = chosenOption?.pickupMinutes != null ? chosenOption.pickupMinutes + COLLECT_MINUTES : null;

  // everything a booking needs, in the order of the form: the first problem is the one we take them to
  const problems = () => [
    !pinsRef.current.pickup && { field: FIELD.pickup, message: pickupAddress.trim() ? 'We couldn’t find the pick-up address: choose one of the suggestions, or tap the map' : 'Where should the rider pick it up?' },
    !pinsRef.current.dropoff && { field: FIELD.dropoff, message: dropoffAddress.trim() ? 'We couldn’t find the drop-off address: choose one of the suggestions, or tap the map' : 'Where should it be delivered?' },
    pickupAddress.trim().length < 5 && { field: FIELD.pickup, message: 'Describe the pick-up address (estate, street, building or landmark)' },
    dropoffAddress.trim().length < 5 && { field: FIELD.dropoff, message: 'Describe the drop-off address (estate, street, building or landmark)' },
    itemDescription.trim().length < 3 && { field: FIELD.item, message: 'What are you sending? (e.g. documents, a bag of clothes, a TV)' },
    quote && !quote.ok && { field: FIELD.pickup, message: quote.reason },
    quote?.ok && !chosenOption?.fits && { field: FIELD.vehicle, message: 'Choose a vehicle that can carry it' },
    !isKenyanPhone(senderPhone) && { field: FIELD.senderPhone, message: 'Enter the phone number at the pick-up (07XX XXX XXX)' },
    !isKenyanPhone(recipientPhone) && { field: FIELD.recipientPhone, message: 'Enter the recipient’s phone number (07XX XXX XXX)' },
  ].filter(Boolean);
  const missingFields = triedToBook ? new Set(problems().map((problem) => problem.field)) : new Set();
  const fieldClass = (fieldId) => (missingFields.has(fieldId) ? 'mk-field-missing' : '');

  const book = async (event) => {
    event.preventDefault();
    if (isBooking) return;
    setTriedToBook(true);
    // addresses typed but never placed on the map: find them now
    if (!pinsRef.current.pickup) await pinTypedAddress('pickup');
    if (!pinsRef.current.dropoff) await pinTypedAddress('dropoff');
    const firstProblem = problems()[0];
    if (firstProblem) {
      toast.error(firstProblem.message);
      showField(firstProblem.field);
      return;
    }
    if (isPricing || !quote?.ok) { toast('Getting the price… tap Book again in a moment', { icon: '⏳' }); return; }
    if (!customer) { navigate(`/login?next=${encodeURIComponent('/ride-with-us')}`); return; } // the trip is kept
    setIsBooking(true);
    try {
      const { data } = await api.post('/errands', {
        kind: 'parcel', notes,
        pickup: { ...pinsRef.current.pickup, address: pickupAddress, name: senderName, phone: senderPhone },
        dropoff: { ...pinsRef.current.dropoff, address: dropoffAddress, name: recipientName, phone: recipientPhone },
        parcel: { what: itemDescription, size: parcelSize, vehicle, payer, expectedFare: chosenOption.fare }, // the price they agreed to
      });
      clearDraft();
      toast.success(`Booked! Finding the nearest ${chosenOption.label.toLowerCase()} rider 🛵`);
      navigate(`/errands/${data._id}`, { replace: true });
    } catch (error) {
      toast.error(errMsg(error), { duration: 6000 });
      setIsBooking(false);
      if (error.response?.data?.code === 'PRICE_CHANGED') {
        // the price went up (traffic or demand): show the new prices and bring the choice back into view
        setPriceRefresh((count) => count + 1);
        showField(FIELD.vehicle);
      }
    }
  };

  return (
    <div className="mk">
      <form className="mk-ride" onSubmit={book} noValidate>
        <header className="mk-ride-head">
          <h1>🛵 Ride with us</h1>
          <p>Parcels anywhere in Nairobi by bike, 4-seater car or pickup. Price upfront, rider tracked live.</p>
        </header>

        {/* 1. the trip: the two addresses first, the map under them */}
        <section className="mk-box mk-ride-trip" aria-label="Your trip">
          <div className={`mk-ride-stop ${fieldClass(FIELD.pickup)}`}>
            <button type="button" className={`mk-ride-dot a ${movingPin === 'pickup' ? 'on' : ''}`} onClick={() => setMovingPin('pickup')} aria-label="Move the pick-up pin on the map">A</button>
            <label className="os-field" htmlFor={FIELD.pickup}><span>Pick up from {isFinding.pickup && <small className="os-muted">· finding it…</small>}</span>
              <div onBlur={() => lookUpAfterBlur('pickup')}>
                <AddressInput id={FIELD.pickup} value={pickupAddress} onChange={(text) => typeAddress('pickup', text)} onPlace={(place) => { placePin('pickup', place, place.address || place.text); setMovingPin('dropoff'); }} placeholder="Estate, street, building or landmark" ariaLabel="Pick-up address" />
              </div>
            </label>
          </div>
          <button type="button" className="os-btn os-btn-ghost mk-ride-here" onClick={useMyLocation} disabled={isLocating}>{isLocating ? 'Finding you…' : '📍 Use my current location'}</button>
          <div className={`mk-ride-stop ${fieldClass(FIELD.dropoff)}`}>
            <button type="button" className={`mk-ride-dot b ${movingPin === 'dropoff' ? 'on' : ''}`} onClick={() => setMovingPin('dropoff')} aria-label="Move the drop-off pin on the map">B</button>
            <label className="os-field" htmlFor={FIELD.dropoff}><span>Deliver to {isFinding.dropoff && <small className="os-muted">· finding it…</small>}</span>
              <div onBlur={() => lookUpAfterBlur('dropoff')}>
                <AddressInput id={FIELD.dropoff} value={dropoffAddress} onChange={(text) => typeAddress('dropoff', text)} onPlace={(place) => placePin('dropoff', place, place.address || place.text)} placeholder="Where should it go?" ariaLabel="Drop-off address" />
              </div>
            </label>
          </div>
          <GMap
            center={movingSpot || pickup || dropoff || NAIROBI_CBD} zoom={13} markers={markers} className="mk-ride-map"
            onDrag={(lat, lng) => placePin(movingPin, { lat, lng })} onPick={(id) => setMovingPin(id)}
            route={routeOnRoads || (pickup && dropoff ? [pickup, dropoff] : null)} routeStraight={!routeOnRoads}
          />
          <p className="mk-hint">Tap the map to place pin <b>{movingPin === 'pickup' ? 'A (pick-up)' : 'B (drop-off)'}</b>. Tap A or B to switch.</p>
        </section>

        {/* 2. what it is */}
        <section className="mk-box">
          <h2>What are you sending?</h2>
          <label className={`os-field ${fieldClass(FIELD.item)}`} htmlFor={FIELD.item}><span>Item *</span>
            <input id={FIELD.item} value={itemDescription} onChange={(event) => setItemDescription(event.target.value)} maxLength={120} placeholder="e.g. documents, a bag of clothes, a 32” TV" />
          </label>
          <div className="mk-errand-chips mk-ride-sizes" role="radiogroup" aria-label="Parcel size">
            {PARCEL_SIZES.map(([sizeKey, sizeLabel, sizeDetail]) => (
              <button type="button" key={sizeKey} role="radio" aria-checked={parcelSize === sizeKey} className={parcelSize === sizeKey ? 'on' : ''} onClick={() => setParcelSize(sizeKey)}><b>{sizeLabel}</b><small>{sizeDetail}</small></button>
            ))}
          </div>
        </section>

        {/* 3. the vehicle, with its price */}
        <section className="mk-box" aria-live="polite">
          <h2>Choose your ride</h2>
          {!pickup || !dropoff ? <p className="os-muted">Enter the pick-up and drop-off to see prices.</p>
            : !quote ? <p className="os-muted">Finding prices and riders near you…</p>
            : !quote.ok ? <p className="mk-err-text">{quote.reason}</p>
            : (
              <>
                <p className="mk-hint">{quote.km} km on the road{isPricing ? ' · updating…' : ''}</p>
                <div id={FIELD.vehicle} tabIndex={-1} className={`mk-ride-options ${fieldClass(FIELD.vehicle)}`} role="radiogroup" aria-label="Vehicle">
                  {options.map((option) => (
                    <button
                      type="button" key={option.vehicle} role="radio" aria-checked={vehicle === option.vehicle} disabled={!option.fits}
                      className={`mk-ride-option ${vehicle === option.vehicle ? 'on' : ''}`} onClick={() => setVehicle(option.vehicle)}
                    >
                      <span className="mk-ride-icon" aria-hidden="true">{option.icon}</span>
                      <span className="mk-ride-what">
                        <b>{option.label}</b>
                        <small>{!option.fits ? option.reason : option.ridersNearby ? `Rider ${option.pickupMinutes} min away · ${option.tripMinutes} min trip` : `${option.tripMinutes} min trip · we’ll find you a rider`}</small>
                        <small className="mk-ride-note">{option.note}</small>
                        {option.surge?.multiplier > 1 && (
                          // why it costs more right now, like Uber's and Bolt's surge notice
                          <small className="mk-ride-surge">⚡ {option.surge.multiplier}× · {option.surge.reasons.join(', ') || 'busy right now'}</small>
                        )}
                      </span>
                      <b className="mk-ride-price">{priceText(option.fare)}</b>
                    </button>
                  ))}
                </div>
                {chosenOption && (
                  // how the price is made up, like a ride-hailing receipt
                  <p className="mk-hint mk-ride-breakdown">
                    Base {priceText(chosenOption.fareParts.base)} + distance {priceText(chosenOption.fareParts.distance)} + time {priceText(chosenOption.fareParts.time)}
                    {chosenOption.fareParts.surge > 1 ? ` · × ${chosenOption.fareParts.surge} (${chosenOption.surge.reasons.join(', ') || 'busy right now'}), normally ${priceText(chosenOption.fareParts.standard)}` : ''}
                    {chosenOption.fareParts.minimumApplies ? ` · minimum fare ${priceText(chosenOption.fareParts.minimum)}` : ''}
                    {pickupMinutes != null ? ` · collected in about ${pickupMinutes} min` : ''}
                  </p>
                )}
              </>
            )}
        </section>

        {/* 4. the people */}
        <section className="mk-box">
          <h2>Who hands it over, who receives it?</h2>
          <div className="mk-errand-two">
            <label className="os-field" htmlFor="ride-sender-name"><span>Pick-up contact name</span><input id="ride-sender-name" value={senderName} onChange={(event) => setSenderName(event.target.value)} maxLength={80} autoComplete="name" /></label>
            <label className={`os-field ${fieldClass(FIELD.senderPhone)}`} htmlFor={FIELD.senderPhone}><span>Pick-up phone *</span><input id={FIELD.senderPhone} value={senderPhone} onChange={(event) => setSenderPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" /></label>
          </div>
          <div className="mk-errand-two">
            <label className="os-field" htmlFor="ride-recipient-name"><span>Recipient’s name</span><input id="ride-recipient-name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={80} /></label>
            <label className={`os-field ${fieldClass(FIELD.recipientPhone)}`} htmlFor={FIELD.recipientPhone}><span>Recipient’s phone *</span><input id={FIELD.recipientPhone} value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} inputMode="tel" placeholder="07XX XXX XXX" /></label>
          </div>
          <div className="mk-errand-chips mk-ride-payer" role="radiogroup" aria-label="Who pays the rider">
            {[['recipient', '📍 The recipient', 'on delivery'], ['sender', '🏠 The sender', 'at pick-up']].map(([payerKey, payerLabel, payerWhen]) => (
              <button type="button" key={payerKey} role="radio" aria-checked={payer === payerKey} className={payer === payerKey ? 'on' : ''} onClick={() => setPayer(payerKey)}><b>{payerLabel} pays</b><small>{payerWhen}, cash or M-Pesa</small></button>
            ))}
          </div>
          <label className="os-field" htmlFor="ride-notes"><span>Note for the rider (optional)</span><textarea id="ride-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} placeholder="e.g. gate code, call on arrival, fragile" /></label>
        </section>

        {/* 5. book: always answers (says what's missing and takes them there) */}
        <div className="mk-ride-book">
          <button type="submit" className="os-btn os-btn-brand os-btn-lg os-block" disabled={isBooking}>
            {isBooking ? 'Booking…' : !customer ? 'Log in to book' : chosenOption ? `Book ${chosenOption.label} · ${priceText(chosenOption.fare)}` : 'Book a rider'}
          </button>
          <p className="mk-hint mk-center">Nothing to pay now: the rider is paid {payer === 'sender' ? 'at pick-up' : 'on delivery'}. Riders are ID-checked; you’ll see who’s coming and can call them. <Link to="/errands">My deliveries</Link></p>
        </div>
      </form>
    </div>
  );
}
