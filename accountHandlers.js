// Seller Transaction Account — everything the SELLER does (register, verify email, KYC,
// business upgrade, deposit, withdraw) and everything the ADMIN does to a seller's
// account (disable/enable, disbursement gate, IP block list, password reset, reviews).
//
// Rules enforced here, on the server, for every request:
//   * a registered seller's seat can only be used by a session that signed in (password)
//   * a disabled account, or a blocked IP, can do nothing but see the notice
//   * withdrawals need: verified KYC, the admin's disbursement switch ON, balance,
//     the daily limit (or a verified business account), the crypto prior-deposit
//     requirement (crypto only) and — when email delivery is configured — an emailed code

const { store } = require('./db');
const F = require('./finance');
const S = require('./security');
const { sanitizeText, escapeHtml, isValidEmail, RateLimiter, hashPassword, passwordProblem, generateSixDigitCode, hashCode, codeMatches, generateAccountId, normalizePhone } = S;
const COUNTRIES = require('./public/countries.js');
const LANGS = require('./public/languages.js');
const { runKycChecks } = require('./kycCheck');
const CD = require('./cryptoDeposit');
const E = require('./email');
const N = require('./notifyService');
const IP = require('./ipTools');
const FH = require('./fundsHandlers');

const TERMS_VERSION = 'QSTD-TERMS-2026-10';
const COMPLAINTS_EMAIL = E.COMPLAINTS_EMAIL;
const SUPPORT_EMAIL = E.SUPPORT_EMAIL;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 30 * 1000;
const CODE_MAX_ATTEMPTS = 5;

const accountLimiter = new RateLimiter({ windowMs: 60000, max: Number(process.env.ACCOUNT_RATE_LIMIT) || 20 });
const codeLimiter = new RateLimiter({ windowMs: 10 * 60 * 1000, max: 8 });
setInterval(() => { accountLimiter.sweep(); codeLimiter.sweep(); }, 60000).unref();

const KYC_DOC_TYPES = new Set(['national_id', 'drivers_license', 'passport']);
const PROOF_ADDRESS_TYPES = new Set(['bank_statement', 'utility_bill', 'electricity_bill', 'council_tax', 'other']);
const UPLOAD_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
const BUSINESS_TYPES = new Set(['sole_proprietor', 'partnership', 'llc', 'corporation', 'ngo', 'other']);

function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!u || !d) return '';
  return `${u[0]}${'•'.repeat(Math.max(2, Math.min(6, u.length - 2)))}${u.length > 1 ? u[u.length - 1] : ''}@${d}`;
}
const norm = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();

