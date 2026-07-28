// PostgreSQL-backed implementation of the data store interface.
// Activated automatically when process.env.DATABASE_URL is set.
// Provides real persistence across Render restarts/redeploys.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

class PgStore {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
    });
  }

  async init() {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await this.pool.query(schema);
    // Seed default group if empty
    const { rows } = await this.pool.query('SELECT id FROM groups LIMIT 1');
    if (rows.length === 0) {
      await this.pool.query(
        `INSERT INTO groups (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        ['default-group', 'General Transaction Group #1']
      );
    }
  }

  // ---------- USERS ----------
  async upsertUser(u) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (session_token, display_name, role, is_admin, email, country_code, avatar_seed, is_online, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
       ON CONFLICT (session_token) DO UPDATE SET
         display_name = COALESCE($2, users.display_name),
         role = COALESCE($3, users.role),
         is_admin = COALESCE($4, users.is_admin),
         email = CASE WHEN $5 IS NOT NULL THEN $5 ELSE users.email END,
         country_code = CASE WHEN $6 IS NOT NULL THEN $6 ELSE users.country_code END,
         is_online = COALESCE($8, users.is_online),
         last_seen = NOW()
       RETURNING *`,
      [u.sessionToken, u.displayName, u.role || 'PARTY A', !!u.isAdmin, u.email || null, u.countryCode || null, u.sessionToken, u.isOnline ?? false]
    );
    return rows[0];
  }

  async setUserOnline(sessionToken, isOnline) {
    await this.pool.query(`UPDATE users SET is_online=$2, last_seen=NOW() WHERE session_token=$1`, [sessionToken, isOnline]);
  }

  async getUser(sessionToken) {
    const { rows } = await this.pool.query(`SELECT * FROM users WHERE session_token=$1`, [sessionToken]);
    return rows[0] || null;
  }

  async getAllUsers() {
    const { rows } = await this.pool.query(`SELECT * FROM users ORDER BY last_seen DESC`);
    return rows;
  }

  // ---------- GROUPS ----------
  async createGroupIfMissing(groupId, name) {
    const { rows } = await this.pool.query(
      `INSERT INTO groups (id, name) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET id = groups.id
       RETURNING *`,
      [groupId, name]
    );
    return rows[0];
  }

  async getGroup(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM groups WHERE id=$1`, [groupId]);
    return rows[0] || null;
  }

  async getAllGroups() {
    const { rows } = await this.pool.query(`SELECT * FROM groups ORDER BY created_at ASC`);
    return rows;
  }

  async updateGroup(groupId, fields) {
    const map = {
      name: 'name', custom_name_a: 'custom_name_a', custom_name_b: 'custom_name_b',
      file_uploads_enabled: 'file_uploads_enabled', highlighted: 'highlighted',
      transaction_form_enabled: 'transaction_form_enabled'
    };
    const keys = Object.keys(fields).filter(k => map[k]);
    if (keys.length === 0) return this.getGroup(groupId);
    const setClause = keys.map((k, i) => `${map[k]} = $${i + 2}`).join(', ');
    const values = keys.map(k => fields[k]);
    const { rows } = await this.pool.query(
      `UPDATE groups SET ${setClause} WHERE id=$1 RETURNING *`,
      [groupId, ...values]
    );
    return rows[0] || null;
  }

  async deleteGroup(groupId) {
    await this.pool.query(`DELETE FROM groups WHERE id=$1`, [groupId]);
  }

  // ---------- MESSAGES ----------
  async insertMessage(msg) {
    const { rows } = await this.pool.query(
      `INSERT INTO messages (id, group_id, sender_token, sender_name, sender_role, text, file_url, file_type, file_name, reply_to_id, forwarded_from, target_lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [msg.id, msg.groupId, msg.senderToken || null, msg.senderName, msg.senderRole || null, msg.text,
       msg.fileUrl || null, msg.fileType || null, msg.fileName || null, msg.replyToId || null, msg.forwardedFrom || null, msg.targetLang || 'en']
    );
    return rows[0];
  }

  async getMessagesForGroup(groupId, limit = 500) {
    // Take the N most recent rows (DESC), then re-sort ascending for display —
    // a plain "ORDER BY created_at ASC LIMIT n" would return the OLDEST n
    // messages instead, which is wrong for both full-history loads and
    // last-message-preview lookups (limit=1).
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT * FROM messages WHERE group_id=$1 AND is_deleted=FALSE
         ORDER BY created_at DESC LIMIT $2
       ) recent ORDER BY created_at ASC`,
      [groupId, limit]
    );
    return rows;
  }

  async getMessageById(messageId) {
    const { rows } = await this.pool.query(`SELECT * FROM messages WHERE id=$1`, [messageId]);
    return rows[0] || null;
  }

  async editMessage(messageId, newText, editedBy) {
    const existing = await this.getMessageById(messageId);
    if (!existing) return null;
    await this.pool.query(
      `INSERT INTO message_edits (message_id, old_text, edited_by) VALUES ($1,$2,$3)`,
      [messageId, existing.text, editedBy]
    );
    const { rows } = await this.pool.query(
      `UPDATE messages SET text=$2, is_edited=TRUE WHERE id=$1 RETURNING *`,
      [messageId, newText]
    );
    return rows[0];
  }

  async getMessageEditHistory(messageId) {
    const { rows } = await this.pool.query(
      `SELECT old_text AS "oldText", edited_by AS "editedBy", edited_at AS "editedAt"
       FROM message_edits WHERE message_id=$1 ORDER BY edited_at ASC`,
      [messageId]
    );
    return rows;
  }

  async deleteMessages(groupId, messageIds) {
    if (!messageIds.length) return;
    await this.pool.query(
      `UPDATE messages SET is_deleted=TRUE WHERE group_id=$1 AND id = ANY($2::text[])`,
      [groupId, messageIds]
    );
    await this.pool.query(
      `DELETE FROM pinned_messages WHERE group_id=$1 AND message_id = ANY($2::text[])`,
      [groupId, messageIds]
    );
  }

  // ---------- PINS ----------
  async togglePin(groupId, messageId) {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM pinned_messages WHERE group_id=$1 AND message_id=$2`,
      [groupId, messageId]
    );
    if (rows.length) {
      await this.pool.query(`DELETE FROM pinned_messages WHERE group_id=$1 AND message_id=$2`, [groupId, messageId]);
    } else {
      await this.pool.query(`INSERT INTO pinned_messages (group_id, message_id) VALUES ($1,$2)`, [groupId, messageId]);
    }
    return this.getPinnedMessages(groupId);
  }

  async getPinnedMessages(groupId) {
    const { rows } = await this.pool.query(
      `SELECT m.* FROM messages m
       JOIN pinned_messages p ON p.message_id = m.id
       WHERE p.group_id=$1 AND m.is_deleted=FALSE
       ORDER BY p.pinned_at ASC`,
      [groupId]
    );
    return rows;
  }

  // ---------- REACTIONS ----------
  async toggleReaction(messageId, sessionToken, emoji) {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM message_reactions WHERE message_id=$1 AND session_token=$2 AND emoji=$3`,
      [messageId, sessionToken, emoji]
    );
    if (rows.length) {
      await this.pool.query(
        `DELETE FROM message_reactions WHERE message_id=$1 AND session_token=$2 AND emoji=$3`,
        [messageId, sessionToken, emoji]
      );
    } else {
      await this.pool.query(
        `INSERT INTO message_reactions (message_id, session_token, emoji) VALUES ($1,$2,$3)`,
        [messageId, sessionToken, emoji]
      );
    }
    return this.getReactionSummary(messageId);
  }

  async getReactionSummary(messageId) {
    const { rows } = await this.pool.query(
      `SELECT emoji, COUNT(*)::int AS count FROM message_reactions WHERE message_id=$1 GROUP BY emoji`,
      [messageId]
    );
    const summary = {};
    rows.forEach(r => { summary[r.emoji] = r.count; });
    return summary;
  }

  // ---------- UNREAD / NOTIFICATIONS ----------
  async incrementUnread(sessionToken, groupId) {
    await this.pool.query(
      `INSERT INTO unread_counts (session_token, group_id, count) VALUES ($1,$2,1)
       ON CONFLICT (session_token, group_id) DO UPDATE SET count = unread_counts.count + 1`,
      [sessionToken, groupId]
    );
  }

  async clearUnread(sessionToken, groupId) {
    await this.pool.query(
      `INSERT INTO unread_counts (session_token, group_id, count) VALUES ($1,$2,0)
       ON CONFLICT (session_token, group_id) DO UPDATE SET count = 0`,
      [sessionToken, groupId]
    );
  }

  async getUnreadCounts(sessionToken) {
    const { rows } = await this.pool.query(
      `SELECT group_id, count FROM unread_counts WHERE session_token=$1`,
      [sessionToken]
    );
    const out = {};
    rows.forEach(r => { out[r.group_id] = r.count; });
    return out;
  }

  async addNotification(sessionToken, type, payload) {
    const { rows } = await this.pool.query(
      `INSERT INTO notifications (session_token, type, payload) VALUES ($1,$2,$3) RETURNING *`,
      [sessionToken, type, JSON.stringify(payload)]
    );
    return rows[0];
  }

  async getNotifications(sessionToken) {
    const { rows } = await this.pool.query(
      `SELECT * FROM notifications WHERE session_token=$1 ORDER BY created_at DESC LIMIT 50`,
      [sessionToken]
    );
    return rows;
  }

  async markNotificationsRead(sessionToken) {
    await this.pool.query(`UPDATE notifications SET is_read=TRUE WHERE session_token=$1`, [sessionToken]);
  }

  // ---------- TRANSACTIONS ----------
  async insertTransaction(tx) {
    const id = uuid();
    const { rows } = await this.pool.query(
      `INSERT INTO transactions (id, group_id, full_legal_name, country, role, asset_type, asset_description,
         quantity, unit_price, total_value, payment_currency, payment_method, payment_terms, notes, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, tx.group_id, tx.full_legal_name, tx.country, tx.role, tx.asset_type, tx.asset_description,
       tx.quantity, tx.unit_price, tx.total_value, tx.payment_currency, tx.payment_method, tx.payment_terms, tx.notes, tx.submitted_by]
    );
    return rows[0];
  }

  async getTransactions(groupId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM transactions WHERE group_id=$1 ORDER BY submitted_at DESC`,
      [groupId]
    );
    return rows;
  }

  async deleteTransaction(groupId, txId) {
    await this.pool.query(`DELETE FROM transactions WHERE group_id=$1 AND id=$2`, [groupId, txId]);
  }

  // ---------- STATS ----------
  async getStats() {
    const [{ rows: u }, { rows: g }, { rows: mt }, { rows: ut }, { rows: tx }] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_online)::int AS online FROM users`),
      this.pool.query(`SELECT COUNT(*)::int AS total FROM groups`),
      this.pool.query(`SELECT COUNT(*)::int AS total FROM messages WHERE is_deleted=FALSE AND created_at >= date_trunc('day', NOW())`),
      this.pool.query(`SELECT COUNT(*)::int AS total FROM messages WHERE is_deleted=FALSE AND file_url IS NOT NULL AND created_at >= date_trunc('day', NOW())`),
      this.pool.query(`SELECT COUNT(*)::int AS total FROM transactions`)
    ].map(p => p.then(r => ({ rows: r.rows }))));

    return {
      totalUsers: u[0].total,
      onlineUsers: u[0].online,
      offlineUsers: u[0].total - u[0].online,
      totalGroups: g[0].total,
      messagesToday: mt[0].total,
      uploadsToday: ut[0].total,
      transactionsSubmitted: tx[0].total
    };
  }
}

module.exports = PgStore;
