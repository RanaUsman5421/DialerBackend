const jwt = require("jsonwebtoken");
const User = require("../models/User");

function verifyToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

async function requireAuth(req, res, next) {
  const value = req.get("authorization") || "";
  const claims = verifyToken(value.startsWith("Bearer ") ? value.slice(7) : "");
  if (!claims) return res.status(401).json({ error: "Authentication required" });
  try {
    const user = await User.findById(claims.sub);
    if (!user || user.isActive === false) return res.status(401).json({ error: "Account is unavailable" });
    req.auth = claims;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

module.exports = { requireAuth, requireAdmin, verifyToken };
