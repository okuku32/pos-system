// Search-engine friendly pages for the marketplace.
//
// The app is a React single-page app, so on its own every address would return the same empty page.
// This router answers marketplace addresses with the built index.html PLUS, for that exact page:
//   - a unique <title>, meta description and canonical address
//   - Open Graph / Twitter tags (rich previews when a link is shared on WhatsApp, Facebook, X...)
//   - JSON-LD structured data (Product + Offer, Car, BreadcrumbList, ItemList, WebSite search box)
//   - the page's real content as plain HTML inside #root (headings, prices, links to every ad),
//     readable by any crawler without running JavaScript; React replaces it as soon as the app starts.
// Also serves /robots.txt and /sitemap.xml (every category, make and ad, updated automatically).
const fs = require('fs');
const path = require('path');
const express = require('express');
const { site } = require('../config/site');
const { cached } = require('../utils/cache');
const Listing = require('../models/Listing');
const { CATEGORIES, COUNTIES, getCategory, getSub, fieldsFor } = require('./categories');
const { itemFirstScreen } = require('./firstScreen');

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
const ksh = (amount) => (amount > 0 ? `KSh ${Number(amount).toLocaleString('en-KE')}` : 'Contact for price');
const clip = (text, number) => {
  const input = String(text || '').replace(/\s+/g, ' ').trim();
  return input.length <= number ? input : `${input.slice(0, number - 1).replace(/\s+\S*$/, '')}…`;
};
const store = () => site().name;
const requestHost = (req) => String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
const publicSiteOrigin = () => {
  if (process.env.NODE_ENV !== 'production' || !/^https:\/\//.test(process.env.SHOP_URL || '')) return '';
  try { return new URL(process.env.SHOP_URL).origin; } catch { return ''; }
};
const baseUrl = (req) => publicSiteOrigin() || `${req.protocol}://${requestHost(req) || 'localhost'}`;
const abs = (req, value) => (/^https?:/.test(value) ? value : `${baseUrl(req)}${value}`);

// ---------------------------------------------------------------- page template (built index.html)
let template = null;
let templateTime = 0;
function readTemplate(dist) {
  const file = path.join(dist, 'index.html');
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (!template || mtimeMs !== templateTime) {
      template = fs.readFileSync(file, 'utf8');
      templateTime = mtimeMs;
    }
  } catch {
    template = null;
  }
  return template;
}

const SNAP_CSS = `<style id="seo-snap-css">.seo-snap{font-family:'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,sans-serif;max-width:1100px;margin:0 auto;padding:18px 16px 40px;color:#14171f;background:#faf8f5;line-height:1.5}.seo-snap a{color:#e2440c}.seo-snap h1{font-size:26px;margin:8px 0 12px}.seo-snap h2{font-size:18px;margin:22px 0 8px}.seo-snap ul{padding-left:18px}.seo-snap li{margin:4px 0}.seo-snap nav{font-size:13px;color:#6b7280}.seo-snap .p{font-weight:800;font-size:20px;color:#e2440c}.seo-snap img{max-width:100%;height:auto;border-radius:14px}.seo-snap dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px}.seo-snap dt{color:#6b7280}.seo-snap form{display:flex;gap:6px;margin:10px 0}.seo-snap input{flex:1;padding:10px;border:1px solid #ddd;border-radius:10px}</style>`;

// the site's public settings, inline (the app starts without waiting for /api/site)
// (and, when photos come from a CDN, an early connection to it, so the first photo doesn't wait for one)
const siteScript = () => {
  const site = require('../config/site').publicSite();
  const cdnHost = site.imageCdn?.url || (site.imageCdn?.proxy === 'wsrv' ? 'https://wsrv.nl' : '');
  const cdn = cdnHost ? `<link rel="preconnect" href="${esc(cdnHost)}">` : '';
  return `${cdn}<script>window.__SITE__=${JSON.stringify(site).replace(/</g, '\\u003c')}</script>`;
};
// the plain app page (addresses without their own search-engine page)
function appPage(dist) {
  const tpl = readTemplate(dist);
  return tpl ? tpl.replace('</head>', `    ${siteScript()}\n  </head>`) : null;
}

