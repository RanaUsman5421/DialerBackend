const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const AdminInvite = require("../models/AdminInvite");
const { publicUser } = require("./auth");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function listUsers(req, res) {
  const users = await User.find({ role: "user" }).select("name username email role isActive createdAt").sort({ createdAt: -1 });
  res.json({ users: users.map(publicUser) });
}

async function createUser(req, res) {
  try {
    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim().toLowerCase();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || username.length < 3 || !emailPattern.test(email) || password.length < 8) {
      return res.status(400).json({ error: "Name, username, valid email and an 8+ character password are required" });
    }
    if (await User.exists({ $or: [{ email }, { username }] })) return res.status(409).json({ error: "Email or username already exists" });
    const user = await User.create({ name, username, email, password: await bcrypt.hash(password, 12), role: "user", createdBy: req.user._id });
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Email or username already exists" });
    console.error("[create-user]", error);
    res.status(500).json({ error: "Unable to create user" });
  }
}

async function listAdmins(req, res) {
  const admins = await User.find({ role: "admin" }).select("name username email role isActive createdAt").sort({ createdAt: 1 });
  res.json({ admins: admins.map((admin) => ({ ...publicUser(admin), createdAt: admin.createdAt })) });
}

async function createInvite(req, res) {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (email && !emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email or leave it blank" });
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await AdminInvite.create({ tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"), email, createdBy: req.user._id, expiresAt });
  res.status(201).json({ inviteToken: rawToken, email, expiresAt });
}

module.exports = { listUsers, createUser, listAdmins, createInvite };
