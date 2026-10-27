# v3.21 — The Desk assigns each seller's account number · Statement of Account PDF

Added on top of v3.20. Nothing removed.

## 1. The Desk (company) assigns each seller's account number
- Nothing is handed out automatically any more (this replaces the v3.19 automatic hand-out). Open a seller's profile in the Desk: the new **"Account number for this seller"** box lets you **type** the number your bank issued, or press **"Assign next from my list (N free)"**. You can also **Remove** a number.
- It reaches the seller's bank details **immediately** (pushed live). The seller sees their number with the shared Chase fields (bank name, SWIFT / BIC, ABA routing; for GBP the sort code; for EUR the shared SWIFT) and their own registered name.
- **Incoming payments use the same number.** The receiving account stamped on each incoming payment, the account card, the tracker, e-mails and receipts all use the seller's assigned number, and a payment is matched by that number or by the seller's Account ID.
- Once the Desk has started using per-seller numbers for a currency (any number listed or assigned), a seller of that currency sees "being prepared" until their number is assigned.
- Rules: a number belongs to one seller only; formats are checked (USD 4–17 digits, GBP 8 digits, EUR a valid IBAN); changing or removing a number **retires** the old one so it can never reach another seller; only identity-verified sellers; Desk staff only.
- Still real numbers only: the portal does not invent bank numbers.

## 2. Statement of Account (PDF)
- Seller → Accounts → **Statement of account** (period: 30 days, 90 days, 6 months, 12 months, all activity) → **Download**. Generated on the spot from the seller's own ledger, in the same style as the receipts: holder, Account ID, receiving account (••last 4), money in / out / held / available, every payment in and out with date, reference, status and amount, period totals, document fingerprint, page numbers.
- Declined, failed and reversed items are listed greyed and not counted. The footer names the Quantum Secure Transaction Desk as the issuer and the fingerprint rule. Admin-only fields never appear.
- Link: `/api/statement/<group>?sig=…&range=30|90|180|365|all` (or `&from=YYYY-MM-DD&to=YYYY-MM-DD`), signed like the receipt links.

## Not added
- No bank logo is included: a third-party bank's logo would suggest an affiliation that doesn't exist. The receiving bank is shown by name.

## Tests
New/changed: `test/v47.js` (25), `test/v48.js` (15), `test/v49.js` (16, statement), `test/ui_v46.py` (16), `test/ui_v47.py` (10). All earlier suites unchanged and passing (server 14 files, browser ui_v38–ui_v47).
Note: the real `pdfkit` package is not installed in the offline test sandbox, so the PDF is verified with a recording stand-in (content, period filtering, pagination, signed route). Please open one statement on your server to check the look.

## Files
New: `public/v47.js`, `public/v47.css`, `test/v49.js`, `test/ui_v47.py`. Edited: `bankDetails.js`, `socketHandlers.js`, `pdfReceipt.js`, `finance.js`, `routes.js`, `public/v46.js`, `public/v46.css`, `public/index.html`, `package.json`.
