// Escrow payment review — the 5-stage review every recorded incoming payment goes through
// (see escrow-review-how-it-works.md). One JSON record per payment lives on
// incoming_funds.review; everything else (admin console, seller tracker) reads it.
//
// Two views of the same record:
//   adminView()  — everything: timers, speed, mode, settings, all checks.
//   sellerView() — ONLY the stage statuses (+ an optional rough time for the ACTIVE
//                  stage when the admin switched that on). Timers are never sent.
//
// Time is accumulated on the server (stage_elapsed += real seconds × speed on every
// tick) rather than computed from a start timestamp, so pausing, changing speed
// mid-stage, or a server restart can never make the clock jump.

const STAGES = [
  { key: 'received',   title: 'Payment received',                  team: 'Intake desk',            share: 10,
    checks: ['Transaction ID logged', 'Buyer and seller notified', 'Receipt stored securely'] },
  { key: 'payer',      title: 'Payer verification',                team: 'Verification team',      share: 25,
    checks: ['Sender name matches buyer', 'Amount matches the order', 'Payment reference matches'] },
  { key: 'authentic',  title: 'Authenticity review',               team: 'Risk and compliance',    share: 35,
    checks: ['Funds cleared with the bank', 'Fraud and chargeback screen', 'Compliance screening'] },
  { key: 'confirmed',  title: 'Payment confirmed',                 team: 'Escrow operations',      share: 10,
    checks: ['Funds confirmed by escrow', 'Funds transferred to the seller account ID'] },
  { key: 'settled',    title: "Funds in seller's vault account",   team: 'Settlement',             share: 20,
    checks: ['Funds credited to the seller'] }
];
const WEIGHTS = STAGES.map((s) => s.share);
const CHECKS_PER_STAGE = STAGES.map((s) => s.checks.length);
const DONE = 6; // current_stage value once every stage has passed

const STATUS_TEXT = {
  1: 'Payment received — logging and intake in progress',
  2: 'Payment under review — verifying the payer',
  3: 'Payment under review — authenticity and compliance checks',
  4: 'Payment confirmed — escrow is transferring the funds',
  5: 'Final step — crediting your vault account',
  6: 'Review complete — funds credited'
};

const SPEEDS = [1, 10, 60, 600, 3600];
const QUICK_DURATIONS = { '6h': 6 * 3600, '1d': 86400, '2d': 172800, '7d': 604800 };
const MIN_TOTAL_SECONDS = 5;
const MAX_TOTAL_SECONDS = 60 * 86400; // 60 days

