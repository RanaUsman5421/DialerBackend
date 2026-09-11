const XLSX = require("xlsx");
const Lead = require("../models/Lead");
const LeadImport = require("../models/LeadImport");
const User = require("../models/User");

const MAX_ROWS = 20000;
const MAX_COLUMNS = 100;
const aliases = {
  name: ["name", "fullname", "customername", "leadname", "contactname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "telephone"],
  email: ["email", "emailaddress"],
  company: ["company", "companyname", "organization", "organisation"],
  city: ["city", "location"],
  source: ["source", "leadsource"],
  notes: ["notes", "note", "remarks", "comment", "comments"],
};
const cleanKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanValue = (value, max = 500) => String(value ?? "").trim().slice(0, max);

function pick(row, field) {
  const wanted = new Set(aliases[field]);
  const entry = Object.entries(row).find(([key]) => wanted.has(cleanKey(key)));
  return entry ? cleanValue(entry[1]) : "";
}

async function importLeads(req, res) {
  let batch;
  try {
    if (!req.file) return res.status(400).json({ error: "An .xls or .xlsx file is required" });
    const assignedTo = await User.findOne({ _id: req.body.assignedTo, role: "user", isActive: true });
    if (!assignedTo) return res.status(400).json({ error: "Select an active user" });

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) return res.status(400).json({ error: "The first worksheet is empty" });
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const rowCount = range.e.r - range.s.r;
    const columnCount = range.e.c - range.s.c + 1;
    if (rowCount > MAX_ROWS || columnCount > MAX_COLUMNS) return res.status(413).json({ error: `Spreadsheet limit is ${MAX_ROWS.toLocaleString()} rows and ${MAX_COLUMNS} columns` });

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, blankrows: false });
    batch = await LeadImport.create({ fileName: req.file.originalname.slice(0, 180), sheetName, assignedTo: assignedTo._id, uploadedBy: req.user._id, totalRows: rows.length });
    const errors = [];
    const leads = [];
    rows.forEach((row, index) => {
      const phone = pick(row, "phone").replace(/^'+/, "");
      if (!phone) {
        errors.push({ row: index + 2, message: "Phone number is missing" });
        return;
      }
      const knownHeaders = new Set(Object.values(aliases).flat());
      const extra = {};
      Object.entries(row).slice(0, MAX_COLUMNS).forEach(([key, value]) => {
        if (!knownHeaders.has(cleanKey(key)) && cleanValue(value)) extra[cleanValue(key, 80)] = cleanValue(value);
      });
      leads.push({ name: pick(row, "name") || "Unknown lead", phone: cleanValue(phone, 60), email: pick(row, "email").toLowerCase(), company: pick(row, "company"), city: pick(row, "city"), source: pick(row, "source") || "Excel import", notes: pick(row, "notes"), assignedTo: assignedTo._id, uploadedBy: req.user._id, importBatch: batch._id, sourceRow: index + 2, extra });
    });
    for (let index = 0; index < leads.length; index += 500) await Lead.insertMany(leads.slice(index, index + 500), { ordered: true });
    batch.importedRows = leads.length;
    batch.skippedRows = errors.length;
    batch.errors = errors.slice(0, 100);
    batch.status = "completed";
    await batch.save();
    res.status(201).json({ import: await batch.populate("assignedTo", "name username email"), message: `${leads.length} leads assigned to ${assignedTo.name}` });
  } catch (error) {
    if (batch) await Lead.deleteMany({ importBatch: batch._id }).catch(() => {});
    if (batch) await LeadImport.updateOne({ _id: batch._id }, { status: "failed", errors: [{ row: 0, message: "Import could not be completed" }] }).catch(() => {});
    console.error("[lead-import]", error);
    res.status(400).json({ error: "Could not read this spreadsheet. Check its format and column headings." });
  }
}

async function listLeads(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
  const filter = {};
  if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Lead.find(filter).populate("assignedTo", "name username email").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Lead.countDocuments(filter),
  ]);
  res.json({ leads: items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}

async function listImports(req, res) {
  const imports = await LeadImport.find().populate("assignedTo", "name username email").populate("uploadedBy", "name username").sort({ createdAt: -1 }).limit(50);
  res.json({ imports });
}

async function stats(req, res) {
  const [totalLeads, newLeads, assignedUsers, completedImports, recentImports] = await Promise.all([
    Lead.countDocuments(), Lead.countDocuments({ status: "new" }), Lead.distinct("assignedTo"), LeadImport.countDocuments({ status: "completed" }),
    LeadImport.find().populate("assignedTo", "name username").sort({ createdAt: -1 }).limit(5),
  ]);
  res.json({ totalLeads, newLeads, assignedUsers: assignedUsers.length, completedImports, recentImports });
}

module.exports = { importLeads, listLeads, listImports, stats };
