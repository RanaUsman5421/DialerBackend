const express = require("express");
const multer = require("multer");
const path = require("path");
const leads = require("../contollers/leads");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const supported = extension === ".xls" || extension === ".xlsx";
    callback(supported ? null : new Error("Only .xls and .xlsx files are supported"), supported);
  },
});

router.use(requireAuth, requireAdmin);
router.get("/stats", leads.stats);
router.get("/imports", leads.listImports);
router.get("/", leads.listLeads);
router.post("/import", upload.single("file"), leads.importLeads);

module.exports = router;
