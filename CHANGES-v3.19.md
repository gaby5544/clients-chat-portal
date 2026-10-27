# v3.19 — A real account number for each seller, handed out automatically

Added on top of v3.18. Nothing removed.

## What it does
- **Desk → Controls → Receiving accounts:** under USD, EUR and GBP there is a new box **"Account number for each seller"**. Paste the account numbers (EUR: IBANs) that **your bank / provider has already issued to you**, one per line.
- Each newly verified seller **automatically receives the next free number and keeps it for good**. Everything else (bank name, SWIFT / BIC, ABA routing or sort code, shared IBAN fields) is typed once on the Desk and is the same for every seller of that currency.
- A seller sees only their own currency's details (the currency is chosen at registration and cannot be changed afterwards) — no currency switcher exists on the seller side.
- When the list is empty, sellers see the shared account with their Account ID as the payment reference (exactly as before). The Desk screen shows how many numbers are free / given out.
- Payment matching uses the seller's own number or their Account ID. A number typed by the Desk on one seller's profile still wins over the list.
- Checks: USD 4–17 digits, GBP exactly 8 digits, EUR must be a valid IBAN (a wrong check digit is refused); repeats are skipped; refused lines stay in the box so you can fix them. Numbers can only be added after the shared account for that currency is saved.

## Not done on purpose
The portal does **not invent** account numbers or IBANs. A number your bank never issued cannot receive money, and could even land in a stranger's account.

## Notes
- Sellers who already saw the shared account get their own number the next time they open their bank details (once the list has numbers). Payments sent to the shared account with their Account ID as the reference are still matched.
- The numbers are saved with the other Desk settings (kept permanently when a Postgres database is connected).

## Files
New: `public/v46.js`, `public/v46.css`, `test/v47.js` (15), `test/v48.js` (10), `test/ui_v46.py` (9). Edited: `bankDetails.js`, `socketHandlers.js`, `public/index.html`, `package.json`. All earlier suites unchanged and passing.
