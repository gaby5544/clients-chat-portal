# v3.2 — what changed (16-point fix list)

**Deploy notes**
- Set `APP_URL` (e.g. https://your-host) so email buttons use your real address. If it is missing, the sign-in alert email falls back to the address the request came from.
- Optional: `GEOIP_PROVIDER=off` disables the outside IP-location lookup (free HTTPS providers ipwho.is / ipapi.co are used otherwise; needs internet on the host).
- Optional: `AUTO_SEND_OFFLINE_EMAILS=false` brings back the admin-approval queue for missed-message emails (default is now automatic).
- Postgres: new columns are added automatically at start-up (`groups.group_flags`, `users.last_ip/geo`, `incoming_funds.meta`).

| # | Change |
|---|---|
| 1 / 1i | Registration saves, then emits "account created" **first**; everything else (email, ledger, IP log) runs afterwards and can never block it. New next-step page: *Continue KYC verification* / *Go to transaction room*. Progress overlay while creating, a 6 s watchdog, and "already created" now moves the seller on instead of showing an error. |
| 2 | Installable app (manifest, maskable icon, caching service worker, install banner, `/install` page). Opening the installed app with no invite link shows a branded **sign-in screen**, never a group. Fonts, icons and flags are bundled — no outside CDN. Party view shows brand + "Secure Room" (no group name, no role/language dropdowns). |
| 3 | Deleted group ⇒ every invite link shows only the **link expired** page with support + complaints emails (HTTP 410, no app code). Buyers/sellers are evicted and **never switched** to another group. |
| 2b | Deleting a buyer/seller user expires that party's link and password sign-in. Admin can re-activate from the seller profile. |
| 3b | Sign-in security email: time, location, IP, device, "Yes, this was me" / "No, secure my account" links, app-download link. *No* blocks the IP, pauses sign-in 24 h and sends a reset code. Admin switch per seller. |
| 4 | Admin tabs were covered by status chips and toasts — chips/toasts no longer take clicks, drawer sits above. Online Users grouped Admins/Sellers/Buyers; online rows open the group, offline rows are inert. |
| 5 | Selfie must be a **real, live face** (face-api landmarks, bundled): no face ⇒ shutter locked; blink or head-turn required; uploads must contain exactly one face. Server rejects anything else. |
| 6 | Flags are bundled SVG images (work on every PC/phone). |
| 7 | IP + country/city shown to Admin / Super Admin only (directory and seller IP log). |
| 8 | Every email is "Dear <name>,"; group names are never printed; identity-verified email rewritten. |
| 9 | Any Admin / Super Admin can open a seller's password (audited). |
| 10 | Live tracking stays on the seller's account after completion (history + status). |
| 11 | Missed-message emails send automatically. |
| 12 | Record-funds form: "Use default" per field + "Fill all"; charges paid by the **buyer on top** (seller gets the full amount) / seller / none; seller sees charge, buyer total and "You receive". |
| 13 | Declined withdrawal: admin writes a proper reason (min 10 chars, ready-made presets); shown as "Reason for decline" in the account and in the email — "Email-code confirmed" removed. |
| 14 | Crypto deposit explanation: purpose, tier table (from your spec), one-time unlock, automatic credit, withdraw any time afterwards. |
| 15 | Withdrawal authorisation email lists every detail the seller entered; a "request received" email follows. |
| 16 | Tracking is six stages (new **Phone verification**); when finished the funds stay in the vault until the admin releases them. Option to auto-release per payment. |

**Honest limits**: phone verification is confirmed by the Desk (a real SMS/call needs a provider such as Twilio); liveness is blink/head-turn, not certified; IP location needs internet on the host.
