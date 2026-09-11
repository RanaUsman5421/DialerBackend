const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (user) => ({ id: user._id.toString(), name: user.name, email: user.email });
const ensureAuthConfigured = () => {
  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET is not configured");
    error.code = "AUTH_NOT_CONFIGURED";
    throw error;
  }
};
const issueToken = (user) => {
  ensureAuthConfigured();
  return jwt.sign({ sub: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

function authFailure(res, error, fallback) {
  console.error(`[auth] ${error.code || error.name}:`, error.message);
  if (error.code === "AUTH_NOT_CONFIGURED") {
    return res.status(503).json({ error: "Authentication is not configured on the server", code: error.code });
  }
  if (error.code === 11000) {
    return res.status(409).json({ error: "An account with this email already exists", code: "EMAIL_EXISTS" });
  }
  return res.status(500).json({ error: fallback, code: "AUTH_INTERNAL_ERROR" });
}

async function signup(req, res) {
  try {
    ensureAuthConfigured();
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || !emailPattern.test(email) || password.length < 8) {
      return res.status(400).json({ error: "Name, valid email and an 8+ character password are required" });
    }
    if (await User.exists({ email })) return res.status(409).json({ error: "An account with this email already exists" });
    // Mongoose allocates _id before save. Validate JWT configuration before
    // persistence so a failed token operation cannot leave a half-created user.
    const user = new User({ name, email, password: await bcrypt.hash(password, 12) });
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
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid email or password" });
    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    authFailure(res, error, "Unable to sign in");
  }
}

module.exports = { signup, login };
