// Incoming-funds stage tracker — pure data + shaping (no I/O), shared by
// finance.js (what leaves the server) and tracking.js (the engine).
//
// Every payment the Desk records goes through five visible stages. The seller
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
  { n: 5, title: 'Funds in seller\u2019s vault account', team: 'Settlement',
    checks: ['Funds credited to the seller'] }
];
const STAGE_COUNT = STAGES.length;
const WEIGHTS = [10, 25, 35, 10, 20];           // share of the total time per stage (%)
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

/** Validate admin-supplied timers (array of 5 whole seconds). Returns array or null. */
function cleanTimers(input) {
  if (!Array.isArray(input) || input.length !== STAGE_COUNT) return null;
  const out = input.map((v) => Math.floor(Number(v)));
  if (!out.every((v) => Number.isFinite(v) && v >= MIN_STAGE_SECONDS && v <= MAX_TOTAL_SECONDS)) return null;
  if (out.reduce((a, b) => a + b, 0) > MAX_TOTAL_SECONDS) return null;
  return out;
}

function checkText(stage, i, accountId) {
  return stage.checks[i].replace('{ACCOUNT_ID}', accountId || '—');
}

function timersOf(rec) {
  const t = Array.isArray(rec.track_timers) ? rec.track_timers : (typeof rec.track_timers === 'string' ? JSON.parse(rec.track_timers) : null);
  return cleanTimers(t) || defaultTimers();
}

/**
 * Shape a record's tracker for the wire.
 *  forAdmin=false (seller): no timers, no queued-stage detail, no speed/mode.
 */
function publicTrack(rec, { accountId, forAdmin = false, now = Date.now() } = {}) {
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
        text: checkText(s, i, accountId),
        state: status === 'passed' ? 'done' : status === 'queued' ? 'wait' : (i < check ? 'done' : i === check ? 'now' : 'wait')
      }));
    }
    if (status === 'in_review') row.progress = s.checks.length ? check / s.checks.length : 0;
    if (forAdmin) row.timerSec = timers[idx];
    return row;
  });

  const out = { enabled: true, stage, complete: finished, stages, finishedAt: rec.track_finished_at || null, serverNow: now };
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

module.exports = { STAGES, STAGE_COUNT, WEIGHTS, MIN_STAGE_SECONDS, DEFAULT_TOTAL_SECONDS, MAX_TOTAL_SECONDS, splitTotal, defaultTimers, cleanTimers, timersOf, publicTrack };
