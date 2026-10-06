// Money movement for the seller Transaction Account — everything an admin does
// to a seller's funds lives here:
//   * record incoming funds (who paid, what for, how much). By default a payment
//     starts the 5-stage ESCROW REVIEW: it sits in the vault (balance_held) and is
//     released to the seller's available balance only when the review finishes.
//   * run that review (server-side timers, manual approvals, pause/skip/restart)
//   * move a withdrawal through its four stages: Pending, Processing, Completed
//     or Declined
//   * the read-only "Funds Desk" queries that let an admin open ANY seller's account
//
// Only ADMIN / SUPER_ADMIN may do any of this (Moderators cannot), and every
// change is pushed live to the seller's own private room and to the
// 'finance-admins' room — never to the Buyer or a Moderator.

const { store } = require('./db');
const { sanitizeText, isValidEmail, RateLimiter, normalizePhone } = require('./security');
const F = require('./finance');
const ER = require('./escrowReview');
const POL = require('./policy');
const CD = require('./public/countries');
const { translateOne } = require('./translate');
const { sendPushToUser } = require('./webpush');
const E = require('./email');
const { postSystemMessage } = require('./chatShape');
const { ensureAccountId } = require('./accounts');

const financeLimiter = new RateLimiter({ windowMs: 60000, max: 60 });
setInterval(() => financeLimiter.sweep(), 60000).unref();

const METHODS = new Set(['bank_transfer', 'wire', 'crypto', 'card', 'cheque', 'cash', 'other']);
const PAYER_TYPES = new Set(['individual', 'company']);
const MAX_AMOUNT = 999999999.99;

// Four admin-selectable withdrawal stages. Completed and Declined are final.
const WITHDRAWAL_TRANSITIONS = {
  pending: ['processing', 'declined', 'completed'],
  processing: ['pending', 'declined', 'completed']
};
const WD_LABEL = F.WD_LABEL;
const WD_DEFAULT_NOTE = {
  pending: 'Request received — awaiting review',
  processing: 'Approved — payout in progress',
  completed: 'Payout sent'
};

const fmt = F.fmtMoney;

function activeSocketsOf(io) { return io._activeSockets || new Map(); }
function isSellerOnline(io, token) {
  if (!token) return false;
  return Array.from(activeSocketsOf(io).values()).some((v) => v.sessionToken === token);
}

// Translate a {title, body} notice into the seller's chosen language.
async function localize(group, notice) {
  const lang = group && group.seller_language;
  if (!notice || !lang || lang === 'en') return notice;
  const [title, body] = await Promise.all([translateOne(notice.title || '', lang, 'en'), translateOne(notice.body || '', lang, 'en')]);
  return { ...notice, title: title.text || notice.title, body: body.text || notice.body };
}

// ---------------- Per-record locking (the ticker and admin actions never interleave on one record) ----------------
const locks = new Map();
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = () => { if (locks.get(id) === next) locks.delete(id); };
  next.then(cleanup, cleanup);
  locks.set(id, next);
  return next;
}

// ---------------- Snapshots ----------------
async function limitsFor(g, wds) {
  const limit = await POL.getDailyLimit(store);
  const c = POL.dailyLimitCheck(g, wds, 0, limit);
  return { groupId: g.id, daily: c.unlimited ? null : limit, used: c.used, remaining: c.remaining, unlimited: c.unlimited, currency: g.seller_currency || null };
}

function balanceBreakdown(g, inc, wds) {
  const inVault = inc.filter((i) => ['in_review', 'held_in_vault'].includes(i.status)).reduce((s, i) => s + Number(i.amount_ledger), 0);
  const pendingWd = wds.filter((w) => w.funds_reserved && ['pending', 'processing'].includes(F.normWdStatus(w.status))).reduce((s, w) => s + Number(w.amount_ledger), 0);
  return { inVault: F.round2(inVault), pendingWithdrawals: F.round2(pendingWd) };
}

