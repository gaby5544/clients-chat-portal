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
    file_uploads_enabled: true,
    highlighted: false,
    transaction_form_enabled: false,
    banner_url: null,
    created_at: nowIso(),
    // Seller account / finance fields — a group created from the admin
    // panel (not via an invite) is chat-only until/unless it's turned into
    // a seller account through the invite+registration flow.
    account_type: 'seller_type_a',
    registration_status: 'invited',
    invite_token: null,
    invite_consumed_at: null,
    owner_full_name: null,
    owner_email: null,
    owner_password_hash: null,
    currency: null,
    currency_locked_at: null,
    kyc_status: 'not_submitted'
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
    this.branding = {
      id: 1, logo_url: null, accent_color: '#38bdf8', accent_color_2: '#8b5cf6',
      welcome_message: 'Welcome to Quantum Secure Transaction Desk.', background_url: null,
      updated_at: nowIso()
    };

    // ---- Seller accounts / finance (see sellerAuth.js + routes.js) ----
    this.sellerSessions = new Map();     // token -> {group_id, expires_at}
    this.resetCodes = new Map();         // groupId -> [{codeHash, expiresAt, consumedAt}]
    this.kycSubmissions = new Map();     // groupId -> [submission]
    this.deposits = new Map();           // groupId -> [deposit]
    this.withdrawals = new Map();        // groupId -> [withdrawal]
    this.balances = new Map();           // groupId -> {available, held}

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
  }

  async clearUnread(sessionToken, groupId) {
    const m = this.unread.get(sessionToken);
    if (m) m.set(groupId, 0);
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

  // ==================================================================
  // SELLER ACCOUNTS, KYC, DEPOSITS & WITHDRAWALS
  // ==================================================================

  _ensureBalance(groupId) {
    if (!this.balances.has(groupId)) this.balances.set(groupId, { available: 0, held: 0, updated_at: nowIso() });
    return this.balances.get(groupId);
  }

  // ---------- INVITES / REGISTRATION ----------
  async createInvite({ email, createdBy }) {
    const id = uuid();
    const inviteToken = uuid();
    const group = {
      ...makeDefaultGroup(id, 'Pending Registration'),
      owner_email: email,
      invite_token: inviteToken,
      registration_status: 'invited'
    };
    this.groups.set(id, group);
    this.messages.set(id, []);
    this.pins.set(id, new Set());
    this.transactions.set(id, []);
    this.announcements.set(id, []);
    this.tasks.set(id, []);
    return group;
  }

  async getGroupByInviteToken(token) {
    for (const g of this.groups.values()) {
      if (g.invite_token === token) return g;
    }
    return null;
  }

  async getGroupByOwnerEmail(email) {
    const norm = (email || '').trim().toLowerCase();
    for (const g of this.groups.values()) {
      if ((g.owner_email || '').trim().toLowerCase() === norm) return g;
    }
    return null;
  }

  async completeRegistration(groupId, { fullName, passwordHash, groupName, currency }) {
    const g = this.groups.get(groupId);
    if (!g) return null;
    g.owner_full_name = fullName;
    g.owner_password_hash = passwordHash;
    g.name = groupName;
    g.currency = currency;
    g.registration_status = 'active';
    g.kyc_status = 'not_submitted';
    g.invite_consumed_at = nowIso();
    this._ensureBalance(groupId);
    return g;
  }

  async lockCurrencyIfNeeded(groupId) {
    const g = this.groups.get(groupId);
    if (g && !g.currency_locked_at) g.currency_locked_at = nowIso();
  }

  async updateSellerProfile(groupId, { fullName }) {
    const g = this.groups.get(groupId);
    if (!g) return null;
    if (fullName) g.owner_full_name = fullName;
    return g;
  }

  // ---------- SESSIONS ----------
  async createSellerSession(token, groupId, expiresAt) {
    this.sellerSessions.set(token, { group_id: groupId, expires_at: expiresAt });
  }
  async getSellerSession(token) { return this.sellerSessions.get(token) || null; }
  async deleteSellerSession(token) { this.sellerSessions.delete(token); }

  // ---------- PASSWORD RESET ----------
  async createPasswordResetCode(groupId, codeHash, expiresAt) {
    if (!this.resetCodes.has(groupId)) this.resetCodes.set(groupId, []);
    const record = { codeHash, expiresAt, consumedAt: null, createdAt: nowIso() };
    this.resetCodes.get(groupId).push(record);
    return record;
  }
  async findValidResetCode(groupId, codeHash) {
    const list = this.resetCodes.get(groupId) || [];
    const now = new Date();
    return list.find(r => r.codeHash === codeHash && !r.consumedAt && new Date(r.expiresAt) > now) || null;
  }
  async consumeResetCode(groupId, codeHash) {
    const record = await this.findValidResetCode(groupId, codeHash);
    if (record) record.consumedAt = nowIso();
    return !!record;
  }
  async setOwnerPassword(groupId, passwordHash) {
    const g = this.groups.get(groupId);
    if (!g) return null;
    g.owner_password_hash = passwordHash;
    return g;
  }

  // ---------- KYC ----------
  async createKycSubmission(sub) {
    const record = {
      id: uuid(), group_id: sub.groupId, doc_type: sub.docType,
      id_front_url: sub.idFrontUrl, id_back_url: sub.idBackUrl || null,
      proof_of_address_url: sub.proofOfAddressUrl, selfie_url: sub.selfieUrl,
      status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null,
      created_at: nowIso()
    };
    if (!this.kycSubmissions.has(sub.groupId)) this.kycSubmissions.set(sub.groupId, []);
    this.kycSubmissions.get(sub.groupId).unshift(record);
    const g = this.groups.get(sub.groupId);
    if (g) g.kyc_status = 'pending';
    return record;
  }
  async getKycSubmissions(groupId) { return this.kycSubmissions.get(groupId) || []; }
  async getKycSubmissionById(id) {
    for (const list of this.kycSubmissions.values()) {
      const found = list.find(s => s.id === id);
      if (found) return found;
    }
    return null;
  }
  async getKycQueue() {
    const out = [];
    for (const [groupId, list] of this.kycSubmissions.entries()) {
      const latest = list[0];
      if (latest && latest.status === 'pending') {
        const g = this.groups.get(groupId);
        out.push({ ...latest, group_name: g ? g.name : null, owner_email: g ? g.owner_email : null });
      }
    }
    return out;
  }
  async reviewKyc(submissionId, { status, reviewedBy, rejectionReason }) {
    for (const [groupId, list] of this.kycSubmissions.entries()) {
      const sub = list.find(s => s.id === submissionId);
      if (sub) {
        sub.status = status;
        sub.reviewed_by = reviewedBy || null;
        sub.reviewed_at = nowIso();
        sub.rejection_reason = rejectionReason || null;
        const g = this.groups.get(groupId);
        if (g) g.kyc_status = status;
        return { submission: sub, groupId, group: g };
      }
    }
    return null;
  }

  // ---------- DEPOSITS ----------
  async createDeposit(dep) {
    const record = {
      id: uuid(), group_id: dep.groupId, reference: `DEP-${uuid().slice(0, 6).toUpperCase()}`,
      method: dep.method, asset: dep.asset || null, network: dep.network || null,
      amount: Number(dep.amount), status: 'held_in_vault',
      rejection_reason: null, reviewed_by: null, reviewed_at: null, created_at: nowIso()
    };
    if (!this.deposits.has(dep.groupId)) this.deposits.set(dep.groupId, []);
    this.deposits.get(dep.groupId).unshift(record);
    const bal = this._ensureBalance(dep.groupId);
    bal.held += record.amount;
    bal.updated_at = nowIso();
    return record;
  }
  async getDeposits(groupId) { return this.deposits.get(groupId) || []; }
  async getDepositQueue() {
    const out = [];
    for (const [groupId, list] of this.deposits.entries()) {
      const g = this.groups.get(groupId);
      list.filter(d => d.status === 'held_in_vault').forEach(d => out.push({ ...d, group_name: g ? g.name : null }));
    }
    return out;
  }
  async getTotalDeposited(groupId) {
    const list = this.deposits.get(groupId) || [];
    return list.filter(d => d.status !== 'rejected').reduce((sum, d) => sum + d.amount, 0);
  }
  async reviewDeposit(depositId, { status, reviewedBy, rejectionReason }) {
    for (const [groupId, list] of this.deposits.entries()) {
      const dep = list.find(d => d.id === depositId);
      if (dep) {
        if (dep.status !== 'held_in_vault') return { deposit: dep, groupId, noop: true };
        const bal = this._ensureBalance(groupId);
        bal.held -= dep.amount;
        if (status === 'verified') bal.available += dep.amount;
        bal.updated_at = nowIso();
        dep.status = status;
        dep.reviewed_by = reviewedBy || null;
        dep.reviewed_at = nowIso();
        dep.rejection_reason = rejectionReason || null;
        return { deposit: dep, groupId, group: this.groups.get(groupId) };
      }
    }
    return null;
  }

  // ---------- WITHDRAWALS ----------
  async createWithdrawal(w) {
    const record = {
      id: uuid(), group_id: w.groupId, reference: `WD-${uuid().slice(0, 6).toUpperCase()}`,
      method: w.method, asset: w.asset || null, network: w.network || null,
      destination: w.destination || null, amount: Number(w.amount),
      amount_currency: w.amountCurrency,
      entered_amount: w.enteredAmount != null ? Number(w.enteredAmount) : null,
      entered_currency: w.enteredCurrency || null,
      amount_usd_equiv: w.amountUsdEquiv || null,
      status: 'pending', status_reason: null, status_history: [{ status: 'pending', at: nowIso(), byAdminId: null, note: null }],
      created_at: nowIso(), updated_at: nowIso()
    };
    if (!this.withdrawals.has(w.groupId)) this.withdrawals.set(w.groupId, []);
    this.withdrawals.get(w.groupId).unshift(record);
    return record;
  }
  async getWithdrawals(groupId) { return this.withdrawals.get(groupId) || []; }
  async getWithdrawalQueue() {
    const out = [];
    for (const [groupId, list] of this.withdrawals.entries()) {
      const g = this.groups.get(groupId);
      list.filter(w => !['completed', 'rejected', 'failed'].includes(w.status))
        .forEach(w => out.push({ ...w, group_name: g ? g.name : null }));
    }
    return out;
  }
  async advanceWithdrawal(withdrawalId, { status, reason, adminId }) {
    for (const [groupId, list] of this.withdrawals.entries()) {
      const wd = list.find(w => w.id === withdrawalId);
      if (!wd) continue;
      const prev = wd.status;
      const TERMINAL = ['completed', 'rejected', 'failed'];
      if (TERMINAL.includes(prev)) return { withdrawal: wd, groupId, noop: true };
      const bal = this._ensureBalance(groupId);
      const isReturn = (prev === 'held_in_vault' || prev === 'processing') && (status === 'rejected' || status === 'failed');
      if (prev === 'pending' && status === 'held_in_vault') {
        bal.available -= wd.amount; bal.held += wd.amount;
      } else if (prev === 'held_in_vault' && status === 'processing') {
        // no balance movement — still held
      } else if (prev === 'processing' && status === 'completed') {
        bal.held -= wd.amount;
      } else if (isReturn) {
        bal.held -= wd.amount; bal.available += wd.amount;
      } else if (prev === 'pending' && (status === 'rejected' || status === 'failed')) {
        // funds were never moved out of available
      } else {
        throw new Error(`Invalid withdrawal transition: ${prev} -> ${status}`);
      }
      bal.updated_at = nowIso();
      wd.status = status;
      wd.status_reason = reason || null;
      wd.status_history.push({ status, at: nowIso(), byAdminId: adminId || null, note: reason || null });
      wd.updated_at = nowIso();
      return { withdrawal: wd, groupId, group: this.groups.get(groupId) };
    }
    return null;
  }

  // ---------- BALANCES ----------
  async getBalances(groupId) {
    const bal = this._ensureBalance(groupId);
    return { available: bal.available, held: bal.held, updated_at: bal.updated_at };
  }
}

module.exports = MemStore;
