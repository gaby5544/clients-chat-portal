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
    // ---- v3.1 ----
    seller_phone: null, seller_account_id: null, seller_language: 'en', seller_account_type: 'Standard account',
    seller_registered_at: null, seller_terms_accepted_at: null, seller_terms_version: null, seller_onboarding_choice: null,
    seller_disabled: false, seller_disabled_at: null, seller_disabled_reason: null,
    disbursement_enabled: false, disbursement_updated_at: null,
    seller_registration_ip: null, seller_last_ip: null, seller_ip_log: [], seller_blocked_ips: [], seller_auth_tokens: [],
    kyc_id_number: null, kyc_id_name: null, kyc_id_dob: null, kyc_id_expiry: null, kyc_id_country: null, kyc_attempts: 0,
    business_status: 'none', business_data: null, business_submitted_at: null, business_reviewed_at: null, business_rejection_reason: null,
    crypto_deposit_verified: false, crypto_override_by: null
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
    this.emailCodes = new Map();     // id -> one-time email code (registration / withdrawal confirmation)
    this.settings = new Map();       // key -> JSON value (crypto tiers, limits)
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
      phone: u.phone !== undefined ? u.phone : existing.phone ?? null,
      pref_lang: u.prefLang !== undefined ? u.prefLang : existing.pref_lang ?? null,
      last_ip: u.lastIp !== undefined ? u.lastIp : existing.last_ip ?? null,
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

  async getGroupBySellerAccountId(accountId) {
    for (const g of this.groups.values()) if (g.seller_account_id && g.seller_account_id === String(accountId)) return g;
    return null;
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
    for (const map of [this.deposits, this.withdrawals, this.incoming, this.passwordResets, this.emailCodes]) {
      for (const [id, rec] of map.entries()) if (rec.group_id === groupId) map.delete(id);
    }
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
    m.set(groupId, (m.get(groupId) || 0) + 1);
    if (!this.unreadMeta) this.unreadMeta = new Map();
    const k = sessionToken + '|' + groupId;
    const meta = this.unreadMeta.get(k);
    if (!meta || !meta.first_unread_at) this.unreadMeta.set(k, { first_unread_at: nowIso(), last_reminded_at: null });
  }

  async clearUnread(sessionToken, groupId) {
    const m = this.unread.get(sessionToken);
    if (m) m.set(groupId, 0);
    if (this.unreadMeta) this.unreadMeta.delete(sessionToken + '|' + groupId);
  }

  // Unread rows whose last nudge (or first unread moment) is at least `olderThanMs` ago — drives the 60-minute reminders.
  async getDueReminders(olderThanMs) {
    const out = [];
    const cutoff = Date.now() - olderThanMs;
    for (const [token, m] of this.unread.entries()) {
      for (const [groupId, count] of m.entries()) {
        if (!(count > 0)) continue;
        const meta = (this.unreadMeta && this.unreadMeta.get(token + '|' + groupId)) || null;
        if (!meta) continue;
        const since = new Date(meta.last_reminded_at || meta.first_unread_at).getTime();
        if (since <= cutoff) out.push({ session_token: token, group_id: groupId, count, first_unread_at: meta.first_unread_at, last_reminded_at: meta.last_reminded_at });
      }
    }
    return out;
  }
  async markReminded(sessionToken, groupId) {
    const meta = this.unreadMeta && this.unreadMeta.get(sessionToken + '|' + groupId);
    if (meta) meta.last_reminded_at = nowIso();
  }

  async getUnreadCounts(sessionToken) {
    const m = this.unread.get(sessionToken);
    return m ? Object.fromEntries(m) : {};
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
      funds_reserved: !!rec.fundsReserved, payout_reference: null, request_ip: rec.requestIp || null,
      seller_account_id: rec.sellerAccountId || null,
      status_history: [{ status: 'pending', at: nowIso(), by: null, note: 'Submitted by seller' }],
      created_at: nowIso(), updated_at: nowIso()
    };
    this.withdrawals.set(record.id, record);
    return record;
  }
  async updateWithdrawal(id, fields) {
    const w = this.withdrawals.get(id);
    if (!w) return null;
    const allowed = ['funds_reserved', 'payout_reference'];
    for (const k of Object.keys(fields)) if (allowed.includes(k)) w[k] = fields[k];
    w.updated_at = nowIso();
    return w;
  }
  async getWithdrawalsForGroup(groupId) {
    return Array.from(this.withdrawals.values()).filter(w => w.group_id === groupId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  async getWithdrawalById(id) { return this.withdrawals.get(id) || null; }
  async getPendingWithdrawals() {
    return Array.from(this.withdrawals.values())
      .filter(w => !['completed', 'declined', 'rejected', 'failed'].includes(w.status))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  async advanceWithdrawal(id, { status, reason, by, expectedStatus }) {
    const w = this.withdrawals.get(id);
    if (!w) return null;
    if (expectedStatus && w.status !== expectedStatus) return null; // compare-and-set: someone else moved it first
    w.status = status;
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
      payer_phone: rec.payerPhone || null, payer_type: rec.payerType || null, payer_bank: rec.payerBank || null,
      invoice_ref: rec.invoiceRef || null, wallet_address: rec.walletAddress || null, target_account_id: rec.targetAccountId || null,
      note_shared: !!rec.noteShared, review_mode: rec.reviewMode || 'none', review_stage: rec.reviewStage ?? 6,
      review_checks: rec.reviewChecks || 0, review_elapsed_ms: rec.reviewElapsedMs || 0, review_last_tick: rec.reviewLastTick || null,
      review_paused: !!rec.reviewPaused, review_speed: rec.reviewSpeed || 1, review_show_time: !!rec.reviewShowTime,
      review_timers: rec.reviewTimers || null, review_stage_times: rec.reviewStageTimes || [],
      created_at: now, updated_at: now
    };
    this.incoming.set(record.id, record);
    return record;
  }
  async updateIncomingFunds(id, fields) {
    const i = this.incoming.get(id);
    if (!i) return null;
    const allowed = ['review_mode', 'review_stage', 'review_checks', 'review_elapsed_ms', 'review_last_tick', 'review_paused', 'review_speed',
      'review_show_time', 'review_timers', 'review_stage_times', 'note_shared', 'internal_note'];
    for (const k of Object.keys(fields)) if (allowed.includes(k)) i[k] = fields[k];
    i.updated_at = nowIso();
    return i;
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

  // ---------- EMAIL CODES (registration verification / withdrawal confirmation) ----------
  async createEmailCode(rec) {
    // A new code supersedes any earlier unconsumed one for the same purpose.
    for (const c of this.emailCodes.values()) if (c.group_id === rec.groupId && c.purpose === rec.purpose && !c.consumed_at) c.consumed_at = nowIso();
    const record = {
      id: uuid(), group_id: rec.groupId, purpose: rec.purpose, email: rec.email, code_hash: rec.codeHash,
      payload: rec.payload || null, attempts: 0, expires_at: rec.expiresAt, verified_at: null, consumed_at: null, created_at: nowIso()
    };
    this.emailCodes.set(record.id, record);
    return record;
  }
  async getLatestEmailCode(groupId, purpose) {
    const all = Array.from(this.emailCodes.values()).filter(c => c.group_id === groupId && c.purpose === purpose && !c.consumed_at);
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return all[0] || null;
  }
  async bumpEmailCodeAttempts(id) { const c = this.emailCodes.get(id); if (c) c.attempts += 1; return c ? c.attempts : 0; }
  async markEmailCodeVerified(id) { const c = this.emailCodes.get(id); if (c) c.verified_at = nowIso(); return c || null; }
  // Compare-and-set: only the first caller gets the row, so a code can never be used twice.
  async consumeEmailCode(id) {
    const c = this.emailCodes.get(id);
    if (!c || c.consumed_at) return null;
    c.consumed_at = nowIso();
    return c;
  }

  // ---------- APP SETTINGS ----------
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
