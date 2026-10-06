/* Quantum Secure Transaction Desk v3.1 — the seller's Transaction Account (client).
   Registration (email-verified), post-registration choice, dashboard, live payment tracking,
   withdrawals (gate, limits, crypto requirement, email-code confirmation), KYC with live face
   verification, business upgrade, disabled / network-blocked screens.
   Buyers never load any of this state; the server only sends it to the seller and to finance admins. */

let sellerAccountState = null;
let sellerDeposits = [];
let sellerWithdrawals = [];
let sellerIncoming = [];
let sellerLimits = null;
const SUPPORT_EMAIL_DEFAULT = 'complaints@usvistra.com';
const isSeller = () => myRole === 'PARTY B' && !isAdminConfirmed;

// ============================================================================
// Small helpers
// ============================================================================
function setFieldError(id, msg, prefix = 'fld-') {
  const f = el(prefix + id);
  if (!f) return;
  f.classList.add('has-error');
  const e = f.querySelector('.fld-error-text');
  if (e) e.textContent = msg;
  f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
}
function clearFieldErrors(root) {
  (root || document).querySelectorAll('.fld.has-error').forEach((f) => f.classList.remove('has-error'));
}
function showCallout(id, msg, tone) {
  const c = el(id);
  if (!c) return;
  c.className = 'callout show' + (tone ? ' ' + tone : ' warn');
  c.textContent = msg;
}
function hideCallout(id) { const c = el(id); if (c) { c.classList.remove('show'); c.textContent = ''; } }
function setSelect(id, val) {
  const s = el(id);
  if (!s) return;
  s.value = val;
  const t = s.parentElement && s.parentElement.querySelector('.csel-trigger');
  if (t && typeof cselSyncTrigger === 'function') cselSyncTrigger(s, t);
}
function setBusy(btn, busy, busyHtml) {
  if (!btn) return;
  if (busy) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = busyHtml || '<i class="fa-solid fa-spinner fa-spin"></i>'; }
  else { btn.disabled = false; if (btn.dataset.html) { btn.innerHTML = btn.dataset.html; delete btn.dataset.html; } }
}
function supportEmail() { return (sellerAccountState && sellerAccountState.supportEmail) || SUPPORT_EMAIL_DEFAULT; }
function statusPillClass(status) {
  if (['verified', 'completed', 'credited'].includes(status)) return 'enabled';
  if (['rejected', 'failed', 'reversed', 'declined'].includes(status)) return 'disabled';
  return '';
}
const DEPOSIT_LABEL = { held_in_vault: 'Awaiting confirmation', verified: 'Verified', rejected: 'Rejected' };

// ============================================================================
// Socket: state
// ============================================================================
socket.on('seller-account-state', (acct) => {
  if (activeGroupId && acct.groupId !== activeGroupId) return;
  sellerAccountState = acct;
  if (isSeller()) {
    adoptServerLanguage(acct);
    setGroupDisbursement(!!acct.disbursementEnabled);
  }
  renderTxAccountUI();
  maybeShowTxRegModal();
  maybeShowOnboardingChoice();
});
socket.on('deposits-list', ({ groupId, deposits }) => { if (groupId === activeGroupId) { sellerDeposits = deposits; renderSellerLists(); } });
socket.on('withdrawals-list', ({ groupId, withdrawals }) => { if (groupId === activeGroupId) { sellerWithdrawals = withdrawals; renderSellerLists(); } });
socket.on('incoming-list', ({ groupId, incoming }) => { if (groupId === activeGroupId) { sellerIncoming = incoming; renderSellerLists(); } });
socket.on('withdrawal-limits', (l) => { if (l.groupId === activeGroupId) { sellerLimits = l; renderLimitLine(); } });
socket.on('deposit-created', (d) => { if (isSeller() && d.groupId === activeGroupId) { sellerDeposits = [d, ...sellerDeposits.filter((x) => x.id !== d.id)]; renderSellerLists(); } });
socket.on('deposit-updated', (d) => { if (isSeller() && d.groupId === activeGroupId) { sellerDeposits = sellerDeposits.map((x) => (x.id === d.id ? d : x)); renderSellerLists(); } });
socket.on('withdrawal-updated', (w) => { if (isSeller() && w.groupId === activeGroupId) { sellerWithdrawals = sellerWithdrawals.map((x) => (x.id === w.id ? w : x)); renderSellerLists(); } });
// Messages from the Desk arrive already translated into the seller's language.
socket.on('seller-notice', (n) => {
  toastRaw(`${n.title} — ${n.body}`);
  if (!isPageActive()) { Notif.chime(1); Notif.flashTitle(n.title); }
});

function adoptServerLanguage(a) {
  if (a && a.registered && a.language && a.language !== Xlate.lang && Date.now() - Xlate.lastLocalChange > 6000) Xlate.setLanguage(a.language, { persist: false });
}

// ============================================================================
// Disbursement stage (shown in the chat header, the seller dashboard, the withdraw page and the admin dashboard)
// ============================================================================
let groupDisbursement = null;
function setGroupDisbursement(on) {
  groupDisbursement = !!on;
  const pill = el('disbPill');
  if (pill) {
    pill.classList.remove('hidden');
    pill.classList.toggle('on', groupDisbursement);
    pill.classList.toggle('off', !groupDisbursement);
    pill.querySelector('i').className = 'fa-solid ' + (groupDisbursement ? 'fa-circle-check' : 'fa-hourglass-half');
    el('disbPillText').textContent = groupDisbursement ? 'In disbursement stage' : 'Awaiting disbursement';
  }
  const sp = el('txStagePill');
  if (sp) {
    sp.classList.toggle('on', groupDisbursement); sp.classList.toggle('off', !groupDisbursement);
    sp.querySelector('i').className = 'fa-solid ' + (groupDisbursement ? 'fa-circle-check' : 'fa-hourglass-half');
    sp.querySelector('span').textContent = groupDisbursement ? 'In disbursement stage' : 'Awaiting disbursement';
  }
  renderStageBanner();
}
function renderStageBanner() {
  const b = el('wdStageBanner');
  if (!b) return;
  const on = !!groupDisbursement;
  b.className = 'stage-banner ' + (on ? 'on' : 'off');
  b.querySelector('i').className = 'fa-solid ' + (on ? 'fa-circle-check' : 'fa-hourglass-half');
  el('wdStageText').innerHTML = on
    ? '<b>In disbursement stage.</b> Your transaction is confirmed — you can withdraw your available balance.'
    : '<b>Awaiting disbursement.</b> Withdrawals open once the Desk confirms your transaction and moves it to the disbursement stage. <button type="button" class="link-btn" onclick="goToTransactionGroup()">Complete the transaction</button>';
}
socket.on('init-state', (data) => {
  if (data.group && typeof data.group.disbursementEnabled === 'boolean') setGroupDisbursement(data.group.disbursementEnabled);
  else { const p = el('disbPill'); if (p) p.classList.add('hidden'); }
  // First visit: ask for a language (the globe button is always available afterwards).
  try {
    if (!isAdminConfirmed && !localStorage.getItem('q_lang_prompted')) {
      localStorage.setItem('q_lang_prompted', '1');
      setTimeout(() => { if (!sellerAccountState || sellerAccountState.registered || !sellerAccountState.registered) openLanguagePicker(); }, 400);
    }
  } catch (e) { /* storage unavailable */ }
});
socket.on('disbursement-status', ({ groupId, enabled }) => {
  if (groupId !== activeGroupId) return;
  setGroupDisbursement(enabled);
  if (sellerAccountState) sellerAccountState.disbursementEnabled = enabled;
  if (isSeller() && enabled) toastRaw(Xlate.lang === 'en' ? 'Your transaction is now in the disbursement stage — withdrawals are open.' : '✓ Disbursement');
});
function goToTransactionGroup() {
  closeTxAccountView();
  ['popupModal', 'wdCodeModal'].forEach((id) => el(id).classList.add('hidden'));
  const mc = el('messageContainer'); if (mc) mc.scrollTop = mc.scrollHeight;
  const inp = el('messageInput'); if (inp) inp.focus();
  const pill = el('disbPill'); if (pill) { pill.classList.add('pulse'); pill.style.animation = 'blink 1s 3'; setTimeout(() => { pill.style.animation = ''; }, 3200); }
}

// ============================================================================
// Registration
// ============================================================================
let rgPicker = null, rgPrepared = false, rgVerifiedEmail = null, rgResendTimer = null, rgCodeSentTo = null;
let obShown = false;

