# v3.9 — receiving account details, wallpapers, new seller app design

Nothing from earlier versions was removed. New files: `accountDetails.js`, `public/v39.js`, `public/v39.css`, `public/wallpapers/`, `test/v39_check.js`, `test/dump39.js`, `test/ui39.py`.

| # | Request | What was done |
|---|---|---|
| 1 | A proper account for every seller; once approved, show **all** account details, **no copy buttons** | New **Accounts** tab (Receive money) with USD / EUR / GBP: account holder, account number, ABA routing, sort code, IBAN, SWIFT/BIC, bank name and address, plus the seller's Account ID as the payment reference. Everything is displayed in full — nothing masked, no Copy / Copy-all buttons. **Share as PDF** prints all three currencies. **Server-enforced:** the details are not sent to the browser until the identity is approved (KYC `verified`, by an admin or by `KYC_AUTO_APPROVE`). Before approval the tab shows where the seller stands (not submitted / under review / not approved) with a Verify button. Approval pushes the details live and the approval notice says "your account details are ready under Accounts". |
| 1b | (needed to make it real) | Each seller gets a full set of details **generated from their Account ID** (deterministic; valid IBAN mod-97 and ABA check digit; nothing to lose on redeploy). **Admin ▸ Seller profile ▸ Receiving account details**: edit any value per seller, or *Reset to generated*. Fields you type are marked ✎ and only those are stored. |
| 2 / 2i | Add the wallpapers; seller picks a style; **#1 default**; works as home page **and** wall | Six styles (your six images, cropped clean — the Pinterest buttons and watermarks are gone). Each seller picks theirs with the palette button in the chat header or in **Profile ▸ Your style**. The choice is saved on the seller's account (`seller_wallpaper`, default 1) so it follows them to every device, and it is applied to the **home page** (Transaction Account) and the **chat wall**. Panels and bubbles become frosted glass so text stays readable on every style. |
| 3 | Seller design like your last image | The side menu is replaced by a **floating rounded bottom bar: Home · Transfer · Accounts · Profile** (active tab in teal), with a banking-style balance hero on Home (eye to hide the balance, status chips, Receive / Transfer / Activity shortcuts). Transactions, Statements, Forms, Security and Help are all still there — under **Profile ▸ More**, and via the back arrow. The old side-menu markup is kept in the page (hidden), so every earlier function still works. |

## New optional settings (all have defaults)
| Variable | Meaning |
|---|---|
| `ACCOUNT_BANK_NAME` | Bank name used in generated details (default `Quantum Secure Bank`; regional names are `… N.A.`, `… Europe AG`, `… UK Ltd`) |
| `ACCOUNT_BANK_NAME_USD/EUR/GBP`, `ACCOUNT_BANK_ADDRESS_USD/EUR/GBP`, `ACCOUNT_BANK_SWIFT_USD/EUR/GBP`, `ACCOUNT_BANK_CODE` | Override any part of the generated bank block |
| `ACCOUNT_DETAILS_AUTOGEN=false` | Show **only** details an admin typed in (sellers see "being prepared" until then) |

## IMPORTANT before real money
The generated numbers are **format-valid placeholders, not accounts at a real bank**, and the default bank addresses are the sample ones ("100 Example Street…"). Set your real banking partner with the variables above and/or type each seller's real details in the admin editor before any seller is told to receive money there. The admin editor shows an amber warning while a seller is still on generated values.

## Database
Two columns are added automatically at start-up: `groups.seller_wallpaper` (INTEGER, default 1) and `groups.seller_account_details` (JSONB).

## Tests
`node test/v39_check.js` (35 checks: details hidden until approval, checksums, determinism, admin edit/reset/sanitising, permissions, wallpaper default/validation/ownership), plus the existing suites (scenario 99, recovery 23, mailer 25, email 10, translate 10, pg_check, pdf_stub). `python3 test/ui39.py` (53 headless-browser checks at phone and desktop size, incl. no copy buttons, all pages reachable, print view, admin editor). Not run here: real Postgres, real devices, a real print-to-PDF on iOS.

## Notes
- The six wallpapers are the resolution you supplied (≈850 px wide). On large desktop screens they are enlarged and softened by the glass effect; drop sharper files over `public/wallpapers/wp-1.jpg … wp-6.jpg` (and `wp-N-thumb.jpg`) any time.
- The new screens are English, like the rest of the seller app's fixed labels.
- The crypto deposit page keeps its Copy button for the Desk's wallet addresses (needed to send funds) — that is not part of the account-details card.
