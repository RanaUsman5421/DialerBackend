const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: "Unknown lead" },
  phone: { type: String, required: true, trim: true, index: true },
  email: { type: String, lowercase: true, trim: true, default: "" },
  company: { type: String, trim: true, default: "" },
  city: { type: String, trim: true, default: "" },
  source: { type: String, trim: true, default: "Excel import" },
  notes: { type: String, trim: true, default: "" },
  status: { type: String, enum: ["new", "contacted", "qualified", "won", "lost"], default: "new", index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  importBatch: { type: mongoose.Schema.Types.ObjectId, ref: "LeadImport", required: true, index: true },
  sourceRow: { type: Number, required: true },
  extra: { type: Map, of: String, default: {} },
}, { timestamps: true });

leadSchema.index({ importBatch: 1, sourceRow: 1 }, { unique: true });

module.exports = mongoose.model("Lead", leadSchema);
