# v3.4 — third fix list

| # | Change |
|---|---|
| 1 | **Admin login fixed.** The "link expired" redirect now never fires for the admin entry (`?officer=1`) or an admin session (your snippet, plus an `officer`/`isAdminConfirmed` check). Replaces the earlier `v32.js` line. |
| 2 | **Add seller manually** (Admin → Accounts → *All sellers* → *Add seller*): name, email, country, currency, phone, language. No registration form for the seller. The seller gets a welcome email, signs in with their email → *Forgot password* → 6-digit code → chooses their own password → KYC. Their **transaction room starts locked** (they see only their dashboard; chat shows "This transaction room is locked") until an admin unlocks it from the seller's card or profile. Payments appear on their dashboard like any seller. |
| 2b | **Every seller can change their password** (Account → Security) with confirmation email. |
| 3 | **Incoming-payment live tracking moved under Transactions** (dashboard keeps a small "N payments being verified → tap to follow" pointer). The line "Awaiting final release by the Desk to the main account" is removed from stage 6. |
| 4 | **Account ID, currency, country (with flag) and account type live in the sidebar** profile card — not on the dashboard header. |
| 4i | New seller pages: **Statements** (all payments/withdrawals/deposits, receipts, CSV download), **Security** (change password, recent sign-ins with location, protection tips), **Help & Support** (support + complaints contacts, FAQ, install app). |
| 5 | **Admin sees every seller in full**: *All sellers* table with name, email, phone, country, currency, Account ID, registration date, last sign-in + location, balances, KYC status, password (Show button; shown automatically in the full profile), and actions — Disable / Reactivate, **Ban / Unban** (closes the account and expires the link), Lock / Unlock room, sign-in alerts on/off. |

**Limits**: the Desk still confirms phone verification; IP location needs internet on the host. There is no separate "Settings" page — language and app install are in Profile and Help.
