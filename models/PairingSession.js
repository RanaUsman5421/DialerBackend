const mongoose = require("mongoose");

const pairingSessionSchema = new mongoose.Schema({
  pairingId: { type: String, required: true, unique: true, index: true },
  code: { type: String, required: true, index: true },
  desktopName: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  desktopTokenHash: { type: String, required: true },
  phoneTokenHash: String,
  device: mongoose.Schema.Types.Mixed,
  pairedAt: Date,
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
  revokedAt: Date,
}, { timestamps: true });

module.exports = mongoose.models.PairingSession || mongoose.model("PairingSession", pairingSessionSchema);
