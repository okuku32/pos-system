// /verify-email?token=… : the link from the "Confirm your email" message. Confirms the email, then asks the person to
// log in (signing up never logs anyone in on its own). The token is removed from the address bar straight away.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import shopApi, { errMsg } from './shopApi';
import { STORE_INFO } from './storeInfo';
import { useSeo } from '../market/marketApi';

// where a new seller goes first (what they said they sell when they signed up)
const FIRST = { 'mama-mboga': 'fresh-produce', samaki: 'samaki', grocery: 'cooking-products', chemist: '', boutique: 'clothes-shoes', electronics: 'electronics', spares: 'spare-parts', 'baby-shop': 'baby-kids' };
const firstStepFor = (accountType, types = []) => {
  if (accountType !== 'seller') return '/';
  if (types[0] === 'chemist') return '/account#shop-location';
  return FIRST[types[0]] ? `/market/sell?category=${FIRST[types[0]]}` : '/market/sell';
};

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'checking' });
  const once = useRef(false);
  useSeo({ title: 'Confirm your email', noindex: true });
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = params.get('token') || '';
    window.history.replaceState(null, '', '/verify-email'); // the token doesn't stay in the address bar / history
    if (!/^[a-f0-9]{64}$/.test(token)) return setState({ status: 'bad', message: 'This link is incomplete. Open it again from the email, or ask for a new one.' });
    shopApi
      .post('/customers/verify-email', { token })
      .then(({ data }) => setState({ status: 'ok', ...data }))
      .catch((error) => setState({ status: 'bad', message: errMsg(error) }));
  }, [params]);

  const next = state.status === 'ok' ? firstStepFor(state.accountType, state.sellerTypes) : '/';
  const loginLink = `/login?as=${state.accountType === 'seller' ? 'seller' : 'buyer'}${state.email ? `&email=${encodeURIComponent(state.email)}` : ''}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`;
  return (
    <div className="os-reset">
      <div className="os-auth-card os-verify-card">
        {state.status === 'checking' && <><div className="os-verify-icon">⏳</div><h1>Confirming your email…</h1></>}
        {state.status === 'ok' && (
          <>
            <div className="os-verify-icon">✅</div>
            <h1>Your email is confirmed</h1>
            <p className="os-muted">Welcome to <SiteName />! Log in to start {state.accountType === 'seller' ? 'selling' : 'buying'}.</p>
            <Link to={loginLink} className="os-btn os-btn-brand os-btn-lg os-block">Log in</Link>
          </>
        )}
        {state.status === 'bad' && (
          <>
            <div className="os-verify-icon">⚠️</div>
            <h1>We couldn’t confirm this link</h1>
            <p className="os-muted">{state.message}</p>
            <Link to="/login" className="os-btn os-btn-brand os-block">Go to log in (we’ll send a new link)</Link>
          </>
        )}
      </div>
    </div>
  );
}
