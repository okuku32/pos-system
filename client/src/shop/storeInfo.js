// The marketplace's public details (name, contacts, address), loaded once at start-up from /api/site
// (see main.jsx). Admins edit them under Admin → Settings.
export const STORE_INFO = {
  name: 'Kapu',
  tagline: 'Sell fast. Buy smart. Pay safe.',
  location: '',
  address: '',
  mapQuery: '',
  phone: '0768507798',
  whatsapp: '',
  email: '',
  hours: [], // e.g. [['Mon – Sat', '8:00 am – 6:00 pm']]
  commissionPercent: 5,
  logoUrl: '',
  campaign: null, // seasonal banner on the home page (Admin → Settings)
  mapsKey: '', // Google Maps browser key (Admin → Settings); maps still work without it
  social: {}, // TikTok, Instagram, Facebook, X, YouTube links (Admin → Settings)
};

export let mapEmbedUrl = '';
export let directionsUrl = '';

export function applySiteInfo(info = {}) {
  Object.assign(STORE_INFO, {
    name: info.name || 'Kapu',
    tagline: info.tagline || STORE_INFO.tagline,
    social: info.social || {},
    address: info.address || '',
    location: (info.address || '').split(',')[0] || '',
    mapQuery: info.address || '',
    phone: info.phone || '0768507798',
    whatsapp: String(info.whatsapp || '').replace(/\D/g, ''),
    email: info.email || '',
    hours: info.hours || [],
    commissionPercent: info.commissionPercent ?? 5,
    campaign: info.campaign || null,
    fieldwork: info.fieldwork || null, // riders & shopping agents: fees and shares
    courier: info.courier || null, // far deliveries by bus / courier (Admin → Settings)
    trades: info.trades || null, // wholesalers by trade, importers by what they import
    demoPayments: !!info.demoPayments,
    mpesaReady: !!info.mpesaReady,
    mapsKey: info.mapsKey || '',
    imageCdn: info.imageCdn || null, // photos through a CDN (IMAGE_CDN_URL / IMAGE_CDN_RESIZE on the server)
    mapTiles: info.mapTiles || null, // the maps' images: OpenStreetMap's unless MAP_TILE_URL is set on the server
  });
  mapEmbedUrl = STORE_INFO.mapQuery ? `https://www.google.com/maps?q=${encodeURIComponent(STORE_INFO.mapQuery)}&output=embed` : '';
  directionsUrl = STORE_INFO.mapQuery ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(STORE_INFO.mapQuery)}` : '';
}

// Returns { status: 'ok' | 'offline' }: the site still opens offline; pages show their own connection errors
export async function loadStoreInfo() {
  if (window.__SITE__) {
    applySiteInfo(window.__SITE__); // put in the page by the server
    return { status: 'ok' };
  }
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/site`);
    if (!res.ok) return { status: 'offline' };
    applySiteInfo(await res.json());
    return { status: 'ok' };
  } catch {
    return { status: 'offline' };
  }
}

// "Kapu" keeps its two-tone wordmark; any other name is shown as plain text
export const isKapu = () => STORE_INFO.name.trim().toLowerCase() === 'kapu';
