const { store } = require('./db');
const { escapeHtml, sanitizeText, RateLimiter } = require('./security');
const { notifyOfflineMessage, notifyTransactionSubmitted } = require('./email');
const { ADMIN_PASSKEY } = require('./routes');

const messageLimiter = new RateLimiter({ windowMs: 10000, max: 20 });   // 20 msgs / 10s per socket
const actionLimiter = new RateLimiter({ windowMs: 10000, max: 30 });    // generic admin/action guard
setInterval(() => { messageLimiter.sweep(); actionLimiter.sweep(); }, 60000).unref();

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
    isOnline: u.is_online,
    lastSeen: u.last_seen
  };
}

async function publicMessage(m) {
  const reactions = await store.getReactionSummary(m.id);
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
    reactions
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
    fileUploadsEnabled: g.file_uploads_enabled,
    highlighted: g.highlighted,
    transactionFormEnabled: g.transaction_form_enabled,
    lastMessagePreview: last ? (last.file_url ? `📎 ${last.file_name || 'Attachment'}` : last.text).slice(0, 80) : 'No messages yet...',
    unreadCount: unread
  };
}

function registerSocketHandlers(io, socket) {
  const activeSockets = io._activeSockets || (io._activeSockets = new Map()); // socketId -> {sessionToken, groupId, isAdmin}
  const pendingDisconnects = io._pendingDisconnects || (io._pendingDisconnects = new Map()); // sessionToken -> timeout handle
  const DISCONNECT_GRACE_MS = 8000; // absorb brief network blips / tab backgrounding without spamming the chat

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
    // Regular (non-admin) users must never receive the full groups list —
    // they're locked to the single group they were invited into.
    const groups = await store.getAllGroups();
    if (viewerSocket) {
      const meta = activeSockets.get(viewerSocket.id);
      if (!meta || !meta.isAdmin) return; // silently ignore for non-admins
      const list = await Promise.all(groups.map(g => groupSummary(g, meta.sessionToken)));
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

  async function pushNotificationIfOffline(targetToken, payload) {
    const targetOnline = Array.from(activeSockets.values()).some(v => v.sessionToken === targetToken);
    if (targetOnline) return;
    const user = await store.getUser(targetToken);
    await store.addNotification(targetToken, 'message', payload);
    if (user && user.email) {
      await notifyOfflineMessage(user.email, payload);
    }
  }

  // ---------------- JOIN ROOM ----------------
  socket.on('join-room', async ({ groupId, role, adminKey, sessionToken, email }) => {
    try {
      if (!sessionToken || typeof sessionToken !== 'string') return;
      groupId = sanitizeText(groupId || 'default-group', 100);
      const isAdmin = adminKey === ADMIN_PASSKEY;

      let group = await store.getGroup(groupId);
      if (!group) {
        if (!isAdmin) {
          return socket.emit('error-msg', 'This group does not exist, or your invite link is invalid. Please check the link with your Desk Officer.');
        }
        group = await store.createGroupIfMissing(groupId, `Transaction Group #${(await store.getAllGroups()).length + 1}`);
      }

      const safeRole = ['PARTY A', 'PARTY B'].includes(role) ? role : 'PARTY A';
      const displayName = isAdmin
        ? 'Desk Officer (Admin)'
        : (safeRole === 'PARTY A' ? group.custom_name_a : group.custom_name_b);

      // Was this session already considered "present" before this connection?
      // (another open tab, or a disconnect that's still within its grace
      // window) — if so, this is a resume, not a fresh arrival, and should
      // not post a new "connected" system message.
      const alreadyActiveElsewhere = Array.from(activeSockets.values()).some(v => v.sessionToken === sessionToken);
      const wasWithinGracePeriod = pendingDisconnects.has(sessionToken);
      if (wasWithinGracePeriod) {
        clearTimeout(pendingDisconnects.get(sessionToken));
        pendingDisconnects.delete(sessionToken);
      }
      const isGenuinelyNewPresence = !alreadyActiveElsewhere && !wasWithinGracePeriod;

      const user = await store.upsertUser({
        sessionToken,
        displayName,
        role: isAdmin ? 'ADMINISTRATOR' : safeRole,
        isAdmin,
        email: isValidEmailSafe(email) ? email : undefined,
        isOnline: true
      });

      // Leave previous rooms
      socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
      socket.join(groupId);
      if (isAdmin) socket.join('admins');

      activeSockets.set(socket.id, { sessionToken, groupId, isAdmin });

      const [messages, pinnedMessages, unreadCounts] = await Promise.all([
        store.getMessagesForGroup(groupId),
        store.getPinnedMessages(groupId),
        store.getUnreadCounts(sessionToken)
      ]);

      await store.clearUnread(sessionToken, groupId);

      socket.emit('init-state', {
        group: await groupSummary(group, sessionToken),
        isAdminConfirmed: isAdmin,
        socketId: socket.id,
        sessionToken,
        messages: await Promise.all(messages.map(publicMessage)),
        pinnedMessages: await Promise.all(pinnedMessages.map(publicMessage)),
        unreadCounts
      });

      if (isGenuinelyNewPresence) {
        const sysMsg = await store.insertMessage({
          id: 'sys-' + Date.now() + Math.random().toString(36).slice(2, 6),
          groupId,
          senderName: 'SYSTEM',
          text: `${escapeHtml(displayName)} connected.`
        });
        io.to(groupId).emit('message', await publicMessage(sysMsg));
      }

      await broadcastPresence(groupId);
      await broadcastDirectory();
      await broadcastGroupsList();
      if (isAdmin) await broadcastStats();
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
      const meta = activeSockets.get(socket.id);
      if (!meta) return;
      const user = await store.getUser(meta.sessionToken);
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

      const payload = await publicMessage(msg);
      io.to(groupId).emit('message', payload);
      await broadcastGroupsList();
      await broadcastStats();

      // Offline delivery: increment unread + notify everyone else who is a
      // member of this conversation but not currently connected.
      const allUsers = await store.getAllUsers();
      const onlineTokens = new Set(Array.from(activeSockets.values()).map(v => v.sessionToken));
      for (const other of allUsers) {
        if (other.session_token === user.session_token) continue;
        await store.incrementUnread(other.session_token, groupId);
        if (!onlineTokens.has(other.session_token)) {
          await pushNotificationIfOffline(other.session_token, {
            fromName: user.display_name,
            groupName: group.name,
            text: cleanText.slice(0, 200)
          });
        }
      }
    } catch (err) {
      console.error('[send-message] error:', err);
    }
  });

  // ---------------- MARK READ ----------------
  socket.on('mark-group-read', async ({ groupId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta) return;
    await store.clearUnread(meta.sessionToken, groupId);
    await broadcastGroupsList(socket);
  });

  // ---------------- ADMIN: EDIT MESSAGE ----------------
  socket.on('admin-edit-message', async ({ groupId, messageId, newText }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const clean = sanitizeText(newText, 4000);
    if (!clean) return;
    const updated = await store.editMessage(messageId, escapeHtml(clean), meta.sessionToken);
    if (!updated) return;
    // Users only ever see the latest text — no "(edited)" flag goes to them.
    io.to(groupId).emit('message-edited', { groupId, messageId, newText: updated.text });
    // Admin-only edited badge, sent solely into the admin room.
    io.to('admins').emit('message-edited-admin-flag', { groupId, messageId, isEdited: true });
  });

  // ---------------- ADMIN: GET EDIT HISTORY (admin-only) ----------------
  socket.on('admin-get-edit-history', async ({ messageId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const history = await store.getMessageEditHistory(messageId);
    socket.emit('edit-history-result', { messageId, history });
  });

  // ---------------- ADMIN: PIN / UNPIN (fixed event name) ----------------
  socket.on('admin-toggle-pin-message', async ({ groupId, messageId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const pinned = await store.togglePin(groupId, messageId);
    io.to(groupId).emit('pinned-messages-updated', {
      groupId,
      pinnedMessages: await Promise.all(pinned.map(publicMessage))
    });
  });

  // ---------------- ADMIN: BULK DELETE MESSAGES ----------------
  socket.on('admin-bulk-delete-messages', async ({ groupId, messageIds }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin || !Array.isArray(messageIds)) return;
    await store.deleteMessages(groupId, messageIds);
    io.to(groupId).emit('messages-bulk-deleted', { groupId, messageIds });
    const pinned = await store.getPinnedMessages(groupId);
    io.to(groupId).emit('pinned-messages-updated', { groupId, pinnedMessages: await Promise.all(pinned.map(publicMessage)) });
    await broadcastGroupsList();
  });

  // ---------------- ADMIN: TOGGLE UPLOAD PERMISSION (fixed event name) ----------------
  socket.on('admin-toggle-upload-permission', async ({ groupId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    const updated = await store.updateGroup(groupId, { file_uploads_enabled: !group.file_uploads_enabled });
    io.to(groupId).emit('upload-permission-changed', { groupId, fileUploadsEnabled: updated.file_uploads_enabled });
  });

  // ---------------- ADMIN: TRANSACTION FORM TOGGLE ----------------
  socket.on('admin-toggle-transaction-form', async ({ groupId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    const updated = await store.updateGroup(groupId, { transaction_form_enabled: !group.transaction_form_enabled });
    io.to(groupId).emit('transaction-form-status', { groupId, enabled: updated.transaction_form_enabled });
  });

  // ---------------- SUBMIT TRANSACTION ----------------
  socket.on('submit-transaction', async ({ groupId, formData }) => {
    if (!actionLimiter.allow(socket.id)) return;
    const meta = activeSockets.get(socket.id);
    if (!meta) return;
    const group = await store.getGroup(groupId);
    const user = await store.getUser(meta.sessionToken);
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

    // Notify all connected admins by email if they have one on file.
    const admins = (await store.getAllUsers()).filter(u => u.is_admin && u.email);
    for (const admin of admins) {
      await notifyTransactionSubmitted(admin.email, { submitterName: tx.submitted_by, groupName: group.name });
    }
    socket.emit('transaction-submit-ack', { success: true });
  });

  socket.on('admin-get-transactions', async ({ groupId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const [rows, group] = await Promise.all([store.getTransactions(groupId), store.getGroup(groupId)]);
    socket.emit('transactions-list', { groupId, transactions: rows, formEnabled: !!(group && group.transaction_form_enabled) });
  });

  socket.on('admin-delete-transaction', async ({ groupId, txId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    await store.deleteTransaction(groupId, txId);
    io.to('admins').emit('transaction-deleted', { groupId, txId });
    await broadcastStats();
  });

  // ---------------- REACTIONS ----------------
  socket.on('toggle-reaction', async ({ groupId, messageId, emoji }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || typeof emoji !== 'string' || emoji.length > 8) return;
    const summary = await store.toggleReaction(messageId, meta.sessionToken, emoji);
    io.to(groupId).emit('reaction-updated', { messageId, reactions: summary });
  });

  // ---------------- GROUP MANAGEMENT ----------------
  socket.on('create-group', async ({ groupName }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const newId = 'group-' + Date.now();
    const name = sanitizeText(groupName, 100) || `General Transaction Group #${(await store.getAllGroups()).length + 1}`;
    await store.createGroupIfMissing(newId, escapeHtml(name));
    await broadcastGroupsList();
    socket.emit('group-created-and-switch', { newGroupId: newId });
  });

  socket.on('delete-group', async ({ groupId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const all = await store.getAllGroups();
    if (all.length <= 1) return socket.emit('error-msg', 'Cannot delete the last remaining group!');
    await store.deleteGroup(groupId);
    await broadcastGroupsList();
    const remaining = (await store.getAllGroups())[0];
    io.to(groupId).emit('force-room-switch', { newGroupId: remaining.id });
  });

  socket.on('bulk-delete-groups', async ({ groupIds }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin || !Array.isArray(groupIds)) return;
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
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    await store.updateGroup(groupId, { highlighted: !group.highlighted });
    await broadcastGroupsList();
  });

  socket.on('rename-party', async ({ groupId, party, newName }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const clean = escapeHtml(sanitizeText(newName, 100));
    if (!clean || !['A', 'B'].includes(party)) return;
    await store.updateGroup(groupId, party === 'A' ? { custom_name_a: clean } : { custom_name_b: clean });
    const group = await store.getGroup(groupId);
    // Note: this relabels the ROLE going forward (new messages from that
    // role use the new name). It intentionally does NOT force connected
    // clients to rejoin — that used to cause a disconnect/reconnect cycle
    // that spammed the chat with duplicate system messages. Anyone
    // currently connected picks up their new label next time they open
    // the app (reload/rejoin).
    io.to(groupId).emit('party-renamed', { groupId, party, newName: clean, customNames: { A: group.custom_name_a, B: group.custom_name_b } });
    await broadcastGroupsList();
  });

  // ---------------- ADMIN: KICK USER ----------------
  socket.on('admin-kick-user', ({ targetSessionToken }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin || !targetSessionToken) return;
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

  // ---------------- ADMIN: DELETE / CLEAR DIRECTORY ENTRIES ----------------
  socket.on('admin-delete-user', async ({ targetSessionToken }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin || !targetSessionToken) return;
    // Force-disconnect them first if currently online, then purge their record.
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
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const removed = await store.clearOfflineUsers();
    socket.emit('directory-cleared', { removed });
    await broadcastDirectory();
    await broadcastStats();
  });

  // ---------------- ADMIN: CLEAR CHAT HISTORY ----------------
  socket.on('admin-clear-chat', async ({ groupId }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
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
    const meta = activeSockets.get(socket.id);
    if (!meta) return;
    const user = await store.getUser(meta.sessionToken);
    if (!user) return;
    socket.to(meta.groupId).emit('user-typing', { sender: user.display_name, isTyping });
    io.to('admins').emit('admin-live-draft', {
      groupId: meta.groupId,
      sender: user.display_name,
      draftText: sanitizeText(currentDraft, 500)
    });
  });

  // ---------------- ADMIN DM ----------------
  socket.on('admin-initiate-dm', async ({ targetSessionToken, initialMessage }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    const target = await store.getUser(targetSessionToken);
    if (!target) return;

    const dmRoomId = `dm-${[meta.sessionToken, targetSessionToken].sort().join('-')}`;
    socket.join(dmRoomId);
    for (const [sockId, v] of activeSockets.entries()) {
      if (v.sessionToken === targetSessionToken) io.sockets.sockets.get(sockId)?.join(dmRoomId);
    }

    const clean = escapeHtml(sanitizeText(initialMessage, 2000));
    const msgPayload = {
      dmRoomId,
      sender: 'Desk Officer (Admin)',
      senderToken: meta.sessionToken,
      text: clean,
      time: nowTime()
    };
    io.to(dmRoomId).emit('dm-channel-opened', { dmRoomId });
    io.to(dmRoomId).emit('dm-message', msgPayload);

    if (target.email) await notifyOfflineMessage(target.email, { fromName: 'Desk Officer (Admin)', groupName: 'Direct Message', text: clean });
  });

  socket.on('send-dm-reply', async ({ dmRoomId, text }) => {
    const meta = activeSockets.get(socket.id);
    if (!meta) return;
    const user = await store.getUser(meta.sessionToken);
    const clean = escapeHtml(sanitizeText(text, 2000));
    if (!clean) return;
    io.to(dmRoomId).emit('dm-message', {
      dmRoomId,
      sender: user ? user.display_name : 'User',
      senderToken: meta.sessionToken,
      text: clean,
      time: nowTime()
    });
  });

  // ---------------- MISC ----------------
  socket.on('get-all-groups', () => broadcastGroupsList(socket));

  socket.on('admin-get-stats', async () => {
    const meta = activeSockets.get(socket.id);
    if (!meta || !meta.isAdmin) return;
    socket.emit('admin-stats', await store.getStats());
  });

  socket.on('disconnect', async () => {
    const meta = activeSockets.get(socket.id);
    if (!meta) return;
    activeSockets.delete(socket.id);

    // Only start the offline countdown if no other socket for this session remains.
    const stillConnected = Array.from(activeSockets.values()).some(v => v.sessionToken === meta.sessionToken);
    if (stillConnected) return; // another tab/device is still active — nothing to announce

    const timer = setTimeout(async () => {
      pendingDisconnects.delete(meta.sessionToken);
      // Re-check: they may have reconnected right at the boundary.
      const reconnectedNow = Array.from(activeSockets.values()).some(v => v.sessionToken === meta.sessionToken);
      if (reconnectedNow) return;

      await store.setUserOnline(meta.sessionToken, false);
      const user = await store.getUser(meta.sessionToken);
      const sysMsg = await store.insertMessage({
        id: 'sys-' + Date.now() + Math.random().toString(36).slice(2, 6),
        groupId: meta.groupId,
        senderName: 'SYSTEM',
        text: `${escapeHtml(user ? user.display_name : 'A user')} disconnected.`
      });
      io.to(meta.groupId).emit('message', await publicMessage(sysMsg));
      await broadcastDirectory();
      await broadcastPresence(meta.groupId);
      await broadcastStats();
    }, DISCONNECT_GRACE_MS);

    pendingDisconnects.set(meta.sessionToken, timer);
  });
}

function isValidEmailSafe(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

module.exports = { registerSocketHandlers };
