const express = require("express");
const auth = require("../contollers/auth");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.post("/signup", auth.signup);
router.post("/login", auth.login);
router.get("/me", requireAuth, auth.me);

module.exports = router;
