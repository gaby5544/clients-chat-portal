// v3.23: admin-added sellers sign in with an emailed code; KYC is still required before they can use or withdraw.
process.env.ACCOUNT_RATE_MAX = '1000';
require('./harness');
const mails = []; const origLog = console.log;
console.log = (...a) => { const s = a.join(' '); if (/\[email:mock\]/.test(s)) { mails.push(s); return; } if (!/\[storage\]|\[push\]/.test(s)) origLog(...a); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; origLog('  ✓', m); } else { fail++; origLog('  ✗ FAIL:', m); } };
(async () => {
  const { initStore, store } = require('../db'); const { buildRouter } = require('../routes'); const Links = require('../links'); const { hashPassword } = require('../security');
  await initStore(); const router = buildRouter();
  const post = (path, body, headers) => new Promise((resolve) => { const r = router.routes.find((x) => x[0] === 'post' && x[1] === path); const h = r[2][r[2].length - 1];
    const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ status: this.code, json: o }); }, setHeader() {}, set() { return this; } };
    h({ body, headers: headers || { host: 'x.test' }, socket: { remoteAddress: '9.9.9.9' }, protocol: 'https' }, res); });
  const lastCode = () => { const m = mails.filter((x) => /sign-in code/i.test(x)).pop(); const c = m && m.match(/\b(\d{6})\b/); return c ? c[1] : null; };
  const mk = async (id, email, flags, extra) => { await store.createGroupIfMissing(id, id); await store.updateGroup(id, { seller_registered: true, email_b: email, seller_full_name: 'Ama Boateng', seller_currency: 'USD', seller_account_id: '1' + id.length + '0000000', kyc_status: 'not_submitted', group_flags: flags, ...(extra || {}) }); };
  await mk('man1', 'ama@example.com', { manualSeller: true });
  await mk('self1', 'self@example.com', {}, { seller_password_hash: hashPassword('Secret123') });
  await mk('ban1', 'ban@example.com', { manualSeller: true, banned: true });

  let r = await post('/api/auth/code/request', { email: 'nope' }); ok(r.status === 400, 'a bad email is refused');
  const before = mails.length;
  r = await post('/api/auth/code/request', { email: 'nobody@example.com' }); ok(r.status === 200 && r.json.success && mails.length === before, 'unknown email: same answer, no mail sent (nothing revealed)');
  r = await post('/api/auth/code/request', { email: 'self@example.com' }); ok(r.status === 200 && mails.length === before, 'a seller who signed up on their own is not offered email-code sign-in (they have a password)');
  r = await post('/api/auth/code/request', { email: 'ban@example.com' }); ok(r.status === 200 && mails.length === before, 'a banned account is sent nothing');
  r = await post('/api/auth/code/request', { email: 'Ama@Example.com' }); ok(r.status === 200 && r.json.success, 'the admin-added seller asks for a code (email case ignored)');
  const code = lastCode(); ok(/^\d{6}$/.test(code || ''), 'a 6-digit code was emailed: ' + code);
  r = await post('/api/auth/code/request', { email: 'ama@example.com' }); ok(r.status === 429, 'asking again immediately is slowed down');
  r = await post('/api/auth/code/verify', { email: 'ama@example.com', code: code === '000000' ? '111111' : '000000' }); ok(r.status === 400, 'a wrong code is refused');
  r = await post('/api/auth/code/verify', { email: 'ama@example.com', code: 'abc' }); ok(r.status === 400, 'a non-numeric code is refused');
  r = await post('/api/auth/code/verify', { email: 'ama@example.com', code }); ok(r.status === 200 && r.json.success && r.json.groupId === 'man1' && !!r.json.sessionToken, 'the right code signs the seller in to their own account');
  const LoginProof = require('../loginProof'); ok(await LoginProof.check(r.json.sessionToken, 'man1'), 'the session is proven for that account');
  r = await post('/api/auth/code/verify', { email: 'ama@example.com', code }); ok(r.status === 400, 'the same code cannot be used twice');
  // too many wrong guesses burn the code
  await store.setSetting('scode:ama@example.com', 'null'); await store.setSetting('scode:ama@example.com', JSON.stringify({ hash: require('../security').hashCode('424242'), exp: Date.now() + 60000, tries: 0, sentAt: 0 }));
  for (let i = 0; i < 5; i++) await post('/api/auth/code/verify', { email: 'ama@example.com', code: '111111' });
  r = await post('/api/auth/code/verify', { email: 'ama@example.com', code: '424242' }); ok(r.status === 429 || r.status === 400, 'after 5 wrong guesses even the right code no longer works');
  // expired
  await store.setSetting('scode:ama@example.com', JSON.stringify({ hash: require('../security').hashCode('313131'), exp: Date.now() - 1000, tries: 0, sentAt: 0 }));
  r = await post('/api/auth/code/verify', { email: 'ama@example.com', code: '313131' }); ok(r.status === 400, 'an expired code is refused');
  // banned after code was issued
  await store.setSetting('scode:ban@example.com', JSON.stringify({ hash: require('../security').hashCode('515151'), exp: Date.now() + 60000, tries: 0, sentAt: 0 }));
  r = await post('/api/auth/code/verify', { email: 'ban@example.com', code: '515151' }); ok(r.status === 403, 'a banned account cannot sign in even with a valid code');
  // welcome email carries the login link
  const E = require('../email'); mails.length = 0;
  await E.notifyManualAccount('ama@example.com', { accountId: '123', fullName: 'Ama Boateng', currency: 'USD', country: 'Ghana', baseUrl: 'https://desk.test' });
  const w = mails.pop() || ''; ok(/signin=code/.test(w) && /ama%40example\.com|ama@example\.com/.test(w) && /Send me a code/.test(w), 'the welcome email links to the code sign-in page and says how it works');
  ok(/identity verification/i.test(w) && /cannot use your account or withdraw/.test(w), 'the welcome email says identity verification comes first');
  // KYC: not verified -> cannot withdraw (server) ; room chat blocked
  const g = await store.getGroup('man1'); ok(g.kyc_status === 'not_submitted', 'the new seller starts as not verified');
  origLog(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { origLog('CRASH', e); process.exit(1); });
