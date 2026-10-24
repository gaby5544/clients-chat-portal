// v3.14 App PIN. A 6-digit PIN a seller can set on top of their password.
//   * stored only as a salted scrypt hash (same helper as passwords) inside the account flags, never sent to any client
//   * required to open the account after a page load / sign-in, to show the card details, to unfreeze the card and to start a transfer
//   * five wrong tries lock PIN entry for five minutes (per account); the account password can always set a new PIN
const { hashPassword, verifyPassword } = require('./security');

const PIN_RE = /^\d{6}$/;
const MAX_TRIES = 5, LOCK_MS = 5 * 60 * 1000, UNLOCK_MS = 15 * 60 * 1000;
const unlocked = new Map();   // `${sessionToken}|${groupId}` -> expiry (ms)
const fails = new Map();      // groupId -> { n, until }

const flagsOf = (g) => { const f = g && g.group_flags; if (!f) return {}; if (typeof f === 'string') { try { return JSON.parse(f) || {}; } catch (e) { return {}; } } return f; };
const hasPin = (g) => !!flagsOf(g).pinHash;
const key = (token, gid) => `${token}|${gid}`;

/** Weak PINs are refused: one repeated digit (111111) or a straight run (123456 / 654321). */
function isWeak(pin) {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const d = pin.split('').map(Number); let up = true, down = true;
  for (let i = 1; i < 6; i++) { if (d[i] !== d[i - 1] + 1) up = false; if (d[i] !== d[i - 1] - 1) down = false; }
  return up || down;
}
const hashPin = (pin) => hashPassword(pin);
function verifyPin(pin, g) { const h = flagsOf(g).pinHash; return !!h && PIN_RE.test(String(pin || '')) && verifyPassword(String(pin), h); }

function lockState(gid, now = Date.now()) { const f = fails.get(gid); if (f && f.until > now) return { locked: true, retryIn: Math.ceil((f.until - now) / 1000) }; return { locked: false, retryIn: 0 }; }
function recordFail(gid, now = Date.now()) {
  const f = fails.get(gid) && fails.get(gid).until > now ? fails.get(gid) : (fails.get(gid) || { n: 0, until: 0 });
  if (f.until && f.until <= now) { f.n = 0; f.until = 0; }
  f.n += 1; if (f.n >= MAX_TRIES) { f.until = now + LOCK_MS; f.n = 0; }
  fails.set(gid, f); const st = lockState(gid, now); return { left: st.locked ? 0 : Math.max(0, MAX_TRIES - f.n), ...st };
}
const clearFails = (gid) => fails.delete(gid);
const markUnlocked = (token, gid, now = Date.now()) => { unlocked.set(key(token, gid), now + UNLOCK_MS); };
/** True when no PIN is set, or the PIN was entered recently in this session. Using it refreshes the window. */
function isUnlocked(token, g, now = Date.now()) {
  if (!hasPin(g)) return true;
  const k = key(token, g.id), exp = unlocked.get(k);
  if (!exp || exp < now) { unlocked.delete(k); return false; }
  unlocked.set(k, now + UNLOCK_MS); return true;
}
function clearSession(token) { for (const k of unlocked.keys()) if (k.startsWith(token + '|')) unlocked.delete(k); }
const _reset = () => { unlocked.clear(); fails.clear(); };

module.exports = { PIN_RE, MAX_TRIES, LOCK_MS, UNLOCK_MS, isWeak, hashPin, verifyPin, hasPin, lockState, recordFail, clearFails, markUnlocked, isUnlocked, clearSession, flagsOf, _reset };
