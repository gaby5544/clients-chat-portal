// Email notifications via Nodemailer.
// Configure with either:
//   EMAIL_SERVICE (e.g. "gmail") + EMAIL_USER + EMAIL_PASS
// or generic SMTP:
//   SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS
// If neither is configured, emails are logged to the console instead of
// sent (mock mode) so the app still runs fully in local/dev environments.

const M = require('./mailer');
const TPL = require('./emailTemplate');
const { SERVICE, COMPANY } = TPL;
const BRAND = TPL.BRAND;
const SUPPORT_EMAIL = TPL.supportEmail();
const ALLOW_MOCK = () => String(process.env.EMAIL_ALLOW_MOCK || '').toLowerCase() === 'true' || process.env.NODE_ENV !== 'production';

/** Render a structured message (see emailTemplate.js) and deliver it. Never throws → { ok, provider, error }. */
async function sendTemplated(to, parts, lang) {
  if (!to) return { ok: false, error: 'No recipient address.' };
  try {
    const mail = await TPL.renderEmail(parts, lang || 'en');
    if (!M.isEmailConfigured()) {
      if (ALLOW_MOCK()) { console.log(`[email:mock] to=${to} subject="${mail.subject}" body="${mail.text.replace(/\n+/g, ' | ').slice(0, 2500)}"`); return { ok: true, provider: 'mock' }; }
      console.error(`[email] NOT SENT to ${to} ("${mail.subject}") — no email provider is configured.`);
      return { ok: false, error: 'not_configured' };
    }
    const r = await M.send({ to, subject: mail.subject, text: mail.text, html: mail.html });
    if (r.ok) console.log(`[email] sent via ${r.provider} to ${to}: ${mail.subject}`);
    return r;
  } catch (err) { console.error('[email] send failed:', err.message); return { ok: false, error: err.message }; }
}

/** Plain-text entry point kept for older callers: wraps the text in the Vistra letterhead. */
async function sendEmail(to, subject, text, lang) {
  return sendTemplated(to, { subject: `Vistra | ${subject}`, eyebrow: 'Notification', title: subject, paragraphs: String(text).split(/\n{2,}/) }, lang);
}

// Compatibility with the Desk's earlier email.js API
const isEmailConfigured = M.isEmailConfigured;
async function sendRaw(to, subject, text, html) { const r = await M.send({ to, subject, text, html }); return !!r.ok; }
async function compose(to, lang, subject, parts) {
  return sendTemplated(to, { subject: `Vistra | ${subject}`, eyebrow: parts.eyebrow || 'Notification', title: parts.title || subject, paragraphs: parts.lines || [], code: parts.code, cta: parts.cta }, lang);
}
const emailStatus = M.emailStatus;
const setRuntimeConfig = M.setRuntimeConfig;
const activeConfig = M.activeConfig;
const checkDeliverability = M.checkDeliverability;
const verifyConnection = M.verifyConnection;

// Legacy helpers (the Desk's earlier email.js exported these) — now rendered in the Vistra letterhead.
function wrapHtml(title, bodyHtml) { return TPL.renderEmailSync({ subject: title, eyebrow: 'Notification', title, paragraphs: [], bodyHtml, noGreeting: true }).html; }
function codeBlock(code) { return `<div style="margin:18px 0;padding:22px;text-align:center;background:#0d0608;border:1px solid #d4af37;border-radius:4px;font:700 34px ui-monospace,Menlo,Consolas,monospace;letter-spacing:10px;color:#f5d77a">${String(code).replace(/[<>&"]/g, '')}</div>`; }

const q = (s) => `\u201C${s}\u201D`;
const acct = (id) => (id ? [['Account ID', String(id)]] : []);

// =====================================================================================================
//  Messages
// =====================================================================================================

