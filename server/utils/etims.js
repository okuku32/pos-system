// KRA eTIMS integration (OSCU: Online Sales Control Unit).
//
// Every completed sale is sent to KRA as a tax invoice. KRA answers with a receipt number, internal data
// and a receipt signature, which are printed on the receipt with a QR code customers can scan to verify.
//
// Modes (ETIMS_MODE in .env):
//   off     - nothing is sent (default)
//   mock    - simulated KRA responses for testing the flow; receipts are marked "TEST: not a valid tax invoice"
//   sandbox - KRA's eTIMS sandbox (needs your sandbox TIN, branch ID and device serial from KRA)
//   live    - KRA production
//
// Built to the OSCU API as published by KRA (selectInitOsdcInfo, saveItem, saveTrnsSalesOsdc).
// Confirm field codes against KRA's current specification and test in the sandbox before going live.
const axios = require('axios');
const crypto = require('crypto');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Setting = require('../models/Setting');

// ---------- configuration ----------
const DEFAULT_API = { sandbox: 'https://etims-api-sbx.kra.go.ke/etims-api', live: 'https://etims-api.kra.go.ke/etims-api' };
const DEFAULT_PORTAL = { sandbox: 'https://etims-sbx.kra.go.ke', live: 'https://etims.kra.go.ke' };

const cfg = () => {
  const mode = ['mock', 'sandbox', 'live'].includes(process.env.ETIMS_MODE) ? process.env.ETIMS_MODE : 'off';
  const net = mode === 'live' ? 'live' : 'sandbox';
  return {
    mode,
    enabled: mode !== 'off',
    apiUrl: (process.env.ETIMS_API_URL || DEFAULT_API[net]).replace(/\/$/, ''),
    portalUrl: (process.env.ETIMS_PORTAL_URL || DEFAULT_PORTAL[net]).replace(/\/$/, ''),
    tin: (process.env.ETIMS_TIN || '').trim().toUpperCase(), // your KRA PIN, e.g. P051234567X
    bhfId: (process.env.ETIMS_BHF_ID || '00').trim(), // branch ID ("00" = head office)
    deviceSerial: (process.env.ETIMS_DEVICE_SERIAL || '').trim(),
    traderName: process.env.ETIMS_TRADER_NAME || 'Ordersasa',
    address: process.env.ETIMS_ADDRESS || 'Imara Mall, Mombasa Road, Nairobi',
    defaultClassCode: process.env.ETIMS_DEFAULT_ITEM_CLASS || '5020230500', // item classification (KRA code list)
  };
};

// VAT categories used by eTIMS. Shop prices are VAT-inclusive.
const TAX_RATES = { A: 0, B: 16, C: 0, D: 0, E: 8 };
const TAX_LABELS = { A: 'A - Exempt', B: 'B - VAT 16%', C: 'C - Zero rated', D: 'D - Non-VAT', E: 'E - VAT 8%' };
const PAYMENT_CODES = { cash: '01', mpesa: '06' }; // 01 cash, 06 mobile money

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Dates in Kenyan time: yyyyMMdd and yyyyMMddHHmmss
function eatParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d)
    .reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return { date: `${p.year}${p.month}${p.day}`, dateTime: `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}` };
}

// ---------- KRA API calls ----------
async function kraPost(endpoint, body, { withKey = true } = {}) {
  const c = cfg();
  const headers = { 'Content-Type': 'application/json', tin: c.tin, bhfId: c.bhfId };
  if (withKey) {
    const cmcKey = await Setting.get('etims.cmcKey');
    if (!cmcKey) throw new Error('eTIMS device is not initialised yet (Settings → eTIMS → Initialise device)');
    headers.cmcKey = cmcKey;
  }
  const { data } = await axios.post(`${c.apiUrl}${endpoint}`, body, { headers, timeout: 15000 });
  if (data?.resultCd !== '000' && data?.resultCd !== '001') {
    const err = new Error(`KRA ${data?.resultCd || '?'}: ${data?.resultMsg || 'request rejected'}`);
    err.kra = data;
    throw err;
  }
  return data;
}

