// Seller account lifecycle + the admin controls over it.
//
//  Seller side : registration (with email-code verification), language, onboarding
//                choice, KYC (auto-validated), business upgrade, withdrawals
//                (disbursement gate -> limits -> crypto requirement -> email code).
//  Admin side  : disable / enable a seller, the disbursement toggle, per-seller IP
//                blocking, crypto-requirement override, policy (tiers, daily limit,
//                KYC auto-approve), business review, password-reset email.

const crypto = require('crypto');
const { store } = require('./db');
const S = require('./security');
const F = require('./finance');
const POL = require('./policy');
const KYC = require('./kyc');
const CD = require('./public/countries');
const LANG = require('./public/languages');
const LEGAL = require('./public/legal');
const E = require('./email');
const { generateAccountId } = require('./accounts');
const { postSystemMessage } = require('./chatShape');
const FH = require('./fundsHandlers');

const { sanitizeText, escapeHtml, RateLimiter } = S;

const accountLimiter = new RateLimiter({ windowMs: 60000, max: 30 });
const codeSendLimiter = new RateLimiter({ windowMs: 10 * 60000, max: 6 });
const adminLimiter = new RateLimiter({ windowMs: 60000, max: 60 });
setInterval(() => { accountLimiter.sweep(); codeSendLimiter.sweep(); adminLimiter.sweep(); }, 60000).unref();

const KYC_DOC_TYPES = new Set(['national_id', 'drivers_license', 'passport']);
const PROOF_ADDRESS_TYPES = new Set(['bank_statement', 'utility_bill', 'electricity_bill', 'council_tax', 'other']);
const UPLOAD_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 30 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const SUPPORT = E.SUPPORT_EMAIL;

const sameHash = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function recordIp(group, ip, action) {
  if (!ip) return group;
  const log = Array.isArray(group.seller_ip_log) ? group.seller_ip_log.slice(-49) : [];
  const last = log[log.length - 1];
  if (action === 'join' && last && last.ip === ip && Date.now() - new Date(last.at).getTime() < 3600 * 1000) return group;
  log.push({ ip, action, at: new Date().toISOString() });
  const fields = { seller_ip_log: log, seller_last_ip: ip };
  if (action === 'register') fields.seller_registration_ip = ip;
  return (await store.updateGroup(group.id, fields)) || group;
}
const isIpBlocked = (group, ip) => !!ip && Array.isArray(group.seller_blocked_ips) && group.seller_blocked_ips.includes(ip);

