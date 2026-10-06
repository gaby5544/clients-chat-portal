# Email setup (Zoho) — and how to stay out of spam

## 1. Environment variables (Zoho Mail)

| Variable | Value |
|---|---|
| `EMAIL_SERVICE` | `zoho` |
| `EMAIL_USER` | the **full mailbox address**, e.g. `no-reply@usvistra.com` |
| `EMAIL_PASS` | a Zoho **app-specific password** (My Account → Security → App Passwords) — required when two-factor is on |
| `EMAIL_FROM` | *(optional)* `"Vistra Quantum Secure Transaction Desk" <no-reply@usvistra.com>` — must be the same mailbox, or an alias on it |
| `ZOHO_REGION` | *(optional)* `com` (default), `eu`, `in`, `com.au`, `jp`, `ca`, `sa`, `com.cn`. Leave empty and the server finds your data centre by itself |
| `SUPPORT_EMAIL` | `support@usvistra.com` (shown on every email; replies go here) |
| `COMPLAINTS_EMAIL` | `complaints@usvistra.com` (shown separately as the Complaints desk) |
| `APP_URL` | your public site address, e.g. `https://desk.usvistra.com` (adds the gold “Open your account” buttons) |
| `SUPPORT_RESPONSE_TIME` | *(optional)* e.g. `one business day` — added to the Support card if you set it |

Then open **Accounts → Compliance settings → Email delivery** and press **Verify connection** and **Send test**.

## 2. Why mail lands in spam — and the three DNS records that fix it

Spam filters trust a message when the sending domain *proves* it authorised the mail. The application already does everything on its side (matching From address, plain-text + HTML parts, proper headers, no tracking links). The proof lives in your DNS (where `usvistra.com` is managed). In Zoho Mail → **Admin Console → Domains → usvistra.com** add:

1. **SPF** — one TXT record on `usvistra.com`: `v=spf1 include:zoho.com ~all`  
   (use `zoho.eu`, `zoho.in`, … for other data centres). There must be only **one** SPF record.
2. **DKIM** — in the same Zoho screen choose **DKIM → Add selector**, copy the TXT record Zoho shows into DNS, then press **Verify**.
3. **DMARC** — a TXT record on `_dmarc.usvistra.com`: `v=DMARC1; p=none; rua=mailto:no-reply@usvistra.com`  
   (move to `p=quarantine` once everything passes).

Use **Check deliverability** in the dashboard — it reads your live DNS and tells you which of these is missing and the exact value to add.

## 3. Habits that keep you out of spam
* Always send from an address on **your own domain** (never gmail/yahoo/outlook).
* Start with a few real emails (registration codes) before any bulk volume; keep Zoho’s daily sending limit in mind.
* Keep the subject lines and wording as they are — no ALL CAPS, no “free/urgent!!!”.
* If the first message lands in spam, mark it **Not spam** once; the next ones follow.

No software can *guarantee* inbox placement for every provider — but with SPF + DKIM + DMARC passing, mail from a properly configured Zoho domain reaches the inbox in the overwhelming majority of cases.

## 4. If your host blocks SMTP
Some hosts block outgoing SMTP ports. The dashboard will say so plainly. Then use an HTTPS provider instead (Resend, Brevo or SendGrid — all have free tiers): save its API key in **Email delivery**.
