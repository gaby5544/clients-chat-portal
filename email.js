// Email — automatic, branded and translated. Configure ONE of these (checked in this order):
//   RESEND_API_KEY / BREVO_API_KEY / SENDGRID_API_KEY — HTTPS APIs (work on hosts that block SMTP ports)
//   ZOHO:  EMAIL_SERVICE=zoho + EMAIL_USER (full Zoho address) + EMAIL_PASS (password or app-specific password)
//          optional ZOHO_REGION = com (default) | eu | in | com.au | jp | ca | sa   — must match where the account lives
//          The server tries smtp.zoho.<region> first and smtppro.zoho.<region> (paid / custom-domain orgs) second.
//   EMAIL_SERVICE (e.g. "gmail") + EMAIL_USER + EMAIL_PASS
//   SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS
// EMAIL_FROM ("Name <address@your-domain>") — with Zoho this must be the mailbox you log in with (or one of its
// verified aliases); if it is not, the server automatically re-sends from the login address.
// With nothing configured, emails are only logged (mock mode). GET /api/health reports `emailConfigured`.
// Staying out of spam is mostly DNS: SPF + DKIM + DMARC on the sending domain. Admin > System status >
// "Check spam protection" tests all three for the domain in EMAIL_FROM and says exactly what to add.

const crypto = require('crypto');
const dnsp = require('dns').promises;
const nodemailer = require('nodemailer');
const { translateOne, translateMany, unescapeHtml } = require('./translate');
const { render } = require('./emailTemplate');
const { escapeHtml } = require('./security');

const ZOHO_TLD = { com: 'com', us: 'com', eu: 'eu', in: 'in', 'com.au': 'com.au', au: 'com.au', jp: 'jp', ca: 'ca', sa: 'sa' };
const zohoTld = () => ZOHO_TLD[String(process.env.ZOHO_REGION || 'com').trim().toLowerCase().replace(/^\./, '')] || 'com';
const zohoHost = (pro) => { const t = zohoTld(); const base = t === 'ca' ? 'zohocloud.ca' : `zoho.${t}`; return `${pro ? 'smtppro' : 'smtp'}.${base}`; };
const isZoho = () => /^zoho(mail)?$/i.test(String(process.env.EMAIL_SERVICE || '')) || /zoho/i.test(String(process.env.SMTP_HOST || ''));

const authUser = () => process.env.EMAIL_USER || process.env.SMTP_USER || null;
const authPass = () => process.env.EMAIL_PASS || process.env.SMTP_PASS || null;
const TIMEOUTS = { connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 25000 };

function smtpTransport(host, port) {
  const p = Number(port) || 465;
  return Object.assign(nodemailer.createTransport({ host, port: p, secure: p === 465, requireTLS: p !== 465, auth: { user: authUser(), pass: authPass() }, ...TIMEOUTS }), { _host: `${host}:${p}` });
}

// Returns a list of candidate transports (usually one). Zoho gets two because free and paid/custom-domain
// accounts use different servers; the first one that authenticates is remembered.
function buildTransporters() {
  const user = authUser(), pass = authPass();
  if (!user || !pass) {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) { /* handled below */ } else return [];
  }
  if (isZoho() && !process.env.SMTP_HOST) {
    const port = process.env.SMTP_PORT || 465;
    return [smtpTransport(zohoHost(false), port), smtpTransport(zohoHost(true), port)];
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return [smtpTransport(process.env.SMTP_HOST, process.env.SMTP_PORT || 587)];
  }
  if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return [Object.assign(nodemailer.createTransport({ service: process.env.EMAIL_SERVICE, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }, ...TIMEOUTS }), { _host: process.env.EMAIL_SERVICE })];
  }
  return [];
}
let transporters = buildTransporters();
let activeIdx = 0;
let forceAuthFrom = false; // set once the provider has refused a different From address

function apiProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  return null;
}
function providerName() {
  const a = apiProvider();
  if (a) return a;
  if (transporters.length) return isZoho() ? 'zoho' : (process.env.EMAIL_SERVICE ? `smtp:${process.env.EMAIL_SERVICE}` : 'smtp');
  return null;
}

// Live delivery status — shown in the admin System status panel so a broken mail setup is visible, not silent.
const status = { sent: 0, failed: 0, lastOkAt: null, lastError: null, lastErrorAt: null, host: null, verified: null, verifyError: null, fromNote: null };

