// A private file (a rider's licence, a buyer's request photo): fetched with the logged-in session (it has no public
// address), shown from memory and forgotten when the screen closes. `client` is the axios instance to use: the
// staff api for moderators, the shop api for customers.
import { useEffect, useState } from 'react';

export default function PrivateFile({ client, path, alt = 'Document', pdf = false, className = '', height = 120 }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made = '';
    setUrl('');
    setFailed(false);
    client.get(path, { responseType: 'blob' })
      .then((response) => {
        if (!live) return;
        made = URL.createObjectURL(response.data);
        setUrl(made);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [client, path]);
  const open = () => url && window.open(url, '_blank', 'noopener');
  if (failed) return <span className={`pf pf-failed ${className}`} style={{ height }}>⚠️ Can’t open</span>;
  if (!url) return <span className={`pf pf-loading ${className}`} style={{ height }} aria-busy="true">Loading…</span>;
  if (pdf) return <button type="button" className={`pf pf-pdf ${className}`} style={{ height }} onClick={open} title="Open the PDF">📄<small>Open PDF</small></button>;
  return (
    <button type="button" className={`pf ${className}`} style={{ height }} onClick={open} title="Open full size">
      <img src={url} alt={alt} />
    </button>
  );
}
