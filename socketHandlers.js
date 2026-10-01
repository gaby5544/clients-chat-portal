const { store } = require('./db');
const { escapeHtml, sanitizeText, RateLimiter, hashPassword, verifyPassword, isStrongEnoughPassword, isValidEmail } = require('./security');
const { notifyOfflineMessage, notifyTransactionSubmitted, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus } = require('./email');
const { resolveAdminRole, hasMinRole } = require('./roles');
const { sendPushToUser } = require('./webpush');
const F = require('./finance');
const { publicSellerAccount, publicDeposit, publicWithdrawal, CURRENCIES, CRYPTO_ASSETS, convertCurrency } = F;
const { registerFundsHandlers, pushSellerState, pushAdminLedger, emitSnapshotTo } = require('./fundsHandlers');

const messageLimiter = new RateLimiter({ windowMs: 10000, max: 20 });   // 20 msgs / 10s per socket
const actionLimiter = new RateLimiter({ windowMs: 10000, max: 30 });    // generic admin/action guard
const accountActionLimiter = new RateLimiter({ windowMs: 60000, max: 8 }); // registration/KYC/deposit/withdrawal submissions
setInterval(() => { messageLimiter.sweep(); actionLimiter.sweep(); accountActionLimiter.sweep(); }, 60000).unref();

const KYC_DOC_TYPES = new Set(['national_id', 'drivers_license', 'passport']);
const PROOF_ADDRESS_TYPES = new Set(['bank_statement', 'utility_bill', 'electricity_bill', 'council_tax', 'other']);
// CURRENCIES / CRYPTO_ASSETS / FX conversion and the seller-facing payload
// shapers now live in finance.js (shared with fundsHandlers.js).
// KYC documents are only ever files this server stored itself.
const UPLOAD_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function publicUser(u) {
  if (!u) return null;
  return {
    sessionToken: u.session_token,
    displayName: u.display_name,
    role: u.role,
    isAdmin: u.is_admin,
    adminRole: u.admin_role || null,
    isOnline: u.is_online,
    lastSeen: u.last_seen
  };
}

async function publicMessage(m) {
  const [reactions, status] = await Promise.all([
    store.getReactionSummary(m.id),
    store.getMessageStatus(m.id)
  ]);
  return {
    id: m.id,
    groupId: m.group_id,
    sender: m.sender_name,
    senderRole: m.sender_role,
    senderToken: m.sender_token,
    text: m.text,
    fileUrl: m.file_url,
    fileType: m.file_type,
    fileName: m.file_name,
    replyToId: m.reply_to_id,
    forwardedFrom: m.forwarded_from,
    targetLang: m.target_lang,
    isEdited: m.is_edited,
    time: nowTime(),
    createdAt: m.created_at,
    reactions,
    status
  };
}

function publicTask(t) {
  return {
    id: t.id, groupId: t.group_id, title: t.title, description: t.description,
    status: t.status, createdBy: t.created_by, assignedRole: t.assigned_role,
    createdAt: t.created_at, updatedAt: t.updated_at
  };
}

function publicAnnouncement(a) {
  return { id: a.id, groupId: a.group_id, messageId: a.message_id, text: a.text, createdBy: a.created_by, createdAt: a.created_at };
}

function publicPendingEmail(p) {
  return {
    id: p.id, groupId: p.group_id, party: p.party, toEmail: p.to_email,
    fromName: p.from_name, groupName: p.group_name, text: p.message_text,
    status: p.status, createdAt: p.created_at
  };
}

async function groupSummary(g, viewerToken) {
  const messages = await store.getMessagesForGroup(g.id, 1);
  const last = messages[messages.length - 1];
  const unread = viewerToken ? (await store.getUnreadCounts(viewerToken))[g.id] || 0 : 0;
  return {
    id: g.id,
    name: g.name,
    customNames: { A: g.custom_name_a, B: g.custom_name_b },
    emails: { A: g.email_a || null, B: g.email_b || null },
    fileUploadsEnabled: g.file_uploads_enabled,
    highlighted: g.highlighted,
    transactionFormEnabled: g.transaction_form_enabled,
    bannerUrl: g.banner_url || null,
    lastMessagePreview: last ? (last.file_url ? `📎 ${last.file_name || 'Attachment'}` : last.text).slice(0, 80) : 'No messages yet...',
    unreadCount: unread
  };
}

