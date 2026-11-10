import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg, money } from '../api';
import Modal from '../components/Modal';
import ProductImage, { imageUrl } from '../components/ProductImage';

const EMPTY = { name: '', sku: '', barcode: '', category: 'General', price: '', cost: '', stock: '', lowStockThreshold: 5, active: true, discountPercent: 0, taxType: 'B', etimsClassCode: '' };
const TAX_TYPES = [['B', 'B · VAT 16% (standard)'], ['E', 'E · VAT 8%'], ['C', 'C · Zero-rated'], ['A', 'A · Exempt'], ['D', 'D · Non-VAT']];

export default function Products() {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [file, setFile] = useState(null); // new image picked in the form
  const [preview, setPreview] = useState('');
  const [removeImg, setRemoveImg] = useState(false);
  const [saving, setSaving] = useState(false);

  const openForm = (p) => {
    setEditing(p);
    setFile(null);
    setPreview('');
    setRemoveImg(false);
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast.error('Please choose an image file');
    if (f.size > 3 * 1024 * 1024) return toast.error('Image is too large (max 3 MB)');
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setRemoveImg(false);
  };

  const load = () =>
    api.get('/products', { params: { all: true, q } }).then((r) => setProducts(r.data)).catch((e) => toast.error(errMsg(e)));

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const save = async (e) => {
    e.preventDefault();
    const body = {
      ...editing,
      price: Number(editing.price),
      cost: Number(editing.cost || 0),
      stock: Number(editing.stock || 0),
      lowStockThreshold: Number(editing.lowStockThreshold || 0),
      discountPercent: Math.min(90, Math.max(0, Number(editing.discountPercent || 0))),
    };
    delete body.salePrice;
    delete body.etimsItemCode;
    delete body.etimsRegistered;
    delete body.image;
    setSaving(true);
    try {
      const { data: saved } = editing._id ? await api.put(`/products/${editing._id}`, body) : await api.post('/products', body);
      if (file) {
        const form = new FormData();
        form.append('image', file);
        try {
          await api.post(`/products/${saved._id}/image`, form);
        } catch (err) {
          toast.error(`Product saved, but the image failed: ${errMsg(err)}`);
        }
      } else if (removeImg && editing.image) {
        await api.delete(`/products/${saved._id}/image`);
      }
      toast.success('Product saved');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Delete ${p.name}? Past sales keep their records.`)) return;
    try {
      await api.delete(`/products/${p._id}`);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const set = (k) => (e) => setEditing({ ...editing, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div>
      <div className="page-head">
        <h2>Products</h2>
        <div className="toolbar">
          <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => openForm({ ...EMPTY })}>+ Add product</button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th></th><th>Name</th><th>SKU</th><th>Category</th><th className="right">Price</th>
              <th className="right">Cost</th><th className="right">Discount</th><th className="right">Stock</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p._id}>
                <td className="thumb-cell"><ProductImage product={p} /></td>
                <td>{p.name}</td>
                <td className="muted">{p.sku || '-'}</td>
                <td>{p.category}</td>
                <td className="right">{money(p.price)}</td>
                <td className="right muted">{money(p.cost)}</td>
                <td className="right">{p.discountPercent > 0 ? <span className="deal-text">−{p.discountPercent}% → {money(p.salePrice)}</span> : <span className="muted">–</span>}</td>
                <td className={`right ${p.stock <= p.lowStockThreshold ? 'error-text' : ''}`}>{p.stock}</td>
                <td><span className={`badge ${p.active ? 'completed' : 'cancelled'}`}>{p.active ? 'active' : 'hidden'}</span></td>
                <td className="right nowrap">
                  <button className="btn ghost sm" onClick={() => openForm({ ...p, sku: p.sku || '', barcode: p.barcode || '' })}>Edit</button>
                  <button className="btn ghost sm danger-text" onClick={() => remove(p)}>Delete</button>
                </td>
              </tr>
            ))}
            {!products.length && <tr><td colSpan={10} className="center muted">No products yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Edit product' : 'New product'} onClose={() => !saving && setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            <div className="span2 image-field">
              {preview || (editing.image && !removeImg) ? (
                <img className="product-img large" src={preview || imageUrl(editing.image)} alt="" />
              ) : (
                <ProductImage product={{ name: editing.name || '?' }} size={96} />
              )}
              <div>
                <label className="btn ghost sm file-btn">
                  {preview || (editing.image && !removeImg) ? 'Change picture' : 'Add picture'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pickFile} hidden />
                </label>
                {(preview || (editing.image && !removeImg)) && (
                  <button type="button" className="btn ghost sm danger-text" onClick={() => { setFile(null); setPreview(''); setRemoveImg(true); }}>
                    Remove
                  </button>
                )}
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>JPG, PNG, WEBP or GIF, up to 3 MB</p>
              </div>
            </div>
            <label className="span2">Name<input value={editing.name} onChange={set('name')} required /></label>
            <label>SKU<input value={editing.sku} onChange={set('sku')} /></label>
            <label>Barcode<input value={editing.barcode} onChange={set('barcode')} /></label>
            <label className="span2">Category<input value={editing.category} onChange={set('category')} list="cats" /></label>
            <label>Selling price<input type="number" step="0.01" min="0" value={editing.price} onChange={set('price')} required /></label>
            <label>Cost price<input type="number" step="0.01" min="0" value={editing.cost} onChange={set('cost')} /></label>
            <label className="span2">
              Discount % <small className="muted">(0 = no discount; customers see the old price crossed out)</small>
              <input type="number" min="0" max="90" step="1" value={editing.discountPercent ?? 0} onChange={set('discountPercent')} />
              {Number(editing.discountPercent) > 0 && Number(editing.price) > 0 && (() => {
                const sp = Math.round((Number(editing.price) * (100 - Number(editing.discountPercent))) / 100);
                const below = Number(editing.cost) > 0 && sp <= Number(editing.cost);
                return <small className={below ? 'error-text' : 'deal-text'}>Sells for {money(sp)}{below ? ', below cost price!' : `, margin ${money(sp - Number(editing.cost || 0))}`}</small>;
              })()}
            </label>
            <label>Stock<input type="number" value={editing.stock} onChange={set('stock')} /></label>
            <label>Low-stock alert at<input type="number" min="0" value={editing.lowStockThreshold} onChange={set('lowStockThreshold')} /></label>
            <label>
              VAT type (KRA eTIMS)
              <select value={editing.taxType || 'B'} onChange={set('taxType')}>
                {TAX_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>
              KRA item class code <small className="muted">(optional)</small>
              <input value={editing.etimsClassCode || ''} onChange={set('etimsClassCode')} placeholder="Uses the default" />
            </label>
            {editing.etimsItemCode && <p className="muted span2" style={{ margin: '-4px 0 8px', fontSize: 12 }}>KRA item code: {editing.etimsItemCode}{editing.etimsRegistered ? ' (registered)' : ''}</p>}
            <label className="check span2"><input type="checkbox" checked={editing.active} onChange={set('active')} /> Visible at checkout</label>
            <datalist id="cats">{[...new Set(products.map((p) => p.category))].map((c) => <option key={c} value={c} />)}</datalist>
            <div className="modal-actions span2">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
