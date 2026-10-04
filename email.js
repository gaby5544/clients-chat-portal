// Email notifications via Nodemailer.
// Configure with either:
//   EMAIL_SERVICE (e.g. "gmail") + EMAIL_USER + EMAIL_PASS
// or generic SMTP:
//   SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS
// If neither is configured, emails are logged to the console instead of
// sent (mock mode) so the app still runs fully in local/dev environments.

const nodemailer = require('nodemailer');

let transporter = null;

function buildTransporter() {
  if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
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

function emailStatus() {
  return transporter
    ? { configured: true, mode: process.env.EMAIL_SERVICE ? `service:${process.env.EMAIL_SERVICE}` : `smtp:${process.env.SMTP_HOST}` }
    : { configured: false, mode: 'mock (codes are printed in the server log only)' };
}

// Optional `lang` translates the subject and body into the recipient's language
// (falls back to the original English text if translation is unavailable).
async function localizeMail(subject, text, lang) {
  if (!lang || lang === 'en') return { subject, text };
  try {
    const { translateText } = require('./translator');
    const [s, b] = await Promise.all([translateText(subject, lang), translateText(text, lang)]);
    return { subject: s.ok ? s.text : subject, text: b.ok ? b.text : text };
  } catch (e) { return { subject, text }; }
}

async function sendEmail(to, subject, text, lang) {
  if (!to) return;
  try {
    ({ subject, text } = await localizeMail(subject, text, lang));
    if (transporter) {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"Transaction Account Alerts" <no-reply@transactionaccount.example>',
        to,
        subject,
        text
      });
      console.log(`[email] sent to ${to}: ${subject}`);
    } else {
      console.log(`[email:mock] to=${to} subject="${subject}" body="${text}"`);
    }
  } catch (err) {
    console.error('[email] send failed:', err.message);
  }
}

function notifyOfflineMessage(toEmail, { fromName, groupName, text, lang }) {
  return sendEmail(
    toEmail,
    `New message in ${groupName}`,
    `${fromName} sent you a message while you were offline:\n\n"${text}"\n\nLog in to your Transaction Account to reply.`,
    lang
  );
}

function notifyTransactionSubmitted(toEmail, { submitterName, groupName }) {
  return sendEmail(
    toEmail,
    `New transaction submitted in ${groupName}`,
    `${submitterName} submitted a new transaction form in "${groupName}". Review it from the Admin Transaction Board.`
  );
}

