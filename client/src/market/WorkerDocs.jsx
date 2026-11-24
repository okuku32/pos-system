// 🆔 My documents (riders, shopping agents, partner shops): upload your ID, driving licence, insurance… with the
// expiry dates; see which are approved, what's missing and what expires soon. The files are private: only you and
// our team can open them. An expired driving licence or insurance stops new jobs until the renewed one is uploaded.
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, errMsg } from './marketApi';
import PrivateFile from '../components/PrivateFile';
import { KapuName } from '../components/BrandName';

const dateText = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const expiryText = (doc) => {
  if (!doc.expiresAt) return 'Doesn’t expire';
  if (doc.state === 'expired') return `Expired ${dateText(doc.expiresAt)}`;
  if (doc.days === 0) return `Expires today (${dateText(doc.expiresAt)})`;
  return `Expires ${dateText(doc.expiresAt)} · in ${doc.days} day${doc.days === 1 ? '' : 's'}`;
};
const STATUS = { pending: ['wait', '🕓 Being checked'], approved: ['ok', '✓ Approved'], rejected: ['bad', '✕ Not accepted'] };
const today = () => new Date().toISOString().slice(0, 10);

export default function WorkerDocs({ open: startOpen = false, onChange }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/work/docs').then((response) => setData(response.data)).catch((err) => toast.error(errMsg(err))), []);
  useEffect(() => {
    load();
  }, [load]);
  const changed = () => {
    load();
    onChange?.();
  };
  const summary = data?.summary;
  const attention = summary && (summary.blocked || summary.missing.length || summary.expired || summary.expiring || summary.rejected);
  const remove = async (doc) => {
    if (!window.confirm(`Remove your ${doc.label.toLowerCase()}?`)) return;
    try {
      await api.delete(`/work/docs/${doc._id}`);
      changed();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const label = (key) => data?.kinds.find((kind) => kind.key === key)?.label || key;
  return (
    <details className="mk-box mk-docs" id="docs" open={startOpen || !!attention}>
      <summary>
        <span>🆔 My documents</span>
        {summary && (
          <span className={`mk-pill ${summary.blocked || summary.expired ? 'bad' : summary.missing.length || summary.expiring || summary.rejected ? 'wait' : 'ok'}`}>
            {summary.blocked || summary.expired ? `${summary.expired} expired` : summary.missing.length ? `${summary.missing.length} missing` : summary.expiring ? `${summary.expiring} expiring soon` : summary.pending ? 'being checked' : 'all good'}
          </span>
        )}
      </summary>
      {!data && <div className="page-loading"><span className="page-spinner" /></div>}
      {data && (
        <>
          {summary.blocked && <p className="mk-docs-alert bad">⛔ {summary.blocked}</p>}
          {summary.missing.length > 0 && <p className="mk-docs-alert wait">Please upload: <b>{summary.missing.map(label).join(', ')}</b>.</p>}
          {!summary.blocked && summary.expiring > 0 && <p className="mk-docs-alert wait">⏰ {summary.expiring} document{summary.expiring === 1 ? '' : 's'} expire{summary.expiring === 1 ? 's' : ''} within 30 days. Renew and upload the new one in time.</p>}
          <p className="mk-hint">🔒 Only you and the <KapuName /> team can open these. Our moderators check each one and its expiry date.</p>
          <ul className="mk-docs-list">
            {data.docs.map((doc) => {
              const [tone, text] = STATUS[doc.status] || ['wait', doc.status];
              return (
                <li key={doc._id} className={`mk-doc ${doc.state}`}>
                  <PrivateFile client={api} path={doc.file} pdf={doc.pdf} alt={doc.label} height={84} />
                  <div>
                    <b>{doc.icon} {doc.label}</b>
                    {doc.number && <small>No. {doc.number}</small>}
                    <small className={`mk-doc-exp ${doc.state}`}>{doc.state === 'expired' ? '⛔ ' : doc.state === 'expiring' ? '⏰ ' : ''}{expiryText(doc)}</small>
                    <span className={`mk-pill ${tone}`}>{text}</span>
                    {doc.status === 'rejected' && doc.reviewNote && <small className="danger-text">“{doc.reviewNote}” Please upload it again.</small>}
                  </div>
                  {doc.status !== 'approved' && <button type="button" className="os-linkbtn" onClick={() => remove(doc)} aria-label={`Remove ${doc.label}`}>Remove</button>}
                </li>
              );
            })}
          </ul>
          <UploadDoc kinds={data.kinds} have={data.docs} missing={summary.missing} onDone={changed} />
        </>
      )}
    </details>
  );
}

function UploadDoc({ kinds, have, missing, onDone }) {
  const [kind, setKind] = useState(missing[0] || 'licence');
  const [form, setForm] = useState({ number: '', expiresAt: '', label: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (missing.length && !missing.includes(kind) && !have.some((doc) => doc.kind === kind && doc.state === 'expired')) setKind(missing[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.join(',')]);
  const meta = kinds.find((item) => item.key === kind) || {};
  const replacing = kind !== 'other' && have.some((doc) => doc.kind === kind);
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!file) return toast.error('Take a clear photo of the document, or choose a PDF');
    if (file.size > 8 * 1024 * 1024) return toast.error('The file is too large (max 8 MB)');
    const data = new FormData();
    data.append('kind', kind);
    Object.entries(form).forEach(([key, value]) => value && data.append(key, value));
    data.append('file', file);
    setBusy(true);
    try {
      await api.post('/work/docs', data);
      toast.success(replacing ? 'Uploaded. It replaces the old one once our team checks it.' : 'Uploaded. Our team will check it.');
      setFile(null);
      setForm({ number: '', expiresAt: '', label: '' });
      event.target.reset();
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-docs-upload" onSubmit={submit}>
      <h4>{replacing ? 'Upload a renewed document' : 'Upload a document'}</h4>
      <label>Document
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          {kinds.map((item) => <option key={item.key} value={item.key}>{item.icon} {item.label}{item.required ? ' (required)' : ''}</option>)}
        </select>
      </label>
      {kind === 'other' && <label>What is it?<input value={form.label} onChange={set('label')} required minLength={3} maxLength={60} placeholder="e.g. First-aid certificate" /></label>}
      <div className="mk-photoreq-row">
        <label>Number (optional)<input value={form.number} onChange={set('number')} maxLength={40} placeholder={kind === 'licence' ? 'Licence number' : kind === 'insurance' ? 'Policy / certificate number' : ''} /></label>
        {meta.expires !== false && <label>Expiry date{meta.expires === true ? '' : ' (if any)'}<input type="date" min={today()} value={form.expiresAt} onChange={set('expiresAt')} required={meta.expires === true} /></label>}
      </div>
      <label>Photo or PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>
      <small className="os-muted">A clear photo, all four corners showing, nothing covered. Max 8 MB.</small>
      <button className="os-btn os-btn-brand" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
    </form>
  );
}
