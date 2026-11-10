import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import { useAuth } from '../context/AuthContext';
import GoogleButton from '../components/GoogleButton';

export default function Login() {
  const { user, login, setup, loginWithGoogle } = useAuth();
  const onGoogle = async (credential) => {
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const [needsSetup, setNeedsSetup] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/auth/setup').then((r) => setNeedsSetup(r.data.needsSetup)).catch(() => {});
  }, []);

  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (needsSetup) await setup(form);
      else await login(form.email, form.password);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card login" onSubmit={submit}>
        <h1>Order<span style={{ color: "#ff5a1f" }}>sasa</span> POS</h1>
        <p className="muted">{needsSetup ? 'Create the first admin account' : 'Sign in to continue'}</p>
        {needsSetup && (
          <label>
            Name
            <input value={form.name} onChange={set('name')} required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={6} />
        </label>
        <button className="btn block" disabled={busy}>
          {busy ? 'Please wait…' : needsSetup ? 'Create admin' : 'Sign in'}
        </button>
        {!needsSetup && (
          <div className="staff-google">
            <GoogleButton onCredential={onGoogle} text="signin_with" width={316} />
          </div>
        )}
      </form>
      <a className="muted" href="/shop" style={{ position: 'fixed', bottom: 20 }}>Shopping with Ordersasa? Go to the shop →</a>
    </div>
  );
}
