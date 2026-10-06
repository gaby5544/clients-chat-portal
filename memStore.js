// In-memory implementation of the data store interface.
// Used automatically when DATABASE_URL is not configured.
// NOTE: data does not survive a process restart in this mode —
// see pgStore.js for the persistent Postgres-backed implementation.

const { v4: uuid } = require('uuid');

function nowIso() { return new Date().toISOString(); }

function makeDefaultGroup(id, name) {
  return {
    id,
    name,
    custom_name_a: 'Buyer',
    custom_name_b: 'Seller',
    email_a: null,
    email_b: null,
    buyer_session_token: null,
    seller_session_token: null,
    file_uploads_enabled: true,
    highlighted: false,
    transaction_form_enabled: false,
    banner_url: null,
    created_at: nowIso(),
    // ---- Transaction Account (seller registration/KYC/balance) ----
    seller_registered: false,
    seller_full_name: null,
    seller_password_hash: null,
    seller_currency: null,
    currency_locked_at: null,
    seller_failed_logins: 0,
    seller_locked_until: null,
    kyc_status: 'not_submitted',
    kyc_doc_type: null,
    kyc_id_front_url: null,
    kyc_id_back_url: null,
    kyc_proof_address_url: null,
    kyc_proof_address_type: null,
    seller_date_of_birth: null,
    seller_country: null,
    kyc_selfie_url: null,
    kyc_submitted_at: null,
    kyc_reviewed_by: null,
    kyc_reviewed_at: null,
    kyc_rejection_reason: null,
    balance_available: 0,
    balance_held: 0,
    total_deposited: 0,
    // ---- v4 additions ----
    seller_phone: null,
    seller_email_verified: false,
    seller_account_id: null,
    seller_account_type: 'Standard account',
    seller_language: 'en',
    terms_accepted_at: null,
    terms_version: null,
    seller_registered_ip: null,
    seller_registered_at: null,
    seller_disabled: false,
    seller_disabled_reason: null,
    seller_disabled_at: null,
    disbursement_enabled: false,
    crypto_deposit_verified: false,
    business_status: 'none',
    business_data: null,
    business_submitted_at: null,
    business_reviewed_at: null,
    business_rejection_reason: null,
    kyc_auto_report: null,
    kyc_id_number: null,
    kyc_id_expiry: null,
    kyc_name_on_id: null,
    kyc_issuing_country: null
  };
}

class MemStore {
  constructor() {
    this.users = new Map();          // sessionToken -> user
    this.groups = new Map();         // groupId -> group
    this.messages = new Map();       // groupId -> [messages]
    this.editHistory = new Map();    // messageId -> [{oldText, editedBy, editedAt}]
    this.reactions = new Map();      // messageId -> [{sessionToken, emoji}]
    this.pins = new Map();           // groupId -> Set(messageId)
    this.notifications = new Map();  // sessionToken -> [notification]
    this.unread = new Map();         // sessionToken -> Map(groupId -> count)
    this.transactions = new Map();   // groupId -> [transaction]
    this.announcements = new Map();  // groupId -> [announcement]
    this.tasks = new Map();          // groupId -> [task]
    this.messageReads = new Map();   // messageId -> Map(sessionToken -> {deliveredAt, readAt})
    this.pushSubs = new Map();       // endpoint -> {sessionToken, endpoint, p256dh, auth}
    this.pendingEmails = new Map();  // id -> pending email record (missed-message alerts awaiting admin approval)
    this.passwordResets = new Map(); // id -> reset record
    this.deposits = new Map();       // id -> deposit record
    this.withdrawals = new Map();    // id -> withdrawal record
    this.incoming = new Map();       // id -> incoming-funds record (recorded by the Desk against a seller)
    this.verifications = new Map();  // id -> verification code record (register / withdraw)
    this.sellerSessions = new Map(); // groupId -> Map(sessionToken -> {ip, created_at})
    this.ipEvents = [];              // [{group_id, kind, ip, country, user_agent, created_at}]
    this.blockedIps = new Map();     // groupId -> Map(ip -> {reason, blocked_by, created_at})
    this.settings = new Map();       // key -> value
    this.translations = new Map();   // `${lang}:${hash}` -> translated text
    this.branding = {
      id: 1, logo_url: null, accent_color: '#38bdf8', accent_color_2: '#8b5cf6',
      welcome_message: 'Welcome to Quantum Secure Transaction Desk.', background_url: null,
      updated_at: nowIso()
    };

    this.groups.set('default-group', makeDefaultGroup('default-group', 'General Transaction Group #1'));
    this.messages.set('default-group', []);
    this.pins.set('default-group', new Set());
    this.transactions.set('default-group', []);
    this.announcements.set('default-group', []);
    this.tasks.set('default-group', []);
  }