// ---- Conversation ----
function notifyOfflineMessage(toEmail, { fromName, groupName, text, lang, name }) {
  return sendTemplated(toEmail, {
    subject: `Vistra | New message in ${groupName}`, preheader: `${fromName} has written to you in ${groupName}.`,
    eyebrow: 'Secure Conversation', title: 'You have a new message', name,
    paragraphs: [`${fromName} has sent you a message in the transaction ${q(groupName)} while you were away.`, 'For your protection, message content is shown in full only after you sign in to your secure workspace.'],
    quote: String(text || '').slice(0, 160) + (String(text || '').length > 160 ? '…' : ''),
    cta: { label: 'Open the conversation' }
  }, lang);
}
function notifyMessageReminder(toEmail, { groupName, count, lang, name }) {
  return sendTemplated(toEmail, {
    subject: `Vistra | ${count} unread message${count === 1 ? '' : 's'} in ${groupName}`, preheader: `You have ${count} unread message${count === 1 ? '' : 's'} waiting.`,
    eyebrow: 'Gentle Reminder', title: `${count} message${count === 1 ? '' : 's'} awaiting your attention`, name,
    paragraphs: [`You still have ${count} unread message${count === 1 ? '' : 's'} in the transaction ${q(groupName)}.`, 'Timely responses help your transaction progress without delay.'],
    cta: { label: 'Read and reply' }
  }, lang);
}
function notifyTransactionSubmitted(toEmail, { submitterName, groupName, lang }) {
  return sendTemplated(toEmail, {
    subject: `Vistra | New transaction submitted — ${groupName}`, eyebrow: 'Desk Notification', title: 'A new transaction has been submitted',
    paragraphs: [`${submitterName} has submitted a new transaction form in ${q(groupName)}.`, 'Please review it from the Admin Transaction Board.'], cta: { label: 'Open the Desk' }
  }, lang);
}

// ---- Security codes ----
function notifyRegistrationCode(toEmail, { code, groupName, lang, name }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Verify your email address', preheader: 'Your verification code is inside. It expires in 10 minutes.',
    eyebrow: 'Identity & Security', title: 'Verify your email address', name,
    paragraphs: [`Welcome to Vistra. To protect the Transaction Account being opened for ${q(groupName)}, we must first confirm that this email address belongs to you.`, 'Please enter the verification code below on the registration form.'],
    code, notice: `${'Vistra will never ask you for this code by phone, email or chat.'} If you did not begin this registration, no action is required — you may safely ignore this message.`
  }, lang);
}
function notifyPasswordResetCode(toEmail, { code, groupName, lang, name }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Your password reset code', preheader: 'Use this code to choose a new password. It expires in 10 minutes.',
    eyebrow: 'Account Security', title: 'Reset your password', name,
    paragraphs: [`We received a request to reset the password of your Transaction Account${groupName ? ` for ${q(groupName)}` : ''}.`, 'Enter the code below to continue and choose a new password.'],
    code, notice: `If you did not request this, your password remains unchanged and you may ignore this message. If you are concerned about your account, contact Support at ${SUPPORT_EMAIL} straight away.`
  }, lang);
}
function notifyWithdrawalCode(toEmail, { code, amountText, accountId, destination, lang, name }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Authorise your withdrawal', preheader: 'A withdrawal needs your confirmation code. It expires in 10 minutes.',
    eyebrow: 'Withdrawal Authorisation', title: 'Confirm your withdrawal', name,
    paragraphs: ['A withdrawal has been requested from your Transaction Account. As an additional layer of protection, it will proceed only after you enter the confirmation code below.'],
    details: [['Amount', amountText], ...acct(accountId), ...(destination ? [['Destination', destination]] : [])],
    code, notice: `This code can be used once and expires in 10 minutes. If you did not request this withdrawal, do NOT share the code — change your password and contact Support at ${SUPPORT_EMAIL} immediately.`
  }, lang);
}

