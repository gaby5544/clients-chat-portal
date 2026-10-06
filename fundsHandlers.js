// Money movement for the seller Transaction Account — everything an admin does
// to a seller's funds lives here:
//   * record incoming funds (who paid, what for, how much) and release/reverse them
//   * move a withdrawal through pending -> held in vault -> processing -> completed,
//     or decline it (with a reason)
//   * the read-only "Funds Desk" queries that let an admin open ANY seller's account
//
// Only ADMIN / SUPER_ADMIN may do any of this (Moderators cannot), and every
// change is pushed live to the seller's own private room and to the
// 'finance-admins' room — never to the Buyer or a Moderator.

const { store } = require('./db');
const { sanitizeText, isValidEmail, RateLimiter } = require('./security');
const F = require('./finance');
const { sendPushToUser } = require('./webpush');
const { notifyIncomingFunds, notifyWithdrawalStatus } = require('./email');
const T = require('./trackingDefs');
const { localize } = require('./notifier');

const financeLimiter = new RateLimiter({ windowMs: 60000, max: 40 });
setInterval(() => financeLimiter.sweep(), 60000).unref();

const METHODS = new Set(['bank_transfer', 'wire', 'crypto', 'card', 'cheque', 'cash', 'other']);
const CCY_SYMBOL = { USD: '$', GBP: '£', EUR: '€' };
const MAX_AMOUNT = 999999999.99;

// Withdrawal statuses an admin can choose between (any of the four, at any time):
//   pending  · processing  -> funds sit in the seller's PENDING balance
//   completed              -> funds have left the account for good
//   declined               -> funds go straight back to the available balance
// Older rows may still carry held_in_vault / rejected / failed; they are treated as
// pending / declined.
const WD_STATUSES = ['pending', 'processing', 'declined', 'completed'];
const WITHDRAWAL_TRANSITIONS = {
  pending: ['processing', 'completed', 'declined'],
  processing: ['pending', 'completed', 'declined'],
  completed: ['pending', 'processing', 'declined'],
  declined: ['pending', 'processing', 'completed']
};
const canon = (s) => (s === 'held_in_vault' ? 'pending' : (s === 'rejected' || s === 'failed') ? 'declined' : s);
const bucketOf = (s) => ({ pending: 'pending', processing: 'pending', declined: 'available', completed: 'gone' }[canon(s)]);
const WD_LABEL = { pending: 'Pending', held_in_vault: 'Pending', processing: 'Processing', completed: 'Completed', declined: 'Declined', rejected: 'Declined', failed: 'Declined' };
const WD_DEFAULT_NOTE = {
  pending: 'Awaiting review',
  processing: 'Approved — payout in progress',
  completed: 'Payout sent',
  declined: null
};

function fmt(amount, ccy) {
  const n = Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return CCY_SYMBOL[ccy] ? `${CCY_SYMBOL[ccy]}${n}` : `${n} ${ccy}`;
}

function activeSocketsOf(io) { return io._activeSockets || new Map(); }
function isSellerOnline(io, token) {
  if (!token) return false;
  return Array.from(activeSocketsOf(io).values()).some((v) => v.sessionToken === token);
}

// ---------------- Snapshots ----------------
async function sellerSnapshot(groupId) {
  const g = await store.getGroup(groupId);
  if (!g) return null;
  const [deps, wds, inc] = await Promise.all([
    store.getDepositsForGroup(groupId), store.getWithdrawalsForGroup(groupId), store.getIncomingFundsForGroup(groupId)
  ]);
  return {
    account: F.publicSellerAccount(g),
    deposits: deps.map(F.publicDeposit),
    withdrawals: wds.map((w) => F.publicWithdrawal(w)),
    incoming: inc.map((i) => F.publicIncoming(i, false, g.seller_account_id))
  };
}

