const crypto = require("crypto");
const mongoose = require("mongoose");
const PairingSession = require("../models/PairingSession");

const PAIRING_TTL_MS = Number(process.env.PAIRING_TTL_MS || 5 * 60 * 1000);
const sessions = new Map();
const token = () => crypto.randomBytes(32).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");
const id = () => crypto.randomUUID();
const usable = (session) => session && !session.revokedAt && (session.pairedAt || !session.expiresAt || new Date(session.expiresAt).getTime() > Date.now());

function cache(document) {
  if (!document) return null;
  const raw = document.toObject ? document.toObject() : document;
  const existing = sessions.get(raw.pairingId) || {};
  const session = { ...raw, desktopSocketId: existing.desktopSocketId || null, phoneSocketId: existing.phoneSocketId || null };
  sessions.set(session.pairingId, session);
  return session;
}

async function createSession(desktopName = "Lionex Desktop", publicUrl = "http://localhost:3000", userId) {
  let code;
  do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  while ([...sessions.values()].some((item) => item.code === code && usable(item) && !item.pairedAt));
  const desktopToken = token();
  const session = cache({ pairingId: id(), code, desktopName: String(desktopName).slice(0, 80), userId: String(userId), desktopTokenHash: hash(desktopToken), phoneTokenHash: null, device: null, pairedAt: null, expiresAt: new Date(Date.now() + PAIRING_TTL_MS), revokedAt: null });
  if (mongoose.connection.readyState === 1) await PairingSession.create({ ...session, desktopSocketId: undefined, phoneSocketId: undefined });
  return { session, desktopToken, qrPayload: `lionex://pair?server=${encodeURIComponent(publicUrl)}&code=${code}` };
}

async function get(pairingId) {
  const existing = sessions.get(String(pairingId));
  if (usable(existing)) return existing;
  if (mongoose.connection.readyState !== 1) return null;
  return cache(await PairingSession.findOne({ pairingId: String(pairingId), revokedAt: null }).lean());
}

async function findByCode(code) {
  const normalized = String(code);
  const existing = [...sessions.values()].find((item) => item.code === normalized && usable(item) && !item.pairedAt);
  if (existing) return existing;
  if (mongoose.connection.readyState !== 1) return null;
  return cache(await PairingSession.findOne({ code: normalized, pairedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).lean());
}

async function markPaired(session, phoneToken, device) {
  session.phoneTokenHash = hash(phoneToken); session.device = device; session.pairedAt = new Date(); session.expiresAt = null;
  if (mongoose.connection.readyState === 1) await PairingSession.updateOne({ pairingId: session.pairingId }, { $set: { phoneTokenHash: session.phoneTokenHash, device, pairedAt: session.pairedAt, expiresAt: null } });
}

async function revoke(session) {
  session.revokedAt = new Date(); sessions.delete(session.pairingId);
  if (mongoose.connection.readyState === 1) await PairingSession.updateOne({ pairingId: session.pairingId }, { $set: { revokedAt: session.revokedAt } });
}

function verifyDesktop(session, rawToken) { return Boolean(session?.desktopTokenHash && crypto.timingSafeEqual(Buffer.from(session.desktopTokenHash), Buffer.from(hash(rawToken)))); }
function verifyPhone(session, rawToken) { return Boolean(session?.phoneTokenHash && crypto.timingSafeEqual(Buffer.from(session.phoneTokenHash), Buffer.from(hash(rawToken)))); }
function publicSession(session) { return { pairingId: session.pairingId, code: session.code, desktopName: session.desktopName, expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null, paired: Boolean(session.pairedAt), device: session.device }; }

setInterval(() => { const now = Date.now(); for (const [key, session] of sessions) if (!session.pairedAt && session.expiresAt && new Date(session.expiresAt).getTime() <= now) sessions.delete(key); }, 60_000).unref();

module.exports = { createSession, findByCode, get, markPaired, revoke, publicSession, token, verifyDesktop, verifyPhone };
