// Escrow payment review engine — the server-side port of the escrow review console.
//
// One incoming payment = one record. It moves through 5 review stages and only
// when stage 5 finishes is the money released from the vault to the seller's
// available balance (the caller does the balance move; this module only owns the
// stage/timer state and the two "views" of it):
//
//   * adminView  — everything: timers, speed, pause, mode, per-stage durations
//   * sellerView — the safe version. It NEVER contains a timer (unless the admin
//                  switched "show estimated time" on, and then only the ACTIVE
//                  stage's remaining time). Queued stages expose a title only.
//
// Persisted fields (all on the incoming_funds row):
//   review_mode ('none'|'auto'|'manual'), review_stage (1..5 active, 6 finished),
//   review_checks, review_elapsed_ms (time spent in the current stage, already
//   scaled by speed), review_last_tick, review_paused, review_speed,
//   review_show_time, review_timers (seconds per stage — admin only),
//   review_stage_times (when each stage passed — used by the receipt).

const STAGES = [
  { title: 'Payment received', team: 'Intake desk', checks: ['Transaction ID logged', 'Buyer and seller notified', 'Receipt stored securely'] },
  { title: 'Payer verification', team: 'Verification team', checks: ['Sender name matches buyer', 'Amount matches the order', 'Payment reference matches'] },
  { title: 'Authenticity review', team: 'Risk and compliance', checks: ['Funds cleared with the bank', 'Fraud and chargeback screen', 'Compliance screening'] },
  { title: 'Payment confirmed', team: 'Escrow operations', checks: ['Funds confirmed by escrow', null /* built from the seller Account ID */] },
  { title: 'Funds in seller’s vault account', team: 'Settlement', checks: ['Funds credited to the seller'] }
];
const WEIGHTS = [10, 25, 35, 10, 20];
const STATUS_TEXT = ['Payment received', 'Payment under review', 'Payment under review', 'Payment confirmed', 'Moving funds to seller’s vault', 'Funds credited to the seller'];
const TOTAL_CHECKS = STAGES.reduce((n, s) => n + s.checks.length, 0); // 12
const MIN_STAGE_SECONDS = 2;
const FIT_SECONDS = 45;           // "Auto-fit": the whole review plays in about 45 seconds
const SPEEDS = [1, 10, 60, 600, 3600];
const MAX_TOTAL_SECONDS = 60 * 24 * 3600; // 60 days

function stageChecks(stageIdx, accountId) {
  return STAGES[stageIdx].checks.map((c) => c || `Funds transferred to the seller account ${accountId || '—'}`);
}

