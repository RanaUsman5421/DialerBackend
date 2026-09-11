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
const auth = require("./contollers/auth");
const { requireAuth, verifyToken } = require("./middleware/auth");

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || "*";
const io = new Server(server, { cors: { origin: allowedOrigin, methods: ["GET", "POST"] } });
const port = Number(process.env.PORT || 3000);

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "64kb" }));

app.get("/", (_req, res) => res.json({ name: "Lionex Bridge", status: "ok" }));
app.get("/health", (_req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1, now: new Date().toISOString() }));
app.post("/api/auth/signup", auth.signup);
app.post("/api/auth/login", auth.login);

app.post("/api/pairing/sessions", requireAuth, (req, res) => {
  const publicUrl = String(req.body.serverUrl || process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const session = pairing.createSession(req.body.desktopName, publicUrl, req.auth.sub);
  res.status(201).json({ ...pairing.publicSession(session), desktopToken: session.desktopToken, qrPayload: session.qrPayload });
});

app.get("/api/pairing/sessions/:id", (req, res) => {
  const session = pairing.get(req.params.id);
  if (!session || session.desktopToken !== req.get("x-desktop-token")) return res.status(404).json({ error: "Pairing session not found" });
  res.json(pairing.publicSession(session));
});

function acknowledge(ack, payload) { if (typeof ack === "function") ack(payload); }
function validDesktop(session, token) { return session && session.desktopToken === token; }
function validPhone(session, token) { return session && session.phoneToken === token; }
function room(session) { return `pair:${session.pairingId}`; }

io.on("connection", (socket) => {
  socket.on("desktop:join", (data = {}, ack) => {
    const session = pairing.get(data.pairingId);
    if (!validDesktop(session, data.desktopToken)) return acknowledge(ack, { ok: false, error: "Invalid desktop session" });
    session.desktopSocketId = socket.id;
    socket.data.pairingId = session.pairingId;
    socket.data.peerType = "desktop";
    socket.join(room(session));
    acknowledge(ack, { ok: true, paired: Boolean(session.pairedAt), device: session.device });
  });

  socket.on("phone:pair", async (data = {}, ack) => {
    const code = String(data.code || "").replace(/\D/g, "");
    const session = pairing.findByCode(code);
    if (!session) return acknowledge(ack, { ok: false, error: "Code invalid or expired" });
    const claims = verifyToken(data.accessToken);
    if (!claims || claims.sub !== session.userId) return acknowledge(ack, { ok: false, error: "Sign in with the same account used on desktop" });
    const device = data.device || {};
    if (!device.deviceId || !device.name) return acknowledge(ack, { ok: false, error: "Device identity is required" });

    session.phoneToken = pairing.token();
    session.phoneSocketId = socket.id;
    socket.data.pairingId = session.pairingId;
    socket.data.peerType = "phone";
    session.device = { deviceId: String(device.deviceId), name: String(device.name).slice(0, 80), model: String(device.model || ""), androidVersion: String(device.androidVersion || "") };
    session.pairedAt = Date.now();
    session.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    socket.join(room(session));

    if (mongoose.connection.readyState === 1) {
      const tokenHash = crypto.createHash("sha256").update(session.phoneToken).digest("hex");
      Device.findOneAndUpdate({ deviceId: session.device.deviceId }, { ...session.device, tokenHash, pairedDesktopName: session.desktopName, lastSeenAt: new Date() }, { upsert: true }).catch(console.error);
    }
    const result = { ok: true, pairingId: session.pairingId, phoneToken: session.phoneToken, desktopName: session.desktopName };
    acknowledge(ack, result);
    io.to(room(session)).emit("pairing:complete", { pairingId: session.pairingId, device: session.device });
  });

  socket.on("phone:resume", (data = {}, ack) => {
    const session = pairing.get(data.pairingId);
    if (!validPhone(session, data.phoneToken)) return acknowledge(ack, { ok: false, error: "Saved pairing is no longer valid" });
    session.phoneSocketId = socket.id;
    socket.data.pairingId = session.pairingId;
    socket.data.peerType = "phone";
    socket.join(room(session));
    acknowledge(ack, { ok: true, desktopName: session.desktopName });
    io.to(session.desktopSocketId || "").emit("device:online", { device: session.device });
  });

  socket.on("desktop:command", (data = {}, ack) => {
    const session = pairing.get(data.pairingId);
    if (!validDesktop(session, data.desktopToken) || !session.pairedAt) return acknowledge(ack, { ok: false, error: "Desktop is not paired" });
    if (!session.phoneSocketId) return acknowledge(ack, { ok: false, error: "Phone is offline" });
    io.to(session.phoneSocketId).emit("phone:command", data.command || {});
    acknowledge(ack, { ok: true });
  });

  socket.on("phone:event", (data = {}, ack) => {
    const session = pairing.get(data.pairingId);
    if (!validPhone(session, data.phoneToken)) return acknowledge(ack, { ok: false, error: "Phone is not authenticated" });
    if (session.desktopSocketId) io.to(session.desktopSocketId).emit("desktop:event", data.event || {});
    acknowledge(ack, { ok: true });
  });

  socket.on("disconnect", () => {
    const session = pairing.get(socket.data.pairingId);
    if (!session) return;
    if (socket.data.peerType === "phone" && session.phoneSocketId === socket.id) {
      session.phoneSocketId = null;
      if (session.desktopSocketId) io.to(session.desktopSocketId).emit("device:offline");
    }
    if (socket.data.peerType === "desktop" && session.desktopSocketId === socket.id) session.desktopSocketId = null;
  });
});

async function start() {
  await connectDB();
  server.listen(port, "0.0.0.0", () => console.log(`Lionex Bridge listening on http://0.0.0.0:${port}`));
}

if (require.main === module) start();
module.exports = { app, server, io, start };
