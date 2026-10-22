# v3.11 — Airwallex welcome slide, AIRWX virtual card, payments matched to the receiving account

Built on v3.10. Nothing was removed. Existing files changed only by additive lines (see "Touched files").

## 1. Welcome tour: slide 5 "Partnered with Airwallex"
- The tour now has **five** slides and five dots. Slides 1-4 are untouched; the Airwallex slide is number 5 (the last one).
- It reproduces the supplied hero: "Partnered with" + **Airwallex** appearing letter by letter, disappearing and appearing again (9 s loop); the rule with the shine; the four services **01-04** typed letter by letter **once** and then staying; the animated rings; and the virtual card (Jane Madison, 02/30, ending 2345) beside the text, underneath on phones.
- **Skip** works from slides 1-4 (as before). **Swipe, arrow keys, dots and Next** all work; the slide also **scrolls up and down** on small phones (a soft fade shows there is more). The last slide shows **Get started** and the Terms line, like the old last slide.
- Motion starts when the slide is shown and pauses when you leave it. If the visitor has "reduce motion" on, everything is shown static.
- Space Grotesk is loaded from Google Fonts (system fonts are the fallback).
- Brand note: "Partnered with Airwallex" should only be published if the partnership is real. No Airwallex logo or assets are used.

## 2. AIRWX virtual card (Visa)
**Default: NOT eligible.** A seller whose card is not switched on sees one screen: "Virtual card not available - your account is not eligible at the moment. Contact Support." Nothing else (no fee, no hint, no pop-up). The server sends such a seller only `{eligible:false}`.

**You switch it on per seller:** Seller profile -> *AIRWX virtual card* -> tick "Eligible". It can be switched off again at any time (the seller returns to "not eligible" live).

**Then the seller:**
1. **Apply** (identity verification required). If their available balance covers the fee, Apply also pays it.
2. **Pays the one-time issuing fee, 20 USD** (converted to their currency: 20 USD, 15.75 GBP, ... at the portal's FX table). It is taken from the available balance, atomically: tapping twice cannot charge twice or overdraw. If the balance is short the seller sees how much is missing and an **Add funds** button (the existing deposit flow). Change the fee with `CARD_FEE_USD`.
3. **Waits** while you generate the card ("We are generating your card", fee reference CF-XXXXXXXX). They are emailed when it is ready.
4. **Uses the card**: card art with AIRWX, VISA, the last four digits, expiry and name. "Show card details" reveals the full number and CVV for 30 seconds, then hides them again.
The fee appears in Statements as "Card fee".

**Your side:** *Controls -> AIRWX virtual cards* lists paid applications ("to generate"). Type the card your issuer generated (number, expiry, CVV, name) and press **Issue card**; or **Decline & refund fee** (the fee goes back to the seller's available balance in full). Seller profile also has **Freeze / Unfreeze**.

**Security (important):**
- The card number is **never invented by the portal.** A card number only exists once a real issuer has issued it. You enter the issued details; they are validated (16 digits, Visa prefix 4, Luhn check digit, expiry, 3-digit CVV, one number per seller).
- The number and CVV are stored **encrypted** (AES-256-GCM, the same vault as other secrets - set `PASSWORD_VAULT_KEY`). They are **never** sent in lists, to the Desk after saving (you see only the last four digits), or by email. Only the owning seller can reveal them; every reveal is counted and shown to you.
- Storing a full card number and CVV is subject to card-industry (PCI-DSS) rules. For a live programme, have your issuer (for example the Airwallex issuing API) hold the card data and show it through the issuer's secure display, and keep only the last four digits here.

## 3. Payments matched to the receiving account
One function (`bankDetails.receivingSnapshot`) decides "the seller's receiving account", so the account card, the incoming payment, tracker stage 4, the emails and the receipt can never disagree.
- **When you record incoming funds,** the payment is stamped with the account it lands in (currency, last four digits, bank, Account ID) and a **reference check**: does the payer's bank reference contain the seller's Account ID (matched / different / none)? The check is for the Desk only.
- **The record form** now shows "Pays into USD account ••7765 · Account ID ..." and warns if the reference lacks the Account ID, if the payment currency differs from the account (it will be converted), or if no receiving account is set yet.
- **The seller sees** "Received into: USD account ••7765 · Account ID ..." on each incoming payment, and the **Receive page lists incoming payments with their current stage** ("Stage 3 of 6 - Authenticity review"). Stage 4 of the tracker already names the same Account ID.
- **The email and the PDF receipt** say "Credited to USD account ••7765 (Account ID ...)" and, for a payment in another currency, the converted amount and rate.
- Payments recorded before v3.11 fall back to the Account ID.

## 4. Both bank-detail editors (verified)
- **Controls -> Receiving accounts** (your global USD / EUR / GBP account) and **Seller profile -> Receiving account** (one seller's own account) are covered by tests: validation, save, per-seller override, clear, and that the seller's view and the payment stamp both use the same account.

## Tests
Server 62/62 (`test/v39.js`), browser 77/77 (`test/ui_v39.py`), plus v3.10 server 46, v3.10 browser 54, scenario 99, recovery 23, email 10, and the Postgres, PDF, flow and migration checks. Not tested on physical phones, against a real mail provider or a real card issuer.

## Touched files
New: `cards.js`, `public/v39.js`, `public/v39.css`, `test/v39.js`, `test/ui_v39.py`, `test/dump_v39.js`.
Additive edits: `socketHandlers.js` (card handlers), `email.js` (`notifyCardStatus`), `bankDetails.js` (snapshot + reference check), `fundsHandlers.js` (stamp + email rows), `finance.js` (`receivedInto`), `pdfReceipt.js` ("Credited to"), `public/index.html` (links), `public/v32.js` (two lines: statement row, "Received into" line), `package.json` (3.11.0).
Env: `CARD_FEE_USD` (default 20), `CARD_RATE_MAX`, `CARD_REVEAL_MAX`.
