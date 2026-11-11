import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, fieldsOf, findCat, findSub, imgUrl, priceText, timeAgo, useCategories, useSeo, adultOk, confirmAdult } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { prettyPhone } from '../shop/shopApi';
import ListingCard, { AdImage } from './ListingCard';
import AdultGate from './AdultGate';
import './market.css';

const QUICK = ['Is this still available?', 'What’s your last price?', 'Where can I view it?', 'Can you deliver?'];

export default function ListingPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { customer } = useShop();
  const data = useCategories();
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(0);
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [adult, setAdult] = useState(adultOk);

  // lift the floating help buttons above the sticky Chat / Call bar on phones
  useEffect(() => {
    document.body.classList.add('mk-sticky-on');
    return () => document.body.classList.remove('mk-sticky-on');
  }, []);

  useEffect(() => {
    let live = true;
    setRes(null);
    setError('');
    setPhoto(0);
    setPhone('');
    api.get(`/market/listings/${slug}`).then((r) => live && setRes(r.data)).catch((e) => live && setError(e.response?.status === 404 ? 'gone' : errMsg(e)));
    window.scrollTo({ top: 0 });
    return () => {
      live = false;
    };
  }, [slug, customer?._id]);

  const l = res?.listing;
  const cat = findCat(data, l?.category);
  const sub = findSub(cat, l?.sub);
  const where = l ? [l.area, l.county].filter(Boolean).join(', ') : '';

  useSeo({
    title: l ? `${l.title}${l.price > 0 ? ` – ${priceText(l.price)}` : ''} | ${where}` : error === 'gone' ? 'Ad not found' : '',
    description: l ? `${priceText(l.price)}${l.negotiable ? ' (negotiable)' : ''} · ${where}. ${l.description.slice(0, 120)}` : '',
    image: l?.images?.[0],
    noindex: error === 'gone' || l?.status === 'hidden',
    path: `/market/item/${slug}`,
    jsonLd: l
      ? {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: l.title,
          description: l.description,
          image: (l.images || []).map((u) => `${window.location.origin}${u}`),
          offers: { '@type': 'Offer', priceCurrency: 'KES', ...(l.price > 0 ? { price: l.price } : {}), availability: l.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' },
        }
      : null,
  });

  const needLogin = (why) => {
    toast(why, { icon: '🔐' });
    navigate(`/shop/login?next=${encodeURIComponent(location.pathname)}`);
  };

  const showPhone = async () => {
    if (!customer) return needLogin('Log in or sign up (free) to see the seller’s number');
    try {
      const r = await api.get(`/market/listings/${l._id}/phone`);
      setPhone(r.data.phone);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const sendChat = async (text) => {
    const t = (text ?? msg).trim();
    if (!t) return;
    if (!customer) return needLogin('Log in or sign up (free) to chat with the seller');
    setSending(true);
    try {
      const r = await api.post('/market/conversations', { listingId: l._id, text: t });
      toast.success('Message sent to the seller');
      navigate(`/market/messages/${r.data.conversation._id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSending(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: l.title, text: `${l.title} – ${priceText(l.price)}`, url }).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success('Link copied');
    }
  };

  const report = async (reason) => {
    if (!customer) return needLogin('Log in to report an ad');
    try {
      const r = await api.post(`/market/listings/${l._id}/report`, { reason });
      toast.success(r.data.alreadyReported ? 'You already reported this ad' : 'Thanks, our team will review this ad');
      setReporting(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const setStatus = async (status) => {
    try {
      await api.patch(`/market/listings/${l._id}/status`, { status });
      setRes((r) => ({ ...r, listing: { ...r.listing, status } }));
      toast.success(status === 'sold' ? 'Marked as sold' : 'Your ad is live again');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (error === 'gone') {
    return (
      <div className="mk mk-wrap">
        <div className="os-empty">
          <div className="os-empty-art">🕵️</div>
          <h4>This ad is no longer available</h4>
          <p>It may have been sold or removed by the seller.</p>
          <Link className="os-btn os-btn-brand" to="/market">Browse the marketplace</Link>
        </div>
      </div>
    );
  }
  if (error) return <div className="mk mk-wrap"><p className="mk-error">{error}</p></div>;
  if (!res) {
    return (
      <div className="mk mk-wrap">
        <div className="mk-ad mk-skel-page"><div className="mk-gallery mk-skel" /><div className="mk-side"><i /><i /><i /></div></div>
      </div>
    );
  }
  if (cat?.adult && !adult) return <AdultGate onYes={() => { confirmAdult(); setAdult(true); }} />;

  const images = l.images || [];
  const facts = fieldsOf(cat, sub).filter((f) => l.attrs?.[f.key] !== undefined && l.attrs[f.key] !== '');
  const fmt = (f, v) => (f.type === 'number' && (f.key === 'mileage' || f.key === 'litres' || f.key === 'watts') ? Number(v).toLocaleString('en-KE') : String(v));
  const s = res.seller;
  const waNumber = phone && phone.replace(/\D/g, '');

  return (
    <div className="mk">
      <div className="mk-wrap">
        <nav className="mk-crumbs" aria-label="Breadcrumb">
          <Link to="/market">Marketplace</Link> › {cat && <><Link to={`/market/${cat.slug}`}>{cat.name}</Link> › </>}
          {sub && <><Link to={`/market/${cat.slug}/${sub.slug}`}>{sub.name}</Link> › </>}
          <span>{l.title}</span>
        </nav>

        {l.status === 'sold' && <div className="mk-banner sold">This item has been sold.</div>}
        {l.status === 'hidden' && <div className="mk-banner hidden">This ad was taken down by the marketplace team{l.hiddenReason ? `: ${l.hiddenReason}` : ''}. Only you can see it.</div>}

        <div className="mk-ad">
          <div className="mk-ad-main">
            <div className="mk-gallery">
              <AdImage ad={l} src={images[photo] || ''} eager className="mk-gallery-main" alt={`${l.title}${images.length > 1 ? `, photo ${photo + 1}` : ''}`} />
              {images.length > 1 && (
                <>
                  <button className="mk-gal-nav prev" onClick={() => setPhoto((p) => (p - 1 + images.length) % images.length)} aria-label="Previous photo">‹</button>
                  <button className="mk-gal-nav next" onClick={() => setPhoto((p) => (p + 1) % images.length)} aria-label="Next photo">›</button>
                  <span className="mk-gal-count">{photo + 1} / {images.length}</span>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="mk-thumbs">
                {images.map((u, i) => (
                  <button key={u} className={i === photo ? 'on' : ''} onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1}`}>
                    <img src={imgUrl(u)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            <div className="mk-ad-head mk-only-mobile">
              <h1>{l.title}</h1>
              <div className="mk-ad-price">{priceText(l.price)}{l.negotiable && l.price > 0 && <small>Negotiable</small>}</div>
              <p className="mk-ad-meta">📍 {where} · {timeAgo(l.createdAt)} · 👁 {l.views} views</p>
            </div>

            {(l.condition || facts.length > 0) && (
              <section className="mk-box">
                <h2>Details</h2>
                <dl className="mk-details">
                  {l.condition && <div className="mk-detail"><dt>Condition</dt><dd>{l.condition}</dd></div>}
                  {facts.map((f) => <div key={f.key} className="mk-detail"><dt>{f.label}</dt><dd>{fmt(f, l.attrs[f.key])}</dd></div>)}
                </dl>
              </section>
            )}

            <section className="mk-box">
              <h2>Description</h2>
              <p className="mk-desc">{l.description}</p>
            </section>
          </div>

          <aside className="mk-side">
            <div className="mk-box mk-ad-head mk-only-desktop">
              <h1>{l.title}</h1>
              <div className="mk-ad-price">{priceText(l.price)}{l.negotiable && l.price > 0 && <small>Negotiable</small>}</div>
              <p className="mk-ad-meta">📍 {where}<br />Posted {timeAgo(l.createdAt)} · 👁 {l.views} views</p>
            </div>

            {l.mine ? (
              <div className="mk-box">
                <h2>This is your ad</h2>
                <div className="mk-owner-actions">
                  <Link className="os-btn os-btn-dark" to={`/market/edit/${l._id}`}>✏️ Edit ad</Link>
                  {l.status === 'active' && <button className="os-btn os-btn-ghost" onClick={() => setStatus('sold')}>✅ Mark as sold</button>}
                  {l.status === 'sold' && <button className="os-btn os-btn-ghost" onClick={() => setStatus('active')}>↺ Sell again</button>}
                  <Link className="os-btn os-btn-ghost" to="/market/my">My ads</Link>
                </div>
              </div>
            ) : (
              <div className="mk-box mk-seller" id="contact">
                {s && (
                  <Link to={`/market/seller/${s._id}`} className="mk-seller-head">
                    <span className="mk-avatar">{s.name.slice(0, 1)}</span>
                    <span>
                      <b>{s.name}</b>
                      <small>On {new Date(s.memberSince).getFullYear() === new Date().getFullYear() ? 'the marketplace since ' + new Date(s.memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : `the marketplace since ${new Date(s.memberSince).getFullYear()}`} · {s.activeAds} ad{s.activeAds === 1 ? '' : 's'}</small>
                    </span>
                  </Link>
                )}
                {l.status === 'active' && (
                  <>
                    <div className="mk-quick">
                      {QUICK.map((qq) => <button key={qq} onClick={() => setMsg(qq)} className={msg === qq ? 'on' : ''}>{qq}</button>)}
                    </div>
                    <form className="mk-chatbox" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
                      <textarea rows={2} maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`Write to ${s?.name.split(' ')[0] || 'the seller'}…`} aria-label="Message to the seller" />
                      <button className="os-btn os-btn-brand os-block" disabled={sending}>{sending ? 'Sending…' : '💬 Chat with seller'}</button>
                    </form>
                    {l.hasPhone && (phone ? (
                      <div className="mk-phone">
                        <a className="os-btn os-btn-dark" href={`tel:+${phone}`}>📞 {prettyPhone(phone)}</a>
                        <a className="os-btn mk-btn-wa" href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi, I saw your ad "${l.title}" on Ordersasa: ${window.location.href}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                      </div>
                    ) : (
                      <button className="os-btn os-btn-ghost os-block" onClick={showPhone}>📞 Show phone number</button>
                    ))}
                  </>
                )}
              </div>
            )}

            <div className="mk-box mk-tips">
              <h2>Safety tips</h2>
              <ul>
                <li>Meet in a safe public place.</li>
                <li>Check the item before you pay.</li>
                <li>Never pay a deposit or send M-Pesa in advance.</li>
                {l.category === 'land-property' && <li>Do a land search at the Lands registry before paying anything.</li>}
                {l.category === 'vehicles' && <li>Confirm the logbook details on NTSA eCitizen.</li>}
              </ul>
            </div>

            <div className="mk-ad-links">
              <button className="os-linkbtn" onClick={share}>🔗 Share</button>
              <a className="os-linkbtn" href={`https://wa.me/?text=${encodeURIComponent(`${l.title} – ${priceText(l.price)} ${window.location.href}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              {!l.mine && <button className="os-linkbtn mk-report" onClick={() => setReporting((r) => !r)}>🚩 Report ad</button>}
            </div>
            {reporting && (
              <div className="mk-box mk-report-box">
                <b>What’s wrong with this ad?</b>
                {['It’s a scam / fraud', 'Item already sold', 'Wrong category or price', 'Prohibited item', 'Offensive content'].map((r) => (
                  <button key={r} onClick={() => report(r)}>{r}</button>
                ))}
              </div>
            )}
          </aside>
        </div>

        {res.similar?.length > 0 && (
          <section>
            <div className="mk-section-head">
              <h2>Similar {sub ? sub.name.toLowerCase() : 'ads'}</h2>
              {cat && sub && <Link className="mk-more" to={`/market/${cat.slug}/${sub.slug}`}>See all →</Link>}
            </div>
            <div className="mk-grid">{res.similar.map((ad, i) => <ListingCard key={ad._id} ad={ad} index={i} />)}</div>
          </section>
        )}
      </div>

      {!l.mine && l.status === 'active' && (
        <div className="mk-sticky-contact mk-only-mobile">
          <a href="#contact" className="os-btn os-btn-brand os-grow" onClick={(e) => { e.preventDefault(); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}>💬 Chat</a>
          {l.hasPhone && (phone ? <a className="os-btn os-btn-dark os-grow" href={`tel:+${phone}`}>📞 Call</a> : <button className="os-btn os-btn-dark os-grow" onClick={showPhone}>📞 Show number</button>)}
        </div>
      )}
    </div>
  );
}