function summaryOf(g, counts) {
  return {
    groupId: g.id,
    groupName: g.name,
    sellerName: g.seller_full_name || g.custom_name_b || 'Seller',
    email: g.email_b || null,
    registered: !!g.seller_registered,
    currency: g.seller_currency || null,
    kycStatus: g.kyc_status,
    accountId: g.seller_account_id || null,
    accountType: g.seller_account_type || 'standard',
    country: g.seller_country || null,
    countryIso: g.seller_country_iso || null,
    phone: g.seller_phone || null,
    disabled: !!g.seller_disabled,
    disbursementEnabled: !!g.disbursement_enabled,
    businessStatus: g.business_status || 'none',
    balances: {
      available: Number(g.balance_available || 0),
      held: Number(g.balance_held || 0),
      pending: Number(g.balance_pending || 0),
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
  return {
    ledger: {
      groupId: g.id,
      account: F.publicSellerAccount(g, { forAdmin: true }),
      deposits: deps.map(F.publicDeposit),
      withdrawals: wds.map((w) => F.publicWithdrawal(w, { forAdmin: true })),
      incoming: inc.map((i) => F.publicIncoming(i, true, g.seller_account_id))
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

// Push the seller's full, current state to everything that is allowed to see
// it: the seller's own private room, any finance admin currently sitting in
// that group's chat, and the Funds Desk. `notice` (optional) is a popup line
// for the seller. Sending whole lists (not deltas) means the seller's screen
// can never drift out of step with what the admin just did.
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

// Direct (non-room) snapshot for one socket — used on join/refresh.
async function emitSnapshotTo(socket, groupId) {
  const snap = await sellerSnapshot(groupId);
  if (!snap) return;
  socket.emit('seller-account-state', snap.account);
  socket.emit('deposits-list', { groupId, deposits: snap.deposits });
  socket.emit('incoming-list', { groupId, incoming: snap.incoming });
  socket.emit('withdrawals-list', { groupId, withdrawals: snap.withdrawals });
}

async function alertSellerOffline(io, group, { title, body }) {
  const token = group.seller_session_token;
  if (token && !isSellerOnline(io, token)) {
    try {
      const lang = group.seller_language || 'en';
      const [tt, bb] = await Promise.all([localize(title, lang), localize(body, lang)]);
      await sendPushToUser(token, { title: tt, body: bb, url: '/?groupId=' + encodeURIComponent(group.id), tag: 'qsd-acct-' + group.id, requireInteraction: true });
    } catch (e) { /* push is best-effort */ }
  }
}

// ---------------- Input validation for "record incoming funds" ----------------
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
  const feeAmount = F.round2(Number(p.feeAmount || 0));
  if (!Number.isFinite(feeAmount) || feeAmount < 0) return { error: 'The fee must be zero or a positive amount.' };
  if (feeAmount >= amount) return { error: 'The fee must be smaller than the amount received.' };
  const fxRate = F.fxRate(amountCurrency, group.seller_currency);
  const amountLedger = F.convertCurrency(amount - feeAmount, amountCurrency, group.seller_currency); // net of fee
  if (amountLedger <= 0) return { error: 'That amount is too small once converted to the seller\'s currency.' };
  if (!['credit', 'hold', 'track'].includes(p.treatment)) return { error: 'Please choose how the funds should be handled.' };

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

  let track = null;
  if (p.treatment === 'track') {
    let timers = null;
    if (p.timers !== undefined && p.timers !== null) {
      timers = T.cleanTimers(p.timers);
      if (!timers) return { error: `Each tracking stage needs at least ${T.MIN_STAGE_SECONDS} seconds, and the total cannot exceed 90 days.` };
    } else if (p.totalSeconds !== undefined && p.totalSeconds !== null && p.totalSeconds !== '') {
      const tot = Number(p.totalSeconds);
      if (!Number.isFinite(tot) || tot < 60 || tot > T.MAX_TOTAL_SECONDS) return { error: 'Choose a tracking duration between 1 minute and 90 days.' };
      timers = T.splitTotal(tot);
    } else timers = T.defaultTimers();
    const mode = p.trackMode === 'manual' ? 'manual' : 'auto';
    track = { enabled: true, mode, stage: 1, check: 0, elapsedMs: 0, paused: false, speed: 1, timers, showTimer: !!p.showTimerToSeller, stageTimes: { 1: new Date().toISOString() } };
  }
  const internalNote = sanitizeText(p.internalNote, 1000) || null;

  return {
    value: {
      payerName, purpose, method: p.method, asset, network,
      amount, amountCurrency, fxRate, feeAmount, amountLedger, treatment: p.treatment, receivedAt,
      payerEmail: payerEmail || null, payerCountry: sanitizeText(p.payerCountry, 100) || null,
      externalRef: sanitizeText(p.externalRef, 200) || null,
      bankName: sanitizeText(p.bankName, 200) || null, senderAccount: sanitizeText(p.senderAccount, 100) || null,
      internalNote, noteSharedWithBuyer: !!(internalNote && p.shareNoteWithBuyer === true), proofUrl, track,
      notifySeller: p.notifySeller !== false
    }
  };
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
      let rec;
      try {
        rec = await store.createIncomingFunds({
          groupId: group.id, payerName: v.payerName, payerEmail: v.payerEmail, payerCountry: v.payerCountry,
          purpose: v.purpose, method: v.method, asset: v.asset, network: v.network, externalRef: v.externalRef,
          bankName: v.bankName, senderAccount: v.senderAccount, feeAmount: v.feeAmount, noteSharedWithBuyer: v.noteSharedWithBuyer,
          amount: v.amount, amountCurrency: v.amountCurrency, amountLedger: L, fxRate: v.fxRate,
          receivedAt: v.receivedAt, status: credited ? 'credited' : 'held_in_vault',
          historyNote: credited ? 'Funds received and credited to your available balance'
            : v.track ? 'Funds received — being verified and held in the vault until every stage is complete'
            : 'Funds received — held in the vault pending clearance',
          proofUrl: v.proofUrl, internalNote: v.internalNote, recordedBy: meta().sessionToken, track: v.track
        });
      } catch (err) {
        await store.adjustBalances(group.id, credited ? { available: -L, total: -L } : { held: -L, total: -L }); // undo — no record, no money
        throw err;
      }

      const amountText = v.amountCurrency === group.seller_currency
        ? fmt(v.amount, v.amountCurrency)
        : `${fmt(v.amount, v.amountCurrency)} (≈ ${fmt(L, group.seller_currency)})`;
      const title = credited ? 'Funds received' : 'Funds received — now being verified';
      const body = `${amountText} from ${v.payerName} — ${v.purpose}`;
      await pushSellerState(io, group.id, v.notifySeller ? { kind: 'incoming', title, body, id: rec.id } : null);
      socket.emit('incoming-funds-recorded', { id: rec.id, ref: F.refFor('incoming', rec.id), groupId: group.id });
      // "Internal note" visibility: only when the admin ticks the box does the buyer (and the group) see it.
      if (v.noteSharedWithBuyer && ctx.postDeskMessage) {
        await ctx.postDeskMessage(group.id, `DESK NOTE · Payment ${F.refFor('incoming', rec.id)}: ${v.internalNote}`);
      }
      if (v.notifySeller) {
        await alertSellerOffline(io, group, { title, body });
        if (group.email_b) await notifyIncomingFunds(group.email_b, { groupName: group.name, amountText, payerName: v.payerName, purpose: v.purpose, status: rec.status, lang: group.seller_language });
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
      const rec = await store.getIncomingFundsById(String(id || ''));
      if (!rec) return socket.emit('error-msg', 'That entry no longer exists.');
      const group = await store.getGroup(rec.group_id);
      if (!group) return;
      const L = Number(rec.amount_ledger);
      const from = rec.status;
      const note = sanitizeText(reason, 500);
      const by = meta().sessionToken;
      let adj; let undo; let toStatus; let historyNote;

      if (action === 'release') {
        if (from !== 'held_in_vault') return socket.emit('error-msg', 'Only funds held in the vault can be released.');
        adj = { held: -L, available: L }; undo = { held: L, available: -L };
        toStatus = 'credited'; historyNote = note || 'Cleared and released to your available balance';
      } else if (action === 'reverse') {
        if (!['held_in_vault', 'credited'].includes(from)) return socket.emit('error-msg', 'This entry has already been reversed.');
        if (!note) return socket.emit('error-msg', 'A reason is required to reverse funds.');
        adj = from === 'credited' ? { available: -L, total: -L } : { held: -L, total: -L };
        undo = from === 'credited' ? { available: L, total: L } : { held: L, total: L };
        toStatus = 'reversed'; historyNote = note;
      } else {
        return;
      }

      const moved = await store.adjustBalances(group.id, adj);
      if (!moved) {
        return socket.emit('error-msg', action === 'reverse' && from === 'credited'
          ? 'The seller has already withdrawn or reserved part of these funds — their available balance is too low to reverse this credit.'
          : 'The seller\'s balance no longer covers this change.');
      }
      const updated = await store.advanceIncomingFunds(rec.id, { status: toStatus, reason: historyNote, by, expectedStatus: from });
      if (!updated) {
        await store.adjustBalances(group.id, undo); // someone else changed it first — put the money back
        return socket.emit('error-msg', 'This entry was changed by someone else. Please review its current status.');
      }
      if (rec.track_enabled) await store.updateIncomingFunds(rec.id, { track_stage: T.STAGE_COUNT + 1, track_check: 0, track_elapsed_ms: 0, track_paused: true, track_finished_at: new Date().toISOString() });

      const amountText = rec.amount_currency === group.seller_currency
        ? fmt(rec.amount, rec.amount_currency)
        : `${fmt(rec.amount, rec.amount_currency)} (≈ ${fmt(L, group.seller_currency)})`;
      const title = toStatus === 'credited' ? 'Funds released to your balance' : 'Incoming payment reversed';
      const body = `${amountText} from ${rec.payer_name}${toStatus === 'reversed' ? ` — ${note}` : ''}`;
      await pushSellerState(io, group.id, { kind: 'incoming', title, body, id: rec.id });
      await alertSellerOffline(io, group, { title, body });
      if (group.email_b) {
        await notifyIncomingFunds(group.email_b, {
          groupName: group.name, amountText, payerName: rec.payer_name, purpose: rec.purpose,
          status: toStatus === 'credited' ? 'released' : 'reversed', reason: note, lang: group.seller_language
        });
      }
    } catch (err) {
      console.error('[admin-update-incoming-funds] error:', err);
      socket.emit('error-msg', 'Something went wrong updating that entry. Please check the ledger.');
    }
  });

  // ---- Withdrawals: the admin may set ANY of the four stages ----
  // pending · processing · declined · completed. Funds follow the stage:
  //   pending/processing -> sit in the seller's pending balance
  //   completed          -> leave the account for good
  //   declined           -> go straight back to the available balance
  socket.on('admin-advance-withdrawal', async ({ withdrawalId, toStatus, reason }) => {
    try {
      if (!guard()) return;
      if (toStatus === 'rejected' || toStatus === 'failed') toStatus = 'declined';
      if (!WD_STATUSES.includes(toStatus)) return socket.emit('error-msg', 'Please choose Pending, Processing, Declined or Completed.');
      const wd = await store.getWithdrawalById(String(withdrawalId || ''));
      if (!wd) return socket.emit('error-msg', 'That withdrawal no longer exists.');
      const from = wd.status;
      if (canon(from) === toStatus) return socket.emit('error-msg', `This withdrawal is already ${WD_LABEL[toStatus]}.`);
      const terminalBefore = ['completed', 'declined'].includes(canon(from));
      const note = sanitizeText(reason, 500);
      if (toStatus === 'declined' && !note) return socket.emit('error-msg', 'A reason is required to decline a withdrawal.');
      if (terminalBefore && !note) return socket.emit('error-msg', 'A reason is required to re-open a finished withdrawal.');
      const group = await store.getGroup(wd.group_id);
      if (!group) return;
      const amt = F.round2(wd.amount_ledger);
      const by = meta().sessionToken;

      // 1) Balance movement between buckets (atomic + guarded).
      const fromB = bucketOf(from); const toB = bucketOf(toStatus);
      let adj = null; let undo = null;
      if (fromB !== toB) {
        adj = {}; undo = {};
        if (fromB !== 'gone') { adj[fromB] = -amt; undo[fromB] = amt; }
        if (toB !== 'gone') { adj[toB] = (adj[toB] || 0) + amt; undo[toB] = (undo[toB] || 0) - amt; }
        const moved = await store.adjustBalances(group.id, adj);
        if (!moved) {
          return socket.emit('error-msg', toB === 'pending' && fromB === 'available'
            ? 'The seller no longer has enough available balance to re-open this withdrawal.'
            : 'The seller\'s balances do not cover this change — please check the ledger.');
        }
      }

      // 2) Status change (compare-and-set, so a double-click or a second admin can't apply it twice).
      const updated = await store.advanceWithdrawal(wd.id, {
        status: toStatus, reason: toStatus === 'declined' ? note : (note || WD_DEFAULT_NOTE[toStatus] || null), by, expectedStatus: from
      });
      if (!updated) {
        if (undo) await store.adjustBalances(group.id, undo);
        return socket.emit('error-msg', 'This withdrawal was changed by someone else. Please review its current status.');
      }

      const pub = F.publicWithdrawal(updated);
      const label = WD_LABEL[toStatus];
      const title = 'Withdrawal update';
      const body = `${pub.ref} (${fmt(wd.amount, wd.amount_currency)}) is now ${label}${toStatus === 'declined' ? ` — ${note}` : ''}`;
      await pushSellerState(io, group.id, { kind: 'withdrawal', title, body, id: wd.id, status: toStatus });
      io.to('finance-admins').emit('withdrawal-updated', F.publicWithdrawal(updated, { forAdmin: true }));
      if (['completed', 'declined'].includes(toStatus)) io.to('finance-admins').emit('withdrawal-resolved', F.publicWithdrawal(updated, { forAdmin: true }));
      await alertSellerOffline(io, group, { title, body });
      if (group.email_b) await notifyWithdrawalStatus(group.email_b, { groupName: group.name, amount: wd.amount, currency: wd.amount_currency, status: toStatus, reason: updated.status_reason, lang: group.seller_language });
      if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
    } catch (err) {
      console.error('[admin-advance-withdrawal] error:', err);
      socket.emit('error-msg', 'Something went wrong updating that withdrawal. Please check the ledger.');
    }
  });
}

module.exports = {
  registerFundsHandlers, pushSellerState, pushAdminLedger, emitSnapshotTo, sellerSnapshot,
  WITHDRAWAL_TRANSITIONS, WD_LABEL, WD_STATUSES, alertSellerOffline, canon, bucketOf
};