  async init() { /* nothing to do for memory backend */ }

  // ---------- USERS ----------
  async upsertUser(u) {
    const existing = this.users.get(u.sessionToken) || {};
    const merged = {
      session_token: u.sessionToken,
      display_name: u.displayName ?? existing.display_name,
      role: u.role ?? existing.role ?? 'PARTY A',
      is_admin: u.isAdmin ?? existing.is_admin ?? false,
      admin_role: u.adminRole !== undefined ? u.adminRole : existing.admin_role ?? null,
      email: u.email !== undefined ? u.email : existing.email ?? null,
      country_code: u.countryCode !== undefined ? u.countryCode : existing.country_code ?? null,
      country_name: u.countryName !== undefined ? u.countryName : existing.country_name ?? null,
      language: u.language !== undefined ? u.language : existing.language ?? null,
      avatar_seed: existing.avatar_seed || u.sessionToken,
      is_online: u.isOnline ?? existing.is_online ?? false,
      first_seen: existing.first_seen || nowIso(),
      last_seen: nowIso()
    };
    this.users.set(u.sessionToken, merged);
    return merged;
  }

  async setUserOnline(sessionToken, isOnline) {
    const u = this.users.get(sessionToken);
    if (u) { u.is_online = isOnline; u.last_seen = nowIso(); }
  }

  async getUser(sessionToken) { return this.users.get(sessionToken) || null; }
  async getAllUsers() { return Array.from(this.users.values()); }

  async deleteUser(sessionToken) {
    this.users.delete(sessionToken);
  }

  async clearOfflineUsers() {
    let count = 0;
    for (const [token, u] of this.users.entries()) {
      if (!u.is_online) { this.users.delete(token); count++; }
    }
    return count;
  }

  // ---------- GROUPS ----------
  async createGroupIfMissing(groupId, name) {
    if (!this.groups.has(groupId)) {
      this.groups.set(groupId, makeDefaultGroup(groupId, name));
      this.messages.set(groupId, []);
      this.pins.set(groupId, new Set());
      this.transactions.set(groupId, []);
      this.announcements.set(groupId, []);
      this.tasks.set(groupId, []);
    }
    return this.groups.get(groupId);
  }

  async getGroup(groupId) { return this.groups.get(groupId) || null; }
  async getAllGroups() { return Array.from(this.groups.values()); }
  async findGroupsBySellerEmail(email) {
    const lower = String(email).toLowerCase();
    return Array.from(this.groups.values()).filter(g => g.email_b && g.email_b.toLowerCase() === lower && g.seller_registered);
  }

  async updateGroup(groupId, fields) {
    const g = this.groups.get(groupId);
    if (!g) return null;
    Object.assign(g, fields);
    return g;
  }

  async deleteGroup(groupId) {
    this.groups.delete(groupId);
    this.messages.delete(groupId);
    this.pins.delete(groupId);
    this.transactions.delete(groupId);
    this.announcements.delete(groupId);
    this.tasks.delete(groupId);
    // Mirror Postgres' ON DELETE CASCADE so a deleted group leaves no orphaned money records behind.
    for (const map of [this.deposits, this.withdrawals, this.incoming, this.passwordResets, this.verifications]) {
      for (const [id, rec] of map.entries()) if (rec.group_id === groupId) map.delete(id);
    }
    this.sellerSessions.delete(groupId);
    this.blockedIps.delete(groupId);
    this.ipEvents = this.ipEvents.filter(e => e.group_id !== groupId);
  }

  // Atomic, guarded balance change. Returns the updated group, or null if the
  // group is gone or the change would push any balance below zero (so two
  // admins acting at once can never overdraw an account).
  async adjustBalances(groupId, { available = 0, held = 0, total = 0 } = {}) {
    const g = this.groups.get(groupId);
    if (!g) return null;
    const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const a = r2(Number(g.balance_available || 0) + available);
    const h = r2(Number(g.balance_held || 0) + held);
    const t = r2(Number(g.total_deposited || 0) + total);
    if (a < 0 || h < 0 || t < 0) return null;
    g.balance_available = a; g.balance_held = h; g.total_deposited = t;
    return g;
  }

