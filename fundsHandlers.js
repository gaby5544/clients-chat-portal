// Money movement for the seller Transaction Account — everything an admin does
// to a seller's funds lives here:
//   * record incoming funds (who paid, what for, how much), run each held payment
//     through the 5-stage escrow review (escrow.js), release / reverse it
//   * move a withdrawal through its four stages: pending -> processing -> completed,
//     or declined (with a reason) — the admin may pick any stage
//   * the read-only "Funds Desk" queries that let an admin open ANY seller's account
//
// Only ADMIN / SUPER_ADMIN may do any of this (Moderators cannot), and every change
// is pushed live to the seller's own private room and to the 'finance-admins' room —
// never to the Buyer or a Moderator. (A Desk note the admin chooses to release to the
// buyer is the one deliberate exception, delivered as a buyer-only chat message.)

const { store } = require('./db');
const { sanitizeText, escapeHtml, isValidEmail, RateLimiter } = require('./security');
const F = require('./finance');
const Escrow = require('./escrow');
const { sendPushToUser } = require('./webpush');
const { notifyIncomingFunds, notifyWithdrawalStatus, notifyDeskNote } = require('./email');
const N = require('./notifyService');

const financeLimiter = new RateLimiter({ windowMs: 60000, max: 60 });
setInterval(() => financeLimiter.sweep(), 60000).unref();

const METHODS = new Set(['bank_transfer', 'wire', 'crypto', 'card', 'cheque', 'cash', 'other']);
const MAX_AMOUNT = 999999999.99;

// Withdrawal stages the admin can choose from (older 'held_in_vault'/'failed' rows are normalised on read).
const WD_STAGES = ['pending', 'processing', 'completed', 'rejected'];
const WD_LABEL = { pending: 'Pending', processing: 'Processing', completed: 'Completed', rejected: 'Declined' };
const WD_DEFAULT_NOTE = { pending: 'Request received — awaiting review', processing: 'Approved — payout in progress', completed: 'Payout sent' };

const fmt = F.fmtFull;

function activeSocketsOf(io) { return io._activeSockets || new Map(); }

// ---------------- Snapshots ----------------
async function sellerSnapshot(groupId) {
  const g = await store.getGroup(groupId);
  if (!g) return null;
  const [deps, wds, inc] = await Promise.all([
    store.getDepositsForGroup(groupId), store.getWithdrawalsForGroup(groupId), store.getIncomingFundsForGroup(groupId)
  ]);
  const opts = { accountId: g.seller_account_id };
  return {
    account: F.publicSellerAccount(g),
    deposits: deps.map(F.publicDeposit),
    withdrawals: wds.map((w) => F.publicWithdrawal(w)),
    incoming: inc.map((i) => F.publicIncoming(i, false, opts))
  };
}

function summaryOf(g, counts) {
  const c = require('./public/countries.js').byName(g.seller_country);
  return {
    groupId: g.id,
    groupName: g.name,
    sellerName: g.seller_full_name || g.custom_name_b || 'Seller',
    email: g.email_b || null,
    registered: !!g.seller_registered,
    currency: g.seller_currency || null,
    kycStatus: g.kyc_status,
    accountId: g.seller_account_id || null,
    country: g.seller_country || null,
    countryCode: c ? c.code : null,
    disabled: !!g.seller_disabled,
    disbursementEnabled: !!g.disbursement_enabled,
    businessStatus: g.business_status || 'none',
    balances: {
      available: Number(g.balance_available || 0),
      held: Number(g.balance_held || 0),
      totalDeposited: Number(g.total_deposited || 0)
    },
    activeWithdrawals: counts.activeWithdrawals || 0,
    heldIncoming: counts.heldIncoming || 0,
    pendingDeposits: counts.pendingDeposits || 0
  };
}

