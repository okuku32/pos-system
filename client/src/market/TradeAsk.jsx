// "Are you an importer or a wholesaler?": asked once, on the Sell page, the first time someone starts selling
// (logged in, never posted an ad). Not at sign-up and not on other pages.
//   1. two buttons: 🏭 Wholesaler · 🌍 Importer (or "Neither", which stops the question for good; ✕ asks again next visit)
//   2. what they deal in (our categories) and, importers, the countries they import from
//      (importers of vehicles: the makes and models; of spare parts: the kinds of parts)
//   3. saved → back to the Sell form to post their first item
// Saved on the account (sellerTypes + trade + sellerCategories), so they show up on "Wholesalers near me" / Importers.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, errMsg, useCategories } from './marketApi';
import { useShop } from '../shop/ShopContext';
import { TradePopup } from './SellerTrade';
import { dropKind, pickTrade, tradeMissing, tradeOf, tradePayload } from './tradeRules';

const LATER = 'kapu_trade_later';
const SELL_PAGE = /^\/market\/sell\/?$/; // a new ad (not editing one)
const later = () => { try { return sessionStorage.getItem(LATER) === '1'; } catch { return false; } };
// done: a wholesaler / importer whose details are complete, or a seller who already answered
export const needsTradeAsk = (customer) => !!customer && !customer.tradeAsked
  && !((customer.sellerTypes || []).some((kind) => kind === 'wholesaler' || kind === 'importer') && !tradeMissing(customer.sellerTypes || [], tradeOf(customer.trade)));

export default function TradeAsk() {
  const { customer, setCustomer } = useShop();
  const { pathname } = useLocation();
  const onSellPage = SELL_PAGE.test(pathname);
  const asking = onSellPage && needsTradeAsk(customer);
  // first time selling? (never posted an ad) — only checked on the Sell page
  const [firstTime, setFirstTime] = useState(null);
  const me = customer?._id;
  useEffect(() => {
    if (!asking || !me) return undefined;
    let live = true;
    api.get('/market/mine?count=1').then((response) => live && setFirstTime(response.data.count === 0)).catch(() => live && setFirstTime(false));
    return () => { live = false; };
  }, [asking, me]);
  const data = useCategories();
  const [step, setStep] = useState('ask'); // ask → trade
  const [kind, setKind] = useState(null);
  const [trade, setTrade] = useState(null);
  const [cats, setCats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(later);
  if (hidden || !asking || !firstTime) return null;
  const categories = data?.categories || [];
  const countries = data?.importCountries || [];
  const types = customer?.sellerTypes || [];
  const close = () => { try { sessionStorage.setItem(LATER, '1'); } catch { /* private mode */ } setHidden(true); };

  const choose = (picked) => {
    setKind(picked);
    setTrade(tradeOf(customer.trade));
    setCats(customer.sellerCategories || []);
    setStep('trade');
  };
  const pick = (field, key, max) => {
    const result = pickTrade(trade, cats, field, key, max);
    if (result.error) return toast.error(result.error);
    setCats(result.categories);
    setTrade(result.trade);
    return undefined;
  };
  const save = async (body) => {
    setBusy(true);
    try {
      const response = await api.put('/customers/me', body);
      setCustomer(response.data);
      return response.data;
    } catch (error) {
      toast.error(errMsg(error));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    const nextTypes = [kind, ...types.filter((item) => item !== kind)].slice(0, 5);
    const missing = tradeMissing(nextTypes, trade);
    if (missing) return toast.error(missing);
    const saved = await save({ sellerTypes: nextTypes, sellerCategories: cats, trade: tradePayload(nextTypes, trade), tradeAsked: true });
    if (saved) {
      toast.success(kind === 'importer' ? 'Saved: buyers looking for importers will find you. Now post your first item.' : 'Saved: buyers looking for wholesalers will find you. Now post your first item.');
      setHidden(true); // back to the Sell form
    }
    return undefined;
  };
  const neither = async () => { if (await save({ tradeAsked: true })) setHidden(true); };

  if (step === 'trade') {
    return <TradePopup kind={kind} categories={categories} countries={countries} trade={trade} onPick={pick} onRemove={() => { setTrade(dropKind(trade, kind)); setStep('ask'); }} onClose={finish} />;
  }

  // step 1: the question
  return createPortal(
    <div className="os os-types-pop os-trade-ask" role="dialog" aria-modal="true" aria-labelledby="os-trade-ask-title">
      <button type="button" className="os-types-backdrop" aria-label="Ask me later" tabIndex={-1} onClick={close} />
      <section className="os-types-panel">
        <header>
          <button type="button" className="os-trade-ask-x" onClick={close} aria-label="Ask me later">✕</button>
          <h2 id="os-trade-ask-title">👋 {customer.name.split(' ')[0]}, before your first ad: are you an importer or a wholesaler?</h2>
          <p>Tell buyers what you deal in. They search for importers and wholesalers by what they sell and where it’s from. Asked only once.</p>
        </header>
        <div className="os-trade-ask-choices">
          <button type="button" className="os-trade-ask-choice" disabled={busy} onClick={() => choose('wholesaler')}>
            <span aria-hidden="true">🏭</span><b>Wholesaler</b><small>I sell in bulk (jumla): cartons, bales, sacks</small>
          </button>
          <button type="button" className="os-trade-ask-choice" disabled={busy} onClick={() => choose('importer')}>
            <span aria-hidden="true">🌍</span><b>Importer</b><small>I bring in goods from China, Dubai, the UK…</small>
          </button>
        </div>
        <footer>
          <button type="button" className="os-btn os-btn-ghost" disabled={busy} onClick={neither}>Neither: I’m a retailer</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