  // ---------- MESSAGES ----------
  async insertMessage(msg) {
    const record = {
      id: msg.id,
      group_id: msg.groupId,
      sender_token: msg.senderToken || null,
      sender_name: msg.senderName,
      sender_role: msg.senderRole || null,
      text: msg.text,
      file_url: msg.fileUrl || null,
      file_type: msg.fileType || null,
      file_name: msg.fileName || null,
      reply_to_id: msg.replyToId || null,
      forwarded_from: msg.forwardedFrom || null,
      target_lang: msg.targetLang || 'en',
      audience: msg.audience || null,
      is_edited: false,
      is_deleted: false,
      created_at: nowIso()
    };
    if (!this.messages.has(msg.groupId)) this.messages.set(msg.groupId, []);
    this.messages.get(msg.groupId).push(record);
    return record;
  }

  async getMessagesForGroup(groupId, limit = 500) {
    const list = this.messages.get(groupId) || [];
    return list.filter(m => !m.is_deleted).slice(-limit);
  }

  async getMessageById(messageId) {
    for (const list of this.messages.values()) {
      const found = list.find(m => m.id === messageId);
      if (found) return found;
    }
    return null;
  }

  async editMessage(messageId, newText, editedBy) {
    const msg = await this.getMessageById(messageId);
    if (!msg) return null;
    if (!this.editHistory.has(messageId)) this.editHistory.set(messageId, []);
    this.editHistory.get(messageId).push({ oldText: msg.text, editedBy, editedAt: nowIso() });
    msg.text = newText;
    msg.is_edited = true;
    return msg;
  }

  async getMessageEditHistory(messageId) {
    return this.editHistory.get(messageId) || [];
  }

  async deleteMessages(groupId, messageIds) {
    const list = this.messages.get(groupId) || [];
    list.forEach(m => { if (messageIds.includes(m.id)) m.is_deleted = true; });
    const pinSet = this.pins.get(groupId);
    if (pinSet) messageIds.forEach(id => pinSet.delete(id));
  }

  // ---------- PINS ----------
  async togglePin(groupId, messageId) {
    if (!this.pins.has(groupId)) this.pins.set(groupId, new Set());
    const set = this.pins.get(groupId);
    if (set.has(messageId)) set.delete(messageId); else set.add(messageId);
    return this.getPinnedMessages(groupId);
  }

  async getPinnedMessages(groupId) {
    const set = this.pins.get(groupId) || new Set();
    const list = this.messages.get(groupId) || [];
    return list.filter(m => set.has(m.id) && !m.is_deleted);
  }

  // ---------- REACTIONS ----------
  async toggleReaction(messageId, sessionToken, emoji) {
    if (!this.reactions.has(messageId)) this.reactions.set(messageId, []);
    const list = this.reactions.get(messageId);
    const idx = list.findIndex(r => r.sessionToken === sessionToken && r.emoji === emoji);
    if (idx === -1) list.push({ sessionToken, emoji }); else list.splice(idx, 1);
    return this.getReactionSummary(messageId);
  }

  async getReactionSummary(messageId) {
    const list = this.reactions.get(messageId) || [];
    const summary = {};
    list.forEach(r => { summary[r.emoji] = (summary[r.emoji] || 0) + 1; });
    return summary;
  }

  // ---------- UNREAD / NOTIFICATIONS ----------
  async incrementUnread(sessionToken, groupId) {
    if (!this.unread.has(sessionToken)) this.unread.set(sessionToken, new Map());
    const m = this.unread.get(sessionToken);
    const cur = m.get(groupId) || { count: 0, since: null, lastReminded: null };
    if (!cur.count) { cur.since = nowIso(); cur.lastReminded = null; }
    cur.count += 1;
    m.set(groupId, cur);
  }

  async clearUnread(sessionToken, groupId) {
    const m = this.unread.get(sessionToken);
    if (m) m.set(groupId, { count: 0, since: null, lastReminded: null });
  }

  async getUnreadCounts(sessionToken) {
    const m = this.unread.get(sessionToken);
    if (!m) return {};
    const out = {};
    for (const [gid, v] of m.entries()) out[gid] = v.count;
    return out;
  }

