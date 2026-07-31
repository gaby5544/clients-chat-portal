// Security utilities: XSS protection, input validation/sanitization, rate limiting.

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
 * Not distributed (fine for a single Render instance); swap for a
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
  RateLimiter
};