const BRAND = process.env.BRAND_NAME || 'Quantum Secure Transaction Desk';
const TAGLINE = process.env.BRAND_TAGLINE || 'Secure Escrow & Payment Desk';
const MONOGRAM = (process.env.BRAND_MONOGRAM || BRAND.trim().charAt(0) || 'Q').toUpperCase();
// Two different desks with two different jobs: help (support) and formal escalations (complaints).
const COMPLAINTS_EMAIL = process.env.COMPLAINTS_EMAIL || 'complaints@usvistra.com';
const supportAddr = () => process.env.SUPPORT_EMAIL || parseFrom(fromAddress()).email;
const appUrl = () => { const u = String(process.env.APP_URL || '').trim().replace(/\/+$/, ''); return /^https?:\/\//i.test(u) ? u : ''; };
function isEmailConfigured() { return !!(apiProvider() || transporters.length); }

function parseFrom(f) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(f));
  return m ? { name: m[1].trim() || BRAND, email: m[2].trim() } : { name: BRAND, email: String(f).trim() };
}
function configuredFrom() {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  const u = authUser();
  return u && u.includes('@') ? `"${BRAND}" <${u}>` : `"${BRAND}" <no-reply@localhost>`;
}
function fromAddress() {
  const f = configuredFrom();
  const u = authUser();
  if (!apiProvider() && forceAuthFrom && u && u.includes('@')) return `"${parseFrom(f).name}" <${u}>`;
  return f;
}
function getStatus() { return { configured: isEmailConfigured(), provider: providerName(), from: fromAddress(), ...status, host: status.host || (transporters[activeIdx] && transporters[activeIdx]._host) || null }; }

// Check the SMTP login at start-up so a wrong password / region shows immediately, not on the first seller's code.
async function verifyTransport() {
  if (apiProvider() || !transporters.length) return;
  let lastErr = null;
  for (let i = 0; i < transporters.length; i++) {
    const t = transporters[i];
    if (typeof t.verify !== 'function') return;
    try { await t.verify(); activeIdx = i; status.verified = true; status.verifyError = null; status.host = t._host; console.log(`[email] SMTP login OK on ${t._host} (${providerName()})`); return; }
    catch (e) { lastErr = e; console.error(`[email] SMTP check failed on ${t._host}: ${e.message}`); }
  }
  status.verified = false; status.verifyError = friendlySmtpError(lastErr);
}
setTimeout(() => { verifyTransport().catch(() => {}); }, 1500).unref();

function friendlySmtpError(err) {
  const m = String((err && (err.response || err.message)) || err || '');
  if (/535|Invalid Credentials|auth(entication)? failed|AUTH/i.test(m) && isZoho()) return `${m.slice(0, 200)} — Zoho rejected the login. Check EMAIL_USER (full address) and EMAIL_PASS. If two-factor is on, create an app-specific password in Zoho Accounts > Security. If the account is in the EU/India/Australia data centre set ZOHO_REGION=eu|in|com.au.`;
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(m)) return `${m.slice(0, 160)} — cannot reach the mail server (wrong host/region, or the host blocks outbound SMTP).`;
  if (/SMTP access|not enabled|IMAP|SMTP is disabled/i.test(m)) return `${m.slice(0, 200)} — enable SMTP/IMAP access for this mailbox in Zoho Mail settings.`;
  return m.slice(0, 300);
}

async function postJson(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text()).slice(0, 300); } catch (e) { /* ignore */ }
      throw new Error(`${url.split('/')[2]} answered ${r.status}${detail ? ': ' + detail : ''}`);
    }
  } finally { clearTimeout(timer); }
}

// Headers that mark this as an automatic transactional message (not bulk mail) and give replies somewhere to go.
function mailHeaders(from, optional) {
  const dom = (parseFrom(from).email.split('@')[1] || 'localhost').toLowerCase();
  const headers = { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'OOF, AutoReply' };
  if (optional) headers['List-Unsubscribe'] = `<mailto:${supportAddr()}?subject=unsubscribe>`; // reminders / message alerts only
  return { headers, messageId: `<${crypto.randomUUID()}@${dom}>`, replyTo: supportAddr() };
}

async function smtpSend(msg) {
  const order = transporters.map((_, i) => (i + activeIdx) % transporters.length);
  let lastErr = null;
  for (const i of order) {
    try { await transporters[i].sendMail(msg); activeIdx = i; status.host = transporters[i]._host; return; }
    catch (e) {
      lastErr = e;
      // wrong credentials / unreachable host → try the next candidate server; a refused recipient or sender is final here
      if (!/535|Invalid Credentials|auth|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNECTION|ESOCKET/i.test(String(e.code || '') + ' ' + String(e.message))) throw e;
    }
  }
  throw lastErr;
}

