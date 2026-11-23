// 🆔 Field-team documents: riders (and agents / partner shops) upload their ID, driving licence, insurance… with the
// expiry dates. They see their own documents and when each one expires; our moderators open the files, check the
// expiry dates (and correct them), and approve or reject each one. The files are private (security/privateFiles):
// never public URLs, never cached, and every time a moderator opens one it's written to the audit log.
// An expired driving licence or insurance stops a rider taking NEW jobs until they upload the renewed one.
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const files = require('../security/privateFiles');
const { emitAdmin, emitCustomer } = require('../utils/realtime');

const BUCKET = 'worker-docs';
const DAY = 86400000;
const SOON_DAYS = 30; // "expiring soon"
const MOTOR = ['Motorbike', 'Tuk-tuk', 'Car', 'Van / pickup'];
// expires: true → an expiry date is required · 'optional' · false → never expires
const DOC_KINDS = {
  id: { label: 'National ID / passport', icon: '🆔', expires: false },
  licence: { label: 'Driving licence', icon: '🚦', expires: true },
  insurance: { label: 'Motor insurance', icon: '🛡️', expires: true },
  psv: { label: 'PSV / rider badge', icon: '🎫', expires: true },
  good_conduct: { label: 'Certificate of good conduct', icon: '📜', expires: 'optional' },
  logbook: { label: 'Logbook', icon: '📘', expires: false },
  permit: { label: 'Business permit', icon: '🏪', expires: true },
  other: { label: 'Other document', icon: '📄', expires: 'optional' },
};
const STOPS_JOBS = ['licence', 'insurance']; // a rider can't take new jobs with these expired
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (value) => mongoose.isValidObjectId(value);
const dateText = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// what each person on the team must have on file
function requiredKinds(worker) {
  if (!worker?.role) return [];
  if (worker.role === 'rider') return MOTOR.includes(worker.vehicle) ? ['id', 'licence', 'insurance'] : ['id'];
  if (worker.role === 'partner') return ['id', 'permit'];
  return ['id'];
}

// expired · expiring (within 30 days) · valid · none (doesn't expire)
function expiryOf(doc, now = Date.now()) {
  if (!doc.expiresAt) return { state: 'none', days: null };
  const days = Math.ceil((new Date(doc.expiresAt).getTime() - now) / DAY);
  return { state: days < 0 ? 'expired' : days <= SOON_DAYS ? 'expiring' : 'valid', days };
}

const docView = (doc, base) => ({
  _id: doc._id, kind: doc.kind, label: doc.kind === 'other' && doc.label ? doc.label : DOC_KINDS[doc.kind]?.label || doc.kind, icon: DOC_KINDS[doc.kind]?.icon || '📄',
  number: doc.number || '', expiresAt: doc.expiresAt || null, ...expiryOf(doc), status: doc.status, reviewNote: doc.reviewNote || '', reviewedAt: doc.reviewedAt || null,
  uploadedAt: doc.uploadedAt, mime: doc.mime, pdf: doc.mime === 'application/pdf', size: doc.size || 0,
  file: `${base}/${doc._id}/file`,
});

// the overview moderators and the rider see: what's missing, expired, expiring or waiting for a check
function summaryOf(worker, now = Date.now()) {
  const docs = (worker?.docs || []).filter((doc) => doc.status !== 'rejected');
  const states = docs.map((doc) => ({ doc, ...expiryOf(doc, now) }));
  const missing = requiredKinds(worker).filter((kind) => !docs.some((doc) => doc.kind === kind));
  const expired = states.filter((item) => item.state === 'expired');
  const nextExpiry = states.filter((item) => item.state !== 'expired' && item.doc.expiresAt).map((item) => new Date(item.doc.expiresAt)).sort((a, b) => a - b)[0] || null;
  const stopped = worker?.role === 'rider' ? expired.filter((item) => STOPS_JOBS.includes(item.doc.kind)) : [];
  return {
    total: (worker?.docs || []).length, missing, expired: expired.length, expiring: states.filter((item) => item.state === 'expiring').length,
    pending: docs.filter((doc) => doc.status === 'pending').length, rejected: (worker?.docs || []).filter((doc) => doc.status === 'rejected').length,
    nextExpiry,
    blocked: stopped.length ? `Your ${stopped.map((item) => DOC_KINDS[item.doc.kind].label.toLowerCase()).join(' and ')} expired on ${dateText(stopped[0].doc.expiresAt)}. Upload the renewed one (Documents) to take new jobs.` : '',
  };
}
exports.summaryOf = summaryOf;
exports.DOC_KINDS = DOC_KINDS;

