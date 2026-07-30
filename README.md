# Quantum Secure Transaction Desk — v2.0

Rebuilt chat portal: enterprise dark-glass UI, fixed Socket.IO event contract,
PostgreSQL persistence (with in-memory dev fallback), transaction board,
reactions/replies/pins/forwarding, drag-and-drop uploads, admin dashboard,
email notifications, and hardened input handling.

## What changed from the original repo

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
```
server.js              Entry point
src/
  db.js                 Picks Postgres or in-memory backend
  pgStore.js             Postgres implementation
  memStore.js             In-memory fallback (dev only)
  socketHandlers.js     All Socket.IO event logic
  routes.js              REST: file upload, CSV export, health check
  security.js            Escaping, sanitization, validation, rate limiting
  geo.js                  IP → country/flag resolution
  email.js                Nodemailer wrapper
public/
  index.html, css/style.css, js/app.js, js/i18n.js
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
