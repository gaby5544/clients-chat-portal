// Mail transport: delivery, Zoho handling, inbox-placement hygiene and diagnostics.
//
// Providers (first match wins; environment variables beat dashboard settings):
//   RESEND_API_KEY | BREVO_API_KEY | SENDGRID_API_KEY        (HTTPS — work on any host)
//   EMAIL_SERVICE=zoho + EMAIL_USER + EMAIL_PASS             (Zoho Mail over SMTP)
//   EMAIL_SERVICE=<other> + EMAIL_USER + EMAIL_PASS | SMTP_HOST/PORT/USER/PASS
// Optional: EMAIL_FROM, ZOHO_REGION (com|eu|in|com.au|jp|ca|sa|com.cn), EMAIL_HOST, EMAIL_PORT,
//           BRAND_NAME, SUPPORT_EMAIL, REPLY_TO, DKIM_SELECTOR, EMAIL_FROM_STRICT=true
//
// Nothing here can GUARANTEE inbox placement — that depends on the sending domain's DNS
// (SPF, DKIM, DMARC) — but everything the application controls is done correctly, and
// checkDeliverability() tells you exactly which DNS records are missing.

const nodemailer = require('nodemailer');
const crypto = require('crypto');
const dns = require('dns').promises;

const BRAND = process.env.EMAIL_FROM_NAME || process.env.BRAND_NAME || 'Vistra Quantum Secure Transaction Desk';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@usvistra.com';   // Reply-To: replies reach Support. Complaints have their own address (COMPLAINTS_EMAIL).

// ---- Zoho data centres ------------------------------------------------------
const ZOHO = {
  'com':    { smtp: 'smtp.zoho.com',    spf: 'zoho.com' },
  'eu':     { smtp: 'smtp.zoho.eu',     spf: 'zoho.eu' },
  'in':     { smtp: 'smtp.zoho.in',     spf: 'zoho.in' },
  'com.au': { smtp: 'smtp.zoho.com.au', spf: 'zoho.com.au' },
  'jp':     { smtp: 'smtp.zoho.jp',     spf: 'zoho.jp' },
  'ca':     { smtp: 'smtp.zohocloud.ca', spf: 'zohocloud.ca' },
  'sa':     { smtp: 'smtp.zoho.sa',     spf: 'zoho.sa' },
  'com.cn': { smtp: 'smtp.zoho.com.cn', spf: 'zoho.com.cn' }
};
const ZOHO_ORDER = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa', 'com.cn'];
const zohoRegionOfHost = (h) => ZOHO_ORDER.find((r) => ZOHO[r].smtp === String(h || '').toLowerCase()) || null;

let runtimeConfig = null;
let working = null;                     // last host/port that worked: { key, host, port, secure }
let fromFallback = new Set();           // configs whose custom From was refused → use the login address

function envConfig() {
  const from = process.env.EMAIL_FROM;
  if (process.env.RESEND_API_KEY) return { provider: 'resend', apiKey: process.env.RESEND_API_KEY, from, source: 'env' };
  if (process.env.BREVO_API_KEY) return { provider: 'brevo', apiKey: process.env.BREVO_API_KEY, from, source: 'env' };
  if (process.env.SENDGRID_API_KEY) return { provider: 'sendgrid', apiKey: process.env.SENDGRID_API_KEY, from, source: 'env' };
  const svc = process.env.EMAIL_SERVICE;
  if (svc && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    if (/zoho/i.test(svc)) return { provider: 'smtp', from, source: 'env', smtp: { zoho: true, region: (process.env.ZOHO_REGION || '').toLowerCase() || null, host: process.env.EMAIL_HOST || null, port: Number(process.env.EMAIL_PORT) || null, user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } };
    return { provider: 'smtp', from, source: 'env', smtp: { service: svc, user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } };
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const host = process.env.SMTP_HOST; const zregion = zohoRegionOfHost(host);
    return { provider: 'smtp', from, source: 'env', smtp: { zoho: !!zregion || /zoho/i.test(host), region: process.env.ZOHO_REGION ? process.env.ZOHO_REGION.toLowerCase() : zregion, host, port: Number(process.env.SMTP_PORT) || null, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } };
  }
  return null;
}
function activeConfig() {
  const e = envConfig(); if (e) return e;
  if (runtimeConfig && runtimeConfig.provider) {
    const c = { ...runtimeConfig, source: 'dashboard' };
    if (c.smtp && (/zoho/i.test(c.smtp.service || '') || /zoho/i.test(c.smtp.host || ''))) c.smtp = { ...c.smtp, zoho: true, region: c.smtp.region || zohoRegionOfHost(c.smtp.host) };
    return c;
  }
  return null;
}
function setRuntimeConfig(cfg) { runtimeConfig = cfg && cfg.provider ? cfg : null; working = null; fromFallback = new Set(); }
const isEmailConfigured = () => !!activeConfig();

