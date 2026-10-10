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
    if (!parts.name && !parts.noGreeting) { const n = await resolveName(to); if (n) parts = { ...parts, name: n }; }
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
const clean = (v) => TPL.unesc(v);
const GENERIC_NAME = /^(buyer|seller|client|party\s*[ab]|administrator|desk officer)$/i;

/**
 * Every message is addressed to the person by name ("Dear John Mensah,"). When a caller does not pass the
 * name, it is looked up from the recipient's email: the seller's registered full name first, then the name the
 * Desk Officer typed for that party when the group was created. Generic placeholders ("Buyer", "Seller") are
 * never used as a name.
 */
async function resolveName(toEmail) {
  try {
    const { store } = require('./db');
    const lower = String(toEmail || '').toLowerCase();
    const groups = await store.getAllGroups();
    let fallback = null;
    for (const g of groups) {
      if (g.email_b && g.email_b.toLowerCase() === lower) {
        const n = clean(g.seller_full_name || g.custom_name_b || '').trim();
        if (n && !GENERIC_NAME.test(n)) { if (g.seller_full_name) return n; fallback = fallback || n; }
      }
      if (g.email_a && g.email_a.toLowerCase() === lower) {
        const n = clean(g.custom_name_a || '').trim();
        if (n && !GENERIC_NAME.test(n)) fallback = fallback || n;
      }
    }
    return fallback;
  } catch (e) { return null; }
}

// =====================================================================================================
//  Messages  (group names are never printed to clients — they are internal labels for the Desk)
// =====================================================================================================

