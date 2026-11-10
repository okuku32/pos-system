const mongoose = require('mongoose');

// Small key/value store for system state (e.g. the eTIMS device communication key and invoice counter)
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

settingSchema.statics.get = async function (key, fallback = null) {
  const s = await this.findOne({ key });
  return s ? s.value : fallback;
};
settingSchema.statics.set = function (key, value) {
  return this.findOneAndUpdate({ key }, { $set: { value } }, { upsert: true, returnDocument: 'after' });
};
// Atomic counter (e.g. sequential eTIMS invoice numbers)
settingSchema.statics.next = async function (key) {
  const s = await this.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' });
  return s.value;
};

module.exports = mongoose.model('Setting', settingSchema);
