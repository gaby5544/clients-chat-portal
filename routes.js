const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { store } = require('./db');
const { validateTransactionForm, escapeHtml, isValidEmail, isNonEmptyString } = require('./security');
const { generateTransactionPdf } = require('./pdfReceipt');
const { resolveAdminRole, hasMinRole } = require('./roles');
const { getPublicKey } = require('./webpush');
const {
  hashPassword, verifyPassword, generateSixDigitCode, hashCode, RESET_CODE_TTL_MS,
  setSessionCookie, clearSessionCookie, createSession, requireSellerAuth,
  parseCookies, SESSION_COOKIE
} = require('./sellerAuth');
const { sendPasswordResetCode, notifyInvite, notifyKycStatus, notifyDepositStatus, notifyWithdrawalStatus } = require('./email');
const { convert, SUPPORTED_CURRENCIES } = require('./fx');

const ASSETS = ['BTC', 'ETH', 'USDT'];
const NETWORKS = ['BEP20', 'TRC20'];
const DOC_TYPES = ['national_id', 'drivers_license', 'passport'];
const WITHDRAWAL_QUEUE_STATUSES = ['pending', 'held_in_vault', 'processing'];
const WITHDRAWAL_TRANSITIONS = {
  pending: ['held_in_vault', 'rejected', 'failed'],
  held_in_vault: ['processing', 'rejected', 'failed'],
  processing: ['completed', 'rejected', 'failed']
};

function sellerProfile(g, balances) {
  return {
    groupId: g.id,
    groupName: g.name,
    fullName: g.owner_full_name,
    email: g.owner_email,
    accountType: g.account_type,
    currency: g.currency,
    currencyLocked: !!g.currency_locked_at,
    kycStatus: g.kyc_status,
    memberSince: g.created_at,
    balances
  };
}

const KYC_FIELD_TO_COLUMN = { idFront: 'id_front_url', idBack: 'id_back_url', proofOfAddress: 'proof_of_address_url', selfie: 'selfie_url' };
// The DB columns above store bare filenames on disk, not public URLs — this
// rewrites them into the authenticated /api/kyc-file/... route before a
// submission is ever sent to a client (seller or admin).
function kycWithFileUrls(sub) {
  return {
    ...sub,
    id_front_url: sub.id_front_url ? `/api/kyc-file/${sub.id}/idFront` : null,
    id_back_url: sub.id_back_url ? `/api/kyc-file/${sub.id}/idBack` : null,
    proof_of_address_url: sub.proof_of_address_url ? `/api/kyc-file/${sub.id}/proofOfAddress` : null,
    selfie_url: sub.selfie_url ? `/api/kyc-file/${sub.id}/selfie` : null
  };
}

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// KYC documents (photo ID, proof of address, selfies) are sensitive personal
// data — they live in their own directory, NOT under UPLOAD_DIR, and are
// deliberately never mounted with express.static. They're only reachable
// through the authenticated /api/kyc-file/:id/:field route below, which
// checks the requester is either the seller who owns the submission or an
// admin, before streaming the file.
const KYC_DIR = path.join(__dirname, 'kyc-uploads');
if (!fs.existsSync(KYC_DIR)) fs.mkdirSync(KYC_DIR, { recursive: true });

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
// Tighter limits on auth endpoints — these are the ones worth brute-forcing.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });

