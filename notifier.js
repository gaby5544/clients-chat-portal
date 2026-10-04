// Message notification engine.
//
//  * EVERY new message notifies the people who did not send it: the group's
//    Buyer, its Seller, and every Admin/Moderator — instantly, whether they are
//    online (live alert, which the browser turns into a 3x sound) or offline
//    (Web Push to their devices).
//  * Anyone who still has the message unread gets a reminder every 60 minutes
//    (REMINDER_MINUTES) until they read it.
//  * When somebody reads a group, everyone else in it is told who read it, and
//    — because an admin has now seen it — the other admins' reminders for that
//    group stop and they are told it has been handled.
//  * Alerts are translated into each recipient's own language.

const { store } = require('./db');
const { sendPushToUser } = require('./webpush');
const { translateText } = require('./translator');
const { notifyMessageReminder } = require('./email');

const REMIND_EVERY_MS = Math.max(1, Number(process.env.REMINDER_MINUTES) || 60) * 60 * 1000;
const MAX_REMINDERS = 100;
const ADMIN_ACTIVE_WINDOW_MS = 30 * 24 * 3600 * 1000;
const AUTO_EMAIL = String(process.env.AUTO_SEND_OFFLINE_EMAILS || '').toLowerCase() === 'true';

const reminders = new Map();      // `${token}|${groupId}` -> { lastAt, sent }
const readDebounce = new Map();   // `${groupId}|${readerToken}` -> ts
const k = (token, groupId) => `${token}|${groupId}`;

function liveSockets(io, token) {
  const out = [];
  const active = io._activeSockets || new Map();
  for (const [sockId, v] of active) {
    if (v.sessionToken !== token) continue;
    const s = io.sockets.sockets.get(sockId);
    if (s) out.push(s);
  }
  return out;
}

async function langFor(token, group) {
  try {
    if (group && group.seller_session_token === token && group.seller_language) return group.seller_language;
    const u = await store.getUser(token);
    return (u && u.language) || 'en';
  } catch (e) { return 'en'; }
}

async function localize(text, lang) {
  if (!text || !lang || lang === 'en') return text;
  const r = await translateText(text, lang);
  return r.ok ? r.text : text;
}

async function adminTokens() {
  const users = await store.getAllUsers();
  const cutoff = Date.now() - ADMIN_ACTIVE_WINDOW_MS;
  return users.filter((u) => u.is_admin && u.admin_role && new Date(u.last_seen || 0).getTime() >= cutoff).map((u) => u.session_token);
}

/**
 * Deliver one alert to one person. Live sockets get an 'alert' event (the
 * client decides whether to chime based on whether they are looking at it);
 * if they have no live socket at all, it goes out as a Web Push instead.
 */
async function deliver(io, token, group, { title, body, kind = 'message', reminder = false, messageId = null }) {
  const lang = await langFor(token, group);
  const [t, b] = await Promise.all([localize(title, lang), localize(body, lang)]);
  const socks = liveSockets(io, token);
  const payload = { kind, reminder, groupId: group.id, groupName: group.name, title: t, body: b, messageId, at: new Date().toISOString() };
  socks.forEach((s) => s.emit('alert', payload));
  if (!socks.length) {
    try { await store.addNotification(token, kind, { title: t, body: b, groupId: group.id }); } catch (e) { /* best effort */ }
    try { await sendPushToUser(token, { title: t, body: b, url: '/?groupId=' + encodeURIComponent(group.id), tag: 'qsd-' + group.id, requireInteraction: true }); } catch (e) { /* best effort */ }
  }
  return socks.length > 0;
}

/** A message was posted: alert everyone else, bump their unread count, start their reminder clock. */
async function notifyNewMessage(io, group, sender, text, messageId, { skipAdmins = false } = {}) {
  const recipients = new Set();
  if (group.buyer_session_token) recipients.add(group.buyer_session_token);
  if (group.seller_session_token) recipients.add(group.seller_session_token);
  if (!skipAdmins) for (const t of await adminTokens()) recipients.add(t);
  recipients.delete(sender.session_token);

  const preview = String(text || '').replace(/<[^>]*>/g, '').slice(0, 200) || 'Shared a file';
  const title = `New message from ${sender.display_name}`;
  for (const token of recipients) {
    try {
      await store.incrementUnread(token, group.id);
      readDebounce.delete(group.id + '|' + token);   // a NEW message means their next read is worth announcing
      if (!reminders.has(k(token, group.id))) reminders.set(k(token, group.id), { lastAt: Date.now(), sent: 0 });
      await deliver(io, token, group, { title: `${title} · ${group.name}`, body: preview, messageId });
    } catch (err) { console.error('[notifier] deliver failed:', err.message); }
  }
}

