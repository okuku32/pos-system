import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { errMsg } from '../api';
import { useAuth } from '../context/AuthContext';
import BrandName from '../components/BrandName';

// Change my staff password. "forced": a new / reset account (or an old default password) must do this first.
export default function ChangePassword({ forced = false }) {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value });
  const strong = values.next.length >= 8 && /[A-Za-z]/.test(values.next) && /\d/.test(values.next);

  const submit = async (event) => {
    event.preventDefault();
    if (values.next !== values.again) return toast.error('The new passwords don’t match');
    setBusy(true);
    try {
      toast.success(await changePassword(values.current, values.next));
      setValues({ current: '', next: '', again: '' });
      if (!forced) navigate('/admin');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form className="card login" onSubmit={submit}>
      {forced && <div className="staff-login-badge">🔑 One more step</div>}
      <h1>{forced ? <><BrandName accent="#ff5a1f" /> Admin</> : 'Change password'}</h1>
      <p className="muted">
        {forced ? <>Hi {user?.name?.split(' ')[0]}, please choose your own password before you continue. Use the password you were given (or your old one) as the current password.</> : 'Your other devices will be signed out.'}
      </p>
      <label>
        Current password
        <input type="password" value={values.current} onChange={set('current')} required autoComplete="current-password" autoFocus />
      </label>
      <label>
        New password
        <input type="password" value={values.next} onChange={set('next')} required minLength={8} autoComplete="new-password" />
        <small className={strong ? 'ok-text' : 'muted'}>{strong ? '✓ Strong enough' : 'At least 8 characters, with letters and numbers'}</small>
      </label>
      <label>
        New password again
        <input type="password" value={values.again} onChange={set('again')} required minLength={8} autoComplete="new-password" />
      </label>
      <button className="btn block" disabled={busy || !strong}>{busy ? 'Saving…' : 'Save new password'}</button>
      {forced && <button type="button" className="btn ghost block" onClick={logout}>Log out</button>}
    </form>
  );
  return forced ? <div className="center-screen staff-login">{form}</div> : <div className="staff-password">{form}</div>;
}
