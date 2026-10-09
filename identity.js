// Opaque public IDs. A session token is a CREDENTIAL — whoever holds it can act as that
// person — so it must never be sent to anyone else. Everything other people need to
// recognise a user (who sent a message, who is online, who to DM or remove) uses a
// one-way ID derived from the token with a server-side secret instead.
const crypto = require('crypto');

let secret = process.env.UID_SECRET || process.env.PASSWORD_VAULT_KEY || null;

/** Call once after the store is ready: keeps IDs stable across restarts when no env secret is set. */
async function initIdentity(store) {
  if (secret) return;
  let s = await store.getSetting('uid_secret', null);
  if (!s) { s = crypto.randomBytes(32).toString('hex'); await store.setSetting('uid_secret', s); }
  secret = s;
}

function uidOf(token) {
  if (!token) return null;
  if (!secret) secret = crypto.randomBytes(32).toString('hex');   // before init (tests): per-process
  return 'u_' + crypto.createHmac('sha256', secret).update('uid|' + token).digest('base64url').slice(0, 22);
}

async function tokenForUid(store, uid) {
  if (typeof uid !== 'string' || !/^u_[A-Za-z0-9_-]{22}$/.test(uid)) return null;
  for (const u of await store.getAllUsers()) if (uidOf(u.session_token) === uid) return u.session_token;
  return null;
}

/** Keyed hash for signed links (login-alert confirmations). Same stable secret as the opaque user IDs. */
function hmac(label, data) {
  if (!secret) secret = crypto.randomBytes(32).toString('hex');
  return crypto.createHmac('sha256', secret).update(label + '|' + data).digest('base64url');
}

module.exports = { initIdentity, uidOf, tokenForUid, hmac };
