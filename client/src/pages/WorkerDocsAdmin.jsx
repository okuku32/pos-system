// Moderators: a rider's (or agent's / partner shop's) documents. Open each file (every view is written to the audit
// log), check the expiry date against the document and correct it if needed, then approve or reject.
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import Modal from '../components/Modal';
import PrivateFile from '../components/PrivateFile';

const dateText = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const STATE = { expired: ['cancelled', 'Expired'], expiring: ['pending', 'Expiring soon'], valid: ['completed', 'Valid'], none: ['', 'No expiry'] };

// the little summary in the Field team table
export function DocsCell({ docs, onOpen }) {
  if (!docs) return null;
  const bits = [];
  if (docs.expired) bits.push(<span key="x" className="badge cancelled">⛔ {docs.expired} expired</span>);
  if (docs.expiring) bits.push(<span key="e" className="badge pending">⏰ {docs.expiring} expiring</span>);
  if (docs.missing?.length) bits.push(<span key="m" className="badge pending">{docs.missing.length} missing</span>);
  if (docs.pending) bits.push(<span key="p" className="badge">🕓 {docs.pending} to check</span>);
  return (
    <button type="button" className="btn ghost sm docs-cell" onClick={onOpen} title="Open their documents">
      🆔 {docs.total} doc{docs.total === 1 ? '' : 's'}
      <span className="docs-cell-badges">{bits.length ? bits : <span className="badge completed">✓ all good</span>}</span>
      {docs.nextExpiry && <small className="muted">next expiry {dateText(docs.nextExpiry)}</small>}
    </button>
  );
}

export default function WorkerDocsModal({ workerId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get(`/work/admin/workers/${workerId}/docs`).then((response) => setData(response.data)).catch((err) => toast.error(errMsg(err))), [workerId]);
  useEffect(() => {
    load();
  }, [load]);
  const label = (key) => data?.kinds.find((kind) => kind.key === key)?.label || key;
  const w = data?.worker;
  return (
    <Modal title={w ? `🆔 ${w.name}’s documents` : 'Documents'} onClose={onClose} width={760}>
      {!data && <p className="muted">Loading…</p>}
      {data && (
        <div className="docs-admin">
          <p className="muted" style={{ marginTop: 0 }}>
            {w.role === 'rider' ? `🏍️ Rider · ${w.vehicle || 'vehicle not set'}${w.plate ? ` · ${w.plate}` : ''}` : w.role === 'partner' ? '🛡️ Partner shop' : '🛍️ Shopping agent'} · ID {w.idNumber || '–'}{w.phone ? ` · ${w.phone}` : ''}
          </p>
          {data.summary.blocked && <p className="docs-alert bad">⛔ Can’t take new jobs: {data.summary.blocked.split('.')[0]}.</p>}
          {data.summary.missing.length > 0 && <p className="docs-alert">Missing: <b>{data.summary.missing.map(label).join(', ')}</b></p>}
          <p className="muted" style={{ fontSize: 12 }}>🔒 Opening a document is recorded in the audit log. Check the name matches, the photo is clear, and the expiry date matches what’s printed.</p>
          {!data.docs.length && <p className="muted">No documents uploaded yet.</p>}
          {data.docs.map((doc) => <DocRow key={doc._id} doc={doc} workerId={workerId} onDone={() => { load(); onChanged?.(); }} />)}
        </div>
      )}
    </Modal>
  );
}

function DocRow({ doc, workerId, onDone }) {
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt ? new Date(doc.expiresAt).toISOString().slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [badge, text] = STATE[doc.state] || STATE.none;
  const review = async (action) => {
    let note = '';
    if (action === 'reject') {
      note = window.prompt(`Why isn’t this ${doc.label.toLowerCase()} accepted? (the rider sees this)`, doc.state === 'expired' ? 'It has expired. Please upload the renewed one.' : 'The photo is not clear.');
      if (note === null) return;
    }
    setBusy(true);
    try {
      await api.post(`/work/admin/workers/${workerId}/docs/${doc._id}`, { action, note, ...(expiresAt ? { expiresAt } : {}) });
      toast.success(action === 'approve' ? 'Approved' : 'Rejected: they’ve been told');
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`docs-row ${doc.state}`}>
      <PrivateFile client={api} path={doc.file} pdf={doc.pdf} alt={doc.label} height={110} />
      <div className="docs-row-info">
        <b>{doc.icon} {doc.label}</b>
        {doc.number && <span className="muted">No. {doc.number}</span>}
        <span>{doc.expiresAt ? <>Expires <b>{dateText(doc.expiresAt)}</b> {doc.state !== 'none' && <span className={`badge ${badge}`}>{doc.state === 'expired' ? `${text} ${-doc.days} day${doc.days === -1 ? '' : 's'} ago` : doc.state === 'expiring' ? `${text}: ${doc.days} day${doc.days === 1 ? '' : 's'}` : text}</span>}</> : <span className="muted">No expiry date</span>}</span>
        <span className="muted" style={{ fontSize: 12 }}>Uploaded {dateText(doc.uploadedAt)}{doc.reviewedAt ? ` · ${doc.status} ${dateText(doc.reviewedAt)}` : ''}{doc.reviewNote ? ` · “${doc.reviewNote}”` : ''}</span>
        <span className={`badge ${doc.status === 'approved' ? 'completed' : doc.status === 'rejected' ? 'cancelled' : 'pending'}`}>{doc.status === 'pending' ? 'to check' : doc.status}</span>
      </div>
      <div className="docs-row-actions">
        <label className="muted" style={{ fontSize: 12 }}>Expiry on the document
          <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>
        <div>
          <button className="btn sm" disabled={busy} onClick={() => review('approve')}>✔ Approve</button>
          <button className="btn ghost sm" disabled={busy} onClick={() => review('reject')}>Reject</button>
        </div>
      </div>
    </div>
  );
}
