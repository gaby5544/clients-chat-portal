// Live stage tracking for incoming funds.
//
//  * The ENGINE ticks every couple of seconds and advances every payment whose
//    tracker is in "auto" mode (respecting pause and the admin's speed-up).
//  * Admin controls (set timers/mode/speed, confirm a check, skip a stage) are
//    ADMIN+ socket events.
//  * When the last stage passes, the funds held in the seller's vault are
//    released to their available balance automatically — regardless of the
//    state of the underlying transaction.
//
// The seller only ever receives the sanitised shape from trackingDefs.publicTrack().

const { store } = require('./db');
const F = require('./finance');
const T = require('./trackingDefs');
const { RateLimiter } = require('./security');
const { notifyIncomingFunds } = require('./email');

const CCY_SYMBOL = { USD: '$', GBP: '£', EUR: '€' };
const fmt = (n, c) => `${CCY_SYMBOL[c] || ''}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${CCY_SYMBOL[c] ? '' : ' ' + c}`;

const lastTick = new Map();      // incoming id -> last tick (ms)
const lastPersist = new Map();   // incoming id -> last time elapsed was written (ms)
const finishing = new Set();     // ids currently being released (prevents double release)
const limiter = new RateLimiter({ windowMs: 60000, max: 60 });
setInterval(() => limiter.sweep(), 60000).unref();

const funds = () => require('./fundsHandlers'); // lazy: fundsHandlers requires this file's defs, not the reverse

function nowIso() { return new Date().toISOString(); }
function stageTimesWith(rec, stage) {
  const times = (rec.track_stage_times && typeof rec.track_stage_times === 'object') ? { ...rec.track_stage_times } : {};
  if (stage >= 1 && stage <= T.STAGE_COUNT && !times[stage]) times[stage] = nowIso();
  return times;
}

async function pushTrackUpdate(io, rec, group) {
  const g = group || await store.getGroup(rec.group_id);
  if (!g) return;
  io.to(`seller:${g.id}`).emit('incoming-track-update', { groupId: g.id, id: rec.id, status: rec.status, track: T.publicTrack(rec, { accountId: g.seller_account_id, phone: g.seller_phone }) });
  io.to('finance-admins').emit('incoming-track-update-admin', { groupId: g.id, id: rec.id, status: rec.status, track: T.publicTrack(rec, { accountId: g.seller_account_id, phone: g.seller_phone, forAdmin: true }) });
}

/**
 * All verification stages are done. By default the funds STAY in the seller's vault and wait for the Desk to
 * release them manually to the main account ("Release from vault"). Only payments recorded with automatic
 * release are credited here.
 */
async function finishTracking(io, rec) {
  if (finishing.has(rec.id)) return;
  finishing.add(rec.id);
  try {
    const group = await store.getGroup(rec.group_id);
    if (!group) return;
    const L = Number(rec.amount_ledger);
    const meta = (rec.meta && typeof rec.meta === 'object') ? rec.meta : (typeof rec.meta === 'string' ? (() => { try { return JSON.parse(rec.meta); } catch (e) { return {}; } })() : {});
    const amountText = rec.amount_currency === group.seller_currency ? fmt(rec.amount, rec.amount_currency) : `${fmt(rec.amount, rec.amount_currency)} (≈ ${fmt(L, group.seller_currency)})`;
    const fh = funds();

    if (!meta.autoRelease) {
      await store.updateIncomingFunds(rec.id, { track_stage: T.STAGE_COUNT + 1, track_check: 0, track_elapsed_ms: 0, track_finished_at: nowIso(), track_stage_times: stageTimesWith(rec, T.STAGE_COUNT) });
      const fresh = await store.getIncomingFundsById(rec.id);
      await pushTrackUpdate(io, fresh);
      const title = 'Verification complete — funds secured';
      const body = `${amountText} from ${rec.payer_name} has passed every verification stage and is secured in your vault. It will be released to your main account by the Desk.`;
      await fh.pushSellerState(io, group.id, { kind: 'incoming', title, body, id: rec.id });
      await fh.alertSellerOffline(io, group, { title, body });
      io.to('finance-admins').emit('toast-info', { message: `${F.refFor('incoming', rec.id)} finished verification — ready for you to release from the vault.` });
      if (group.email_b) await notifyIncomingFunds(group.email_b, { amountText, payerName: rec.payer_name, purpose: rec.purpose, status: 'awaiting_release', accountId: group.seller_account_id });
      return;
    }

    const moved = await store.adjustBalances(group.id, { held: -L, available: L });
    if (!moved) {
      await store.updateIncomingFunds(rec.id, { track_paused: true });
      io.to('finance-admins').emit('error-msg', `Tracker for ${F.refFor('incoming', rec.id)} could not release funds: the seller's vault balance does not cover it. It has been paused.`);
      return;
    }
    const updated = await store.advanceIncomingFunds(rec.id, { status: 'credited', reason: 'Funds credited to the seller', by: null, expectedStatus: 'held_in_vault' });
    if (!updated) { await store.adjustBalances(group.id, { held: L, available: -L }); return; }
    await store.updateIncomingFunds(rec.id, { track_stage: T.STAGE_COUNT + 1, track_check: 0, track_elapsed_ms: 0, track_finished_at: nowIso(), track_stage_times: stageTimesWith(rec, T.STAGE_COUNT) });
    const title = 'Funds credited to your account';
    const body = `${amountText} from ${rec.payer_name} is now available — Account ${group.seller_account_id || ''}`.trim();
    await fh.pushSellerState(io, group.id, { kind: 'incoming', title, body, id: rec.id });
    await fh.alertSellerOffline(io, group, { title, body });
    if (group.email_b) await notifyIncomingFunds(group.email_b, { amountText, payerName: rec.payer_name, purpose: rec.purpose, status: 'released', accountId: group.seller_account_id });
  } catch (err) {
    console.error('[tracking] finish error:', err);
  } finally {
    finishing.delete(rec.id);
  }
}

