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
  const seller3 = io.add('1.1.1.3'); registerSocketHandlers(io, seller3);

  await admin.fire('join-room', { groupId: 'default-group', role: 'PARTY A', adminKey: 'SUPERADMIN123', sessionToken: 'admin-token' });
  await admin.fire('create-group', { groupName: 'Deal One', emailB: 's1@example.com', emailA: 'b1@example.com' });
  const g1 = admin.last('group-created-and-switch').newGroupId;
  await new Promise((r) => setTimeout(r, 15));
  await admin.fire('create-group', { groupName: 'Deal Two', emailB: 's2@example.com', emailA: 'b2@example.com' });
  const g2 = admin.last('group-created-and-switch').newGroupId;
  await new Promise((r) => setTimeout(r, 15));
  await admin.fire('create-group', { groupName: 'Deal Three', emailB: 's3@example.com', emailA: 'b3@example.com' });
  const g3 = admin.last('group-created-and-switch').newGroupId;
  await buyer.fire('join-room', { groupId: g1, role: 'BUYER', sessionToken: 'buyer-token' });
  await seller.fire('join-room', { groupId: g1, role: 'SELLER', sessionToken: 'seller-token' });
  await seller2.fire('join-room', { groupId: g2, role: 'SELLER', sessionToken: 'seller2-token' });
  await seller3.fire('join-room', { groupId: g3, role: 'SELLER', sessionToken: 'seller3-token' });

  const flat = (r, c) => Object.fromEntries(r.details[c].a.concat(r.details[c].b));
  section('1. Not approved -> no account details');
  await store.updateGroup(g1, { seller_account_id: '12345678901', seller_full_name: 'Kwame Mensah', seller_currency: 'USD', kyc_status: 'pending' });
  await seller.fire('get-receiving-details', { groupId: g1 });
  let r = seller.last('receiving-details');
  ok(r && r.approved === false && r.status === 'pending' && !r.details, 'pending seller gets approved:false and no numbers');

  section('2. Approved, but the Desk has not entered real details yet');
  await store.updateGroup(g1, { kyc_status: 'verified' });
  await seller.fire('get-receiving-details', { groupId: g1 });
  r = seller.last('receiving-details');
  ok(r.approved === true && r.ready === false && !r.details, 'seller sees "being prepared" - no invented numbers, no sample');
  ok(JSON.stringify(r).indexOf('Northvale') < 0 && JSON.stringify(r).indexOf('SAMP') < 0, 'nothing fake is ever shown by default');

  section('3. Validation uses real banking rules');
  const V = BD.validateAccount;
  { const r = V('USD', { accountNumber: '123456', routing: '123456789', swift: 'HBUKGB4B', bankName: 'HSBC Bank USA', bankAddress: '452 Fifth Avenue, New York' }); ok(r.ok && r.warnings.length === 1, 'v3.12: ABA routing with a wrong check digit is saved with a WARNING (not blocked)'); }
  ok(!V('USD', { accountNumber: '123456', routing: '12345', swift: 'HBUKGB4B', bankName: 'HSBC Bank USA', bankAddress: '452 Fifth Avenue, New York' }).ok, 'a routing number that is not 9 digits is rejected');
  { const r = V('EUR', { iban: 'DE89 3704 0044 0532 0130 01', swift: 'COBADEFF', bankName: 'Bank', bankAddress: 'Platz 1, Frankfurt' }); ok(r.ok && r.warnings.length === 1, 'v3.12: IBAN with wrong check digits is saved with a WARNING (not blocked)'); }
  ok(!V('EUR', { iban: 'DE89 3704', swift: 'COBADEFF', bankName: 'Bank', bankAddress: 'Platz 1, Frankfurt' }).ok, 'a malformed / wrong-length IBAN is rejected');
  ok(!V('GBP', { holder: 'Co Ltd', sortCode: '12-34', accountNumber: '1234567', swift: 'HBUKGB4B', bankName: 'HSBC UK', bankAddress: '8 Canada Square, London' }).ok, 'bad sort code / 7-digit UK account rejected');
  ok(!V('USD', { holder: 'Co', accountNumber: '123456', routing: '021000021', swift: 'bad', bankName: 'Bank', bankAddress: '1 Main Street, NY' }).ok, 'malformed SWIFT rejected');
  ok(V('USD', { holder: 'Co', accountNumber: '123456789', routing: '021000021', swift: 'CHASUS33', bankName: 'Test Bank', bankAddress: '1 Main Street, New York' }).ok, 'a correctly formed USD account passes');

  section('4. Privacy');
  await buyer.fire('get-receiving-details', { groupId: g1 });
  ok(!buyer.last('receiving-details'), 'buyer cannot read the seller\'s account details');
  await seller2.fire('get-receiving-details', { groupId: g1 });
  ok(!seller2.last('receiving-details'), 'another seller cannot read them either');
  await seller.fire('get-bank-profiles', {}); await seller.fire('admin-get-seller-receiving', { groupId: g1 });
  ok(!seller.last('bank-profiles') && !seller.last('admin-seller-receiving'), 'seller cannot read the Desk\'s accounts');
  await seller.fire('admin-set-bank-profiles', { profiles: { USD: { holder: 'Evil' } } }); await seller.fire('admin-set-seller-receiving', { groupId: g1, fields: {} });
  ok((await BD.getProfiles(store)).USD.configured === false && !(await BD.getOverride(store, g1)), 'seller cannot change any account details');

  section('5. The Desk enters its REAL receiving accounts');
  await admin.fire('get-bank-profiles', {});
  ok(admin.last('bank-profiles').profiles.USD.configured === false && admin.last('bank-profiles').schema.GBP.req.includes('sortCode'), 'Desk sees which currencies are not set yet');
  await admin.fire('admin-set-bank-profiles', { profiles: { USD: { holder: 'Vistra Client Account', accountNumber: '123456789', routing: '123456788', swift: 'CHASUS33', bankName: 'Test Bank', bankAddress: '1 Main Street, New York' } } });
  ok(admin.last('bank-profiles').profiles.USD.configured && !admin.last('bank-profiles').profiles.USD.fields.holder, 'v3.12: a bad check digit no longer blocks saving, and no account name is stored on the shared account');
  ok((admin.all('toast-info') || []).some((t) => /check digit/i.test(t.message || '')), 'the Desk is shown a check-digit warning');
  await admin.fire('admin-set-bank-profiles', { profiles: { USD: { accountNumber: '123456789', routing: '1234', swift: 'CHASUS33', bankName: 'Test Bank', bankAddress: '1 Main Street, New York' } } });
  ok(/routing/i.test(admin.last('error-msg') || ''), 'an invalid routing number is refused with a clear message');
  const USD = { holder: 'Vistra Client Account', accountNumber: '4821907765', routing: '021000021', swift: 'CHASUS33', bankName: 'Test Bank USA', bankAddress: '1 Main Street, New York, NY 10001' };
  const EUR = { holder: 'Vistra Client Account', iban: 'DE89 3704 0044 0532 0130 00', swift: 'COBADEFF', bankName: 'Test Bank AG', bankAddress: 'Platz 1, 60311 Frankfurt' };
  const GBP = { holder: 'Vistra Client Account', sortCode: '401276', accountNumber: '12345678', iban: 'GB82 WEST 1234 5698 7654 32', swift: 'HBUKGB4B', bankName: 'Test Bank UK', bankAddress: '8 Canada Square, London E14 5HQ' };
  await admin.fire('admin-set-bank-profiles', { profiles: { USD, EUR, GBP } });
  ok(['USD', 'EUR', 'GBP'].every((c) => admin.last('bank-profiles').profiles[c].configured), 'valid USD, EUR and GBP accounts saved');
  ok(admin.last('bank-profiles').profiles.GBP.fields.sortCode === '40-12-76', 'sort code is normalised (40-12-76)');
  await seller.fire('get-receiving-details', { groupId: g1 });
  r = seller.last('receiving-details');
  ok(r.ready === true && r.source === 'desk' && Object.keys(r.details).join() === 'USD', 'USD seller sees ONLY USD details');
  const u = flat(r, 'USD');
  ok(u['Account number'] === '4821907765' && u['ABA routing number'] === '021000021' && u['SWIFT / BIC'] === 'CHASUS33' && u['Bank name'] === 'Test Bank USA' && /New York/.test(u['Bank address']), 'USD: account, routing, SWIFT, bank and address shown');
  ok(u['Payment reference'] === '12345678901', 'the seller\'s Account ID is their payment reference');
  ok(!r.details.USD.sample && !JSON.stringify(r).includes('EUR') && !JSON.stringify(r).includes('GBP'), 'no sample label, and no other currency leaks');
  await store.updateGroup(g2, { seller_account_id: '55512345678', seller_full_name: 'Ama Boateng', seller_currency: 'EUR', kyc_status: 'verified' });
  await seller2.fire('get-receiving-details', { groupId: g2 });
  const r2 = seller2.last('receiving-details'); const e = flat(r2, 'EUR');
  ok(Object.keys(r2.details).join() === 'EUR' && e['IBAN'] === 'DE89 3704 0044 0532 0130 00' && e['SWIFT / BIC'] === 'COBADEFF' && !('Account number' in e), 'EUR seller sees ONLY EUR: IBAN + BIC (an IBAN already contains the account number)');
  await store.updateGroup(g3, { seller_account_id: '77700011122', seller_full_name: 'Jane Okoro', seller_currency: 'GBP', kyc_status: 'verified' });
  await seller3.fire('get-receiving-details', { groupId: g3 });
  const r3 = seller3.last('receiving-details'); const gb = flat(r3, 'GBP');
  ok(Object.keys(r3.details).join() === 'GBP' && gb['Sort code'] === '40-12-76' && gb['Account number'] === '12345678' && /^GB82/.test(gb['IBAN']) && gb['Payment reference'] === '77700011122', 'GBP seller sees ONLY GBP: sort code, account number, IBAN, SWIFT, reference');
  ok(seller.all('receiving-details').length >= 2, 'verified sellers are updated live when the Desk saves');

  section('6. Per-seller details typed by the Desk');
  await admin.fire('admin-get-seller-receiving', { groupId: g1 });
  let av = admin.last('admin-seller-receiving');
  ok(av.currency === 'USD' && av.globalConfigured === true && av.source === 'desk' && av.override === null, 'Desk sees where this seller\'s details come from');
  await admin.fire('admin-set-seller-receiving', { groupId: g1, fields: { ...USD, accountNumber: '99887766554', holder: 'Kwame Mensah' } });
  await seller.fire('get-receiving-details', { groupId: g1 });
  const o = flat(seller.last('receiving-details'), 'USD');
  ok(seller.last('receiving-details').source === 'seller' && o['Account number'] === '99887766554' && o['Account name'] === 'Kwame Mensah' && !('Payment reference' in o), 'the seller\'s own account details replace the global ones');
  await admin.fire('admin-set-seller-receiving', { groupId: g1, fields: { ...USD, routing: '1234' } });
  ok(/routing/i.test(admin.last('error-msg') || ''), 'per-seller details are validated too');
  await admin.fire('admin-clear-seller-receiving', { groupId: g1 });
  await seller.fire('get-receiving-details', { groupId: g1 });
  ok(seller.last('receiving-details').source === 'desk', 'clearing goes back to the global account');
  ok(seller.last('receiving-details').details.USD && !JSON.stringify(seller.last('receiving-details').details).includes('99887766554'), 'old per-seller numbers are gone');

  section('7. No demo / sample mode (removed in v3.20)');
  await store.updateGroup(g1, { seller_currency: 'USD' }); await store.setSetting('bank_profiles', '');
  process.env.ALLOW_SAMPLE_BANK_DETAILS = 'true';
  await seller.fire('get-receiving-details', { groupId: g1 });
  ok(seller.last('receiving-details').ready === false && !seller.last('receiving-details').details, 'even with the old ALLOW_SAMPLE_BANK_DETAILS=true setting, nothing sample is ever shown');
  delete process.env.ALLOW_SAMPLE_BANK_DETAILS;
  await seller.fire('get-receiving-details', { groupId: g1 });
  ok(seller.last('receiving-details').ready === false, 'sellers see "being prepared" until real details are saved');

  section('8. Support requests reach Support');
  const before = logs.length;
  await seller.fire('submit-support-request', { groupId: g1, name: 'Kwame Mensah', email: 'not-an-email', topic: 'Complaint', message: 'My payment has not arrived yet.' });
  ok(seller.last('support-request-result').ok === false && seller.last('support-request-result').field === 'email', 'invalid email is refused');
  await seller.fire('submit-support-request', { groupId: g1, name: 'Kwame', email: 'kwame@example.com', topic: 'Complaint', message: 'short' });
  ok(seller.last('support-request-result').ok === false && seller.last('support-request-result').field === 'message', 'too-short message is refused');
  await seller.fire('submit-support-request', { groupId: g1, name: 'Kwame Mensah', email: 'kwame@example.com', topic: 'Payment issue', message: 'My payment from ACME has not appeared in my account.' });
  const sr = seller.last('support-request-result');
  ok(sr.ok === true && /^SR-[0-9A-F]{8}$/.test(sr.ref), 'request accepted with a reference: ' + sr.ref);
  const mails = logs.slice(before).filter((l) => /\[email:mock\]/.test(l));
  ok(mails.some((l) => /to=support@usvistra\.com/.test(l) && l.includes(sr.ref) && /ACME/.test(l)), 'the full message is emailed to the Support inbox');
  ok(mails.some((l) => /to=kwame@example\.com/.test(l) && l.includes(sr.ref)), 'the seller gets an acknowledgement with the same reference');
  ok((admin.all('support-request-new') || []).some((t) => t.ref === sr.ref), 'the Desk dashboard is alerted live');
  await admin.fire('get-support-requests', {});
  ok(admin.last('support-requests').list[0].ref === sr.ref && admin.last('support-requests').list[0].accountId === '12345678901', 'the request is stored for the Desk with the seller\'s Account ID');
  await admin.fire('admin-resolve-support-request', { ref: sr.ref, resolved: true });
  ok(admin.last('support-requests').list[0].resolved === true, 'the Desk can mark it resolved');
  await buyer.fire('submit-support-request', { groupId: g1, name: 'x', email: 'x@example.com', topic: 'Other', message: 'I am not the seller here.' });
  ok(buyer.last('support-request-result').ok === false, 'only the seller of the account can use the Support form');
  await seller.fire('get-support-requests', {});
  ok(!seller.last('support-requests'), 'sellers cannot read the support inbox');
  for (let i = 0; i < 5; i++) await seller.fire('submit-support-request', { groupId: g1, name: 'K', email: 'kwame@example.com', topic: 'Question', message: 'Another question number ' + i + ' about my account.' });
  ok(/several requests/.test(seller.last('support-request-result').error || ''), 'flooding is rate-limited');

  section('5. Per-seller style (wallpaper)');
  await seller.fire('get-my-style', { groupId: g1 });
  ok(seller.last('my-style').style === '4', 'default style is number 4 (Summit)');
  await seller.fire('set-my-style', { groupId: g1, style: '4' });
  ok(seller.last('my-style').style === '4' && seller.last('my-style').saved, 'seller picks style 4');
  await seller.fire('set-my-style', { groupId: g1, style: '9' });
  await seller.fire('get-my-style', { groupId: g1 });
  ok(seller.last('my-style').style === '4', 'invalid style numbers are ignored');
  await seller2.fire('get-my-style', { groupId: g2 });
  ok(seller2.last('my-style').style === '4', 'each seller has their own style');
  await buyer.fire('set-my-style', { groupId: g1, style: '6' });
  await seller.fire('get-my-style', { groupId: g1 });
  ok(seller.last('my-style').style === '4', 'only the seller can change their style');

  origLog(`\nRESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { origLog('CRASH', e); process.exit(1); });
