import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Modal from './Modal';
import api from '../api';
import { money } from '../api';

const STORE = import.meta.env.VITE_STORE_NAME || 'Ordersasa';

function EtimsBlock({ sale }) {
  const [etims, setEtims] = useState(sale.etims);
  const [qr, setQr] = useState('');

  // KRA may answer a moment after the sale: check again a few times
  useEffect(() => {
    if (etims?.status === 'submitted' || !sale._id) return undefined;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      api.get(`/sales/${sale._id}`).then((r) => r.data.etims && setEtims(r.data.etims)).catch(() => {});
      if (n >= 5) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [sale._id, etims?.status]);

  useEffect(() => {
    if (etims?.verifyUrl) QRCode.toDataURL(etims.verifyUrl, { margin: 1, width: 140 }).then(setQr).catch(() => {});
  }, [etims?.verifyUrl]);

  if (!etims) return null;
  if (etims.status !== 'submitted') {
    return <p className="center muted" style={{ fontSize: 12 }}>KRA eTIMS: {etims.status === 'failed' ? 'not accepted, will need resending' : 'sending to KRA…'}</p>;
  }
  return (
    <div className="etims-block">
      <hr />
      {etims.mode === 'mock' && <p className="etims-test">TEST MODE: not a valid tax invoice</p>}
      <p className="center"><b>KRA eTIMS TAX INVOICE</b></p>
      <div className="row-between"><span>Taxable amount</span><span>{money(etims.taxableAmount)}</span></div>
      <div className="row-between"><span>VAT</span><span>{money(etims.totalTax)}</span></div>
      {sale.customerTin && <div className="row-between"><span>Buyer PIN</span><span>{sale.customerTin}</span></div>}
      <div className="row-between"><span>CU invoice no.</span><span>{etims.sdcId}/{etims.rcptNo}</span></div>
      <div className="row-between"><span>Invoice no.</span><span>{etims.invoiceNo}</span></div>
      <div className="etims-code"><span>Internal data</span><b>{etims.intrlData}</b></div>
      <div className="etims-code"><span>Receipt signature</span><b>{etims.rcptSign}</b></div>
      {etims.sdcDateTime && <div className="row-between"><span>CU date</span><span>{String(etims.sdcDateTime).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}).*/, '$3/$2/$1 $4:$5:$6')}</span></div>}
      {qr && <img className="etims-qr" src={qr} alt="Scan to verify this receipt with KRA" />}
      <p className="center muted" style={{ fontSize: 11 }}>Scan to verify with KRA</p>
    </div>
  );
}

export default function Receipt({ sale, onClose }) {
  if (!sale) return null;
  return (
    <Modal title="Receipt" onClose={onClose} width={380}>
      <div className="receipt print-area">
        <h2>{STORE}</h2>
        <p className="muted">{new Date(sale.createdAt).toLocaleString()}</p>
        <p>
          <b>{sale.receiptNo}</b>
        </p>
        {sale.order?.orderNo && <p className="muted">Order: {sale.order.orderNo}</p>}
        <p className="muted">Served by: {sale.cashier?.name || '-'}</p>
        <hr />
        <table>
          <tbody>
            {sale.items.map((i, idx) => (
              <tr key={idx}>
                <td>
                  {i.name}
                  <br />
                  <small className="muted">
                    {i.quantity} × {money(i.price)}
                    {i.listPrice > i.price && <> (was {money(i.listPrice)})</>}
                  </small>
                </td>
                <td className="right">{money(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr />
        <div className="row-between"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
        {sale.discount > 0 && <div className="row-between"><span>Discount</span><span>-{money(sale.discount)}</span></div>}
        {sale.tax > 0 && <div className="row-between"><span>Tax</span><span>{money(sale.tax)}</span></div>}
        <div className="row-between total"><span>TOTAL</span><span>{money(sale.total)}</span></div>
        {(sale.savings || 0) + (sale.discount || 0) > 0 && (
          <div className="row-between receipt-saved"><span>YOU SAVED</span><span>{money((sale.savings || 0) + (sale.discount || 0))}</span></div>
        )}
        <hr />
        <div className="row-between"><span>Payment</span><span>{sale.paymentMethod === 'mpesa' ? 'M-Pesa' : 'Cash'}</span></div>
        {sale.paymentMethod === 'cash' && (
          <>
            <div className="row-between"><span>Tendered</span><span>{money(sale.amountTendered)}</span></div>
            <div className="row-between"><span>Change</span><span>{money(sale.change)}</span></div>
          </>
        )}
        {sale.paymentMethod === 'mpesa' && (
          <>
            <div className="row-between"><span>Phone</span><span>{sale.mpesa?.phone}</span></div>
            <div className="row-between"><span>M-Pesa Ref</span><span>{sale.mpesa?.receiptNumber || '-'}</span></div>
          </>
        )}
        <div className="row-between"><span>Status</span><span className={`badge ${sale.status}`}>{sale.status}</span></div>
        <EtimsBlock sale={sale} />
        <p className="center muted" style={{ marginTop: 12 }}>Thank you for shopping with us!</p>
      </div>
      <div className="modal-actions no-print">
        <button className="btn" onClick={() => window.print()}>Print</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
