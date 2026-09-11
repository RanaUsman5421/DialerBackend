require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../db/connect");
const User = require("../models/User");

async function run() {
  const username = String(process.env.ADMIN_SEED_USERNAME || "").trim().toLowerCase();
  const email = String(process.env.ADMIN_SEED_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_SEED_PASSWORD || "");
  const name = String(process.env.ADMIN_SEED_NAME || "Dialer Administrator").trim();
  if (!username || !email || password.length < 12) throw new Error("ADMIN_SEED_USERNAME, ADMIN_SEED_EMAIL and a 12+ character ADMIN_SEED_PASSWORD are required");
  if (!(await connectDB()) || mongoose.connection.readyState !== 1) throw new Error("MongoDB connection is required to seed the admin");
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ $or: [{ username }, { email }] }).select("+password");
  if (existing) {
    existing.name = name;
    existing.username = username;
    existing.email = email;
    existing.password = passwordHash;
    existing.role = "admin";
    existing.isActive = true;
    await existing.save();
    console.log(`Admin updated: ${username}`);
  } else {
    await User.create({ name, username, email, password: passwordHash, role: "admin", isActive: true });
    console.log(`Admin created: ${username}`);
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => mongoose.disconnect());