function maybeShowTxRegModal() {
  if (!isSeller() || !sellerAccountState) return;
  el('txAccountBtn').classList.remove('hidden');
  el('brandMenuTxAccount').classList.remove('hidden');
  if (sellerAccountState.registered) { closeModal('txRegModal'); return; }
  if (sellerAccountState.disabled) return;
  prepareRegForm();
  el('txRegModal').classList.remove('hidden');
}
function prepareRegForm() {
  if (rgPrepared) return;
  rgPrepared = true;
  rgPicker = mountCountryPicker(el('rgCountry'), { showDial: true, onChange: (c) => { el('rgPhonePrefix').textContent = c ? c.d : '+'; } });
  el('rgLang').innerHTML = window.LANG_DATA.list.map((l) => `<option value="${l.c}">${escapeHtml(l.n)} · ${escapeHtml(l.e)}</option>`).join('');
  el('rgLang').value = Xlate.lang;
  const d = new Date(); d.setFullYear(d.getFullYear() - 18);
  el('rgDob').max = d.toISOString().slice(0, 10); el('rgDob').min = '1900-01-01';
  const pre = sellerAccountState && sellerAccountState.email;
  if (pre) { el('rgEmail').value = pre; el('rgEmailPrefillNote').style.display = 'block'; }
  el('rgForm').addEventListener('input', (e) => { const f = e.target.closest('.fld'); if (f) f.classList.remove('has-error'); hideCallout('rgError'); });
  el('rgCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rgVerifyCode(); } });
  syncRgEmailUi();
}
function syncRgEmailUi() {
  const verified = !!rgVerifiedEmail;
  el('rgVerified').classList.toggle('hidden', !verified);
  if (verified) { el('rgCodeBox').classList.add('hidden'); el('rgVerifiedAddr').textContent = rgVerifiedEmail; }
  el('rgEmail').readOnly = verified;
  el('rgSendBtn').style.display = verified ? 'none' : '';
  el('rgEmailClear').style.display = (verified || el('rgEmail').value) ? '' : 'none';
}
function rgEmailEdited() {
  const v = el('rgEmail').value.trim().toLowerCase();
  if (rgCodeSentTo && rgCodeSentTo !== v) { el('rgCodeBox').classList.add('hidden'); rgCodeSentTo = null; }
  syncRgEmailUi();
}
function rgClearEmail() {
  rgVerifiedEmail = null; rgCodeSentTo = null;
  el('rgEmail').value = ''; el('rgEmail').readOnly = false;
  el('rgCodeBox').classList.add('hidden'); el('rgCode').value = '';
  el('rgEmailPrefillNote').style.display = 'none';
  syncRgEmailUi();
  el('rgEmail').focus();
}
function rgStartResendCountdown(sec = 30) {
  clearInterval(rgResendTimer);
  let left = sec;
  const btn = el('rgResendBtn'), send = el('rgSendBtn');
  const tick = () => {
    if (left <= 0) { clearInterval(rgResendTimer); btn.disabled = false; btn.textContent = 'Resend code'; send.disabled = false; return; }
    btn.disabled = true; send.disabled = true; btn.textContent = `Resend code in ${left}s`; left--;
  };
  tick(); rgResendTimer = setInterval(tick, 1000);
}
function rgSendCode() {
  const email = el('rgEmail').value.trim().toLowerCase();
  clearFieldErrors(el('fld-email'));
  if (!isValidEmailClient(email)) return setFieldError('email', 'Please enter a valid email address.');
  el('rgCodeErr').textContent = '';
  socket.emit('send-register-code', { groupId: activeGroupId, email });
  rgStartResendCountdown(30);
}
socket.on('register-code-sent', ({ email, masked, expiresInSec, delivered, mock }) => {
  rgCodeSentTo = email;
  el('rgCodeBox').classList.remove('hidden');
  el('rgCode').value = '';
  el('rgCodeMsg').textContent = delivered === false
    ? (mock ? `Email delivery is not set up on this server yet, so the code could not be sent. Please contact ${supportEmail()}.` : `We could not send an email to ${masked}. Please check the address and try again in a moment.`)
    : `We sent a 6-digit code to ${masked}. It expires in ${Math.round((expiresInSec || 600) / 60)} minutes — check your spam folder if you cannot see it.`;
  setTimeout(() => el('rgCode').focus(), 50);
});
socket.on('register-code-error', ({ message, verify, retryAfter }) => {
  if (verify) { el('rgCodeErr').textContent = message; el('rgCode').select(); return; }
  setFieldError('email', message);
  if (retryAfter) rgStartResendCountdown(retryAfter); else { clearInterval(rgResendTimer); el('rgSendBtn').disabled = false; el('rgResendBtn').disabled = false; el('rgResendBtn').textContent = 'Resend code'; }
});
function rgVerifyCode() {
  const email = el('rgEmail').value.trim().toLowerCase();
  const code = el('rgCode').value.trim();
  if (!/^\d{6}$/.test(code)) { el('rgCodeErr').textContent = 'Enter the 6-digit code from your email.'; return; }
  el('rgCodeErr').textContent = '';
  socket.emit('verify-register-code', { groupId: activeGroupId, email, code });
}
socket.on('register-code-verified', ({ email }) => {
  rgVerifiedEmail = email; clearInterval(rgResendTimer);
  clearFieldErrors(el('fld-email'));
  syncRgEmailUi();
});
function rgPwInput() {
  const pw = el('rgPw').value, pw2 = el('rgPw2').value;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) score++;
  if (pw.length >= 12) score++;
  if (/[^A-Za-z0-9]/.test(pw) && pw.length >= 8) score++;
  const bar = el('rgPwBar');
  bar.style.width = `${(score / 4) * 100}%`;
  bar.style.background = ['var(--accent-rose)', 'var(--accent-rose)', 'var(--accent-amber)', 'var(--accent-cyan)', 'var(--accent-emerald)'][score];
  const m = el('rgPwMatch');
  if (!pw2) { m.textContent = ''; m.className = 'pw-match'; }
  else if (pw === pw2) { m.textContent = '✓ Passwords match'; m.className = 'pw-match ok'; }
  else { m.textContent = '✗ Passwords do not match'; m.className = 'pw-match bad'; }
}
function rgComposePhone() {
  const c = rgPicker && rgPicker.getCountry();
  if (!c) return '';
  const raw = el('rgPhone').value.trim();
  if (raw.startsWith('+')) return raw.replace(/[\s().-]/g, '');
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits ? c.d.replace(/\s/g, '') + digits : '';
}
function submitTxRegistration() {
  clearFieldErrors(el('rgForm')); hideCallout('rgError');
  const name = el('rgName').value.trim().replace(/\s+/g, ' ');
  const country = rgPicker.getCountry();
  const phone = rgComposePhone();
  const email = el('rgEmail').value.trim().toLowerCase();
  const pw = el('rgPw').value, pw2 = el('rgPw2').value;
  const dob = el('rgDob').value;
  const errs = [];
  if (name.length < 3 || !/\s/.test(name)) errs.push(['fullName', 'Please enter your full legal name (first and last name).']);
  if (!country) errs.push(['country', 'Please select your country.']);
  if (!dob) errs.push(['dateOfBirth', 'Please enter your date of birth.']);
  else if ((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000) < 18) errs.push(['dateOfBirth', 'You must be at least 18 years old to create a Transaction Account.']);
  if (!/^\+\d{7,15}$/.test(phone)) errs.push(['phone', country ? 'Please enter a valid phone number.' : 'Select your country first, then enter your phone number.']);
  if (!isValidEmailClient(email)) errs.push(['email', 'Please enter a valid email address.']);
  else if (rgVerifiedEmail !== email) errs.push(['email', 'Please verify your email address with the code we send you.']);
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pw)) errs.push(['password', 'Password must be at least 8 characters and include a letter and a number.']);
  if (pw !== pw2) errs.push(['confirmPassword', 'The passwords do not match.']);
  if (!el('rgTerms').checked) errs.push(['acceptTerms', 'You must accept the Terms of Service & Escrow Policy to continue.']);
  if (errs.length) {
    errs.forEach(([f, m]) => setFieldError(f, m));
    const first = el('fld-' + errs[0][0]);
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  setBusy(el('rgSubmit'), true, '<i class="fa-solid fa-spinner fa-spin"></i> Creating…');
  setTimeout(() => setBusy(el('rgSubmit'), false), 10000);
  socket.emit('register-transaction-account', {
    groupId: activeGroupId, fullName: name, email, password: pw, confirmPassword: pw2,
    currency: el('rgCurrency').value, dateOfBirth: dob, country: country.n, phone,
    language: el('rgLang').value, acceptTerms: true, termsVersion: window.LEGAL_DATA.version
  });
}
socket.on('register-error', ({ message, field }) => {
  setBusy(el('rgSubmit'), false);
  if (field && el('fld-' + field)) { setFieldError(field, message); el('fld-' + field).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  else showCallout('rgError', message, 'warn');
  if (field === 'email' || !field) showCallout('rgError', message, 'warn');
});
socket.on('transaction-account-created', ({ accountId }) => {
  setBusy(el('rgSubmit'), false);
  closeModal('txRegModal');
  obShown = false;
  setTimeout(maybeShowOnboardingChoice, 150);
});

// ---- After registration: Start transaction / Continue KYC ----
function maybeShowOnboardingChoice() {
  const a = sellerAccountState;
  if (!isSeller() || !a || !a.registered || a.disabled || obShown) return;
  if (a.onboardingChoice) { obShown = true; return; }
  if (!el('txRegModal').classList.contains('hidden')) return;
  obShown = true;
  el('obName').textContent = a.fullName || '';
  el('obAcctId').textContent = a.accountId || '—';
  el('obChoiceModal').classList.remove('hidden');
}
function obChoose(choice) {
  closeModal('obChoiceModal');
  socket.emit('set-onboarding-choice', { groupId: activeGroupId, choice });
  if (choice === 'transaction') {
    goToTransactionGroup();
    toast('You are in your transaction group. The Desk and the buyer can see your messages here.');
  } else {
    openTxAccountView();
    openTxKycWizard();
  }
}

// ============================================================================
// Dashboard shell
// ============================================================================
function toggleBrandMenu(force) {
  const menu = el('brandMenu');
  if (typeof force === 'boolean') { menu.classList.toggle('hidden', !force); return; }
  menu.classList.toggle('hidden');
}
document.addEventListener('click', (e) => {
  const group = el('brandGroup');
  if (group && !group.contains(e.target)) toggleBrandMenu(false);
  const sidebar = document.querySelector('.tx-sidebar');
  if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !e.target.closest('.tx-mobile-nav-btn')) sidebar.classList.remove('open');
});
function openTxAccountView() {
  toggleBrandMenu(false);
  if (!sellerAccountState) return;
  if (!sellerAccountState.registered) return maybeShowTxRegModal();
  socket.emit('get-my-seller-account', { groupId: activeGroupId }); // re-sync, never trust a stale cache
  el('txAccountView').classList.remove('hidden');
  renderTxAccountUI();
  renderSellerLists();
  setTxAccountNav('dashboard');
}
function closeTxAccountView() { el('txAccountView').classList.add('hidden'); document.querySelector('.tx-sidebar').classList.remove('open'); }
function toggleTxSidebar() { document.querySelector('.tx-sidebar').classList.toggle('open'); }
const TX_NAV_TITLES = {
  dashboard: ['Dashboard', "Welcome back — here's where your account stands today."],
  tracking: ['Payment tracking', 'Follow every incoming payment through the escrow review, live.'],
  transactions: ['Transactions', 'Every deposit and withdrawal on this account.'],
  withdraw: ['Withdraw', 'Send your available balance out to crypto or a bank account.'],
  forms: ['Forms', 'Anything the Desk Officer has sent your group.'],
  profile: ['Profile', 'Your account details.']
};
function setTxAccountNav(nav) {
  document.querySelectorAll('#txAccountView [data-txnav]').forEach((b) => b.classList.toggle('active', b.dataset.txnav === nav));
  document.querySelectorAll('#txAccountView .tx-page').forEach((p) => p.classList.add('hidden'));
  el('txPage' + nav.charAt(0).toUpperCase() + nav.slice(1)).classList.remove('hidden');
  el('txPageTitle').textContent = TX_NAV_TITLES[nav][0];
  el('txPageSub').textContent = TX_NAV_TITLES[nav][1];
  document.querySelector('.tx-sidebar').classList.remove('open');
  if (nav === 'forms') renderTxForms();
  if (nav === 'profile') renderTxProfile();
  if (nav === 'tracking') renderTracking();
  if (nav === 'withdraw') { resetWithdrawForm(); renderStageBanner(); renderLimitLine(); }
}
function copyAccountId() { if (sellerAccountState && sellerAccountState.accountId) copyText(sellerAccountState.accountId, 'Account ID copied.'); }
function renderTxForms() {
  const box = el('txFormsBody');
  if (!box) return;
  if (window.currentGroupTxFormEnabled) {
    box.innerHTML = `<div class="invite-link-row"><div style="flex:1;"><div style="font-weight:800; font-size:0.82rem;">Transaction Form</div><div style="font-size:0.74rem; color:var(--text-muted);">Sent by the Desk Officer for this deal.</div></div><button class="send-btn" onclick="openTransactionForm()">Fill Form</button></div>`;
  } else {
    box.innerHTML = '<p class="tx-empty">No forms right now.</p>';
  }
}
const KYC_LABEL = { not_submitted: 'Not submitted', pending: 'Pending review', verified: 'Verified', rejected: 'Rejected' };
function renderTxProfile() {
  const a = sellerAccountState;
  if (!a) return;
  el('txProfileName').textContent = a.fullName || '—';
  el('txProfileAcctId').textContent = a.accountId || '—';
  el('txProfileType').textContent = a.accountType || 'Standard account';
  el('txProfileEmail').textContent = a.email || '—';
  el('txProfilePhone').textContent = a.phone || '—';
  el('txProfileDob').textContent = a.dateOfBirth ? fmtDate(a.dateOfBirth) : '—';
  el('txProfileCountry').innerHTML = a.country ? countryLine(a.country) : '—';
  el('txProfileCurrency').textContent = a.currency || '—';
  const L = window.LANG_DATA.find ? window.LANG_DATA.find(Xlate.lang) : null;
  el('txProfileLang').textContent = L ? `${L.n} (${L.e})` : Xlate.lang;
  el('txProfileKyc').textContent = KYC_LABEL[a.kyc.status] || a.kyc.status;
  el('txProfileRegistered').textContent = a.registeredAt ? fmtDateTime(a.registeredAt) : '—';
  el('txProfileTerms').textContent = a.termsAcceptedAt ? `${fmtDateTime(a.termsAcceptedAt)}${a.termsVersion ? ' · v' + a.termsVersion : ''}` : (a.registered ? 'Accepted at registration' : '—');
}