async function deliver(to, subject, text, html, optional) {
  const from = fromAddress();
  const prov = apiProvider();
  if (prov === 'resend') return postJson('https://api.resend.com/emails', { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, { from, to: [to], subject, html, text, reply_to: supportAddr(), headers: { 'Auto-Submitted': 'auto-generated' } });
  if (prov === 'brevo') { const f = parseFrom(from); return postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': process.env.BREVO_API_KEY }, { sender: f, to: [{ email: to }], replyTo: { email: supportAddr() }, subject, htmlContent: html, textContent: text }); }
  if (prov === 'sendgrid') { const f = parseFrom(from); return postJson('https://api.sendgrid.com/v3/mail/send', { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` }, { personalizations: [{ to: [{ email: to }] }], from: f, reply_to: { email: supportAddr() }, subject, content: [{ type: 'text/plain', value: text || ' ' }, { type: 'text/html', value: html }] }); }
  const build = (fromAddr) => ({ from: fromAddr, to, subject, text, html, ...mailHeaders(fromAddr, optional) });
  try { return await smtpSend(build(from)); }
  catch (e) {
    // Zoho (and most SMTP servers) refuse a From that is not the login mailbox or one of its aliases → resend from the login address.
    const u = authUser();
    const refused = /553|550|relay|not allowed|sender (address )?rejected|not (authorized|permitted)|From address|alias/i.test(String(e.response || '') + ' ' + String(e.message));
    if (refused && u && u.includes('@') && parseFrom(from).email.toLowerCase() !== u.toLowerCase()) {
      const alt = `"${parseFrom(from).name}" <${u}>`;
      await smtpSend(build(alt));
      forceAuthFrom = true;
      status.fromNote = `The server refused ${parseFrom(from).email} as the sender, so mail is sent from ${u}. Set EMAIL_FROM to ${u} (or add ${parseFrom(from).email} as an alias in Zoho) to remove this notice.`;
      return;
    }
    throw e;
  }
}

async function sendRaw(to, subject, text, html, optional) {
  if (!to) return false;
  if (!isEmailConfigured()) {
    console.log(`[email:mock] to=${to} subject="${subject}" body="${text}"`);
    return false;
  }
  try {
    await deliver(to, subject, text, html, optional);
    status.sent++; status.lastOkAt = new Date().toISOString();
    console.log(`[email] sent via ${providerName()} to ${to}: ${subject}`);
    return true;
  } catch (err) {
    status.failed++; status.lastError = friendlySmtpError(err); status.lastErrorAt = new Date().toISOString();
    console.error('[email] send failed:', status.lastError);
    return false;
  }
}

/** Admin "send a test email" — returns {ok, error?} so the operator sees exactly why delivery fails. */
async function sendTest(to) {
  if (!isEmailConfigured()) return { ok: false, error: 'No email provider is configured. For Zoho set EMAIL_SERVICE=zoho, EMAIL_USER, EMAIL_PASS and EMAIL_FROM (same address). Or set RESEND_API_KEY / BREVO_API_KEY / SENDGRID_API_KEY, or SMTP settings. Then restart.' };
  const before = status.failed;
  const body = ['If you can read this, email delivery is working. Verification codes, withdrawal codes and notices will reach your sellers and buyers.', 'If this message landed in your spam folder, mark it "Not spam" and run "Check spam protection" in System status.'];
  const mail = layout('en', { eyebrow: 'System check', tone: 'success', status: { label: 'Delivery working', tone: 'success' }, title: 'Test email', paragraphs: body, contact: 'both' });
  const ok = await sendRaw(to, `${BRAND} — test email`, mail.text, mail.html);
  return ok ? { ok: true, from: fromAddress() } : { ok: false, error: status.failed > before ? status.lastError : 'Not sent.' };
}

// ---------------------------------------------------------------------------------------------------------------
// Spam-protection DNS check for the domain in the From address: SPF, DKIM, DMARC (+ MX, + login/From match).
const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|aol|proton|protonmail|gmx|mail)\./i;
const SPF_HINT = { zoho: () => `include:zoho.${zohoTld()}`, resend: () => 'include:amazonses.com', brevo: () => 'include:spf.brevo.com', sendgrid: () => 'include:sendgrid.net' };
const txt = async (name) => { const r = await dnsp.resolveTxt(name); return r.map((c) => c.join('')); };
async function safe(fn) { try { return { v: await fn() }; } catch (e) { return { err: e }; } }
const notFound = (e) => e && /ENOTFOUND|ENODATA|NXDOMAIN|NOTFOUND/i.test(String(e.code || e.message));

async function checkDeliverability() {
  const fromEmail = parseFrom(fromAddress()).email;
  const domain = (fromEmail.split('@')[1] || '').toLowerCase();
  const prov = providerName();
  const family = prov === 'zoho' || isZoho() ? 'zoho' : prov;
  const out = { domain, fromEmail, provider: prov, checks: [] };
  const add = (id, label, st, detail, fix) => out.checks.push({ id, label, status: st, detail, fix: fix || null });
  if (!isEmailConfigured()) { add('cfg', 'Email provider', 'bad', 'No provider configured yet.', 'Set the Zoho (or API) variables and restart.'); return out; }
  if (!domain || !domain.includes('.')) { add('from', 'Sender address', 'bad', `"${fromEmail}" is not a valid address.`, 'Set EMAIL_FROM="Name <you@yourdomain.com>".'); return out; }
  if (FREE_MAIL.test(domain)) add('from', 'Sender domain', 'bad', `${domain} is a free mailbox domain. Mail "from" it sent through another service cannot pass SPF/DKIM and is often junked.`, 'Send from an address on your own domain (e.g. no-reply@yourcompany.com) hosted on Zoho.');
  else add('from', 'Sender domain', 'ok', domain);
  const u = authUser();
  if (!apiProvider() && u && u.includes('@')) {
    if (u.toLowerCase() === fromEmail.toLowerCase()) add('login', 'From matches the login mailbox', 'ok', u);
    else add('login', 'From matches the login mailbox', 'warn', `Login is ${u} but EMAIL_FROM is ${fromEmail}. Zoho only allows this for verified aliases; otherwise mail is re-sent from ${u}.`, `Set EMAIL_FROM to ${u}, or add ${fromEmail} as an alias of that mailbox.`);
  }
  // SPF
  let r = await safe(() => txt(domain));
  if (r.err && !notFound(r.err)) add('spf', 'SPF', 'warn', `DNS lookup failed (${r.err.code || r.err.message}). Try again.`);
  else {
    const recs = (r.v || []).filter((x) => /^v=spf1\b/i.test(x));
    const hint = (SPF_HINT[family] || (() => null))();
    if (!recs.length) add('spf', 'SPF', 'bad', 'No SPF record found. Receivers cannot confirm your provider may send for this domain.', `Add a TXT record on ${domain}: v=spf1 ${hint || 'include:<your provider>'} ~all`);
    else if (recs.length > 1) add('spf', 'SPF', 'bad', `${recs.length} SPF records exist. Only one is allowed, so all of them fail.`, 'Merge them into a single TXT record.');
    else if (hint && !recs[0].includes(hint.replace('include:', ''))) add('spf', 'SPF', 'bad', `SPF exists but does not include your provider: ${recs[0]}`, `Add ${hint} to that record, before the final ~all / -all.`);
    else add('spf', 'SPF', 'ok', recs[0]);
  }
  // DKIM
  const selectors = [process.env.DKIM_SELECTOR, 'zmail', 'zoho', 'default', 'resend', 's1', 'selector1', 'k1', 'mail'].filter(Boolean);
  let dkim = null, dkimErr = null;
  for (const sel of [...new Set(selectors)]) {
    const d = await safe(() => txt(`${sel}._domainkey.${domain}`));
    if (d.v && d.v.some((x) => /v=DKIM1|k=rsa|p=/i.test(x))) { dkim = sel; break; }
    if (d.err && !notFound(d.err)) dkimErr = d.err;
  }
  if (dkim) add('dkim', 'DKIM', 'ok', `Signing key published (selector "${dkim}")`);
  else if (dkimErr) add('dkim', 'DKIM', 'warn', `DNS lookup failed (${dkimErr.code || dkimErr.message}). Try again.`);
  else add('dkim', 'DKIM', 'bad', 'No DKIM key found at the usual selectors. Unsigned mail is the biggest cause of spam placement.', family === 'zoho' ? 'Zoho Mail Admin Console > Domains > your domain > Email Configuration > DKIM > Add selector, copy the TXT record into your DNS, click Verify, and set the selector as default. If you used a custom selector name, set DKIM_SELECTOR to it and re-check.' : 'Enable domain authentication (DKIM) in your email provider and add the DNS records it shows.');
  // DMARC
  r = await safe(() => txt(`_dmarc.${domain}`));
  const dm = (r.v || []).find((x) => /^v=DMARC1/i.test(x));
  if (dm) { const pol = (/p=(\w+)/i.exec(dm) || [])[1]; add('dmarc', 'DMARC', pol === 'none' ? 'warn' : 'ok', dm, pol === 'none' ? 'Policy is "none" (monitor only). Once SPF and DKIM pass, move to p=quarantine for the best trust.' : null); }
  else if (r.err && !notFound(r.err)) add('dmarc', 'DMARC', 'warn', `DNS lookup failed (${r.err.code || r.err.message}). Try again.`);
  else add('dmarc', 'DMARC', 'bad', 'No DMARC record. Gmail and Yahoo expect one.', `Add a TXT record on _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:${fromEmail}`);
  // MX (replies and some spam filters look for a working mailbox on the sending domain)
  r = await safe(() => dnsp.resolveMx(domain));
  if (r.v && r.v.length) add('mx', 'MX (mailbox exists)', 'ok', r.v.map((m) => m.exchange).slice(0, 3).join(', '));
  else if (r.err && !notFound(r.err)) add('mx', 'MX (mailbox exists)', 'warn', `DNS lookup failed (${r.err.code || r.err.message}).`);
  else add('mx', 'MX (mailbox exists)', 'bad', 'The sending domain has no MX records.', family === 'zoho' ? `Add Zoho's MX records for ${domain} (mx.zoho.${zohoTld()}, mx2.zoho.${zohoTld()}, mx3.zoho.${zohoTld()}).` : 'Add MX records for the domain.');
  out.ok = out.checks.every((c) => c.status === 'ok');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Compose + translate + send. `parts` = { eyebrow, tone, title, lines[], status{label,tone}, facts[[k,v]], code,
// codeNote, cta (label), note, noteTone, contact: 'support' | 'both', optional, signoff:false }.
// Every human sentence is translated into the reader's language; codes, amounts, references and addresses pass through untouched.
const LEGAL = 'This message is confidential and intended solely for the recipient. If it reached you in error, please delete it and let us know. Never share a verification code with anyone: our team will never ask you for one. All communications and transactions are handled under strict compliance controls.';

function buildMail(lang, parts, tr) {
  const T = (s) => (s ? tr(s) : s);
  const contacts = [{ kind: 'support', title: T('Support'), desc: T('Help with sign-in, codes, payments and your account.'), email: supportAddr() }];
  if (parts.contact === 'both') contacts.push({ kind: 'complaints', title: T('Complaints & Escalations'), desc: T('Formal disputes and service complaints. Every complaint is logged and acknowledged in writing.'), email: COMPLAINTS_EMAIL });
  const url = appUrl();
  const lines = parts.lines || [];
  return render({
    lang, brand: BRAND, tagline: T(TAGLINE), monogram: MONOGRAM,
    preheader: T(parts.preheader || lines[0] || parts.title),
    eyebrow: T(parts.eyebrow), tone: parts.tone, title: T(parts.title), paragraphs: lines.map(T),
    status: parts.status ? { label: T(parts.status.label), tone: parts.status.tone } : null,
    facts: (parts.facts || []).filter((f) => f && f[1] != null && f[1] !== '').map(([k, v]) => [T(k), String(v)]),
    code: parts.code, codeNote: T(parts.codeNote),
    cta: parts.cta && url ? { label: T(parts.cta), url } : null,
    note: T(parts.note), noteTone: parts.noteTone,
    signoff: parts.signoff === false ? null : { closing: T('Respectfully,'), role: T('Client Services'), org: BRAND },
    contacts, address: process.env.COMPANY_ADDRESS || '', legal: T(LEGAL), year: new Date().getFullYear()
  });
}
const layout = (lang, parts) => buildMail(lang, parts, (s) => s);

async function compose(to, lang, subject, parts) {
  const L = lang && lang !== 'en' ? lang : null;
  const dict = new Map();
  if (L) {
    const seen = new Set([subject]);
    buildMail(L, parts, (s) => { seen.add(s); return s; });
    const list = [...seen].filter(Boolean);
    const res = await translateMany(list, L, 'en');
    list.forEach((k, i) => dict.set(k, res[i].text));
  }
  const tr = (s) => (dict.has(s) ? dict.get(s) : s);
  const mail = buildMail(L || 'en', parts, tr);
  return sendRaw(to, tr(subject), mail.text, mail.html, !!parts.optional);
}

// Back-compat plain sender used by a few callers.
function sendEmail(to, subject, text) {
  const mail = layout('en', { title: subject, lines: [text] });
  return sendRaw(to, subject, mail.text, mail.html);
}

const clip = (t, n = 280) => { const x = unescapeHtml(String(t || '')).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const SECURITY_NOTE = 'Never share this code. Our team will never ask for it by email, chat or phone.';

// ---------------- Codes ----------------
function notifyVerificationCode(to, { code, lang, minutes = 10 }) {
  return compose(to, lang, 'Your verification code', {
    eyebrow: 'Security verification', title: 'Confirm your email address', tone: 'gold',
    lines: ['Welcome. To finish opening your Transaction Account, enter the verification code below on the registration screen.'],
    code, codeNote: `Valid for ${minutes} minutes`,
    note: `If you did not start this registration, no action is needed. The code will simply expire. ${SECURITY_NOTE}`, noteTone: 'warn'
  });
}
function notifyWithdrawalCode(to, { code, lang, amountText, destination, minutes = 10 }) {
  return compose(to, lang, 'Authorize your withdrawal', {
    eyebrow: 'Withdrawal authorization', title: 'Authorize your withdrawal', tone: 'warn',
    lines: ['A withdrawal was requested from your Transaction Account. To authorize it, enter the code below. Funds only move once this step is completed.'],
    facts: [['Amount', amountText], ['Destination', destination]],
    code, codeNote: `Valid for ${minutes} minutes`,
    note: 'If you did not request this withdrawal, do not enter the code. Contact us immediately so that we can secure your account. ' + SECURITY_NOTE, noteTone: 'bad', contact: 'both'
  });
}
function notifyPasswordResetCode(to, { code, groupName, lang }) {
  return compose(to, lang, 'Your password reset code', {
    eyebrow: 'Account recovery', title: 'Reset your password', tone: 'gold',
    lines: [`We received a request to reset the password of your Transaction Account on "${groupName}". Enter the code below to choose a new password.`],
    code, codeNote: 'Valid for 10 minutes',
    note: `If you did not request this, you can ignore this email. Your password stays unchanged. ${SECURITY_NOTE}`, noteTone: 'warn'
  });
}

// ---------------- Messages & reminders (buyer and seller) ----------------
function notifyOfflineMessage(to, { fromName, groupName, text, lang }) {
  return compose(to, lang, `New message in ${groupName}`, {
    eyebrow: 'New message', title: `A message awaits you in ${groupName}`, tone: 'gold',
    lines: [`${fromName} has written to you. Here is a preview:`, 'Open the conversation to read the full message and reply.'],
    note: `“${clip(text)}”`, noteTone: 'gold', cta: 'Open the conversation', optional: true
  });
}
function notifyUnreadReminder(to, { groupName, count, fromName, lang }) {
  const many = count > 1;
  return compose(to, lang, `Reminder: unread message${many ? 's' : ''} in ${groupName}`, {
    eyebrow: 'Gentle reminder', title: `You have unread message${many ? 's' : ''}`, tone: 'warn',
    lines: [`You have ${count} unread message${many ? 's' : ''} in "${groupName}"${fromName ? `, the latest from ${fromName}` : ''}.`, 'Please open the conversation to review and respond at your earliest convenience.'],
    cta: 'Open the conversation', optional: true
  });
}
function notifyTransactionSubmitted(to, { submitterName, groupName, lang }) {
  return compose(to, lang, `New transaction submitted in ${groupName}`, {
    eyebrow: 'Desk notification', title: 'A new transaction was submitted', tone: 'info',
    lines: [`${submitterName} submitted a transaction form in "${groupName}".`, 'Please review it from the Admin Transaction Board.'],
    facts: [['Submitted by', submitterName], ['Transaction', groupName]], cta: 'Open the desk'
  });
}

// ---------------- Account state ----------------
function notifySellerDisabled(to, { groupName, reason, lang }) {
  return compose(to, lang, 'Your account has been disabled', {
    eyebrow: 'Account notice', title: 'Your account has been disabled', tone: 'bad', status: { label: 'Disabled', tone: 'bad' },
    lines: [`Access to your Transaction Account for "${groupName}" has been suspended by the Desk. Your funds remain protected while this is in place.`],
    facts: [['Transaction', groupName], ['Reason', reason]],
    note: `If you believe this is a mistake, or you wish to make a formal complaint, write to ${COMPLAINTS_EMAIL} and include the email address of your account. For any other help, our support team is here.`, noteTone: 'bad', contact: 'both'
  });
}
function notifySellerEnabled(to, { groupName, lang }) {
  return compose(to, lang, 'Your account has been re-enabled', {
    eyebrow: 'Account notice', title: 'Your account is active again', tone: 'success', status: { label: 'Active', tone: 'success' },
    lines: [`Good news. Your Transaction Account for "${groupName}" has been re-enabled. You can sign in and continue where you left off.`],
    cta: 'Open your account'
  });
}
function notifyDisbursement(to, { groupName, enabled, lang }) {
  return compose(to, lang, enabled ? 'Your transaction is in the disbursement stage' : 'Disbursement paused', enabled ? {
    eyebrow: 'Transaction update', title: 'Your transaction has reached disbursement', tone: 'success', status: { label: 'Disbursement stage', tone: 'success' },
    lines: [`The transaction "${groupName}" is confirmed and has reached the disbursement stage.`, 'You may now request a withdrawal from your Transaction Account.'], cta: 'Open your account'
  } : {
    eyebrow: 'Transaction update', title: 'Disbursement is paused', tone: 'warn', status: { label: 'Paused', tone: 'warn' },
    lines: [`Withdrawals for "${groupName}" are paused because the transaction is not currently in the disbursement stage.`, 'We will notify you as soon as this changes.']
  });
}
function notifyKycStatus(to, { groupName, status, reason, lang }) {
  const c = {
    pending: { tone: 'info', label: 'Under review', title: 'Your documents are under review', lines: [`Your identity documents for "${groupName}" passed our automatic checks and are now with our compliance team. We will email you the moment a decision is made.`] },
    verified: { tone: 'success', label: 'Verified', title: 'Your identity is verified', lines: [`Your identity has been verified for "${groupName}". You can request withdrawals as soon as your transaction reaches the disbursement stage.`] },
    rejected: { tone: 'bad', label: 'Not approved', title: 'Your verification was not approved', lines: [`Your identity verification for "${groupName}" could not be approved.`, 'Please correct the issue below and submit your documents again.'], facts: [['Reason', reason]], contact: 'both' }
  }[status] || { tone: 'info', label: String(status), title: 'Identity verification update', lines: [`Your verification status is now: ${status}.`] };
  return compose(to, lang, `Identity verification update — ${groupName}`, { eyebrow: 'Identity verification', title: c.title, tone: c.tone, status: { label: c.label, tone: c.tone }, lines: c.lines, facts: c.facts, contact: c.contact, cta: 'Open your account' });
}
function notifyBusinessStatus(to, { groupName, status, reason, lang }) {
  const c = {
    pending: { tone: 'info', label: 'Under review', title: 'Your business application is under review', lines: [`We received the business account application for "${groupName}". Our compliance team is reviewing it and will email you with the outcome.`] },
    verified: { tone: 'success', label: 'Approved', title: 'Your business account is approved', lines: [`The business account for "${groupName}" is approved. The daily withdrawal limit has been lifted.`] },
    rejected: { tone: 'bad', label: 'Not approved', title: 'Your business application was not approved', lines: [`The business account application for "${groupName}" could not be approved.`], facts: [['Reason', reason]], contact: 'both' }
  }[status] || { tone: 'info', label: String(status), title: 'Business account update', lines: [`Status: ${status}.`] };
  return compose(to, lang, `Business account update — ${groupName}`, { eyebrow: 'Business account', title: c.title, tone: c.tone, status: { label: c.label, tone: c.tone }, lines: c.lines, facts: c.facts, contact: c.contact, cta: 'Open your account' });
}

// ---------------- Money ----------------
function notifyDepositStatus(to, { groupName, amount, status, reason, lang }) {
  const c = {
    verified: { tone: 'success', label: 'Confirmed', title: 'Your deposit is confirmed', lines: [`Your deposit for "${groupName}" has been confirmed and is now available in your Transaction Account.`] },
    rejected: { tone: 'bad', label: 'Not confirmed', title: 'Your deposit could not be confirmed', lines: [`We were unable to confirm your deposit for "${groupName}".`], contact: 'both' }
  }[status] || { tone: 'info', label: String(status), title: 'Deposit update', lines: [`Your deposit status is now: ${status}.`] };
  return compose(to, lang, `Deposit update — ${groupName}`, { eyebrow: 'Deposit', title: c.title, tone: c.tone, status: { label: c.label, tone: c.tone }, lines: c.lines, facts: [['Deposit', amount], ['Transaction', groupName], ['Reason', status === 'rejected' ? reason : null]], contact: c.contact, cta: 'Open your account' });
}
const WD_LABELS = { pending: 'Pending', processing: 'Processing', declined: 'Declined', completed: 'Completed' };
const WD_TONE = { pending: 'warn', processing: 'info', declined: 'bad', completed: 'success' };
const WD_LINE = {
  pending: 'Your withdrawal request has been received and your funds are held securely while it is processed.',
  processing: 'Your withdrawal is being processed. We will notify you again when it is complete.',
  declined: 'Your withdrawal could not be completed and the funds have been returned to your available balance.',
  completed: 'Your withdrawal is complete. The funds have been sent to the destination you provided.'
};
function notifyWithdrawalStatus(to, { groupName, amount, currency, status, reason, reference, lang }) {
  const label = WD_LABELS[status] || status;
  return compose(to, lang, `Withdrawal update — ${groupName}`, {
    eyebrow: 'Withdrawal', title: `Withdrawal ${String(label).toLowerCase()}`, tone: WD_TONE[status] || 'info', status: { label, tone: WD_TONE[status] || 'info' },
    lines: [WD_LINE[status] || `Your withdrawal is now: ${label}.`],
    facts: [['Amount', `${amount} ${currency || ''}`.trim()], ['Transaction', groupName], ['Payout reference', reference], ['Note', reason]],
    contact: status === 'declined' ? 'both' : 'support', cta: 'Open your account'
  });
}
function notifyIncomingFunds(to, { groupName, amountText, payerName, purpose, status, reason, accountId, lang }) {
  const c = {
    credited: { tone: 'success', label: 'Credited', title: 'Funds credited to your account', line: `Funds from ${payerName} have been received and credited to your Transaction Account for "${groupName}".` },
    in_review: { tone: 'info', label: 'Escrow review', title: 'Payment received and under escrow review', line: `A payment from ${payerName} has been received for "${groupName}" and has entered our 5-stage escrow review. The funds stay safely in the vault until the review completes.` },
    held_in_vault: { tone: 'warn', label: 'Held in vault', title: 'Payment received and held in the vault', line: `Funds from ${payerName} have been received for "${groupName}" and are held in the vault pending clearance.` },
    released: { tone: 'success', label: 'Released', title: 'Funds released to your account', line: `Funds from ${payerName} have cleared and are now available in your Transaction Account for "${groupName}".${accountId ? ` The funds were transferred to the seller account ${accountId}.` : ''}` },
    reversed: { tone: 'bad', label: 'Reversed', title: 'A payment was reversed', line: `A payment from ${payerName} on "${groupName}" has been reversed.`, contact: 'both' }
  }[status] || { tone: 'info', label: String(status), title: 'Incoming funds update', line: `Your incoming funds status is now: ${status}.` };
  return compose(to, lang, `Incoming funds update — ${groupName}`, {
    eyebrow: 'Incoming funds', title: c.title, tone: c.tone, status: { label: c.label, tone: c.tone }, lines: [c.line],
    facts: [['Amount', amountText], ['From', payerName], ['Purpose', purpose], ['Transaction', groupName], ['Account ID', accountId], ['Reason', status === 'reversed' ? reason : null]],
    contact: c.contact, cta: 'Open your account'
  });
}

module.exports = {
  sendEmail, compose, isEmailConfigured, getStatus, sendTest, providerName, checkDeliverability, verifyTransport, get SUPPORT_EMAIL() { return supportAddr(); }, COMPLAINTS_EMAIL, BRAND, layout,
  notifyVerificationCode, notifyWithdrawalCode, notifyPasswordResetCode,
  notifyOfflineMessage, notifyUnreadReminder, notifyTransactionSubmitted,
  notifySellerDisabled, notifySellerEnabled, notifyDisbursement, notifyKycStatus, notifyBusinessStatus,
  notifyDepositStatus, notifyWithdrawalStatus, notifyIncomingFunds
};
