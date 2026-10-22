// Fixtures for the v3.11 browser tests (real server shapers, no server needed).
require('./harness');
const F = require('../finance');
const gid = JSON.parse(require('fs').readFileSync('/tmp/fixtures_v38.json', 'utf8')).gid;
const now = new Date().toISOString();
const raw = (id, stage, status, ref, cur) => ({ id, group_id: gid, payer_name: 'ACME Ltd', purpose: 'Invoice 42', method: 'bank_transfer', amount: 500, amount_currency: cur || 'USD', amount_ledger: 500, fx_rate: 1, received_at: now, status, status_history: [], created_at: now, updated_at: now, fee_amount: 0,
  track_enabled: true, track_stage: stage, track_check: 1, track_timers: null, track_stage_times: { 1: now, 2: now, 3: now }, track_mode: 'manual', external_ref: ref || null,
  meta: { receivingAccount: { accountId: '48291037561', currency: 'USD', ending: '7765', bankName: 'Test Bank USA', source: 'desk', ready: true }, referenceCheck: 'matched' } });
const out = {
  gid,
  incoming: [F.publicIncoming(raw('aaaa1111-0000', 3, 'held_in_vault', '48291037561'), false, '48291037561', '+233244123456'), F.publicIncoming(raw('bbbb2222-0000', 7, 'credited'), false, '48291037561', '+233244123456')],
  cardQueue: { list: [{ groupId: gid, sellerName: 'Kwame Mensah', accountId: '48291037561', currency: 'USD', verified: true, eligible: true, status: 'processing', fee: { usd: 20, amount: 20, currency: 'USD', paid: true, paidAt: now, ref: 'CF-1A2B3C4D' }, appliedAt: now, last4: null }], eligible: [{ groupId: gid, sellerName: 'Kwame Mensah', accountId: '48291037561' }], fee: 20 },
  adminCard: { groupId: gid, sellerName: 'Kwame Mensah', accountId: '48291037561', currency: 'USD', verified: true, eligible: false, status: 'none', fee: { usd: 20, amount: 20, currency: 'USD', paid: false }, last4: null, reveals: 0 },
  snapshot: { accountId: '48291037561', currency: 'USD', ready: true, source: 'desk', ending: '7765', bankName: 'Test Bank USA', label: 'USD account ••7765' }
};
require('fs').writeFileSync('/tmp/fixtures_v39.json', JSON.stringify(out));
console.log('ok');
