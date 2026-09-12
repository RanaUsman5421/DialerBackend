const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const AdminInvite = require("../models/AdminInvite");
const { issueToken, publicUser, ensureAuthConfigured } = require("./auth");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/;
const hashToken = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function login(req, res) {
  try {
    ensureAuthConfigured();
    const identity = String(req.body.identity || req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await User.findOne({ $or: [{ email: identity }, { username: identity }] }).select("+password");
    if (!user || !["admin","leads_agent"].includes(user.role) || !user.isActive || user.accountState === "suspended" || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }
    if(user.accountState === "pending") return res.status(403).json({error:"Your account is awaiting administrator approval",code:"ACCOUNT_PENDING"});
    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("[admin-login]", error);
    res.status(500).json({ error: "Unable to sign in" });
  }
}

async function signup(req, res) {
  let claimedInvite = null;
  let user = null;
  try {
    ensureAuthConfigured();
    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim().toLowerCase();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const inviteToken = String(req.body.inviteToken || "").trim();
    if (name.length < 2 || !usernamePattern.test(username) || !emailPattern.test(email) || password.length < 8 || !inviteToken) {
      return res.status(400).json({ error: "Name, username, valid email, 8+ character password and invite code are required" });
    }
    if (await User.exists({ $or: [{ email }, { username }] })) return res.status(409).json({ error: "Email or username already exists" });

    user = new User({ name, username, email, role: "admin", isActive: true });
    claimedInvite = await AdminInvite.findOneAndUpdate(
      { tokenHash: hashToken(inviteToken), usedAt: null, expiresAt: { $gt: new Date() }, $or: [{ email: "" }, { email }] },
      { $set: { usedAt: new Date(), usedBy: user._id } },
      { new: true },
    );
    if (!claimedInvite) return res.status(400).json({ error: "Invite code is invalid, expired or issued for another email" });

    user.password = await bcrypt.hash(password, 12);
    user.createdBy = claimedInvite.createdBy;
    await user.save();
    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    if (claimedInvite && user?._id) await AdminInvite.updateOne({ _id: claimedInvite._id, usedBy: user._id }, { $set: { usedAt: null, usedBy: null } }).catch(() => {});
    if (error.code === 11000) return res.status(409).json({ error: "Email or username already exists" });
    console.error("[admin-signup]", error);
    res.status(500).json({ error: "Unable to create admin account" });
  }
}

module.exports = { login, signup };
