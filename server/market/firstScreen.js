// 📱 An item page's first screen, built on the server and sent inside the HTML.
//
// Why: on a phone, the app needs ~2.5 s on a slow connection (download + start React) before it can draw anything, and
// a buyer who taps a shared link stares at a spinner. The server already knows the ad, so it sends the top of the page
// (photo, title, price) ready-made. The browser shows it as soon as the HTML arrives and starts downloading the photo at
// once (the photo is in the HTML, not discovered later by JavaScript). When the app starts, React replaces it with the
// real page, which looks the same, so nothing jumps.
//
// The photo address must be *exactly* the one the app will use (same CDN address, same sizes), otherwise the phone
// downloads the photo twice. photoAddress / photoSizeChoices below mirror imgUrl / imgSrcSet in
// client/src/market/marketApi.js, and GALLERY_PHOTO mirrors the gallery's <AdImage> in ListingPage.jsx (a unit test
// checks they agree).
//
// Shown on phones only (index.html's CSS). Desktops start the app fast enough, and their layout has many variants.
const { getCategory } = require('./categories');

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

// the gallery photo's request: the same width, size choices and `sizes` as the app's gallery <AdImage>
const GALLERY_PHOTO = { width: 1080, sizeChoices: [320, 480, 720, 1080], sizes: '(max-width: 760px) 100vw, 800px' };

// background colours for ads without a photo (two tones per category). Same as TINTS in client/src/market/marketApi.js.
const PHOTOLESS_TINTS = {
  vehicles: ['#fff1ea', '#ffd9c7'], electronics: ['#eaf2ff', '#cfe0ff'], 'land-property': ['#eaf7ee', '#c9ecd5'], beddings: ['#f3eefe', '#e0d4fb'],
  furniture: ['#fdf3e7', '#f6dfc0'], stationery: ['#eef7ff', '#d5eafc'], packaging: ['#f6f1ea', '#e7dccb'], liquor: ['#fbecef', '#f3cfd7'],
  'spare-parts': ['#eef0f3', '#d9dee6'], bicycles: ['#e9f8f6', '#c8eee8'], appliances: ['#fff6e5', '#ffe6b3'], utensils: ['#f1f5ea', '#dbe7c8'],
  'clothes-shoes': ['#fdeef6', '#f8d2e6'], bags: ['#f5efe9', '#e6d6c6'], beauty: ['#fcedf3', '#f6cfe0'], 'detergents-cleaning': ['#e9f6fd', '#c9e9f9'],
  'cooking-products': ['#fbf6e6', '#f2e4b0'], beverages: ['#eaf8f0', '#c5ecd6'], 'baby-kids': ['#eef6ff', '#d3e6ff'], 'african-crafts': ['#fbf1e6', '#f0d9bd'], 'fresh-produce': ['#ecf8e8', '#cdeec2'], samaki: ['#e8f4fb', '#c4e2f3'], other: ['#f2f0ed', '#e2ded8'],
};

// The address of one of our photos (a path like /uploads/listings/abc.jpg), resized to `width` when a CDN can resize:
//   imageCdn { proxy: 'wsrv', origin }  → wsrv.nl fetches it from our public origin, resizes, converts to WebP
//   imageCdn { url, resize? }           → your own CDN (with its resize address template, if it has one)
//   no CDN                              → our own address (relative: the page and the photos share one origin)
function photoAddress(photoPath, width, imageCdn) {
  if (!photoPath) return '';
  if (/^(https?:|blob:|data:)/.test(photoPath)) return photoPath; // already a full address (e.g. a seeded stock photo)
  const isOurUpload = photoPath.startsWith('/uploads/');
  if (imageCdn?.proxy === 'wsrv' && imageCdn.origin && isOurUpload) {
    return `https://wsrv.nl/?url=${encodeURIComponent(imageCdn.origin + photoPath)}&w=${Math.round(width || 1280)}&output=webp&q=78&we&il`;
  }
  if (imageCdn?.url && isOurUpload) {
    if (width && imageCdn.resize) {
      // the template names the photo either as the full CDN address ({url}) or just its path ({path}), and the width ({w})
      return imageCdn.resize.replace('{url}', `${imageCdn.url}${photoPath}`).replace('{path}', photoPath).replace('{w}', String(Math.round(width)));
    }
    return `${imageCdn.url}${photoPath}`;
  }
  return photoPath;
}

// the `srcset` list ("address 320w, address 480w, …") so the phone picks the size that fits its screen; only when the
// CDN can resize (otherwise every "size" would be the same file, and the attribute is left out)
function photoSizeChoices(photoPath, imageCdn, widths = GALLERY_PHOTO.sizeChoices) {
  const canResize = Boolean(imageCdn?.resize || imageCdn?.proxy === 'wsrv');
  if (!canResize || !photoPath?.startsWith('/uploads/')) return undefined;
  return widths.map((width) => `${photoAddress(photoPath, width, imageCdn)} ${width}w`).join(', ');
}

// the top of the item page on a phone: search bar (placeholder), breadcrumbs, the photo (or the category's emoji on its
// colour), title and price. `priceText` comes from the caller so it reads exactly like the rest of the page.
function itemFirstScreen(listing, { imageCdn, categoryName, subName, priceText }) {
  const firstPhoto = (listing.images || [])[0];
  const category = getCategory(listing.category);
  const [tintLight, tintDark] = PHOTOLESS_TINTS[listing.category] || PHOTOLESS_TINTS.other;
  const sizeChoices = photoSizeChoices(firstPhoto, imageCdn);
  // fetchpriority="high": the photo is what the buyer came to see, so it goes ahead of the app's code in the queue
  const picture = firstPhoto
    ? `<img class="bi-photo" src="${escapeHtml(photoAddress(firstPhoto, GALLERY_PHOTO.width, imageCdn))}"${sizeChoices ? ` srcset="${escapeHtml(sizeChoices)}" sizes="${GALLERY_PHOTO.sizes}"` : ''} alt="${escapeHtml(listing.title)}" width="400" height="300" fetchpriority="high">`
    : `<div class="bi-photo bi-nophoto" style="background:linear-gradient(135deg, ${tintLight}, ${tintDark})"><span>${category?.icon || '🛍️'}</span></div>`;
  // the same trail as the real page (ending with the ad's title), so the photo below starts at the same height
  const crumbs = ['Home', categoryName, subName, listing.title].filter(Boolean).map(escapeHtml).join(' › ');
  return `<div class="boot-item" aria-hidden="true"><div class="bi-search">Search Kapu</div><p class="bi-crumbs">${crumbs}</p><div class="bi-gallery">${picture}</div><p class="bi-title">${escapeHtml(listing.title)}</p><p class="bi-price">${escapeHtml(priceText)}</p></div>`;
}

module.exports = { itemFirstScreen, photoAddress, photoSizeChoices, GALLERY_PHOTO, PHOTOLESS_TINTS };
