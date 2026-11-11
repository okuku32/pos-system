// Search-engine friendly pages for the marketplace.
//
// The app is a React single-page app, so on its own every address would return the same empty page.
// This router answers marketplace (and shop) addresses with the built index.html PLUS, for that exact page:
//   - a unique <title>, meta description and canonical address
//   - Open Graph / Twitter tags (rich previews when a link is shared on WhatsApp, Facebook, X...)
//   - JSON-LD structured data (Product + Offer, Car, BreadcrumbList, ItemList, WebSite search box)
//   - the page's real content as plain HTML inside #root (headings, prices, links to every ad),
//     readable by any crawler without running JavaScript; React replaces it as soon as the app starts.
// Also serves /robots.txt and /sitemap.xml (every category, make and ad, updated automatically).
const fs = require('fs');
const path = require('path');
const express = require('express');
const { resolveTenant, requestHost, settings } = require('../tenancy/tenants');
const { runAsTenant } = require('../tenancy/context');
const { cached } = require('../utils/cache');
const Listing = require('../models/Listing');
const { CATEGORIES, COUNTIES, getCategory, getSub, fieldsFor } = require('./categories');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ksh = (n) => (n > 0 ? `KSh ${Number(n).toLocaleString('en-KE')}` : 'Contact for price');
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
};
const store = () => {
  try {
    return settings().storeName || 'Ordersasa';
  } catch {
    return 'Ordersasa';
  }
};
const baseUrl = (req) => `${req.protocol}://${requestHost(req) || 'localhost'}`;
const abs = (req, p) => (/^https?:/.test(p) ? p : `${baseUrl(req)}${p}`);

// ---------------------------------------------------------------- page template (built index.html)
let template = null;
let templateTime = 0;
function readTemplate(dist) {
  const file = path.join(dist, 'index.html');
  try {
    const t = fs.statSync(file).mtimeMs;
    if (!template || t !== templateTime) {
      template = fs.readFileSync(file, 'utf8');
      templateTime = t;
    }
  } catch {
    template = null;
  }
  return template;
}