// ---- Account ----
function notifyAccountCreated(toEmail, { groupName, accountId, fullName, lang }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Your Transaction Account is ready', preheader: `Account ${accountId} has been created.`,
    eyebrow: 'Welcome to Vistra', title: 'Your Transaction Account is ready', name: fullName, badge: { text: 'Account active', tone: 'success' },
    paragraphs: [`It is our pleasure to confirm that your Standard Transaction Account for ${q(groupName)} has been created.`, 'Please keep your Account ID for reference — it appears on your dashboard and on every receipt we issue.', 'Next, begin your transaction in the group conversation, or complete identity verification so that withdrawals are ready the moment your funds are.'],
    details: [['Account ID', String(accountId)], ['Account type', 'Standard'], ['Transaction', groupName]], cta: { label: 'Open your account' }
  }, lang);
}
function notifyAccountAccess(toEmail, { groupName, accountId, disabled, reason, lang, name }) {
  return disabled ? sendTemplated(toEmail, {
    subject: 'Vistra | Important notice about your account', preheader: 'Your Transaction Account has been disabled.',
    eyebrow: 'Account Notice', title: 'Your Transaction Account has been disabled', name, badge: { text: 'Account disabled', tone: 'danger' },
    paragraphs: [`We are writing to inform you that your Transaction Account for ${q(groupName)} has been disabled.`, 'While the account is disabled you will not be able to withdraw, deposit or change account details.'],
    details: [...acct(accountId), ...(reason ? [['Reason', reason]] : [])], dispute: true
  }, lang) : sendTemplated(toEmail, {
    subject: 'Vistra | Your account has been re-enabled', preheader: 'Your Transaction Account is fully available again.',
    eyebrow: 'Account Notice', title: 'Your Transaction Account is active again', name, badge: { text: 'Account enabled', tone: 'success' },
    paragraphs: [`Good news — your Transaction Account for ${q(groupName)} has been re-enabled and is fully available again.`, 'Thank you for your patience while we completed our review.'], details: acct(accountId), cta: { label: 'Open your account' }
  }, lang);
}

// ---- Verification (KYC) ----
function notifyKycStatus(toEmail, { groupName, status, reason, lang, name }) {
  const V = {
    pending: { badge: ['Under review', 'info'], title: 'We have received your documents', p: [`Your identity verification documents for ${q(groupName)} have been received and are now under review by our compliance team.`, 'We will write to you as soon as the review is complete.'] },
    verified: { badge: ['Verified', 'success'], title: 'Your identity has been verified', p: [`Your identity has been verified for ${q(groupName)}.`, 'You may now request withdrawals at any time, subject to your transaction reaching the disbursement stage.'] },
    rejected: { badge: ['Action required', 'danger'], title: 'We could not approve your verification', p: [`Your identity verification for ${q(groupName)} could not be approved.`, 'Please review the reason below, then resubmit clear, valid and unexpired documents.'], dispute: true }
  }[status] || { badge: [String(status), 'info'], title: 'Your verification status has changed', p: [`Your verification status is now: ${status}.`] };
  return sendTemplated(toEmail, { subject: `Vistra | Identity verification — ${V.badge[0]}`, eyebrow: 'Identity Verification', title: V.title, name, badge: { text: V.badge[0], tone: V.badge[1] }, paragraphs: V.p, details: reason && status === 'rejected' ? [['Reason', reason]] : [], dispute: !!V.dispute, cta: status === 'rejected' ? { label: 'Resubmit documents' } : undefined }, lang);
}
function notifyBusinessStatus(toEmail, { groupName, status, reason, lang, name }) {
  const V = {
    pending: { badge: ['Under review', 'info'], title: 'Your Business application is under review', p: [`Your Business account application for ${q(groupName)} has been received and is under review.`, 'We will email you as soon as a decision has been made.'] },
    verified: { badge: ['Approved', 'success'], title: 'Your Business account is approved', p: [`Your Business account for ${q(groupName)} has been approved.`, 'Daily withdrawal limits no longer apply to your account.'] },
    rejected: { badge: ['Not approved', 'danger'], title: 'Your Business application was not approved', p: [`Your Business account application for ${q(groupName)} was not approved.`, 'You may correct the details and apply again.'], dispute: true }
  }[status] || { badge: [String(status), 'info'], title: 'Your Business account status has changed', p: [`Your Business account status is now: ${status}.`] };
  return sendTemplated(toEmail, { subject: `Vistra | Business account — ${V.badge[0]}`, eyebrow: 'Business Account', title: V.title, name, badge: { text: V.badge[0], tone: V.badge[1] }, paragraphs: V.p, details: reason && status === 'rejected' ? [['Reason', reason]] : [], dispute: !!V.dispute }, lang);
}

