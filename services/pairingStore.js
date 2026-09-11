const crypto = require("crypto");

const PAIRING_TTL_MS = Number(process.env.PAIRING_TTL_MS || 5 * 60 * 1000);
const sessions = new Map();

const token = () => crypto.randomBytes(32).toString("base64url");
const id = () => crypto.randomUUID();

function createSession(desktopName = "Lionex Desktop", publicUrl = "http://localhost:3000", userId) {
  let code;
  do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  while ([...sessions.values()].some((session) => session.code === code && session.expiresAt > Date.now()));

  const session = {
    pairingId: id(), code, desktopName: String(desktopName).slice(0, 80), userId: String(userId),
    desktopToken: token(), phoneToken: null, device: null,
    desktopSocketId: null, phoneSocketId: null,
    expiresAt: Date.now() + PAIRING_TTL_MS, pairedAt: null,
  };
  sessions.set(session.pairingId, session);
  return { ...session, qrPayload: `lionex://pair?server=${encodeURIComponent(publicUrl)}&code=${code}` };
}

function findByCode(code) {
  return [...sessions.values()].find((item) => item.code === String(code) && item.expiresAt > Date.now() && !item.pairedAt);
}

function get(pairingId) {
  const session = sessions.get(pairingId);
  if (!session || session.expiresAt <= Date.now()) return null;
  return session;
}

function publicSession(session) {
  return {
    pairingId: session.pairingId, code: session.code, desktopName: session.desktopName,
    expiresAt: new Date(session.expiresAt).toISOString(), paired: Boolean(session.pairedAt),
    device: session.device,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) if (session.expiresAt <= now && !session.pairedAt) sessions.delete(key);
}, 60_000).unref();

module.exports = { createSession, findByCode, get, publicSession, token };
