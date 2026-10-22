// Zoho handling, From alignment, spam-hygiene headers, and the DNS deliverability checker.
require('./harness');
const Module = require('module');
const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push('ERR ' + a.join(' '));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; log(c ? '  ✓' : '  ✗ FAIL:', m); };

// A programmable nodemailer: records every connection attempt and decides the outcome per host/port.
const attempts = []; let behave = () => ({});
const orig = Module._load;
Module._load = function (r, ...rest) {
  if (r === 'nodemailer') return { createTransport: (opts) => ({ sendMail: async (msg) => { attempts.push({ opts, msg }); const b = behave(opts, msg); if (b.err) { const e = new Error(b.err.message || 'x'); Object.assign(e, b.err); throw e; } return { messageId: msg.messageId }; }, verify: async () => { const b = behave(opts, null); if (b.err) { const e = new Error(b.err.message || 'x'); Object.assign(e, b.err); throw e; } return true; } }) };
  return orig.call(this, r, ...rest);
};
const reset = () => { attempts.length = 0; ['EMAIL_SERVICE', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM', 'ZOHO_REGION', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM_STRICT'].forEach((k) => delete process.env[k]); };
(async () => {
  process.env.NODE_ENV = 'production';
  let M = require('../mailer'); const E = require('../email');
  const fresh = () => { delete require.cache[require.resolve('../mailer')]; delete require.cache[require.resolve('../email')]; M = require('../mailer'); return require('../email'); };

  // 1) Typical Zoho setup (US data centre)
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'no-reply@usvistra.com'; process.env.EMAIL_PASS = 'app-pass';
  let Em = fresh(); behave = () => ({});
  let r = await Em.notifyRegistrationCode('seller@example.com', { code: '123456', groupName: 'Deal' });
  const a0 = attempts[0];
  ok(r.ok && a0.opts.host === 'smtp.zoho.com' && a0.opts.port === 465 && a0.opts.secure === true, 'Zoho (US) connects to smtp.zoho.com:465 with SSL');
  ok(a0.msg.from.includes('<no-reply@usvistra.com>') && a0.msg.envelope.from === 'no-reply@usvistra.com', 'From defaults to the Zoho login mailbox (what Zoho requires)');
  ok(a0.msg.headers['Auto-Submitted'] === 'auto-generated' && /^<[0-9a-f-]+@usvistra\.com>$/.test(a0.msg.messageId), 'system-mail headers + Message-ID on your own domain');
  ok(a0.msg.replyTo === 'support@usvistra.com', 'replies go to Support');
  ok(a0.msg.html.includes('VISTRA') && a0.msg.html.includes('Quantum Secure Transaction Desk') && a0.msg.text.includes('Vistra Fund Solutions') && a0.msg.text.length > 200, 'HTML and plain-text parts are both sent');

  // 2) A From on another domain is replaced (Zoho would reject / spam-flag it)
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'no-reply@usvistra.com'; process.env.EMAIL_PASS = 'p'; process.env.EMAIL_FROM = '"Desk" <desk@other-domain.com>';
  Em = fresh(); await Em.notifyPasswordResetCode('s@example.com', { code: '111111', groupName: 'G' });
  ok(attempts[0].msg.from.includes('<no-reply@usvistra.com>'), 'a From on a different domain is replaced by the login mailbox');
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'no-reply@usvistra.com'; process.env.EMAIL_PASS = 'p'; process.env.EMAIL_FROM = '"Vistra Desk" <support@usvistra.com>';
  Em = fresh(); await Em.notifyPasswordResetCode('s@example.com', { code: '111111', groupName: 'G' });
  ok(attempts[0].msg.from.includes('<support@usvistra.com>') && attempts[0].msg.from.includes('Vistra Desk'), 'an alias on the SAME domain is honoured');
  // refused alias → retried once with the login address, then remembered
  attempts.length = 0; behave = (o, m) => (m && m.envelope.from === 'support@usvistra.com' ? { err: { message: '553 5.7.1 Sender is not allowed to relay emails', responseCode: 553, response: '553 5.7.1 Sender is not allowed to relay emails' } } : {});
  r = await Em.notifyPasswordResetCode('s@example.com', { code: '222222', groupName: 'G' });
  ok(r.ok && attempts.length === 2 && attempts[1].msg.envelope.from === 'no-reply@usvistra.com', 'if Zoho refuses the alias, it retries as the login mailbox and succeeds');
  behave = () => ({});

  // 3) EU account: wrong data centre first, found automatically
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'no-reply@usvistra.com'; process.env.EMAIL_PASS = 'p';
  Em = fresh(); behave = (o) => (o.host === 'smtp.zoho.eu' ? {} : { err: { code: 'EAUTH', message: '535 Authentication Failed', responseCode: 535 } });
  r = await Em.notifyRegistrationCode('s@example.com', { code: '333333', groupName: 'G' });
  ok(r.ok && attempts.map((a) => a.opts.host).join(',') === 'smtp.zoho.com,smtp.zoho.eu', 'EU/other data centre: auto-detected after the first login fails (' + attempts.map((a) => a.opts.host).join(' → ') + ')');
  attempts.length = 0; await Em.notifyRegistrationCode('s@example.com', { code: '444444', groupName: 'G' });
  ok(attempts.length === 1 && attempts[0].opts.host === 'smtp.zoho.eu', 'the working data centre is remembered');
  // explicit region
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'no-reply@usvistra.com'; process.env.EMAIL_PASS = 'p'; process.env.ZOHO_REGION = 'in';
  Em = fresh(); behave = () => ({}); await Em.notifyRegistrationCode('s@example.com', { code: '1', groupName: 'G' }); ok(attempts[0].opts.host === 'smtp.zoho.in', 'ZOHO_REGION=in uses smtp.zoho.in');

  // 4) Wrong password → plain-English reason
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'no-reply@usvistra.com'; process.env.EMAIL_PASS = 'bad'; process.env.ZOHO_REGION = 'com';
  Em = fresh(); behave = () => ({ err: { code: 'EAUTH', message: 'Invalid login: 535 Authentication Failed', responseCode: 535 } });
  r = await Em.notifyRegistrationCode('s@example.com', { code: '1', groupName: 'G' });
  ok(r.ok === false && /app-specific password/i.test(r.error) && /ZOHO_REGION/.test(r.error), 'bad Zoho password → tells you to use an app-specific password and mentions the data-centre setting');
  const v = await Em.verifyConnection(); ok(v.ok === false && /app-specific/i.test(v.error), 'Verify connection reports the same reason');
  // 5) Port blocked → advises HTTPS provider; transient failure retried once
  behave = () => ({ err: { code: 'ETIMEDOUT', message: 'Connection timeout' } }); attempts.length = 0;
  r = await Em.notifyRegistrationCode('s@example.com', { code: '1', groupName: 'G' });
  ok(r.ok === false && /blocks outgoing SMTP/i.test(r.error), 'blocked SMTP port → recommends Resend/Brevo/SendGrid');
  let n = 0; behave = () => (++n === 1 ? { err: { code: 'ECONNRESET', message: 'reset' } } : {}); attempts.length = 0; M.setRuntimeConfig(null);
  r = await Em.notifyRegistrationCode('s@example.com', { code: '1', groupName: 'G' }); ok(r.ok === true, 'one transient network failure is retried automatically');

  // 6) Deliverability checker (DNS) with a fake resolver
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'no-reply@usvistra.com'; process.env.EMAIL_PASS = 'p'; process.env.ZOHO_REGION = 'com'; Em = fresh();
  const dnsOf = (map) => ({ txt: async (name) => map[name] || [], mx: async (d) => (map['MX:' + d] || []) });
  let d = await Em.checkDeliverability(dnsOf({}));
  ok(!d.ok && d.checks.find((c) => c.name === 'SPF').status === 'fail' && /include:zoho\.com/.test(d.checks.find((c) => c.name === 'SPF').fix), 'no DNS records → SPF/DKIM/DMARC fail with the exact record to add');
  d = await Em.checkDeliverability(dnsOf({ 'usvistra.com': ['v=spf1 include:zoho.com ~all'], 'zmail._domainkey.usvistra.com': ['v=DKIM1; k=rsa; p=MIGf...'], '_dmarc.usvistra.com': ['v=DMARC1; p=quarantine; rua=mailto:dmarc@usvistra.com'], 'MX:usvistra.com': [{ exchange: 'mx.zoho.com', priority: 10 }] }));
  ok(d.ok && d.checks.every((c) => c.status === 'pass'), 'correct SPF + DKIM + DMARC + MX → all green');
  d = await Em.checkDeliverability(dnsOf({ 'usvistra.com': ['v=spf1 include:_spf.google.com ~all'], '_dmarc.usvistra.com': ['v=DMARC1; p=none'] }));
  ok(/does not authorise Zoho/.test(d.checks.find((c) => c.name === 'SPF').detail) && d.checks.find((c) => c.name === 'DMARC').status === 'warn', 'SPF that omits Zoho is caught; DMARC p=none is a warning');
  d = await Em.checkDeliverability(dnsOf({ 'usvistra.com': ['v=spf1 include:zoho.com ~all', 'v=spf1 a ~all'] })); ok(/More than one SPF/.test(d.checks.find((c) => c.name === 'SPF').detail), 'two SPF records are flagged as invalid');
  reset(); process.env.EMAIL_SERVICE = 'zoho'; process.env.EMAIL_USER = 'someone@gmail.com'; process.env.EMAIL_PASS = 'p'; Em = fresh();
  d = await Em.checkDeliverability(dnsOf({})); ok(d.checks.find((c) => c.name === 'From domain').status === 'fail', 'a gmail.com sender is flagged (cannot be authenticated)');

  // 7) Support vs Complaints stay separate
  reset(); process.env.NODE_ENV = 'development'; Em = fresh(); const TPL = require('../emailTemplate');
  const mail = await TPL.renderEmail({ subject: 's', eyebrow: 'e', title: 't', paragraphs: ['p'], dispute: true });
  ok(mail.html.includes('mailto:support@usvistra.com') && mail.html.includes('mailto:complaints@usvistra.com') && mail.html.indexOf('SUPPORT') !== -1 || /Support/.test(mail.html), 'both addresses appear, each as its own contact card');
  const sup = mail.text.split('\n').filter((l) => /support@usvistra\.com/.test(l)), com = mail.text.split('\n').filter((l) => /complaints@usvistra\.com/.test(l));
  ok(sup.length >= 1 && com.length >= 2 && !/complaints@/.test(sup.join('')), 'plain text: support line and complaints lines are separate');
  ok(/Do you disagree with this decision/.test(mail.html) && /Complaints desk/.test(mail.html), 'decision emails add a Complaints-desk callout');
  ok(mail.html.includes('Vistra Fund Solutions') && mail.html.includes('Sovereign Wealth &amp; Trust Architecture') && mail.html.includes('156 W 56th. St. 3rd Floor, New York, NY 10019') && mail.html.includes('Trading Support Coordinator'), 'Vistra brand lines, address and signature are exact');
  ok((mail.html.match(/Quantum Secure Transaction Desk/g) || []).length >= 3, 'Quantum Secure Transaction Desk appears in the service bar, signature and footer');
  console.log = log;
  log(`\nRESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log = log; log('FATAL', e); process.exit(2); });