// for workController.accept: why this rider can't take new jobs (an expired licence / insurance), or ''
exports.blockedReason = (worker) => summaryOf(worker).blocked;

exports.upload = files.uploader(BUCKET, { field: 'file', max: 1, pdf: true, sizeMb: 8 });

const kindsFor = (worker) => {
  const required = requiredKinds(worker);
  return Object.entries(DOC_KINDS).map(([key, value]) => ({ key, ...value, required: required.includes(key) }));
};

// GET /api/work/docs
exports.mine = asyncHandler(async (req, res) => {
  const worker = req.customer.worker;
  if (!worker?.role) throw httpError('Apply to join the field team first', 403);
  res.json({ docs: (worker.docs || []).map((doc) => docView(doc, '/work/docs')), kinds: kindsFor(worker), summary: summaryOf(worker) });
});

// POST /api/work/docs  (multipart: file, kind, number, expiresAt=YYYY-MM-DD, label)
// A new upload of the same kind replaces the old one (a renewed licence), and goes back to our team to check.
exports.add = asyncHandler(async (req, res) => {
  try {
    const customer = req.customer;
    if (!customer.worker?.role) throw httpError('Apply to join the field team first', 403);
    if (customer.worker.status === 'suspended') throw httpError('Your field-team account is suspended. Contact support.', 403);
    const file = req.files?.[0];
    if (!file) throw httpError('Take a clear photo of the document, or choose a PDF');
    const kind = String(req.body.kind || '');
    const meta = DOC_KINDS[kind];
    if (!meta) throw httpError('Choose which document this is');
    const label = kind === 'other' ? clean(req.body.label, 60) : '';
    if (kind === 'other' && label.length < 3) throw httpError('Say what this document is');
    let expiresAt = null;
    if (req.body.expiresAt) {
      expiresAt = new Date(`${String(req.body.expiresAt).slice(0, 10)}T23:59:59+03:00`); // the end of that day, Kenya time
      if (Number.isNaN(expiresAt.getTime())) throw httpError('Enter the expiry date');
      if (expiresAt.getTime() > Date.now() + 15 * 365 * DAY) throw httpError('That expiry date is too far away: check it');
      if (expiresAt.getTime() < Date.now()) throw httpError(`This ${meta.label.toLowerCase()} has expired. Upload the renewed one.`);
    }
    if (meta.expires === true && !expiresAt) throw httpError(`Enter the date your ${meta.label.toLowerCase()} expires`);
    if (meta.expires === false) expiresAt = null;
    const docs = customer.worker.docs || [];
    if (kind === 'other' ? docs.filter((doc) => doc.kind === 'other').length >= 5 : false) throw httpError('You can keep up to 5 other documents. Remove one first.');
    const replaced = kind === 'other' ? [] : docs.filter((doc) => doc.kind === kind);
    const doc = { kind, ...(label ? { label } : {}), number: clean(req.body.number, 40), ...(expiresAt ? { expiresAt } : {}), file: file.filename, mime: file.mimetype, size: file.size, uploadedAt: new Date(), status: 'pending' };
    customer.set('worker.docs', [...docs.filter((item) => !replaced.includes(item)), doc]);
    await customer.save();
    replaced.forEach((item) => files.remove(BUCKET, item.file));
    emitAdmin('work:docs', { _id: customer._id, name: customer.name, kind });
    const saved = customer.worker.docs[customer.worker.docs.length - 1];
    res.status(201).json({ doc: docView(saved, '/work/docs'), summary: summaryOf(customer.worker) });
  } catch (err) {
    files.discard(req);
    throw err;
  }
});

