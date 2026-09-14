# Android release artifact

`lionexphone-1.1.apk`: signed release APK, applicationId `com.example.lionexphone`, versionCode 2.

SHA-256: `b5a45ba6cec34956a4756947b390ff66d6f3d372d31d8e6f611dd1969d491cea`.

Rebuilt with the supplied orange/red phone logo; versionCode remains 2 / versionName 1.1 as requested.
The previous staged APK is backed up locally in LionexPhone/app/build/release-backups.
Already-installed 1.1 builds will not detect this same-version rebuild as a newer update; install it manually.

APK Signature Scheme v2 verified with Android SDK apksigner.
Public signing certificate SHA-256: `bbe07416b6b6ac64f13a6fe070aa3a525c44b42e0df185f379bf715d1e68550d`.
No private signing key or credentials are stored in this backend directory.

Push the APK if desired, then attach it to a public GitHub Release. The updater currently expects a direct
`https://github.com/OWNER/REPO/releases/download/TAG/FILE.apk` asset URL, not a GitHub blob/page URL.
Run `scripts/stageAndroidUpdate.mjs` with the APK, its versionCode/name and that real asset URL; copy its output
to this folder's updater.json and deploy the backend. Metadata stays disabled until a real URL is supplied.

For later releases and secure key backup instructions see `../../../LionexPhone/ANDROID-UPDATES.md`.
Existing debug-signed testing apps cannot update directly to this new release certificate.
Do not uninstall an existing testing installation without first considering loss of local app data.
