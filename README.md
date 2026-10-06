# Quantum Secure Transaction Desk — v3.1

Enterprise chat portal: dark-glass UI, PostgreSQL persistence (with
in-memory dev fallback), transaction board with PDF receipts, multi-admin
role tiers, announcements, tasks & approvals, live dashboard widgets, push
notifications, message read receipts, a Branding Center, onboarding, and
hardened input handling throughout.

## v3.1 — Seller Transaction Accounts
See `CHANGELOG.md` for the item-by-item list. In short: verified-email seller
registration, unique Account IDs, KYC with live face step, escrow payment
tracking (5-stage, auto-release), disbursement gate, bank/crypto withdrawals
with emailed codes, daily limit + business upgrade, IP blocking, 46-language
UI and chat translation, and a full admin control surface (Sellers tab, Funds
Desk, Record Incoming Funds, Policy).

**Needed in production:** a working mailbox (Zoho: `EMAIL_SERVICE=zoho`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` = same address, `ZOHO_REGION`) or an email provider key (`RESEND_API_KEY`, `BREVO_API_KEY`, `SENDGRID_API_KEY` or SMTP,
plus a verified `EMAIL_FROM`), `DATABASE_URL` (schema migrates itself on boot), a long random `RECEIPT_SECRET`, and
`TRUST_PROXY_HOPS` matching your hosting. A translation key (DeepL/Google/LibreTranslate) gives the best quality.
After deploying, open **Admin ▸ Accounts ▸ System status**: it shows email, translation, exchange-rate and IP
detection health, and has a **Send test email** button.

**Emails:** every message (codes, KYC, escrow stages, deposits, withdrawals, account notices, message alerts) uses one
premium template with a monogram badge, status chip, facts table and two footer desks: **Support** (`SUPPORT_EMAIL`) and
**Complaints & Escalations** (`COMPLAINTS_EMAIL`). Set `BRAND_NAME`, `BRAND_MONOGRAM`, `BRAND_TAGLINE`, `COMPANY_ADDRESS`
and `APP_URL` to personalise it. Use addresses on your own domain.

**Keeping email out of spam:** no code can force an inbox; what decides it is your domain's DNS. Publish **SPF**
(`v=spf1 include:zoho.com ~all`, use your region's domain), **DKIM** (Zoho Mail Admin ▸ Domains ▸ Email Configuration
▸ DKIM) and **DMARC** (`_dmarc` TXT, start with `p=none`, move to `quarantine` later), send from the same address you log
in with, then press **Check spam protection** in System status until every line is green. A brand-new domain also
needs a few days of normal sending to build reputation.

**How seller accounts are protected**
- A registered seller's account is opened by **signing in** (email + password). The invite link alone no longer
  gives access. Each signed-in browser is remembered (a hashed token), so the seller does not retype the password
  every time. The seller can sign out; the admin can sign the seller out of every device.
- Passwords are stored as salted hashes and **cannot be viewed by anyone**, including the admin and the company. This is
  deliberate: a screen that shows passwords would expose every seller's credentials (and every other site where they
  reuse the same password). Instead the admin has **Set temporary password** (shown once, replaces the old one, signs
  every device out), **Email password-reset code**, and **Sign out all devices**.
- Everything else about the seller is visible to the admin: name, email, phone, country, date of birth, language,
  Account ID, terms version and time, registration/last IP, IP log, KYC and business documents, balances.
- KYC images, business documents and proofs of payment are stored under unguessable `p_…` names and open only through
  signed links that expire after 6 hours (chat attachments stay public under unguessable names).

**IP detection:** taken from `X-Forwarded-For` counted from the right by `TRUST_PROXY_HOPS` (a visitor cannot forge
that part), or from `cf-connecting-ip` when `TRUST_CLOUDFLARE=1`. Blocks match the exact IPv4 address, or the whole
IPv6 /64. They are enforced at join, registration, sign-in, withdrawal, and cut live sessions at once.

**Known limits (be aware):**
- KYC checks are rule-based (format, name/DOB match, expiry, quality). There is no OCR or face-matching service
  (paid); the live face step uses the browser's face detector when available. A human approves or rejects.
- Free translation fallbacks (MyMemory, Lingva) have small quotas; set a DeepL/Google/LibreTranslate key for volume.
- Exchange rates (USD/GBP/EUR) come from a free public feed; if both sources are down the last saved rates are used.
- Not run in the build sandbox: a live Postgres, real email providers, a real translation provider, a real camera,
  and a real reverse proxy. Check them on your deployed host with the System status panel.

## v3.0 additions
- **Announcements** — Admin+ can post to any combination of groups; each one
  is inserted as a chat message and automatically pinned.
- **Tasks & Approvals** — Admin+ creates tasks (e.g. "Submit Documentation");
  any participant in that group can mark their own task Pending/Completed/
  Rejected. A live pending-count badge shows on the header Tasks icon and the
  admin dashboard.
- **Live Dashboard Widgets** — Online Users, Recent Transactions, Recent
  Uploads, and Pending Reviews, all pushed live to the admin panel as the
  underlying data changes (not just on refresh).
- **Push Notifications** — real Web Push (VAPID-based, no third-party
  service) with a service worker, working even with the browser fully closed
  on desktop and Android. **iOS honest caveat**: Apple only allows web push
  for sites added to the Home Screen (iOS 16.4+) — that's a platform
  restriction, not something this or any web app can work around.
- **Message status ticks** — Sent (single check) → Delivered (double check)
  → Read (bright double check), tracked server-side per recipient.
- **Multi-admin roles** — Super Admin (full control), Admin (group/
  transaction/task management), Moderator (message moderation only), each
  with their own passkey. See `DEPLOY.md` for the three env vars.
- **Branding Center** — Super Admin only: logo, two accent colors, welcome
  message, background image, and per-group banners — applied live for every
  visitor via CSS custom properties, no code changes needed.
- **Onboarding** — first-time regular users see a welcome modal with a short
  guided tour; shown once per browser.
- **PDF transaction receipts** — every submission generates a branded,
  professionally laid-out PDF, downloaded automatically by the submitter and
  available to admins from the Transactions tab.
- **Enterprise polish** — message fade-in animations, empty states, glowing
  redesigned send button, skeleton-ready structure, consistent spacing.

## What changed in the original rebuild

**Fixed event mismatches** (frontend and backend were using different event
names, so these features silently did nothing):
- Upload toggle now consistently uses `admin-toggle-upload-permission` /
  `upload-permission-changed` on both sides.
- Pin toggle now consistently uses `admin-toggle-pin-message` /
  `pinned-messages-updated` on both sides.

**Edit visibility**: regular users only ever receive the latest message text
(`message-edited` carries no edited flag to them). Edit history — the
previous versions of a message — is retrievable only via the admin-only
`admin-get-edit-history` event, verified server-side by admin session, not
just hidden in the UI.

**Security**: all user-generated text is HTML-escaped server-side before
storage (the original code injected raw text via `innerHTML`, which was an
open XSS hole); rate limiting on messages, uploads, form submissions, and
exports; file upload type/size validation; parameterized SQL everywhere (no
string-built queries).

**New features**: German/Italian/Turkish added to both the interface
language selector and the message-translation selector; user directory with
buyer/seller/admin grouping and automatic country flags (IP-based, works
for any country via Unicode regional indicators — no hardcoded flag list);
transaction board with per-group enable/disable, CSV export, and the full
requested form field set; message reactions, replies, forwarding, and a
long-press/right-click context menu; drag-and-drop uploads with image
previews; admin dashboard with live stats; offline message delivery via
unread counters + email notification.

## Structure
Everything sits directly in the repo root except `public/` (the web-servable
frontend) — deliberately flattened to a single folder so uploading to GitHub
can't silently drop a nested subfolder the way it did with the previous
multi-level layout.
```
server.js              Entry point
db.js                   Picks Postgres or in-memory backend
pgStore.js              Postgres implementation
memStore.js             In-memory fallback (dev only)
socketHandlers.js       All Socket.IO event logic
routes.js               REST: file upload, CSV export, PDF receipt, push, branding, health check
roles.js                Multi-admin role tiers (Super Admin/Admin/Moderator)
security.js             Escaping, sanitization, validation, rate limiting
email.js                Nodemailer wrapper
webpush.js              Web Push (VAPID) wrapper
pdfReceipt.js           Branded PDF transaction receipts
public/
  index.html, style.css, app.js, i18n.js, sw.js, icon-192.png
schema.sql              Postgres schema (auto-applied on boot)
DEPLOY.md               Host-agnostic deployment guide — read this first
DEPLOY_NORTHFLANK.md    Step-by-step walkthrough for Northflank (free, always-on, custom name)
DEPLOY_RENDER.md        Step-by-step Render deployment guide
.env.example            All configuration options
```

## Testing performed in this environment
- All backend modules pass `node -c` syntax checks.
- Server boots cleanly and serves HTTP/health/static/Socket.IO handshake.
- A Socket.IO integration test (real client, real server, no mocks) covers:
  join flow for regular users and admin, XSS-escaping, pin/upload toggle
  events end-to-end, transaction submission → admin notification, task
  creation, and announcement creation (auto-pinned). All assertions pass.
- Every store method called from `socketHandlers.js`/`routes.js` was
  cross-checked against both `pgStore.js` and `memStore.js` — no missing
  methods, no event-name mismatches between `public/app.js` and
  `socketHandlers.js`.
- The Postgres code path is syntax- and query-reviewed but **not** run
  against a live database in this sandbox (no external DB reachable here) —
  test it against your real Postgres instance before relying on it in
  production.
- v3.1.2: ~260 backend assertions (registration, codes, escrow engine, funds,
  withdrawals, limits, IP, notifications, translation) pass against stubbed
  mail/DB; a headless-browser smoke test loads the seller and admin screens
  with a mocked socket and reports no script errors. Not run here: a live
  Postgres, a real SMTP server, a real translation provider, or a real camera.

## A note on this copy of the repo
The zip this was rebuilt from had several files saved under the wrong
names — cosmetic packaging mistakes, not code bugs. `env.example` (missing
its leading dot) contained an old draft of `socketHandlers.js`, and there
were a `app.js` (actually CSS), a `style.css` (actually HTML), and two
generically-named `download` files (one an exact duplicate of `email.js`,
one an outdated draft of `routes.js`) sitting in the repo root. All of
those have been removed, and `.env.example` has been rebuilt as an actual
environment-variable template. Nothing in the real application code needed
fixing — see "Testing performed" above.

## Quick start
```bash
cp .env.example .env
npm install
npm start
```
Then open `http://localhost:3000`. For deploying somewhere it'll stay
online, start with `DEPLOY.md` (works on any host) or `DEPLOY_NORTHFLANK.md`
(step-by-step for a free, always-on host with a custom name). Render
instructions are still in `DEPLOY_RENDER.md` if you want them.