function render(dist, page) {
  const tpl = readTemplate(dist);
  if (!tpl) return null;
  const head = [
    `<link rel="canonical" href="${esc(page.canonical)}" data-seo>`,
    `<meta name="robots" content="${page.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}" data-seo>`,
    `<meta property="og:type" content="${page.ogType || 'website'}" data-seo>`,
    `<meta property="og:site_name" content="${esc(page.site)}" data-seo>`,
    `<meta property="og:title" content="${esc(page.title)}" data-seo>`,
    `<meta property="og:description" content="${esc(page.description)}" data-seo>`,
    `<meta property="og:url" content="${esc(page.canonical)}" data-seo>`,
    `<meta property="og:locale" content="en_KE" data-seo>`,
    page.image ? `<meta property="og:image" content="${esc(page.image)}" data-seo>` : '',
    `<meta name="twitter:card" content="${page.image ? 'summary_large_image' : 'summary'}" data-seo>`,
    `<meta name="twitter:title" content="${esc(page.title)}" data-seo>`,
    `<meta name="twitter:description" content="${esc(page.description)}" data-seo>`,
    page.image ? `<meta name="twitter:image" content="${esc(page.image)}" data-seo>` : '',
    page.prev ? `<link rel="prev" href="${esc(page.prev)}" data-seo>` : '',
    page.next ? `<link rel="next" href="${esc(page.next)}" data-seo>` : '',
    page.jsonLd?.length ? `<script type="application/ld+json" id="seo-jsonld">${JSON.stringify(page.jsonLd.length === 1 ? page.jsonLd[0] : page.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
    SNAP_CSS,
    siteScript(),
    // the app's first API request, started now instead of after its code has downloaded and run (same cookies, so the
    // same answer the app would get); the app takes it once (window.__PREFETCH__), else asks as usual
    page.prefetch ? `<script>window.__PREFETCH__={path:${JSON.stringify(page.prefetch)},data:fetch(${JSON.stringify('/api' + page.prefetch)},{credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}</script>` : '',
  ].filter(Boolean).join('\n    ');
  return tpl
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(page.description)}" />`)
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<div id="root">', `<div id="root"><div class="seo-snap">${page.body || ''}</div>`)
    // a ready-made first screen goes inside the loading screen (index.html's CSS shows it instead of the spinner on phones);
    // a function as the replacement, so a "$" in an ad's title is kept as written (not read as a replace pattern)
    .replace('<div class="boot-spin"></div>', () => `<div class="boot-spin"></div>${page.firstScreen || ''}`);
}

// ---------------------------------------------------------------- shared bits
const crumbsHtml = (items) => `<nav aria-label="Breadcrumb">${items.map((item, index) => (index < items.length - 1 ? `<a href="${esc(item.href)}">${esc(item.name)}</a> › ` : esc(item.name))).join('')}</nav>`;
const crumbsLd = (req, items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: abs(req, item.href) })),
});
const adLine = (listing) => `<li><a href="/market/item/${esc(listing.slug)}">${esc(listing.title)}</a> · <b>${esc(ksh(listing.price))}</b>${listing.negotiable ? ' (negotiable)' : ''} · ${esc([listing.area, listing.county].filter(Boolean).join(', '))}</li>`;
const searchForm = (query = '') => `<form action="/market/search" method="get" role="search"><input name="q" value="${esc(query)}" placeholder="Search cars, land, phones, furniture…" aria-label="Search the marketplace"><button>Search</button></form>`;
const catLinks = (counts) => `<ul>${CATEGORIES.map((category) => `<li><a href="/market/${category.slug}">${esc(category.name)}</a> (${counts[category.slug]?.total || 0} ads): ${category.subs.map((sub) => `<a href="/market/${category.slug}/${sub.slug}">${esc(sub.name)}</a>`).join(', ')}</li>`).join('')}</ul>`;

// ---------------------------------------------------------------- pages
const market = () => require('../controllers/marketController');

async function homePage(req) {
  const site = store();
  const [counts, latest] = await Promise.all([
    market().countsByCategory(),
    Listing.find({ status: 'active' }).sort({ createdAt: -1 }).limit(30).select('slug title price negotiable county area').lean(),
  ]);
  const total = Object.values(counts).reduce((sum, value) => sum + value.total, 0);
  const title = `${site}: buy & sell cars, land, phones, furniture and more in Kenya`;
  const description = clip(`Kenya’s easy marketplace: ${total.toLocaleString('en-KE')} ads for vehicles, land & plots, electronics, furniture, beddings, spare parts, clothes, beauty, liquor and more. Search, chat with sellers and buy safely on ${site}.`, 160);
  return {
    site, title, description, canonical: abs(req, '/'),
    jsonLd: [
      {
        '@context': 'https://schema.org', '@type': 'WebSite', name: site, url: abs(req, '/'),
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: abs(req, '/market/search?q={search_term_string}') }, 'query-input': 'required name=search_term_string' },
      },
      { '@context': 'https://schema.org', '@type': 'Organization', name: site, url: baseUrl(req), logo: abs(req, '/favicon.svg'), sameAs: Object.values(require('../config/site').site().social || {}).filter(Boolean) },
    ],
    body: `<h1>${esc(site)}: buy and sell anything in Kenya</h1>
      <p>${esc(description)}</p>${searchForm()}
      <h2>Browse categories</h2>${catLinks(counts)}
      <h2>Latest ads</h2><ul>${latest.map(adLine).join('')}</ul>
      <p><a href="/market/sell">Post a free ad</a> · <a href="/help">Help &amp; contact</a></p>`,
  };
}

