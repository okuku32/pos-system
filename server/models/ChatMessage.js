const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');

// One message in a buyer–seller conversation (kept separate so long chats don't bloat the conversation)
const chatMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = tenantModel('ChatMessage', chatMessageSchema);
