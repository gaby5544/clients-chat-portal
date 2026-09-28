/**
 * End-to-end smoke test for invite-only Seller registration + KYC review.
 *
 * Run against a live instance of this server (in-memory store is fine):
 *   PORT=3311 node server.js &
 *   TEST_PORT=3311 node test/invite-kyc-flow.test.js
 *
 * Exits non-zero if any check fails.
 */
const { io } = require('socket.io-client');
const PORT = process.env.TEST_PORT || 3311;
const URL = `http://localhost:${PORT}`;

function connect() {
  const s = io(URL, { forceNew: true, reconnection: false });
  s.on('connect_error', (err) => console.error('connect_error:', err.message));
  return s;
}
function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('PASS:', msg); } }

async function main() {
  // ---- 1. Admin connects and joins the default group ----
  const admin = connect();
  await once(admin, 'connect');
  admin.emit('join-room', { groupId: 'default-group', role: 'ADMINISTRATOR', adminKey: 'ADMIN123', sessionToken: 'admin-token-1' });
  const adminInit = await once(admin, 'init-state');
  assert(adminInit.isAdminConfirmed === true, 'admin joined default-group as confirmed admin');

  // ---- 2. Admin creates a brand-new group (auto-generates a Seller invite) ----
  admin.emit('create-group', { groupName: 'Gold Deal — Lagos', customNameA: '', customNameB: '' });
  const created = await once(admin, 'group-created-and-switch');
  assert(!!created.sellerInviteToken, 'create-group auto-generated a Seller invite token');
  const newGroupId = created.newGroupId;
  admin.emit('join-room', { groupId: newGroupId, role: 'ADMINISTRATOR', adminKey: 'ADMIN123', sessionToken: 'admin-token-1' });
  await once(admin, 'init-state'); // admin's own rejoin into the new group

  // ---- 3. Admin explicitly generates a second, ad-hoc invite for that group ----
  admin.emit('admin-create-invite', { groupId: newGroupId });
  const invCreated = await once(admin, 'invite-created');
  assert(invCreated.groupId === newGroupId, 'admin-create-invite issued a token for the right group');
  const inviteToken = invCreated.token;

  // ---- 4. A brand-new visitor cannot just join as Seller without an invite ----
  const rando = connect();
  await once(rando, 'connect');
  rando.emit('join-room', { groupId: newGroupId, role: 'PARTY B', sessionToken: 'rando-token-1' });
  const randoErr = await once(rando, 'error-msg');
  assert(/invite-only/i.test(randoErr), 'an un-invited visitor is refused Seller access: "' + randoErr + '"');

  // ---- 5. Checking the real invite token succeeds ----
  rando.emit('check-invite', { token: inviteToken });
  const valid = await once(rando, 'invite-valid');
  assert(valid.groupId === newGroupId, 'check-invite reports the correct group for a valid token');

  // ---- 6. Redeeming it creates the Seller account and joins them in ----
  rando.emit('redeem-invite', { token: inviteToken, sessionToken: 'rando-token-1', displayName: 'Jane Seller', password: 'supersecret1' });
  const sellerInit = await once(rando, 'init-state');
  assert(sellerInit.role === 'PARTY B', 'redeem-invite joined the seller in as PARTY B');
  assert(sellerInit.kycStatus === 'not_submitted', 'fresh seller account starts KYC not_submitted');

  // ---- 7. The same invite cannot be redeemed a second time ----
  const rando2 = connect();
  await once(rando2, 'connect');
  rando2.emit('redeem-invite', { token: inviteToken, sessionToken: 'someone-else-token', displayName: 'Impostor', password: 'whatever123' });
  const reuse = await once(rando2, 'invite-invalid');
  assert(/already been used/i.test(reuse.reason), 'a second redemption of the same token is refused: "' + reuse.reason + '"');

  // ---- 8. The registered seller can reconnect on a later "visit" (same sessionToken) ----
  const rejoin = connect();
  await once(rejoin, 'connect');
  rejoin.emit('join-room', { groupId: newGroupId, role: 'PARTY B', sessionToken: 'rando-token-1' });
  const rejoinInit = await once(rejoin, 'init-state');
  assert(rejoinInit.role === 'PARTY B', 'the registered seller can reconnect normally afterwards');

  // ---- 9. Seller submits KYC documents ----
  // Register listeners BEFORE triggering the action (exactly like app.js does
  // at page-load) — awaiting once() only after emitting is what was racy here.
  const adminNotifiedPromise = once(admin, 'kyc-submission-created');
  const sellerPendingPromise = once(rando, 'kyc-status-update');
  rando.emit('submit-kyc', { groupId: newGroupId, documents: [{ url: '/uploads/fake-id.png', name: 'passport.png', type: 'Government ID' }] });
  const sellerKycUpdate = await sellerPendingPromise;
  assert(sellerKycUpdate.status === 'pending', 'seller sees their own submission go to pending');
  const adminKycCreated = await adminNotifiedPromise;
  assert(adminKycCreated.sellerName === 'Jane Seller', 'admin is notified in real time of the new KYC submission');

  // ---- 10. Admin lists and approves it ----
  admin.emit('admin-list-kyc');
  const kycList = await once(admin, 'kyc-list');
  assert(kycList.submissions.length === 1 && kycList.submissions[0].status === 'pending', 'admin-list-kyc shows exactly one pending submission');
  const submissionId = kycList.submissions[0].id;

  const sellerVerifiedPromise = once(rando, 'kyc-status-update');
  admin.emit('admin-review-kyc', { submissionId, decision: 'verified' });
  const sellerVerified = await sellerVerifiedPromise;
  assert(sellerVerified.status === 'verified', 'seller is notified live once approved');

  // ---- 11. A non-admin cannot generate invites or review KYC ----
  let gotSomething = false;
  rando.emit('admin-create-invite', { groupId: newGroupId });
  rando.once('invite-created', () => { gotSomething = true; });
  await new Promise(r => setTimeout(r, 400));
  assert(gotSomething === false, 'a Seller (non-admin) cannot generate invite links');

  // ---- 12. A second Seller, NOT yet KYC-verified, is blocked from withdrawing ----
  admin.emit('admin-create-invite', { groupId: newGroupId });
  const invCreated2 = await once(admin, 'invite-created');
  const unverified = connect();
  await once(unverified, 'connect');
  unverified.emit('redeem-invite', { token: invCreated2.token, sessionToken: 'unverified-token-1', displayName: 'Unverified Seller', password: 'anotherpass1' });
  await once(unverified, 'init-state');
  unverified.emit('request-withdrawal', { groupId: newGroupId, amount: '1,000 USD', destination: 'some-wallet' });
  const blocked = await once(unverified, 'withdrawal-blocked');
  assert(/verification/i.test(blocked.reason), 'withdrawal is blocked server-side until KYC is verified: "' + blocked.reason + '"');

  // ---- 13. The already-verified Seller (Jane) CAN request a withdrawal ----
  const adminWithdrawalNotified = once(admin, 'withdrawal-request-created');
  const sellerWithdrawSubmitted = once(rando, 'withdrawal-submitted');
  rando.emit('request-withdrawal', { groupId: newGroupId, amount: '2,500 USD', destination: 'bank-acct-0099', note: 'After deal closed' });
  const submitted = await sellerWithdrawSubmitted;
  assert(submitted.status === 'pending', 'a KYC-verified seller can submit a withdrawal request');
  const adminWithdrawal = await adminWithdrawalNotified;
  assert(adminWithdrawal.sellerName === 'Jane Seller' && adminWithdrawal.amount === '2,500 USD', 'admin is notified live of the new withdrawal request');

  // ---- 14. Admin lists and approves the withdrawal ----
  admin.emit('admin-list-withdrawals');
  const wList = await once(admin, 'withdrawals-list');
  assert(wList.requests.length === 1 && wList.requests[0].status === 'pending', 'admin-list-withdrawals shows exactly one pending request');
  const requestId = wList.requests[0].id;

  const sellerWithdrawUpdatePromise = once(rando, 'withdrawal-status-update');
  const adminReviewedPromise = once(admin, 'withdrawal-request-reviewed'); // drain THIS legitimate broadcast here
  admin.emit('admin-review-withdrawal', { requestId, decision: 'approved' });
  const withdrawApproved = await sellerWithdrawUpdatePromise;
  assert(withdrawApproved.status === 'approved', 'seller is notified live once the withdrawal is approved');
  await adminReviewedPromise; // make sure it's fully drained before the next check registers a fresh listener

  // ---- 15. A non-admin cannot approve/reject withdrawals ----
  let withdrawalReviewLeaked = false;
  admin.once('withdrawal-request-reviewed', () => { withdrawalReviewLeaked = true; });
  unverified.emit('admin-review-withdrawal', { requestId, decision: 'approved' });
  await new Promise(r => setTimeout(r, 400));
  assert(withdrawalReviewLeaked === false, 'a non-admin request-withdrawal review is silently ignored');

  console.log('\nAll checks complete.');
  process.exit(process.exitCode || 0);
}

main().catch((err) => { console.error('TEST CRASHED:', err); process.exit(1); });
