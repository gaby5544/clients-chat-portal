# Changelog — v3.1.0 (Seller Transaction Accounts, escrow tracking, withdrawals)

Every item from the brief, one by one. File names show where the work lives.

## Section 1 — Registration, accounts, notifications, language

| # | Request | Done | Where |
|---|---|---|---|
| 1 | Seller registration: password eye toggle, confirm-password check, phone number, emailed verification code | ✔ Eye toggle + strength meter + live match check; phone field with auto dial-code from the country; 6-digit email code (10 min, 5 attempts, 30 s resend) must be verified before the form can submit | `index.html`, `seller31.js`, `sellerHandlers.js`, `email.js` |
| 1i | Pre-filled admin-set email — replace/remove it; note that it can never be changed | ✔ Pre-filled, can be replaced or removed *before* registering; a professional notice says it is permanently tied to the account; the server refuses any later change | same + `socketHandlers.js` |
| 2 | Saved user details visible to admin | ✔ Name, email, phone, country + flag, DOB, language, account type/ID, terms version + time, registration IP, last IP, IP log, KYC/business state — Admin ▸ Sellers and Funds Desk | `admin31.js`, `finance.js` |
| 3 | Password recovery really sends codes | ✔ Reset code emailed (hashed in DB, 10 min, single use). Admin can also email a reset code. Without SMTP configured, emails are logged and the Policy panel says so in red | `email.js`, `sellerHandlers.js` |
| 4 | Required ✔ Terms & Policy checkbox with professional escrow terms | ✔ Custom checkbox, full-text viewer, version + timestamp stored | `legal.js`, `ui31.js` |
| 5 | Scrollable, auto-searchable country select | ✔ Type-to-search by name or dial code, keyboard navigation, flags, scrollable list | `ui31.js` (`mountCountryPicker`), `countries.js` |
| 6 | Notifications: offline delivery, sound ×3 if inactive, hourly repeat, read receipts | ✔ Live socket, Web Push when no tab is active, email when offline (throttled), chime ×3 + vibration + title flash when the tab is inactive, repeats every 60 min while unread, "read" notice to the other side | `notify.js`, `ui31.js`, `sw.js`, `webpush.js` |
| 7 | Unique Account ID under "Account currency" | ✔ Auto-generated, unique, shown as "Account ID …" on the seller dashboard, receipts and tracker | `accounts.js`, `seller31.js` |
| 8 | Country + flag on the dashboard | ✔ Profile card, header and admin views | `ui31.js`, `seller31.js` |
| 9 | Admin disable/enable seller | ✔ Toggle with optional reason; seller notified live + push + email; a disabled seller sees a full-screen notice with **complaints@usvistra.com** | `sellerHandlers.js`, `admin31.js`, `seller31.js` |
| 10 | Translation in group chat and automatic notifications | ✔ Incoming chat messages auto-translate with "Show original"; server notifications are translated into the recipient's language | `xlate.js`, `translate.js`, `notify.js` |
| 11 | Preferred language everywhere, easy to find | ✔ Globe button in the chat header, in the account sidebar, and a first-visit prompt; 46 languages, RTL for Arabic/Hebrew/etc.; whole UI incl. the transaction account is translated | `xlate.js`, `languages.js`, `ui31.js` |
| 12 | "Standard account" pre-selected | ✔ Locked in at registration (Business is an upgrade) | `index.html`, `sellerHandlers.js` |

## Section 2 — Onboarding, KYC, funds, tracking

