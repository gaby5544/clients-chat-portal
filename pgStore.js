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
      `INSERT INTO users (session_token, display_name, role, is_admin, admin_role, email, country_code, avatar_seed, is_online, last_seen, phone, pref_lang, last_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), $10, $11, $12)
       ON CONFLICT (session_token) DO UPDATE SET
         display_name = COALESCE($2, users.display_name),
         role = COALESCE($3, users.role),
         is_admin = COALESCE($4, users.is_admin),
         admin_role = CASE WHEN $5 IS NOT NULL THEN $5 ELSE users.admin_role END,
         email = CASE WHEN $6 IS NOT NULL THEN $6 ELSE users.email END,
         country_code = CASE WHEN $7 IS NOT NULL THEN $7 ELSE users.country_code END,
         is_online = COALESCE($9, users.is_online),
         phone = CASE WHEN $10 IS NOT NULL THEN $10 ELSE users.phone END,
         pref_lang = CASE WHEN $11 IS NOT NULL THEN $11 ELSE users.pref_lang END,
         last_ip = CASE WHEN $12 IS NOT NULL THEN $12 ELSE users.last_ip END,
         last_seen = NOW()
       RETURNING *`,
      [u.sessionToken, u.displayName, u.role || 'PARTY A', !!u.isAdmin, u.adminRole || null, u.email || null, u.countryCode || null, u.sessionToken, u.isOnline ?? false,
       u.phone || null, u.prefLang || null, u.lastIp || null]
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

  async findGroupsBySellerEmail(email) {
    const { rows } = await this.pool.query(
      `SELECT * FROM groups WHERE lower(email_b) = lower($1) AND seller_registered = TRUE`,
      [email]
    );
    return rows;
  }

  async getGroupBySellerAccountId(accountId) {
    const { rows } = await this.pool.query(`SELECT * FROM groups WHERE seller_account_id=$1`, [String(accountId)]);
    return rows[0] || null;
  }

  async updateGroup(groupId, fields) {
    const JSON_COLS = new Set(['seller_ip_log', 'seller_blocked_ips', 'business_data', 'seller_auth_tokens']);
    const V31 = ['seller_phone', 'seller_account_id', 'seller_language', 'seller_account_type', 'seller_registered_at',
      'seller_terms_accepted_at', 'seller_terms_version', 'seller_onboarding_choice', 'seller_disabled', 'seller_disabled_at',
      'seller_disabled_reason', 'disbursement_enabled', 'disbursement_updated_at', 'seller_registration_ip', 'seller_last_ip',
      'seller_ip_log', 'seller_blocked_ips', 'seller_auth_tokens', 'kyc_id_number', 'kyc_id_name', 'kyc_id_dob', 'kyc_id_expiry', 'kyc_id_country',
      'kyc_attempts', 'business_status', 'business_data', 'business_submitted_at', 'business_reviewed_at',
      'business_rejection_reason', 'crypto_deposit_verified', 'crypto_override_by'];
    const map = {
      name: 'name', custom_name_a: 'custom_name_a', custom_name_b: 'custom_name_b',
      email_a: 'email_a', email_b: 'email_b',
      buyer_session_token: 'buyer_session_token', seller_session_token: 'seller_session_token',
      file_uploads_enabled: 'file_uploads_enabled', highlighted: 'highlighted',
      transaction_form_enabled: 'transaction_form_enabled', banner_url: 'banner_url',
      // Transaction Account (seller registration/KYC/balance)
      seller_registered: 'seller_registered', seller_full_name: 'seller_full_name',
      seller_password_hash: 'seller_password_hash', seller_currency: 'seller_currency',
      currency_locked_at: 'currency_locked_at', seller_failed_logins: 'seller_failed_logins',
      seller_locked_until: 'seller_locked_until', kyc_status: 'kyc_status', kyc_doc_type: 'kyc_doc_type',
      kyc_id_front_url: 'kyc_id_front_url', kyc_id_back_url: 'kyc_id_back_url',
      kyc_proof_address_url: 'kyc_proof_address_url', kyc_proof_address_type: 'kyc_proof_address_type', kyc_selfie_url: 'kyc_selfie_url',
      seller_date_of_birth: 'seller_date_of_birth', seller_country: 'seller_country',
      kyc_submitted_at: 'kyc_submitted_at', kyc_reviewed_by: 'kyc_reviewed_by', kyc_reviewed_at: 'kyc_reviewed_at',
      kyc_rejection_reason: 'kyc_rejection_reason', balance_available: 'balance_available',
      balance_held: 'balance_held', total_deposited: 'total_deposited'
    };
    V31.forEach((c) => { map[c] = c; });
    const keys = Object.keys(fields).filter(k => map[k]);
    if (keys.length === 0) return this.getGroup(groupId);
    const setClause = keys.map((k, i) => `${map[k]} = $${i + 2}${JSON_COLS.has(map[k]) ? '::jsonb' : ''}`).join(', ');
    const values = keys.map(k => (JSON_COLS.has(map[k]) && fields[k] !== null && fields[k] !== undefined ? JSON.stringify(fields[k]) : fields[k]));
    const { rows } = await this.pool.query(
      `UPDATE groups SET ${setClause} WHERE id=$1 RETURNING *`,
      [groupId, ...values]
    );
    return rows[0] || null;
  }

  async deleteGroup(groupId) {
    await this.pool.query(`DELETE FROM groups WHERE id=$1`, [groupId]);
  }

  // Atomic, guarded balance change in ONE statement: it applies only if no
  // balance would drop below zero, so two admins acting at once can never
  // overdraw an account. Returns the updated group row, or null if not applied.
  async adjustBalances(groupId, { available = 0, held = 0, total = 0 } = {}) {
    const { rows } = await this.pool.query(
      `UPDATE groups SET
         balance_available = balance_available + $2::numeric,
         balance_held      = balance_held      + $3::numeric,
         total_deposited   = total_deposited   + $4::numeric
       WHERE id = $1
         AND balance_available + $2::numeric >= 0
         AND balance_held      + $3::numeric >= 0
         AND total_deposited   + $4::numeric >= 0
       RETURNING *`,
      [groupId, available, held, total]
    );
    return rows[0] || null;
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
      `INSERT INTO unread_counts (session_token, group_id, count, first_unread_at) VALUES ($1,$2,1,NOW())
       ON CONFLICT (session_token, group_id) DO UPDATE SET count = unread_counts.count + 1,
         first_unread_at = COALESCE(unread_counts.first_unread_at, NOW())`,
      [sessionToken, groupId]
    );
  }

  async clearUnread(sessionToken, groupId) {
    await this.pool.query(
      `INSERT INTO unread_counts (session_token, group_id, count) VALUES ($1,$2,0)
       ON CONFLICT (session_token, group_id) DO UPDATE SET count = 0, first_unread_at = NULL, last_reminded_at = NULL`,
      [sessionToken, groupId]
    );
  }

  async getDueReminders(olderThanMs) {
    const { rows } = await this.pool.query(
      `SELECT session_token, group_id, count, first_unread_at, last_reminded_at FROM unread_counts
       WHERE count > 0 AND first_unread_at IS NOT NULL
         AND COALESCE(last_reminded_at, first_unread_at) <= NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
      [Math.floor(olderThanMs)]
    );
    return rows;
  }
  async markReminded(sessionToken, groupId) {
    await this.pool.query(`UPDATE unread_counts SET last_reminded_at = NOW() WHERE session_token=$1 AND group_id=$2`, [sessionToken, groupId]);
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

  // ---------- PENDING EMAILS (missed-message alerts awaiting admin approval) ----------
  async createPendingEmail(rec) {
    const id = uuid();
    const { rows } = await this.pool.query(
      `INSERT INTO pending_emails (id, group_id, party, to_email, from_name, group_name, message_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, rec.groupId, rec.party, rec.toEmail, rec.fromName, rec.groupName, rec.messageText]
    );
    return rows[0];
  }
  async getPendingEmails(status = 'pending') {
    const { rows } = await this.pool.query(`SELECT * FROM pending_emails WHERE status=$1 ORDER BY created_at DESC`, [status]);
    return rows;
  }
  async getPendingEmailById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM pending_emails WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async resolvePendingEmail(id, status) {
    const { rows } = await this.pool.query(
      `UPDATE pending_emails SET status=$2, resolved_at=NOW() WHERE id=$1 RETURNING *`,
      [id, status]
    );
    return rows[0] || null;
  }

  // ---------- PASSWORD RESETS (Transaction Account) ----------
  async createPasswordReset(rec) {
    const { rows } = await this.pool.query(
      `INSERT INTO password_resets (id, group_id, code_hash, expires_at) VALUES ($1,$2,$3,$4) RETURNING *`,
      [uuid(), rec.groupId, rec.codeHash, rec.expiresAt]
    );
    return rows[0];
  }
  async getLatestPasswordReset(groupId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM password_resets WHERE group_id=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [groupId]
    );
    return rows[0] || null;
  }
  async setPasswordResetToken(id, resetToken) {
    const { rows } = await this.pool.query(
      `UPDATE password_resets SET reset_token=$2 WHERE id=$1 RETURNING *`,
      [id, resetToken]
    );
    return rows[0] || null;
  }
  async consumePasswordResetByToken(groupId, resetToken) {
    const { rows } = await this.pool.query(
      `UPDATE password_resets SET consumed_at=NOW()
       WHERE group_id=$1 AND reset_token=$2 AND consumed_at IS NULL RETURNING *`,
      [groupId, resetToken]
    );
    return rows[0] || null;
  }

  // ---------- DEPOSITS ----------
  async createDeposit(rec) {
    const { rows } = await this.pool.query(
      `INSERT INTO deposits (id, group_id, method, asset, network, reference_code, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [uuid(), rec.groupId, rec.method, rec.asset || null, rec.network || null, rec.referenceCode || null, rec.amount]
    );
    return rows[0];
  }
  async getDepositsForGroup(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM deposits WHERE group_id=$1 ORDER BY notified_at DESC`, [groupId]);
    return rows;
  }
  async getDepositById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM deposits WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async getPendingDeposits() {
    const { rows } = await this.pool.query(`SELECT * FROM deposits WHERE status='held_in_vault' ORDER BY notified_at ASC`);
    return rows;
  }
  async resolveDeposit(id, { status, verifiedBy, rejectionReason }) {
    const { rows } = await this.pool.query(
      `UPDATE deposits SET status=$2, verified_by=$3, verified_at=NOW(), rejection_reason=$4 WHERE id=$1 RETURNING *`,
      [id, status, verifiedBy || null, rejectionReason || null]
    );
    return rows[0] || null;
  }

  // ---------- WITHDRAWAL REQUESTS ----------
  async createWithdrawal(rec) {
    const history = JSON.stringify([{ status: 'pending', at: new Date().toISOString(), by: null, note: 'Submitted by seller' }]);
    const { rows } = await this.pool.query(
      `INSERT INTO withdrawal_requests
        (id, group_id, method, asset, network, destination, beneficiary_name, bank_name, bank_account, bank_swift, bank_country, amount, amount_currency, amount_ledger, status_history,
         funds_reserved, request_ip, seller_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [uuid(), rec.groupId, rec.method, rec.asset || null, rec.network || null, rec.destination || null,
       rec.beneficiaryName || null, rec.bankName || null, rec.bankAccount || null, rec.bankSwift || null, rec.bankCountry || null,
       rec.amount, rec.amountCurrency, rec.amountLedger, history, !!rec.fundsReserved, rec.requestIp || null, rec.sellerAccountId || null]
    );
    return rows[0];
  }
  async updateWithdrawal(id, fields) {
    const map = { funds_reserved: 'funds_reserved', payout_reference: 'payout_reference' };
    const keys = Object.keys(fields).filter(k => map[k]);
    if (!keys.length) return this.getWithdrawalById(id);
    const setClause = keys.map((k, i) => `${map[k]} = $${i + 2}`).join(', ');
    const { rows } = await this.pool.query(`UPDATE withdrawal_requests SET ${setClause}, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, ...keys.map(k => fields[k])]);
    return rows[0] || null;
  }
  async getWithdrawalsForGroup(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM withdrawal_requests WHERE group_id=$1 ORDER BY created_at DESC`, [groupId]);
    return rows;
  }
  async getWithdrawalById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM withdrawal_requests WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async getPendingWithdrawals() {
    const { rows } = await this.pool.query(
      `SELECT * FROM withdrawal_requests WHERE status NOT IN ('completed','declined','rejected','failed') ORDER BY created_at ASC`
    );
    return rows;
  }
  async advanceWithdrawal(id, { status, reason, by, expectedStatus }) {
    const { rows } = await this.pool.query(
      `UPDATE withdrawal_requests
         SET status=$2, status_reason=$3, updated_at=NOW(),
             status_history = status_history || $4::jsonb
       WHERE id=$1 AND ($5::text IS NULL OR status = $5::text) RETURNING *`,
      [id, status, reason || null, JSON.stringify([{ status, at: new Date().toISOString(), by: by || null, note: reason || null }]), expectedStatus || null]
    );
    return rows[0] || null;
  }

  // ---------- INCOMING FUNDS (recorded by the Desk against a seller) ----------
  async createIncomingFunds(rec) {
    const history = JSON.stringify([{ status: rec.status, at: new Date().toISOString(), by: rec.recordedBy || null, note: rec.historyNote || null }]);
    const cols = {
      id: uuid(), group_id: rec.groupId, payer_name: rec.payerName, payer_email: rec.payerEmail || null, payer_country: rec.payerCountry || null,
      purpose: rec.purpose, method: rec.method, asset: rec.asset || null, network: rec.network || null, external_ref: rec.externalRef || null,
      amount: rec.amount, amount_currency: rec.amountCurrency, amount_ledger: rec.amountLedger, fx_rate: rec.fxRate,
      received_at: rec.receivedAt || new Date().toISOString(), status: rec.status, status_history: history,
      proof_url: rec.proofUrl || null, internal_note: rec.internalNote || null, recorded_by: rec.recordedBy || null,
      payer_phone: rec.payerPhone || null, payer_type: rec.payerType || null, payer_bank: rec.payerBank || null,
      invoice_ref: rec.invoiceRef || null, wallet_address: rec.walletAddress || null, target_account_id: rec.targetAccountId || null,
      note_shared: !!rec.noteShared, review_mode: rec.reviewMode || 'none', review_stage: rec.reviewStage ?? 6,
      review_checks: rec.reviewChecks || 0, review_elapsed_ms: rec.reviewElapsedMs || 0, review_last_tick: rec.reviewLastTick || null,
      review_paused: !!rec.reviewPaused, review_speed: rec.reviewSpeed || 1, review_show_time: !!rec.reviewShowTime,
      review_timers: rec.reviewTimers ? JSON.stringify(rec.reviewTimers) : null, review_stage_times: JSON.stringify(rec.reviewStageTimes || [])
    };
    const names = Object.keys(cols);
    const ph = names.map((n, i) => `$${i + 1}${['status_history', 'review_timers', 'review_stage_times'].includes(n) ? '::jsonb' : ''}`);
    const { rows } = await this.pool.query(`INSERT INTO incoming_funds (${names.join(',')}) VALUES (${ph.join(',')}) RETURNING *`, names.map(n => cols[n]));
    return rows[0];
  }
  async updateIncomingFunds(id, fields) {
    const JSONC = new Set(['review_timers', 'review_stage_times']);
    const allowed = ['review_mode', 'review_stage', 'review_checks', 'review_elapsed_ms', 'review_last_tick', 'review_paused', 'review_speed',
      'review_show_time', 'review_timers', 'review_stage_times', 'note_shared', 'internal_note'];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    if (!keys.length) return this.getIncomingFundsById(id);
    const setClause = keys.map((k, i) => `${k} = $${i + 2}${JSONC.has(k) ? '::jsonb' : ''}`).join(', ');
    const vals = keys.map(k => (JSONC.has(k) && fields[k] !== null && fields[k] !== undefined ? JSON.stringify(fields[k]) : fields[k]));
    const { rows } = await this.pool.query(`UPDATE incoming_funds SET ${setClause}, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, ...vals]);
    return rows[0] || null;
  }
  async getIncomingFundsForGroup(groupId) {
    const { rows } = await this.pool.query(`SELECT * FROM incoming_funds WHERE group_id=$1 ORDER BY received_at DESC, created_at DESC`, [groupId]);
    return rows;
  }
  async getIncomingFundsById(id) {
    const { rows } = await this.pool.query(`SELECT * FROM incoming_funds WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async getIncomingFundsByStatus(status) {
    const { rows } = await this.pool.query(`SELECT * FROM incoming_funds WHERE status=$1`, [status]);
    return rows;
  }
  async advanceIncomingFunds(id, { status, reason, by, expectedStatus }) {
    const { rows } = await this.pool.query(
      `UPDATE incoming_funds
         SET status=$2, status_reason=$3, updated_at=NOW(),
             status_history = status_history || $4::jsonb
       WHERE id=$1 AND ($5::text IS NULL OR status = $5::text) RETURNING *`,
      [id, status, reason || null, JSON.stringify([{ status, at: new Date().toISOString(), by: by || null, note: reason || null }]), expectedStatus || null]
    );
    return rows[0] || null;
  }

  // ---------- EMAIL CODES ----------
  async createEmailCode(rec) {
    await this.pool.query(`UPDATE email_codes SET consumed_at=NOW() WHERE group_id=$1 AND purpose=$2 AND consumed_at IS NULL`, [rec.groupId, rec.purpose]);
    const { rows } = await this.pool.query(
      `INSERT INTO email_codes (id, group_id, purpose, email, code_hash, payload, expires_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
      [uuid(), rec.groupId, rec.purpose, rec.email, rec.codeHash, rec.payload ? JSON.stringify(rec.payload) : null, rec.expiresAt]
    );
    return rows[0];
  }
  async getLatestEmailCode(groupId, purpose) {
    const { rows } = await this.pool.query(
      `SELECT * FROM email_codes WHERE group_id=$1 AND purpose=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, [groupId, purpose]);
    return rows[0] || null;
  }
  async bumpEmailCodeAttempts(id) {
    const { rows } = await this.pool.query(`UPDATE email_codes SET attempts = attempts + 1 WHERE id=$1 RETURNING attempts`, [id]);
    return rows[0] ? rows[0].attempts : 0;
  }
  async markEmailCodeVerified(id) {
    const { rows } = await this.pool.query(`UPDATE email_codes SET verified_at=NOW() WHERE id=$1 RETURNING *`, [id]);
    return rows[0] || null;
  }
  async consumeEmailCode(id) {
    const { rows } = await this.pool.query(`UPDATE email_codes SET consumed_at=NOW() WHERE id=$1 AND consumed_at IS NULL RETURNING *`, [id]);
    return rows[0] || null;
  }

  // ---------- APP SETTINGS ----------
  async getSetting(key) {
    const { rows } = await this.pool.query(`SELECT value FROM app_settings WHERE key=$1`, [key]);
    return rows[0] ? rows[0].value : null;
  }
  async setSetting(key, value) {
    await this.pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
      [key, JSON.stringify(value)]
    );
    return value;
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
}

module.exports = PgStore;