const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, KYC_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`);
  }
});
const kycUpload = multer({
  storage: kycStorage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('File type not allowed'));
    cb(null, true);
  }
}).fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'proofOfAddress', maxCount: 1 },
  { name: 'selfie', maxCount: 1 }
]);

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  const role = resolveAdminRole(key);
  if (!hasMinRole(role, 'ADMIN')) return res.status(403).json({ error: 'Admin authorization required' });
  next();
}

function buildRouter(io) {
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

  // ================================================================
  // SELLER ACCOUNTS — invite, register, login, password reset
  // ================================================================

  // ---- Admin: invite a new seller by email ----
  router.post('/api/admin/invites', formLimiter, requireAdmin, async (req, res) => {
    const { email } = req.body || {};
    const normalized = (email || '').trim().toLowerCase();
    if (!isValidEmail(normalized)) return res.status(400).json({ error: 'A valid email is required' });
    const existing = await store.getGroupByOwnerEmail(normalized);
    if (existing) return res.status(409).json({ error: 'An account already exists for this email' });

    const group = await store.createInvite({ email: normalized });
    const inviteUrl = `${req.protocol}://${req.get('host')}/seller.html?invite=${group.invite_token}`;
    await notifyInvite(normalized, { inviteUrl });
    res.json({ success: true, inviteUrl, token: group.invite_token, groupId: group.id });
  });

  // ---- Public: resolve an invite token (prefills the registration email) ----
  router.get('/api/invite/:token', async (req, res) => {
    const group = await store.getGroupByInviteToken(req.params.token);
    if (!group || group.registration_status !== 'invited') {
      return res.status(404).json({ error: 'This invite link is invalid or has already been used.' });
    }
    res.json({ email: group.owner_email });
  });

  // ---- Seller: complete registration from an invite link ----
  router.post('/api/seller/register', authLimiter, async (req, res) => {
    const { token, fullName, password, confirmPassword, groupName, currency } = req.body || {};
    if (!isNonEmptyString(token, 200)) return res.status(400).json({ error: 'Missing invite token' });

    const group = await store.getGroupByInviteToken(token);
    if (!group || group.registration_status !== 'invited') {
      return res.status(400).json({ error: 'This invite link is invalid or has already been used.' });
    }
    if (!isNonEmptyString(fullName, 200)) return res.status(400).json({ error: 'Full name is required' });
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    if (!isNonEmptyString(groupName, 200)) return res.status(400).json({ error: 'A group name is required' });
    if (!SUPPORTED_CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Invalid currency' });

    const passwordHash = await hashPassword(password);
    const updated = await store.completeRegistration(group.id, {
      fullName: escapeHtml(fullName.trim()),
      passwordHash,
      groupName: escapeHtml(groupName.trim()),
      currency
    });
    const sessionToken = await createSession(group.id);
    setSessionCookie(res, sessionToken);
    res.json({ success: true, account: sellerProfile(updated, await store.getBalances(group.id)) });
  });

  // ---- Seller: log in ----
  router.post('/api/seller/login', loginLimiter, async (req, res) => {
    const genericError = () => res.status(401).json({ error: 'Incorrect email or password' });
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== 'string' || !password) return genericError();

    const group = await store.getGroupByOwnerEmail(email);
    if (!group || group.registration_status !== 'active') return genericError();
    const ok = await verifyPassword(password, group.owner_password_hash);
    if (!ok) return genericError();

    const sessionToken = await createSession(group.id);
    setSessionCookie(res, sessionToken);
    res.json({ success: true });
  });

  // ---- Seller: log out ----
  router.post('/api/seller/logout', async (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await store.deleteSellerSession(token);
    clearSessionCookie(res);
    res.json({ success: true });
  });

  // ---- Seller: forgot password (step 1 — always responds the same way,
  // regardless of whether the email is on file, so this can't be used to
  // enumerate registered accounts) ----
  router.post('/api/seller/forgot-password', authLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (isValidEmail(email)) {
      const group = await store.getGroupByOwnerEmail(email);
      if (group && group.registration_status === 'active') {
        const code = generateSixDigitCode();
        const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();
        await store.createPasswordResetCode(group.id, hashCode(code), expiresAt);
        await sendPasswordResetCode(group.owner_email, code);
      }
    }
    res.json({ success: true });
  });

  // ---- Seller: forgot password (step 2 — check the code without consuming
  // it yet, so the UI can move to the "set new password" screen) ----
  router.post('/api/seller/verify-reset-code', authLimiter, async (req, res) => {
    const { email, code } = req.body || {};
    const invalid = () => res.status(400).json({ error: 'Invalid or expired code' });
    if (!isValidEmail(email) || !/^\d{6}$/.test(code || '')) return invalid();
    const group = await store.getGroupByOwnerEmail(email);
    if (!group) return invalid();
    const found = await store.findValidResetCode(group.id, hashCode(code));
    if (!found) return invalid();
    res.json({ success: true });
  });

  // ---- Seller: forgot password (step 3 — consumes the code) ----
  router.post('/api/seller/reset-password', authLimiter, async (req, res) => {
    const { email, code, newPassword } = req.body || {};
    const invalid = () => res.status(400).json({ error: 'Invalid or expired code' });
    if (!isValidEmail(email) || !/^\d{6}$/.test(code || '')) return invalid();
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const group = await store.getGroupByOwnerEmail(email);
    if (!group) return invalid();
    const consumed = await store.consumeResetCode(group.id, hashCode(code));
    if (!consumed) return invalid();
    await store.setOwnerPassword(group.id, await hashPassword(newPassword));
    res.json({ success: true });
  });

  // ================================================================
  // SELLER DASHBOARD — profile, KYC, deposits, withdrawals
  // ================================================================

  router.get('/api/seller/me', requireSellerAuth, async (req, res) => {
    const group = await store.getGroup(req.sellerGroupId);
    if (!group) return res.status(404).json({ error: 'Account not found' });
    res.json(sellerProfile(group, await store.getBalances(req.sellerGroupId)));
  });

  router.patch('/api/seller/profile', formLimiter, requireSellerAuth, async (req, res) => {
    const { fullName } = req.body || {};
    if (!isNonEmptyString(fullName, 200)) return res.status(400).json({ error: 'Full name is required' });
    const updated = await store.updateSellerProfile(req.sellerGroupId, { fullName: escapeHtml(fullName.trim()) });
    res.json({ success: true, fullName: updated.owner_full_name });
  });

  // ---- KYC submission (4 files: ID front/back, proof of address, selfie) ----
  router.post('/api/seller/kyc', uploadLimiter, requireSellerAuth, (req, res) => {
    kycUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      const { docType } = req.body || {};
      if (!DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'Invalid document type' });
      const files = req.files || {};
      if (!files.idFront || !files.proofOfAddress || !files.selfie) {
        return res.status(400).json({ error: 'ID front, proof of address, and a selfie are all required' });
      }
      if (docType !== 'passport' && !files.idBack) {
        return res.status(400).json({ error: 'Back of ID is required for this document type' });
      }
      const sub = await store.createKycSubmission({
        groupId: req.sellerGroupId,
        docType,
        idFrontUrl: files.idFront[0].filename,
        idBackUrl: files.idBack ? files.idBack[0].filename : null,
        proofOfAddressUrl: files.proofOfAddress[0].filename,
        selfieUrl: files.selfie[0].filename
      });
      io.to('admins').emit('kyc-queue-updated');
      io.to(req.sellerGroupId).emit('kyc-status-changed', { status: 'pending' });
      res.json({ success: true, submissionId: sub.id, status: sub.status });
    });
  });

  router.get('/api/seller/kyc', requireSellerAuth, async (req, res) => {
    res.json((await store.getKycSubmissions(req.sellerGroupId)).map(kycWithFileUrls));
  });

  // ---- Serves a single KYC document (photo ID / proof of address / selfie).
  // These are sensitive personal documents, so — unlike the general
  // /uploads mount — this route is never publicly listable and always
  // checks that the requester is either the seller who submitted it or an
  // authenticated admin, before streaming anything from disk. ----
  router.get('/api/kyc-file/:submissionId/:field', async (req, res) => {
    const column = KYC_FIELD_TO_COLUMN[req.params.field];
    if (!column) return res.status(400).json({ error: 'Invalid field' });
    const sub = await store.getKycSubmissionById(req.params.submissionId);
    if (!sub) return res.status(404).json({ error: 'Not found' });

    let authorized = false;
    const sessionToken = parseCookies(req)[SESSION_COOKIE];
    if (sessionToken) {
      const session = await store.getSellerSession(sessionToken);
      if (session && new Date(session.expires_at) > new Date() && session.group_id === sub.group_id) authorized = true;
    }
    if (!authorized) {
      const adminRole = resolveAdminRole(req.headers['x-admin-key'] || req.query.adminKey);
      if (hasMinRole(adminRole, 'ADMIN')) authorized = true;
    }
    if (!authorized) return res.status(403).json({ error: 'Not authorized' });

    const filename = sub[column];
    if (!filename) return res.status(404).json({ error: 'File not found' });
    const filePath = path.join(KYC_DIR, path.basename(filename)); // basename guards against path traversal
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  });

  // ---- Where a seller should actually send a deposit — configured via env
  // vars so this isn't hardcoded fake data. Falls back to an obvious
  // placeholder so it's impossible to miss in local/dev setups. ----
  router.get('/api/seller/deposit-instructions', requireSellerAuth, (req, res) => {
    res.json({
      crypto: {
        BTC: process.env.DEPOSIT_BTC_ADDRESS || 'Set DEPOSIT_BTC_ADDRESS in your environment',
        ETH: process.env.DEPOSIT_ETH_ADDRESS || 'Set DEPOSIT_ETH_ADDRESS in your environment',
        USDT_BEP20: process.env.DEPOSIT_USDT_BEP20_ADDRESS || 'Set DEPOSIT_USDT_BEP20_ADDRESS in your environment',
        USDT_TRC20: process.env.DEPOSIT_USDT_TRC20_ADDRESS || 'Set DEPOSIT_USDT_TRC20_ADDRESS in your environment'
      },
      bank: {
        bankName: process.env.DEPOSIT_BANK_NAME || 'Set DEPOSIT_BANK_NAME in your environment',
        accountNumber: process.env.DEPOSIT_BANK_ACCOUNT || 'Set DEPOSIT_BANK_ACCOUNT in your environment',
        swift: process.env.DEPOSIT_BANK_SWIFT || 'Set DEPOSIT_BANK_SWIFT in your environment',
        reference: `DEP-${req.sellerGroupId.slice(0, 8).toUpperCase()}`
      }
    });
  });

  // ---- Deposits ----
  router.post('/api/seller/deposits', formLimiter, requireSellerAuth, async (req, res) => {
    const { method, asset, network, amount } = req.body || {};
    const amt = Number(amount);
    if (!['crypto', 'bank'].includes(method)) return res.status(400).json({ error: 'Invalid method' });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
    if (method === 'crypto') {
      if (!ASSETS.includes(asset)) return res.status(400).json({ error: 'Invalid asset' });
      if (asset === 'USDT' && !NETWORKS.includes(network)) return res.status(400).json({ error: 'Select a network for USDT' });
    }

    await store.lockCurrencyIfNeeded(req.sellerGroupId);
    const dep = await store.createDeposit({
      groupId: req.sellerGroupId,
      method,
      asset: method === 'crypto' ? asset : null,
      network: method === 'crypto' && asset === 'USDT' ? network : null,
      amount: amt
    });
    const balances = await store.getBalances(req.sellerGroupId);
    io.to(req.sellerGroupId).emit('deposit-created', { deposit: dep, balances });
    io.to('admins').emit('deposit-queue-updated');
    res.json({ success: true, deposit: dep, balances });
  });

  router.get('/api/seller/deposits', requireSellerAuth, async (req, res) => {
    res.json(await store.getDeposits(req.sellerGroupId));
  });

  // ---- Withdrawals ----
  router.post('/api/seller/withdrawals', formLimiter, requireSellerAuth, async (req, res) => {
    const group = await store.getGroup(req.sellerGroupId);
    if (!group) return res.status(404).json({ error: 'Account not found' });
    if (group.kyc_status !== 'verified') {
      return res.status(403).json({ error: 'Identity verification is required before you can withdraw funds' });
    }

    const { method, asset, network, walletAddress, amount, amountCurrency, bankDetails } = req.body || {};
    const enteredAmt = Number(amount);
    if (!Number.isFinite(enteredAmt) || enteredAmt <= 0) return res.status(400).json({ error: 'Enter a valid amount' });

    let destination = null;
    let ledgerAmount = enteredAmt;
    let enteredCurrency = null;
    let amountUsdEquiv = null;

    if (method === 'crypto') {
      if (!ASSETS.includes(asset)) return res.status(400).json({ error: 'Invalid asset' });
      if (asset === 'USDT' && !NETWORKS.includes(network)) return res.status(400).json({ error: 'Select a network for USDT' });
      if (!isNonEmptyString(walletAddress, 200)) return res.status(400).json({ error: 'Wallet address is required' });
      if (!SUPPORTED_CURRENCIES.includes(amountCurrency)) return res.status(400).json({ error: 'Invalid currency' });
      destination = { walletAddress: escapeHtml(walletAddress.trim()) };
      // The seller may enter the amount in a currency other than their
      // account's ledger currency (a display convenience) — convert to the
      // ledger currency for the actual balance check/deduction, and keep
      // the original entry + a USD reference alongside for the audit trail.
      if (amountCurrency !== group.currency) {
        ledgerAmount = convert(enteredAmt, amountCurrency, group.currency);
        enteredCurrency = amountCurrency;
      }
      amountUsdEquiv = Number(convert(enteredAmt, amountCurrency, 'USD').toFixed(2));
    } else if (method === 'bank') {
      const b = bankDetails || {};
      if (!isNonEmptyString(b.beneficiaryName, 200) || !isNonEmptyString(b.bankName, 200) ||
          !isNonEmptyString(b.accountNumber, 100) || !isNonEmptyString(b.swift, 50) || !isNonEmptyString(b.country, 100)) {
        return res.status(400).json({ error: 'All bank details are required' });
      }
      destination = {
        beneficiaryName: escapeHtml(b.beneficiaryName.trim()),
        bankName: escapeHtml(b.bankName.trim()),
        accountNumber: escapeHtml(b.accountNumber.trim()),
        swift: escapeHtml(b.swift.trim()),
        country: escapeHtml(b.country.trim())
      };
      // Bank withdrawals are always denominated in the account's own currency.
    } else {
      return res.status(400).json({ error: 'Invalid method' });
    }

    const balances = await store.getBalances(req.sellerGroupId);
    if (ledgerAmount > balances.available) {
      return res.status(400).json({ error: 'That amount is more than your available balance' });
    }

    const wd = await store.createWithdrawal({
      groupId: req.sellerGroupId,
      method,
      asset: method === 'crypto' ? asset : null,
      network: method === 'crypto' && asset === 'USDT' ? network : null,
      destination,
      amount: ledgerAmount,
      amountCurrency: group.currency,
      enteredAmount: enteredCurrency ? enteredAmt : null,
      enteredCurrency,
      amountUsdEquiv
    });
    io.to(req.sellerGroupId).emit('withdrawal-created', { withdrawal: wd });
    io.to('admins').emit('withdrawal-queue-updated');
    res.json({ success: true, withdrawal: wd });
  });

  router.get('/api/seller/withdrawals', requireSellerAuth, async (req, res) => {
    res.json(await store.getWithdrawals(req.sellerGroupId));
  });

  // ---- Combined transaction feed (deposits + withdrawals), newest first ----
  router.get('/api/seller/transactions', requireSellerAuth, async (req, res) => {
    const [deposits, withdrawals] = await Promise.all([
      store.getDeposits(req.sellerGroupId),
      store.getWithdrawals(req.sellerGroupId)
    ]);
    const combined = [
      ...deposits.map(d => ({ kind: 'deposit', id: d.id, reference: d.reference, method: d.method, asset: d.asset, network: d.network, amount: d.amount, status: d.status, createdAt: d.created_at })),
      ...withdrawals.map(w => ({ kind: 'withdrawal', id: w.id, reference: w.reference, method: w.method, asset: w.asset, network: w.network, amount: w.amount, status: w.status, createdAt: w.created_at }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(combined);
  });

  // ================================================================
  // ADMIN — KYC review, deposit verification, withdrawal processing
  // ================================================================

  router.get('/api/admin/kyc-queue', requireAdmin, async (req, res) => {
    res.json((await store.getKycQueue()).map(kycWithFileUrls));
  });

  router.post('/api/admin/kyc/:id/review', formLimiter, requireAdmin, async (req, res) => {
    const { status, reason } = req.body || {};
    if (!['verified', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (status === 'rejected' && !isNonEmptyString(reason, 500)) {
      return res.status(400).json({ error: 'A reason is required when rejecting' });
    }
    const adminRole = resolveAdminRole(req.headers['x-admin-key'] || req.query.adminKey);
    const result = await store.reviewKyc(req.params.id, { status, reviewedBy: adminRole, rejectionReason: reason });
    if (!result) return res.status(404).json({ error: 'Submission not found' });
    const { groupId, group } = result;
    io.to(groupId).emit('kyc-status-changed', { status });
    io.to('admins').emit('kyc-queue-updated');
    if (group && group.owner_email) await notifyKycStatus(group.owner_email, { status, reason });
    res.json({ success: true });
  });

  router.get('/api/admin/deposits-queue', requireAdmin, async (req, res) => {
    res.json(await store.getDepositQueue());
  });

  router.post('/api/admin/deposits/:id/review', formLimiter, requireAdmin, async (req, res) => {
    const { status, reason } = req.body || {};
    if (!['verified', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (status === 'rejected' && !isNonEmptyString(reason, 500)) {
      return res.status(400).json({ error: 'A reason is required when rejecting' });
    }
    const adminRole = resolveAdminRole(req.headers['x-admin-key'] || req.query.adminKey);
    const result = await store.reviewDeposit(req.params.id, { status, reviewedBy: adminRole, rejectionReason: reason });
    if (!result) return res.status(404).json({ error: 'Deposit not found' });
    if (result.noop) return res.json({ success: true, note: 'Already reviewed' });
    const { groupId, group, deposit } = result;
    const balances = await store.getBalances(groupId);
    io.to(groupId).emit('deposit-status-changed', { deposit, balances });
    io.to('admins').emit('deposit-queue-updated');
    if (group && group.owner_email) {
      await notifyDepositStatus(group.owner_email, { status, amount: deposit.amount, currency: group.currency, reason });
    }
    res.json({ success: true });
  });

  router.get('/api/admin/withdrawals-queue', requireAdmin, async (req, res) => {
    res.json(await store.getWithdrawalQueue());
  });

  router.post('/api/admin/withdrawals/:id/status', formLimiter, requireAdmin, async (req, res) => {
    const { status, reason } = req.body || {};
    const allValid = Object.values(WITHDRAWAL_TRANSITIONS).some(list => list.includes(status));
    if (!allValid) return res.status(400).json({ error: 'Invalid status' });
    if ((status === 'rejected' || status === 'failed') && !isNonEmptyString(reason, 500)) {
      return res.status(400).json({ error: 'A reason is required when declining or failing a withdrawal' });
    }
    const adminRole = resolveAdminRole(req.headers['x-admin-key'] || req.query.adminKey);
    let result;
    try {
      result = await store.advanceWithdrawal(req.params.id, { status, reason, adminId: adminRole });
    } catch (err) {
      return res.status(409).json({ error: err.message });
    }
    if (!result) return res.status(404).json({ error: 'Withdrawal not found' });
    if (result.noop) return res.json({ success: true, note: 'Already at a final status' });
    const { groupId, group, withdrawal } = result;
    const balances = await store.getBalances(groupId);
    io.to(groupId).emit('withdrawal-status-changed', { withdrawal, balances });
    io.to('admins').emit('withdrawal-queue-updated');
    if (group && group.owner_email) {
      await notifyWithdrawalStatus(group.owner_email, { status, amount: withdrawal.amount, currency: withdrawal.amount_currency, reason });
    }
    res.json({ success: true });
  });

  // ---- Admin: full finance detail for one group (dashboard drill-in) ----
  router.get('/api/admin/groups/:id/finance', requireAdmin, async (req, res) => {
    const group = await store.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const [balances, deposits, withdrawals, kyc] = await Promise.all([
      store.getBalances(req.params.id),
      store.getDeposits(req.params.id),
      store.getWithdrawals(req.params.id),
      store.getKycSubmissions(req.params.id)
    ]);
    res.json({ profile: sellerProfile(group, balances), deposits, withdrawals, kyc });
  });

  return router;
}

module.exports = { buildRouter };
