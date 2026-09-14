const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const semver = require('semver');

function createUpdatesRouter(directory = path.resolve(__dirname, '../updates')) {
  const router = express.Router();
  const safe = name => typeof name === 'string' && /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name) && !name.includes('..');
  async function readConfig() {
    let raw;
    try { raw = await fs.readFile(path.join(directory,'updater.json'),'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; raw = await fs.readFile(path.join(directory,'latest.json'),'utf8'); }
    const config = JSON.parse(raw);
    if (!semver.valid(config.version) || !safe(config.installer) || !config.installer.endsWith('_x64-setup.exe') || !safe(config.signatureFile) || config.signatureFile !== `${config.installer}.sig` || !Number.isFinite(Date.parse(config.pub_date))) throw new Error('Invalid update metadata');
    return config;
  }
  async function resolveArtifact(name) {
    const realDirectory = await fs.realpath(directory);
    const realFile = await fs.realpath(path.join(directory,name));
    if (path.dirname(realFile) !== realDirectory || !(await fs.stat(realFile)).isFile()) throw new Error('Invalid artifact');
    return realFile;
  }
  router.get('/:target/:arch/:currentVersion', async (req,res) => {
    res.set('Cache-Control','no-store');
    if (!semver.valid(req.params.currentVersion)) return res.status(400).json({error:'Invalid installed version'});
    // Never send the Windows x64 installer to another OS/architecture.
    if (req.params.target !== 'windows' || req.params.arch !== 'x86_64') return res.status(204).end();
    try {
      const config = await readConfig();
      if (!semver.gt(config.version,req.params.currentVersion)) return res.status(204).end();
      await resolveArtifact(config.installer);
      const signature = (await fs.readFile(await resolveArtifact(config.signatureFile),'utf8')).trim();
      if (!signature) throw new Error('Empty signature');
      const origin = process.env.UPDATES_PUBLIC_URL || 'https://dialerbackend-k439.onrender.com';
      const url = new URL(`/updates/${encodeURIComponent(config.installer)}`,origin);
      if (url.protocol !== 'https:') throw new Error('HTTPS update URL required');
      return res.json({version:config.version,notes:String(config.notes || ''),pub_date:config.pub_date,url:url.href,signature});
    } catch { return res.status(503).json({error:'Signed update release is not ready'}); }
  });
  router.get('/:file', async (req,res) => {
    try {
      const config = await readConfig(), name = req.params.file;
      if (name !== config.installer && name !== config.signatureFile) return res.status(404).end();
      const file = await resolveArtifact(name);
      res.set('Cache-Control','no-store');
      res.type(name.endsWith('.sig')?'text/plain':'application/octet-stream');
      return res.sendFile(file);
    } catch { return res.status(404).end(); }
  });
  return router;
}
module.exports = createUpdatesRouter();
module.exports.createUpdatesRouter = createUpdatesRouter;
