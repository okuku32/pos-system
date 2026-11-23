import { Link } from 'react-router-dom';
import './market.css';

// Liquor ads are for adults only (Alcoholic Drinks Control Act): ask once, remembered on this device
export default function AdultGate({ onYes }) {
  return (
    <div className="mk mk-wrap">
      <div className="mk-gate" role="dialog" aria-labelledby="mk-gate-h">
        <div className="mk-gate-icon">🔞</div>
        <h1 id="mk-gate-h">Are you 18 or older?</h1>
        <p>Liquor ads are only for adults aged 18 and above. Sellers must hold a valid liquor licence, and you may be asked for ID on delivery.</p>
        <div className="os-row center">
          <Link to="/" className="os-btn os-btn-ghost">No, take me back</Link>
          <button className="os-btn os-btn-brand" onClick={onYes}>Yes, I’m 18+</button>
        </div>
        <small>Drink responsibly. Not for sale to persons under the age of 18.</small>
      </div>
    </div>
  );
}
