// Verifies what the Android app produces (BioCryptoTest output) with the server's real WebAuthn code.
const WA = require('../../webauthn.js'); const { execSync } = require('child_process');
const out = execSync('rm -rf /tmp/biot && mkdir -p /tmp/biot && javac -d /tmp/biot src/com/vistra/desk/BioCrypto.java test/BioCryptoTest.java 2>&1 && java -cp /tmp/biot com.vistra.desk.BioCryptoTest 2>/tmp/biot/log', { cwd: __dirname + '/..', encoding: 'utf8' });
process.stdout.write(require('fs').readFileSync('/tmp/biot/log', 'utf8'));
const j = JSON.parse(out.trim().split('\n').pop()); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const reg = WA.verifyRegistration({ credentialId: j.id, publicKey: j.pub, clientDataJSON: j.regCd }, { challenge: j.regCh, origin: j.origin });
ok(reg.ok && reg.cred.kty === 'ec', 'server accepts the app\'s registration (P-256 public key, create ceremony)');
const a = { credentialId: j.id, authenticatorData: j.ad, clientDataJSON: j.authCd, signature: j.sig };
const r = WA.verifyAssertion(a, reg.cred, { challenge: j.authCh, origin: j.origin });
ok(r.ok && r.counter === 1790000000, 'server accepts the app\'s fingerprint answer (signature, flags, rp hash, counter)');
ok(!WA.verifyAssertion(a, { ...reg.cred, counter: r.counter }, { challenge: j.authCh, origin: j.origin }).ok, 'replaying the same answer is refused (counter)');
ok(!WA.verifyAssertion(a, reg.cred, { challenge: 'other', origin: j.origin }).ok, 'wrong challenge is refused');
ok(!WA.verifyAssertion(a, reg.cred, { challenge: j.authCh, origin: 'https://evil.example.com' }).ok, 'wrong website is refused');
const bad = Buffer.from(j.sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); bad[bad.length - 3] ^= 1;
ok(!WA.verifyAssertion({ ...a, signature: WA.b64u(bad) }, reg.cred, { challenge: j.authCh, origin: j.origin }).ok, 'a tampered signature is refused');
console.log(`RESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
