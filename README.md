# Quantum Secure Transaction Desk — v3.0

Enterprise chat portal: dark-glass UI, PostgreSQL persistence (with
in-memory dev fallback), transaction board with PDF receipts, multi-admin
role tiers, announcements, tasks & approvals, live dashboard widgets, push
notifications, message read receipts, a Branding Center, onboarding, and
hardened input handling throughout.

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

## v3.1 — Seller accounts, KYC & the vault (new)

A parallel, password-protected identity layer for sellers ("Party A / Type
A"), separate from the free-form chat `session_token` above — real money
movement needs real authentication, not a client-picked name. A "seller
account" is a `groups` row with login credentials; the group **is** the
seller's dedicated workspace.

- **Invite → register → login**. Admin sends an invite by email
  (`POST /api/admin/invites`) from `public/admin-finance.html`; the seller
  opens `public/seller.html?invite=TOKEN`, which resolves and locks their
  email, then walks them through full name + password, naming their group,
  and choosing a currency (USD/GBP/EUR, locked after the first deposit).
  Subsequent visits just need `public/seller.html` — email + password only.
- **Forgot password**: email → 6-digit code (emailed, 10-minute expiry,
  single-use) → new password. Every response is worded identically whether
  or not the email is registered, so the endpoint can't be used to check
  who has an account.
- **KYC documents are never publicly served.** Unlike ordinary chat
  attachments (`/uploads`, served statically), photo IDs, proof-of-address
  documents and selfies are saved to a separate `kyc-uploads/` directory
  that has no static route at all. They're only reachable through
  `GET /api/kyc-file/:submissionId/:field`, which checks the requester is
  either the seller who owns that submission (via their session cookie) or
  an authenticated admin before streaming anything from disk.
- **KYC, reviewed manually only, no auto-approval**: sellers submit a photo
  ID (national ID / driver's license / passport), a proof of address dated
  within 3 months, and a selfie, from `seller.html`. An admin approves or
  rejects (with a reason) from `admin-finance.html`. Withdrawals are
  blocked (`403`) until `kyc_status = 'verified'` — and once verified, nothing
  in the seller-facing code can revert it; that's an admin-only action.
- **The vault**: one shared `held` balance covering money in either
  direction under manual review — an incoming deposit a seller reports
  (`POST /api/seller/deposits`) lands in `held` immediately (and counts
  toward Total Deposited) but not `available` until an admin verifies it
  actually arrived; an outgoing withdrawal moves the same way in reverse as
  an admin advances it through **Pending → Held in Vault → Processing →
  Completed** (or **Rejected/Failed** with a required reason at any stage).
  All of this is real, transactional balance math in both `memStore.js` and
  `pgStore.js` — see the test suite note below.
- **Withdrawals**: crypto (BTC/ETH/USDT, with a BEP20/TRC20 network picker
  for USDT) or bank transfer, gated on KYC. A crypto withdrawal can be
  *entered* in USD/GBP/EUR for convenience even though the account's ledger
  is fixed to one currency — it's converted server-side
  (see `fx.js` — **placeholder rates, swap for a live FX API before going
  live**) and both the entered amount and the ledger amount are kept for
  the audit trail.
- **Admin panel**: `public/admin-finance.html` — a shared-passkey-gated
  page (same model as the rest of the admin surface) with an invite sender
  and three live queues (KYC, deposits, withdrawals), each with
  approve/reject or stage-advance actions and a required reason on any
  decline. Everything pushes live via Socket.IO
  (`kyc-queue-updated`, `deposit-queue-updated`, `withdrawal-queue-updated`,
  and per-seller `*-status-changed` events) using the existing `admins` /
  per-group room pattern already in `socketHandlers.js`.
- **New tables** (`schema.sql`): `seller_sessions`, `password_reset_codes`,
  `kyc_submissions`, `deposits`, `withdrawal_requests`, `balances`, plus
  new columns on `groups` (`account_type`, `registration_status`,
  `invite_token`, `owner_email`, `owner_password_hash`, `currency`,
  `kyc_status`, …).
- **No new dependencies.** Password hashing uses Node's own built-in
  `crypto.scrypt` (see `sellerAuth.js`) rather than an external package —
  a memory-hard, well-regarded password hash that ships with Node itself.
  (An earlier draft of this feature used `bcryptjs`; it was swapped out
  after a lockfile/registry sync issue broke the Northflank build — see
  the note below.)
- **New env vars** — see `.env.example`: `RESET_CODE_SECRET` and the
  `DEPOSIT_*` vars (your actual receiving crypto addresses / bank details,
  shown to sellers when they go to deposit — these are placeholders until
  you set them).

**Known placeholders, called out in code comments where they live:**
- `fx.js` ships fixed, approximate FX rates. Swap `convert()` for a live
  FX API call (e.g. exchangerate.host) before relying on this for real
  amounts.
- There's no automated blockchain or bank-feed verification — by design,
  per the requirement that KYC and fund processing be reviewed manually.
  "Record a deposit" is the seller *telling* you funds are coming; an admin
  still confirms they actually arrived before verifying it.
- `io.to(groupId)` / `join-finance-room` trusts knowledge of the (UUID,
  unguessable) group id, the same trust boundary the rest of this file
  already uses for chat rooms. Tightening this to also check the seller's
  session cookie during the socket handshake is a reasonable hardening
  step if you want defense-in-depth here.

**Testing performed for v3.1** (see also "Testing performed" below for the
same caveat on the rest of the app): the full seller lifecycle — register,
login, password reset, deposit → vault → admin-verify, KYC submit →
admin-verify, withdrawal with currency conversion through
Pending → Held in Vault → Processing → Completed, a rejection path that
returns funds, and the guard against skipping straight from Pending to
Completed — was run end-to-end against `memStore.js` (32 assertions, all
passing) in this sandbox, which has no network access to install real
dependencies or run a live Postgres instance. `pgStore.js`'s SQL mirrors
that exact same logic (with `BEGIN`/`COMMIT`/`ROLLBACK` and `FOR UPDATE`
row locks around every balance-mutating query) and is syntax-checked, but
**not** exercised against a live database from here — test it against your
real Postgres instance before trusting it in production, same as the rest
of the Postgres code path.

**Deploy fix, 2026-09-27:** the first push of this feature set failed
Northflank's build with `npm error Missing: bcryptjs@2.4.3 from lock file`.
Cause: `bcryptjs` was added to `package.json` from a sandbox with no
network access, so `package-lock.json` never got regenerated to match, and
the buildpack's `npm ci` correctly refused to install with a mismatched
lockfile. Fixed by removing the dependency entirely rather than patching
the lockfile by hand — password hashing now uses Node's built-in
`crypto.scrypt` (see `sellerAuth.js`), so `package.json` and
`package-lock.json` need nothing added and can't drift apart again. If you
ever do add a real new dependency to this project by hand-editing
`package.json`, always run `npm install` locally and commit the updated
`package-lock.json` in the same commit — `npm ci` will not do this for you.

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
routes.js               REST: uploads, CSV export, PDF receipt, push, branding, health, seller/admin finance API
sellerAuth.js           Seller password hashing + session cookie auth (separate from chat's session_token)
fx.js                   Currency conversion — placeholder rates, see v3.1 notes above
roles.js                Multi-admin role tiers (Super Admin/Admin/Moderator)
security.js             Escaping, sanitization, validation, rate limiting
email.js                Nodemailer wrapper (incl. invites, reset codes, KYC/deposit/withdrawal notices)
webpush.js              Web Push (VAPID) wrapper
pdfReceipt.js           Branded PDF transaction receipts
public/
  index.html, style.css, app.js, i18n.js, sw.js, icon-192.png   Chat + admin UI
  seller.html             Seller dashboard: register/login/KYC/deposits/withdrawals
  admin-finance.html      Admin review panel: invites, KYC/deposit/withdrawal queues
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
- UI was not exercised in an actual browser from this environment; verify
  the visual layer once deployed.

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
Then open `http://localhost:3000` for the chat/admin app,
`http://localhost:3000/admin-finance.html` for the new KYC/deposit/
withdrawal review panel (same passkey as the rest of admin), and send
yourself an invite from there to try `http://localhost:3000/seller.html`
end-to-end. If you already have a Postgres database from an earlier
version of this app, no manual migration is needed — `schema.sql` re-runs
on every boot and every new table/column uses `IF NOT EXISTS`, so it's
safe to just restart.

For deploying somewhere it'll stay
online, start with `DEPLOY.md` (works on any host) or `DEPLOY_NORTHFLANK.md`
(step-by-step for a free, always-on host with a custom name). Render
instructions are still in `DEPLOY_RENDER.md` if you want them.
