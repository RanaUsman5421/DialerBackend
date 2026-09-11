const mongoose = require("mongoose");

const leadImportSchema = new mongoose.Schema({
  fileName: { type: String, required: true, trim: true },
  sheetName: { type: String, default: "" },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  totalRows: { type: Number, default: 0 },
  importedRows: { type: Number, default: 0 },
  skippedRows: { type: Number, default: 0 },
  status: { type: String, enum: ["processing", "completed", "failed"], default: "processing", index: true },
  errors: [{ row: Number, message: String }],
}, { timestamps: true });

module.exports = mongoose.model("LeadImport", leadImportSchema);