  // Everything still unread, with when it started and when we last nudged —
  // drives the "remind every 60 minutes until read" scheduler.
  async getUnreadDetails() {
    const out = [];
    for (const [token, m] of this.unread.entries()) {
      for (const [gid, v] of m.entries()) {
        if (v.count > 0) out.push({ session_token: token, group_id: gid, count: v.count, since: v.since, last_reminded_at: v.lastReminded });
      }
    }
    return out;
  }
  async markReminded(sessionToken, groupId) {
    const m = this.unread.get(sessionToken);
    const v = m && m.get(groupId);
    if (v) v.lastReminded = nowIso();
  }

  async addNotification(sessionToken, type, payload) {
    if (!this.notifications.has(sessionToken)) this.notifications.set(sessionToken, []);
    const n = { id: uuid(), type, payload, is_read: false, created_at: nowIso() };
    this.notifications.get(sessionToken).unshift(n);
    return n;
  }

  async getNotifications(sessionToken) {
    return (this.notifications.get(sessionToken) || []).slice(0, 50);
  }

  async markNotificationsRead(sessionToken) {
    const list = this.notifications.get(sessionToken) || [];
    list.forEach(n => { n.is_read = true; });
  }

  // ---------- TRANSACTIONS ----------
  async insertTransaction(tx) {
    const record = { id: uuid(), submitted_at: nowIso(), ...tx };
    if (!this.transactions.has(tx.group_id)) this.transactions.set(tx.group_id, []);
    this.transactions.get(tx.group_id).push(record);
    return record;
  }

  async getTransactions(groupId) { return this.transactions.get(groupId) || []; }

  async getTransactionById(txId) {
    for (const [groupId, list] of this.transactions.entries()) {
      const found = list.find(t => t.id === txId);
      if (found) return { ...found, group_id: groupId };
    }
    return null;
  }

  async deleteTransaction(groupId, txId) {
    const list = this.transactions.get(groupId) || [];
    this.transactions.set(groupId, list.filter(t => t.id !== txId));
  }

  async getAllTransactionsCount() {
    let count = 0;
    for (const list of this.transactions.values()) count += list.length;
    return count;
  }

  // ---------- STATS ----------
  async getStats() {
    const users = Array.from(this.users.values());
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let messagesToday = 0, uploadsToday = 0;
    for (const list of this.messages.values()) {
      for (const m of list) {
        if (m.is_deleted) continue;
        if (new Date(m.created_at) >= todayStart) {
          messagesToday++;
          if (m.file_url) uploadsToday++;
        }
      }
    }
    return {
      totalUsers: users.length,
      onlineUsers: users.filter(u => u.is_online).length,
      offlineUsers: users.filter(u => !u.is_online).length,
      totalGroups: this.groups.size,
      messagesToday,
      uploadsToday,
      transactionsSubmitted: await this.getAllTransactionsCount()
    };
  }

  // ---------- ANNOUNCEMENTS ----------
  async createAnnouncement(a) {
    const record = { id: uuid(), group_id: a.groupId, message_id: a.messageId || null, text: a.text, created_by: a.createdBy || null, created_at: nowIso() };
    if (!this.announcements.has(a.groupId)) this.announcements.set(a.groupId, []);
    this.announcements.get(a.groupId).unshift(record);
    return record;
  }
  async getAnnouncements(groupId) { return this.announcements.get(groupId) || []; }
  async deleteAnnouncement(groupId, id) {
    const list = this.announcements.get(groupId) || [];
    this.announcements.set(groupId, list.filter(a => a.id !== id));
  }

  // ---------- TASKS ----------
  async createTask(t) {
    const record = {
      id: uuid(), group_id: t.groupId, title: t.title, description: t.description || null,
      status: 'Pending', created_by: t.createdBy || null, assigned_role: t.assignedRole || null,
      created_at: nowIso(), updated_at: nowIso()
    };
    if (!this.tasks.has(t.groupId)) this.tasks.set(t.groupId, []);
    this.tasks.get(t.groupId).unshift(record);
    return record;
  }
  async getTasks(groupId) { return this.tasks.get(groupId) || []; }
  async updateTaskStatus(groupId, taskId, status) {
    const list = this.tasks.get(groupId) || [];
    const task = list.find(t => t.id === taskId);
    if (task) { task.status = status; task.updated_at = nowIso(); }
    return task || null;
  }
  async deleteTask(groupId, taskId) {
    const list = this.tasks.get(groupId) || [];
    this.tasks.set(groupId, list.filter(t => t.id !== taskId));
  }
  async getPendingTasksCount() {
    let count = 0;
    for (const list of this.tasks.values()) count += list.filter(t => t.status === 'Pending').length;
    return count;
  }

