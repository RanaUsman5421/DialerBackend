const express = require("express");
const multer = require("multer");
const path = require("path");
const leads = require("../contollers/leads");
const { requireAuth, requireAdmin, requireRoles } = require("../middleware/auth");

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

router.use(requireAuth);
const web=requireRoles('admin','leads_agent');
router.get('/assigned',requireRoles('calling_agent'),leads.listAssignedLeads);
router.get('/:id/history',requireRoles('admin','leads_agent','calling_agent'),leads.history);
router.patch('/call-record',requireRoles('calling_agent'),leads.recordCall);
router.patch('/:id',requireRoles('admin','calling_agent'),leads.updateLead);
router.get('/workload',requireAdmin,leads.workload);
router.get('/team-performance',requireAdmin,require('../contollers/teamPerformance').teamPerformance);
router.post('/assign',requireAdmin,leads.assign);
router.get('/groups',web,leads.groups);
router.get('/rejected/export',web,leads.exportRejected);
router.get('/rejected',web,leads.rejectedLeads);
router.get('/rejected/:id/matches',requireAdmin,leads.duplicateMatches);
router.post('/rejected/:id/resubmit',web,leads.resubmit);
router.get('/stats',web,leads.stats);
router.get('/imports',web,leads.listImports);
router.get('/',web,leads.listLeads);
router.post('/manual',web,leads.manualLead);
router.post('/import',web,upload.single('file'),leads.importLeads);
router.get('/:id',requireRoles('admin','leads_agent','calling_agent'),leads.detail);
module.exports=router;
