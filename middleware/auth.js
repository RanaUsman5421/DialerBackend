const jwt = require("jsonwebtoken");

function verifyToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const value = req.get("authorization") || "";
  const claims = verifyToken(value.startsWith("Bearer ") ? value.slice(7) : "");
  if (!claims) return res.status(401).json({ error: "Authentication required" });
  req.auth = claims;
  next();
}

module.exports = { requireAuth, verifyToken };
