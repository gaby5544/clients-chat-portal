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
        from: process.env.EMAIL_FROM || '"Quantum Desk Alerts" <no-reply@quantumdesk.com>',
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
    `${fromName} sent you a message while you were offline:\n\n"${text}"\n\nLog in to Quantum Secure Desk to reply.`
  );
}

function notifyTransactionSubmitted(toEmail, { submitterName, groupName }) {
  return sendEmail(
    toEmail,
    `New transaction submitted in ${groupName}`,
    `${submitterName} submitted a new transaction form in "${groupName}". Review it from the Admin Transaction Board.`
  );
}

function sendPasswordResetCode(toEmail, code) {
  return sendEmail(
    toEmail,
    'Your Quantum Desk verification code',
    `Your password reset code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`
  );
}

function notifyInvite(toEmail, { inviteUrl, groupLabel }) {
  return sendEmail(
    toEmail,
    'You have been invited to Quantum Secure Transaction Desk',
    `You've been invited to set up your seller account${groupLabel ? ` for ${groupLabel}` : ''}.\n\nUse this link to register:\n${inviteUrl}\n\nThis link is single-use and tied to this email address.`
  );
}

function notifyKycStatus(toEmail, { status, reason }) {
  const subject = status === 'verified' ? 'Your identity has been verified' : 'Update on your identity verification';
  const body = status === 'verified'
    ? 'Your identity verification has been approved. You can now withdraw funds at any time.'
    : `Your identity verification was not approved.${reason ? ` Reason: ${reason}` : ''} You can submit new documents from your Profile.`;
  return sendEmail(toEmail, subject, body);
}

function notifyDepositStatus(toEmail, { status, amount, currency, reason }) {
  const subject = status === 'verified' ? 'Deposit confirmed' : 'Update on your deposit';
  const body = status === 'verified'
    ? `Your deposit of ${currency} ${amount} has been verified and is now available in your balance.`
    : `Your deposit of ${currency} ${amount} could not be verified.${reason ? ` Reason: ${reason}` : ''}`;
  return sendEmail(toEmail, subject, body);
}

function notifyWithdrawalStatus(toEmail, { status, amount, currency, reason }) {
  const labels = {
    held_in_vault: 'is held in the vault pending compliance review',
    processing: 'is now processing',
    completed: 'has been completed',
    rejected: 'was declined',
    failed: 'could not be completed'
  };
  const subject = `Withdrawal update: ${status.replace(/_/g, ' ')}`;
  const body = `Your withdrawal of ${currency} ${amount} ${labels[status] || `is now "${status}"`}.${reason ? ` Reason: ${reason}` : ''}`;
  return sendEmail(toEmail, subject, body);
}

module.exports = {
  sendEmail,
  notifyOfflineMessage,
  notifyTransactionSubmitted,
  sendPasswordResetCode,
  notifyInvite,
  notifyKycStatus,
  notifyDepositStatus,
  notifyWithdrawalStatus
};
