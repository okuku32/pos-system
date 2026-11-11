// The current client's shop details (name, location, contacts), loaded from the server once at start-up
// (see main.jsx). Each client edits these in Settings → Business details.
export const STORE_INFO = {
  slug: '',
  name: 'Ordersasa',
  location: '',
  address: '',
  mapQuery: '',
  phone: '',
  whatsapp: '',
  email: '',
  hours: [], // e.g. [['Mon – Sat', '8:00 am – 9:00 pm']]
  logoUrl: '',
};

export let mapEmbedUrl = '';
export let directionsUrl = '';

function apply(info) {
  const shop = info.shop || {};
  Object.assign(STORE_INFO, {
    slug: info.slug || '',
    name: info.storeName || 'Ordersasa',
    location: shop.location || shop.address || '',
    address: shop.address || '',
    mapQuery: shop.mapQuery || shop.address || '',
    phone: shop.phone || '',
    whatsapp: (shop.whatsapp || '').replace(/\D/g, ''),
    email: shop.email || '',
    hours: shop.hours || [],
    logoUrl: info.branding?.logoUrl || '',
  });
  mapEmbedUrl = STORE_INFO.mapQuery ? `https://www.google.com/maps?q=${encodeURIComponent(STORE_INFO.mapQuery)}&output=embed` : '';
  directionsUrl = STORE_INFO.mapQuery ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(STORE_INFO.mapQuery)}` : '';
}

// Returns { status: 'ok' | 'suspended' | 'unknown' | 'offline', message }
export async function loadStoreInfo() {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/shop/info`);
    const body = await res.json().catch(() => ({}));
    if (res.status === 403 && body.suspended) return { status: 'suspended', message: body.message };
    if (res.status === 404) return { status: 'unknown', message: body.message };
    if (!res.ok) return { status: 'offline', message: body.message || 'The server is not reachable right now.' };
    apply(body);
    return { status: 'ok' };
  } catch {
    return { status: 'offline', message: 'The server is not reachable right now.' };
  }
}

// "Ordersasa" keeps its two-tone wordmark; other clients' names are shown as plain text
export const isOrdersasa = () => STORE_INFO.name.trim().toLowerCase() === 'ordersasa';
