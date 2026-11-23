// ⭐ Reviews of Kapu itself: buyers and sellers rate how we served them (stars + a comment), for everyone to see.
// Every review comes from a real customer (an order, a sale, an ad or an errand); negative ones are never hidden.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useSeo } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { STORE_INFO } from '../shop/storeInfo';
import { StarPick, Stars } from './Trust';
import './market.css';

const TOPICS = [['buying', 'Buying'], ['selling', 'Selling'], ['delivery', 'Delivery'], ['payments', 'Payments (M-Pesa)'], ['support', 'Customer care'], ['other', 'Something else']];
const ROLE = { buyer: 'Buyer', seller: 'Seller', both: 'Buyer & seller' };
const dateText = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function ReviewCard({ review }) {
  return (
    <article className="mk-review mk-os-review">
      <div className="mk-review-top">
        <Stars value={review.rating} label={false} />
        <b>{review.name}</b>
        <span className={`mk-os-role ${review.role}`}>{ROLE[review.role]}</span>
        {review.verified && <span className="mk-os-verified" title="Completed an order on Kapu">✔ Verified customer</span>}
        <small>{dateText(review.at)}{review.edited ? ' · edited' : ''}{review.topic && review.topic !== 'other' ? ` · ${TOPICS.find(([key]) => key === review.topic)?.[1]}` : ''}</small>
      </div>
      <p>{review.comment}</p>
      {review.reply && <p className="mk-review-reply"><b>{STORE_INFO.name} team:</b> {review.reply}</p>}
    </article>
  );
}

function RateUs({ onSaved }) {
  const { customer } = useShop();
  const [mine, setMine] = useState(null);
  const [form, setForm] = useState({ rating: 0, comment: '', topic: 'buying' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!customer) return;
    api.get('/reviews/mine').then((response) => {
      setMine(response.data);
      if (response.data.review) setForm({ rating: response.data.review.rating, comment: response.data.review.comment, topic: response.data.review.topic });
      else if (response.data.role === 'seller') setForm((previous) => ({ ...previous, topic: 'selling' }));
    }).catch(() => setMine({ canReview: false }));
  }, [customer]);
  if (!customer) return <div className="mk-box mk-rate-us" id="rate"><b>Used {STORE_INFO.name}? Tell everyone how it went.</b><p className="os-muted">Log in to rate us. Only real buyers and sellers can post a review.</p><Link className="os-btn os-btn-brand" to="/login?next=reviews">Log in to rate us</Link></div>;
  if (!mine) return null;
  if (!mine.canReview) return <div className="mk-box mk-rate-us" id="rate"><b>Rate us after your first order, sale or ad</b><p className="os-muted">So every review here comes from someone who really used {STORE_INFO.name}.</p><Link className="os-btn os-btn-ghost" to="/">Start shopping</Link> <Link className="os-btn os-btn-ghost" to="/market/sell">Post an ad</Link></div>;
  if (mine.review && !editing) {
    return (
      <div className="mk-box mk-rate-us" id="rate">
        <b>Your review of {STORE_INFO.name}</b>
        <ReviewCard review={mine.review} />
        <button type="button" className="os-linkbtn" onClick={() => setEditing(true)}>Edit my review</button>
      </div>
    );
  }
  const send = async (event) => {
    event.preventDefault();
    if (!form.rating) return toast.error('Tap the stars to rate us');
    setBusy(true);
    try {
      const response = await api.post('/reviews', form);
      setMine({ ...mine, review: response.data });
      setEditing(false);
      toast.success('Asante! Your review is now public.');
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mk-box mk-rate-us mk-review-form" id="rate" onSubmit={send}>
      <b>How did {STORE_INFO.name} serve you{customer.name ? `, ${customer.name.split(' ')[0]}` : ''}?</b>
      <StarPick value={form.rating} onChange={(rating) => setForm({ ...form, rating })} label="Your rating of Kapu" />
      <label className="os-field">
        <span>What was it about?</span>
        <select value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })}>{TOPICS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
      </label>
      <label className="os-field">
        <span>Your comment *</span>
        <textarea rows={3} value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} minLength={10} maxLength={800} required placeholder="What went well? What should we do better? (shown publicly with your first name)" />
        <small className="mk-counter">{form.comment.length}/800</small>
      </label>
      <div className="os-row">
        <button className="os-btn os-btn-brand" disabled={busy || form.comment.trim().length < 10}>{busy ? 'Posting…' : mine.review ? 'Update my review' : 'Post my review'}</button>
        {editing && <button type="button" className="os-btn os-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
      <small className="os-muted">Shown as “{customer.name ? `${customer.name.split(' ')[0]}${customer.name.trim().includes(' ') ? ` ${customer.name.trim().split(/\s+/).pop()[0].toUpperCase()}.` : ''}` : 'you'}”. We never hide a review for being negative.</small>
    </form>
  );
}

