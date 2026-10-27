# v3.17 — One US bank for every currency (optional) + "Bank country"

Added on top of v3.16. Nothing removed.

## What changed
- **Desk > Controls > Receiving accounts:** under EUR and GBP there is now a switch **"Use my US bank account for EUR / GBP"**. When it is on, sellers in that currency see the Desk's ONE US bank — the same bank name, **US address**, SWIFT/BIC, account number and ABA routing number as USD — with their own name and their own Payment reference. They are told to pay by **international SWIFT wire** (their payer's bank may convert the payment; fees can apply). Nothing is invented: it is the USD account already typed in. Off by default; each currency is switched independently.
- **No IBAN / sort code is shown in that mode.** An IBAN is issued by a bank and contains its country (DE…, GB…); a US account has none, so showing one would be false. A GBP/EUR account with its own real IBAN / sort code still works exactly as before (switch off).
- **New row "Bank country"** in every seller's bank details, read from the bank's own SWIFT/BIC (letters 5–6, e.g. CHASUS33 → United States, DEUTDEFF → Germany), so it can never disagree with the bank.
- Safety: EUR/GBP can only use the US bank if the USD account is saved and valid; the USD account cannot be removed while EUR/GBP depend on it; payment records for those sellers name the real account (••7359).

## Files
Edited: `bankDetails.js`, `public/index.html`, `package.json`. New: `public/v45.js`, `public/v45.css`, `test/ui_v45.py` (14 checks). Server checks for the new mode: 15 (all pass).

## Honest notes
- Whether your bank credits EUR/GBP wires to a US-dollar account, at what rate and with what fees, is up to your bank — please confirm with Chase before telling sellers it works.
- Only enter bank details that came from a bank for an account you control.
