// Email for the Transaction Desk — built to work with Zoho Mail out of the box and to
// land in the inbox, not spam.
//
// WHAT YOU SET (any ONE of these styles works — the names you already use keep working):
//   EMAIL_SERVICE=zoho   EMAIL_USER=no-reply@usvistra.com   EMAIL_PASS=<Zoho app password>
//   EMAIL_FROM="Quantum Secure Transaction Desk <no-reply@usvistra.com>"      (optional)
//   or  SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS     (any other provider)
//   optional: ZOHO_REGION=com|eu|in|com.au|jp|ca|sa|com.cn   EMAIL_REPLY_TO   EMAIL_FROM_ALIASES
//             EMAIL_DKIM_SELECTOR   BRAND_NAME   SUPPORT_EMAIL
//
// WHAT THIS FILE DOES FOR YOU
//  * Zoho has different servers per region and per plan (smtp.zoho.com, smtppro.zoho.com,
//    smtp.zoho.eu, .in, ...). If you do not say which, it tries them in a sensible order (SSL 465,
//    then 587), remembers the one that works, and tells you plainly in the log if none does.
//  * The "From" address is forced to be your real mailbox (or a listed alias). Zoho rejects, and
//    spam filters punish, mail "from" an address the account does not own.
//  * Every email is multipart (plain text + HTML), has a proper Message-ID on your own domain,
//    Reply-To, Auto-Submitted, and a clear sender identity — the things receiving servers check.
//  * Sends are retried (3 attempts with back-off) and never block the app; a failed send is
//    reported to the caller so the UI can say so instead of waiting for an email that never comes.
//  * checkDeliverability() reads your DNS and tells you whether SPF, DKIM and DMARC are set —
//    those three DNS records (not code) are what decide inbox vs spam.
// If email is not configured, messages are printed to the console (mock mode) so local runs work.

const nodemailer = require('nodemailer');
const crypto = require('crypto');
const dns = require('dns').promises;
const { translateText } = require('./translate');
const { escapeHtml } = require('./security');

const Tpl = require('./emailTemplate');
const BRAND = process.env.BRAND_NAME || 'Quantum Secure Transaction Desk';          // the desk's name, shown as the gold badge
const FROM_NAME = process.env.EMAIL_FROM_NAME || `Vistra - ${BRAND}`;               // what recipients see as the sender
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@usvistra.com';           // help, codes, verification, withdrawals
const COMPLAINTS_EMAIL = process.env.COMPLAINTS_EMAIL || 'complaints@usvistra.com';  // formal complaints, reviews, disputes
const APP_URL = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');

const ZOHO_REGIONS = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa', 'com.cn'];

// ---------------- configuration ----------------
function readConfig() {
  const e = process.env;
  const service = String(e.EMAIL_SERVICE || '').trim();
  const user = e.EMAIL_USER || e.SMTP_USER || '';
  const pass = e.EMAIL_PASS || e.SMTP_PASS || '';
  const host = String(e.SMTP_HOST || '').trim();
  const configured = !!(user && pass && (service || host));
  const zoho = /zoho/i.test(service) || /zoho/i.test(host) || /zoho/i.test(e.EMAIL_HOST || '');
  return { service, user, pass, host, port: Number(e.SMTP_PORT) || 0, configured, zoho };
}
let CFG = readConfig();

function parseAddress(s) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(s || '');
  if (m) return { name: (m[1] || '').trim(), address: m[2].trim() };
  return /@/.test(s || '') ? { name: '', address: String(s).trim() } : { name: '', address: '' };
}

