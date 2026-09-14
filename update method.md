Next update publish karne ka process yeh hai:
Android APK updater ka separate signing, credentials template, build aur GitHub publish method:
../LionexPhone/ANDROID-UPDATES.md
Android endpoint: /updates/android/latest. Android config: updates/android/updater.json.
Desktop ki updater.key ko Android signing mein use NA karein.
1. Changes complete karke version 0.1.1 se 0.1.2 karein, teen files mein:
   - LionexDialer/package.json
   - LionexDialer/src-tauri/Cargo.toml
   - LionexDialer/src-tauri/tauri.conf.json
2. LionexDialer folder ke terminal mein signed build banayein:
   npm run tauri:build:signed
   Yeh protected folder wali existing signing key automatically use karega. Nayi key generate nahi karni.
3. Release files backend mein stage karein:
   node scripts/stage-update.mjs "Is version mein remarks aur calling improvements."
   Yeh signature verify karke DialerBackend/updates mein installer, matching .sig aur updated updater.json rakhega.
4. Updated DialerBackend deploy/upload karein, including updates folder ki files. Sirf local files change karne se installed users ko update nahi milega.
5. Installed 0.1.1 app se top bar ka Update button click karke check → download → install test karein. Daily automatic check bhi local time 12 PM ke baad availability batayega.
Har aglay release par version increment karke yehi steps repeat karein.
Important: aapke tabs mein private LionexDialer/updater.key bhi nazar aa rahi hai. Private key ya signing credentials backend/GitHub par upload na karein. Build script ki default key location C:\Users\ADNAN\.tauri\lionexdialer\updater.key hai; project wali copy ki zaroorat nahi.
