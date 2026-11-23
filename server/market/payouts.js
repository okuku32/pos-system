// What our riders & shopping agents earn, and paying them.
//
// Every job has an agent fee (what the buyer paid for the delivery / inspection / courier handling).
// Kapu keeps a share of it: our commission (10%) + tax (5%) = 15% by default (Admin → Settings).
//   · fee paid to Kapu (M-Pesa orders, inspections, courier): we send the agent the rest, by M-Pesa,
//     30 minutes after the job is done (time to report a problem)
//   · fee collected by the agent (cash / M-Pesa on delivery): the 15% is charged to their account and taken
//     off their next payout
//   · courier fares the agent paid for the buyer are refunded in full (no commission on them)
// Each M-Pesa transfer is a Payout record linked to its jobs.
const Task = require('../models/Task');
const Payout = require('../models/Payout');
const Customer = require('../models/Customer');
const { site } = require('../config/site');
const { emitCustomer, emitAdmin } = require('../utils/realtime');

const rates = () => {
  const fieldwork = site().fieldwork;
  return { commissionPercent: fieldwork.commissionPercent ?? 10, taxPercent: fieldwork.taxPercent ?? 5, delayMin: fieldwork.payoutDelayMin ?? 30 };
};

// gross agent fee → { gross, commission, tax, net, cash, reimburse, toPay }
// toPay < 0: the agent collected the fee themselves and owes us our share
function split(gross = 0, cash = 0, reimburse = 0) {
  const ratesResult = rates();
  const amount = Math.max(0, Math.round(gross));
  const commission = Math.round((amount * ratesResult.commissionPercent) / 100);
  const tax = Math.round((amount * ratesResult.taxPercent) / 100);
  const net = amount - commission - tax;
  const sum = Math.max(0, Math.round(cash));
  const re = Math.max(0, Math.round(reimburse));
  return { gross: amount, commission, tax, net, cash: sum, reimburse: re, toPay: net - sum + re };
}

// a job is done: work out the money and start the 30-minute hold
function settleTask(task, now = new Date()) {
  if (task.worker) require('./directory').touch(task.worker); // riders / shopping agents tables
  const splitResult = split(task.fee || 0, task.collectCash || 0, task.reimburse || 0);
  task.money = splitResult;
  task.pay = splitResult.net; // what the agent earns from this job (after our 15%)
  const status = splitResult.toPay > 0 ? 'waiting' : splitResult.toPay < 0 ? 'owed' : 'none';
  task.payout = { status, dueAt: new Date(now.getTime() + rates().delayMin * 60000) };
  return task;
}

// ---------------------------------------------------------------- the M-Pesa run (every minute)
const OPEN = ['waiting', 'due', 'owed'];
let running = false;
async function runPayouts(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  const sent = [];
  try {
    const settings = site();
    const b2c = require('../utils/mpesa').b2cReady();
    // agents with something past the hold (or carried over)
    const workers = await Task.distinct('worker', { status: 'done', $or: [{ 'payout.status': 'waiting', 'payout.dueAt': { $lte: now } }, { 'payout.status': 'due' }] });
    if (!workers.length) return { sent: 0 };
    // everything for every agent in three reads (not three per agent)
    const [recentFails, allTasks, people] = await Promise.all([
      // a failed transfer: wait 30 minutes before trying again
      Payout.distinct('worker', { worker: { $in: workers }, status: 'failed', createdAt: { $gt: new Date(now.getTime() - 30 * 60000) }, retried: { $ne: true } }),
      Task.find({ worker: { $in: workers }, status: 'done', $or: [{ 'payout.status': 'waiting', 'payout.dueAt': { $lte: now } }, { 'payout.status': { $in: ['due', 'owed'] } }] }).lean(),
      Customer.find({ _id: { $in: workers } }).select('name phone worker.mpesaPhone').lean(),
    ]);
    const waitAfterFail = new Set(recentFails.map(String));
    const tasksOf = new Map();
    for (const task of allTasks) tasksOf.set(String(task.worker), [...(tasksOf.get(String(task.worker)) || []), task]);
    const personOf = new Map(people.map((person) => [String(person._id), person]));
    const owed = [];
    const byHand = [];
    const toPay = [];
    for (const workerId of workers) {
      if (waitAfterFail.has(String(workerId))) continue;
      const tasks = tasksOf.get(String(workerId)) || [];
      const total = tasks.reduce((sum, task) => sum + (task.money?.toPay || 0), 0);
      const ids = tasks.map((task) => task._id);
      if (total <= 0) owed.push(...ids); // they owe us (cash jobs) more than we owe them: carry it to their next jobs
      else if (!b2c && !settings.demoPayments) byHand.push(...ids); // M-Pesa transfers aren't set up: ready for an admin to send by hand
      else toPay.push([workerId, tasks]);
    }
    if (owed.length) await Task.updateMany({ _id: { $in: owed }, 'payout.status': { $in: ['waiting', 'due'] } }, { $set: { 'payout.status': 'owed' } });
    if (byHand.length) await Task.updateMany({ _id: { $in: byHand }, 'payout.status': 'waiting' }, { $set: { 'payout.status': 'due' } });
    for (const [workerId, tasks] of toPay) {
      const payout = await createPayout(workerId, tasks, b2c ? 'b2c' : 'demo', {}, personOf.get(String(workerId)));
      if (!payout) continue;
      await sendPayout(payout);
      sent.push(payout._id);
    }
  } finally {
    running = false;
  }
  return { sent: sent.length };
}

