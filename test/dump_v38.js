// Fixtures for the v3.8 browser test: a verified seller + a not-yet-verified seller, with the exact events the real server sends.
process.env.ACCOUNT_RATE_MAX = '1000';
const { FakeIO } = require('./harness'); const fs = require('fs');
const origLog = console.log; console.log = () => {};
(async () => {
  const { initStore, store } = require('../db'); await initStore();
  const { registerSocketHandlers } = require('../socketHandlers'); const io = new FakeIO();
  const admin = io.add('9.9.9.9'); registerSocketHandlers(io, admin);
  const seller = io.add('1.1.1.1'); registerSocketHandlers(io, seller);
  await admin.fire('join-room', { groupId: 'default-group', role: 'PARTY A', adminKey: 'SUPERADMIN123', sessionToken: 'admin-token' });
  await admin.fire('create-group', { groupName: 'Deal One', emailB: 's1@example.com', emailA: 'b1@example.com' });
  const gid = admin.last('group-created-and-switch').newGroupId;
  await seller.fire('join-room', { groupId: gid, role: 'SELLER', sessionToken: 'seller-token' });
  const base = { seller_registered: true, seller_account_id: '48213907765', seller_full_name: 'Kwame Mensah', seller_currency: 'USD', seller_email: 's1@example.com', seller_country: 'Ghana', balance_available: 24580 };
  await store.updateGroup(gid, { ...base, kyc_status: 'not_submitted' });
  await seller.fire('get-my-seller-account', { groupId: gid }); const unverified = seller.last('seller-account-state');
  await seller.fire('get-receiving-details', { groupId: gid }); const lockedDetails = seller.last('receiving-details');
  await store.updateGroup(gid, { kyc_status: 'verified' });
  await seller.fire('get-my-seller-account', { groupId: gid }); const verified = seller.last('seller-account-state');
  await seller.fire('get-receiving-details', { groupId: gid }); const details = seller.last('receiving-details');
  const sInit = seller.last('init-state');
  const out = { gid, init: sInit, unverified, verified, lockedDetails, details };
  fs.writeFileSync('/tmp/fixtures_v38.json', JSON.stringify(out)); origLog('fixtures_v38 written', !!unverified, !!verified, !!details && details.approved); process.exit(0);
})().catch((e) => { origLog('FATAL', e); process.exit(1); });
