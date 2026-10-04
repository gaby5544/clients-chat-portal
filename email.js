// Email via Nodemailer — automatic, branded and translated.
// Configure with either:
//   EMAIL_SERVICE (e.g. "gmail") + EMAIL_USER + EMAIL_PASS
// or generic SMTP:
//   SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS
// If neither is configured, emails are logged to the console instead of sent
// (mock mode) so the app still runs in local/dev — GET /api/health reports
// `emailConfigured` so you can see at a glance whether real delivery is on.

const nodemailer = require('nodemailer');
const { translateOne } = require('./translate');
const { escapeHtml } = require('./security');

let transporter = null;

function buildTransporter() {
  if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({ service: process.env.EMAIL_SERVICE, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return null;
}
transporter = buildTransporter();

const BRAND = process.env.BRAND_NAME || 'Quantum Secure Transaction Desk';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'complaints@usvistra.com';
function isEmailConfigured() { return !!transporter; }

function wrapHtml(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#0b1220;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:20px 28px;color:#fff;font-size:17px;font-weight:600;letter-spacing:.2px">${escapeHtml(BRAND)}</td></tr>
<tr><td style="padding:28px;color:#0f172a;font-size:15px;line-height:1.6">
<div style="font-size:19px;font-weight:600;margin:0 0 14px">${escapeHtml(title)}</div>${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px;background:#f1f5f9;color:#64748b;font-size:12px;line-height:1.5">This is an automated message from ${escapeHtml(BRAND)}. Questions? Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#4f46e5">${SUPPORT_EMAIL}</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

function codeBlock(code) {
  return `<div style="margin:18px 0;padding:16px;text-align:center;background:#f1f5f9;border-radius:10px;font-size:30px;letter-spacing:8px;font-weight:700;color:#0f172a;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(code)}</div>`;
}
const p = (t) => `<p style="margin:0 0 12px">${escapeHtml(t).replace(/\n/g, '<br>')}</p>`;

async function sendRaw(to, subject, text, html) {
  if (!to) return false;
  try {
    if (transporter) {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `"${BRAND}" <no-reply@transactionaccount.example>`,
        to, subject, text, html
      });
      console.log(`[email] sent to ${to}: ${subject}`);
      return true;
    }
    console.log(`[email:mock] to=${to} subject="${subject}" body="${text}"`);
    return false;
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return false;
  }
}

// Compose + translate + send. `parts` = { title, lines:[...], code?, cta? }.
// Every human sentence is translated into `lang`; codes and numbers pass through untouched.
async function compose(to, lang, subject, parts) {
  const tr = async (s) => (lang && lang !== 'en' ? (await translateOne(s, lang, 'en')).text : s);
  const [subj, title] = await Promise.all([tr(subject), tr(parts.title || subject)]);
  const lines = await Promise.all((parts.lines || []).map(tr));
  const footer = parts.footer ? await tr(parts.footer) : null;
  const text = [title, '', ...lines, parts.code ? `\n${parts.code}\n` : '', footer || ''].join('\n').trim();
  const html = wrapHtml(title, lines.map(p).join('') + (parts.code ? codeBlock(parts.code) : '') + (footer ? `<p style="margin:12px 0 0;color:#64748b;font-size:13px">${escapeHtml(footer)}</p>` : ''));
  return sendRaw(to, subj, text, html);
}

// Back-compat plain sender used by a few callers.
function sendEmail(to, subject, text) {
  return sendRaw(to, subject, text, wrapHtml(subject, p(text)));
}

// ---------------- Codes ----------------
function notifyVerificationCode(to, { code, lang, minutes = 10 }) {
  return compose(to, lang, 'Verify your email address', {
    title: 'Verify your email address',
    lines: ['Use the code below to verify your email and finish creating your Transaction Account.', `This code expires in ${minutes} minutes.`],
    code, footer: 'If you did not request this, you can safely ignore this email.'
  });
}
function notifyWithdrawalCode(to, { code, lang, amountText, destination, minutes = 10 }) {
  return compose(to, lang, 'Confirm your withdrawal', {
    title: 'Confirm your withdrawal request',
    lines: [`A withdrawal of ${amountText} was requested from your Transaction Account${destination ? ` to ${destination}` : ''}.`, 'Enter this code to confirm it. Never share this code with anyone.', `The code expires in ${minutes} minutes.`],
    code, footer: 'If you did not make this request, do not enter the code and contact us immediately.'
  });
}
function notifyPasswordResetCode(to, { code, groupName, lang }) {
  return compose(to, lang, 'Your password reset code', {
    title: 'Reset your password',
    lines: [`Use this code to reset the password for your Transaction Account on "${groupName}".`, 'This code expires in 10 minutes.'],
    code, footer: 'If you did not request this, you can ignore this email — your password will not change.'
  });
}

// ---------------- Messages & reminders ----------------
function notifyOfflineMessage(to, { fromName, groupName, text, lang }) {
  return compose(to, lang, `New message in ${groupName}`, {
    title: `New message in ${groupName}`,
    lines: [`${fromName} sent you a message:`, `“${text}”`, 'Log in to your Transaction Account to reply.']
  });
}
function notifyUnreadReminder(to, { groupName, count, fromName, lang }) {
  return compose(to, lang, `Reminder: unread message${count > 1 ? 's' : ''} in ${groupName}`, {
    title: 'You have unread messages',
    lines: [`You have ${count} unread message${count > 1 ? 's' : ''} in "${groupName}"${fromName ? ` (latest from ${fromName})` : ''}.`, 'Open your Transaction Account to read and reply.']
  });
}
function notifyTransactionSubmitted(to, { submitterName, groupName, lang }) {
  return compose(to, lang, `New transaction submitted in ${groupName}`, {
    title: 'New transaction submitted',
    lines: [`${submitterName} submitted a new transaction form in "${groupName}".`, 'Review it from the Admin Transaction Board.']
  });
}

// ---------------- Account state ----------------
function notifySellerDisabled(to, { groupName, reason, lang }) {
  return compose(to, lang, 'Your account has been disabled', {
    title: 'Account disabled',
    lines: [`Your Transaction Account for "${groupName}" has been disabled by the Desk.`, reason ? `Reason: ${reason}` : null, `If you believe this is a mistake, please contact ${SUPPORT_EMAIL}.`].filter(Boolean)
  });
}
function notifySellerEnabled(to, { groupName, lang }) {
  return compose(to, lang, 'Your account has been re-enabled', {
    title: 'Account re-enabled',
    lines: [`Good news — your Transaction Account for "${groupName}" is active again. You can sign in and continue.`]
  });
}
function notifyDisbursement(to, { groupName, enabled, lang }) {
  return compose(to, lang, enabled ? 'Your transaction is in the disbursement stage' : 'Disbursement paused', {
    title: enabled ? 'Disbursement stage reached' : 'Disbursement paused',
    lines: enabled
      ? [`The transaction "${groupName}" is confirmed and has reached the disbursement stage. You can now request a withdrawal from your Transaction Account.`]
      : [`Withdrawals for "${groupName}" are currently paused because the transaction is not in the disbursement stage.`]
  });
}
function notifyKycStatus(to, { groupName, status, reason, lang }) {
  const copy = {
    pending: [`Your identity verification documents for "${groupName}" passed our automatic checks and are now with our compliance team.`],
    verified: [`Your identity has been verified for "${groupName}". You can now request withdrawals when your transaction reaches the disbursement stage.`],
    rejected: [`Your identity verification for "${groupName}" was not approved.`, reason ? `Reason: ${reason}` : null, 'Please correct the issue and resubmit.'].filter(Boolean)
  };
  return compose(to, lang, `Identity verification update — ${groupName}`, { title: 'Identity verification update', lines: copy[status] || [`Your verification status is now: ${status}`] });
}
function notifyBusinessStatus(to, { groupName, status, reason, lang }) {
  const copy = {
    pending: [`Your business account application for "${groupName}" has been received and is under review.`],
    verified: [`Your business account for "${groupName}" is approved. The daily withdrawal limit has been lifted.`],
    rejected: [`Your business account application for "${groupName}" was not approved.`, reason ? `Reason: ${reason}` : null].filter(Boolean)
  };
  return compose(to, lang, `Business account update — ${groupName}`, { title: 'Business account update', lines: copy[status] || [`Status: ${status}`] });
}

// ---------------- Money ----------------
function notifyDepositStatus(to, { groupName, amount, status, reason, lang }) {
  const copy = {
    verified: [`Your deposit of ${amount} for "${groupName}" has been confirmed and is now available in your Transaction Account.`],
    rejected: [`Your deposit of ${amount} for "${groupName}" could not be confirmed.`, reason ? `Reason: ${reason}` : null].filter(Boolean)
  };
  return compose(to, lang, `Deposit update — ${groupName}`, { title: 'Deposit update', lines: copy[status] || [`Your deposit status is now: ${status}`] });
}
const WD_LABELS = { pending: 'Pending', processing: 'Processing', declined: 'Declined', completed: 'Completed' };
function notifyWithdrawalStatus(to, { groupName, amount, currency, status, reason, reference, lang }) {
  const label = WD_LABELS[status] || status;
  return compose(to, lang, `Withdrawal update — ${groupName}`, {
    title: `Withdrawal ${label.toLowerCase()}`,
    lines: [`Your withdrawal of ${`${amount} ${currency || ''}`.trim()} for "${groupName}" is now: ${label}.`, reference ? `Payout reference: ${reference}` : null, reason ? `Note: ${reason}` : null].filter(Boolean)
  });
}
function notifyIncomingFunds(to, { groupName, amountText, payerName, purpose, status, reason, accountId, lang }) {
  const tail = `Payment for: ${purpose}`;
  const copy = {
    credited: [`Funds of ${amountText} from ${payerName} have been received and credited to your Transaction Account for "${groupName}".`, tail],
    in_review: [`A payment of ${amountText} from ${payerName} has been received for "${groupName}" and is now in our 5-stage escrow review. The funds stay safely in the vault until the review completes.`, accountId ? `Account ID: ${accountId}` : null, tail].filter(Boolean),
    held_in_vault: [`Funds of ${amountText} from ${payerName} have been received for "${groupName}" and are held in the vault pending clearance.`, tail],
    released: [`Funds of ${amountText} from ${payerName} have cleared and are now available in your Transaction Account for "${groupName}".`, accountId ? `Funds transferred to the seller account ${accountId}.` : null, tail].filter(Boolean),
    reversed: [`A payment of ${amountText} from ${payerName} on "${groupName}" has been reversed.`, reason ? `Reason: ${reason}` : null, tail].filter(Boolean)
  };
  return compose(to, lang, `Incoming funds update — ${groupName}`, { title: 'Incoming funds update', lines: copy[status] || [`Your incoming funds status is now: ${status}`] });
}

module.exports = {
  sendEmail, compose, isEmailConfigured, SUPPORT_EMAIL, BRAND,
  notifyVerificationCode, notifyWithdrawalCode, notifyPasswordResetCode,
  notifyOfflineMessage, notifyUnreadReminder, notifyTransactionSubmitted,
  notifySellerDisabled, notifySellerEnabled, notifyDisbursement, notifyKycStatus, notifyBusinessStatus,
  notifyDepositStatus, notifyWithdrawalStatus, notifyIncomingFunds
};
