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
  with their own passkey. See `DEPLOY_RENDER.md` for the three env vars.
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
routes.js               REST: file upload, CSV export, health check
security.js             Escaping, sanitization, validation, rate limiting
email.js                Nodemailer wrapper
public/
  index.html, style.css, app.js, i18n.js
schema.sql              Postgres schema (auto-applied on boot)
DEPLOY_RENDER.md        Step-by-step Render deployment guide
.env.example            All configuration options
```

## Testing performed in this environment
- All backend modules pass `node -c` syntax checks.
- Server boots cleanly and serves HTTP/health/static/Socket.IO handshake.
- A 20-assertion Socket.IO integration test (real client, real server, no
  mocks) covers: join flow for regular users and admin, XSS-escaping,
  both previously-broken events end-to-end, edit history admin-gating,
  reactions, replies, transaction submission → admin notification → CSV
  export with auth, and upload MIME-type rejection. All 20 pass.
- The Postgres code path is syntax- and query-reviewed but **not** run
  against a live database in this sandbox (no external DB reachable here) —
  test it against your real Render Postgres instance before relying on it
  in production.
- UI was not exercised in an actual browser from this environment; verify
  the visual layer once deployed.

## Quick start
```bash
cp .env.example .env
npm install
npm start
```
Then open `http://localhost:3000`. See `DEPLOY_RENDER.md` for deploying to
Render with real Postgres persistence.
