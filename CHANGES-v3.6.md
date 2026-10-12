# v3.6 — one-tap install + a real Android app file

- **One tap installs.** The download button now calls the browser's own install prompt immediately — no instruction screen — whenever the browser offers it (Chrome, Edge, Samsung Internet, Opera on Android; Chrome/Edge on computers). The offer is captured the moment the page loads. Fixed my bug that opened the instructions even when the prompt was ready.
- **Android app file (APK)**: `public/downloads/Vistra.apk` (package `com.vistra.desk`, signed). It opens the site full-screen with its own icon; camera for the identity selfie, file uploads and microphone are supported. Offered on the sign-in screen, in the install guide and on `/install` for Android phones. Source and rebuild script are in `android-app/`. **The signing key is NOT in this repository** — keep `vistra.keystore` safe; every future update of the app must be signed with it.
- Android browsers that cannot install a web app get an "Open in Chrome — one-tap install" button; Edge/Opera on Android are now detected correctly.
- Inside the Android app, install buttons are hidden.

Limits: the APK is a thin shell around the website; web-push notifications and the CSV statement download do not work inside it (they still work in the browser/installed web app). I could not run it on a physical phone from here.