// One-time device initialisation: KRA returns the communication key used for all later calls
async function initDevice() {
  const c = cfg();
  if (!c.enabled) throw new Error('eTIMS is off. Set ETIMS_MODE in server/.env');
  if (c.mode === 'mock') {
    await Setting.set('etims.cmcKey', 'MOCK-' + crypto.randomBytes(8).toString('hex'));
    await Setting.set('etims.device', { sdcId: 'KRACU-TEST-0001', mrcNo: 'TEST-MRC', initialisedAt: new Date() });
    return { ok: true, message: 'Test mode: simulated device initialised' };
  }
  if (!c.tin || !c.deviceSerial) throw new Error('Set ETIMS_TIN and ETIMS_DEVICE_SERIAL in server/.env first');
  const data = await kraPost('/selectInitOsdcInfo', { tin: c.tin, bhfId: c.bhfId, dvcSrlNo: c.deviceSerial }, { withKey: false });
  const info = data?.data?.info || {};
  if (!info.cmcKey) throw new Error('KRA did not return a communication key: ' + (data?.resultMsg || 'unknown'));
  await Setting.set('etims.cmcKey', info.cmcKey);
  await Setting.set('etims.device', { sdcId: info.sdcId, mrcNo: info.mrcNo, dvcId: info.dvcId, taxprNm: info.taxprNm, bhfNm: info.bhfNm, initialisedAt: new Date() });
  return { ok: true, message: `Device initialised${info.taxprNm ? ` for ${info.taxprNm}` : ''}` };
}

// KRA item code: country + product type + packaging unit + quantity unit + sequence, e.g. KE2NTU0000012
async function ensureItemRegistered(product) {
  const c = cfg();
  if (product.etimsItemCode && product.etimsRegistered) return product.etimsItemCode;
  // Test mode: use a stand-in code and don't mark the product as registered, so the real
  // sandbox/live registration still happens later
  if (c.mode === 'mock') return `KE2NTU${String(product._id).slice(-7).toUpperCase()}`;
  const seq = await Setting.next('etims.itemSeq');
  const itemCd = product.etimsItemCode || `KE2NTU${String(seq).padStart(7, '0')}`;
  {
    await kraPost('/saveItem', {
      tin: c.tin, bhfId: c.bhfId, itemCd,
      itemClsCd: product.etimsClassCode || c.defaultClassCode,
      itemTyCd: '2', itemNm: product.name.slice(0, 200), itemStdNm: null, orgnNatCd: 'KE',
      pkgUnitCd: 'NT', qtyUnitCd: 'U', taxTyCd: product.taxType || 'B',
      btchNo: null, bcd: product.barcode || null, dftPrc: product.price,
      grpPrcL1: product.price, grpPrcL2: product.price, grpPrcL3: product.price, grpPrcL4: product.price, grpPrcL5: null,
      addInfo: null, sftyQty: null, isrcAplcbYn: 'N', useYn: 'Y',
      regrNm: 'Ordersasa POS', regrId: 'POS', modrNm: 'Ordersasa POS', modrId: 'POS',
    });
  }
  await Product.updateOne({ _id: product._id }, { $set: { etimsItemCode: itemCd, etimsRegistered: true } });
  return itemCd;
}

