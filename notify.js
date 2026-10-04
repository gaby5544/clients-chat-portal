// Automatic notifications — everyone (buyer, seller, every admin) is told about
// new messages the moment they are sent, whether or not they are online.
//
//  * Active in the chat (tab visible + focused, in that group)  -> nothing to do, they see it.
//  * Online but not looking at it                                -> in-app notice + 3-beep sound, and a push if no tab is active.
//  * Offline                                                     -> push + email, immediately.
//  * Still unread an hour later                                  -> a reminder (sound/push/email), then every 60 minutes until read.
//  * When someone reads a message                                -> the others are told ("X read your message").
//
// Text is translated into each recipient's own language (seller_language for the
// seller, users.pref_lang for everyone else) before it is shown, pushed or emailed.

const { store } = require('./db');
const { sendPushToUser } = require('./webpush');
const E = require('./email');
const { translateOne, unescapeHtml } = require('./translate');

const REMINDER_EVERY_MS = 60 * 60 * 1000;
const EMAIL_THROTTLE_MS = 2 * 60 * 1000;   // at most one "new message" email per person per group per 2 minutes
const ADMIN_FRESH_MS = 30 * 24 * 3600 * 1000;
const APPROVAL_REQUIRED = /^(1|true|yes)$/i.test(process.env.EMAIL_APPROVAL_REQUIRED || '');

const emailLast = new Map(); // `${token}|${group}` -> ts

function publicPendingEmail(p) {
  return {
    id: p.id, groupId: p.group_id, party: p.party, toEmail: p.to_email,
    fromName: p.from_name, groupName: p.group_name, text: p.message_text,
    status: p.status, createdAt: p.created_at
  };
}

