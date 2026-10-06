# Setting up your email (Zoho) — in plain English

You already have **usvistra.com** on Zoho Mail. This guide connects the Transaction Desk to it, and then makes sure
the emails land in people's **inbox, not spam**. It takes about 20 minutes. No coding.

> **How email works here:** the website logs into *one* Zoho mailbox (like a robot employee) and sends every email
> from it. The Zoho password you give it must be an **App Password** (a special password just for apps), not your
> normal one.

---

## Part 1 — Create the "sender" mailbox
1. Sign in to **Zoho Mail → Admin Console → Users → Add User**.
2. Create **`no-reply@usvistra.com`** (you can use any name you like, e.g. `desk@usvistra.com`).
   *This must be a real mailbox.* Zoho blocks mail "from" addresses that don't exist, and spam filters punish it.
3. You already use **support@usvistra.com** and **complaints@usvistra.com** — keep them. Customers reply to Support.

## Part 2 — Get the App Password
1. Open **https://accounts.zoho.com** (if your Zoho is in Europe/India use `accounts.zoho.eu` / `accounts.zoho.in`)
   and **sign in as the no-reply mailbox** (not as yourself). If you don't know its password, reset it in the Admin Console.
2. Go to **Security → App Passwords → Generate New Password**. Name it `Transaction Desk`.
3. Zoho shows a long password **once**. Copy it. *(If you can't see "App Passwords", switch on Two-Factor
   Authentication on that mailbox first — the option then appears.)*
4. In **Zoho Mail → Settings → Mail Accounts**, make sure **IMAP/SMTP access is on** for that mailbox.

## Part 3 — Tell the website (Northflank → your service → Environment → Runtime variables)
Add these, then **restart the service**:

| Name | Value | Meaning |
|---|---|---|
| `EMAIL_SERVICE` | `zoho` | use Zoho |
| `EMAIL_USER` | `no-reply@usvistra.com` | the **full** mailbox address |
| `EMAIL_PASS` | *(the App Password)* | not your normal password |
| `EMAIL_FROM` | `Vistra - Quantum Secure Transaction Desk <no-reply@usvistra.com>` | optional — the name people see |
| `APP_URL` | `https://your-site-address` | optional — adds an "Open the Transaction Desk" button to emails |

You do **not** need to know your Zoho "region" or server name — the website tries Zoho's servers (`smtp.zoho.com`,
`smtppro.zoho.com`, `.eu`, `.in`, `.com.au` …) automatically and remembers the one that works.
(To pin it anyway: `ZOHO_REGION=eu`.) Old names `SMTP_HOST / SMTP_USER / SMTP_PASS` still work too.

## Part 4 — Check it works
1. Open the site as admin → **Accounts** tab → **EMAIL DELIVERY (ZOHO)**.
2. It should say **"Connected — emails are being sent"** with the server name.
3. Type your own email and press **Send test email**. It should arrive in a minute.
4. In the server log you will also see `[email] ✅ Ready — sending through smtppro.zoho.com:465 …`.

When this is green, **security codes switch on automatically** (registration + every withdrawal). While it is not
working, codes stay off so no seller is ever locked out.

## Part 5 — Stay out of spam (the 3 DNS records)
Receiving servers (Gmail, Outlook…) ask three questions about your domain. You answer them with three DNS records.
**This matters more than anything in the code.** Where? Wherever your domain's DNS is managed (your registrar,
Cloudflare, etc.). In Zoho: **Admin Console → Domains → usvistra.com → Email Configuration**.

| Record | Where to add | Value | Why |
|---|---|---|---|
| **SPF** | TXT on `usvistra.com` | `v=spf1 include:zoho.com ~all` (Europe: `include:zoho.eu`) | says "Zoho may send for us". Only **one** SPF record allowed — merge if you have another. |
| **DKIM** | TXT shown by Zoho under **DKIM → Add selector** (e.g. `zoho._domainkey`) | copy exactly what Zoho shows, then press **Verify** | a digital signature proving the mail is really yours |
| **DMARC** | TXT on `_dmarc.usvistra.com` | `v=DMARC1; p=none; rua=mailto:support@usvistra.com` | tells servers what to do with fakes; start with `none`, move to `quarantine` after 2–3 weeks |

DNS changes can take up to a few hours. Then press **Check inbox-readiness** in the admin panel — it reads your DNS
and shows a ✅ or ❌ for SPF, DKIM, DMARC and MX, with the exact fix next to anything missing.

**Good habits the code already follows for you:** sends only from your real mailbox; plain-text *and* HTML version;
proper sender name; honest subjects; Reply-To = Support; automatic retries; no tracking pixels; no link shorteners.
**Please also:** don't email people who didn't register; if a test lands in Spam, open it and press **Not spam**;
note Zoho limits how many emails per day your plan can send.

> **Honest note:** nobody can *guarantee* inbox delivery — Gmail/Outlook decide. But with a real mailbox + SPF +
> DKIM + DMARC (all green in the checker) your transactional emails get the best treatment possible.

## If it says "Not working"
| Message | What it means / fix |
|---|---|
| *login refused … use a Zoho APP PASSWORD* | Wrong password type. Make a new App Password (Part 2) and paste it with no spaces. Check `EMAIL_USER` is the **full** address. |
| *still refused with the right App Password* | Your Zoho plan may not include SMTP, or IMAP/SMTP access is off (Part 2, step 4). Free Zoho plans can restrict this — upgrade to **Mail Lite** or use a free relay such as Brevo (300 emails/day) with the same 3 DNS records. |
| *cannot reach … (ETIMEDOUT)* | The hosting provider is blocking outgoing mail ports. We try 465 and 587; ask your host to allow them. |
| *Rejected … 553 / sender not allowed* | `EMAIL_FROM` isn't your mailbox. Use the mailbox address (or create an alias in Zoho and list it in `EMAIL_FROM_ALIASES`). |

## Which two addresses are used for what
* **support@usvistra.com — Client Support:** help with accounts, security codes, identity verification, deposits and
  withdrawals. Replies to every email go here.
* **complaints@usvistra.com — Complaints & Escalations:** formal complaints, disputed decisions, account reviews
  (e.g. a disabled account) and suspected unauthorised activity.
Both appear, with their own descriptions, in the footer of every email. Change them with `SUPPORT_EMAIL` and `COMPLAINTS_EMAIL`.

## Every email the Desk sends (all in the Vistra design, all translated into the person's language)
Registration code · Welcome (with Account ID) · Withdrawal authorisation code · Password-reset code · Password reset by the
Desk · Identity verification (received / verified / not approved) · Deposit confirmed / not confirmed · Withdrawal
(pending / processing / completed / declined) · Incoming funds (credited / in escrow review / released / reversed) ·
Disbursement stage open / paused · Account disabled / re-enabled · Business account (received / approved / not approved) ·
New message while offline (buyer or seller) · Note from the Desk (buyer) · New transaction submitted (admins) · Test email.
