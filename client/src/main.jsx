import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import toast, { Toaster, ToastBar } from 'react-hot-toast';
import Swipeable from './shop/Swipeable';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { loadStoreInfo } from './shop/storeInfo';
import './index.css';
import { preloadRoute } from './App';
import { startPwa } from './pwa';
import { setupNativeShell } from './platform';

startPwa(); // installable app + works on a weak connection (production only)

// photos through the image CDN: if one can't load from it (the CDN can't reach us, a slow moment…), load it from us instead
window.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.cdnFallback) return;
  const src = img.currentSrc || img.src || '';
  if (!src.startsWith('https://wsrv.nl/')) return;
  try {
    const original = new URL(new URL(src).searchParams.get('url'));
    img.dataset.cdnFallback = '1';
    img.removeAttribute('srcset');
    img.src = `${import.meta.env.VITE_API_URL ? new URL(import.meta.env.VITE_API_URL).origin : ''}${original.pathname}`;
  } catch { /* leave it */ }
}, true);
setupNativeShell(); // Android app: back button, token storage (does nothing on the web)

const root = ReactDOM.createRoot(document.getElementById('root'));

// Load the marketplace's name and contacts first (the page shows the server's ready-made version meanwhile),
// then start the app. Offline still starts: pages show their own connection errors and recover on reload.
preloadRoute(window.location.pathname); // fetch this page's code while the app starts
loadStoreInfo().then(() => {
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster position="top-center" containerStyle={{ zIndex: 2147483000 }} toastOptions={{ style: { maxWidth: 420 } }}>
            {/* every pop-up can be swiped left or right, or closed with ✕ */}
            {(shown) => (
              <Swipeable className="os-toast-swipe" closeButton={false} onDismiss={() => toast.dismiss(shown.id)}>
                <ToastBar toast={shown}>
                  {({ icon, message }) => (
                    <>
                      {icon}
                      {message}
                      {shown.type !== 'loading' && (
                        <button type="button" className="os-toast-x" aria-label="Close" onClick={() => toast.dismiss(shown.id)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      )}
                    </>
                  )}
                </ToastBar>
              </Swipeable>
            )}
          </Toaster>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
});
