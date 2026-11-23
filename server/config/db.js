const mongoose = require('mongoose');

// One connection pool per server process, shared by every request: up to MONGO_POOL_SIZE queries run at the same time
// (default 20; with several servers each has its own pool). If the database can't be reached, requests fail within
// seconds instead of hanging.
module.exports = async function connectDB() {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxIdleTimeMS: 5 * 60 * 1000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
};
