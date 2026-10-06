// Seller Transaction Account — registration, security, KYC, business upgrade,
// withdrawals and every admin control that touches an account. (Money movement
// for incoming funds and the withdrawal status machine live in fundsHandlers.js;
// live payment tracking lives in tracking.js.)

const crypto = require('crypto');
const { store } = require('./db');
const {
  sanitizeText, escapeHtml, isValidEmail, hashPassword, isStrongEnoughPassword, generateSixDigitCode, hashCode,
  RateLimiter, normalizePhone, clientIpFrom, maskEmail
} = require('./security');
const F = require('./finance');
const C = require('./compliance');
const { TERMS_VERSION, TERMS_SECTIONS, TERMS_CHECKBOX_LABEL, COMPLAINTS_EMAIL } = require('./terms');
const QC = require('./public/countries');
const QL = require('./public/languages');
const E = require('./email');
const { pushSellerState, pushAdminLedger, emitSnapshotTo, alertSellerOffline } = require('./fundsHandlers');
const vault = require('./vault');
const EMAIL_DEV_ECHO = String(process.env.EMAIL_DEV_ECHO_CODES || '').toLowerCase() === 'true';
function emailFailMessage(r) {
  if (r && r.error === 'not_configured') return 'Our email service is not set up yet, so we cannot send your code. Please contact the Desk Officer.';
  return 'We could not send the email right now. Please check the address and try again in a minute — if it keeps failing, contact the Desk Officer.';
}

const limiter = new RateLimiter({ windowMs: 60000, max: Number(process.env.ACCOUNT_RATE_MAX) || 30 });
const codeLimiter = new RateLimiter({ windowMs: 60000, max: 4 });
setInterval(() => { limiter.sweep(); codeLimiter.sweep(); }, 60000).unref();

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_COOLDOWN_MS = 30 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const UPLOAD_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
const KYC_DOC_TYPES = new Set(['national_id', 'drivers_license', 'passport']);
const PROOF_ADDRESS_TYPES = new Set(['bank_statement', 'utility_bill', 'electricity_bill', 'council_tax', 'other']);
const KYC_AUTO_APPROVE = String(process.env.KYC_AUTO_APPROVE || '').toLowerCase() === 'true';
const IP_LOG_MAX = 50;

const pendingWithdrawals = new Map();   // sessionToken -> { groupId, draft, codeHash, expires, attempts, issuedAt }

function jsonOf(v, fb) {
  if (v === null || v === undefined) return fb;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fb; } }
  return v;
}
function ipOfSocket(socket) {
  return clientIpFrom(socket.handshake && socket.handshake.headers, socket.handshake && socket.handshake.address);
}
const ipOk = (s) => typeof s === 'string' && /^[0-9a-fA-F:.]{3,64}$/.test(s);

async function generateAccountId() {
  for (let i = 0; i < 25; i++) {
    const id = String(crypto.randomInt(1, 10)) + String(crypto.randomInt(0, 1e10)).padStart(10, '0');   // 11 digits, never starts with 0
    if (!(await store.findGroupByAccountId(id))) return id;
  }
  throw new Error('Could not allocate a unique account ID');
}

async function recordSellerIp(groupId, ip, event) {
  if (!ip || ip === 'unknown') return;
  const g = await store.getGroup(groupId);
  if (!g) return;
  const log = jsonOf(g.seller_ip_log, []).slice();
  const now = new Date().toISOString();
  let row = log.find((r) => r.ip === ip);
  if (!row) { row = { ip, firstSeen: now, lastSeen: now, count: 0, events: [] }; log.push(row); }
  row.lastSeen = now; row.count += 1;
  if (!row.events.includes(event)) row.events.push(event);
  while (log.length > IP_LOG_MAX) log.shift();
  await store.updateGroup(groupId, { seller_ip_log: log });
}
const isIpBlocked = (g, ip) => jsonOf(g.seller_blocked_ips, []).includes(ip);

function ccyOf(g) { return g.seller_currency || 'USD'; }
const SYMBOL = { USD: '$', GBP: '£', EUR: '€' };
function money(n, c) {
  const s = Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return SYMBOL[c] ? `${SYMBOL[c]}${s}` : `${s} ${c}`;
}

async function cryptoPolicy() { return C.sanitizePolicy(await store.getSetting(C.SETTING_KEY_CRYPTO, null)); }

async function verifiedCryptoDepositsUsd(group) {
  const deps = await store.getDepositsForGroup(group.id);
  const sum = deps.filter((d) => d.method === 'crypto' && d.status === 'verified').reduce((s, d) => s + Number(d.amount), 0);
  return F.convertCurrency(sum, ccyOf(group), 'USD');
}

/** Load the dashboard-saved email settings (decrypting secrets) into the mailer. */
async function applyEmailSettings(cfg) {
  if (!cfg) return E.setRuntimeConfig(null);
  const out = { provider: cfg.provider, from: cfg.from };
  if (cfg.apiKeyEnc) out.apiKey = await vault.decrypt(cfg.apiKeyEnc);
  if (cfg.smtp) out.smtp = { host: cfg.smtp.host, port: cfg.smtp.port, service: cfg.smtp.service, user: cfg.smtp.user, pass: await vault.decrypt(cfg.smtp.passEnc) };
  E.setRuntimeConfig(out);
}
async function loadEmailSettings() { try { await applyEmailSettings(await store.getSetting('email_config', null)); } catch (e) { console.error('[email] could not load saved settings:', e.message); } }

