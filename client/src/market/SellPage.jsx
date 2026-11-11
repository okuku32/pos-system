import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, fieldsOf, findCat, findSub, imgUrl, shrinkImage, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import './market.css';

const MAX_PHOTOS = 8;
const EMPTY = { category: '', sub: '', title: '', description: '', price: '', negotiable: true, condition: '', county: '', area: '', attrs: {}, showPhone: true, licensed: false };

// One "detail" input, built from the category's field definition (make/model, year, size...)
function FieldInput({ f, value, attrs, onChange }) {
  const id = `f-${f.key}`;
  const label = <span>{f.label}{f.required ? ' *' : ''}</span>;
  if (f.type === 'make') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value, { model: '' })} required={f.required}>
          <option value="">Choose…</option>
          {Object.keys(f.makes).map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
    );
  }
  if (f.type === 'model') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} list={`${id}-list`} placeholder={attrs.make && attrs.make !== 'Other' ? `e.g. ${attrs._models?.[0] || ''}` : 'Type the model'} maxLength={40} />
        <datalist id={`${id}-list`}>{(attrs._models || []).map((m) => <option key={m} value={m} />)}</datalist>
      </label>
    );
  }
  if (f.type === 'select') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required}>
          <option value="">Choose…</option>
          {f.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (f.type === 'number') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <input id={id} type="number" inputMode="decimal" min={f.min} max={f.max} step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required} />
      </label>
    );
  }
  return (
    <label className="os-field" htmlFor={id}>
      {label}
      <input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={60} required={f.required} />
    </label>
  );
}

