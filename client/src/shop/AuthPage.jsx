import { useEffect, useState } from 'react';
import PayMethodFields, { emptyPay, payMissing } from '../market/PayMethodFields';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useShop } from './ShopContext';
import { errMsg, firstName } from './shopApi';
import Logo from './Logo';
import { STORE_INFO } from './storeInfo';
import GoogleButton, { googleEnabled } from '../components/GoogleButton';
import PasswordRules, { passwordOk } from './PasswordRules';
import { useCategories } from '../market/marketApi';
import SellerTypesPicker from '../market/SellerTypesPicker';
import { AddressInput } from '../market/Maps';
import SellerTrade from '../market/SellerTrade';
import { TRADE_KINDS, emptyTrade, dropKind, tradeMissing, tradePayload } from '../market/tradeRules';
import './shop.css';
import { SiteName } from '../components/BrandName';

// mode: 'login' | 'signup'
// seller types at sign-up: [shop kind, icon, name, hint, the category they'll post in first]
const SELLER_TYPES = [
  ['shop', '🏪', 'Retailer / shop', 'Sells to customers', ''],
  ['market-stall', '🧺', 'Market stall', 'In a market', ''],
  ['mama-mboga', '🥬', 'Mama mboga', 'Vegetables & fruit', 'fresh-produce'],
  ['samaki', '🐟', 'Samaki dealer', 'Fish & omena', 'samaki'],
  ['grocery', '🌾', 'Cereals & groceries', 'Rice, flour, oil', 'cooking-products'],
  ['chemist', '💊', 'Chemist', 'Licensed pharmacy', 'pharmacy'],
  ['boutique', '👗', 'Boutique', 'Clothes & shoes', 'clothes-shoes'],
  ['electronics', '📱', 'Electronics', 'Phones, TVs', 'electronics'],
  ['spares', '🔧', 'Motor & spares', 'Cars & parts', 'spare-parts'],
  ['baby-shop', '🧸', 'Baby shop', 'Baby & kids', 'baby-kids'],
];