async function categoryPage(req, catSlug, subSlug) {
  const site = store();
  const cat = getCategory(catSlug);
  const sub = subSlug ? getSub(catSlug, subSlug) : null;
  if (!cat || (subSlug && !sub)) return null;
  const query = req.query;
  const make = typeof query.make === 'string' ? query.make.slice(0, 40) : '';
  const model = typeof query.model === 'string' ? query.model.slice(0, 40) : '';
  const county = COUNTIES.includes(query.county) ? query.county : '';
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const result = await market().runSearch({ ...query, category: cat.slug, sub: sub?.slug, make, model, county, page, limit: 24 });

  const what = [make, model, sub ? sub.name : cat.name].filter(Boolean).join(' ');
  const heading = /for (sale|rent|lease)/i.test(what) ? what : `${what} for sale`; // no "for sale for sale"
  const where = county ? `in ${county}` : 'in Kenya';
  const title = `${heading} ${where}${page > 1 ? ` (page ${page})` : ''} | ${site}`;
  const prices = result.items.map((item) => item.price).filter((item) => item > 0);
  const range = prices.length ? ` Prices from ${ksh(Math.min(...prices))}.` : '';
  const description = clip(`${result.total.toLocaleString('en-KE')} ${what.toLowerCase()} ads ${where}.${range} ${cat.blurb} Chat with sellers directly on ${site}.`, 160);

  // canonical keeps only the parts that make this a distinct page (make, model, county, page)
  const keep = new URLSearchParams();
  if (make) keep.set('make', make);
  if (model) keep.set('model', model);
  if (county) keep.set('county', county);
  const basePath = `/market/${cat.slug}${sub ? `/${sub.slug}` : ''}`;
  const withPage = (currentPage) => {
    const params = new URLSearchParams(keep);
    if (currentPage > 1) params.set('page', currentPage);
    const text = params.toString();
    return abs(req, `${basePath}${text ? `?${text}` : ''}`);
  };
  const otherFilters = Object.keys(query).some((key) => !['make', 'model', 'county', 'page'].includes(key));

  const crumbs = [{ name: 'Home', href: '/' }, { name: cat.name, href: `/market/${cat.slug}` }];
  if (sub) crumbs.push({ name: sub.name, href: basePath });
  if (make) crumbs.push({ name: [make, model].filter(Boolean).join(' '), href: withPage(1).replace(baseUrl(req), '') });

  const makeField = sub && fieldsFor(cat.slug, sub.slug).find((item) => item.type === 'make');
  const makes = makeField ? Object.keys(makeField.makes).filter((key) => key !== 'Other') : [];
  return {
    site, title, description,
    canonical: withPage(page),
    noindex: otherFilters || result.total === 0, // filtered or empty pages: let Google follow links but not index them
    prev: page > 1 ? withPage(page - 1) : null,
    next: page < result.pages ? withPage(page + 1) : null,
    jsonLd: [
      crumbsLd(req, crumbs),
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: `${heading} ${where}`, numberOfItems: result.total,
        itemListElement: result.items.map((item, index) => ({ '@type': 'ListItem', position: (page - 1) * 24 + index + 1, url: abs(req, `/market/item/${item.slug}`), name: item.title })),
      },
    ],
    body: `${crumbsHtml(crumbs)}<h1>${esc(heading)} ${esc(where)}</h1>
      <p>${esc(description)}</p>${searchForm()}
      ${!sub ? `<h2>${esc(cat.name)} categories</h2><ul>${cat.subs.map((subcategory) => `<li><a href="/market/${cat.slug}/${subcategory.slug}">${esc(subcategory.name)}</a></li>`).join('')}</ul>` : ''}
      ${makes.length && !make ? `<h2>Popular makes</h2><p>${makes.map((currentMake) => `<a href="${basePath}?make=${encodeURIComponent(currentMake)}">${esc(currentMake)} ${esc(sub.name.toLowerCase())}</a>`).join(' · ')}</p>` : ''}
      ${make && makeField?.makes[make]?.length && !model ? `<h2>${esc(make)} models</h2><p>${makeField.makes[make].map((item) => `<a href="${basePath}?make=${encodeURIComponent(make)}&amp;model=${encodeURIComponent(item)}">${esc(make)} ${esc(item)}</a>`).join(' · ')}</p>` : ''}
      <h2>${result.total.toLocaleString('en-KE')} ads</h2><ul>${result.items.map(adLine).join('')}</ul>
      <p>${page > 1 ? `<a href="${esc(withPage(page - 1))}">‹ Previous page</a> ` : ''}${page < result.pages ? `<a href="${esc(withPage(page + 1))}">Next page ›</a>` : ''}</p>
      <h2>Browse by county</h2><p>${COUNTIES.slice(0, 12).map((item) => `<a href="${basePath}?county=${encodeURIComponent(item)}">${esc(item)}</a>`).join(' · ')}</p>`,
  };
}

