import { useEffect, useState } from 'react';
import api, { errMsg } from '../api';
import { useAuth } from '../context/AuthContext';
import EtimsSettings from '../components/EtimsSettings';

const MODE_TEXT = {
  smtp: { label: 'Sending real emails', cls: 'success-text' },
  ethereal: { label: 'Test mode: emails go to an Ethereal test inbox, not to customers', cls: 'warn-text' },
  disabled: { label: 'Disabled: set SMTP_HOST in server/.env', cls: 'error-text' },
};

export default function Settings() {
  const { user } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(null);
  const [to, setTo] = useState(user?.email || '');
  const [mailResult, setMailResult] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get('/settings/email').then((r) => setEmail(r.data)).catch(() => {});
  }, []);

  const test = async () => {
    setBusy(true);
    try {
      const { data } = await api.get('/mpesa/test');
      setResult({ ok: true, message: data.message });
    } catch (err) {
      setResult({ ok: false, message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (e) => {
    e.preventDefault();
    setSending(true);
    setMailResult(null);
    try {
      const { data } = await api.post('/settings/email/test', { to });
      setMailResult({ ok: true, message: data.message, preview: data.preview });
    } catch (err) {
      setMailResult({ ok: false, message: errMsg(err) });
    } finally {
      setSending(false);
    }
  };

  const mode = email && (MODE_TEXT[email.mode] || MODE_TEXT.disabled);

  return (
    <div>
      <h2>Settings</h2>
      <div className="card" style={{ maxWidth: 680 }}>
        <h3>M-Pesa (Daraja) connection</h3>
        <p className="muted">
          Credentials are set in <code>server/.env</code> (MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
          MPESA_PASSKEY, MPESA_CALLBACK_URL). Restart the server after changing them.
        </p>
        <button className="btn mpesa" onClick={test} disabled={busy}>
          {busy ? 'Testing…' : 'Test Daraja credentials'}
        </button>
        {result && <p className={result.ok ? 'success-text' : 'error-text'}>{result.message}</p>}
      </div>

      <div className="card" style={{ maxWidth: 680 }}>
        <h3>Customer email notifications</h3>
        <p className="muted">
          Online customers get an email when they place an order, when their payment is received, when their order is
          dispatched for delivery (or ready for pickup), and if it is cancelled.
        </p>
        {email && (
          <>
            <div className="row-between"><span className="muted">Status</span><b className={mode.cls}>{mode.label}</b></div>
            {email.host && <div className="row-between"><span className="muted">SMTP server</span><span>{email.host}</span></div>}
            <div className="row-between"><span className="muted">Sent from</span><span>{email.from}</span></div>
            <div className="row-between"><span className="muted">Tracking links point to</span><span>{email.shopUrl}</span></div>
          </>
        )}
        <form className="toolbar" style={{ marginTop: 14 }} onSubmit={sendTest}>
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" required style={{ flex: 1 }} />
          <button className="btn" disabled={sending}>{sending ? 'Sending…' : 'Send test email'}</button>
        </form>
        {mailResult && (
          <p className={mailResult.ok ? 'success-text' : 'error-text'}>
            {mailResult.message}
            {mailResult.preview && (
              <> · <a href={mailResult.preview} target="_blank" rel="noreferrer">Open the test email ↗</a></>
            )}
          </p>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          To send real emails, fill in <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>,{' '}
          <code>SMTP_PASS</code> and <code>SHOP_URL</code> in <code>server/.env</code>.
        </p>
      </div>
      <EtimsSettings />
    </div>
  );
}
