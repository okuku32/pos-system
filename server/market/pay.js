// How a seller is paid on delivery: M-Pesa Till (Buy Goods), Paybill + account, Pochi la Biashara, or Send Money.
// The seller sets it in My account; a copy goes on every order so the buyer always sees how to pay.
const METHODS = ['till', 'paybill', 'pochi', 'phone'];
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const pretty = (value) => String(value || '').replace(/^254(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3');

// checks what the seller entered (throws a friendly message); null = remove
function cleanPay(pay, httpError, formatPhone) {
  if (!pay) return null;
  if (!METHODS.includes(pay.method)) throw httpError('Choose how buyers pay you: Till, Paybill, Pochi la Biashara or Send Money');
  const name = String(pay.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
  if (pay.method === 'till') {
    const till = digits(pay.till);
    if (!/^\d{5,7}$/.test(till)) throw httpError('Enter your M-Pesa Till number (Buy Goods): 5 to 7 digits');
    return { method: 'till', till, name };
  }
  if (pay.method === 'paybill') {
    const paybill = digits(pay.paybill);
    const account = String(pay.account || '').replace(/[<>]/g, '').trim().slice(0, 20);
    if (!/^\d{5,7}$/.test(paybill)) throw httpError('Enter the Paybill (business) number: 5 to 7 digits');
    if (!account) throw httpError('Enter the account number buyers should use with the Paybill');
    return { method: 'paybill', paybill, account, name };
  }
  let phone;
  try {
    phone = formatPhone(pay.phone);
  } catch {
    throw httpError(pay.method === 'pochi' ? 'Enter the phone number of your Pochi la Biashara' : 'Enter the M-Pesa number buyers should send money to');
  }
  return { method: pay.method, phone, name };
}

// "M-Pesa Till 123456 (Wambua Cash & Carry)"
function payText(value) {
  if (!value?.method) return '';
  const who = value.name ? ` (${value.name})` : '';
  if (value.method === 'till') return `M-Pesa Buy Goods, Till ${value.till}${who}`;
  if (value.method === 'paybill') return `M-Pesa Paybill ${value.paybill}, account ${value.account}${who}`;
  if (value.method === 'pochi') return `M-Pesa Pochi la Biashara ${pretty(value.phone)}${who}`;
  return `M-Pesa Send Money to ${pretty(value.phone)}${who}`;
}
const publicPay = (pay) => (pay?.method ? { method: pay.method, till: pay.till || '', paybill: pay.paybill || '', account: pay.account || '', phone: pay.phone || '', name: pay.name || '', text: payText(pay) } : null);

module.exports = { cleanPay, payText, publicPay, METHODS };
