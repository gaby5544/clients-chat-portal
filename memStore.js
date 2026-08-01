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
    custom_name_a: 'Buyer (Party A)',
    custom_name_b: 'Seller (Party B)',
    file_uploads_enabled: true,
    highlighted: false,
    transaction_form_enabled: false,
    created_at: nowIso()
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

    this.groups.set('default-group', makeDefaultGroup('default-group', 'General Transaction Group #1'));
    this.messages.set('default-group', []);
    this.pins.set('default-group', new Set());
    this.transactions.set('default-group', []);
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
}

module.exports = MemStore;
