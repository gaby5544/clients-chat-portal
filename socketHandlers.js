const { store } = require('./db');
const { escapeHtml, sanitizeText, RateLimiter, hashPassword, verifyPassword, isStrongEnoughPassword, isValidEmail } = require('./security');
const { notifyOfflineMessage, notifyTransactionSubmitted, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus } = require('./email');
const { resolveAdminRole, hasMinRole } = require('./roles');
const { sendPushToUser } = require('./webpush');
const F = require('./finance');
const { publicSellerAccount, publicDeposit, publicWithdrawal, CURRENCIES, CRYPTO_ASSETS, convertCurrency } = F;
const { registerFundsHandlers, pushSellerState, pushAdminLedger, emitSnapshotTo } = require('./fundsHandlers');
const { registerAccountHandlers, recordSellerIp, isIpBlocked, ipOfSocket } = require('./accountHandlers');
const { registerTrackingHandlers } = require('./tracking');
const notifier = require('./notifier');
const { uidOf, tokenForUid } = require('./identity');
const QC = require('./public/countries');
const { COMPLAINTS_EMAIL } = require('./terms');
const L = require('./links');
const W = require('./wallets');
const BD = require('./bankDetails');
const CARD = require('./cards');
const geoip = require('./geoip');
const { sendLoginAlert, setLoginAlertsEnabled } = require('./loginAlert');
// Missed-message emails now go out automatically (set AUTO_SEND_OFFLINE_EMAILS=false to bring back the approval queue).
const AUTO_EMAIL = String(process.env.AUTO_SEND_OFFLINE_EMAILS || 'true').toLowerCase() !== 'false';

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
    uid: uidOf(u.session_token),
    displayName: u.display_name,
    role: u.role,
    isAdmin: u.is_admin,
    adminRole: u.admin_role || null,
    isOnline: u.is_online,
    lastSeen: u.last_seen,
    language: u.language || null,
    countryIso: u.countryIso || null,
    country: u.country || null
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
    senderId: uidOf(m.sender_token),
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
    status: t.status, createdBy: uidOf(t.created_by), assignedRole: t.assigned_role,
    createdAt: t.created_at, updatedAt: t.updated_at
  };
}

function publicAnnouncement(a) {
  return { id: a.id, groupId: a.group_id, messageId: a.message_id, text: a.text, createdBy: uidOf(a.created_by), createdAt: a.created_at };
}

function publicPendingEmail(p) {
  return {
    id: p.id, groupId: p.group_id, party: p.party, toEmail: p.to_email,
    fromName: p.from_name, groupName: p.group_name, text: p.message_text,
    status: p.status, createdAt: p.created_at
  };
}

