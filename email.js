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

module.exports = { sendEmail, notifyOfflineMessage, notifyTransactionSubmitted };