// ---- Conversation ----
function notifyOfflineMessage(toEmail, { fromName, text, lang, name }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | You have a new message waiting', preheader: `${clean(fromName)} has written to you in your secure transaction conversation.`,
    eyebrow: 'Secure Conversation', title: 'You have a new message', name,
    paragraphs: [`${clean(fromName)} has sent you a message in your secure transaction conversation while you were away.`, 'For your protection, message content is shown in full only after you sign in to your secure workspace. A prompt reply helps your transaction move forward without delay.'],
    quote: String(text || '').slice(0, 160) + (String(text || '').length > 160 ? '…' : ''),
    cta: { label: 'Open the conversation' }
  }, lang);
}
function notifyMessageReminder(toEmail, { count, lang, name }) {
  return sendTemplated(toEmail, {
    subject: `Vistra | ${count} unread message${count === 1 ? '' : 's'} waiting for you`, preheader: `You have ${count} unread message${count === 1 ? '' : 's'} waiting.`,
    eyebrow: 'Gentle Reminder', title: `${count} message${count === 1 ? '' : 's'} awaiting your attention`, name,
    paragraphs: [`You still have ${count} unread message${count === 1 ? '' : 's'} in your secure transaction conversation.`, 'Timely responses help your transaction progress without delay.'],
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
function notifyRegistrationCode(toEmail, { code, lang, name }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Verify your email address', preheader: 'Your verification code is inside. It expires in 10 minutes.',
    eyebrow: 'Identity & Security', title: 'Verify your email address', name,
    paragraphs: ['Welcome to Vistra. To protect the Transaction Account that is being opened in your name, we must first confirm that this email address belongs to you.', 'Please enter the verification code below on the registration form.'],
    code, notice: `${'Vistra will never ask you for this code by phone, email or chat.'} If you did not begin this registration, no action is required — you may safely ignore this message.`
  }, lang);
}
function notifyPasswordResetCode(toEmail, { code, lang, name }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Your password reset code', preheader: 'Use this code to choose a new password. It expires in 10 minutes.',
    eyebrow: 'Account Security', title: 'Reset your password', name,
    paragraphs: ['We received a request to reset the password of your Vistra Transaction Account.', 'Enter the code below to continue and choose a new password.'],
    code, notice: `If you did not request this, your password remains unchanged and you may ignore this message. If you are concerned about your account, contact Support at ${SUPPORT_EMAIL} straight away.`
  }, lang);
}
function notifyWithdrawalCode(toEmail, { code, amountText, accountId, destination, detailRows, reference, lang, name }) {
  const rows = detailRows && detailRows.length ? detailRows : (destination ? [['Destination', destination]] : []);
  return sendTemplated(toEmail, {
    subject: 'Vistra | Authorise your withdrawal', preheader: 'A withdrawal needs your confirmation code. It expires in 10 minutes.',
    eyebrow: 'Withdrawal Authorisation', title: 'Confirm your withdrawal', name, badge: { text: 'Authorisation required', tone: 'warning' },
    paragraphs: ['A withdrawal has been requested from your Transaction Account. As an additional layer of protection, it will proceed only after you enter the confirmation code below.', 'Please check that every detail of the request is exactly as you entered it. If anything looks wrong, do not enter the code — contact Support immediately.'],
    details: [...(reference ? [['Request reference', reference]] : []), ['Amount', amountText], ...acct(accountId), ...rows],
    code, notice: `This code can be used once and expires in 10 minutes. If you did not request this withdrawal, do NOT share the code — change your password and contact Support at ${SUPPORT_EMAIL} immediately.`
  }, lang);
}
function notifyWithdrawalReceived(toEmail, { reference, amountText, accountId, detailRows, lang, name }) {
  return sendTemplated(toEmail, {
    subject: `Vistra | Withdrawal request received — ${reference}`, preheader: 'We have received and recorded your withdrawal request.',
    eyebrow: 'Withdrawal Request', title: 'We have received your withdrawal request', name, badge: { text: 'Pending review', tone: 'info' },
    paragraphs: ['Thank you. Your withdrawal request has been authorised with your confirmation code and recorded securely. The amount has been reserved from your available balance while our team completes its review.', 'The details of your request are set out below, exactly as you submitted them. You can follow every stage from the Withdrawals section of your account.'],
    details: [['Request reference', reference], ['Amount', amountText], ...acct(accountId), ...(detailRows || []), ['Current status', 'Pending']],
    notice: `If any detail above is incorrect, or you did not make this request, contact Support at ${SUPPORT_EMAIL} straight away so we can stop it.`, cta: { label: 'Track your withdrawal' }
  }, lang);
}
function notifyManualAccount(toEmail, { accountId, fullName, currency, country, lang, baseUrl }) {
  const url = baseUrl || TPL.appUrl() || '';
  return sendTemplated(toEmail, {
    subject: 'Vistra | Your Transaction Account has been created', preheader: 'Choose your password to sign in for the first time.',
    eyebrow: 'Welcome to Vistra', title: 'Your Transaction Account is ready', name: fullName, badge: { text: 'Account created', tone: 'success' },
    paragraphs: ['Our team has opened a Transaction Account for you, so there is no form to fill in.', 'To sign in for the first time: open the app or website, choose Sign in, tap “Forgot your password?”, and enter this email address. We will send you a 6-digit code — enter it and choose your own password.', 'After signing in you will complete a short identity verification (KYC). Once our team has verified you, your account is fully active and any payment you receive appears on your dashboard.'],
    details: [['Account holder', clean(fullName)], ['Account ID', String(accountId)], ['Account currency', currency], ['Country', country]],
    notice: `Never share your password or any code with anyone. Our team will never ask for them. Need help? Contact ${SUPPORT_EMAIL}.`, cta: { label: 'Sign in', url: url ? url + '/?forgot=1' : undefined }
  }, lang);
}
function notifyPasswordChanged(toEmail, { accountId, name, lang }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Your password was changed', preheader: 'Your account password has just been changed.', eyebrow: 'Account Security', title: 'Your password was changed', name,
    badge: { text: 'Security notice', tone: 'warning' }, paragraphs: ['This is a confirmation that the password of your Transaction Account has just been changed.', `If this was you, no action is needed. If it was NOT you, contact Support at ${SUPPORT_EMAIL} immediately so we can secure your account.`],
    details: [...acct(accountId), ['Changed on', new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }) + ' (New York time)']]
  }, lang);
}
function notifyLoginAlert(toEmail, { name, accountId, lang, time, ip, geo, device, source, confirmUrl, denyUrl, appBase }) {
  const when = new Date(time || Date.now());
  const ny = when.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const stamp = `${ny} (${when.toUTCString().replace('GMT', 'UTC')})`;
  const where = geo && geo.known ? geo.label : 'Location could not be determined';
  const app = (appBase || TPL.appUrl()) ? `${appBase || TPL.appUrl()}/install` : '';
  return sendTemplated(toEmail, {
    subject: 'Vistra | New sign-in to your Transaction Account', preheader: `A sign-in was recorded from ${where}. Please confirm that it was you.`,
    eyebrow: 'Account Security', title: 'New sign-in to your account', name, badge: { text: 'Security alert', tone: 'warning' },
    paragraphs: [
      'Protecting your funds and personal information is our highest priority, so we review every sign-in to your Transaction Account and tell you about it straight away.',
      'A sign-in was just recorded with the details below. Please take a moment to check them.',
      'If this was you, simply confirm it — no further action is needed and your account remains fully secure.',
      'If this was NOT you, act immediately: choose “No, secure my account” below. We will lock the sign-in, block that network address and ask you to set a new password. You may also contact Support at ' + SUPPORT_EMAIL + ' and quote your Account ID.',
      ...(app ? ['Manage your account faster and more securely — download the Vistra Transaction app for your phone or computer: ' + app] : [])
    ],
    details: [['Date and time', stamp], ['Location', where], ...(geo && geo.known && geo.countryIso ? [['Country', geo.country]] : []), ['IP address', ip], ['Device', device || 'Unknown device'], ...acct(accountId), ['Sign-in method', source === 'link' ? 'Secure invite link' : 'Email and password']],
    notice: 'Vistra will never ask you for your password or any verification code by email, phone or chat. Your account details and funds are protected by encrypted storage, device and location monitoring, and email confirmation of every sensitive action.',
    cta: confirmUrl ? { label: 'Yes, this was me', url: confirmUrl } : undefined,
    cta2: denyUrl ? { label: 'No, secure my account', url: denyUrl } : undefined
  }, lang);
}