function registerSocketHandlers(io, socket) {
  const activeSockets = io._activeSockets || (io._activeSockets = new Map()); // socketId -> {sessionToken, groupId, isAdmin, adminRole}
  const pendingDisconnects = io._pendingDisconnects || (io._pendingDisconnects = new Map()); // sessionToken -> timeout handle
  const DISCONNECT_GRACE_MS = 8000; // absorb brief network blips / tab backgrounding without spamming the chat

  function meta() { return activeSockets.get(socket.id); }
  function metaHasMinRole(minRole) {
    const m = meta();
    return !!m && hasMinRole(m.adminRole, minRole);
  }

  async function broadcastPresence(groupId) {
    const all = await store.getAllUsers();
    const tokensInGroup = new Set(
      Array.from(activeSockets.values()).filter(v => v.groupId === groupId).map(v => v.sessionToken)
    );
    const roomUsers = all.filter(u => tokensInGroup.has(u.session_token)).map(publicUser);
    io.to(groupId).emit('presence-update', roomUsers);
  }

  async function broadcastDirectory() {
    const all = await store.getAllUsers();
    io.to('admins').emit('user-directory', all.map(publicUser));
  }

  async function broadcastGroupsList(viewerSocket) {
    const groups = await store.getAllGroups();
    if (viewerSocket) {
      const m = activeSockets.get(viewerSocket.id);
      if (!m || !hasMinRole(m.adminRole, 'ADMIN')) return; // silently ignore for non-admins/moderators
      const list = await Promise.all(groups.map(g => groupSummary(g, m.sessionToken)));
      viewerSocket.emit('all-groups-list', list);
    } else {
      const list = await Promise.all(groups.map(g => groupSummary(g, null)));
      io.to('admins').emit('all-groups-list', list);
    }
  }

  async function broadcastStats() {
    const stats = await store.getStats();
    io.to('admins').emit('admin-stats', stats);
  }

  async function broadcastDashboardWidgets() {
    const widgets = await store.getDashboardWidgets();
    io.to('admins').emit('dashboard-widgets-update', widgets);
  }

  async function pushIfOffline(targetToken, payload) {
    const targetOnline = Array.from(activeSockets.values()).some(v => v.sessionToken === targetToken);
    if (targetOnline) return;
    await store.addNotification(targetToken, 'message', payload);
    // Push is immediate and automatic — no approval gate, unlike email below.
    await sendPushToUser(targetToken, {
      title: `New message from ${payload.fromName}`,
      body: payload.text,
      url: '/'
    });
  }

  // Missed-message emails are queued as "pending" and only actually sent once
  // an admin approves them (see 'admin-approve-pending-email' below) — never
  // sent automatically, per how the Desk Officer wants email handled. Works
  // even for a party who has never joined the group yet, as long as an email
  // was set for them (e.g. at group creation) — they are offline by definition.
  async function queueOfflineEmail(group, party, payload) {
    const toEmail = party === 'A' ? group.email_a : group.email_b;
    if (!toEmail) return;
    const rec = await store.createPendingEmail({
      groupId: group.id, party, toEmail,
      fromName: payload.fromName, groupName: payload.groupName, messageText: payload.text
    });
    io.to('admins').emit('pending-email-created', publicPendingEmail(rec));
  }

  // Money movement (incoming funds, withdrawal status control, Funds Desk).
  registerFundsHandlers(io, socket, { meta, metaHasMinRole, broadcastGroupsList });

  // ---------------- JOIN ROOM ----------------
  socket.on('join-room', async ({ groupId, role, adminKey, sessionToken, email }) => {
    try {
      if (!sessionToken || typeof sessionToken !== 'string') return;
      groupId = sanitizeText(groupId || 'default-group', 100);
      const adminRole = resolveAdminRole(adminKey);
      const isAdmin = !!adminRole;

      let group = await store.getGroup(groupId);
      if (!group) {
        if (!isAdmin) {
          return socket.emit('error-msg', 'This group does not exist, or your invite link is invalid. Please check the link with your Desk Officer.');
        }
        group = await store.createGroupIfMissing(groupId, `Transaction Group #${(await store.getAllGroups()).length + 1}`);
      }

      // Invite links use friendly role names in the URL ('BUYER'/'SELLER') so
      // a party never sees the internal 'PARTY A'/'PARTY B' slot names even
      // in their own browser's address bar. Old-style links already sent out
      // with '?role=PARTY%20A' etc. still work.
      const roleMap = { BUYER: 'PARTY A', SELLER: 'PARTY B', 'PARTY A': 'PARTY A', 'PARTY B': 'PARTY B' };
      const safeRole = roleMap[role] || 'PARTY A';
      const displayName = isAdmin
        ? `Desk Officer (${adminRole === 'SUPER_ADMIN' ? 'Super Admin' : adminRole === 'MODERATOR' ? 'Moderator' : 'Admin'})`
        : (safeRole === 'PARTY A' ? group.custom_name_a : group.custom_name_b);

      // A reconnect within the grace window (brief network blip / tab
      // backgrounding) just clears the pending "went offline" timer below —
      // it does not need any special handling here any more since presence
      // is no longer logged into the chat as a message.
      if (pendingDisconnects.has(sessionToken)) {
        clearTimeout(pendingDisconnects.get(sessionToken));
        pendingDisconnects.delete(sessionToken);
      }

      const user = await store.upsertUser({
        sessionToken,
        displayName,
        role: isAdmin ? 'ADMINISTRATOR' : safeRole,
        isAdmin,
        adminRole,
        email: isValidEmailSafe(email) ? email : undefined,
        isOnline: true
      });

      socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
      socket.join(groupId);
      if (isAdmin) socket.join('admins');
      // Money data goes ONLY to Admin / Super Admin (never a Moderator) via this room.
      if (hasMinRole(adminRole, 'ADMIN')) socket.join('finance-admins');

      activeSockets.set(socket.id, { sessionToken, groupId, isAdmin, adminRole, role: isAdmin ? null : safeRole });

      // Persist which session currently holds the Buyer/Seller seat for THIS
      // group. This is what lets offline notifications (push + email) target
      // exactly the right two people instead of every user in the system —
      // last one to join a given role/group keeps the seat, so switching
      // devices still works.
      if (!isAdmin) {
        await store.updateGroup(groupId, safeRole === 'PARTY A' ? { buyer_session_token: sessionToken } : { seller_session_token: sessionToken });
        group = await store.getGroup(groupId);
        // The seller gets a private room for their Transaction Account so
        // live money updates can never reach the Buyer in the same chat.
        if (safeRole === 'PARTY B') socket.join(`seller:${groupId}`);
      }

      const [messages, pinnedMessages, unreadCounts, announcements, tasks] = await Promise.all([
        store.getMessagesForGroup(groupId),
        store.getPinnedMessages(groupId),
        store.getUnreadCounts(sessionToken),
        store.getAnnouncements(groupId),
        store.getTasks(groupId)
      ]);

      await store.clearUnread(sessionToken, groupId);

      socket.emit('init-state', {
        group: await groupSummary(group, sessionToken),
        isAdminConfirmed: isAdmin,
        adminRole,
        role: isAdmin ? null : safeRole,
        socketId: socket.id,
        sessionToken,
        messages: await Promise.all(messages.map(publicMessage)),
        pinnedMessages: await Promise.all(pinnedMessages.map(publicMessage)),
        unreadCounts,
        announcements: announcements.map(publicAnnouncement),
        tasks: tasks.map(publicTask)
      });

      // Presence (the header badges + User Directory) is how joins are surfaced
      // now — they are deliberately NOT logged as chat messages any more, so the
      // transaction log stays clean for both parties.
      await broadcastPresence(groupId);
      await broadcastDirectory();
      await broadcastGroupsList();
      if (isAdmin) {
        await broadcastStats();
        await broadcastDashboardWidgets();
        const pending = await store.getPendingEmails('pending');
        socket.emit('pending-emails-list', pending.map(publicPendingEmail));
        // Admin / Super Admin viewing this group gets the seller's Transaction
        // Account state too (KYC/balances/ledger) — never a Moderator, never the buyer.
        if (hasMinRole(adminRole, 'ADMIN')) await emitSnapshotTo(socket, groupId);
      } else if (safeRole === 'PARTY B') {
        // The Seller's own account — this is the popup trigger: the client
        // shows the "Create your Transaction Account" registration modal
        // whenever seller_registered is still false.
        await emitSnapshotTo(socket, groupId);
      }
    } catch (err) {
      console.error('[join-room] error:', err);
      socket.emit('error-msg', 'Failed to join room.');
    }
  });

  // ---------------- SEND MESSAGE ----------------
  socket.on('send-message', async ({ groupId, text, targetLang, replyToId, fileUrl, fileType, fileName }) => {
    try {
      if (!messageLimiter.allow(socket.id)) {
        return socket.emit('error-msg', 'You are sending messages too quickly. Please slow down.');
      }
      const m = meta();
      if (!m) return;
      const user = await store.getUser(m.sessionToken);
      const group = await store.getGroup(groupId);
      if (!user || !group) return;

      const cleanText = sanitizeText(text, 4000);
      if (!cleanText && !fileUrl) return;
      if (fileUrl && !group.file_uploads_enabled) {
        return socket.emit('error-msg', 'File uploads are currently disabled by the Admin for this group.');
      }

      const msg = await store.insertMessage({
        id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        groupId,
        senderToken: user.session_token,
        senderName: user.display_name,
        senderRole: user.role,
        text: escapeHtml(cleanText || (fileName ? `Shared file: ${fileName}` : '')),
        targetLang: targetLang || 'en',
        replyToId: replyToId || null,
        fileUrl: fileUrl || null,
        fileType: fileType || null,
        fileName: fileName ? escapeHtml(fileName) : null
      });

      const roomTokens = new Set(Array.from(activeSockets.values()).filter(v => v.groupId === groupId).map(v => v.sessionToken));
      for (const token of roomTokens) {
        if (token === user.session_token) continue;
        await store.markDelivered(msg.id, token);
      }

      const payload = await publicMessage(msg);
      io.to(groupId).emit('message', payload);
      await broadcastGroupsList();
      await broadcastStats();
      if (fileUrl) await broadcastDashboardWidgets();

      // Only the group's actual Buyer and Seller get notified about this
      // message — never every user in the whole system (a message in one
      // deal must never leak into another deal's notifications). Admin
      // messages notify both (whichever is offline); a party's own message
      // notifies only the other one.
      const onlineTokens = new Set(Array.from(activeSockets.values()).map(v => v.sessionToken));
      const senderParty = group.buyer_session_token === user.session_token ? 'A'
        : group.seller_session_token === user.session_token ? 'B' : null;
      const notifyPayload = { fromName: user.display_name, groupName: group.name, text: cleanText.slice(0, 200) };
      for (const party of ['A', 'B']) {
        if (party === senderParty) continue;
        const token = party === 'A' ? group.buyer_session_token : group.seller_session_token;
        // A party who has never joined this group yet has no session token
        // at all — they are, by definition, offline, so an email (if one is
        // on file) can still be queued even though there's no token to push to.
        const isOnline = token ? onlineTokens.has(token) : false;
        if (token) await store.incrementUnread(token, groupId);
        if (!isOnline) {
          if (token) await pushIfOffline(token, notifyPayload);
          await queueOfflineEmail(group, party, notifyPayload);
        }
      }
    } catch (err) {
      console.error('[send-message] error:', err);
    }
  });

  // ---------------- MARK READ (also drives read receipts) ----------------
  socket.on('mark-group-read', async ({ groupId }) => {
    const m = meta();
    if (!m) return;
    await store.clearUnread(m.sessionToken, groupId);
    const updatedIds = await store.markGroupRead(groupId, m.sessionToken, m.sessionToken);
    if (updatedIds.length) io.to(groupId).emit('message-status-bulk-update', { messageIds: updatedIds, status: 'read' });
    await broadcastGroupsList(socket);
  });

  // ---------------- MODERATOR+: EDIT MESSAGE ----------------
  socket.on('admin-edit-message', async ({ groupId, messageId, newText }) => {
    if (!metaHasMinRole('MODERATOR')) return;
    const clean = sanitizeText(newText, 4000);
    if (!clean) return;
    const updated = await store.editMessage(messageId, escapeHtml(clean), meta().sessionToken);
    if (!updated) return;
    io.to(groupId).emit('message-edited', { groupId, messageId, newText: updated.text });
    io.to('admins').emit('message-edited-admin-flag', { groupId, messageId, isEdited: true });
  });

  // ---------------- MODERATOR+: GET EDIT HISTORY ----------------
  socket.on('admin-get-edit-history', async ({ messageId }) => {
    if (!metaHasMinRole('MODERATOR')) return;
    const history = await store.getMessageEditHistory(messageId);
    socket.emit('edit-history-result', { messageId, history });
  });

  // ---------------- MODERATOR+: PIN / UNPIN ----------------
  socket.on('admin-toggle-pin-message', async ({ groupId, messageId }) => {
    if (!metaHasMinRole('MODERATOR')) return;
    const pinned = await store.togglePin(groupId, messageId);
    io.to(groupId).emit('pinned-messages-updated', {
      groupId,
      pinnedMessages: await Promise.all(pinned.map(publicMessage))
    });
  });

  // ---------------- MODERATOR+: BULK DELETE MESSAGES ----------------
  socket.on('admin-bulk-delete-messages', async ({ groupId, messageIds }) => {
    if (!metaHasMinRole('MODERATOR') || !Array.isArray(messageIds)) return;
    await store.deleteMessages(groupId, messageIds);
    io.to(groupId).emit('messages-bulk-deleted', { groupId, messageIds });
    const pinned = await store.getPinnedMessages(groupId);
    io.to(groupId).emit('pinned-messages-updated', { groupId, pinnedMessages: await Promise.all(pinned.map(publicMessage)) });
    await broadcastGroupsList();
  });

  // ---------------- ADMIN+: TOGGLE UPLOAD PERMISSION ----------------
  socket.on('admin-toggle-upload-permission', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    const updated = await store.updateGroup(groupId, { file_uploads_enabled: !group.file_uploads_enabled });
    io.to(groupId).emit('upload-permission-changed', { groupId, fileUploadsEnabled: updated.file_uploads_enabled });
  });

  // ---------------- ADMIN+: TRANSACTION FORM TOGGLE ----------------
  socket.on('admin-toggle-transaction-form', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    const updated = await store.updateGroup(groupId, { transaction_form_enabled: !group.transaction_form_enabled });
    io.to(groupId).emit('transaction-form-status', { groupId, enabled: updated.transaction_form_enabled });
  });

  // ---------------- SUBMIT TRANSACTION (any authenticated user) ----------------
  socket.on('submit-transaction', async ({ groupId, formData }) => {
    if (!actionLimiter.allow(socket.id)) return;
    const m = meta();
    if (!m) return;
    const group = await store.getGroup(groupId);
    const user = await store.getUser(m.sessionToken);
    if (!group || !group.transaction_form_enabled || !formData) return;

    const { validateTransactionForm } = require('./security');
    const { valid, errors } = validateTransactionForm(formData);
    if (!valid) return socket.emit('error-msg', `Transaction form error: ${errors.join(', ')}`);

    const tx = await store.insertTransaction({
      group_id: groupId,
      full_legal_name: escapeHtml(sanitizeText(formData.full_legal_name, 200)),
      country: escapeHtml(sanitizeText(formData.country, 100)),
      role: escapeHtml(sanitizeText(formData.role, 50)),
      asset_type: escapeHtml(sanitizeText(formData.asset_type, 200)),
      asset_description: escapeHtml(sanitizeText(formData.asset_description, 1000)),
      quantity: escapeHtml(sanitizeText(formData.quantity, 100)),
      unit_price: escapeHtml(sanitizeText(formData.unit_price, 100)),
      total_value: escapeHtml(sanitizeText(formData.total_value, 100)),
      payment_currency: escapeHtml(sanitizeText(formData.payment_currency, 20)),
      payment_method: escapeHtml(sanitizeText(formData.payment_method, 100)),
      payment_terms: escapeHtml(sanitizeText(formData.payment_terms, 500)),
      notes: escapeHtml(sanitizeText(formData.notes, 1000)),
      submitted_by: user ? user.display_name : 'Unknown'
    });

    io.to('admins').emit('transaction-submitted', { groupId, transaction: tx });
    await broadcastStats();
    await broadcastDashboardWidgets();

    // Let both parties in this group know a form was submitted (as a normal chat
    // notice) without exposing the sensitive form details to them — only the
    // admin panel (above) receives the full transaction data.
    const noticeMsg = await store.insertMessage({
      id: 'sys-' + Date.now() + Math.random().toString(36).slice(2, 6),
      groupId,
      senderName: 'SYSTEM',
      text: `📄 Transaction form submitted by ${escapeHtml(tx.submitted_by)}. The Desk Officer has been notified.`
    });
    io.to(groupId).emit('message', await publicMessage(noticeMsg));

    const admins = (await store.getAllUsers()).filter(u => u.is_admin && u.email);
    for (const admin of admins) {
      await notifyTransactionSubmitted(admin.email, { submitterName: tx.submitted_by, groupName: group.name });
    }
    socket.emit('transaction-submit-ack', { success: true, txId: tx.id });
  });

  socket.on('admin-get-transactions', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const [rows, group] = await Promise.all([store.getTransactions(groupId), store.getGroup(groupId)]);
    socket.emit('transactions-list', { groupId, transactions: rows, formEnabled: !!(group && group.transaction_form_enabled) });
  });

  socket.on('admin-delete-transaction', async ({ groupId, txId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    await store.deleteTransaction(groupId, txId);
    io.to('admins').emit('transaction-deleted', { groupId, txId });
    await broadcastStats();
    await broadcastDashboardWidgets();
  });

  // ---------------- ADMIN+: PENDING EMAIL APPROVALS ----------------
  // A missed-message email never goes out on its own — it waits here until
  // an admin approves it.
  socket.on('admin-get-pending-emails', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const pending = await store.getPendingEmails('pending');
    socket.emit('pending-emails-list', pending.map(publicPendingEmail));
  });

  socket.on('admin-approve-pending-email', async ({ id }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const rec = await store.getPendingEmailById(id);
    if (!rec || rec.status !== 'pending') return;
    await notifyOfflineMessage(rec.to_email, { fromName: rec.from_name, groupName: rec.group_name, text: rec.message_text });
    const updated = await store.resolvePendingEmail(id, 'sent');
    io.to('admins').emit('pending-email-resolved', publicPendingEmail(updated));
  });

  socket.on('admin-reject-pending-email', async ({ id }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const rec = await store.getPendingEmailById(id);
    if (!rec || rec.status !== 'pending') return;
    const updated = await store.resolvePendingEmail(id, 'rejected');
    io.to('admins').emit('pending-email-resolved', publicPendingEmail(updated));
  });

  // ---------------- REACTIONS (any authenticated user) ----------------
  socket.on('toggle-reaction', async ({ groupId, messageId, emoji }) => {
    const m = meta();
    if (!m || typeof emoji !== 'string' || emoji.length > 8) return;
    const summary = await store.toggleReaction(messageId, m.sessionToken, emoji);
    io.to(groupId).emit('reaction-updated', { messageId, reactions: summary });
  });

  // ---------------- ADMIN+: GROUP MANAGEMENT ----------------
  socket.on('create-group', async ({ groupName, customNameA, customNameB, emailA, emailB }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const newId = 'group-' + Date.now();
    const name = sanitizeText(groupName, 100) || `General Transaction Group #${(await store.getAllGroups()).length + 1}`;
    await store.createGroupIfMissing(newId, escapeHtml(name));

    // Every group is a private, one-buyer-one-seller room. The Desk Officer can
    // put each client's own name and email on their link right away instead of
    // adding it later — falls back to the generic "Buyer"/"Seller" default and
    // no email (no offline email alerts until one is added) otherwise.
    const cleanA = escapeHtml(sanitizeText(customNameA, 100));
    const cleanB = escapeHtml(sanitizeText(customNameB, 100));
    const fields = {};
    if (cleanA) fields.custom_name_a = cleanA;
    if (cleanB) fields.custom_name_b = cleanB;
    if (isValidEmailSafe(emailA)) fields.email_a = emailA.trim();
    if (isValidEmailSafe(emailB)) fields.email_b = emailB.trim();
    if (Object.keys(fields).length) await store.updateGroup(newId, fields);

    const group = await store.getGroup(newId);
    await broadcastGroupsList();
    socket.emit('group-created-and-switch', {
      newGroupId: newId,
      customNames: { A: group.custom_name_a, B: group.custom_name_b },
      emails: { A: group.email_a || null, B: group.email_b || null }
    });
  });

  socket.on('delete-group', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const all = await store.getAllGroups();
    if (all.length <= 1) return socket.emit('error-msg', 'Cannot delete the last remaining group!');
    await store.deleteGroup(groupId);
    await broadcastGroupsList();
    const remaining = (await store.getAllGroups())[0];
    io.to(groupId).emit('force-room-switch', { newGroupId: remaining.id });
  });

  socket.on('bulk-delete-groups', async ({ groupIds }) => {
    if (!metaHasMinRole('ADMIN') || !Array.isArray(groupIds)) return;
    for (const gid of groupIds) {
      const all = await store.getAllGroups();
      if (all.length > 1) {
        await store.deleteGroup(gid);
        const remaining = (await store.getAllGroups())[0];
        io.to(gid).emit('force-room-switch', { newGroupId: remaining.id });
      }
    }
    await broadcastGroupsList();
  });

  socket.on('toggle-highlight-group', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    await store.updateGroup(groupId, { highlighted: !group.highlighted });
    await broadcastGroupsList();
  });

  socket.on('rename-party', async ({ groupId, party, newName }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const clean = escapeHtml(sanitizeText(newName, 100));
    if (!clean || !['A', 'B'].includes(party)) return;
    await store.updateGroup(groupId, party === 'A' ? { custom_name_a: clean } : { custom_name_b: clean });
    const group = await store.getGroup(groupId);
    io.to(groupId).emit('party-renamed', { groupId, party, newName: clean, customNames: { A: group.custom_name_a, B: group.custom_name_b } });
    await broadcastGroupsList();
  });

  // Admin sets/updates a party's email after group creation (offline-message
  // email alerts for that party only start working once this is set).
  socket.on('admin-set-party-email', async ({ groupId, party, email }) => {
    if (!metaHasMinRole('ADMIN')) return;
    if (!['A', 'B'].includes(party)) return;
    if (email && !isValidEmailSafe(email)) return socket.emit('error-msg', 'That does not look like a valid email address.');
    const clean = email ? email.trim() : null; // empty string/undefined clears it
    await store.updateGroup(groupId, party === 'A' ? { email_a: clean } : { email_b: clean });
    const group = await store.getGroup(groupId);
    io.to(groupId).emit('party-email-updated', { groupId, party, email: clean });
    await broadcastGroupsList();
  });

  // Buyer/Seller adding or updating their OWN email for offline alerts —
  // scoped to whichever seat (buyer_session_token/seller_session_token) they
  // actually hold in this group, so they can never touch the other party's.
  socket.on('set-my-email', async ({ groupId, email }) => {
    const m = meta();
    if (!m || m.isAdmin) return;
    if (!isValidEmailSafe(email)) return socket.emit('error-msg', 'That does not look like a valid email address.');
    const group = await store.getGroup(groupId);
    if (!group) return;
    let party = null;
    if (group.buyer_session_token === m.sessionToken) party = 'A';
    else if (group.seller_session_token === m.sessionToken) party = 'B';
    if (!party) return;
    const clean = email.trim();
    await store.updateGroup(groupId, party === 'A' ? { email_a: clean } : { email_b: clean });
    socket.emit('my-email-updated', { email: clean });
    io.to('admins').emit('party-email-updated', { groupId, party, email: clean });
    await broadcastGroupsList();
  });

  // =====================================================================
  // TRANSACTION ACCOUNT SYSTEM — Seller registration, KYC, deposits and
  // withdrawals. See Withdrawal_System___Technical_Blueprint for the full
  // spec this implements. Everything here is Seller-only or Admin-only;
  // a Buyer never sees any of it, and it's never folded into groupSummary.
  // =====================================================================

  // A Seller can only ever act on THEIR OWN group's Transaction Account —
  // this resolves & checks that in one place for every handler below.
  async function requireSellerOwnGroup(groupId) {
    const m = meta();
    if (!m || m.isAdmin) return null;
    const group = await store.getGroup(groupId);
    if (!group || group.seller_session_token !== m.sessionToken) return null;
    return group;
  }

  // ---- Registration: "Create your Transaction Account" ----
  // This is the popup shown the moment a Seller opens their invite link and
  // seller_registered is still false — it's what turns their chat seat into
  // an actual account with a password, and locks in their ledger currency.
  socket.on('register-transaction-account', async ({ groupId, fullName, email, password, currency }) => {
    const m = meta();
    if (!m || m.isAdmin) return;
    if (!accountActionLimiter.allow(m.sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    const group = await store.getGroup(groupId);
    if (!group || group.seller_session_token !== m.sessionToken) return socket.emit('error-msg', 'You are not the Seller of this group.');
    if (group.seller_registered) return socket.emit('error-msg', 'This Transaction Account has already been created.');

    const cleanName = sanitizeText(fullName, 200);
    if (!cleanName) return socket.emit('error-msg', 'Please enter your full name.');
    if (!isStrongEnoughPassword(password)) return socket.emit('error-msg', 'Password must be at least 8 characters.');
    if (!CURRENCIES.has(currency)) return socket.emit('error-msg', 'Please choose a valid account currency.');
    // Email is usually already on file (set by the Desk Officer, or by the
    // seller via the envelope icon) — but if it's still missing, the
    // registration form itself can supply it so nobody gets stuck.
    const finalEmail = group.email_b || (isValidEmailSafe(email) ? email.trim() : null);
    if (!finalEmail) return socket.emit('error-msg', 'Please enter a valid email address.');

    const fields = {
      seller_registered: true,
      seller_full_name: escapeHtml(cleanName),
      seller_password_hash: hashPassword(password),
      seller_currency: currency,
      currency_locked_at: new Date().toISOString() // locked immediately; blueprint's "locked after first deposit" is loosened here since the ledger needs a currency from day one
    };
    if (!group.email_b) fields.email_b = finalEmail;
    await store.updateGroup(groupId, fields);
    const updated = await store.getGroup(groupId);
    socket.emit('seller-account-state', publicSellerAccount(updated));
    socket.emit('transaction-account-created', { groupId });
    io.to('finance-admins').emit('seller-account-updated', publicSellerAccount(updated));
    await pushAdminLedger(io, groupId); // Funds Desk learns about the new account (and its currency) immediately
    await broadcastGroupsList();
  });

  // ---- KYC ----
  socket.on('submit-kyc', async ({ groupId, docType, idFrontUrl, idBackUrl, proofAddressType, proofAddressUrl, selfieUrl }) => {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return;
    if (!accountActionLimiter.allow(meta().sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    if (group.kyc_status === 'verified') return socket.emit('error-msg', 'Your identity is already verified.');
    if (!KYC_DOC_TYPES.has(docType)) return socket.emit('error-msg', 'Please select a valid document type.');
    if (!PROOF_ADDRESS_TYPES.has(proofAddressType)) return socket.emit('error-msg', 'Please select what kind of proof of address you\'re uploading.');
    if (!idFrontUrl || !proofAddressUrl || !selfieUrl) return socket.emit('error-msg', 'ID (front), proof of address, and a selfie are all required.');
    if (docType !== 'passport' && !idBackUrl) return socket.emit('error-msg', 'The back of your ID is required for this document type.');
    // Admins open these links from the review queue, so only files this server
    // itself stored are accepted (never a javascript:/external URL).
    const urlsToCheck = [idFrontUrl, proofAddressUrl, selfieUrl].concat(docType !== 'passport' ? [idBackUrl] : []);
    if (!urlsToCheck.every((u) => typeof u === 'string' && UPLOAD_URL_RE.test(u))) return socket.emit('error-msg', 'One of your documents was not uploaded correctly. Please upload it again.');

    await store.updateGroup(groupId, {
      kyc_status: 'pending',
      kyc_doc_type: docType,
      kyc_id_front_url: sanitizeText(idFrontUrl, 500),
      kyc_id_back_url: docType === 'passport' ? null : sanitizeText(idBackUrl, 500),
      kyc_proof_address_url: sanitizeText(proofAddressUrl, 500),
      kyc_proof_address_type: proofAddressType,
      kyc_selfie_url: sanitizeText(selfieUrl, 500),
      kyc_submitted_at: new Date().toISOString(),
      kyc_rejection_reason: null
    });
    const updated = await store.getGroup(groupId);
    socket.emit('seller-account-state', publicSellerAccount(updated));
    io.to('finance-admins').emit('kyc-submitted', publicSellerAccount(updated));
    await pushAdminLedger(io, groupId);
  });

  socket.on('admin-get-kyc-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const groups = await store.getAllGroups();
    const queue = groups.filter(g => g.kyc_status === 'pending').map(publicSellerAccount);
    socket.emit('kyc-queue-list', queue);
  });

  socket.on('admin-review-kyc', async ({ groupId, decision, reason }) => {
    if (!metaHasMinRole('ADMIN')) return;
    if (!['verified', 'rejected'].includes(decision)) return;
    const group = await store.getGroup(groupId);
    if (!group || group.kyc_status !== 'pending') return;
    const m = meta();
    await store.updateGroup(groupId, {
      kyc_status: decision,
      kyc_reviewed_by: m.sessionToken,
      kyc_reviewed_at: new Date().toISOString(),
      kyc_rejection_reason: decision === 'rejected' ? (sanitizeText(reason, 500) || 'Not specified') : null
    });
    const updated = await store.getGroup(groupId);
    await pushSellerState(io, groupId, {
      kind: 'kyc',
      title: decision === 'verified' ? 'Identity verified' : 'Identity verification not approved',
      body: decision === 'verified' ? 'You can now request withdrawals at any time.' : (updated.kyc_rejection_reason || 'Please resubmit your documents.')
    });
    io.to('finance-admins').emit('kyc-resolved', publicSellerAccount(updated));
    if (updated.email_b) await notifyKycStatus(updated.email_b, { groupName: updated.name, status: decision, reason: updated.kyc_rejection_reason });
  });

  // ---- Deposits ("Record a deposit" — a notification, never proof of funds) ----
  socket.on('notify-deposit', async ({ groupId, asset, network, amount }) => {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return;
    if (!accountActionLimiter.allow(meta().sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 999999999.99) return socket.emit('error-msg', 'Please enter a valid amount.');
    // Deposits are crypto-only — bank deposit was intentionally removed.
    if (!CRYPTO_ASSETS.has(asset)) return socket.emit('error-msg', 'Please choose a valid asset.');

    const depAmt = F.round2(amt);
    const dep = await store.createDeposit({ groupId, method: 'crypto', asset, network: network || null, amount: depAmt });
    // Recorded immediately as "Held in Vault" — total_deposited moves now,
    // available balance never moves until an admin confirms the funds arrived.
    await store.adjustBalances(groupId, { held: depAmt, total: depAmt });
    await pushSellerState(io, groupId, null);
    socket.emit('deposit-created', publicDeposit(dep));
    io.to('finance-admins').emit('deposit-created', publicDeposit(dep));
    await broadcastGroupsList();
  });

  socket.on('admin-get-deposits-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const pending = await store.getPendingDeposits();
    socket.emit('deposits-queue-list', pending.map(publicDeposit));
  });

  socket.on('admin-review-deposit', async ({ depositId, decision, reason }) => {
    if (!metaHasMinRole('ADMIN')) return;
    if (!['verified', 'rejected'].includes(decision)) return;
    const dep = await store.getDepositById(depositId);
    if (!dep || dep.status !== 'held_in_vault') return;
    const group = await store.getGroup(dep.group_id);
    if (!group) return;
    const m = meta();
    const amt = F.round2(dep.amount);
    // Verified: held -> available. Rejected: release the hold and back out the
    // Total Deposited bump — it never became available.
    const moved = await store.adjustBalances(dep.group_id, decision === 'verified' ? { held: -amt, available: amt } : { held: -amt, total: -amt });
    if (!moved) return socket.emit('error-msg', 'The seller\'s held balance does not cover this deposit — please check the ledger.');
    const resolved = await store.resolveDeposit(depositId, { status: decision, verifiedBy: m.sessionToken, rejectionReason: decision === 'rejected' ? (sanitizeText(reason, 500) || 'Not specified') : null });
    const updatedGroup = await store.getGroup(dep.group_id);
    await pushSellerState(io, dep.group_id, {
      kind: 'deposit',
      title: decision === 'verified' ? 'Deposit confirmed' : 'Deposit could not be confirmed',
      body: decision === 'verified' ? `${amt.toFixed(2)} ${updatedGroup.seller_currency || ''} is now available.`.trim() : (resolved.rejection_reason || 'Not specified')
    });
    io.to('finance-admins').emit('deposit-resolved', publicDeposit(resolved));
    if (updatedGroup.email_b) await notifyDepositStatus(updatedGroup.email_b, { groupName: updatedGroup.name, amount: `${amt} ${updatedGroup.seller_currency || ''}`.trim(), status: decision, reason: resolved.rejection_reason });
    await broadcastGroupsList();
  });

  // ---- Withdrawals ----
  // The admin side of the state machine (pending -> held in vault -> processing
  // -> completed, or declined) lives in fundsHandlers.js. The seller's request is here.

  socket.on('request-withdrawal', async ({ groupId, method, asset, network, destination, beneficiaryName, bankName, bankAccount, bankSwift, bankCountry, amount, amountCurrency }) => {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return;
    if (!accountActionLimiter.allow(meta().sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    if (group.kyc_status !== 'verified') return socket.emit('error-msg', 'Your identity must be verified before you can withdraw.');
    if (!group.seller_currency) return socket.emit('error-msg', 'Your account currency has not been set yet.');
    const amt = F.round2(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) return socket.emit('error-msg', 'Please enter a valid amount.');
    if (!['crypto', 'bank'].includes(method)) return socket.emit('error-msg', 'Please choose a withdrawal method.');

    let ledgerAmount, ccy;
    if (method === 'crypto') {
      if (!CRYPTO_ASSETS.has(asset)) return socket.emit('error-msg', 'Please choose a valid asset.');
      if (!destination || sanitizeText(destination, 200).length < 6) return socket.emit('error-msg', 'Please enter a valid destination wallet address.');
      ccy = CURRENCIES.has(amountCurrency) ? amountCurrency : group.seller_currency; // seller may pick the entry currency for crypto only (§6)
      ledgerAmount = convertCurrency(amt, ccy, group.seller_currency);
    } else {
      if (!beneficiaryName || !bankName || !bankAccount) return socket.emit('error-msg', 'Beneficiary name, bank name and account number/IBAN are required.');
      ccy = group.seller_currency; // bank transfers stay in the account's fixed currency only
      ledgerAmount = amt;
    }
    if (ledgerAmount > Number(group.balance_available || 0)) return socket.emit('error-msg', 'That amount exceeds your available balance.');

    const wd = await store.createWithdrawal({
      groupId, method, asset: method === 'crypto' ? asset : null, network: method === 'crypto' ? (network || null) : null,
      destination: method === 'crypto' ? sanitizeText(destination, 200) : null,
      beneficiaryName: method === 'bank' ? sanitizeText(beneficiaryName, 200) : null,
      bankName: method === 'bank' ? sanitizeText(bankName, 200) : null,
      bankAccount: method === 'bank' ? sanitizeText(bankAccount, 100) : null,
      bankSwift: method === 'bank' ? sanitizeText(bankSwift, 50) : null,
      bankCountry: method === 'bank' ? sanitizeText(bankCountry, 100) : null,
      amount: amt, amountCurrency: ccy, amountLedger: Math.round(ledgerAmount * 100) / 100
    });
    socket.emit('withdrawal-created', publicWithdrawal(wd));
    io.to('finance-admins').emit('withdrawal-created', publicWithdrawal(wd));
    await pushSellerState(io, groupId, null); // keeps the seller's other devices + the Funds Desk in step
  });

  socket.on('admin-get-withdrawals-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const pending = await store.getPendingWithdrawals();
    socket.emit('withdrawals-queue-list', pending.map(publicWithdrawal));
  });

  // Admin inspecting one specific group's full Transaction Account (used
  // when opening a group from the Groups panel, distinct from the queues above
  // which span every group).
  socket.on('admin-get-seller-account', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    await emitSnapshotTo(socket, groupId);
  });

  // The Seller's own on-demand refresh — fired every time they open their
  // Transaction Account view, so what they see is pulled fresh from the
  // store rather than trusted to whatever the socket has cached client-side.
  socket.on('get-my-seller-account', async ({ groupId }) => {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return;
    await emitSnapshotTo(socket, groupId);
  });

  // ---------------- ADMIN+: GROUP BANNER (Branding Center) ----------------
  socket.on('admin-set-group-banner', async ({ groupId, bannerUrl }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const clean = sanitizeText(bannerUrl, 500);
    await store.updateGroup(groupId, { banner_url: clean || null });
    io.to(groupId).emit('group-banner-updated', { groupId, bannerUrl: clean || null });
    await broadcastGroupsList();
  });

  // ---------------- ADMIN+: KICK / DELETE / CLEAR USERS ----------------
  socket.on('admin-kick-user', ({ targetSessionToken }) => {
    if (!metaHasMinRole('ADMIN') || !targetSessionToken) return;
    for (const [sockId, v] of activeSockets.entries()) {
      if (v.sessionToken === targetSessionToken) {
        const targetSocket = io.sockets.sockets.get(sockId);
        if (targetSocket) {
          targetSocket.emit('error-msg', 'You have been disconnected by the Desk Officer.');
          targetSocket.disconnect(true);
        }
      }
    }
  });

  socket.on('admin-delete-user', async ({ targetSessionToken }) => {
    if (!metaHasMinRole('ADMIN') || !targetSessionToken) return;
    for (const [sockId, v] of activeSockets.entries()) {
      if (v.sessionToken === targetSessionToken) {
        const targetSocket = io.sockets.sockets.get(sockId);
        if (targetSocket) { targetSocket.emit('error-msg', 'Your session was removed by the Desk Officer.'); targetSocket.disconnect(true); }
      }
    }
    await store.deleteUser(targetSessionToken);
    await broadcastDirectory();
    await broadcastStats();
  });

  socket.on('admin-clear-offline-users', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const removed = await store.clearOfflineUsers();
    socket.emit('directory-cleared', { removed });
    await broadcastDirectory();
    await broadcastStats();
  });

  // ---------------- ADMIN+: CLEAR CHAT HISTORY ----------------
  socket.on('admin-clear-chat', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const messages = await store.getMessagesForGroup(groupId, 100000);
    const ids = messages.map(m => m.id);
    if (ids.length === 0) return;
    await store.deleteMessages(groupId, ids);
    io.to(groupId).emit('messages-bulk-deleted', { groupId, messageIds: ids });
    io.to(groupId).emit('pinned-messages-updated', { groupId, pinnedMessages: [] });
    await broadcastGroupsList();
  });

  // ---------------- TYPING / LIVE DRAFT ----------------
  socket.on('typing-start', async ({ isTyping, currentDraft }) => {
    const m = meta();
    if (!m) return;
    const user = await store.getUser(m.sessionToken);
    if (!user) return;
    socket.to(m.groupId).emit('user-typing', { sender: user.display_name, isTyping });
    io.to('admins').emit('admin-live-draft', {
      groupId: m.groupId,
      sender: user.display_name,
      draftText: sanitizeText(currentDraft, 500)
    });
  });

  // ---------------- ADMIN+: DIRECT MESSAGE ----------------
  socket.on('admin-initiate-dm', async ({ targetSessionToken, initialMessage }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const target = await store.getUser(targetSessionToken);
    if (!target) return;
    const m = meta();

    const dmRoomId = `dm-${[m.sessionToken, targetSessionToken].sort().join('-')}`;
    socket.join(dmRoomId);
    for (const [sockId, v] of activeSockets.entries()) {
      if (v.sessionToken === targetSessionToken) io.sockets.sockets.get(sockId)?.join(dmRoomId);
    }

    const clean = escapeHtml(sanitizeText(initialMessage, 2000));
    const msgPayload = {
      dmRoomId,
      sender: 'Desk Officer (Admin)',
      senderToken: m.sessionToken,
      text: clean,
      time: nowTime()
    };
    io.to(dmRoomId).emit('dm-channel-opened', { dmRoomId });
    io.to(dmRoomId).emit('dm-message', msgPayload);

    if (target.email) await notifyOfflineMessage(target.email, { fromName: 'Desk Officer (Admin)', groupName: 'Direct Message', text: clean });
  });

  socket.on('send-dm-reply', async ({ dmRoomId, text }) => {
    const m = meta();
    if (!m) return;
    const user = await store.getUser(m.sessionToken);
    const clean = escapeHtml(sanitizeText(text, 2000));
    if (!clean) return;
    io.to(dmRoomId).emit('dm-message', {
      dmRoomId,
      sender: user ? user.display_name : 'User',
      senderToken: m.sessionToken,
      text: clean,
      time: nowTime()
    });
  });

  // ---------------- ADMIN+: ANNOUNCEMENTS ----------------
  socket.on('create-announcement', async ({ groupIds, text }) => {
    if (!metaHasMinRole('ADMIN') || !Array.isArray(groupIds) || !groupIds.length) return;
    const clean = escapeHtml(sanitizeText(text, 1000));
    if (!clean) return;
    const m = meta();
    for (const groupId of groupIds) {
      const group = await store.getGroup(groupId);
      if (!group) continue;
      const sysMsg = await store.insertMessage({
        id: 'ann-' + Date.now() + Math.random().toString(36).slice(2, 6),
        groupId, senderName: 'ANNOUNCEMENT', text: clean
      });
      const announcement = await store.createAnnouncement({ groupId, messageId: sysMsg.id, text: clean, createdBy: m.sessionToken });
      const pinned = await store.togglePin(groupId, sysMsg.id);
      io.to(groupId).emit('message', await publicMessage(sysMsg));
      io.to(groupId).emit('pinned-messages-updated', { groupId, pinnedMessages: await Promise.all(pinned.map(publicMessage)) });
      io.to(groupId).emit('announcement-created', publicAnnouncement(announcement));
    }
    await broadcastGroupsList();
  });

  socket.on('get-announcements', async ({ groupId }) => {
    const m = meta();
    if (!m) return;
    const list = await store.getAnnouncements(groupId);
    socket.emit('announcements-list', { groupId, announcements: list.map(publicAnnouncement) });
  });

  socket.on('delete-announcement', async ({ groupId, id }) => {
    if (!metaHasMinRole('ADMIN')) return;
    await store.deleteAnnouncement(groupId, id);
    socket.emit('announcements-list', { groupId, announcements: (await store.getAnnouncements(groupId)).map(publicAnnouncement) });
  });

  // ---------------- TASKS & APPROVALS ----------------
  socket.on('create-task', async ({ groupId, title, description, assignedRole }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const cleanTitle = sanitizeText(title, 200);
    if (!cleanTitle) return;
    const m = meta();
    const task = await store.createTask({
      groupId, title: escapeHtml(cleanTitle), description: escapeHtml(sanitizeText(description, 1000)),
      createdBy: m.sessionToken, assignedRole: ['PARTY A', 'PARTY B'].includes(assignedRole) ? assignedRole : null
    });
    io.to(groupId).emit('task-created', publicTask(task));
    io.to('admins').emit('task-created', publicTask(task));
    await broadcastDashboardWidgets();
  });

  socket.on('get-tasks', async ({ groupId }) => {
    const m = meta();
    if (!m) return;
    const list = await store.getTasks(groupId);
    socket.emit('tasks-list', { groupId, tasks: list.map(publicTask) });
  });

  socket.on('update-task-status', async ({ groupId, taskId, status }) => {
    const m = meta();
    if (!m) return;
    if (!['Pending', 'Completed', 'Rejected'].includes(status)) return;
    const updated = await store.updateTaskStatus(groupId, taskId, status);
    if (!updated) return;
    io.to(groupId).emit('task-updated', publicTask(updated));
    io.to('admins').emit('task-updated', publicTask(updated));
    await broadcastDashboardWidgets();
  });

  socket.on('delete-task', async ({ groupId, taskId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    await store.deleteTask(groupId, taskId);
    io.to(groupId).emit('task-deleted', { groupId, taskId });
    io.to('admins').emit('task-deleted', { groupId, taskId });
    await broadcastDashboardWidgets();
  });

  // ---------------- MISC ----------------
  socket.on('get-all-groups', () => broadcastGroupsList(socket));

  socket.on('admin-get-stats', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    socket.emit('admin-stats', await store.getStats());
  });

  socket.on('admin-get-dashboard-widgets', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    socket.emit('dashboard-widgets-update', await store.getDashboardWidgets());
  });

  socket.on('disconnect', async () => {
    const m = meta();
    if (!m) return;
    activeSockets.delete(socket.id);

    const stillConnected = Array.from(activeSockets.values()).some(v => v.sessionToken === m.sessionToken);
    if (stillConnected) return;

    const timer = setTimeout(async () => {
      pendingDisconnects.delete(m.sessionToken);
      const reconnectedNow = Array.from(activeSockets.values()).some(v => v.sessionToken === m.sessionToken);
      if (reconnectedNow) return;

      await store.setUserOnline(m.sessionToken, false);
      // Going offline is reflected only in presence (header badges + Directory),
      // never as a chat message — see the matching note in 'join-room'.
      await broadcastDirectory();
      await broadcastPresence(m.groupId);
      await broadcastStats();
      await broadcastDashboardWidgets();
    }, DISCONNECT_GRACE_MS);

    pendingDisconnects.set(m.sessionToken, timer);
  });
}

function isValidEmailSafe(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

module.exports = { registerSocketHandlers };