function registerAccountHandlers(io, socket, ctx) {
  const { meta, metaHasMinRole } = ctx;

  const disabledMessage = (g) => `Your account has been disabled${g.seller_disabled_reason ? ` (${g.seller_disabled_reason})` : ''}. To lodge a complaint, contact ${COMPLAINTS_EMAIL} (general help: ${SUPPORT_EMAIL}).`;

  /**
   * Resolve & authorise the seller acting on THEIR OWN group. Returns the group or null
   * (having told the client why). `allowDisabled` is for the few actions a disabled seller still needs.
   */
  async function sellerGroup(groupId, { allowUnregistered = false, allowDisabled = false } = {}) {
    const m = meta();
    if (!m || m.isAdmin) return null;
    const group = await store.getGroup(String(groupId || ''));
    if (!group || group.seller_session_token !== m.sessionToken) return null;
    if (!group.seller_registered) {
      if (allowUnregistered) return group;
      socket.emit('error-msg', 'Please create your Transaction Account first.');
      return null;
    }
    if (!(await store.hasSellerSession(group.id, m.sessionToken))) {
      socket.emit('seller-login-required', { groupId: group.id, groupName: group.name, emailHint: maskEmail(group.email_b) });
      return null;
    }
    if (await store.isIpBlocked(group.id, m.ip)) {
      socket.emit('seller-ip-blocked', { supportEmail: COMPLAINTS_EMAIL });
      return null;
    }
    if (group.seller_disabled && !allowDisabled) { socket.emit('error-msg', disabledMessage(group)); return null; }
    return group;
  }
  const limited = () => {
    if (!accountLimiter.allow(meta().sessionToken)) { socket.emit('error-msg', 'Too many attempts — please wait a moment and try again.'); return true; }
    return false;
  };
  const adminGuard = () => metaHasMinRole('ADMIN');

  // ==========================================================================
  // REGISTRATION — email check code, then create the account
  // ==========================================================================
  async function resolveRegistrationEmail(group, submitted) {
    const clean = typeof submitted === 'string' ? submitted.trim() : '';
    const email = clean || group.email_b || '';
    if (!isValidEmail(email)) return { error: 'Please enter a valid email address.' };
    return { email };
  }

  socket.on('send-registration-code', async ({ groupId, email }) => {
    try {
      const group = await sellerGroup(groupId, { allowUnregistered: true });
      if (!group) return;
      if (group.seller_registered) return socket.emit('error-msg', 'This Transaction Account has already been created.');
      if (!codeLimiter.allow('reg:' + meta().sessionToken)) return socket.emit('error-msg', 'Too many codes requested — please wait a few minutes and try again.');
      const r = await resolveRegistrationEmail(group, email);
      if (r.error) return socket.emit('error-msg', r.error);
      if (!E.emailCodesRequired()) return socket.emit('registration-code-sent', { required: false, email: r.email });
      const prev = await store.getLatestVerificationCode(group.id, 'register');
      if (prev && prev.email === r.email && Date.now() - new Date(prev.created_at).getTime() < CODE_RESEND_MS) {
        return socket.emit('error-msg', 'A code was just sent — please wait a few seconds before requesting another.');
      }
      const code = generateSixDigitCode();
      await store.createVerificationCode({ groupId: group.id, purpose: 'register', email: r.email, codeHash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
      const sent = await E.notifyRegistrationCode(r.email, { code, lang: (await store.getUser(meta().sessionToken) || {}).language });
      if (!E.isEmailConfigured()) console.log(`[verification] registration code for ${r.email}: ${code} (email delivery is not configured — shown here for testing)`);
      else if (!sent) return socket.emit('error-msg', 'We could not send the verification email just now. Please check the address and try again in a moment.');
      socket.emit('registration-code-sent', { required: true, email: r.email, emailMasked: maskEmail(r.email), expiresInSec: CODE_TTL_MS / 1000, resendInSec: CODE_RESEND_MS / 1000 });
    } catch (err) { console.error('[send-registration-code]', err); socket.emit('error-msg', 'We could not send the code. Please try again.'); }
  });

  socket.on('register-transaction-account', async (p) => {
    try {
      p = p || {};
      const m = meta();
      if (!m || m.isAdmin) return;
      if (limited()) return;
      const group = await sellerGroup(p.groupId, { allowUnregistered: true });
      if (!group) return socket.emit('error-msg', 'You are not the Seller of this group.');
      if (group.seller_registered) return socket.emit('error-msg', 'This Transaction Account has already been created.');
      if (await store.isIpBlocked(group.id, m.ip)) return socket.emit('seller-ip-blocked', { supportEmail: COMPLAINTS_EMAIL });

      const fullName = sanitizeText(p.fullName, 200);
      if (fullName.length < 3 || !/\p{L}/u.test(fullName)) return socket.emit('error-msg', 'Please enter your full legal name.');
      const er = await resolveRegistrationEmail(group, p.email);
      if (er.error) return socket.emit('error-msg', er.error);
      const phone = normalizePhone(String(p.phone || ''));
      if (!phone) return socket.emit('error-msg', 'Please enter a valid phone number including your country code.');
      const pw = passwordProblem(p.password);
      if (pw) return socket.emit('error-msg', pw);
      if (p.password !== p.passwordConfirm) return socket.emit('error-msg', 'The two passwords do not match.');
      if (!F.CURRENCIES.has(p.currency)) return socket.emit('error-msg', 'Please choose a valid account currency.');
      const dob = new Date(p.dateOfBirth);
      if (!p.dateOfBirth || Number.isNaN(dob.getTime()) || dob.getFullYear() < 1900 || dob.getTime() > Date.now()) return socket.emit('error-msg', 'Please enter a valid date of birth.');
      if ((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000) < 18) return socket.emit('error-msg', 'You must be at least 18 years old to create a Transaction Account.');
      const country = COUNTRIES.byName(p.country);
      if (!country) return socket.emit('error-msg', 'Please select your country.');
      const lang = LANGS.get(p.language) ? p.language : 'en';
      if (p.accountType !== 'Standard account') return socket.emit('error-msg', 'Please select the Standard account type.');
      if (p.acceptTerms !== true) return socket.emit('error-msg', 'You must accept the Terms & Policy to create your account.');

      // Email verification (enforced whenever email delivery is configured, or REQUIRE_EMAIL_CODES=true).
      let emailVerified = false;
      let verification = null;
      if (E.emailCodesRequired()) {
        verification = await store.getLatestVerificationCode(group.id, 'register');
        const code = String(p.emailCode || '').trim();
        if (!/^\d{6}$/.test(code)) return socket.emit('error-msg', 'Please enter the 6-digit code we emailed you.');
        if (!verification || verification.email !== er.email || new Date(verification.expires_at) < new Date()) {
          return socket.emit('error-msg', 'That code has expired or was sent to a different email. Please request a new code.');
        }
        if ((await store.bumpVerificationAttempts(verification.id)) > CODE_MAX_ATTEMPTS) return socket.emit('error-msg', 'Too many incorrect codes. Please request a new code.');
        if (!codeMatches(code, verification.code_hash)) return socket.emit('error-msg', 'That code is not correct. Please check it and try again.');
        emailVerified = true;
      }

      const fields = {
        seller_registered: true, seller_full_name: escapeHtml(fullName), seller_password_hash: hashPassword(p.password),
        seller_currency: p.currency, seller_date_of_birth: p.dateOfBirth, seller_country: country.name,
        seller_phone: phone, seller_email_verified: emailVerified, seller_account_type: 'Standard account',
        seller_language: lang, terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION,
        seller_registered_ip: m.ip || null, seller_registered_at: new Date().toISOString(),
        currency_locked_at: new Date().toISOString(), email_b: er.email
      };
      if (verification) { if (!(await store.consumeVerificationCode(verification.id))) return socket.emit('error-msg', 'That code was already used. Please request a new one.'); }
      await store.updateGroup(group.id, fields);
      await store.ensureSellerAccountId(group.id, generateAccountId);
      await store.addSellerSession(group.id, m.sessionToken, m.ip);
      await store.logIpEvent({ groupId: group.id, kind: 'register', ip: m.ip || 'unknown', country: country.code, userAgent: socket.handshake.headers['user-agent'] });
      await store.upsertUser({ sessionToken: m.sessionToken, role: 'PARTY B', countryCode: country.code, countryName: country.name, language: lang });

      const updated = await store.getGroup(group.id);
      E.notifyWelcome(er.email, { name: fullName, accountId: updated.seller_account_id, accountType: 'Standard account', currency: p.currency, lang }).catch(() => {});
      socket.emit('seller-account-state', F.publicSellerAccount(updated));
      socket.emit('transaction-account-created', { groupId: group.id, accountId: updated.seller_account_id });
      io.to('finance-admins').emit('seller-account-updated', F.publicSellerAccount(updated, { forAdmin: true }));
      await FH.pushAdminLedger(io, group.id);
      if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
      if (ctx.broadcastDirectory) await ctx.broadcastDirectory();
    } catch (err) { console.error('[register-transaction-account]', err); socket.emit('error-msg', 'We could not create your account. Please try again.'); }
  });

  // Language preference — for the signed-in seller it is saved on the ACCOUNT too.
  socket.on('set-my-language', async ({ lang }) => {
    const m = meta();
    if (!m || !LANGS.get(lang)) return;
    await store.upsertUser({ sessionToken: m.sessionToken, language: lang });
    if (!m.isAdmin) {
      const g = await store.getGroup(m.groupId);
      if (g && g.seller_session_token === m.sessionToken && g.seller_registered && await store.hasSellerSession(g.id, m.sessionToken)) {
        await store.updateGroup(g.id, { seller_language: lang });
        socket.emit('seller-account-state', F.publicSellerAccount(await store.getGroup(g.id)));
        await FH.pushAdminLedger(io, g.id);
      }
    }
    socket.emit('my-language-updated', { lang });
    if (ctx.broadcastDirectory) await ctx.broadcastDirectory();
  });

  // ==========================================================================
  // KYC — automatic pre-check, then the Desk's review queue
  // ==========================================================================
  socket.on('submit-kyc', async (p) => {
    try {
      p = p || {};
      const group = await sellerGroup(p.groupId);
      if (!group) return;
      if (limited()) return;
      if (group.kyc_status === 'verified') return socket.emit('error-msg', 'Your identity is already verified.');
      if (group.kyc_status === 'pending') return socket.emit('error-msg', 'Your documents are already under review.');
      if (!KYC_DOC_TYPES.has(p.docType)) return socket.emit('error-msg', 'Please select a valid document type.');
      if (!PROOF_ADDRESS_TYPES.has(p.proofAddressType)) return socket.emit('error-msg', 'Please select what kind of proof of address you\'re uploading.');
      if (!p.idFrontUrl || !p.proofAddressUrl || !p.selfieUrl) return socket.emit('error-msg', 'ID (front), proof of address, and a selfie are all required.');
      if (p.docType !== 'passport' && !p.idBackUrl) return socket.emit('error-msg', 'The back of your ID is required for this document type.');
      const urls = [p.idFrontUrl, p.proofAddressUrl, p.selfieUrl].concat(p.docType !== 'passport' ? [p.idBackUrl] : []);
      if (!urls.every((u) => typeof u === 'string' && UPLOAD_URL_RE.test(u))) return socket.emit('error-msg', 'One of your documents was not uploaded correctly. Please upload it again.');

      // Automatic checks (moderate): expiry, name match, ID number sanity, duplicates, image quality.
      // The same person may hold accounts in several groups (same email) — only a DIFFERENT seller reusing an ID number is a duplicate.
      const myEmail = String(group.email_b || '').toLowerCase();
      const others = (await store.getAllGroups()).filter((g) => g.id !== group.id && g.kyc_id_number && g.kyc_status !== 'rejected' && String(g.email_b || '').toLowerCase() !== myEmail).map((g) => norm(g.kyc_id_number));
      const faceCount = Number.isInteger(p.selfieFaceCount) && p.selfieFaceCount >= 0 && p.selfieFaceCount <= 10 ? p.selfieFaceCount : null;
      const result = await runKycChecks({
        fullName: group.seller_full_name, docType: p.docType, nameOnId: sanitizeText(p.nameOnId, 200), idNumber: sanitizeText(p.idNumber, 40),
        idExpiry: sanitizeText(p.idExpiry, 10), issuingCountry: sanitizeText(p.issuingCountry, 100),
        idFrontUrl: p.idFrontUrl, idBackUrl: p.docType !== 'passport' ? p.idBackUrl : null, proofAddressUrl: p.proofAddressUrl, selfieUrl: p.selfieUrl,
        selfieFaceCount: faceCount
      }, { otherIdNumbers: others });

      const base = {
        kyc_doc_type: p.docType, kyc_id_front_url: p.idFrontUrl, kyc_id_back_url: p.docType === 'passport' ? null : p.idBackUrl,
        kyc_proof_address_url: p.proofAddressUrl, kyc_proof_address_type: p.proofAddressType, kyc_selfie_url: p.selfieUrl,
        kyc_id_number: norm(p.idNumber) || null, kyc_id_expiry: /^\d{4}-\d{2}-\d{2}$/.test(p.idExpiry || '') ? p.idExpiry : null,
        kyc_name_on_id: sanitizeText(p.nameOnId, 200) || null, kyc_issuing_country: sanitizeText(p.issuingCountry, 100) || null,
        kyc_submitted_at: new Date().toISOString(), kyc_auto_report: result.report
      };
      if (!result.ok) {
        const reason = result.reasons.join(' ');
        await store.updateGroup(group.id, { ...base, kyc_status: 'rejected', kyc_rejection_reason: reason.slice(0, 1500) });
        socket.emit('kyc-auto-result', { ok: false, reasons: result.reasons });
        await FH.pushSellerState(io, group.id, null);
        if (group.email_b) await E.notifyKycStatus(group.email_b, { groupName: group.name, status: 'rejected', reason, name: group.seller_full_name, lang: group.seller_language });
        return;
      }
      await store.updateGroup(group.id, { ...base, kyc_status: 'pending', kyc_rejection_reason: null });
      const updated = await store.getGroup(group.id);
      socket.emit('kyc-auto-result', { ok: true, reasons: [] });
      socket.emit('seller-account-state', F.publicSellerAccount(updated));
      io.to('finance-admins').emit('kyc-submitted', F.publicSellerAccount(updated, { forAdmin: true }));
      await FH.pushAdminLedger(io, group.id);
      if (updated.email_b) await E.notifyKycStatus(updated.email_b, { groupName: updated.name, status: 'pending', name: updated.seller_full_name, lang: updated.seller_language });
    } catch (err) { console.error('[submit-kyc]', err); socket.emit('error-msg', 'We could not process your documents. Please try again.'); }
  });

  socket.on('admin-get-kyc-queue', async () => {
    if (!adminGuard()) return;
    const groups = await store.getAllGroups();
    socket.emit('kyc-queue-list', groups.filter((g) => g.kyc_status === 'pending').map((g) => F.publicSellerAccount(g, { forAdmin: true })));
  });

  socket.on('admin-review-kyc', async ({ groupId, decision, reason }) => {
    if (!adminGuard()) return;
    if (!['verified', 'rejected'].includes(decision)) return;
    const group = await store.getGroup(groupId);
    if (!group || group.kyc_status !== 'pending') return;
    const m = meta();
    await store.updateGroup(groupId, {
      kyc_status: decision, kyc_reviewed_by: m.sessionToken, kyc_reviewed_at: new Date().toISOString(),
      kyc_rejection_reason: decision === 'rejected' ? (sanitizeText(reason, 500) || 'Not specified') : null
    });
    const updated = await store.getGroup(groupId);
    await FH.pushSellerState(io, groupId, {
      kind: 'kyc', title: decision === 'verified' ? 'Identity verified' : 'Identity verification not approved',
      body: decision === 'verified' ? 'You can now request withdrawals once the transaction is in the disbursement stage.' : (updated.kyc_rejection_reason || 'Please resubmit your documents.')
    });
    io.to('finance-admins').emit('kyc-resolved', F.publicSellerAccount(updated, { forAdmin: true }));
    if (updated.seller_session_token) await N.pushToToken(updated.seller_session_token, { title: decision === 'verified' ? 'Identity verified' : 'Identity verification not approved', body: decision === 'verified' ? 'Your identity has been verified.' : (updated.kyc_rejection_reason || 'Please resubmit your documents.') });
    if (updated.email_b) await E.notifyKycStatus(updated.email_b, { groupName: updated.name, status: decision, reason: updated.kyc_rejection_reason, name: updated.seller_full_name, lang: updated.seller_language });
  });

  // ==========================================================================
  // BUSINESS (unlimited withdrawal) APPLICATION
  // ==========================================================================
  socket.on('submit-business-application', async (p) => {
    try {
      p = p || {};
      const group = await sellerGroup(p.groupId);
      if (!group) return;
      if (limited()) return;
      if (group.business_status === 'verified') return socket.emit('error-msg', 'Your business account is already approved.');
      if (group.business_status === 'pending') return socket.emit('error-msg', 'Your business application is already under review.');
      const t = (v, n) => sanitizeText(v, n);
      const d = {
        companyName: t(p.companyName, 200), tradingName: t(p.tradingName, 200), registrationNumber: t(p.registrationNumber, 60), taxNumber: t(p.taxNumber, 60),
        country: t(p.country, 100), businessType: t(p.businessType, 40), incorporationDate: t(p.incorporationDate, 10), businessAddress: t(p.businessAddress, 400),
        directorName: t(p.directorName, 200), directorTitle: t(p.directorTitle, 100), industry: t(p.industry, 200), website: t(p.website, 200),
        sourceOfFunds: t(p.sourceOfFunds, 600), expectedMonthlyVolume: t(p.expectedMonthlyVolume, 80), businessEmail: t(p.businessEmail, 254), businessPhone: t(p.businessPhone, 40)
      };
      const need = { companyName: 'company or business name', registrationNumber: 'company registration number', taxNumber: 'tax number', country: 'country of incorporation', businessAddress: 'registered business address', directorName: 'director or authorised signatory name', industry: 'industry / nature of business', sourceOfFunds: 'source of funds', expectedMonthlyVolume: 'expected monthly volume' };
      for (const [k, label] of Object.entries(need)) if (!d[k]) return socket.emit('error-msg', `Please enter the ${label}.`);
      if (!COUNTRIES.byName(d.country)) return socket.emit('error-msg', 'Please select the country of incorporation.');
      if (!BUSINESS_TYPES.has(d.businessType)) return socket.emit('error-msg', 'Please choose the business type.');
      if (d.incorporationDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.incorporationDate)) return socket.emit('error-msg', 'The incorporation date is not valid.');
      if (d.incorporationDate && new Date(d.incorporationDate) > new Date()) return socket.emit('error-msg', 'The incorporation date cannot be in the future.');
      if (d.businessEmail && !isValidEmail(d.businessEmail)) return socket.emit('error-msg', 'The business email does not look valid.');
      if (p.acceptDeclaration !== true) return socket.emit('error-msg', 'Please confirm the declaration to submit your application.');
      if (typeof p.certificateUrl !== 'string' || !UPLOAD_URL_RE.test(p.certificateUrl)) return socket.emit('error-msg', 'Please upload your certificate of incorporation / business registration.');
      if (p.addressProofUrl && !UPLOAD_URL_RE.test(p.addressProofUrl)) return socket.emit('error-msg', 'The business address document was not uploaded correctly.');
      d.certificateUrl = p.certificateUrl; d.addressProofUrl = p.addressProofUrl || null;
      await store.updateGroup(group.id, { business_status: 'pending', business_data: d, business_submitted_at: new Date().toISOString(), business_rejection_reason: null });
      const updated = await store.getGroup(group.id);
      socket.emit('business-submitted', { ok: true });
      socket.emit('seller-account-state', F.publicSellerAccount(updated));
      io.to('finance-admins').emit('business-submitted', F.publicSellerAccount(updated, { forAdmin: true }));
      await FH.pushAdminLedger(io, group.id);
      if (updated.email_b) await E.notifyBusinessStatus(updated.email_b, { status: 'pending', name: updated.seller_full_name, lang: updated.seller_language });
    } catch (err) { console.error('[submit-business-application]', err); socket.emit('error-msg', 'We could not submit your application. Please try again.'); }
  });

  socket.on('admin-get-business-queue', async () => {
    if (!adminGuard()) return;
    socket.emit('business-queue-list', (await store.getAllGroups()).filter((g) => g.business_status === 'pending').map((g) => F.publicSellerAccount(g, { forAdmin: true })));
  });

  socket.on('admin-review-business', async ({ groupId, decision, reason }) => {
    if (!adminGuard()) return;
    if (!['verified', 'rejected'].includes(decision)) return;
    const group = await store.getGroup(groupId);
    if (!group || group.business_status !== 'pending') return;
    const note = sanitizeText(reason, 500);
    if (decision === 'rejected' && !note) return socket.emit('error-msg', 'Please give a reason — it is shown to the seller.');
    await store.updateGroup(groupId, { business_status: decision, business_reviewed_at: new Date().toISOString(), business_rejection_reason: decision === 'rejected' ? note : null });
    const updated = await store.getGroup(groupId);
    const title = decision === 'verified' ? 'Business account approved' : 'Business application not approved';
    const body = decision === 'verified' ? 'The daily withdrawal limit no longer applies to your account.' : note;
    await FH.pushSellerState(io, groupId, { kind: 'business', title, body });
    if (updated.seller_session_token) await N.pushToToken(updated.seller_session_token, { title, body });
    if (updated.email_b) await E.notifyBusinessStatus(updated.email_b, { status: decision, reason: note, name: updated.seller_full_name, lang: updated.seller_language });
    io.to('finance-admins').emit('business-resolved', F.publicSellerAccount(updated, { forAdmin: true }));
  });

  // ==========================================================================
  // DEPOSITS (crypto only — a notification, never proof of funds)
  // ==========================================================================
  socket.on('notify-deposit', async ({ groupId, asset, network, amount }) => {
    const group = await sellerGroup(groupId);
    if (!group) return;
    if (limited()) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 999999999.99) return socket.emit('error-msg', 'Please enter a valid amount.');
    if (!F.CRYPTO_ASSETS.has(asset)) return socket.emit('error-msg', 'Please choose a valid asset.');
    const depAmt = F.round2(amt);
    const dep = await store.createDeposit({ groupId: group.id, method: 'crypto', asset, network: sanitizeText(network, 20) || null, amount: depAmt });
    await store.adjustBalances(group.id, { held: depAmt, total: depAmt });
    await FH.pushSellerState(io, group.id, null);
    socket.emit('deposit-created', F.publicDeposit(dep));
    io.to('finance-admins').emit('deposit-created', F.publicDeposit(dep));
    if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
  });

  socket.on('admin-get-deposits-queue', async () => {
    if (!adminGuard()) return;
    socket.emit('deposits-queue-list', (await store.getPendingDeposits()).map(F.publicDeposit));
  });

  socket.on('admin-review-deposit', async ({ depositId, decision, reason }) => {
    if (!adminGuard()) return;
    if (!['verified', 'rejected'].includes(decision)) return;
    const dep = await store.getDepositById(depositId);
    if (!dep || dep.status !== 'held_in_vault') return;
    const group = await store.getGroup(dep.group_id);
    if (!group) return;
    const amt = F.round2(dep.amount);
    const moved = await store.adjustBalances(dep.group_id, decision === 'verified' ? { held: -amt, available: amt } : { held: -amt, total: -amt });
    if (!moved) return socket.emit('error-msg', 'The seller\'s held balance does not cover this deposit — please check the ledger.');
    const resolved = await store.resolveDeposit(depositId, { status: decision, verifiedBy: meta().sessionToken, rejectionReason: decision === 'rejected' ? (sanitizeText(reason, 500) || 'Not specified') : null });
    const g2 = await store.getGroup(dep.group_id);
    await FH.pushSellerState(io, dep.group_id, {
      kind: 'deposit', title: decision === 'verified' ? 'Deposit confirmed' : 'Deposit could not be confirmed',
      body: decision === 'verified' ? `${F.fmtFull(amt, g2.seller_currency)} is now available.` : (resolved.rejection_reason || 'Not specified')
    });
    io.to('finance-admins').emit('deposit-resolved', F.publicDeposit(resolved));
    if (g2.seller_session_token) await N.pushToToken(g2.seller_session_token, { title: decision === 'verified' ? 'Deposit confirmed' : 'Deposit could not be confirmed', body: decision === 'verified' ? `${F.fmtFull(amt, g2.seller_currency)} is now available.` : (resolved.rejection_reason || '') });
    if (g2.email_b) await E.notifyDepositStatus(g2.email_b, { groupName: g2.name, amount: F.fmtFull(amt, g2.seller_currency), status: decision, reason: resolved.rejection_reason, name: g2.seller_full_name, lang: g2.seller_language });
    if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
  });

  // ==========================================================================
  // WITHDRAWALS — gate -> limit -> crypto requirement -> email code -> reserve funds
  // ==========================================================================
  /** Validates a withdrawal request. Returns { value } or { handled:true } after telling the client what blocks it. */
  async function validateWithdrawal(group, p) {
    const fail = (msg) => { socket.emit('error-msg', msg); return { handled: true }; };
    if (group.kyc_status !== 'verified') return fail('Your identity must be verified before you can withdraw.');
    if (!group.disbursement_enabled) {
      socket.emit('withdrawal-blocked', { reason: 'disbursement', title: 'Transaction not yet in the disbursement stage',
        message: 'Withdrawals open once both parties in your transaction group are confirmed and the Desk has moved the transaction into the disbursement stage. Please complete your part of the transaction first — your funds are safe and will be available to withdraw as soon as the stage is reached.' });
      return { handled: true };
    }
    if (!group.seller_currency) return fail('Your account currency has not been set yet.');
    const amt = F.round2(Number(p.amount));
    if (!Number.isFinite(amt) || amt <= 0) return fail('Please enter a valid amount.');
    if (!['crypto', 'bank'].includes(p.method)) return fail('Please choose a withdrawal method.');
    let ledgerAmount; let ccy; let details;
    if (p.method === 'crypto') {
      if (!F.CRYPTO_ASSETS.has(p.asset)) return fail('Please choose a valid asset.');
      const dest = sanitizeText(p.destination, 200);
      if (dest.length < 10 || /\s/.test(dest)) return fail('Please enter a valid destination wallet address.');
      ccy = F.CURRENCIES.has(p.amountCurrency) ? p.amountCurrency : group.seller_currency;
      ledgerAmount = F.convertCurrency(amt, ccy, group.seller_currency);
      details = { asset: p.asset, network: sanitizeText(p.network, 20) || null, destination: dest };
    } else {
      const bn = sanitizeText(p.beneficiaryName, 200); const bk = sanitizeText(p.bankName, 200); const ac = sanitizeText(p.bankAccount, 100);
      if (!bn || !bk || !ac) return fail('Beneficiary name, bank name and account number/IBAN are required.');
      ccy = group.seller_currency; ledgerAmount = amt;
      details = { beneficiaryName: bn, bankName: bk, bankAccount: ac, bankSwift: sanitizeText(p.bankSwift, 50), bankCountry: sanitizeText(p.bankCountry, 100) };
    }
    ledgerAmount = F.round2(ledgerAmount);
    if (ledgerAmount > Number(group.balance_available || 0)) return fail('That amount exceeds your available balance.');

    // Daily limit (rolling 24 hours, in the account's own currency) — lifted by a verified business account.
    if (group.business_status !== 'verified') {
      const used = F.round2(await store.sumWithdrawalsLedgerSince(group.id, new Date(Date.now() - 24 * 3600 * 1000).toISOString()));
      const limit = F.DAILY_WITHDRAWAL_LIMIT;
      if (used + ledgerAmount > limit) {
        socket.emit('withdrawal-blocked', { reason: 'daily_limit', limit, used, remaining: Math.max(0, F.round2(limit - used)), requested: ledgerAmount, currency: group.seller_currency,
          businessStatus: group.business_status || 'none',
          title: 'Daily withdrawal limit reached',
          message: `The standard daily withdrawal limit is ${F.fmtFull(limit, group.seller_currency)} in any 24 hours. Upgrade to a business account for unlimited withdrawals.` });
        return { handled: true };
      }
    }

    // Crypto only: the one-time prior crypto-deposit requirement (bank withdrawals are unaffected).
    let unlockCrypto = false;
    if (p.method === 'crypto' && !group.crypto_deposit_verified) {
      const tiers = await CD.loadTiers(store);
      const ev = CD.evaluate({ group, amount: amt, amountCurrency: ccy, tiers, deposits: await store.getDepositsForGroup(group.id) });
      if (!ev.allowed) {
        socket.emit('withdrawal-blocked', { reason: 'crypto_deposit', ...ev,
          title: 'A crypto deposit is required first',
          message: `Before your first crypto withdrawal we need a verified crypto deposit on file. A deposit of at least ${F.fmtFull(ev.requiredAccount, ev.currency)} is required for a withdrawal of this size. Your bank withdrawals are not affected.` });
        return { handled: true };
      }
      unlockCrypto = true;
    }
    return { value: { method: p.method, amount: amt, amountCurrency: ccy, ledgerAmount, details, unlockCrypto } };
  }

  async function createWithdrawalNow(group, v, confirmedAt) {
    const L = v.ledgerAmount;
    const moved = await store.adjustBalances(group.id, { available: -L, held: L }); // leaves the main balance, goes straight to pending
    if (!moved) { socket.emit('error-msg', 'That amount exceeds your available balance.'); return null; }
    let wd;
    try {
      wd = await store.createWithdrawal({
        groupId: group.id, method: v.method, asset: v.details.asset || null, network: v.details.network || null, destination: v.details.destination || null,
        beneficiaryName: v.details.beneficiaryName || null, bankName: v.details.bankName || null, bankAccount: v.details.bankAccount || null,
        bankSwift: v.details.bankSwift || null, bankCountry: v.details.bankCountry || null,
        amount: v.amount, amountCurrency: v.amountCurrency, amountLedger: L, ip: meta().ip || null, confirmedAt, fundsReserved: true
      });
    } catch (err) { await store.adjustBalances(group.id, { available: L, held: -L }); throw err; }
    if (v.unlockCrypto) await store.updateGroup(group.id, { crypto_deposit_verified: true });
    await store.logIpEvent({ groupId: group.id, kind: 'withdraw', ip: meta().ip || 'unknown', country: null, userAgent: socket.handshake.headers['user-agent'] });
    socket.emit('withdrawal-created', F.publicWithdrawal(wd));
    io.to('finance-admins').emit('withdrawal-created', F.publicWithdrawal(wd, { forAdmin: true }));
    await FH.pushSellerState(io, group.id, null);
    // Tell offline admins a new request is waiting.
    for (const u of await store.getAllUsers()) {
      if (u.is_admin && !N.isOnline(io, u.session_token)) await N.pushToToken(u.session_token, { title: 'New withdrawal request', body: `${group.seller_full_name || group.name} requested ${F.fmtFull(v.amount, v.amountCurrency)}.` });
    }
    if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
    return wd;
  }

  socket.on('request-withdrawal', async (p) => {
    try {
      p = p || {};
      const group = await sellerGroup(p.groupId);
      if (!group) return;
      if (limited()) return;
      const r = await validateWithdrawal(group, p);
      if (r.handled) return;
      if (!E.emailCodesRequired()) { await createWithdrawalNow(group, r.value, null); return; }
      if (!codeLimiter.allow('wd:' + meta().sessionToken)) return socket.emit('error-msg', 'Too many codes requested — please wait a few minutes and try again.');
      const code = generateSixDigitCode();
      await store.createVerificationCode({ groupId: group.id, purpose: 'withdraw', email: group.email_b, codeHash: hashCode(code), payload: p, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
      const methodText = r.value.method === 'crypto' ? `${r.value.details.asset} to ${r.value.details.destination.slice(0, 8)}…` : `bank transfer to ${r.value.details.bankName}`;
      const sentOk = await E.notifyWithdrawalCode(group.email_b, { code, amountText: F.fmtFull(r.value.amount, r.value.amountCurrency), methodText, name: group.seller_full_name, lang: group.seller_language });
      if (!E.isEmailConfigured()) console.log(`[verification] withdrawal code for ${group.email_b}: ${code} (email delivery is not configured — shown here for testing)`);
      else if (!sentOk) return socket.emit('error-msg', 'We could not send your security code by email just now. Please try again in a moment.');
      socket.emit('withdrawal-code-sent', { emailMasked: maskEmail(group.email_b), expiresInSec: CODE_TTL_MS / 1000, resendInSec: CODE_RESEND_MS / 1000 });
    } catch (err) { console.error('[request-withdrawal]', err); socket.emit('error-msg', 'We could not submit your withdrawal. Please try again.'); }
  });

  socket.on('resend-withdrawal-code', async ({ groupId }) => {
    try {
      const group = await sellerGroup(groupId);
      if (!group) return;
      const prev = await store.getLatestVerificationCode(group.id, 'withdraw');
      if (!prev || !prev.payload) return socket.emit('error-msg', 'Please start your withdrawal again.');
      if (Date.now() - new Date(prev.created_at).getTime() < CODE_RESEND_MS) return socket.emit('error-msg', 'A code was just sent — please wait a few seconds before requesting another.');
      if (!codeLimiter.allow('wd:' + meta().sessionToken)) return socket.emit('error-msg', 'Too many codes requested — please wait a few minutes and try again.');
      const r = await validateWithdrawal(group, prev.payload);
      if (r.handled) return;
      const code = generateSixDigitCode();
      await store.consumeVerificationCode(prev.id);
      await store.createVerificationCode({ groupId: group.id, purpose: 'withdraw', email: group.email_b, codeHash: hashCode(code), payload: prev.payload, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
      const sentOk2 = await E.notifyWithdrawalCode(group.email_b, { code, amountText: F.fmtFull(r.value.amount, r.value.amountCurrency), methodText: r.value.method === 'crypto' ? r.value.details.asset : 'bank transfer', name: group.seller_full_name, lang: group.seller_language });
      if (!E.isEmailConfigured()) console.log(`[verification] withdrawal code for ${group.email_b}: ${code} (email delivery is not configured — shown here for testing)`);
      else if (!sentOk2) return socket.emit('error-msg', 'We could not resend the code by email just now. Please try again in a moment.');
      socket.emit('withdrawal-code-sent', { emailMasked: maskEmail(group.email_b), expiresInSec: CODE_TTL_MS / 1000, resendInSec: CODE_RESEND_MS / 1000, resent: true });
    } catch (err) { console.error('[resend-withdrawal-code]', err); socket.emit('error-msg', 'We could not resend the code. Please try again.'); }
  });

  socket.on('confirm-withdrawal', async ({ groupId, code }) => {
    try {
      const group = await sellerGroup(groupId);
      if (!group) return;
      const c = String(code || '').trim();
      if (!/^\d{6}$/.test(c)) return socket.emit('error-msg', 'Please enter the 6-digit code we emailed you.');
      const v = await store.getLatestVerificationCode(group.id, 'withdraw');
      if (!v || !v.payload || new Date(v.expires_at) < new Date()) return socket.emit('error-msg', 'That code has expired. Please start your withdrawal again.');
      if ((await store.bumpVerificationAttempts(v.id)) > CODE_MAX_ATTEMPTS) { await store.consumeVerificationCode(v.id); return socket.emit('error-msg', 'Too many incorrect codes. Please start your withdrawal again.'); }
      if (!codeMatches(c, v.code_hash)) return socket.emit('error-msg', 'That code is not correct. Please check it and try again.');
      if (!(await store.consumeVerificationCode(v.id))) return socket.emit('error-msg', 'That code was already used.');
      const r = await validateWithdrawal(group, v.payload); // state may have changed while the code was in the inbox
      if (r.handled) return;
      const wd = await createWithdrawalNow(group, r.value, new Date().toISOString());
      if (wd) socket.emit('withdrawal-confirmed', { ref: F.publicWithdrawal(wd).ref });
    } catch (err) { console.error('[confirm-withdrawal]', err); socket.emit('error-msg', 'We could not confirm your withdrawal. Please try again.'); }
  });

  // Live crypto-requirement preview (recalculated whenever the amount changes).
  socket.on('check-crypto-requirement', async ({ groupId, amount, amountCurrency }) => {
    const group = await sellerGroup(groupId);
    if (!group) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return socket.emit('crypto-requirement', { allowed: true, empty: true });
    const ccy = F.CURRENCIES.has(amountCurrency) ? amountCurrency : group.seller_currency;
    const ev = CD.evaluate({ group, amount: amt, amountCurrency: ccy, tiers: await CD.loadTiers(store), deposits: await store.getDepositsForGroup(group.id) });
    socket.emit('crypto-requirement', ev);
  });

  // The seller's own on-demand refresh — fired every time they open their account view.
  socket.on('get-my-seller-account', async ({ groupId }) => {
    const group = await sellerGroup(groupId, { allowDisabled: true });
    if (!group) return;
    await FH.emitSnapshotTo(socket, group.id);
  });

  socket.on('admin-get-withdrawals-queue', async () => {
    if (!adminGuard()) return;
    socket.emit('withdrawals-queue-list', (await store.getPendingWithdrawals()).map((w) => F.publicWithdrawal(w, { forAdmin: true })));
  });

  socket.on('admin-get-seller-account', async ({ groupId }) => {
    if (!adminGuard()) return;
    const group = await store.getGroup(groupId);
    if (!group) return;
    await FH.emitSnapshotTo(socket, groupId);
  });

  // ==========================================================================
  // ADMIN CONTROLS over a seller's account
  // ==========================================================================
  socket.on('admin-set-seller-disabled', async ({ groupId, disabled, reason }) => {
    try {
      if (!adminGuard()) return;
      const group = await store.getGroup(String(groupId || ''));
      if (!group || !group.seller_registered) return socket.emit('error-msg', 'This seller has not created an account yet.');
      const off = !!disabled;
      if (off === !!group.seller_disabled) return socket.emit('error-msg', off ? 'This account is already disabled.' : 'This account is already enabled.');
      const note = sanitizeText(reason, 300);
      await store.updateGroup(group.id, { seller_disabled: off, seller_disabled_reason: off ? (note || null) : null, seller_disabled_at: off ? new Date().toISOString() : null });
      const title = off ? 'Account disabled' : 'Account re-enabled';
      const body = off ? `Your Transaction Account has been disabled${note ? ` — ${note}` : ''}. To lodge a complaint or request a review, email ${COMPLAINTS_EMAIL} (general help: ${SUPPORT_EMAIL}).` : 'Your Transaction Account is active again. You can use it as normal.';
      await FH.pushSellerState(io, group.id, { kind: 'account', title, body, disabled: off });
      if (group.seller_session_token) await N.pushToToken(group.seller_session_token, { title, body });
      if (group.email_b) await E.notifyAccountAccess(group.email_b, { groupName: group.name, disabled: off, reason: note, name: group.seller_full_name, lang: group.seller_language });
      if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
    } catch (err) { console.error('[admin-set-seller-disabled]', err); socket.emit('error-msg', 'Could not update the account.'); }
  });

  socket.on('admin-set-disbursement', async ({ groupId, enabled }) => {
    try {
      if (!adminGuard()) return;
      const group = await store.getGroup(String(groupId || ''));
      if (!group) return;
      const on = !!enabled;
      await store.updateGroup(group.id, { disbursement_enabled: on });
      io.to(group.id).emit('disbursement-status', { groupId: group.id, enabled: on });
      const title = on ? 'Disbursement stage reached' : 'Disbursement stage paused';
      const body = on ? 'Both parties are confirmed. You can now withdraw your available funds.' : 'Withdrawals are paused until the transaction is confirmed by both parties and moved back into the disbursement stage.';
      await FH.pushSellerState(io, group.id, { kind: 'disbursement', title, body, enabled: on });
      if (group.seller_session_token) await N.pushToToken(group.seller_session_token, { title, body });
      if (group.email_b && group.seller_registered) E.notifyDisbursement(group.email_b, { groupName: group.name, enabled: on, name: group.seller_full_name, lang: group.seller_language }).catch(() => {});
      if (ctx.broadcastGroupsList) await ctx.broadcastGroupsList();
    } catch (err) { console.error('[admin-set-disbursement]', err); }
  });

  socket.on('admin-set-crypto-verified', async ({ groupId, verified }) => {
    if (!adminGuard()) return;
    const group = await store.getGroup(String(groupId || ''));
    if (!group) return;
    await store.updateGroup(group.id, { crypto_deposit_verified: !!verified });
    await FH.pushSellerState(io, group.id, null);
  });

  socket.on('admin-reset-seller-password', async ({ groupId, newPassword }) => {
    try {
      if (!adminGuard()) return;
      const group = await store.getGroup(String(groupId || ''));
      if (!group || !group.seller_registered) return socket.emit('error-msg', 'This seller has not created an account yet.');
      const pw = passwordProblem(newPassword);
      if (pw) return socket.emit('error-msg', pw);
      await store.updateGroup(group.id, { seller_password_hash: hashPassword(newPassword), seller_failed_logins: 0, seller_locked_until: null });
      await store.deleteSellerSessions(group.id); // every signed-in device must sign in again with the new password
      for (const [sockId, v] of (io._activeSockets || new Map()).entries()) {
        if (v.groupId === group.id && !v.isAdmin && v.role === 'PARTY B') {
          const s = io.sockets.sockets.get(sockId);
          if (s) { s.emit('seller-login-required', { groupId: group.id, groupName: group.name, emailHint: maskEmail(group.email_b) }); s.disconnect(true); }
        }
      }
      if (group.email_b) await E.notifyPasswordResetByDesk(group.email_b, { name: group.seller_full_name, lang: group.seller_language });
      socket.emit('seller-password-reset-done', { groupId: group.id });
    } catch (err) { console.error('[admin-reset-seller-password]', err); socket.emit('error-msg', 'Could not reset the password.'); }
  });

  // ---- IP detection: list, block, unblock ----
  async function sendIps(groupId) {
    socket.emit('seller-ips', { groupId, ips: await store.getIpSummary(groupId) });
  }
  socket.on('admin-get-seller-ips', async ({ groupId }) => {
    if (!adminGuard()) return;
    await sendIps(String(groupId || ''));
  });
  socket.on('admin-block-ip', async ({ groupId, ip, reason }) => {
    if (!adminGuard()) return;
    const group = await store.getGroup(String(groupId || ''));
    const clean = IP.normalize(String(ip || ''));
    if (!group || !clean) return socket.emit('error-msg', 'That IP address is not valid.');
    await store.blockIp(group.id, clean, sanitizeText(reason, 200) || null, meta().sessionToken);
    // Kick any seller session currently connected from that IP.
    for (const [sockId, v] of (io._activeSockets || new Map()).entries()) {
      if (v.groupId === group.id && !v.isAdmin && v.role === 'PARTY B' && v.ip === clean) {
        const s = io.sockets.sockets.get(sockId);
        if (s) { s.emit('seller-ip-blocked', { supportEmail: COMPLAINTS_EMAIL }); s.disconnect(true); }
      }
    }
    await sendIps(group.id);
  });
  socket.on('admin-unblock-ip', async ({ groupId, ip }) => {
    if (!adminGuard()) return;
    const clean = IP.normalize(String(ip || ''));
    if (!clean) return;
    await store.unblockIp(String(groupId || ''), clean);
    await sendIps(String(groupId || ''));
  });

  // ---- Email delivery: status, test message, SPF/DKIM/DMARC check (Admin and above) ----
  const emailLimiter = new RateLimiter({ windowMs: 60000, max: 6 });
  socket.on('admin-email-status', () => { if (!adminGuard()) return; socket.emit('email-status', E.getStatus()); });
  socket.on('admin-send-test-email', async ({ to }) => {
    if (!adminGuard()) return;
    if (!emailLimiter.allow(meta().sessionToken)) return socket.emit('error-msg', 'Please wait a minute before sending another test.');
    const addr = String(to || '').trim();
    if (!isValidEmail(addr)) return socket.emit('error-msg', 'Please enter a valid email address to send the test to.');
    const r = await E.sendTest(addr);
    socket.emit('email-test-result', { ...r, to: addr });
    socket.emit('email-status', E.getStatus());
  });
  socket.on('admin-check-deliverability', async () => {
    if (!adminGuard()) return;
    if (!emailLimiter.allow(meta().sessionToken)) return socket.emit('error-msg', 'Please wait a minute before checking again.');
    socket.emit('email-deliverability', await E.checkDeliverability());
  });

  // ---- Crypto deposit tiers (view: any admin; change: Super Admin only) ----
  socket.on('admin-get-crypto-tiers', async () => {
    if (!adminGuard()) return;
    socket.emit('crypto-tiers', { tiers: await CD.loadTiers(store), ranges: CD.RANGES, canEdit: metaHasMinRole('SUPER_ADMIN') });
  });
  socket.on('admin-set-crypto-tiers', async ({ tiers }) => {
    if (!metaHasMinRole('SUPER_ADMIN')) return socket.emit('error-msg', 'Only a Super Admin can change the crypto deposit tiers.');
    const err = CD.validateTiers(tiers);
    if (err) return socket.emit('error-msg', err);
    await store.setSetting(CD.SETTING_KEY, CD.cleanTiers(tiers));
    socket.emit('crypto-tiers', { tiers: await CD.loadTiers(store), ranges: CD.RANGES, canEdit: true, saved: true });
  });
}

module.exports = { registerAccountHandlers, maskEmail, TERMS_VERSION };
