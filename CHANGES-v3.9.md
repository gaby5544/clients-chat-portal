# v3.9 — account details, wallpapers, seller bottom bar

Built on your v3.8 zip. Nothing was removed: the only edited existing lines are the version number, one `<link>` and one `<script>` tag in `index.html`, the new handlers inserted in `socketHandlers.js`, and the test server's file-type list. Everything else is new files.

## 1. Account details for approved sellers (Northvale-style card)
- New **Accounts** page: hero with the seller's balance, account type, "Verified" and name; USD / EUR / GBP tabs; "Account holder details" and "Bank details" groups; info note; Save as PDF.
- **No copy buttons anywhere.** Every detail is shown in full by default. The eye button hides the balance and account numbers if the seller wants privacy.
- Appears only after identity verification is **approved**. Before that the seller sees a locked card with "Verify identity" (or "being reviewed").
- Reachable from the bottom bar, the sidebar, and a "Receive money" shortcut on the dashboard.
- Each seller's account number / IBAN is generated once at approval and then frozen. IBANs carry real ISO 13616 check digits (verified in tests). No two sellers share a number.
- **Controls -> Receiving bank details** (Desk): edit bank name, address, SWIFT/BIC, routing / bank code / sort code. Until you save, every card says **"Sample data only"**. Existing sellers keep the details first issued; "re-issue" is available per seller (`admin-reissue-receiving-details`).
- Server: `bankDetails.js`; events `get-receiving-details`, `get-bank-profiles`, `admin-set-bank-profiles`.

## 2. Wallpapers = home page and wall, number 1 by default
- Six styles: 1 Aurora (default), 2 Midnight Stripe, 3 Bronze Silk, 4 Summit, 5 Crimson Dots, 6 Sapphire Eclipse. Phone UI buttons and watermarks were cropped out of your screenshots; images are compressed WebP in `public/wallpapers/`.
- Each seller has a **palette button** (top bar and Profile) opening a picker. The choice becomes the background of their account home and of their conversation wall, and tints the accent colour.
- Saved on the seller's account (follows them to any device) and remembered on the device for instant loading. Admins and buyers are not affected.
- The public landing page also uses style 1.

## 3. Seller screen like your last image
- Rounded bottom bar: **Home, Transfer, Accounts, Profile**, teal for the active item. Home = dashboard, Transfer = withdraw. On desktop it sits inside the main area.
- Transactions, Statements, Forms, Security and Help stay in the sidebar (hamburger on phones). Glass-style panels sit over the wallpaper.

## Tests
Server 25/25 (`test/v38.js`), browser 51/51 (`test/ui_v38.py` with `test/dump_v38.js`), plus all existing suites green (scenario 99, recovery 23, email 10, mailer 25, translate 10, Postgres and PDF checks).

## Please read
- **The sample bank details must be replaced** in Controls before real use. The generated account numbers and IBANs are only real if your partner bank actually issues accounts under that bank profile and number scheme. Do not publish them to payers until your bank confirms they can receive money.
- The card header shows "VISTRA" (matches your emails). Tell me if you want your configurable brand name there instead.
- `test/dump.js` (the old fixture generator) already crashed in the v3.8 zip before my changes, so the older `ui_test.py` could not be re-run. I did not alter it.
- Verified in headless Chromium at 360 / 400 / 1280 px. Not tested on physical Android / iPhone devices.