async function adminLedger(g) {
  const [deps, wds, inc] = await Promise.all([
    store.getDepositsForGroup(g.id), store.getWithdrawalsForGroup(g.id), store.getIncomingFundsForGroup(g.id)
  ]);
  const counts = {
    activeWithdrawals: wds.filter((w) => ['pending', 'held_in_vault', 'processing'].includes(w.status)).length,
    heldIncoming: inc.filter((i) => i.status === 'held_in_vault').length,
    pendingDeposits: deps.filter((d) => d.status === 'held_in_vault').length
  };
  const opts = { accountId: g.seller_account_id };
  return {
    ledger: {
      groupId: g.id,
      account: F.publicSellerAccount(g, { forAdmin: true }),
      deposits: deps.map(F.publicDeposit),
      withdrawals: wds.map((w) => F.publicWithdrawal(w, { forAdmin: true })),
      incoming: inc.map((i) => F.publicIncoming(i, true, opts))
    },
    summary: summaryOf(g, counts)
  };
}

async function pushAdminLedger(io, groupId) {
  const g = await store.getGroup(groupId);
  if (!g) return;
  const { ledger, summary } = await adminLedger(g);
  io.to('finance-admins').emit('funds-desk-ledger', ledger);
  io.to('finance-admins').emit('funds-desk-summary', summary);
}

// Push the seller's full, current state to everything allowed to see it: the
// seller's own private room, any finance admin sitting in that group's chat, and
// the Funds Desk. `notice` (optional) is a popup line for the seller. Sending whole
// lists (not deltas) means the seller's screen can never drift from what the admin did.
async function pushSellerState(io, groupId, notice) {
  const snap = await sellerSnapshot(groupId);
  if (!snap) return;
  const emitAll = (target) => {
    target.emit('seller-account-state', snap.account);
    target.emit('deposits-list', { groupId, deposits: snap.deposits });
    target.emit('incoming-list', { groupId, incoming: snap.incoming });
    target.emit('withdrawals-list', { groupId, withdrawals: snap.withdrawals });
  };
  emitAll(io.to(`seller:${groupId}`));
  for (const [sockId, v] of activeSocketsOf(io)) {
    if (v.groupId === groupId && v.isAdmin && (v.adminRole === 'ADMIN' || v.adminRole === 'SUPER_ADMIN')) {
      const s = io.sockets.sockets.get(sockId);
      if (s) emitAll(s);
    }
  }
  if (notice) io.to(`seller:${groupId}`).emit('seller-notice', notice);
  await pushAdminLedger(io, groupId);
}

async function emitSnapshotTo(socket, groupId) {
  const snap = await sellerSnapshot(groupId);
  if (!snap) return;
  socket.emit('seller-account-state', snap.account);
  socket.emit('deposits-list', { groupId, deposits: snap.deposits });
  socket.emit('incoming-list', { groupId, incoming: snap.incoming });
  socket.emit('withdrawals-list', { groupId, withdrawals: snap.withdrawals });
}

async function alertSeller(io, group, { title, body }) {
  const token = group.seller_session_token;
  if (token && !N.isOnline(io, token)) await N.pushToToken(token, { title, body, url: '/' });
}

// ---------------- Input validation for "record incoming funds" ----------------
function parseEscrowSettings(p, now = Date.now()) {
  const e = p.escrow || {};
  const mode = e.mode === 'manual' ? 'manual' : 'auto';
  let totalSeconds = Escrow.QUICK_DURATIONS['1d'];
  if (e.completeBy) {
    const d = new Date(e.completeBy);
    if (Number.isNaN(d.getTime())) return { error: 'The "complete by" date for the escrow review is not valid.' };
    totalSeconds = Math.floor((d.getTime() - now) / 1000);
    if (totalSeconds < Escrow.MIN_TOTAL_SECONDS || totalSeconds > 60 * 86400) return { error: 'The escrow review "complete by" time must be between a few seconds and 60 days from now.' };
  } else if (e.quick && Escrow.QUICK_DURATIONS[e.quick]) totalSeconds = Escrow.QUICK_DURATIONS[e.quick];
  else if (Number.isFinite(Number(e.totalSeconds)) && Number(e.totalSeconds) >= 5) totalSeconds = Math.min(60 * 86400, Math.floor(Number(e.totalSeconds)));
  return { mode, totalSeconds, showTime: !!e.showTime };
}