async function createPayout(workerId, tasks, method, extra = {}, known = null) {
  const customer = known || await Customer.findById(workerId).select('name phone worker.mpesaPhone').lean();
  if (!customer) return null;
  const sum = (key) => tasks.reduce((total, task) => total + (task.money?.[key] || 0), 0);
  const payout = await Payout.create({
    worker: workerId, name: customer.name, phone: customer.worker?.mpesaPhone || customer.phone, method, status: method === 'manual' ? 'paid' : 'sending',
    amount: sum('toPay'), gross: sum('gross'), commission: sum('commission'), tax: sum('tax'), cash: sum('cash'), reimburse: sum('reimburse'),
    tasks: tasks.map((task) => task._id), jobs: tasks.length, ...extra,
  });
  // claim the jobs (only those still open, so nothing is paid twice)
  await Task.updateMany({ _id: { $in: payout.tasks }, 'payout.status': { $in: OPEN } }, { $set: { 'payout.status': method === 'manual' ? 'paid' : 'sending', 'payout.payout': payout._id, ...(method === 'manual' ? { 'payout.paidAt': new Date(), 'payout.ref': payout.ref } : {}) } });
  return payout;
}

async function sendPayout(payout) {
  if (payout.method === 'demo') return markPaid(payout, `DEMO${String(payout._id).slice(-6).toUpperCase()}`);
  try {
    const pay = await require('../utils/mpesa').b2cPay({ phone: payout.phone, amount: payout.amount, remarks: `Kapu pay: ${payout.jobs} job${payout.jobs === 1 ? '' : 's'}`, occasion: `PAY${String(payout._id).slice(-8)}` });
    payout.conversationId = pay.ConversationID;
    payout.originatorId = pay.OriginatorConversationID;
    await payout.save();
  } catch (err) {
    await markFailed(payout, err.response?.data?.errorMessage || err.message);
  }
  return payout;
}

async function markPaid(paid, ref) {
  paid.status = 'paid';
  paid.ref = ref;
  paid.paidAt = new Date();
  await paid.save();
  await Task.updateMany({ 'payout.payout': paid._id }, { $set: { 'payout.status': 'paid', 'payout.paidAt': paid.paidAt, 'payout.ref': ref } });
  emitCustomer(String(paid.worker), 'work:paid', { amount: paid.amount, ref, jobs: paid.jobs });
  require('./directory').touch(paid.worker);
  emitAdmin('work:update', { payout: paid._id });
  return paid;
}
async function markFailed(failed, error, { requeue = true } = {}) {
  failed.status = 'failed';
  failed.error = String(error || 'M-Pesa didn’t accept the transfer').slice(0, 200);
  await failed.save();
  // timed out: the money may still arrive, so the jobs stay with this transfer until an admin checks and retries
  if (!requeue) { emitAdmin('work:update', { payout: failed._id }); return failed; }
  // the jobs go back to "ready", for the next try
  await Task.updateMany({ 'payout.payout': failed._id }, { $set: { 'payout.status': 'due' }, $unset: { 'payout.payout': 1 } });
  emitAdmin('work:update', { payout: failed._id });
  return failed;
}