function registerSellerHandlers(io, socket, ctx) {
  const { meta, metaHasMinRole, broadcastGroupsList } = ctx;
  const ipOf = () => S.getSocketIp(socket);

  // Seller acting on THEIR OWN group only. Disabled accounts and blocked IPs are refused here, once.
  async function requireActiveSeller(groupId, { allowDisabled = false, silent = false } = {}) {
    const m = meta();
    if (!m || m.isAdmin) return null;
    const group = await store.getGroup(String(groupId || ''));
    if (!group || group.seller_session_token !== m.sessionToken) return null;
    if (!allowDisabled && group.seller_disabled) {
      if (!silent) socket.emit('seller-disabled', { groupId: group.id, reason: group.seller_disabled_reason || null, contact: SUPPORT });
      return null;
    }
    if (isIpBlocked(group, ipOf())) {
      if (!silent) socket.emit('ip-blocked', { groupId: group.id, contact: SUPPORT });
      return null;
    }
    return group;
  }

  const sellerState = (g) => FH.pushSellerState(io, g.id, null);
  const langOfGroup = (g) => g.seller_language || 'en';

  // ====================================================================
  // Activity / language / onboarding
  // ====================================================================
  socket.on('client-activity', ({ visible, focused }) => {
    const m = meta();
    if (m) m.active = !!visible && !!focused;
  });

  socket.on('set-language', async ({ groupId, lang }) => {
    const m = meta();
    if (!m) return;
    const l = LANG.find(lang);
    if (!l) return socket.emit('error-msg', 'That language is not available.');
    await store.upsertUser({ sessionToken: m.sessionToken, prefLang: l.c });
    if (!m.isAdmin) {
      const group = await store.getGroup(String(groupId || m.groupId || ''));
      if (group && group.seller_session_token === m.sessionToken && group.seller_registered) {
        await store.updateGroup(group.id, { seller_language: l.c });
        await sellerState(group);
      }
    }
    socket.emit('language-saved', { lang: l.c });
  });

  socket.on('set-onboarding-choice', async ({ groupId, choice }) => {
    const group = await requireActiveSeller(groupId, { allowDisabled: true });
    if (!group || !['transaction', 'kyc'].includes(choice)) return;
    await store.updateGroup(group.id, { seller_onboarding_choice: choice });
    await sellerState(group);
  });

  // ====================================================================
  // Registration — email verification, then account creation
  // ====================================================================
  socket.on('send-register-code', async ({ groupId, email }) => {
    const m = meta();
    if (!m || m.isAdmin) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group || group.seller_session_token !== m.sessionToken) return socket.emit('error-msg', 'You are not the Seller of this group.');
    if (group.seller_registered) return socket.emit('error-msg', 'This Transaction Account has already been created.');
    if (!codeSendLimiter.allow(m.sessionToken)) return socket.emit('error-msg', 'Too many code requests — please wait a few minutes and try again.');
    const addr = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!S.isValidEmail(addr)) return socket.emit('register-code-error', { message: 'Please enter a valid email address.' });
    const clash = (await store.findGroupsBySellerEmail(addr)).find((g) => g.id !== group.id);
    if (clash) return socket.emit('register-code-error', { message: 'An account already exists for this email address. Please sign in instead.' });
    const prev = await store.getLatestEmailCode(group.id, 'register');
    if (prev && Date.now() - new Date(prev.created_at).getTime() < CODE_RESEND_MS) {
      return socket.emit('register-code-error', { message: 'A code was just sent. Please wait a few seconds before requesting another.', retryAfter: 30 });
    }
    const code = S.generateSixDigitCode();
    await store.createEmailCode({ groupId: group.id, purpose: 'register', email: addr, codeHash: S.hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
    const lang = (await store.getUser(m.sessionToken))?.pref_lang || 'en';
    const sent = await E.notifyVerificationCode(addr, { code, lang });
    socket.emit('register-code-sent', { email: addr, masked: S.maskEmail(addr), expiresInSec: CODE_TTL_MS / 1000, delivered: sent, mock: !E.isEmailConfigured() });
  });

  socket.on('verify-register-code', async ({ groupId, email, code }) => {
    const m = meta();
    if (!m || m.isAdmin) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group || group.seller_session_token !== m.sessionToken) return;
    const addr = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const rec = await store.getLatestEmailCode(group.id, 'register');
    const fail = (message) => socket.emit('register-code-error', { message, verify: true });
    if (!rec || rec.email !== addr) return fail('Please request a verification code for this email first.');
    if (new Date(rec.expires_at) < new Date()) return fail('That code has expired. Please request a new one.');
    if (rec.attempts >= CODE_MAX_ATTEMPTS) return fail('Too many incorrect attempts. Please request a new code.');
    if (!/^\d{6}$/.test(String(code || '')) || !sameHash(rec.code_hash, S.hashCode(String(code)))) {
      const n = await store.bumpEmailCodeAttempts(rec.id);
      return fail(n >= CODE_MAX_ATTEMPTS ? 'Too many incorrect attempts. Please request a new code.' : 'That code is not correct. Please check it and try again.');
    }
    await store.markEmailCodeVerified(rec.id);
    socket.emit('register-code-verified', { email: addr });
  });

  socket.on('register-transaction-account', async (p) => {
    const m = meta();
    if (!m || m.isAdmin) return;
    p = p || {};
    const fail = (message, field) => socket.emit('register-error', { message, field: field || null });
    if (!accountLimiter.allow(m.sessionToken)) return fail('Too many attempts — please wait a moment and try again.');
    const group = await store.getGroup(String(p.groupId || ''));
    if (!group || group.seller_session_token !== m.sessionToken) return fail('You are not the Seller of this group.');
    if (group.seller_registered) return fail('This Transaction Account has already been created.');
    const ip = ipOf();
    if (isIpBlocked(group, ip)) { socket.emit('ip-blocked', { groupId: group.id, contact: SUPPORT }); return; }

    const name = sanitizeText(p.fullName, 200);
    if (name.length < 3 || !/\s/.test(name)) return fail('Please enter your full legal name (first and last name).', 'fullName');
    if (!S.isStrongEnoughPassword(p.password)) return fail(S.PASSWORD_RULE_TEXT, 'password');
    if (p.password !== p.confirmPassword) return fail('The passwords do not match.', 'confirmPassword');
    if (!F.CURRENCIES.has(p.currency)) return fail('Please choose a valid account currency.', 'currency');
    const country = CD.find(p.country);
    if (!country) return fail('Please select your country.', 'country');
    const phone = S.normalizePhone(p.phone);
    if (!phone) return fail('Please enter a valid phone number including the country code.', 'phone');
    if (!phone.startsWith(country.d.replace(/\s/g, ''))) return fail(`Your phone number must start with ${country.d} for ${country.n}.`, 'phone');

    const dob = new Date(p.dateOfBirth);
    if (!p.dateOfBirth || Number.isNaN(dob.getTime()) || dob.getFullYear() < 1900 || dob.getTime() > Date.now()) return fail('Please enter a valid date of birth.', 'dateOfBirth');
    if ((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000) < 18) return fail('You must be at least 18 years old to create a Transaction Account.', 'dateOfBirth');

    if (p.acceptTerms !== true) return fail('You must accept the Terms of Service & Escrow Policy to continue.', 'acceptTerms');
    if (p.termsVersion !== LEGAL.version) return fail('The Terms were updated. Please reload the page and review them.', 'acceptTerms');

    const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
    if (!S.isValidEmail(email)) return fail('Please enter a valid email address.', 'email');
    const rec = await store.getLatestEmailCode(group.id, 'register');
    if (!rec || !rec.verified_at || rec.email !== email || new Date(rec.expires_at) < new Date(Date.now() - 30 * 60 * 1000)) {
      return fail('Please verify your email address with the code we send you.', 'email');
    }
    const clash = (await store.findGroupsBySellerEmail(email)).find((g) => g.id !== group.id);
    if (clash) return fail('An account already exists for this email address. Please sign in instead.', 'email');
    const consumed = await store.consumeEmailCode(rec.id); // one verification, one account
    if (!consumed) return fail('That verification has already been used. Please verify your email again.', 'email');

    const accountId = await generateAccountId(store);
    const lang = (LANG.find(p.language) || { c: 'en' }).c;
    const nowIso = new Date().toISOString();
    await store.updateGroup(group.id, {
      seller_registered: true,
      seller_full_name: escapeHtml(name),
      seller_password_hash: S.hashPassword(p.password),
      seller_currency: p.currency,
      seller_date_of_birth: p.dateOfBirth,
      seller_country: escapeHtml(country.n),
      seller_phone: phone,
      email_b: email,
      seller_account_id: accountId,
      seller_account_type: 'Standard account',
      seller_language: lang,
      seller_registered_at: nowIso,
      seller_terms_accepted_at: nowIso,
      seller_terms_version: LEGAL.version,
      currency_locked_at: nowIso
    });
    let updated = await store.getGroup(group.id);
    updated = await recordIp(updated, ip, 'register');
    await store.upsertUser({ sessionToken: m.sessionToken, email, phone, countryCode: country.c, prefLang: lang, lastIp: ip });

    socket.emit('seller-account-state', F.publicSellerAccount(updated, false));
    socket.emit('transaction-account-created', { groupId: group.id, accountId });
    await FH.pushSellerState(io, group.id, null);
    await FH.pushAdminLedger(io, group.id);
    io.to('finance-admins').emit('seller-account-updated', F.publicSellerAccount(updated, true));
    if (broadcastGroupsList) await broadcastGroupsList();
  });

  // ====================================================================
  // KYC — validated on the server before it reaches a human
  // ====================================================================
  socket.on('submit-kyc', async (p) => {
    p = p || {};
    const group = await requireActiveSeller(p.groupId);
    if (!group) return;
    const m = meta();
    if (!accountLimiter.allow(m.sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    if (group.kyc_status === 'verified') return socket.emit('error-msg', 'Your identity is already verified.');
    if (group.kyc_status === 'pending') return socket.emit('error-msg', 'Your documents are already under review.');
    if (!KYC_DOC_TYPES.has(p.docType)) return socket.emit('error-msg', 'Please select a valid document type.');
    if (!PROOF_ADDRESS_TYPES.has(p.proofAddressType)) return socket.emit('error-msg', 'Please select what kind of proof of address you\'re uploading.');
    const urls = [p.idFrontUrl, p.proofAddressUrl, p.selfieUrl].concat(p.docType !== 'passport' ? [p.idBackUrl] : []);
    if (!urls.every((u) => typeof u === 'string' && UPLOAD_URL_RE.test(u))) {
      return socket.emit('kyc-auto-result', { ok: false, reasons: ['One of your documents was not uploaded correctly. Please upload it again.'] });
    }

    const allGroups = await store.getAllGroups();
    const result = KYC.validateSubmission({
      docType: p.docType, idNumber: p.idNumber, idName: p.idName, idDob: p.idDob, idExpiry: p.idExpiry, idCountry: p.idCountry,
      idFrontUrl: p.idFrontUrl, idBackUrl: p.docType === 'passport' ? null : p.idBackUrl, proofAddressUrl: p.proofAddressUrl, selfieUrl: p.selfieUrl,
      quality: p.quality, face: p.face
    }, { group, allGroups });

    const attempts = Number(group.kyc_attempts || 0) + 1;
    const base = {
      kyc_doc_type: p.docType, kyc_id_front_url: p.idFrontUrl, kyc_id_back_url: p.docType === 'passport' ? null : p.idBackUrl,
      kyc_proof_address_url: p.proofAddressUrl, kyc_proof_address_type: p.proofAddressType, kyc_selfie_url: p.selfieUrl,
      kyc_submitted_at: new Date().toISOString(), kyc_attempts: attempts
    };
    if (!result.ok) {
      const reason = result.reasons.join(' • ');
      await store.updateGroup(group.id, { ...base, kyc_status: 'rejected', kyc_rejection_reason: sanitizeText(reason, 900), kyc_reviewed_by: null, kyc_reviewed_at: new Date().toISOString() });
      socket.emit('kyc-auto-result', { ok: false, reasons: result.reasons });
      await FH.pushSellerState(io, group.id, { kind: 'kyc', title: 'Verification not approved', body: result.reasons[0] });
      if (group.email_b) await E.notifyKycStatus(group.email_b, { groupName: group.name, status: 'rejected', reason: reason, lang: langOfGroup(group) });
      return;
    }
    const settings = (await store.getSetting('kyc_settings')) || {};
    const status = settings.autoApprove ? 'verified' : 'pending';
    const n = result.normalized;
    await store.updateGroup(group.id, {
      ...base, kyc_status: status, kyc_rejection_reason: null,
      kyc_id_number: n.idNumber, kyc_id_name: escapeHtml(n.idName), kyc_id_dob: n.idDob, kyc_id_expiry: n.idExpiry, kyc_id_country: n.idCountry,
      kyc_reviewed_by: settings.autoApprove ? 'auto' : null, kyc_reviewed_at: settings.autoApprove ? new Date().toISOString() : null
    });
    socket.emit('kyc-auto-result', { ok: true, status });
    await FH.pushSellerState(io, group.id, {
      kind: 'kyc', title: status === 'verified' ? 'Identity verified' : 'Documents received',
      body: status === 'verified' ? 'Your identity has been verified.' : 'Your documents passed our automatic checks and are now with our compliance team.'
    });
    io.to('finance-admins').emit('kyc-submitted', F.publicSellerAccount(await store.getGroup(group.id), true));
    if (group.email_b) await E.notifyKycStatus(group.email_b, { groupName: group.name, status, lang: langOfGroup(group) });
  });

  socket.on('admin-get-kyc-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const groups = await store.getAllGroups();
    socket.emit('kyc-queue-list', groups.filter((g) => g.kyc_status === 'pending').map((g) => F.publicSellerAccount(g, true)));
  });

  socket.on('admin-review-kyc', async ({ groupId, decision, reason }) => {
    if (!metaHasMinRole('ADMIN') || !adminLimiter.allow(meta().sessionToken)) return;
    if (!['verified', 'rejected'].includes(decision)) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group || group.kyc_status !== 'pending') return;
    const note = decision === 'rejected' ? (sanitizeText(reason, 500) || 'Not specified') : null;
    await store.updateGroup(group.id, { kyc_status: decision, kyc_reviewed_by: meta().sessionToken, kyc_reviewed_at: new Date().toISOString(), kyc_rejection_reason: note });
    await FH.pushSellerState(io, group.id, {
      kind: 'kyc', title: decision === 'verified' ? 'Identity verified' : 'Identity verification not approved',
      body: decision === 'verified' ? 'Your identity is verified. You can withdraw once your transaction reaches the disbursement stage.' : (note || 'Please resubmit your documents.')
    });
    io.to('finance-admins').emit('kyc-resolved', F.publicSellerAccount(await store.getGroup(group.id), true));
    if (group.email_b) await E.notifyKycStatus(group.email_b, { groupName: group.name, status: decision, reason: note, lang: langOfGroup(group) });
  });

  // ---- Business account upgrade (unlimited withdrawals) ----
  socket.on('submit-business-kyc', async (p) => {
    p = p || {};
    const group = await requireActiveSeller(p.groupId);
    if (!group) return;
    if (!accountLimiter.allow(meta().sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    if (group.kyc_status !== 'verified') return socket.emit('business-result', { ok: false, errors: ['Please complete your personal identity verification first.'] });
    if (group.business_status === 'verified') return socket.emit('business-result', { ok: false, errors: ['Your business account is already approved.'] });
    if (group.business_status === 'pending') return socket.emit('business-result', { ok: false, errors: ['Your business application is already under review.'] });
    const v = KYC.validateBusiness(p);
    if (v.errors) return socket.emit('business-result', { ok: false, errors: v.errors });
    await store.updateGroup(group.id, { business_status: 'pending', business_data: v.value, business_submitted_at: new Date().toISOString(), business_rejection_reason: null });
    socket.emit('business-result', { ok: true });
    await FH.pushSellerState(io, group.id, { kind: 'business', title: 'Business application received', body: 'Our compliance team will review your company details.' });
    io.to('finance-admins').emit('business-submitted', F.publicSellerAccount(await store.getGroup(group.id), true));
    if (group.email_b) await E.notifyBusinessStatus(group.email_b, { groupName: group.name, status: 'pending', lang: langOfGroup(group) });
  });

  socket.on('admin-get-business-queue', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const groups = await store.getAllGroups();
    socket.emit('business-queue-list', groups.filter((g) => g.business_status === 'pending').map((g) => F.publicSellerAccount(g, true)));
  });

  socket.on('admin-review-business', async ({ groupId, decision, reason }) => {
    if (!metaHasMinRole('ADMIN') || !adminLimiter.allow(meta().sessionToken)) return;
    if (!['verified', 'rejected'].includes(decision)) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group || group.business_status !== 'pending') return;
    const note = decision === 'rejected' ? (sanitizeText(reason, 500) || 'Not specified') : null;
    await store.updateGroup(group.id, {
      business_status: decision, business_reviewed_at: new Date().toISOString(), business_rejection_reason: note,
      seller_account_type: decision === 'verified' ? 'Business account' : 'Standard account'
    });
    await FH.pushSellerState(io, group.id, {
      kind: 'business', title: decision === 'verified' ? 'Business account approved' : 'Business application not approved',
      body: decision === 'verified' ? 'Your account is now a Business account with no daily withdrawal limit.' : (note || 'Please review the reason and resubmit.')
    });
    if (group.email_b) await E.notifyBusinessStatus(group.email_b, { groupName: group.name, status: decision, reason: note, lang: langOfGroup(group) });
    io.to('finance-admins').emit('business-resolved', F.publicSellerAccount(await store.getGroup(group.id), true));
  });

  // ====================================================================
  // Withdrawals — gate, limits, crypto requirement, email confirmation
  // ====================================================================
  const WD_BLOCK_MSG = {
    not_in_disbursement: 'This transaction has not reached the disbursement stage yet. Withdrawals open once the Desk confirms the transaction and moves it to disbursement. Please complete the transaction in your transaction group.',
    kyc_required: 'Your identity must be verified before you can withdraw.'
  };

  // Validate a withdrawal request end-to-end. Returns {error} | {blocked} | {value}.
  async function evaluateWithdrawal(group, p) {
    if (!group.disbursement_enabled) return { blocked: { code: 'not_in_disbursement', message: WD_BLOCK_MSG.not_in_disbursement } };
    if (group.kyc_status !== 'verified') return { blocked: { code: 'kyc_required', message: WD_BLOCK_MSG.kyc_required } };
    if (!group.seller_currency) return { error: 'Your account currency has not been set yet.' };
    const amt = F.round2(Number(p.amount));
    if (!Number.isFinite(amt) || amt <= 0) return { error: 'Please enter a valid amount.' };
    if (amt > 999999999.99) return { error: 'That amount is above the maximum for a single withdrawal.' };
    if (!['crypto', 'bank'].includes(p.method)) return { error: 'Please choose a withdrawal method.' };

    let ledgerAmount; let ccy; const d = {};
    if (p.method === 'crypto') {
      if (!F.CRYPTO_ASSETS.has(p.asset)) return { error: 'Please choose a valid asset.' };
      const dest = sanitizeText(p.destination, 200);
      if (!/^[A-Za-z0-9:_\-.]{14,120}$/.test(dest)) return { error: 'Please enter a valid destination wallet address.' };
      ccy = F.CURRENCIES.has(p.amountCurrency) ? p.amountCurrency : group.seller_currency;
      ledgerAmount = F.convertCurrency(amt, ccy, group.seller_currency);
      Object.assign(d, { asset: p.asset, network: sanitizeText(p.network, 20) || null, destination: dest });
    } else {
      const bn = sanitizeText(p.beneficiaryName, 200); const bk = sanitizeText(p.bankName, 200); const ac = sanitizeText(p.bankAccount, 60);
      if (bn.length < 2 || bk.length < 2) return { error: 'Beneficiary name and bank name are required.' };
      if (!/^[A-Za-z0-9 \-]{5,40}$/.test(ac)) return { error: 'Please enter a valid account number or IBAN.' };
      const swift = sanitizeText(p.bankSwift, 20).replace(/\s/g, '').toUpperCase();
      if (swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swift)) return { error: 'The SWIFT/BIC code must be 8 or 11 characters.' };
      const bc = CD.find(p.bankCountry);
      if (!bc) return { error: 'Please select the bank’s country.' };
      ccy = group.seller_currency; // bank transfers stay in the account's own currency
      ledgerAmount = amt;
      Object.assign(d, { beneficiaryName: bn, bankName: bk, bankAccount: ac, bankSwift: swift || null, bankCountry: bc.n });
    }
    ledgerAmount = F.round2(ledgerAmount);
    if (ledgerAmount > Number(group.balance_available || 0) + 1e-9) return { error: 'That amount exceeds your available balance.' };

    const [wds, limit] = await Promise.all([store.getWithdrawalsForGroup(group.id), POL.getDailyLimit(store)]);
    const dl = POL.dailyLimitCheck(group, wds, ledgerAmount, limit);
    if (!dl.allowed) {
      return { blocked: { code: 'daily_limit', limit, used: dl.used, remaining: dl.remaining, currency: group.seller_currency, canUpgrade: group.business_status !== 'verified' } };
    }
    let gate = null;
    if (p.method === 'crypto') {
      const [deps, tiers] = await Promise.all([store.getDepositsForGroup(group.id), POL.getTiers(store)]);
      gate = POL.cryptoGate(group, deps, ledgerAmount, tiers);
      if (!gate.allowed) return { blocked: { code: 'crypto_deposit_required', ...gate } };
    }
    return { value: { method: p.method, amount: amt, amountCurrency: ccy, amountLedger: ledgerAmount, ...d, gate } };
  }

  const wdSummaryText = (group, v) => `${F.fmtMoney(v.amount, v.amountCurrency)}${v.amountCurrency !== group.seller_currency ? ` (≈ ${F.fmtMoney(v.amountLedger, group.seller_currency)})` : ''}`;
  const wdDestText = (v) => (v.method === 'crypto' ? `${v.asset} wallet ${v.destination.slice(0, 6)}…${v.destination.slice(-4)}` : `${v.bankName} ••••${String(v.bankAccount).replace(/\W/g, '').slice(-4)}`);

  async function sendWithdrawalCode(group, v, m) {
    const code = S.generateSixDigitCode();
    await store.createEmailCode({
      groupId: group.id, purpose: 'withdraw', email: group.email_b, codeHash: S.hashCode(code),
      payload: v, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString()
    });
    const lang = langOfGroup(group);
    const delivered = await E.notifyWithdrawalCode(group.email_b, { code, lang, amountText: wdSummaryText(group, v), destination: wdDestText(v) });
    socket.emit('withdrawal-code-sent', {
      masked: S.maskEmail(group.email_b), expiresInSec: CODE_TTL_MS / 1000, delivered, mock: !E.isEmailConfigured(),
      summary: { method: v.method, amountText: wdSummaryText(group, v), destination: wdDestText(v) }
    });
  }

  // Step 1: validate, then email a confirmation code. Nothing moves yet.
  socket.on('request-withdrawal', async (p) => {
    p = p || {};
    const group = await requireActiveSeller(p.groupId);
    if (!group) return;
    const m = meta();
    if (!accountLimiter.allow(m.sessionToken)) return socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.');
    if (!group.email_b) return socket.emit('error-msg', 'No email address is on file for this account.');
    const ev = await evaluateWithdrawal(group, p);
    if (ev.error) return socket.emit('error-msg', ev.error);
    if (ev.blocked) return socket.emit('withdrawal-blocked', { groupId: group.id, ...ev.blocked });
    if (!codeSendLimiter.allow(m.sessionToken)) return socket.emit('error-msg', 'Too many code requests — please wait a few minutes and try again.');
    await recordIp(group, ipOf(), 'withdraw');
    await sendWithdrawalCode(group, ev.value, m);
  });

  socket.on('resend-withdrawal-code', async ({ groupId }) => {
    const group = await requireActiveSeller(groupId);
    if (!group) return;
    const m = meta();
    const rec = await store.getLatestEmailCode(group.id, 'withdraw');
    if (!rec || !rec.payload) return socket.emit('error-msg', 'Please start the withdrawal again.');
    if (Date.now() - new Date(rec.created_at).getTime() < CODE_RESEND_MS) return socket.emit('error-msg', 'A code was just sent. Please wait a few seconds.');
    if (!codeSendLimiter.allow(m.sessionToken)) return socket.emit('error-msg', 'Too many code requests — please wait a few minutes and try again.');
    await sendWithdrawalCode(group, rec.payload, m);
  });

  // Step 2: the code confirms it. Everything is re-checked against current state, then the funds are reserved.
  socket.on('confirm-withdrawal', async ({ groupId, code }) => {
    const group = await requireActiveSeller(groupId);
    if (!group) return;
    const m = meta();
    const fail = (message) => socket.emit('withdrawal-code-error', { message });
    if (!accountLimiter.allow(m.sessionToken)) return fail('Too many attempts — please wait a moment.');
    const rec = await store.getLatestEmailCode(group.id, 'withdraw');
    if (!rec || !rec.payload) return fail('Please start the withdrawal again.');
    if (new Date(rec.expires_at) < new Date()) return fail('That code has expired. Please request a new one.');
    if (rec.attempts >= CODE_MAX_ATTEMPTS) return fail('Too many incorrect attempts. Please request a new code.');
    if (!/^\d{6}$/.test(String(code || '')) || !sameHash(rec.code_hash, S.hashCode(String(code)))) {
      const n = await store.bumpEmailCodeAttempts(rec.id);
      return fail(n >= CODE_MAX_ATTEMPTS ? 'Too many incorrect attempts. Please request a new code.' : 'That code is not correct. Please check it and try again.');
    }
    const consumed = await store.consumeEmailCode(rec.id); // a code can only ever confirm one withdrawal
    if (!consumed) return fail('That code has already been used.');

    const ev = await evaluateWithdrawal(group, rec.payload);
    if (ev.error) return fail(ev.error);
    if (ev.blocked) { socket.emit('withdrawal-blocked', { groupId: group.id, ...ev.blocked }); return; }
    const v = ev.value;
    const moved = await store.adjustBalances(group.id, { available: -v.amountLedger, held: v.amountLedger });
    if (!moved) return fail('That amount exceeds your available balance.');
    let wd;
    try {
      wd = await store.createWithdrawal({
        groupId: group.id, method: v.method, asset: v.asset || null, network: v.network || null, destination: v.destination || null,
        beneficiaryName: v.beneficiaryName || null, bankName: v.bankName || null, bankAccount: v.bankAccount || null,
        bankSwift: v.bankSwift || null, bankCountry: v.bankCountry || null,
        amount: v.amount, amountCurrency: v.amountCurrency, amountLedger: v.amountLedger,
        fundsReserved: true, requestIp: ipOf(), sellerAccountId: group.seller_account_id || null
      });
    } catch (err) {
      await store.adjustBalances(group.id, { available: v.amountLedger, held: -v.amountLedger });
      console.error('[confirm-withdrawal] create failed:', err);
      return fail('Something went wrong. Nothing was withdrawn — please try again.');
    }
    if (v.method === 'crypto' && v.gate && !group.crypto_deposit_verified) await store.updateGroup(group.id, { crypto_deposit_verified: true }); // one-time unlock
    await recordIp(await store.getGroup(group.id), ipOf(), 'withdraw-confirmed');
    socket.emit('withdrawal-created', F.publicWithdrawal(wd, false));
    io.to('finance-admins').emit('withdrawal-created', F.publicWithdrawal(wd, true));
    await FH.pushSellerState(io, group.id, null);
    if (broadcastGroupsList) await broadcastGroupsList();
  });

  // Live recalculation for the crypto-requirement popup as the amount changes.
  socket.on('check-crypto-requirement', async ({ groupId, amount, amountCurrency }) => {
    const group = await requireActiveSeller(groupId, { silent: true });
    if (!group || !group.seller_currency) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const ccy = F.CURRENCIES.has(amountCurrency) ? amountCurrency : group.seller_currency;
    const ledger = F.convertCurrency(amt, ccy, group.seller_currency);
    const [deps, tiers] = await Promise.all([store.getDepositsForGroup(group.id), POL.getTiers(store)]);
    socket.emit('crypto-requirement', { groupId: group.id, ...POL.cryptoGate(group, deps, ledger, tiers) });
  });

  // ====================================================================
  // Admin controls over a seller
  // ====================================================================
  function adminGuard() {
    if (!metaHasMinRole('ADMIN')) return false;
    if (!adminLimiter.allow(meta().sessionToken)) { socket.emit('error-msg', 'Too many actions — please wait a moment.'); return false; }
    return true;
  }

  socket.on('admin-get-sellers', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    const groups = await store.getAllGroups();
    socket.emit('sellers-list', groups.filter((g) => g.seller_registered).map((g) => F.publicSellerAccount(g, true)));
  });

  // Disable / enable a seller: the seller is told live, by push and by email, and sees the contact address.
  socket.on('admin-set-seller-disabled', async ({ groupId, disabled, reason }) => {
    try {
      if (!adminGuard()) return;
      const group = await store.getGroup(String(groupId || ''));
      if (!group || !group.seller_registered) return socket.emit('error-msg', 'That seller account does not exist yet.');
      const off = !!disabled;
      if (off === !!group.seller_disabled) return;
      const note = off ? (sanitizeText(reason, 300) || null) : null;
      await store.updateGroup(group.id, { seller_disabled: off, seller_disabled_at: off ? new Date().toISOString() : null, seller_disabled_reason: note });
      const updated = await store.getGroup(group.id);
      io.to(`seller:${group.id}`).emit(off ? 'seller-disabled' : 'seller-enabled', { groupId: group.id, reason: note, contact: SUPPORT });
      await FH.pushSellerState(io, group.id, off
        ? { kind: 'account', title: 'Account disabled', body: `Your account has been disabled. Please contact ${SUPPORT}.` }
        : { kind: 'account', title: 'Account re-enabled', body: 'Your account is active again.' });
      if (group.seller_session_token && !Array.from((io._activeSockets || new Map()).values()).some((v) => v.sessionToken === group.seller_session_token)) {
        const t = await FH.localize(updated, off
          ? { title: 'Account disabled', body: `Your account has been disabled. Please contact ${SUPPORT}.` }
          : { title: 'Account re-enabled', body: 'Your account is active again.' });
        await require('./webpush').sendPushToUser(group.seller_session_token, { title: t.title, body: t.body, url: '/' });
      }
      if (updated.email_b) {
        if (off) await E.notifySellerDisabled(updated.email_b, { groupName: updated.name, reason: note, lang: langOfGroup(updated) });
        else await E.notifySellerEnabled(updated.email_b, { groupName: updated.name, lang: langOfGroup(updated) });
      }
      io.to('finance-admins').emit('seller-account-updated', F.publicSellerAccount(updated, true));
      if (broadcastGroupsList) await broadcastGroupsList();
    } catch (err) { console.error('[admin-set-seller-disabled]', err); socket.emit('error-msg', 'Could not update that account.'); }
  });

  // Disbursement gate: on/off per transaction group. Shown in the admin dashboard, the chat header and the seller account.
  socket.on('admin-set-disbursement', async ({ groupId, enabled }) => {
    try {
      if (!adminGuard()) return;
      const group = await store.getGroup(String(groupId || ''));
      if (!group) return socket.emit('error-msg', 'That group no longer exists.');
      const on = !!enabled;
      if (on === !!group.disbursement_enabled) { io.to(group.id).emit('disbursement-status', { groupId: group.id, enabled: on }); return; }
      await store.updateGroup(group.id, { disbursement_enabled: on, disbursement_updated_at: new Date().toISOString() });
      io.to(group.id).emit('disbursement-status', { groupId: group.id, enabled: on });
      await postSystemMessage(io, group.id, on
        ? '🔓 This transaction is confirmed and has moved to the disbursement stage. Withdrawals are now open.'
        : '🔒 Disbursement has been paused. Withdrawals are closed until the transaction returns to the disbursement stage.');
      if (group.seller_registered) {
        const notice = on
          ? { kind: 'account', title: 'Disbursement stage reached', body: 'Your transaction is confirmed. You can now request a withdrawal.' }
          : { kind: 'account', title: 'Disbursement paused', body: 'Withdrawals are closed until the transaction returns to the disbursement stage.' };
        await FH.pushSellerState(io, group.id, notice);
        const updated = await store.getGroup(group.id);
        if (group.seller_session_token && !Array.from((io._activeSockets || new Map()).values()).some((v) => v.sessionToken === group.seller_session_token)) {
          const t = await FH.localize(updated, notice);
          await require('./webpush').sendPushToUser(group.seller_session_token, { title: t.title, body: t.body, url: '/' });
        }
        if (updated.email_b) await E.notifyDisbursement(updated.email_b, { groupName: updated.name, enabled: on, lang: langOfGroup(updated) });
      }
      if (broadcastGroupsList) await broadcastGroupsList();
      io.to('admins').emit('disbursement-status', { groupId: group.id, enabled: on });
    } catch (err) { console.error('[admin-set-disbursement]', err); socket.emit('error-msg', 'Could not update the disbursement stage.'); }
  });

  // IP controls (per seller).
  async function mutateBlockedIps(groupId, ip, add) {
    if (!adminGuard()) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group) return socket.emit('error-msg', 'That group no longer exists.');
    const clean = S.cleanIp(String(ip || '').trim());
    if (!clean || !S.isValidIp(clean)) return socket.emit('error-msg', 'Please enter a valid IP address.');
    const list = Array.isArray(group.seller_blocked_ips) ? group.seller_blocked_ips.slice() : [];
    const next = add ? Array.from(new Set(list.concat(clean))) : list.filter((x) => x !== clean);
    await store.updateGroup(group.id, { seller_blocked_ips: next });
    if (add) { // anyone currently connected from that IP as this seller is cut off now
      for (const [sockId, v] of (io._activeSockets || new Map())) {
        if (v.groupId === group.id && v.sessionToken === group.seller_session_token) {
          const s = io.sockets.sockets.get(sockId);
          if (s && S.getSocketIp(s) === clean) { s.emit('ip-blocked', { groupId: group.id, contact: SUPPORT }); }
        }
      }
    }
    await FH.pushAdminLedger(io, group.id);
  }
  socket.on('admin-block-ip', ({ groupId, ip }) => mutateBlockedIps(groupId, ip, true).catch((e) => console.error('[block-ip]', e)));
  socket.on('admin-unblock-ip', ({ groupId, ip }) => mutateBlockedIps(groupId, ip, false).catch((e) => console.error('[unblock-ip]', e)));

  // VIP / institutional override of the crypto prior-deposit requirement.
  socket.on('admin-set-crypto-override', async ({ groupId, enabled }) => {
    if (!adminGuard()) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group) return;
    await store.updateGroup(group.id, { crypto_deposit_verified: !!enabled, crypto_override_by: enabled ? meta().sessionToken : null });
    await FH.pushSellerState(io, group.id, null);
  });

  // Passwords are hashed and cannot be viewed by anyone. The Desk can email the seller a reset code instead.
  socket.on('admin-send-password-reset', async ({ groupId }) => {
    if (!adminGuard()) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group || !group.seller_registered || !group.email_b) return socket.emit('error-msg', 'That seller has no registered email.');
    const code = S.generateSixDigitCode();
    await store.createPasswordReset({ groupId: group.id, codeHash: S.hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
    await E.notifyPasswordResetCode(group.email_b, { code, groupName: group.name, lang: langOfGroup(group) });
    socket.emit('admin-notice', { message: `Password reset code emailed to ${S.maskEmail(group.email_b)}.` });
  });

  // Policy: daily limit, crypto-deposit tiers, KYC auto-approve.
  socket.on('admin-get-policy', async () => {
    if (!metaHasMinRole('ADMIN')) return;
    socket.emit('policy', {
      tiers: await POL.getTiers(store), ranges: POL.RANGES, daily: await POL.getDailyLimit(store),
      kycAutoApprove: !!((await store.getSetting('kyc_settings')) || {}).autoApprove, emailConfigured: E.isEmailConfigured()
    });
  });
  socket.on('admin-save-policy', async ({ tiers, daily, kycAutoApprove }) => {
    if (!adminGuard()) return;
    if (tiers !== undefined) { const r = await POL.saveTiers(store, tiers); if (r.error) return socket.emit('error-msg', r.error); }
    if (daily !== undefined) { const r = await POL.saveDailyLimit(store, daily); if (r.error) return socket.emit('error-msg', r.error); }
    if (kycAutoApprove !== undefined) await store.setSetting('kyc_settings', { autoApprove: !!kycAutoApprove });
    socket.emit('admin-notice', { message: 'Policy saved.' });
    socket.emit('policy', {
      tiers: await POL.getTiers(store), ranges: POL.RANGES, daily: await POL.getDailyLimit(store),
      kycAutoApprove: !!((await store.getSetting('kyc_settings')) || {}).autoApprove, emailConfigured: E.isEmailConfigured()
    });
  });
}

module.exports = { registerSellerHandlers, recordIp, isIpBlocked };
