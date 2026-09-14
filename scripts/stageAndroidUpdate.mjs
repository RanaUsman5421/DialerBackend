import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {validate}=require('../routes/androidUpdates');
const [apk,versionCode,versionName,apkUrl,...notes]=process.argv.slice(2);
if(!apk || !versionCode || !versionName || !apkUrl) throw new Error('Usage: node scripts/stageAndroidUpdate.mjs APK VERSION_CODE VERSION_NAME PUBLIC_GITHUB_RELEASE_APK_URL "Release notes"');
const file=resolve(apk);
const bytes=await readFile(file);
const config={enabled:true,applicationId:'com.example.lionexphone',versionCode:Number(versionCode),versionName,apkUrl,sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:(await stat(file)).size,notes:notes.join(' ')};
validate(config);
// Output only: review and copy this JSON to updates/android/updater.json.
console.log(JSON.stringify(config,null,2));
