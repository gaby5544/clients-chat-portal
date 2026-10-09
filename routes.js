const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { store } = require('./db');
const { validateTransactionForm, escapeHtml, isValidEmail, hashPassword, verifyPassword, isStrongEnoughPassword, generateSixDigitCode, hashCode, clientIpFrom } = require('./security');
const { generateTransactionPdf, generateFundsReceiptPdf } = require('./pdfReceipt');
const F = require('./finance');
const { resolveAdminRole, hasMinRole } = require('./roles');
const { getPublicKey } = require('./webpush');
const { notifyPasswordResetCode, notifyRegistrationCode, emailStatus } = require('./email');
const { translateText, translateMany, translationStatus } = require('./translator');
const { TERMS_VERSION, TERMS_SECTIONS, TERMS_CHECKBOX_LABEL, COMPLAINTS_EMAIL, SUPPORT_EMAIL } = require('./terms');
const { recordSellerIp, isIpBlocked } = require('./accountHandlers');
const LA = require('./loginAlert');
const Links = require('./links');
const vault = require('./vault');
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
const translateLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
// Wrong reset-code guesses per account (in addition to the per-IP limiter above).
const resetGuesses = new Map(); // groupId -> { n, until }
const RESET_MAX_GUESSES = 5;
const RESET_LOCK_MS = 10 * 60 * 1000;
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
    if (!rec || (kind === 'incoming' && !['credited', 'held_in_vault'].includes(rec.status)) || (kind === 'withdrawal' && rec.status !== 'completed')) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    const group = await store.getGroup(rec.group_id);
    if (!group) return res.status(404).json({ error: 'Receipt not found' });
    const record = kind === 'incoming' ? F.publicIncoming(rec, false, group.seller_account_id, group.seller_phone) : F.publicWithdrawal(rec);
    generateFundsReceiptPdf(res, { kind, record, group });
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

  // One email can own several Transaction Accounts (one per group). Sign-in therefore checks the
  // password against every account on that email and, if more than one matches, lets the seller pick.
  router.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== 'string' || !password) return res.status(400).json(BAD_LOGIN);
    const all = await store.findGroupsBySellerEmail(email.trim());
    if (!all.length) {
      // Not a seller — is it a buyer who created an account in the app?
      const lower = email.trim().toLowerCase();
      const buyers = (await store.getAllGroups()).filter((g) => g.email_a && g.email_a.toLowerCase() === lower && Links.flagsOf(g).buyerPwHash && verifyPassword(password, Links.flagsOf(g).buyerPwHash));
      if (!buyers.length) return res.status(401).json(BAD_LOGIN);
      const open = buyers.filter((g) => !Links.flagsOf(g).buyerLinkRevoked);
      if (!open.length) return res.status(410).json({ error: `This link has expired. Please contact us at ${SUPPORT_EMAIL}.`, code: 'link_expired' });
      const g = open.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
      return res.json({ success: true, ok: true, role: 'BUYER', groupId: g.id, sessionToken: require('crypto').randomUUID() });
    }
    // Accounts whose seller link was expired by the Desk (user deleted) can no longer sign in.
    const matches = all.filter((g) => !Links.flagsOf(g).sellerLinkRevoked);
    if (!matches.length) return res.status(410).json({ error: `This link has expired. Please contact us at ${SUPPORT_EMAIL}.`, code: 'link_expired' });
    const ip = clientIpFrom(req.headers, req.socket && req.socket.remoteAddress);
    const now = new Date();
    const open = matches.filter((g) => !(g.seller_locked_until && new Date(g.seller_locked_until) > now));
    if (!open.length) return res.status(423).json({ error: 'Too many failed attempts. Please try again later.' });
    const valid = open.filter((g) => verifyPassword(password, g.seller_password_hash));
    if (!valid.length) {
      for (const g of open) {
        const fails = (g.seller_failed_logins || 0) + 1;
        const fields = { seller_failed_logins: fails };
        if (fails >= LOGIN_LOCKOUT_AFTER) { fields.seller_locked_until = new Date(Date.now() + LOGIN_LOCKOUT_MS).toISOString(); fields.seller_failed_logins = 0; }
        await store.updateGroup(g.id, fields);
      }
      return res.status(401).json(BAD_LOGIN);
    }
    // Correct password from here on, so it is safe to say why access is refused.
    const allowed = valid.filter((g) => !isIpBlocked(g, ip));
    if (!allowed.length) return res.status(403).json({ error: `Access from this network location has been disabled for this account. Please contact ${COMPLAINTS_EMAIL}.`, code: 'ip_blocked' });
    const sessionToken = uuidv4();
    for (const g of allowed) { await store.updateGroup(g.id, { seller_failed_logins: 0, seller_locked_until: null }); await recordSellerIp(g.id, ip, 'login'); LA.sendLoginAlert(g, ip, { ua: req.headers['user-agent'], source: 'password', baseUrl: (req.headers && req.headers.host) ? `${req.protocol || 'https'}://${req.headers.host}` : undefined }).catch(() => {}); }
    const shape = (g) => ({ groupId: g.id, groupName: g.name, accountId: g.seller_account_id || null, language: g.seller_language || 'en', disabled: !!g.seller_disabled });
    // A disabled account can still sign in, so the seller sees WHY it is disabled and how to complain.
    if (allowed.length === 1) {
      const g = allowed[0];
      return res.json({ success: true, groupId: g.id, sessionToken, groupName: g.name, language: g.seller_language || 'en', disabled: !!g.seller_disabled, complaintsEmail: COMPLAINTS_EMAIL });
    }
    res.json({ success: true, multiple: true, sessionToken, accounts: allowed.map(shape), complaintsEmail: COMPLAINTS_EMAIL });
  });

  // ---- App "Create account": find the transaction the email belongs to, verify it, set a password (buyers) ----
  const findParty = async (email, role) => {
    const lower = String(email || '').trim().toLowerCase(); const field = role === 'BUYER' ? 'email_a' : 'email_b';
    const hits = (await store.getAllGroups()).filter((g) => g[field] && g[field].toLowerCase() === lower);
    return hits.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  };
  const NO_DEAL = `We could not find a transaction for this email address. Please use the exact email your Desk Officer registered, open your invitation link, or contact ${SUPPORT_EMAIL}.`;
  router.post('/api/app/lookup', loginLimiter, async (req, res) => {
    const { email, role } = req.body || {};
    if (!isValidEmail(email) || !['BUYER', 'SELLER'].includes(role)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const hits = await findParty(email, role);
    if (!hits.length) return res.status(404).json({ error: NO_DEAL });
    const live = hits.filter((g) => !Links.flagsOf(g)[role === 'BUYER' ? 'buyerLinkRevoked' : 'sellerLinkRevoked']);
    if (!live.length) return res.status(410).json({ error: `This link has expired. Please contact us at ${SUPPORT_EMAIL}.`, code: 'link_expired' });
    const g = live[0];
    const exists = role === 'BUYER' ? !!Links.flagsOf(g).buyerPwHash : !!g.seller_registered;
    res.json({ ok: true, groupId: g.id, exists });
  });
  router.post('/api/buyer/request-code', loginLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const hits = (await findParty(email, 'BUYER')).filter((g) => !Links.flagsOf(g).buyerLinkRevoked);
    if (!hits.length) return res.status(404).json({ error: NO_DEAL });
    const code = generateSixDigitCode();
    await store.setSetting('bcode:' + email.trim().toLowerCase(), JSON.stringify({ hash: hashCode(code), exp: Date.now() + 10 * 60 * 1000, tries: 0 }));
    const nm = hits[0].custom_name_a && !/^(buyer|seller|client)$/i.test(hits[0].custom_name_a) ? hits[0].custom_name_a : undefined;
    const r = await notifyRegistrationCode(email.trim(), { code, name: nm });
    if (r && r.ok === false) return res.status(502).json(emailFailBody(r));
    res.json({ ok: true });
  });
  router.post('/api/buyer/register', loginLimiter, async (req, res) => {
    const { email, code, password } = req.body || {};
    if (!isValidEmail(email) || typeof code !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Please complete every field.' });
    if (!isStrongEnoughPassword(password)) return res.status(400).json({ error: 'Choose a stronger password: at least 8 characters with letters and numbers.' });
    const key = 'bcode:' + email.trim().toLowerCase();
    let rec = null; try { rec = JSON.parse(await store.getSetting(key, 'null')); } catch (e) { rec = null; }
    if (!rec || Date.now() > rec.exp) return res.status(400).json({ error: 'That code has expired. Please request a new one.' });
    if (rec.tries >= 5) return res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
    if (hashCode(String(code).trim()) !== rec.hash) { rec.tries += 1; await store.setSetting(key, JSON.stringify(rec)); return res.status(400).json({ error: 'That code is not correct.' }); }
    const hits = (await findParty(email, 'BUYER')).filter((g) => !Links.flagsOf(g).buyerLinkRevoked);
    if (!hits.length) return res.status(404).json({ error: NO_DEAL });
    for (const g of hits) await store.updateGroup(g.id, { group_flags: { ...Links.flagsOf(g), buyerPwHash: hashPassword(password), buyerAccountAt: new Date().toISOString() } });
    await store.setSetting(key, 'null');
    res.json({ ok: true, groupId: hits[0].id, sessionToken: require('crypto').randomUUID() });
  });

  // Company contact details for the sign-in screen and the "link expired" page.
  router.get('/api/contact', (req, res) => res.json({ support: SUPPORT_EMAIL, complaints: COMPLAINTS_EMAIL }));
  router.get('/install', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'install.html')));

  // ---- "Was this you?" links from the new-sign-in email ----
  const secPage = (title, msg, ok) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="margin:0;background:#050203;color:#e5e7eb;font-family:Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px"><div style="max-width:480px;background:#140b0d;border:1px solid #3d3218;border-top:3px solid ${ok ? '#34d399' : '#d4af37'};border-radius:6px;padding:34px 28px;text-align:center"><div style="font:400 22px Georgia,serif;letter-spacing:6px;color:#fff;text-transform:uppercase;margin-bottom:18px">Vistra</div><h1 style="font:400 24px Georgia,serif;color:#fffdfa;margin:0 0 12px">${title}</h1><p style="line-height:1.75;font-size:15px;color:#d1d5db;margin:0">${msg}</p><p style="font-size:12px;color:#6b7280;margin-top:22px">Support: ${SUPPORT_EMAIL}</p></div></body></html>`;
  router.get('/security/login/:token/:decision', async (req, res) => {
    res.set('Cache-Control', 'no-store').type('html');
    const d = LA.readToken(req.params.token);
    const g = d && await store.getGroup(d.g);
    if (!g) return res.status(410).send(secPage('Link no longer valid', 'This security link has expired or has already been used. If you are concerned about your account, please contact Support.', false));
    const flags = LA.flagsOf(g); const stamp = new Date().toISOString();
    if (req.params.decision === 'yes') {
      const trusted = Array.from(new Set([...(flags.trustedIps || []), d.i])).slice(-25);
      await store.updateGroup(g.id, { group_flags: { ...flags, trustedIps: trusted } });
      return res.send(secPage('Thank you — confirmed', 'We have noted that this sign-in was you. No further action is needed and your account remains fully secure.', true));
    }
    if (req.params.decision === 'no') {
      const cur = typeof g.seller_blocked_ips === 'string' ? JSON.parse(g.seller_blocked_ips || '[]') : (g.seller_blocked_ips || []);
      const blocked = Array.from(new Set([...cur, d.i]));
      const reports = [...(flags.securityReports || []), { at: stamp, ip: d.i, decision: 'not-me' }].slice(-20);
      await store.updateGroup(g.id, { seller_blocked_ips: blocked, seller_locked_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), group_flags: { ...flags, securityReports: reports } });
      if (g.email_b) { const code = generateSixDigitCode(); await store.createPasswordReset({ groupId: g.id, codeHash: hashCode(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).catch(() => {}); notifyPasswordResetCode(g.email_b, { code, lang: g.seller_language }).catch(() => {}); }
      return res.send(secPage('Your account has been secured', 'Thank you for letting us know. We have blocked that network address and paused sign-in for 24 hours. We have also emailed you a code so you can choose a new password. Our team has been alerted and will review your account.', false));
    }
    res.status(404).send(secPage('Not found', 'This link is not valid.', false));
  });

  function emailFailBody(r) {
    return r.error === 'not_configured'
      ? { error: 'Our email service is not set up yet, so we cannot send the code. Please contact the Desk Officer.' }
      : { error: 'We could not send the email right now. Please try again in a minute.' };
  }

  router.post('/api/auth/forgot-password/request', resetLimiter, async (req, res) => {
    const { email } = req.body || {};
    // Never reveal whether an account exists for a given address.
    if (!isValidEmail(email)) return res.json({ success: true });
    const matches = await store.findGroupsBySellerEmail(email.trim());
    if (matches.length) {
      const code = generateSixDigitCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      for (const g of matches) { await store.createPasswordReset({ groupId: g.id, codeHash: hashCode(code), expiresAt }); resetGuesses.delete(g.id); }
      const first = matches[0];
      const sent = await notifyPasswordResetCode(first.email_b, { code, groupName: matches.length > 1 ? `${matches.length} accounts on this email` : first.name, lang: first.seller_language });
      if (!sent.ok) return res.status(sent.error === 'not_configured' ? 503 : 502).json(emailFailBody(sent));
    }
    res.json({ success: true });
  });

  router.post('/api/auth/forgot-password/verify', resetLimiter, async (req, res) => {
    const { email, code } = req.body || {};
    if (!isValidEmail(email) || !/^\d{6}$/.test(String(code || ''))) return res.status(400).json({ error: 'Invalid code.' });
    const matches = await store.findGroupsBySellerEmail(email.trim());
    if (!matches.length) return res.status(400).json({ error: 'Invalid or expired code.' });
    if (matches.every((g) => (resetGuesses.get(g.id) || { until: 0 }).until > Date.now())) return res.status(429).json({ error: 'Too many incorrect codes. Please wait a few minutes or request a new code.' });
    const resets = [];
    for (const g of matches) {
      const r = await store.getLatestPasswordReset(g.id);
      if (r && new Date(r.expires_at) >= new Date() && r.code_hash === hashCode(code)) resets.push(r);
    }
    if (!resets.length) {
      for (const g of matches) {
        const gs = resetGuesses.get(g.id) || { n: 0, until: 0 };
        gs.n += 1; if (gs.n >= RESET_MAX_GUESSES) { gs.n = 0; gs.until = Date.now() + RESET_LOCK_MS; }
        resetGuesses.set(g.id, gs);
      }
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }
    matches.forEach((g) => resetGuesses.delete(g.id));
    const resetToken = uuidv4();
    for (const r of resets) await store.setPasswordResetToken(r.id, resetToken);
    res.json({ success: true, resetToken });
  });

  router.post('/api/auth/forgot-password/reset', resetLimiter, async (req, res) => {
    const { email, resetToken, newPassword } = req.body || {};
    if (!isValidEmail(email) || !resetToken || !isStrongEnoughPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const matches = await store.findGroupsBySellerEmail(email.trim());
    let changed = 0; const enc = await vault.encrypt(newPassword);
    for (const g of matches) {
      const consumed = await store.consumePasswordResetByToken(g.id, resetToken);
      if (!consumed) continue;
      await store.updateGroup(g.id, { seller_password_hash: hashPassword(newPassword), seller_password_enc: enc, seller_password_changed_at: new Date().toISOString(), seller_failed_logins: 0, seller_locked_until: null });
      changed++;
    }
    if (!changed) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    res.json({ success: true, accountsUpdated: changed });
  });

  // ---- Translation (server-side, cached, with provider fallback) ----
  router.post('/api/translate', translateLimiter, async (req, res) => {
    const { text, target, source } = req.body || {};
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) return res.status(400).json({ error: 'Provide text up to 5,000 characters.' });
    if (typeof target !== 'string' || !/^[a-zA-Z-]{2,7}$/.test(target)) return res.status(400).json({ error: 'Invalid target language.' });
    const r = await translateText(text, target, typeof source === 'string' && /^[a-zA-Z-]{2,7}$/.test(source) ? source : 'auto');
    res.json({ text: r.text, detected: r.detected, ok: r.ok });
  });
  router.post('/api/translate/batch', translateLimiter, async (req, res) => {
    const { texts, target, source } = req.body || {};
    if (!Array.isArray(texts) || !texts.length || texts.length > 80) return res.status(400).json({ error: 'Provide 1–80 strings.' });
    if (typeof target !== 'string' || !/^[a-zA-Z-]{2,7}$/.test(target)) return res.status(400).json({ error: 'Invalid target language.' });
    const clean = texts.map((x) => String(x == null ? '' : x).slice(0, 1500));
    if (clean.reduce((n, x) => n + x.length, 0) > 30000) return res.status(400).json({ error: 'Too much text in one request.' });
    const out = await translateMany(clean, target, typeof source === 'string' && /^[a-zA-Z-]{2,7}$/.test(source) ? source : 'auto');
    res.json({ results: out.map((r) => r.text), ok: out.every((r) => r.ok) });
  });

  router.get('/api/terms', (req, res) => res.json({ version: TERMS_VERSION, sections: TERMS_SECTIONS, checkboxLabel: TERMS_CHECKBOX_LABEL, complaintsEmail: COMPLAINTS_EMAIL, supportEmail: SUPPORT_EMAIL }));

  router.get('/api/health', (req, res) => res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: require('./package.json').version,
    build: 'funds-desk-2026-10',
    email: emailStatus(),
    translation: translationStatus()
  }));

  return router;
}

module.exports = { buildRouter };
