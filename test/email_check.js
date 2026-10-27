require('./harness');
const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push('ERR ' + a.join(' '));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; log(c ? '  ✓' : '  ✗ FAIL:', m); };
(async () => {
  const E = require('../email');
  // 1) production + nothing configured → fails loudly (never pretends it sent)
  process.env.NODE_ENV = 'production';
  let r = await E.sendEmail('a@b.com', 's', 't'); ok(r.ok === false && r.error === 'not_configured', 'production, no provider → reports failure instead of silently "sending"');
  ok(E.emailStatus().configured === false, 'status says not configured');
  // 2) dev mode logs and succeeds
  process.env.NODE_ENV = 'development'; r = await E.sendEmail('a@b.com', 's', 't'); ok(r.ok && r.provider === 'mock', 'development: mock send ok');
  process.env.NODE_ENV = 'production';
  // 3) Resend over HTTPS
  const calls = []; global.fetch = async (url, opts) => { calls.push([url, opts]); return { ok: true, status: 200, text: async () => '{"id":"1"}' }; };
  E.setRuntimeConfig({ provider: 'resend', apiKey: 're_123', from: 'Desk <no-reply@example.com>' });
  r = await E.sendEmail('seller@example.com', 'Code', 'Your code is 123456');
  const body = JSON.parse(calls[0][1].body);
  ok(r.ok && calls[0][0] === 'https://api.resend.com/emails' && calls[0][1].headers.Authorization === 'Bearer re_123' && body.to[0] === 'seller@example.com' && body.from === 'Desk <no-reply@example.com>', 'Resend request is correct');
  E.setRuntimeConfig({ provider: 'brevo', apiKey: 'xkey', from: 'no-reply@example.com' });
  r = await E.sendEmail('s@example.com', 'Code', 'x'); const bb = JSON.parse(calls[1][1].body);
  ok(r.ok && calls[1][1].headers['api-key'] === 'xkey' && bb.sender.email === 'no-reply@example.com' && bb.to[0].email === 's@example.com', 'Brevo request is correct');
  E.setRuntimeConfig({ provider: 'sendgrid', apiKey: 'SG.x', from: '"Desk" <no-reply@example.com>' });
  r = await E.sendEmail('s@example.com', 'Code', 'x'); const sg = JSON.parse(calls[2][1].body);
  ok(r.ok && sg.from.email === 'no-reply@example.com' && sg.personalizations[0].to[0].email === 's@example.com', 'SendGrid request is correct');
  // 4) provider rejects → real error text comes back
  global.fetch = async () => ({ ok: false, status: 403, text: async () => '{"message":"The example.com domain is not verified."}' });
  E.setRuntimeConfig({ provider: 'resend', apiKey: 're_bad', from: 'Desk <no-reply@example.com>' });
  r = await E.sendEmail('s@example.com', 'Code', 'x'); ok(r.ok === false && /not verified/.test(r.error), 'provider error is surfaced: ' + r.error);
  // 5) network failure
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND api.resend.com'); };
  r = await E.sendEmail('s@example.com', 'Code', 'x'); ok(r.ok === false && /Could not reach resend/.test(r.error), 'network failure is reported: ' + r.error.slice(0, 70));
  // 6) missing From
  E.setRuntimeConfig({ provider: 'brevo', apiKey: 'k' }); r = await E.sendEmail('s@example.com', 'Code', 'x'); ok(r.ok === false && /From/.test(r.error), 'missing From address gives a clear message');
  // 7) env beats dashboard
  process.env.RESEND_API_KEY = 're_env'; ok(E.emailStatus().source === 'env', 'environment variables take priority over dashboard settings'); delete process.env.RESEND_API_KEY;
  log(`\nRESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
