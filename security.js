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

/** A random 11-digit numeric seller Account ID (never starts with 0), e.g. 15963475226. */
function generateAccountId() {
  return String(crypto.randomInt(1, 10)) + String(crypto.randomInt(0, 1e10)).padStart(10, '0');
}

/**
 * Phone numbers are stored as "+<digits>" (E.164-ish). Accepts spaces, dashes,
 * dots and brackets while typing; returns null if it is not a plausible number.
 */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d{7,15}$/.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+/, '');
  if (digits.startsWith('0')) return null; // an international number never starts with 0
  return `+${digits}`;
}

/** Password rules for the Transaction Account: 8+ chars with at least a letter and a number. */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 200) return 'Password is too long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must include at least one letter and one number.';
  return null;
}

/** Constant-time comparison of a submitted 6-digit code against its stored hash. */
function codeMatches(code, storedHash) {
  const a = Buffer.from(hashCode(String(code || '').trim()), 'hex');
  const b = Buffer.from(String(storedHash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

module.exports = {
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
  hashCode,
  generateAccountId,
  normalizePhone,
  passwordProblem,
  codeMatches
};
