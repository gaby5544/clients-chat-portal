const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { store } = require('./db');
const { validateTransactionForm, escapeHtml } = require('./security');
const { generateTransactionPdf } = require('./pdfReceipt');
const { resolveAdminRole, hasMinRole } = require('./roles');
const { getPublicKey } = require('./webpush');

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

  router.get('/api/health', (req, res) => res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: require('./package.json').version,
    build: 'enterprise-features-2026-08'
  }));

  return router;
}

module.exports = { buildRouter };
