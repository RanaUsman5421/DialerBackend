const express = require("express");
const adminAuth = require("../contollers/adminAuth");
const admin = require("../contollers/admin");
const auth = require("../contollers/auth");
const { requireAuth, requireAdmin, requireRoles } = require("../middleware/auth");

const router = express.Router();
router.post("/auth/login", adminAuth.login);
router.post("/auth/signup", adminAuth.signup);
router.get("/auth/me", requireAuth, requireRoles("admin", "leads_agent"), auth.me);

router.use(requireAuth, requireAdmin);
router.get("/users", admin.listUsers);
router.post("/users", admin.createUser);
router.patch("/users/:id", admin.updateUser);
router.get("/accounts", admin.listAdmins);
router.post("/invites", admin.createInvite);

module.exports = router;
