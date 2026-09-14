const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {createUpdatesRouter} = require('../routes/updates');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'lionex-updater-test-'));
  const app = express(); app.use('/updates',createUpdatesRouter(directory));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/updates`;
  const config = {version:'0.1.2',notes:'Test',pub_date:'2026-09-14T12:00:00Z',installer:'lionexdialer_0.1.2_x64-setup.exe',signatureFile:'lionexdialer_0.1.2_x64-setup.exe.sig'};
  try {
    assert.equal((await fetch(`${base}/windows/x86_64/0.1.1`)).status,503);
    await fs.writeFile(path.join(directory,'updater.json'),JSON.stringify(config));
    await fs.writeFile(path.join(directory,config.installer),'disposable test installer');
    await fs.writeFile(path.join(directory,config.signatureFile),'test-signature-content');
    const response = await fetch(`${base}/windows/x86_64/0.1.1`);
    assert.equal(response.status,200); const data = await response.json();
    assert.equal(data.signature,'test-signature-content'); assert.equal(data.version,'0.1.2'); assert(data.url.startsWith('https://'));
    assert.equal((await fetch(`${base}/windows/x86_64/0.1.2`)).status,204);
    assert.equal((await fetch(`${base}/windows/x86_64/0.1.3`)).status,204);
    assert.equal((await fetch(`${base}/windows/x86_64/not-a-version`)).status,400);
    assert.equal((await fetch(`${base}/linux/x86_64/0.1.1`)).status,204);
    assert.equal((await fetch(`${base}/windows/aarch64/0.1.1`)).status,204);
    assert.equal((await fetch(`${base}/${config.installer}`)).status,200);
    await fs.writeFile(path.join(directory,'secret.txt'),'must not be served');
    assert.equal((await fetch(`${base}/secret.txt`)).status,404);
    assert.equal((await fetch(`${base}/updater.json`)).status,404);
    config.installer='../secret.txt'; await fs.writeFile(path.join(directory,'updater.json'),JSON.stringify(config));
    assert.equal((await fetch(`${base}/windows/x86_64/0.1.1`)).status,503);
    console.log('Updater API passed: versions, platform isolation, missing artifacts, signatures, download allowlist and traversal rejection.');
  } finally { await new Promise(resolve=>server.close(resolve)); await fs.rm(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
