# v3.16 — Fingerprint unlock inside the Android app

Added on top of v3.15. Nothing removed.

## New
- **Native fingerprint bridge for the Android app (v1.1).** `android-app/src/com/vistra/desk/BiometricBridge.java` + `BioCrypto.java`: the phone's Android Keystore holds a P-256 key that needs a real fingerprint for every signature (hardware-backed where available, non-exportable, invalidated if the phone's fingerprints change). Android's own fingerprint sheet is shown ("Use PIN instead" button included).
- The answers use the same WebAuthn format as browsers, so **the server is unchanged** — it verifies them with the code from v3.15.
- `public/v43.js`: inside the app it talks to the bridge (`window.VistraBio`); in browsers it still uses WebAuthn. Clear messages for: cancelled, too many tries, fingerprints changed, no fingerprint saved, Android older than 9.
- `AndroidManifest.xml`: version 1.1 (code 2), `USE_BIOMETRIC`, `USE_FINGERPRINT`, optional fingerprint feature. User agent `VistraApp/1.1`.
- `android-app/build-sdk.sh` and `.github/workflows/build-android.yml`: build + sign + publish `public/downloads/Vistra.apk` on GitHub with one click. See `ANDROID-FINGERPRINT.md`.

## Safety
- The bridge only works for pages on the Vistra website over https, and only signs the website's own login/registration challenges for that website.
- Android 8 and older: the bridge is not installed; PIN only.

## Tests
`android-app/test/bio_native_check.js` (6): the app's crypto code (run on a real JDK) is verified by the server's real `webauthn.js`; replay, wrong challenge, wrong website, tampered signature refused. `test/ui_v44.py` (26): the website flow with a stand-in app bridge. Full earlier suites unchanged and passing.

## Honest limits
- The `.apk` itself could not be compiled in this workspace (Google's Android build servers are blocked). It is built by the GitHub workflow. The Java was type-checked here against stand-in Android classes and its crypto tested on a JDK; it has not run on a physical phone yet. Please test on one phone first.
- `public/downloads/Vistra.apk` in this package is still the old v1.0 until the GitHub build replaces it.
- The old app's signing key no longer exists, so phones must uninstall v1.0 once.
