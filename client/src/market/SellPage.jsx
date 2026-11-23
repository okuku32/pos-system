import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { api, COLOUR_HEX, errMsg, SOLD_BY_UNIT, unitShort, fieldsOf, findCat, findSub, hasOrigin, imgUrl, originChoice, FOOD_CATS, originsOf, priceText, shrinkImage, useCategories, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { STORE_INFO } from '../shop/storeInfo';
import { PriceGuide } from './Trust';
import { ProductHint, StorePicker } from './Relations';
import './market.css';

const MAX_PHOTOS = 8;
const EMPTY = { origin: '', category: '', sub: '', title: '', description: '', price: '', wasPrice: '', negotiable: true, condition: '', county: '', area: '', attrs: {}, showPhone: true, licensed: false, buyNow: false, stock: '', weightKg: '', delivery: { available: true, fee: '', pickup: true, days: '' }, layaway: { enabled: false, minDepositPercent: 30, maxWeeks: 4 }, wholesale: { enabled: false, unit: '', retail: true, tiers: [{ minQty: '', price: '' }] } };
// vehicles, land and services are agreed in person; everything else can also be sold online
const canSellOnline = (cat, sub) => !!cat && !['vehicles', 'land-property'].includes(cat) && sub !== 'services';

// A numbered form section with a title and a short line explaining it
function Section({ n, id, title, hint, optional, className = '', innerRef, children }) {
  return (
    <section id={id} ref={innerRef} className={`mk-box mk-sell-sec mk-scroll-target ${className}`}>
      <header className="mk-sell-sec-head">
        <span className="mk-step">{n}</span>
        <div>
          <h2>{title}{optional && <em className="mk-sell-opt">Optional</em>}</h2>
          {hint && <p>{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

// A KSh amount field: the currency sits inside the box
function MoneyInput(props) {
  return (
    <div className="mk-input-pre">
      <span aria-hidden="true">KSh</span>
      <input type="number" inputMode="numeric" min="0" {...props} />
    </div>
  );
}

// One "detail" input, built from the category's field definition (make/model, year, size...)
function FieldInput({ f: field, value, attrs, onChange }) {
  const id = `f-${field.key}`;
  const label = <span>{field.label}{field.required ? ' *' : ''}</span>;
  if (field.type === 'make') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value, { model: '' })} required={field.required}>
          <option value="">Choose…</option>
          {Object.keys(field.makes).map((key) => <option key={key}>{key}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === 'model') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <input id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} list={`${id}-list`} placeholder={attrs.make && attrs.make !== 'Other' ? `e.g. ${attrs._models?.[0] || ''}` : 'Type the model'} maxLength={40} />
        <datalist id={`${id}-list`}>{(attrs._models || []).map((_model) => <option key={_model} value={_model} />)}</datalist>
      </label>
    );
  }
  if (field.key === 'colour') {
    return (
      <div className="os-field mk-span-all">
        <span>{field.label}</span>
        <div className="mk-swatches" role="radiogroup" aria-label={field.label}>
          {field.options.map((option) => (
            <button type="button" key={option} role="radio" aria-checked={value === option} className={`mk-swatch ${value === option ? 'on' : ''}`} onClick={() => onChange(value === option ? '' : option)}>
              <i style={{ background: COLOUR_HEX[option] || '#ddd' }} />
              <span>{option}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} required={field.required}>
          <option value="">Choose…</option>
          {field.options.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === 'number') {
    return (
      <label className="os-field" htmlFor={id}>
        {label}
        <input id={id} type="number" inputMode="decimal" min={field.min} max={field.max} step="any" value={value ?? ''} onChange={(event) => onChange(event.target.value)} required={field.required} />
      </label>
    );
  }
  return (
    <label className="os-field" htmlFor={id}>
      {label}
      <input id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} maxLength={60} required={field.required} />
    </label>
  );
}

export default function SellPage() {
  const { id } = useParams(); // editing an existing ad
  const navigate = useNavigate();
  const { customer, ready } = useShop();
  const data = useCategories();
  const [form, setForm] = useState(EMPTY);
  const [params] = useSearchParams();
  const [picking, setPicking] = useState(!id); // the full category grid; folded away once a type is chosen
  const photosRef = useRef(null);
  const [typeOpen, setTypeOpen] = useState(false); // the type picker, on top of the screen, after choosing a category
  const [guide, setGuide] = useState(-1); // the guided steps after the type: -1 closed · 'start' · the step shown
  const loadedWas = useRef(''); // the "was" price the ad had when the edit started
  // coming from the "+ Sell" pop-up: the category and type are already chosen
  useEffect(() => {
    if (id || !data) return;
    const category = findCat(data, params.get('category'));
    const subcategory = findSub(category, params.get('sub'));
    if (category && !subcategory) { // a new seller's own category (mama mboga → Fresh produce): pick the type next
      setForm((previousForm) => (previousForm.category ? previousForm : { ...previousForm, category: category.slug, sub: '', condition: '', attrs: {} }));
      setTypeOpen(true);
      return;
    }
    if (!subcategory) return;
    setForm((previousForm) => (previousForm.category === category.slug && previousForm.sub === subcategory.slug ? previousForm : { ...previousForm, category: category.slug, sub: subcategory.slug, condition: '', attrs: {} }));
    setPicking(false);
  }, [id, data, params]);
  // the store it's sold from (Seller hub → Stores → "Product here" opens this form with it chosen)
  useEffect(() => {
    if (!id && params.get('store')) setForm((previousForm) => ({ ...previousForm, store: params.get('store') }));
  }, [id, params]);
  // from "Now add your items" (importers / wholesalers): where it's from, and bulk prices switched on
  useEffect(() => {
    if (id) return;
    const origin = params.get('origin');
    const bulk = params.get('wholesale') === '1';
    if (origin || bulk) setForm((previousForm) => ({ ...previousForm, ...(origin ? { origin } : {}), ...(bulk ? { wholesale: { ...previousForm.wholesale, enabled: true } } : {}) }));
  }, [id, params]);
  const setStore = useCallback((value) => setForm((previousForm) => ({ ...previousForm, store: value })), []);
  const setProduct = useCallback((value) => setForm((previousForm) => ({ ...previousForm, product: value })), []);
  const [photos, setPhotos] = useState([]); // [{ url } existing | { file, preview } new]
  const [loaded, setLoaded] = useState(!id);
  const [saving, setSaving] = useState(false);
  const [busyPhotos, setBusyPhotos] = useState(false);
  const [dragging, setDragging] = useState(false); // photos being dragged over the drop zone
  const fileInput = useRef(null);

  useSeo({ title: id ? 'Edit your ad' : 'Post a free ad', description: 'Sell anything on the marketplace: vehicles, land, electronics, furniture and more.', noindex: true });
  // the Post ad / Cancel bar is on screen (a type is chosen): the floating help buttons move up out of its way
  const barOn = !!form.sub;
  useEffect(() => {
    if (!barOn) return undefined;
    document.body.classList.add('mk-sell-bar-on');
    return () => document.body.classList.remove('mk-sell-bar-on');
  }, [barOn]);

  useEffect(() => {
    if (!id || !customer) return;
    api
      .get(`/market/mine/${id}`)
      .then((response) => {
        const payload = response.data;
        loadedWas.current = payload.wasPrice && payload.discountPercent > 0 ? payload.wasPrice : '';
        setForm({ ...EMPTY, ...payload, price: payload.price || '', wasPrice: loadedWas.current, attrs: payload.attrs || {}, licensed: payload.category === 'liquor', stock: payload.buyNow ? payload.stock : '', weightKg: payload.weightKg ?? '', delivery: { ...EMPTY.delivery, ...(payload.delivery || {}), fee: payload.delivery?.fee || '' }, layaway: { ...EMPTY.layaway, ...(payload.layaway || {}) }, wholesale: payload.wholesale?.enabled ? { ...payload.wholesale, tiers: payload.wholesale.tiers.length ? payload.wholesale.tiers : EMPTY.wholesale.tiers } : EMPTY.wholesale });
        setPhotos((payload.images || []).map((url) => ({ url })));
        setPicking(false);
        setLoaded(true);
      })
      .catch((error) => {
        toast.error(errMsg(error));
        navigate('/market/my', { replace: true });
      });
  }, [id, customer, navigate]);

  // free the photo previews when leaving the page
  useEffect(() => () => photos.forEach((photo) => photo.preview && URL.revokeObjectURL(photo.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = findCat(data, form.category);
  const sub = findSub(cat, form.sub);
  const fields = useMemo(() => fieldsOf(cat, sub), [cat, sub]);
  // greens (sukuma, kienyeji, dhania…) are sold by the kifungu unless the seller picks something else
  useEffect(() => {
    if (form.category === 'fresh-produce' && form.sub === 'vegetables' && !form.attrs.unit) setForm((previousForm) => ({ ...previousForm, attrs: { ...previousForm.attrs, unit: 'Kifungu (bunch)' } }));
  }, [form.category, form.sub, form.attrs.unit]);
  const per = SOLD_BY_UNIT.includes(form.category) ? unitShort(form.attrs.unit) : '';
  const makeField = fields.find((field) => field.type === 'make');
  const models = makeField && form.attrs.make ? makeField.makes[form.attrs.make] || [] : [];

  if (ready && !customer) return <Navigate to={`/login?as=seller&next=${encodeURIComponent(id ? `/market/edit/${id}` : `/market/sell${params.toString() ? `?${params}` : ''}`)}`} replace />;
  if (!loaded || !data) return <div className="mk mk-wrap"><div className="page-loading"><span className="page-spinner" /></div></div>;

  const set = (key) => (event) => setForm((previousForm) => ({ ...previousForm, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  // a field inside a group (delivery, layaway, wholesale)
  const setIn = (group, key, cast = (value) => value) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : cast(event.target.value);
    setForm((previousForm) => ({ ...previousForm, [group]: { ...previousForm[group], [key]: value } }));
  };
  const setTier = (index, key) => (event) => {
    const value = event.target.value;
    setForm((previousForm) => ({ ...previousForm, wholesale: { ...previousForm.wholesale, tiers: previousForm.wholesale.tiers.map((tier, position) => (position === index ? { ...tier, [key]: value } : tier)) } }));
  };
  const setAttr = (key) => (value, extra = {}) => setForm((previousForm) => ({ ...previousForm, attrs: { ...previousForm.attrs, [key]: value, ...extra } }));
  // choosing a category opens the type picker; choosing a type (picker or dropdown) moves on to the photos
  const chooseCat = (slug) => {
    setForm((previousForm) => ({ ...previousForm, category: slug, sub: '', condition: '', attrs: {} }));
    setTypeOpen(true);
  };
  const chooseSub = (value) => {
    setForm((previousForm) => ({ ...previousForm, sub: value, attrs: {} }));
    setTypeOpen(false);
    if (value) {
      setPicking(false);
      if (!id) setGuide('start');
      else setTimeout(() => photosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };
  const goTo = (sectionId) => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const addFiles = async (list) => {
    const files = [...(list || [])].filter((item) => item.type.startsWith('image/'));
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (!room) return toast.error(`Up to ${MAX_PHOTOS} photos`);
    if (files.length > room) toast(`Only the first ${room} photo${room === 1 ? '' : 's'} were added (max ${MAX_PHOTOS})`, { icon: 'ℹ️' });
    setBusyPhotos(true);
    const ready_ = await Promise.all(files.slice(0, room).map(shrinkImage)); // big phone photos become small, fast uploads
    setBusyPhotos(false);
    const big = ready_.filter((item) => item.size > 5 * 1024 * 1024);
    if (big.length) toast.error('A photo is too large (max 5 MB)');
    setPhotos((previousPhotos) => [...previousPhotos, ...ready_.filter((item) => item.size <= 5 * 1024 * 1024).map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };
  const addPhotos = (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    addFiles(files);
  };
  const dropZone = {
    onDragOver: (event) => { event.preventDefault(); setDragging(true); },
    onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); },
    onDrop: (event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); },
  };
  const removePhoto = (index) => setPhotos((previousPhotos) => {
    if (previousPhotos[index].preview) URL.revokeObjectURL(previousPhotos[index].preview);
    return previousPhotos.filter((_, position) => position !== index);
  });
  const makeCover = (cover) => setPhotos((previousPhotos) => [previousPhotos[cover], ...previousPhotos.filter((_, index) => index !== cover)]);

  // a ready-made title from the details ("Toyota Vitz 2015")
  const suggestedTitle = [form.attrs.make !== 'Other' && form.attrs.make, form.attrs.model, form.attrs.year, form.attrs.storage && `${form.attrs.storage}${/^\d+$/.test(form.attrs.storage) ? 'GB' : ''}`, form.attrs.size && form.attrs.unit && `${form.attrs.size} ${form.attrs.unit}`]
    .filter(Boolean)
    .join(' ');

  // the checklist beside the form: what's left before the ad is ready
  const online = canSellOnline(form.category, form.sub);
  const checks = [
    { label: 'Category', done: !!sub, to: 'sec-category' },
    { label: 'At least one photo', done: photos.length > 0, to: 'sec-photos' },
    { label: 'Item details', done: fields.filter((field) => field.required).every((field) => form.attrs[field.key]) && (!cat?.condition || !!form.condition), to: 'sec-details' },
    { label: 'Title', done: form.title.trim().length >= 5, to: 'sec-details' },
    { label: 'Description', done: form.description.trim().length >= 20, to: 'sec-details' },
    { label: 'Price', done: Number(form.price) > 0, to: 'sec-price' },
    { label: 'County', done: !!form.county, to: 'sec-price' },
  ];
  const doneCount = checks.filter((check) => check.done).length;
  const percent = Math.round((doneCount / checks.length) * 100);
  const cover = photos[0] ? (photos[0].url ? imgUrl(photos[0].url) : photos[0].preview) : '';
  const discount = Number(form.wasPrice) > Number(form.price) && Number(form.price) > 0 ? Math.round(((Number(form.wasPrice) - Number(form.price)) / Number(form.wasPrice)) * 100) : 0;

  // ---------------------------------------------------------------- the guided steps (a new ad, after choosing the type)
  // One detail at a time, on top of the screen: photos, the item's details, condition, title, description, price,
  // where it is and selling online. Required ones must be filled to go on; optional ones can be skipped. Steps already
  // filled are passed over. At the end the whole form is shown, ready to check and post.
  const pickChoice = (key, value) => setForm((previousForm) => ({ ...previousForm, [key]: value }));
  const guideSteps = !sub ? [] : [
    {
      key: 'photos', icon: '📷', title: 'Add photos of your item', hint: `Up to ${MAX_PHOTOS}. The first one is the cover buyers see in search.`, done: () => photos.length > 0,
      render: () => (
        <div className="mk-guide-photos">
          {photos.length > 0 && (
            <div className="mk-guide-thumbs">
              {photos.map((photo, index) => <img key={photo.url || photo.preview} src={photo.url ? imgUrl(photo.url) : photo.preview} alt={`Photo ${index + 1}`} />)}
            </div>
          )}
          <button type="button" className="os-btn os-btn-dark os-block" onClick={() => fileInput.current?.click()} disabled={busyPhotos || photos.length >= MAX_PHOTOS}>
            {busyPhotos ? '⏳ Preparing your photos…' : photos.length ? `＋ Add more (${photos.length}/${MAX_PHOTOS})` : '📷 Take or choose photos'}
          </button>
          <small className="os-muted">Bright, clear photos of the real item get far more chats.</small>
        </div>
      ),
    },
    ...fields.map((field) => ({
      key: `attr-${field.key}`, icon: '📝', title: field.label, hint: `About your ${(sub?.name || 'item').toLowerCase()}`, required: !!field.required, done: () => form.attrs[field.key] !== undefined && form.attrs[field.key] !== '',
      check: () => (field.required && !form.attrs[field.key] ? `Please fill in: ${field.label}` : ''),
      render: () => (
        <div className="mk-form-grid mk-guide-one">
          <FieldInput f={field} value={form.attrs[field.key]} attrs={{ ...form.attrs, _models: models }} onChange={setAttr(field.key)} />
        </div>
      ),
    })),
    ...(hasOrigin(form.category, form.sub) ? [{
      key: 'origin', icon: '🌍', title: 'Where is it from?', done: () => !!form.origin,
      render: () => (
        <label className="os-field">
          <span>Origin</span>
          <select value={form.origin || ''} onChange={set('origin')}>
            <option value="">Not sure / don’t say</option>
            {originsOf(data).map((item) => <option key={item.key} value={item.key}>{originChoice(item, form.category)}</option>)}
          </select>
        </label>
      ),
    }] : []),
    ...(cat?.condition ? [{
      key: 'condition', icon: '✨', title: 'What condition is it in?', required: true, done: () => !!form.condition, check: () => (form.condition ? '' : 'Choose the condition'), autoNext: true,
      render: () => (
        <div className="mk-guide-choices" role="radiogroup" aria-label="Condition">
          {cat.condition.map((item) => <button type="button" key={item} role="radio" aria-checked={form.condition === item} className={form.condition === item ? 'on' : ''} onClick={() => { pickChoice('condition', item); guideGo(guideAt + 1); }}>{item}</button>)}
        </div>
      ),
    }] : []),
    {
      key: 'title', icon: '🏷️', title: 'Give your ad a title', hint: 'Say what it is: brand, model, size.', required: true, done: () => form.title.trim().length >= 5,
      check: () => (form.title.trim().length >= 5 ? '' : 'The title needs at least 5 characters'),
      render: () => (
        <label className="os-field">
          <span className="mk-label-row">Title * <small className="mk-counter">{form.title.length}/90</small></span>
          <input value={form.title} onChange={set('title')} maxLength={90} placeholder={suggestedTitle || 'e.g. Toyota Vitz 2015, very clean'} />
          {suggestedTitle && !form.title && <button type="button" className="mk-suggest-title" onClick={() => pickChoice('title', suggestedTitle)}>Use “{suggestedTitle}”</button>}
        </label>
      ),
    },
    {
      key: 'description', icon: '📄', title: 'Describe it', hint: 'Condition, features, what’s included, why you’re selling.', required: true, done: () => form.description.trim().length >= 20,
      check: () => (form.description.trim().length >= 20 ? '' : `${20 - form.description.trim().length} more characters needed`),
      render: () => (
        <label className="os-field">
          <span className="mk-label-row">Description * <small className="mk-counter">{form.description.length}/5000</small></span>
          <textarea rows={5} value={form.description} onChange={set('description')} maxLength={5000} placeholder="Condition, features, accessories included, why you’re selling…" />
          {form.description.length > 0 && form.description.trim().length < 20 && <small className="mk-field-help">{20 - form.description.trim().length} more characters needed</small>}
        </label>
      ),
    },
    {
      key: 'price', icon: '💰', title: per ? `Your price per ${per}` : 'Your price', hint: 'Leave it empty for “Contact for price”.', done: () => Number(form.price) > 0,
      render: () => (
        <>
          <label className="os-field">
            <span>{per ? `Price per ${per}` : 'Price'}</span>
            <MoneyInput value={form.price} onChange={set('price')} placeholder={per ? `Your price for one ${per}` : 'Empty = “Contact for price”'} />
          </label>
          <label className="mk-check mk-mt"><input type="checkbox" checked={form.negotiable} onChange={set('negotiable')} /> Price is negotiable</label>
        </>
      ),
    },
    {
      key: 'location', icon: '📍', title: 'Where is the item?', required: true, done: () => !!form.county, check: () => (form.county ? '' : 'Choose the county'),
      render: () => (
        <div className="mk-form-grid">
          <label className="os-field">
            <span>County *</span>
            <select value={form.county} onChange={set('county')}>
              <option value="">Choose…</option>
              {data.counties.map((county) => <option key={county}>{county}</option>)}
            </select>
          </label>
          <label className="os-field">
            <span>Area / town</span>
            <input value={form.area} onChange={set('area')} maxLength={60} placeholder="e.g. Kitengela, Westlands" />
          </label>
        </div>
      ),
    },
    ...(online ? [{
      key: 'online', icon: '🛒', title: 'Sell it online too?', hint: 'Buyers order and pay with M-Pesa or cash on delivery.', done: () => false,
      check: () => (form.buyNow && !(Number(form.stock) >= 1) ? 'Enter how many you have in stock' : ''),
      render: () => (
        <>
          <div className="mk-guide-choices" role="radiogroup" aria-label="Sell online">
            <button type="button" role="radio" aria-checked={!!form.buyNow} className={form.buyNow ? 'on' : ''} onClick={() => pickChoice('buyNow', true)}>Yes, buyers can order online</button>
            <button type="button" role="radio" aria-checked={!form.buyNow} className={!form.buyNow ? 'on' : ''} onClick={() => pickChoice('buyNow', false)}>No, chat and call only</button>
          </div>
          {form.buyNow && (
            <label className="os-field mk-mt">
              <span>Quantity in stock *</span>
              <input type="number" inputMode="numeric" min="1" max="100000" value={form.stock} onChange={set('stock')} placeholder="e.g. 10" />
            </label>
          )}
        </>
      ),
    }] : []),
  ];
  // the next step still to fill, from index (or -1 when every one is filled)
  const nextOpen = (from) => {
    for (let index = from; index < guideSteps.length; index += 1) if (!guideSteps[index].done()) return index;
    return -1;
  };
  const finishGuide = () => {
    setGuide(-1);
    toast.success('All details filled. Check your ad and post it 🎉', { id: 'guide-done' });
    setTimeout(() => photosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };
  const guideGo = (from) => {
    const next = nextOpen(from);
    if (next < 0) finishGuide();
    else setGuide(next);
  };
  // 'start': the first step still to fill (worked out here, not in an effect: this runs after the page's early returns)
  const guideAt = guide === 'start' ? nextOpen(0) : guide;
  const guideStep = typeof guideAt === 'number' && guideAt >= 0 ? guideSteps[guideAt] || null : null;

  const submit = async (event) => {
    event.preventDefault();
    if (!form.sub) return toast.error('Please choose a category');
    const fresh = photos.filter((photo) => photo.file);
    // the exact order chosen (cover first): existing photos by URL, new ones as "new:<n>"
    const order = photos.map((photo) => photo.url || `new:${fresh.indexOf(photo)}`);
    const body = new FormData();
    const attrs = Object.fromEntries(Object.entries(form.attrs).filter(([key, value]) => !key.startsWith('_') && value !== ''));
    // was price: typed → a discount · emptied → no discount · never set → lowering the price on an edit makes one by itself
    const wasPrice = form.wasPrice !== '' ? Number(form.wasPrice) : loadedWas.current ? 0 : undefined;
    body.append('data', JSON.stringify({ ...form, wasPrice, attrs, price: Number(form.price || 0), order, buyNow: form.buyNow && online, wholesale: { ...form.wholesale, tiers: form.wholesale.tiers.filter((tier) => tier.minQty && tier.price) }, stock: Number(form.stock || 0), delivery: { ...form.delivery, fee: Number(form.delivery.fee || 0) } }));
    fresh.forEach((item) => body.append('images', item.file));
    setSaving(true);
    try {
      const response = id ? await api.put(`/market/listings/${id}`, body) : await api.post('/market/listings', body);
      toast.success(id ? 'Your ad was updated' : 'Your ad is live! 🎉');
      navigate(`/market/item/${response.data.slug}`);
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
          <nav className="mk-crumbs" aria-label="Breadcrumb">
            <Link to="/">Marketplace</Link> / <Link to="/market/my">My ads</Link> / <span>{id ? 'Edit ad' : 'New ad'}</span>
          </nav>
          <h1>{id ? 'Edit your ad' : 'Post a free ad'}</h1>
          <p className="os-muted">{id ? 'Changes show straight away.' : 'Reach buyers across Kenya. Good photos and a clear title sell faster.'}</p>
        </div>

        <form onSubmit={submit} className={`mk-sell-layout ${sub ? 'has-side' : ''}`}>
          <div className="mk-sell-main">
            {typeOpen && cat && <TypePicker cat={cat} value={form.sub} onPick={chooseSub} onClose={() => setTypeOpen(false)} />}
            {guideStep && !typeOpen && (
              <GuidePopup step={guideStep} index={guideAt} total={guideSteps.length} category={cat} sub={sub}
                onBack={guideAt > 0 ? () => setGuide(guideAt - 1) : null}
                onNext={() => {
                  const problem = guideStep.check?.() || '';
                  if (problem) return problem;
                  guideGo(guideAt + 1);
                  return '';
                }}
                onShown={() => guide === 'start' && setGuide(guideAt)}
                onClose={() => setGuide(-1)} />
            )}
            {/* 1. category */}
            <Section n="1" id="sec-category" title="What are you selling?" hint={sub && !picking ? null : 'Pick the category that fits best, then the type. This decides which details buyers see.'}>
              {sub && !picking ? (
                <div className="mk-sell-chosen">
                  <span className="mk-sell-chosen-icon">{cat.icon}</span>
                  <div><b>{sub.name}</b><small>{cat.name}</small></div>
                  <button type="button" className="os-btn os-btn-ghost" onClick={() => setPicking(true)}>Change</button>
                </div>
              ) : (
                <>
                  <div className="mk-sell-cats">
                    {data.categories.map((category) => (
                      <button type="button" key={category.slug} className={form.category === category.slug ? 'on' : ''} aria-pressed={form.category === category.slug} onClick={() => chooseCat(category.slug)}>
                        <span>{category.icon}</span>{category.name}
                      </button>
                    ))}
                  </div>
                  {form.category !== 'other' && (
                    <p className="mk-sell-other">Can’t find a category for your item? <button type="button" className="mk-linkbtn" onClick={() => chooseCat('other')}>🛍️ Choose “Other”</button></p>
                  )}
                  {cat && (
                    <label className="os-field mk-mt">
                      <span>Type *</span>
                      <select value={form.sub} onChange={(event) => chooseSub(event.target.value)} required>
                        <option value="">Choose the type of {cat.name.toLowerCase()}…</option>
                        {cat.subs.map((subcategory) => <option key={subcategory.slug} value={subcategory.slug}>{subcategory.name}{subcategory.other ? ' (not listed above)' : ''}</option>)}
                      </select>
                      <small className="mk-hint">Not in the list? Pick “{(cat.subs.find((subcategory) => subcategory.other) || {}).name || 'Other'}”.</small>
                    </label>
                  )}
                </>
              )}
              {cat?.adult && (
                <label className="mk-check mk-sell-callout mk-mt">
                  <input type="checkbox" checked={!!form.licensed} onChange={set('licensed')} required />
                  I hold a valid liquor licence and will only sell to people aged 18 or older.
                </label>
              )}
              {cat?.chemistOnly && customer?.chemist?.status !== 'verified' && (
                <div className="mk-chem wait mk-mt">
                  💊 <b>Only licensed chemists can post medicines and health products.</b>
                  <span>{customer?.chemist?.status === 'pending' ? 'We’re checking your licence; you can post once it’s approved.' : <>Send your Pharmacy and Poisons Board premises licence in <Link to="/account#shop-location">My account → Shop location</Link> (tick “Chemist”).</>}</span>
                </div>
              )}
              {cat?.chemistOnly && (form.sub === 'prescription-medicine' || form.attrs?.rx === 'Prescription needed') && (
                <p className="mk-hint mk-mt">℞ Prescription medicines can’t be bought online. Buyers chat with you and bring their prescription to the chemist.</p>
              )}
            </Section>

            {sub && (
              <>
                {/* 2. photos */}
                <Section n="2" id="sec-photos" innerRef={photosRef} title="Photos" hint={`Up to ${MAX_PHOTOS} photos. The first one is the cover buyers see in search.`}>
                  {photos.length === 0 ? (
                    <button type="button" className={`mk-dropzone ${dragging ? 'over' : ''}`} onClick={() => fileInput.current?.click()} disabled={busyPhotos} {...dropZone}>
                      <span className="mk-dropzone-icon">{busyPhotos ? '⏳' : '📷'}</span>
                      <b>{busyPhotos ? 'Preparing your photos…' : 'Add photos'}</b>
                      <small>Drag and drop here, or click to choose. JPG, PNG or WebP, up to 5 MB each.</small>
                    </button>
                  ) : (
                    <div className={`mk-photo-grid ${dragging ? 'over' : ''}`} {...dropZone}>
                      {photos.map((photo, index) => (
                        <div key={photo.url || photo.preview} className={`mk-photo ${index === 0 ? 'cover' : ''}`}>
                          <img src={photo.url ? imgUrl(photo.url) : photo.preview} alt={`Photo ${index + 1}`} />
                          {index === 0 ? <span className="mk-cover-tag">Cover</span> : <button type="button" className="mk-photo-cover" onClick={() => makeCover(index)}>Make cover</button>}
                          <button type="button" className="mk-photo-x" onClick={() => removePhoto(index)} aria-label={`Remove photo ${index + 1}`}>✕</button>
                        </div>
                      ))}
                      {photos.length < MAX_PHOTOS && (
                        <button type="button" className="mk-photo-add" onClick={() => fileInput.current?.click()} disabled={busyPhotos}>
                          <span>{busyPhotos ? '⏳' : '＋'}</span>
                          {busyPhotos ? 'Preparing…' : 'Add more'}
                        </button>
                      )}
                    </div>
                  )}
                  <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addPhotos} />
                  <div className="mk-sell-meta">
                    <span>{photos.length}/{MAX_PHOTOS} photos</span>
                    <span>Tip: bright, clear photos of the real item get far more chats.</span>
                  </div>
                </Section>

                {/* 3. details */}
                <Section n="3" id="sec-details" title="Details" hint="Help buyers find your ad and know exactly what they’re getting.">
                  {(fields.length > 0 || hasOrigin(form.category, form.sub) || cat.condition) && (
                    <div className="mk-sell-group">
                      <h3 className="mk-sell-sub">About the item</h3>
                      <div className="mk-form-grid">
                        {fields.map((field) => (
                          <FieldInput key={field.key} f={field} value={form.attrs[field.key]} attrs={{ ...form.attrs, _models: models }} onChange={setAttr(field.key)} />
                        ))}
                        {hasOrigin(form.category, form.sub) && (
                          <label className="os-field">
                            <span>Where is it from?</span>
                            <select value={form.origin || ''} onChange={set('origin')}>
                              <option value="">Not sure / don’t say</option>
                              {originsOf(data).map((item) => <option key={item.key} value={item.key}>{originChoice(item, form.category)}</option>)}
                            </select>
                            {FOOD_CATS.includes(form.category) && form.origin && form.origin !== 'local' && !form.attrs.brand && <small className="os-muted">Imported? Add the brand name above, so buyers can tell it apart.</small>}
                          </label>
                        )}
                        {cat.condition && (
                          <label className="os-field">
                            <span>Condition *</span>
                            <select value={form.condition} onChange={set('condition')} required>
                              <option value="">Choose…</option>
                              {cat.condition.map((item) => <option key={item}>{item}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="mk-sell-group">
                    <h3 className="mk-sell-sub">Title and description</h3>
                    <label className="os-field">
                      <span className="mk-label-row">Title * <small className="mk-counter">{form.title.length}/90</small></span>
                      <input value={form.title} onChange={set('title')} required minLength={5} maxLength={90} placeholder={suggestedTitle || 'e.g. Toyota Vitz 2015, very clean'} />
                      {suggestedTitle && !form.title && (
                        <button type="button" className="mk-suggest-title" onClick={() => setForm((previousForm) => ({ ...previousForm, title: suggestedTitle }))}>Use “{suggestedTitle}”</button>
                      )}
                      <small className="mk-field-help">Say what it is: brand, model, size. Avoid ALL CAPS and “urgent”.</small>
                    </label>
                    <ProductHint title={form.title} category={form.category} sub={form.sub} value={form.product || ''} onChange={setProduct} />
                    <StorePicker value={form.store || ''} onChange={setStore} />
                    <label className="os-field mk-mt">
                      <span className="mk-label-row">Description * <small className="mk-counter">{form.description.length}/5000</small></span>
                      <textarea rows={6} value={form.description} onChange={set('description')} required minLength={20} maxLength={5000} placeholder="Condition, features, accessories included, why you’re selling…" />
                      {form.description.length > 0 && form.description.trim().length < 20 && <small className="mk-field-help">{20 - form.description.trim().length} more characters needed</small>}
                    </label>
                  </div>
                </Section>

                {/* 4. price & location */}
                <Section n="4" id="sec-price" title="Price and location" hint="Buyers filter by price and county, so fill these in to show up in more searches.">
                  <div className="mk-sell-group">
                    <h3 className="mk-sell-sub">Pricing</h3>
                    <div className="mk-form-grid">
                      {form.category === 'vehicles' && <div className="mk-span-all"><PriceGuide listing={{ category: form.category, sub: form.sub, price: Number(form.price) }} attrs={form.attrs} compact /></div>}
                      <label className="os-field">
                        <span>{per ? `Price per ${per}` : 'Price'}</span>
                        <MoneyInput value={form.price} onChange={set('price')} placeholder={per ? `Your price for one ${per}` : 'Empty = “Contact for price”'} />
                        {per === 'kifungu' && (
                          <span className="mk-chips mk-price-chips" role="group" aria-label="Quick price per kifungu">
                            {[5, 10, 20].map((amount) => <button type="button" key={amount} className={Number(form.price) === amount ? 'on' : ''} onClick={() => setForm((previousForm) => ({ ...previousForm, price: String(amount) }))}>KSh {amount}</button>)}
                          </span>
                        )}
                        {form.category === 'fresh-produce' && form.sub === 'tomatoes-onions' && <small className="os-muted">Per kg, per piece or a fungu: choose “Sold per” above. You set the price and can change it any time.</small>}
                        {per === 'kifungu' && <small className="os-muted">Most vifungu go for KSh 5 or 10. Set your own price; you can change it any time from My ads.</small>}
                      </label>
                      <label className="os-field">
                        <span>Was price <em>(optional, if it’s on offer)</em></span>
                        <MoneyInput value={form.wasPrice} onChange={set('wasPrice')} placeholder="Price before the discount" />
                        {discount > 0 && (
                          <small className={discount >= 5 && discount <= 70 ? 'ok-text' : 'danger-text'}>{discount >= 5 && discount <= 70 ? `🏷️ -${discount}%: shown in “Best discounts” on the home page for 30 days` : discount < 5 ? 'Under 5% off: not shown as a discount' : 'Over 70% off looks unreal: check the prices'}</small>
                        )}
                      </label>
                      <label className="mk-check mk-span-all">
                        <input type="checkbox" checked={form.negotiable} onChange={set('negotiable')} /> Price is negotiable
                      </label>
                    </div>
                  </div>
                  <div className="mk-sell-group">
                    <h3 className="mk-sell-sub">Location and contact</h3>
                    <div className="mk-form-grid">
                      <label className="os-field">
                        <span>County *</span>
                        <select value={form.county} onChange={set('county')} required>
                          <option value="">Choose…</option>
                          {data.counties.map((county) => <option key={county}>{county}</option>)}
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
                  </div>
                </Section>

                {/* 5. sell online */}
                {online && (
                  <Section n="5" id="sec-online" title="Sell online" optional className={`mk-online ${form.buyNow ? 'on' : ''}`}>
                    <label className="mk-switch mk-switch-card">
                      <input type="checkbox" checked={form.buyNow} onChange={set('buyNow')} />
                      <span><b>Let buyers order and pay online</b><small>They pay with M-Pesa (we pass it to you after delivery, minus {STORE_INFO.commissionPercent}%) or cash on delivery. You get an alert for every order.</small></span>
                    </label>
                    {form.buyNow && (
                      <>
                        <div className="mk-sell-group">
                          <h3 className="mk-sell-sub">Stock</h3>
                          <div className="mk-form-grid">
                            <label className="os-field">
                              <span>Quantity in stock *</span>
                              <input type="number" inputMode="numeric" min="1" max="100000" value={form.stock} onChange={set('stock')} required placeholder="e.g. 10" />
                            </label>
                            <label className="os-field">
                              <span>Weight per item, about (kg)</span>
                              <input type="number" inputMode="decimal" min="0" max="5000" step="0.1" value={form.weightKg} onChange={set('weightKg')} placeholder="e.g. 0.5" />
                              <small className="os-muted">Light parcels (under 5 kg) close by get free delivery from our agents.</small>
                            </label>
                          </div>
                        </div>
                        <div className="mk-sell-group">
                          <h3 className="mk-sell-sub">Delivery and pick-up</h3>
                          <div className="mk-sell-toggles">
                            <label className="mk-check"><input type="checkbox" checked={form.delivery.available} onChange={setIn('delivery', 'available')} /> I deliver</label>
                            <label className="mk-check"><input type="checkbox" checked={form.delivery.pickup} onChange={setIn('delivery', 'pickup')} /> Buyers can pick up from me</label>
                          </div>
                          {form.delivery.available && (
                            <div className="mk-form-grid mk-mt">
                              <label className="os-field">
                                <span>Delivery fee</span>
                                <MoneyInput value={form.delivery.fee} onChange={setIn('delivery', 'fee')} placeholder="0 = free delivery" />
                              </label>
                              <label className="os-field">
                                <span>Delivery time</span>
                                <input value={form.delivery.days} onChange={setIn('delivery', 'days')} maxLength={40} placeholder="e.g. Same day in Nairobi, 1-3 days elsewhere" />
                              </label>
                            </div>
                          )}
                        </div>
                        <div className="mk-sell-group">
                          <h3 className="mk-sell-sub">Payment plan</h3>
                          <label className="mk-switch mk-switch-card">
                            <input type="checkbox" checked={form.layaway.enabled} onChange={setIn('layaway', 'enabled')} />
                            <span><b>🐢 Offer Lipa Pole Pole</b><small>Buyers pay a deposit with M-Pesa (the item is reserved), then the rest weekly. You ship when it’s fully paid. {form.category === 'electronics' && ['phones', 'laptops', 'tvs', 'tablets'].includes(form.sub) ? 'Many Kenyans buy phones, laptops and TVs this way: turning it on brings you more buyers.' : 'Great for phones, TVs, furniture.'}</small></span>
                          </label>
                          {form.layaway.enabled && (
                            <div className="mk-form-grid mk-mt">
                              <label className="os-field">
                                <span>Minimum deposit</span>
                                <select value={form.layaway.minDepositPercent} onChange={setIn('layaway', 'minDepositPercent', Number)}>
                                  {[10, 20, 25, 30, 40, 50].map((item) => <option key={item} value={item}>{item}% of the price</option>)}
                                </select>
                              </label>
                              <label className="os-field">
                                <span>Pay within</span>
                                <select value={form.layaway.maxWeeks} onChange={setIn('layaway', 'maxWeeks', Number)}>
                                  {[1, 2, 3, 4, 6, 8, 12].map((item) => <option key={item} value={item}>{item} week{item > 1 ? 's' : ''}</option>)}
                                </select>
                              </label>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </Section>
                )}

                {/* 6. wholesale */}
                {online && (
                  <Section n="6" id="sec-wholesale" title="Wholesale prices" optional className={`mk-online ${form.wholesale.enabled ? 'on' : ''}`}>
                    <label className="mk-switch mk-switch-card">
                      <input type="checkbox" checked={form.wholesale.enabled} onChange={setIn('wholesale', 'enabled')} />
                      <span><b>I sell in bulk (bei ya jumla)</b><small>Lower prices for bigger quantities. Your ad also appears in the Wholesale section, and the right price is applied automatically when buyers order online.</small></span>
                    </label>
                    {form.wholesale.enabled && (
                      <div className="mk-sell-group">
                        <div className="mk-form-grid">
                          <label className="os-field">
                            <span>Sold per</span>
                            <input value={form.wholesale.unit} onChange={setIn('wholesale', 'unit')} maxLength={30} placeholder="e.g. carton, bale, crate, dozen" list="mk-units" />
                            <datalist id="mk-units">{['piece', 'carton', 'bale', 'crate', 'dozen', 'pack', 'bag', 'jerrycan', 'kg', 'ream', 'roll'].map((item) => <option key={item} value={item} />)}</datalist>
                          </label>
                          <label className="mk-check mk-check-inline">
                            <input type="checkbox" checked={form.wholesale.retail} onChange={setIn('wholesale', 'retail')} /> Also sell single units at the normal price
                          </label>
                        </div>
                        <div className="mk-tier-table" role="table" aria-label="Quantity prices">
                          <div className="mk-tier-head" role="row"><span role="columnheader">From quantity</span><span role="columnheader">Price each</span><span /></div>
                          {form.wholesale.tiers.map((tier, index) => (
                            <div key={index} className="mk-tier-line" role="row">
                              <input type="number" inputMode="numeric" min="2" aria-label={`Tier ${index + 1}: from quantity`} value={tier.minQty} onChange={setTier(index, 'minQty')} placeholder={['10', '50', '200', '1000'][index]} />
                              <MoneyInput min="1" aria-label={`Tier ${index + 1}: price each`} value={tier.price} onChange={setTier(index, 'price')} placeholder={form.price ? String(Math.round(Number(form.price) * [0.9, 0.82, 0.75, 0.7][index])) : ''} />
                              {form.wholesale.tiers.length > 1 ? <button type="button" className="os-icon-btn" aria-label="Remove this price" onClick={() => setForm((previousForm) => ({ ...previousForm, wholesale: { ...previousForm.wholesale, tiers: previousForm.wholesale.tiers.filter((_, position) => position !== index) } }))}>✕</button> : <span />}
                            </div>
                          ))}
                        </div>
                        {form.wholesale.tiers.length < 4 && <button type="button" className="os-linkbtn mk-mt" onClick={() => setForm((previousForm) => ({ ...previousForm, wholesale: { ...previousForm.wholesale, tiers: [...previousForm.wholesale.tiers, { minQty: '', price: '' }] } }))}>+ Add another quantity price</button>}
                      </div>
                    )}
                  </Section>
                )}

                <div className="mk-sell-submit">
                  <span className="mk-sell-submit-progress"><b>{doneCount}/{checks.length}</b> ready</span>
                  <Link to={id ? '/market/my' : '/'} className="os-btn os-btn-ghost">Cancel</Link>
                  <button className="os-btn os-btn-brand os-btn-lg" disabled={saving || busyPhotos}>{saving ? 'Saving…' : id ? 'Save changes' : 'Post ad'}</button>
                </div>
                <p className="mk-hint mk-center">By posting you agree to sell only legal items you own. Ads that break the rules are removed.</p>
              </>
            )}
          </div>

          {sub && (
            <aside className="mk-sell-side">
              <div className="mk-box mk-sell-progress">
                <div className="mk-sell-progress-top">
                  <b>Ad checklist</b>
                  <span>{percent}%</span>
                </div>
                <div className="mk-sell-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div>
                <ul>
                  {checks.map((check) => (
                    <li key={check.label} className={check.done ? 'done' : ''}>
                      <button type="button" onClick={() => goTo(check.to)}>
                        <span className="mk-sell-tick" aria-hidden="true">{check.done ? '✓' : ''}</span>
                        {check.label}
                        <span className="sr-only">{check.done ? ' (done)' : ' (to do)'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mk-box mk-sell-preview">
                <small className="mk-sell-preview-label">Preview</small>
                <div className="mk-sell-preview-img">
                  {cover ? <img src={cover} alt="" /> : <span>{cat?.icon || '📷'}</span>}
                </div>
                <div className="mk-sell-preview-body">
                  <div className="mk-price">
                    {priceText(Number(form.price))}
                    {per && Number(form.price) > 0 && <small className="mk-per">/ {per}</small>}
                    {discount >= 5 && discount <= 70 && <s className="mk-was">{priceText(Number(form.wasPrice))}</s>}
                  </div>
                  <h3>{form.title || suggestedTitle || 'Your ad title'}</h3>
                  <small>📍 {[form.area, form.county].filter(Boolean).join(', ') || 'Your location'}</small>
                </div>
              </div>
            </aside>
          )}
        </form>
      </div>
    </div>
  );
}

// the pop-ups go in the shop's root (.os: its colours and fonts), outside the page's fade-in wrapper (a transform
// would pin a fixed pop-up to the page instead of the screen)
const portalRoot = () => document.querySelector('.os') || document.body;

// After choosing a category: its types pop up at the top of the screen, as big buttons (a search box when there are
// many). Tapping one fills in "Type" and moves on to the photos. Esc, ✕ or a tap outside closes it (the dropdown
// below still works).
function TypePicker({ cat, value, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const panel = useRef(null);
  useEffect(() => {
    const key = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    panel.current?.querySelector('input, button.mk-type-opt')?.focus({ preventScroll: true });
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // the page behind stays still
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = scroll;
    };
  }, [onClose]);
  const words = query.trim().toLowerCase();
  const subs = cat.subs.filter((sub) => !words || sub.name.toLowerCase().includes(words) || (sub.synonyms || []).some((word) => word.toLowerCase().includes(words)));
  // on document.body: the page's fade-in wrapper (a transform) would otherwise pin it to the page, not the screen
  return createPortal(
    <div className="mk-type-wrap" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="mk-type-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="mk-type-title">
        <div className="mk-type-head">
          <span className="mk-type-icon" aria-hidden="true">{cat.icon}</span>
          <div>
            <small>{cat.name}</small>
            <h3 id="mk-type-title">What type is it?</h3>
          </div>
          <button type="button" className="os-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {cat.subs.length > 8 && (
          <input className="mk-type-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${cat.name.toLowerCase()} types…`} aria-label="Search types" />
        )}
        <div className="mk-type-list" role="listbox" aria-labelledby="mk-type-title">
          {subs.map((sub) => (
            <button type="button" key={sub.slug} role="option" aria-selected={value === sub.slug} className={`mk-type-opt ${value === sub.slug ? 'on' : ''} ${sub.other ? 'other' : ''}`} onClick={() => onPick(sub.slug)}>
              {sub.name}{sub.other && <small>not listed above</small>}
            </button>
          ))}
          {!subs.length && <p className="os-muted">No type matches “{query}”. Pick “{(cat.subs.find((sub) => sub.other) || {}).name || 'Other'}”.</p>}
        </div>
      </div>
    </div>,
    portalRoot()
  );
}

// One guided step, on top of the screen: "Step 3 of 9", the question, its field(s), Back / Next (Finish on the last one).
// Enter goes on (not in a description box); Esc or ✕ closes it and leaves the whole form to fill in.
function GuidePopup({ step, index, total, category, sub, onBack, onNext, onShown, onClose }) {
  const [problem, setProblem] = useState('');
  const panel = useRef(null);
  // the first step shown stays put (adding a photo doesn't jump ahead: they may add more)
  useEffect(() => {
    onShown?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setProblem('');
    const field = panel.current?.querySelector('.mk-guide-body input:not([type=checkbox]), .mk-guide-body select, .mk-guide-body textarea, .mk-guide-body button');
    field?.focus({ preventScroll: true });
  }, [step.key]);
  useEffect(() => {
    const key = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = scroll;
    };
  }, [onClose]);
  const next = () => setProblem(onNext() || '');
  const empty = !step.done();
  return createPortal(
    <div className="mk-type-wrap mk-guide-wrap">
      <div className="mk-type-panel mk-guide-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="mk-guide-title"
        onKeyDown={(event) => { if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA' && event.target.tagName !== 'BUTTON') { event.preventDefault(); next(); } }}>
        <div className="mk-guide-progress" aria-hidden="true"><i style={{ width: `${Math.round(((index + 1) / total) * 100)}%` }} /></div>
        <div className="mk-type-head">
          <span className="mk-type-icon" aria-hidden="true">{step.icon}</span>
          <div>
            <small>Step {index + 1} of {total} · {sub?.name || category?.name}</small>
            <h3 id="mk-guide-title">{step.title}{step.required ? ' *' : ''}</h3>
          </div>
          <button type="button" className="os-icon-btn" onClick={onClose} aria-label="Close and fill in the form">✕</button>
        </div>
        {step.hint && <p className="mk-guide-hint">{step.hint}</p>}
        {!step.required && empty && <p className="mk-guide-optional">Optional: tap Next to leave it empty.</p>}
        <div className="mk-guide-body">{step.render()}</div>
        {problem && <p className="mk-guide-problem" role="alert">{problem}</p>}
        <div className="mk-guide-actions">
          {onBack ? <button type="button" className="os-btn os-btn-ghost" onClick={onBack}>← Back</button> : <span />}
          <button type="button" className="os-btn os-btn-brand mk-guide-next" onClick={next}>{index + 1 >= total ? 'Finish ✓' : 'Next →'}</button>
        </div>
      </div>
    </div>,
    portalRoot()
  );
}
