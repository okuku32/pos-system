import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { errMsg, staffGate } from '../api';
import { useAuth } from '../context/AuthContext';
import GoogleButton from '../components/GoogleButton';
import BrandName from '../components/BrandName';

// Staff sign-in, only at the private link /staff/<key>. A wrong key shows the public site, as if
// there were no such page.
export default function Login() {
  const { key } = useParams();
  const { user, login, setup, loginWithGoogle } = useAuth();
  const [gate, setGate] = useState('checking'); // checking · ok · no
  const [needsSetup, setNeedsSetup] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    // /staff/<key>: the key once (the server then keeps it in an httpOnly cookie) · /staff: the cookie
    api
      .get('/auth/gate', key ? { headers: { 'X-Staff-Gate': key } } : {})
      .then(() => {
        if (!live) return;
        staffGate.set(); // this device has the link (the key itself is in the cookie)
        setGate('ok');
        if (key) window.history.replaceState(null, '', '/staff'); // the key leaves the address bar and history
        return api.get('/auth/setup').then((response) => live && setNeedsSetup(response.data.needsSetup));
      })
      .catch(() => {
        staffGate.clear(); // a link that was replaced, or no link on this device
        if (live) setGate('no');
      });
    return () => {
      live = false;
    };
  }, [key]);

  if (gate === 'no') return <Navigate to="/" replace />;
  if (gate === 'checking') return <div className="page-loading"><span className="page-spinner" /></div>;
  if (user) return <Navigate to="/admin" replace />;

  const set = (entryKey) => (event) => setForm({ ...form, [entryKey]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (needsSetup) await setup(form);
      else await login(form.email, form.password);
    } catch (err) {
      toast.error(errMsg(err), { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };
  const onGoogle = async (credential) => {
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="center-screen staff-login">
      <form className="card login" onSubmit={submit}>
        <div className="staff-login-badge">🔒 Staff only</div>
        <h1><BrandName accent="#ff5a1f" /> Admin</h1>
        <p className="muted">{needsSetup ? 'Create the owner account: you own this marketplace and will add your admins and moderators' : 'Sign in with the staff account your owner or admin gave you'}</p>
        {needsSetup && (
          <label>
            Name
            <input value={form.name} onChange={set('name')} required autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required autoFocus autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete={needsSetup ? 'new-password' : 'current-password'} />
        </label>
        <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : needsSetup ? 'Create owner account' : 'Sign in'}</button>
        {!needsSetup && (
          <div className="staff-google">
            <GoogleButton onCredential={onGoogle} text="signin_with" width={316} />
          </div>
        )}
        <p className="muted staff-login-note">This page is private. Don’t share its link. After 5 wrong passwords the account is locked for 15 minutes.</p>
      </form>
    </div>
  );
}
