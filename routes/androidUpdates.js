const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
function validate(config) {
  if (config.enabled === false) return null;
  const url = new URL(config.apkUrl);
  if (config.applicationId !== 'com.example.lionexphone' || !Number.isSafeInteger(config.versionCode) || config.versionCode < 1 || typeof config.versionName !== 'string' || !config.versionName || !/^[a-f0-9]{64}$/i.test(config.sha256) || !Number.isSafeInteger(config.sizeBytes) || config.sizeBytes < 1 || config.sizeBytes > 200*1024*1024 || url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || !/^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.apk$/.test(url.pathname)) throw new Error('Invalid Android release');
  return { applicationId: config.applicationId, versionCode: config.versionCode, versionName: config.versionName, apkUrl: url.href, sha256: config.sha256.toLowerCase(), sizeBytes: config.sizeBytes, notes: String(config.notes || '').slice(0,10000) };
}
function createAndroidUpdatesRouter(file = path.resolve(__dirname,'../updates/android/updater.json')) {
  const router = express.Router();
  router.get('/latest',async (_req,res)=>{
    res.set('Cache-Control','no-store');
    try {const config=validate(JSON.parse(await fs.readFile(file,'utf8'))); return config ? res.json(config) : res.status(204).end();}
    catch { return res.status(503).json({error:'Android update release is not ready'}); }
  });
  return router;
}
module.exports = createAndroidUpdatesRouter();
module.exports.validate = validate;
module.exports.createAndroidUpdatesRouter = createAndroidUpdatesRouter;
