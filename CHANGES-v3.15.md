# v3.15 — Fingerprint unlock

Added on top of v3.14. Nothing removed.

## What users get
- **Fingerprint (or face) unlock** for the App PIN. It uses the phone's own sensor; the fingerprint never leaves the phone.
- **One-time offer in the installed app.** After the first PIN unlock, the app asks "Unlock with your fingerprint?" — *Turn on fingerprint* or *Not now* (not asked again).
- **Security page card "Fingerprint unlock"** (browser and app): states for no sensor, PIN not set yet, Off, On. Lists the phones using it, this one marked. Turn on for this phone / Turn off.
- **Lock screen**: a "Use fingerprint" button next to the PIN keypad; the prompt opens by itself. Cancelling it shows no error. The PIN always still works.
- Also used when card details or a transfer ask for the PIN.

## Rules
- Needs an App PIN first; the PIN must have been entered recently to turn fingerprint on.
- Turning a phone off needs the account password.
- Removing the PIN turns off all fingerprints.
- Max 5 phones per account.

## Server (`webauthn.js`, `accountHandlers.js`)
Real WebAuthn verification: challenge (single use, 5 min), origin, rpId hash, user-presence + user-verified flags, signature counter (clone detection), ES256/RS256 signature. Events: `get-my-bio`, `bio-reg-options`, `bio-register`, `bio-auth-options`, `bio-auth`, `bio-remove`; replies `my-bio`, `bio-result`. Only the public key is stored (`group_flags.bioCreds`).

## Files
New: `webauthn.js`, `public/v43.js`, `public/v43.css`, `test/v43.js` (29), `test/ui_v43.py` (31). Edited: `accountHandlers.js`, `public/index.html`, `package.json`.

## Tested
All suites green: server v43 29, v42 53, v41 31, v40 76, v39 71, v38 50, scenario 99, recovery 23, email 10; browser v38 55, v39 82, v40 61, v41 63, v42 59, v43 31. Browser tests use headless Chromium with a mocked sensor; server tests use real signatures. Not tested on physical phones.

## Notes
- Works in browsers and installed web apps on devices with a fingerprint/face sensor, over HTTPS.
- The bundled Android APK is a plain WebView ("VistraApp/1.0"); fingerprint there needs a native biometric bridge and a rebuilt APK with your keystore, which can't be done in this sandbox.
