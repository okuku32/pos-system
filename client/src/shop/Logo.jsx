import { STORE_INFO, isKapu } from './storeInfo';
import { KapuName } from '../components/BrandName';

// Shop mark: the client's logo if they set one, otherwise our kapu (a woven basket) on the brand orange.
// The name itself is in the Kenyan flag's colours.
export default function Logo({ size = 34, light = false }) {
  return (
    <span className="os-logo">
      {STORE_INFO.logoUrl ? <img src={STORE_INFO.logoUrl} alt="" width={size} height={size} style={{ borderRadius: 10, objectFit: 'cover' }} /> : (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill="var(--os-brand)" />
        <path d="M13.5 17a6.5 6.5 0 0 1 13 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M8.5 17h23l-2.7 13.3a2.4 2.4 0 0 1-2.35 1.95H13.55a2.4 2.4 0 0 1-2.35-1.95Z" fill="#fff" />
        <path d="M10.4 22.2h19.2M11.3 26.6h17.4" stroke="var(--os-brand)" strokeOpacity=".55" strokeWidth="2" />
      </svg>
      )}
      <span className={`os-wordmark ${light ? 'light' : ''}`}>
        {isKapu() ? <KapuName light={light} /> : STORE_INFO.name}
      </span>
    </span>
  );
}
