# v3.12 - automatic account name, real phone numbers, visible chat room, card billing address, closed rooms

Built on v3.11. Nothing was removed; existing files changed only where noted ("Touched files"). New files: `public/v40.js`, `public/v40.css`, `public/phoneRules.js`, `public/addressRules.js`, `loginProof.js`, tests `test/v40.js`, `test/ui_v40.py`.

## 1. Bank details: the Account name fills itself in
- The Desk's shared USD / EUR / GBP account **no longer has an "Account name" box**. Every verified seller sees **their own registered name** as the Account name, automatically and individually, together with the details for the currency they chose (USD: account number + ABA routing + SWIFT + bank; EUR: IBAN + SWIFT; GBP: sort code + account number + SWIFT) and their Account ID as the payment reference.
- A per-seller account (Seller profile) still works. Its Account name is optional (placeholder shows the seller's name); blank = the seller's name.
- **ABA routing / IBAN check-digit failures are warnings, not errors.** The value is saved and the Desk sees a warning toast ("double-check it with the bank"). Wrong lengths / malformed values are still refused. (Heads-up: a bank may compare the transfer's beneficiary name with the account name it holds; if your partner bank holds the account under the company name, payers' banks may flag a different name.)
- **Accounts page:** account number, IBAN, routing number and sort code show as **••••1234** until the seller taps the **eye** (Show / Hide). They are hidden again each time the seller returns to the page. "Save as PDF" temporarily reveals them so the PDF is usable.

## 2. Phone numbers must be real and match the country
- `public/phoneRules.js` (shared by browser and server): the dialling code must be the selected country's (+233 can never go with Nigeria), the length must be a real length for that country, and for larger countries the first digits must be valid (US/Canada cannot start with 0/1, UK mobile 07..., India 6-9, ...). Obvious fakes (1111111111, 1234567890) are refused. A country code typed inside the number box is recognised once, not doubled. Caribbean +1-xxx countries and the Dominican Republic (809/829/849) are handled.
- Registration: choosing the country sets the phone code automatically; a live hint shows a green tick with the full number, or the exact reason. The server enforces the same rule (registration and **Add seller**).
- It is a built-in rule table (no internet lookup), so it checks code + length + first digits, not whether the line is live.

## 3. Seller layout
- **Chat room is impossible to miss:** a "Chat room" button beside the profile icon (icon only on phones), a first item "Chat room - Talk to the Desk" in the side list, a 5th "Chat" item in the bottom bar, and "Back to chat room" pinned at the bottom of the side list (it was hidden under the bottom bar).
- Top bar: Support and the bell are removed. The seller's **country flag** (and name on wide screens) sits at the right.
- **Notifications** is now an item in the list (after Security, before Profile): push status with a one-tap "Turn on", and a list of recent updates (payments, card, tracking) with an unread dot.
- Seller chat header: the envelope and bell are removed (admins keep them).
- **Notifications switch on by themselves:** the app asks for permission and subscribes right after sign-in (and again on the first tap, which some phones require). Browsers never allow a site to force permission; if the person blocked it, the Notifications page explains how to allow it.
- **Bronze Silk** (style 3) is the default style for everybody who has not picked one.

## 4. Typing everywhere
- **Chat box:** no more thin one-letter column. On phones the typing box is full width with the **microphone beside Send**; Options / Translate / Attach sit on a row under it. On desktop it is one row. The clipboard (paste) button is removed (normal paste still works).
- **Universal keyboard settings** on every field (also fields added later): names -> Capitalised Words + auto-correct; chat/long text -> sentence capitals + auto-correct + spell-check; email -> lower-case, no auto-correct, email keyboard; password/codes/account numbers -> no auto-correct, right keyboard; phone -> number pad; address fields -> proper autofill. Auto-correct itself is done by each phone / browser keyboard (Android, iPhone, PC).

## 5. AIRWX card billing address
- Applying now needs a complete **billing address**: street, apartment (optional), city, state / province, ZIP / postal code, country. Country starts as the seller's country; it opens the dark searchable country list. Checks: US/Canada state names or codes (normalised to NY, ON ...), ZIP / postcode formats for ~80 countries (tidied, e.g. SW1A 2AA), postal code optional only where the country has none.
- Stored with the application; shown to the seller on the Card page (editable until the card is issued) and to the Desk above the issue form.

## 6. Desk (admin)
- **Add seller:** the country is a dark, searchable, scrolling list (not the white native list); currency and language use the dark dropdown; phone is checked against the country.
- **Change email silently:** Seller profile -> *Change email address*. Updates the sign-in email; sends **nothing** to the seller (no email to the old or new address, no push, no notice). Recorded in the account audit trail (visible in the profile). Refuses an address another seller uses.
- **Manually added sellers** get the "Your Transaction Account has been created" email as the **first (and only) message** they receive (verified by test).

## 7. Closed rooms: no more "link expired"
- The app **always opens**. An old link now lands on **Sign in / Create account** with a short note instead of a dead page.
- A person removed from a group, or whose group was deleted, can **still sign in and see their own account** (balance, details, statements, card...). Only the trading room is closed: Chat room buttons disappear, a banner explains it, and they cannot post.
- **Deleting a group no longer erases a registered seller's account.** The room is closed (chat wiped, hidden from the Desk's group list) and the account stays. A group with no registered seller is deleted completely as before.
- A buyer whose seat was removed has no account to show, so sign-in tells them plainly their access to that trading room has ended. A **banned** account still cannot sign in (clear "account closed" message).
- `loginProof.js`: a session that signed in with a password is remembered, so only a signed-in person gets their account on a closed link.

## Touched files
`bankDetails.js`, `cards.js`, `socketHandlers.js`, `accountHandlers.js`, `routes.js`, `links.js`, `server.js`, `finance.js`, `public/v38.js`, `public/v32.js` (one hook), `public/index.html` (4 tags), tests updated for the new rules (`test/v38.js`, `v39.js`, `ui_v38.py`, `ui_v39.py`, `scenario.js`, `harness.js`).

## Tests
`node test/v40.js` (76), `python3 test/ui_v40.py` (62) plus the full earlier suite (v38 50, v39 70+, ui_v38 55, ui_v39 80, scenario 99, recovery 23, email_check 10, pg_check, pdf_stub, flow, migration). Browser tests ran in headless Chromium at phone and desktop sizes; not tried on physical devices.