// ---- Account ----
function notifyAccountCreated(toEmail, { accountId, fullName, lang }) {
  return sendTemplated(toEmail, {
    subject: 'Vistra | Your Transaction Account is ready', preheader: `Account ${accountId} has been created.`,
    eyebrow: 'Welcome to Vistra', title: 'Your Transaction Account is ready', name: fullName, badge: { text: 'Account active', tone: 'success' },
    paragraphs: ['It is our pleasure to confirm that your Standard Transaction Account has been created and is now active.', 'Please keep your Account ID for reference — it appears on your dashboard and on every receipt we issue.', 'Next, begin your transaction in the group conversation, or complete identity verification so that withdrawals are ready the moment your funds are.'],
    details: [['Account holder', clean(fullName)], ['Account ID', String(accountId)], ['Account type', 'Standard']], cta: { label: 'Open your account' }
  }, lang);
}
function notifyAccountAccess(toEmail, { accountId, disabled, reason, lang, name }) {
  return disabled ? sendTemplated(toEmail, {
    subject: 'Vistra | Important notice about your account', preheader: 'Your Transaction Account has been disabled.',
    eyebrow: 'Account Notice', title: 'Your Transaction Account has been disabled', name, badge: { text: 'Account disabled', tone: 'danger' },
    paragraphs: ['We are writing to inform you that your Transaction Account has been disabled.', 'While the account is disabled you will not be able to withdraw, deposit or change account details.'],
    details: [...acct(accountId), ...(reason ? [['Reason', reason]] : [])], dispute: true
  }, lang) : sendTemplated(toEmail, {
    subject: 'Vistra | Your account has been re-enabled', preheader: 'Your Transaction Account is fully available again.',
    eyebrow: 'Account Notice', title: 'Your Transaction Account is active again', name, badge: { text: 'Account enabled', tone: 'success' },
    paragraphs: ['Good news — your Transaction Account has been re-enabled and is fully available again.', 'Thank you for your patience while we completed our review.'], details: acct(accountId), cta: { label: 'Open your account' }
  }, lang);
}

