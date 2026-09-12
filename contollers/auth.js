const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-z0-9._-]{3,30}$/;
const publicUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  username: user.username || null,
  email: user.email,
  role: user.role === "user" ? "calling_agent" : user.role,
  accountState: user.accountState || "active",
  isActive: user.isActive !== false,
});
const ensureAuthConfigured = () => {
  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET is not configured");
    error.code = "AUTH_NOT_CONFIGURED";
    throw error;
  }
};
const issueToken = (user) => {
  ensureAuthConfigured();
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: "12h" });
};

function authFailure(res, error, fallback) {
  console.error(`[auth] ${error.code || error.name}:`, error.message);
  if (error.code === "AUTH_NOT_CONFIGURED") {
    return res.status(503).json({ error: "Authentication is not configured on the server", code: error.code });
  }
  if (error.code === 11000) {
    return res.status(409).json({ error: "Email or username already exists", code: "ACCOUNT_EXISTS" });
  }
  if (error.name === "ValidationError") return res.status(400).json({ error: "Account details are invalid. Check your name, username, email and password.", code: "INVALID_ACCOUNT" });
  if (["MongoServerSelectionError", "MongooseServerSelectionError"].includes(error.name)) return res.status(503).json({ error: "The account database is temporarily unavailable. Please try again shortly.", code: "DATABASE_UNAVAILABLE" });
  return res.status(500).json({ error: fallback, code: "AUTH_INTERNAL_ERROR" });
}

async function signup(req, res) {
  try {
    ensureAuthConfigured();
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || !emailPattern.test(email) || password.length < 8) {
      return res.status(400).json({ error: "Name, valid email and an 8+ character password are required" });
    }
    // Android clients may omit username; web signups supply it.
    if (username && !usernamePattern.test(username)) return res.status(400).json({ error: "Username must be 3–30 characters using letters, numbers, dots, underscores or hyphens" });
    if (await User.exists({ $or: [{ email }, ...(username ? [{ username }] : [])] })) return res.status(409).json({ error: "Email or username already exists", code: "ACCOUNT_EXISTS" });
    // Mongoose allocates _id before save. Validate JWT configuration before
    // persistence so a failed token operation cannot leave a half-created user.
    const role = req.body.role === "leads_agent" ? "leads_agent" : "calling_agent";
    const user = new User({ name, email, ...(username ? { username } : {}), password: await bcrypt.hash(password, 12), role, accountState: "pending", isActive: true });
    const token = issueToken(user);
    await user.save();
    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    authFailure(res, error, "Unable to create account");
  }
}

async function login(req, res) {
  try {
    ensureAuthConfigured();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await User.findOne({ email }).select("+password");
    if (!user || user.isActive === false || user.accountState === "suspended" || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid email or password" });
    if(user.accountState === "pending") return res.status(403).json({error:"Your account is awaiting administrator approval",code:"ACCOUNT_PENDING"});
    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    authFailure(res, error, "Unable to sign in");
  }
}

function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

module.exports = { signup, login, me, publicUser, issueToken, ensureAuthConfigured };
