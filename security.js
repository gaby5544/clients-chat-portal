// Security utilities: XSS protection, input validation/sanitization, rate limiting.
const crypto = require('crypto');

/**
 * Password hashing for the seller Transaction Account (scrypt — built into
 * Node, no extra dependency). Format: "<saltHex>:<hashHex>" so a lost/rotated
 * work-factor never breaks verification of older hashes.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const hash = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
function isStrongEnoughPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200;
}

/** A random 6-digit numeric code for password-reset emails, hashed the same way. */
function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/**
 * Escape HTML special characters so user-generated text can never be
 * interpreted as markup when injected into the DOM. Applied server-side
 * before storage AND again client-side before render (defense in depth).
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Trim, strip control characters, and enforce a max length on free-text input.
 */
function sanitizeText(str, maxLen = 4000) {
  if (typeof str !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return stripped.trim().slice(0, maxLen);
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254;
}

function isNonEmptyString(val, maxLen = 500) {
  return typeof val === 'string' && val.trim().length > 0 && val.trim().length <= maxLen;
}

/**
 * Validates the transaction submission form. Returns { valid, errors }.
 */
function validateTransactionForm(body) {
  const errors = [];
  const required = {
    full_legal_name: 200,
    country: 100,
    role: 50,
    asset_type: 200
  };
  for (const [field, maxLen] of Object.entries(required)) {
    if (!isNonEmptyString(body[field], maxLen)) {
      errors.push(`${field.replace(/_/g, ' ')} is required`);
    }
  }
  if (body.role && !['Buyer', 'Seller'].includes(body.role)) {
    errors.push('role must be Buyer or Seller');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Minimal in-memory sliding-window rate limiter for Socket.IO events.
 * Not distributed (fine for a single server instance); swap for a
 * Redis-backed limiter if you scale to multiple instances.
 */
class RateLimiter {
  constructor({ windowMs = 10000, max = 15 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map(); // key -> [timestamps]
  }

  allow(key) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    arr.push(now);
    this.hits.set(key, arr);
    return arr.length <= this.max;
  }

  // Periodically clean up old keys to avoid unbounded memory growth.
  sweep() {
    const now = Date.now();
    for (const [key, arr] of this.hits.entries()) {
      const fresh = arr.filter(t => now - t < this.windowMs);
      if (fresh.length === 0) this.hits.delete(key); else this.hits.set(key, fresh);
    }
  }
}

// ---- v3.1 helpers --------------------------------------------------------

/** Phone number -> E.164-ish string ("+233244123456") or null when invalid. */
function normalizePhone(dialCode, localNumber) {
  const dial = String(dialCode || '').replace(/\D/g, '');
  let local = String(localNumber || '').replace(/[^\d]/g, '');
  if (!dial || !local) return null;
  local = local.replace(/^0+/, ''); // national trunk prefix (0244... -> 244...)
  const full = dial + local;
  if (local.length < 6 || full.length < 8 || full.length > 15) return null;
  return '+' + full;
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function nameTokens(s) {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/['-]/g, '').split(/\s+/).filter(Boolean);
}
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/**
 * Moderate name comparison for KYC: tolerant of middle names, ordering,
 * diacritics and a one-letter typo, but rejects genuinely different names.
 */
function namesRoughlyMatch(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let hits = 0;
  const used = new Set();
  for (const tok of short) {
    const idx = long.findIndex((x, i) => !used.has(i) && (x === tok || (Math.max(tok.length, x.length) >= 4 && Math.min(tok.length, x.length) >= 3 && editDistance(tok, x) <= 1)));
    if (idx >= 0) { used.add(idx); hits++; }
  }
  return hits >= Math.max(1, Math.ceil(short.length * 0.6)) && (short.length === 1 ? long.length <= 1 || hits >= 1 : hits >= 2 || short.length < 2);
}

/** Client IP behind a proxy (Render/Northflank set x-forwarded-for). */
function clientIpFrom(headers, fallback) {
  const xff = headers && (headers['x-forwarded-for'] || headers['X-Forwarded-For']);
  let ip = (typeof xff === 'string' && xff.split(',')[0].trim()) || (headers && headers['x-real-ip']) || fallback || '';
  ip = String(ip).replace(/^::ffff:/, '');
  return ip.slice(0, 64) || 'unknown';
}

function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d;
}

module.exports = {
  normalizePhone, namesRoughlyMatch, clientIpFrom, maskEmail, nameTokens,
  escapeHtml,
  sanitizeText,
  isValidEmail,
  isNonEmptyString,
  validateTransactionForm,
  RateLimiter,
  hashPassword,
  verifyPassword,
  isStrongEnoughPassword,
  generateSixDigitCode,
  hashCode
};