function parseIncoming(p, group) {
  const payerName = sanitizeText(p.payerName, 200);
  if (!payerName) return { error: 'Please enter who the payment is from.' };
  const purpose = sanitizeText(p.purpose, 500);
  if (!purpose) return { error: 'Please describe what the payment is for.' };
  if (!METHODS.has(p.method)) return { error: 'Please choose a payment method.' };
  let asset = null; let network = null;
  if (p.method === 'crypto') {
    if (!F.CRYPTO_ASSETS.has(p.asset)) return { error: 'Please choose the crypto asset received.' };
    asset = p.asset;
    network = sanitizeText(p.network, 20) || null;
  }
  const amount = F.round2(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Please enter a valid amount.' };
  if (amount > MAX_AMOUNT) return { error: 'That amount is above the maximum allowed for a single entry.' };
  const amountCurrency = F.CURRENCIES.has(p.amountCurrency) ? p.amountCurrency : group.seller_currency;
  const fxRate = F.fxRate(amountCurrency, group.seller_currency);
  const amountLedger = F.convertCurrency(amount, amountCurrency, group.seller_currency);
  if (amountLedger <= 0) return { error: 'That amount is too small once converted to the seller\'s currency.' };
  if (!['credit', 'hold'].includes(p.treatment)) return { error: 'Please choose whether to credit the funds now or hold them in the vault.' };

  let receivedAt = new Date().toISOString();
  if (p.receivedAt) {
    const d = new Date(p.receivedAt);
    if (Number.isNaN(d.getTime())) return { error: 'The received date is not valid.' };
    if (d.getTime() > Date.now() + 24 * 3600 * 1000) return { error: 'The received date cannot be in the future.' };
    if (d.getFullYear() < 2000) return { error: 'The received date is not valid.' };
    receivedAt = d.toISOString();
  }
  const payerEmail = p.payerEmail ? sanitizeText(p.payerEmail, 254) : '';
  if (payerEmail && !isValidEmail(payerEmail)) return { error: 'The payer email does not look valid.' };
  const proofUrl = typeof p.proofUrl === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(p.proofUrl) ? p.proofUrl : null;
  const internalNote = sanitizeText(p.internalNote, 1000) || null;

  let escrow = null;
  if (p.treatment === 'hold') {
    escrow = parseEscrowSettings(p);
    if (escrow.error) return { error: escrow.error };
  }
  return {
    value: {
      payerName, purpose, method: p.method, asset, network,
      amount, amountCurrency, fxRate, amountLedger, treatment: p.treatment, receivedAt,
      payerEmail: payerEmail || null, payerCountry: sanitizeText(p.payerCountry, 100) || null,
      payerCompany: sanitizeText(p.payerCompany, 200) || null, payerPhone: sanitizeText(p.payerPhone, 40) || null,
      payerBank: sanitizeText(p.payerBank, 200) || null, orderRef: sanitizeText(p.orderRef, 120) || null,
      externalRef: sanitizeText(p.externalRef, 200) || null,
      internalNote, buyerVisibleNote: !!(internalNote && p.buyerVisibleNote), proofUrl,
      notifySeller: p.notifySeller !== false, escrow
    }
  };
}

// ---------------- Releasing funds (shared by the admin button and the escrow timer) ----------------
const locks = new Map(); // record id -> promise chain (one mutation at a time per payment, in this process)
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(id, next);
  next.finally(() => { if (locks.get(id) === next) locks.delete(id); }).catch(() => {});
  return next;
}

