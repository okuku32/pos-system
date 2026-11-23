// Download an order's PDF receipt (the request needs the login token, so it's fetched, then saved).
import toast from 'react-hot-toast';

export async function saveReceipt(client, path, orderNo) {
  const value = toast.loading('Preparing your receipt…');
  try {
    const clientEntry = await client.get(path, { responseType: 'blob' });
    const blob = clientEntry.data instanceof Blob ? clientEntry.data : new Blob([clientEntry.data], { type: 'application/pdf' });
    const name = `Kapu-${orderNo}.pdf`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast.success(`Saved ${name} to your downloads`, { id: value });
  } catch {
    toast.error('Couldn’t download the receipt. Please try again.', { id: value });
  }
}
