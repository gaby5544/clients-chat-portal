# Deploying this app anywhere (host-agnostic)

Nothing in this codebase is tied to Render or any other specific host. It's
a plain Node.js + Express + Socket.IO app that reads its port from
`process.env.PORT`, so it runs on any platform that can run a persistent
Node process. That excludes pure static hosts (GitHub Pages, Netlify,
Cloudflare Pages) and serverless-function-only platforms (Vercel Hobby,
Netlify Functions) — those don't keep a socket connection open, and this
app's real-time chat needs one.

For a step-by-step walkthrough on a strong free, always-on option, see
`DEPLOY_NORTHFLANK.md`. This file covers what's true on *any* host.

## What every host needs from you
1. **The repo** — push this project to GitHub (or GitLab/Bitbucket).
2. **Build command**: `npm install`
3. **Start command**: `npm start` (runs `node server.js`)
4. **A port** — leave `PORT` unset; almost every host injects it and
   `server.js` already reads `process.env.PORT`, falling back to `3000`
   only for local dev.
5. **Environment variables** — set these in the host's dashboard (never
   commit a real `.env` file):

   | Key | Required? | Notes |
   |---|---|---|
   | `DATABASE_URL` | Strongly recommended | Postgres connection string. Without it the app falls back to in-memory storage and **loses all data on every restart**. Free Postgres: [Neon](https://neon.tech) or [Supabase](https://supabase.com) both work from any host. |
   | `SUPER_ADMIN_PASSKEY` | Yes | Change from the default before going live. |
   | `ADMIN_PASSKEY` | Yes | Change from the default. |
   | `MODERATOR_PASSKEY` | Yes | Change from the default. |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional | For push notifications to survive restarts. Generate once with `npx web-push generate-vapid-keys`. |
   | `CORS_ORIGIN` | Optional | Set to your deployed URL once you know it; `*` is fine while testing. |
   | `EMAIL_SERVICE` / `EMAIL_USER` / `EMAIL_PASS` **or** `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Optional | For offline-message and transaction email alerts. Leave unset and the app just logs emails to the console instead. |
   | `RESEND_API_KEY` **or** `BREVO_API_KEY` **or** `SENDGRID_API_KEY` | Recommended | HTTPS email providers (work even where SMTP ports are blocked). Required for sellers to receive verification and withdrawal codes unless you use SMTP above. |
   | `EMAIL_FROM` | Required with an email API | `Name <address@your-verified-domain>`. The provider rejects unverified senders; **Admin ▸ Accounts ▸ System status ▸ Send test email** shows the exact error. |
   | `SUPPORT_EMAIL` / `COMPLAINTS_EMAIL` | Recommended | The two desks shown in every email footer. Use addresses on your sending domain. |
   | `BRAND_NAME` / `BRAND_MONOGRAM` / `BRAND_TAGLINE` / `COMPANY_ADDRESS` / `APP_URL` | Optional | Email look and the "Open your account" button. |
   | `TRUST_PROXY_HOPS` | Recommended | Number of proxies in front of the app (default 1). Controls IP detection. Verify in System status. |
   | `TRUST_CLOUDFLARE` | Optional | `1` if behind Cloudflare. |
   | `RECEIPT_SECRET` | Recommended | Long random string; signs receipt and private-file links so they survive restarts. |

   Full reference with comments: `.env.example`.

6. **Websocket support** — confirm the host proxies WebSocket/Upgrade
   requests (every general-purpose Node host does; some pure "static +
   serverless function" platforms do not).

## The three admin tiers
`roles.js` defines three passkeys. A higher tier can do everything a lower
one can:
- **Super Admin** — everything, plus the Branding Center.
- **Admin** — group/transaction/task management, uploads, kicking users, DMs.
- **Moderator** — message moderation only (edit/delete/pin, edit history).

All three log in from the same hidden URL: visit your deployed site once
with `?officer=1` (e.g. `https://your-app-url/?officer=1`) — this reveals a
shield icon that then stays visible in that browser tab. Click it and enter
whichever passkey matches the access level you want to grant.

## File uploads & disk persistence
Chat attachments are written to a local `uploads/` folder via multer. Most
free container hosts (this one included) have **ephemeral disks** — files
written to local disk disappear on the next redeploy (they usually survive
plain restarts, just not redeploys). Chat messages, users, groups,
reactions, pins, tasks, announcements, and transactions are all in
Postgres and are unaffected by this — only attached files are at risk.

Two ways to fix it, if attachments need to last:
- Mount a **persistent volume** at the `uploads/` path, if your host offers
  one (Northflank, Fly.io, and Railway all do).
- Swap the multer disk storage in `routes.js` for an S3-compatible object
  store (Cloudflare R2 and Backblaze B2 both have workable free tiers) —
  more setup, but survives redeploys on any host, including ones without
  persistent volumes.

## Local development
```bash
cp .env.example .env
npm install
npm start
```
Without `DATABASE_URL` set, it runs on in-memory storage automatically —
fine for a quick local check, but everything resets when you stop it.
