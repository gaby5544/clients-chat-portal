# v3.1.2 — withdrawal decline, private emails, crypto wording

| # | Issue raised | Fix | Where |
|---|---|---|---|
| 1 | Admin chose **Declined** but the seller's withdrawal was not declined / amount not returned | **Root cause:** the same withdrawal is drawn twice on the admin screen (Funds Desk card and Withdrawals queue) and both cards used identical control IDs, so "Update stage" read the *other* card's dropdown (still on Processing) and the reason box was ignored. Every control is now scoped to its own card. Also: the decline always returns the **full amount** to the seller's available balance (even if the pending pool was adjusted by hand), the reason box turns red and says "required" when Declined is picked, the admin gets a clear confirmation ("… returned to the seller's available balance"), and a Moderator who tries a money action now gets an explanation instead of silence | `admin31.js`, `fundsHandlers.js` |
| 2 | Seller could see the buyer's email in Email Alerts | The server now sends each person **only their own** address (buyer → buyer's, seller → seller's, admin → both); an admin changing one party's address no longer broadcasts it to the room; the browser remembers an alert address **per transaction and role** (it used to be one global value shared by buyer and seller); a seller's join ignores any address the browser supplies; a registered seller sees "alerts go to the email on your Transaction Account (se***@…)" instead of an editable box; outdated "once the Desk Officer approves" text removed | `socketHandlers.js`, `app.js` |
| 3 | Crypto withdrawal requirement sounded frightening | Rewritten in a calm, professional voice following the compliance spec: a one-time source-of-funds / AML funding trail; **not a fee** — the deposit is credited in full to the available balance once the Desk confirms it on-chain; permanently unlocks crypto withdrawals; bank withdrawals never affected; recalculated live as the amount changes. New: reassurance card on the Withdraw page with progress (verified / still to deposit), a "Why is this required?" explainer, a hint inside Record a Deposit showing how much is still needed, a "Deposit recorded" confirmation, and clearer confirmed / not-confirmed deposit emails. Tier percentages stay configurable in the admin Policy panel | `seller31.js`, `ui31.js`, `v31.css`, `index.html`, `email.js` |

Tests: 70 + 16 + 85 + 41 + 20 + 14 + 17 backend assertions, the escrow test and 7 headless-browser scenarios pass.

---

# v3.1.1 — fixes after review

| # | Issue raised | Fix | Where |
|---|---|---|---|
| 1 | Emails only sent when SMTP was set | Added HTTPS providers (Resend, Brevo, SendGrid) besides SMTP. Failures are recorded with the provider's reason, shown in **Admin ▸ Accounts ▸ System status** with a **Send test email** button. The seller sees "we could not send the email" instead of a silent success | `email.js`, `sellerHandlers.js`, `admin31.js`, `seller31.js` |
| 1b | Zoho mailbox must work and not land in spam | **Zoho-aware SMTP**: `EMAIL_SERVICE=zoho` picks smtp.zoho.<region> (`ZOHO_REGION`) and falls back to smtppro.zoho.<region>; start-up login check; readable errors (app-password / region hints); if Zoho refuses the From address mail is re-sent from the login mailbox. Better inbox placement: light standards-friendly HTML, plain-text part, Message-ID on your domain, Reply-To, `Auto-Submitted` header, `List-Unsubscribe` on reminder emails, no dummy default sender. **Check spam protection** button tests SPF, DKIM, DMARC, MX and From-vs-login for your domain and prints the exact DNS records to add | `email.js`, `sellerHandlers.js`, `admin31.js` |
| 1c | Elite, professional emails; separate Support and Complaints voices | New dark-and-gold layout (`emailTemplate.js`): monogram badge (first letter of `BRAND_NAME`, or `BRAND_MONOGRAM`), spaced brand line + tagline, colour-coded status chip, key-facts table, large code panel, call-to-action button, security call-out, signature, and two footer blocks: **Support** (help; Reply-To) and **Complaints & Escalations** (formal disputes), each with its own address and wording. Complaints is added to security-sensitive and negative notices (disabled, rejected, declined, reversed, withdrawal authorisation). Copy of all 27 notices rewritten; translated into the reader's language with right-to-left support; plain-text twin; no remote images; renders at phone width | `emailTemplate.js`, `email.js` |
| 2 | Translation quality / admin English-only | Chain: DeepL → Google → LibreTranslate → MyMemory → Lingva (keyless). Admin screens are now translated too (names, amounts, IDs and codes are protected). Status + live test in System status. **Fixed a bug where the chain crashed on a missing function** | `translate.js`, `xlate.js`, `admin31.js` |
| 3 | No OCR / face-match | Left as is by request (paid service) | – |
| 4 | KYC files not behind a login | Private uploads (`p_…`) open only with an HMAC-signed link that expires in 6 hours; signed when sent to the seller or admin. Path-traversal and encoded-name bypasses tested | `routes.js`, `finance.js` |
| 5 | Passwords not visible | **Deliberately not built** (it would expose every seller's credentials). Instead: *Set temporary password* (shown once, kills the old one, signs out all devices), *Email reset code*, *Sign out all devices*. All other seller information is visible to the admin | `sellerHandlers.js`, `admin31.js` |
| 6 | FX placeholders | Live USD/GBP/EUR rates (frankfurter.dev → open.er-api.com), refreshed every 6 h, saved to the DB, plausibility-checked, with manual refresh. Each payment keeps the rate it was converted at | `fx.js` |
| 7 | IP detection "perfect" | **Fixed spoofing**: the old code trusted the first X-Forwarded-For entry (any visitor could fake it). Now counted from the right by `TRUST_PROXY_HOPS`, plus Cloudflare mode, IPv4-mapped and IPv6 /64 matching. Enforced at join, register, **sign-in**, withdrawal and live. **IP detection** diagnostic in System status shows what the server sees | `security.js`, `sellerHandlers.js`, `routes.js`, `server.js` |
| 8 | (found while fixing) Invite link alone opened a registered account | Added seller **sign-in** (email + password), per-device trusted sessions, sign-out, admin "sign out all devices", forgot-password flow in the modal | `accounts.js`, `socketHandlers.js`, `routes.js`, `seller31.js`, `index.html` |
| 10 | Registration form stayed open with "This Transaction Account has already been created" | The account is now written in **one** save (account + trusted device + IP record); a failure in any later step (user profile, admin push) can no longer stop the seller being moved on; pressing Create again for an account that already exists simply re-sends the state and opens the **Start transaction / Continue KYC** screen instead of an error; the browser re-requests its account state if no reply arrives within 6 s (dropped mobile connection); one failing screen render can no longer stop the form closing | `sellerHandlers.js`, `seller31.js` |
| 9 | (found by static scan) | `admin-get-withdrawals-queue` called an undefined function; deposit decisions did not update the seller's list live | `socketHandlers.js` |

Tests: 70 + 16 + 85 backend assertions and the escrow engine test pass; headless-browser smoke tests of the seller, admin, sign-in and language screens report no script errors.

---

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