// ---- From address -------------------------------------------------------------
function parseFrom(from) {
  const s = String(from || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m[2].trim())) return { name: m[1].trim() || BRAND, email: m[2].trim() };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { name: BRAND, email: s };
  return null;
}
const configKey = (cfg) => `${cfg.provider}|${cfg.smtp ? cfg.smtp.user : cfg.apiKey ? String(cfg.apiKey).slice(-6) : ''}`;

function resolveFrom(cfg, useLogin = false) {
  const login = cfg.smtp && /@/.test(cfg.smtp.user || '') ? cfg.smtp.user : null;
  let f = parseFrom(cfg.from);
  if (cfg.provider === 'resend' && !f) f = { name: BRAND, email: 'onboarding@resend.dev' };
  if (cfg.provider === 'smtp') {
    if (!f && login) f = { name: BRAND, email: login };
    // Zoho only accepts the mailbox you log in with (or an alias you added). A From on another
    // domain is rejected or lands in spam — so use the login address unless told not to.
    const strict = String(process.env.EMAIL_FROM_STRICT || '').toLowerCase() === 'true';
    if (f && login && !strict && (useLogin || fromFallback.has(configKey(cfg))) && f.email.toLowerCase() !== login.toLowerCase()) f = { name: f.name, email: login };
    if (f && login && cfg.smtp.zoho && !strict && f.email.split('@')[1] && login.split('@')[1] && f.email.split('@')[1].toLowerCase() !== login.split('@')[1].toLowerCase()) f = { name: f.name, email: login };
  }
  return f;
}

function emailStatus() {
  const cfg = activeConfig();
  if (!cfg) return { configured: false, provider: null, source: null, from: null, mode: 'not configured — verification codes cannot be delivered' };
  const f = resolveFrom(cfg);
  const warnings = [];
  if (!f) warnings.push('No valid From address — set EMAIL_FROM.');
  else if (/\.example$|^no-reply@transactionaccount/i.test(f.email)) warnings.push('The From address uses a placeholder domain — mail will be rejected or marked as spam.');
  return { configured: true, provider: cfg.provider === 'smtp' && cfg.smtp && cfg.smtp.zoho ? 'zoho' : cfg.provider, source: cfg.source, from: f ? `${f.name} <${f.email}>` : null, region: cfg.smtp && cfg.smtp.zoho ? (cfg.smtp.region || 'auto-detect') : null, warnings, mode: `${cfg.provider}${cfg.smtp && cfg.smtp.zoho ? ' (Zoho)' : ''} (${cfg.source})` };
}

