// Business expenses (operating costs): record, list, summarise.
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const asyncHandler = require('../utils/asyncHandler');
const { httpError } = require('../utils/saleService');

const DEFAULT_CATEGORIES = [
  'Rent', 'Salaries & wages', 'Electricity', 'Water', 'Internet & phone', 'Transport & delivery',
  'Repairs & maintenance', 'Marketing', 'Licences & permits', 'Bank & M-Pesa charges', 'Cleaning & supplies', 'Other',
];
const METHODS = ['cash', 'mpesa', 'bank', 'cheque', 'other'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pick(body) {
  const o = {};
  if (body.date !== undefined) {
    const d = new Date(body.date);
    if (Number.isNaN(d.getTime())) throw httpError('Enter a valid date');
    if (d > new Date(Date.now() + 86400000)) throw httpError('The date can’t be in the future');
    o.date = d;
  }
  if (body.category !== undefined) {
    o.category = String(body.category).trim().slice(0, 60);
    if (!o.category) throw httpError('Choose a category');
  }
  if (body.amount !== undefined) {
    o.amount = r2(body.amount);
    if (!(o.amount > 0)) throw httpError('Enter the amount');
  }
  if (body.paymentMethod !== undefined) o.paymentMethod = METHODS.includes(body.paymentMethod) ? body.paymentMethod : 'cash';
  for (const k of ['description', 'reference', 'paidTo']) if (body[k] !== undefined) o[k] = String(body[k]).trim();
  if (o.reference) o.reference = o.reference.toUpperCase();
  return o;
}

function dateFilter(from, to) {
  if (!from && !to) return null;
  const f = {};
  if (from) f.$gte = new Date(`${from}T00:00:00`);
  if (to) f.$lte = new Date(`${to}T23:59:59.999`);
  return f;
}

// GET /api/expenses?from=&to=&category=&q=&page=
exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = {};
  const d = dateFilter(req.query.from, req.query.to);
  if (d) filter.date = d;
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
    filter.$or = [{ description: rx }, { paidTo: rx }, { reference: rx }, { category: rx }];
  }
  const [expenses, count, byCategory] = await Promise.all([
    Expense.find(filter).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Expense.countDocuments(filter),
    Expense.aggregate([{ $match: filter }, { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
  ]);
  res.json({
    expenses,
    count,
    page,
    pages: Math.ceil(count / limit) || 1,
    summary: { total: r2(byCategory.reduce((n, c) => n + c.total, 0)), byCategory: byCategory.map((c) => ({ category: c._id, total: r2(c.total), count: c.count })) },
  });
});

// GET /api/expenses/categories: the usual ones plus any the shop has used
exports.categories = asyncHandler(async (req, res) => {
  const used = await Expense.distinct('category');
  res.json([...new Set([...DEFAULT_CATEGORIES, ...used])]);
});

exports.create = asyncHandler(async (req, res) => {
  const data = pick(req.body);
  if (!data.category) throw httpError('Choose a category');
  if (!data.amount) throw httpError('Enter the amount');
  res.status(201).json(await Expense.create({ ...data, createdBy: req.user.name }));
});

exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError('Expense not found', 404);
  const e = await Expense.findByIdAndUpdate(req.params.id, { $set: pick(req.body) }, { returnDocument: 'after', runValidators: true }).lean();
  if (!e) throw httpError('Expense not found', 404);
  res.json(e);
});

exports.remove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError('Expense not found', 404);
  await Expense.deleteOne({ _id: req.params.id });
  res.json({ message: 'Expense deleted' });
});
