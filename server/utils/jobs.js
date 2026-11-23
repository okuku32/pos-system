// Background jobs, safe with several servers (MongoDB does the coordination; no extra service needed).
//
//  every(name, ms, fn)        a scheduled task. Every server sets the timer, but each run takes a lock first, so
//                             it happens on exactly one server (expire unpaid orders, payouts, rider matching…).
//  enqueue(type, payload)     slow work done outside the request, e.g. sending an email. Any server can pick it up;
//  handle(type, fn)           failures are retried with back-off (30 s, 2 min, 8 min…), then marked failed.
//  start() / stop()           the queue worker (started with the server, stopped on shutdown).
const os = require('os');
const crypto = require('crypto');
const Job = require('../models/Job');

const ME = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
const handlers = new Map();
const timers = [];
let polling = null;
let busy = false;
let stopped = false;

// ---------------------------------------------------------------- scheduled tasks, one server at a time
async function takeLock(name, holdMs) {
  const now = new Date();
  try {
    const lock = await Job.findOneAndUpdate(
      { type: 'lock', name, $or: [{ lockedUntil: { $lt: now } }, { owner: ME }] },
      { $set: { status: 'lock', owner: ME, lockedUntil: new Date(now.getTime() + holdMs) }, $setOnInsert: { type: 'lock', name } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    return lock?.owner === ME;
  } catch (error) {
    if (error.code === 11000) return false; // another server holds it
    throw error;
  }
}
const release = (name) => Job.updateOne({ type: 'lock', name, owner: ME }, { $set: { lockedUntil: new Date(0) } }).catch(() => {});

function every(name, ms, fn) {
  const run = async () => {
    if (stopped) return;
    try {
      // held for most of the interval: a crashed server's lock expires before the next run
      if (!(await takeLock(name, Math.max(5000, ms * 0.9)))) return;
      await fn();
    } catch (error) {
      console.error(`[jobs] ${name}:`, error.message);
    }
  };
  const timer = setInterval(run, ms);
  timer.unref?.();
  timers.push(timer);
  return run; // callers may run it once now
}

// ---------------------------------------------------------------- the queue
const enqueue = (type, payload = {}, { delayMs = 0, maxAttempts = 5 } = {}) => Job.create({ type, payload, runAt: new Date(Date.now() + delayMs), maxAttempts });
const handle = (type, fn) => handlers.set(type, fn);
const backoff = (attempt) => Math.min(60 * 60 * 1000, 30 * 1000 * 4 ** (attempt - 1));

async function claim() {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      type: { $in: [...handlers.keys()] },
      $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedUntil: { $lt: now } }], // or a crashed server's job
    },
    { $set: { status: 'running', owner: ME, lockedUntil: new Date(now.getTime() + 5 * 60 * 1000) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: 'after' }
  ).lean();
}

async function work() {
  if (busy || stopped || !handlers.size) return 0;
  busy = true;
  let done = 0;
  try {
    for (let job = await claim(); job && !stopped && done < 20; job = await claim()) {
      done += 1;
      try {
        await handlers.get(job.type)(job.payload || {}, job);
        await Job.updateOne({ _id: job._id }, { $set: { status: 'done', doneAt: new Date(), payload: {} }, $unset: { lockedUntil: 1, error: 1 } });
      } catch (error) {
        const last = job.attempts >= job.maxAttempts;
        await Job.updateOne({ _id: job._id }, {
          $set: { status: last ? 'failed' : 'queued', error: String(error.message || error).slice(0, 300), runAt: new Date(Date.now() + backoff(job.attempts)), ...(last ? { doneAt: new Date(), payload: {} } : {}) },
          $unset: { lockedUntil: 1 },
        });
        if (last) console.error(`[jobs] ${job.type} gave up after ${job.attempts} tries:`, error.message);
      }
    }
  } finally {
    busy = false;
  }
  return done;
}

function start(intervalMs = 2000) {
  stopped = false;
  if (polling) return;
  polling = setInterval(() => work().catch((error) => console.error('[jobs] queue:', error.message)), intervalMs);
  polling.unref?.();
}
async function stop() {
  stopped = true;
  clearInterval(polling);
  polling = null;
  timers.splice(0).forEach(clearInterval);
  for (let wait = 0; busy && wait < 50; wait += 1) await new Promise((resolve) => setTimeout(resolve, 100)); // let the current job finish
}

module.exports = { every, enqueue, handle, work, start, stop, takeLock, release, ME };
