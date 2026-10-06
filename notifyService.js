// Notifications that must reach people whether or not they are online:
//   * pushToToken()      — Web Push in the RECIPIENT'S language (title + body translated server-side)
//   * emitToUser()       — live in-app event on the person's private room (every open tab/device)
//   * startReminderLoop  — repeats the notification every 60 minutes until the messages are read
//   * emitToAudience()   — chat events for one audience only (e.g. a Desk note released to the buyer)
// The browser side (sound x3, title flash, desktop notification) lives in public/app.js / v4.js.

const { store } = require('./db');
const { sendPushToUser } = require('./webpush');
const { translateText } = require('./translate');

const REMINDER_INTERVAL_MS = 60 * 60 * 1000;

function userRoom(token) { return `user:${token}`; }
function emitToUser(io, token, event, payload) { if (token) io.to(userRoom(token)).emit(event, payload); }

function isOnline(io, token) {
  if (!token) return false;
  const map = io._activeSockets || new Map();
  for (const v of map.values()) if (v.sessionToken === token) return true;
  return false;
}

async function languageOf(token) {
  try { const u = await store.getUser(token); return (u && u.language) || 'en'; } catch (e) { return 'en'; }
}

/** Push to every device of one session, translated into that person's language. Never throws. */
async function pushToToken(token, { title, body, url }) {
  if (!token) return;
  try {
    const lang = await languageOf(token);
    let t = title; let b = body;
    if (lang !== 'en') {
      const [tt, bb] = await Promise.all([translateText(title, lang), translateText(body, lang)]);
      t = tt || title; b = bb || body;
    }
    await sendPushToUser(token, { title: t, body: b, url: url || '/' });
  } catch (err) { console.warn('[notify] push failed:', err.message); }
}

/** Emit a chat-level event only to sockets that are allowed to see it. audience: null|'buyer'|'seller'|'admin'. */
function emitToAudience(io, groupId, audience, event, payload) {
  if (!audience) { io.to(groupId).emit(event, payload); return; }
  const map = io._activeSockets || new Map();
  for (const [sockId, v] of map.entries()) {
    if (v.groupId !== groupId) continue;
    const ok = v.isAdmin || (audience === 'buyer' && v.role === 'PARTY A') || (audience === 'seller' && v.role === 'PARTY B');
    if (ok) { const s = io.sockets.sockets.get(sockId); if (s) s.emit(event, payload); }
  }
}
/** Can this viewer see a message with the given audience? */
function canSeeMessage(audience, { isAdmin, role }) {
  if (!audience) return true;
  if (isAdmin) return true;
  return (audience === 'buyer' && role === 'PARTY A') || (audience === 'seller' && role === 'PARTY B');
}

let loopStarted = false;
/**
 * Every minute, find anyone who still has unread messages for 60+ minutes since
 * the first unread one (or since the last reminder) and nudge them again — a push
 * (if they are offline / have push on) and a live event (if they are online).
 * Reading the chat clears the unread counter, which ends the reminders.
 */
function startReminderLoop(io) {
  if (loopStarted) return;
  loopStarted = true;
  const run = async () => {
    try {
      const now = Date.now();
      const rows = await store.getUnreadDetails();
      for (const r of rows) {
        const ref = new Date(r.last_reminded_at || r.since || 0).getTime();
        if (!ref || now - ref < REMINDER_INTERVAL_MS) continue;
        const group = await store.getGroup(r.group_id);
        const user = await store.getUser(r.session_token);
        if (!group || !user) { await store.markReminded(r.session_token, r.group_id); continue; }
        await store.markReminded(r.session_token, r.group_id); // mark first so a slow push can never double-send
        const count = Number(r.count) || 1;
        const title = 'Unread messages';
        const body = `You still have ${count} unread message${count === 1 ? '' : 's'} in ${group.name}. Open the Desk to read them.`;
        emitToUser(io, r.session_token, 'unread-reminder', { groupId: r.group_id, groupName: group.name, count, title, body });
        await pushToToken(r.session_token, { title, body, url: '/' });
      }
    } catch (err) { console.error('[reminders] loop error:', err.message); }
  };
  setInterval(run, 60 * 1000).unref();
}

module.exports = { userRoom, emitToUser, isOnline, pushToToken, emitToAudience, canSeeMessage, startReminderLoop, REMINDER_INTERVAL_MS };