/** Advance one record by `ms` of (already speed-adjusted) progress. */
async function advanceBy(io, rec, ms) {
  const timers = T.timersOf(rec);
  let stage = Number(rec.track_stage) || 1;
  let elapsed = Number(rec.track_elapsed_ms || 0) + ms;
  const startStage = stage; const startCheck = Number(rec.track_check) || 0;
  let times = rec.track_stage_times;
  while (stage <= T.STAGE_COUNT && elapsed >= timers[stage - 1] * 1000) {
    elapsed -= timers[stage - 1] * 1000;
    stage += 1;
    if (stage <= T.STAGE_COUNT) { rec.track_stage_times = stageTimesWith({ track_stage_times: times }, stage); times = rec.track_stage_times; }
  }
  if (stage > T.STAGE_COUNT) {
    rec.track_stage = T.STAGE_COUNT; // stay on the last stage until the release below lands
    rec.track_check = T.STAGES[T.STAGE_COUNT - 1].checks.length;
    await store.updateIncomingFunds(rec.id, { track_stage: rec.track_stage, track_check: rec.track_check, track_elapsed_ms: 0, track_stage_times: times });
    await pushTrackUpdate(io, rec);
    return finishTracking(io, rec);
  }
  const n = T.STAGES[stage - 1].checks.length;
  const check = Math.min(n, Math.floor((elapsed / (timers[stage - 1] * 1000)) * n));
  const changed = stage !== startStage || check !== startCheck;
  rec.track_stage = stage; rec.track_check = check; rec.track_elapsed_ms = Math.floor(elapsed);
  const persistDue = Date.now() - (lastPersist.get(rec.id) || 0) > 30000;
  if (changed || persistDue) {
    await store.updateIncomingFunds(rec.id, { track_stage: stage, track_check: check, track_elapsed_ms: rec.track_elapsed_ms, track_stage_times: rec.track_stage_times || times });
    lastPersist.set(rec.id, Date.now());
  }
  if (changed) {
    await pushTrackUpdate(io, rec);
    if (stage !== startStage) {
      const g = await store.getGroup(rec.group_id);
      if (g) io.to(`seller:${g.id}`).emit('seller-notice', { kind: 'tracking', title: 'Payment update', body: `${F.refFor('incoming', rec.id)}: ${T.STAGES[stage - 1].title} is now in review.`, id: rec.id });
    }
  } else if (rec.track_show_timer) {
    // Countdown is local on the client between pushes, so nothing to send here.
  }
}

async function tick(io) {
  let list;
  try { list = await store.getActiveTrackedIncoming(); } catch (err) { console.error('[tracking] tick load failed:', err.message); return; }
  const now = Date.now();
  const alive = new Set(list.map((r) => r.id));
  for (const id of Array.from(lastTick.keys())) if (!alive.has(id)) { lastTick.delete(id); lastPersist.delete(id); }
  for (const rec of list) {
    const prev = lastTick.get(rec.id) || now;
    lastTick.set(rec.id, now);
    if (rec.track_mode !== 'auto' || rec.track_paused || finishing.has(rec.id)) continue;
    const dt = Math.min(Math.max(0, now - prev), 15000);
    if (dt <= 0) continue;
    try { await advanceBy(io, rec, dt * (Number(rec.track_speed) || 1)); }
    catch (err) { console.error('[tracking] advance error:', err); }
  }
}

function startTrackingEngine(io, intervalMs = 2000) {
  const h = setInterval(() => tick(io).catch((e) => console.error('[tracking] tick error:', e)), intervalMs);
  if (h.unref) h.unref();
  return { stop: () => clearInterval(h), tick: () => tick(io) };
}