// Split a total (seconds) across the five stages by weight; the leftover goes to the last stage.
function splitTotal(totalSeconds) {
  const total = Math.floor(Number(totalSeconds));
  const parts = WEIGHTS.map((w) => Math.floor((total * w) / 100));
  parts[4] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

function toDHMS(s) {
  s = Math.max(0, Math.floor(s));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

// Validate admin-entered timers (5 whole numbers of seconds). Returns {error} or {timers}.
function validateTimers(arr) {
  if (!Array.isArray(arr) || arr.length !== 5) return { error: 'Please set a time for each of the 5 stages.' };
  const t = arr.map((x) => Number(x));
  if (!t.every((x) => Number.isFinite(x) && Number.isInteger(x))) return { error: 'Stage times must be whole numbers of seconds.' };
  if (t.some((x) => x < MIN_STAGE_SECONDS)) return { error: `Each stage needs at least ${MIN_STAGE_SECONDS} seconds.` };
  if (t.reduce((a, b) => a + b, 0) > MAX_TOTAL_SECONDS) return { error: 'The whole review cannot be longer than 60 days.' };
  return { timers: t };
}

// Build the initial persisted state for a new review.
//   opts: { mode:'auto'|'manual', totalSeconds?, timers?, speed?:number|'fit', showTime?:boolean }
function initialState(opts = {}, nowMs = Date.now()) {
  const mode = opts.mode === 'manual' ? 'manual' : 'auto';
  let timers = null;
  if (mode === 'auto') {
    if (opts.timers) {
      const v = validateTimers(opts.timers);
      if (v.error) return { error: v.error };
      timers = v.timers;
    } else {
      const total = Number(opts.totalSeconds) > 0 ? Number(opts.totalSeconds) : 6 * 3600;
      timers = splitTotal(total);
      const v = validateTimers(timers);
      if (v.error) return { error: v.error };
    }
  } else {
    timers = splitTotal(6 * 3600); // unused in manual mode, kept so the admin can switch to automatic later
  }
  const speed = resolveSpeed(opts.speed, timers);
  return {
    value: {
      review_mode: mode, review_stage: 1, review_checks: 0, review_elapsed_ms: 0,
      review_last_tick: new Date(nowMs).toISOString(), review_paused: false, review_speed: speed,
      review_show_time: !!opts.showTime, review_timers: timers, review_stage_times: []
    }
  };
}

function resolveSpeed(speed, timers) {
  if (speed === 'fit') {
    const sum = timers.reduce((a, b) => a + b, 0);
    return Math.max(1, Math.round((sum / FIT_SECONDS) * 100) / 100);
  }
  const n = Number(speed);
  if (Number.isFinite(n) && n >= 1 && n <= 100000) return n;
  return 1;
}

// ---- Time advancement ----
// Pure: takes the stored fields, returns the fields that changed (or null).
// Called about once a second by the server ticker, so closing every browser
// never stops a review.
function tick(rec, nowMs = Date.now()) {
  let stage = Number(rec.review_stage);
  if (!(stage >= 1 && stage <= 5)) return null;
  const last = rec.review_last_tick ? new Date(rec.review_last_tick).getTime() : nowMs;
  const base = { review_last_tick: new Date(nowMs).toISOString() };
  if (rec.review_mode !== 'auto' || rec.review_paused) return base; // time does not pass while manual/paused
  const timers = rec.review_timers;
  if (!Array.isArray(timers) || timers.length !== 5) return base;

  const speed = Number(rec.review_speed) || 1;
  let elapsed = Number(rec.review_elapsed_ms || 0) + Math.max(0, nowMs - last) * speed;
  const stageTimes = Array.isArray(rec.review_stage_times) ? rec.review_stage_times.slice() : [];
  let passed = false;
  while (stage <= 5 && elapsed >= timers[stage - 1] * 1000) {
    elapsed -= timers[stage - 1] * 1000;
    stageTimes.push({ stage, at: new Date(nowMs).toISOString() });
    stage += 1;
    passed = true;
  }
  const out = { ...base, review_stage: stage };
  if (stage > 5) {
    out.review_stage = 6; out.review_checks = 0; out.review_elapsed_ms = 0;
  } else {
    const n = STAGES[stage - 1].checks.length;
    out.review_elapsed_ms = Math.floor(elapsed);
    out.review_checks = Math.min(n, Math.floor((elapsed / (timers[stage - 1] * 1000)) * n));
  }
  if (passed) out.review_stage_times = stageTimes;
  return out;
}

// ---- Manual / admin actions (all pure; return the changed fields or {error}) ----
function confirmCheck(rec, nowMs = Date.now()) {
  const stage = Number(rec.review_stage);
  if (!(stage >= 1 && stage <= 5)) return { error: 'This review is already complete.' };
  if (rec.review_mode !== 'manual') return { error: 'Switch to manual review to confirm checks yourself.' };
  const n = STAGES[stage - 1].checks.length;
  const checks = Number(rec.review_checks || 0);
  if (checks < n) return { fields: { review_checks: checks + 1, review_last_tick: new Date(nowMs).toISOString() } };
  return approveStage(rec, nowMs);
}

function approveStage(rec, nowMs = Date.now()) {
  const stage = Number(rec.review_stage);
  if (!(stage >= 1 && stage <= 5)) return { error: 'This review is already complete.' };
  const times = (Array.isArray(rec.review_stage_times) ? rec.review_stage_times : []).concat([{ stage, at: new Date(nowMs).toISOString() }]);
  const next = stage + 1;
  return { fields: { review_stage: next, review_checks: 0, review_elapsed_ms: 0, review_stage_times: times, review_last_tick: new Date(nowMs).toISOString() } };
}

const skipStage = approveStage;

function restart(rec, nowMs = Date.now()) {
  const stage = Number(rec.review_stage);
  if (!(stage >= 1 && stage <= 5)) return { error: 'A finished review cannot be restarted.' };
  return { fields: { review_stage: 1, review_checks: 0, review_elapsed_ms: 0, review_stage_times: [], review_last_tick: new Date(nowMs).toISOString() } };
}

function setPaused(rec, paused, nowMs = Date.now()) {
  const stage = Number(rec.review_stage);
  if (!(stage >= 1 && stage <= 5)) return { error: 'This review is already complete.' };
  return { fields: { review_paused: !!paused, review_last_tick: new Date(nowMs).toISOString() } };
}

// Change mode / timers / speed / show-time. Elapsed time in the current stage is
// preserved; the persisted timers only change when the admin supplies new ones.
function configure(rec, opts, nowMs = Date.now()) {
  const stage = Number(rec.review_stage);
  if (!(stage >= 1 && stage <= 5)) return { error: 'This review is already complete.' };
  const f = { review_last_tick: new Date(nowMs).toISOString() };
  if (opts.mode === 'auto' || opts.mode === 'manual') f.review_mode = opts.mode;
  let timers = rec.review_timers;
  if (opts.timers) {
    const v = validateTimers(opts.timers);
    if (v.error) return { error: v.error };
    timers = v.timers; f.review_timers = timers; f.review_elapsed_ms = 0; f.review_checks = 0;
  } else if (opts.totalSeconds) {
    const t = splitTotal(Number(opts.totalSeconds));
    const v = validateTimers(t);
    if (v.error) return { error: v.error };
    timers = v.timers; f.review_timers = timers; f.review_elapsed_ms = 0; f.review_checks = 0;
  }
  if (opts.speed !== undefined) f.review_speed = resolveSpeed(opts.speed, timers || splitTotal(6 * 3600));
  if (opts.showTime !== undefined) f.review_show_time = !!opts.showTime;
  return { fields: f };
}

// ---- Views ----
function progressPct(rec) {
  const stage = Number(rec.review_stage);
  if (stage > 5) return 100;
  let done = 0;
  for (let i = 0; i < stage - 1; i++) done += STAGES[i].checks.length;
  done += Number(rec.review_checks || 0);
  return Math.round((done / TOTAL_CHECKS) * 100);
}

function vaultBadge(stage) {
  // Mirrors the console's vault account tile.
  if (stage > 5) return { label: 'Credited', tone: 'success' };
  if (stage >= 5) return { label: 'Ready to release', tone: 'accent' };
  return { label: 'On hold', tone: 'warning' };
}

function remainingSeconds(rec, nowMs = Date.now()) {
  const stage = Number(rec.review_stage);
  if (!(stage >= 1 && stage <= 5) || !Array.isArray(rec.review_timers)) return null;
  const last = rec.review_last_tick ? new Date(rec.review_last_tick).getTime() : nowMs;
  const live = rec.review_mode === 'auto' && !rec.review_paused ? Math.max(0, nowMs - last) * (Number(rec.review_speed) || 1) : 0;
  const elapsed = Number(rec.review_elapsed_ms || 0) + live;
  return Math.max(0, Math.ceil(rec.review_timers[stage - 1] - elapsed / 1000));
}

// What a seller (or the buyer-visible chat) is allowed to see. No timers. Ever.
function sellerView(rec, accountId, nowMs = Date.now()) {
  if (!rec || rec.review_mode === 'none') return null;
  const stage = Number(rec.review_stage);
  const stages = STAGES.map((s, i) => {
    const idx = i + 1;
    const status = idx < stage ? 'passed' : idx === stage ? 'in_review' : 'queued';
    const out = { index: idx, title: s.title, status };
    if (status !== 'queued') {
      out.team = s.team;
      const texts = stageChecks(i, accountId);
      out.checks = texts.map((t, j) => ({ text: t, done: status === 'passed' || j < Number(rec.review_checks || 0) }));
    }
    return out;
  });
  const view = {
    statusLine: STATUS_TEXT[Math.min(Math.max(stage - 1, 0), 5)],
    stage: Math.min(stage, 6), finished: stage > 5, stages,
    progress: progressPct(rec), vault: vaultBadge(stage), accountId: accountId || null
  };
  if (rec.review_show_time && rec.review_mode === 'auto' && stage <= 5 && !rec.review_paused) {
    view.activeStageSecondsLeft = remainingSeconds(rec, nowMs); // active stage only
  }
  return view;
}

// Full view for the admin console.
function adminView(rec, accountId, nowMs = Date.now()) {
  if (!rec || rec.review_mode === 'none') return null;
  const stage = Number(rec.review_stage);
  const timers = Array.isArray(rec.review_timers) ? rec.review_timers : null;
  const base = sellerView(rec, accountId, nowMs);
  base.stages = STAGES.map((s, i) => {
    const idx = i + 1;
    const status = idx < stage ? 'passed' : idx === stage ? 'in_review' : 'queued';
    return {
      index: idx, title: s.title, team: s.team, status,
      checks: stageChecks(i, accountId).map((t, j) => ({ text: t, done: status === 'passed' || (status === 'in_review' && j < Number(rec.review_checks || 0)) })),
      durationSeconds: timers ? timers[i] : null
    };
  });
  const left = [];
  if (timers && stage <= 5 && rec.review_mode === 'auto') {
    let total = remainingSeconds(rec, nowMs) || 0;
    for (let i = stage; i < 5; i++) total += timers[i];
    left.push(total);
  }
  return {
    ...base, mode: rec.review_mode, paused: !!rec.review_paused, speed: Number(rec.review_speed) || 1,
    showTime: !!rec.review_show_time, timers, stageTimes: rec.review_stage_times || [],
    checksDone: Number(rec.review_checks || 0), stageSecondsLeft: remainingSeconds(rec, nowMs),
    totalSecondsLeft: left.length ? left[0] : null, nextAction: stage > 5 ? null : (Number(rec.review_checks || 0) < STAGES[stage - 1].checks.length ? 'Confirm check' : 'Approve stage')
  };
}

module.exports = {
  STAGES, WEIGHTS, STATUS_TEXT, TOTAL_CHECKS, SPEEDS, FIT_SECONDS, MIN_STAGE_SECONDS,
  stageChecks, splitTotal, toDHMS, validateTimers, initialState, resolveSpeed,
  tick, confirmCheck, approveStage, skipStage, restart, setPaused, configure,
  progressPct, vaultBadge, remainingSeconds, sellerView, adminView
};
