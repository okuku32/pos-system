const mongoose = require('mongoose');

// Background work (utils/jobs.js).
//  • Queued jobs: slow work done outside the request (emails…), retried with back-off if it fails.
//  • Locks ("lock:<name>"): a scheduled task (expire unpaid orders, payouts…) runs on ONE server at a time.
// Finished jobs are deleted after 3 days, and their payload is wiped as soon as they're done (it can hold
// an email address).
const jobSchema = new mongoose.Schema(
  {
    type: { type: String, required: true }, // 'email' … or 'lock' for a scheduler lock
    name: { type: String }, // locks: the task's name (unique)
    payload: mongoose.Schema.Types.Mixed,
    status: { type: String, enum: ['queued', 'running', 'done', 'failed', 'lock'], default: 'queued' },
    runAt: { type: Date, default: Date.now }, // not before
    lockedUntil: Date, // a server is working on it until then (a crashed server's job is picked up again after)
    owner: String, // which server
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    error: String,
    doneAt: Date,
  },
  { timestamps: true }
);
jobSchema.index({ status: 1, runAt: 1 }); // the worker: next job due
jobSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { type: 'lock' } }); // one lock per task
jobSchema.index({ doneAt: 1 }, { expireAfterSeconds: 3 * 24 * 3600 }); // tidy up finished jobs

module.exports = mongoose.model('Job', jobSchema);