/**
 * Move a held payment into the seller's available balance. Used when an admin
 * clicks Release and when the escrow review reaches its final stage.
 * Returns { ok, error?, rec }.
 */
async function releaseIncoming(io, rec, { by = null, note = null } = {}) {
  const group = await store.getGroup(rec.group_id);
  if (!group) return { ok: false, error: 'Group not found.' };
  if (rec.status !== 'held_in_vault') return { ok: false, error: 'Only funds held in the vault can be released.' };
  const L = Number(rec.amount_ledger);
  const moved = await store.adjustBalances(group.id, { held: -L, available: L });
  if (!moved) return { ok: false, error: 'The seller\'s balance no longer covers this change.' };
  const updated = await store.advanceIncomingFunds(rec.id, { status: 'credited', reason: note || 'Cleared and released to your available balance', by, expectedStatus: 'held_in_vault' });
  if (!updated) { await store.adjustBalances(group.id, { held: L, available: -L }); return { ok: false, error: 'This entry was changed by someone else. Please review its current status.' }; }
  // Mark the review finished so the tracker shows every stage as passed.
  if (updated.review && updated.review.current_stage < Escrow.DONE) {
    Escrow.forceComplete(updated.review, Date.now(), 'Funds released');
    await store.updateIncomingReview(updated.id, updated.review);
  }
  const amountText = rec.amount_currency === group.seller_currency ? fmt(rec.amount, rec.amount_currency) : `${fmt(rec.amount, rec.amount_currency)} (≈ ${fmt(L, group.seller_currency)})`;
  const title = 'Funds released to your balance';
  const body = `${amountText} from ${rec.payer_name}`;
  await pushSellerState(io, group.id, { kind: 'incoming', title, body, id: rec.id });
  await alertSeller(io, group, { title, body });
  if (group.email_b) await notifyIncomingFunds(group.email_b, { groupName: group.name, amountText, payerName: rec.payer_name, purpose: rec.purpose, status: 'released', name: group.seller_full_name, lang: group.seller_language });
  return { ok: true, rec: updated };
}

// ---------------- Escrow review: timer loop ----------------
let escrowLoopStarted = false;
function startEscrowLoop(io) {
  if (escrowLoopStarted) return;
  escrowLoopStarted = true;
  const run = async () => {
    let records = [];
    try { records = await store.getActiveReviewRecords(); } catch (e) { return; }
    for (const rec of records) {
      withLock(rec.id, async () => {
        const fresh = await store.getIncomingFundsById(rec.id);
        if (!fresh || fresh.status !== 'held_in_vault' || !fresh.review) return;
        const prevStage = fresh.review.current_stage;
        const out = Escrow.tick(fresh.review, Date.now());
        if (!out.changed) return;
        await store.updateIncomingReview(fresh.id, fresh.review);
        const group = await store.getGroup(fresh.group_id);
        if (out.completed) {
          const res = await releaseIncoming(io, fresh, { by: null, note: 'Escrow review complete — funds credited' });
          if (!res.ok) { console.warn('[escrow] auto-release failed:', res.error); await pushSellerState(io, fresh.group_id, null); }
        } else if (fresh.review.current_stage !== prevStage && group) {
          const stage = Escrow.STAGES[fresh.review.current_stage - 1];
          const body = `Your payment of ${fmt(fresh.amount, fresh.amount_currency)} from ${fresh.payer_name} is now at: ${stage.title}.`;
          await pushSellerState(io, fresh.group_id, { kind: 'escrow', title: 'Payment update', body, id: fresh.id });
          await alertSeller(io, group, { title: 'Payment update', body });
        } else {
          await pushSellerState(io, fresh.group_id, null);
        }
      }).catch((e) => console.error('[escrow] tick error:', e.message));
    }
  };
  setInterval(run, 3000).unref();
}