// ---- Verification (KYC) ----
function notifyKycStatus(toEmail, { status, reason, lang, name, accountId }) {
  const V = {
    pending: { badge: ['Under review', 'info'], title: 'We have received your documents', p: ['Thank you for submitting your identity verification documents. They have been received securely and are now under review by our compliance team.', 'We will write to you as soon as the review is complete.'] },
    verified: { badge: ['Verified', 'success'], title: 'Your identity has been successfully verified', p: ['We are pleased to confirm that your identity has been successfully verified. Thank you for completing this important security step — it keeps every client, and every transaction, protected.', 'Your Transaction Account is now fully verified. You may request withdrawals at any time, subject to your transaction reaching the disbursement stage.'] },
    rejected: { badge: ['Action required', 'danger'], title: 'We could not approve your verification', p: ['Thank you for submitting your documents. Unfortunately, we were unable to approve your identity verification on this occasion.', 'Please review the reason below, then resubmit clear, valid and unexpired documents. We are here to help if you have any questions.'], dispute: true }
  }[status] || { badge: [String(status), 'info'], title: 'Your verification status has changed', p: [`Your verification status is now: ${status}.`] };
  return sendTemplated(toEmail, { subject: `Vistra | Identity verification — ${V.badge[0]}`, eyebrow: 'Identity Verification', title: V.title, name, badge: { text: V.badge[0], tone: V.badge[1] }, paragraphs: V.p, details: [...acct(accountId), ...(reason && status === 'rejected' ? [['Reason', reason]] : [])], dispute: !!V.dispute, cta: status === 'rejected' ? { label: 'Resubmit documents' } : undefined }, lang);
}
function notifyBusinessStatus(toEmail, { status, reason, lang, name }) {
  const V = {
    pending: { badge: ['Under review', 'info'], title: 'Your Business application is under review', p: ['Your Business account application has been received and is under review.', 'We will email you as soon as a decision has been made.'] },
    verified: { badge: ['Approved', 'success'], title: 'Your Business account is approved', p: ['We are delighted to confirm that your Business account has been approved.', 'Daily withdrawal limits no longer apply to your account.'] },
    rejected: { badge: ['Not approved', 'danger'], title: 'Your Business application was not approved', p: ['Your Business account application was not approved on this occasion.', 'You may correct the details and apply again.'], dispute: true }
  }[status] || { badge: [String(status), 'info'], title: 'Your Business account status has changed', p: [`Your Business account status is now: ${status}.`] };
  return sendTemplated(toEmail, { subject: `Vistra | Business account — ${V.badge[0]}`, eyebrow: 'Business Account', title: V.title, name, badge: { text: V.badge[0], tone: V.badge[1] }, paragraphs: V.p, details: reason && status === 'rejected' ? [['Reason', reason]] : [], dispute: !!V.dispute }, lang);
}

