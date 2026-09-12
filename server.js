const express = require("express");
const http = require("http");
const cors = require("cors");
const crypto = require("crypto");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const connectDB = require("./db/connect");
const Device = require("./models/Device");
const pairing = require("./services/pairingStore");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const leadRoutes = require("./routes/leads");
const { requireAuth, verifyToken, requireRoles } = require("./middleware/auth");

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || "*";
const io = new Server(server, { cors: { origin: allowedOrigin, methods: ["GET", "POST"] } });
const port = Number(process.env.PORT || 3000);

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "64kb" }));

app.get("/", (_req, res) => res.json({ name: "Lionex Bridge", status: "ok" }));
app.get("/health", (_req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1, authConfigured: Boolean(process.env.JWT_SECRET), managementVersion: 1, now: new Date().toISOString() }));
app.use("/api/auth", authRoutes);
app.use("/api/admin/leads", leadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/leads", leadRoutes);

app.post("/api/pairing/sessions", requireAuth, requireRoles("calling_agent"), async (req, res) => {
  try {
    const publicUrl = String(req.body.serverUrl || process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const created = await pairing.createSession(req.body.desktopName, publicUrl, req.auth.sub);
    res.status(201).json({ ...pairing.publicSession(created.session), desktopToken: created.desktopToken, qrPayload: created.qrPayload });
  } catch (error) { console.error(error); res.status(500).json({ error: "Could not create pairing session" }); }
});

app.get("/api/pairing/sessions/:id", async (req, res) => {
  const session = await pairing.get(req.params.id);
  if (!pairing.verifyDesktop(session, req.get("x-desktop-token"))) return res.status(404).json({ error: "Pairing session not found" });
  res.json(pairing.publicSession(session));
});

app.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Spreadsheet must be 5 MB or smaller" });
  if (error?.message?.includes(".xls")) return res.status(400).json({ error: error.message });
  if(error.status) return res.status(error.status).json({error:error.message});
  if(error.name === "CastError" || error.name === "ValidationError") return res.status(400).json({error:"Invalid request data"});
  console.error("[http]", error);
  res.status(500).json({ error: "Unexpected server error" });
});

function acknowledge(ack, payload) { if (typeof ack === "function") ack(payload); }
async function activeCaller(session) {
 if(!session?.userId)return false;
 const user=await require('./models/User').findById(session.userId).select('role isActive accountState').lean();
 return Boolean(user && ['user','calling_agent'].includes(user.role) && user.isActive!==false && (!user.accountState||user.accountState==='active'));
}
function room(session) { return `pair:${session.pairingId}`; }

