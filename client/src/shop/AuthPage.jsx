import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useShop } from './ShopContext';
import { errMsg, firstName } from './shopApi';
import Logo from './Logo';
import GoogleButton, { googleEnabled } from '../components/GoogleButton';
import './shop.css';

// mode: 'login' | 'signup'
export default function AuthPage({ mode }) {
  const { customer, ready, login, signup, loginWithGoogle } = useShop();
  const [hasGoogle, setHasGoogle] = useState(false);
  useEffect(() => {
    googleEnabled().then(setHasGoogle);
  }, []);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const isSignup = mode === 'signup';
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', login: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = isSignup ? 'Create your Ordersasa account' : 'Log in · Ordersasa';
  }, [isSignup]);

  const done = () => navigate(next === 'checkout' ? '/shop?checkout=1' : '/shop', { replace: true });

  if (ready && customer && !busy) return <Navigate to={next === 'checkout' ? '/shop?checkout=1' : '/shop'} replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        await signup({ name: form.name, email: form.email, phone: form.phone, password: form.password });
        toast.success(`Karibu, ${firstName(form.name)}! Your account is ready 🎉`);
      } else {
        await login(form.login, form.password);
        toast.success('Welcome back! 👋');
      }
      done();
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };

  const onGoogle = async (credential) => {
    setBusy(true);
    try {
      const data = await loginWithGoogle(credential);
      toast.success(data.created ? `Karibu, ${firstName(data.customer.name)}! Your account is ready 🎉` : `Welcome back, ${firstName(data.customer.name)}! 👋`);
      done();
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };

  const strength = form.password.length >= 10 ? 3 : form.password.length >= 8 ? 2 : form.password.length >= 6 ? 1 : 0;

  return (
    <div className="os os-auth">
      <aside className="os-auth-side">
        <Link to="/shop"><Logo light size={38} /></Link>
        <div className="os-auth-pitch">
          <h2>{isSignup ? 'Karibu! Let’s get you shopping.' : 'Good to see you again.'}</h2>
          <p>{isSignup ? 'Create a free account to order in a few taps, save your delivery address, and follow every order live, from our shelves to your door.' : 'Log in to finish your order, check on deliveries, and reorder your favourites.'}</p>
          <ul>
            <li><span>📍</span> Live order tracking</li>
            <li><span>🛵</span> Delivery or quick pickup</li>
            <li><span>💳</span> Pay with M-Pesa or cash</li>
          </ul>
        </div>
        <small>© {new Date().getFullYear()} Ordersasa</small>
      </aside>

      <main className="os-auth-main">
        <form className="os-auth-card os-fade-up" onSubmit={submit}>
          <Link to="/shop" className="os-auth-mobile-logo"><Logo /></Link>
          <h1>{isSignup ? 'Create your account' : 'Log in'}</h1>
          <p className="os-muted">
            {isSignup ? 'Already have an account? ' : 'New to Ordersasa? '}
            <Link to={`${isSignup ? '/shop/login' : '/shop/signup'}${next ? `?next=${next}` : ''}`}>{isSignup ? 'Log in' : 'Create a free account'}</Link>
          </p>
          {next === 'checkout' && <div className="os-note">🛒 Your cart is saved. {isSignup ? 'Sign up' : 'Log in'} to place your order.</div>}

          {hasGoogle && (
            <>
              <GoogleButton onCredential={onGoogle} text={isSignup ? 'signup_with' : 'continue_with'} width={360} />
              <div className="os-or"><span>or {isSignup ? 'sign up' : 'log in'} with email</span></div>
            </>
          )}

          {isSignup ? (
            <>
              <label className="os-field"><span>Full name</span><input value={form.name} onChange={set('name')} required minLength={2} maxLength={60} autoComplete="name" autoFocus placeholder="e.g. Wanjiku Kamau" /></label>
              <label className="os-field"><span>Phone number</span><input value={form.phone} onChange={set('phone')} required inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" /></label>
              <label className="os-field"><span>Email</span><input type="email" value={form.email} onChange={set('email')} required autoComplete="email" placeholder="you@example.com" /></label>
            </>
          ) : (
            <label className="os-field"><span>Email or phone number</span><input value={form.login} onChange={set('login')} required autoComplete="username" autoFocus placeholder="you@example.com or 07XX XXX XXX" /></label>
          )}

          <label className="os-field">
            <span>Password</span>
            <div className="os-pass">
              <input type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} required minLength={6} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? 'At least 6 characters' : 'Your password'} />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          {isSignup && form.password && (
            <div className={`os-strength s${strength}`} aria-live="polite">
              <i /><i /><i />
              <span>{['Too short', 'Okay', 'Good', 'Strong'][strength]}</span>
            </div>
          )}

          <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy}>
            {busy ? <span className="os-spinner" /> : isSignup ? 'Create account' : 'Log in'}
          </button>
          <Link to="/shop" className="os-back">← Continue browsing without an account</Link>
        </form>
      </main>
    </div>
  );
}
