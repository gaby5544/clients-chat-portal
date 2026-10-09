// Incoming-funds stage tracker — pure data + shaping (no I/O), shared by
// finance.js (what leaves the server) and tracking.js (the engine).
//
// Every payment the Desk records goes through six visible stages (the fifth is a phone verification). The seller
// only ever sees the stage the payment has actually reached — queued stages
// show no detail, and timers are stripped unless the admin explicitly turned
// "show time left" on (and then only for the active stage).

const STAGES = [
  { n: 1, title: 'Payment received', team: 'Intake desk',
    checks: ['Transaction ID logged', 'Buyer and seller notified', 'Receipt stored securely'] },
  { n: 2, title: 'Payer verification', team: 'Verification team',
    checks: ['Sender name matches buyer', 'Amount matches the order', 'Payment reference matches'] },
  { n: 3, title: 'Authenticity review', team: 'Risk and compliance',
    checks: ['Funds cleared with the bank', 'Fraud and chargeback screen', 'Compliance screening'] },
  { n: 4, title: 'Payment confirmed', team: 'Escrow operations',
    checks: ['Funds confirmed by escrow', 'Funds transferred to the seller account {ACCOUNT_ID}'] },
  { n: 5, title: 'Phone verification', team: 'Security desk',
    checks: ['Phone number {PHONE} on file matched to the account holder', 'Verification call placed to the account holder', 'Account holder\u2019s confirmation recorded'] },
  { n: 6, title: 'Funds in seller\u2019s vault account', team: 'Settlement',
    checks: ['Funds secured in the seller\u2019s vault account', 'Awaiting final release by the Desk to the main account'] }
];
const STAGE_COUNT = STAGES.length;
const WEIGHTS = [8, 20, 30, 10, 17, 15];           // share of the total time per stage (%)
const MIN_STAGE_SECONDS = 2;
const DEFAULT_TOTAL_SECONDS = Number(process.env.TRACK_DEFAULT_TOTAL_SECONDS) || 24 * 3600;
const MAX_TOTAL_SECONDS = 90 * 86400;

function splitTotal(totalSeconds) {
  const t = Math.max(MIN_STAGE_SECONDS * STAGE_COUNT, Math.floor(totalSeconds));
  const parts = WEIGHTS.map((w) => Math.max(MIN_STAGE_SECONDS, Math.floor(t * w / 100)));
  const used = parts.reduce((a, b) => a + b, 0);
  parts[STAGE_COUNT - 1] = Math.max(MIN_STAGE_SECONDS, parts[STAGE_COUNT - 1] + (t - used));
  return parts;
}

function defaultTimers() { return splitTotal(DEFAULT_TOTAL_SECONDS); }

/** Validate admin-supplied timers (array of 6 whole seconds). Returns array or null. */
function cleanTimers(input) {
  if (!Array.isArray(input) || input.length !== STAGE_COUNT) return null;
  const out = input.map((v) => Math.floor(Number(v)));
  if (!out.every((v) => Number.isFinite(v) && v >= MIN_STAGE_SECONDS && v <= MAX_TOTAL_SECONDS)) return null;
  if (out.reduce((a, b) => a + b, 0) > MAX_TOTAL_SECONDS) return null;
  return out;
}

/** +233244123456 -> "+233 ••• ••• 456" — the seller sees which number is being verified, never the whole of it. */
function maskPhone(p) {
  const s = String(p || '').replace(/[^\d+]/g, '');
  if (s.length < 6) return 'your number';
  const m = s.match(/^(\+\d{1,3})?(\d+)$/);
  const cc = (m && m[1]) || ''; const rest = (m && m[2]) || s;
  return `${cc ? cc + ' ' : ''}\u2022\u2022\u2022 \u2022\u2022\u2022 ${rest.slice(-3)}`;
}
function checkText(stage, i, accountId, phone) {
  return stage.checks[i].replace('{ACCOUNT_ID}', accountId || '—').replace('{PHONE}', maskPhone(phone));
}

function timersOf(rec) {
  const t = Array.isArray(rec.track_timers) ? rec.track_timers : (typeof rec.track_timers === 'string' ? JSON.parse(rec.track_timers) : null);
  // Payments recorded before the phone stage existed carry five timers — slot the new stage in.
  if (Array.isArray(t) && t.length === 5) { const six = [t[0], t[1], t[2], t[3], Math.max(MIN_STAGE_SECONDS, Math.round(t[4] * 0.6)), t[4]]; return cleanTimers(six) || defaultTimers(); }
  return cleanTimers(t) || defaultTimers();
}

/**
 * Shape a record's tracker for the wire.
 *  forAdmin=false (seller): no timers, no queued-stage detail, no speed/mode.
 */
function publicTrack(rec, { accountId, phone, forAdmin = false, now = Date.now() } = {}) {
  if (!rec.track_enabled) return null;
  const timers = timersOf(rec);
  const stage = Number(rec.track_stage) || 1;
  const check = Number(rec.track_check) || 0;
  const times = (rec.track_stage_times && typeof rec.track_stage_times === 'object') ? rec.track_stage_times : {};
  const finished = stage > STAGE_COUNT;

  const stages = STAGES.map((s, idx) => {
    const status = stage > s.n ? 'passed' : (stage === s.n ? 'in_review' : 'queued');
    const row = { n: s.n, title: s.title, team: s.team, status, startedAt: times[s.n] || null };
    if (status !== 'queued' || forAdmin) {
      row.checks = s.checks.map((_, i) => ({
        text: checkText(s, i, accountId, phone),
        state: status === 'passed' ? 'done' : status === 'queued' ? 'wait' : (i < check ? 'done' : i === check ? 'now' : 'wait')
      }));
    }
    if (status === 'in_review') row.progress = s.checks.length ? check / s.checks.length : 0;
    if (forAdmin) row.timerSec = timers[idx];
    return row;
  });

  const out = { enabled: true, stage, complete: finished, awaitingRelease: finished && rec.status === 'held_in_vault', stages, finishedAt: rec.track_finished_at || null, serverNow: now };
  const showTime = forAdmin || rec.track_show_timer;
  if (showTime && !finished && rec.track_mode === 'auto') {
    const activeMs = timers[stage - 1] * 1000;
    const leftMs = Math.max(0, activeMs - Number(rec.track_elapsed_ms || 0));
    out.activeLeftSec = Math.ceil(leftMs / 1000);
    out.paused = !!rec.track_paused;
  }
  if (forAdmin) {
    out.mode = rec.track_mode; out.paused = !!rec.track_paused; out.speed = Number(rec.track_speed) || 1;
    out.timers = timers; out.showTimer = !!rec.track_show_timer; out.elapsedMs = Number(rec.track_elapsed_ms || 0);
    let left = 0;
    for (let i = stage; i < STAGE_COUNT; i++) left += timers[i];
    if (!finished) left += Math.max(0, timers[stage - 1] - Number(rec.track_elapsed_ms || 0) / 1000);
    out.totalLeftSec = Math.ceil(left);
  }
  return out;
}

module.exports = { maskPhone, STAGES, STAGE_COUNT, WEIGHTS, MIN_STAGE_SECONDS, DEFAULT_TOTAL_SECONDS, MAX_TOTAL_SECONDS, splitTotal, defaultTimers, cleanTimers, timersOf, publicTrack };
