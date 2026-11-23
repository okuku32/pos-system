const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { settlePayment } = require('../controllers/orderController');
const { settleBoost } = require('../controllers/boostController');
const { settlePlanPayment } = require('../controllers/planController');
const { sameKey, safaricomId } = require('../security/callbackKey');
const { audit } = require('../security/audit');

// Safaricom posts payment results here (public, no login). The address carries a secret key that only
// Safaricom receives (see security/callbackKey.js); without it the result is ignored and logged.
// Always answer 200 (Safaricom retries otherwise), then match the payment to what it was for.
const ok = (res) => res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
const keyed = (handler) =>
  asyncHandler(async (req, res) => {
    ok(res);
    if (!sameKey(req.params.key)) {
      audit(req, 'mpesa.callback_rejected', { outcome: 'denied', detail: `bad key on ${req.path.replace(/\/[^/]+$/, '/…')}` });
      return;
    }
    await handler(req);
  });

const stk = async (req) => {
  const cb = req.body?.Body?.stkCallback;
  const id = safaricomId(cb?.CheckoutRequestID);
  if (!id) return;
  const items = Array.isArray(cb.CallbackMetadata?.Item) ? cb.CallbackMetadata.Item : [];
  const get = (number) => items.find((item) => item?.Name === number)?.Value;
  const receipt = safaricomId(String(get('MpesaReceiptNumber') ?? '')) || undefined;
  const result = cb.ResultCode === 0 || cb.ResultCode === '0' ? { ok: true, receipt, amount: Number.isFinite(Number(get('Amount'))) ? Number(get('Amount')) : undefined } : { ok: false, reason: String(cb.ResultDesc || '').slice(0, 200) };
  audit(req, 'mpesa.stk_result', { detail: `${id} ${result.ok ? 'paid' : 'not paid'}` });
  if (await settlePayment(id, result)) return;
  if (await settleBoost(id, result)) return;
  if (await settlePlanPayment(id, result)) return;
  await require('../controllers/errandController').settle(id, result);
};

// riders & agents paid by M-Pesa (B2C): the result of each transfer
const b2c = async (req) => {
  const res = req.body?.Result;
  if (!res) return;
  const ConversationID = safaricomId(res.ConversationID);
  const OriginatorConversationID = safaricomId(res.OriginatorConversationID);
  if (!ConversationID && !OriginatorConversationID) return;
  await require('../market/payouts').b2cResult({ Result: { ...res, ConversationID, OriginatorConversationID } });
};
const b2cTimeout = async (req) => {
  const id = safaricomId(req.body?.Result?.ConversationID || req.body?.ConversationID);
  // a timeout is NOT a failure: the money may still arrive. Flag it for an admin; never re-send automatically.
  if (id) await require('../market/payouts').b2cResult({ Result: { ConversationID: id, ResultCode: 1, ResultDesc: 'M-Pesa timed out: check the M-Pesa statement before trying again', timeout: true } });
};

router.post('/callback/:key', keyed(stk));
router.post('/b2c/result/:key', keyed(b2c));
router.post('/b2c/timeout/:key', keyed(b2cTimeout));
// the old addresses without the key: answered (so Safaricom stops retrying) but never trusted
const ignored = asyncHandler(async (req, res) => {
  ok(res);
  audit(req, 'mpesa.callback_rejected', { outcome: 'denied', detail: `no key on ${req.path}` });
});
router.post('/callback', ignored);
router.post('/b2c/result', ignored);
router.post('/b2c/timeout', ignored);

module.exports = router;