/** `readerToken` opened/read the group. */
async function onGroupRead(io, readerToken, groupId, reader) {
  reminders.delete(k(readerToken, groupId));
  const last = readDebounce.get(groupId + '|' + readerToken) || 0;
  if (Date.now() - last < 8000) return;
  readDebounce.set(groupId + '|' + readerToken, Date.now());
  if (readDebounce.size > 2000) readDebounce.clear();
  if (!reader) return;
  const isAdmin = !!reader.is_admin;
  // Tell everyone in the group EXCEPT the reader — and never include the reader's session token (it is a credential).
  for (const [sockId, v] of (io._activeSockets || new Map())) {
    if (v.groupId !== groupId || v.sessionToken === readerToken) continue;
    const s = io.sockets.sockets.get(sockId);
    if (s) s.emit('message-read-by', { groupId, readerName: reader.display_name, readerRole: reader.role, isAdmin });
  }
  if (isAdmin) {
    // Another admin now has eyes on this conversation — stop everyone else's admin reminders.
    for (const t of await adminTokens()) {
      if (t === readerToken) continue;
      reminders.delete(k(t, groupId));
      try { await store.clearUnread(t, groupId); } catch (e) { /* ignore */ }
      liveSockets(io, t).forEach((s) => s.emit('alert', { kind: 'handled', reminder: false, silent: true, groupId, title: 'Conversation handled', body: `${reader.display_name} has opened and read the messages in this group.`, at: new Date().toISOString() }));
    }
  }
}

async function runReminders(io) {
  let rows;
  try { rows = await store.getAllUnreadRows(); } catch (e) { return; }
  const live = new Set(rows.map((r) => k(r.session_token, r.group_id)));
  for (const key of Array.from(reminders.keys())) if (!live.has(key)) reminders.delete(key);
  const now = Date.now();
  for (const r of rows) {
    const key = k(r.session_token, r.group_id);
    let entry = reminders.get(key);
    if (!entry) { reminders.set(key, { lastAt: now, sent: 0 }); continue; }
    if (now - entry.lastAt < REMIND_EVERY_MS || entry.sent >= MAX_REMINDERS) continue;
    entry.lastAt = now; entry.sent += 1;
    try {
      const group = await store.getGroup(r.group_id);
      if (!group) continue;
      const n = Number(r.count);
      const sentLive = await deliver(io, r.session_token, group, {
        title: `Unread messages · ${group.name}`,
        body: `You still have ${n} unread message${n === 1 ? '' : 's'}. Open the chat to read and reply.`,
        kind: 'reminder', reminder: true
      });
      if (AUTO_EMAIL && !sentLive) {
        const user = await store.getUser(r.session_token);
        const to = group.seller_session_token === r.session_token ? group.email_b : group.buyer_session_token === r.session_token ? group.email_a : (user && user.email);
        if (to) await notifyMessageReminder(to, { groupName: group.name, count: n, lang: await langFor(r.session_token, group) });
      }
    } catch (err) { console.error('[notifier] reminder failed:', err.message); }
  }
}

function startReminderEngine(io, checkEveryMs = 60 * 1000) {
  const h = setInterval(() => runReminders(io).catch((e) => console.error('[notifier] reminder error:', e)), checkEveryMs);
  if (h.unref) h.unref();
  return { stop: () => clearInterval(h), run: () => runReminders(io), _reminders: reminders, REMIND_EVERY_MS };
}

module.exports = { notifyNewMessage, onGroupRead, deliver, startReminderEngine, runReminders, localize, langFor, liveSockets, adminTokens, _reminders: reminders, REMIND_EVERY_MS };
