const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { store } = require('./db');
const { validateTransactionForm, escapeHtml, isValidEmail, hashPassword, verifyPassword, isStrongEnoughPassword, generateSixDigitCode, hashCode, getReqIp, PASSWORD_RULE_TEXT } = require('./security');
const { translateMany, provider: translateProvider } = require('./translate');
const { isIpBlocked, recordIp } = require('./sellerHandlers');
const E = require('./email');
const { generateTransactionPdf, generateFundsReceiptPdf } = require('./pdfReceipt');
const F = require('./finance');
const { resolveAdminRole, hasMinRole } = require('./roles');
const { getPublicKey } = require('./webpush');
const { notifyPasswordResetCode } = E;
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/csv'
]);
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, `${randomName}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('File type not allowed'));
    }
    cb(null, true);
  }
});

// Rate limiters — protect against abuse of upload/export/form endpoints.
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const formLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const exportLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const pdfLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });
// Tighter limits for auth endpoints — these are brute-force targets.
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const translateLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, standardHeaders: true, legacyHeaders: false });
const LOGIN_LOCKOUT_AFTER = 6;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  const role = resolveAdminRole(key);
  if (!hasMinRole(role, 'ADMIN')) return res.status(403).json({ error: 'Admin authorization required' });
  next();
}

function buildRouter() {
  const router = express.Router();

  router.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

  // ---- File upload (drag-and-drop / attachment) ----
  router.post('/api/upload', uploadLimiter, (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      const isImage = req.file.mimetype.startsWith('image/');
      res.json({
        fileUrl: `/uploads/${req.file.filename}`,
        fileType: isImage ? 'image' : 'file',
        fileName: escapeHtml(req.file.originalname),
        fileSize: req.file.size
      });
    });
  });

  // ---- Transaction submission (also available over socket; REST kept for form-post fallback) ----
  router.post('/api/transactions/:groupId', formLimiter, async (req, res) => {
    const { valid, errors } = validateTransactionForm(req.body);
    if (!valid) return res.status(400).json({ error: errors.join(', ') });
    const group = await store.getGroup(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.transaction_form_enabled) return res.status(403).json({ error: 'Transaction form is disabled for this group' });

    const tx = await store.insertTransaction({
      group_id: req.params.groupId,
      full_legal_name: escapeHtml(req.body.full_legal_name),
      country: escapeHtml(req.body.country),
      role: escapeHtml(req.body.role),
      asset_type: escapeHtml(req.body.asset_type),
      asset_description: escapeHtml(req.body.asset_description || ''),
      quantity: escapeHtml(req.body.quantity || ''),
      unit_price: escapeHtml(req.body.unit_price || ''),
      total_value: escapeHtml(req.body.total_value || ''),
      payment_currency: escapeHtml(req.body.payment_currency || ''),
      payment_method: escapeHtml(req.body.payment_method || ''),
      payment_terms: escapeHtml(req.body.payment_terms || ''),
      notes: escapeHtml(req.body.notes || ''),
      submitted_by: escapeHtml(req.body.submitted_by || 'Unknown')
    });
    res.json({ success: true, transaction: tx });
  });

  // ---- Admin: export transactions as CSV ----
  router.get('/api/transactions/:groupId/export', exportLimiter, requireAdmin, async (req, res) => {
    const rows = await store.getTransactions(req.params.groupId);
    const headers = [
      'id', 'full_legal_name', 'country', 'role', 'asset_type', 'asset_description',
      'quantity', 'unit_price', 'total_value', 'payment_currency', 'payment_method',
      'payment_terms', 'notes', 'submitted_by', 'submitted_at'
    ];
    const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    rows.forEach(r => lines.push(headers.map(h => csvEscape(r[h])).join(',')));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${req.params.groupId}.csv"`);
    res.send(lines.join('\n'));
  });

  // ---- PDF receipt download ----
  // Accessible via the transaction's UUID alone (same "unguessable link"
  // pattern as e.g. a payment receipt link) — this lets the person who just
  // submitted the form download their own receipt immediately without an
  // admin login, while remaining effectively private since UUIDs aren't
  // enumerable.
  router.get('/api/transactions/pdf/:txId', pdfLimiter, async (req, res) => {
    const tx = await store.getTransactionById(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Receipt not found' });
    const group = await store.getGroup(tx.group_id);
    generateTransactionPdf(res, tx, group ? group.name : 'Unknown Group');
  });

  // ---- Transaction Account receipts (incoming funds / completed withdrawals) ----
  // The link is HMAC-signed and only ever handed to the seller who owns the
  // record (or a finance admin) inside a socket payload — it can't be guessed
  // or edited to point at someone else's record.
  router.get('/api/receipts/:kind/:id', pdfLimiter, async (req, res) => {
    const { kind, id } = req.params;
    if (!['incoming', 'withdrawal'].includes(kind) || !F.verifyReceiptSig(kind, id, req.query.sig)) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    const rec = kind === 'incoming' ? await store.getIncomingFundsById(id) : await store.getWithdrawalById(id);
    // A receipt only exists for money that actually landed / actually left.
    if (!rec || (kind === 'incoming' && rec.status !== 'credited') || (kind === 'withdrawal' && F.normWdStatus(rec.status) !== 'completed')) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    const group = await store.getGroup(rec.group_id);
    if (!group) return res.status(404).json({ error: 'Receipt not found' });
    const record = kind === 'incoming' ? F.publicIncoming(rec, false) : F.publicWithdrawal(rec, false);
    generateFundsReceiptPdf(res, { kind, record, group, raw: rec });
  });

  // ---- Translation (chat messages, interface text, notifications) ----
  // Requires a known session so the provider key can't be used by strangers.
  router.post('/api/translate', translateLimiter, async (req, res) => {
    const { sessionToken, texts, target, source } = req.body || {};
    if (!sessionToken || !(await store.getUser(String(sessionToken)))) return res.status(401).json({ error: 'Unknown session' });
    if (!Array.isArray(texts) || !texts.length || texts.length > 60 || !target) return res.status(400).json({ error: 'Invalid request' });
    const clean = texts.map((t) => String(t == null ? '' : t).slice(0, 2000));
    const out = await translateMany(clean, String(target), source ? String(source) : null);
    res.json({ provider: translateProvider(), results: out.map((r) => ({ text: r.text, ok: r.ok })) });
  });

  // ---- Web Push: subscribe / unsubscribe ----
  router.get('/api/push/vapid-public-key', (req, res) => res.json({ publicKey: getPublicKey() }));

  router.post('/api/push/subscribe', formLimiter, async (req, res) => {
    const { sessionToken, subscription } = req.body || {};
    if (!sessionToken || !subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription payload' });
    }
    await store.savePushSubscription(sessionToken, subscription);
    res.json({ success: true });
  });

  router.post('/api/push/unsubscribe', formLimiter, async (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await store.removePushSubscription(endpoint);
    res.json({ success: true });
  });

  // ---- Branding Center ----
  // GET is public (every visitor needs the branding to render the page
  // correctly); only SUPER_ADMIN can change it.
  router.get('/api/branding', async (req, res) => {
    const branding = await store.getBranding();
    res.json(branding);
  });

  router.post('/api/branding', formLimiter, async (req, res) => {
    const key = req.headers['x-admin-key'] || req.query.adminKey;
    const role = resolveAdminRole(key);
    if (!hasMinRole(role, 'SUPER_ADMIN')) return res.status(403).json({ error: 'Super Admin authorization required' });
    const { logo_url, accent_color, accent_color_2, welcome_message, background_url } = req.body || {};
    const updated = await store.updateBranding({ logo_url, accent_color, accent_color_2, welcome_message, background_url });
    res.json(updated);
  });

  // ==========================================================================
  // TRANSACTION ACCOUNT AUTH — Seller login + forgot-password. These run
  // before any socket/group session exists (a returning Seller may not have
  // their original invite link handy), so they're plain REST + JSON.
  // ==========================================================================

  // A generic, timing-consistent "incorrect email or password" for both
  // "no such account" and "wrong password" — never reveal which was wrong.
  const BAD_LOGIN = { error: 'Incorrect email or password.' };

  router.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== 'string' || !password) return res.status(400).json(BAD_LOGIN);
    const matches = await store.findGroupsBySellerEmail(email.trim());
    const group = matches[0]; // one seller account per email
    if (!group) return res.status(401).json(BAD_LOGIN);
    const ip = getReqIp(req);
    if (group.seller_locked_until && new Date(group.seller_locked_until) > new Date()) {
      return res.status(423).json({ error: 'Too many failed attempts. Please try again later.' });
    }
    if (!verifyPassword(password, group.seller_password_hash)) {
      const fails = (group.seller_failed_logins || 0) + 1;
      const fields = { seller_failed_logins: fails };
      if (fails >= LOGIN_LOCKOUT_AFTER) {
        fields.seller_locked_until = new Date(Date.now() + LOGIN_LOCKOUT_MS).toISOString();
        fields.seller_failed_logins = 0;
      }
      await store.updateGroup(group.id, fields);
      return res.status(401).json(BAD_LOGIN);
    }
    // Admin-blocked IPs are refused at sign-in (after the password check, so this never reveals which accounts exist).
    if (isIpBlocked(group, ip)) {
      return res.status(403).json({ error: 'Sign-in from this network has been blocked for this account. Please contact complaints@usvistra.com.', code: 'ip_blocked', contact: E.SUPPORT_EMAIL });
    }
    await store.updateGroup(group.id, { seller_failed_logins: 0, seller_locked_until: null });
    await recordIp(group, ip, 'login');
    res.json({
      success: true, groupId: group.id, sessionToken: uuidv4(), groupName: group.name,
      disabled: !!group.seller_disabled, contact: E.SUPPORT_EMAIL, language: group.seller_language || 'en'
    });
  });

  router.post('/api/auth/forgot-password/request', resetLimiter, async (req, res) => {
    const { email } = req.body || {};
    // Always return success even if the email isn't found — never reveal
    // whether an account exists for a given address.
    if (!isValidEmail(email)) return res.json({ success: true });
    const matches = await store.findGroupsBySellerEmail(email.trim());
    const group = matches[0];
    if (group) {
      const code = generateSixDigitCode();
      await store.createPasswordReset({ groupId: group.id, codeHash: hashCode(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
      await notifyPasswordResetCode(group.email_b, { code, groupName: group.name, lang: group.seller_language });
    }
    res.json({ success: true });
  });

  router.post('/api/auth/forgot-password/verify', resetLimiter, async (req, res) => {
    const { email, code } = req.body || {};
    if (!isValidEmail(email) || !/^\d{6}$/.test(String(code || ''))) return res.status(400).json({ error: 'Invalid code.' });
    const matches = await store.findGroupsBySellerEmail(email.trim());
    const group = matches[0];
    if (!group) return res.status(400).json({ error: 'Invalid or expired code.' });
    const reset = await store.getLatestPasswordReset(group.id);
    if (!reset || new Date(reset.expires_at) < new Date() || reset.code_hash !== hashCode(code)) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }
    const resetToken = uuidv4();
    await store.setPasswordResetToken(reset.id, resetToken);
    res.json({ success: true, resetToken });
  });

  router.post('/api/auth/forgot-password/reset', resetLimiter, async (req, res) => {
    const { email, resetToken, newPassword } = req.body || {};
    if (!isValidEmail(email) || !resetToken || !isStrongEnoughPassword(newPassword)) {
      return res.status(400).json({ error: PASSWORD_RULE_TEXT });
    }
    const matches = await store.findGroupsBySellerEmail(email.trim());
    const group = matches[0];
    if (!group) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    const consumed = await store.consumePasswordResetByToken(group.id, resetToken);
    if (!consumed) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    await store.updateGroup(group.id, { seller_password_hash: hashPassword(newPassword), seller_failed_logins: 0, seller_locked_until: null });
    res.json({ success: true });
  });

  router.get('/api/health', (req, res) => res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: require('./package.json').version,
    build: 'transaction-desk-2026-10',
    emailConfigured: E.isEmailConfigured(),
    translationProvider: translateProvider()
  }));

  return router;
}

module.exports = { buildRouter };
