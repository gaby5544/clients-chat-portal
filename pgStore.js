// PostgreSQL-backed implementation of the data store interface.
// Activated automatically when process.env.DATABASE_URL is set.
// Provides real persistence across host restarts/redeploys.

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
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
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
      `INSERT INTO users (session_token, display_name, role, is_admin, admin_role, email, country_code, avatar_seed, is_online, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
       ON CONFLICT (session_token) DO UPDATE SET
         display_name = COALESCE($2, users.display_name),
         role = COALESCE($3, users.role),
         is_admin = COALESCE($4, users.is_admin),
         admin_role = CASE WHEN $5 IS NOT NULL THEN $5 ELSE users.admin_role END,
         email = CASE WHEN $6 IS NOT NULL THEN $6 ELSE users.email END,
         country_code = CASE WHEN $7 IS NOT NULL THEN $7 ELSE users.country_code END,
         is_online = COALESCE($9, users.is_online),
         last_seen = NOW()
       RETURNING *`,
      [u.sessionToken, u.displayName, u.role || 'PARTY A', !!u.isAdmin, u.adminRole || null, u.email || null, u.countryCode || null, u.sessionToken, u.isOnline ?? false]
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

  async deleteUser(sessionToken) {
    await this.pool.query(`DELETE FROM users WHERE session_token=$1`, [sessionToken]);
  }

  async clearOfflineUsers() {
    const { rowCount } = await this.pool.query(`DELETE FROM users WHERE is_online=FALSE`);
    return rowCount;
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
      transaction_form_enabled: 'transaction_form_enabled', banner_url: 'banner_url'
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

  async getTransactionById(txId) {
    const { rows } = await this.pool.query(`SELECT * FROM transactions WHERE id=$1`, [txId]);
    return rows[0] || null;
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

  // ---------- ANNOUNCEMENTS ----------
  async createAnnouncement(a) {
    const id = uuid();
    const { rows } = await this.pool.query(
      `INSERT INTO announcements (id, group_id, message_id, text, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, a.groupId, a.messageId || null, a.text, a.createdBy || null]
    );
    return rows[0];
  }
  async getAnnouncements(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM announcements WHERE group_id=$1 ORDER BY created_at DESC`, [groupId]);
    return rows;
  }
  async deleteAnnouncement(groupId, id) {
    await this.pool.query(`DELETE FROM announcements WHERE group_id=$1 AND id=$2`, [groupId, id]);
  }

  // ---------- TASKS ----------
  async createTask(t) {
    const id = uuid();
    const { rows } = await this.pool.query(
      `INSERT INTO tasks (id, group_id, title, description, status, created_by, assigned_role)
       VALUES ($1,$2,$3,$4,'Pending',$5,$6) RETURNING *`,
      [id, t.groupId, t.title, t.description || null, t.createdBy || null, t.assignedRole || null]
    );
    return rows[0];
  }
  async getTasks(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM tasks WHERE group_id=$1 ORDER BY created_at DESC`, [groupId]);
    return rows;
  }
  async updateTaskStatus(groupId, taskId, status) {
    const { rows } = await this.pool.query(
      `UPDATE tasks SET status=$3, updated_at=NOW() WHERE group_id=$1 AND id=$2 RETURNING *`,
      [groupId, taskId, status]
    );
    return rows[0] || null;
  }
  async deleteTask(groupId, taskId) {
    await this.pool.query(`DELETE FROM tasks WHERE group_id=$1 AND id=$2`, [groupId, taskId]);
  }
  async getPendingTasksCount() {
    const { rows } = await this.pool.query(`SELECT COUNT(*)::int AS total FROM tasks WHERE status='Pending'`);
    return rows[0].total;
  }

  // ---------- MESSAGE READS ----------
  async markDelivered(messageId, sessionToken) {
    await this.pool.query(
      `INSERT INTO message_reads (message_id, session_token, delivered_at) VALUES ($1,$2,NOW())
       ON CONFLICT (message_id, session_token) DO UPDATE SET delivered_at = COALESCE(message_reads.delivered_at, NOW())`,
      [messageId, sessionToken]
    );
    return this.getMessageStatus(messageId);
  }
  async markRead(messageId, sessionToken) {
    await this.pool.query(
      `INSERT INTO message_reads (message_id, session_token, delivered_at, read_at) VALUES ($1,$2,NOW(),NOW())
       ON CONFLICT (message_id, session_token) DO UPDATE SET
         read_at = NOW(),
         delivered_at = COALESCE(message_reads.delivered_at, NOW())`,
      [messageId, sessionToken]
    );
    return this.getMessageStatus(messageId);
  }
  async markGroupRead(groupId, sessionToken, excludeSenderToken) {
    const { rows } = await this.pool.query(
      `SELECT id FROM messages WHERE group_id=$1 AND is_deleted=FALSE AND sender_token IS NOT NULL AND sender_token != $2`,
      [groupId, sessionToken]
    );
    const ids = rows.map(r => r.id);
    for (const id of ids) await this.markRead(id, sessionToken);
    return ids;
  }
  async getMessageStatus(messageId) {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) FILTER (WHERE read_at IS NOT NULL)::int AS read_count,
              COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered_count
       FROM message_reads WHERE message_id=$1`,
      [messageId]
    );
    const { read_count, delivered_count } = rows[0];
    if (read_count > 0) return 'read';
    if (delivered_count > 0) return 'delivered';
    return 'sent';
  }

  // ---------- PUSH SUBSCRIPTIONS ----------
  async savePushSubscription(sessionToken, sub) {
    await this.pool.query(
      `INSERT INTO push_subscriptions (session_token, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET session_token=$1, p256dh=$3, auth=$4`,
      [sessionToken, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
  }
  async removePushSubscription(endpoint) {
    await this.pool.query(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [endpoint]);
  }
  async getPushSubscriptionsForUser(sessionToken) {
    const { rows } = await this.pool.query(`SELECT * FROM push_subscriptions WHERE session_token=$1`, [sessionToken]);
    return rows;
  }

  // ---------- BRANDING ----------
  async getBranding() {
    const { rows } = await this.pool.query(`SELECT * FROM branding_settings WHERE id=1`);
    if (rows[0]) return rows[0];
    const { rows: inserted } = await this.pool.query(`INSERT INTO branding_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING RETURNING *`);
    return inserted[0] || (await this.pool.query(`SELECT * FROM branding_settings WHERE id=1`)).rows[0];
  }
  async updateBranding(fields) {
    const map = { logo_url: 'logo_url', accent_color: 'accent_color', accent_color_2: 'accent_color_2', welcome_message: 'welcome_message', background_url: 'background_url' };
    const keys = Object.keys(fields).filter(k => map[k]);
    if (keys.length === 0) return this.getBranding();
    await this.getBranding(); // ensure row exists
    const setClause = keys.map((k, i) => `${map[k]} = $${i + 1}`).join(', ');
    const values = keys.map(k => fields[k]);
    const { rows } = await this.pool.query(
      `UPDATE branding_settings SET ${setClause}, updated_at=NOW() WHERE id=1 RETURNING *`,
      values
    );
    return rows[0];
  }

  // ---------- DASHBOARD WIDGETS ----------
  async getDashboardWidgets() {
    const [{ rows: online }, { rows: recentTx }, { rows: recentUploads }, pendingReviews] = await Promise.all([
      this.pool.query(`SELECT display_name, role, is_admin FROM users WHERE is_online=TRUE ORDER BY last_seen DESC`),
      this.pool.query(`SELECT * FROM transactions ORDER BY submitted_at DESC LIMIT 5`),
      this.pool.query(`SELECT id, file_name, file_type, sender_name, group_id, created_at FROM messages WHERE file_url IS NOT NULL AND is_deleted=FALSE ORDER BY created_at DESC LIMIT 5`),
      this.getPendingTasksCount()
    ]);
    return {
      onlineUsers: online.map(u => ({ displayName: u.display_name, role: u.role, isAdmin: u.is_admin })),
      recentTransactions: recentTx,
      recentUploads: recentUploads.map(m => ({ id: m.id, fileName: m.file_name, fileType: m.file_type, sender: m.sender_name, groupId: m.group_id, createdAt: m.created_at })),
      pendingReviews
    };
  }

  // ==================================================================
  // SELLER ACCOUNTS, KYC, DEPOSITS & WITHDRAWALS
  // ==================================================================

  async _ensureBalanceRow(groupId, client = this.pool) {
    await client.query(
      `INSERT INTO balances (group_id) VALUES ($1) ON CONFLICT (group_id) DO NOTHING`,
      [groupId]
    );
  }

  // ---------- INVITES / REGISTRATION ----------
  async createInvite({ email }) {
    const id = uuid();
    const inviteToken = uuid();
    const { rows } = await this.pool.query(
      `INSERT INTO groups (id, name, owner_email, invite_token, registration_status)
       VALUES ($1, 'Pending Registration', $2, $3, 'invited') RETURNING *`,
      [id, email, inviteToken]
    );
    return rows[0];
  }

  async getGroupByInviteToken(token) {
    const { rows } = await this.pool.query(`SELECT * FROM groups WHERE invite_token=$1`, [token]);
    return rows[0] || null;
  }

  async getGroupByOwnerEmail(email) {
    const { rows } = await this.pool.query(
      `SELECT * FROM groups WHERE lower(owner_email) = lower($1)`, [email]
    );
    return rows[0] || null;
  }

  async completeRegistration(groupId, { fullName, passwordHash, groupName, currency }) {
    const { rows } = await this.pool.query(
      `UPDATE groups SET owner_full_name=$2, owner_password_hash=$3, name=$4, currency=$5,
         registration_status='active', kyc_status='not_submitted', invite_consumed_at=NOW()
       WHERE id=$1 RETURNING *`,
      [groupId, fullName, passwordHash, groupName, currency]
    );
    await this._ensureBalanceRow(groupId);
    return rows[0] || null;
  }

  async lockCurrencyIfNeeded(groupId) {
    await this.pool.query(
      `UPDATE groups SET currency_locked_at = NOW() WHERE id=$1 AND currency_locked_at IS NULL`,
      [groupId]
    );
  }

  async updateSellerProfile(groupId, { fullName }) {
    const { rows } = await this.pool.query(
      `UPDATE groups SET owner_full_name = COALESCE($2, owner_full_name) WHERE id=$1 RETURNING *`,
      [groupId, fullName || null]
    );
    return rows[0] || null;
  }

  // ---------- SESSIONS ----------
  async createSellerSession(token, groupId, expiresAt) {
    await this.pool.query(
      `INSERT INTO seller_sessions (session_token, group_id, expires_at) VALUES ($1,$2,$3)`,
      [token, groupId, expiresAt]
    );
  }
  async getSellerSession(token) {
    const { rows } = await this.pool.query(`SELECT * FROM seller_sessions WHERE session_token=$1`, [token]);
    return rows[0] || null;
  }
  async deleteSellerSession(token) {
    await this.pool.query(`DELETE FROM seller_sessions WHERE session_token=$1`, [token]);
  }

  // ---------- PASSWORD RESET ----------
  async createPasswordResetCode(groupId, codeHash, expiresAt) {
    const { rows } = await this.pool.query(
      `INSERT INTO password_reset_codes (group_id, code_hash, expires_at) VALUES ($1,$2,$3) RETURNING *`,
      [groupId, codeHash, expiresAt]
    );
    return rows[0];
  }
  async findValidResetCode(groupId, codeHash) {
    const { rows } = await this.pool.query(
      `SELECT * FROM password_reset_codes
       WHERE group_id=$1 AND code_hash=$2 AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [groupId, codeHash]
    );
    return rows[0] || null;
  }
  async consumeResetCode(groupId, codeHash) {
    const { rowCount } = await this.pool.query(
      `UPDATE password_reset_codes SET consumed_at=NOW()
       WHERE id = (
         SELECT id FROM password_reset_codes
         WHERE group_id=$1 AND code_hash=$2 AND consumed_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1
       )`,
      [groupId, codeHash]
    );
    return rowCount > 0;
  }
  async setOwnerPassword(groupId, passwordHash) {
    const { rows } = await this.pool.query(
      `UPDATE groups SET owner_password_hash=$2 WHERE id=$1 RETURNING *`,
      [groupId, passwordHash]
    );
    return rows[0] || null;
  }

  // ---------- KYC ----------
  async createKycSubmission(sub) {
    const id = uuid();
    const { rows } = await this.pool.query(
      `INSERT INTO kyc_submissions (id, group_id, doc_type, id_front_url, id_back_url, proof_of_address_url, selfie_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [id, sub.groupId, sub.docType, sub.idFrontUrl, sub.idBackUrl || null, sub.proofOfAddressUrl, sub.selfieUrl]
    );
    await this.pool.query(`UPDATE groups SET kyc_status='pending' WHERE id=$1`, [sub.groupId]);
    return rows[0];
  }
  async getKycSubmissions(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM kyc_submissions WHERE group_id=$1 ORDER BY created_at DESC`, [groupId]);
    return rows;
  }
  async getKycSubmissionById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM kyc_submissions WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async getKycQueue() {
    const { rows } = await this.pool.query(
      `SELECT k.*, g.name AS group_name, g.owner_email
       FROM kyc_submissions k JOIN groups g ON g.id = k.group_id
       WHERE k.status='pending'
       ORDER BY k.created_at ASC`
    );
    return rows;
  }
  async reviewKyc(submissionId, { status, reviewedBy, rejectionReason }) {
    const { rows } = await this.pool.query(
      `UPDATE kyc_submissions SET status=$2, reviewed_by=$3, reviewed_at=NOW(), rejection_reason=$4
       WHERE id=$1 RETURNING *`,
      [submissionId, status, reviewedBy || null, rejectionReason || null]
    );
    const sub = rows[0];
    if (!sub) return null;
    const { rows: grows } = await this.pool.query(
      `UPDATE groups SET kyc_status=$2 WHERE id=$1 RETURNING *`,
      [sub.group_id, status]
    );
    return { submission: sub, groupId: sub.group_id, group: grows[0] };
  }

  // ---------- DEPOSITS ----------
  async createDeposit(dep) {
    const id = uuid();
    const reference = `DEP-${id.slice(0, 6).toUpperCase()}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO deposits (id, group_id, reference, method, asset, network, amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'held_in_vault') RETURNING *`,
        [id, dep.groupId, reference, dep.method, dep.asset || null, dep.network || null, dep.amount]
      );
      await this._ensureBalanceRow(dep.groupId, client);
      await client.query(
        `UPDATE balances SET held = held + $2, updated_at=NOW() WHERE group_id=$1`,
        [dep.groupId, dep.amount]
      );
      await client.query('COMMIT');
      return { ...rows[0], amount: Number(rows[0].amount) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async getDeposits(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM deposits WHERE group_id=$1 ORDER BY created_at DESC`, [groupId]);
    return rows.map(r => ({ ...r, amount: Number(r.amount) }));
  }
  async getDepositQueue() {
    const { rows } = await this.pool.query(
      `SELECT d.*, g.name AS group_name FROM deposits d JOIN groups g ON g.id = d.group_id
       WHERE d.status='held_in_vault' ORDER BY d.created_at ASC`
    );
    return rows.map(r => ({ ...r, amount: Number(r.amount) }));
  }
  async getTotalDeposited(groupId) {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE group_id=$1 AND status != 'rejected'`,
      [groupId]
    );
    return Number(rows[0].total);
  }
  async reviewDeposit(depositId, { status, reviewedBy, rejectionReason }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: drows } = await client.query(`SELECT * FROM deposits WHERE id=$1 FOR UPDATE`, [depositId]);
      const dep = drows[0];
      if (!dep) { await client.query('ROLLBACK'); return null; }
      if (dep.status !== 'held_in_vault') { await client.query('ROLLBACK'); return { deposit: dep, groupId: dep.group_id, noop: true }; }
      await client.query(`UPDATE balances SET held = held - $2, updated_at=NOW() WHERE group_id=$1`, [dep.group_id, dep.amount]);
      if (status === 'verified') {
        await client.query(`UPDATE balances SET available = available + $2, updated_at=NOW() WHERE group_id=$1`, [dep.group_id, dep.amount]);
      }
      const { rows: updated } = await client.query(
        `UPDATE deposits SET status=$2, reviewed_by=$3, reviewed_at=NOW(), rejection_reason=$4 WHERE id=$1 RETURNING *`,
        [depositId, status, reviewedBy || null, rejectionReason || null]
      );
      const { rows: grows } = await client.query(`SELECT * FROM groups WHERE id=$1`, [dep.group_id]);
      await client.query('COMMIT');
      return { deposit: { ...updated[0], amount: Number(updated[0].amount) }, groupId: dep.group_id, group: grows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------- WITHDRAWALS ----------
  async createWithdrawal(w) {
    const id = uuid();
    const reference = `WD-${id.slice(0, 6).toUpperCase()}`;
    const history = JSON.stringify([{ status: 'pending', at: new Date().toISOString(), byAdminId: null, note: null }]);
    const { rows } = await this.pool.query(
      `INSERT INTO withdrawal_requests (id, group_id, reference, method, asset, network, destination, amount, amount_currency, entered_amount, entered_currency, amount_usd_equiv, status, status_history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13) RETURNING *`,
      [id, w.groupId, reference, w.method, w.asset || null, w.network || null,
        w.destination ? JSON.stringify(w.destination) : null, w.amount, w.amountCurrency,
        w.enteredAmount != null ? w.enteredAmount : null, w.enteredCurrency || null, w.amountUsdEquiv || null, history]
    );
    return { ...rows[0], amount: Number(rows[0].amount) };
  }
  async getWithdrawals(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM withdrawal_requests WHERE group_id=$1 ORDER BY created_at DESC`, [groupId]);
    return rows.map(r => ({ ...r, amount: Number(r.amount) }));
  }
  async getWithdrawalQueue() {
    const { rows } = await this.pool.query(
      `SELECT w.*, g.name AS group_name FROM withdrawal_requests w JOIN groups g ON g.id = w.group_id
       WHERE w.status NOT IN ('completed','rejected','failed') ORDER BY w.created_at ASC`
    );
    return rows.map(r => ({ ...r, amount: Number(r.amount) }));
  }
  async advanceWithdrawal(withdrawalId, { status, reason, adminId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: wrows } = await client.query(`SELECT * FROM withdrawal_requests WHERE id=$1 FOR UPDATE`, [withdrawalId]);
      const wd = wrows[0];
      if (!wd) { await client.query('ROLLBACK'); return null; }
      const prev = wd.status;
      const TERMINAL = ['completed', 'rejected', 'failed'];
      if (TERMINAL.includes(prev)) { await client.query('ROLLBACK'); return { withdrawal: wd, groupId: wd.group_id, noop: true }; }
      const amount = Number(wd.amount);
      const isReturn = (prev === 'held_in_vault' || prev === 'processing') && (status === 'rejected' || status === 'failed');
      if (prev === 'pending' && status === 'held_in_vault') {
        await client.query(`UPDATE balances SET available = available - $2, held = held + $2, updated_at=NOW() WHERE group_id=$1`, [wd.group_id, amount]);
      } else if (prev === 'held_in_vault' && status === 'processing') {
        // no balance movement
      } else if (prev === 'processing' && status === 'completed') {
        await client.query(`UPDATE balances SET held = held - $2, updated_at=NOW() WHERE group_id=$1`, [wd.group_id, amount]);
      } else if (isReturn) {
        await client.query(`UPDATE balances SET held = held - $2, available = available + $2, updated_at=NOW() WHERE group_id=$1`, [wd.group_id, amount]);
      } else if (prev === 'pending' && (status === 'rejected' || status === 'failed')) {
        // funds were never moved
      } else {
        await client.query('ROLLBACK');
        throw new Error(`Invalid withdrawal transition: ${prev} -> ${status}`);
      }
      const newHistoryEntry = { status, at: new Date().toISOString(), byAdminId: adminId || null, note: reason || null };
      const { rows: updated } = await client.query(
        `UPDATE withdrawal_requests
         SET status=$2, status_reason=$3, status_history = status_history || $4::jsonb, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [withdrawalId, status, reason || null, JSON.stringify([newHistoryEntry])]
      );
      const { rows: grows } = await client.query(`SELECT * FROM groups WHERE id=$1`, [wd.group_id]);
      await client.query('COMMIT');
      return { withdrawal: { ...updated[0], amount: Number(updated[0].amount) }, groupId: wd.group_id, group: grows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------- BALANCES ----------
  async getBalances(groupId) {
    await this._ensureBalanceRow(groupId);
    const { rows } = await this.pool.query(`SELECT * FROM balances WHERE group_id=$1`, [groupId]);
    const b = rows[0];
    return { available: Number(b.available), held: Number(b.held), updated_at: b.updated_at };
  }
}

module.exports = PgStore;
