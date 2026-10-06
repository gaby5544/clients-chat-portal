// Runs the REAL server logic and dumps the exact events each browser would receive, as fixtures for the UI test.
process.env.ACCOUNT_RATE_MAX = '1000';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { FakeIO } = require('./harness');
const logs = []; const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };
const code = (re) => { for (let i = logs.length - 1; i >= 0; i--) { const m = logs[i].match(re); if (m) return m[1]; } return null; };
function img(name, w, h, size) { const b = crypto.randomBytes(size); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); fs.writeFileSync(path.join(__dirname, '..', 'uploads', name), b); return '/uploads/' + name; }
(async () => {
  const { initStore, store } = require('../db'); await initStore();
  const { registerSocketHandlers } = require('../socketHandlers'); const tracking = require('../tracking');
  const io = new FakeIO(); const out = {};
  const admin = io.add('9.9.9.9'); registerSocketHandlers(io, admin);
  const seller = io.add('1.1.1.1'); registerSocketHandlers(io, seller);
  const buyer = io.add('2.2.2.2'); registerSocketHandlers(io, buyer);
  let mark = 0; const cut = (name) => { out[name] = seller.emitted.slice(mark); mark = seller.emitted.length; };
  await admin.fire('join-room', { groupId: 'default-group', role: 'PARTY A', adminKey: 'SUPERADMIN123', sessionToken: 'admin-token' });
  await admin.fire('create-group', { groupName: 'Gold Deal', emailB: 'seller@example.com', emailA: 'buyer@example.com' });
  const gid = admin.last('group-created-and-switch').newGroupId; out.gid = gid;
  await buyer.fire('join-room', { groupId: gid, role: 'BUYER', sessionToken: 'buyer-token' });
  await seller.fire('join-room', { groupId: gid, role: 'SELLER', sessionToken: 'seller-token', lang: 'fr' });
  cut('s1_join');
  await seller.fire('request-registration-email-code', { groupId: gid, email: 'seller@example.com' }); cut('s2_codesent');
  const c = code(/>>> (\d{6}) <<</); out.regCode = c;
  await seller.fire('verify-registration-email', { groupId: gid, email: 'seller@example.com', code: c }); cut('s3_verified');
  await seller.fire('register-transaction-account', { groupId: gid, fullName: 'Kwame Mensah', password: 'Sup3rSecret!', currency: 'USD', dateOfBirth: '1990-05-04', country: 'Ghana', phoneDial: '233', phoneNumber: '0244123456', language: 'fr', acceptTerms: true, accountType: 'standard', email: 'seller@example.com' });
  cut('s4_registered');
  await store.updateGroup(gid, { kyc_status: 'verified' });
  await admin.fire('admin-record-incoming-funds', { groupId: gid, payerName: 'ACME Corp', purpose: 'Invoice 42', method: 'bank_transfer', amount: 2000000, amountCurrency: 'USD', feeAmount: 500, treatment: 'track', totalSeconds: 86400, bankName: 'Barclays', senderAccount: 'GB29NWBK60161331926819', internalNote: 'Wire verified', shareNoteWithBuyer: true });
  const inc = (await store.getIncomingFundsForGroup(gid))[0];
  await admin.fire('admin-tracking-set', { id: inc.id, speed: 3600, timers: [6000, 6000, 6000, 6000, 6000] });
  const eng = tracking.startTrackingEngine(io, 1e6);
  for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 1300)); await eng.tick(); }
  eng.stop();
  const cur = await store.getIncomingFundsById(inc.id); out.trackStageAtDump = cur.track_stage;
  cut('s5_tracking');
  await admin.fire('admin-get-seller-ledger', { groupId: gid }); out.adminLedgerTracking = admin.last('funds-desk-ledger');
  // finish tracking → funds available
  await admin.fire('admin-tracking-skip', { id: inc.id }); await admin.fire('admin-tracking-skip', { id: inc.id }); await admin.fire('admin-tracking-skip', { id: inc.id });
  for (let i = 0; i < 6; i++) { const r = await store.getIncomingFundsById(inc.id); if (r.status === 'credited') break; await admin.fire('admin-tracking-skip', { id: inc.id }); }
  cut('s6_credited');
  await seller.fire('request-withdrawal', { groupId: gid, method: 'bank', amount: 100, beneficiaryName: 'K Mensah', bankName: 'GCB', bankAccount: '1234567890', bankCountry: 'Ghana' }); cut('s7_blocked');
  await admin.fire('admin-set-disbursement', { groupId: gid, enabled: true });
  await seller.fire('request-withdrawal', { groupId: gid, method: 'bank', amount: 100, beneficiaryName: 'K Mensah', bankName: 'GCB', bankAccount: '1234567890', bankCountry: 'Ghana' }); cut('s8_codesent');
  const wc = code(/>>> (\d{6}) <<</); out.wdCode = wc;
  await seller.fire('confirm-withdrawal', { groupId: gid, code: wc }); cut('s9_withdrawn');
  const w = (await store.getWithdrawalsForGroup(gid))[0];
  await admin.fire('admin-advance-withdrawal', { withdrawalId: w.id, toStatus: 'processing' }); cut('s10_processing');
  await admin.fire('admin-get-seller-ledger', { groupId: gid }); out.adminLedgerFinal = admin.last('funds-desk-ledger');
  await admin.fire('admin-set-seller-disabled', { groupId: gid, disabled: true, reason: 'Compliance review' }); cut('s11_disabled');
  await admin.fire('admin-get-seller-profile', { groupId: gid }); out.adminProfile = admin.last('seller-profile');
  await admin.fire('admin-get-funds-overview', {}); out.fundsOverview = admin.last('funds-overview'); out.adminInit = admin.all('init-state')[0]; out.allGroups = admin.last('all-groups-list');
  fs.writeFileSync('/tmp/fixtures.json', JSON.stringify(out));
  origLog('fixtures written; stages:', Object.keys(out).join(', '));
  process.exit(0);
})().catch((e) => { origLog('FATAL', e); process.exit(2); });
