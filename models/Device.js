const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  platform: { type: String, default: "android" },
  model: String,
  androidVersion: String,
  tokenHash: { type: String, required: true },
  pairedDesktopName: String,
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.models.Device || mongoose.model("Device", deviceSchema);