// ---- Funds ----
function notifyDepositStatus(toEmail, { groupName, amount, status, reason, lang, name }) {
  const ok = status === 'verified';
  return sendTemplated(toEmail, {
    subject: `Vistra | Deposit ${ok ? 'confirmed' : 'update'} — ${groupName}`, eyebrow: 'Deposit Notification', title: ok ? 'Your deposit has been confirmed' : 'We could not confirm your deposit', name,
    badge: { text: ok ? 'Confirmed' : 'Not confirmed', tone: ok ? 'success' : 'danger' },
    paragraphs: ok ? [`Your deposit for ${q(groupName)} has been confirmed and is now available in your Transaction Account.`] : [`Your deposit for ${q(groupName)} could not be confirmed. Please review the reason below.`],
    details: [['Amount', String(amount)], ...(reason && !ok ? [['Reason', reason]] : [])], dispute: !ok
  }, lang);
}
function notifyIncomingFunds(toEmail, { groupName, amountText, payerName, purpose, status, reason, lang, name }) {
  const V = {
    credited: { badge: ['Credited', 'success'], title: 'Funds have been credited', p: `Funds have been received and credited to your Transaction Account for ${q(groupName)}.` },
    held_in_vault: { badge: ['Held in vault', 'warning'], title: 'Funds received — now being verified', p: `Funds have been received for ${q(groupName)} and are held securely in your vault while they pass our verification stages. You can follow their progress live from your dashboard.` },
    released: { badge: ['Released', 'success'], title: 'Funds are now available', p: `Verification is complete. The funds for ${q(groupName)} have been released and are now available in your Transaction Account.` },
    reversed: { badge: ['Reversed', 'danger'], title: 'A payment has been reversed', p: `A payment received for ${q(groupName)} has been reversed and removed from your Transaction Account.`, dispute: true }
  }[status] || { badge: [String(status), 'info'], title: 'Your payment status has changed', p: `Your incoming payment status is now: ${status}.` };
  return sendTemplated(toEmail, {
    subject: `Vistra | ${V.title} — ${groupName}`, eyebrow: 'Funds Notification', title: V.title, name, badge: { text: V.badge[0], tone: V.badge[1] }, paragraphs: [V.p],
    details: [['Amount', amountText], ['Received from', payerName], ['Payment for', purpose], ...(reason && status === 'reversed' ? [['Reason', reason]] : [])], dispute: !!V.dispute, cta: status !== 'reversed' ? { label: 'View your account' } : undefined
  }, lang);
}
function notifyWithdrawalStatus(toEmail, { groupName, amount, currency, status, reason, lang, name }) {
  const label = { pending: 'Pending', held_in_vault: 'Pending', processing: 'Processing', completed: 'Completed', declined: 'Declined', rejected: 'Declined', failed: 'Declined' }[status] || status;
  const tone = { Pending: 'warning', Processing: 'info', Completed: 'success', Declined: 'danger' }[label] || 'info';
  const body = { Pending: 'Your withdrawal request has been received and is awaiting review.', Processing: 'Your withdrawal has been approved and the payout is now in progress.', Completed: 'Your withdrawal has been completed and the payout has been sent.', Declined: 'We were unable to proceed with your withdrawal. The funds have been returned to your available balance.' }[label] || `Your withdrawal is now ${label}.`;
  return sendTemplated(toEmail, {
    subject: `Vistra | Withdrawal ${label.toLowerCase()} — ${groupName}`, preheader: `Your withdrawal is now ${label}.`, eyebrow: 'Withdrawal Update', title: `Your withdrawal is ${label.toLowerCase()}`, name,
    badge: { text: label, tone }, paragraphs: [body], details: [['Amount', `${amount} ${currency}`], ['Transaction', groupName], ...(reason ? [[label === 'Declined' ? 'Reason' : 'Note', reason]] : [])], dispute: label === 'Declined'
  }, lang);
}

module.exports = {
  wrapHtml, codeBlock,
  setRuntimeConfig, activeConfig, emailStatus, isEmailConfigured, checkDeliverability, verifyConnection, sendRaw, compose, sendTemplated, BRAND, COMPANY, SERVICE, SUPPORT_EMAIL,
  sendEmail,
  notifyOfflineMessage, notifyTransactionSubmitted, notifyPasswordResetCode, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus, notifyIncomingFunds,
  notifyRegistrationCode, notifyWithdrawalCode, notifyAccountAccess, notifyAccountCreated, notifyBusinessStatus, notifyMessageReminder
};
