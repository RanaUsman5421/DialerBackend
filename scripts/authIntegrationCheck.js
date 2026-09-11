require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { server } = require("../server");

(async () => {
  const email = `codex-auth-${Date.now()}@example.invalid`;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const credentials = { name: "Auth Diagnostic", email, password: "Diagnostic-Only-9482" };
    const signupResponse = await fetch(`${url}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials) });
    const signup = await signupResponse.json();
    if (signupResponse.status !== 201 || !signup.token) throw new Error(`Signup failed (${signupResponse.status}): ${JSON.stringify(signup)}`);
    const loginResponse = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: credentials.password }) });
    const login = await loginResponse.json();
    if (loginResponse.status !== 200 || !login.token) throw new Error(`Login failed (${loginResponse.status}): ${JSON.stringify(login)}`);
    console.log("Auth signup/login integration check passed");
  } finally {
    if (mongoose.connection.readyState === 1) await User.deleteOne({ email });
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
