process.env.JWT_SECRET ||= "integration-test-secret";
const jwt = require("jsonwebtoken");
const { io: client } = require("socket.io-client");
const { server } = require("../server");

const once = (socket, event) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000);
  socket.once(event, (value) => { clearTimeout(timeout); resolve(value); });
});
const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); const url = `http://127.0.0.1:${address.port}`;
  const accessToken = jwt.sign({ sub: "integration-user", email: "test@lionex.local" }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const response = await fetch(`${url}/api/pairing/sessions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ desktopName: "Integration Desktop", serverUrl: url }) });
  if (!response.ok) throw new Error(`Session endpoint returned ${response.status}`);
  const session = await response.json();
  if (!/^\d{6}$/.test(session.code) || !session.qrPayload.startsWith("lionex://pair")) throw new Error("Invalid pairing payload");

  const desktop = client(url); const phone = client(url); await Promise.all([once(desktop, "connect"), once(phone, "connect")]);
  const joined = await emitAck(desktop, "desktop:join", { pairingId: session.pairingId, desktopToken: session.desktopToken });
  if (!joined.ok) throw new Error(joined.error);
  const pairedEvent = once(desktop, "pairing:complete");
  const paired = await emitAck(phone, "phone:pair", { code: session.code, accessToken, device: { deviceId: "integration-phone", name: "Test Android", model: "Virtual", androidVersion: "17" } });
  if (!paired.ok) throw new Error(paired.error); await pairedEvent;
  const receivedCommand = once(phone, "phone:command");
  const commandAck = await emitAck(desktop, "desktop:command", { pairingId: session.pairingId, desktopToken: session.desktopToken, command: { type: "DIAL", number: "123" } });
  if (!commandAck.ok || (await receivedCommand).type !== "DIAL") throw new Error("Command relay failed");
  const receivedEvent = once(desktop, "desktop:event");
  const eventAck = await emitAck(phone, "phone:event", { pairingId: session.pairingId, phoneToken: paired.phoneToken, event: { type: "CALL_STATE", state: "DIALING" } });
  if (!eventAck.ok || (await receivedEvent).state !== "DIALING") throw new Error("Event relay failed");
  desktop.close(); phone.close(); await new Promise((resolve) => server.close(resolve));
  console.log("Pairing integration check passed");
})().catch(async (error) => { console.error(error); await new Promise((resolve) => server.close(resolve)); process.exitCode = 1; });
