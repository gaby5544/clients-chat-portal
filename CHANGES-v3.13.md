# v3.13 — Bank-style dashboard, exact ledger, Desk Officer console

Only what was requested was added.

## 1. Bank-style seller dashboard (replaces the old one)
- Balance card is first on Home: Available balance, Money in, Money out, name/account type and the account number (last 4) — or the Account ID if no bank details exist yet. Eye hides/shows the balance (remembered).
- Quick actions: Send, Receive, Withdraw, Statements. Four stat tiles: Total deposited, Fees paid, Withdrawn, Held in vault. Identity status row. Recent activity.
- Tap any activity row for a details sheet (status, reference, payer, account number/ID it landed in, receipt download; withdrawals show a masked destination).
- The virtual card now has its own page (Cards tab). New bottom bar: Home · Transfer · Cards · Activity · Profile. Transfer page: Send, Add money, Withdraw. Activity page: Money in / Money out + full list.
- Summit (wallpaper 4) is the default background.

## 2. Side list
Every option kept (Chat room, Dashboard, Accounts, Card, Transactions, Withdraw, Statements, Forms, Security, Notifications, Profile, Help & Support, Back to chat room) and **Sign out** added at the bottom (with confirmation). Also at the end of Profile.

## 3. Profile picture
Sellers can add their own picture instead of the initials (cropped to a small JPEG, saved to the account, shown in the top bar and Profile, synced across devices, removable).

## 4. Funds calculate exactly
New server ledger (`ledgerFor`): total deposited 100,020 − card fee 20 = available 100,000; money in − money out = available. Used on Home, Activity, statements and the admin ledger.

## 5. Account ID / account number in payment stages
- No bank details yet → the Account ID is used.
- Bank details added → the account number (IBAN for EUR) is used and shown ("Account number ••7765"), and incoming references match by either.
- Stage 4 of the payment tracker, the receipt PDF, the "Credited to" email row and the admin strip follow the same rule.

## 6. Removed
The "This invitation no longer opens a trading room…" notice.

## 7. Desk Officer (`?officer=1`)
A separate "Desk Officer Console · Restricted access" passkey page — no Create account, tour, download or Welcome. Nothing joins a room until a passkey is entered; a wrong passkey shows a message and clears the field; the right one opens the Desk. It never falls back to the client welcome screen.

## Not added (not requested)
Sample's PIN lock, auto-lock, card freeze toggle, "Send again" quick-send.

## Tests
Server: v41 31, v40 76, v39 70, v38 50, scenario 99, recovery 23, email 10. Browser (headless Chromium): ui_v38 55, ui_v39 80, ui_v40 61, ui_v41 64 — all passing.
