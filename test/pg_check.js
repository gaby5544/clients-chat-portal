// Checks every SQL statement the Postgres store issues: placeholders ($1..$n) must match the parameters passed.
require('./harness');
const Module = require('module'); const seen = []; let bad = 0;
class FakePool { constructor() {} on() {} async query(sql, params = []) {
  const nums = [...String(sql).matchAll(/\$(\d+)/g)].map(m => +m[1]); const max = nums.length ? Math.max(...nums) : 0;
  const missing = []; for (let i = 1; i <= max; i++) if (!nums.includes(i)) missing.push(i);
  const ok = max === params.length && !missing.length; if (!ok) { bad++; console.log('MISMATCH', max, 'placeholders vs', params.length, 'params\n', String(sql).replace(/\s+/g, ' ').slice(0, 160)); }
  seen.push(String(sql).trim().split(/\s+/).slice(0, 3).join(' '));
  return { rows: [{ id: 'x', group_id: 'g', status: 'pending', status_history: [], seller_ip_log: [], balance_available: 1, balance_held: 1, balance_pending: 1, total_deposited: 1, amount: 1, value: { a: 1 } }], rowCount: 1 };
} async end() {} }
const orig = Module._load; Module._load = function (r, ...rest) { if (r === 'pg') return { Pool: FakePool }; return orig.call(this, r, ...rest); };
process.env.DATABASE_URL = 'postgres://x'; delete process.env.STORAGE;
const PgStore = require('../pgStore');
const S = new PgStore('postgres://localhost/test');
S.pool = new FakePool();
(async () => {
  await S.updateGroup('g', { seller_phone: '+1', seller_ip_log: [{ ip: '1.1.1.1' }], seller_blocked_ips: ['1.1.1.1'], business_profile: { a: 1 }, kyc_auto_result: { passed: true }, disbursement_enabled: true, crypto_deposit_verified: true, balance_pending: 5 });
  await S.adjustBalances('g', { available: -5, pending: 5 });
  await S.adjustBalances('g', { held: 5 });
  await S.findGroupByAccountId('123'); await S.getSetting('k'); await S.setSetting('k', { a: 1 });
  await S.createWithdrawal({ groupId: 'g', method: 'bank', amount: 1, amountCurrency: 'USD', amountLedger: 1, requestIp: '1.1.1.1', sellerAccountId: '123', emailConfirmedAt: new Date().toISOString() });
  await S.getWithdrawalsSince('g', new Date().toISOString());
  await S.createIncomingFunds({ groupId: 'g', payerName: 'A', purpose: 'p', method: 'wire', amount: 1, amountCurrency: 'USD', amountLedger: 1, fxRate: 1, status: 'held_in_vault', feeAmount: 1, bankName: 'b', senderAccount: 's', noteSharedWithBuyer: true, track: { enabled: true, mode: 'auto', stage: 1, check: 0, elapsedMs: 0, paused: false, speed: 1, timers: [2, 2, 2, 2, 2], showTimer: false, stageTimes: { 1: 'x' } } });
  await S.updateIncomingFunds('i', { track_stage: 2, track_check: 1, track_elapsed_ms: 5, track_timers: [2, 2, 2, 2, 2], track_stage_times: { 1: 'x' }, track_paused: true, note_shared_with_buyer: true });
  await S.getActiveTrackedIncoming(); await S.getAllUnreadRows();
  await S.upsertUser({ sessionToken: 't', displayName: 'N', language: 'fr' });
  console.log('statements checked:', seen.length, '| mismatches:', bad); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(2); });
