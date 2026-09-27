// Authentication for seller (Party A / Type A) accounts.
//
// This is deliberately separate from the free-form `session_token` chat
// identity used elsewhere in the app (see socketHandlers.js `join-room`):
// that token is generated client-side and never password-protected, which
// is fine for an anonymous chat participant but not for something that
// gates real money movement. A seller account is a `groups` row with real
// login credentials, and access to it is a server-issued, cryptographically
// random session token stored in an httpOnly cookie — the client never
// sees or sets this value itself.

const crypto = require('crypto');
const { store } = require('./db');

const SESSION_COOKIE = 'qsd_seller_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SCRYPT_KEYLEN = 64;

// Password hashing via Node's built-in crypto.scrypt — no external
// dependency (deliberately: this project previously depended on bcryptjs
// for this, but a lockfile/registry mismatch broke the deploy build; scrypt
// is a well-regarded, memory-hard password hash and ships with Node itself,
// so there's nothing here that can go out of sync with package.json again).
// Stored format: "scrypt$<salt-hex>$<hash-hex>".
function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(plain), salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(plain, stored) {
  return new Promise((resolve) => {
    if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return resolve(false);
    const parts = stored.split('$');
    if (parts.length !== 3) return resolve(false);
    const [, saltHex, hashHex] = parts;
    let salt, expected;
    try {
      salt = Buffer.from(saltHex, 'hex');
      expected = Buffer.from(hashHex, 'hex');
    } catch (e) { return resolve(false); }
    crypto.scrypt(String(plain), salt, expected.length, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        resolve(derivedKey.length === expected.length && crypto.timingSafeEqual(derivedKey, expected));
      } catch (e) {
        resolve(false);
      }
    });
  });
}

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** A 6-digit numeric code, zero-padded, for password-reset emails. */
function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(code) {
  // Codes are short-lived and low-entropy, so a fast keyed hash is enough —
  // no need for bcrypt's deliberate slowness here, just avoid storing plaintext.
  return crypto.createHmac('sha256', process.env.RESET_CODE_SECRET || 'qsd-reset-code-secret')
    .update(code).digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

async function createSession(groupId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await store.createSellerSession(token, groupId, expiresAt);
  return token;
}

/**
 * Express middleware: requires a valid seller session cookie. On success,
 * attaches `req.sellerGroupId`. Does not check KYC status or account
 * standing — routes that need that check it themselves, since "logged in"
 * and "allowed to withdraw" are different questions.
 */
function requireSellerAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  store.getSellerSession(token).then(session => {
    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
    req.sellerGroupId = session.group_id;
    req.sellerSessionToken = token;
    next();
  }).catch(next);
}

module.exports = {
  SESSION_COOKIE,
  RESET_CODE_TTL_MS,
  hashPassword,
  verifyPassword,
  generateToken,
  generateSixDigitCode,
  hashCode,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  createSession,
  requireSellerAuth
};