async function sellerSnapshot(groupId) {
  const g = await store.getGroup(groupId);
  if (!g) return null;
  const [deps, wds, inc] = await Promise.all([
    store.getDepositsForGroup(groupId), store.getWithdrawalsForGroup(groupId), store.getIncomingFundsForGroup(groupId)
  ]);
  const account = F.publicSellerAccount(g, false);
  account.balances = { ...account.balances, ...balanceBreakdown(g, inc, wds) };
  const now = Date.now();
  return {
    account,
    deposits: deps.map(F.publicDeposit),
    withdrawals: wds.map((w) => F.publicWithdrawal(w, false)),
    incoming: inc.map((i) => F.publicIncoming(i, false, now)),
    limits: await limitsFor(g, wds)
  };
}

function summaryOf(g, counts) {
  const country = CD.find(F.plainName(g.seller_country));
  return {
    groupId: g.id,
    groupName: g.name,
    sellerName: F.plainName(g.seller_full_name) || g.custom_name_b || 'Seller',
    email: g.email_b || null,
    phone: g.seller_phone || null,
    accountId: g.seller_account_id || null,
    country: F.plainName(g.seller_country) || null,
    countryFlag: country ? CD.flagEmoji(country.c) : null,
    registered: !!g.seller_registered,
    disabled: !!g.seller_disabled,
    disbursementEnabled: !!g.disbursement_enabled,
    currency: g.seller_currency || null,
    kycStatus: g.kyc_status,
    businessStatus: g.business_status || 'none',
    balances: {
      available: Number(g.balance_available || 0),
      held: Number(g.balance_held || 0),
      totalDeposited: Number(g.total_deposited || 0)
    },
    activeWithdrawals: counts.activeWithdrawals || 0,
    heldIncoming: counts.heldIncoming || 0,
    inReview: counts.inReview || 0,
    pendingDeposits: counts.pendingDeposits || 0
  };
}