function renderTxAccountUI() {
  const a = sellerAccountState;
  if (!a || !a.registered) return;
  const ccy = a.currency || 'USD';
  const b = a.balances;
  el('txAvailableBalance').textContent = fmtMoney(b.available, ccy);
  el('txHeldBalance').textContent = fmtMoney(b.inVault !== undefined ? b.inVault : b.held, ccy);
  el('txPendingWd').textContent = fmtMoney(b.pendingWithdrawals || 0, ccy);
  el('txTotalDeposited').textContent = fmtMoney(b.totalDeposited, ccy);
  el('txCcyLabel').textContent = ccy;
  el('txAcctIdLabel').textContent = a.accountId || '—';

  const reviewing = sellerIncoming.filter((i) => i.status === 'in_review').length;
  const held = sellerIncoming.filter((i) => i.status === 'held_in_vault').length;
  const parts = [];
  if (reviewing) parts.push(`${reviewing} under escrow review`);
  if (held) parts.push(`${held} on hold`);
  el('txHeldNote').textContent = parts.length ? parts.join(' + ') : 'Nothing in review';
  const active = sellerWithdrawals.filter((w) => ['pending', 'processing'].includes(w.status)).length;
  el('txPendingWdNote').textContent = active ? `${active} withdrawal${active > 1 ? 's' : ''} in progress` : 'None in progress';
  const lastWd = sellerWithdrawals.find((w) => w.status === 'completed');
  el('txLastWithdrawal').textContent = lastWd ? fmtMoney(lastWd.amount, lastWd.amountCurrency) : '—';
  el('txLastWithdrawalNote').textContent = lastWd ? fmtDate(lastWd.updatedAt) : 'No withdrawals yet';

  // identity strip + sidebar
  const initials = (a.fullName || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  el('txAvatar').textContent = initials; el('txIdAvatar').textContent = initials;
  el('txIdName').textContent = a.fullName || '—'; el('txSideGroupName').textContent = a.fullName || 'Your Account';
  const isBiz = a.business && a.business.status === 'verified';
  ['txIdType', 'txSideType'].forEach((id) => { el(id).textContent = a.accountType || 'Standard account'; el(id).classList.toggle('business', isBiz); });
  const cl = a.country ? countryLine(a.country) : '';
  el('txIdCountry').innerHTML = cl; el('txSideCountry').innerHTML = cl;
  setGroupDisbursement(!!a.disbursementEnabled);

  // identity verification
  const kycLabel = KYC_LABEL[a.kyc.status] || a.kyc.status;
  const kycClass = a.kyc.status === 'verified' ? 'enabled' : a.kyc.status === 'rejected' ? 'disabled' : '';
  [el('txKycBadgeSmall'), el('txSideKycPill')].forEach((e) => { if (e) { e.textContent = kycLabel; e.className = 'tx-status-badge' + (kycClass ? ' ' + kycClass : ''); } });
  el('txVerifyIdentityNote').textContent = kycLabel + (a.kyc.status === 'rejected' && a.kyc.rejectionReason ? ` — ${a.kyc.rejectionReason}` : '');
  el('txVerifyIdentityIcon').className = 'tx-verify-icon' + (a.kyc.status === 'verified' ? ' ok' : a.kyc.status === 'rejected' ? ' bad' : '');
  el('txVerifyIdentityAction').style.display = (a.kyc.status === 'verified' || a.kyc.status === 'pending') ? 'none' : 'block';
  const banner = {
    not_submitted: { cls: '', text: 'Verify your identity to unlock withdrawals.', btn: 'Verify Now' },
    pending: { cls: 'info', text: "Your documents passed our automatic checks and are with our compliance team. We'll notify you as soon as they're approved.", btn: null },
    rejected: { cls: 'bad', text: `Your verification was not approved${a.kyc.rejectionReason ? ': ' + a.kyc.rejectionReason : '.'}`, btn: 'Resubmit' },
    verified: null
  }[a.kyc.status];
  const bannerEl = el('txKycBanner');
  bannerEl.classList.toggle('hidden', !banner);
  if (banner) {
    bannerEl.className = 'tx-kyc-banner' + (banner.cls ? ' ' + banner.cls : '');
    el('txKycBannerText').textContent = banner.text;
    el('txKycBannerBtn').style.display = banner.btn ? '' : 'none';
    if (banner.btn) el('txKycBannerBtn').innerHTML = `<i class="fa-solid fa-upload"></i> ${banner.btn}`;
  }
  const lockEl = el('txWithdrawKycLock');
  lockEl.style.display = a.kyc.status === 'verified' ? 'none' : 'flex';
  if (banner) {
    lockEl.className = 'tx-kyc-banner' + (banner.cls ? ' ' + banner.cls : '');
    el('txWithdrawKycLockText').textContent = a.kyc.status === 'not_submitted' ? 'Identity verification is required before you can withdraw.' : banner.text;
    el('txWithdrawKycLockBtn').style.display = banner.btn ? '' : 'none';
    if (banner.btn) el('txWithdrawKycLockBtn').innerHTML = `<i class="fa-solid fa-upload"></i> ${banner.btn}`;
  }
  el('txIdentityCardHint').textContent = { not_submitted: 'Tap to verify', pending: 'Under review', rejected: 'Tap to resubmit', verified: 'Verified ✓' }[a.kyc.status] || '';

  // business upgrade
  const bs = a.business ? a.business.status : 'none';
  el('txBizNote').textContent = bs === 'verified' ? 'Business account · no daily withdrawal limit'
    : bs === 'pending' ? 'Business application under review'
    : bs === 'rejected' ? `Application not approved${a.business.rejectionReason ? ': ' + a.business.rejectionReason : ''}`
    : 'Standard account · daily withdrawal limit applies';
  el('txBizIcon').className = 'tx-verify-icon' + (bs === 'verified' ? ' ok' : bs === 'rejected' ? ' bad' : '');
  el('txBizAction').style.display = (bs === 'none' || bs === 'rejected') ? 'block' : 'none';
  el('txBizAction').querySelector('button').innerHTML = `<i class="fa-solid fa-briefcase"></i> ${bs === 'rejected' ? 'Resubmit business application' : 'Upgrade to Business account'}`;

  if (!el('txPageProfile').classList.contains('hidden')) renderTxProfile();
  el('txAccountBtn').classList.toggle('hidden', myRole !== 'PARTY B');
}

function mergedActivity() {
  const ccy = sellerAccountState ? sellerAccountState.currency : '';
  const deps = sellerDeposits.map((d) => ({ date: d.notifiedAt, type: `Deposit${d.method === 'crypto' ? ` · ${d.asset}` : ''}`, amount: fmtMoney(d.amount, ccy), status: d.status, label: DEPOSIT_LABEL[d.status] || d.status, note: d.rejectionReason || '' }));
  const wds = sellerWithdrawals.map((w) => ({ date: w.createdAt, type: `Withdrawal${w.method === 'crypto' ? ` · ${w.asset}` : ' · Bank'}`, amount: `−${fmtMoney(w.amount, w.amountCurrency)}`, status: w.status, label: w.statusLabel, note: w.statusReason || '' }));
  const inc = sellerIncoming.map((i) => ({ date: i.receivedAt, type: 'Payment', who: i.payerName, amount: `+${fmtMoney(i.amount, i.amountCurrency)}`, status: i.status, label: i.statusLabel, note: i.statusReason || '' }));
  return [...deps, ...wds, ...inc].sort((a, b) => new Date(b.date) - new Date(a.date));
}
function activityRow(row, withNote) {
  return `<tr><td>${fmtDate(row.date)}</td><td>${escapeHtml(row.type)}${row.who ? ` · <span class="notranslate" translate="no">${escapeHtml(row.who)}</span>` : ''}</td><td class="notranslate" translate="no">${escapeHtml(row.amount)}</td>
    <td><span class="tx-status-badge ${statusPillClass(row.status)}">${escapeHtml(row.label)}</span></td>${withNote ? `<td>${escapeHtml(row.note)}</td>` : ''}</tr>`;
}
function renderSellerLists() {
  const all = mergedActivity();
  el('txRecentActivityBody').innerHTML = all.length ? all.slice(0, 5).map((r) => activityRow(r, false)).join('') : '<tr><td colspan="4" class="tx-empty">No activity yet.</td></tr>';
  el('txFullActivityBody').innerHTML = all.length ? all.map((r) => activityRow(r, true)).join('') : '<tr><td colspan="5" class="tx-empty">No activity yet.</td></tr>';
  el('txIncomingList').innerHTML = sellerIncoming.length ? sellerIncoming.map((i) => {
    const iconCls = i.status === 'credited' ? '' : i.status === 'reversed' ? 'reversed' : 'held';
    const icon = i.status === 'credited' ? 'fa-arrow-down' : i.status === 'reversed' ? 'fa-rotate-left' : 'fa-lock';
    return `<div class="incoming-row">
      <div class="incoming-icon ${iconCls}"><i class="fa-solid ${icon}"></i></div>
      <div class="incoming-main">
        <div class="incoming-top-line"><span class="incoming-payer notranslate" translate="no">${escapeHtml(i.payerName)}</span><span class="incoming-amount notranslate" translate="no">+${fmtMoney(i.amount, i.amountCurrency)}</span></div>
        <div class="incoming-purpose">${escapeHtml(i.purpose)}</div>
        <div class="incoming-meta">${fmtDateTime(i.receivedAt)} · <span class="tx-status-badge ${statusPillClass(i.status)}" style="padding:2px 8px; font-size:0.62rem;">${escapeHtml(i.statusLabel)}</span>${i.statusReason ? ` · ${escapeHtml(i.statusReason)}` : ''}</div>
        ${i.review && i.status === 'in_review' ? `<a class="incoming-receipt" href="#" onclick="setTxAccountNav('tracking'); return false;"><i class="fa-solid fa-satellite-dish"></i> Track this payment live</a>` : ''}
        ${i.receiptUrl ? `<a class="incoming-receipt" href="${i.receiptUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-file-invoice"></i> Download receipt</a>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="ledger-empty">No incoming payments recorded yet.</p>';
  renderTracking();
  renderWithdrawalRecords();
  renderTxAccountUI();
}

// ============================================================================
// Payment tracking — the live 5-stage escrow review (seller view: no timers unless the Desk enabled them)
// ============================================================================
function renderTracking() {
  const box = el('txTrackingList');
  if (!box) return;
  const list = sellerIncoming.filter((i) => i.review)
    .sort((a, b) => ((a.status === 'in_review' ? 0 : 1) - (b.status === 'in_review' ? 0 : 1)) || (new Date(b.receivedAt) - new Date(a.receivedAt)));
  const live = list.some((i) => i.status === 'in_review');
  el('txTrackDot').classList.toggle('hidden', !live);
  el('txBellDot').classList.toggle('hidden', !live);
  if (!list.length) {
    box.innerHTML = `<div class="trk-empty"><i class="fa-solid fa-satellite-dish"></i><div style="font-weight:800; margin-bottom:6px;">No payments under review</div><div style="font-size:0.8rem;">When the Desk records an incoming payment for you, its escrow review appears here and updates live — stage by stage — until the funds reach your account.</div></div>`;
    return;
  }
  box.innerHTML = list.map(trackCard).join('');
  tickTrackTimes();
}
function trackCard(i) {
  const r = i.review, liveNow = i.status === 'in_review', done = i.status === 'credited' || r.finished;
  const stages = r.stages.map((st) => {
    const chip = st.status === 'passed' ? 'Completed' : st.status === 'in_review' ? 'In review' : 'Queued';
    const dotInner = st.status === 'passed' ? '<i class="fa-solid fa-check"></i>' : st.index;
    let checks = '';
    if (st.checks) {
      let firstOpen = true;
      checks = `<ul class="trk-checks">${st.checks.map((c) => {
        let cls = '', icon = 'fa-regular fa-circle';
        if (c.done) { cls = 'done'; icon = 'fa-solid fa-circle-check'; }
        else if (st.status === 'in_review' && firstOpen) { cls = 'pending'; icon = 'fa-solid fa-circle-notch fa-spin'; }
        if (!c.done) firstOpen = false;
        return `<li class="${cls}"><i class="${icon}"></i><span>${escapeHtml(c.text)}</span></li>`;
      }).join('')}</ul>`;
    }
    return `<li class="trk-stage ${st.status}"><div class="trk-dot">${dotInner}</div><div>
      <div class="trk-stage-title">${escapeHtml(st.title)} <span class="trk-chip">${chip}</span>${st.team ? `<span class="trk-team">· ${escapeHtml(st.team)}</span>` : ''}</div>${checks}</div></li>`;
  }).join('');
  const left = (!done && typeof r.activeStageSecondsLeft === 'number') ? `<div class="trk-time" data-until="${Date.now() + r.activeStageSecondsLeft * 1000}"></div>` : '';
  return `<div class="trk-card ${liveNow ? 'live' : done ? 'done' : ''}">
    <div class="trk-head">
      <div><span class="live-tag ${done ? 'done' : ''}">${done ? 'COMPLETED' : 'LIVE'}</span>
        <div class="trk-payer notranslate" translate="no" style="margin-top:6px;">${escapeHtml(i.payerName)}</div>
        <div class="trk-sub">${escapeHtml(i.purpose)}</div>
        <div class="trk-sub">${fmtDateTime(i.receivedAt)}</div></div>
      <div><div class="trk-amount notranslate" translate="no">+${fmtMoney(i.amount, i.amountCurrency)}</div><div class="trk-ref notranslate" translate="no">${escapeHtml(i.ref)}</div></div>
    </div>
    <div class="trk-status-line"><span>${escapeHtml(r.statusLine)}</span><span class="trk-vault ${r.vault.tone}">Vault: ${escapeHtml(r.vault.label)}</span></div>
    <div class="trk-bar"><i style="width:${r.progress}%"></i></div>
    <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-muted); margin-top:6px;"><span>Escrow review progress</span><b class="notranslate" translate="no">${r.progress}%</b></div>
    ${left}
    <ul class="trk-stages">${stages}</ul>
    ${i.sharedNote ? `<div class="trk-note"><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(i.sharedNote)}</div>` : ''}
    ${done ? `<div class="trk-foot"><span><i class="fa-solid fa-circle-check" style="color:var(--accent-emerald)"></i> Funds credited to your available balance.</span>${i.receiptUrl ? `<a class="admin-btn" href="${i.receiptUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-file-invoice"></i> Download receipt</a>` : ''}</div>` : ''}
  </div>`;
}
function tickTrackTimes() {
  document.querySelectorAll('.trk-time[data-until]').forEach((n) => {
    const s = Math.max(0, Math.round((Number(n.dataset.until) - Date.now()) / 1000));
    n.textContent = `Estimated time left in this stage: ${fmtDuration(s)}`;
  });
}
setInterval(tickTrackTimes, 1000);

// ============================================================================
// Deposits (crypto, recorded by the seller; the Desk confirms on-chain)
// ============================================================================
function openTxDepositModal() { el('txDepositAmount').value = ''; el('txDepositModal').classList.remove('hidden'); }
function submitTxDeposit() {
  const amount = parseFloat(el('txDepositAmount').value);
  if (!amount || amount <= 0) return toast('Please enter a valid amount.', true);
  socket.emit('notify-deposit', { groupId: activeGroupId, asset: el('txDepositAsset').value, network: el('txDepositNetwork').value, amount });
  closeModal('txDepositModal');
}

// ============================================================================
// Withdrawals
// ============================================================================
let wdBankPicker = null, wdCryptoTimer = null, wdResendTimer = null, wdPendingSummary = null;
function resetWithdrawForm() {
  // The bank form must never show what was typed or chosen the last time the seller was here.
  ['txWdDestination', 'txWdBeneficiary', 'txWdBankName', 'txWdBankAccount', 'txWdSwift', 'txWdAmount'].forEach((id) => {
    const e = el(id);
    e.value = '';
    e.setAttribute('name', `${id}_${Math.random().toString(36).slice(2, 8)}`); // defeats browser autofill history
  });
  setSelect('txWithdrawMethod', 'crypto'); setSelect('txWdAsset', 'USDT'); setSelect('txWdNetwork', 'TRC20');
  if (!wdBankPicker) wdBankPicker = mountCountryPicker(el('txWdBankCountry'), { placeholder: 'Select the bank’s country' });
  wdBankPicker.clear();
  toggleTxWithdrawFields();
  hideCallout('wdCryptoCallout');
  setBusy(el('wdSubmitBtn'), false);
  renderLimitLine();
}
window.addEventListener('pageshow', (e) => { if (e.persisted && el('txPageWithdraw') && !el('txPageWithdraw').classList.contains('hidden')) resetWithdrawForm(); });
function toggleTxWithdrawFields() {
  const isCrypto = el('txWithdrawMethod').value === 'crypto';
  el('txWithdrawBankFields').style.display = isCrypto ? 'none' : 'flex';
  el('txWithdrawCryptoFields').style.display = isCrypto ? 'flex' : 'none';
  if (!isCrypto) hideCallout('wdCryptoCallout'); else wdAmountChanged();
}
function renderLimitLine() {
  const box = el('wdLimitLine');
  if (!box || !sellerLimits || !sellerAccountState) return;
  const ccy = sellerAccountState.currency;
  box.innerHTML = sellerLimits.unlimited
    ? '<span><i class="fa-solid fa-infinity"></i> Business account — no daily withdrawal limit.</span>'
    : `<span>Daily limit: <b class="notranslate" translate="no">${fmtMoney(sellerLimits.daily, ccy)}</b></span><span>· Available today: <b class="notranslate" translate="no">${fmtMoney(sellerLimits.remaining, ccy)}</b></span>
       ${sellerAccountState.business.status === 'none' || sellerAccountState.business.status === 'rejected' ? '<button type="button" class="link-btn" onclick="openBusinessModal()">Need more? Upgrade to Business</button>' : ''}`;
}
function wdAmountChanged() {
  clearTimeout(wdCryptoTimer);
  if (el('txWithdrawMethod').value !== 'crypto') return;
  const amount = parseFloat(el('txWdAmount').value);
  if (!amount || amount <= 0) { hideCallout('wdCryptoCallout'); return; }
  wdCryptoTimer = setTimeout(() => {
    socket.emit('check-crypto-requirement', { groupId: activeGroupId, amount, amountCurrency: sellerAccountState ? sellerAccountState.currency : 'USD' });
  }, 350);
}
function cryptoGateFacts(g) {
  const ccy = g.currency;
  const rule = g.pct != null ? `${(g.pct * 100).toFixed(g.pct * 1000 % 10 ? 1 : 0)}% of this withdrawal` : `a flat ${fmtMoney(g.flat, 'USD')}`;
  return { rule, required: fmtMoney(g.requiredLedger, ccy), have: fmtMoney(g.haveUsd, 'USD'), remaining: fmtMoney(g.remainingLedger, ccy), usd: fmtMoney(g.requiredUsd, 'USD') };
}
socket.on('crypto-requirement', (g) => {
  if (g.groupId !== activeGroupId || el('txWithdrawMethod').value !== 'crypto') return;
  if (g.unlocked || g.allowed) { showCallout('wdCryptoCallout', 'Crypto withdrawals are unlocked on your account — no further deposit is needed.', 'ok'); return; }
  const f = cryptoGateFacts(g);
  showCallout('wdCryptoCallout', `A one-time verified crypto deposit of ${f.required} (${f.rule}, ≈ ${f.usd}) is required before your first crypto withdrawal. Verified so far: ${f.have}. Still needed: ${f.remaining}. Bank withdrawals are not affected.`, 'warn');
});
function wdBusy(on) { setBusy(el('wdSubmitBtn'), on, '<i class="fa-solid fa-spinner fa-spin"></i> Sending code…'); if (on) setTimeout(() => wdBusy(false), 12000); }
socket.on('error-msg', () => wdBusy(false));

function submitTxWithdrawal() {
  const a = sellerAccountState;
  if (!a) return;
  const method = el('txWithdrawMethod').value;
  const amount = parseFloat(el('txWdAmount').value);
  if (!amount || amount <= 0) return toast('Please enter a valid amount.', true);
  const payload = { groupId: activeGroupId, method, amount, amountCurrency: a.currency || 'USD' };
  if (method === 'bank') {
    const bc = wdBankPicker.getValue();
    if (!bc) return toast('Please select the bank’s country.', true);
    Object.assign(payload, {
      beneficiaryName: el('txWdBeneficiary').value.trim(), bankName: el('txWdBankName').value.trim(),
      bankAccount: el('txWdBankAccount').value.trim(), bankSwift: el('txWdSwift').value.trim(), bankCountry: bc
    });
    if (!payload.beneficiaryName || !payload.bankName || !payload.bankAccount) return toast('Please complete the beneficiary, bank and account details.', true);
  } else {
    Object.assign(payload, { asset: el('txWdAsset').value, network: el('txWdNetwork').value, destination: el('txWdDestination').value.trim() });
    if (!payload.destination) return toast('Please enter the destination wallet address.', true);
  }
  // Fast local gate (the server enforces it again): not in the disbursement stage -> popup, nothing is sent.
  if (a.kyc.status === 'verified' && !a.disbursementEnabled) return showDisbursementPopup();
  wdBusy(true);
  socket.emit('request-withdrawal', payload);
}

function showDisbursementPopup(message) {
  showPopup({
    icon: 'fa-hourglass-half', tone: 'warn', title: 'Transaction not yet in the disbursement stage',
    body: message || 'This transaction has not reached the disbursement stage yet, so withdrawals are not open. Please complete the transaction in your transaction group — once the Desk confirms it and moves it to disbursement, you will be able to withdraw.',
    actions: [{ label: 'Complete the transaction', primary: true, icon: 'fa-comments', onClick: goToTransactionGroup }, { label: 'Close' }]
  });
}
socket.on('withdrawal-blocked', (b) => {
  wdBusy(false);
  if (b.groupId && b.groupId !== activeGroupId) return;
  closeModal('wdCodeModal');
  const ccy = (sellerAccountState && sellerAccountState.currency) || 'USD';
  if (b.code === 'not_in_disbursement') return showDisbursementPopup(b.message);
  if (b.code === 'kyc_required') {
    return showPopup({ icon: 'fa-id-card', tone: 'info', title: 'Verify your identity first', body: b.message || 'Your identity must be verified before you can withdraw.',
      actions: [{ label: 'Continue KYC verification', primary: true, icon: 'fa-id-card', onClick: openTxKycWizard }, { label: 'Close' }] });
  }
  if (b.code === 'daily_limit') {
    const acts = [];
    if (b.canUpgrade) acts.push({ label: 'Request unlimited withdrawals', primary: true, icon: 'fa-briefcase', onClick: openBusinessModal });
    acts.push({ label: 'Close' });
    return showPopup({ icon: 'fa-gauge-high', tone: 'warn', title: 'Daily withdrawal limit reached',
      body: `Standard accounts can withdraw up to ${fmtMoney(b.limit, ccy)} in any 24-hour period.${b.canUpgrade ? ' Need to move more? Upgrade to a Business account for unlimited withdrawals — it only takes your company details.' : ' Your Business application is being reviewed.'}`,
      facts: [['Daily limit', fmtMoney(b.limit, ccy)], ['Withdrawn in the last 24 hours', fmtMoney(b.used, ccy)], ['Available now', fmtMoney(b.remaining, ccy)]], actions: acts });
  }
  if (b.code === 'crypto_deposit_required') {
    const f = cryptoGateFacts(b);
    return showPopup({ icon: 'fa-shield-halved', tone: 'warn', title: 'A security deposit is required for crypto withdrawals',
      body: `Before your first crypto withdrawal we need a one-time verified crypto deposit from you. For this amount it is ${f.rule}. Fiat (bank) withdrawals are not affected, and this is a one-time step.`,
      facts: [['Deposit required', f.required], ['≈ in USD', f.usd], ['Verified so far', f.have], ['Still needed', f.remaining]],
      actions: [{ label: 'Record a deposit', primary: true, icon: 'fa-arrow-down', onClick: openTxDepositModal }, { label: 'Close' }] });
  }
  toast(b.message || 'This withdrawal cannot be processed right now.', true);
});

// ---- Email code confirmation ----
function wdStartResendCountdown(sec = 30) {
  clearInterval(wdResendTimer);
  let left = sec;
  const btn = el('wdResendBtn');
  const tick = () => {
    if (left <= 0) { clearInterval(wdResendTimer); btn.disabled = false; btn.textContent = 'Resend code'; return; }
    btn.disabled = true; btn.textContent = `Resend code in ${left}s`; left--;
  };
  tick(); wdResendTimer = setInterval(tick, 1000);
}
socket.on('withdrawal-code-sent', ({ masked, expiresInSec, delivered, mock, summary }) => {
  wdBusy(false);
  wdPendingSummary = summary;
  el('wdCodeMsg').textContent = delivered === false
    ? (mock ? `Email delivery is not set up on this server yet, so the code could not be sent. Please contact ${supportEmail()}.` : `We could not email ${masked} just now. Tap “Resend code” in a moment.`)
    : `We emailed a 6-digit confirmation code to ${masked}. It expires in ${Math.round((expiresInSec || 600) / 60)} minutes. Enter it to authorise this withdrawal.`;
  el('wdCodeFacts').innerHTML = summary ? `<div><span>Amount</span><b>${escapeHtml(summary.amountText)}</b></div><div><span>To</span><b class="notranslate" translate="no">${escapeHtml(summary.destination)}</b></div>` : '';
  el('wdCodeErr').textContent = '';
  if (el('wdCodeModal').classList.contains('hidden')) el('wdCodeInput').value = '';
  el('wdCodeModal').classList.remove('hidden');
  setBusy(el('wdConfirmBtn'), false);
  wdStartResendCountdown(30);
  setTimeout(() => el('wdCodeInput').focus(), 80);
});
function wdResendCode() { socket.emit('resend-withdrawal-code', { groupId: activeGroupId }); el('wdResendBtn').disabled = true; }
function wdConfirmCode() {
  const code = el('wdCodeInput').value.trim();
  if (!/^\d{6}$/.test(code)) { el('wdCodeErr').textContent = 'Enter the 6-digit code from your email.'; return; }
  el('wdCodeErr').textContent = '';
  setBusy(el('wdConfirmBtn'), true, '<i class="fa-solid fa-spinner fa-spin"></i>');
  setTimeout(() => setBusy(el('wdConfirmBtn'), false), 10000);
  socket.emit('confirm-withdrawal', { groupId: activeGroupId, code });
}
socket.on('withdrawal-code-error', ({ message }) => {
  setBusy(el('wdConfirmBtn'), false);
  el('wdCodeErr').textContent = message;
  el('wdCodeInput').select();
});
socket.on('withdrawal-created', (w) => {
  if (!isSeller() || w.groupId !== activeGroupId) return;
  sellerWithdrawals = [w, ...sellerWithdrawals.filter((x) => x.id !== w.id)];
  closeModal('wdCodeModal'); clearInterval(wdResendTimer);
  setBusy(el('wdConfirmBtn'), false);
  resetWithdrawForm();
  renderSellerLists();
  toast('Withdrawal confirmed and submitted. You can follow it below.');
  const list = el('txWithdrawalsList'); if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---- Withdrawal records ----
function renderWithdrawalRecords() {
  const box = el('txWithdrawalsList');
  if (!box) return;
  box.innerHTML = sellerWithdrawals.length
    ? [...sellerWithdrawals].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((w) => (w.method === 'crypto' ? cryptoRecord(w) : bankRecord(w))).join('')
    : '<p class="ledger-empty">No withdrawals yet.</p>';
}
function bankRecord(w) {
  const hist = (w.statusHistory || []).map((h) => h.status);
  const reachedProcessing = hist.includes('processing') || w.status === 'processing' || w.status === 'completed';
  const nodes = [{ label: 'Pending', icon: 'fa-inbox' }, { label: 'Processing', icon: 'fa-gears' }, { label: w.status === 'declined' ? 'Declined' : 'Completed', icon: w.status === 'declined' ? 'fa-xmark' : 'fa-flag-checkered' }];
  const reachedIdx = w.status === 'pending' ? 0 : w.status === 'processing' ? 1 : w.status === 'completed' ? 2 : (reachedProcessing ? 1 : 0);
  const nodeHtml = nodes.map((n, i) => {
    let cls = '';
    if (w.status === 'completed') cls = 'reached done';
    else if (w.status === 'declined') cls = i === 2 ? 'declined reached' : (i <= reachedIdx ? 'reached' : '');
    else cls = i < reachedIdx ? 'reached' : i === reachedIdx ? 'reached current' : '';
    return `<div class="wd-node ${cls}"><div class="wd-node-dot"><i class="fa-solid ${w.status === 'completed' || (i < reachedIdx) ? 'fa-check' : n.icon}"></i></div>${n.label}</div>`;
  }).join('');
  return `<div class="wd-bank">
    <div class="wd-bank-head">
      <div><div class="wd-bank-title"><i class="fa-solid fa-building-columns" style="color:var(--accent-cyan)"></i> Bank transfer</div>
        <div class="wd-bank-sub notranslate" translate="no">${escapeHtml(w.bankName || '')} ••••${escapeHtml(String(w.bankAccount || '').replace(/\W/g, '').slice(-4))} · ${escapeHtml(w.beneficiaryName || '')}</div></div>
      <div style="text-align:end;"><div class="wd-amt notranslate" translate="no">−${fmtMoney(w.amount, w.amountCurrency)}</div><span class="wd-status ${w.status}">${escapeHtml(w.statusLabel)}</span></div>
    </div>
    <div class="wd-track">${nodeHtml}</div>
    <div class="wd-meta">
      <div><span>Requested</span><b>${fmtDateTime(w.createdAt)}</b></div>
      <div><span>Last update</span><b>${fmtDateTime(w.updatedAt)}</b></div>
      <div><span>Reference</span><b class="notranslate" translate="no">${escapeHtml(w.ref)}</b></div>
      ${w.payoutReference ? `<div><span>Payout reference</span><b class="notranslate" translate="no">${escapeHtml(w.payoutReference)}</b></div>` : ''}
      ${w.bankCountry ? `<div><span>Bank country</span><b>${countryLine(w.bankCountry)}</b></div>` : ''}
    </div>
    ${w.status === 'declined' && w.statusReason ? `<div class="wd-reason"><b>Declined:</b> ${escapeHtml(w.statusReason)} — the amount has been returned to your available balance.</div>` : ''}
    ${w.receiptUrl ? `<div style="margin-top:12px;"><a class="admin-btn" href="${w.receiptUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-file-invoice"></i> Download receipt</a></div>` : ''}
  </div>`;
}
function cryptoRecord(w) {
  const tl = (w.statusHistory || []).map((h) => `<li><span>${escapeHtml(h.statusLabel || h.status)}${h.note ? ` — ${escapeHtml(h.note)}` : ''}</span><b>${fmtDateTime(h.at)}</b></li>`).join('');
  return `<div class="wd-crypto"><div class="wd-crypto-in">
    <div class="wd-crypto-top">
      <div class="coin ${escapeHtml(w.asset || '')} notranslate" translate="no">${escapeHtml(w.asset || '?')}</div>
      <div class="wd-crypto-main"><div class="wd-crypto-title">${escapeHtml(w.asset || '')} withdrawal</div>
        <div class="wd-crypto-net notranslate" translate="no">${escapeHtml(w.network || '')} · ${escapeHtml(maskMiddle(w.destination || '', 8, 6))}</div>
        <span class="wd-status ${w.status}">${escapeHtml(w.statusLabel)}</span></div>
      <div class="wd-crypto-amt notranslate" translate="no">−${fmtMoney(w.amount, w.amountCurrency)}</div>
    </div>
    <div class="wd-meta" style="margin-top:14px;">
      <div><span>Date created</span><b>${fmtDateTime(w.createdAt)}</b></div>
      <div><span>Last update</span><b>${fmtDateTime(w.updatedAt)}</b></div>
      <div><span>Reference</span><b class="notranslate" translate="no">${escapeHtml(w.ref)}</b></div>
      ${w.payoutReference ? `<div><span>Transaction hash / payout ref</span><b class="notranslate" translate="no">${escapeHtml(w.payoutReference)}</b></div>` : ''}
    </div>
    ${w.status === 'declined' && w.statusReason ? `<div class="wd-reason"><b>Declined:</b> ${escapeHtml(w.statusReason)} — the amount has been returned to your available balance.</div>` : ''}
    ${tl ? `<ul class="wd-timeline">${tl}</ul>` : ''}
    ${w.receiptUrl ? `<div style="margin-top:12px;"><a class="admin-btn" href="${w.receiptUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-file-invoice"></i> Download receipt</a></div>` : ''}
  </div></div>`;
}

// ============================================================================
// KYC wizard — details, documents, live face verification
// ============================================================================
const kyc = { doc: 'passport', proof: 'bank_statement', uploads: {}, quality: {}, face: { live: false, detected: null }, step: 0, resultShown: false, countryPicker: null, stream: null, detectTimer: null, detector: null };
const KYC_ID_RULES = {
  passport: { label: 'Passport number', re: /^[A-Z0-9]{6,9}$/ },
  national_id: { label: 'National ID number', re: /^[A-Z0-9][A-Z0-9\-\/]{4,19}$/ },
  drivers_license: { label: 'Driver’s licence number', re: /^[A-Z0-9][A-Z0-9\-\/ ]{4,23}$/ }
};
function kycSteps() { return ['type', 'details', 'idFront'].concat(kyc.doc !== 'passport' ? ['idBack'] : [], ['proof', 'selfie', 'review']); }
function handleTxIdentityCardClick() {
  const status = sellerAccountState ? sellerAccountState.kyc.status : 'not_submitted';
  if (status === 'pending') return toast("Your documents are under review — we'll notify you once they're approved.");
  if (status === 'verified') return toast('Your identity is verified.');
  openTxKycWizard();
}
function openTxKycWizard() {
  const a = sellerAccountState;
  const status = a ? a.kyc.status : 'not_submitted';
  if (status === 'pending') return toast('Your documents are already under review.');
  if (status === 'verified') return toast('Your identity is already verified.');
  closeModal('popupModal');
  Object.assign(kyc, { doc: 'passport', proof: 'bank_statement', uploads: {}, quality: {}, face: { live: false, detected: null }, step: 0, resultShown: false });
  ['idFront', 'idBack', 'proof'].forEach((k) => {
    el('kycZone_' + k).classList.remove('done', 'failed');
    el('kycPrev_' + k).classList.add('hidden'); el('kycPrev_' + k).removeAttribute('src');
    el('kycName_' + k).textContent = 'JPG, PNG or PDF · up to 15MB';
    el('kycZone_' + k).querySelector('.tx-upload-title').textContent = 'Tap to upload';
    el('kycStatus_' + k).textContent = ''; el('kycStatus_' + k).className = 'tx-wizard-status';
  });
  el('kycIdName').value = a ? (a.fullName || '') : '';
  el('kycIdDob').value = a && a.dateOfBirth ? a.dateOfBirth : '';
  el('kycIdNumber').value = ''; el('kycIdExpiry').value = '';
  el('kycIdExpiry').min = new Date().toISOString().slice(0, 10);
  if (!kyc.countryPicker) kyc.countryPicker = mountCountryPicker(el('kycCountry'), { placeholder: 'Select issuing country' });
  kyc.countryPicker.setValue(a && a.country ? a.country : '');
  el('kycResult').innerHTML = '';
  clearFieldErrors(el('txKycWizardModal'));
  el('txKycWizardModal').classList.remove('hidden');
  kycRender();
}
function closeKycWizard() { kycStopCamera(); closeModal('txKycWizardModal'); }
function kycPickDoc(v) { kyc.doc = v; kycRender(); }
function kycPickProof(v) { kyc.proof = v; kycRender(); }
function kycRender() {
  const steps = kycSteps();
  const key = steps[kyc.step];
  document.querySelectorAll('#txKycWizardModal .kyc-step').forEach((s) => s.classList.toggle('show', s.dataset.kstep === key));
  el('kycDots').innerHTML = steps.map((_, i) => `<div class="dot ${i < kyc.step ? 'done' : i === kyc.step ? 'active' : ''}"></div>`).join('');
  el('kycCount').textContent = `Step ${kyc.step + 1} of ${steps.length}`;
  el('kycDocGrid').querySelectorAll('.tx-doc-card').forEach((c) => c.classList.toggle('selected', c.dataset.value === kyc.doc));
  el('kycProofGrid').querySelectorAll('.tx-doc-card').forEach((c) => c.classList.toggle('selected', c.dataset.value === kyc.proof));
  el('kycIdNumberLabel').textContent = KYC_ID_RULES[kyc.doc].label;
  el('kycFrontTitle').textContent = kyc.doc === 'passport' ? 'Passport — photo page' : 'ID — Front';
  el('kycBackBtn').style.visibility = kyc.step === 0 || kyc.resultShown && kyc.resultOk ? 'hidden' : 'visible';
  const last = key === 'review';
  el('kycNextBtn').innerHTML = last ? (kyc.resultShown ? (kyc.resultOk ? 'Done' : '<i class="fa-solid fa-pen"></i> Review my details') : '<i class="fa-solid fa-upload"></i> Submit for Review') : 'Continue';
  if (last) kycRenderSummary();
  if (key === 'selfie') { if (!kyc.uploads.selfie) kycStartCamera(); } else kycStopCamera();
}
function kycRenderSummary() {
  const rows = [['Document', ({ passport: 'Passport', national_id: 'National ID Card', drivers_license: 'Driver’s License' })[kyc.doc]], ['Name on document', el('kycIdName').value.trim()], ['Document number', el('kycIdNumber').value.trim().toUpperCase()], ['Expires', el('kycIdExpiry').value]];
  const files = kycSteps().filter((k) => ['idFront', 'idBack', 'proof', 'selfie'].includes(k)).map((k) => `<div>✓ ${({ idFront: kyc.doc === 'passport' ? 'Passport photo page' : 'ID — Front', idBack: 'ID — Back', proof: 'Proof of address', selfie: 'Live selfie' })[k]} uploaded</div>`).join('');
  el('kycSummary').innerHTML = rows.map(([k, v]) => `<div><span style="color:var(--text-faint)">${k}:</span> <b class="notranslate" translate="no" style="color:var(--text-main)">${escapeHtml(v || '—')}</b></div>`).join('')
    + `<div style="margin-top:8px;">${files}</div>`
    + `<div style="margin-top:10px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">${kyc.shotUrl ? `<img class="shot-thumb" src="${kyc.shotUrl}" alt="">` : ''}<span class="face-badge ${kyc.face.detected === true ? 'ok' : 'na'}"><i class="fa-solid fa-face-smile"></i> ${kyc.face.detected === true ? 'Face verified — live capture' : kyc.face.live ? 'Live capture complete — face check will be confirmed on review' : 'Face verification pending'}</span></div>`;
}
function kycValidateDetails() {
  clearFieldErrors(el('txKycWizardModal'));
  const errs = [];
  const name = el('kycIdName').value.trim();
  const num = el('kycIdNumber').value.trim().toUpperCase();
  const rule = KYC_ID_RULES[kyc.doc];
  if (name.length < 3) errs.push(['idName', 'Enter your full name exactly as it appears on the document.']);
  if (!rule.re.test(num)) errs.push(['idNumber', `Enter a valid ${rule.label.toLowerCase()}.`]);
  if (!kyc.countryPicker.getValue()) errs.push(['idCountry', 'Select the country that issued the document.']);
  const dob = el('kycIdDob').value, exp = el('kycIdExpiry').value;
  if (!dob) errs.push(['idDob', 'Enter your date of birth as shown on the document.']);
  if (!exp) errs.push(['idExpiry', 'Enter the expiry date.']);
  else if (new Date(exp + 'T23:59:59') < new Date()) errs.push(['idExpiry', 'This document has expired. Please use a valid, unexpired document.']);
  errs.forEach(([f, m]) => setFieldError(f, m, 'kfld-'));
  return errs.length === 0;
}
function kycNext() {
  const steps = kycSteps();
  const key = steps[kyc.step];
  if (key === 'review') {
    if (kyc.resultShown) {
      if (kyc.resultOk) return closeKycWizard();
      kyc.resultShown = false; kyc.step = 1; el('kycResult').innerHTML = ''; return kycRender(); // fix details
    }
    return kycSubmit();
  }
  if (key === 'details' && !kycValidateDetails()) return;
  if (['idFront', 'idBack', 'proof', 'selfie'].includes(key) && !kyc.uploads[key]) return toast(key === 'selfie' ? 'Please take your live photo before continuing.' : 'Please upload this document before continuing.', true);
  kyc.step++; kycRender();
}
function kycBack() { if (kyc.step === 0) return; kyc.step--; kyc.resultShown = false; kycRender(); }

// Clarity measurement on the original photo (the server re-checks size, type, dimensions and duplicates).
function measureImage(file) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const sc = Math.min(1, 640 / Math.max(img.width, img.height));
        const w = Math.max(8, Math.round(img.width * sc)), h = Math.max(8, Math.round(img.height * sc));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const g = new Float32Array(w * h); let sum = 0;
        for (let i = 0, p = 0; i < g.length; i++, p += 4) { g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; sum += g[i]; }
        let s = 0, s2 = 0, n = 0;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x, l = -4 * g[i] + g[i - 1] + g[i + 1] + g[i - w] + g[i + w];
          s += l; s2 += l * l; n++;
        }
        const variance = n ? s2 / n - (s / n) * (s / n) : 0;
        resolve({ sharp: Math.sqrt(Math.max(variance, 0)), bright: sum / g.length });
      } catch (e) { resolve(null); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
async function kycFileChosen(input, key) {
  const file = input.files[0];
  if (!file) return;
  const zone = el('kycZone_' + key), prev = el('kycPrev_' + key), nameEl = el('kycName_' + key), st = el('kycStatus_' + key);
  zone.classList.remove('done', 'failed');
  nameEl.textContent = file.name;
  if (file.type.startsWith('image/')) { prev.src = URL.createObjectURL(file); prev.classList.remove('hidden'); } else prev.classList.add('hidden');
  st.textContent = 'Checking & uploading…'; st.className = 'tx-wizard-status busy';
  const q = await measureImage(file);
  const result = await uploadRawFile(file);
  if (result.ok) {
    kyc.uploads[key] = result.url;
    if (q && key !== 'proof') kyc.quality[key] = q;
    zone.classList.add('done'); zone.querySelector('.tx-upload-title').textContent = 'Uploaded — tap to replace';
    st.textContent = '✓ Uploaded'; st.className = 'tx-wizard-status ok';
    if (q && key !== 'proof' && q.sharp < 12) { st.textContent = '✓ Uploaded — this photo looks a little blurry; a sharper one is more likely to pass.'; }
  } else {
    kyc.uploads[key] = null;
    zone.classList.add('failed'); zone.querySelector('.tx-upload-title').textContent = 'Failed — tap to try again';
    st.textContent = '✗ ' + result.error; st.className = 'tx-wizard-status bad';
    toast(result.error, true);
  }
  input.value = '';
}

// ---- Live face verification ----
function kycStopCamera() {
  clearInterval(kyc.detectTimer); kyc.detectTimer = null;
  if (kyc.stream) { kyc.stream.getTracks().forEach((t) => t.stop()); kyc.stream = null; }
  const v = el('kycVideo'); if (v) v.srcObject = null;
}
function setFaceBadge(state, text) {
  const b = el('kycFaceBadge');
  b.className = 'face-badge ' + state;
  b.querySelector('span').textContent = text;
}
async function kycStartCamera() {
  hideCallout('kycCamError');
  el('kycShot').classList.add('hidden'); el('kycVideo').classList.remove('hidden'); el('kycOval').classList.remove('ok');
  el('kycRetakeBtn').style.display = 'none'; el('kycCaptureBtn').style.display = ''; el('kycCaptureBtn').disabled = true;
  el('kycCamStatus').textContent = 'Starting camera…';
  setFaceBadge('wait', 'Waiting for your face');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCallout('kycCamError', 'This browser cannot open the camera. Please use a current version of Chrome, Safari or Firefox over a secure (https) connection.', 'warn');
    el('kycCamStatus').textContent = 'Camera unavailable'; return;
  }
  try {
    kyc.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false });
    const v = el('kycVideo'); v.srcObject = kyc.stream; await v.play();
  } catch (err) {
    showCallout('kycCamError', 'We could not access your camera. Allow camera access for this site in your browser settings, then tap Retake to try again. A live photo is required for face verification.', 'warn');
    el('kycCamStatus').textContent = 'Camera blocked'; el('kycRetakeBtn').style.display = ''; return;
  }
  kyc.detector = ('FaceDetector' in window) ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 }) : null;
  el('kycCamStatus').textContent = kyc.detector ? 'Position your face inside the oval' : 'Camera ready — centre your face in the oval';
  if (!kyc.detector) { setFaceBadge('na', 'Live camera ready'); setTimeout(() => { el('kycCaptureBtn').disabled = false; }, 1200); return; }
  kyc.detectTimer = setInterval(async () => {
    const v = el('kycVideo');
    if (!v.videoWidth) return;
    try {
      const faces = await kyc.detector.detect(v);
      let ok = false, msg = 'No face detected';
      if (faces.length > 1) msg = 'Only one person in the frame, please';
      else if (faces.length === 1) {
        const b = faces[0].boundingBox, cx = (b.x + b.width / 2) / v.videoWidth, cy = (b.y + b.height / 2) / v.videoHeight, wr = b.width / v.videoWidth;
        if (wr < 0.22) msg = 'Move closer to the camera';
        else if (wr > 0.85) msg = 'Move a little further back';
        else if (cx < 0.3 || cx > 0.7 || cy < 0.2 || cy > 0.72) msg = 'Centre your face in the oval';
        else { ok = true; msg = 'Face detected — hold still'; }
      }
      el('kycOval').classList.toggle('ok', ok);
      el('kycCamStatus').textContent = msg;
      setFaceBadge(ok ? 'ok' : 'wait', ok ? 'Face detected' : 'Waiting for your face');
      el('kycCaptureBtn').disabled = !ok;
    } catch (e) { /* detection hiccup — keep trying */ }
  }, 350);
}
async function kycCapture() {
  const v = el('kycVideo');
  if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  let detected = null;
  if (kyc.detector) { try { detected = (await kyc.detector.detect(c)).length === 1; } catch (e) { detected = null; } }
  if (detected === false) { toast('We could not clearly detect your face in that photo. Please retake it.', true); return; }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) return toast('Could not capture the photo. Please try again.', true);
  const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
  el('kycStatus_selfie').textContent = 'Uploading…'; el('kycStatus_selfie').className = 'tx-wizard-status busy';
  el('kycCaptureBtn').disabled = true;
  const q = await measureImage(file);
  const up = await uploadRawFile(file);
  if (!up.ok) { el('kycStatus_selfie').textContent = '✗ ' + up.error; el('kycStatus_selfie').className = 'tx-wizard-status bad'; el('kycCaptureBtn').disabled = false; return; }
  kyc.uploads.selfie = up.url; if (q) kyc.quality.selfie = q;
  kyc.face = { live: true, detected };
  kyc.shotUrl = URL.createObjectURL(file);
  el('kycShot').src = kyc.shotUrl; el('kycShot').classList.remove('hidden'); el('kycVideo').classList.add('hidden');
  el('kycCaptureBtn').style.display = 'none'; el('kycRetakeBtn').style.display = '';
  el('kycOval').classList.add('ok');
  el('kycCamStatus').textContent = 'Photo captured';
  setFaceBadge(detected === true ? 'ok' : 'na', detected === true ? 'Face verified — live capture' : 'Live capture complete');
  el('kycStatus_selfie').textContent = '✓ Uploaded'; el('kycStatus_selfie').className = 'tx-wizard-status ok';
  kycStopCamera();
}
function kycRetake() { kyc.uploads.selfie = null; kyc.face = { live: false, detected: null }; delete kyc.quality.selfie; el('kycStatus_selfie').textContent = ''; kycStartCamera(); }

