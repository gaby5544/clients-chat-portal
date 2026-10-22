# Deploying to Northflank (free, always-on, name it yourself)

Why Northflank over most other free Node hosts: its free **Sandbox** tier
is always-on (no sleeping/cold-starts, which matters for a live chat app),
includes a free Postgres database in the same tier, and lets you pick your
own service/project name, which becomes part of your app's URL. A card is
required to verify the account, but the Sandbox tier itself doesn't charge
you as long as you stay within its limits (2 services, 1 database, 2 cron
jobs).

If you'd rather not add a card, **Koyeb** is the fallback: no card
required, one free service, but it scales to zero after inactivity, so the
first message after a quiet period will be slightly delayed while it wakes
up. The env vars and steps below are almost identical there — Koyeb's
equivalent settings live under Service → Environment Variables, and your
custom name comes from the service name in `your-service.koyeb.app`.

## 1. Push this repo to GitHub
Northflank deploys from a Git repo. Create a repo (public or private —
private is fine, Northflank supports GitHub App installs on private repos)
and push this project to it.

## 2. Create a Northflank project
1. Sign up at [northflank.com](https://northflank.com) and create a new
   **Project**. The project name becomes part of your services' URLs, so
   pick something short and clean here, e.g. `quantum-desk`.

## 3. Add the free Postgres database
1. Inside your project: **Create new → Addon → Postgres**.
2. Name it (e.g. `quantum-desk-db`) and create it on the free Sandbox
   plan.
3. Once provisioned, open it and copy its connection string
   (`DATABASE_URL`-style, starts with `postgresql://`) — you'll paste this
   into the app service's environment variables next.

## 4. Create the app service
1. **Create new → Service → Combined (build + deploy from Git)**.
2. Connect the GitHub repo you pushed in step 1.
3. **Name the service** — this is the "customize the name" part. Whatever
   you type here becomes the subdomain segment in your app's free URL:
   ```
   https://p01--<service-name>--<project-name>--<account-id>.code.run
   ```
   You can rename the service later too. If you own a real domain, add it
   under Project → Domains once the service is live and Northflank issues
   a free HTTPS cert for it automatically — then the long `code.run` URL
   becomes optional.
4. Build settings:
   - **Build type**: Buildpack/Dockerfile auto-detect is fine — Northflank
     detects Node from `package.json` automatically.
   - **Run command**: `npm start`
5. **Networking / Ports**: add a public port, `3000`, HTTP, and check
   "Enable public access" so it gets a URL. (Leave the app's own `PORT` env
   var unset — Northflank injects the right value and `server.js` already
   reads `process.env.PORT`.)
6. **Environment variables** (Service → Environment):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Postgres connection string from step 3 |
   | `SUPER_ADMIN_PASSKEY` | pick a real value — do not keep the default |
   | `ADMIN_PASSKEY` | pick a real value |
   | `MODERATOR_PASSKEY` | pick a real value |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | optional, see note below |
   | `CORS_ORIGIN` | your `code.run` URL once known, or `*` while testing |
   | `EMAIL_SERVICE` / `EMAIL_USER` / `EMAIL_PASS` | optional, e.g. Gmail + App Password |
   | `EMAIL_FROM` | optional display "from" address |

   **VAPID keys**: skip them for the first deploy, watch the runtime logs
   for a line starting with `[push] No VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
   set`, copy the two keys it prints, paste them in as env vars, and
   redeploy once — after that push subscriptions survive restarts.

7. Deploy. Watch the build/runtime logs for:
   ```
   [storage] Connected to PostgreSQL. Persistence enabled.
   Quantum Secure Transaction Desk running on port XXXX
   ```

## 5. Persistent uploads (optional but recommended)
Chat file attachments are written to a local `uploads/` folder. Northflank
rebuilds the container filesystem on every redeploy, so without a volume,
attachments vanish on the next deploy. To keep them:
1. Service → **Volumes → Add volume**.
2. Mount path: `/app/uploads` (or wherever your build places the app —
   check the build logs if unsure).
3. Pick a size (1 GB is plenty to start).

Everything else — messages, users, groups, transactions, tasks,
announcements — is in Postgres and is unaffected either way.

## 6. First login
- Open your deployed URL. Regular users just pick a role (Buyer/Seller)
  and join.
- To log in as Super Admin/Admin/Moderator, visit your URL once with
  `?officer=1` appended (e.g.
  `https://p01--quantum-desk--quantum-desk--yourid.code.run/?officer=1`)
  — this reveals a shield icon that stays visible in that browser after.
  Click it and enter the matching passkey.

## Local development (unchanged, works the same regardless of host)
```bash
cp .env.example .env
npm install
npm start
```
