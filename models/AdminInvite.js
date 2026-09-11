const mongoose = require("mongoose");

const adminInviteSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  email: { type: String, lowercase: true, trim: true, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.model("AdminInvite", adminInviteSchema);