// ---- Error explanations -----------------------------------------------------
function explainError(err, cfg) {
  const msg = String((err && (err.response || err.message)) || err || 'Unknown error');
  const code = err && (err.code || err.responseCode);
  const zoho = cfg && cfg.smtp && cfg.smtp.zoho;
  if (code === 'EAUTH' || /\b535\b|authentication (failed|credentials)|invalid login/i.test(msg)) {
    return zoho ? 'Zoho refused the login. Use the full mailbox address as EMAIL_USER and an APP-SPECIFIC password as EMAIL_PASS (Zoho → My Account → Security → App Passwords; required when two-factor is on). If your account is on a non-US Zoho data centre, set ZOHO_REGION to eu, in, com.au, jp, ca, sa or com.cn.' : 'The mail server refused the username/password.';
  }
  if (/\b55[0-4]\b/.test(msg) && /(sender|from|relay|alias|not allowed|permission|mailbox)/i.test(msg)) return 'The mail server refused the From address. The From address must be the mailbox you log in with (or an alias added to that mailbox in Zoho).';
  if (/\b554\b/.test(msg) && /(spam|reputation|blocked|policy)/i.test(msg)) return 'The server rejected the message as spam/policy. Check the sending domain’s SPF/DKIM/DMARC records (use “Check deliverability”).';
  if (/\b45[0-2]\b|daily|limit|quota|too many/i.test(msg)) return 'The provider’s sending limit was hit. Wait and retry, or upgrade the plan.';
  if (cfg && cfg.provider !== 'smtp' && (code === 'ENOTFOUND' || /ENOTFOUND|ECONN|ETIMEDOUT|fetch failed|aborted/i.test(msg))) return `Could not reach ${cfg.provider} (${msg.slice(0, 120)}). Check that this server can reach the internet.`;
  if (['ETIMEDOUT', 'ECONNREFUSED', 'ESOCKET', 'ECONNECTION', 'ECONNRESET'].includes(code) || /timed? ?out|ECONN/i.test(msg)) return 'Could not reach the mail server — your hosting provider probably blocks outgoing SMTP. Use an HTTPS provider (Resend, Brevo or SendGrid) instead.';
  if (code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) return 'The mail server host name could not be found. Check the host name for typos.';
  return msg.slice(0, 220);
}

// ---- Message construction ---------------------------------------------------
function domainOf(addr) { return String(addr || '').split('@')[1] || 'localhost'; }
function buildMessage({ to, subject, text, html }, from) {
  const id = crypto.randomUUID();
  const replyTo = process.env.REPLY_TO || SUPPORT_EMAIL;
  return {
    from: `"${String(from.name).replace(/"/g, '')}" <${from.email}>`,
    to, subject, text, html,
    replyTo,
    messageId: `<${id}@${domainOf(from.email)}>`,
    envelope: { from: from.email, to },                          // return-path = From → SPF alignment
    headers: {
      'Auto-Submitted': 'auto-generated',                        // marks it as a system message, not mass mail
      'X-Auto-Response-Suppress': 'OOF, AutoReply',
      'X-Entity-Ref-ID': id
    }
  };
}

// ---- HTTPS providers --------------------------------------------------------
async function http(method, url, headers, body) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const raw = await res.text(); let data = null; try { data = JSON.parse(raw); } catch (e) { /* not JSON */ }
    if (!res.ok) { const m = (data && (data.message || data.error || (data.errors && data.errors[0] && data.errors[0].message) || data.code)) || raw.slice(0, 200) || ('HTTP ' + res.status); throw new Error(`${res.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`); }
    return data;
  } finally { clearTimeout(timer); }
}
async function viaHttp(cfg, m, from) {
  const extra = { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'OOF, AutoReply' };
  const replyTo = process.env.REPLY_TO || SUPPORT_EMAIL;
  if (cfg.provider === 'resend') return http('POST', 'https://api.resend.com/emails', { Authorization: 'Bearer ' + cfg.apiKey }, { from: `${from.name} <${from.email}>`, to: [m.to], subject: m.subject, text: m.text, html: m.html, reply_to: replyTo, headers: extra });
  if (cfg.provider === 'brevo') return http('POST', 'https://api.brevo.com/v3/smtp/email', { 'api-key': cfg.apiKey }, { sender: { name: from.name, email: from.email }, to: [{ email: m.to }], subject: m.subject, textContent: m.text, htmlContent: m.html, replyTo: { email: replyTo }, headers: extra });
  if (cfg.provider === 'sendgrid') return http('POST', 'https://api.sendgrid.com/v3/mail/send', { Authorization: 'Bearer ' + cfg.apiKey }, { personalizations: [{ to: [{ email: m.to }] }], from: { email: from.email, name: from.name }, reply_to: { email: replyTo }, subject: m.subject, content: [{ type: 'text/plain', value: m.text }].concat(m.html ? [{ type: 'text/html', value: m.html }] : []), headers: extra });
  throw new Error('Unknown email provider: ' + cfg.provider);
}