async function adminLedger(g) {
  const [deps, wds, inc] = await Promise.all([
    store.getDepositsForGroup(g.id), store.getWithdrawalsForGroup(g.id), store.getIncomingFundsForGroup(g.id)
  ]);
  const counts = {
    activeWithdrawals: wds.filter((w) => ['pending', 'processing'].includes(F.normWdStatus(w.status))).length,
    heldIncoming: inc.filter((i) => i.status === 'held_in_vault').length,
    inReview: inc.filter((i) => i.status === 'in_review').length,
    pendingDeposits: deps.filter((d) => d.status === 'held_in_vault').length
  };
  const now = Date.now();
  const account = F.publicSellerAccount(g, true);
  account.balances = { ...account.balances, ...balanceBreakdown(g, inc, wds) };
  return {
    ledger: {
      groupId: g.id,
      account,
      deposits: deps.map(F.publicDeposit),
      withdrawals: wds.map((w) => F.publicWithdrawal(w, true)),
      incoming: inc.map((i) => F.publicIncoming(i, true, now)),
      limits: await limitsFor(g, wds)
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
  if (g.seller_registered) io.to('finance-admins').emit('seller-account-updated', ledger.account);
}

// Push the seller's full, current state to everything that is allowed to see
// it: the seller's own private room, any finance admin currently sitting in
// that group's chat, and the Funds Desk. `notice` (optional) is a popup line
// for the seller (translated into their language). Sending whole lists (not
// deltas) means the seller's screen can never drift out of step.
async function pushSellerState(io, groupId, notice) {
  const snap = await sellerSnapshot(groupId);
  if (!snap) return;
  const g = await store.getGroup(groupId);
  const emitAll = (target) => {
    target.emit('seller-account-state', snap.account);
    target.emit('deposits-list', { groupId, deposits: snap.deposits });
    target.emit('incoming-list', { groupId, incoming: snap.incoming });
    target.emit('withdrawals-list', { groupId, withdrawals: snap.withdrawals });
    target.emit('withdrawal-limits', snap.limits);
  };
  emitAll(io.to(`seller:${groupId}`));
  const adminSnap = await adminLedger(g);
  for (const [sockId, v] of activeSocketsOf(io)) {
    if (v.groupId === groupId && v.isAdmin && (v.adminRole === 'ADMIN' || v.adminRole === 'SUPER_ADMIN')) {
      const s = io.sockets.sockets.get(sockId);
      if (s) {
        s.emit('seller-account-state', adminSnap.ledger.account);
        s.emit('deposits-list', { groupId, deposits: adminSnap.ledger.deposits });
        s.emit('incoming-list', { groupId, incoming: snap.incoming });
        s.emit('withdrawals-list', { groupId, withdrawals: snap.withdrawals });
      }
    }
  }
  if (notice) io.to(`seller:${groupId}`).emit('seller-notice', await localize(g, notice));
  io.to('finance-admins').emit('funds-desk-ledger', adminSnap.ledger);
  io.to('finance-admins').emit('funds-desk-summary', adminSnap.summary);
}

// Direct (non-room) snapshot for one socket — used on join/refresh.
async function emitSnapshotTo(socket, groupId, forAdmin) {
  const snap = await sellerSnapshot(groupId);
  if (!snap) return;
  if (forAdmin) {
    const g = await store.getGroup(groupId);
    const a = await adminLedger(g);
    socket.emit('seller-account-state', a.ledger.account);
  } else {
    socket.emit('seller-account-state', snap.account);
  }
  socket.emit('deposits-list', { groupId, deposits: snap.deposits });
  socket.emit('incoming-list', { groupId, incoming: snap.incoming });
  socket.emit('withdrawals-list', { groupId, withdrawals: snap.withdrawals });
  socket.emit('withdrawal-limits', snap.limits);
}

async function alertSellerOffline(io, group, { title, body }) {
  const token = group.seller_session_token;
  if (token && !isSellerOnline(io, token)) {
    try {
      const t = await localize(group, { title, body });
      await sendPushToUser(token, { title: t.title, body: t.body, url: '/' });
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
  let asset = null; let network = null; let walletAddress = null;
  if (p.method === 'crypto') {
    if (!F.CRYPTO_ASSETS.has(p.asset)) return { error: 'Please choose the crypto asset received.' };
    asset = p.asset;
    network = sanitizeText(p.network, 20) || null;
    walletAddress = sanitizeText(p.walletAddress, 200) || null;
  }
  const amount = F.round2(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Please enter a valid amount.' };
  if (amount > MAX_AMOUNT) return { error: 'That amount is above the maximum allowed for a single entry.' };
  const amountCurrency = F.CURRENCIES.has(p.amountCurrency) ? p.amountCurrency : group.seller_currency;
  const fxRate = F.fxRate(amountCurrency, group.seller_currency);
  const amountLedger = F.convertCurrency(amount, amountCurrency, group.seller_currency);
  if (amountLedger <= 0) return { error: 'That amount is too small once converted to the seller\'s currency.' };
  const treatment = p.treatment || 'review';
  if (!['review', 'credit', 'hold'].includes(treatment)) return { error: 'Please choose how the funds should be handled.' };

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
  let payerPhone = null;
  if (p.payerPhone) {
    payerPhone = normalizePhone(p.payerPhone);
    if (!payerPhone) return { error: 'The payer phone number does not look valid (include the country code).' };
  }
  const payerType = PAYER_TYPES.has(p.payerType) ? p.payerType : 'individual';
  const proofUrl = typeof p.proofUrl === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(p.proofUrl) ? p.proofUrl : null;
  const payerCountry = p.payerCountry ? (CD.find(p.payerCountry) ? CD.find(p.payerCountry).n : sanitizeText(p.payerCountry, 100)) : null;

  let review = null;
  if (treatment === 'review') {
    const r = ER.initialState({
      mode: p.reviewMode === 'manual' ? 'manual' : 'auto',
      totalSeconds: p.reviewTotalSeconds, timers: Array.isArray(p.reviewTimers) ? p.reviewTimers : undefined,
      speed: p.reviewSpeed, showTime: !!p.reviewShowTime
    });
    if (r.error) return { error: r.error };
    review = r.value;
  }

  return {
    value: {
      payerName, purpose, method: p.method, asset, network, walletAddress,
      amount, amountCurrency, fxRate, amountLedger, treatment, receivedAt,
      payerEmail: payerEmail || null, payerPhone, payerType, payerCountry,
      payerBank: sanitizeText(p.payerBank, 200) || null, invoiceRef: sanitizeText(p.invoiceRef, 120) || null,
      externalRef: sanitizeText(p.externalRef, 200) || null,
      internalNote: sanitizeText(p.internalNote, 1000) || null, noteShared: !!p.noteShared && !!sanitizeText(p.internalNote, 1000),
      proofUrl, notifySeller: p.notifySeller !== false, review
    }
  };
}

function amountTextFor(rec, group) {
  const L = Number(rec.amount_ledger);
  return rec.amount_currency === group.seller_currency
    ? fmt(rec.amount, rec.amount_currency)
    : `${fmt(rec.amount, rec.amount_currency)} (≈ ${fmt(L, group.seller_currency)})`;
}

// ---------------- Escrow review: completion + change fan-out ----------------
const REVIEW_FIELDS = ['review_stage', 'review_checks', 'review_elapsed_ms', 'review_stage_times', 'review_last_tick'];
const pickReview = (o) => REVIEW_FIELDS.reduce((m, k) => { if (o[k] !== undefined) m[k] = o[k]; return m; }, {});

// Stage 5 finished: move the money from the vault to the seller's available balance.
async function finishReview(io, rec, by) {
  const group = await store.getGroup(rec.group_id);
  if (!group) return null;
  const L = Number(rec.amount_ledger);
  const moved = await store.adjustBalances(group.id, { held: -L, available: L });
  if (!moved) { console.error('[escrow] release failed: held balance does not cover', rec.id); return null; }
  const done = await store.advanceIncomingFunds(rec.id, {
    status: 'credited', reason: 'Funds credited to the seller', by: by || null, expectedStatus: 'in_review'
  });
  if (!done) { await store.adjustBalances(group.id, { held: L, available: -L }); return null; }
  const acct = rec.target_account_id || group.seller_account_id;
  const amountText = amountTextFor(rec, group);
  try {
    await postSystemMessage(io, group.id, `✅ Escrow review complete. ${amountText} — funds transferred to the seller account ${acct || ''} and credited.`.replace('  ', ' '));
  } catch (e) { /* chat notice is best-effort */ }
  const title = 'Funds credited';
  const body = `${amountText} from ${rec.payer_name} — funds transferred to the seller account ${acct || ''}`.trim();
  await pushSellerState(io, group.id, { kind: 'incoming', title, body, id: rec.id });
  await alertSellerOffline(io, group, { title, body });
  if (group.email_b) {
    await E.notifyIncomingFunds(group.email_b, {
      groupName: group.name, amountText, payerName: rec.payer_name, purpose: rec.purpose, status: 'released', accountId: acct, lang: group.seller_language
    });
  }
  return done;
}

async function afterReviewChange(io, updated, before, by) {
  if (!updated) return;
  if (Number(updated.review_stage) > 5) { await finishReview(io, updated, by); return; }
  let notice = null;
  if (Number(before.review_stage) < 4 && Number(updated.review_stage) >= 4) {
    notice = { kind: 'incoming', title: 'Payment confirmed', body: `Your payment of ${fmt(updated.amount, updated.amount_currency)} has passed review and is moving to your vault account.`, id: updated.id };
  }
  await pushSellerState(io, updated.group_id, notice);
}

// Server ticker: reviews keep moving whether or not anyone has a page open.
function startEscrowTicker(io) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const list = await store.getIncomingFundsByStatus('in_review');
      const now = Date.now();
      for (const rec of list) {
        if (rec.review_mode !== 'auto' || rec.review_paused) continue;
        await withLock(rec.id, async () => {
          const cur = await store.getIncomingFundsById(rec.id);
          if (!cur || cur.status !== 'in_review') return;
          const fields = ER.tick(cur, now);
          if (!fields) return;
          const stageChanged = fields.review_stage !== undefined && Number(fields.review_stage) !== Number(cur.review_stage);
          const checksChanged = fields.review_checks !== undefined && Number(fields.review_checks) !== Number(cur.review_checks);
          if (!stageChanged && !checksChanged) return; // baseline stays valid; nothing to persist or push
          const updated = await store.updateIncomingFunds(cur.id, fields);
          await afterReviewChange(io, updated, cur, null);
        }).catch((e) => console.error('[escrow] tick failed:', e.message));
      }
    } catch (e) { console.error('[escrow] ticker error:', e.message); } finally { busy = false; }
  }, 1000);
  t.unref();
  return t;
}

function registerFundsHandlers(io, socket, ctx) {
  const { meta, metaHasMinRole } = ctx;

  // ADMIN+ only, and rate-limited: this moves money.
  function guard() {
    if (!metaHasMinRole('ADMIN')) { socket.emit('error-msg', 'Only an Admin or Super Admin can change money records.'); return false; }
    if (!financeLimiter.allow(meta().sessionToken)) { socket.emit('error-msg', 'Too many actions — please wait a moment and try again.'); return false; }
    return true;
  }

  // ---- Funds Desk: read ----
  socket.on('admin-get-funds-overview', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const [groups, pendingWds, heldInc, reviewInc, pendingDeps] = await Promise.all([
      store.getAllGroups(), store.getPendingWithdrawals(), store.getIncomingFundsByStatus('held_in_vault'),
      store.getIncomingFundsByStatus('in_review'), store.getPendingDeposits()
    ]);
    const tally = (list) => list.reduce((m, r) => { m[r.group_id] = (m[r.group_id] || 0) + 1; return m; }, {});
    const w = tally(pendingWds); const h = tally(heldInc); const d = tally(pendingDeps); const r = tally(reviewInc);
    socket.emit('funds-overview', groups.map((g) => summaryOf(g, { activeWithdrawals: w[g.id], heldIncoming: h[g.id], inReview: r[g.id], pendingDeposits: d[g.id] })));
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
      let group = await store.getGroup(String(p.groupId || ''));
      if (!group) return socket.emit('error-msg', 'That group no longer exists.');
      if (!group.seller_registered || !group.seller_currency) {
        return socket.emit('error-msg', 'This seller has not created their Transaction Account yet — funds can be recorded once they have.');
      }
      group = await ensureAccountId(store, group);
      const { error, value: v } = parseIncoming(p, group);
      if (error) return socket.emit('error-msg', error);

      const L = v.amountLedger;
      const status = v.treatment === 'review' ? 'in_review' : v.treatment === 'credit' ? 'credited' : 'held_in_vault';
      const adj = status === 'credited' ? { available: L, total: L } : { held: L, total: L };
      const undo = status === 'credited' ? { available: -L, total: -L } : { held: -L, total: -L };
      const moved = await store.adjustBalances(group.id, adj);
      if (!moved) return socket.emit('error-msg', 'Could not update the seller\'s balance. Nothing was recorded.');
      const r = v.review;
      let rec;
      try {
        rec = await store.createIncomingFunds({
          groupId: group.id, payerName: v.payerName, payerEmail: v.payerEmail, payerCountry: v.payerCountry,
          payerPhone: v.payerPhone, payerType: v.payerType, payerBank: v.payerBank, invoiceRef: v.invoiceRef, walletAddress: v.walletAddress,
          purpose: v.purpose, method: v.method, asset: v.asset, network: v.network, externalRef: v.externalRef,
          amount: v.amount, amountCurrency: v.amountCurrency, amountLedger: L, fxRate: v.fxRate,
          receivedAt: v.receivedAt, status,
          historyNote: status === 'credited' ? 'Funds received and credited to your available balance'
            : status === 'in_review' ? 'Payment received — escrow review started' : 'Funds received — held in the vault pending clearance',
          proofUrl: v.proofUrl, internalNote: v.internalNote, noteShared: v.noteShared, recordedBy: meta().sessionToken,
          targetAccountId: group.seller_account_id,
          reviewMode: r ? r.review_mode : 'none', reviewStage: r ? r.review_stage : 6, reviewChecks: 0, reviewElapsedMs: 0,
          reviewLastTick: r ? r.review_last_tick : null, reviewPaused: false, reviewSpeed: r ? r.review_speed : 1,
          reviewShowTime: r ? r.review_show_time : false, reviewTimers: r ? r.review_timers : null, reviewStageTimes: []
        });
      } catch (err) {
        await store.adjustBalances(group.id, undo); // undo — no record, no money
        throw err;
      }

      const amountText = amountTextFor(rec, group);
      const title = status === 'credited' ? 'Funds received' : status === 'in_review' ? 'Payment received — under escrow review' : 'Funds received — held in vault';
      const body = `${amountText} from ${v.payerName} — ${v.purpose}`;
      await pushSellerState(io, group.id, v.notifySeller ? { kind: 'incoming', title, body, id: rec.id } : null);
      socket.emit('incoming-funds-recorded', { id: rec.id, ref: F.refFor('incoming', rec.id), groupId: group.id });
      if (v.notifySeller) {
        // Both parties see a line in the transaction chat (this is the "buyer and seller notified" check).
        try {
          await postSystemMessage(io, group.id, status === 'in_review'
            ? `💰 A payment of ${amountText} has been received (ref ${rec.ref || F.refFor('incoming', rec.id)}) and is now under escrow review.`
            : `💰 A payment of ${amountText} has been received (ref ${F.refFor('incoming', rec.id)}).`);
          if (v.noteShared && v.internalNote) await postSystemMessage(io, group.id, `📝 Note from the Desk: ${v.internalNote}`);
        } catch (e) { /* chat notice is best-effort */ }
        await alertSellerOffline(io, group, { title, body });
        if (group.email_b) await E.notifyIncomingFunds(group.email_b, { groupName: group.name, amountText, payerName: v.payerName, purpose: v.purpose, status: rec.status, accountId: group.seller_account_id, lang: group.seller_language });
      }
    } catch (err) {
      console.error('[admin-record-incoming-funds] error:', err);
      socket.emit('error-msg', 'Something went wrong recording those funds. Please check the seller\'s ledger before retrying.');
    }
  });

  // ---- Edit the internal note / share it with the buyer ----
  socket.on('admin-set-incoming-note', async ({ id, note, shared }) => {
    try {
      if (!guard()) return;
      const rec = await store.getIncomingFundsById(String(id || ''));
      if (!rec) return socket.emit('error-msg', 'That entry no longer exists.');
      const clean = sanitizeText(note, 1000) || null;
      const share = !!shared && !!clean;
      const wasShared = !!rec.note_shared && rec.internal_note === clean;
      await store.updateIncomingFunds(rec.id, { internal_note: clean, note_shared: share });
      if (share && !wasShared) await postSystemMessage(io, rec.group_id, `📝 Note from the Desk: ${clean}`);
      await pushSellerState(io, rec.group_id, null);
    } catch (err) {
      console.error('[admin-set-incoming-note] error:', err);
      socket.emit('error-msg', 'Could not save that note.');
    }
  });

  // ---- Escrow review console actions ----
  socket.on('admin-review-action', async ({ id, action, opts }) => {
    try {
      if (!guard()) return;
      const rid = String(id || '');
      await withLock(rid, async () => {
        const cur = await store.getIncomingFundsById(rid);
        if (!cur) return socket.emit('error-msg', 'That entry no longer exists.');
        if (cur.status !== 'in_review') return socket.emit('error-msg', 'This payment is no longer under review.');
        const now = Date.now();
        const live = { ...cur, ...(ER.tick(cur, now) || {}) }; // fold elapsed time in before acting
        let res;
        switch (action) {
          case 'confirm': res = ER.confirmCheck(live, now); break;
          case 'approve': case 'skip': res = ER.approveStage(live, now); break;
          case 'restart': res = ER.restart(live, now); break;
          case 'pause': res = ER.setPaused(live, true, now); break;
          case 'resume': res = ER.setPaused(live, false, now); break;
          case 'configure': res = ER.configure(live, opts || {}, now); break;
          default: return;
        }
        if (res.error) return socket.emit('error-msg', res.error);
        const updated = await store.updateIncomingFunds(cur.id, { ...pickReview(live), ...res.fields });
        await afterReviewChange(io, updated, cur, meta().sessionToken);
      });
    } catch (err) {
      console.error('[admin-review-action] error:', err);
      socket.emit('error-msg', 'Something went wrong updating that review.');
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

      if (action === 'release' && from === 'in_review') {
        // Override: skip the remaining review and release now.
        return withLock(rec.id, async () => {
          const cur = await store.getIncomingFundsById(rec.id);
          if (!cur || cur.status !== 'in_review') return socket.emit('error-msg', 'This payment is no longer under review.');
          const times = (Array.isArray(cur.review_stage_times) ? cur.review_stage_times : []).concat([{ stage: Number(cur.review_stage), at: new Date().toISOString(), override: true }]);
          const updated = await store.updateIncomingFunds(cur.id, { review_stage: 6, review_checks: 0, review_elapsed_ms: 0, review_stage_times: times });
          await finishReview(io, updated, by);
        });
      }

      let adj; let undo; let toStatus; let historyNote;
      if (action === 'release') {
        if (from !== 'held_in_vault') return socket.emit('error-msg', 'Only funds held in the vault can be released.');
        adj = { held: -L, available: L }; undo = { held: L, available: -L };
        toStatus = 'credited'; historyNote = note || 'Cleared and released to your available balance';
      } else if (action === 'reverse') {
        if (!['held_in_vault', 'credited', 'in_review'].includes(from)) return socket.emit('error-msg', 'This entry has already been reversed.');
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

      const amountText = amountTextFor(rec, group);
      const title = toStatus === 'credited' ? 'Funds released to your balance' : 'Incoming payment reversed';
      const body = `${amountText} from ${rec.payer_name}${toStatus === 'reversed' ? ` — ${note}` : ''}`;
      await pushSellerState(io, group.id, { kind: 'incoming', title, body, id: rec.id });
      await alertSellerOffline(io, group, { title, body });
      if (group.email_b) {
        await E.notifyIncomingFunds(group.email_b, {
          groupName: group.name, amountText, payerName: rec.payer_name, purpose: rec.purpose,
          status: toStatus === 'credited' ? 'released' : 'reversed', reason: note, accountId: rec.target_account_id, lang: group.seller_language
        });
      }
    } catch (err) {
      console.error('[admin-update-incoming-funds] error:', err);
      socket.emit('error-msg', 'Something went wrong updating that entry. Please check the ledger.');
    }
  });

  // ---- Withdrawals: four admin-selected stages — Pending, Processing, Completed, Declined ----
  async function setWithdrawalStage({ withdrawalId, toStatus, reason, payoutReference }) {
    try {
      if (!guard()) return;
      const to = F.normWdStatus(toStatus);
      if (!F.WD_STATUSES.includes(toStatus) && !['rejected', 'failed'].includes(toStatus)) return socket.emit('error-msg', 'Please choose a valid stage.');
      const wd = await store.getWithdrawalById(String(withdrawalId || ''));
      if (!wd) return socket.emit('error-msg', 'That withdrawal no longer exists.');
      const from = F.normWdStatus(wd.status);
      if (from === to) return socket.emit('error-msg', `This withdrawal is already ${WD_LABEL[to]}.`);
      if (!(WITHDRAWAL_TRANSITIONS[from] || []).includes(to)) {
        return socket.emit('error-msg', `A ${WD_LABEL[from].toLowerCase()} withdrawal cannot be moved to ${WD_LABEL[to]}.${['completed', 'declined'].includes(from) ? ' Completed and declined withdrawals are final.' : ''}`);
      }
      const declining = to === 'declined';
      const note = sanitizeText(reason, 500);
      if (declining && !note) return socket.emit('error-msg', 'A reason is required to decline a withdrawal.');
      const group = await store.getGroup(wd.group_id);
      if (!group) return;
      const amt = F.round2(wd.amount_ledger);
      const by = meta().sessionToken;

      // 1) Balance movement (atomic + guarded). Funds were reserved (available -> pending) when the seller confirmed.
      let adj = null; let undo = null; let reservedNow = null;
      const reserved = !!wd.funds_reserved;
      if (declining) {
        if (reserved) { adj = { held: -amt, available: amt }; undo = { held: amt, available: -amt }; reservedNow = false; }
      } else if (to === 'completed') {
        if (reserved) { adj = { held: -amt }; undo = { held: amt }; }
        else { adj = { available: -amt }; undo = { available: amt }; } // legacy request that was never reserved
        reservedNow = false; // the money has left the account
      } else if (!reserved) { // pending/processing but never reserved (legacy) -> reserve now
        adj = { available: -amt, held: amt }; undo = { available: amt, held: -amt }; reservedNow = true;
      }
      if (adj) {
        let moved = await store.adjustBalances(group.id, adj);
        if (!moved && declining) {
          // The reserved money left the seller's available balance when they confirmed, so a decline
          // must ALWAYS give it back — even if the pending pool was since adjusted by hand.
          const held = F.round2((await store.getGroup(group.id)).balance_held || 0);
          const take = Math.min(held, amt);
          adj = { held: -take, available: amt }; undo = { held: take, available: -amt };
          moved = await store.adjustBalances(group.id, adj);
        }
        if (!moved) return socket.emit('error-msg', 'The seller\'s balance no longer covers this change — please check the ledger.');
      }

      // 2) Status change (compare-and-set, so a double-click or a second admin can't apply it twice).
      const ref = to === 'completed' ? (sanitizeText(payoutReference, 120) || null) : null;
      const updated = await store.advanceWithdrawal(wd.id, {
        status: to, reason: declining ? note : (note || WD_DEFAULT_NOTE[to] || null), by, expectedStatus: wd.status
      });
      if (!updated) {
        if (undo) await store.adjustBalances(group.id, undo);
        return socket.emit('error-msg', 'This withdrawal was changed by someone else. Please review its current status.');
      }
      const extra = {};
      if (reservedNow !== null) extra.funds_reserved = reservedNow;
      if (ref) extra.payout_reference = ref;
      const final = Object.keys(extra).length ? ((await store.updateWithdrawal(wd.id, extra)) || updated) : updated;

      const pub = F.publicWithdrawal(final, true);
      const label = WD_LABEL[to];
      const title = 'Withdrawal update';
      const body = `${pub.ref} (${fmt(wd.amount, wd.amount_currency)}) is now ${label}${declining ? ` — ${note}` : ''}${ref ? ` — reference ${ref}` : ''}`;
      await pushSellerState(io, group.id, { kind: 'withdrawal', title, body, id: wd.id, status: to });
      socket.emit('admin-notice', { message: declining
        ? (reserved ? `${pub.ref} declined — ${fmt(wd.amount, wd.amount_currency)} returned to the seller's available balance.` : `${pub.ref} declined (no funds had been reserved, so nothing needed returning).`)
        : `${pub.ref} is now ${label}.` });
      io.to('finance-admins').emit('withdrawal-updated', pub);
      if (['completed', 'declined'].includes(to)) io.to('finance-admins').emit('withdrawal-resolved', pub);
      await alertSellerOffline(io, group, { title, body });
      if (group.email_b) await E.notifyWithdrawalStatus(group.email_b, { groupName: group.name, amount: fmt(wd.amount, wd.amount_currency), currency: '', status: to, reason: final.status_reason, reference: final.payout_reference, lang: group.seller_language });
      if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
    } catch (err) {
      console.error('[admin-set-withdrawal-stage] error:', err);
      socket.emit('error-msg', 'Something went wrong updating that withdrawal. Please check the ledger.');
    }
  }
  socket.on('admin-set-withdrawal-stage', setWithdrawalStage);
  socket.on('admin-advance-withdrawal', setWithdrawalStage); // legacy event name
}

module.exports = {
  registerFundsHandlers, startEscrowTicker, pushSellerState, pushAdminLedger, emitSnapshotTo, sellerSnapshot, adminLedger,
  summaryOf, localize, limitsFor, WITHDRAWAL_TRANSITIONS, WD_LABEL
};