function registerFundsHandlers(io, socket, ctx) {
  const { meta, metaHasMinRole } = ctx;

  // ADMIN+ only, and rate-limited: this moves money.
  function guard() {
    if (!metaHasMinRole('ADMIN')) return false;
    if (!financeLimiter.allow(meta().sessionToken)) { socket.emit('error-msg', 'Too many actions — please wait a moment and try again.'); return false; }
    return true;
  }

  // ---- Funds Desk: read ----
  socket.on('admin-get-funds-overview', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const [groups, pendingWds, heldInc, pendingDeps] = await Promise.all([
      store.getAllGroups(), store.getPendingWithdrawals(), store.getIncomingFundsByStatus('held_in_vault'), store.getPendingDeposits()
    ]);
    const tally = (list) => list.reduce((m, r) => { m[r.group_id] = (m[r.group_id] || 0) + 1; return m; }, {});
    const w = tally(pendingWds); const h = tally(heldInc); const d = tally(pendingDeps);
    socket.emit('funds-overview', groups.map((g) => summaryOf(g, { activeWithdrawals: w[g.id], heldIncoming: h[g.id], pendingDeposits: d[g.id] })));
  });

  socket.on('admin-get-seller-ledger', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const g = await store.getGroup(String(groupId || ''));
    if (!g) return socket.emit('error-msg', 'That group no longer exists.');
    const { ledger, summary } = await adminLedger(g);
    socket.emit('funds-desk-ledger', ledger);
    socket.emit('funds-desk-summary', summary);
  });

  // ---- Record incoming funds ----
  socket.on('admin-record-incoming-funds', async (payload) => {
    try {
      if (!guard()) return;
      const p = payload || {};
      const group = await store.getGroup(String(p.groupId || ''));
      if (!group) return socket.emit('error-msg', 'That group no longer exists.');
      if (!group.seller_registered || !group.seller_currency) {
        return socket.emit('error-msg', 'This seller has not created their Transaction Account yet — funds can be recorded once they have.');
      }
      const { error, value: v } = parseIncoming(p, group);
      if (error) return socket.emit('error-msg', error);

      const credited = v.treatment === 'credit';
      const L = v.amountLedger;
      const moved = await store.adjustBalances(group.id, credited ? { available: L, total: L } : { held: L, total: L });
      if (!moved) return socket.emit('error-msg', 'Could not update the seller\'s balance. Nothing was recorded.');

      // Every recorded payment gets a review: a held one starts running; a credited one is shown already complete.
      const review = credited
        ? Escrow.createReview({ completed: true })
        : Escrow.createReview({ mode: v.escrow.mode, totalSeconds: v.escrow.totalSeconds });
      if (!credited) review.show_time_to_seller = !!v.escrow.showTime;

      let rec;
      try {
        rec = await store.createIncomingFunds({
          groupId: group.id, payerName: v.payerName, payerEmail: v.payerEmail, payerCountry: v.payerCountry,
          payerCompany: v.payerCompany, payerPhone: v.payerPhone, payerBank: v.payerBank, orderRef: v.orderRef,
          purpose: v.purpose, method: v.method, asset: v.asset, network: v.network, externalRef: v.externalRef,
          amount: v.amount, amountCurrency: v.amountCurrency, amountLedger: L, fxRate: v.fxRate,
          receivedAt: v.receivedAt, status: credited ? 'credited' : 'held_in_vault',
          historyNote: credited ? 'Funds received and credited to your available balance' : 'Funds received — held in the vault while the payment is reviewed',
          proofUrl: v.proofUrl, internalNote: v.internalNote, buyerVisibleNote: v.buyerVisibleNote,
          recordedBy: meta().sessionToken, review
        });
      } catch (err) {
        await store.adjustBalances(group.id, credited ? { available: -L, total: -L } : { held: -L, total: -L }); // undo — no record, no money
        throw err;
      }

      const amountText = v.amountCurrency === group.seller_currency
        ? fmt(v.amount, v.amountCurrency)
        : `${fmt(v.amount, v.amountCurrency)} (≈ ${fmt(L, group.seller_currency)})`;
      const title = credited ? 'Funds received' : 'Funds received — held in vault';
      const body = `${amountText} from ${v.payerName} — ${v.purpose}`;
      await pushSellerState(io, group.id, v.notifySeller ? { kind: 'incoming', title, body, id: rec.id } : null);
      socket.emit('incoming-funds-recorded', { id: rec.id, ref: F.refFor('incoming', rec.id), groupId: group.id });
      if (v.notifySeller) {
        await alertSeller(io, group, { title, body });
        if (group.email_b) await notifyIncomingFunds(group.email_b, { groupName: group.name, amountText, payerName: v.payerName, purpose: v.purpose, status: rec.status, name: group.seller_full_name, lang: group.seller_language });
      }

      // Optional: release the internal note to the buyer as a buyer-only message in the group chat.
      if (v.internalNote && v.buyerVisibleNote) {
        const noteMsg = await store.insertMessage({
          id: 'desk-' + Date.now() + Math.random().toString(36).slice(2, 6),
          groupId: group.id, senderName: 'DESK NOTE',
          text: escapeHtml(`📝 Note from the Desk: ${v.internalNote}`), audience: 'buyer'
        });
        if (ctx.publicMessage) N.emitToAudience(io, group.id, 'buyer', 'message', await ctx.publicMessage(noteMsg));
        if (group.buyer_session_token && !N.isOnline(io, group.buyer_session_token)) {
          await N.pushToToken(group.buyer_session_token, { title: 'Note from the Desk', body: v.internalNote.slice(0, 160), url: '/' });
        }
        if (group.email_a) notifyDeskNote(group.email_a, { groupName: group.name, note: v.internalNote }).catch(() => {});
      }
    } catch (err) {
      console.error('[admin-record-incoming-funds] error:', err);
      socket.emit('error-msg', 'Something went wrong recording those funds. Please check the seller\'s ledger before retrying.');
    }
  });

  // ---- Release / reverse recorded funds ----
  socket.on('admin-update-incoming-funds', async ({ id, action, reason }) => {
    try {
      if (!guard()) return;
      await withLock(String(id || ''), async () => {
        const rec = await store.getIncomingFundsById(String(id || ''));
        if (!rec) return socket.emit('error-msg', 'That entry no longer exists.');
        const group = await store.getGroup(rec.group_id);
        if (!group) return;
        const L = Number(rec.amount_ledger);
        const from = rec.status;
        const note = sanitizeText(reason, 500);
        const by = meta().sessionToken;

        if (action === 'release') {
          const res = await releaseIncoming(io, rec, { by, note: note || null });
          if (!res.ok) socket.emit('error-msg', res.error);
          return;
        }
        if (action !== 'reverse') return;
        if (!['held_in_vault', 'credited'].includes(from)) return socket.emit('error-msg', 'This entry has already been reversed.');
        if (!note) return socket.emit('error-msg', 'A reason is required to reverse funds.');
        const adj = from === 'credited' ? { available: -L, total: -L } : { held: -L, total: -L };
        const undo = from === 'credited' ? { available: L, total: L } : { held: L, total: L };
        const moved = await store.adjustBalances(group.id, adj);
        if (!moved) {
          return socket.emit('error-msg', from === 'credited'
            ? 'The seller has already withdrawn or reserved part of these funds — their available balance is too low to reverse this credit.'
            : 'The seller\'s balance no longer covers this change.');
        }
        const updated = await store.advanceIncomingFunds(rec.id, { status: 'reversed', reason: note, by, expectedStatus: from });
        if (!updated) { await store.adjustBalances(group.id, undo); return socket.emit('error-msg', 'This entry was changed by someone else. Please review its current status.'); }
        const amountText = rec.amount_currency === group.seller_currency ? fmt(rec.amount, rec.amount_currency) : `${fmt(rec.amount, rec.amount_currency)} (≈ ${fmt(L, group.seller_currency)})`;
        const title = 'Incoming payment reversed';
        const body = `${amountText} from ${rec.payer_name} — ${note}`;
        await pushSellerState(io, group.id, { kind: 'incoming', title, body, id: rec.id });
        await alertSeller(io, group, { title, body });
        if (group.email_b) await notifyIncomingFunds(group.email_b, { groupName: group.name, amountText, payerName: rec.payer_name, purpose: rec.purpose, status: 'reversed', reason: note, name: group.seller_full_name, lang: group.seller_language });
      });
    } catch (err) {
      console.error('[admin-update-incoming-funds] error:', err);
      socket.emit('error-msg', 'Something went wrong updating that entry. Please check the ledger.');
    }
  });

  // ---- Escrow review console (admin only) ----
  socket.on('admin-escrow-action', async ({ id, action, value }) => {
    try {
      if (!guard()) return;
      await withLock(String(id || ''), async () => {
        const rec = await store.getIncomingFundsById(String(id || ''));
        if (!rec || !rec.review) return socket.emit('error-msg', 'That payment has no escrow review.');
        if (rec.status !== 'held_in_vault') return socket.emit('error-msg', 'The escrow review only runs while the funds are held in the vault.');
        const now = Date.now();
        const review = rec.review;
        let res;
        switch (action) {
          case 'mode': res = Escrow.setMode(review, value, now); break;
          case 'speed': res = Escrow.setSpeed(review, value, now); break;
          case 'pause': res = Escrow.setPaused(review, true, now); break;
          case 'resume': res = Escrow.setPaused(review, false, now); break;
          case 'show-time': res = Escrow.setShowTime(review, !!value, now); break;
          case 'skip': res = Escrow.skipStage(review, now); break;
          case 'restart': res = Escrow.restart(review, now); break;
          case 'confirm-check': res = Escrow.confirmCheck(review, now); break;
          case 'approve-stage': res = Escrow.approveStage(review, now); break;
          case 'timers': {
            const v = value || {};
            if (v.completeBy) {
              const d = new Date(v.completeBy);
              const total = Number.isNaN(d.getTime()) ? NaN : Math.floor((d.getTime() - now) / 1000);
              res = Escrow.setTimers(review, { totalSeconds: total }, now);
            } else if (v.quick && Escrow.QUICK_DURATIONS[v.quick]) res = Escrow.setTimers(review, { totalSeconds: Escrow.QUICK_DURATIONS[v.quick] }, now);
            else if (Array.isArray(v.perStage)) res = Escrow.setTimers(review, { timers: v.perStage }, now);
            else res = { ok: false, error: 'Please choose how long the review should take.' };
            break;
          }
          default: return;
        }
        if (!res.ok) return socket.emit('error-msg', res.error || 'That action could not be applied.');
        await store.updateIncomingReview(rec.id, review);
        if (res.completed) {
          const out = await releaseIncoming(io, { ...rec, review }, { by: meta().sessionToken, note: 'Escrow review complete — funds credited' });
          if (!out.ok) socket.emit('error-msg', out.error);
        } else {
          await pushSellerState(io, rec.group_id, null);
        }
      });
    } catch (err) {
      console.error('[admin-escrow-action] error:', err);
      socket.emit('error-msg', 'Something went wrong updating the escrow review.');
    }
  });

  // ---- Withdrawals: pending -> processing -> completed, or declined (any stage may be chosen) ----
  socket.on('admin-advance-withdrawal', async ({ withdrawalId, toStatus, reason }) => {
    try {
      if (!guard()) return;
      await withLock('wd:' + String(withdrawalId || ''), async () => {
        const wd = await store.getWithdrawalById(String(withdrawalId || ''));
        if (!wd) return socket.emit('error-msg', 'That withdrawal no longer exists.');
        const target = F.normalizeWdStatus(String(toStatus || ''));
        if (!WD_STAGES.includes(target)) return socket.emit('error-msg', 'Please choose a valid stage.');
        const from = F.normalizeWdStatus(wd.status);
        if (from === target) return socket.emit('error-msg', `This withdrawal is already ${WD_LABEL[target]}.`);
        if (from === 'completed') return socket.emit('error-msg', 'A completed withdrawal is final and cannot be changed.');
        if (from === 'rejected' && target === 'completed') return socket.emit('error-msg', 'A declined withdrawal must be reopened as Pending or Processing before it can be completed.');
        const note = sanitizeText(reason, 500);
        if (target === 'rejected' && !note) return socket.emit('error-msg', 'A reason is required to decline a withdrawal.');
        const group = await store.getGroup(wd.group_id);
        if (!group) return;
        const amt = F.round2(wd.amount_ledger);
        const by = meta().sessionToken;
        const reserved = !!wd.funds_reserved;

        // Balance movement (atomic + guarded). `reserved` = the amount is currently held out of "available".
        let adj = null; let undo = null; let nowReserved = reserved;
        if (target === 'pending' || target === 'processing') {
          if (!reserved) { adj = { available: -amt, held: amt }; undo = { available: amt, held: -amt }; nowReserved = true; }
        } else if (target === 'completed') {
          adj = reserved ? { held: -amt } : { available: -amt }; undo = reserved ? { held: amt } : { available: amt }; nowReserved = false;
        } else if (target === 'rejected') {
          if (reserved) { adj = { held: -amt, available: amt }; undo = { held: amt, available: -amt }; }
          nowReserved = false;
        }
        if (adj) {
          const moved = await store.adjustBalances(group.id, adj);
          if (!moved) {
            return socket.emit('error-msg', target === 'completed' || reserved
              ? 'The seller\'s held balance does not cover this change — please check the ledger.'
              : 'The seller no longer has enough available balance to cover this withdrawal.');
          }
        }
        const updated = await store.advanceWithdrawal(wd.id, {
          status: target, reason: target === 'rejected' ? note : (note || WD_DEFAULT_NOTE[target] || null), by,
          expectedStatus: wd.status, fundsReserved: nowReserved
        });
        if (!updated) {
          if (undo) await store.adjustBalances(group.id, undo);
          return socket.emit('error-msg', 'This withdrawal was changed by someone else. Please review its current status.');
        }

        const pub = F.publicWithdrawal(updated);
        const label = WD_LABEL[target];
        const title = 'Withdrawal update';
        const body = `${pub.ref} (${fmt(wd.amount, wd.amount_currency)}) is now ${label}${target === 'rejected' ? ` — ${note}` : ''}`;
        await pushSellerState(io, group.id, { kind: 'withdrawal', title, body, id: wd.id, status: target });
        io.to('finance-admins').emit('withdrawal-updated', F.publicWithdrawal(updated, { forAdmin: true }));
        if (['completed', 'rejected'].includes(target)) io.to('finance-admins').emit('withdrawal-resolved', F.publicWithdrawal(updated, { forAdmin: true }));
        await alertSeller(io, group, { title, body });
        if (group.email_b) await notifyWithdrawalStatus(group.email_b, { groupName: group.name, amount: wd.amount, currency: wd.amount_currency, status: target, reason: updated.status_reason, ref: pub.ref, name: group.seller_full_name, lang: group.seller_language });
        if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
      });
    } catch (err) {
      console.error('[admin-advance-withdrawal] error:', err);
      socket.emit('error-msg', 'Something went wrong updating that withdrawal. Please check the ledger.');
    }
  });
}

module.exports = {
  registerFundsHandlers, pushSellerState, pushAdminLedger, emitSnapshotTo, sellerSnapshot, adminLedger, summaryOf,
  startEscrowLoop, releaseIncoming, withLock, WD_STAGES, WD_LABEL
};