  // ---------- MESSAGE READS ----------
  async markDelivered(messageId, sessionToken) {
    if (!this.messageReads.has(messageId)) this.messageReads.set(messageId, new Map());
    const m = this.messageReads.get(messageId);
    if (!m.has(sessionToken)) m.set(sessionToken, { deliveredAt: nowIso(), readAt: null });
    return this.getMessageStatus(messageId);
  }
  async markRead(messageId, sessionToken) {
    if (!this.messageReads.has(messageId)) this.messageReads.set(messageId, new Map());
    const m = this.messageReads.get(messageId);
    const existing = m.get(sessionToken) || { deliveredAt: nowIso(), readAt: null };
    existing.readAt = nowIso();
    if (!existing.deliveredAt) existing.deliveredAt = existing.readAt;
    m.set(sessionToken, existing);
    return this.getMessageStatus(messageId);
  }
  async markGroupRead(groupId, sessionToken, excludeSenderToken) {
    const list = this.messages.get(groupId) || [];
    const updatedIds = [];
    for (const msg of list) {
      if (msg.sender_token === excludeSenderToken || !msg.sender_token) continue;
      if (msg.sender_token === sessionToken) continue;
      await this.markRead(msg.id, sessionToken);
      updatedIds.push(msg.id);
    }
    return updatedIds;
  }
  async getMessageStatus(messageId) {
    const m = this.messageReads.get(messageId);
    if (!m || m.size === 0) return 'sent';
    const entries = Array.from(m.values());
    if (entries.some(e => e.readAt)) return 'read';
    if (entries.some(e => e.deliveredAt)) return 'delivered';
    return 'sent';
  }