export default function KapuReviews() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState({ role: '', stars: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const [list, setList] = useState([]);
  const [reload, setReload] = useState(0);
  useSeo({ title: `${STORE_INFO.name} reviews: what buyers and sellers say`, description: `Honest reviews of ${STORE_INFO.name} from real buyers and sellers in Kenya, with stars and comments. Good and bad, nothing hidden.`, path: '/reviews' });
  useEffect(() => {
    let live = true;
    api.get('/reviews', { params: { ...filter, page } }).then((response) => {
      if (!live) return;
      setData(response.data);
      setList((previous) => (page === 1 ? response.data.reviews : [...previous, ...response.data.reviews]));
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [filter, page, reload]);
  const choose = (change) => {
    setPage(1);
    setFilter({ ...filter, ...change });
  };
  const total = data?.count || 0;

  return (
    <div className="mk"><div className="mk-wrap mk-os-reviews">
        <section className="mk-work-hero">
          <h1>⭐ What our customers say</h1>
          <p>Real reviews of {STORE_INFO.name} from buyers and sellers: how we served them, good and bad. Every review comes from someone who ordered, sold or posted an ad here.</p>
        </section>

        <section className="mk-box mk-os-summary" aria-label="Rating summary">
          <div className="mk-review-big"><b>{total ? data.avg.toFixed(1) : '–'}</b><Stars value={data?.avg || 0} label={false} size={22} /><small>{total} review{total === 1 ? '' : 's'}</small></div>
          <div className="mk-review-bars">
            {(data?.stars || []).map((row) => (
              <button type="button" key={row.stars} className={String(filter.stars) === String(row.stars) ? 'on' : ''} onClick={() => choose({ stars: String(filter.stars) === String(row.stars) ? '' : row.stars })}>
                <span>{row.stars}★</span><i><em style={{ width: `${total ? (row.count / total) * 100 : 0}%` }} /></i><small>{row.count}</small>
              </button>
            ))}
          </div>
          <div className="mk-os-sides">
            <div><small>Buyers rate us</small><b>{data?.buyers?.count ? `${data.buyers.avg.toFixed(1)} ★` : '–'}</b><small>{data?.buyers?.count || 0} review{data?.buyers?.count === 1 ? '' : 's'}</small></div>
            <div><small>Sellers rate us</small><b>{data?.sellers?.count ? `${data.sellers.avg.toFixed(1)} ★` : '–'}</b><small>{data?.sellers?.count || 0} review{data?.sellers?.count === 1 ? '' : 's'}</small></div>
          </div>
        </section>

        <RateUs onSaved={() => { setPage(1); setReload((value) => value + 1); }} />

        <div className="mk-os-filters">
          <div className="mk-chips">
            {[['', 'Everyone'], ['buyer', 'Buyers'], ['seller', 'Sellers']].map(([key, text]) => <button type="button" key={key} className={filter.role === key ? 'on' : ''} onClick={() => choose({ role: key })}>{text}</button>)}
          </div>
          <select value={filter.sort} onChange={(event) => choose({ sort: event.target.value })} aria-label="Sort reviews">
            <option value="newest">Newest first</option>
            <option value="highest">Highest rated</option>
            <option value="lowest">Lowest rated</option>
          </select>
        </div>
        {filter.stars && <p className="os-muted">Showing {filter.stars}★ reviews · <button type="button" className="os-linkbtn" onClick={() => choose({ stars: '' })}>show all</button></p>}
        {data && !list.length && <div className="mk-empty"><p>No reviews {filter.role || filter.stars ? 'here ' : ''}yet. {filter.role || filter.stars ? '' : 'Be the first to rate us!'}</p></div>}
        <div className="mk-os-list">{list.map((review) => <ReviewCard key={review._id} review={review} />)}</div>
        {data && page < data.pages && <p className="mk-center"><button type="button" className="os-btn os-btn-ghost" onClick={() => setPage(page + 1)}>Show more reviews</button></p>}
      </div></div>
  );
}
