# v3.18 — Bank address optional · bank country required when sending money out

Added on top of v3.17. Nothing removed.

- **Receiving accounts (Desk → Controls):** "Bank address" is now **optional** for USD, EUR and GBP. If left blank, sellers simply do not see that row (name, SWIFT/BIC, account details and "Bank country" still show). If typed, it must still be a real-looking address (8+ characters).
- **Sending money out:** the bank **Transfer** form already had a required "Bank country" picker (with flags). The bank **Withdraw** form had one but did not require it — it is now required in the form and on the server, so every bank payout shows the destination country on the confirmation, the e-mails and the receipt.
- Tests: `test/v46.js` (5). All earlier suites unchanged and passing (server 10 files, browser ui_v38–ui_v45).

## Not changed (on purpose)
- No account numbers, IBANs or sort codes are invented. Only numbers a bank has really issued are shown; each seller already gets a unique Account ID as the payment reference. For a separate real account per seller, a bank / provider that issues them is needed, and each can be entered on that seller's profile.
