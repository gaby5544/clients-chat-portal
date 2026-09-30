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

async function sendEmail(to, subject, text) {
  if (!to) return;
  try {
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

function notifyOfflineMessage(toEmail, { fromName, groupName, text }) {
  return sendEmail(
    toEmail,
    `New message in ${groupName}`,
    `${fromName} sent you a message while you were offline:\n\n"${text}"\n\nLog in to your Transaction Account to reply.`
  );
}

function notifyTransactionSubmitted(toEmail, { submitterName, groupName }) {
  return sendEmail(
    toEmail,
    `New transaction submitted in ${groupName}`,
    `${submitterName} submitted a new transaction form in "${groupName}". Review it from the Admin Transaction Board.`
  );
}

function notifyPasswordResetCode(toEmail, { code, groupName }) {
  return sendEmail(
    toEmail,
    `Your Transaction Account verification code`,
    `Your password reset code for the Transaction Account on "${groupName}" is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`
  );
}

function notifyKycStatus(toEmail, { groupName, status, reason }) {
  const lines = {
    pending: `Your identity verification documents for "${groupName}" have been received and are now under review.`,
    verified: `Your identity has been verified for "${groupName}". You can now request withdrawals at any time.`,
    rejected: `Your identity verification for "${groupName}" was not approved.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease resubmit your documents.`
  };
  return sendEmail(toEmail, `Identity verification update — ${groupName}`, lines[status] || `Your verification status is now: ${status}`);
}

function notifyDepositStatus(toEmail, { groupName, amount, status, reason }) {
  const lines = {
    verified: `Your deposit of ${amount} for "${groupName}" has been confirmed and is now available in your Transaction Account.`,
    rejected: `Your deposit of ${amount} for "${groupName}" could not be confirmed.${reason ? `\n\nReason: ${reason}` : ''}`
  };
  return sendEmail(toEmail, `Deposit update — ${groupName}`, lines[status] || `Your deposit status is now: ${status}`);
}

function notifyWithdrawalStatus(toEmail, { groupName, amount, currency, status, reason }) {
  const labels = { pending: 'Pending review', held_in_vault: 'Held in Vault', processing: 'Processing', completed: 'Completed', rejected: 'Declined', failed: 'Declined' };
  return sendEmail(
    toEmail,
    `Withdrawal update — ${groupName}`,
    `Your withdrawal of ${amount} ${currency} for "${groupName}" is now: ${labels[status] || status}.${reason ? `\n\nNote: ${reason}` : ''}`
  );
}

function notifyIncomingFunds(toEmail, { groupName, amountText, payerName, purpose, status, reason }) {
  const lines = {
    credited: `Funds of ${amountText} from ${payerName} have been received and credited to your Transaction Account for "${groupName}".\n\nPayment for: ${purpose}`,
    held_in_vault: `Funds of ${amountText} from ${payerName} have been received for "${groupName}" and are held in the vault pending clearance. They will move to your available balance once released.\n\nPayment for: ${purpose}`,
    released: `Funds of ${amountText} from ${payerName} have cleared and are now available in your Transaction Account for "${groupName}".\n\nPayment for: ${purpose}`,
    reversed: `A payment of ${amountText} from ${payerName} on "${groupName}" has been reversed.${reason ? `\n\nReason: ${reason}` : ''}\n\nPayment for: ${purpose}`
  };
  return sendEmail(toEmail, `Incoming funds update — ${groupName}`, lines[status] || `Your incoming funds status is now: ${status}`);
}

module.exports = {
  sendEmail, notifyOfflineMessage, notifyTransactionSubmitted,
  notifyPasswordResetCode, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus, notifyIncomingFunds
};
