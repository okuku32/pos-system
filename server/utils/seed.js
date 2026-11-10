// npm run seed — creates an admin + cashier and sample products (replaces existing products)
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (!(await User.findOne({ email: 'admin@pos.com' })))
    await User.create({ name: 'Admin', email: 'admin@pos.com', password: 'admin123', role: 'admin' });
  if (!(await User.findOne({ email: 'cashier@pos.com' })))
    await User.create({ name: 'Cashier', email: 'cashier@pos.com', password: 'cashier123', role: 'cashier' });

  await Product.deleteMany({});
  await Product.insertMany([
    { name: 'Coca-Cola 500ml', sku: 'BEV001', barcode: '5449000000996', category: 'Beverages', price: 80, cost: 55, stock: 120 },
    { name: 'Dasani Water 1L', sku: 'BEV002', category: 'Beverages', price: 70, cost: 40, stock: 80 },
    { name: 'Milk 500ml', sku: 'DAI001', category: 'Dairy', price: 65, cost: 50, stock: 40 },
    { name: 'Eggs (Tray)', sku: 'DAI002', category: 'Dairy', price: 450, cost: 380, stock: 15 },
    { name: 'White Bread 400g', sku: 'BAK001', category: 'Bakery', price: 65, cost: 50, stock: 30 },
    { name: 'Sugar 1kg', sku: 'GRO001', category: 'Groceries', price: 190, cost: 160, stock: 50 },
    { name: 'Maize Flour 2kg', sku: 'GRO002', category: 'Groceries', price: 210, cost: 180, stock: 60 },
    { name: 'Rice 1kg', sku: 'GRO003', category: 'Groceries', price: 180, cost: 140, stock: 4 },
    { name: 'Cooking Oil 1L', sku: 'GRO004', category: 'Groceries', price: 350, cost: 300, stock: 25 },
    { name: 'Bar Soap', sku: 'HOU001', category: 'Household', price: 120, cost: 90, stock: 35 },
    { name: 'Tissue Paper 4pk', sku: 'HOU002', category: 'Household', price: 240, cost: 190, stock: 3 },
    { name: 'Biscuits', sku: 'SNK001', category: 'Snacks', price: 50, cost: 35, stock: 100 },
  ]);
  console.log('Seeded. Login: admin@pos.com / admin123  or  cashier@pos.com / cashier123');
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
