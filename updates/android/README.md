# Android update release

Current release: `lionexphone-1.2.2.apk` (`com.example.lionexphone`, versionCode 4, versionName 1.2.2).
The APK was checked locally with Android SDK `aapt` and `apksigner`. Its release signing certificate SHA-256 is
`bbe07416b6b6ac64f13a6fe070aa3a525c44b42e0df185f379bf715d1e68550d`.
No signing key or passwords are stored in this backend repository.

`updater.json` points to the GitHub Release asset at tag `android-v1.2.2`, **not** a GitHub `blob/main` page.
On a push to `main` that changes the APK, metadata, verification script or publishing workflow,
`.github/workflows/publish-android-update.yml` verifies APK size/SHA-256 and creates the Release with APK attached.
The URL only works **after the GitHub Actions run succeeds**. GitHub Actions must be enabled and allowed to use
`contents: write`. If repository settings block publishing, enable that permission or manually create the Release
and attach the same APK.

Before pushing, run `node scripts/verifyAndroidRelease.mjs` from `DialerBackend`. After pushing, confirm the
**Publish Android update** Actions run succeeds, then open the `apkUrl` from `updater.json` in a browser: it must
download an APK. Only then test **Check for Updates** on the phone. The backend host must deploy this metadata too;
a repository push alone does not deploy a separately hosted backend.

For later versions, increase `versionCode` in LionexPhone, build with the **same** release signing key, copy the
new APK here as `lionexphone-VERSION.apk`, and regenerate `updater.json` with `stageAndroidUpdate.mjs` using
`https://github.com/RanaUsman5421/DialerBackend/releases/download/android-vVERSION/lionexphone-VERSION.apk`.
Run `node scripts/verifyAndroidRelease.mjs` and push to `main`. Never reuse a version/tag for different APK bytes.
See `../../../LionexPhone/ANDROID-UPDATES.md` for key backup and full release instructions.