async function searchPage(req) {
  const site = store();
  const query = String(req.query.q || '').slice(0, 100);
  const result = await market().runSearch({ ...req.query, limit: 24 });
  const title = query ? `${query}: ${result.total} ads for sale in Kenya | ${site}` : `Search the ${site} marketplace`;
  return {
    site, title, description: clip(`${result.total} results for “${query}” on the ${site} marketplace. Compare prices and chat with sellers.`, 160),
    canonical: abs(req, `/market/search${query ? `?q=${encodeURIComponent(query)}` : ''}`),
    noindex: true, // search results pages are not indexed (Google's guidelines); the ads themselves are
    body: `<h1>${esc(query ? `Results for “${query}”` : 'Search the marketplace')}</h1>${searchForm(query)}<ul>${result.items.map(adLine).join('')}</ul>`,
  };
}

async function itemPage(req, slug) {
  const site = store();
  const found = await market().loadPublicListing(slug);
  if (!found) {
    return {
      status: 404, site, title: `Ad not found | ${site}`, description: 'This ad has been removed or sold.', canonical: abs(req, '/'), noindex: true,
      body: `<h1>This ad is no longer available</h1><p><a href="/">Browse the marketplace</a></p>${searchForm()}`,
    };
  }
  const { l: listing } = found;
  const cat = getCategory(listing.category);
  const sub = getSub(listing.category, listing.sub);
  const where = [listing.area, listing.county].filter(Boolean).join(', ');
  const title = `${listing.title}${listing.price > 0 ? ` – ${ksh(listing.price)}` : ''} | ${where} | ${site}`;
  const description = clip(`${listing.status === 'sold' ? 'SOLD. ' : ''}${ksh(listing.price)}${listing.negotiable ? ' (negotiable)' : ''} · ${where}. ${listing.description}`, 160);
  const fields = fieldsFor(listing.category, listing.sub);
  const facts = fields.filter((field) => listing.attrs?.[field.key] !== undefined && listing.attrs[field.key] !== '').map((item) => [item.label, listing.attrs[item.key]]);
  if (listing.condition) facts.unshift(['Condition', listing.condition]);
  const images = (listing.images || []).map((image) => abs(req, image));
  const crumbs = [{ name: 'Home', href: '/' }, { name: cat?.name || 'Ads', href: `/market/${listing.category}` }, { name: sub?.name || '', href: `/market/${listing.category}/${listing.sub}` }, { name: listing.title, href: `/market/item/${listing.slug}` }];

  const attrs = listing.attrs || {};
  const isCar = listing.category === 'vehicles';
  const product = {
    '@context': 'https://schema.org',
    '@type': isCar ? ['Product', 'Car'] : 'Product',
    name: listing.title,
    description: clip(listing.description, 5000),
    sku: String(listing._id),
    category: [cat?.name, sub?.name].filter(Boolean).join(' > '),
    ...(images.length ? { image: images } : {}),
    ...(attrs.make || attrs.brand ? { brand: { '@type': 'Brand', name: attrs.make || attrs.brand } } : {}),
    ...(attrs.model ? { model: attrs.model } : {}),
    ...(isCar && attrs.year ? { vehicleModelDate: String(attrs.year) } : {}),
    ...(isCar && attrs.mileage ? { mileageFromOdometer: { '@type': 'QuantitativeValue', value: attrs.mileage, unitCode: 'KMT' } } : {}),
    ...(isCar && attrs.transmission ? { vehicleTransmission: attrs.transmission } : {}),
    ...(isCar && attrs.fuel ? { fuelType: attrs.fuel } : {}),
    ...(attrs.colour ? { color: attrs.colour } : {}),
    offers: {
      '@type': 'Offer',
      url: abs(req, `/market/item/${listing.slug}`),
      priceCurrency: 'KES',
      ...(listing.price > 0 ? { price: listing.price } : {}),
      availability: listing.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      itemCondition: /new/i.test(listing.condition || '') && !/used/i.test(listing.condition || '') ? 'https://schema.org/NewCondition' : /refurb/i.test(listing.condition || '') ? 'https://schema.org/RefurbishedCondition' : listing.condition ? 'https://schema.org/UsedCondition' : undefined,
      areaServed: { '@type': 'Place', name: `${where}, Kenya` },
      seller: { '@type': 'Person', name: listing.sellerName || 'Seller' },
    },
  };
  const similar = await market().similarTo(listing, 10);
  return {
    site, title, description, canonical: abs(req, `/market/item/${listing.slug}`), image: images[0], ogType: 'product',
    prefetch: `/market/listings/${encodeURIComponent(listing.slug)}`, // the app's own request for this ad, started with the page
    // the top of the page (photo, title, price), drawn by the browser before the app has started (phones; see firstScreen.js)
    // (the settings are read through the module: inside this function, `site` is the store's name)
    firstScreen: itemFirstScreen(listing, { imageCdn: require('../config/site').site().imageCdn, categoryName: cat?.name, subName: sub?.name, priceText: `${ksh(listing.price)}${listing.negotiable ? ' · negotiable' : ''}${listing.status === 'sold' ? ' · SOLD' : ''}` }),
    jsonLd: [product, crumbsLd(req, crumbs)],
    body: `${crumbsHtml(crumbs)}<article><h1>${esc(listing.title)}</h1>
      <p class="p">${esc(ksh(listing.price))}${listing.negotiable ? ' · negotiable' : ''}${listing.status === 'sold' ? ' · SOLD' : ''}</p>
      <p>📍 ${esc(where)} · Posted ${new Date(listing.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} by <a href="/market/seller/${esc(listing.seller)}">${esc(listing.sellerName || 'the seller')}</a></p>
      ${images[0] ? `<img src="${esc(images[0])}" alt="${esc(listing.title)}" width="640" height="480">` : ''}
      ${facts.length ? `<h2>Details</h2><dl>${facts.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>` : ''}
      <h2>Description</h2><p>${esc(listing.description).replace(/\n/g, '<br>')}</p></article>
      ${similar.length ? `<h2>Similar ${esc(sub?.name?.toLowerCase() || 'ads')}</h2><ul>${similar.map(adLine).join('')}</ul>` : ''}`,
  };
}

async function sellerPage(req, id) {
  const site = store();
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const Customer = require('../models/Customer');
  const customer = await Customer.findById(id).select('name').lean();
  if (!customer) return null;
  const items = await Listing.find({ seller: id, status: 'active' }).sort({ createdAt: -1 }).limit(60).select('slug title price negotiable county area').lean();
  return {
    site, title: `${customer.name}’s ads on ${site} (${items.length})`, description: clip(`See all ${items.length} ads posted by ${customer.name} on the ${site} marketplace.`, 160),
    canonical: abs(req, `/market/seller/${id}`), noindex: items.length === 0,
    body: `<h1>Ads by ${esc(customer.name)}</h1><ul>${items.map(adLine).join('')}</ul>`,
  };
}

const privatePage = (req, title) => ({ site: store(), title: `${title} | ${store()}`, description: `${title} on the ${store()} marketplace.`, canonical: abs(req, req.path), noindex: true, body: '' });

// ---------------------------------------------------------------- robots & sitemap
const PRIVATE_PATHS = ['/api/', '/admin', '/agreements', '/plans', '/login', '/signup', '/forgot-password', '/reset-password', '/account', '/checkout', '/orders', '/sales', '/market/sell', '/market/edit', '/market/my', '/market/messages'];

function robots(req, res) {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600');
  res.send(`User-agent: *\nAllow: /\n${PRIVATE_PATHS.map((privatePath) => `Disallow: ${privatePath}`).join('\n')}\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
}

async function sitemap(req, res) {
  const base = baseUrl(req);
  const xml = await cached(`market:sitemap:${base}`, 10 * 60 * 1000, async () => {
    const counts = await market().countsByCategory();
    const urls = [
      { loc: '/', freq: 'hourly', pri: '1.0' },
      { loc: '/about', freq: 'monthly', pri: '0.5' },
      { loc: '/contact', freq: 'monthly', pri: '0.5' },
      { loc: '/help', freq: 'monthly', pri: '0.3' },
      { loc: '/wholesale', freq: 'daily', pri: '0.8' },
      { loc: '/ride-with-us', freq: 'weekly', pri: '0.7' },
      { loc: '/imports', freq: 'daily', pri: '0.8' },
      { loc: '/sellers-near-me', freq: 'weekly', pri: '0.6' },
      { loc: '/wholesalers-near-me', freq: 'weekly', pri: '0.6' },
      ...['/boutiques-near-me', '/boutiques-near-me/men', '/boutiques-near-me/women', '/mama-mboga-near-me', '/markets-near-me', '/chemists-near-me', '/electronics-shops-near-me', '/spare-parts-shops-near-me', '/baby-shops-near-me', '/groceries-near-me', '/importers-near-me'].map((loc) => ({ loc, freq: 'weekly', pri: '0.6' })),
      { loc: '/fashion', freq: 'daily', pri: '0.8' },
      ...(await require('../models/Market').find({ approved: true }).select('slug').lean()).map((element) => ({ loc: `/markets/${element.slug}`, freq: 'weekly', pri: '0.6' })),
      ...require('./origins').ORIGINS.map((origin) => ({ loc: `/imports/${origin.key}`, freq: 'daily', pri: '0.7' })),
    ];
    for (const category of CATEGORIES) {
      urls.push({ loc: `/market/${category.slug}`, freq: 'daily', pri: '0.8' });
      for (const sub of category.subs) if (counts[category.slug]?.subs[sub.slug]) urls.push({ loc: `/market/${category.slug}/${sub.slug}`, freq: 'daily', pri: '0.7' });
    }
    // make and model pages that actually have ads ("Toyota Vitz cars for sale in Kenya")
    const mm = await Listing.aggregate([
      { $match: { status: 'active', 'attrs.make': { $exists: true, $ne: '' } } },
      { $group: { _id: { c: '$category', s: '$sub', make: '$attrs.make', model: '$attrs.model' } } },
      { $limit: 5000 },
    ]);
    const makesSeen = new Set();
    for (const { _id: element } of mm) {
      const mk = `/market/${element.c}/${element.s}?make=${encodeURIComponent(element.make)}`;
      if (!makesSeen.has(mk)) {
        makesSeen.add(mk);
        urls.push({ loc: mk, freq: 'daily', pri: '0.6' });
      }
      if (element.model) urls.push({ loc: `${mk}&model=${encodeURIComponent(element.model)}`, freq: 'daily', pri: '0.6' });
    }
    const ads = await Listing.find({ status: 'active' }).sort({ updatedAt: -1 }).limit(45000).select('slug updatedAt images').lean();
    for (const ad of ads) urls.push({ loc: `/market/item/${ad.slug}`, mod: ad.updatedAt, freq: 'weekly', pri: '0.7', img: ad.images?.[0] });
    const item = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((url) => `  <url><loc>${item(base + url.loc)}</loc>${url.mod ? `<lastmod>${new Date(url.mod).toISOString()}</lastmod>` : ''}<changefreq>${url.freq}</changefreq><priority>${url.pri}</priority>${url.img ? `<image:image><image:loc>${item(base + url.img)}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>`;
  });
  res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(xml);
}

// ---------------------------------------------------------------- router
// async route handlers: errors go to the error handler
const wrap = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    next(err);
  }
};