io.on("connection", (socket) => {
  socket.on("desktop:join", async (data = {}, ack) => {
    const session = await pairing.get(data.pairingId);
    if ((!pairing.verifyDesktop(session, data.desktopToken) || !await activeCaller(session))) return acknowledge(ack, { ok: false, error: "Invalid desktop session" });
    session.desktopSocketId = socket.id;
    socket.data.pairingId = session.pairingId;
    socket.data.peerType = "desktop";
    socket.join(room(session));
    acknowledge(ack, { ok: true, paired: Boolean(session.pairedAt), phoneOnline: Boolean(session.phoneSocketId), device: session.device });
  });

  socket.on("phone:pair", async (data = {}, ack) => {
    const code = String(data.code || "").replace(/\D/g, "");
    const session = await pairing.findByCode(code);
    if (!session) return acknowledge(ack, { ok: false, error: "Code invalid or expired" });
    const claims = verifyToken(data.accessToken);
    if (!claims || claims.sub !== session.userId || !await activeCaller(session)) return acknowledge(ack, { ok: false, error: "Sign in with the same account used on desktop" });
    const device = data.device || {};
    if (!device.deviceId || !device.name) return acknowledge(ack, { ok: false, error: "Device identity is required" });

    const phoneToken = pairing.token();
    session.phoneSocketId = socket.id;
    socket.data.pairingId = session.pairingId;
    socket.data.peerType = "phone";
    session.device = { deviceId: String(device.deviceId), name: String(device.name).slice(0, 80), model: String(device.model || ""), androidVersion: String(device.androidVersion || "") };
    await pairing.markPaired(session, phoneToken, session.device);
    socket.join(room(session));

    if (mongoose.connection.readyState === 1) {
      const tokenHash = crypto.createHash("sha256").update(phoneToken).digest("hex");
      Device.findOneAndUpdate({ deviceId: session.device.deviceId }, { ...session.device, tokenHash, pairedDesktopName: session.desktopName, lastSeenAt: new Date() }, { upsert: true }).catch(console.error);
    }
    const result = { ok: true, pairingId: session.pairingId, phoneToken, desktopName: session.desktopName };
    acknowledge(ack, result);
    io.to(room(session)).emit("pairing:complete", { pairingId: session.pairingId, device: session.device });
  });

  socket.on("phone:resume", async (data = {}, ack) => {
    const session = await pairing.get(data.pairingId);
    if ((!pairing.verifyPhone(session, data.phoneToken) || !await activeCaller(session))) return acknowledge(ack, { ok: false, error: "Saved pairing is no longer valid" });
    session.phoneSocketId = socket.id;
    socket.data.pairingId = session.pairingId;
    socket.data.peerType = "phone";
    socket.join(room(session));
    acknowledge(ack, { ok: true, desktopName: session.desktopName });
    io.to(session.desktopSocketId || "").emit("device:online", { device: session.device });
  });

  socket.on("desktop:command", async (data = {}, ack) => {
    const session = await pairing.get(data.pairingId);
    if ((!pairing.verifyDesktop(session, data.desktopToken) || !await activeCaller(session)) || !session.pairedAt) return acknowledge(ack, { ok: false, error: "Desktop is not paired" });
    if (!session.phoneSocketId) return acknowledge(ack, { ok: false, error: "Phone is offline" });
    io.to(session.phoneSocketId).emit("phone:command", data.command || {});
    acknowledge(ack, { ok: true });
  });

  socket.on("phone:event", async (data = {}, ack) => {
    const session = await pairing.get(data.pairingId);
    if ((!pairing.verifyPhone(session, data.phoneToken) || !await activeCaller(session))) return acknowledge(ack, { ok: false, error: "Phone is not authenticated" });
    if (session.desktopSocketId) io.to(session.desktopSocketId).emit("desktop:event", data.event || {});
    acknowledge(ack, { ok: true });
  });

  socket.on("desktop:unpair", async (data = {}, ack) => {
    const session = await pairing.get(data.pairingId);
    if ((!pairing.verifyDesktop(session, data.desktopToken) || !await activeCaller(session))) return acknowledge(ack, { ok: false, error: "Invalid desktop session" });
    if (session.phoneSocketId) io.to(session.phoneSocketId).emit("phone:unpaired");
    await pairing.revoke(session);
    acknowledge(ack, { ok: true });
  });

  socket.on("phone:unpair", async (data = {}, ack) => {
    const session = await pairing.get(data.pairingId);
    if ((!pairing.verifyPhone(session, data.phoneToken) || !await activeCaller(session))) return acknowledge(ack, { ok: false, error: "Invalid phone session" });
    if (session.desktopSocketId) io.to(session.desktopSocketId).emit("pairing:revoked");
    await pairing.revoke(session);
    acknowledge(ack, { ok: true });
  });

  socket.on("disconnect", async () => {
    const session = await pairing.get(socket.data.pairingId);
    if (!session) return;
    if (socket.data.peerType === "phone" && session.phoneSocketId === socket.id) {
      session.phoneSocketId = null;
      if (session.desktopSocketId) io.to(session.desktopSocketId).emit("device:offline");
    }
    if (socket.data.peerType === "desktop" && session.desktopSocketId === socket.id) session.desktopSocketId = null;
  });
});

async function start() {
  if (!process.env.JWT_SECRET) console.error("CONFIG ERROR: JWT_SECRET is missing; login/signup will be unavailable");
  await connectDB();
  server.listen(port, "0.0.0.0", () => console.log(`Lionex Bridge listening on http://0.0.0.0:${port}`));
}

if (require.main === module) start();
module.exports = { app, server, io, start };