// ---------- build the invoice ----------
async function buildInvoice(sale, invcNo) {
  const c = cfg();
  const products = await Product.find({ _id: { $in: sale.items.map((i) => i.product) } });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  // Spread any order-level discount across lines so line totals add up to what the customer paid
  const gross = sale.items.reduce((s, i) => s + i.subtotal, 0) || 1;
  const orderDisc = Number(sale.discount) || 0;

  const totals = { A: [0, 0], B: [0, 0], C: [0, 0], D: [0, 0], E: [0, 0] }; // [taxable, tax]
  const itemList = [];
  for (let n = 0; n < sale.items.length; n++) {
    const i = sale.items[n];
    const p = byId.get(String(i.product)) || { _id: i.product, name: i.name, price: i.listPrice || i.price, taxType: 'B' };
    const taxTy = TAX_RATES[p.taxType] !== undefined ? p.taxType : 'B';
    const itemCd = await ensureItemRegistered(p);
    const unit = i.listPrice || i.price;
    const splyAmt = r2(unit * i.quantity);
    const lineTotal = r2(i.subtotal - (orderDisc * i.subtotal) / gross);
    const dcAmt = r2(splyAmt - lineTotal);
    const rate = TAX_RATES[taxTy];
    const taxAmt = r2((lineTotal * rate) / (100 + rate)); // prices include VAT
    totals[taxTy][0] += lineTotal;
    totals[taxTy][1] += taxAmt;
    itemList.push({
      itemSeq: n + 1, itemCd, itemClsCd: p.etimsClassCode || c.defaultClassCode, itemNm: i.name, bcd: p.barcode || null,
      pkgUnitCd: 'NT', pkg: i.quantity, qtyUnitCd: 'U', qty: i.quantity, prc: unit, splyAmt,
      dcRt: splyAmt ? r2((dcAmt / splyAmt) * 100) : 0, dcAmt,
      isrccCd: null, isrccNm: null, isrcRt: null, isrcAmt: null,
      taxTyCd: taxTy, taxblAmt: lineTotal, taxAmt, totAmt: lineTotal,
    });
  }

  const now = eatParts(new Date(sale.updatedAt || sale.createdAt || Date.now()));
  const totTaxbl = r2(Object.values(totals).reduce((s, t) => s + t[0], 0));
  const totTax = r2(Object.values(totals).reduce((s, t) => s + t[1], 0));
  return {
    tin: c.tin, bhfId: c.bhfId, trdInvcNo: sale.receiptNo, invcNo, orgInvcNo: 0,
    custTin: sale.customerTin || null, custNm: sale.customerName || null,
    salesTyCd: 'N', rcptTyCd: 'S', pmtTyCd: PAYMENT_CODES[sale.paymentMethod] || '07', salesSttsCd: '02',
    cfmDt: now.dateTime, salesDt: now.date, stockRlsDt: now.dateTime, cnclReqDt: null, cnclDt: null, rfdDt: null, rfdRsnCd: null,
    totItemCnt: itemList.length,
    taxblAmtA: r2(totals.A[0]), taxblAmtB: r2(totals.B[0]), taxblAmtC: r2(totals.C[0]), taxblAmtD: r2(totals.D[0]), taxblAmtE: r2(totals.E[0]),
    taxRtA: 0, taxRtB: 16, taxRtC: 0, taxRtD: 0, taxRtE: 8,
    taxAmtA: r2(totals.A[1]), taxAmtB: r2(totals.B[1]), taxAmtC: r2(totals.C[1]), taxAmtD: r2(totals.D[1]), taxAmtE: r2(totals.E[1]),
    totTaxblAmt: totTaxbl, totTaxAmt: totTax, totAmt: r2(sale.total),
    prchrAcptcYn: 'N', remark: sale.order ? 'Online order' : null,
    regrId: 'POS', regrNm: 'Ordersasa POS', modrId: 'POS', modrNm: 'Ordersasa POS',
    receipt: {
      custTin: sale.customerTin || null, custMblNo: sale.mpesa?.phone || null, rptNo: null,
      trdeNm: c.traderName, adrs: c.address, topMsg: c.traderName, btmMsg: 'Thank you for shopping with us', prchrAcptcYn: 'N',
    },
    itemList,
  };
}

// ---------- submit one sale ----------
// One submission per sale at a time; a second caller waits for the one already running
const inflight = new Map();

