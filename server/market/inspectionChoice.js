// 🔍 The buyer's inspection choice at checkout: two buttons, "Inspect my goods" (KSh 200 added) or "Don't inspect"
// (no inspection, no fee). This is the ONE place that decides whether an order carries the inspection fee:
//   · the choice must be exactly 'inspect' or 'none' (anything else is refused, never guessed);
//   · the fee comes from the server's constant (INSPECTION_FEE), never from the request: a client can't send a fee;
//   · "Don't inspect" together with an old-style "wanted: true" is a contradiction, and is refused;
//   · no choice at all (an older app) means no inspection: the buyer is never charged by default.
// The Order model checks the same rule again before saving (an order marked 'none' can't carry an inspection fee).
const httpError = require('../utils/httpError');
const { INSPECTION_FEE } = require('./fieldwork');

const CHOICES = Object.freeze(['inspect', 'none']);
const ASK = 'Choose “Inspect my goods” or “Don’t inspect”.';

// req.body.inspection → { inspect, choice, notes-free }. Throws a 400 on anything ambiguous.
function readChoice(input) {
  if (input === undefined || input === null) return { inspect: false, choice: 'none', explicit: false };
  if (typeof input !== 'object' || Array.isArray(input)) throw httpError(ASK);
  const hasChoice = Object.prototype.hasOwnProperty.call(input, 'choice');
  if (hasChoice && (typeof input.choice !== 'string' || !CHOICES.includes(input.choice))) throw httpError(ASK);
  const legacyYes = input.wanted === true; // older app versions: a real boolean only (never the text "true")
  if (hasChoice && input.choice === 'none' && legacyYes) throw httpError(`You chose “Don’t inspect” and asked for an inspection. ${ASK}`);
  const inspect = hasChoice ? input.choice === 'inspect' : legacyYes;
  return { inspect, choice: inspect ? 'inspect' : 'none', explicit: hasChoice };
}

// the fee for one seller's order: KSh 200 when the buyer chose to inspect, otherwise nothing
const inspectionFee = (choice) => (choice === 'inspect' ? INSPECTION_FEE : 0);

// the last check before an order is saved: "Don't inspect" orders never carry an inspection or its fee
// (orders from before the two buttons have no recorded choice and are left as they were)
function assertNoFeeWithoutConsent(order) {
  if (order.inspectionChoice === 'none' && (order.inspection?.fee > 0 || order.inspection?.status)) {
    throw httpError('An inspection fee can only be added when the buyer chooses “Inspect my goods”.', 409);
  }
  if (order.inspectionChoice === 'inspect' && order.inspection?.fee != null && order.inspection.fee !== INSPECTION_FEE) {
    throw httpError('The inspection fee is a fixed KSh 200.', 409);
  }
}

module.exports = { CHOICES, readChoice, inspectionFee, assertNoFeeWithoutConsent, INSPECTION_FEE };
