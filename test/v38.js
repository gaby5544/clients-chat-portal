// v3.8+ server checks: receiving account details after approval, admin bank profile, per-seller style.
process.env.ACCOUNT_RATE_MAX = '1000';
const { FakeIO } = require('./harness');
const logs = []; const origLog = console.log;
console.log = (...a) => { const s = a.join(' '); logs.push(s); if (!/\[email:mock\]|\[storage\]|\[push\]/.test(s)) origLog(...a); };
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; origLog('  ✓', msg); } else { fail++; origLog('  ✗ FAIL:', msg); } };
const section = (s) => origLog('\n' + s);
const mod97 = (iban) => { const r = (iban.replace(/\s/g, '').slice(4) + iban.replace(/\s/g, '').slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55)); let rem = 0; for (const ch of r) rem = (rem * 10 + Number(ch)) % 97; return rem; };

(async () => {
  const { initStore, store } = require('../db'); await initStore();
  const { registerSocketHandlers } = require('../socketHandlers');
  const BD = require('../bankDetails');
  const io = new FakeIO();
  const admin = io.add('9.9.9.9'); registerSocketHandlers(io, admin);
  const buyer = io.add('2.2.2.2'); registerSocketHandlers(io, buyer);
  const seller = io.add('1.1.1.1'); registerSocketHandlers(io, seller);
  const seller2 = io.add('1.1.1.2'); registerSocketHandlers(io, seller2);

  await admin.fire('join-room', { groupId: 'default-group', role: 'PARTY A', adminKey: 'SUPERADMIN123', sessionToken: 'admin-token' });
  await admin.fire('create-group', { groupName: 'Deal One', emailB: 's1@example.com', emailA: 'b1@example.com' });
  const g1 = admin.last('group-created-and-switch').newGroupId;
  await admin.fire('create-group', { groupName: 'Deal Two', emailB: 's2@example.com', emailA: 'b2@example.com' });
  const g2 = admin.last('group-created-and-switch').newGroupId;
  await buyer.fire('join-room', { groupId: g1, role: 'BUYER', sessionToken: 'buyer-token' });
  await seller.fire('join-room', { groupId: g1, role: 'SELLER', sessionToken: 'seller-token' });
  await seller2.fire('join-room', { groupId: g2, role: 'SELLER', sessionToken: 'seller2-token' });

  section('1. Not approved -> no account details');
  await store.updateGroup(g1, { seller_account_id: '12345678901', seller_full_name: 'Kwame Mensah', seller_currency: 'USD', kyc_status: 'pending' });
  await seller.fire('get-receiving-details', { groupId: g1 });
  let r = seller.last('receiving-details');
  ok(r && r.approved === false && r.status === 'pending' && !r.details, 'pending seller gets approved:false and no numbers');
  await store.updateGroup(g1, { kyc_status: 'not_submitted' }); await seller.fire('get-receiving-details', { groupId: g1 });
  ok(seller.last('receiving-details').approved === false, 'not-submitted seller gets nothing');

  section('2. Approved -> every detail is issued');
  await store.updateGroup(g1, { kyc_status: 'verified' });
  await seller.fire('get-receiving-details', { groupId: g1 });
  r = seller.last('receiving-details');
  ok(r.approved === true && r.holder === 'Kwame Mensah' && ['USD', 'EUR', 'GBP'].every((c) => r.details[c]), 'approved seller receives USD, EUR and GBP details');
  const flat = (c) => Object.fromEntries(r.details[c].a.concat(r.details[c].b));
  ok(flat('USD')['Account name'] === 'Kwame Mensah' && /^[1-9]\d{9}$/.test(flat('USD')['Account number']) && /^\d{9}$/.test(flat('USD')['ABA routing number']), 'USD: holder, 10-digit account number, 9-digit routing');
  ok(mod97(flat('EUR')['IBAN']) === 1 && /^DE\d{2} /.test(flat('EUR')['IBAN']), 'EUR: IBAN has valid ISO 13616 check digits: ' + flat('EUR')['IBAN']);
  ok(mod97(flat('GBP')['IBAN']) === 1 && /^\d{8}$/.test(flat('GBP')['Account number']) && flat('GBP')['Sort code'], 'GBP: valid IBAN, 8-digit account, sort code');
  ok(flat('USD')['SWIFT / BIC'] && flat('USD')['Bank name'] && flat('USD')['Bank address'], 'every currency carries SWIFT, bank name and bank address');
  ok(r.details.USD.sample === true, 'sample profile is flagged until the Desk saves real bank details');
  const first = JSON.stringify(r.details);
  await seller.fire('get-receiving-details', { groupId: g1 });
  ok(JSON.stringify(seller.last('receiving-details').details) === first, 'details are stable between requests');

  section('3. Privacy');
  await buyer.fire('get-receiving-details', { groupId: g1 });
  ok(!buyer.last('receiving-details'), 'buyer cannot read the seller\'s account details');
  await seller2.fire('get-receiving-details', { groupId: g1 });
  ok(!seller2.last('receiving-details'), 'another seller cannot read them either');
  await seller.fire('get-bank-profiles', {});
  ok(!seller.last('bank-profiles'), 'seller cannot read or edit the bank profile');
  await seller.fire('admin-set-bank-profiles', { profiles: { USD: { bankName: 'Evil' } } });
  ok((await BD.getProfiles(store)).USD.sample === true, 'seller cannot change the bank profile');

  section('4. Desk edits the bank profile');
  await admin.fire('get-bank-profiles', {});
  ok(admin.last('bank-profiles').profiles.USD.swift === 'NVLBUS33', 'Desk can read the profile');
  await admin.fire('admin-set-bank-profiles', { profiles: { USD: { swift: 'bad' } } });
  ok(/valid format/.test(admin.last('error-msg') || ''), 'invalid SWIFT is rejected with a clear message');
  await admin.fire('admin-set-bank-profiles', { profiles: { USD: { bankName: 'Harbor Trust Bank', bankAddress: '1 Pine St, New York, NY', swift: 'HTBKUS33', routing: '021000089' },
    EUR: { bankName: 'Harbor Trust Europe', bankAddress: 'Platz 2, Frankfurt', swift: 'HTBKDEFF', bankCode: '10010010' },
    GBP: { bankName: 'Harbor Trust UK', bankAddress: '2 Row, London', swift: 'HTBKGB2L', sortCode: '20-30-40', ibanBank: 'HTBK' } } });
  ok(!!admin.last('bank-profiles') && admin.last('bank-profiles').profiles.USD.sample === false, 'valid profile saved and no longer "sample"');
  await seller.fire('get-receiving-details', { groupId: g1 });
  ok(JSON.stringify(seller.last('receiving-details').details) === first, 'an already-approved seller keeps the details first issued');
  await store.updateGroup(g2, { seller_account_id: '55512345678', seller_full_name: 'Ama Boateng', seller_currency: 'GBP', kyc_status: 'verified' });
  await seller2.fire('get-receiving-details', { groupId: g2 });
  const r2 = seller2.last('receiving-details'); const f2 = Object.fromEntries(r2.details.GBP.a.concat(r2.details.GBP.b));
  ok(f2['Bank name'] === 'Harbor Trust UK' && f2['Sort code'] === '20-30-40' && mod97(f2['IBAN']) === 1 && r2.details.GBP.sample === false, 'a newly approved seller is issued under the new bank profile (valid IBAN)');
  ok(f2['IBAN'] !== flat('GBP')['IBAN'] && f2['Account number'] !== flat('GBP')['Account number'], 'two sellers never share an account number');
  await admin.fire('admin-reissue-receiving-details', { groupId: g1 });
  await seller.fire('get-receiving-details', { groupId: g1 });
  ok(Object.fromEntries(seller.last('receiving-details').details.USD.b)['Bank name'] === 'Harbor Trust Bank', 'Desk can re-issue a seller under the current bank profile');

  section('5. Per-seller style (wallpaper)');
  await seller.fire('get-my-style', { groupId: g1 });
  ok(seller.last('my-style').style === '1', 'default style is number 1');
  await seller.fire('set-my-style', { groupId: g1, style: '4' });
  ok(seller.last('my-style').style === '4' && seller.last('my-style').saved, 'seller picks style 4');
  await seller.fire('set-my-style', { groupId: g1, style: '9' });
  await seller.fire('get-my-style', { groupId: g1 });
  ok(seller.last('my-style').style === '4', 'invalid style numbers are ignored');
  await seller2.fire('get-my-style', { groupId: g2 });
  ok(seller2.last('my-style').style === '1', 'each seller has their own style');
  await buyer.fire('set-my-style', { groupId: g1, style: '6' });
  await seller.fire('get-my-style', { groupId: g1 });
  ok(seller.last('my-style').style === '4', 'only the seller can change their style');

  origLog(`\nRESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { origLog('CRASH', e); process.exit(1); });