function splitTotal(totalSeconds) {
  const parts = WEIGHTS.map((w) => Math.floor((totalSeconds * w) / 100));
  parts[4] += totalSeconds - parts.reduce((a, b) => a + b, 0); // any leftover goes to the last stage
  return parts;
}
function toDHMS(s) {
  s = Math.max(0, Math.floor(s));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
function fromDHMS({ d = 0, h = 0, m = 0, s = 0 }) {
  const v = [d, h, m, s].map(Number);
  if (v.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) return null;
  if (v[1] > 23 || v[2] > 59 || v[3] > 59) return null; // "minutes of 75" is rejected, per the test checklist
  return v[0] * 86400 + v[1] * 3600 + v[2] * 60 + v[3];
}

/** Builds a new review. `startedAt` defaults to now; timers come from a total or an explicit 5-array. */
function createReview({ mode = 'auto', totalSeconds = QUICK_DURATIONS['1d'], timers, now = Date.now(), completed = false } = {}) {
  const t = Array.isArray(timers) && timers.length === 5 ? timers.map((n) => Math.max(1, Math.floor(Number(n) || 0))) : splitTotal(totalSeconds);
  const iso = new Date(now).toISOString();
  return {
    mode: mode === 'manual' ? 'manual' : 'auto',
    current_stage: completed ? DONE : 1,
    checks_done: completed ? 0 : 0,
    stage_elapsed: 0,
    last_tick_at: iso,
    paused: false,
    speed: 1,
    show_time_to_seller: false,
    timers_seconds: t,
    started_at: iso,
    completed_at: completed ? iso : null,
    log: [{ at: iso, event: completed ? 'Review completed on recording' : 'Review started' }]
  };
}

function logEvent(review, event, now) {
  review.log = (review.log || []).concat([{ at: new Date(now).toISOString(), event }]).slice(-60);
}

/**
 * Advance the clock. Returns { changed, completed } — `changed` is true when the
 * stage or check count moved (so callers know to push live updates).
 * Mutates and returns the review in `out.review`.
 */
function tick(review, now = Date.now()) {
  const out = { changed: false, completed: false, review };
  if (!review || review.current_stage >= DONE) return out;
  const last = new Date(review.last_tick_at).getTime();
  const dt = Math.max(0, (now - (Number.isFinite(last) ? last : now)) / 1000);
  review.last_tick_at = new Date(now).toISOString();
  if (review.mode !== 'auto' || review.paused || dt === 0) return out;

  review.stage_elapsed += dt * (review.speed || 1);
  // A big jump (high speed, or server downtime) can pass several stages in one tick.
  while (review.current_stage < DONE) {
    const idx = review.current_stage - 1;
    const length = review.timers_seconds[idx];
    if (review.stage_elapsed >= length) {
      review.stage_elapsed -= length;
      review.current_stage += 1;
      review.checks_done = 0;
      out.changed = true;
      if (review.current_stage >= DONE) {
        review.completed_at = new Date(now).toISOString();
        review.stage_elapsed = 0;
        logEvent(review, 'Review complete', now);
        out.completed = true;
      } else {
        logEvent(review, `Stage ${review.current_stage} started — ${STAGES[review.current_stage - 1].title}`, now);
      }
    } else {
      const n = CHECKS_PER_STAGE[idx];
      const done = Math.min(n, Math.floor((review.stage_elapsed / length) * n));
      if (done !== review.checks_done) { review.checks_done = done; out.changed = true; }
      break;
    }
  }
  return out;
}

function totalSecondsLeft(review) {
  if (!review || review.current_stage >= DONE) return 0;
  let left = review.timers_seconds[review.current_stage - 1] - review.stage_elapsed;
  for (let i = review.current_stage; i < 5; i++) left += review.timers_seconds[i];
  return Math.max(0, Math.ceil(left));
}

// ---------------- Admin actions (all return { ok, error?, completed? }) ----------------
function setMode(review, mode, now) {
  if (!['auto', 'manual'].includes(mode)) return { ok: false, error: 'Mode must be automatic or manual.' };
  tick(review, now);
  review.mode = mode;
  logEvent(review, mode === 'auto' ? 'Switched to automatic timers' : 'Switched to manual review', now);
  return { ok: true };
}
function setSpeed(review, speed, now) {
  if (!SPEEDS.includes(Number(speed)) && speed !== 'fit') return { ok: false, error: 'Unsupported speed.' };
  tick(review, now); // settle the clock at the OLD speed first
  if (speed === 'fit') { // "Auto-fit": whole review plays in ~45 seconds from where it is now
    const left = totalSecondsLeft(review);
    review.speed = Math.max(1, left / 45);
  } else review.speed = Number(speed);
  logEvent(review, `Speed set to ${speed === 'fit' ? 'auto-fit' : speed + 'x'}`, now);
  return { ok: true };
}
function setPaused(review, paused, now) {
  tick(review, now);
  review.paused = !!paused;
  logEvent(review, paused ? 'Paused' : 'Resumed', now);
  return { ok: true };
}
function setTimers(review, { totalSeconds, timers }, now) {
  let t;
  if (Array.isArray(timers)) {
    if (timers.length !== 5) return { ok: false, error: 'Please give a time for each of the 5 stages.' };
    t = timers.map((n) => (typeof n === 'object' ? fromDHMS(n) : Number(n)));
    if (t.some((n) => n === null || !Number.isFinite(n) || n < 1)) return { ok: false, error: 'Every stage needs a valid time (minutes up to 59, seconds up to 59).' };
  } else {
    const total = Number(totalSeconds);
    if (!Number.isFinite(total) || total < MIN_TOTAL_SECONDS) return { ok: false, error: 'That total time is too short.' };
    t = splitTotal(Math.floor(total));
  }
  if (t.reduce((a, b) => a + b, 0) > MAX_TOTAL_SECONDS) return { ok: false, error: 'The total review time cannot exceed 60 days.' };
  if (review.current_stage >= DONE) return { ok: false, error: 'This review has already finished.' };
  tick(review, now);
  review.timers_seconds = t.map((n) => Math.floor(n));
  review.stage_elapsed = Math.min(review.stage_elapsed, review.timers_seconds[review.current_stage - 1] - 1);
  logEvent(review, 'Timers updated', now);
  return { ok: true };
}
function setShowTime(review, on, now) {
  review.show_time_to_seller = !!on;
  logEvent(review, on ? 'Estimated time shown to the seller' : 'Estimated time hidden from the seller', now);
  return { ok: true };
}
function skipStage(review, now) {
  if (review.current_stage >= DONE) return { ok: false, error: 'This review has already finished.' };
  tick(review, now);
  review.current_stage += 1; review.checks_done = 0; review.stage_elapsed = 0;
  let completed = false;
  if (review.current_stage >= DONE) { review.completed_at = new Date(now).toISOString(); completed = true; logEvent(review, 'Review complete (stage skipped)', now); }
  else logEvent(review, `Stage skipped — now on stage ${review.current_stage}`, now);
  return { ok: true, completed };
}
function restart(review, now) {
  const fresh = createReview({ mode: review.mode, timers: review.timers_seconds, now });
  fresh.show_time_to_seller = review.show_time_to_seller;
  fresh.speed = 1;
  fresh.log = (review.log || []).concat([{ at: new Date(now).toISOString(), event: 'Restarted from stage 1' }]).slice(-60);
  Object.keys(review).forEach((k) => delete review[k]);
  Object.assign(review, fresh);
  return { ok: true };
}
function confirmCheck(review, now) {
  if (review.mode !== 'manual') return { ok: false, error: 'Switch to manual review to confirm checks yourself.' };
  if (review.current_stage >= DONE) return { ok: false, error: 'This review has already finished.' };
  const n = CHECKS_PER_STAGE[review.current_stage - 1];
  if (review.checks_done >= n) return { ok: false, error: 'Every check in this stage is already confirmed — approve the stage.' };
  review.checks_done += 1;
  logEvent(review, `Check confirmed: ${STAGES[review.current_stage - 1].checks[review.checks_done - 1]}`, now);
  return { ok: true };
}
function approveStage(review, now) {
  if (review.mode !== 'manual') return { ok: false, error: 'Stage approval is only used in manual review.' };
  if (review.current_stage >= DONE) return { ok: false, error: 'This review has already finished.' };
  if (review.checks_done < CHECKS_PER_STAGE[review.current_stage - 1]) return { ok: false, error: 'Confirm every check in this stage before approving it.' };
  review.current_stage += 1; review.checks_done = 0; review.stage_elapsed = 0;
  let completed = false;
  if (review.current_stage >= DONE) { review.completed_at = new Date(now).toISOString(); completed = true; logEvent(review, 'Review complete', now); }
  else logEvent(review, `Stage approved — now on stage ${review.current_stage}`, now);
  return { ok: true, completed };
}
/** Marks a review finished (used when an admin releases the funds directly). */
function forceComplete(review, now, note) {
  if (!review || review.current_stage >= DONE) return;
  review.current_stage = DONE; review.checks_done = 0; review.stage_elapsed = 0;
  review.completed_at = new Date(now).toISOString();
  logEvent(review, note || 'Completed by the Desk', now);
}

// ---------------- Views ----------------
function stageList(review) {
  return STAGES.map((s, i) => ({
    n: i + 1, key: s.key, title: s.title, team: s.team, checks: s.checks,
    status: (i + 1) < review.current_stage ? 'passed' : (i + 1) === review.current_stage ? 'in_review' : 'queued'
  }));
}

/** What a seller is allowed to see. NO timers, speeds, modes or settings — ever. */
function sellerView(review, { accountId } = {}) {
  if (!review) return null;
  const stage = review.current_stage;
  const stages = stageList(review).map((s) => {
    const checks = s.checks.map((label, ci) => {
      let text = label;
      if (s.key === 'confirmed' && ci === 1 && accountId) text = `Funds transferred to the seller account ${accountId}`;
      // Check detail is shown only for stages that have actually started — a queued stage reveals nothing.
      return { text, done: s.status === 'passed' || (s.status === 'in_review' && ci < review.checks_done) };
    });
    return { n: s.n, title: s.title, team: s.team, status: s.status, checks: s.status === 'queued' ? [] : checks };
  });
  const view = {
    statusLine: STATUS_TEXT[stage] || STATUS_TEXT[1],
    stage, finished: stage >= DONE, stages,
    vault: stage >= DONE ? 'credited' : 'pending'
  };
  if (review.show_time_to_seller && stage < DONE) {
    const length = review.timers_seconds[stage - 1];
    view.activeStageTimeLeft = Math.max(0, Math.ceil(length - review.stage_elapsed));
  }
  return view;
}

/** Full record for the admin console. */
function adminView(review, { accountId } = {}) {
  if (!review) return null;
  return {
    ...sellerView(review, { accountId }),
    activeStageTimeLeft: undefined,
    mode: review.mode, paused: !!review.paused, speed: review.speed, showTimeToSeller: !!review.show_time_to_seller,
    timersSeconds: review.timers_seconds, timersDhms: review.timers_seconds.map(toDHMS),
    stageElapsed: Math.floor(review.stage_elapsed), totalSecondsLeft: totalSecondsLeft(review),
    checksDone: review.checks_done, checksPerStage: CHECKS_PER_STAGE, weights: WEIGHTS,
    startedAt: review.started_at, completedAt: review.completed_at, log: (review.log || []).slice(-12)
  };
}

module.exports = {
  STAGES, WEIGHTS, CHECKS_PER_STAGE, DONE, SPEEDS, QUICK_DURATIONS, MIN_TOTAL_SECONDS,
  splitTotal, toDHMS, fromDHMS, createReview, tick, totalSecondsLeft,
  setMode, setSpeed, setPaused, setTimers, setShowTime, skipStage, restart, confirmCheck, approveStage, forceComplete,
  sellerView, adminView
};