| # | Request | Done | Where |
|---|---|---|---|
| 1 | Post-registration popup: Start transaction / Continue KYC | ✔ Two-card popup; "Start transaction" goes to the group chat, "Continue KYC" opens the wizard | `seller31.js` (`obChoose`) |
| 2 | KYC with auto-reject (moderate), face verification visible | ✔ Server checks: name/DOB match, expiry, minimum age, ID format per document, duplicate ID, file type/size/dimensions, duplicate files; client checks sharpness/brightness. Reasons are listed to the seller. Live camera step with face oval + "face detected" badge | `kyc.js`, `seller31.js` |
| 3 | Funds shown elegantly ($2,000,000.00) | ✔ One formatter everywhere (UI, emails, PDFs) | `ui31.js`, `finance.js` |
| 4 | Seller transaction tracking from the escrow console | ✔ Seller ▸ **Payment tracking** only: 5-stage blinking live tracker; funds stay in the vault until the pipeline auto-releases them; stage 4 shows "Funds confirmed by escrow" and "Funds transferred to the seller account <Account ID>". Seller never sees timers (unless the admin opts in, active stage only) | `escrowReview.js`, `fundsHandlers.js`, `seller31.js` |
| 5 | Elite downloadable receipt with Account ID; admin internal note (buyer can/cannot see) | ✔ Branded PDF receipt with Account ID, payer, purpose, reference, review timeline. Internal note per payment with a "buyer and seller can see this" switch (shared notes post to the chat) | `pdfReceipt.js`, `admin31.js` |
| 6 | Complete "Record incoming funds" tab | ✔ Payer (name, type, email, phone, country, bank), payment (purpose, method, date, amount, currency, invoice/bank reference, crypto asset/network/wallet, proof upload), handling (escrow review / credit now / hold), review mode, speed, total time or per-stage times, notes, notify switch | `index.html`, `admin31.js` |
| 7 | Disbursement gate | ✔ ON/OFF per group, shown in the admin dashboard, chat header and seller account. Off ⇒ popup "not in the disbursement stage" with a **Complete the transaction** button that goes to the group | `sellerHandlers.js`, `admin31.js`, `seller31.js` |

## Section 3 — Withdrawals

| # | Request | Done | Where |
|---|---|---|---|
| 1 | Main → pending on request; 4 admin stages; blinking tracker; bank form clears cache | ✔ Pending / Processing / Declined / Completed (shown as "Completed"); funds move to pending when the emailed code is confirmed; declined refunds; completed is final. Blinking 3-node bank tracker. Form values reset and input names randomised on every open, on back/forward-cache restore and after submit | `fundsHandlers.js`, `seller31.js` |
| 2 | Crypto withdrawal record | ✔ Distinct elite card: date created, asset/network, masked wallet, blinking status | `seller31.js` |
| 3 | 10,000,000/day limit, unlimited via business KYC | ✔ Rolling 24 h limit in any account currency (editable in the admin Policy panel); popup offers "Request unlimited withdrawals" → business upgrade form (company name, registration ID, tax number, UBO, documents) → admin approves | `policy.js`, `kyc.js`, `seller31.js`, `admin31.js` |
| 4 | Email code for every withdrawal | ✔ Single-use, 10 min, 5 attempts | `sellerHandlers.js` |
| 5 | IP detection at register/login/withdraw; admin disable per seller | ✔ Logged on every action; admin can block/unblock any IP per seller; enforced at login (live sessions cut), registration and withdrawal | `security.js`, `sellerHandlers.js`, `admin31.js` |
| – | Crypto prior-deposit spec | ✔ Tiers: <$10k 15–25 %, $10k–100k 5–10 %, $100k–1M 1–5 %, >$1M flat $5k–25k (admin-configurable within those ranges). Shown in the popup, recalculated live as the amount changes, converted to USD. One-time unlock flag `crypto_deposit_verified`; admin override per seller; fiat unaffected | `policy.js`, `seller31.js`, `admin31.js` |

## Also changed
- `app.js` trimmed: the old seller/admin account code was replaced by `seller31.js`, `admin31.js`, `ui31.js`, `xlate.js`.
- Unused `applyI18n` removed; `sw.js` / `webpush.js` now carry tag + vibration.
- `.env.example` and `.gitignore` added; `uploads/` is shipped empty.
- Order of withdrawal gates: disbursement stage first, then KYC.
