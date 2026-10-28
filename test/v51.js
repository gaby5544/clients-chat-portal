// v3.24: admin edits seller details and deletes seller accounts.
process.env.ACCOUNT_RATE_MAX = '1000';
const { FakeIO } = require('./harness');
const origLog = console.log; console.log = (...a) => { const s = a.join(' '); if (!/\[email:mock\]|\[storage\]|\[push\]/.test(s)) origLog(...a); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; origLog('  ✓', m); } else { fail++; origLog('  ✗ FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { initStore, store } = require('../db'); await initStore(); const BD = require('../bankDetails'); const Links = require('../links');
  const { registerSocketHandlers } = require('../socketHandlers');
  const io = new FakeIO(); const admin = io.add('9.9.9.9'); registerSocketHandlers(io, admin);
  const seller = io.add('1.1.1.1'); registerSocketHandlers(io, seller);
  await admin.fire('join-room', { groupId: 'default-group', role: 'PARTY A', adminKey: 'SUPERADMIN123', sessionToken: 'admin-token' });
  await admin.fire('admin-add-seller', { fullName: 'Martin Friedrich', email: 'martin@example.com', country: 'DE', currency: 'EUR', language: 'en' });
  const added = admin.last('admin-seller-added'); ok(!!added, 'an admin-added seller exists'); const gid = added.groupId;
  await admin.fire('admin-add-seller', { fullName: 'Other Person', email: 'other@example.com', country: 'GH', currency: 'USD' }); const gid2 = admin.last('admin-seller-added').groupId;

  // ---- permissions ----
  await seller.fire('join-room', { groupId: gid, role: 'SELLER', sessionToken: 'sel-tok' });
  await seller.fire('admin-edit-seller', { groupId: gid, fullName: 'Hacker Name' }); ok((await store.getGroup(gid)).seller_full_name !== 'Hacker Name', 'a seller cannot edit accounts');
  await seller.fire('admin-delete-seller', { groupId: gid, confirm: added.accountId }); ok(!!(await store.getGroup(gid)), 'a seller cannot delete accounts');

  // ---- edit ----
  await admin.fire('admin-edit-seller', { groupId: gid, fullName: 'Martin' }); ok(/full name/i.test(String(admin.last('error-msg'))), 'a one-word name is refused');
  await admin.fire('admin-edit-seller', { groupId: gid, email: 'not-an-email' }); ok(/valid email/i.test(String(admin.last('error-msg'))), 'a bad email is refused');
  await admin.fire('admin-edit-seller', { groupId: gid, email: 'other@example.com' }); ok(/already uses/i.test(String(admin.last('error-msg'))), 'an email used by another account is refused');
  await admin.fire('admin-edit-seller', { groupId: gid, registeredAt: new Date(Date.now() + 5 * 864e5).toISOString() }); ok(/future/i.test(String(admin.last('error-msg'))), 'a registration date in the future is refused');
  await admin.fire('admin-edit-seller', { groupId: gid, dateOfBirth: '2015-01-01' }); ok(/18 and 120/.test(String(admin.last('error-msg'))), 'a date of birth under 18 is refused');
  await admin.fire('admin-edit-seller', { groupId: gid, phone: '+1555' }); ok(/starts with \+49/.test(String(admin.last('error-msg'))), 'a phone code that does not match the country is refused');
  await admin.fire('admin-edit-seller', { groupId: gid }); ok(/Nothing was changed/.test(String(admin.last('error-msg'))), 'saving with no change says so');
  const when = '2026-03-14T09:30:00.000Z';
  await admin.fire('admin-edit-seller', { groupId: gid, fullName: 'Martin Friedrich-Weber', email: 'Martin.FW@Example.com', country: 'AT', phone: '+43 664 1234567', dateOfBirth: '1988-05-17', registeredAt: when, language: 'de' });
  let g = await store.getGroup(gid);
  ok(g.seller_full_name === 'Martin Friedrich-Weber' && g.custom_name_b === 'Martin Friedrich-Weber', 'name updated everywhere it is used');
  ok(g.email_b === 'martin.fw@example.com' && g.reg_email_target === 'martin.fw@example.com', 'email updated (lower-cased)');
  ok(g.seller_country === 'Austria' && g.seller_country_iso === 'AT', 'country updated');
  ok(/^\+43/.test(g.seller_phone), 'phone validated against the new country and stored as +43…: ' + g.seller_phone);
  ok(String(g.seller_date_of_birth).slice(0, 10) === '1988-05-17', 'date of birth saved');
  ok(new Date(g.seller_registered_at).toISOString() === when, 'registration date saved exactly');
  ok(g.seller_language === 'de', 'language saved');
  ok(/Martin Friedrich-Weber/.test(g.name), 'the group name that was "<name> — Account" follows the new name');
  const log = Links.flagsOf(g).profileEdits; ok(log && log.length === 1 && log[0].changes.fullName && log[0].changes.registeredAt && log[0].role, 'the edit is recorded with date, role and before/after');
  ok(admin.last('seller-edited') && admin.last('seller-profile').account.fullName === 'Martin Friedrich-Weber', 'the admin screens get the new details');
  ok(g.seller_account_id === added.accountId, 'the Account ID is untouched');
  // clearing phone
  await admin.fire('admin-edit-seller', { groupId: gid, phone: '' }); ok((await store.getGroup(gid)).seller_phone === null, 'phone can be cleared');
  // currency: allowed with no money, refused with money
  await admin.fire('admin-edit-seller', { groupId: gid, currency: 'GBP' }); ok((await store.getGroup(gid)).seller_currency === 'GBP', 'currency can change while the account has no money');
  await store.adjustBalances(gid, { available: 50, total: 50 });
  await admin.fire('admin-edit-seller', { groupId: gid, currency: 'USD' }); ok(/cannot be changed/.test(String(admin.last('error-msg'))) && (await store.getGroup(gid)).seller_currency === 'GBP', 'currency is locked once there is money');

  // ---- delete ----
  await admin.fire('admin-delete-seller', { groupId: gid, confirm: '123' }); ok(/Account ID exactly/.test(String(admin.last('error-msg'))) && !!(await store.getGroup(gid)), 'wrong confirmation: nothing deleted');
  await admin.fire('admin-delete-seller', { groupId: gid, confirm: added.accountId }); ok(/still holds/.test(String(admin.last('error-msg'))) && !!(await store.getGroup(gid)), 'an account holding money needs the extra acknowledgement');
  await admin.fire('admin-delete-seller', { groupId: gid, confirm: added.accountId, acknowledgeFunds: true });
  ok(!(await store.getGroup(gid)), 'the account is gone from the database');
  ok(!(await store.findGroupsBySellerEmail('martin.fw@example.com')).length, 'its email is free to use again');
  ok(!!admin.last('seller-account-deleted') && admin.last('seller-account-deleted').groupId === gid, 'the admin screen is told to remove the card');
  const st = JSON.parse(await store.getSetting('deleted_accounts', '[]')); ok(st.length === 1 && st[0].accountId === added.accountId && st[0].balances.available === 50 && st[0].role, 'a deletion record (who, when, what it held) is kept');
  const lk = await Links.linkState(gid, 'SELLER').catch(() => null); ok(!lk || lk.valid === false, 'the seller\'s old link no longer works');
  ok(!!(await store.getGroup(gid2)), 'other sellers are untouched');
  await admin.fire('admin-delete-seller', { groupId: gid, confirm: added.accountId }); ok(/not found/.test(String(admin.last('error-msg'))), 'deleting twice is handled politely');
  await admin.fire('admin-list-sellers'); ok(!admin.last('sellers-list').some((r) => r.groupId === gid) && admin.last('sellers-list').some((r) => r.groupId === gid2), 'the sellers list no longer shows the deleted account');
  // a seller whose room was deleted earlier (account kept) can still be deleted
  await admin.fire('delete-group', { groupId: gid2 }); let g2 = await store.getGroup(gid2); ok(g2 && Links.flagsOf(g2).roomDeleted, 'deleting a group alone keeps the account (as before)');
  await admin.fire('admin-delete-seller', { groupId: gid2, confirm: g2.seller_account_id }); ok(!(await store.getGroup(gid2)), '…and the account can now be deleted from the admin list');
  origLog(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { origLog('CRASH', e); process.exit(1); });
