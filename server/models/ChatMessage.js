const mongoose = require('mongoose');

// One message in a buyer–seller conversation (kept separate so long chats don't bloat the conversation)
const chatMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    // text · offer (price proposal card) · visit (site-visit request) · system (offer accepted, visit confirmed…)
    kind: { type: String, enum: ['text', 'offer', 'visit', 'system'], default: 'text' },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
    visitAt: Date,
    visitStatus: { type: String, enum: ['requested', 'confirmed', 'declined'] },
    flag: String, // 'money': looks like a request to send money first
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
