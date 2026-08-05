# Deploying to Render

## 1. Push this repository to GitHub
Render deploys from a Git repo (GitHub/GitLab/Bitbucket). Push this project
to a repo if you haven't already.

## 2. Create the PostgreSQL database
1. In the Render dashboard: **New → PostgreSQL**.
2. Name it (e.g. `quantum-secure-desk-db`), pick a region close to your
   web service, choose a plan, and create it.
3. Once it's provisioned, open the database page and copy the
   **Internal Database URL** (starts with `postgresql://`). Use the
   *internal* URL if your web service is in the same Render region — it's
   faster and doesn't count against external bandwidth.
4. The app auto-creates all tables from `schema.sql` on first boot — no
   manual migration step needed. If you want to review or run it by hand,
   you can psql in with the **External Database URL** shown on the same page.

## 3. Create the Web Service
1. **New → Web Service**, connect the repo.
2. Settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Starter is enough to begin with.
3. Add Environment Variables (Settings → Environment):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Internal Database URL from step 2 |
   | `SUPER_ADMIN_PASSKEY` | full control, including Branding Center (default `SUPERADMIN123` — change this) |
   | `ADMIN_PASSKEY` | group/transaction/task management, no branding (default `ADMIN123` — change this) |
   | `MODERATOR_PASSKEY` | message moderation only — edit/delete/pin (default `MODERATOR123` — change this) |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | for push notifications to persist across restarts — see note below |
   | `CORS_ORIGIN` | your Render URL once known, e.g. `https://your-app.onrender.com`, or `*` while testing |
   | `EMAIL_SERVICE` / `EMAIL_USER` / `EMAIL_PASS` | if using a named provider like Gmail (App Password required) |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | if using generic SMTP instead |
   | `EMAIL_FROM` | e.g. `"Quantum Desk Alerts <no-reply@yourdomain.com>"` |

   `PORT` does not need to be set — Render injects it automatically and
   `server.js` reads `process.env.PORT`.

   **About the three passkeys**: these are three *separate* login codes for
   three access levels. Give the Super Admin one only to yourself/owners,
   the Admin one to day-to-day staff who manage groups and transactions,
   and the Moderator one to anyone who should only be able to moderate
   messages (edit/delete/pin) without touching groups, transactions, or
   branding. All three log in at the same hidden URL (`/?officer=1`) — the
   passkey you type determines which access level you get.

   **About VAPID keys**: if you don't set these, the server generates
   temporary ones on every boot and prints them to the logs — meaning
   everyone's push notification subscriptions break on every restart/
   redeploy. Deploy once, check the logs for a message starting with
   `[push] No VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY set`, copy the two keys
   it printed into your environment variables, and redeploy once more.
   After that they'll stay stable.

4. Deploy. Watch the logs for:
   ```
   [storage] Connected to PostgreSQL. Persistence enabled.
   Quantum Secure Transaction Desk running on port XXXX
   ```
   If you instead see the "No DATABASE_URL set" warning, double-check the
   `DATABASE_URL` environment variable is set and the service was redeployed
   after adding it.

## 4. Uploaded files & disk persistence
File attachments are written to the `uploads/` folder on the service's
local disk via multer. **Render's free/starter web service disk is
ephemeral** — files will disappear on redeploy (though they survive plain
restarts). This is fine for testing, but for production durability you have
two options:
- Add a Render **Persistent Disk** to the service and mount it at the
  `uploads/` path (Settings → Disks), or
- Swap the multer disk storage in `src/routes.js` for an object storage
  backend (S3, Cloudflare R2, Backblaze B2, etc.) — this is the more robust
  option and recommended if attachments matter long-term.

Chat messages, users, groups, reactions, pins, transactions, and unread
counts are all in Postgres and survive restarts/redeploys regardless.

## 5. First login
- Open the deployed URL. Regular users just pick a role (Buyer/Seller) and
  join.
- To log in as Super Admin, Admin, or Moderator, go to
  `https://your-app.onrender.com/?officer=1` once (bookmark it) — this
  reveals a shield icon that stays hidden from regular users. Click it and
  enter whichever passkey matches the access level you want.

## 6. Custom domain (optional)
Render → your service → Settings → Custom Domains → follow the CNAME/A
record instructions for your DNS provider.

## Local development
```bash
cp .env.example .env
npm install
npm start
```
Without `DATABASE_URL` set, the app runs on in-memory storage automatically
— useful for quick local testing, but data resets whenever you restart it.