// ---- SMTP (with Zoho region / port discovery) -------------------------------
function smtpAttempts(cfg) {
  const s = cfg.smtp;
  if (s.service && !s.zoho) return [{ service: s.service }];
  const list = [];
  const push = (host, port) => { if (!list.some((a) => a.host === host && a.port === port)) list.push({ host, port, secure: port === 465 }); };
  if (working && working.key === configKey(cfg)) push(working.host, working.port);
  if (s.zoho) {
    const hosts = s.host ? [s.host] : s.region && ZOHO[s.region] ? [ZOHO[s.region].smtp] : ZOHO_ORDER.map((r) => ZOHO[r].smtp);
    const ports = s.port ? [s.port] : [465, 587];
    hosts.forEach((h, i) => ports.forEach((p) => { if (i === 0 || p === ports[0]) push(h, p); }));
  } else {
    push(s.host, s.port || 587);
    if (!s.port) push(s.host, 465);
  }
  return list;
}
function transportFor(cfg, a) {
  const common = { auth: { user: cfg.smtp.user, pass: cfg.smtp.pass }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 20000 };
  return a.service ? nodemailer.createTransport({ service: a.service, auth: common.auth })
    : nodemailer.createTransport({ host: a.host, port: a.port, secure: a.secure, requireTLS: !a.secure, ...common });
}
const isNetworkErr = (e) => ['ETIMEDOUT', 'ECONNREFUSED', 'ESOCKET', 'ECONNECTION', 'ECONNRESET', 'ENOTFOUND'].includes(e && e.code);
async function viaSmtp(cfg, m, from) {
  const attempts = smtpAttempts(cfg); let last; const triedHosts = new Set(); const authFailed = new Set();
  for (const a of attempts) {
    if (a.host && (triedHosts.has(a.host + ':net') || authFailed.has(a.host))) continue;                    // port blocked on this host → try its other port only
    try {
      const info = await transportFor(cfg, a).sendMail(buildMessage(m, from));
      if (a.host) working = { key: configKey(cfg), host: a.host, port: a.port };
      return info;
    } catch (err) {
      last = err;
      if (isNetworkErr(err) && a.host) { triedHosts.add(a.host + ':net'); if (attempts.filter((x) => x.host === a.host).length <= 1) break; continue; }
      if (err.code === 'EAUTH' && cfg.smtp.zoho && !cfg.smtp.region && !cfg.smtp.host) { authFailed.add(a.host); continue; }   // wrong data centre → try the next one
      throw err;
    }
  }
  throw last || new Error('No SMTP server could be reached.');
}

async function deliverOnce(cfg, m, useLogin) {
  const from = resolveFrom(cfg, useLogin);
  if (!from) throw new Error('No valid "From" address is set. Set EMAIL_FROM to an address such as "Desk <no-reply@yourdomain.com>".');
  return cfg.provider === 'smtp' ? viaSmtp(cfg, m, from) : viaHttp(cfg, m, from);
}

/** Never throws. Resolves { ok, provider, error, hint? }. `m` = { to, subject, text, html } */
async function send(m) {
  if (!m || !m.to) return { ok: false, error: 'No recipient address.' };
  const cfg = activeConfig();
  if (!cfg) return { ok: false, error: 'not_configured' };
  const attempt = async () => {
    try { await deliverOnce(cfg, m, false); return null; }
    catch (err) {
      // A custom From the server refuses → retry once with the login mailbox and remember it.
      if (cfg.provider === 'smtp' && /\b55[0-4]\b/.test(String(err.response || err.message)) && /(sender|from|relay|alias|not allowed|permission)/i.test(String(err.response || err.message)) && !fromFallback.has(configKey(cfg))) {
        fromFallback.add(configKey(cfg));
        try { await deliverOnce(cfg, m, true); return null; } catch (e2) { return e2; }
      }
      return err;
    }
  };
  let err = await attempt();
  if (err && (isNetworkErr(err) || /\b4\d\d\b/.test(String(err.responseCode || ''))) && err.code !== 'ENOTFOUND') { await new Promise((r) => setTimeout(r, 1500)); err = await attempt(); }   // one retry for transient problems
  if (!err) return { ok: true, provider: cfg.provider === 'smtp' && cfg.smtp.zoho ? 'zoho' : cfg.provider };
  const hint = explainError(err, cfg);
  console.error('[email] send failed:', String(err.message || err).slice(0, 200), '→', hint);
  return { ok: false, error: hint, raw: String(err.message || err).slice(0, 300) };
}

