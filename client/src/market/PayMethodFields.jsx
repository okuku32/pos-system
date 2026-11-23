// How a seller gets paid by M-Pesa: Till (Buy Goods), Paybill + account, Pochi la Biashara or Send Money.
// Used when a seller signs up and in My account. The server checks it again (server/market/pay.js).
import './market.css';

export const PAY_WAYS = [['till', 'Till number', 'Buy Goods'], ['paybill', 'Paybill', 'Business + account no.'], ['pochi', 'Pochi la Biashara', 'Your Pochi phone'], ['phone', 'Send Money', 'Your M-Pesa phone']];
export const emptyPay = (phone = '', name = '') => ({ method: '', till: '', paybill: '', account: '', phone, name });

// what's still missing ('' when it's complete)
export function payMissing(pay) {
  const digits = (value) => String(value || '').replace(/\D/g, '');
  if (!pay?.method) return 'Choose how you get paid: Till, Paybill, Pochi la Biashara or Send Money';
  if (pay.method === 'till' && !/^\d{5,7}$/.test(digits(pay.till))) return 'Enter your M-Pesa Till number (5 to 7 digits)';
  if (pay.method === 'paybill' && !/^\d{5,7}$/.test(digits(pay.paybill))) return 'Enter your Paybill number (5 to 7 digits)';
  if (pay.method === 'paybill' && !String(pay.account || '').trim()) return 'Enter the Paybill account number';
  if ((pay.method === 'pochi' || pay.method === 'phone') && digits(pay.phone).length < 9) return 'Enter the M-Pesa phone number you get paid on';
  return '';
}

export default function PayMethodFields({ value, onChange, idPrefix = 'pay' }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  return (
    <>
      <div className="mk-choice mk-paydetails-ways" role="radiogroup" aria-label="How you get paid">
        {PAY_WAYS.map(([key, label, hint]) => (
          <label key={key} className={value.method === key ? 'on' : ''}><input type="radio" name={`${idPrefix}-method`} checked={value.method === key} onChange={() => onChange({ ...value, method: key })} /><span><b>{label}</b><small>{hint}</small></span></label>
        ))}
      </div>
      {value.method && (
        <div className="mk-form-grid mk-mt">
          {value.method === 'till' && <label className="os-field"><span>Till number *</span><input inputMode="numeric" value={value.till} onChange={set('till')} placeholder="e.g. 512345" required /></label>}
          {value.method === 'paybill' && (
            <>
              <label className="os-field"><span>Paybill (business) number *</span><input inputMode="numeric" value={value.paybill} onChange={set('paybill')} placeholder="e.g. 247247" required /></label>
              <label className="os-field"><span>Account number *</span><input value={value.account} onChange={set('account')} maxLength={20} placeholder="e.g. your phone or shop name" required /></label>
            </>
          )}
          {(value.method === 'pochi' || value.method === 'phone') && <label className="os-field"><span>{value.method === 'pochi' ? 'Pochi la Biashara phone *' : 'M-Pesa phone *'}</span><input inputMode="tel" value={value.phone} onChange={set('phone')} placeholder="07XX XXX XXX" required /></label>}
          <label className="os-field"><span>Name buyers will see on M-Pesa</span><input value={value.name} onChange={set('name')} maxLength={60} placeholder="e.g. Wambua Cash & Carry" /></label>
        </div>
      )}
    </>
  );
}