export default function AuthPage({ mode }) {
  const { customer, ready, login, signup, loginWithGoogle, setAccountType, resendVerification } = useShop();
  const [hasGoogle, setHasGoogle] = useState(false);
  useEffect(() => {
    googleEnabled().then(setHasGoogle);
  }, []);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const isSignup = mode === 'signup';
  // "I want to buy" or "I want to sell": where they land, and what the page talks about
  const [as, setAs] = useState(params.get('as') === 'seller' || (next || '').startsWith('/market/sell') || (next || '').startsWith('/sales') ? 'seller' : 'buyer');
  const seller = as === 'seller';
  // where to go after logging in: the checkout, back to the page they came from, or the right home for buyers / sellers
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  // a new seller (all their details saved at sign-up): straight to their seller hub. Email sign-ups confirm their
  // email first, so their first log-in (the welcome card is still waiting) goes there too.
  const firstLogin = () => { try { return !!JSON.parse(sessionStorage.getItem('kapu_welcome') || 'null')?.seller; } catch { return false; } };
  const landing = (isNew) => (next === 'checkout' ? '/checkout' : safeNext || (seller ? (isNew || firstLogin() ? '/seller' : '/sales') : '/'));
  const dest = landing(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '', login: params.get('email') || '' });
  // after sign-up (or a log-in with an unconfirmed email): "check your email", with a button to send the link again
  const [pending, setPending] = useState(null); // { email, message }
  const [resending, setResending] = useState(false);
  // new sellers (optional): what they sell, like the menu (mama mboga, mama samaki, importer, chemist…)
  const [types, setTypes] = useState([]);
  // new sellers (required): what they sell, and where
  const catData = useCategories();
  // categories, and the types inside each (picked in the pop-up that opens when a category is tapped)
  const [what, setWhat] = useState({ categories: [], items: [] });
  const cats = what.categories;
  const [where, setWhere] = useState({ county: '', area: '', lat: null, lng: null });
  // new sellers (required): how they get paid by M-Pesa
  const [pay, setPay] = useState(emptyPay());
  const [locating, setLocating] = useState(false);
  const pinShop = () => {
    if (!navigator.geolocation) return toast.error('This device can’t share its location');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setWhere((previous) => ({ ...previous, lat: position.coords.latitude, lng: position.coords.longitude })); setLocating(false); toast.success('Shop pinned: buyers near you will find you'); },
      () => { setLocating(false); toast.error('Couldn’t get your location. You can pin your shop later in My account.'); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
    return undefined;
  };
  // wholesalers and importers: what they deal in (and, importers, from which countries), asked in a pop-up when tapped
  const [trade, setTrade] = useState(emptyTrade);
  const [tradeOpen, setTradeOpen] = useState(null);
  // what a new seller must fill in (checked again by the server)
  const sellerMissing = !seller || !isSignup ? '' : !types.length ? 'Choose what kind of seller you are' : tradeMissing(types, trade) ? tradeMissing(types, trade) : !cats.length ? 'Choose what you sell' : !where.county ? 'Choose your county' : where.area.trim().length < 2 ? 'Enter your town or area' : payMissing(pay);
  const profile = () => ({ payDetails: { ...pay, phone: pay.phone || form.phone, name: pay.name.trim() || form.name.trim() }, sellerTypes: types, sellerCategories: cats, sellerItems: what.items, trade: tradePayload(types, trade), location: { county: where.county, area: where.area.trim(), ...(where.lat != null ? { lat: where.lat, lng: where.lng } : {}) } });
  const toggleType = (key) => {
    if (types.includes(key)) {
      setTypes(types.filter((item) => item !== key));
      setTrade((previous) => dropKind(previous, key));
      return;
    }
    const next = [...types, key].slice(-5);
    types.filter((item) => !next.includes(item)).forEach((item) => setTrade((previous) => dropKind(previous, item))); // pushed out by the limit
    setTypes(next);
    if (TRADE_KINDS.includes(key)) setTradeOpen(key);
  };
  const removeKind = (kind) => { setTypes((previous) => previous.filter((item) => item !== kind)); setTrade((previous) => dropKind(previous, kind)); };
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = isSignup ? `Create your ${STORE_INFO.name} account` : `Log in · ${STORE_INFO.name}`;
  }, [isSignup]);

  const done = (isNew) => {
    window.dispatchEvent(new Event('kapu:navigating')); // the top bar shows while the next page opens
    navigate(landing(isNew), { replace: true });
  };
  // a new account: a welcome on screen now, and a welcome card on the page they land on
  const welcome = (name, asSeller) => {
    toast.success(`Welcome to Kapu, ${firstName(name)}! 🎉`, { duration: 5000 });
    try {
      sessionStorage.setItem('kapu_welcome', JSON.stringify({ name: firstName(name), seller: !!asSeller }));
    } catch {
      /* private mode */
    }
  };

  if (ready && customer && !busy) return <Navigate to={dest} replace />;

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        if (sellerMissing) throw new Error(sellerMissing);
        if (form.password !== form.confirm) throw new Error('The passwords don’t match');
        if (!passwordOk(form.password, form)) throw new Error('Choose a stronger password: see the list under the password');
        const data = await signup({ name: form.name, email: form.email, phone: form.phone, password: form.password, confirmPassword: form.confirm, accountType: as, ...(seller ? profile() : {}) });
        welcome(form.name, seller); // shown after they confirm and log in
        setPending({ email: data.email || form.email, message: data.message });
        setBusy(false);
        return undefined;
      }
      const me = await login(form.login, form.password);
      const hub = landing(false) === '/seller';
      done(false); // straight to the next page: nothing else to wait for
      if (!hub) toast.success(seller ? 'Welcome back! Here are your orders to fulfil 🧾' : `Welcome back${me?.name ? `, ${firstName(me.name)}` : ''}! 👋`); // a first log-in gets the welcome card instead
      if (me && me.accountType !== as) setAccountType(as).catch(() => {}); // remembered in the background
    } catch (err) {
      // right password, email not confirmed yet: offer to send the link again
      if (err.response?.data?.code === 'EMAIL_NOT_VERIFIED') setPending({ email: err.response.data.email || form.login, message: err.response.data.message, unverified: true });
      else toast.error(errMsg(err));
      setBusy(false);
    }
  };
  const resend = async () => {
    setResending(true);
    try {
      toast.success((await resendVerification(pending.email)).message);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setResending(false);
    }
  };

  const onGoogle = async (credential) => {
    setBusy(true);
    try {
      if (isSignup && sellerMissing) throw new Error(sellerMissing);
      const data = await loginWithGoogle(credential, as, seller ? profile() : {});
      if (!data.created) await setAccountType(as).catch(() => {});
      if (data.created) welcome(data.customer.name, seller);
      else toast.success(`Welcome back, ${firstName(data.customer.name)}! 👋`);
      done(data.created);
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };


  return (
    <div className="os os-auth">
      <aside className="os-auth-side">
        <Link to="/"><Logo light size={38} /></Link>
        <div className="os-auth-pitch">
          {seller ? (
            <>
              <h2>{isSignup ? 'Sell to buyers across Kenya.' : 'Welcome back, seller.'}</h2>
              <p>Post ads free, chat with buyers, and sell online with M-Pesa or cash on delivery. You get an alert for every order.</p>
              <ul>
                <li><span>📢</span> Free ads in 2 minutes</li>
                <li><span>✔</span> Get verified, sell faster</li>
                <li><span>🔥</span> Boost to the top from KSh 99</li>
                <li><span>🐢</span> Offer Lipa Pole Pole to reach more buyers</li>
              </ul>
            </>
          ) : (
            <>
              <h2>{isSignup ? 'Karibu! Let’s find you a deal.' : 'Good to see you again.'}</h2>
              <p>Chat with sellers, make offers, and buy online with M-Pesa, cash on delivery or Lipa Pole Pole.</p>
              <ul>
                <li><span>🛡️</span> Lipa Salama: paid only after delivery</li>
                <li><span>💰</span> Make an offer and bargain</li>
                <li><span>📍</span> Live order tracking</li>
              </ul>
            </>
          )}
        </div>
        <small>© {new Date().getFullYear()} <SiteName light /></small>
      </aside>

      <main className="os-auth-main">
        <form className="os-auth-card os-fade-up" onSubmit={submit}>
          <Link to="/" className="os-auth-mobile-logo"><Logo /></Link>
          <div className="os-role" role="radiogroup" aria-label="What do you want to do?">
            <button type="button" role="radio" aria-checked={!seller} className={!seller ? 'on' : ''} onClick={() => setAs('buyer')}>
              <span>🛍️</span><b>I want to buy</b><small>Shop, chat, make offers</small>
            </button>
            <button type="button" role="radio" aria-checked={seller} className={seller ? 'on' : ''} onClick={() => setAs('seller')}>
              <span>🏪</span><b>I want to sell</b><small>Post ads, get orders</small>
            </button>
          </div>
          <h1>{isSignup ? (seller ? 'Create your seller account' : 'Create your account') : seller ? 'Seller log in' : 'Log in'}</h1>
          <p className="os-muted">
            {isSignup ? 'Already have an account? ' : <>New to <SiteName />? </>}
            <Link to={`${isSignup ? '/login' : '/signup'}?as=${as}${next ? `&next=${encodeURIComponent(next)}` : ''}`}>{isSignup ? 'Log in' : 'Create a free account'}</Link>
          </p>
          {next === 'checkout' && <div className="os-note">🛒 Your cart is saved. {isSignup ? 'Sign up' : 'Log in'} to place your order.</div>}

          {isSignup && seller && (
            <>
            <fieldset className="os-seller-types">
              <legend>What kind of seller are you? <em className="os-req">required</em></legend>
              <div>
                {SELLER_TYPES.map(([key, icon, name]) => (
                  <button type="button" key={key} className={types.includes(key) ? 'on' : ''} aria-pressed={types.includes(key)} onClick={() => toggleType(key)}><span>{icon}</span> {name}</button>
                ))}
              </div>
              <SellerTrade types={types} trade={trade} onTrade={setTrade} what={what} onWhat={setWhat} open={tradeOpen} setOpen={setTradeOpen} onRemoveKind={removeKind} categories={catData?.categories || []} countries={catData?.importCountries || []} />
              <small className="os-muted">Pick all that fit (up to 5). Buyers looking for wholesalers, importers, mama mbogas… find you first.</small>
            </fieldset>
            <fieldset className="os-seller-types os-seller-cats">
              <legend>What do you sell? <em className="os-req">required</em></legend>
              <SellerTypesPicker categories={catData?.categories || []} value={what} onChange={setWhat} />
              <small className="os-muted">Tap a category, then tick what you sell in it (up to 6 categories). You can change them later in My account.</small>
            </fieldset>
            <fieldset className="os-seller-where">
              <legend>Where do you sell? <em className="os-req">required</em></legend>
              <div className="os-seller-where-row">
                <label className="os-field"><span>County</span>
                  <select value={where.county} onChange={(event) => setWhere({ ...where, county: event.target.value })}>
                    <option value="">Choose…</option>
                    {(catData?.counties || []).map((county) => <option key={county}>{county}</option>)}
                  </select>
                </label>
                <label className="os-field"><span>Town / area</span><AddressInput value={where.area} onChange={(text) => setWhere((previous) => ({ ...previous, area: text }))} onPlace={(place) => setWhere((previous) => ({ ...previous, area: (place.area || place.name || place.text).slice(0, 60), county: place.county || previous.county, lat: place.lat, lng: place.lng }))} maxLength={60} placeholder="e.g. Gikomba, Kawangware" ariaLabel="Town or area" /></label>
              </div>
              <button type="button" className={`os-btn ${where.lat != null ? 'os-btn-ghost' : 'os-btn-dark'} os-pin-shop`} disabled={locating} onClick={pinShop}>{locating ? 'Getting your location…' : where.lat != null ? '✅ Shop pinned (tap to pin again)' : '📍 I’m at my shop: pin it on the map (optional)'}</button>
              <small className="os-muted">A pin puts you on “Sellers near me”, “Wholesalers near me” and the rest, with your contacts for buyers.</small>
            </fieldset>
            <fieldset className="os-seller-pay">
              <legend>How do you get paid? <em className="os-req">required</em></legend>
              <PayMethodFields value={pay} onChange={setPay} idPrefix="signup-pay" />
              <small className="os-muted">Buyers who pay on delivery see this on their order and pay you straight by M-Pesa. You can change it later in My account.</small>
            </fieldset>
            </>
          )}

          {hasGoogle && (
            <>
              <GoogleButton onCredential={onGoogle} text={isSignup ? 'signup_with' : 'continue_with'} width={360} />
              <div className="os-or"><span>or {isSignup ? 'sign up' : 'log in'} with email</span></div>
            </>
          )}

          {pending && (
            <div className="os-verify-pending" role="status">
              <div className="os-verify-icon">✉️</div>
              <h2>{pending.unverified ? 'Confirm your email first' : 'Check your email'}</h2>
              <p>{pending.message}</p>
              <p className="os-muted">The link works for 24 hours. Can’t find it? Look in your spam folder.</p>
              <button type="button" className="os-btn os-btn-ghost os-block" disabled={resending} onClick={resend}>{resending ? 'Sending…' : 'Send the link again'}</button>
              {!pending.unverified && <Link className="os-btn os-btn-brand os-block" to={`/login?as=${as}&email=${encodeURIComponent(pending.email)}`} onClick={() => setPending(null)}>I’ve confirmed it: log in</Link>}
            </div>
          )}

          {!pending && (isSignup ? (
            <>
              <label className="os-field"><span>{seller ? 'Your name or business name' : 'Full name'}</span><input value={form.name} onChange={set('name')} required minLength={2} maxLength={60} autoComplete="name" autoFocus placeholder={seller ? 'e.g. Wanjiku Kamau or Mama Mboga Supplies' : 'e.g. Wanjiku Kamau'} /></label>
              <label className="os-field"><span>{seller ? 'Phone number (buyers can call you)' : 'Phone number'}</span><input value={form.phone} onChange={set('phone')} required inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" /></label>
              <label className="os-field"><span>Email</span><input type="email" value={form.email} onChange={set('email')} required autoComplete="email" placeholder="you@example.com" /></label>
            </>
          ) : (
            <label className="os-field"><span>Email or phone number</span><input value={form.login} onChange={set('login')} required autoComplete="username" autoFocus placeholder="you@example.com or 07XX XXX XXX" /></label>
          ))}

          {!pending && <><label className="os-field">
            <span>Password</span>
            <div className="os-pass">
              <input type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} required minLength={isSignup ? 10 : 1} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? '10+ characters: A–Z, a–z and 0–9' : 'Your password'} />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          {!isSignup && (
            <Link
              to={`/forgot-password${form.login.includes('@') ? `?email=${encodeURIComponent(form.login.trim())}` : ''}`}
              className="os-forgot"
            >
              Forgot your password?
            </Link>
          )}
          {isSignup && <PasswordRules password={form.password} who={form} />}
          {isSignup && (
            <label className="os-field">
              <span>Confirm password</span>
              <input type={show ? 'text' : 'password'} value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" placeholder="Type the same password again" />
              {form.confirm && form.confirm !== form.password && <small className="os-mismatch">The passwords don’t match yet</small>}
            </label>
          )}

          <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy || (isSignup && (form.password !== form.confirm || !passwordOk(form.password, form)))}>
            {busy ? <span className="os-spinner" /> : isSignup ? (seller ? 'Create seller account' : 'Create account') : seller ? 'Log in to sell' : 'Log in'}
          </button>
          {sellerMissing && <p className="os-seller-missing" role="note">✋ {sellerMissing} (above)</p>}</>}
          <Link to="/" className="os-back">← Continue browsing without an account</Link>
        </form>
      </main>
    </div>
  );
}
