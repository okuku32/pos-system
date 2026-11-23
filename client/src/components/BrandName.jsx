import { STORE_INFO, isKapu } from '../shop/storeInfo';

// "Kapu" in the Kenyan flag's colours (see .kapu-name in index.css). `light` = on a dark background.
export function KapuName({ light = false }) {
  return (
    <span className={`kapu-name${light ? ' light' : ''}`} aria-label="Kapu">
      <span className="k1" aria-hidden="true">K</span><span className="k2" aria-hidden="true">a</span><span className="k3" aria-hidden="true">p</span><span className="k4" aria-hidden="true">u</span>
    </span>
  );
}

// The site's name: Kapu in the flag's colours, or a client's own name as plain text.
// `accent` is given on light pages (the log-in pages); without it the name sits on the dark admin bar.
export default function BrandName({ accent }) {
  if (isKapu()) return <KapuName light={!accent} />;
  return <>{STORE_INFO.name}</>;
}