function kycSubmit() {
  const btn = el('kycNextBtn');
  setBusy(btn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Checking…');
  setTimeout(() => setBusy(btn, false), 15000);
  const doc = kyc.doc;
  socket.emit('submit-kyc', {
    groupId: activeGroupId, docType: doc,
    idNumber: el('kycIdNumber').value.trim().toUpperCase(), idName: el('kycIdName').value.trim(), idDob: el('kycIdDob').value,
    idExpiry: el('kycIdExpiry').value, idCountry: kyc.countryPicker.getValue(),
    idFrontUrl: kyc.uploads.idFront, idBackUrl: doc === 'passport' ? null : kyc.uploads.idBack,
    proofAddressType: kyc.proof, proofAddressUrl: kyc.uploads.proof, selfieUrl: kyc.uploads.selfie,
    quality: kyc.quality, face: kyc.face
  });
}
socket.on('kyc-auto-result', (r) => {
  setBusy(el('kycNextBtn'), false);
  kyc.resultShown = true; kyc.resultOk = !!r.ok;
  if (r.ok) {
    el('kycResult').innerHTML = `<div class="kyc-result ok"><b><i class="fa-solid fa-circle-check"></i> ${r.status === 'verified' ? 'Identity verified' : 'Documents received'}</b><div style="margin-top:6px;">${r.status === 'verified' ? 'Your identity has been verified. You can withdraw as soon as your transaction reaches the disbursement stage.' : 'Your documents passed our automatic checks (document details, expiry, name match, photo clarity and live face verification) and are now with our compliance team for final approval. We will notify you.'}</div></div>`;
  } else {
    el('kycResult').innerHTML = `<div class="kyc-result bad"><b><i class="fa-solid fa-circle-xmark"></i> We could not approve this submission yet</b><ul>${(r.reasons || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul><div style="margin-top:8px; color:var(--text-muted);">Please correct the points above and submit again — your uploaded photos are kept, so you only need to replace the ones that were rejected.</div></div>`;
  }
  kycRender();
});

// ============================================================================
// Business account (unlimited withdrawals)
// ============================================================================
let bizPicker = null; const bizDocs = {};
function openBusinessModal() {
  const a = sellerAccountState;
  if (!a) return;
  closeModal('popupModal');
  if (a.kyc.status !== 'verified') {
    return showPopup({ icon: 'fa-id-card', tone: 'info', title: 'Verify your identity first', body: 'A Business account is linked to a verified owner. Please complete your personal identity verification, then apply for the upgrade.',
      actions: [{ label: 'Continue KYC verification', primary: true, icon: 'fa-id-card', onClick: openTxKycWizard }, { label: 'Close' }] });
  }
  if (a.business.status === 'pending') return toast('Your business application is already under review.');
  if (a.business.status === 'verified') return toast('Your account is already a Business account.');
  if (!bizPicker) bizPicker = mountCountryPicker(el('bzCountry'), { placeholder: 'Select country' });
  el('bizForm').reset(); bizPicker.clear(); Object.keys(bizDocs).forEach((k) => delete bizDocs[k]);
  ['bzStatReg', 'bzStatTax', 'bzStatAddr'].forEach((id) => { el(id).textContent = ''; });
  hideCallout('bizError');
  el('bizModal').classList.remove('hidden');
}
async function bizUpload(input, key) {
  const file = input.files[0];
  if (!file) return;
  const st = el({ registrationDocUrl: 'bzStatReg', taxDocUrl: 'bzStatTax', addressDocUrl: 'bzStatAddr' }[key]);
  st.textContent = 'Uploading…';
  const r = await uploadRawFile(file);
  if (r.ok) { bizDocs[key] = r.url; st.textContent = '✓ ' + file.name; } else { delete bizDocs[key]; st.textContent = '✗ ' + r.error; }
}
function submitBusiness() {
  hideCallout('bizError');
  const v = (id) => el(id).value.trim();
  const payload = {
    groupId: activeGroupId, businessName: v('bzName'), tradingName: v('bzTrading'), regNumber: v('bzReg'), taxNumber: v('bzTax'),
    incorporationCountry: bizPicker.getValue(), incorporationDate: v('bzDate'), businessType: v('bzType'), industry: v('bzIndustry'),
    address: v('bzAddress'), website: v('bzWebsite'), contactName: v('bzContact'), contactRole: v('bzRole'),
    expectedMonthlyVolume: v('bzVolume'), sourceOfFunds: v('bzSource'), uboName: v('bzUbo'), uboOwnershipPct: v('bzUboPct'),
    registrationDocUrl: bizDocs.registrationDocUrl || '', taxDocUrl: bizDocs.taxDocUrl || '', addressDocUrl: bizDocs.addressDocUrl || ''
  };
  setBusy(el('bizSubmitBtn'), true, '<i class="fa-solid fa-spinner fa-spin"></i>');
  setTimeout(() => setBusy(el('bizSubmitBtn'), false), 10000);
  socket.emit('submit-business-kyc', payload);
}
socket.on('business-result', (r) => {
  setBusy(el('bizSubmitBtn'), false);
  if (r.ok) {
    closeModal('bizModal');
    showPopup({ icon: 'fa-briefcase', tone: 'ok', title: 'Application received', body: 'Thank you. Our compliance team will review your company details and notify you by email and in the portal. Until it is approved your daily withdrawal limit still applies.', actions: [{ label: 'Close', primary: true }] });
  } else {
    showCallout('bizError', (r.errors || ['Please check the form.']).join('\n'), 'warn');
    el('bizError').style.whiteSpace = 'pre-line';
  }
});

// ============================================================================
// Disabled / network-blocked screens
// ============================================================================
socket.on('seller-disabled', (d) => {
  if (d.groupId && d.groupId !== activeGroupId) return;
  const contact = d.contact || SUPPORT_EMAIL_DEFAULT;
  const acct = (sellerAccountState && sellerAccountState.accountId) || '';
  el('disabledMail').href = `mailto:${contact}?subject=${encodeURIComponent('Disabled account' + (acct ? ' — Account ID ' + acct : ''))}`;
  el('disabledMailText').textContent = contact;
  el('disabledAcct').textContent = acct || '—';
  const r = el('disabledReason');
  r.classList.toggle('hidden', !d.reason);
  r.textContent = d.reason ? `Note from the Desk: ${d.reason}` : '';
  el('disabledOverlay').classList.remove('hidden');
});
socket.on('seller-enabled', (d) => {
  if (d.groupId && d.groupId !== activeGroupId) return;
  el('disabledOverlay').classList.add('hidden');
  toast('Your account has been re-enabled. Welcome back.');
});
socket.on('ip-blocked', (d) => {
  const contact = (d && d.contact) || SUPPORT_EMAIL_DEFAULT;
  el('ipBlockMail').href = `mailto:${contact}?subject=${encodeURIComponent('Network access blocked')}`;
  el('ipBlockMailText').textContent = contact;
  el('ipBlockOverlay').classList.remove('hidden');
});


// ============================================================================
// Sign in / forgot password — a registered Transaction Account opens with email + password
// ============================================================================
let slResetEmail = '', slResetToken = null;
const SL_TITLES = { login: 'Sign in to your Transaction Account', forgot1: 'Reset your password', forgot2: 'Enter your code', forgot3: 'Choose a new password' };
function slShow(view) {
  ['login', 'forgot1', 'forgot2', 'forgot3'].forEach((v) => el('slView' + v.charAt(0).toUpperCase() + v.slice(1)).classList.toggle('hidden', v !== view));
  el('slTitle').textContent = SL_TITLES[view];
  ['slError', 'slError1', 'slError2', 'slError3'].forEach(hideCallout);
  setTimeout(() => { const f = { login: 'slEmail', forgot1: 'slFEmail', forgot2: 'slCode', forgot3: 'slNewPw' }[view]; if (el(f)) el(f).focus(); }, 60);
}
async function slPost(path, body) {
  try {
    const r = await fetch('/api/auth' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch (e) { /* non-JSON error page */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'Network error — please check your connection and try again.' } };
  }
}
function slOpen() {
  closeModal('txRegModal'); closeModal('obChoiceModal');
  const t = el('txAccountView'); if (t) t.classList.add('hidden');
  slShow('login');
  el('sellerLoginModal').classList.remove('hidden');
}
async function slLogin() {
  const email = el('slEmail').value.trim(), password = el('slPw').value;
  if (!email || !password) return showCallout('slError', 'Enter your email address and password.');
  hideCallout('slError');
  setBusy(el('slLoginBtn'), true, '<i class="fa-solid fa-spinner fa-spin"></i> Signing in…');
  const r = await slPost('/login', { email, password });
  setBusy(el('slLoginBtn'), false);
  if (!r.ok || !r.data.success) return showCallout('slError', r.data.error || 'Sign-in failed. Please try again.');
  try { localStorage.setItem('q_seller_token:' + r.data.groupId, r.data.sessionToken); } catch (e) { /* storage blocked */ }
  sessionStorage.setItem('q_session_token', r.data.sessionToken);
  window.location.href = window.location.pathname + '?groupId=' + encodeURIComponent(r.data.groupId) + '&role=SELLER';
}
async function slForgotRequest(resend) {
  const email = resend ? slResetEmail : el('slFEmail').value.trim();
  if (!email) return showCallout('slError1', 'Enter the email address on your account.');
  slResetEmail = email;
  setBusy(el('slF1Btn'), true, '<i class="fa-solid fa-spinner fa-spin"></i>');
  await slPost('/forgot-password/request', { email }); // always "success" — never reveals whether the address has an account
  setBusy(el('slF1Btn'), false);
  slShow('forgot2');
  el('slF2Msg').textContent = `If an account exists for ${email}, a 6-digit code is on its way. It expires in 10 minutes — check your spam folder too.`;
  if (resend) toast('A new code was requested.');
}
async function slForgotVerify() {
  const code = el('slCode').value.trim();
  if (!/^\d{6}$/.test(code)) return showCallout('slError2', 'Enter the 6-digit code from the email.');
  setBusy(el('slF2Btn'), true, '<i class="fa-solid fa-spinner fa-spin"></i>');
  const r = await slPost('/forgot-password/verify', { email: slResetEmail, code });
  setBusy(el('slF2Btn'), false);
  if (!r.ok || !r.data.resetToken) return showCallout('slError2', r.data.error || 'That code is not valid or has expired.');
  slResetToken = r.data.resetToken;
  slShow('forgot3');
}
async function slForgotReset() {
  const a = el('slNewPw').value, b = el('slNewPw2').value;
  if (a.length < 8 || !/[A-Za-z]/.test(a) || !/\d/.test(a)) return showCallout('slError3', 'Password must be at least 8 characters and include a letter and a number.');
  if (a !== b) return showCallout('slError3', 'The passwords do not match.');
  setBusy(el('slF3Btn'), true, '<i class="fa-solid fa-spinner fa-spin"></i>');
  const r = await slPost('/forgot-password/reset', { email: slResetEmail, resetToken: slResetToken, newPassword: a });
  setBusy(el('slF3Btn'), false);
  if (!r.ok) return showCallout('slError3', r.data.error || 'Could not save the new password. Please start again.');
  el('slNewPw').value = ''; el('slNewPw2').value = ''; slResetToken = null;
  slShow('login');
  el('slEmail').value = slResetEmail; el('slPw').value = '';
  showCallout('slError', 'Your password was updated. Sign in with the new password.', 'ok');
}
socket.on('seller-login-required', () => slOpen());
function sellerSignOut() { socket.emit('seller-sign-out', { groupId: activeGroupId }); }
socket.on('seller-signed-out', ({ groupId }) => {
  try { localStorage.removeItem('q_seller_token:' + groupId); } catch (e) { /* ignore */ }
  sessionStorage.setItem('q_session_token', 'token-' + Math.random().toString(36).slice(2, 15));
  window.location.reload();
});
// Remember this browser as trusted once the account is open (so a return visit needs no password until sign-out).
socket.on('seller-account-state', (acct) => {
  if (!acct || !acct.registered || !isSeller() || acct.groupId !== activeGroupId) return;
  try { localStorage.setItem('q_seller_token:' + acct.groupId, sessionToken); } catch (e) { /* ignore */ }
});
