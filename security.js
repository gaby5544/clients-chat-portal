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
  // 8+ characters with at least one letter and one number — enough to stop trivial
  // passwords without making the sign-up form feel hostile.
  return typeof password === 'string' && password.length >= 8 && password.length <= 200 && /[A-Za-z\u00C0-\uFFFF]/.test(password) && /\d/.test(password);
}
const PASSWORD_RULE_TEXT = 'Password must be at least 8 characters and include a letter and a number.';

/** A random 6-digit numeric code for password-reset emails, hashed the same way. */
// 14 characters, no look-alikes, always satisfies isStrongEnoughPassword (upper, lower, digit, symbol).
function generateTempPassword() {
  const pick = (set) => set[crypto.randomInt(0, set.length)];
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789', X = '#$%&*+?!';
  const chars = [pick(U), pick(L), pick(D), pick(X)];
  const all = U + L + D + X;
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
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

// ---------- Contact helpers ----------
/** Phone numbers are stored as "+<digits>" (E.164-style): 7-15 digits after the +. */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s().-]/g, '');
  if (!/^\+\d{7,15}$/.test(cleaned)) return null;
  return cleaned;
}
function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '';
  const shown = user.length <= 2 ? user[0] || '' : user.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(2, user.length - shown.length))}@${domain}`;
}

// ---------- Client IP (works behind Render / Northflank / Netlify proxies) ----------
function cleanIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim();
  if (s.startsWith('[')) s = s.replace(/^\[([^\]]+)\].*$/, '$1');          // [::1]:1234
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, ''); // 1.2.3.4:5678
  if (s.toLowerCase().startsWith('::ffff:') && s.includes('.')) s = s.slice(7);   // IPv4-mapped IPv6
  if (s === '::1') s = '127.0.0.1';
  return s.slice(0, 64).toLowerCase();
}

// How many reverse proxies sit in front of this app (each appends the address it received the request from).
// Only that many entries from the RIGHT of X-Forwarded-For are trusted — anything a client types on the left is ignored,
// so a blocked seller cannot dodge a block by sending a fake X-Forwarded-For header.
// TRUST_PROXY=0 → no proxy (use the socket address); TRUST_PROXY_HOPS=2 → e.g. Cloudflare + the host's load balancer.
function trustHops() {
  if (process.env.TRUST_PROXY === '0') return 0;
  const n = Number(process.env.TRUST_PROXY_HOPS);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}
function ipFromHeaders(headers, fallback) {
  const h = headers || {};
  const get = (k) => h[k] || h[k.toLowerCase()];
  if (process.env.TRUST_CLOUDFLARE === '1' && get('cf-connecting-ip')) return cleanIp(get('cf-connecting-ip'));
  const hops = trustHops();
  const xff = get('x-forwarded-for');
  if (hops > 0 && xff) {
    const parts = String(xff).split(',').map((x) => cleanIp(x)).filter(Boolean);
    if (parts.length) return parts[Math.max(0, parts.length - hops)];
  }
  return cleanIp(fallback);
}
const getReqIp = (req) => ipFromHeaders(req.headers, req.socket && req.socket.remoteAddress);
const getSocketIp = (socket) => ipFromHeaders(socket.handshake && socket.handshake.headers, socket.handshake && socket.handshake.address);

function expandIPv6(ip) {
  let s = String(ip).toLowerCase();
  if (s.includes('.')) { // embedded IPv4 tail
    const m = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
    if (!m) return null;
    const hex = (a, b) => ((Number(a) << 8) | Number(b)).toString(16);
    s = m[1] + hex(m[2], m[3]) + ':' + hex(m[4], m[5]);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? left.length !== 8 : missing < 0) return null;
  const groups = halves.length === 2 ? left.concat(Array(missing).fill('0'), right) : left;
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}
/** The "network" an address belongs to: the address itself for IPv4, the /64 for IPv6 (one home/office = one /64). */
function ipNetwork(ip) {
  const c = cleanIp(ip);
  if (!c) return '';
  if (!c.includes(':')) return c;
  const g = expandIPv6(c);
  return g ? g.slice(0, 4).join(':') + '::/64' : c;
}
const sameNetwork = (a, b) => !!a && !!b && ipNetwork(a) === ipNetwork(b);
function isPrivateIp(ip) {
  const c = cleanIp(ip);
  if (!c) return true;
  if (c.includes(':')) { const g = expandIPv6(c); return !g || /^(fc|fd|fe[89ab])/.test(g[0]) || g.join('') === '00000000000000000000000000000001' || g.join('') === '0'.repeat(32); }
  const [a, b] = c.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}
function isValidIp(ip) {
  return typeof ip === 'string' && (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? ip.split('.').every((n) => Number(n) <= 255) : /^[0-9a-fA-F:]{3,45}$/.test(ip) && ip.includes(':'));
}

// ---------- Name matching (KYC) — tolerant of order, middle names, accents, case ----------
function nameTokens(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\u4e00-\u9fff\s'-]/g, ' ')
    .split(/\s+/).filter((t) => t.length > 1 || /[\u4e00-\u9fff]/.test(t));
}
/** True when every word of the shorter name appears in the longer one (moderate, not strict). */
function namesMatch(a, b) {
  const ta = nameTokens(a); const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2 && long.length >= 2 && short.length === 1) return false; // a single word is never enough
  const matched = short.filter((t) => long.some((u) => u === t || (t.length > 3 && u.length > 3 && (u.startsWith(t) || t.startsWith(u)))));
  return matched.length === short.length;
}

module.exports = {
  PASSWORD_RULE_TEXT, normalizePhone, maskEmail, cleanIp, ipFromHeaders, trustHops, ipNetwork, sameNetwork, isPrivateIp, expandIPv6, getReqIp, getSocketIp, isValidIp, namesMatch, nameTokens,
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
  generateTempPassword,
  hashCode
};
