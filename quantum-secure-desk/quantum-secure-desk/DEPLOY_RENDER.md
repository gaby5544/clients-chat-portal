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
   | `ADMIN_PASSKEY` | your own admin passkey (don't keep the default in production) |
   | `CORS_ORIGIN` | your Render URL once known, e.g. `https://your-app.onrender.com`, or `*` while testing |
   | `EMAIL_SERVICE` / `EMAIL_USER` / `EMAIL_PASS` | if using a named provider like Gmail (App Password required) |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | if using generic SMTP instead |
   | `EMAIL_FROM` | e.g. `"Quantum Desk Alerts <no-reply@yourdomain.com>"` |

   `PORT` does not need to be set — Render injects it automatically and
   `server.js` reads `process.env.PORT`.

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
- Click the shield icon (bottom of the icon rail) to log in as Admin using
  the `ADMIN_PASSKEY` you set.

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
