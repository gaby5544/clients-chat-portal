# v3.14 — Transfer, App PIN, auto sign-out, card freeze, billing in the Desk

Only what was requested was added.

## 1. "Send" is now "Transfer" (bank transfer, not a crypto deposit)
- Home's first action and the Transfer tab open a **bank transfer** form: Local transfer / International wire, account holder, bank name, account number or IBAN (IBAN check digits verified), SWIFT / BIC (required for international), bank country, amount (with Max), optional reference.
- It uses the same secure pipeline as withdrawals: emailed 6-digit code, funds reserved, then the Desk reviews it (Pending → Processing → Completed). The reference travels to the Desk and into the emails.
- **Disbursement gate:** until the Desk moves the transaction to the disbursement stage, tapping Transfer shows a pop-up ("Transfers are not open yet" with the four stages and a Complete transaction button); the form is not shown. Once the stage is reached the page opens. The server enforces the same rule.
- **Admin-added sellers** (their room is already locked) are open immediately: no pop-up, no waiting. This also applies to their Withdraw page, since both use the same pipeline.
- The crypto deposit wizard is not lost: **Deposit crypto** is a row on the Accounts page (and still used by the card "Add funds" and the crypto-verification step).

## 2. AIRWX card billing address — Desk only
- The seller is no longer asked for a billing address (form removed from the seller's card page; anything sent is ignored).
- The Desk enters it in the issue form (street, apartment, city, state, ZIP/postal code, country; validated per country) and can correct it any time from the seller's profile. A card cannot be issued without it.
- The seller sees it only after the card is issued, when they tap **Show card details** (with the number/CVV; hidden again with them).

## 3. App PIN
- 6-digit PIN, stored only as a salted hash; weak PINs (111111, 123456…) refused. Set / change / remove on **Security**, always with the account password.
- Lock screen when the account opens (sign-in or reload). PIN is also asked for: showing card details, unfreezing the card, starting a transfer/withdrawal (enforced on the server).
- 5 wrong PINs lock PIN entry for 5 minutes. Sign out is always available on the lock screen.

## 4. Auto sign-out after 2 minutes without activity
Any seller session (account or chat) is signed out after 2 minutes with no touch, click, key or scroll; the next time they sign in again (and enter their PIN if set). A note on the sign-in page explains why. The Desk Officer page is not affected.

## 5. Card freeze
Seller can **Freeze card** / **Unfreeze card** (unfreeze asks for the PIN if set). A card frozen by the Desk cannot be unfrozen by the seller ("contact Support").

## 6. Incoming box
Names, references, amounts and status stay inside the box (wrapping instead of being cut at the edges).

## Notes
- Transfers appear in Activity as withdrawals (same record).
- Auto sign-out is enforced by the app in the browser (the session is also cleared on the server on sign-out); it cannot tell if a page was left open on a device that was switched off.

## Tests
Server: v42 53, v41 31, v40 76, v39 71, v38 50, scenario 99, recovery 23, email 10. Browser (headless Chromium): ui_v38 55, ui_v39 82, ui_v40 61, ui_v41 63, ui_v42 59 — all passing.
