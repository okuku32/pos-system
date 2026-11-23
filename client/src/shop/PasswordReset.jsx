import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useShop } from './ShopContext';
import { errMsg, firstName } from './shopApi';
import { STORE_INFO } from './storeInfo';
import Logo from './Logo';
import PasswordRules, { passwordOk } from './PasswordRules';
import './shop.css';

// mode 'forgot': ask for the email and send the reset link
// mode 'reset':  opened from the emailed link (?token=...), choose a new password
export default function PasswordReset({ mode }) {
  const { requestPasswordReset, resetPassword } = useShop();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [email, setEmail] = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');

  useEffect(() => {
    document.title = `${mode === 'forgot' ? 'Forgot password' : 'Choose a new password'} · ${STORE_INFO.name}`;
  }, [mode]);

  const sendLink = async (link) => {
    link.preventDefault();
    setBusy(true);
    try {
      const data = await requestPasswordReset(email.trim());
      setSent(data.message);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (password !== confirm) return toast.error('The two passwords don’t match');
    setBusy(true);
    try {
      const data = await resetPassword(token, password);
      toast.success(`Password changed. Welcome back, ${firstName(data.customer.name)}! 👋`);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };


  return (
    <div className="os os-auth">
      <main className="os-auth-main">
        <div className="os-auth-card os-fade-up">
          <Link to="/" className="os-reset-logo"><Logo /></Link>

          {mode === 'forgot' ? (
            sent ? (
              <div className="os-reset-done">
                <div className="os-empty-art">📬</div>
                <h1>Check your email</h1>
                <p className="os-muted">{sent}</p>
                <p className="os-muted" style={{ fontSize: 14 }}>The link works once and expires in 30 minutes.</p>
                <button type="button" className="os-btn os-btn-ghost os-block" onClick={() => setSent('')}>Use a different email</button>
                <Link to="/login" className="os-back">← Back to log in</Link>
              </div>
            ) : (
              <form onSubmit={sendLink} className="os-reset-form">
                <h1>Forgot your password?</h1>
                <p className="os-muted">Enter the email you signed up with and we’ll send you a link to choose a new password.</p>
                <label className="os-field">
                  <span>Email</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus autoComplete="email" placeholder="you@example.com" />
                </label>
                <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy}>
                  {busy ? <span className="os-spinner" /> : 'Send reset link'}
                </button>
                <Link to="/login" className="os-back">← Back to log in</Link>
              </form>
            )
          ) : !/^[a-f0-9]{64}$/.test(token) ? (
            <div className="os-reset-done">
              <div className="os-empty-art">🔗</div>
              <h1>This link isn’t complete</h1>
              <p className="os-muted">Open the link from the email again, or request a new one.</p>
              <Link to="/forgot-password" className="os-btn os-btn-brand os-block">Request a new link</Link>
            </div>
          ) : (
            <form onSubmit={save} className="os-reset-form">
              <h1>Choose a new password</h1>
              <p className="os-muted">After this you’ll be logged in, and any other devices using your old password will be signed out.</p>
              <label className="os-field">
                <span>New password</span>
                <div className="os-pass">
                  <input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} autoFocus autoComplete="new-password" placeholder="10+ characters: A–Z, a–z and 0–9" />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
                </div>
              </label>
              {password && <PasswordRules password={password} />}
              <label className="os-field">
                <span>Type it again</span>
                <input type={show ? 'text' : 'password'} value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={6} autoComplete="new-password" />
              </label>
              {confirm && confirm !== password && <small className="os-mismatch">The passwords don’t match yet</small>}
              <button className="os-btn os-btn-brand os-btn-lg os-block" disabled={busy || password !== confirm || !passwordOk(password)}>
                {busy ? <span className="os-spinner" /> : 'Save new password'}
              </button>
              <Link to="/forgot-password" className="os-back">Link expired? Request a new one</Link>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