// DELETE /api/work/docs/:docId  (not an approved one: a renewed document replaces it instead)
exports.remove = asyncHandler(async (req, res) => {
  const customer = req.customer;
  const doc = isId(req.params.docId) ? customer.worker?.docs?.id(req.params.docId) : null;
  if (!doc) throw httpError('Document not found', 404);
  if (doc.status === 'approved') throw httpError('Our team approved this document. Upload the renewed one to replace it.', 409);
  const file = doc.file;
  customer.worker.docs.pull(doc._id);
  await customer.save();
  files.remove(BUCKET, file);
  res.json({ ok: true, summary: summaryOf(customer.worker) });
});

// GET /api/work/docs/:docId/file  (their own)
exports.file = asyncHandler(async (req, res) => {
  const doc = isId(req.params.docId) ? req.customer.worker?.docs?.id(req.params.docId) : null;
  if (!doc) throw httpError('Document not found', 404);
  files.send(res, BUCKET, doc.file, doc.kind);
});

// ---------------------------------------------------------------- moderators (staff with the "orders" area)
async function workerOf(req) {
  if (!isId(req.params.id)) throw httpError('Not found', 404);
  const customer = await Customer.findById(req.params.id);
  if (!customer?.worker?.role) throw httpError('Not found', 404);
  return customer;
}

// GET /api/work/admin/workers/:id/docs
exports.adminDocs = asyncHandler(async (req, res) => {
  const customer = await workerOf(req);
  res.json({
    worker: { _id: customer._id, name: customer.name, phone: customer.phone, role: customer.worker.role, vehicle: customer.worker.vehicle || '', plate: customer.worker.plate || '', idNumber: customer.worker.idNumber || '', status: customer.worker.status },
    docs: (customer.worker.docs || []).map((doc) => docView(doc, `/work/admin/workers/${customer._id}/docs`)),
    kinds: kindsFor(customer.worker), summary: summaryOf(customer.worker),
  });
});

// GET /api/work/admin/workers/:id/docs/:docId/file  (written to the audit log)
exports.adminFile = asyncHandler(async (req, res) => {
  const customer = await workerOf(req);
  const doc = isId(req.params.docId) ? customer.worker.docs?.id(req.params.docId) : null;
  if (!doc) throw httpError('Document not found', 404);
  require('../security/audit').audit(req, 'worker.doc.view', { target: String(customer._id), detail: `${doc.kind} of ${customer.name}` });
  files.send(res, BUCKET, doc.file, `${customer.name}-${doc.kind}`);
});