// ---- Funds ----
function notifyDepositStatus(toEmail, { amount, status, reason, lang, name }) {
  const ok = status === 'verified';
  return sendTemplated(toEmail, {
    subject: `Vistra | Deposit ${ok ? 'confirmed' : 'update'}`, eyebrow: 'Deposit Notification', title: ok ? 'Your deposit has been confirmed' : 'We could not confirm your deposit', name,
    badge: { text: ok ? 'Confirmed' : 'Not confirmed', tone: ok ? 'success' : 'danger' },
    paragraphs: ok ? ['Your deposit has been confirmed and is now recorded on your Transaction Account. Thank you.'] : ['We could not confirm your deposit. Please review the reason below.'],
    details: [['Amount', String(amount)], ...(reason && !ok ? [['Reason', reason]] : [])], dispute: !ok
  }, lang);
}
function notifyIncomingFunds(toEmail, { amountText, payerName, purpose, status, reason, lang, name, extraDetails, accountId }) {
  const V = {
    credited: { badge: ['Credited', 'success'], title: 'Funds have been credited', p: 'Funds have been received and credited to your Transaction Account.' },
    held_in_vault: { badge: ['Held in vault', 'warning'], title: 'Funds received — now being verified', p: 'Funds have been received and are held securely in your vault while they pass our verification stages. You can follow their progress live from your dashboard.' },
    awaiting_release: { badge: ['Verified', 'success'], title: 'Verification complete — funds secured', p: 'Every verification stage has been completed. Your funds are safely secured in your vault and are awaiting final release by the Desk to your main account. You will be notified the moment they are released.' },
    released: { badge: ['Released', 'success'], title: 'Funds are now available', p: 'Verification is complete. The funds have been released from your vault and are now available in your main Transaction Account.' },
    reversed: { badge: ['Reversed', 'danger'], title: 'A payment has been reversed', p: 'A payment received on your account has been reversed and removed from your Transaction Account.', dispute: true }
  }[status] || { badge: [String(status), 'info'], title: 'Your payment status has changed', p: `Your incoming payment status is now: ${status}.` };
  return sendTemplated(toEmail, {
    subject: `Vistra | ${V.title}`, eyebrow: 'Funds Notification', title: V.title, name, badge: { text: V.badge[0], tone: V.badge[1] }, paragraphs: [V.p],
    details: [['Amount', amountText], ['Received from', payerName], ['Payment for', purpose], ...(extraDetails || []), ...acct(accountId), ...(reason && status === 'reversed' ? [['Reason', reason]] : [])], dispute: !!V.dispute, cta: status !== 'reversed' ? { label: 'View your account' } : undefined
  }, lang);
}
function notifyWithdrawalStatus(toEmail, { amount, currency, status, reason, lang, name, reference, accountId }) {
  const label = { pending: 'Pending', held_in_vault: 'Pending', processing: 'Processing', completed: 'Completed', declined: 'Declined', rejected: 'Declined', failed: 'Declined' }[status] || status;
  const tone = { Pending: 'warning', Processing: 'info', Completed: 'success', Declined: 'danger' }[label] || 'info';
  const body = { Pending: 'Your withdrawal request has been received and is awaiting review.', Processing: 'Your withdrawal has been approved and the payout is now in progress.', Completed: 'Your withdrawal has been completed and the payout has been sent.', Declined: 'We were unable to proceed with your withdrawal request. The full amount has been returned to your available balance. The reason given by our team is shown below.' }[label] || `Your withdrawal is now ${label}.`;
  const declined = label === 'Declined';
  return sendTemplated(toEmail, {
    subject: `Vistra | Withdrawal ${label.toLowerCase()}${reference ? ' — ' + reference : ''}`, preheader: `Your withdrawal is now ${label}.`, eyebrow: 'Withdrawal Update', title: `Your withdrawal is ${label.toLowerCase()}`, name,
    badge: { text: label, tone }, paragraphs: [body],
    details: [...(reference ? [['Request reference', reference]] : []), ['Amount', `${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`], ...acct(accountId), ['Status', label], ...(reason && !declined ? [['Note', reason]] : [])],
    quote: declined && reason ? reason : undefined, dispute: declined
  }, lang);
}

module.exports = {
  wrapHtml, codeBlock,
  setRuntimeConfig, activeConfig, emailStatus, isEmailConfigured, checkDeliverability, verifyConnection, sendRaw, compose, sendTemplated, BRAND, COMPANY, SERVICE, SUPPORT_EMAIL,
  sendEmail,
  notifyOfflineMessage, notifyTransactionSubmitted, notifyPasswordResetCode, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus, notifyIncomingFunds,
  notifyRegistrationCode, notifyWithdrawalCode, notifyAccountAccess, notifyAccountCreated, notifyBusinessStatus, notifyMessageReminder,
  notifyWithdrawalReceived, notifyLoginAlert, notifyManualAccount, notifyPasswordChanged, resolveName
};
