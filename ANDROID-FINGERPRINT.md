# Getting the Vistra Android app with fingerprint unlock (v1.1)

The app source already contains the fingerprint code (`android-app/`). An Android app has to be *built and signed* by Google's
tools. You do not install anything: GitHub does it for you, free, in about 5 minutes.

## One-time setup (3 minutes)
1. Open your GitHub repository (the one Northflank deploys from) and upload / push this v3.16 folder content to it, so it contains
   `android-app/` and `.github/workflows/build-android.yml`.
2. Save your signing key (file `vistra-signing-key.txt`, sent to you separately): GitHub → **Settings → Secrets and variables →
   Actions → New repository secret**. Add two secrets with exactly these names:
   - `VISTRA_KEYSTORE_BASE64` — the long line from the file
   - `VISTRA_KEYSTORE_PASSWORD` — the key password from the file
   (If you skip this, the build still works with a one-time key, but phones would have to uninstall/reinstall when you later switch to your real key.)

## Build it
GitHub → **Actions → "Build Vistra Android app" → Run workflow**. When it finishes (green tick):
- the new `Vistra.apk` is saved into `public/downloads/Vistra.apk` in your repo, so your website's Download button serves it after Northflank redeploys, and
- it is also attached to the run as **Vistra-apk** (Artifacts, at the bottom of the run page).

## Install on a phone
- **First time moving from the old app (v1.0): uninstall the old Vistra app once, then install the new one.** (The old app was signed with a key that no longer exists, so Android will not treat the new file as an update.) After this, future updates install over the top.
- Open the downloaded `Vistra.apk` → allow "install unknown apps" if asked.
- Open the app → sign in → set your App PIN (Security) → the app asks **"Unlock with your fingerprint?"** → Turn on.

## Requirements and behaviour
- Android 9 or newer with at least one fingerprint saved in the phone's Settings. (Older phones, or phones with no fingerprint, keep using the PIN.)
- The fingerprint never leaves the phone. The app makes a private key inside the phone's secure hardware; it can only be used after a real fingerprint check, cannot be copied out, and Android destroys it if someone adds a new fingerprint to the phone (then the app falls back to the PIN and asks you to turn it on again).
- Only the public key is sent to the server; it verifies every unlock with a signature and a one-time challenge.
- The PIN always works.

## Building on your own computer instead (optional)
Install the Android SDK (platform 34, build-tools 34.0.0) and Java 17+, then:
`ANDROID_HOME=… KEYSTORE=vistra.keystore KEYPASS=… bash android-app/build-sdk.sh`
