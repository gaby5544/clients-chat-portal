# v3.7 — cinematic intro, direct app downloads

**Intro tour (first time the app is opened):** after the circular splash, four swipeable slides with your images — globe & phone → hourglass → trolley of parcels → wallet — with Skip, Next, progress dots, keyboard arrows and a floating, glowing animation per slide. The last slide (wallet) shows a large **Get started** button and the Terms line. Shown once; "Take the tour" on the welcome screen replays it. Images were cut out of their black backgrounds (transparent WebP) so they sit cleanly on the app.

**Direct downloads — no more "Add to Chrome" / "Install app":**
- Android: one tap downloads `Vistra.apk` (`/downloads/Vistra.apk`), with the 3 install steps shown.
- Windows: one tap downloads `Vistra-Setup.exe` — a real installer that adds Vistra to the Start menu and desktop (per-user, no admin rights) and opens in its own app window. Source in `windows-app/`.
- iPhone / iPad: Apple does not allow any app to be installed outside the App Store, so Safari → Add to Home Screen remains the only route there (clearly explained).
- Download buttons: header, sign-in screen, banner, Help page, and the new cinematic `/install` page (with a QR code to open it on a phone). Share that link with clients.

**Notes:** `Vistra-Setup.exe` and `Vistra.apk` are unsigned by a commercial certificate, so Windows may show "Windows protected your PC" (More info → Run anyway) and Android asks to allow installs from the browser once. I could not run either file on a real device from here. The Android signing key stays private (not in this repo).
