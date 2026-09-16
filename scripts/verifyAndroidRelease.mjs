import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const repo = process.argv[2] || 'RanaUsman5421/DialerBackend';
const config = JSON.parse(await readFile(resolve('updates/android/updater.json'), 'utf8'));
if (config.enabled !== true || config.applicationId !== 'com.example.lionexphone')
  throw new Error('Android release metadata is disabled or has the wrong package');
if (!Number.isSafeInteger(config.versionCode) || config.versionCode < 1 ||
    !/^\d+\.\d+(?:\.\d+)*$/.test(config.versionName))
  throw new Error('Invalid Android version');

const apk = `updates/android/lionexphone-${config.versionName}.apk`;
const expectedUrl = `https://github.com/${repo}/releases/download/android-v${config.versionName}/lionexphone-${config.versionName}.apk`;
if (config.apkUrl !== expectedUrl)
  throw new Error(`APK URL must be ${expectedUrl}`);

const file = resolve(apk);
const size = (await stat(file)).size;
if (size !== config.sizeBytes) throw new Error('APK size does not match updater.json');
const hash = createHash('sha256').update(await readFile(file)).digest('hex');
if (hash !== String(config.sha256).toLowerCase())
  throw new Error('APK SHA-256 does not match updater.json');

console.log(`Verified ${apk}: ${size} bytes, SHA-256 ${hash}`);
