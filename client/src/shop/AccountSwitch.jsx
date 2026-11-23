// 🔁 One account, every role: switch between buying, selling and riding (or shopping agent / partner shop)
// in one tap: from the account menu, the ☰ menu, and the top of each dashboard.
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useShop } from './ShopContext';
import { errMsg } from './shopApi';

const WORK = {
  rider: { icon: '🏍️', label: 'Rider', hint: 'Deliveries & earnings' },
  agent: { icon: '🧺', label: 'Shopping agent', hint: 'Jobs & earnings' },
  partner: { icon: '🛡️', label: 'Partner shop', hint: 'Items to verify' },
};
const SELL_PATHS = ['/sales', '/market/my', '/market/sell', '/seller-tools'];

// which dashboard the person is on now
export function modeOf(pathname) {
  if (SELL_PATHS.some((path) => pathname.startsWith(path))) return 'sell';
  if (pathname.startsWith('/work')) return 'work';
  if (['/orders', '/deliveries', '/errands'].some((path) => pathname.startsWith(path))) return 'buy';
  return '';
}

export default function AccountSwitch({ variant = 'menu', onGo }) {
  const { customer, counts = {}, setAccountType } = useShop();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!customer) return null;
  const now = modeOf(pathname);
  const seller = customer.accountType === 'seller';
  const worker = customer.worker?.role ? { ...WORK[customer.worker.role], status: customer.worker.status } : null;
  const go = async (mode) => {
    onGo?.();
    if (mode === 'buy') return navigate('/orders');
    if (mode === 'work') return navigate('/work');
    if (!seller) {
      try {
        await setAccountType('seller'); // a buyer starts selling: their seller dashboard is switched on
        toast.success('Seller dashboard on. Post your first ad!');
      } catch (error) {
        toast.error(errMsg(error));
        return undefined;
      }
    }
    return navigate('/sales');
  };
  const items = [
    { key: 'buy', icon: '🛍️', label: 'Buyer', hint: 'My orders & deliveries' },
    { key: 'sell', icon: '🏪', label: 'Seller', hint: seller ? 'Sales, ads & payouts' : 'Start selling, free', badge: counts.toHandle, join: !seller },
    worker
      ? { key: 'work', icon: worker.icon, label: worker.label, hint: worker.status === 'approved' ? worker.hint : worker.status === 'pending' ? 'Application being checked' : 'See your status' }
      : { key: 'work', icon: '🏍️', label: 'Rider', hint: 'Earn: ride or shop with us', join: true },
  ];
  return (
    <nav className={`os-switch os-switch-${variant}`} aria-label="Switch dashboard">
      {variant === 'bar' && <span className="os-switch-label">Switch to</span>}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`${now === item.key ? 'on' : ''} ${item.join ? 'join' : ''}`}
          aria-current={now === item.key ? 'page' : undefined}
          onClick={() => go(item.key)}
        >
          <span className="os-switch-icon" aria-hidden="true">{item.icon}</span>
          <span className="os-switch-text">
            <b>{item.join ? `+ ${item.label}` : item.label}</b>
            {variant !== 'bar' && <small>{item.hint}</small>}
          </span>
          {item.badge > 0 && <i className="os-switch-badge">{item.badge}</i>}
        </button>
      ))}
    </nav>
  );
}
