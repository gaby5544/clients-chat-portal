const { store } = require('./db');
const { escapeHtml, sanitizeText, RateLimiter } = require('./security');
const { notifyOfflineMessage, notifyTransactionSubmitted } = require('./email');
const { resolveAdminRole, hasMinRole } = require('./roles');
const F = require('./finance');
const COUNTRIES = require('./public/countries.js');
const LANGS = require('./public/languages.js');
const IP = require('./ipTools');
const N = require('./notifyService');
const { registerFundsHandlers, pushSellerState, pushAdminLedger, emitSnapshotTo } = require('./fundsHandlers');
const { registerAccountHandlers, maskEmail } = require('./accountHandlers');

const messageLimiter = new RateLimiter({ windowMs: 10000, max: 20 });   // 20 msgs / 10s per socket
const actionLimiter = new RateLimiter({ windowMs: 10000, max: 30 });    // generic admin/action guard
const accountActionLimiter = new RateLimiter({ windowMs: 60000, max: 8 }); // registration/KYC/deposit/withdrawal submissions
setInterval(() => { messageLimiter.sweep(); actionLimiter.sweep(); accountActionLimiter.sweep(); }, 60000).unref();

const COMPLAINTS_EMAIL = require('./email').COMPLAINTS_EMAIL;

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
    lastSeen: u.last_seen,
    countryCode: u.country_code || null,
    countryName: u.country_name || null,
    language: u.language || null
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
    audience: m.audience || null,
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
    disbursementEnabled: !!g.disbursement_enabled,
    sellerDisabled: !!g.seller_disabled,
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

  // Immediate + automatic (no approval gate, unlike email below). The push is translated
  // into the recipient's own language before it is sent.
  async function pushIfOffline(targetToken, payload) {
    if (N.isOnline(io, targetToken)) return;
    await store.addNotification(targetToken, 'message', payload);
    await N.pushToToken(targetToken, {
      title: `New message from ${payload.fromName}`,
      body: payload.text ? `${payload.groupName}: ${payload.text}` : payload.groupName,
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

  // Money movement (incoming funds, escrow review, withdrawal stages, Funds Desk) and the
  // seller's own account flows (registration, KYC, business upgrade, withdrawals, admin controls).
  const subCtx = { meta, metaHasMinRole, broadcastGroupsList, broadcastDirectory, publicMessage };
  registerFundsHandlers(io, socket, subCtx);
  registerAccountHandlers(io, socket, subCtx);

  // ---------------- JOIN ROOM ----------------
  socket.on('join-room', async ({ groupId, role, adminKey, sessionToken, email, lang }) => {
    try {
      if (!sessionToken || typeof sessionToken !== 'string') return;
      groupId = sanitizeText(groupId || 'default-group', 100);
      const adminRole = resolveAdminRole(adminKey);
      const isAdmin = !!adminRole;
      const ip = IP.fromSocket(socket);

      let group = await store.getGroup(groupId);
      if (!group) {
        if (!isAdmin) {
          return socket.emit('error-msg', 'This group does not exist, or your invite link is invalid. Please check the link with your Desk Officer.');
        }
        group = await store.createGroupIfMissing(groupId, `Transaction Group #${(await store.getAllGroups()).length + 1}`);
      }

      // Invite links use friendly role names in the URL ('BUYER'/'SELLER') so
      // a party never sees the internal 'PARTY A'/'PARTY B' slot names even
      // in their own browser's address bar. Old-style links already sent
      // out with '?role=PARTY%20A' etc. still work.
      const roleMap = { BUYER: 'PARTY A', SELLER: 'PARTY B', 'PARTY A': 'PARTY A', 'PARTY B': 'PARTY B' };
      const safeRole = roleMap[role] || 'PARTY A';

      // A REGISTERED seller's seat is protected: only a session that signed in with the
      // account password may take it, and a blocked IP never may. (Before registration the
      // invite link alone is enough — that is how the seller creates the account.)
      if (!isAdmin && safeRole === 'PARTY B') {
        if (await store.isIpBlocked(groupId, ip)) {
          await store.logIpEvent({ groupId, kind: 'login_blocked', ip, userAgent: socket.handshake.headers['user-agent'] });
          return socket.emit('seller-ip-blocked', { supportEmail: COMPLAINTS_EMAIL });
        }
        if (group.seller_registered) {
          let authorised = await store.hasSellerSession(groupId, sessionToken);
          if (!authorised) {
            // Accounts created before sign-in existed: the session already holding the seat is grandfathered in once.
            const existing = await store.getSellerSessionTokens(groupId);
            if (!existing.length && group.seller_session_token === sessionToken) { await store.addSellerSession(groupId, sessionToken, ip); authorised = true; }
          }
          if (!authorised) {
            return socket.emit('seller-login-required', { groupId, groupName: group.name, emailHint: maskEmail(group.email_b) });
          }
        }
      }

      const displayName = isAdmin
        ? `Desk Officer (${adminRole === 'SUPER_ADMIN' ? 'Super Admin' : adminRole === 'MODERATOR' ? 'Moderator' : 'Admin'})`
        : (safeRole === 'PARTY A' ? group.custom_name_a : group.custom_name_b);

      // A reconnect within the grace window (brief network blip / tab backgrounding)
      // just clears the pending "went offline" timer below.
      if (pendingDisconnects.has(sessionToken)) {
        clearTimeout(pendingDisconnects.get(sessionToken));
        pendingDisconnects.delete(sessionToken);
      }

      // Country: a registered seller's declared country; otherwise whatever the host/CDN tells us about the visitor.
      let countryCode; let countryName;
      if (!isAdmin && safeRole === 'PARTY B' && group.seller_registered) {
        const c = COUNTRIES.byName(group.seller_country);
        if (c) { countryCode = c.code; countryName = c.name; }
      } else if (!isAdmin) {
        const c = COUNTRIES.byCode(IP.countryFromHeaders(socket.handshake.headers));
        if (c) { countryCode = c.code; countryName = c.name; }
      }
      const accountLang = (!isAdmin && safeRole === 'PARTY B' && group.seller_registered) ? group.seller_language : null;
      const chosenLang = LANGS.get(accountLang || lang) ? (accountLang || lang) : undefined;

      const user = await store.upsertUser({
        sessionToken,
        displayName,
        role: isAdmin ? 'ADMINISTRATOR' : safeRole,
        isAdmin,
        adminRole,
        email: isValidEmailSafe(email) ? email : undefined,
        countryCode, countryName, language: chosenLang,
        isOnline: true
      });

      socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
      socket.join(groupId);
      socket.join(N.userRoom(sessionToken)); // private room: every tab/device of this person
      if (isAdmin) socket.join('admins');
      // Money data goes ONLY to Admin / Super Admin (never a Moderator) via this room.
      if (hasMinRole(adminRole, 'ADMIN')) socket.join('finance-admins');

      activeSockets.set(socket.id, { sessionToken, groupId, isAdmin, adminRole, role: isAdmin ? null : safeRole, ip });

      // Persist which session currently holds the Buyer/Seller seat for THIS
      // group — this is what lets offline notifications target exactly the right
      // two people instead of every user in the system.
      if (!isAdmin) {
        await store.updateGroup(groupId, safeRole === 'PARTY A' ? { buyer_session_token: sessionToken } : { seller_session_token: sessionToken });
        group = await store.getGroup(groupId);
        // The seller gets a private room for their Transaction Account so
        // live money updates can never reach the Buyer in the same chat.
        if (safeRole === 'PARTY B') {
          socket.join(`seller:${groupId}`);
          if (group.seller_registered) await store.logIpEvent({ groupId, kind: 'join', ip, country: countryCode, userAgent: socket.handshake.headers['user-agent'] });
        } else socket.join(`buyer:${groupId}`);
      }

      const viewer = { isAdmin, role: isAdmin ? null : safeRole };
      let [messages, pinnedMessages, unreadCounts, announcements, tasks] = await Promise.all([
        store.getMessagesForGroup(groupId),
        store.getPinnedMessages(groupId),
        store.getUnreadCounts(sessionToken),
        store.getAnnouncements(groupId),
        store.getTasks(groupId)
      ]);

      messages = messages.filter(m => N.canSeeMessage(m.audience, viewer));
      pinnedMessages = pinnedMessages.filter(m => N.canSeeMessage(m.audience, viewer));
      await store.clearUnread(sessionToken, groupId);

      socket.emit('init-state', {
        group: await groupSummary(group, sessionToken),
        isAdminConfirmed: isAdmin,
        adminRole,
        role: isAdmin ? null : safeRole,
        socketId: socket.id,
        sessionToken,
        language: user.language || null,
        accountLanguage: accountLang,
        country: countryCode ? { code: countryCode, name: countryName } : null,
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
      if (!m || m.groupId !== groupId) return;
      const user = await store.getUser(m.sessionToken);
      const group = await store.getGroup(groupId);
      if (!user || !group) return;
      if (!m.isAdmin && m.role === 'PARTY B' && group.seller_registered) {
        if (!(await store.hasSellerSession(groupId, m.sessionToken))) return socket.emit('seller-login-required', { groupId, groupName: group.name, emailHint: maskEmail(group.email_b) });
        if (group.seller_disabled) return socket.emit('error-msg', `Your account has been disabled. To lodge a complaint, contact ${COMPLAINTS_EMAIL}.`);
      }

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

      // WHO gets notified: the group's own Buyer and Seller (whichever did not send it) and
      // every Desk Officer other than the sender. Never anyone outside this deal. Each recipient
      // is told immediately — a live event if online (the browser plays the sound 3 times when
      // they are not looking at the chat), a translated push if offline — and is reminded every
      // 60 minutes (see notifyService) until they open the chat.
      const senderToken = user.session_token;
      const senderParty = group.buyer_session_token === senderToken ? 'A'
        : group.seller_session_token === senderToken ? 'B' : null;
      const notifyPayload = { fromName: user.display_name, groupName: group.name, text: cleanText.slice(0, 200), groupId };
      const recipients = new Map(); // token -> 'A' | 'B' | 'ADMIN'
      if (group.buyer_session_token && senderParty !== 'A') recipients.set(group.buyer_session_token, 'A');
      if (group.seller_session_token && senderParty !== 'B') recipients.set(group.seller_session_token, 'B');
      for (const u of await store.getAllUsers()) if (u.is_admin && u.session_token !== senderToken) recipients.set(u.session_token, 'ADMIN');
      recipients.delete(senderToken);

      for (const [token, kind] of recipients.entries()) {
        await store.incrementUnread(token, groupId);
        N.emitToUser(io, token, 'notify-message', { ...notifyPayload, messageId: msg.id });
        if (!N.isOnline(io, token)) await pushIfOffline(token, notifyPayload);
      }
      // A party who has never joined has no session token yet — an email (if one is on file) can still be queued.
      for (const party of ['A', 'B']) {
        if (party === senderParty) continue;
        const token = party === 'A' ? group.buyer_session_token : group.seller_session_token;
        if (!token || !N.isOnline(io, token)) await queueOfflineEmail(group, party, notifyPayload);
      }
    } catch (err) {
      console.error('[send-message] error:', err);
    }
  });

  // ---------------- MARK READ (also drives read receipts) ----------------
  socket.on('mark-group-read', async ({ groupId }) => {
    const m = meta();
    if (!m || m.groupId !== groupId) return;
    const had = Number((await store.getUnreadCounts(m.sessionToken))[groupId] || 0);
    await store.clearUnread(m.sessionToken, groupId); // ends the 60-minute reminders for this person
    const updatedIds = await store.markGroupRead(groupId, m.sessionToken, m.sessionToken);
    if (updatedIds.length) io.to(groupId).emit('message-status-bulk-update', { messageIds: updatedIds, status: 'read' });
    // Tell everyone else the messages were opened (in the group, and any Desk Officer elsewhere).
    if (updatedIds.length || had) {
      const reader = await store.getUser(m.sessionToken);
      const notice = { groupId, byName: reader ? reader.display_name : 'Someone', byToken: m.sessionToken, count: updatedIds.length || had };
      socket.to(groupId).emit('message-read-notice', notice);
      io.to('admins').except(groupId).emit('message-read-notice', notice);
    }
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
    const target = await store.getGroup(groupId);
    if (party === 'B' && target && target.seller_registered) return socket.emit('error-msg', 'The seller\'s email is tied to their Transaction Account and cannot be changed.');
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
    if (party === 'B' && group.seller_registered) return socket.emit('error-msg', 'Your email is tied to your Transaction Account and cannot be changed.');
    const clean = email.trim();
    await store.updateGroup(groupId, party === 'A' ? { email_a: clean } : { email_b: clean });
    socket.emit('my-email-updated', { email: clean });
    io.to('admins').emit('party-email-updated', { groupId, party, email: clean });
    await broadcastGroupsList();
  });

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
