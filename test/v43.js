// v3.15 server checks: fingerprint unlock (WebAuthn): registration, signature verification, replay / tamper / clone defences, PIN interplay.
process.env.ACCOUNT_RATE_MAX = '1000';
const { FakeIO } = require('./harness');
const crypto = require('crypto');
const origLog = console.log; console.log = (...a) => { const s = a.join(' '); if (!/\[email:mock\]|\[storage\]|\[push\]/.test(s)) origLog(...a); };
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; origLog('  ✓', msg); } else { fail++; origLog('  ✗ FAIL:', msg); } };
const section = (s) => origLog('\n' + s);
const W = require('../webauthn'); const PIN = require('../pinLock');
const ORIGIN = 'https://portal.example.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest();

(async () => {
  const { initStore, store } = require('../db'); await initStore();
  const { registerSocketHandlers } = require('../socketHandlers'); const { hashPassword } = require('../security');
  const io = new FakeIO();
  const admin = io.add('9.9.9.9'); registerSocketHandlers(io, admin);
  const seller = io.add('1.1.1.1'); registerSocketHandlers(io, seller); seller.handshake.headers.origin = ORIGIN;
  const other = io.add('1.1.1.2'); registerSocketHandlers(io, other); other.handshake.headers.origin = ORIGIN;
  await admin.fire('join-room', { groupId: 'default-group', role: 'PARTY A', adminKey: 'SUPERADMIN123', sessionToken: 'admin-token' });
  await admin.fire('create-group', { groupName: 'Deal One', emailB: 'one@example.com' }); const g1 = admin.last('group-created-and-switch').newGroupId; await sleep(15);
  await admin.fire('create-group', { groupName: 'Deal Two', emailB: 'two@example.com' }); const g2 = admin.last('group-created-and-switch').newGroupId;
  await seller.fire('join-room', { groupId: g1, role: 'SELLER', sessionToken: 's1' }); await other.fire('join-room', { groupId: g2, role: 'SELLER', sessionToken: 's2' });
  const base = { seller_registered: true, seller_currency: 'USD', kyc_status: 'verified', seller_phone: '+233244123456', seller_password_hash: hashPassword('Passw0rd!x') };
  await store.updateGroup(g1, { ...base, seller_account_id: '11100022233', seller_full_name: 'Kwame Mensah', email_b: 'one@example.com', seller_session_token: 's1' });
  await store.updateGroup(g2, { ...base, seller_account_id: '22200033344', seller_full_name: 'Ama Boateng', email_b: 'two@example.com', seller_session_token: 's2' });

  // a pretend phone: an ES256 key pair that "signs" after the owner's fingerprint
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }); const credId = W.b64u(crypto.randomBytes(32));
  const cd = (type, challenge, origin = ORIGIN) => W.b64u(Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })));
  const authData = (counter, flags = 0x05, rp = 'portal.example.com') => { const b = Buffer.alloc(37); sha(Buffer.from(rp)).copy(b, 0); b[32] = flags; b.writeUInt32BE(counter, 33); return b; };
  const sign = (ad, cdB64, key = privateKey) => W.b64u(crypto.sign('sha256', Buffer.concat([ad, sha(W.fromB64u(cdB64))]), key));
  const assertion = async (o) => { const { counter = 1, flags = 0x05, challenge, origin, rp, key, cid = credId, tamper } = o; const c = cd('webauthn.get', challenge, origin); const ad = authData(counter, flags, rp); const sig = sign(ad, c, key); return { groupId: g1, credentialId: cid, authenticatorData: W.b64u(ad), clientDataJSON: tamper ? cd('webauthn.get', challenge, origin) + 'A' : c, signature: sig }; };
  const lastOpts = (s, ev) => s.last(ev);

  section('1. Fingerprint needs the PIN first');
  await seller.fire('bio-reg-options', { groupId: g1 });
  ok(seller.last('bio-result').ok === false && /PIN first/.test(seller.last('bio-result').error) && !seller.all('bio-reg-options').length, 'no PIN: fingerprint setup is refused');
  await seller.fire('set-my-pin', { groupId: g1, pin: '482916', password: 'Passw0rd!x' });
  PIN._reset(); await seller.fire('bio-reg-options', { groupId: g1 });
  ok(seller.last('pin-required').action === 'bio' && !seller.all('bio-reg-options').length, 'a PIN exists but was not entered in this session: it is asked for');
  await seller.fire('unlock-pin', { groupId: g1, pin: '482916' });

  section('2. Turning it on (registration)');
  await seller.fire('bio-reg-options', { groupId: g1 });
  const ro = seller.last('bio-reg-options');
  ok(ro && ro.rpId === 'portal.example.com' && /^[A-Za-z0-9_-]{43}$/.test(ro.challenge) && ro.exclude.length === 0, 'the server issues a challenge for the app\'s own domain');
  const reg = (o = {}) => ({ groupId: g1, credentialId: credId, publicKey: W.b64u(spki), clientDataJSON: cd('webauthn.create', ro.challenge), label: 'Android phone', ...o });
  await seller.fire('bio-register', reg({ clientDataJSON: cd('webauthn.create', 'wrong-challenge') }));
  ok(seller.last('bio-result').ok === false, 'a wrong challenge is refused');
  await seller.fire('bio-register', reg());
  ok(seller.last('bio-result').ok === false, 'a challenge can only be used once');
  await seller.fire('bio-reg-options', { groupId: g1 }); const ro2 = seller.last('bio-reg-options');
  await seller.fire('bio-register', reg({ clientDataJSON: cd('webauthn.create', ro2.challenge, 'https://evil.example.net') }));
  ok(seller.last('bio-result').ok === false && /Vistra app/.test(seller.last('bio-result').error), 'a request from another website is refused');
  await seller.fire('bio-reg-options', { groupId: g1 }); const ro3 = seller.last('bio-reg-options');
  await seller.fire('bio-register', reg({ clientDataJSON: cd('webauthn.create', ro3.challenge), publicKey: W.b64u(Buffer.from('not a key')) }));
  ok(seller.last('bio-result').ok === false, 'garbage instead of a key is refused');
  await seller.fire('bio-reg-options', { groupId: g1 }); const ro4 = seller.last('bio-reg-options');
  await seller.fire('bio-register', reg({ clientDataJSON: cd('webauthn.create', ro4.challenge) }));
  ok(seller.last('bio-result').ok === true && seller.last('bio-result').kind === 'enabled', 'a good registration is accepted');
  ok(seller.last('my-bio').devices.length === 1 && seller.last('my-bio').devices[0].label === 'Android phone' && !JSON.stringify(seller.last('my-bio')).includes(W.b64u(spki)), 'the app is told which phones, never the key');
  const gflags = (g) => (typeof g.group_flags === 'string' ? JSON.parse(g.group_flags) : g.group_flags);
  ok(gflags(await store.getGroup(g1)).bioCreds[0].pub === W.b64u(spki) && !JSON.stringify(await seller.last('seller-account-state') || {}).includes('bioCreds'), 'only the PUBLIC key is stored, and it is not sent in account state');

  section('3. Unlocking with the fingerprint');
  PIN._reset();
  await seller.fire('bio-auth-options', { groupId: g1 }); const ao = seller.last('bio-auth-options');
  ok(ao && ao.ids[0] === credId && ao.rpId === 'portal.example.com', 'the server offers a challenge for the enrolled phone');
  await seller.fire('bio-auth', await assertion({ challenge: ao.challenge, counter: 1, key: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }));
  ok(seller.last('bio-result').ok === false && !PIN.isUnlocked('s1', await store.getGroup(g1)), 'a signature from another key is refused (still locked)');
  const tryAuth = async (o) => { await seller.fire('bio-auth-options', { groupId: g1 }); const x = seller.last('bio-auth-options'); await seller.fire('bio-auth', await assertion({ challenge: x.challenge, ...o })); return seller.last('bio-result'); };
  ok((await tryAuth({ counter: 1, flags: 0x01 })).ok === false, 'without user verification (no fingerprint check) it is refused');
  ok((await tryAuth({ counter: 1, rp: 'evil.example.net' })).ok === false, 'a response made for another domain is refused');
  ok((await tryAuth({ counter: 1, origin: 'https://evil.example.net' })).ok === false, 'a response from another origin is refused');
  ok((await tryAuth({ counter: 1, tamper: true })).ok === false, 'tampered data is refused');
  await seller.fire('bio-auth', await assertion({ challenge: 'stale', counter: 1 })); ok(seller.last('bio-result').ok === false, 'a made-up challenge is refused');
  ok(!PIN.isUnlocked('s1', await store.getGroup(g1)), 'after all those attempts the account is still locked');
  await seller.fire('bio-auth-options', { groupId: g1 }); const good = seller.last('bio-auth-options');
  const okAssert = await assertion({ challenge: good.challenge, counter: 5 });
  await seller.fire('bio-auth', okAssert);
  ok(seller.last('pin-result').ok === true && seller.last('pin-result').via === 'fingerprint' && PIN.isUnlocked('s1', await store.getGroup(g1)), 'the real fingerprint signature unlocks the account (same as the PIN)');
  await seller.fire('bio-auth', okAssert); ok(seller.last('bio-result').ok === false, 'the same response cannot be replayed');
  ok((await tryAuth({ counter: 5 })).ok === false && /cloned/.test(seller.last('bio-result').error), 'a counter that does not go up is refused (cloned key)');
  PIN._reset(); ok((await tryAuth({ counter: 6 })) && PIN.isUnlocked('s1', await store.getGroup(g1)), 'a higher counter works again');
  ok(gflags(await store.getGroup(g1)).bioCreds[0].counter === 6, 'the counter is remembered');
  await other.fire('bio-auth-options', { groupId: g1 }); ok(!other.all('bio-auth-options').length, 'another seller cannot ask for challenges on this account');

  section('4. Turning it off');
  await seller.fire('bio-remove', { groupId: g1, id: credId, password: 'nope' }); ok(seller.last('bio-result').ok === false && seller.last('my-bio').devices.length === 1, 'turning it off needs the account password');
  await seller.fire('bio-remove', { groupId: g1, id: credId, password: 'Passw0rd!x' }); ok(seller.last('bio-result').ok === true && seller.last('my-bio').devices.length === 0, 'with the password it is removed');
  await seller.fire('bio-auth-options', { groupId: g1 }); ok(seller.last('bio-result').none === true, 'then no fingerprint challenges are issued');
  // removing the PIN also removes fingerprint keys
  PIN._reset(); await seller.fire('unlock-pin', { groupId: g1, pin: '482916' });
  await seller.fire('bio-reg-options', { groupId: g1 }); const r5 = seller.last('bio-reg-options');
  await seller.fire('bio-register', { groupId: g1, credentialId: credId, publicKey: W.b64u(spki), clientDataJSON: cd('webauthn.create', r5.challenge), label: 'Android phone' });
  ok(seller.last('bio-result').ok === true, 'it can be turned on again');
  await seller.fire('remove-my-pin', { groupId: g1, password: 'Passw0rd!x' });
  ok(!gflags(await store.getGroup(g1)).bioCreds, 'removing the PIN also removes the fingerprint keys (they only exist on top of a PIN)');

  origLog(`\nRESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { origLog('TEST CRASH', e.stack); process.exit(1); });