const SNAP_CSS = `<style id="seo-snap-css">.seo-snap{font-family:'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,sans-serif;max-width:1100px;margin:0 auto;padding:18px 16px 40px;color:#14171f;background:#faf8f5;line-height:1.5}.seo-snap a{color:#e2440c}.seo-snap h1{font-size:26px;margin:8px 0 12px}.seo-snap h2{font-size:18px;margin:22px 0 8px}.seo-snap ul{padding-left:18px}.seo-snap li{margin:4px 0}.seo-snap nav{font-size:13px;color:#6b7280}.seo-snap .p{font-weight:800;font-size:20px;color:#e2440c}.seo-snap img{max-width:100%;height:auto;border-radius:14px}.seo-snap dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px}.seo-snap dt{color:#6b7280}.seo-snap form{display:flex;gap:6px;margin:10px 0}.seo-snap input{flex:1;padding:10px;border:1px solid #ddd;border-radius:10px}</style>`;

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
  ].filter(Boolean).join('\n    ');
  return tpl
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(page.description)}" />`)
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><div class="seo-snap">${page.body || ''}</div></div>`);
}

// ---------------------------------------------------------------- shared bits
const crumbsHtml = (items) => `<nav aria-label="Breadcrumb">${items.map((c, i) => (i < items.length - 1 ? `<a href="${esc(c.href)}">${esc(c.name)}</a> › ` : esc(c.name))).join('')}</nav>`;
const crumbsLd = (req, items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(req, c.href) })),
});
const adLine = (a) => `<li><a href="/market/item/${esc(a.slug)}">${esc(a.title)}</a> · <b>${esc(ksh(a.price))}</b>${a.negotiable ? ' (negotiable)' : ''} · ${esc([a.area, a.county].filter(Boolean).join(', '))}</li>`;
const searchForm = (q = '') => `<form action="/market/search" method="get" role="search"><input name="q" value="${esc(q)}" placeholder="Search cars, land, phones, furniture…" aria-label="Search the marketplace"><button>Search</button></form>`;
const catLinks = (counts) => `<ul>${CATEGORIES.map((c) => `<li><a href="/market/${c.slug}">${esc(c.name)}</a> (${counts[c.slug]?.total || 0} ads): ${c.subs.map((s) => `<a href="/market/${c.slug}/${s.slug}">${esc(s.name)}</a>`).join(', ')}</li>`).join('')}</ul>`;

// ---------------------------------------------------------------- pages
const market = () => require('../controllers/marketController');

async function homePage(req) {
  const site = store();
  const [counts, latest] = await Promise.all([
    market().countsByCategory(),
    Listing.find({ status: 'active' }).sort({ createdAt: -1 }).limit(30).select('slug title price negotiable county area').lean(),
  ]);
  const total = Object.values(counts).reduce((a, c) => a + c.total, 0);
  const title = `${site} Marketplace: buy & sell cars, land, phones, furniture and more in Kenya`;
  const description = clip(`Kenya’s easy marketplace: ${total.toLocaleString('en-KE')} ads for vehicles, land & plots, electronics, furniture, beddings, spare parts, clothes, beauty, liquor and more. Search, chat with sellers and buy safely on ${site}.`, 160);
  return {
    site, title, description, canonical: abs(req, '/market'),
    jsonLd: [
      {
        '@context': 'https://schema.org', '@type': 'WebSite', name: `${site} Marketplace`, url: abs(req, '/market'),
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: abs(req, '/market/search?q={search_term_string}') }, 'query-input': 'required name=search_term_string' },
      },
      { '@context': 'https://schema.org', '@type': 'Organization', name: site, url: baseUrl(req), logo: abs(req, '/favicon.svg') },
    ],
    body: `<h1>${esc(site)} Marketplace: buy and sell anything in Kenya</h1>
      <p>${esc(description)}</p>${searchForm()}
      <h2>Browse categories</h2>${catLinks(counts)}
      <h2>Latest ads</h2><ul>${latest.map(adLine).join('')}</ul>
      <p><a href="/market/sell">Post a free ad</a> · <a href="/shop">${esc(site)} shop: groceries delivered</a></p>`,
  };
}

async function categoryPage(req, catSlug, subSlug) {
  const site = store();
  const cat = getCategory(catSlug);
  const sub = subSlug ? getSub(catSlug, subSlug) : null;
  if (!cat || (subSlug && !sub)) return null;
  const q = req.query;
  const make = typeof q.make === 'string' ? q.make.slice(0, 40) : '';
  const model = typeof q.model === 'string' ? q.model.slice(0, 40) : '';
  const county = COUNTIES.includes(q.county) ? q.county : '';
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const r = await market().runSearch({ ...q, category: cat.slug, sub: sub?.slug, make, model, county, page, limit: 24 });

  const what = [make, model, sub ? sub.name : cat.name].filter(Boolean).join(' ');
  const heading = /for (sale|rent|lease)/i.test(what) ? what : `${what} for sale`; // no "for sale for sale"
  const where = county ? `in ${county}` : 'in Kenya';
  const title = `${heading} ${where}${page > 1 ? ` (page ${page})` : ''} | ${site}`;
  const prices = r.items.map((a) => a.price).filter((p) => p > 0);
  const range = prices.length ? ` Prices from ${ksh(Math.min(...prices))}.` : '';
  const description = clip(`${r.total.toLocaleString('en-KE')} ${what.toLowerCase()} ads ${where}.${range} ${cat.blurb} Chat with sellers directly on ${site}.`, 160);

  // canonical keeps only the parts that make this a distinct page (make, model, county, page)
  const keep = new URLSearchParams();
  if (make) keep.set('make', make);
  if (model) keep.set('model', model);
  if (county) keep.set('county', county);
  const basePath = `/market/${cat.slug}${sub ? `/${sub.slug}` : ''}`;
  const withPage = (p) => {
    const u = new URLSearchParams(keep);
    if (p > 1) u.set('page', p);
    const s = u.toString();
    return abs(req, `${basePath}${s ? `?${s}` : ''}`);
  };
  const otherFilters = Object.keys(q).some((k) => !['make', 'model', 'county', 'page'].includes(k));

  const crumbs = [{ name: 'Marketplace', href: '/market' }, { name: cat.name, href: `/market/${cat.slug}` }];
  if (sub) crumbs.push({ name: sub.name, href: basePath });
  if (make) crumbs.push({ name: [make, model].filter(Boolean).join(' '), href: withPage(1).replace(baseUrl(req), '') });

  const makeField = sub && fieldsFor(cat.slug, sub.slug).find((f) => f.type === 'make');
  const makes = makeField ? Object.keys(makeField.makes).filter((m) => m !== 'Other') : [];
  return {
    site, title, description,
    canonical: withPage(page),
    noindex: otherFilters || r.total === 0, // filtered or empty pages: let Google follow links but not index them
    prev: page > 1 ? withPage(page - 1) : null,
    next: page < r.pages ? withPage(page + 1) : null,
    jsonLd: [
      crumbsLd(req, crumbs),
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: `${heading} ${where}`, numberOfItems: r.total,
        itemListElement: r.items.map((a, i) => ({ '@type': 'ListItem', position: (page - 1) * 24 + i + 1, url: abs(req, `/market/item/${a.slug}`), name: a.title })),
      },
    ],
    body: `${crumbsHtml(crumbs)}<h1>${esc(heading)} ${esc(where)}</h1>
      <p>${esc(description)}</p>${searchForm()}
      ${!sub ? `<h2>${esc(cat.name)} categories</h2><ul>${cat.subs.map((s) => `<li><a href="/market/${cat.slug}/${s.slug}">${esc(s.name)}</a></li>`).join('')}</ul>` : ''}
      ${makes.length && !make ? `<h2>Popular makes</h2><p>${makes.map((m) => `<a href="${basePath}?make=${encodeURIComponent(m)}">${esc(m)} ${esc(sub.name.toLowerCase())}</a>`).join(' · ')}</p>` : ''}
      ${make && makeField?.makes[make]?.length && !model ? `<h2>${esc(make)} models</h2><p>${makeField.makes[make].map((m) => `<a href="${basePath}?make=${encodeURIComponent(make)}&amp;model=${encodeURIComponent(m)}">${esc(make)} ${esc(m)}</a>`).join(' · ')}</p>` : ''}
      <h2>${r.total.toLocaleString('en-KE')} ads</h2><ul>${r.items.map(adLine).join('')}</ul>
      <p>${page > 1 ? `<a href="${esc(withPage(page - 1))}">‹ Previous page</a> ` : ''}${page < r.pages ? `<a href="${esc(withPage(page + 1))}">Next page ›</a>` : ''}</p>
      <h2>Browse by county</h2><p>${COUNTIES.slice(0, 12).map((c) => `<a href="${basePath}?county=${encodeURIComponent(c)}">${esc(c)}</a>`).join(' · ')}</p>`,
  };
}

async function searchPage(req) {
  const site = store();
  const q = String(req.query.q || '').slice(0, 100);
  const r = await market().runSearch({ ...req.query, limit: 24 });
  const title = q ? `${q}: ${r.total} ads for sale in Kenya | ${site}` : `Search the ${site} marketplace`;
  return {
    site, title, description: clip(`${r.total} results for “${q}” on the ${site} marketplace. Compare prices and chat with sellers.`, 160),
    canonical: abs(req, `/market/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    noindex: true, // search results pages are not indexed (Google's guidelines); the ads themselves are
    body: `<h1>${esc(q ? `Results for “${q}”` : 'Search the marketplace')}</h1>${searchForm(q)}<ul>${r.items.map(adLine).join('')}</ul>`,
  };
}