async function groupSummary(g, viewerToken, forAdmin = false, viewerRole = null) {
  const messages = await store.getMessagesForGroup(g.id, 1);
  const last = messages[messages.length - 1];
  const unread = viewerToken ? (await store.getUnreadCounts(viewerToken))[g.id] || 0 : 0;
  return {
    id: g.id,
    name: g.name,
    customNames: { A: g.custom_name_a, B: g.custom_name_b },
    // A buyer or seller only ever receives THEIR OWN address — never the other party's.
    emails: (!forAdmin && viewerRole === 'PARTY A') ? { A: g.email_a || null, B: null }
      : (!forAdmin && viewerRole === 'PARTY B') ? { A: null, B: g.email_b || null }
      : { A: g.email_a || null, B: g.email_b || null },
    fileUploadsEnabled: g.file_uploads_enabled,
    highlighted: g.highlighted,
    transactionFormEnabled: g.transaction_form_enabled,
    bannerUrl: g.banner_url || null,
    disbursementEnabled: !!g.disbursement_enabled,
    ...(forAdmin ? {
      seller: {
        registered: !!g.seller_registered, name: g.seller_full_name || null, accountId: g.seller_account_id || null,
        country: g.seller_country || null, countryIso: g.seller_country_iso || null, phone: g.seller_phone || null,
        disabled: !!g.seller_disabled, accountType: g.seller_account_type || 'standard', language: g.seller_language || 'en',
        kycStatus: g.kyc_status, businessStatus: g.business_status || 'none', emailLocked: !!g.seller_email_locked
      }
    } : {}),
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
    await broadcastLastSeen(groupId).catch(() => {});
  }

  async function broadcastDirectory() {
    const [all, groups] = await Promise.all([store.getAllUsers(), store.getAllGroups()]);
    const geo = new Map(); // seller session token -> where they are from
    for (const g of groups) if (g.seller_session_token && g.seller_country_iso) geo.set(g.seller_session_token, { countryIso: g.seller_country_iso, country: g.seller_country });
    const seat = new Map(); // session token -> the group whose Buyer / Seller seat they hold (admin click-through)
    for (const g of groups) { if (g.buyer_session_token) seat.set(g.buyer_session_token, g.id); if (g.seller_session_token) seat.set(g.seller_session_token, g.id); }
    const base = all.map((u) => ({ ...publicUser({ ...u, ...(geo.get(u.session_token) || {}) }), groupId: u.is_admin ? null : (seat.get(u.session_token) || null) }));
    // Network address + location are shown to Admin / Super Admin only — never to a Moderator, buyer or seller.
    const withNet = all.map((u, i) => ({ ...base[i], ip: u.last_ip || null, geo: u.geo || null }));
    io.to('finance-admins').emit('user-directory', withNet);
    for (const [sid, m] of activeSockets.entries()) if (m.isAdmin && !hasMinRole(m.adminRole, 'ADMIN')) io.to(sid).emit('user-directory', base);   // moderators: no network details
  }

  async function broadcastGroupsList(viewerSocket) {
    const groups = await store.getAllGroups();
    if (viewerSocket) {
      const m = activeSockets.get(viewerSocket.id);
      if (!m || !hasMinRole(m.adminRole, 'ADMIN')) return; // silently ignore for non-admins/moderators
      const list = await Promise.all(groups.map(g => groupSummary(g, m.sessionToken, true)));
      viewerSocket.emit('all-groups-list', list);
    } else {
      const list = await Promise.all(groups.map(g => groupSummary(g, null, true)));
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
  // ---- Admin toggle: automatic missed-message emails ----
  async function autoEmailOn() { const v = await store.getSetting('auto_missed_email', null); return v === null ? AUTO_EMAIL : String(v) === '1'; }
  socket.on('admin-set-auto-email', async ({ enabled }) => {
    if (!meta() || !meta().isAdmin) return;
    await store.setSetting('auto_missed_email', enabled ? '1' : '0');
    io.to('admins').emit('auto-email-state', { enabled: !!enabled });
    socket.emit('toast-info', { message: enabled ? 'Automatic missed-message emails are ON — anyone who is away gets an email when someone writes.' : 'Automatic missed-message emails are OFF — they now wait for approval.' });
  });

  async function queueOfflineEmail(group, party, payload) {
    const toEmail = party === 'A' ? group.email_a : group.email_b;
    if (!toEmail) return;
    if (await autoEmailOn()) {
      // Auto-send is ON (admin toggle): skip the approval queue and email straight away, in the recipient's language.
      await notifyOfflineMessage(toEmail, { fromName: payload.fromName, text: payload.text, lang: party === 'B' ? group.seller_language : undefined, name: party === 'B' ? (group.seller_full_name || group.custom_name_b) : group.custom_name_a });
      return;
    }
    const rec = await store.createPendingEmail({
      groupId: group.id, party, toEmail,
      fromName: payload.fromName, groupName: payload.groupName, messageText: payload.text
    });
    io.to('admins').emit('pending-email-created', publicPendingEmail(rec));
  }

  // A message posted into the group by the Desk itself (status banners, shared payment notes).
  async function postDeskMessage(groupId, text) {
    const group = await store.getGroup(groupId);
    if (!group) return null;
    const msg = await store.insertMessage({
      id: 'desk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      groupId, senderName: 'Desk Officer', senderRole: 'ADMINISTRATOR', text: escapeHtml(sanitizeText(text, 2000))
    });
    io.to(groupId).emit('message', await publicMessage(msg));
    try { await notifier.notifyNewMessage(io, group, { session_token: 'desk', display_name: 'Desk Officer' }, text, msg.id, { skipAdmins: true }); } catch (e) { /* alerts are best-effort */ }
    await broadcastGroupsList();
    return msg;
  }

  const handlerCtx = { meta, metaHasMinRole, broadcastGroupsList, postDeskMessage, requireSellerOwnGroup };
  // Money movement (incoming funds, withdrawal status control, Funds Desk).
  registerFundsHandlers(io, socket, handlerCtx);
  // Seller account: registration, security, KYC, business upgrade, withdrawals, admin account controls.
  registerAccountHandlers(io, socket, handlerCtx);
  // Live stage tracking controls for incoming funds.
  registerTrackingHandlers(io, socket, handlerCtx);

  // ---------------- JOIN ROOM ----------------
  // ---- One row per seat: drop stray offline user rows that no group seat refers to ----
  async function pruneOrphanUsers() {
    try {
      const [users, groups] = await Promise.all([store.getAllUsers(), store.getAllGroups()]);
      const seats = new Set(); for (const g of groups) { if (g.buyer_session_token) seats.add(g.buyer_session_token); if (g.seller_session_token) seats.add(g.seller_session_token); }
      const live = new Set(Array.from(activeSockets.values()).map((v) => v.sessionToken));
      const hourAgo = Date.now() - 3600 * 1000;
      for (const u of users) {
        if (live.has(u.session_token) || u.is_online) continue;
        if (!u.is_admin && !seats.has(u.session_token)) await store.deleteUser(u.session_token);
        else if (u.is_admin && new Date(u.last_seen || 0).getTime() < hourAgo) await store.deleteUser(u.session_token);
      }
    } catch (e) { console.error('[prune]', e.message); }
  }
  pruneOrphanUsers();

  // ---- Last seen: admin sees everything; parties see each other only if the Desk allows it AND both share ----
  const lsCfg = (g) => { const f = L.flagsOf(g); return { mode: f.lastSeenMode || 'off', A: f.buyerShareLastSeen !== false, B: f.sellerShareLastSeen !== false }; };
  async function seatInfo(token) { if (!token) return { online: false, at: null }; const u = await store.getUser(token); const online = Array.from(activeSockets.values()).some((v) => v.sessionToken === token); return { online, at: u ? u.last_seen : null }; }
  async function broadcastLastSeen(groupId) {
    const g = await store.getGroup(groupId); if (!g) return;
    const cfg = lsCfg(g); const [buyer, seller] = [await seatInfo(g.buyer_session_token), await seatInfo(g.seller_session_token)];
    io.to('admins').emit('last-seen', { groupId, admin: true, mode: cfg.mode, buyerShares: cfg.A, sellerShares: cfg.B, buyer, seller });
    const room = io.sockets.adapter.rooms.get(groupId);
    for (const sid of room ? Array.from(room) : []) {
      const m = activeSockets.get(sid); if (!m || m.isAdmin) continue;
      const me = m.role === 'PARTY A' ? 'A' : 'B', other = me === 'A' ? seller : buyer;
      const visible = cfg.mode !== 'off' && cfg[me] && cfg[me === 'A' ? 'B' : 'A'];
      io.to(sid).emit('last-seen', { groupId, admin: false, mode: cfg.mode, mine: cfg[me], other: visible ? (other.online ? { online: true } : { online: false, recently: cfg.mode === 'recently', at: cfg.mode === 'exact' ? other.at : null }) : { hidden: true } });
    }
  }
  socket.on('admin-set-last-seen-mode', async ({ groupId, mode }) => {
    if (!meta() || !meta().isAdmin || !['off', 'recently', 'exact'].includes(mode)) return;
    const g = await store.getGroup(groupId); if (!g) return;
    await store.updateGroup(groupId, { group_flags: { ...L.flagsOf(g), lastSeenMode: mode } });
    await broadcastLastSeen(groupId);
  });
  socket.on('set-my-last-seen-share', async ({ enabled }) => {
    const m = meta(); if (!m || m.isAdmin) return;
    const g = await store.getGroup(m.groupId); if (!g) return;
    const key = m.role === 'PARTY A' ? 'buyerShareLastSeen' : 'sellerShareLastSeen';
    await store.updateGroup(m.groupId, { group_flags: { ...L.flagsOf(g), [key]: !!enabled } });
    await broadcastLastSeen(m.groupId);
  });

  /** Delete a group and kick everybody out of it. Buyers / sellers see the "link expired" page and their
   *  user records are removed; only admins are moved to another group. */
  async function removeGroupAndEvict(groupId) {
    const g = await store.getGroup(groupId);
    await L.tombstone(groupId);
    const seatTokens = g ? [g.buyer_session_token, g.seller_session_token].filter(Boolean) : [];
    await store.deleteGroup(groupId);
    const remaining = (await store.getAllGroups())[0];
    const room = io.sockets.adapter.rooms.get(groupId);
    for (const sid of room ? Array.from(room) : []) {
      const sock = io.sockets.sockets.get(sid); if (!sock) continue;
      const meta = activeSockets.get(sid);
      if (meta && meta.isAdmin) { if (remaining) sock.emit('force-room-switch', { newGroupId: remaining.id }); }
      else { sock.emit('link-expired', { reason: 'removed' }); activeSockets.delete(sid); sock.leave(groupId); sock.disconnect(true); }
    }
    for (const t of seatTokens) { try { const u = await store.getUser(t); if (u && !u.is_admin) await store.deleteUser(t); } catch (e) {} }
    await pruneOrphanUsers();
    await broadcastDirectory().catch(() => {});
  }

  socket.on('join-room', async ({ groupId, role, adminKey, sessionToken, email, lang }) => {
    try {
      if (!sessionToken || typeof sessionToken !== 'string') return;
      groupId = sanitizeText(groupId || 'default-group', 100);
      const adminRole = resolveAdminRole(adminKey);
      const isAdmin = !!adminRole;

      let group = await L.ensureGroup(groupId);
      if (!group) {
        if (!isAdmin) return socket.emit('link-expired', { reason: 'removed' });
        group = await store.createGroupIfMissing(groupId, `Transaction Group #${(await store.getAllGroups()).length + 1}`);
      }
      if (group && !isAdmin) {
        const st = await L.linkState(groupId, role);
        if (!st.valid) return socket.emit('link-expired', { reason: st.reason });
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

      // One invite seat = one person. If this seat already has an identity, reuse it instead of minting a new user
      // row each time the link is opened (fixes the pile of duplicate "Buyer / Seller" entries).
      if (!isAdmin) {
        const seatTok = safeRole === 'PARTY A' ? group.buyer_session_token : group.seller_session_token;
        if (seatTok && seatTok !== sessionToken) sessionToken = seatTok;
      }

      // A reconnect within the grace window (brief network blip / tab
      // backgrounding) just clears the pending "went offline" timer below —
      // it does not need any special handling here any more since presence
      // is no longer logged into the chat as a message.
      if (pendingDisconnects.has(sessionToken)) {
        clearTimeout(pendingDisconnects.get(sessionToken));
        pendingDisconnects.delete(sessionToken);
      }

      // A seller whose current network address was blocked by the Desk cannot enter their seat.
      if (!isAdmin && safeRole === 'PARTY B' && group.seller_registered && isIpBlocked(group, ipOfSocket(socket))) {
        return socket.emit('ip-blocked', { message: 'Access from this network location has been disabled for this account. Please contact ' + COMPLAINTS_EMAIL + '.' });
      }

      const user = await store.upsertUser({
        sessionToken,
        displayName,
        role: isAdmin ? 'ADMINISTRATOR' : safeRole,
        isAdmin,
        adminRole,
        email: isValidEmailSafe(email) ? email : undefined,
        language: (typeof lang === 'string' && /^[a-zA-Z-]{2,7}$/.test(lang)) ? lang : undefined,
        isOnline: true
      });

      // Remember where this person connected from (admin-only data); the lookup runs in the background.
      { const ip = ipOfSocket(socket);
        store.setUserNet(sessionToken, ip, null).catch(() => {});
        geoip.lookup(ip).then(async (g) => { if (g && g.known) { await store.setUserNet(sessionToken, ip, g); broadcastDirectory().catch(() => {}); } else broadcastDirectory().catch(() => {}); }).catch(() => {}); }

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
        pruneOrphanUsers().catch(() => {});
        // The seller gets a private room for their Transaction Account so
        // live money updates can never reach the Buyer in the same chat.
        if (safeRole === 'PARTY B') {
          socket.join(`seller:${groupId}`);
          // Registered seller entering from an address the account has not used before -> security email.
          if (group.seller_registered) sendLoginAlert(group, ipOfSocket(socket), { ua: socket.handshake.headers['user-agent'], source: 'link', baseUrl: `${socket.handshake.headers['x-forwarded-proto'] || 'https'}://${socket.handshake.headers.host}` }).catch(() => {});
        }
      }

      let [messages, pinnedMessages, unreadCounts, announcements, tasks] = await Promise.all([
        store.getMessagesForGroup(groupId),
        store.getPinnedMessages(groupId),
        store.getUnreadCounts(sessionToken),
        store.getAnnouncements(groupId),
        store.getTasks(groupId)
      ]);

      await store.clearUnread(sessionToken, groupId);
      notifier.onGroupRead(io, sessionToken, groupId, user).catch(() => {});

      const roomLocked = !isAdmin && !!L.flagsOf(group).roomLocked;
      if (roomLocked) { messages = []; pinnedMessages = []; announcements = []; tasks = []; }
      socket.emit('init-state', {
        locked: roomLocked,
        group: await groupSummary(group, sessionToken, isAdmin, isAdmin ? null : safeRole),
        isAdminConfirmed: isAdmin,
        adminRole,
        role: isAdmin ? null : safeRole,
        socketId: socket.id,
        sessionToken,
        uid: uidOf(sessionToken),
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
        socket.emit('auto-email-state', { enabled: await autoEmailOn() });
      } else if (safeRole === 'PARTY B') {
        if (group.seller_registered) { await recordSellerIp(groupId, ipOfSocket(socket), 'login'); }
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
      if (!m.isAdmin && L.flagsOf(group).roomLocked) return socket.emit('error-msg', 'This transaction room is locked. Please contact support to have it unlocked.');
      if (!m.isAdmin && m.role === 'PARTY B' && group.seller_registered && (!group.kyc_status || group.kyc_status === 'none' || group.kyc_status === 'not_submitted')) {
        return socket.emit('error-msg', 'Please complete your identity verification (KYC) first — it unlocks your dashboard and the transaction room.');
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

      // Everyone except the sender is alerted immediately: the group's Buyer and
      // Seller plus every admin/moderator. Online people get a live alert (the
      // browser chimes 3x when they aren't looking at the chat); offline people get
      // a Web Push. Unread counts and the 60-minute reminder clock start here too.
      await notifier.notifyNewMessage(io, group, user, cleanText || (fileName ? `Shared file: ${fileName}` : 'Shared a file'), msg.id);
      const onlineTokens = new Set(Array.from(activeSockets.values()).map(v => v.sessionToken));
      const senderParty = group.buyer_session_token === user.session_token ? 'A'
        : group.seller_session_token === user.session_token ? 'B' : null;
      const notifyPayload = { fromName: user.display_name, groupName: group.name, text: cleanText.slice(0, 200) };
      for (const party of ['A', 'B']) {
        if (party === senderParty) continue;
        const token = party === 'A' ? group.buyer_session_token : group.seller_session_token;
        const isOnline = token ? onlineTokens.has(token) : false;
        // An offline party (or one who never joined) can still be emailed if an address is on file.
        if (!isOnline) await queueOfflineEmail(group, party, notifyPayload);
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
    const reader = await store.getUser(m.sessionToken);
    notifier.onGroupRead(io, m.sessionToken, groupId, reader).catch(() => {});
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
    await removeGroupAndEvict(groupId);
    await broadcastGroupsList();
  });

  socket.on('bulk-delete-groups', async ({ groupIds }) => {
    if (!metaHasMinRole('ADMIN') || !Array.isArray(groupIds)) return;
    for (const gid of groupIds) {
      const all = await store.getAllGroups();
      if (all.length > 1) await removeGroupAndEvict(gid);
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
    if (party === 'B') {
      const g0 = await store.getGroup(groupId);
      if (g0 && g0.seller_email_locked) return socket.emit('error-msg', 'The seller\'s email is permanently tied to their registered account and cannot be changed.');
    }
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
    if (party === 'B' && group.seller_email_locked) return socket.emit('error-msg', 'Your email is permanently tied to your account and cannot be changed.');
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

  // Registration, email verification, terms acceptance, account ID, KYC submission, business upgrade,
  // withdrawal requests and disable/enable now live in accountHandlers.js.

  socket.on('admin-get-kyc-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const groups = await store.getAllGroups();
    const queue = groups.filter(g => g.kyc_status === 'pending').map((g) => publicSellerAccount(g, { forAdmin: true }));
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
    io.to('finance-admins').emit('kyc-resolved', publicSellerAccount(updated, { forAdmin: true }));
    if (updated.email_b) await notifyKycStatus(updated.email_b, { groupName: updated.name, status: decision, reason: updated.kyc_rejection_reason, lang: updated.seller_language });
  });

  // ---- Deposits ("Record a deposit" — a notification, never proof of funds) ----
  socket.on('get-deposit-wallets', async () => {
    const m = meta(); if (!m) return;
    const all = await W.getWallets(store);
    socket.emit('deposit-wallets', { wallets: m.isAdmin ? all : all.filter((w) => w.enabled).map(({ id, asset, network, label, sub, address }) => ({ id, asset, network, label, sub, address })), admin: !!m.isAdmin });
  });
  socket.on('admin-set-deposit-wallets', async ({ wallets }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const r = await W.setWallets(store, wallets);
    if (!r.ok) return socket.emit('error-msg', r.error);
    io.to('admins').emit('deposit-wallets', { wallets: r.wallets, admin: true });
    socket.emit('toast-info', { message: 'Deposit wallets saved. Sellers see the new addresses immediately.' });
  });

  socket.on('notify-deposit', async ({ groupId, asset, network, amount, txHash }) => {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return;
    if (!group.seller_registered) return socket.emit('error-msg', 'Please create your Transaction Account first.');
    if (group.seller_disabled) return socket.emit('error-msg', 'Your account is disabled. Contact ' + COMPLAINTS_EMAIL + '.');
    if (isIpBlocked(group, ipOfSocket(socket))) return socket.emit('error-msg', 'Access from this network location has been disabled for your account.');
    if (!accountActionLimiter.allow(meta().sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 999999999.99) return socket.emit('error-msg', 'Please enter a valid amount.');
    // Deposits are crypto-only — bank deposit was intentionally removed.
    if (!CRYPTO_ASSETS.has(asset)) return socket.emit('error-msg', 'Please choose a valid asset.');
    const wallet = (await W.getWallets(store)).find((w) => w.enabled && w.asset === asset && w.network === network);
    if (!wallet) return socket.emit('error-msg', 'That deposit option is not available. Please choose one of the listed wallets.');
    const hash = String(txHash || '').trim();
    if (hash && !/^[A-Za-z0-9]{16,100}$/.test(hash)) return socket.emit('error-msg', 'That transaction ID does not look valid. Copy it exactly from your wallet, or leave it empty.');

    const depAmt = F.round2(amt);
    const dep = await store.createDeposit({ groupId, method: 'crypto', asset, network: network || null, amount: depAmt, referenceCode: hash || null });
    // Recorded as "awaiting confirmation" (held in vault). Neither the available balance NOR Total Deposited moves
    // until the Desk confirms the funds arrived on-chain — only then is it credited.
    await store.adjustBalances(groupId, { held: depAmt });
    if (group.email_b) require('./email').notifyDepositRecorded(group.email_b, { amountText: `${depAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${asset}`, network: wallet.sub, address: wallet.address, txHash: hash, ref: publicDeposit(dep).ref, accountId: group.seller_account_id, name: group.seller_full_name, lang: group.seller_language }).catch(() => {});
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
    // Verified: held -> available (and Total Deposited goes up). Rejected: the hold is simply released.
    const moved = await store.adjustBalances(dep.group_id, decision === 'verified' ? { held: -amt, available: amt, total: amt } : { held: -amt });
    if (!moved) return socket.emit('error-msg', 'The seller\'s held balance does not cover this deposit — please check the ledger.');
    const resolved = await store.resolveDeposit(depositId, { status: decision, verifiedBy: m.sessionToken, rejectionReason: decision === 'rejected' ? (sanitizeText(reason, 500) || 'Not specified') : null });
    // Crypto prior-deposit requirement: once verified crypto deposits cover what this seller was asked for, unlock crypto withdrawals for good.
    if (decision === 'verified' && dep.method === 'crypto' && !group.crypto_deposit_verified && group.crypto_deposit_required_usd) {
      const { verifiedCryptoDepositsUsd } = require('./accountHandlers');
      const haveUsd = await verifiedCryptoDepositsUsd(await store.getGroup(dep.group_id));
      if (haveUsd + 1e-9 >= Number(group.crypto_deposit_required_usd)) await store.updateGroup(dep.group_id, { crypto_deposit_verified: true });
    }
    const updatedGroup = await store.getGroup(dep.group_id);
    await pushSellerState(io, dep.group_id, {
      kind: 'deposit',
      title: decision === 'verified' ? 'Deposit confirmed' : 'Deposit could not be confirmed',
      body: decision === 'verified' ? `${amt.toFixed(2)} ${updatedGroup.seller_currency || ''} is now available.`.trim() : (resolved.rejection_reason || 'Not specified')
    });
    io.to('finance-admins').emit('deposit-resolved', publicDeposit(resolved));
    if (updatedGroup.email_b) await notifyDepositStatus(updatedGroup.email_b, { groupName: updatedGroup.name, amount: `${amt} ${updatedGroup.seller_currency || ''}`.trim(), status: decision, reason: resolved.rejection_reason, lang: updatedGroup.seller_language });
    await broadcastGroupsList();
  });

  // ---- Withdrawals ----
  // The admin side of the state machine (pending -> held in vault -> processing
  // -> completed, or declined) lives in fundsHandlers.js. The seller's request is here.

  socket.on('admin-get-withdrawals-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const pending = await store.getPendingWithdrawals();
    socket.emit('withdrawals-queue-list', pending.map((w) => publicWithdrawal(w, { forAdmin: true })));
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
  // ---- Receiving account details — only an identity-verified seller, only their own group, only their own currency ----
  const allowSampleBank = () => String(process.env.ALLOW_SAMPLE_BANK_DETAILS || '').toLowerCase() === 'true';
  const pushReceiving = async (group) => { try { io.to(`seller:${group.id}`).emit('receiving-details', await BD.getForGroup(store, group, { allowSample: allowSampleBank() })); } catch (e) { /* seller refetches on open */ } };
  socket.on('get-receiving-details', async ({ groupId }) => {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return;
    try { socket.emit('receiving-details', await BD.getForGroup(store, group, { allowSample: allowSampleBank() })); } catch (e) { socket.emit('receiving-details', { approved: false, status: group.kyc_status || 'not_submitted', error: true }); }
  });
  // Desk: the global receiving account per currency (Controls -> Receiving accounts). Real account details only.
  socket.on('get-bank-profiles', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    socket.emit('bank-profiles', { profiles: await BD.getProfiles(store), schema: BD.SCHEMA, labels: BD.LABEL, allowSample: allowSampleBank() });
  });
  socket.on('admin-set-bank-profiles', async ({ profiles }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const r = await BD.setProfiles(store, profiles || {});
    if (!r.ok) return socket.emit('error-msg', r.error);
    socket.emit('bank-profiles', { profiles: r.profiles, schema: BD.SCHEMA, labels: BD.LABEL, allowSample: allowSampleBank() });
    socket.emit('toast-info', { message: 'Receiving accounts saved. Verified sellers see them straight away, each with their own payment reference.' });
    for (const g of await store.getAllGroups()) if (g.kyc_status === 'verified') await pushReceiving(g);
  });
  // Desk: one seller's own account details (when the bank issues one account per customer)
  socket.on('admin-get-seller-receiving', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const group = await store.getGroup(groupId); if (!group) return;
    socket.emit('admin-seller-receiving', await BD.adminView(store, group, { allowSample: allowSampleBank() }));
  });
  socket.on('admin-set-seller-receiving', async ({ groupId, fields }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const group = await store.getGroup(groupId); if (!group) return;
    const r = await BD.setOverride(store, group, fields || {});
    if (!r.ok) return socket.emit('error-msg', r.error);
    socket.emit('admin-seller-receiving', await BD.adminView(store, group, { allowSample: allowSampleBank() }));
    socket.emit('toast-info', { message: 'This seller\u2019s account details were saved and are now visible to them.' });
    await pushReceiving(group);
  });
  socket.on('admin-clear-seller-receiving', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const group = await store.getGroup(groupId); if (!group) return;
    await BD.clearOverride(store, groupId);
    socket.emit('admin-seller-receiving', await BD.adminView(store, group, { allowSample: allowSampleBank() }));
    socket.emit('toast-info', { message: 'Seller-specific details removed. They now see the Desk\u2019s global account for their currency.' });
    await pushReceiving(group);
  });

  // ---- Support: a seller writes to Support from inside the app; it lands in the Support inbox (email) and the Desk dashboard ----
  const SUPPORT_TOPICS = ['Question', 'Complaint', 'Payment issue', 'Account or login', 'Other'];
  const loadTickets = async () => { try { const raw = await store.getSetting('support_requests', null); const l = raw ? JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) : []; return Array.isArray(l) ? l : []; } catch (e) { return []; } };
  const saveTickets = (l) => store.setSetting('support_requests', JSON.stringify(l.slice(0, 500)));
  socket.on('submit-support-request', async ({ groupId, name, email, topic, message }) => {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return socket.emit('support-request-result', { ok: false, error: 'Please sign in to your account and try again.' });
    const em = sanitizeText(email, 160).toLowerCase(), msg = sanitizeText(message, 2000), nm = sanitizeText(name, 100), tp = SUPPORT_TOPICS.includes(topic) ? topic : 'Question';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return socket.emit('support-request-result', { ok: false, field: 'email', error: 'Please enter a valid email address so we can reply to you.' });
    if (msg.length < 10) return socket.emit('support-request-result', { ok: false, field: 'message', error: 'Please describe your question or issue in a little more detail (at least 10 characters).' });
    global.__supportRate = global.__supportRate || new Map();
    const now = Date.now(), hist = (global.__supportRate.get(group.id) || []).filter((t) => now - t < 3600e3);
    if (hist.length >= 5) return socket.emit('support-request-result', { ok: false, error: 'You have sent several requests in the last hour. Our team has them and will reply to you by email shortly.' });
    hist.push(now); global.__supportRate.set(group.id, hist);
    const ref = 'SR-' + require('crypto').randomBytes(4).toString('hex').toUpperCase();
    const ip = ipOfSocket(socket);
    const ticket = { ref, topic: tp, name: nm || group.seller_full_name || '', email: em, message: msg, groupId: group.id, accountId: group.seller_account_id || null, country: group.seller_country || null, createdAt: new Date().toISOString(), resolved: false };
    const list = await loadTickets(); list.unshift(ticket); await saveTickets(list);
    const E = require('./email');
    const sent = await E.notifySupportRequest({ ...ticket, ip }).catch((e) => ({ ok: false, error: e.message }));
    E.notifySupportAck(em, { ref, topic: tp, name: ticket.name, lang: group.seller_language }).catch(() => {});
    io.to('admins').emit('support-request-new', ticket);
    socket.emit('support-request-result', { ok: true, ref, emailed: !!(sent && sent.ok) });
  });
  socket.on('get-support-requests', async () => { if (!metaHasMinRole('ADMIN')) return; socket.emit('support-requests', { list: await loadTickets() }); });
  socket.on('admin-resolve-support-request', async ({ ref, resolved }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const list = await loadTickets(); const t = list.find((x) => x.ref === ref); if (!t) return;
    t.resolved = resolved !== false; await saveTickets(list);
    io.to('admins').emit('support-requests', { list });
  });

  // ---- Seller's chosen style (wallpaper) — saved per seller so it follows them to any device ----
  socket.on('get-my-style', async ({ groupId }) => {
    const group = await requireSellerOwnGroup(groupId); if (!group) return;
    const v = await store.getSetting(`style:${group.id}`, null);
    socket.emit('my-style', { style: /^[1-6]$/.test(String(v)) ? String(v) : '1' });
  });
  socket.on('set-my-style', async ({ groupId, style }) => {
    const group = await requireSellerOwnGroup(groupId); if (!group) return;
    if (!/^[1-6]$/.test(String(style))) return;
    await store.setSetting(`style:${group.id}`, String(style));
    socket.emit('my-style', { style: String(style), saved: true });
  });


  // ====================================================================
  // AIRWX virtual card (v3.11). Not eligible by default; the Desk switches it on per seller.
  // ====================================================================
  const cardBusy = new Set();                                   // one money-moving card action per seller at a time
  const cardLimiter = new RateLimiter({ windowMs: 60000, max: Number(process.env.CARD_RATE_MAX) || 20 });   // apply / pay
  const revealLimiter = new RateLimiter({ windowMs: 60000, max: Number(process.env.CARD_REVEAL_MAX) || 10 }); // reveal
  const cardView = async (group) => CARD.sellerView(store, group, { convert: F.convertCurrency });
  const pushCard = async (groupId) => { const g = await store.getGroup(groupId); if (g) io.to(`seller:${groupId}`).emit('my-card', await cardView(g)); io.to('admins').emit('card-queue-dirty', { groupId }); };
  const cardMail = async (g, kind, extra) => {
    try {
      if (!g.email_b) return;
      const rec = await CARD.getCard(store, g.id); const fee = CARD.feeFor(F.convertCurrency, g.seller_currency || 'USD');
      require('./email').notifyCardStatus(g.email_b, { kind, ref: rec && rec.fee ? rec.fee.ref : null, amountText: ['applied', 'fee_paid'].includes(kind) ? `${fee.ledger.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${fee.currency} (${fee.usd} USD)` : null, last4: rec ? rec.last4 : null, lang: g.seller_language, name: g.seller_full_name, accountId: g.seller_account_id, ...(extra || {}) }).catch(() => {});
    } catch (e) { /* email is best-effort */ }
  };
  // Seller: what the Card page shows. A seller who is not eligible receives {eligible:false} and nothing else.
  socket.on('get-my-card', async ({ groupId }) => {
    const group = await requireSellerOwnGroup(groupId); if (!group) return;
    try { socket.emit('my-card', await cardView(group)); } catch (e) { socket.emit('my-card', { eligible: false }); }
  });
  const cardErr = (error) => socket.emit('card-result', { ok: false, error });
  // Seller: apply (and optionally pay the issuing fee in the same step).
  socket.on('apply-virtual-card', async ({ groupId, payNow }) => {
    const group = await requireSellerOwnGroup(groupId); if (!group) return;
    if (!cardLimiter.allow(meta().sessionToken)) return cardErr('Too many attempts. Please wait a moment and try again.');
    if (!(await CARD.isEligible(store, group.id))) return socket.emit('my-card', { eligible: false });
    if (group.kyc_status !== 'verified') return cardErr('Please complete identity verification before applying for a card.');
    if (group.seller_disabled) return cardErr('Your account is currently disabled. Please contact Support.');
    const cur = await CARD.getCard(store, group.id);
    if (cur && ['awaiting_fee', 'processing', 'issued', 'frozen'].includes(cur.status)) return socket.emit('my-card', await cardView(group));
    await CARD.saveCard(store, group.id, { status: 'awaiting_fee', appliedAt: new Date().toISOString(), holder: null, fee: { usd: CARD.FEE_USD } });
    await cardMail(group, 'applied');
    await pushCard(group.id);
    const paid = payNow ? await payFee(group) : null;
    if (!payNow || paid) socket.emit('card-result', { ok: true, step: paid ? 'paid' : 'applied' });
  });
  async function payFee(group) {            // resolves true only when THIS call took the fee
    if (cardBusy.has(group.id)) return false;
    cardBusy.add(group.id);
    try {
      const g = await store.getGroup(group.id); const rec = await CARD.getCard(store, g.id);
      if (!rec || rec.status !== 'awaiting_fee') { socket.emit('my-card', await cardView(g)); return false; }
      const ccy = g.seller_currency || 'USD'; const fee = CARD.feeFor(F.convertCurrency, ccy);
      // available -> fee. adjustBalances refuses to overdraw, so two quick taps can never charge twice or go negative.
      const moved = await store.adjustBalances(g.id, { available: -fee.ledger });
      if (!moved) { cardErr(`Your available balance is not enough to pay the ${CARD.FEE_USD} USD card fee. Add funds, then pay the fee.`); await pushCard(g.id); return false; }
      rec.status = 'processing'; rec.fee = { usd: CARD.FEE_USD, ledger: fee.ledger, currency: ccy, paidAt: new Date().toISOString(), ref: 'CF-' + require('crypto').randomBytes(4).toString('hex').toUpperCase() };
      await CARD.saveCard(store, g.id, rec);
      await cardMail(g, 'fee_paid');
      socket.emit('card-result', { ok: true, step: 'paid', ref: rec.fee.ref });
      await require('./fundsHandlers').pushSellerState(io, g.id, null).catch(() => {});
      await pushCard(g.id);
      return true;
    } finally { cardBusy.delete(group.id); }
  }
  socket.on('pay-card-fee', async ({ groupId }) => {
    const group = await requireSellerOwnGroup(groupId); if (!group) return;
    if (!cardLimiter.allow(meta().sessionToken)) return cardErr('Too many attempts. Please wait a moment and try again.');
    if (!(await CARD.isEligible(store, group.id))) return socket.emit('my-card', { eligible: false });
    await payFee(group);
  });
  // Seller: reveal the full card number, expiry and CVV. Owner only, issued and not frozen; every reveal is counted.
  socket.on('reveal-card', async ({ groupId }) => {
    const group = await requireSellerOwnGroup(groupId); if (!group) return;
    if (!revealLimiter.allow(meta().sessionToken)) return socket.emit('card-result', { ok: false, error: 'Please wait a moment before showing your card details again.' });
    const rec = await CARD.getCard(store, group.id);
    if (!(await CARD.isEligible(store, group.id)) || !rec || rec.status !== 'issued' || !rec.enc) return;
    const pan = await CARD.vault.decrypt(rec.enc.pan), cvv = await CARD.vault.decrypt(rec.enc.cvv);
    if (!pan || !cvv) return socket.emit('card-result', { ok: false, error: 'We could not open the card details. Please contact Support.' });
    rec.reveals = (rec.reveals || 0) + 1; rec.lastRevealAt = new Date().toISOString(); await CARD.saveCard(store, group.id, rec);
    socket.emit('card-reveal', { pan, expMonth: rec.expMonth, expYear: rec.expYear, cvv, holder: rec.holder });
  });
  // Desk: eligibility switch, per seller.
  socket.on('admin-get-card', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const g = await store.getGroup(String(groupId || '')); if (!g) return;
    socket.emit('admin-card', await CARD.adminView(store, g, { convert: F.convertCurrency }));
  });
  socket.on('admin-set-card-eligible', async ({ groupId, eligible }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const g = await store.getGroup(String(groupId || '')); if (!g) return;
    if (!g.seller_registered) return socket.emit('error-msg', 'This seller has not created their account yet.');
    await CARD.setEligible(store, g.id, eligible === true);
    socket.emit('admin-card', await CARD.adminView(store, g, { convert: F.convertCurrency }));
    socket.emit('toast-info', { message: eligible === true ? 'Virtual card switched ON for this seller. They can now apply.' : 'Virtual card switched OFF for this seller.' });
    await pushCard(g.id);
  });
  // Desk: queue of paid applications waiting to be generated (plus unpaid applications, for visibility).
  socket.on('admin-get-card-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const groups = await store.getAllGroups(); const list = [];
    for (const g of groups) {
      if (!g.seller_registered) continue;
      const rec = await CARD.getCard(store, g.id);
      if (rec && ['awaiting_fee', 'processing', 'frozen'].includes(rec.status)) list.push(await CARD.adminView(store, g, { convert: F.convertCurrency }));
    }
    const elig = []; for (const g of groups) { if (g.seller_registered && await CARD.isEligible(store, g.id)) elig.push({ groupId: g.id, sellerName: (g.seller_full_name || g.name || '').replace(/&amp;/g, '&'), accountId: g.seller_account_id || null }); }
    list.sort((a, b) => String(a.appliedAt || '').localeCompare(String(b.appliedAt || '')));
    socket.emit('card-queue', { list, eligible: elig, fee: CARD.FEE_USD });
  });
  // Desk: enter the card the issuer generated. Validated, encrypted, and the seller is told.
  socket.on('admin-issue-card', async ({ groupId, pan, expMonth, expYear, cvv, holder }) => {
    if (!metaHasMinRole('ADMIN')) return;
    if (!actionLimiter.allow(meta().sessionToken)) return;
    const g = await store.getGroup(String(groupId || '')); if (!g) return;
    const rec = await CARD.getCard(store, g.id);
    if (!rec || rec.status !== 'processing') return socket.emit('error-msg', 'There is no paid application waiting for this seller.');
    const v = CARD.validateIssued({ pan, expMonth, expYear, cvv, holder }, g.seller_full_name);
    if (!v.ok) return socket.emit('error-msg', v.error);
    const h = CARD.panHash(v.v.pan); const used = await store.getSetting(`card_pan:${h}`, '');
    if (used && used !== g.id) return socket.emit('error-msg', 'That card number is already assigned to another seller.');
    await store.setSetting(`card_pan:${h}`, g.id);
    Object.assign(rec, { status: 'issued', issuedAt: new Date().toISOString(), issuedBy: meta().sessionToken, last4: v.v.pan.slice(-4), expMonth: v.v.expMonth, expYear: v.v.expYear, holder: v.v.holder, enc: { pan: await CARD.vault.encrypt(v.v.pan), cvv: await CARD.vault.encrypt(v.v.cvv) } });
    await CARD.saveCard(store, g.id, rec);
    await cardMail(g, 'issued');
    io.to(`seller:${g.id}`).emit('seller-notice', { kind: 'card', title: 'Your AIRWX card is ready', body: 'Open the Card page to see it.' });
    socket.emit('toast-info', { message: `AIRWX card issued to ${g.seller_full_name || 'the seller'} (ending ${rec.last4}).` });
    socket.emit('admin-card', await CARD.adminView(store, g, { convert: F.convertCurrency }));
    await pushCard(g.id);
  });
  // Desk: decline. A paid fee is returned to the seller's available balance in full.
  socket.on('admin-decline-card', async ({ groupId, reason }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const g = await store.getGroup(String(groupId || '')); if (!g) return;
    const rec = await CARD.getCard(store, g.id);
    if (!rec || !['awaiting_fee', 'processing'].includes(rec.status)) return socket.emit('error-msg', 'There is no open application for this seller.');
    if (rec.status === 'processing' && rec.fee && rec.fee.ledger) await store.adjustBalances(g.id, { available: rec.fee.ledger });
    rec.status = 'declined'; rec.declinedReason = sanitizeText(reason, 300) || null; rec.declinedAt = new Date().toISOString();
    await CARD.saveCard(store, g.id, rec);
    await cardMail(g, 'declined', { reason: rec.declinedReason });
    await require('./fundsHandlers').pushSellerState(io, g.id, null).catch(() => {});
    socket.emit('admin-card', await CARD.adminView(store, g, { convert: F.convertCurrency }));
    await pushCard(g.id);
  });
  socket.on('admin-freeze-card', async ({ groupId, frozen }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const g = await store.getGroup(String(groupId || '')); if (!g) return;
    const rec = await CARD.getCard(store, g.id);
    if (!rec || !['issued', 'frozen'].includes(rec.status)) return;
    rec.status = frozen === true ? 'frozen' : 'issued'; await CARD.saveCard(store, g.id, rec);
    if (frozen === true) await cardMail(g, 'frozen');
    socket.emit('admin-card', await CARD.adminView(store, g, { convert: F.convertCurrency }));
    await pushCard(g.id);
  });

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
  socket.on('admin-kick-user', async ({ targetUid }) => {
    if (!metaHasMinRole('ADMIN') || !targetUid) return;
    const targetSessionToken = await tokenForUid(store, targetUid);
    if (!targetSessionToken) return;
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

  socket.on('admin-delete-user', async ({ targetUid }) => {
    if (!metaHasMinRole('ADMIN') || !targetUid) return;
    const targetSessionToken = await tokenForUid(store, targetUid);
    if (!targetSessionToken) return;
    // If this person holds the Buyer or Seller seat of a group, that party's invite link is expired for good.
    for (const g of await store.getAllGroups()) {
      if (g.buyer_session_token === targetSessionToken) await L.setRevoked(g.id, 'A', true);
      if (g.seller_session_token === targetSessionToken) await L.setRevoked(g.id, 'B', true);
    }
    for (const [sockId, v] of activeSockets.entries()) {
      if (v.sessionToken === targetSessionToken) {
        const targetSocket = io.sockets.sockets.get(sockId);
        if (targetSocket) { targetSocket.emit('link-expired', { reason: 'revoked' }); targetSocket.disconnect(true); }
      }
    }
    await store.deleteUser(targetSessionToken);
    await broadcastGroupsList();
    await broadcastDirectory();
    await broadcastStats();
  });

  // Re-activate a Buyer/Seller link that expired because their user was deleted.
  socket.on('admin-set-link-revoked', async ({ groupId, party, revoked }) => {
    if (!metaHasMinRole('ADMIN') || !['A', 'B'].includes(party)) return;
    await L.setRevoked(groupId, party, !!revoked);
    await broadcastGroupsList();
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
  socket.on('admin-initiate-dm', async ({ targetUid, initialMessage }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const targetSessionToken = await tokenForUid(store, targetUid);
    const target = targetSessionToken && await store.getUser(targetSessionToken);
    if (!target) return;
    const m = meta();

    const dmRoomId = `dm-${[uidOf(m.sessionToken), uidOf(targetSessionToken)].sort().join('-')}`;
    socket.join(dmRoomId);
    for (const [sockId, v] of activeSockets.entries()) {
      if (v.sessionToken === targetSessionToken) io.sockets.sockets.get(sockId)?.join(dmRoomId);
    }

    const clean = escapeHtml(sanitizeText(initialMessage, 2000));
    const msgPayload = {
      dmRoomId,
      sender: 'Desk Officer (Admin)',
      senderId: uidOf(m.sessionToken),
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
    // Only the two people actually in this private channel may post to it.
    if (typeof dmRoomId !== 'string' || !dmRoomId.startsWith('dm-') || !socket.rooms.has(dmRoomId)) return;
    const user = await store.getUser(m.sessionToken);
    const clean = escapeHtml(sanitizeText(text, 2000));
    if (!clean) return;
    io.to(dmRoomId).emit('dm-message', {
      dmRoomId,
      sender: user ? user.display_name : 'User',
      senderId: uidOf(m.sessionToken),
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
