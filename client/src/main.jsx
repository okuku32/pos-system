import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { loadStoreInfo, STORE_INFO } from './shop/storeInfo';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));

function Blocked({ icon, title, message }) {
  return (
    <div className="center-screen">
      <div className="card login center" style={{ maxWidth: 440 }}>
        <div style={{ fontSize: 44 }}>{icon}</div>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
      </div>
    </div>
  );
}

const renderApp = () =>
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );

// The platform console (/platform) works on any address; every other page belongs to one client,
// so load that client's details (name, location...) first.
if (window.location.pathname.startsWith('/platform')) {
  document.title = 'Platform console';
  renderApp();
} else {
  loadStoreInfo().then((r) => {
    if (r.status === 'suspended') return root.render(<Blocked icon="⏸️" title="Account suspended" message={r.message} />);
    if (r.status === 'unknown') return root.render(<Blocked icon="🔍" title="Shop not found" message={`${r.message}. Check the web address.`} />);
    document.title = STORE_INFO.name;
    renderApp(); // 'offline' still renders: pages show their own connection errors and recover on reload
  });
}
