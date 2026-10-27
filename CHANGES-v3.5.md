# v3.5 — crypto deposits, app download for everyone, layout fixes

**Crypto deposits** (seller → Deposit): three wallets, each with QR code, address, one-tap Copy, network warnings, and an "I have sent the funds" form (amount + optional transaction ID). The Desk's addresses (checksum-verified, and the QR codes decoded back to confirm they match):
- Bitcoin — `bc1qs42pu5fnssfu7xzsfspylmdx9dqqqa4xnl0knz`
- USDT · BNB Smart Chain (BEP20) — `0xb61C2E8D64a26C0D8B72876b202ea4d0AC9F2484`
- USDT · Tron (TRC20) — `TFoXSskaH3mRb3ZrvEe6WELgLUjkXJoWzV`

**A deposit is credited only after it is confirmed.** Recording it shows "Awaiting confirmation" (held); neither the available balance nor *Total deposited* moves. The admin sees the transaction ID in the queue and presses *Confirm & credit* — only then is it added to the seller's **available balance** (and the seller is emailed). Rejected deposits release the hold and credit nothing. The seller also receives a "deposit recorded" email.
Admins can edit an address or switch a wallet off at **Controls → Deposit wallets** (addresses are format-checked; at least one must stay on).

**Download the app**: one guided "Download the app" button for buyers, sellers and admins (header, sign-in screen, Help). It detects iPhone/iPad, Android (Chrome / Samsung / Firefox), Windows, Mac, Firefox desktop and in-app browsers (WhatsApp, Facebook…) and shows the exact steps or a one-tap Install. `/install` page with a QR code (scan from a computer to install on a phone). Offline page, install screenshots, all orientations.

**Layout**: audited at 9 screen sizes (320 px phones to 1920 px desktops, tablets, landscape). Fixed the desktop app being a fixed 900 px tall (the message box fell off-screen on 768 px laptops). 

**Reliability**: the global rate limit (300 requests/min per IP) was counting flag images, fonts and sockets — static files and Socket.IO are now excluded, so busy offices and the country picker can no longer lock people out.

**Limits**: real Android (APK) and Windows (EXE) installer files cannot be produced here; the app installs from the browser on every platform. To get store-style files, give your website address to pwabuilder.com — it generates an Android package and a Windows package for free.
