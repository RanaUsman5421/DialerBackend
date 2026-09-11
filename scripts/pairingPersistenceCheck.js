require("dotenv").config();
const mongoose = require("mongoose");
const PairingSession = require("../models/PairingSession");

(async () => {
  let pairingId;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const firstStore = require("../services/pairingStore");
    const created = await firstStore.createSession("Persistence Check", "https://example.invalid", "diagnostic-user");
    pairingId = created.session.pairingId;
    const phoneToken = firstStore.token();
    await firstStore.markPaired(created.session, phoneToken, { deviceId: "diagnostic-device", name: "Diagnostic Android" });
    delete require.cache[require.resolve("../services/pairingStore")];
    const restartedStore = require("../services/pairingStore");
    const restored = await restartedStore.get(pairingId);
    if (!restored?.pairedAt || !restartedStore.verifyDesktop(restored, created.desktopToken) || !restartedStore.verifyPhone(restored, phoneToken)) throw new Error("Pairing did not survive store restart");
    console.log("Persistent pairing restart check passed");
  } finally {
    if (pairingId) await PairingSession.deleteOne({ pairingId });
    await mongoose.disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