// Safaricom's B2C result: { Result: { ResultCode, ResultDesc, ConversationID, OriginatorConversationID, TransactionID } }
async function b2cResult(body) {
  const Result = body?.Result;
  if (!Result) return false;
  const ids = [Result.ConversationID && { conversationId: String(Result.ConversationID) }, Result.OriginatorConversationID && { originatorId: String(Result.OriginatorConversationID) }].filter(Boolean);
  if (!ids.length) return false;
  // a success that arrives after a timeout still counts (the transfer was flagged, not re-sent)
  const payout = await Payout.findOne({ $or: ids, $and: [{ $or: [{ status: 'sending' }, ...(Number(Result.ResultCode) === 0 ? [{ status: 'failed', retried: { $ne: true } }] : [])] }] });
  if (!payout) return false;
  if (Result.timeout) return !!(await markFailed(payout, Result.ResultDesc, { requeue: false }));
  if (Number(Result.ResultCode) === 0) await markPaid(payout, Result.TransactionID || (Result.ResultParameters?.ResultParameter || []).find((item) => item.Key === 'TransactionReceipt')?.Value || 'MPESA');
  else await markFailed(payout, Result.ResultDesc);
  return true;
}

// ---------------------------------------------------------------- reports
// an agent's balance: sent / waiting (on hold) / ready / owed, from their finished jobs
async function balanceOf(workerId) {
  const rows = await Task.aggregate([
    { $match: { worker: workerId, status: 'done', 'payout.status': { $exists: true } } },
    { $group: { _id: '$payout.status', amount: { $sum: { $ifNull: ['$money.toPay', 0] } }, next: { $min: '$payout.dueAt' } } },
  ]);
  const by = Object.fromEntries(rows.map((row) => [row._id, row]));
  const amt = (key) => by[key]?.amount || 0;
  return {
    sent: amt('paid'), sending: amt('sending'), waiting: amt('waiting'), ready: amt('due'), owed: amt('owed'),
    balance: amt('waiting') + amt('due') + amt('owed') + amt('sending'), nextAt: by.waiting?.next || null,
  };
}

// the money from finished jobs in a period, per agent (admin) or for one agent
const MONEY = {
  jobs: { $sum: 1 }, gross: { $sum: { $ifNull: ['$money.gross', 0] } }, commission: { $sum: { $ifNull: ['$money.commission', 0] } }, tax: { $sum: { $ifNull: ['$money.tax', 0] } },
  net: { $sum: { $ifNull: ['$money.net', 0] } }, cash: { $sum: { $ifNull: ['$money.cash', 0] } }, reimburse: { $sum: { $ifNull: ['$money.reimburse', 0] } },
  sent: { $sum: { $cond: [{ $eq: ['$payout.status', 'paid'] }, { $ifNull: ['$money.toPay', 0] }, 0] } },
  open: { $sum: { $cond: [{ $in: ['$payout.status', ['waiting', 'due', 'owed', 'sending']] }, { $ifNull: ['$money.toPay', 0] }, 0] } },
  tips: { $sum: { $sum: { $ifNull: ['$tips.amount', []] } } },
};
async function earnings({ from, to, worker } = {}) {
  const match = { status: 'done', money: { $exists: true } };
  if (worker) match.worker = worker;
  if (from || to) match.doneAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const rows = await Task.aggregate([{ $match: match }, { $group: { _id: '$worker', ...MONEY, last: { $max: '$doneAt' } } }, { $sort: { gross: -1 } }]);
  return rows;
}

module.exports = { split, settleTask, runPayouts, createPayout, sendPayout, markPaid, markFailed, b2cResult, balanceOf, earnings, rates, OPEN };