function notifyPasswordResetCode(toEmail, { code, groupName, lang }) {
  return sendEmail(
    toEmail,
    `Your Transaction Account password reset code`,
    `Your password reset code for the Transaction Account on "${groupName}" is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    lang
  );
}

function notifyKycStatus(toEmail, { groupName, status, reason, lang }) {
  const lines = {
    pending: `Your identity verification documents for "${groupName}" have been received and are now under review.`,
    verified: `Your identity has been verified for "${groupName}". You can now request withdrawals at any time.`,
    rejected: `Your identity verification for "${groupName}" was not approved.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease resubmit your documents.`
  };
  return sendEmail(toEmail, `Identity verification update — ${groupName}`, lines[status] || `Your verification status is now: ${status}`, lang);
}

function notifyDepositStatus(toEmail, { groupName, amount, status, reason, lang }) {
  const lines = {
    verified: `Your deposit of ${amount} for "${groupName}" has been confirmed and is now available in your Transaction Account.`,
    rejected: `Your deposit of ${amount} for "${groupName}" could not be confirmed.${reason ? `\n\nReason: ${reason}` : ''}`
  };
  return sendEmail(toEmail, `Deposit update — ${groupName}`, lines[status] || `Your deposit status is now: ${status}`, lang);
}

function notifyWithdrawalStatus(toEmail, { groupName, amount, currency, status, reason, lang }) {
  const labels = { pending: 'Pending', held_in_vault: 'Pending', processing: 'Processing', completed: 'Completed', declined: 'Declined', rejected: 'Declined', failed: 'Declined' };
  return sendEmail(
    toEmail,
    `Withdrawal update — ${groupName}`,
    `Your withdrawal of ${amount} ${currency} for "${groupName}" is now: ${labels[status] || status}.${reason ? `\n\nNote: ${reason}` : ''}`,
    lang
  );
}

function notifyIncomingFunds(toEmail, { groupName, amountText, payerName, purpose, status, reason, lang }) {
  const lines = {
    credited: `Funds of ${amountText} from ${payerName} have been received and credited to your Transaction Account for "${groupName}".\n\nPayment for: ${purpose}`,
    held_in_vault: `Funds of ${amountText} from ${payerName} have been received for "${groupName}" and are held in the vault pending clearance. They will move to your available balance once released.\n\nPayment for: ${purpose}`,
    released: `Funds of ${amountText} from ${payerName} have cleared and are now available in your Transaction Account for "${groupName}".\n\nPayment for: ${purpose}`,
    reversed: `A payment of ${amountText} from ${payerName} on "${groupName}" has been reversed.${reason ? `\n\nReason: ${reason}` : ''}\n\nPayment for: ${purpose}`
  };
  return sendEmail(toEmail, `Incoming funds update — ${groupName}`, lines[status] || `Your incoming funds status is now: ${status}`, lang);
}

function notifyRegistrationCode(toEmail, { code, groupName, lang }) {
  return sendEmail(
    toEmail,
    'Verify your email address — Transaction Account',
    `Welcome! Your email verification code for the Transaction Account on "${groupName}" is: ${code}\n\nEnter this code on the registration form to confirm that this email address belongs to you. The code expires in 10 minutes.\n\nFor your security, never share this code with anyone. If you did not start this registration, please ignore this email.`,
    lang
  );
}

function notifyWithdrawalCode(toEmail, { code, amountText, accountId, destination, lang }) {
  return sendEmail(
    toEmail,
    'Confirm your withdrawal — security code',
    `A withdrawal of ${amountText} was requested from Account ${accountId || ''}${destination ? ` to ${destination}` : ''}.\n\nYour withdrawal confirmation code is: ${code}\n\nThe code expires in 10 minutes and can only be used once. If you did not request this withdrawal, do NOT share the code — change your password and contact the Desk immediately.`,
    lang
  );
}

function notifyAccountAccess(toEmail, { groupName, accountId, disabled, reason, complaintsEmail, lang }) {
  const body = disabled
    ? `Your Transaction Account${accountId ? ` (ID ${accountId})` : ''} for "${groupName}" has been disabled.${reason ? `\n\nReason: ${reason}` : ''}\n\nWhile disabled you cannot withdraw, deposit or change account details. If you believe this is a mistake or would like to lodge a complaint, please contact ${complaintsEmail} and quote your Account ID.`
    : `Good news — your Transaction Account${accountId ? ` (ID ${accountId})` : ''} for "${groupName}" has been re-enabled and is fully available again.`;
  return sendEmail(toEmail, disabled ? 'Your Transaction Account has been disabled' : 'Your Transaction Account has been re-enabled', body, lang);
}

function notifyAccountCreated(toEmail, { groupName, accountId, fullName, lang }) {
  return sendEmail(
    toEmail,
    'Your Transaction Account is ready',
    `Hello ${fullName || ''},\n\nYour Standard Transaction Account for "${groupName}" has been created.\n\nAccount ID: ${accountId}\n\nKeep your Account ID for reference — it appears on your dashboard and on every receipt. Next steps: start your transaction in the group chat, or complete identity verification to unlock withdrawals.`,
    lang
  );
}

function notifyBusinessStatus(toEmail, { groupName, status, reason, lang }) {
  const lines = {
    pending: `Your Business account application for "${groupName}" has been received and is under review. We'll email you as soon as a decision is made.`,
    verified: `Your Business account for "${groupName}" has been approved. Daily withdrawal limits no longer apply to your account.`,
    rejected: `Your Business account application for "${groupName}" was not approved.${reason ? `\n\nReason: ${reason}` : ''}\n\nYou can correct the details and apply again.`
  };
  return sendEmail(toEmail, `Business account update — ${groupName}`, lines[status] || `Your business account status is now: ${status}`, lang);
}

function notifyMessageReminder(toEmail, { groupName, count, lang }) {
  return sendEmail(
    toEmail,
    `Reminder: ${count} unread message${count === 1 ? '' : 's'} in ${groupName}`,
    `You still have ${count} unread message${count === 1 ? '' : 's'} in "${groupName}". Log in to read and reply.`,
    lang
  );
}

module.exports = {
  emailStatus, notifyRegistrationCode, notifyWithdrawalCode, notifyAccountAccess, notifyAccountCreated, notifyBusinessStatus, notifyMessageReminder,
  sendEmail, notifyOfflineMessage, notifyTransactionSubmitted,
  notifyPasswordResetCode, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus, notifyIncomingFunds
};