export default function SellPage() {
  const { id } = useParams(); // editing an existing ad
  const navigate = useNavigate();
  const { customer, ready } = useShop();
  const data = useCategories();
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState([]); // [{ url } existing | { file, preview } new]
  const [loaded, setLoaded] = useState(!id);
  const [saving, setSaving] = useState(false);
  const [busyPhotos, setBusyPhotos] = useState(false);
  const fileInput = useRef(null);

  useSeo({ title: id ? 'Edit your ad' : 'Post a free ad', description: 'Sell anything on the marketplace: vehicles, land, electronics, furniture and more.', noindex: true });

  useEffect(() => {
    if (!id || !customer) return;
    api
      .get(`/market/mine/${id}`)
      .then((r) => {
        const l = r.data;
        setForm({ ...EMPTY, ...l, price: l.price || '', attrs: l.attrs || {}, licensed: l.category === 'liquor' });
        setPhotos((l.images || []).map((url) => ({ url })));
        setLoaded(true);
      })
      .catch((e) => {
        toast.error(errMsg(e));
        navigate('/market/my', { replace: true });
      });
  }, [id, customer, navigate]);

  // free the photo previews when leaving the page
  useEffect(() => () => photos.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = findCat(data, form.category);
  const sub = findSub(cat, form.sub);
  const fields = useMemo(() => fieldsOf(cat, sub), [cat, sub]);
  const makeField = fields.find((f) => f.type === 'make');
  const models = makeField && form.attrs.make ? makeField.makes[form.attrs.make] || [] : [];

  if (ready && !customer) return <Navigate to={`/shop/login?next=${encodeURIComponent(id ? `/market/edit/${id}` : '/market/sell')}`} replace />;
  if (!loaded || !data) return <div className="mk mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setAttr = (key) => (value, extra = {}) => setForm((f) => ({ ...f, attrs: { ...f.attrs, [key]: value, ...extra } }));
  const chooseCat = (slug) => setForm((f) => ({ ...f, category: slug, sub: '', condition: '', attrs: {} }));

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    const room = MAX_PHOTOS - photos.length;
    if (!room) return toast.error(`Up to ${MAX_PHOTOS} photos`);
    if (files.length > room) toast(`Only the first ${room} photo${room === 1 ? '' : 's'} were added (max ${MAX_PHOTOS})`, { icon: 'ℹ️' });
    setBusyPhotos(true);
    const ready_ = await Promise.all(files.slice(0, room).map(shrinkImage)); // big phone photos become small, fast uploads
    setBusyPhotos(false);
    const big = ready_.filter((f) => f.size > 5 * 1024 * 1024);
    if (big.length) toast.error('A photo is too large (max 5 MB)');
    setPhotos((p) => [...p, ...ready_.filter((f) => f.size <= 5 * 1024 * 1024).map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };
  const removePhoto = (i) => setPhotos((p) => {
    if (p[i].preview) URL.revokeObjectURL(p[i].preview);
    return p.filter((_, j) => j !== i);
  });
  const makeCover = (i) => setPhotos((p) => [p[i], ...p.filter((_, j) => j !== i)]);

  // a ready-made title from the details ("Toyota Vitz 2015")
  const suggestedTitle = [form.attrs.make !== 'Other' && form.attrs.make, form.attrs.model, form.attrs.year, form.attrs.storage && `${form.attrs.storage}${/^\d+$/.test(form.attrs.storage) ? 'GB' : ''}`, form.attrs.size && form.attrs.unit && `${form.attrs.size} ${form.attrs.unit}`]
    .filter(Boolean)
    .join(' ');

  const submit = async (e) => {
    e.preventDefault();
    if (!form.sub) return toast.error('Please choose a category');
    const fresh = photos.filter((p) => p.file);
    // the exact order chosen (cover first): existing photos by URL, new ones as "new:<n>"
    const order = photos.map((p) => p.url || `new:${fresh.indexOf(p)}`);
    const body = new FormData();
    const attrs = Object.fromEntries(Object.entries(form.attrs).filter(([k, v]) => !k.startsWith('_') && v !== ''));
    body.append('data', JSON.stringify({ ...form, attrs, price: Number(form.price || 0), order }));
    fresh.forEach((p) => body.append('images', p.file));
    setSaving(true);
    try {
      const r = id ? await api.put(`/market/listings/${id}`, body) : await api.post('/market/listings', body);
      toast.success(id ? 'Your ad was updated' : 'Your ad is live! 🎉');
      navigate(`/market/item/${r.data.slug}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mk">
      <div className="mk-wrap mk-sell">
        <div className="mk-sell-head">
          <h1>{id ? 'Edit your ad' : 'Post a free ad'}</h1>
          <p className="os-muted">{id ? 'Changes show straight away.' : 'Reach buyers across Kenya. Good photos and a clear title sell faster.'}</p>
        </div>

        <form onSubmit={submit} className="mk-sell-form">
          {/* 1. category */}
          <section className="mk-box">
            <h2><span className="mk-step">1</span> What are you selling?</h2>
            <div className="mk-sell-cats">
              {data.categories.map((c) => (
                <button type="button" key={c.slug} className={form.category === c.slug ? 'on' : ''} onClick={() => chooseCat(c.slug)}>
                  <span>{c.icon}</span>{c.name}
                </button>
              ))}
            </div>
            {cat && (
              <label className="os-field mk-mt">
                <span>Type *</span>
                <select value={form.sub} onChange={(e) => setForm((f) => ({ ...f, sub: e.target.value, attrs: {} }))} required>
                  <option value="">Choose the type of {cat.name.toLowerCase()}…</option>
                  {cat.subs.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                </select>
              </label>
            )}
            {cat?.adult && (
              <label className="mk-check mk-mt">
                <input type="checkbox" checked={!!form.licensed} onChange={set('licensed')} required />
                I hold a valid liquor licence and will only sell to people aged 18 or older.
              </label>
            )}
          </section>

          {sub && (
            <>
              {/* 2. photos */}
              <section className="mk-box">
                <h2><span className="mk-step">2</span> Photos <small className="os-muted">({photos.length}/{MAX_PHOTOS}, the first is the cover)</small></h2>
                <div className="mk-photo-grid">
                  {photos.map((p, i) => (
                    <div key={p.url || p.preview} className={`mk-photo ${i === 0 ? 'cover' : ''}`}>
                      <img src={p.url ? imgUrl(p.url) : p.preview} alt={`Photo ${i + 1}`} />
                      {i === 0 ? <span className="mk-cover-tag">Cover</span> : <button type="button" className="mk-photo-cover" onClick={() => makeCover(i)}>Make cover</button>}
                      <button type="button" className="mk-photo-x" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>✕</button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <button type="button" className="mk-photo-add" onClick={() => fileInput.current?.click()} disabled={busyPhotos}>
                      <span>{busyPhotos ? '⏳' : '📷'}</span>
                      {busyPhotos ? 'Preparing…' : 'Add photos'}
                    </button>
                  )}
                </div>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addPhotos} />
                <p className="mk-hint">Use clear, bright photos of the real item. Ads with photos get far more chats.</p>
              </section>

              {/* 3. details */}
              <section className="mk-box">
                <h2><span className="mk-step">3</span> Details</h2>
                <div className="mk-form-grid">
                  {fields.map((f) => (
                    <FieldInput key={f.key} f={f} value={form.attrs[f.key]} attrs={{ ...form.attrs, _models: models }} onChange={setAttr(f.key)} />
                  ))}
                  {cat.condition && (
                    <label className="os-field">
                      <span>Condition *</span>
                      <select value={form.condition} onChange={set('condition')} required>
                        <option value="">Choose…</option>
                        {cat.condition.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <label className="os-field mk-mt">
                  <span>Title *</span>
                  <input value={form.title} onChange={set('title')} required minLength={5} maxLength={90} placeholder={suggestedTitle || 'e.g. Toyota Vitz 2015, very clean'} />
                  {suggestedTitle && !form.title && (
                    <button type="button" className="mk-suggest-title" onClick={() => setForm((f) => ({ ...f, title: suggestedTitle }))}>Use “{suggestedTitle}”</button>
                  )}
                </label>
                <label className="os-field mk-mt">
                  <span>Description *</span>
                  <textarea rows={6} value={form.description} onChange={set('description')} required minLength={20} maxLength={5000} placeholder="Condition, features, accessories included, why you’re selling…" />
                  <small className="mk-counter">{form.description.length}/5000</small>
                </label>
              </section>

              {/* 4. price & location */}
              <section className="mk-box">
                <h2><span className="mk-step">4</span> Price &amp; location</h2>
                <div className="mk-form-grid">
                  <label className="os-field">
                    <span>Price (KSh)</span>
                    <input type="number" inputMode="numeric" min="0" value={form.price} onChange={set('price')} placeholder="Leave empty for “Contact for price”" />
                  </label>
                  <label className="mk-check mk-check-inline">
                    <input type="checkbox" checked={form.negotiable} onChange={set('negotiable')} /> Price is negotiable
                  </label>
                  <label className="os-field">
                    <span>County *</span>
                    <select value={form.county} onChange={set('county')} required>
                      <option value="">Choose…</option>
                      {data.counties.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="os-field">
                    <span>Area / town</span>
                    <input value={form.area} onChange={set('area')} maxLength={60} placeholder="e.g. Kitengela, Westlands" />
                  </label>
                </div>
                <label className="mk-check mk-mt">
                  <input type="checkbox" checked={form.showPhone} onChange={set('showPhone')} /> Let logged-in buyers see my phone number{customer?.phone ? '' : ' (add one in your account first)'}
                </label>
              </section>

              <div className="mk-sell-submit">
                <Link to={id ? '/market/my' : '/market'} className="os-btn os-btn-ghost">Cancel</Link>
                <button className="os-btn os-btn-brand os-btn-lg" disabled={saving || busyPhotos}>{saving ? 'Saving…' : id ? 'Save changes' : 'Post ad'}</button>
              </div>
              <p className="mk-hint mk-center">By posting you agree to sell only legal items you own. Ads that break the rules are removed.</p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
