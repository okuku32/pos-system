import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import api, { errMsg, money } from '../api';

const POLL_MS = 3000;
const TIMEOUT_MS = 2 * 60 * 1000;

// Polls the backend until the M-Pesa STK push is paid, failed, or cancelled
export default function MpesaWaiting({ sale, onDone, onClose }) {
  const [status, setStatus] = useState(sale.status);
  const [desc, setDesc] = useState('Waiting for customer to enter M-Pesa PIN…');
  const started = useRef(Date.now());

  useEffect(() => {
    let stop = false;
    let timer;
    const poll = async () => {
      try {
        const { data } = await api.get(`/mpesa/status/${sale._id}`);
        if (stop) return;
        setStatus(data.status);
        if (data.status === 'completed') {
          toast.success(`Payment received: ${data.mpesa?.receiptNumber || ''}`);
          return onDone(data);
        }
        if (data.status !== 'pending') {
          setDesc(data.mpesa?.resultDesc || 'Payment was not completed');
          return;
        }
        if (Date.now() - started.current > TIMEOUT_MS) {
          setDesc('Timed out waiting for payment. You can keep waiting or cancel.');
        }
      } catch (err) {
        if (!stop) setDesc(errMsg(err));
      }
      if (!stop) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [sale._id, onDone]);

  const cancel = async () => {
    try {
      await api.post(`/mpesa/cancel/${sale._id}`);
    } catch {
      /* already resolved */
    }
    onClose();
  };

  const pending = status === 'pending';
  return (
    <Modal title="M-Pesa Payment" onClose={pending ? undefined : onClose}>
      <div className="center">
        {pending && <div className="spinner" />}
        <h2>{money(sale.total)}</h2>
        <p>STK push sent to <b>{sale.mpesa?.phone}</b></p>
        <p className={pending ? 'muted' : 'error-text'}>{desc}</p>
      </div>
      <div className="modal-actions">
        {pending ? (
          <button className="btn danger" onClick={cancel}>Cancel payment</button>
        ) : (
          <button className="btn" onClick={onClose}>Back to cart</button>
        )}
      </div>
    </Modal>
  );
}