function seoRouter(dist) {
  const router = express.Router();
  // renamed categories: the old address moves permanently to the new one
  router.get(/^\/market\/kitchen-equipment(\/.*)?$/, (req, res) => res.redirect(301, `/market/appliances${req.params[0] || ''}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`));
  router.get('/robots.txt', wrap(robots));
  router.get('/sitemap.xml', wrap(sitemap));
  if (!dist) return router;

  const send = (build) =>
    wrap(async (req, res, next) => {
      const page = await build(req);
      if (!page) return next(); // unknown address: the app's own "not found" handling
      const html = render(dist, page);
      if (!html) return next();
      res.status(page.status || 200).set('Cache-Control', 'no-cache').type('html').send(html);
    });

  router.get('/', send(homePage));
  router.get('/market', (req, res) => res.redirect(301, '/')); // the marketplace home is the site's home
  router.get('/market/search', send(searchPage));
  const importsPage = async (req) => {
    const site = store();
    const { getOrigin } = require('./origins');
    const origin = req.params.origin ? getOrigin(req.params.origin) : null;
    if (req.params.origin && !origin) return null;
    const rr = await market().runSearch({ ...req.query, ...(origin ? { origin: origin.key } : { imported: '1' }), limit: 24 });
    const what = origin ? (origin.key === 'local' ? 'Made in Kenya goods' : `${origin.label} in Kenya`) : 'Imported goods in Kenya';
    return {
      site,
      title: origin ? `${what}: buy & sell online | ${site}` : `${what}: ex-UK, China, Europe, USA, Japan & Dubai imports | ${site}`,
      description: clip(`${rr.total} ads for ${what.toLowerCase()}: phones, TVs, laptops, furniture, clothes, car parts and more. Chat with sellers or buy online with M-Pesa.`, 160),
      canonical: abs(req, origin ? `/imports/${origin.key}` : '/imports'),
      noindex: Object.keys(req.query).length > 0,
      body: `<h1>${esc(what)}</h1>${searchForm()}<ul>${rr.items.map(adLine).join('')}</ul>`,
    };
  };
  router.get('/imports', send(importsPage));
  router.get('/imports/:origin', send(importsPage));
  router.get('/wholesale', send(async (req) => {
    const site = store();
    const rr = await market().runSearch({ ...req.query, wholesale: '1', limit: 24 });
    return {
      site,
      title: `Wholesale & bulk deals in Kenya: buy in bulk at jumla prices | ${site}`,
      description: clip(`${rr.total} wholesale ads: cartons, bales, crates and bulk packs of packaging, flour, cooking oil, drinks, detergents, stationery and more at bei ya jumla. Order online with M-Pesa or cash on delivery.`, 160),
      canonical: abs(req, '/wholesale'),
      noindex: Object.keys(req.query).length > 0,
      body: `<h1>Wholesale &amp; bulk deals in Kenya</h1><p>Buy in bulk at jumla prices from wholesalers across Kenya.</p>${searchForm()}<ul>${rr.items.map(adLine).join('')}</ul>`,
    };
  }));
  router.get('/market/item/:slug', send((req) => itemPage(req, req.params.slug)));
  router.get('/market/seller/:id', send((req) => sellerPage(req, req.params.id)));
  router.get(['/market/sell', '/market/edit/:id', '/market/my', '/market/messages', '/market/messages/:id', '/orders', '/orders/:id', '/sales', '/sales/:id', '/checkout', '/account', '/login', '/signup', '/forgot-password', '/reset-password'], send((req) => privatePage(req, 'My account')));
  router.get('/wholesalers-near-me', send((req) => ({ ...privatePage(req, 'Wholesalers near you'), noindex: false, title: `Wholesalers near you in Kenya: bei ya jumla shops on Google Maps | ${store()}`, description: `Find wholesalers and bulk suppliers near you on ${store()}: cartons, bales and crates at wholesale prices, with distance and Google Maps directions.`, canonical: abs(req, '/wholesalers-near-me'), body: '<h1>Wholesalers near you</h1><p>Wholesale shops around you, with bulk prices, distance and directions.</p>' })));
  const nearPage = (path, h1, title, description) => send((req) => ({ ...privatePage(req, h1), noindex: false, title: `${title} | ${store()}`, description, canonical: abs(req, path), body: `<h1>${esc(h1)}</h1><p>${esc(description)}</p>` }));
  router.get('/boutiques-near-me', nearPage('/boutiques-near-me', 'Boutiques near you', 'Boutiques near you in Kenya: clothes shops on Google Maps', `Find boutiques and clothes shops near you on ${store()}: dresses, shirts, suits, shoes and watches, with distance, directions and walking delivery.`));
  router.get('/boutiques-near-me/men', nearPage('/boutiques-near-me/men', 'Men’s boutiques near you', 'Men’s boutiques near you: shirts, suits, shoes & watches', `Men’s wear shops near you on ${store()}: shirts, t-shirts, suits, jeans, shoes and watches, with distance and directions.`));
  router.get('/boutiques-near-me/women', nearPage('/boutiques-near-me/women', 'Women’s boutiques near you', 'Women’s boutiques near you: dresses, heels & handbags', `Ladies’ boutiques near you on ${store()}: dresses, tops, skirts, kitenge, heels, handbags and jewellery, with distance and directions.`));
  router.get('/mama-mboga-near-me', nearPage('/mama-mboga-near-me', 'Mama mboga near you', 'Mama mboga near me: fresh vegetables, fruit & eggs', `Find mama mbogas and market traders near you on ${store()}: sukuma wiki, tomatoes, onions, fruit and eggs, with walking delivery from stalls close by.`));
  router.get('/markets-near-me', nearPage('/markets-near-me', 'Markets near you', 'Markets near you in Kenya: Gikomba, Wakulima, Toi & more', `Find markets near you on ${store()} and the traders who sell there: Gikomba, Wakulima (Marikiti), Toi, Kongowea and more, with directions.`));
  // 🛵 Ride with us (it replaced Shop & ride: the old address moves here permanently, so search engines follow)
  router.get('/ride-with-us', nearPage('/ride-with-us', 'Ride with us: parcel delivery in Nairobi', 'Parcel delivery in Nairobi by bike, 4-seater car or pickup: price upfront', `Send a parcel anywhere in Nairobi with ${store()}: choose a bike, a 4-seater car or a pickup, see the price before you book (standard ride-hailing rates), and the nearest rider collects it. Track your rider live and pay on delivery with cash or M-Pesa.`));
  router.get('/shop-and-ride', (req, res) => res.redirect(301, '/ride-with-us'));
  router.get('/work', nearPage('/work', 'Ride or shop with us', 'Boda riders & shopping agents: earn on every job', `Join ${store()}’s field team: deliver orders as a rider, or become a shopping agent and check items at shops and markets for buyers. Jobs near you, pay shown upfront, paid to your M-Pesa after every job.`));
  router.get('/chemists-near-me', nearPage('/chemists-near-me', 'Chemists near you', 'Chemists near me: licensed pharmacies open now', `Find licensed chemists near you on ${store()}: checked by our team, with opening and closing times, “open now”, medicines and directions.`));
  router.get('/electronics-shops-near-me', nearPage('/electronics-shops-near-me', 'Electronics shops near you', 'Electronics shops near me: phones, TVs & laptops', `Electronics shops near you on ${store()}: phones, laptops, TVs, speakers and accessories, with distance and directions.`));
  router.get('/spare-parts-shops-near-me', nearPage('/spare-parts-shops-near-me', 'Spare parts shops near you', 'Spare parts shops near me: car, boda & machine parts', `Spare parts shops near you on ${store()}: car, motorbike, truck and machinery parts, with distance and directions.`));
  router.get('/baby-shops-near-me', nearPage('/baby-shops-near-me', 'Baby shops near you', 'Baby shops near me: strollers, diapers, toys & clothes', `Baby shops near you on ${store()}: strollers, cots, diapers, feeding, toys and kids’ clothes, with distance and directions.`));
  router.get('/importers-near-me', nearPage('/importers-near-me', 'Importers near you', 'Importers near me: ex-Japan, ex-UK & Dubai goods', `Shops near you on ${store()} selling imported goods: ex-Japan and ex-UK spare parts, Dubai and China electronics, ex-UK household items.`));
  router.get('/groceries-near-me', nearPage('/groceries-near-me', 'Cereals & groceries near you', 'Groceries near me: cereals, flour, oil & sugar', `Grocery and cereal shops near you on ${store()}: rice, beans, flour, cooking oil, sugar, drinks and soap, retail and wholesale.`));
  router.get('/fashion', nearPage('/fashion', 'Fashion', 'Fashion in Kenya: dresses, shirts, shoes & watches', `Shop clothes by type on ${store()}: dresses, shirts, t-shirts, suits, jeans, kitenge, heels, sneakers, watches and jewellery, new and mtumba.`));
  router.get('/markets/:slug', send(async (req) => {
    const match = await require('../models/Market').findOne({ slug: String(req.params.slug).slice(0, 80), approved: true }).lean();
    if (!match) return { ...privatePage(req, 'Market'), status: 404 };
    const where = [match.area, match.county].filter(Boolean).join(', ');
    const desc = `${match.name} in ${where}: ${match.about || 'a market'} See the mama mbogas and traders who sell here on ${store()}, their prices and directions.`;
    return { ...privatePage(req, match.name), noindex: false, title: `${match.name}, ${match.county}: traders & mama mbogas | ${store()}`, description: desc, canonical: abs(req, `/markets/${match.slug}`), body: `<h1>${esc(match.name)}</h1><p>${esc(desc)}</p>`,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'Place', name: match.name, address: { '@type': 'PostalAddress', addressLocality: match.area || match.county, addressRegion: match.county, addressCountry: 'KE' }, geo: { '@type': 'GeoCoordinates', latitude: match.point.coordinates[1], longitude: match.point.coordinates[0] } }] };
  }));
  router.get('/sellers-near-me', send((req) => ({ ...privatePage(req, 'Sellers near you'), noindex: false, title: `Sellers near you in Kenya: shops on Google Maps | ${store()}`, description: `Find sellers and shops near you on ${store()}: see how far they are, get directions on Google Maps and chat before you buy.`, canonical: abs(req, '/sellers-near-me'), body: '<h1>Sellers near you</h1><p>Find shops around you with distance and directions.</p>' })));
  router.get('/about', send((req) => {
    const about = `${store()} is a Kenyan marketplace to buy and sell anything, pay safely with mobile banking (safe mobile payment guaranteed) and get it delivered by trained, ID-checked riders. Free ads, wholesale prices and importers, Shop & ride inspection, Safe deal verification and Lipa Pole Pole.`;
    return {
      ...privatePage(req, `About ${store()}`), noindex: false, title: `About ${store()}: Kenya’s marketplace you can trust`, description: about.slice(0, 160),
      body: `<h1>About ${esc(store())}</h1><p>${esc(about)}</p><h2>What we do</h2><ul><li>Buy and sell anything, free ads</li><li>Pay safely with M-Pesa or cash on delivery</li><li>Delivery by trained riders with live tracking</li><li>Ride with us: parcel delivery anywhere in Nairobi by bike, 4-seater car or pickup, priced upfront</li><li>Safe deal verification for second-hand items</li><li>Wholesale prices and importers</li><li>Lipa Pole Pole: pay bit by bit</li><li>Smart AI search in English and Kiswahili</li></ul>`,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'Organization', name: store(), url: abs(req, '/'), areaServed: 'KE', description: about }],
    };
  }));
  router.get('/contact', send((req) => {
    const info = require('../config/site').site();
    const socials = Object.values(info.social || {}).filter(Boolean);
    const phone = String(info.phone || '').replace(/\D/g, '').replace(/^254/, '0');
    const lines = [phone && `Phone: ${phone}`, info.email && `Email: ${info.email}`, info.address && `Visit us: ${info.address}`].filter(Boolean);
    const about = `Contact ${store()}: ${lines.join(' · ')}. Live chat and WhatsApp support, and follow us on social media.`;
    return {
      ...privatePage(req, `Contact ${store()}`), noindex: false, title: `Contact ${store()}: phone, email & social media`, description: about.slice(0, 160),
      body: `<h1>Contact ${esc(store())}</h1><ul>${lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>${socials.length ? `<h2>Follow us</h2><ul>${socials.map((url) => `<li><a href="${esc(url)}">${esc(url)}</a></li>`).join('')}</ul>` : ''}`,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'Organization', name: store(), url: abs(req, '/'), areaServed: 'KE', sameAs: socials, contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'KE', ...(phone ? { telephone: `+254${phone.slice(1)}` } : {}), ...(info.email ? { email: info.email } : {}) }] }],
    };
  }));
  router.get('/help', send((req) => ({ ...privatePage(req, 'Help & contact'), noindex: false, description: `Get help with buying and selling on ${store()}: contact us, live chat and safety tips.`, body: `<h1>Help &amp; contact</h1>` })));
  router.get('/market/:cat', send((req) => categoryPage(req, req.params.cat)));
  router.get('/market/:cat/:sub', send((req) => categoryPage(req, req.params.cat, req.params.sub)));
  return router;
}

module.exports = { seoRouter, appPage };
