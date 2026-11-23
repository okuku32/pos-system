// The front page ("/"): visitors who haven't signed up first meet Kapu (who we are, what we do) with an invitation
// to join before the official launch. Signed-in members, and visitors who chose "Explore the marketplace", get the
// marketplace home. The choice is remembered on this device.
import { useState } from 'react';
import { useShop } from './ShopContext';
import { browsing, rememberBrowse } from './browse';

// both are part of this page's code (no second wait after the landing itself has loaded: the front page shows sooner)
import AboutPage from './AboutPage';
import MarketHome from '../market/MarketHome';

export default function Landing() {
  const { ready, customer } = useShop();
  const [browse, setBrowse] = useState(browsing);
  const loading = <div className="page-loading" role="status" aria-label="Loading"><span className="page-spinner" /></div>;
  if (!ready) return loading;
  const explore = () => {
    rememberBrowse();
    setBrowse(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return !customer && !browse ? <AboutPage launch onExplore={explore} /> : <MarketHome />;
}
