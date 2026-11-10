// Ordersasa mark: a shopping bag with speed lines ("sasa" = now)
export default function Logo({ size = 34, light = false }) {
  return (
    <span className="os-logo">
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill="var(--os-brand)" />
        <path d="M13 15h16l-1.4 15.2a2 2 0 0 1-2 1.8H16.4a2 2 0 0 1-2-1.8Z" fill="#fff" />
        <path d="M16.5 15v-1.5a4.5 4.5 0 0 1 9 0V15" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M5 21h5M6.5 25.5h4" stroke="#fff" strokeOpacity=".75" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="21" cy="22.5" r="2.2" fill="var(--os-brand)" />
      </svg>
      <span className={`os-wordmark ${light ? 'light' : ''}`}>
        Order<b>sasa</b>
      </span>
    </span>
  );
}