/** The From header. Always an address the SMTP account may legitimately send as. */
let warnedFrom = false;
function resolveFrom() {
  const env = parseAddress(process.env.EMAIL_FROM || '');
  const authAddr = /@/.test(CFG.user) ? CFG.user.trim() : '';
  const aliases = String(process.env.EMAIL_FROM_ALIASES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set([authAddr.toLowerCase(), ...aliases].filter(Boolean));
  let address = authAddr || env.address;
  if (env.address && (allowed.has(env.address.toLowerCase()) || !authAddr)) address = env.address;
  else if (env.address && authAddr && env.address.toLowerCase() !== authAddr.toLowerCase() && !warnedFrom) {
    warnedFrom = true;
    console.warn(`[email] EMAIL_FROM (${env.address}) is not the mailbox you log in with (${authAddr}). Using ${authAddr} instead — Zoho rejects, and spam filters punish, mail sent "as" an address the account does not own. To send as another address, add it to EMAIL_FROM_ALIASES after creating it as an alias in Zoho.`);
  }
  if (!address) address = 'no-reply@localhost.invalid';
  return { name: env.name || FROM_NAME, address, header: `"${(env.name || FROM_NAME).replace(/"/g, '')}" <${address}>`, domain: address.split('@')[1] || 'localhost' };
}

// ---------------- transport discovery ----------------
const state = {
  configured: CFG.configured, ready: null, host: null, port: null, secure: null, zoho: CFG.zoho,
  from: null, lastError: null, lastOkAt: null, lastCheckAt: null, tried: []
};
let transporter = null;
let discovering = null;
let lastDiscoveryAt = 0;
const factory = { createTransport: (o) => nodemailer.createTransport(o) }; // swappable in tests

function baseOptions(from) {
  return {
    pool: true, maxConnections: 2, maxMessages: 100, rateDelta: 1000, rateLimit: 5,
    connectionTimeout: 9000, greetingTimeout: 9000, socketTimeout: 30000,
    name: from.domain, // EHLO name = your own domain (matches your SPF/PTR story better than a pod name)
    tls: { minVersion: 'TLSv1.2' },
    auth: { user: CFG.user, pass: CFG.pass }
  };
}

function candidates() {
  const list = [];
  const add = (host, port, secure) => list.push({ host, port, secure });
  if (CFG.zoho) {
    const regions = [];
    const pref = String(process.env.ZOHO_REGION || '').trim().toLowerCase();
    const fromHost = /smtp(?:pro)?\.zoho\.([a-z.]+)$/i.exec(CFG.host);
    if (pref) regions.push(pref);
    if (fromHost) regions.push(fromHost[1].toLowerCase());
    ZOHO_REGIONS.forEach((r) => { if (!regions.includes(r)) regions.push(r); });
    const first = fromHost ? [CFG.host.toLowerCase()] : [];
    first.forEach((h) => { add(h, 465, true); add(h, 587, false); });
    regions.forEach((r) => ['smtp', 'smtppro'].forEach((p) => {
      const h = `${p}.zoho.${r}`; if (first.includes(h)) return; add(h, 465, true); add(h, 587, false);
    }));
  } else if (CFG.host) {
    const port = CFG.port || 587;
    add(CFG.host, port, port === 465);
    if (port === 465) add(CFG.host, 587, false); else if (port === 587) add(CFG.host, 465, true);
  } else if (CFG.service) {
    list.push({ service: CFG.service });
  }
  return list;
}

function explain(err, c) {
  const msg = String((err && err.message) || err);
  const code = err && err.code;
  if (code === 'EAUTH' || /535|authentication/i.test(msg)) return `login refused at ${c.host || c.service}: check EMAIL_USER (the full address) and use a Zoho APP PASSWORD, not your normal password (or SMTP access is off for this mailbox/plan)`;
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ESOCKET' || code === 'ECONNECTION' || code === 'EDNS' || code === 'ENOTFOUND') return `cannot reach ${c.host}:${c.port} (${code})`;
  return msg.slice(0, 200);
}

/** Finds a working server. Called at boot and again (at most every 5 minutes) after a failed send. */
async function discover(force = false) {
  CFG = readConfig(); state.configured = CFG.configured; state.zoho = CFG.zoho;
  if (!CFG.configured) { transporter = null; state.ready = false; state.lastError = 'Email is not configured (EMAIL_SERVICE/EMAIL_USER/EMAIL_PASS or SMTP_HOST/SMTP_USER/SMTP_PASS).'; return state; }
  if (discovering) return discovering;
  if (!force && Date.now() - lastDiscoveryAt < 5 * 60 * 1000 && state.ready === false) return state;
  discovering = (async () => {
    lastDiscoveryAt = Date.now(); state.tried = []; state.lastCheckAt = new Date().toISOString();
    const from = resolveFrom(); state.from = from.header;
    let lastErr = null; let sawAuthFail = false; let sawReach = false;
    const authRefused = new Set(); // hosts that accepted the connection but refused the login — port 587 on them would fail the same way
    for (const c of candidates()) {
      const label = c.service ? `service:${c.service}` : `${c.host}:${c.port}`;
      if (c.host && authRefused.has(c.host)) continue;
      try {
        const t = factory.createTransport({ ...baseOptions(from), ...(c.service ? { service: c.service } : { host: c.host, port: c.port, secure: c.secure }) });
        await t.verify();
        if (transporter && transporter.close) try { transporter.close(); } catch (e) { /* ignore */ }
        transporter = t; state.ready = true; state.host = c.host || c.service; state.port = c.port || null; state.secure = !!c.secure;
        state.lastError = null; state.lastOkAt = new Date().toISOString(); state.tried.push({ server: label, ok: true });
        console.log(`[email] ✅ Ready — sending through ${label} as ${from.header}`);
        return state;
      } catch (err) {
        lastErr = err; state.tried.push({ server: label, ok: false, why: explain(err, c) });
        if (err && (err.code === 'EAUTH' || /535|authentication/i.test(String(err.message)))) { sawAuthFail = true; if (c.host) authRefused.add(c.host); } else sawReach = true;
        try { if (t && t.close) t.close(); } catch (e) { /* ignore */ }
      }
    }
    state.ready = false;
    state.lastError = sawAuthFail
      ? 'The mail server was reached but refused the login. Use the FULL address as EMAIL_USER and a Zoho APP PASSWORD as EMAIL_PASS (Zoho → My Account → Security → App Passwords). Also check that SMTP/IMAP access is enabled for this mailbox and that your Zoho plan includes SMTP.'
      : `Could not connect to any mail server (${explain(lastErr, { host: 'the server', port: '' })}). Check the host/region and that your host allows outgoing mail on ports 465 or 587.`;
    console.error(`[email] ❌ Not working: ${state.lastError}`);
    state.tried.slice(0, 6).forEach((t) => console.error(`[email]    tried ${t.server}: ${t.why || 'ok'}`));
    return state;
  })().finally(() => { discovering = null; });
  return discovering;
}
// Boot-time check in the background — never delays the app starting.
if (CFG.configured) setTimeout(() => discover(true).catch(() => {}), 50).unref();
else console.log('[email] Not configured — emails will only be printed in this log. Set EMAIL_SERVICE=zoho, EMAIL_USER and EMAIL_PASS (see EMAIL-SETUP-ZOHO.md).');

function isEmailConfigured() { return CFG.configured; }
/** True only when email is configured AND last known to be working. */
function isEmailWorking() { return CFG.configured && state.ready !== false; }

/**
 * Whether security codes (registration email check, withdrawal confirmation) are enforced.
 * REQUIRE_EMAIL_CODES = 'true' | 'false' | 'auto' (default). Auto = enforced whenever email is
 * configured and not known to be broken — so a mistyped password can never lock sellers out.
 */
function emailCodesRequired() {
  const v = String(process.env.REQUIRE_EMAIL_CODES || 'auto').toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return isEmailWorking();
}

// ---------------- building + sending the message ----------------
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps']);

/** Translates every human sentence in the spec (and the template's own fixed text) in ONE batch. Never throws. */
async function localise(spec, subject, lang) {
  if (!lang || lang === 'en') return { spec, subject, fixed: {} };
  const keep = spec.facts ? spec.facts.map(([k]) => k) : [];
  const strings = [subject, spec.eyebrow, spec.title, spec.greeting, ...(spec.paragraphs || []), spec.codeNote, spec.status && spec.status.label,
    spec.notice && spec.notice.text, spec.cta && spec.cta.label, spec.preheader, ...keep, ...Tpl.FIXED_KEYS.map((k) => Tpl.FIXED[k])];
  let out = strings;
  try {
    const { translateBatch } = require('./translate');
    const r = await translateBatch(strings.map((x) => x || ''), lang);
    out = r.translations.map((v, i) => v || strings[i]);
  } catch (e) { /* send English rather than nothing */ }
  let i = 0; const next = () => { const v = out[i]; const orig = strings[i]; i++; return orig === undefined || orig === null || orig === false ? orig : v; };
  const L = { subject: next(), eyebrow: next(), title: next(), greeting: next() };
  const paragraphs = (spec.paragraphs || []).map(() => next());
  const codeNote = next(); const statusLabel = next(); const noticeText = next(); const ctaLabel = next(); const preheader = next();
  const factLabels = keep.map(() => next());
  const fixed = {}; Tpl.FIXED_KEYS.forEach((k) => { fixed[k] = next(); });
  return {
    subject: L.subject || subject, fixed,
    spec: Object.assign({}, spec, {
      eyebrow: L.eyebrow, title: L.title || spec.title, greeting: spec.greeting === false ? false : L.greeting, paragraphs, codeNote,
      status: spec.status ? Object.assign({}, spec.status, { label: statusLabel || spec.status.label }) : undefined,
      notice: spec.notice ? Object.assign({}, spec.notice, { text: noticeText || spec.notice.text }) : undefined,
      cta: spec.cta ? Object.assign({}, spec.cta, { label: ctaLabel || spec.cta.label }) : undefined,
      preheader, facts: spec.facts ? spec.facts.map(([, v], idx) => [factLabels[idx] || spec.facts[idx][0], v]) : undefined
    })
  };
}

/** Sends one Vistra-branded email. Returns true only if the mail server accepted it. */
async function deliver({ to, subject, spec, lang, bulkish = false }) {
  if (!to) return false;
  const loc = await localise(spec, subject, lang);
  const { html, text } = Tpl.render(loc.spec, (x) => x, {
    desk: BRAND, supportEmail: SUPPORT_EMAIL, complaintsEmail: COMPLAINTS_EMAIL, lang: lang || 'en', rtl: RTL.has(lang), fixed: loc.fixed
  });
  subject = loc.subject;

  if (!CFG.configured) { console.log(`[email:mock] to=${to} subject="${subject}" body="${text.split('\n').filter((l) => l.trim() && !/^[=\-]+$/.test(l)).slice(0, 12).join(' / ')}"`); return false; }
  if (!transporter && state.ready !== false) await discover(false);
  if (!transporter) { console.error(`[email] not sent to ${to} (${subject}): ${state.lastError}`); return false; }

  const from = resolveFrom();
  const mail = {
    from: from.header, to, subject, text, html,
    replyTo: process.env.EMAIL_REPLY_TO || SUPPORT_EMAIL,
    messageId: `<${crypto.randomUUID()}@${from.domain}>`,
    headers: Object.assign({ 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
      bulkish ? { 'List-Unsubscribe': `<mailto:${COMPLAINTS_EMAIL}?subject=unsubscribe>` } : {})
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await transporter.sendMail(mail);
      state.lastOkAt = new Date().toISOString(); state.ready = true;
      console.log(`[email] sent to ${to}: ${subject}`);
      return true;
    } catch (err) {
      const fatal = err && (err.responseCode >= 550 && err.responseCode <= 559);
      console.error(`[email] send attempt ${attempt} to ${to} failed: ${String(err.message).slice(0, 200)}`);
      if (fatal) { state.lastError = `Rejected by the mail server: ${String(err.message).slice(0, 200)}`; return false; } // bad recipient / From rejected: retrying will not help
      if (err && (err.code === 'EAUTH' || err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET')) { await discover(true).catch(() => {}); if (!transporter) return false; }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  return false;
}

/** Back-compatible plain sender: paragraphs of `text` become the message body in the Vistra layout. */
function sendEmail(to, subject, text, opts = {}) {
  return deliver({ to, subject, lang: opts.lang, bulkish: !!opts.bulkish,
    spec: { eyebrow: opts.eyebrow || 'Notice', title: opts.title || subject, paragraphs: String(text || '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean), code: opts.code, preheader: subject } });
}

// ---------------- the messages ----------------
const open = () => (APP_URL ? { label: 'Open the Transaction Desk', url: APP_URL } : undefined);
const hello = (name) => (name ? `Dear ${String(name).trim()},` : undefined);
const SECURITY_SHARE = 'Never share this code with anyone. Vistra staff will never ask you for it — by email, telephone or chat.';

function notifyRegistrationCode(toEmail, { code, lang, name }) {
  return deliver({ to: toEmail, lang, subject: 'Your Vistra verification code', spec: {
    eyebrow: 'Security Verification', title: 'Confirm your email address', greeting: hello(name), preheader: `Your verification code is ${code}`,
    paragraphs: ['Welcome to Vistra. To protect your Transaction Account, please confirm that this email address belongs to you by entering the verification code below on the registration screen.',
      'If you did not begin this registration, no action is required — no account will be created and this code will expire on its own.'],
    code, codeNote: 'Valid for 10 minutes  ·  Single use', notice: { tone: 'warn', text: SECURITY_SHARE } } });
}
function notifyWithdrawalCode(toEmail, { code, amountText, methodText, lang, name }) {
  return deliver({ to: toEmail, lang, subject: 'Authorise your Vistra withdrawal', spec: {
    eyebrow: 'Withdrawal Authorisation', title: 'Authorise your withdrawal', greeting: hello(name), preheader: `Withdrawal authorisation code: ${code}`,
    paragraphs: ['A withdrawal has been requested on your Transaction Account. For your protection, it will proceed only once you confirm it with the code below.'],
    facts: [['Amount', amountText], ['Destination', methodText]], code, codeNote: 'Valid for 10 minutes  ·  Single use',
    notice: { tone: 'danger', text: `If you did not request this withdrawal, do not share this code. Contact Client Support immediately at ${SUPPORT_EMAIL} so that we can secure your account.` } } });
}
function notifyPasswordResetCode(toEmail, { code, groupName, lang, name }) {
  return deliver({ to: toEmail, lang, subject: 'Your Vistra password reset code', spec: {
    eyebrow: 'Account Recovery', title: 'Reset your password', greeting: hello(name), preheader: `Password reset code: ${code}`,
    paragraphs: [`We received a request to reset the password of your Transaction Account${groupName ? ` for "${groupName}"` : ''}. Enter the code below on the recovery screen to continue.`],
    code, codeNote: 'Valid for 10 minutes  ·  Single use',
    notice: { tone: 'info', text: `If you did not make this request, you may safely ignore this message — your password has not been changed.\n${SECURITY_SHARE}` } } });
}
function notifyPasswordResetByDesk(toEmail, { lang, name }) {
  return deliver({ to: toEmail, lang, subject: 'Your Vistra account password was reset', spec: {
    eyebrow: 'Account Security', title: 'Your password has been reset', greeting: hello(name), status: { label: 'Password reset', tone: 'warn' },
    paragraphs: ['The Desk has reset the password on your Transaction Account. Please sign in with the temporary password that was provided to you through a secure channel.'],
    notice: { tone: 'danger', text: `If you did not expect this change, contact Client Support immediately at ${SUPPORT_EMAIL}.` }, cta: open() } });
}
function notifyWelcome(toEmail, { name, accountId, accountType, currency, lang }) {
  return deliver({ to: toEmail, lang, subject: 'Welcome to Vistra — your Transaction Account is ready', spec: {
    eyebrow: 'Welcome', title: 'Your Transaction Account is ready', greeting: hello(name), status: { label: 'Account active', tone: 'success' },
    paragraphs: ['Your Transaction Account has been created and secured. Every payment recorded to it passes through a five-stage escrow review before it is released to you, and you can follow each stage live from the Tracking Payment page.',
      'To withdraw, complete identity verification and, once both parties have confirmed the transaction, the Desk will open the disbursement stage for you.'],
    facts: [['Account ID', accountId], ['Account type', accountType || 'Standard account'], ['Currency', currency]],
    notice: { tone: 'info', text: 'Please keep your Account ID. Quote it in any correspondence with Client Support or the Complaints office.' }, cta: open() } });
}
function notifyKycStatus(toEmail, { groupName, status, reason, lang, name }) {
  const base = { eyebrow: 'Identity Verification', greeting: hello(name), cta: open() };
  const spec = status === 'verified'
    ? { ...base, title: 'Your identity has been verified', status: { label: 'Verified', tone: 'success' }, paragraphs: [`Thank you. Your identity has been verified for "${groupName}".`, 'You may now request withdrawals as soon as your transaction has reached the disbursement stage.'] }
    : status === 'rejected'
      ? { ...base, title: 'We could not approve your documents', status: { label: 'Action required', tone: 'danger' }, paragraphs: [`Your identity verification for "${groupName}" was not approved.`, 'Please correct the point below and submit your documents again — it only takes a few minutes.'],
        facts: reason ? [['Reason', reason]] : undefined, notice: { tone: 'info', text: `If you believe this decision is mistaken, you may request a formal review by writing to ${COMPLAINTS_EMAIL} and quoting your Account ID.` } }
      : { ...base, title: 'We have received your documents', status: { label: 'Under review', tone: 'gold' }, paragraphs: [`Your identity verification documents for "${groupName}" have been received and are now with our verification team.`, 'You will be notified as soon as the review is complete.'] };
  return deliver({ to: toEmail, lang, subject: status === 'verified' ? 'Your identity has been verified' : status === 'rejected' ? 'Action required: identity verification' : 'Identity documents received', spec });
}
function notifyDepositStatus(toEmail, { groupName, amount, status, reason, lang, name }) {
  const ok = status === 'verified';
  return deliver({ to: toEmail, lang, subject: ok ? 'Your deposit has been confirmed' : 'Your deposit could not be confirmed', spec: {
    eyebrow: 'Deposit Update', title: ok ? 'Your deposit has been confirmed' : 'Your deposit could not be confirmed', greeting: hello(name),
    status: ok ? { label: 'Confirmed', tone: 'success' } : { label: 'Not confirmed', tone: 'danger' },
    paragraphs: [ok ? `Your deposit for "${groupName}" has been verified and is now available in your Transaction Account.` : `We were unable to confirm your deposit for "${groupName}".`],
    facts: [['Amount', amount], ...(!ok && reason ? [['Reason', reason]] : [])],
    notice: ok ? undefined : { tone: 'info', text: `If you believe the deposit was sent correctly, please contact Client Support at ${SUPPORT_EMAIL} with the transaction reference.` }, cta: open() } });
}
function notifyWithdrawalStatus(toEmail, { groupName, amount, currency, status, reason, lang, name, ref }) {
  const st = status === 'held_in_vault' ? 'pending' : status === 'failed' ? 'rejected' : status;
  const cfg = {
    pending: { label: 'Pending', tone: 'gold', title: 'Withdrawal request received', p: 'We have received your withdrawal request and it is queued for review. The amount has been set aside from your available balance while it is processed.' },
    processing: { label: 'Processing', tone: 'info', title: 'Your withdrawal is being processed', p: 'Your withdrawal has been approved and the payout is now in progress.' },
    completed: { label: 'Completed', tone: 'success', title: 'Your withdrawal is complete', p: 'Your withdrawal has been completed and the funds have been released to your chosen destination. A receipt is available in your Transaction Account.' },
    rejected: { label: 'Declined', tone: 'danger', title: 'Your withdrawal was declined', p: 'We were unable to complete this withdrawal. The full amount has been returned to your available balance.' }
  }[st] || { label: String(st), tone: 'gold', title: 'Withdrawal update', p: `Your withdrawal status is now ${st}.` };
  return deliver({ to: toEmail, lang, subject: `Withdrawal ${cfg.label.toLowerCase()} — ${ref || groupName}`, spec: {
    eyebrow: 'Withdrawal Update', title: cfg.title, greeting: hello(name), status: { label: cfg.label, tone: cfg.tone }, paragraphs: [cfg.p],
    facts: [['Amount', `${amount} ${currency}`], ...(ref ? [['Reference', ref]] : []), ['Transaction group', groupName], ...(reason && st === 'rejected' ? [['Reason', reason]] : [])],
    notice: st === 'rejected' ? { tone: 'info', text: `If you would like to dispute this decision, you may lodge a formal complaint at ${COMPLAINTS_EMAIL}, quoting your Account ID and the reference above.` } : undefined, cta: open() } });
}
function notifyIncomingFunds(toEmail, { groupName, amountText, payerName, purpose, status, reason, lang, name }) {
  const cfg = {
    credited: { label: 'Credited', tone: 'success', title: 'Funds credited to your account', p: `Funds have been received and credited to your Transaction Account for "${groupName}". They are available to you now.` },
    held_in_vault: { label: 'In escrow review', tone: 'gold', title: 'Funds received — held in your vault', p: `Funds have been received for "${groupName}" and are held securely in your vault while the payment completes its escrow review. You can follow each stage live from the Tracking Payment page; the funds move to your available balance automatically when the review finishes.` },
    released: { label: 'Released', tone: 'success', title: 'Funds released to your balance', p: `The escrow review is complete. The funds from "${groupName}" have cleared and are now available in your Transaction Account.` },
    reversed: { label: 'Reversed', tone: 'danger', title: 'A payment was reversed', p: `A payment recorded on "${groupName}" has been reversed.` }
  }[status] || { label: String(status), tone: 'gold', title: 'Incoming funds update', p: `The status of an incoming payment is now ${status}.` };
  return deliver({ to: toEmail, lang, subject: `${cfg.title} — ${groupName}`, spec: {
    eyebrow: 'Incoming Funds', title: cfg.title, greeting: hello(name), status: { label: cfg.label, tone: cfg.tone }, paragraphs: [cfg.p],
    facts: [['Amount', amountText], ['Received from', payerName], ['Payment for', purpose], ...(status === 'reversed' && reason ? [['Reason', reason]] : [])],
    notice: status === 'reversed' ? { tone: 'info', text: `If you wish to query this reversal, please lodge a formal complaint at ${COMPLAINTS_EMAIL} and quote your Account ID.` } : undefined, cta: open() } });
}
function notifyAccountAccess(toEmail, { groupName, disabled, reason, lang, name }) {
  const where = groupName ? ` for "${groupName}"` : '';
  return deliver({ to: toEmail, lang, subject: disabled ? 'Important: your Vistra account has been disabled' : 'Your Vistra account has been re-enabled', spec: disabled ? {
    eyebrow: 'Account Notice', title: 'Your account has been disabled', greeting: hello(name), status: { label: 'Disabled', tone: 'danger' },
    paragraphs: [`Your Transaction Account${where} has been disabled by the Desk. While it is disabled you will not be able to use it; the funds recorded to it remain safely held.`],
    facts: reason ? [['Reason', reason]] : undefined,
    notice: { tone: 'warn', text: `To request a formal review of this decision, lodge a complaint at ${COMPLAINTS_EMAIL} and quote your Account ID. Our Complaints office will acknowledge it and respond in writing.\nFor general questions you may also contact Client Support at ${SUPPORT_EMAIL}.` } } : {
    eyebrow: 'Account Notice', title: 'Your account has been re-enabled', greeting: hello(name), status: { label: 'Active', tone: 'success' },
    paragraphs: [`Good news — your Transaction Account${where} has been re-enabled. You may sign in and use it as normal.`, 'Thank you for your patience while we completed our review.'], cta: open() } });
}
function notifyBusinessStatus(toEmail, { status, reason, lang, name }) {
  const cfg = status === 'verified'
    ? { title: 'Your business account is approved', status: { label: 'Approved', tone: 'success' }, p: ['Your business account application has been approved. The standard daily withdrawal limit no longer applies to your account.'] }
    : status === 'pending'
      ? { title: 'Business application received', status: { label: 'Under review', tone: 'gold' }, p: ['We have received your business account application. Our compliance team is reviewing the company details and documents you provided; you will be notified of the outcome.'] }
      : { title: 'Business application not approved', status: { label: 'Not approved', tone: 'danger' }, p: ['Your business account application was not approved at this time.', 'You may correct the details below and apply again.'], facts: reason ? [['Reason', reason]] : undefined,
        notice: { tone: 'info', text: `If you would like this decision reviewed, you may lodge a formal complaint at ${COMPLAINTS_EMAIL}.` } };
  return deliver({ to: toEmail, lang, subject: status === 'verified' ? 'Your business account is approved' : status === 'pending' ? 'Business application received' : 'Business application update', spec: { eyebrow: 'Business Account', greeting: hello(name), cta: open(), ...cfg, paragraphs: cfg.p } });
}
function notifyDisbursement(toEmail, { groupName, enabled, lang, name }) {
  return deliver({ to: toEmail, lang, subject: enabled ? 'Withdrawals are now open' : 'Withdrawals are paused', spec: enabled ? {
    eyebrow: 'Disbursement Stage', title: 'Withdrawals are now open', greeting: hello(name), status: { label: 'Disbursement stage active', tone: 'success' },
    paragraphs: [`Both parties to "${groupName}" are confirmed and the Desk has opened the disbursement stage. You may now withdraw your available funds from your Transaction Account.`], cta: open() } : {
    eyebrow: 'Disbursement Stage', title: 'Withdrawals are paused', greeting: hello(name), status: { label: 'Paused', tone: 'warn' },
    paragraphs: [`Withdrawals on "${groupName}" are paused until the transaction is confirmed by both parties and returned to the disbursement stage. Your funds remain safe in your account.`], cta: open() } });
}
function notifyOfflineMessage(toEmail, { fromName, groupName, text, lang }) {
  return deliver({ to: toEmail, lang, bulkish: true, subject: `New message in ${groupName}`, spec: {
    eyebrow: 'New Message', title: 'You have a new message', greeting: undefined, preheader: `${fromName} wrote to you in ${groupName}`,
    paragraphs: [`${fromName} sent you a message in "${groupName}" while you were away.`, 'Sign in to the Transaction Desk to read the full conversation and reply.'], quote: text, cta: open() } });
}
function notifyDeskNote(toEmail, { groupName, note, lang }) {
  return deliver({ to: toEmail, lang, bulkish: true, subject: `A note from the Desk — ${groupName}`, spec: {
    eyebrow: 'Note from the Desk', title: 'The Desk has left you a note', greeting: undefined,
    paragraphs: [`The Desk has added the following note regarding "${groupName}":`, 'You will also find it in your transaction group.'], quote: note, cta: open() } });
}
function notifyTransactionSubmitted(toEmail, { submitterName, groupName }) {
  return deliver({ to: toEmail, bulkish: true, subject: `New transaction submitted — ${groupName}`, spec: {
    eyebrow: 'Transaction Board', title: 'A new transaction was submitted', greeting: 'Dear Desk Officer,', status: { label: 'Awaiting review', tone: 'gold' },
    paragraphs: [`${submitterName} has submitted a new transaction form in "${groupName}".`, 'Please review it from the Admin Transaction Board.'], cta: open() } });
}

// ---------------- admin tools: status, test email, DNS check ----------------
function getStatus() {
  const from = resolveFrom();
  return {
    configured: CFG.configured, working: state.ready === true, checking: !!discovering, zoho: CFG.zoho,
    server: state.host ? `${state.host}:${state.port}` : null, from: CFG.configured ? from.header : null,
    lastOkAt: state.lastOkAt, lastCheckAt: state.lastCheckAt, error: state.lastError,
    codesRequired: emailCodesRequired(), tried: state.tried.slice(0, 8)
  };
}
async function sendTest(to) {
  if (!CFG.configured) return { ok: false, error: state.lastError || 'Email is not configured.' };
  await discover(true);
  if (!transporter) return { ok: false, error: state.lastError };
  const ok = await deliver({ to, subject: 'Vistra email delivery test', spec: {
    eyebrow: 'System Check', title: 'Email delivery is working', greeting: 'Dear Administrator,', status: { label: 'Delivered', tone: 'success' },
    paragraphs: ['This is a test message from your Transaction Desk. If you are reading it in your inbox, outgoing email is configured correctly.', 'If it arrived in Spam, mark it "Not spam" and run the inbox-readiness check in the admin panel.'] } });
  return ok ? { ok: true } : { ok: false, error: state.lastError || 'The mail server did not accept the message — see the server log.' };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const flat = (rows) => rows.map((r) => (Array.isArray(r) ? r.join('') : String(r)));
async function txt(name) { try { return flat(await withTimeout(dns.resolveTxt(name), 5000)); } catch (e) { return []; } }

/** Reads the sending domain's DNS and reports on SPF, DKIM, DMARC and MX with plain-English fixes. */
async function checkDeliverability() {
  const from = resolveFrom(); const domain = from.domain;
  const out = { domain, checks: [], summary: '' };
  if (!domain || domain === 'localhost' || domain.endsWith('.invalid')) { out.summary = 'Email is not configured with a real sending address yet.'; return out; }
  const zohoRegion = (state.host && /zoho\.([a-z.]+)$/i.exec(state.host)) ? /zoho\.([a-z.]+)$/i.exec(state.host)[1] : 'com';

  const spfAll = (await txt(domain)).filter((t) => /^v=spf1/i.test(t));
  const spf = spfAll[0] || '';
  const spfOk = !!spf && (!CFG.zoho || spf.includes(`include:zoho.${zohoRegion}`) || /include:zoho\./i.test(spf));
  out.checks.push({ name: 'SPF', ok: spfOk && spfAll.length === 1, found: spf || null,
    fix: !spf ? `Add a TXT record on ${domain}:  v=spf1 include:zoho.${zohoRegion} ~all` : spfAll.length > 1 ? 'You have more than one SPF record — merge them into one.' : !spfOk ? `Your SPF record does not include Zoho. Change it to include "include:zoho.${zohoRegion}".` : null });

  const selectors = [process.env.EMAIL_DKIM_SELECTOR, 'zmail', 'zoho', 'zohomail', 'zmail1', 'default', 'selector1', 's1', 'mail'].filter(Boolean);
  let dk = null; let dkSel = null;
  for (const s of selectors) { const r = (await txt(`${s}._domainkey.${domain}`)).find((t) => /v=DKIM1|k=rsa|p=/i.test(t)); if (r) { dk = r; dkSel = s; break; } }
  out.checks.push({ name: 'DKIM', ok: !!dk, found: dk ? `selector "${dkSel}"` : null,
    fix: dk ? null : 'In Zoho Mail Admin Console → Domains → your domain → Email Configuration → DKIM → Add selector, then copy the TXT record Zoho shows into your DNS and click Verify. (If you already did, set EMAIL_DKIM_SELECTOR to the selector name you chose.)' });

  const dm = (await txt(`_dmarc.${domain}`)).find((t) => /^v=DMARC1/i.test(t)) || '';
  const pol = (/p=(\w+)/i.exec(dm) || [])[1] || '';
  out.checks.push({ name: 'DMARC', ok: !!dm, found: dm || null,
    fix: dm ? (pol === 'none' ? 'DMARC is present in monitoring mode (p=none). That is fine to start; move to p=quarantine once mail is confirmed to pass.' : null) : `Add a TXT record on _dmarc.${domain}:  v=DMARC1; p=none; rua=mailto:${SUPPORT_EMAIL}` });

  let mx = [];
  try { mx = (await withTimeout(dns.resolveMx(domain), 5000)).map((m) => m.exchange.toLowerCase()); } catch (e) { /* none */ }
  const mxOk = mx.some((m) => /zoho\./.test(m)) || !CFG.zoho;
  out.checks.push({ name: 'MX (receiving)', ok: mx.length > 0 && mxOk, found: mx.join(', ') || null, fix: mx.length ? (mxOk ? null : 'Your MX records do not point to Zoho — replies would not reach your Zoho mailbox.') : 'No MX records — add the Zoho MX records so replies reach your mailbox.' });

  const failed = out.checks.filter((c) => !c.ok);
  out.summary = failed.length ? `Fix ${failed.map((c) => c.name).join(', ')} so receiving servers trust your email.` : 'SPF, DKIM, DMARC and MX all look correct — your email is set up for the best chance at the inbox.';
  return out;
}

module.exports = {
  isEmailConfigured, isEmailWorking, emailCodesRequired, SUPPORT_EMAIL, COMPLAINTS_EMAIL, getStatus, sendTest, checkDeliverability, discover,
  deliver, sendEmail,
  notifyRegistrationCode, notifyWithdrawalCode, notifyAccountAccess, notifyBusinessStatus, notifyPasswordResetByDesk, notifyWelcome, notifyDisbursement, notifyDeskNote,
  notifyOfflineMessage, notifyTransactionSubmitted, notifyPasswordResetCode, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus, notifyIncomingFunds,
  _test: { factory, readConfig, resolveFrom, candidates, state, reset() { CFG = readConfig(); transporter = null; state.ready = null; state.tried = []; warnedFrom = false; lastDiscoveryAt = 0; } }
};