// ---- Diagnostics ------------------------------------------------------------
async function verifyConnection() {
  const cfg = activeConfig(); if (!cfg) return { ok: false, error: 'No email provider is configured.' };
  try {
    if (cfg.provider === 'smtp') {
      let last; const authFailed = new Set();
      for (const a of smtpAttempts(cfg)) {
        if (a.host && authFailed.has(a.host)) continue;
        try { await transportFor(cfg, a).verify(); if (a.host) working = { key: configKey(cfg), host: a.host, port: a.port }; return { ok: true, detail: a.host ? `Connected and logged in to ${a.host}:${a.port}.` : 'Connected and logged in.', host: a.host || null }; }
        catch (e) { last = e; if (isNetworkErr(e) && a.host) continue; if (e.code === 'EAUTH' && cfg.smtp.zoho && !cfg.smtp.region && !cfg.smtp.host) { authFailed.add(a.host); continue; } break; }
      }
      return { ok: false, error: explainError(last, cfg) };
    }
    if (cfg.provider === 'resend') { const d = await http('GET', 'https://api.resend.com/domains', { Authorization: 'Bearer ' + cfg.apiKey }); return { ok: true, detail: `API key accepted. Verified domains: ${((d && d.data) || []).filter((x) => x.status === 'verified').map((x) => x.name).join(', ') || 'none yet'}.` }; }
    if (cfg.provider === 'brevo') { await http('GET', 'https://api.brevo.com/v3/account', { 'api-key': cfg.apiKey }); return { ok: true, detail: 'API key accepted.' }; }
    if (cfg.provider === 'sendgrid') { await http('GET', 'https://api.sendgrid.com/v3/scopes', { Authorization: 'Bearer ' + cfg.apiKey }); return { ok: true, detail: 'API key accepted.' }; }
  } catch (err) { return { ok: false, error: explainError(err, cfg) }; }
  return { ok: false, error: 'Unknown provider.' };
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|aol|proton|protonmail|zohomail|zoho|mail|gmx)\./i;
async function txt(name) { try { return (await dns.resolveTxt(name)).map((a) => a.join('')); } catch (e) { return []; } }