// ---------------------------------------------------------------------------
// Admin controls (ADMIN / SUPER_ADMIN only)
// ---------------------------------------------------------------------------
function registerTrackingHandlers(io, socket, ctx) {
  const { meta, metaHasMinRole } = ctx;
  const guard = () => {
    if (!metaHasMinRole('ADMIN')) return false;
    const m = meta();
    if (!limiter.allow(m.sessionToken)) { socket.emit('error-msg', 'Too many actions — please wait a moment.'); return false; }
    return true;
  };
  async function load(id) {
    const rec = await store.getIncomingFundsById(String(id || ''));
    if (!rec) { socket.emit('error-msg', 'That payment no longer exists.'); return null; }
    if (!rec.track_enabled) { socket.emit('error-msg', 'Tracking is not enabled for this payment.'); return null; }
    if (rec.status !== 'held_in_vault' || rec.track_stage > T.STAGE_COUNT) { socket.emit('error-msg', 'This payment has already completed its tracking.'); return null; }
    return rec;
  }
  const done = async (rec) => { await funds().pushSellerState(io, rec.group_id, null); };

  socket.on('admin-tracking-set', async ({ id, mode, paused, speed, timers, totalSeconds, showTimer }) => {
    try {
      if (!guard()) return;
      const rec = await load(id); if (!rec) return;
      const patch = {};
      if (mode !== undefined) { if (!['auto', 'manual'].includes(mode)) return socket.emit('error-msg', 'Mode must be automatic or manual.'); patch.track_mode = mode; }
      if (paused !== undefined) patch.track_paused = !!paused;
      if (speed !== undefined) {
        const s = Number(speed);
        if (!Number.isFinite(s) || s < 1 || s > 86400) return socket.emit('error-msg', 'Speed must be between 1x and 86,400x.');
        patch.track_speed = s;
      }
      if (timers !== undefined) {
        const clean = T.cleanTimers(timers);
        if (!clean) return socket.emit('error-msg', `Each stage needs at least ${T.MIN_STAGE_SECONDS} seconds and the total cannot exceed 90 days.`);
        patch.track_timers = clean;
      } else if (totalSeconds !== undefined) {
        const tot = Number(totalSeconds);
        if (!Number.isFinite(tot) || tot < 60 || tot > T.MAX_TOTAL_SECONDS) return socket.emit('error-msg', 'Choose a total between 1 minute and 90 days.');
        patch.track_timers = T.splitTotal(tot);
      }
      if (showTimer !== undefined) patch.track_show_timer = !!showTimer;
      if (!Object.keys(patch).length) return;
      const updated = await store.updateIncomingFunds(rec.id, patch);
      lastTick.set(rec.id, Date.now());
      await done(updated || rec);
    } catch (err) { console.error('[admin-tracking-set]', err); socket.emit('error-msg', 'Could not update the tracker.'); }
  });

  // Manual mode: confirm the next check, or approve the stage once every check is done.
  socket.on('admin-tracking-confirm', async ({ id }) => {
    try {
      if (!guard()) return;
      const rec = await load(id); if (!rec) return;
      let stage = rec.track_stage; let check = Number(rec.track_check) || 0;
      const n = T.STAGES[stage - 1].checks.length;
      if (check < n) { check += 1; await store.updateIncomingFunds(rec.id, { track_check: check, track_elapsed_ms: 0 }); }
      else if (stage < T.STAGE_COUNT) { stage += 1; await store.updateIncomingFunds(rec.id, { track_stage: stage, track_check: 0, track_elapsed_ms: 0, track_stage_times: stageTimesWith(rec, stage) }); }
      else { const r = await store.getIncomingFundsById(rec.id); await done(r); return finishTracking(io, r); }
      const fresh = await store.getIncomingFundsById(rec.id);
      await done(fresh);
      if (fresh.track_stage !== rec.track_stage) {
        const g = await store.getGroup(rec.group_id);
        if (g) io.to(`seller:${g.id}`).emit('seller-notice', { kind: 'tracking', title: 'Payment update', body: `${F.refFor('incoming', rec.id)}: ${T.STAGES[fresh.track_stage - 1].title} is now in review.`, id: rec.id });
      }
    } catch (err) { console.error('[admin-tracking-confirm]', err); socket.emit('error-msg', 'Could not update the tracker.'); }
  });

  socket.on('admin-tracking-skip', async ({ id }) => {
    try {
      if (!guard()) return;
      const rec = await load(id); if (!rec) return;
      if (rec.track_stage >= T.STAGE_COUNT) { const r = await store.getIncomingFundsById(rec.id); await store.updateIncomingFunds(rec.id, { track_check: T.STAGES[T.STAGE_COUNT - 1].checks.length }); await done(r); return finishTracking(io, r); }
      const stage = rec.track_stage + 1;
      await store.updateIncomingFunds(rec.id, { track_stage: stage, track_check: 0, track_elapsed_ms: 0, track_stage_times: stageTimesWith(rec, stage) });
      const fresh = await store.getIncomingFundsById(rec.id);
      await done(fresh);
      const g = await store.getGroup(rec.group_id);
      if (g) io.to(`seller:${g.id}`).emit('seller-notice', { kind: 'tracking', title: 'Payment update', body: `${F.refFor('incoming', rec.id)}: ${T.STAGES[stage - 1].title} is now in review.`, id: rec.id });
    } catch (err) { console.error('[admin-tracking-skip]', err); socket.emit('error-msg', 'Could not update the tracker.'); }
  });
}

module.exports = { startTrackingEngine, registerTrackingHandlers, advanceBy, finishTracking, stageTimesWith, tick };