  // ---------- PUSH SUBSCRIPTIONS ----------
  async savePushSubscription(sessionToken, sub) {
    this.pushSubs.set(sub.endpoint, { sessionToken, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  }
  async removePushSubscription(endpoint) { this.pushSubs.delete(endpoint); }
  async getPushSubscriptionsForUser(sessionToken) {
    return Array.from(this.pushSubs.values()).filter(s => s.sessionToken === sessionToken);
  }

  // ---------- PENDING EMAILS (missed-message alerts awaiting admin approval) ----------
  async createPendingEmail(rec) {
    const record = {
      id: uuid(), group_id: rec.groupId, party: rec.party, to_email: rec.toEmail,
      from_name: rec.fromName, group_name: rec.groupName, message_text: rec.messageText,
      status: 'pending', created_at: nowIso(), resolved_at: null
    };
    this.pendingEmails.set(record.id, record);
    return record;
  }
  async getPendingEmails(status = 'pending') {
    return Array.from(this.pendingEmails.values())
      .filter(p => p.status === status)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  async getPendingEmailById(id) { return this.pendingEmails.get(id) || null; }
  async resolvePendingEmail(id, status) {
    const p = this.pendingEmails.get(id);
    if (!p) return null;
    p.status = status;
    p.resolved_at = nowIso();
    return p;
  }

  // ---------- PASSWORD RESETS (Transaction Account) ----------
  async createPasswordReset(rec) {
    const record = { id: uuid(), group_id: rec.groupId, code_hash: rec.codeHash, expires_at: rec.expiresAt, consumed_at: null, reset_token: null, created_at: nowIso() };
    this.passwordResets.set(record.id, record);
    return record;
  }
  async getLatestPasswordReset(groupId) {
    const all = Array.from(this.passwordResets.values()).filter(r => r.group_id === groupId && !r.consumed_at);
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return all[0] || null;
  }
  async setPasswordResetToken(id, resetToken) {
    const r = this.passwordResets.get(id);
    if (!r) return null;
    r.reset_token = resetToken;
    return r;
  }
  async consumePasswordResetByToken(groupId, resetToken) {
    const r = Array.from(this.passwordResets.values()).find(x => x.group_id === groupId && x.reset_token === resetToken && !x.consumed_at);
    if (!r) return null;
    r.consumed_at = nowIso();
    return r;
  }

  // ---------- DEPOSITS ----------
  async createDeposit(rec) {
    const record = {
      id: uuid(), group_id: rec.groupId, method: rec.method, asset: rec.asset || null, network: rec.network || null,
      reference_code: rec.referenceCode || null, amount: rec.amount, status: 'held_in_vault',
      notified_at: nowIso(), verified_by: null, verified_at: null, rejection_reason: null
    };
    this.deposits.set(record.id, record);
    return record;
  }
  async getDepositsForGroup(groupId) {
    return Array.from(this.deposits.values()).filter(d => d.group_id === groupId).sort((a, b) => new Date(b.notified_at) - new Date(a.notified_at));
  }
  async getDepositById(id) { return this.deposits.get(id) || null; }
  async getPendingDeposits() {
    return Array.from(this.deposits.values()).filter(d => d.status === 'held_in_vault').sort((a, b) => new Date(a.notified_at) - new Date(b.notified_at));
  }
  async resolveDeposit(id, { status, verifiedBy, rejectionReason }) {
    const d = this.deposits.get(id);
    if (!d) return null;
    d.status = status;
    d.verified_by = verifiedBy || null;
    d.verified_at = nowIso();
    d.rejection_reason = rejectionReason || null;
    return d;
  }

  // ---------- WITHDRAWAL REQUESTS ----------
  async createWithdrawal(rec) {
    const record = {
      id: uuid(), group_id: rec.groupId, method: rec.method, asset: rec.asset || null, network: rec.network || null,
      destination: rec.destination || null, beneficiary_name: rec.beneficiaryName || null, bank_name: rec.bankName || null,
      bank_account: rec.bankAccount || null, bank_swift: rec.bankSwift || null, bank_country: rec.bankCountry || null,
      amount: rec.amount, amount_currency: rec.amountCurrency, amount_ledger: rec.amountLedger,
      status: 'pending', status_reason: null,
      status_history: [{ status: 'pending', at: nowIso(), by: null, note: 'Submitted by seller' }],
      ip: rec.ip || null, confirmed_at: rec.confirmedAt || null, funds_reserved: !!rec.fundsReserved,
      created_at: nowIso(), updated_at: nowIso()
    };
    this.withdrawals.set(record.id, record);
    return record;
  }
  // Total of non-declined withdrawals (ledger currency) created since a moment — daily-limit check.
  async sumWithdrawalsLedgerSince(groupId, sinceIso) {
    const since = new Date(sinceIso).getTime();
    return Array.from(this.withdrawals.values())
      .filter(w => w.group_id === groupId && !['rejected', 'failed'].includes(w.status) && new Date(w.created_at).getTime() >= since)
      .reduce((a, w) => a + Number(w.amount_ledger), 0);
  }
  async getWithdrawalsForGroup(groupId) {
    return Array.from(this.withdrawals.values()).filter(w => w.group_id === groupId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  async getWithdrawalById(id) { return this.withdrawals.get(id) || null; }
  async getPendingWithdrawals() {
    return Array.from(this.withdrawals.values())
      .filter(w => !['completed', 'rejected', 'failed'].includes(w.status))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  async advanceWithdrawal(id, { status, reason, by, expectedStatus, fundsReserved }) {
    const w = this.withdrawals.get(id);
    if (!w) return null;
    if (expectedStatus && w.status !== expectedStatus) return null; // compare-and-set: someone else moved it first
    w.status = status;
    if (fundsReserved !== undefined) w.funds_reserved = !!fundsReserved;
    w.status_reason = reason || null;
    w.status_history.push({ status, at: nowIso(), by: by || null, note: reason || null });
    w.updated_at = nowIso();
    return w;
  }

  // ---------- INCOMING FUNDS (recorded by the Desk against a seller) ----------
  async createIncomingFunds(rec) {
    const now = nowIso();
    const record = {
      id: uuid(), group_id: rec.groupId, payer_name: rec.payerName, payer_email: rec.payerEmail || null,
      payer_country: rec.payerCountry || null, purpose: rec.purpose, method: rec.method,
      asset: rec.asset || null, network: rec.network || null, external_ref: rec.externalRef || null,
      amount: rec.amount, amount_currency: rec.amountCurrency, amount_ledger: rec.amountLedger, fx_rate: rec.fxRate,
      received_at: rec.receivedAt || now, status: rec.status, status_reason: null,
      status_history: [{ status: rec.status, at: now, by: rec.recordedBy || null, note: rec.historyNote || null }],
      proof_url: rec.proofUrl || null, internal_note: rec.internalNote || null, recorded_by: rec.recordedBy || null,
      payer_company: rec.payerCompany || null, payer_bank: rec.payerBank || null, payer_phone: rec.payerPhone || null,
      order_ref: rec.orderRef || null, buyer_visible_note: !!rec.buyerVisibleNote, review: rec.review || null,
      created_at: now, updated_at: now
    };
    this.incoming.set(record.id, record);
    return record;
  }
  async updateIncomingReview(id, review) {
    const i = this.incoming.get(id);
    if (!i) return null;
    i.review = review;
    i.updated_at = nowIso();
    return i;
  }
  // Held records whose escrow review is still running (stage 1-5).
  async getActiveReviewRecords() {
    return Array.from(this.incoming.values()).filter(i => i.status === 'held_in_vault' && i.review && i.review.current_stage >= 1 && i.review.current_stage <= 5);
  }
  async getIncomingFundsForGroup(groupId) {
    return Array.from(this.incoming.values()).filter(i => i.group_id === groupId)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at) || new Date(b.created_at) - new Date(a.created_at));
  }
  async getIncomingFundsById(id) { return this.incoming.get(id) || null; }
  async getIncomingFundsByStatus(status) {
    return Array.from(this.incoming.values()).filter(i => i.status === status);
  }
  async advanceIncomingFunds(id, { status, reason, by, expectedStatus }) {
    const i = this.incoming.get(id);
    if (!i) return null;
    if (expectedStatus && i.status !== expectedStatus) return null; // compare-and-set
    i.status = status;
    i.status_reason = reason || null;
    i.status_history.push({ status, at: nowIso(), by: by || null, note: reason || null });
    i.updated_at = nowIso();
    return i;
  }

  // ---------- v4: ACCOUNT IDs ----------
  async getGroupBySellerAccountId(accountId) {
    return Array.from(this.groups.values()).find(g => g.seller_account_id === accountId) || null;
  }
  // Assigns a unique 11-digit Account ID the first time it is needed.
  async ensureSellerAccountId(groupId, generate) {
    const g = this.groups.get(groupId);
    if (!g) return null;
    if (g.seller_account_id) return g;
    for (let i = 0; i < 25; i++) {
      const id = generate();
      if (!(await this.getGroupBySellerAccountId(id))) { g.seller_account_id = id; return g; }
    }
    throw new Error('Could not allocate a unique account id');
  }

  // ---------- v4: VERIFICATION CODES (register / withdraw) ----------
  async createVerificationCode(rec) {
    const record = {
      id: uuid(), group_id: rec.groupId, purpose: rec.purpose, email: rec.email || null, code_hash: rec.codeHash,
      payload: rec.payload || null, attempts: 0, expires_at: rec.expiresAt, consumed_at: null, created_at: nowIso()
    };
    this.verifications.set(record.id, record);
    return record;
  }
  async getVerificationCode(id) { return this.verifications.get(id) || null; }
  async getLatestVerificationCode(groupId, purpose) {
    const all = Array.from(this.verifications.values()).filter(v => v.group_id === groupId && v.purpose === purpose && !v.consumed_at);
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return all[0] || null;
  }
  async bumpVerificationAttempts(id) {
    const v = this.verifications.get(id);
    if (!v) return 0;
    v.attempts += 1;
    return v.attempts;
  }
  async consumeVerificationCode(id) {
    const v = this.verifications.get(id);
    if (!v || v.consumed_at) return null;
    v.consumed_at = nowIso();
    return v;
  }
  async bumpPasswordResetAttempts(id) {
    const r = this.passwordResets.get(id);
    if (!r) return 0;
    r.attempts = (r.attempts || 0) + 1;
    return r.attempts;
  }

  // ---------- v4: SELLER SESSIONS ----------
  async addSellerSession(groupId, sessionToken, ip) {
    if (!this.sellerSessions.has(groupId)) this.sellerSessions.set(groupId, new Map());
    this.sellerSessions.get(groupId).set(sessionToken, { ip: ip || null, created_at: nowIso() });
  }
  async hasSellerSession(groupId, sessionToken) {
    const m = this.sellerSessions.get(groupId);
    return !!(m && m.has(sessionToken));
  }
  async getSellerSessionTokens(groupId) {
    const m = this.sellerSessions.get(groupId);
    return m ? Array.from(m.keys()) : [];
  }
  async deleteSellerSessions(groupId) { this.sellerSessions.delete(groupId); }

  // ---------- v4: IP EVENTS / BLOCKS ----------
  async logIpEvent({ groupId, kind, ip, country, userAgent }) {
    this.ipEvents.push({ group_id: groupId, kind, ip, country: country || null, user_agent: (userAgent || '').slice(0, 300), created_at: nowIso() });
    if (this.ipEvents.length > 20000) this.ipEvents.splice(0, 5000);
  }
  async getIpSummary(groupId) {
    const by = new Map();
    for (const e of this.ipEvents) {
      if (e.group_id !== groupId) continue;
      const cur = by.get(e.ip) || { ip: e.ip, country: e.country, first_seen: e.created_at, last_seen: e.created_at, events: 0, kinds: {} };
      cur.events += 1; cur.last_seen = e.created_at; if (e.country) cur.country = e.country;
      cur.kinds[e.kind] = (cur.kinds[e.kind] || 0) + 1;
      by.set(e.ip, cur);
    }
    const blocked = this.blockedIps.get(groupId) || new Map();
    return Array.from(by.values()).map(r => ({ ...r, blocked: blocked.has(r.ip) })).sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
  }
  async getBlockedIps(groupId) {
    const m = this.blockedIps.get(groupId) || new Map();
    return Array.from(m.entries()).map(([ip, v]) => ({ ip, ...v }));
  }
  async blockIp(groupId, ip, reason, by) {
    if (!this.blockedIps.has(groupId)) this.blockedIps.set(groupId, new Map());
    this.blockedIps.get(groupId).set(ip, { reason: reason || null, blocked_by: by || null, created_at: nowIso() });
  }
  async unblockIp(groupId, ip) { const m = this.blockedIps.get(groupId); if (m) m.delete(ip); }
  async isIpBlocked(groupId, ip) { const m = this.blockedIps.get(groupId); return !!(m && ip && m.has(ip)); }

  // ---------- v4: TRANSLATION CACHE ----------
  async getTranslations(lang, hashes) {
    const out = {};
    for (const h of hashes) { const v = this.translations.get(`${lang}:${h}`); if (v) out[h] = v; }
    return out;
  }
  async saveTranslations(lang, entries) {
    for (const e of entries) this.translations.set(`${lang}:${e.h}`, e.text);
    if (this.translations.size > 200000) this.translations.delete(this.translations.keys().next().value);
  }

  // ---------- v4: SETTINGS ----------
  async getSetting(key) { return this.settings.has(key) ? this.settings.get(key) : null; }
  async setSetting(key, value) { this.settings.set(key, value); return value; }

  // ---------- BRANDING ----------
  async getBranding() { return this.branding; }
  async updateBranding(fields) {
    Object.assign(this.branding, fields, { updated_at: nowIso() });
    return this.branding;
  }

  // ---------- DASHBOARD WIDGETS ----------
  async getDashboardWidgets() {
    const allUsers = Array.from(this.users.values());
    const onlineUsers = allUsers.filter(u => u.is_online);

    const allTx = [];
    for (const [groupId, list] of this.transactions.entries()) {
      for (const t of list) allTx.push({ ...t, group_id: groupId });
    }
    allTx.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

    const allUploads = [];
    for (const [groupId, list] of this.messages.entries()) {
      for (const m of list) {
        if (m.file_url && !m.is_deleted) allUploads.push({ ...m, group_id: groupId });
      }
    }
    allUploads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      onlineUsers: onlineUsers.map(u => ({ displayName: u.display_name, role: u.role, isAdmin: u.is_admin })),
      recentTransactions: allTx.slice(0, 5),
      recentUploads: allUploads.slice(0, 5).map(m => ({ id: m.id, fileName: m.file_name, fileType: m.file_type, sender: m.sender_name, groupId: m.group_id, createdAt: m.created_at })),
      pendingReviews: await this.getPendingTasksCount()
    };
  }
}

module.exports = MemStore;