/** DNS checks for the From domain: SPF, DKIM, DMARC (+ MX). Never throws. */
async function checkDeliverability(resolver = { txt, mx: async (d) => { try { return await dns.resolveMx(d); } catch (e) { return []; } } }) {
  const cfg = activeConfig(); const checks = [];
  const add = (name, status, detail, fix) => checks.push({ name, status, detail, fix: fix || null });
  if (!cfg) return { ok: false, domain: null, checks: [{ name: 'Email provider', status: 'fail', detail: 'No email provider is configured.', fix: 'Set EMAIL_SERVICE/EMAIL_USER/EMAIL_PASS (Zoho) or save a provider in Email delivery.' }] };
  const f = resolveFrom(cfg); const domain = f ? domainOf(f.email).toLowerCase() : null;
  const zoho = !!(cfg.smtp && cfg.smtp.zoho); const region = (cfg.smtp && cfg.smtp.region) || (working && zohoRegionOfHost(working.host)) || 'com';
  if (!domain) { add('From address', 'fail', 'No valid From address.', 'Set EMAIL_FROM to an address on your own domain.'); return { ok: false, domain: null, checks }; }
  if (/\.example$|\.invalid$|\.local$/i.test(domain)) add('From domain', 'fail', `${domain} is a placeholder domain.`, 'Use an address on a domain you own, e.g. no-reply@yourdomain.com.');
  else if (FREE_MAIL.test(domain)) add('From domain', 'fail', `${domain} is a public mail domain — receivers cannot authenticate it for you.`, 'Send from an address on your own domain (add the domain in Zoho Mail → Admin Console → Domains).');
  else add('From domain', 'pass', `${domain}`);
  if (zoho && cfg.smtp.user && f.email.toLowerCase() !== String(cfg.smtp.user).toLowerCase()) add('From = login', 'warn', `Sending as ${f.email} but logging in as ${cfg.smtp.user}.`, 'Zoho only accepts the login mailbox or an alias added to it. Make EMAIL_FROM the same mailbox.');
  // SPF
  const txts = await resolver.txt(domain); const spf = txts.filter((t) => /^v=spf1/i.test(t));
  const spfInc = ZOHO[region] ? ZOHO[region].spf : 'zoho.com';
  const wantSpf = `v=spf1 include:${spfInc} ~all`;
  if (!spf.length) add('SPF', 'fail', 'No SPF record found.', `Add a TXT record on ${domain}: ${wantSpf}`);
  else if (spf.length > 1) add('SPF', 'fail', 'More than one SPF record — receivers treat this as an error.', `Merge them into one TXT record, e.g. ${wantSpf}`);
  else if (zoho && !/include:[a-z0-9.-]*zoho/i.test(spf[0])) add('SPF', 'fail', `SPF exists but does not authorise Zoho: ${spf[0]}`, `Add include:${spfInc} to it, e.g. ${wantSpf}`);
  else if (/\+all\b/i.test(spf[0])) add('SPF', 'fail', 'SPF ends with +all, which authorises everyone.', 'Change +all to ~all (or -all).');
  else add('SPF', /[-~]all\b/i.test(spf[0]) ? 'pass' : 'warn', spf[0], /[-~]all\b/i.test(spf[0]) ? null : 'End the record with ~all or -all.');
  // DKIM
  const selectors = [process.env.DKIM_SELECTOR, 'zmail', 'zoho', 'zohomail', 'default', 'mail', 's1', 'selector1'].filter(Boolean);
  let dkimFound = null;
  for (const sel of selectors) { const r = await resolver.txt(`${sel}._domainkey.${domain}`); if (r.some((t) => /v=DKIM1|k=rsa|p=/i.test(t))) { dkimFound = sel; break; } }
  if (dkimFound) add('DKIM', 'pass', `Public key found at ${dkimFound}._domainkey.${domain}`);
  else add('DKIM', 'fail', 'No DKIM key found (checked common selectors).', 'In Zoho Mail → Admin Console → Domains → your domain → DKIM, add a selector, copy the TXT record it shows into your DNS, then click Verify. If you used a custom selector, set DKIM_SELECTOR.');
  // DMARC
  const dm = (await resolver.txt(`_dmarc.${domain}`)).filter((t) => /^v=DMARC1/i.test(t));
  if (!dm.length) add('DMARC', 'fail', 'No DMARC record found.', `Add a TXT record on _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:${f.email}   (tighten to p=quarantine once SPF and DKIM pass)`);
  else add('DMARC', /p=none/i.test(dm[0]) ? 'warn' : 'pass', dm[0], /p=none/i.test(dm[0]) ? 'Works, but p=quarantine gives receivers more confidence once SPF and DKIM pass.' : null);
  // MX (a domain that can receive mail looks more legitimate)
  const mx = await resolver.mx(domain);
  add('MX (can receive replies)', mx.length ? 'pass' : 'warn', mx.length ? mx.map((x) => x.exchange).join(', ') : 'No MX record.', mx.length ? null : 'Add the MX records Zoho shows for your domain so replies and bounces are delivered.');
  const ok = checks.every((c) => c.status !== 'fail');
  return { ok, domain, provider: zoho ? 'zoho' : cfg.provider, region: zoho ? region : null, checks };
}

module.exports = { BRAND, SUPPORT_EMAIL, setRuntimeConfig, activeConfig, isEmailConfigured, emailStatus, send, verifyConnection, checkDeliverability, explainError, resolveFrom, buildMessage, _internals: { smtpAttempts, ZOHO } };
