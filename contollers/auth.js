const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (user) => ({ id: user._id.toString(), name: user.name, email: user.email });
const issueToken = (user) => jwt.sign({ sub: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });

async function signup(req, res) {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || !emailPattern.test(email) || password.length < 8) {
      return res.status(400).json({ error: "Name, valid email and an 8+ character password are required" });
    }
    if (await User.exists({ email })) return res.status(409).json({ error: "An account with this email already exists" });
    const user = await User.create({ name, email, password: await bcrypt.hash(password, 12) });
    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to create account" });
  }
}

async function login(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid email or password" });
    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to sign in" });
  }
}

module.exports = { signup, login };
