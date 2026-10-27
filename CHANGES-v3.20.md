# v3.20 — Demo / sample mode removed

Added on top of v3.19.

- **Removed:** the demo / sample bank-details mode (the `ALLOW_SAMPLE_BANK_DETAILS` setting, the built-in sample accounts, the "Sample data only" label and the "Demo mode" text on the Desk). Setting the old variable now does nothing.
- Sellers see their real bank details, or "being prepared" until real details are saved. There is no other state.
- Tests updated (`test/v38.js` section 7 now proves a sample can never appear). All suites pass: server 13 files, browser ui_v38–ui_v46.
- Edited: `bankDetails.js`, `socketHandlers.js`, `fundsHandlers.js`, `public/v38.js`, `public/v38.css`, `test/v38.js`, `package.json`.