function submitSale(saleId) {
  if (!cfg().enabled) return Promise.resolve(null);
  const key = String(saleId);
  if (inflight.has(key)) return inflight.get(key);
  const job = doSubmit(saleId).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function doSubmit(saleId) {
  const c = cfg();
  try {
    const sale = await Sale.findById(saleId);
    if (!sale || sale.status !== 'completed' || sale.etims?.status === 'submitted') return sale?.etims || null;

    // Invoice numbers must be sequential and never reused: assign once, keep on retries
    const invcNo = sale.etims?.invoiceNo || (await Setting.next('etims.invoiceNo'));
    const invoice = await buildInvoice(sale, invcNo);

    let result;
    if (c.mode === 'mock') {
      const device = (await Setting.get('etims.device')) || { sdcId: 'KRACU-TEST-0001' };
      const rcptNo = await Setting.next('etims.mockRcptNo');
      result = {
        rcptNo, totRcptNo: rcptNo, sdcId: device.sdcId,
        intrlData: crypto.randomBytes(13).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 26),
        rcptSign: crypto.randomBytes(8).toString('hex').toUpperCase(),
        sdcDateTime: eatParts().dateTime,
      };
    } else {
      const res = await kraPost('/saveTrnsSalesOsdc', invoice);
      const d = res.data || {};
      const device = (await Setting.get('etims.device')) || {};
      result = {
        rcptNo: d.curRcptNo ?? d.rcptNo, totRcptNo: d.totRcptNo, sdcId: d.sdcId || device.sdcId,
        intrlData: d.intrlData, rcptSign: d.rcptSign, sdcDateTime: d.sdcDateTime || d.vsdcRcptPbctDate,
      };
    }

    const etims = {
      status: 'submitted', mode: c.mode, invoiceNo: invcNo, ...result,
      totalTax: invoice.totTaxAmt, taxableAmount: invoice.totTaxblAmt,
      verifyUrl: result.rcptSign ? `${c.portalUrl}/common/link/etims/receipt/indexEtimsReceiptData?Data=${c.tin || 'TEST'}${c.bhfId}${result.rcptSign}` : null,
      submittedAt: new Date(), attempts: (sale.etims?.attempts || 0) + 1, error: null,
    };
    await Sale.updateOne({ _id: sale._id }, { $set: { etims } });
    return etims;
  } catch (err) {
    const sale = await Sale.findById(saleId).select('etims');
    const attempts = (sale?.etims?.attempts || 0) + 1;
    const backoffMin = Math.min(60, 2 ** Math.min(attempts, 6)); // 2, 4, 8, ... up to 60 minutes
    await Sale.updateOne(
      { _id: saleId },
      { $set: { 'etims.status': attempts >= 12 ? 'failed' : 'retrying', 'etims.error': err.message, 'etims.attempts': attempts, 'etims.nextAttemptAt': new Date(Date.now() + backoffMin * 60000) } }
    );
    console.warn(`[etims] sale ${saleId} not submitted (attempt ${attempts}): ${err.message}`);
    return null;
  }
}

// Wait briefly so cash receipts can show KRA details straight away; slow responses carry on in the background
async function submitWithTimeout(saleId, ms = 8000) {
  if (!cfg().enabled) return null;
  const job = submitSale(saleId);
  return Promise.race([job, new Promise((r) => setTimeout(() => r(null), ms))]);
}

function queueSale(saleId) {
  if (!cfg().enabled) return;
  Sale.updateOne({ _id: saleId, 'etims.status': { $exists: false } }, { $set: { 'etims.status': 'pending', 'etims.attempts': 0 } })
    .then(() => setImmediate(() => submitSale(saleId)))
    .catch(() => {});
}

// Background retries for anything not yet accepted
let timer = null;
function startWorker() {
  if (timer || !cfg().enabled) return;
  timer = setInterval(async () => {
    try {
      const due = await Sale.find({
        status: 'completed',
        'etims.status': { $in: ['pending', 'retrying'] },
        $or: [{ 'etims.nextAttemptAt': { $exists: false } }, { 'etims.nextAttemptAt': { $lte: new Date() } }],
      }).select('_id').limit(20);
      for (const s of due) await submitSale(s._id);
    } catch (err) {
      console.warn('[etims] retry worker:', err.message);
    }
  }, 60 * 1000);
  console.log(`[etims] enabled (${cfg().mode} mode)`);
}

async function status() {
  const c = cfg();
  const [device, cmcKey, counts] = await Promise.all([
    Setting.get('etims.device'),
    Setting.get('etims.cmcKey'),
    Sale.aggregate([{ $match: { 'etims.status': { $exists: true } } }, { $group: { _id: '$etims.status', n: { $sum: 1 } } }]),
  ]);
  return {
    mode: c.mode, enabled: c.enabled, apiUrl: c.mode === 'mock' || !c.enabled ? null : c.apiUrl,
    tin: c.tin || null, bhfId: c.bhfId, deviceSerial: c.deviceSerial || null,
    initialised: !!cmcKey, device,
    counts: Object.fromEntries(counts.map((x) => [x._id, x.n])),
  };
}

module.exports = { submitSale, submitWithTimeout, queueSale, startWorker, initDevice, status, buildInvoice, TAX_RATES, TAX_LABELS, cfg };