async function itemPage(req, slug) {
  const site = store();
  const found = await market().loadPublicListing(slug);
  if (!found) {
    return {
      status: 404, site, title: `Ad not found | ${site}`, description: 'This ad has been removed or sold.', canonical: abs(req, '/market'), noindex: true,
      body: `<h1>This ad is no longer available</h1><p><a href="/market">Browse the marketplace</a></p>${searchForm()}`,
    };
  }
  const { l } = found;
  const cat = getCategory(l.category);
  const sub = getSub(l.category, l.sub);
  const where = [l.area, l.county].filter(Boolean).join(', ');
  const title = `${l.title}${l.price > 0 ? ` – ${ksh(l.price)}` : ''} | ${where} | ${site}`;
  const description = clip(`${l.status === 'sold' ? 'SOLD. ' : ''}${ksh(l.price)}${l.negotiable ? ' (negotiable)' : ''} · ${where}. ${l.description}`, 160);
  const fields = fieldsFor(l.category, l.sub);
  const facts = fields.filter((f) => l.attrs?.[f.key] !== undefined && l.attrs[f.key] !== '').map((f) => [f.label, l.attrs[f.key]]);
  if (l.condition) facts.unshift(['Condition', l.condition]);
  const images = (l.images || []).map((u) => abs(req, u));
  const crumbs = [{ name: 'Marketplace', href: '/market' }, { name: cat?.name || 'Ads', href: `/market/${l.category}` }, { name: sub?.name || '', href: `/market/${l.category}/${l.sub}` }, { name: l.title, href: `/market/item/${l.slug}` }];

  const a = l.attrs || {};
  const isCar = l.category === 'vehicles';
  const product = {
    '@context': 'https://schema.org',
    '@type': isCar ? ['Product', 'Car'] : 'Product',
    name: l.title,
    description: clip(l.description, 5000),
    sku: String(l._id),
    category: [cat?.name, sub?.name].filter(Boolean).join(' > '),
    ...(images.length ? { image: images } : {}),
    ...(a.make || a.brand ? { brand: { '@type': 'Brand', name: a.make || a.brand } } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(isCar && a.year ? { vehicleModelDate: String(a.year) } : {}),
    ...(isCar && a.mileage ? { mileageFromOdometer: { '@type': 'QuantitativeValue', value: a.mileage, unitCode: 'KMT' } } : {}),
    ...(isCar && a.transmission ? { vehicleTransmission: a.transmission } : {}),
    ...(isCar && a.fuel ? { fuelType: a.fuel } : {}),
    ...(a.colour ? { color: a.colour } : {}),
    offers: {
      '@type': 'Offer',
      url: abs(req, `/market/item/${l.slug}`),
      priceCurrency: 'KES',
      ...(l.price > 0 ? { price: l.price } : {}),
      availability: l.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      itemCondition: /new/i.test(l.condition || '') && !/used/i.test(l.condition || '') ? 'https://schema.org/NewCondition' : /refurb/i.test(l.condition || '') ? 'https://schema.org/RefurbishedCondition' : l.condition ? 'https://schema.org/UsedCondition' : undefined,
      areaServed: { '@type': 'Place', name: `${where}, Kenya` },
      seller: { '@type': 'Person', name: l.sellerName || 'Seller' },
    },
  };
  const similar = await market().similarTo(l, 10);
  return {
    site, title, description, canonical: abs(req, `/market/item/${l.slug}`), image: images[0], ogType: 'product',
    jsonLd: [product, crumbsLd(req, crumbs)],
    body: `${crumbsHtml(crumbs)}<article><h1>${esc(l.title)}</h1>
      <p class="p">${esc(ksh(l.price))}${l.negotiable ? ' · negotiable' : ''}${l.status === 'sold' ? ' · SOLD' : ''}</p>
      <p>📍 ${esc(where)} · Posted ${new Date(l.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} by <a href="/market/seller/${esc(l.seller)}">${esc(l.sellerName || 'the seller')}</a></p>
      ${images[0] ? `<img src="${esc(images[0])}" alt="${esc(l.title)}" width="640" height="480">` : ''}
      ${facts.length ? `<h2>Details</h2><dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      <h2>Description</h2><p>${esc(l.description).replace(/\n/g, '<br>')}</p></article>
      ${similar.length ? `<h2>Similar ${esc(sub?.name?.toLowerCase() || 'ads')}</h2><ul>${similar.map(adLine).join('')}</ul>` : ''}`,
  };
}

async function sellerPage(req, id) {
  const site = store();
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const Customer = require('../models/Customer');
  const c = await Customer.findById(id).select('name').lean();
  if (!c) return null;
  const items = await Listing.find({ seller: id, status: 'active' }).sort({ createdAt: -1 }).limit(60).select('slug title price negotiable county area').lean();
  return {
    site, title: `${c.name}’s ads on ${site} (${items.length})`, description: clip(`See all ${items.length} ads posted by ${c.name} on the ${site} marketplace.`, 160),
    canonical: abs(req, `/market/seller/${id}`), noindex: items.length === 0,
    body: `<h1>Ads by ${esc(c.name)}</h1><ul>${items.map(adLine).join('')}</ul>`,
  };
}

function shopPage(req) {
  const site = store();
  return {
    site, title: `${site} Shop: groceries & household items delivered | Pay with M-Pesa`,
    description: clip(`Order groceries, drinks, snacks, dairy, bakery and household items from ${site}. Fast delivery or pickup, pay with M-Pesa or cash.`, 160),
    canonical: abs(req, '/shop'),
    body: `<h1>${esc(site)} Shop</h1><p>Groceries and household items delivered. <a href="/market">Visit the marketplace</a>.</p>`,
  };
}

const privatePage = (req, title) => ({ site: store(), title: `${title} | ${store()}`, description: `${title} on the ${store()} marketplace.`, canonical: abs(req, req.path), noindex: true, body: '' });

// ---------------------------------------------------------------- robots & sitemap
const PRIVATE_PATHS = ['/api/', '/platform', '/login', '/market/sell', '/market/edit', '/market/my', '/market/messages', '/shop/orders', '/shop/login', '/shop/signup', '/shop/forgot-password', '/shop/reset-password', '/track/', '/orders', '/sales', '/support', '/reports', '/dashboard', '/products', '/suppliers', '/purchases', '/expenses', '/users', '/settings', '/marketplace'];

function robots(req, res) {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600');
  res.send(`User-agent: *\nAllow: /\n${PRIVATE_PATHS.map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
}

async function sitemap(req, res) {
  const base = baseUrl(req);
  const xml = await cached(`market:sitemap:${base}`, 10 * 60 * 1000, async () => {
    const counts = await market().countsByCategory();
    const urls = [
      { loc: '/market', freq: 'hourly', pri: '1.0' },
      { loc: '/shop', freq: 'daily', pri: '0.8' },
    ];
    for (const c of CATEGORIES) {
      urls.push({ loc: `/market/${c.slug}`, freq: 'daily', pri: '0.8' });
      for (const s of c.subs) if (counts[c.slug]?.subs[s.slug]) urls.push({ loc: `/market/${c.slug}/${s.slug}`, freq: 'daily', pri: '0.7' });
    }
    // make and model pages that actually have ads ("Toyota Vitz cars for sale in Kenya")
    const mm = await Listing.aggregate([
      { $match: { status: 'active', 'attrs.make': { $exists: true, $ne: '' } } },
      { $group: { _id: { c: '$category', s: '$sub', make: '$attrs.make', model: '$attrs.model' } } },
      { $limit: 5000 },
    ]);
    const makesSeen = new Set();
    for (const { _id: k } of mm) {
      const mk = `/market/${k.c}/${k.s}?make=${encodeURIComponent(k.make)}`;
      if (!makesSeen.has(mk)) {
        makesSeen.add(mk);
        urls.push({ loc: mk, freq: 'daily', pri: '0.6' });
      }
      if (k.model) urls.push({ loc: `${mk}&model=${encodeURIComponent(k.model)}`, freq: 'daily', pri: '0.6' });
    }
    const ads = await Listing.find({ status: 'active' }).sort({ updatedAt: -1 }).limit(45000).select('slug updatedAt images').lean();
    for (const a of ads) urls.push({ loc: `/market/item/${a.slug}`, mod: a.updatedAt, freq: 'weekly', pri: '0.7', img: a.images?.[0] });
    const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url><loc>${x(base + u.loc)}</loc>${u.mod ? `<lastmod>${new Date(u.mod).toISOString()}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority>${u.img ? `<image:image><image:loc>${x(base + u.img)}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>`;
  });
  res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(xml);
}

// ---------------------------------------------------------------- router
// Runs each request as the right client (tenant), like the API does
const asTenant = (handler) => async (req, res, next) => {
  try {
    const t = await resolveTenant({ host: requestHost(req), headerTenant: req.headers['x-tenant'] });
    if (!t || t.unknown || t.status === 'suspended') return next(); // the app shows its own message
    await runAsTenant(t, () => handler(req, res, next));
  } catch (err) {
    next(err);
  }
};

function seoRouter(dist) {
  const r = express.Router();
  r.get('/robots.txt', asTenant(robots));
  r.get('/sitemap.xml', asTenant(sitemap));
  if (!dist) return r;

  const send = (build) =>
    asTenant(async (req, res, next) => {
      const page = await build(req);
      if (!page) return next(); // unknown address: the app's own "not found" handling
      const html = render(dist, page);
      if (!html) return next();
      res.status(page.status || 200).set('Cache-Control', 'no-cache').type('html').send(html);
    });

  r.get(['/', '/market'], send(homePage));
  r.get('/market/search', send(searchPage));
  r.get('/market/item/:slug', send((req) => itemPage(req, req.params.slug)));
  r.get('/market/seller/:id', send((req) => sellerPage(req, req.params.id)));
  r.get(['/market/sell', '/market/edit/:id', '/market/my', '/market/messages', '/market/messages/:id'], send((req) => privatePage(req, 'My marketplace')));
  r.get('/market/:cat', send((req) => categoryPage(req, req.params.cat)));
  r.get('/market/:cat/:sub', send((req) => categoryPage(req, req.params.cat, req.params.sub)));
  r.get('/shop', send(shopPage));
  return r;
}

module.exports = { seoRouter };
