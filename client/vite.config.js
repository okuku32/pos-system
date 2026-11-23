import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The Android app calls the live API by its full address, and only over HTTPS (set VITE_API_URL in .env.android).
function requireHttpsApi(mode) {
  if (mode !== 'android') return;
  const api = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL || '';
  if (!/^https:\/\/[^/\s]+\/api\/?$/.test(api)) {
    throw new Error(`Android build: set VITE_API_URL in client/.env.android to your live API over HTTPS, e.g. https://kapu.example.com/api (got "${api || 'nothing'}")`);
  }
}

// Without this, the shop's frame and the page are only asked for once the main code has downloaded and run (a chain
// of waits on a slow phone). This adds, to the built index.html, a tiny script that starts fetching them at once:
//   · every shop address: the frame (layout, header, cart…) and its stylesheets (not on the admin panel's addresses)
//   · "/": the welcome page (visitors) or the marketplace home (members / visitors who chose to browse)
//   · an item page (/market/item/…, the links people share): the item page
const SHOP_FRAME = ['src/shop/ShopLayout.jsx', 'src/shop/ShopContext.jsx'];
const PAGES = { welcome: ['src/shop/Landing.jsx', 'src/shop/AboutPage.jsx'], home: ['src/shop/Landing.jsx', 'src/market/MarketHome.jsx'], item: ['src/market/ListingPage.jsx'] };
// Runs inside the page (see `loader` below), as early as possible: asks the browser to start downloading the shop's frame
// and the page about to be shown, so they arrive in parallel instead of one after another.
//   frameFiles / pageFiles: { js: ['/assets/…'], css: ['/assets/…'] }, pageFiles per page: { welcome, home, item }
function startEarlyDownloads(documentObject, pagePath, frameFiles, pageFiles) {
  if (pagePath === '/admin' || pagePath.indexOf('/admin/') === 0 || pagePath.indexOf('/staff/') === 0) return; // staff panel: its own files
  // our Content-Security-Policy only lets in tags carrying this page's nonce: copy it from this script onto each <link>
  var nonce = (documentObject.currentScript && documentObject.currentScript.nonce) || '';
  var addLink = function (relation, address, contentType) {
    var link = documentObject.createElement('link');
    link.rel = relation;
    link.href = address;
    if (contentType) link.as = contentType;
    link.crossOrigin = ''; // the same mode the app's own imports use, so the browser reuses these downloads
    if (nonce) link.nonce = nonce;
    documentObject.head.appendChild(link);
  };
  var downloadFiles = function (files) {
    files.js.forEach(function (file) { addLink('modulepreload', file); });
    files.css.forEach(function (file) { addLink('preload', file, 'style'); });
  };
  var isFlagSet = function (storageKey) {
    try { return localStorage.getItem(storageKey) === '1'; } catch (storageError) { return false; }
  };
  downloadFiles(frameFiles);
  // "/" shows the marketplace to members (and visitors who chose to browse), the welcome page to everyone else
  if (pagePath === '/' || pagePath === '') downloadFiles(isFlagSet('kapu_signed_in') || isFlagSet('kapu_browse_market') ? pageFiles.home : pageFiles.welcome);
  else if (pagePath.indexOf('/market/item/') === 0) downloadFiles(pageFiles.item);
}

function preloadShopFrame() {
  return {
    name: 'kapu-preload-shop-frame',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const chunks = Object.values(ctx.bundle).filter((item) => item.type === 'chunk');
        const entry = chunks.find((item) => item.isEntry);
        const already = new Set([entry?.fileName, ...(entry?.imports || [])]);
        // the files (code + styles) of these source files and everything they import
        const filesOf = (sources, skip = new Set()) => {
          const js = new Set();
          const css = new Set();
          const visit = (fileName) => {
            const chunk = ctx.bundle[fileName];
            if (!chunk || chunk.type !== 'chunk' || js.has(fileName)) return;
            js.add(fileName);
            chunk.viteMetadata?.importedCss?.forEach((file) => css.add(file));
            chunk.imports.forEach(visit);
          };
          for (const chunk of chunks) {
            const id = (chunk.facadeModuleId || '').replace(/\\/g, '/');
            if (sources.some((file) => id.endsWith(file))) visit(chunk.fileName);
          }
          return { js: [...js].filter((file) => !already.has(file) && !skip.has(file)).map((file) => '/' + file), css: [...css].filter((file) => !skip.has(file)).map((file) => '/' + file) };
        };
        const frame = filesOf(SHOP_FRAME);
        const inFrame = new Set([...frame.js, ...frame.css].map((file) => file.slice(1)));
        const pages = Object.fromEntries(Object.entries(PAGES).map(([key, sources]) => [key, filesOf(sources, inFrame)]));
        if (!frame.js.length && !frame.css.length) return html;
        // The script is written as a normal function (readable, checked by the editor) and placed in the page as its
        // source text; the file lists are passed in as data. It must stay plain old JavaScript: it runs untranslated.
        const loader = `<script>(${startEarlyDownloads.toString()})(document, location.pathname, ${JSON.stringify(frame)}, ${JSON.stringify(pages)})</script>`;
        return html.replace('</head>', `    ${loader}\n  </head>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => (requireHttpsApi(mode), {
  plugins: [react(), preloadShopFrame()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
    allowedHosts: true, // lets the shop be opened through a tunnel such as ngrok
  },
}));
