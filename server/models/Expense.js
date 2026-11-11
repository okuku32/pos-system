const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');

// Running costs of the business (rent, salaries, electricity...). Stock bought from suppliers is NOT an
// expense here: its cost is already counted as cost of goods when the items are sold.
const expenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0.01, max: 100000000 },
    paymentMethod: { type: String, enum: ['cash', 'mpesa', 'bank', 'cheque', 'other'], default: 'cash' },
    reference: { type: String, trim: true, maxlength: 60 }, // M-Pesa code, cheque no...
    paidTo: { type: String, trim: true, maxlength: 100 },
    createdBy: String,
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1, date: -1 });

// Lives in each client's own database (see tenancy/context.js)
module.exports = tenantModel('Expense', expenseSchema);