function registerAccountHandlers(io, socket, ctx) {
  const { meta, metaHasMinRole, requireSellerOwnGroup, broadcastGroupsList, postDeskMessage } = ctx;

  const tooFast = () => { socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.'); };

  /** A seller acting on their own group, with the disabled / blocked-IP gates applied. */
  async function activeSeller(groupId, { allowDisabled = false } = {}) {
    const group = await requireSellerOwnGroup(groupId);
    if (!group) return null;
    if (!limiter.allow(meta().sessionToken)) { tooFast(); return null; }
    if (group.seller_registered && isIpBlocked(group, ipOfSocket(socket))) {
      socket.emit('ip-blocked', { message: 'Access from this network location has been disabled for your account. Please contact ' + COMPLAINTS_EMAIL + '.' });
      return null;
    }
    if (!allowDisabled && group.seller_disabled) {
      socket.emit('error-msg', 'Your account is disabled. Contact ' + COMPLAINTS_EMAIL + ' to resolve this.');
      socket.emit('seller-account-state', F.publicSellerAccount(group));
      return null;
    }
    return group;
  }
  const lang = (g) => g.seller_language || 'en';
  const adminAccount = (g) => F.publicSellerAccount(g, { forAdmin: true });

  // ------------------------------------------------------------------
  // Terms & languages (public reference data)
  // ------------------------------------------------------------------
  socket.on('get-terms', () => {
    socket.emit('terms-content', { version: TERMS_VERSION, sections: TERMS_SECTIONS, checkboxLabel: TERMS_CHECKBOX_LABEL, complaintsEmail: COMPLAINTS_EMAIL });
  });

  socket.on('set-my-language', async ({ language }) => {
    const m = meta();
    if (!m) return;
    if (!QL.isSupported(language)) return socket.emit('error-msg', 'That language is not available.');
    try {
      await store.upsertUser({ sessionToken: m.sessionToken, language });
      if (!m.isAdmin && m.role === 'PARTY B') {
        const group = await store.getGroup(m.groupId);
        if (group && group.seller_session_token === m.sessionToken && group.seller_registered) {
          await store.updateGroup(group.id, { seller_language: language });
          const fresh = await store.getGroup(group.id);
          socket.emit('seller-account-state', F.publicSellerAccount(fresh));
          io.to('finance-admins').emit('seller-account-updated', adminAccount(fresh));
        }
      }
      socket.emit('language-saved', { language });
    } catch (err) { console.error('[set-my-language]', err); }
  });

  // ------------------------------------------------------------------
  // Registration: email verification code
  // ------------------------------------------------------------------
  socket.on('request-registration-email-code', async ({ groupId, email }) => {
    try {
      const m = meta();
      const group = await requireSellerOwnGroup(groupId);
      if (!group) return;
      if (!codeLimiter.allow(m.sessionToken)) return tooFast();
      if (group.seller_registered) return socket.emit('error-msg', 'This Transaction Account has already been created.');
      if (!isValidEmail(email)) return socket.emit('error-msg', 'Please enter a valid email address.');
      const target = email.trim().toLowerCase();
      if (group.reg_email_code_expires) {
        const issuedAt = new Date(group.reg_email_code_expires).getTime() - CODE_TTL_MS;
        if (Date.now() - issuedAt < CODE_COOLDOWN_MS && group.reg_email_target === target) {
          return socket.emit('error-msg', `Please wait ${Math.ceil((CODE_COOLDOWN_MS - (Date.now() - issuedAt)) / 1000)} seconds before requesting another code.`);
        }
      }
      const code = generateSixDigitCode();
      await store.updateGroup(group.id, {
        reg_email_target: target, reg_email_code_hash: hashCode(code), reg_email_code_expires: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        reg_email_code_attempts: 0, reg_email_verified: false
      });
      const u = await store.getUser(m.sessionToken);
      const sent = await E.notifyRegistrationCode(target, { code, groupName: group.name, lang: (u && u.language) || 'en' });
      if (!sent.ok) {
        // Only echo the code on screen for test setups that explicitly opted in AND have no real provider.
        if (EMAIL_DEV_ECHO && sent.error === 'not_configured') return socket.emit('registration-email-code-sent', { email: target, masked: maskEmail(target), expiresInSec: CODE_TTL_MS / 1000, cooldownSec: CODE_COOLDOWN_MS / 1000, devCode: code });
        await store.updateGroup(group.id, { reg_email_code_hash: null, reg_email_code_expires: null });
        socket.emit('registration-email-failed', { message: emailFailMessage(sent) });
        return;
      }
      socket.emit('registration-email-code-sent', { email: target, masked: maskEmail(target), expiresInSec: CODE_TTL_MS / 1000, cooldownSec: CODE_COOLDOWN_MS / 1000 });
    } catch (err) { console.error('[request-registration-email-code]', err); socket.emit('error-msg', 'We could not send the code. Please try again.'); }
  });

  socket.on('verify-registration-email', async ({ groupId, email, code }) => {
    try {
      const group = await requireSellerOwnGroup(groupId);
      if (!group) return;
      if (!limiter.allow(meta().sessionToken)) return tooFast();
      const target = String(email || '').trim().toLowerCase();
      if (!group.reg_email_code_hash || group.reg_email_target !== target) return socket.emit('registration-email-result', { ok: false, error: 'Please request a verification code for this email address first.' });
      if (Number(group.reg_email_code_attempts || 0) >= MAX_CODE_ATTEMPTS) return socket.emit('registration-email-result', { ok: false, error: 'Too many incorrect attempts. Please request a new code.' });
      if (!group.reg_email_code_expires || new Date(group.reg_email_code_expires).getTime() < Date.now()) return socket.emit('registration-email-result', { ok: false, error: 'That code has expired. Please request a new one.' });
      if (!/^\d{6}$/.test(String(code || '').trim())) return socket.emit('registration-email-result', { ok: false, error: 'Enter the 6-digit code from your email.' });
      if (hashCode(String(code).trim()) !== group.reg_email_code_hash) {
        const attempts = Number(group.reg_email_code_attempts || 0) + 1;
        await store.updateGroup(group.id, { reg_email_code_attempts: attempts });
        return socket.emit('registration-email-result', { ok: false, error: attempts >= MAX_CODE_ATTEMPTS ? 'Too many incorrect attempts. Please request a new code.' : `That code is not correct. ${MAX_CODE_ATTEMPTS - attempts} attempt${MAX_CODE_ATTEMPTS - attempts === 1 ? '' : 's'} left.` });
      }
      await store.updateGroup(group.id, { reg_email_verified: true, reg_email_code_hash: null, reg_email_code_attempts: 0 });
      socket.emit('registration-email-result', { ok: true, email: target });
    } catch (err) { console.error('[verify-registration-email]', err); socket.emit('error-msg', 'Verification failed. Please try again.'); }
  });

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------
  socket.on('register-transaction-account', async (p) => {
    try {
      p = p || {};
      const m = meta();
      const group = await requireSellerOwnGroup(p.groupId);
      if (!group) return;
      if (!limiter.allow(m.sessionToken)) return tooFast();
      if (group.seller_registered) return socket.emit('error-msg', 'This Transaction Account has already been created.');
      const ip = ipOfSocket(socket);
      if (isIpBlocked(group, ip)) return socket.emit('ip-blocked', { message: 'Registration from this network location is not allowed. Please contact ' + COMPLAINTS_EMAIL + '.' });

      const cleanName = sanitizeText(p.fullName, 200);
      if (cleanName.length < 3 || !/\s/.test(cleanName)) return socket.emit('error-msg', 'Please enter your full legal name (first and last name).');
      if (!isStrongEnoughPassword(p.password)) return socket.emit('error-msg', 'Password must be at least 8 characters.');
      if (!F.CURRENCIES.has(p.currency)) return socket.emit('error-msg', 'Please choose a valid account currency.');
      if ((p.accountType || 'standard') !== 'standard') return socket.emit('error-msg', 'New accounts are created as Standard accounts. You can upgrade to a Business account later.');

      if (!isValidEmail(p.email)) return socket.emit('error-msg', 'Please enter a valid email address.');
      const email = p.email.trim().toLowerCase();
      if (!group.reg_email_verified || group.reg_email_target !== email) return socket.emit('error-msg', 'Please verify your email address with the code we send you before creating your account.');

      const country = QC.findCountry(p.country);
      if (!country) return socket.emit('error-msg', 'Please select your country from the list.');
      const dialOk = QC.findCountry(p.phoneIso || country.iso);
      const phone = normalizePhone(p.phoneDial || (dialOk && dialOk.dial), p.phoneNumber);
      if (!phone) return socket.emit('error-msg', 'Please enter a valid phone number, including the country code.');

      const dob = new Date(p.dateOfBirth);
      if (!p.dateOfBirth || Number.isNaN(dob.getTime()) || dob.getFullYear() < 1900 || dob.getTime() > Date.now()) return socket.emit('error-msg', 'Please enter a valid date of birth.');
      if ((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000) < 18) return socket.emit('error-msg', 'You must be at least 18 years old to create a Transaction Account.');
      if (p.acceptTerms !== true) return socket.emit('error-msg', 'Please read and accept the Terms of Service and Transaction Policy to continue.');
      const language = QL.isSupported(p.language) ? p.language : 'en';

      const accountId = await generateAccountId();
      const now = new Date().toISOString();
      await store.updateGroup(group.id, {
        seller_registered: true, seller_full_name: escapeHtml(cleanName), seller_password_hash: hashPassword(p.password), seller_password_enc: await vault.encrypt(p.password),
        seller_currency: p.currency, seller_date_of_birth: p.dateOfBirth, seller_country: country.name, seller_country_iso: country.iso,
        seller_phone: phone, seller_account_id: accountId, seller_account_type: 'standard', seller_language: language,
        seller_terms_accepted_at: now, seller_terms_version: TERMS_VERSION,
        email_b: email, seller_email_locked: true, seller_email_verified_at: now,
        seller_registered_at: now, seller_password_changed_at: now, currency_locked_at: now,
        reg_email_code_hash: null, reg_email_target: email, reg_email_verified: true
      });
      await store.upsertUser({ sessionToken: m.sessionToken, language });
      await recordSellerIp(group.id, ip, 'register');
      const updated = await store.getGroup(group.id);
      socket.emit('seller-account-state', F.publicSellerAccount(updated));
      socket.emit('transaction-account-created', { groupId: group.id, accountId });
      io.to('finance-admins').emit('seller-account-updated', adminAccount(updated));
      await pushAdminLedger(io, group.id);
      await broadcastGroupsList();
      await E.notifyAccountCreated(email, { groupName: updated.name, accountId, fullName: cleanName, lang: language });
    } catch (err) { console.error('[register-transaction-account]', err); socket.emit('error-msg', 'We could not create your account. Please try again.'); }
  });

  // ------------------------------------------------------------------
  // KYC with automatic, moderate validation
  // ------------------------------------------------------------------
  socket.on('submit-kyc', async (p) => {
    try {
      p = p || {};
      const group = await activeSeller(p.groupId);
      if (!group) return;
      if (group.kyc_status === 'verified') return socket.emit('error-msg', 'Your identity is already verified.');
      if (group.kyc_status === 'pending') return socket.emit('error-msg', 'Your documents are already under review.');
      const { docType, idFrontUrl, idBackUrl, proofAddressType, proofAddressUrl, selfieUrl } = p;
      if (!KYC_DOC_TYPES.has(docType)) return socket.emit('error-msg', 'Please select a valid document type.');
      if (!PROOF_ADDRESS_TYPES.has(proofAddressType)) return socket.emit('error-msg', 'Please select what kind of proof of address you\'re uploading.');
      if (!idFrontUrl || !proofAddressUrl || !selfieUrl) return socket.emit('error-msg', 'ID (front), proof of address, and a selfie are all required.');
      if (docType !== 'passport' && !idBackUrl) return socket.emit('error-msg', 'The back of your ID is required for this document type.');
      const urls = [idFrontUrl, proofAddressUrl, selfieUrl].concat(docType !== 'passport' ? [idBackUrl] : []);
      if (!urls.every((u) => typeof u === 'string' && UPLOAD_URL_RE.test(u))) return socket.emit('error-msg', 'One of your documents was not uploaded correctly. Please upload it again.');

      const input = {
        docType, idNumber: sanitizeText(p.idNumber, 40), idName: sanitizeText(p.idName, 200), idDob: sanitizeText(p.idDob, 12), idExpiry: sanitizeText(p.idExpiry, 12),
        idFrontUrl, idBackUrl: docType === 'passport' ? null : idBackUrl, proofAddressUrl, selfieUrl,
        quality: p.quality && typeof p.quality === 'object' ? p.quality : {}, face: p.face && typeof p.face === 'object' ? p.face : {}
      };
      const acct = F.publicSellerAccount(group);
      const result = C.validateKyc(input, { fullName: String(group.seller_full_name || '').replace(/&amp;|&#39;|&quot;/g, ''), dateOfBirth: acct.dateOfBirth });
      const docFields = {
        kyc_doc_type: docType, kyc_id_front_url: idFrontUrl, kyc_id_back_url: input.idBackUrl, kyc_proof_address_url: proofAddressUrl,
        kyc_proof_address_type: proofAddressType, kyc_selfie_url: selfieUrl, kyc_submitted_at: new Date().toISOString(),
        kyc_id_number: input.idNumber.toUpperCase(), kyc_id_name: input.idName || null, kyc_id_expiry: input.idExpiry || null, kyc_id_dob: input.idDob || null,
        kyc_auto_result: { passed: result.passed, reasons: result.reasons, checks: result.checks, faceUnverified: !!result.faceUnverified, checkedAt: result.checkedAt }
      };
      if (!result.passed) {
        await store.updateGroup(group.id, { ...docFields, kyc_status: 'rejected', kyc_rejection_reason: result.reasons.join(' ') });
        socket.emit('kyc-auto-result', { passed: false, reasons: result.reasons, checks: result.checks });
        await pushSellerState(io, group.id, { kind: 'kyc', title: 'Verification not accepted', body: result.reasons[0] });
        return;
      }
      await store.updateGroup(group.id, { ...docFields, kyc_status: KYC_AUTO_APPROVE ? 'verified' : 'pending', kyc_rejection_reason: null, ...(KYC_AUTO_APPROVE ? { kyc_reviewed_at: new Date().toISOString() } : {}) });
      const updated = await store.getGroup(group.id);
      socket.emit('kyc-auto-result', { passed: true, checks: result.checks, autoApproved: KYC_AUTO_APPROVE });
      await pushSellerState(io, group.id, { kind: 'kyc', title: KYC_AUTO_APPROVE ? 'Identity verified' : 'Documents received', body: KYC_AUTO_APPROVE ? 'You can now request withdrawals.' : 'Your documents passed our checks and are now with the Desk for final review.' });
      io.to('finance-admins').emit('kyc-submitted', adminAccount(updated));
      io.to('finance-admins').emit('alert', { kind: 'kyc', groupId: group.id, groupName: group.name, title: 'KYC submitted', body: `${updated.seller_full_name || group.name} has submitted identity documents.` });
    } catch (err) { console.error('[submit-kyc]', err); socket.emit('error-msg', 'We could not process your documents. Please try again.'); }
  });

  // ------------------------------------------------------------------
  // Business account (unlimited withdrawals)
  // ------------------------------------------------------------------
  socket.on('submit-business-upgrade', async (p) => {
    try {
      p = p || {};
      const group = await activeSeller(p.groupId);
      if (!group) return;
      if (group.business_status === 'pending') return socket.emit('error-msg', 'Your business application is already under review.');
      if (group.seller_account_type === 'business') return socket.emit('error-msg', 'Your account is already a Business account.');
      if (group.kyc_status !== 'verified') return socket.emit('error-msg', 'Please complete personal identity verification first.');
      const t = (v, n) => sanitizeText(v, n);
      const prof = {
        companyName: t(p.companyName, 200), legalForm: t(p.legalForm, 80), registrationNumber: t(p.registrationNumber, 40).toUpperCase(),
        registrationCountry: t(p.registrationCountry, 100), incorporationDate: t(p.incorporationDate, 12), taxId: t(p.taxId, 40).toUpperCase(),
        vatNumber: t(p.vatNumber, 40).toUpperCase(), businessAddress: t(p.businessAddress, 300), city: t(p.city, 100), postalCode: t(p.postalCode, 20),
        businessType: t(p.businessType, 120), website: t(p.website, 200), businessPhone: t(p.businessPhone, 30),
        directorName: t(p.directorName, 200), directorRole: t(p.directorRole, 80), uboName: t(p.uboName, 200),
        monthlyVolume: t(p.monthlyVolume, 60), sourceOfFunds: t(p.sourceOfFunds, 500), declaration: p.declaration === true,
        certUrl: p.certUrl, taxDocUrl: p.taxDocUrl, addressDocUrl: p.addressDocUrl
      };
      const need = (ok, msg) => { if (!ok) { socket.emit('error-msg', msg); return false; } return true; };
      if (!need(prof.companyName.length >= 2, 'Please enter your registered company name.')) return;
      if (!need(prof.legalForm, 'Please select the legal form of your business (e.g. Ltd, LLC, Inc).')) return;
      if (!need(/^[A-Z0-9][A-Z0-9\-\/. ]{3,38}$/.test(prof.registrationNumber), 'Please enter a valid company registration number (4–40 letters, numbers or hyphens).')) return;
      if (!need(QC.findCountry(prof.registrationCountry), 'Please select the country where the company is registered.')) return;
      const inc = new Date(prof.incorporationDate);
      if (!need(prof.incorporationDate && !Number.isNaN(inc.getTime()) && inc.getTime() < Date.now() && inc.getFullYear() > 1800, 'Please enter a valid date of incorporation.')) return;
      if (!need(/^[A-Z0-9][A-Z0-9\-\/. ]{4,38}$/.test(prof.taxId), 'Please enter a valid tax identification number (TIN) — 5–40 letters, numbers or hyphens.')) return;
      if (!need(prof.businessAddress.length >= 8 && prof.city && prof.postalCode, 'Please enter the full registered business address, city and postal code.')) return;
      if (!need(prof.businessType, 'Please describe the nature of your business.')) return;
      if (!need(prof.directorName.length >= 3, 'Please enter the name of a director or authorised signatory.')) return;
      if (!need(prof.uboName.length >= 3, 'Please enter the name of the ultimate beneficial owner.')) return;
      if (!need(prof.monthlyVolume, 'Please select your expected monthly withdrawal volume.')) return;
      if (!need(prof.sourceOfFunds.length >= 10, 'Please explain the source of the funds you will be withdrawing (at least a short sentence).')) return;
      if (!need([prof.certUrl, prof.taxDocUrl, prof.addressDocUrl].every((u) => typeof u === 'string' && UPLOAD_URL_RE.test(u)), 'Please upload the certificate of incorporation, a tax document and proof of the business address.')) return;
      if (!need(prof.declaration, 'Please confirm the declaration that the information is true and complete.')) return;
      prof.registrationCountry = QC.findCountry(prof.registrationCountry).name;
      await store.updateGroup(group.id, { business_profile: prof, business_status: 'pending', business_submitted_at: new Date().toISOString(), business_rejection_reason: null });
      const updated = await store.getGroup(group.id);
      await pushSellerState(io, group.id, { kind: 'business', title: 'Business application received', body: 'Our compliance team will review your company details and email you with the decision.' });
      io.to('finance-admins').emit('business-submitted', adminAccount(updated));
      io.to('finance-admins').emit('alert', { kind: 'business', groupId: group.id, groupName: group.name, title: 'Business upgrade request', body: `${prof.companyName} applied for unlimited withdrawals.` });
      if (updated.email_b) await E.notifyBusinessStatus(updated.email_b, { groupName: updated.name, status: 'pending', lang: lang(updated) });
      socket.emit('business-submitted-ok', { companyName: prof.companyName });
    } catch (err) { console.error('[submit-business-upgrade]', err); socket.emit('error-msg', 'We could not submit your application. Please try again.'); }
  });

  socket.on('admin-get-business-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const groups = await store.getAllGroups();
    socket.emit('business-queue-list', groups.filter((g) => g.business_status === 'pending').map(adminAccount));
  });

  socket.on('admin-review-business', async ({ groupId, decision, reason }) => {
    try {
      if (!metaHasMinRole('ADMIN') || !['verified', 'rejected'].includes(decision)) return;
      const group = await store.getGroup(String(groupId || ''));
      if (!group || group.business_status !== 'pending') return;
      const note = sanitizeText(reason, 500);
      if (decision === 'rejected' && !note) return socket.emit('error-msg', 'Please give the seller a reason for the rejection.');
      await store.updateGroup(group.id, {
        business_status: decision, business_reviewed_at: new Date().toISOString(),
        business_rejection_reason: decision === 'rejected' ? note : null,
        ...(decision === 'verified' ? { seller_account_type: 'business' } : {})
      });
      const updated = await store.getGroup(group.id);
      await pushSellerState(io, group.id, { kind: 'business', title: decision === 'verified' ? 'Business account approved' : 'Business application not approved', body: decision === 'verified' ? 'Your daily withdrawal limit has been removed.' : note });
      io.to('finance-admins').emit('business-resolved', adminAccount(updated));
      await alertSellerOffline(io, updated, { title: decision === 'verified' ? 'Business account approved' : 'Business application not approved', body: decision === 'verified' ? 'Unlimited withdrawals are now enabled.' : note });
      if (updated.email_b) await E.notifyBusinessStatus(updated.email_b, { groupName: updated.name, status: decision, reason: note, lang: lang(updated) });
      await broadcastGroupsList();
    } catch (err) { console.error('[admin-review-business]', err); }
  });

  // ------------------------------------------------------------------
  // Admin: disable / enable a seller account
  // ------------------------------------------------------------------
  socket.on('admin-set-seller-disabled', async ({ groupId, disabled, reason }) => {
    try {
      if (!metaHasMinRole('ADMIN')) return;
      const group = await store.getGroup(String(groupId || ''));
      if (!group) return socket.emit('error-msg', 'That group no longer exists.');
      if (!group.seller_registered) return socket.emit('error-msg', 'This seller has not created an account yet.');
      const off = !!disabled;
      if (off === !!group.seller_disabled) return socket.emit('error-msg', off ? 'This account is already disabled.' : 'This account is already enabled.');
      const note = sanitizeText(reason, 300);
      await store.updateGroup(group.id, off
        ? { seller_disabled: true, seller_disabled_reason: note || null, seller_disabled_at: new Date().toISOString() }
        : { seller_disabled: false, seller_disabled_reason: null, seller_disabled_at: null });
      const updated = await store.getGroup(group.id);
      const title = off ? 'Account disabled' : 'Account enabled';
      const body = off
        ? `Your account has been disabled${note ? ` — ${note}` : ''}. To lodge a complaint or ask for a review, contact ${COMPLAINTS_EMAIL}.`
        : 'Your account has been re-enabled. You can use it normally again.';
      await pushSellerState(io, group.id, { kind: 'account-access', title, body });
      io.to(`seller:${group.id}`).emit('seller-access-changed', { groupId: group.id, disabled: off, reason: note || null, complaintsEmail: COMPLAINTS_EMAIL });
      await alertSellerOffline(io, updated, { title, body });
      if (updated.email_b) await E.notifyAccountAccess(updated.email_b, { groupName: updated.name, accountId: updated.seller_account_id, disabled: off, reason: note, complaintsEmail: COMPLAINTS_EMAIL, lang: lang(updated) });
      await broadcastGroupsList();
    } catch (err) { console.error('[admin-set-seller-disabled]', err); socket.emit('error-msg', 'Could not change the account status.'); }
  });

  // ------------------------------------------------------------------
  // Admin: IP controls, profile, password reset, disbursement gate, crypto policy
  // ------------------------------------------------------------------
  socket.on('admin-set-ip-block', async ({ groupId, ip, blocked }) => {
    try {
      if (!metaHasMinRole('ADMIN')) return;
      if (!ipOk(ip)) return socket.emit('error-msg', 'That does not look like a valid IP address.');
      const group = await store.getGroup(String(groupId || ''));
      if (!group) return;
      const list = new Set(jsonOf(group.seller_blocked_ips, []));
      if (blocked) list.add(ip); else list.delete(ip);
      await store.updateGroup(group.id, { seller_blocked_ips: Array.from(list) });
      if (blocked) {
        for (const [sockId, v] of (io._activeSockets || new Map())) {
          if (v.groupId === group.id && !v.isAdmin && v.role === 'PARTY B') {
            const s = io.sockets.sockets.get(sockId);
            if (s && ipOfSocket(s) === ip) { s.emit('ip-blocked', { message: 'Access from this network location has been disabled for your account. Please contact ' + COMPLAINTS_EMAIL + '.' }); s.disconnect(true); }
          }
        }
      }
      await pushAdminLedger(io, group.id);
      socket.emit('seller-profile', { groupId: group.id, account: adminAccount(await store.getGroup(group.id)) });
    } catch (err) { console.error('[admin-set-ip-block]', err); }
  });

  const viewerPerms = (g) => ({ canViewPassword: canViewPassword(g), isSuperAdmin: metaHasMinRole('SUPER_ADMIN') });
  socket.on('admin-get-seller-profile', async ({ groupId }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const g = await store.getGroup(String(groupId || ''));
    if (g) socket.emit('seller-profile', { groupId: g.id, account: adminAccount(g), viewer: viewerPerms(g) });
  });

  // The password is stored only as a salted hash and can never be read back — by anyone.
  // What an admin CAN do is send the seller a reset code.
  socket.on('admin-send-password-reset', async ({ groupId }) => {
    try {
      if (!metaHasMinRole('ADMIN')) return;
      if (!limiter.allow(meta().sessionToken)) return tooFast();
      const g = await store.getGroup(String(groupId || ''));
      if (!g || !g.seller_registered || !g.email_b) return socket.emit('error-msg', 'This seller has no registered account or email.');
      const code = generateSixDigitCode();
      await store.createPasswordReset({ groupId: g.id, codeHash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
      await E.notifyPasswordResetCode(g.email_b, { code, groupName: g.name, lang: lang(g) });
      socket.emit('toast-info', { message: `A password reset code was emailed to ${maskEmail(g.email_b)}.` });
    } catch (err) { console.error('[admin-send-password-reset]', err); socket.emit('error-msg', 'Could not send the reset code.'); }
  });

  // ---- Staff password viewing -------------------------------------------------
  // Allowed for: the company (SUPER_ADMIN) always; the assigned admin team (ADMIN tier) only
  // when the company has switched "assigned admin may view" on for THAT seller. Moderators never.
  // The password is stored encrypted (vault.js); every reveal is written to an audit list.
  const canViewPassword = (g) => metaHasMinRole('SUPER_ADMIN') || (metaHasMinRole('ADMIN') && !!g.password_admin_access);
  socket.on('admin-reveal-seller-password', async ({ groupId }) => {
    try {
      if (!metaHasMinRole('ADMIN')) return;
      if (!limiter.allow(meta().sessionToken)) return tooFast();
      const g = await store.getGroup(String(groupId || ''));
      if (!g || !g.seller_registered) return;
      if (!canViewPassword(g)) return socket.emit('error-msg', 'Only the company (Super Admin) or the admin assigned to this seller can view the password.');
      const plain = await vault.decrypt(g.seller_password_enc);
      if (!plain) return socket.emit('seller-password-revealed', { groupId: g.id, available: false });
      const log = jsonOf(g.seller_password_reveals, []).slice(-49);
      log.push({ at: new Date().toISOString(), role: meta().adminRole || (metaHasMinRole('SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ADMIN') });
      await store.updateGroup(g.id, { seller_password_reveals: log });
      socket.emit('seller-password-revealed', { groupId: g.id, available: true, password: plain, hideAfterSec: 30 });
      socket.emit('seller-profile', { groupId: g.id, account: adminAccount(await store.getGroup(g.id)), viewer: viewerPerms(await store.getGroup(g.id)) });
    } catch (err) { console.error('[admin-reveal-seller-password]', err); socket.emit('error-msg', 'Could not open the password.'); }
  });
  socket.on('admin-set-password-access', async ({ groupId, allowed }) => {
    if (!metaHasMinRole('SUPER_ADMIN')) return socket.emit('error-msg', 'Only the company (Super Admin) can assign password access.');
    const g = await store.getGroup(String(groupId || '')); if (!g) return;
    await store.updateGroup(g.id, { password_admin_access: !!allowed });
    const fresh = await store.getGroup(g.id);
    socket.emit('seller-profile', { groupId: g.id, account: adminAccount(fresh), viewer: viewerPerms(fresh) });
    socket.emit('toast-info', { message: allowed ? 'The assigned admin can now view this seller\'s password.' : 'Password access removed from the assigned admin.' });
  });

  // ---- Email delivery settings (Super Admin) ----------------------------------
  socket.on('admin-get-email-settings', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const saved = await store.getSetting('email_config', null);
    socket.emit('email-settings', { status: E.emailStatus(), saved: saved ? { provider: saved.provider, from: saved.from || '', hasKey: !!saved.apiKeyEnc, smtp: saved.smtp ? { host: saved.smtp.host || '', port: saved.smtp.port || '', user: saved.smtp.user || '', service: saved.smtp.service || '', hasPass: !!saved.smtp.passEnc } : null } : null, canEdit: metaHasMinRole('SUPER_ADMIN') });
  });
  socket.on('admin-save-email-settings', async (p) => {
    try {
      if (!metaHasMinRole('SUPER_ADMIN')) return socket.emit('error-msg', 'Only the company (Super Admin) can change email settings.');
      p = p || {}; const prev = await store.getSetting('email_config', null);
      if (!['resend', 'brevo', 'sendgrid', 'smtp'].includes(p.provider)) return socket.emit('error-msg', 'Choose an email provider.');
      const from = sanitizeText(p.from, 200);
      const cfg = { provider: p.provider, from };
      if (p.provider === 'smtp') {
        const s = p.smtp || {};
        const passEnc = s.pass ? await vault.encrypt(String(s.pass)) : (prev && prev.smtp && prev.smtp.passEnc) || null;
        if (!(s.service || s.host) || !s.user || !passEnc) return socket.emit('error-msg', 'SMTP needs a host (or service), a username and a password.');
        cfg.smtp = { host: sanitizeText(s.host, 200), port: Number(s.port) || 587, service: sanitizeText(s.service, 50), user: sanitizeText(s.user, 200), passEnc };
      } else {
        const apiKeyEnc = p.apiKey ? await vault.encrypt(String(p.apiKey).trim()) : (prev && prev.provider === p.provider && prev.apiKeyEnc) || null;
        if (!apiKeyEnc) return socket.emit('error-msg', 'Paste the provider API key.');
        cfg.apiKeyEnc = apiKeyEnc;
      }
      await store.setSetting('email_config', cfg);
      await applyEmailSettings(cfg);
      socket.emit('toast-info', { message: 'Email settings saved. Send a test email to confirm.' });
      socket.emit('email-settings', { status: E.emailStatus(), saved: { provider: cfg.provider, from, hasKey: !!cfg.apiKeyEnc, smtp: cfg.smtp ? { host: cfg.smtp.host, port: cfg.smtp.port, user: cfg.smtp.user, service: cfg.smtp.service, hasPass: true } : null }, canEdit: true });
    } catch (err) { console.error('[admin-save-email-settings]', err); socket.emit('error-msg', 'Could not save the email settings.'); }
  });
  socket.on('admin-test-email', async ({ to }) => {
    if (!metaHasMinRole('ADMIN')) return;
    if (!limiter.allow(meta().sessionToken)) return tooFast();
    if (!isValidEmail(to)) return socket.emit('email-test-result', { ok: false, error: 'Enter a valid email address to send the test to.' });
    const r = await E.sendTemplated(String(to).trim(), { subject: 'Vistra | Test email', preheader: 'Your email delivery is working.', eyebrow: 'System Check', title: 'Your email delivery is working', badge: { text: 'Delivered', tone: 'success' }, paragraphs: ['This is a test message from the Quantum Secure Transaction Desk. If you are reading it, verification codes and notifications will reach your sellers and buyers.', 'If this message arrived in your spam folder, mark it as “Not spam” and run the deliverability check in your dashboard to see which DNS records are missing.'] });
    socket.emit('email-test-result', { ok: r.ok, provider: r.provider, error: r.ok ? null : (r.error === 'not_configured' ? 'No email provider is configured yet.' : r.error) });
  });

  socket.on('admin-verify-email', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    if (!limiter.allow(meta().sessionToken)) return tooFast();
    socket.emit('email-verify-result', await E.verifyConnection());
  });
  socket.on('admin-check-deliverability', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    if (!limiter.allow(meta().sessionToken)) return tooFast();
    socket.emit('email-deliverability-result', await E.checkDeliverability());
  });

  socket.on('admin-set-disbursement', async ({ groupId, enabled }) => {
    try {
      if (!metaHasMinRole('ADMIN')) return;
      const g = await store.getGroup(String(groupId || ''));
      if (!g) return;
      const on = !!enabled;
      if (on === !!g.disbursement_enabled) return;
      await store.updateGroup(g.id, { disbursement_enabled: on, disbursement_updated_at: new Date().toISOString() });
      io.to(g.id).emit('disbursement-updated', { groupId: g.id, enabled: on });
      await pushSellerState(io, g.id, on
        ? { kind: 'disbursement', title: 'Disbursement stage reached', body: 'Both parties are confirmed. You can now withdraw your available funds.' }
        : { kind: 'disbursement', title: 'Withdrawals paused', body: 'Your transaction is no longer in the disbursement stage. Withdrawals are paused until the Desk confirms it again.' });
      if (postDeskMessage) {
        await postDeskMessage(g.id, on
          ? 'TRANSACTION STATUS: Both parties are confirmed and this transaction is now in the DISBURSEMENT stage. The seller may withdraw available funds.'
          : 'TRANSACTION STATUS: This transaction is not in the disbursement stage. Withdrawals are paused until both parties have completed their obligations and the Desk confirms.');
      }
      await alertSellerOffline(io, g, { title: on ? 'Disbursement stage reached' : 'Withdrawals paused', body: on ? 'You can now withdraw your available funds.' : 'Withdrawals are paused for this transaction.' });
      await broadcastGroupsList();
    } catch (err) { console.error('[admin-set-disbursement]', err); }
  });

  socket.on('admin-set-crypto-verified', async ({ groupId, verified }) => {
    if (!metaHasMinRole('ADMIN')) return;
    const g = await store.getGroup(String(groupId || ''));
    if (!g) return;
    await store.updateGroup(g.id, { crypto_deposit_verified: !!verified });
    await pushSellerState(io, g.id, null);
  });

  socket.on('admin-get-crypto-policy', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    socket.emit('crypto-policy', await cryptoPolicy());
  });
  socket.on('admin-set-crypto-policy', async (policy) => {
    if (!metaHasMinRole('SUPER_ADMIN')) return socket.emit('error-msg', 'Only a Super Admin can change the crypto deposit policy.');
    const clean = C.sanitizePolicy(policy);
    await store.setSetting(C.SETTING_KEY_CRYPTO, clean);
    socket.emit('crypto-policy', clean);
    socket.emit('toast-info', { message: 'Crypto deposit policy saved.' });
  });

  // ------------------------------------------------------------------
  // Withdrawals: gates → email code → reserve funds → admin stages
  // ------------------------------------------------------------------
  async function evaluateWithdrawal(group, p) {
    // Returns { error } | { blocked: {...} } | { draft, ledgerAmount, ccy, amt }
    if (group.kyc_status !== 'verified') return { error: 'Your identity must be verified before you can withdraw.' };
    if (!group.seller_currency) return { error: 'Your account currency has not been set yet.' };
    if (!group.disbursement_enabled) {
      return { blocked: { reason: 'disbursement', title: 'Withdrawals are not open yet', message: 'Your transaction is not yet in the disbursement stage. Both parties must be fully confirmed before funds can be withdrawn. Please complete your part of the transaction in the group chat — once the Desk confirms it, you can withdraw freely.' } };
    }
    const amt = F.round2(Number(p.amount));
    if (!Number.isFinite(amt) || amt <= 0) return { error: 'Please enter a valid amount.' };
    if (!['crypto', 'bank'].includes(p.method)) return { error: 'Please choose a withdrawal method.' };
    let ledgerAmount; let ccy;
    if (p.method === 'crypto') {
      if (!F.CRYPTO_ASSETS.has(p.asset)) return { error: 'Please choose a valid asset.' };
      if (!p.destination || sanitizeText(p.destination, 200).length < 6) return { error: 'Please enter a valid destination wallet address.' };
      ccy = F.CURRENCIES.has(p.amountCurrency) ? p.amountCurrency : group.seller_currency;
      ledgerAmount = F.convertCurrency(amt, ccy, group.seller_currency);
    } else {
      if (!p.beneficiaryName || !p.bankName || !p.bankAccount) return { error: 'Beneficiary name, bank name and account number/IBAN are required.' };
      ccy = group.seller_currency; ledgerAmount = amt;
    }
    ledgerAmount = F.round2(ledgerAmount);
    if (ledgerAmount > Number(group.balance_available || 0)) return { error: 'That amount exceeds your available balance.' };

    if (group.seller_account_type !== 'business') {
      const since = C.startOfUtcDayIso();
      const today = await store.getWithdrawalsSince(group.id, since);
      const used = F.round2(today.reduce((s, w) => s + Number(w.amount_ledger), 0));
      const remaining = Math.max(0, F.round2(C.DAILY_WITHDRAWAL_CAP - used));
      if (ledgerAmount > remaining) {
        return { blocked: {
          reason: 'daily_limit', cap: C.DAILY_WITHDRAWAL_CAP, used, remaining, currency: group.seller_currency,
          businessStatus: group.business_status,
          title: 'Daily withdrawal limit reached',
          message: `Standard accounts can withdraw up to ${money(C.DAILY_WITHDRAWAL_CAP, group.seller_currency)} per day. You have ${money(remaining, group.seller_currency)} remaining today. For unlimited withdrawals, upgrade to a Business account.`
        } };
      }
    }
    if (p.method === 'crypto') {
      const policy = await cryptoPolicy();
      const amountUsd = F.convertCurrency(ledgerAmount, group.seller_currency, 'USD');
      const have = await verifiedCryptoDepositsUsd(group);
      const verdict = C.canWithdrawCrypto(group, amountUsd, policy, have);
      if (!verdict.allowed) {
        const toLedger = (usd) => F.convertCurrency(usd, 'USD', group.seller_currency);
        return { blocked: {
          reason: 'crypto_deposit', currency: group.seller_currency, requiredUsd: verdict.requiredUsd, haveUsd: verdict.haveUsd, shortfallUsd: verdict.shortfallUsd,
          requiredLedger: toLedger(verdict.requiredUsd), haveLedger: toLedger(verdict.haveUsd), shortfallLedger: toLedger(verdict.shortfallUsd),
          flat: verdict.flat, tierId: verdict.tierId, tierPct: verdict.tierPct,
          title: 'A crypto deposit is required first',
          message: `Before your first crypto withdrawal, a crypto deposit of at least ${money(toLedger(verdict.requiredUsd), group.seller_currency)} must be on record. This creates a verifiable funding trail for crypto payouts. Your bank-transfer withdrawals are not affected.`
        }, requiredUsd: verdict.requiredUsd };
      }
      if (verdict.autoVerify && !group.crypto_deposit_verified) await store.updateGroup(group.id, { crypto_deposit_verified: true });
    }
    const draft = {
      method: p.method, asset: p.method === 'crypto' ? p.asset : null, network: p.method === 'crypto' ? (sanitizeText(p.network, 20) || null) : null,
      destination: p.method === 'crypto' ? sanitizeText(p.destination, 200) : null,
      beneficiaryName: p.method === 'bank' ? sanitizeText(p.beneficiaryName, 200) : null, bankName: p.method === 'bank' ? sanitizeText(p.bankName, 200) : null,
      bankAccount: p.method === 'bank' ? sanitizeText(p.bankAccount, 100) : null, bankSwift: p.method === 'bank' ? sanitizeText(p.bankSwift, 50) : null,
      bankCountry: p.method === 'bank' ? sanitizeText(p.bankCountry, 100) : null,
      amount: amt, amountCurrency: ccy, amountLedger: ledgerAmount
    };
    return { draft, ledgerAmount, ccy, amt };
  }

  async function sendWithdrawalCode(group, draft) {
    const code = generateSixDigitCode();
    pendingWithdrawals.set(meta().sessionToken, { groupId: group.id, draft, codeHash: hashCode(code), expires: Date.now() + CODE_TTL_MS, attempts: 0, issuedAt: Date.now() });
    const sent = await E.notifyWithdrawalCode(group.email_b, {
      code, amountText: money(draft.amount, draft.amountCurrency), accountId: group.seller_account_id,
      destination: draft.method === 'crypto' ? `${draft.asset} wallet ${draft.destination.slice(0, 6)}…${draft.destination.slice(-4)}` : `${draft.bankName}`, lang: lang(group)
    });
    if (!sent.ok) { pendingWithdrawals.delete(meta().sessionToken); return socket.emit('error-msg', emailFailMessage(sent)); }
    socket.emit('withdrawal-code-sent', { masked: maskEmail(group.email_b), expiresInSec: CODE_TTL_MS / 1000, cooldownSec: CODE_COOLDOWN_MS / 1000 });
  }

  socket.on('preview-withdrawal', async (p) => {
    try {
      p = p || {};
      const group = await requireSellerOwnGroup(p.groupId);
      if (!group) return;
      const since = C.startOfUtcDayIso();
      const used = F.round2((await store.getWithdrawalsSince(group.id, since)).reduce((s, w) => s + Number(w.amount_ledger), 0));
      socket.emit('withdrawal-preview', {
        groupId: group.id, disbursementEnabled: !!group.disbursement_enabled, accountType: group.seller_account_type,
        dailyCap: group.seller_account_type === 'business' ? null : C.DAILY_WITHDRAWAL_CAP, usedToday: used,
        remainingToday: group.seller_account_type === 'business' ? null : Math.max(0, F.round2(C.DAILY_WITHDRAWAL_CAP - used)),
        currency: group.seller_currency, cryptoVerified: !!group.crypto_deposit_verified
      });
    } catch (err) { /* informational only */ }
  });

  socket.on('request-withdrawal', async (p) => {
    try {
      p = p || {};
      const group = await activeSeller(p.groupId);
      if (!group) return;
      if (!group.email_b) return socket.emit('error-msg', 'No email address is on file to send your confirmation code to.');
      const r = await evaluateWithdrawal(group, p);
      if (r.error) return socket.emit('error-msg', r.error);
      if (r.blocked) {
        if (r.blocked.reason === 'crypto_deposit' && r.requiredUsd) await store.updateGroup(group.id, { crypto_deposit_required_usd: r.requiredUsd });
        return socket.emit('withdrawal-blocked', { groupId: group.id, ...r.blocked });
      }
      await sendWithdrawalCode(group, r.draft);
    } catch (err) { console.error('[request-withdrawal]', err); socket.emit('error-msg', 'We could not start your withdrawal. Please try again.'); }
  });

  socket.on('resend-withdrawal-code', async ({ groupId }) => {
    try {
      const group = await activeSeller(groupId);
      if (!group) return;
      const pend = pendingWithdrawals.get(meta().sessionToken);
      if (!pend || pend.groupId !== group.id) return socket.emit('error-msg', 'Please start your withdrawal again.');
      if (Date.now() - pend.issuedAt < CODE_COOLDOWN_MS) return socket.emit('error-msg', `Please wait ${Math.ceil((CODE_COOLDOWN_MS - (Date.now() - pend.issuedAt)) / 1000)} seconds before requesting another code.`);
      await sendWithdrawalCode(group, pend.draft);
    } catch (err) { console.error('[resend-withdrawal-code]', err); }
  });

  socket.on('cancel-withdrawal-draft', () => { const m = meta(); if (m) pendingWithdrawals.delete(m.sessionToken); });

  socket.on('confirm-withdrawal', async ({ groupId, code }) => {
    try {
      const group = await activeSeller(groupId);
      if (!group) return;
      const token = meta().sessionToken;
      const pend = pendingWithdrawals.get(token);
      if (!pend || pend.groupId !== group.id) return socket.emit('withdrawal-confirm-result', { ok: false, error: 'This withdrawal request has expired. Please start again.', restart: true });
      if (pend.expires < Date.now()) { pendingWithdrawals.delete(token); return socket.emit('withdrawal-confirm-result', { ok: false, error: 'That code has expired. Please start again.', restart: true }); }
      if (!/^\d{6}$/.test(String(code || '').trim())) return socket.emit('withdrawal-confirm-result', { ok: false, error: 'Enter the 6-digit code from your email.' });
      if (hashCode(String(code).trim()) !== pend.codeHash) {
        pend.attempts += 1;
        if (pend.attempts >= MAX_CODE_ATTEMPTS) { pendingWithdrawals.delete(token); return socket.emit('withdrawal-confirm-result', { ok: false, error: 'Too many incorrect attempts. Please start again.', restart: true }); }
        return socket.emit('withdrawal-confirm-result', { ok: false, error: `That code is not correct. ${MAX_CODE_ATTEMPTS - pend.attempts} attempt${MAX_CODE_ATTEMPTS - pend.attempts === 1 ? '' : 's'} left.` });
      }
      // Re-check every gate at the moment the money actually moves.
      const r = await evaluateWithdrawal(group, { ...pend.draft, groupId: group.id });
      if (r.error) { pendingWithdrawals.delete(token); return socket.emit('withdrawal-confirm-result', { ok: false, error: r.error, restart: true }); }
      if (r.blocked) { pendingWithdrawals.delete(token); socket.emit('withdrawal-confirm-result', { ok: false, error: r.blocked.message, restart: true }); return socket.emit('withdrawal-blocked', { groupId: group.id, ...r.blocked }); }
      const L = r.draft.amountLedger;
      const moved = await store.adjustBalances(group.id, { available: -L, pending: L });
      if (!moved) { pendingWithdrawals.delete(token); return socket.emit('withdrawal-confirm-result', { ok: false, error: 'Your available balance no longer covers this withdrawal.', restart: true }); }
      let wd;
      try {
        wd = await store.createWithdrawal({ groupId: group.id, ...r.draft, requestIp: ipOfSocket(socket), emailConfirmedAt: new Date().toISOString(), sellerAccountId: group.seller_account_id });
      } catch (err) { await store.adjustBalances(group.id, { available: L, pending: -L }); throw err; }
      pendingWithdrawals.delete(token);
      await recordSellerIp(group.id, ipOfSocket(socket), 'withdrawal');
      socket.emit('withdrawal-confirm-result', { ok: true, id: wd.id, ref: F.refFor('withdrawal', wd.id) });
      socket.emit('withdrawal-created', F.publicWithdrawal(wd));
      io.to('finance-admins').emit('withdrawal-created', F.publicWithdrawal(wd, { forAdmin: true }));
      io.to('finance-admins').emit('alert', { kind: 'withdrawal', groupId: group.id, groupName: group.name, title: 'New withdrawal request', body: `${group.seller_full_name || group.name} requested ${money(wd.amount, wd.amount_currency)}.` });
      await pushSellerState(io, group.id, null);
      await broadcastGroupsList();
    } catch (err) { console.error('[confirm-withdrawal]', err); socket.emit('withdrawal-confirm-result', { ok: false, error: 'Something went wrong. Please check your withdrawals before trying again.' }); }
  });
}

module.exports = { loadEmailSettings, applyEmailSettings, registerAccountHandlers, recordSellerIp, isIpBlocked, ipOfSocket, jsonOf, generateAccountId, cryptoPolicy, verifiedCryptoDepositsUsd, pendingWithdrawals };