// POST /api/work/admin/workers/:id/docs/:docId { action: approve | reject, note, expiresAt? }
// The moderator checks the document, and the expiry date against it (correcting it if the rider typed it wrong).
exports.adminReview = asyncHandler(async (req, res) => {
  const customer = await workerOf(req);
  const doc = isId(req.params.docId) ? customer.worker.docs?.id(req.params.docId) : null;
  if (!doc) throw httpError('Document not found', 404);
  const action = req.body.action;
  if (!['approve', 'reject'].includes(action)) throw httpError('Approve or reject the document');
  const note = clean(req.body.note, 200);
  if (action === 'reject' && note.length < 3) throw httpError('Tell them why (e.g. “The photo is blurred”, “The licence has expired”)');
  if (req.body.expiresAt) {
    const date = new Date(`${String(req.body.expiresAt).slice(0, 10)}T23:59:59+03:00`);
    if (Number.isNaN(date.getTime())) throw httpError('Enter a valid expiry date');
    if (date.getTime() !== new Date(doc.expiresAt || 0).getTime()) {
      doc.expiresAt = date;
      doc.reminded = undefined;
    }
  }
  if (action === 'approve' && DOC_KINDS[doc.kind]?.expires === true && !doc.expiresAt) throw httpError('Enter the expiry date shown on the document first');
  if (action === 'approve' && doc.expiresAt && new Date(doc.expiresAt) < new Date()) throw httpError('This document has expired: reject it and ask for the renewed one');
  doc.status = action === 'approve' ? 'approved' : 'rejected';
  doc.reviewNote = note;
  doc.reviewedAt = new Date();
  doc.reviewedBy = req.user?.name || req.user?.email || 'Our team';
  await customer.save();
  require('../security/audit').audit(req, `worker.doc.${action}`, { target: String(customer._id), detail: `${doc.kind}${note ? `: ${note}` : ''}` });
  const label = DOC_KINDS[doc.kind]?.label || 'document';
  require('../market/alerts').send(customer._id, {
    kind: 'work', icon: action === 'approve' ? '✅' : '⚠️', link: '/work?docs=1',
    title: { en: action === 'approve' ? `Your ${label.toLowerCase()} is approved` : `Your ${label.toLowerCase()} was not accepted`, sw: action === 'approve' ? `${label} yako imekubaliwa` : `${label} yako haikukubaliwa` },
    body: { en: action === 'approve' ? (doc.expiresAt ? `Valid until ${dateText(doc.expiresAt)}.` : 'Thank you.') : `${note} Please upload it again.`, sw: action === 'approve' ? 'Asante.' : `${note} Tafadhali pakia tena.` },
  }).catch(() => {});
  emitCustomer(String(customer._id), 'work:docs', { _id: doc._id, status: doc.status });
  res.json({ doc: docView(doc, `/work/admin/workers/${customer._id}/docs`), summary: summaryOf(customer.worker) });
});

// ---------------------------------------------------------------- reminders: 30 days, 7 days, and on the day it expires
async function runDocReminders(now = Date.now()) {
  const soon = new Date(now + SOON_DAYS * DAY);
  const people = await Customer.find({ 'worker.docs.expiresAt': { $lte: soon }, 'worker.status': { $in: ['approved', 'pending'] } }).select('name worker.docs worker.role').lean();
  const writes = [];
  const notes = [];
  for (const person of people) {
    for (const doc of person.worker.docs || []) {
      if (!doc.expiresAt || doc.status === 'rejected') continue;
      const { state, days } = expiryOf(doc, now);
      const stage = state === 'expired' ? 'expired' : days <= 7 ? '7' : state === 'expiring' ? '30' : '';
      const order = { '': 0, 30: 1, 7: 2, expired: 3 };
      if (!stage || order[stage] <= order[doc.reminded || '']) continue;
      writes.push({ updateOne: { filter: { _id: person._id }, update: { $set: { 'worker.docs.$[doc].reminded': stage } }, arrayFilters: [{ 'doc._id': doc._id }] } });
      const label = DOC_KINDS[doc.kind]?.label || 'document';
      notes.push([person._id, {
        kind: 'work', icon: stage === 'expired' ? '⛔' : '⏰', link: '/work?docs=1',
        title: { en: stage === 'expired' ? `Your ${label.toLowerCase()} has expired` : `Your ${label.toLowerCase()} expires in ${days} day${days === 1 ? '' : 's'}`, sw: stage === 'expired' ? `${label} yako imeisha muda` : `${label} yako inaisha baada ya siku ${days}` },
        body: { en: `${stage === 'expired' && person.worker.role === 'rider' && STOPS_JOBS.includes(doc.kind) ? 'You can’t take new jobs until you upload the renewed one. ' : ''}Renew it and upload the new one in Rider jobs → Documents.`, sw: 'Ipya na uipakie kwenye Kazi → Hati.' },
      }]);
    }
  }
  if (writes.length) await Customer.bulkWrite(writes, { ordered: false });
  for (const [to, note] of notes) await require('../market/alerts').send(to, note).catch(() => {});
  return notes.length;
}
exports.runDocReminders = runDocReminders;