function createNotifier(io) {
  const sockets = () => io._activeSockets || (io._activeSockets = new Map());

  function socketsOf(token) {
    const out = [];
    for (const [id, v] of sockets()) if (v.sessionToken === token) out.push({ id, meta: v, socket: io.sockets.sockets.get(id) });
    return out.filter((s) => s.socket);
  }
  const isActiveIn = (token, groupId) => socketsOf(token).some((s) => s.meta.groupId === groupId && s.meta.active !== false);
  const anyActive = (token) => socketsOf(token).some((s) => s.meta.active !== false);

  async function langOf(group, token) {
    if (token && group && group.seller_session_token === token && group.seller_language) return group.seller_language;
    const u = token ? await store.getUser(token) : null;
    return (u && u.pref_lang) || 'en';
  }

  async function tr(text, lang) {
    if (!lang || lang === 'en') return text;
    return (await translateOne(text, lang, 'en')).text;
  }

  // People who should hear about activity in a group (besides the sender).
  async function audienceFor(group, senderToken, senderIsAdmin) {
    const list = [];
    for (const party of ['A', 'B']) {
      const token = party === 'A' ? group.buyer_session_token : group.seller_session_token;
      const email = party === 'A' ? group.email_a : group.email_b;
      if (token && token === senderToken) continue;
      if (!token && !email) continue;
      list.push({ kind: 'party', party, token, email });
    }
    if (!senderIsAdmin) {
      const cutoff = Date.now() - ADMIN_FRESH_MS;
      const users = await store.getAllUsers();
      for (const u of users) {
        if (!u.is_admin || u.session_token === senderToken) continue;
        if (u.last_seen && new Date(u.last_seen).getTime() < cutoff) continue;
        list.push({ kind: 'admin', token: u.session_token, email: u.email || null });
      }
    }
    return list;
  }

  async function sendEmailAuto(a, group, fromName, text, lang) {
    if (!a.email) return;
    const k = `${a.token || a.email}|${group.id}`;
    if (Date.now() - (emailLast.get(k) || 0) < EMAIL_THROTTLE_MS) return;
    emailLast.set(k, Date.now());
    if (APPROVAL_REQUIRED && a.kind === 'party') {
      const rec = await store.createPendingEmail({ groupId: group.id, party: a.party, toEmail: a.email, fromName, groupName: group.name, messageText: text });
      io.to('admins').emit('pending-email-created', publicPendingEmail(rec));
      return;
    }
    await E.notifyOfflineMessage(a.email, { fromName, groupName: group.name, text, lang });
  }

  // A new chat message was stored. `text` is the plain (unescaped) preview.
  async function notifyNewMessage({ group, sender, senderIsAdmin, messageId, text }) {
    const audience = await audienceFor(group, sender.session_token, senderIsAdmin);
    const preview = String(text || '').slice(0, 200);
    for (const a of audience) {
      try {
        if (a.token && isActiveIn(a.token, group.id)) continue; // they are reading it right now
        const lang = await langOf(group, a.token);
        const title = await tr(`New message from ${sender.display_name}`, lang);
        const body = lang === 'en' ? preview : (await translateOne(preview, lang)).text;
        if (a.token) {
          await store.incrementUnread(a.token, group.id);
          await store.addNotification(a.token, 'message', { fromName: sender.display_name, groupName: group.name, text: preview, groupId: group.id });
          const live = socketsOf(a.token);
          for (const s of live) {
            s.socket.emit('notify', {
              kind: 'message', groupId: group.id, groupName: group.name, messageId, from: sender.display_name,
              title, body, playSound: true, repeat: 3
            });
          }
          if (!anyActive(a.token)) await sendPushToUser(a.token, { title: `${title} — ${group.name}`, body, url: '/' });
        }
        if (!a.token || socketsOf(a.token).length === 0) await sendEmailAuto(a, group, sender.display_name, preview, lang);
      } catch (err) { console.error('[notify] message notice failed:', err.message); }
    }
  }

  // Someone read messages: tell the people who sent them (and the others watching).
  async function notifyRead({ group, reader, readerSocket, senderTokens, count }) {
    try {
      const payload = { kind: 'read', groupId: group.id, groupName: group.name, by: reader.display_name, count };
      readerSocket.to(group.id).to('admins').emit('read-notice', payload);
      for (const token of senderTokens) {
        if (token === reader.session_token) continue;
        if (socketsOf(token).length === 0) {
          const lang = await langOf(group, token);
          await sendPushToUser(token, { title: await tr(`${reader.display_name} read your message`, lang), body: group.name, url: '/' });
        }
      }
    } catch (err) { console.error('[notify] read notice failed:', err.message); }
  }

  // Hourly nudge for anything still unread.
  let running = false;
  async function runReminders() {
    if (running) return;
    running = true;
    try {
      const due = await store.getDueReminders(REMINDER_EVERY_MS);
      for (const r of due) {
        try {
          const [user, group] = await Promise.all([store.getUser(r.session_token), store.getGroup(r.group_id)]);
          if (!user || !group) { await store.clearUnread(r.session_token, r.group_id); continue; }
          if (isActiveIn(r.session_token, group.id)) { await store.clearUnread(r.session_token, group.id); continue; }
          const lang = await langOf(group, r.session_token);
          const count = Number(r.count) || 1;
          const title = await tr('Unread messages are waiting', lang);
          const body = await tr(`You have ${count} unread message${count > 1 ? 's' : ''} in ${group.name}.`, lang);
          for (const s of socketsOf(r.session_token)) {
            s.socket.emit('notify', { kind: 'reminder', groupId: group.id, groupName: group.name, title, body, count, playSound: true, repeat: 3 });
          }
          if (!anyActive(r.session_token)) await sendPushToUser(r.session_token, { title, body, url: '/' });
          const email = group.seller_session_token === r.session_token ? group.email_b
            : group.buyer_session_token === r.session_token ? group.email_a : user.email;
          if (email && socketsOf(r.session_token).length === 0) await E.notifyUnreadReminder(email, { groupName: group.name, count, lang });
          await store.markReminded(r.session_token, group.id);
        } catch (err) { console.error('[notify] reminder failed:', err.message); }
      }
    } finally { running = false; }
  }

  return { notifyNewMessage, notifyRead, runReminders, socketsOf, isActiveIn, anyActive, langOf, tr };
}

function startReminderTicker(io, notifier) {
  const t = setInterval(() => notifier.runReminders().catch((e) => console.error('[reminders]', e.message)), 60 * 1000);
  t.unref();
  return t;
}

module.exports = { createNotifier, startReminderTicker, publicPendingEmail, REMINDER_EVERY_MS };
