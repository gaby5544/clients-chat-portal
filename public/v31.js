/* v3.1 client layer — loaded after app.js. Everything here either adds new
 * behaviour or deliberately replaces an app.js function of the same name
 * (function declarations are global, so the later definition wins at call time). */

// ====================================================================
// 0. Shared helpers
// ====================================================================
const QC = window.QCountries, QL = window.QLanguages;
function flagHtml(iso, name) {
  if (!iso) return '';
  const lc = String(iso).toLowerCase();
  return `<img class="flag" alt="${escapeHtml(name || iso)}" loading="lazy" src="https://flagcdn.com/w40/${lc}.png" srcset="https://flagcdn.com/w80/${lc}.png 2x" onerror="flagFail(this,'${String(iso).replace(/[^A-Za-z]/g, '')}')">`;
}
function flagFail(img, iso) {
  if (!img || !img.parentNode) return;               // already re-rendered away
  img.onerror = null;
  const s = document.createElement('span'); s.className = 'flag-emoji'; s.textContent = QC.flagEmoji(iso);
  img.replaceWith(s);
}
// Elite money: grouped thousands, correct decimals, currency symbol/code styled — 2,000,000.00 not 2000000.
const CCY_SYMBOL_V = { USD: '$', GBP: '£', EUR: '€' };
function fmtMoney(amount, ccy) {
  const n = Number(amount || 0);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return CCY_SYMBOL_V[ccy] ? `${CCY_SYMBOL_V[ccy]}${s}` : `${s}${ccy ? ' ' + ccy : ''}`;
}
// Dates always carry the year (a date of birth without one is useless). Date-only strings are read as local dates, not shifted by timezone.
function fmtDate(iso) {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(String(iso) + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function fmtLeft(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return d > 0 ? `${d}d ${h}h ${m}m ${s}s` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}
function maskTailClient(str) { const s = String(str || ''); return s.length <= 6 ? s : `${s.slice(0, 4)}••••${s.slice(-4)}`; }
function togglePw(id, btn) {
  const inp = el(id); const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = `<i class="fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
}
function copyAccountId() {
  const id = sellerAccountState && sellerAccountState.accountId; if (!id) return;
  (navigator.clipboard ? navigator.clipboard.writeText(id) : Promise.reject()).then(() => toast('Account ID copied.')).catch(() => toast('Account ID: ' + id));
}
function openModal(id) { el(id).classList.remove('hidden'); }

// ====================================================================
// 1. Country & dial-code picker (scrollable + instantly searchable)
// ====================================================================
const pickState = { mode: null, country: null, dial: null, biz: null, wdbank: null, rfcountry: null, dialManual: false };
function openCountryPicker(mode) {
  pickState.mode = mode;
  el('countryPickerTitle').innerHTML = mode === 'dial' ? '<i class="fa-solid fa-phone"></i> Country code' : '<i class="fa-solid fa-earth-africa"></i> Select country';
  el('countrySearch').value = '';
  renderCountryList();
  openModal('countryPickerModal');
  setTimeout(() => el('countrySearch').focus(), 60);
}
function renderCountryList() {
  const q = el('countrySearch').value.trim().toLowerCase().replace(/^\+/, '');
  const mode = pickState.mode;
  const cur = mode === 'dial' ? pickState.dial : pickState[mode];
  const list = QC.COUNTRIES.filter(c => !q || c.name.toLowerCase().includes(q) || c.iso.toLowerCase() === q || c.dial.startsWith(q));
  // best matches first: names that START with the query
  list.sort((a, b) => ((b.name.toLowerCase().startsWith(q) ? 1 : 0) - (a.name.toLowerCase().startsWith(q) ? 1 : 0)) || a.name.localeCompare(b.name));
  el('countryList').innerHTML = list.length ? list.map(c => `
    <div class="picker-item ${cur && cur.iso === c.iso ? 'active' : ''}" role="option" onclick="pickCountry('${c.iso}')">
      ${flagHtml(c.iso, c.name)}<div class="nm">${escapeHtml(c.name)}</div><span class="dc">+${c.dial}</span>
    </div>`).join('') : '<div class="picker-empty">No country matches your search.</div>';
}
function pickCountry(iso) {
  const c = QC.findCountry(iso); if (!c) return;
  const mode = pickState.mode;
  if (mode === 'dial') { pickState.dial = c; pickState.dialManual = true; paintDial(); }
  else {
    pickState[mode] = c;
    if (mode === 'country') { paintCountryBtn('txReg', c); if (!pickState.dialManual) { pickState.dial = c; paintDial(); } }
    if (mode === 'biz') paintCountryBtn('biz', c);
    if (mode === 'wdbank') paintCountryBtn('wdBank', c);
    if (mode === 'rfcountry') paintCountryBtn('rf', c);
  }
  closeModal('countryPickerModal');
}
function paintCountryBtn(prefix, c) {
  el(prefix + 'CountryFlag').innerHTML = flagHtml(c.iso, c.name);
  const t = el(prefix + 'CountryText'); t.textContent = c.name; t.classList.remove('placeholder');
}
function paintDial() {
  const c = pickState.dial; if (!c) return;
  el('txRegDialFlag').innerHTML = flagHtml(c.iso, c.name); el('txRegDialText').textContent = '+' + c.dial;
}

// ====================================================================
// 2. Language picker (always one tap away: globe in the header)
// ====================================================================
function openLanguagePicker() {
  el('languageSearch').value = '';
  el('autoTranslateMsgs').checked = QI18N.autoMsgs;
  renderLanguageList(); openModal('languageModal');
  setTimeout(() => el('languageSearch').focus(), 60);
}
function renderLanguageList() {
  const q = el('languageSearch').value.trim().toLowerCase();
  const list = QL.LANGUAGES.filter(l => !q || l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code.toLowerCase() === q);
  el('languageList').innerHTML = list.length ? list.map(l => `
    <div class="picker-item notranslate ${QI18N.lang === l.code ? 'active' : ''}" translate="no" role="option" onclick="chooseLanguage('${l.code}')">
      ${flagHtml(l.flag, l.name)}<div class="nm">${escapeHtml(l.native)}<small>${escapeHtml(l.name)}</small></div>${QI18N.lang === l.code ? '<i class="fa-solid fa-check" style="color:var(--accent-emerald)"></i>' : ''}
    </div>`).join('') : '<div class="picker-empty">No language matches your search.</div>';
}
function chooseLanguage(code) {
  QI18N.setLanguage(code);
  closeModal('languageModal');
  syncLanguageLabels();
}
function syncLanguageLabels() {
  const info = QL.findLanguage(QI18N.lang);
  if (el('regLangLabel') && info) el('regLangLabel').textContent = info.native;
  if (el('txProfileLang') && info) el('txProfileLang').textContent = `${info.native} (${info.name})`;
  const sel = el('targetLangSelect');
  if (sel) {
    if (!sel.dataset.full) {
      sel.dataset.full = '1';
      sel.innerHTML = QL.LANGUAGES.map(l => `<option value="${l.code}">${l.name} — ${l.native}</option>`).join('');
    }
    sel.value = QI18N.lang;
  }
}
document.addEventListener('qi18n:change', syncLanguageLabels);
document.addEventListener('DOMContentLoaded', syncLanguageLabels);
syncLanguageLabels();

// Server-side translation for chat (replaces the direct MyMemory call).
async function translateText(text, targetLang, sourceLang) {
  if (!text || !targetLang) return text;
  const r = await QI18N.translateOne(text, targetLang, sourceLang && sourceLang !== 'autodetect' ? sourceLang : 'auto');
  if (!r.ok) toast('Translation is temporarily unavailable — please try again in a moment.', true);
  return r.text || text;
}
// Live messages: add the automatic translation after app.js has rendered them.
socket.on('message', (m) => QI18N.autoTranslate(m));
// History on join: only the most recent ones, to keep it light.
socket.on('init-state', (d) => {
  (d.messages || []).slice(-25).forEach(m => QI18N.autoTranslate(m));
  QI18N.translateNow(document.body);
});

// Include the chosen language when joining.
function joinSession(adminKey = null) {
  const selectedRole = adminKey ? 'ADMINISTRATOR' : (urlLockedRole || el('roleSelect').value);
  const email = localStorage.getItem('q_user_email') || undefined;
  socket.emit('join-room', { groupId: activeGroupId, role: selectedRole, adminKey, sessionToken, email, lang: QI18N.lang });
}

// ====================================================================
// 3. Registration (email code, phone, terms, show-password, standard account)
// ====================================================================
const reg = { verifiedEmail: null, sentTo: null, cooldownT: null };
function maybeShowTxRegModal() {
  if (myRole !== 'PARTY B' || !sellerAccountState) return;
  el('txAccountBtn').classList.remove('hidden');
  el('brandMenuTxAccount').classList.remove('hidden');
  if (sellerAccountState.registered) { closeModal('txRegModal'); return; }
  if (el('txRegModal').classList.contains('hidden')) {
    const prefill = sellerAccountState.email || (currentGroupEmails && currentGroupEmails.B) || '';
    if (!el('txRegEmailInput').value) el('txRegEmailInput').value = prefill;
    el('txRegEmailPrefillNote').style.display = prefill && el('txRegEmailInput').value === prefill ? 'block' : 'none';
    if (!pickState.dial) { pickState.dial = QC.findCountry('US'); paintDial(); }
    syncLanguageLabels();
    openModal('txRegModal');
  }
}
function regClearEmail() {
  const inp = el('txRegEmailInput'); inp.value = ''; inp.readOnly = false; inp.focus();
  el('txRegEmailPrefillNote').style.display = 'none';
  regResetVerification();
}
function regResetVerification() {
  reg.verifiedEmail = null; reg.sentTo = null;
  el('txRegEmailVerified').classList.add('hidden'); el('txRegCodeRow').classList.add('hidden'); el('txRegCodeHint').textContent = '';
  el('txRegSendCodeBtn').classList.remove('hidden'); el('txRegSendCodeBtn').disabled = false;
}
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'txRegEmailInput') {
    const v = t.value.trim().toLowerCase();
    if (reg.verifiedEmail && v !== reg.verifiedEmail) regResetVerification();
    else if (reg.sentTo && v !== reg.sentTo) regResetVerification();
    const pre = sellerAccountState && sellerAccountState.email;
    el('txRegEmailPrefillNote').style.display = pre && v === String(pre).toLowerCase() ? 'block' : 'none';
  }
  if (t.id === 'txRegPasswordInput' || t.id === 'txRegPasswordConfirmInput') regPasswordFeedback();
  if (t.id === 'txRegCodeInput') t.value = t.value.replace(/\D/g, '').slice(0, 6);
  if (t.id === 'wdCodeInput') t.value = t.value.replace(/\D/g, '').slice(0, 6);
  if (t.id === 'forgotCode') t.value = t.value.replace(/\D/g, '').slice(0, 6);
});
function regPasswordFeedback() {
  const p = el('txRegPasswordInput').value, c = el('txRegPasswordConfirmInput').value;
  let score = 0;
  if (p.length >= 8) score++; if (p.length >= 12) score++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++; if (/\d/.test(p)) score++; if (/[^A-Za-z0-9]/.test(p)) score++;
  const bar = el('txRegPwBar'); bar.style.width = (p ? Math.max(12, score * 20) : 0) + '%';
  bar.style.background = score <= 1 ? 'var(--accent-rose)' : score <= 3 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
  el('txRegPwHint').textContent = !p ? '' : p.length < 8 ? 'Use at least 8 characters.' : score <= 2 ? 'Fair — add numbers or symbols to make it stronger.' : 'Strong password.';
  const m = el('txRegPwMatch');
  if (!c) { m.textContent = ''; return; }
  m.textContent = c === p ? '✓ Passwords match' : '✗ Passwords do not match';
  m.style.color = c === p ? 'var(--accent-emerald)' : 'var(--accent-rose)';
}
function regSendEmailCode() {
  const email = el('txRegEmailInput').value.trim();
  if (!isValidEmailClient(email)) return toast('Please enter a valid email address first.', true);
  el('txRegSendCodeBtn').disabled = true;
  socket.emit('request-registration-email-code', { groupId: activeGroupId, email });
  setTimeout(() => { if (!reg.sentTo) el('txRegSendCodeBtn').disabled = false; }, 4000);
}
socket.on('registration-email-code-sent', ({ email, masked, expiresInSec, cooldownSec }) => {
  reg.sentTo = email;
  el('txRegCodeRow').classList.remove('hidden'); el('txRegCodeInput').value = ''; el('txRegCodeInput').focus();
  el('txRegCodeHint').textContent = `We sent a 6-digit code to ${masked}. It expires in ${Math.round(expiresInSec / 60)} minutes.`;
  let left = cooldownSec; const btn = el('txRegSendCodeBtn');
  clearInterval(reg.cooldownT);
  const tick = () => { if (left <= 0) { clearInterval(reg.cooldownT); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Resend code'; } else { btn.disabled = true; btn.textContent = `Resend in ${left--}s`; } };
  tick(); reg.cooldownT = setInterval(tick, 1000);
});
function regVerifyEmailCode() {
  const code = el('txRegCodeInput').value.trim();
  if (!/^\d{6}$/.test(code)) return toast('Enter the 6-digit code from your email.', true);
  socket.emit('verify-registration-email', { groupId: activeGroupId, email: el('txRegEmailInput').value.trim(), code });
}
socket.on('registration-email-result', (r) => {
  if (!r.ok) { el('txRegCodeHint').textContent = r.error; el('txRegCodeHint').style.color = 'var(--accent-rose)'; return toast(r.error, true); }
  reg.verifiedEmail = r.email; clearInterval(reg.cooldownT);
  el('txRegEmailVerified').classList.remove('hidden'); el('txRegSendCodeBtn').classList.add('hidden'); el('txRegCodeRow').classList.add('hidden');
  el('txRegCodeHint').textContent = ''; el('txRegCodeHint').style.color = '';
  toast('Email verified.');
});
function submitTxRegistration() {
  const fullName = el('txRegNameInput').value.trim();
  const email = el('txRegEmailInput').value.trim();
  const password = el('txRegPasswordInput').value, confirm = el('txRegPasswordConfirmInput').value;
  const dateOfBirth = el('txRegDobInput').value;
  const phone = el('txRegPhoneInput').value.trim();
  if (fullName.length < 3 || !/\s/.test(fullName)) return toast('Please enter your full legal name (first and last name).', true);
  if (!isValidEmailClient(email)) return toast("That doesn't look like a valid email.", true);
  if (reg.verifiedEmail !== email.toLowerCase()) return toast('Please verify your email address with the code we send you.', true);
  if (!pickState.dial || phone.replace(/\D/g, '').length < 6) return toast('Please enter a valid phone number.', true);
  if (password.length < 8) return toast('Password must be at least 8 characters.', true);
  if (password !== confirm) return toast('Passwords do not match.', true);
  if (!dateOfBirth) return toast('Please enter your date of birth.', true);
  if ((Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000) < 18) return toast('You must be at least 18 years old to create a Transaction Account.', true);
  if (!pickState.country) return toast('Please select your country.', true);
  if (!el('txRegTerms').checked) return toast('Please tick the box to accept the Terms of Service and Transaction Policy.', true);
  el('txRegSubmitBtn').disabled = true; setTimeout(() => { el('txRegSubmitBtn').disabled = false; }, 4000);
  socket.emit('register-transaction-account', {
    groupId: activeGroupId, fullName, email, password, currency: el('txRegCurrencyInput').value, dateOfBirth,
    country: pickState.country.name, phoneDial: pickState.dial.dial, phoneNumber: phone, phoneIso: pickState.dial.iso,
    language: QI18N.lang, acceptTerms: true, accountType: el('txRegAccountType').value || 'standard'
  });
}
let termsLoaded = false;
async function openTermsModal() {
  openModal('termsModal');
  if (termsLoaded) return;
  try {
    const t = await (await fetch('/api/terms')).json();
    el('termsBody').innerHTML = `<p><b>Version ${escapeHtml(t.version)}</b></p>` + t.sections.map(s => `<h4>${escapeHtml(s.title)}</h4>${s.body.map(p => `<p>${escapeHtml(p)}</p>`).join('')}`).join('');
    termsLoaded = true;
  } catch (e) { el('termsBody').textContent = 'Could not load the terms. Please check your connection and try again.'; }
}
function acceptTermsFromModal() { el('txRegTerms').checked = true; closeModal('termsModal'); }

// Next step after the account is created
socket.off('transaction-account-created');
socket.on('transaction-account-created', ({ accountId }) => {
  closeModal('txRegModal');
  el('nextStepAccountId').textContent = accountId || '—';
  openModal('nextStepModal');
});
function chooseNextStep(which) {
  closeModal('nextStepModal');
  if (which === 'kyc') {
    openTxAccountView();
    setTimeout(() => { openTxKycWizard(); }, 250);
  } else {
    closeTxAccountView();
    goToChat();
    toast('Your transaction group is ready — you can start your transaction now.');
  }
}
function goToChat() {
  ['txAccountView', 'wdBlockedModal'].forEach(id => el(id).classList.add('hidden'));
  const c = el('messageContainer'); if (c) c.scrollTop = c.scrollHeight;
  const inp = el('messageInput'); if (inp) setTimeout(() => inp.focus(), 150);
}
function goCompleteTransaction() { closeModal('wdBlockedModal'); closeTxAccountView(); goToChat(); toast('Complete your part of the transaction here. Once the Desk confirms both parties, withdrawals open.'); }

// ====================================================================
// 4. Seller dashboard: Account ID, flag, profile, disabled state, gate
// ====================================================================
const _renderTxAccountUIBase = renderTxAccountUI;
renderTxAccountUI = function () {
  _renderTxAccountUIBase();
  const a = sellerAccountState; if (!a) return;
  const ccy = a.currency || 'USD';
  if (el('txAcctIdLabel')) el('txAcctIdLabel').textContent = a.accountId || '—';
  const pill = el('txCountryPill');
  if (pill) { pill.classList.toggle('hidden', !a.country); if (a.country) { el('txCountryFlag').innerHTML = flagHtml(a.countryIso, a.country); el('txCountryLabel').textContent = a.country; } }
  if (el('wdAvail')) el('wdAvail').textContent = fmtMoney(a.balances.available, ccy);
  if (el('wdPend')) el('wdPend').textContent = fmtMoney(a.balances.pending || 0, ccy);
  if (el('wdLimit')) el('wdLimit').textContent = a.accountType === 'business' ? 'Unlimited' : fmtMoney(10000000, ccy) + ' / day';
  if (el('txWdAmountCcy')) el('txWdAmountCcy').textContent = `(${ccy})`;
  const gate = el('wdGateBanner'); if (gate) gate.classList.toggle('hidden', !!a.disbursementEnabled || a.kyc.status !== 'verified');
  const unl = el('wdUnlimitedLink'); if (unl) unl.style.display = a.accountType === 'business' ? 'none' : '';
  const bb = el('wdBizBanner');
  if (bb) {
    const b = a.business || {};
    bb.classList.toggle('hidden', !(b.status === 'pending' || b.status === 'rejected' || a.accountType === 'business'));
    bb.innerHTML = a.accountType === 'business' ? `<i class="fa-solid fa-circle-check" style="color:var(--accent-emerald)"></i> <b>Business account</b>${b.companyName ? ' · ' + escapeHtml(b.companyName) : ''} — no daily withdrawal limit applies.`
      : b.status === 'pending' ? '<i class="fa-solid fa-hourglass-half"></i> Your Business application is under review. We will email you the decision.'
      : b.status === 'rejected' ? `<i class="fa-solid fa-circle-xmark" style="color:var(--accent-rose)"></i> Your Business application was not approved${b.rejectionReason ? ': ' + escapeHtml(b.rejectionReason) : '.'} You can correct the details and apply again.` : '';
  }
  updateDisbBadge(a.disbursementEnabled);
  renderDisabledBanner();
  if (!el('txPageProfile').classList.contains('hidden')) renderTxProfile();
};
const _renderTxProfileBase = renderTxProfile;
renderTxProfile = function () {
  _renderTxProfileBase();
  const a = sellerAccountState; if (!a) return;
  el('txProfileAcctId').textContent = a.accountId || '—';
  el('txProfileType').textContent = a.accountTypeLabel || 'Standard account';
  el('txProfilePhone').textContent = a.phone || '—';
  el('txProfileCountry').innerHTML = a.country ? `<span class="flag-inline">${flagHtml(a.countryIso, a.country)} ${escapeHtml(a.country)}</span>` : '—';
  el('txProfileBiz').textContent = a.accountType === 'business' ? 'Approved' : ({ none: 'Not applied', pending: 'Under review', rejected: 'Not approved', verified: 'Approved' }[a.business && a.business.status] || 'Not applied');
  syncLanguageLabels();
};
function updateDisbBadge(enabled) {
  const b = el('disbBadge'); if (!b) return;
  const hasTx = isAdminConfirmed || (sellerAccountState && sellerAccountState.registered);
  if (!hasTx || enabled === undefined) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden'); b.className = 'disb-badge ' + (enabled ? 'on' : 'off');
  b.textContent = enabled ? 'Disbursement stage' : 'Awaiting confirmation';
  const t = el('disbToggleBtn');
  if (t) { t.classList.toggle('hidden', !isAdminConfirmed); t.style.color = enabled ? 'var(--accent-emerald)' : ''; t.title = enabled ? 'In disbursement — click to pause withdrawals' : 'Click to enable disbursement (lets the seller withdraw)'; }
}
let currentGroupDisb = false;
socket.on('init-state', (d) => { currentGroupDisb = !!d.group.disbursementEnabled; updateDisbBadge(currentGroupDisb); });
socket.on('disbursement-updated', ({ groupId, enabled }) => {
  if (groupId !== activeGroupId) return;
  currentGroupDisb = enabled; updateDisbBadge(enabled);
  if (sellerAccountState) { sellerAccountState.disbursementEnabled = enabled; renderTxAccountUI(); }
});
function toggleGroupDisbursement() { socket.emit('admin-set-disbursement', { groupId: activeGroupId, enabled: !currentGroupDisb }); }

// Disabled account
function renderDisabledBanner() {
  const a = sellerAccountState; const host = document.querySelector('#txAccountView .tx-scroll'); if (!host) return;
  let b = el('txDisabledBanner');
  if (!a || !a.disabled) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'txDisabledBanner'; b.className = 'tx-kyc-banner bad'; host.prepend(b); }
  b.innerHTML = `<div class="tx-kyc-banner-text"><i class="fa-solid fa-ban"></i> <span>Your account is disabled${a.disabledReason ? ' — ' + escapeHtml(a.disabledReason) : ''}. Contact <a href="mailto:${a.complaintsEmail}" style="color:inherit;font-weight:800;">${a.complaintsEmail}</a> to complain or request a review.</span></div>`;
}
function showDisabledOverlay(a) {
  el('disabledText').textContent = `Your Transaction Account has been disabled${a.disabledReason ? ' — ' + a.disabledReason : ''}. You cannot withdraw, deposit or change details while it is disabled.`;
  const mail = a.complaintsEmail || 'complaints@usvistra.com';
  el('disabledMail').textContent = mail; el('disabledMail').href = 'mailto:' + mail + '?subject=' + encodeURIComponent('Account ' + (a.accountId || '') + ' — complaint');
  el('disabledAcct').innerHTML = a.accountId ? `Account ID <b>${escapeHtml(a.accountId)}</b>` : '';
  openModal('disabledOverlay');
}
let _disabledShownFor = null;
socket.on('seller-account-state', (a) => {
  if (!a || !a.disabled) { _disabledShownFor = null; return; }
  if (_disabledShownFor !== a.disabledAt) { _disabledShownFor = a.disabledAt; showDisabledOverlay(a); }
});
socket.on('seller-access-changed', ({ disabled, reason }) => {
  if (sellerAccountState) { sellerAccountState.disabled = disabled; sellerAccountState.disabledReason = reason; }
  if (disabled) showDisabledOverlay({ ...(sellerAccountState || {}), disabledReason: reason, complaintsEmail: (sellerAccountState && sellerAccountState.complaintsEmail) });
  else { closeModal('disabledOverlay'); toast('Your account has been re-enabled.'); }
  renderTxAccountUI();
});
socket.on('ip-blocked', ({ message }) => { toast(message, true); const o = el('disabledOverlay'); el('disabledText').textContent = message; el('disabledAcct').textContent = ''; o.classList.remove('hidden'); });

// ====================================================================
// 5. Withdrawals (seller)
// ====================================================================
const _setTxAccountNavBase = setTxAccountNav;
setTxAccountNav = function (nav) {
  _setTxAccountNavBase(nav);
  if (nav === 'withdraw') { resetWithdrawForm(); socket.emit('preview-withdrawal', { groupId: activeGroupId }); renderWithdrawalCards(); }
};
function resetWithdrawForm() {
  // Always start clean: nothing cached from an earlier bank or crypto attempt.
  el('txWithdrawMethod').value = '';
  const sel = el('txWithdrawMethod'); sel.dispatchEvent(new Event('change', { bubbles: true }));
  ['txWdDestination', 'txWdBeneficiary', 'txWdBankName', 'txWdBankAccount', 'txWdSwift', 'txWdAmount'].forEach(id => { el(id).value = ''; });
  pickState.wdbank = null; el('wdBankCountryFlag').innerHTML = ''; el('wdBankCountryText').textContent = 'Select country'; el('wdBankCountryText').classList.add('placeholder');
  el('txWithdrawCryptoFields').style.display = 'none'; el('txWithdrawBankFields').style.display = 'none'; el('txWdAmountRow').style.display = 'none';
  el('wdAmountHint').textContent = '';
}
function onWithdrawMethodChange() {
  const m = el('txWithdrawMethod').value;
  // switching method wipes the other method's fields so nothing stale is submitted
  if (m !== 'bank') { ['txWdBeneficiary', 'txWdBankName', 'txWdBankAccount', 'txWdSwift'].forEach(id => { el(id).value = ''; }); pickState.wdbank = null; el('wdBankCountryFlag').innerHTML = ''; el('wdBankCountryText').textContent = 'Select country'; el('wdBankCountryText').classList.add('placeholder'); }
  if (m !== 'crypto') el('txWdDestination').value = '';
  el('txWithdrawBankFields').style.display = m === 'bank' ? 'block' : 'none';
  el('txWithdrawCryptoFields').style.display = m === 'crypto' ? 'block' : 'none';
  el('txWdAmountRow').style.display = m ? 'block' : 'none';
  el('wdAmountHint').textContent = m === 'crypto' ? 'Crypto withdrawals may require a prior verified crypto deposit.' : '';
}
let wdPreview = null;
socket.on('withdrawal-preview', (p) => {
  wdPreview = p;
  if (!sellerAccountState) return;
  const ccy = p.currency || sellerAccountState.currency;
  el('wdLimit').textContent = p.dailyCap === null ? 'Unlimited' : `${fmtMoney(p.remainingToday, ccy)} left today`;
});
let wdPendingDraft = null, wdResendT = null;
function submitTxWithdrawal() {
  const a = sellerAccountState; if (!a) return;
  const method = el('txWithdrawMethod').value;
  if (!method) return toast('Please choose a withdrawal method.', true);
  const amount = parseFloat(el('txWdAmount').value);
  if (!Number.isFinite(amount) || amount <= 0) return toast('Please enter a valid amount.', true);
  const payload = { groupId: activeGroupId, method, amount, amountCurrency: a.currency || 'USD' };
  if (method === 'bank') {
    Object.assign(payload, { beneficiaryName: el('txWdBeneficiary').value.trim(), bankName: el('txWdBankName').value.trim(), bankAccount: el('txWdBankAccount').value.trim(), bankSwift: el('txWdSwift').value.trim(), bankCountry: pickState.wdbank ? pickState.wdbank.name : '' });
    if (!payload.beneficiaryName || !payload.bankName || !payload.bankAccount) return toast('Beneficiary name, bank name and account number/IBAN are required.', true);
  } else {
    Object.assign(payload, { asset: el('txWdAsset').value, network: el('txWdNetwork').value, destination: el('txWdDestination').value.trim() });
    if (payload.destination.length < 6) return toast('Please enter a valid destination wallet address.', true);
  }
  wdPendingDraft = payload;
  el('txWdSubmit').disabled = true; setTimeout(() => { el('txWdSubmit').disabled = false; }, 3500);
  socket.emit('request-withdrawal', payload);
}
socket.on('withdrawal-code-sent', ({ masked, cooldownSec }) => {
  const d = wdPendingDraft || {}; const ccy = d.amountCurrency;
  el('wdCodeSub').textContent = `We emailed a 6-digit security code to ${masked}. Enter it below to confirm this withdrawal.`;
  el('wdCodeSummary').innerHTML = `<div>Amount <b>${fmtMoney(d.amount, ccy)}</b></div><div>Method <b>${d.method === 'crypto' ? `${escapeHtml(d.asset || '')} (${escapeHtml(d.network || '')})` : 'Bank transfer'}</b></div><div>To <b>${d.method === 'crypto' ? escapeHtml(maskTailClient(d.destination)) : escapeHtml(d.bankName || '')}</b></div>`;
  el('wdCodeInput').value = ''; el('wdCodeError').textContent = '';
  openModal('wdCodeModal'); setTimeout(() => el('wdCodeInput').focus(), 80);
  let left = cooldownSec || 30; const btn = el('wdResendBtn'); clearInterval(wdResendT);
  const tick = () => { if (left <= 0) { clearInterval(wdResendT); btn.disabled = false; btn.textContent = 'Resend code'; } else { btn.disabled = true; btn.textContent = `Resend in ${left--}s`; } };
  tick(); wdResendT = setInterval(tick, 1000);
});
function resendWithdrawalCode() { socket.emit('resend-withdrawal-code', { groupId: activeGroupId }); }
function cancelWithdrawalDraft() { socket.emit('cancel-withdrawal-draft'); closeModal('wdCodeModal'); wdPendingDraft = null; }
function confirmWithdrawalCode() {
  const code = el('wdCodeInput').value.trim();
  if (!/^\d{6}$/.test(code)) { el('wdCodeError').textContent = 'Enter the 6-digit code from your email.'; return; }
  socket.emit('confirm-withdrawal', { groupId: activeGroupId, code });
}
socket.on('withdrawal-confirm-result', (r) => {
  if (r.ok) { closeModal('wdCodeModal'); wdPendingDraft = null; resetWithdrawForm(); toast(`Withdrawal ${r.ref} submitted — it is now Pending.`); return; }
  el('wdCodeError').textContent = r.error || 'Could not confirm.';
  if (r.restart) { setTimeout(() => closeModal('wdCodeModal'), 1800); wdPendingDraft = null; }
});
socket.on('withdrawal-blocked', (b) => {
  if (b.groupId && b.groupId !== activeGroupId) return;
  const ccy = b.currency || (sellerAccountState && sellerAccountState.currency);
  const icon = el('wdBlockedIcon'); let extra = ''; let actions = '';
  el('wdBlockedTitle').textContent = b.title; el('wdBlockedText').textContent = b.message;
  if (b.reason === 'disbursement') {
    icon.className = 'next-badge warn'; icon.innerHTML = '<i class="fa-solid fa-hourglass-half"></i>';
    actions = `<button class="send-btn" onclick="goCompleteTransaction()"><i class="fa-solid fa-comments-dollar"></i> Complete transaction</button><button class="ghost-btn" onclick="closeModal('wdBlockedModal')">Close</button>`;
  } else if (b.reason === 'daily_limit') {
    icon.className = 'next-badge warn'; icon.innerHTML = '<i class="fa-solid fa-gauge-high"></i>';
    extra = `<div class="gate-extra">Daily limit <b>${fmtMoney(b.cap, ccy)}</b><br>Used today <b>${fmtMoney(b.used, ccy)}</b><br>Remaining today <b>${fmtMoney(b.remaining, ccy)}</b></div>`;
    actions = b.businessStatus === 'pending' ? `<button class="ghost-btn" onclick="closeModal('wdBlockedModal')">Close</button>`
      : `<button class="send-btn" onclick="closeModal('wdBlockedModal'); openBusinessModal()"><i class="fa-solid fa-infinity"></i> Upgrade for unlimited withdrawals</button><button class="ghost-btn" onclick="closeModal('wdBlockedModal')">Close</button>`;
    if (b.businessStatus === 'pending') extra += '<p class="reg-note">Your Business application is already under review.</p>';
  } else if (b.reason === 'crypto_deposit') {
    icon.className = 'next-badge warn'; icon.innerHTML = '<i class="fa-solid fa-coins"></i>';
    extra = `<div class="gate-extra">Required crypto deposit <b>${fmtMoney(b.requiredLedger, ccy)}</b><br>Verified so far <b>${fmtMoney(b.haveLedger, ccy)}</b><br>Still needed <b>${fmtMoney(b.shortfallLedger, ccy)}</b></div><p class="reg-note">Your bank-transfer withdrawals are not affected.</p>`;
    window._cryptoShortfall = b.shortfallLedger;
    actions = `<button class="send-btn" onclick="closeModal('wdBlockedModal'); openCryptoDepositForGate()"><i class="fa-solid fa-arrow-down"></i> Make a crypto deposit</button><button class="ghost-btn" onclick="closeModal('wdBlockedModal'); switchToBankWithdrawal()">Withdraw by bank instead</button>`;
  }
  el('wdBlockedExtra').innerHTML = extra; el('wdBlockedActions').innerHTML = actions;
  closeModal('wdCodeModal'); openModal('wdBlockedModal');
});
function openCryptoDepositForGate() { openTxDepositModal(); if (window._cryptoShortfall) el('txDepositAmount').value = (Math.ceil(window._cryptoShortfall * 100) / 100).toFixed(2); }
function switchToBankWithdrawal() { setTxAccountNav('withdraw'); el('txWithdrawMethod').value = 'bank'; el('txWithdrawMethod').dispatchEvent(new Event('change', { bubbles: true })); onWithdrawMethodChange(); const l = document.querySelector('#txWithdrawMethod').parentNode.querySelector('.csel-trigger-label'); if (l) l.textContent = 'Bank transfer'; }

const WD_STEP_ORDER = ['pending', 'processing', 'completed'];
const wdCanon = (s) => (s === 'held_in_vault' ? 'pending' : (s === 'rejected' || s === 'failed') ? 'declined' : s);
function wdTrackerHtml(status) {
  const st = wdCanon(status);
  const labels = { pending: 'Pending', processing: 'Processing', completed: 'Completed', declined: 'Declined' };
  const idx = st === 'declined' ? 1 : WD_STEP_ORDER.indexOf(st);
  const steps = WD_STEP_ORDER.map((k, i) => {
    let cls = '', icon = 'fa-circle', label = labels[k];
    if (st === 'declined' && i === 2) { cls = 'bad'; icon = 'fa-xmark'; label = labels.declined; }
    else if (st === 'completed') { cls = 'done'; icon = 'fa-check'; }
    else if (i < idx) { cls = 'done'; icon = 'fa-check'; }
    else if (i === idx && st !== 'declined') { cls = 'active'; icon = i === 0 ? 'fa-hourglass-half' : 'fa-gears'; }
    else if (st === 'declined' && i < 2) { cls = i === 0 ? 'done' : ''; icon = i === 0 ? 'fa-check' : 'fa-circle'; }
    return `<div class="wd-step ${cls}"><div class="bub"><i class="fa-solid ${icon}"></i></div><span>${label}</span></div>`;
  });
  const links = [0, 1].map(i => `<div class="wd-link ${(st === 'completed' || i < idx || (st === 'declined' && i === 0)) ? 'done' : ''}"></div>`);
  return `<div class="wd-steps">${steps[0]}${links[0]}${steps[1]}${links[1]}${steps[2]}</div>`;
}
function wdCardHtml(w, adminView) {
  const st = wdCanon(w.status);
  const labels = { pending: 'Pending', processing: 'Processing', completed: 'Completed', declined: 'Declined' };
  const pillCls = st === 'completed' ? 'good' : st === 'declined' ? 'bad' : 'info';
  const live = (st === 'pending' || st === 'processing') ? ' wd-live' : '';
  const dest = w.method === 'crypto' ? `<div><span>Asset / network</span><b>${escapeHtml(w.asset || '')}${w.network ? ' · ' + escapeHtml(w.network) : ''}</b></div><div><span>Wallet</span><b>${escapeHtml(adminView ? w.destination : maskTailClient(w.destination))}</b></div>`
    : `<div><span>Bank</span><b>${escapeHtml(w.bankName || '')}${w.bankCountry ? ', ' + escapeHtml(w.bankCountry) : ''}</b></div><div><span>Beneficiary</span><b>${escapeHtml(w.beneficiaryName || '')}</b></div><div><span>Account / IBAN</span><b>${escapeHtml(adminView ? (w.bankAccount || '') : maskTailClient(w.bankAccount))}</b></div>`;
  return `<div class="wd-card">
    <div class="wd-card-top"><div><div class="ttl"><i class="fa-solid ${w.method === 'crypto' ? 'fa-coins' : 'fa-building-columns'}"></i> ${w.method === 'crypto' ? 'Crypto withdrawal' : 'Bank withdrawal'}</div><div class="wd-ref">${escapeHtml(w.ref)}</div></div>
      <div style="text-align:right"><div class="amt">${fmtMoney(w.amount, w.amountCurrency)}</div><span class="lab-chip ${pillCls}${live}">${labels[st]}</span></div></div>
    ${wdTrackerHtml(w.status)}
    <div class="wd-grid"><div><span>Date created</span><b>${fmtDateTime(w.createdAt)}</b></div><div><span>Last update</span><b>${fmtDateTime(w.updatedAt)}</b></div>${dest}<div><span>Account ID</span><b translate="no">${escapeHtml(w.sellerAccountId || (sellerAccountState && sellerAccountState.accountId) || '—')}</b></div>${w.emailConfirmed ? '<div><span>Security</span><b>Email-code confirmed</b></div>' : ''}</div>
    ${w.statusReason && st !== 'pending' ? `<div class="wd-reason" style="${st === 'declined' ? '' : 'background:rgba(56,189,248,.08);color:var(--text-muted);'}">${escapeHtml(w.statusReason)}</div>` : ''}
    ${w.receiptUrl ? `<a class="incoming-receipt" href="${w.receiptUrl}" target="_blank" style="display:inline-flex;margin-top:8px;"><i class="fa-solid fa-file-invoice"></i> Download receipt</a>` : ''}
  </div>`;
}
function renderWithdrawalCards() {
  const box = el('txWithdrawalsOnlyBody'); if (!box) return;
  const list = [...sellerWithdrawals].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  box.innerHTML = list.length ? list.map(w => wdCardHtml(w, false)).join('') : '<p class="ledger-empty">No withdrawals yet.</p>';
}

// ====================================================================
// 6. Incoming payments: live blinking stage tracker (seller)
// ====================================================================
function trackerHtml(track) {
  if (!track || !track.stages) return '';
  const rows = track.stages.map((s, idx) => {
    const last = idx === track.stages.length - 1;
    const pill = s.status === 'passed' ? 'Passed' : s.status === 'in_review' ? 'In review' : 'Queued';
    const icon = s.status === 'passed' ? 'fa-check' : s.status === 'in_review' ? 'fa-spinner' : 'fa-clock';
    const checks = s.checks ? `<div class="trk-checks">${s.checks.map(c => `<div><i class="fa-solid ${c.state === 'done' ? 'fa-circle-check' : c.state === 'now' ? 'fa-circle-notch trk-now' : 'fa-circle'}" style="color:${c.state === 'done' ? 'var(--accent-emerald)' : c.state === 'now' ? 'var(--accent-cyan)' : 'var(--text-faint)'}"></i><span>${escapeHtml(c.text)}</span></div>`).join('')}</div>` : '';
    const bar = s.status === 'in_review' ? `<div class="trk-bar"><i style="width:${Math.round((s.progress || 0) * 100)}%"></i></div>` : '';
    const left = (s.status === 'in_review' && track.activeLeftSec !== undefined && !track.paused) ? `<div class="trk-left" translate="no" data-left="${track.activeLeftSec}" data-t0="${track._t0 || Date.now()}">${fmtLeft(track.activeLeftSec)}</div>` : '';
    return `<div class="trk-row trk-stage ${s.status}">
      <div class="trk-gut"><div class="trk-dot"><i class="fa-solid ${icon}"></i></div>${last ? '' : `<div class="trk-line ${s.status === 'passed' ? 'done' : ''}"></div>`}</div>
      <div class="trk-body"><span class="trk-pill">${pill}</span><div class="nm">${idx + 1}. ${escapeHtml(s.title)}</div><div class="tm">${escapeHtml(s.team)}</div>${checks}${bar}${left}</div></div>`;
  });
  return rows.join('');
}
setInterval(() => {
  document.querySelectorAll('[data-left]').forEach(n => {
    const base = Number(n.dataset.left), t0 = Number(n.dataset.t0);
    n.textContent = fmtLeft(base - (Date.now() - t0) / 1000);
  });
}, 1000);
function stampTrack(i) { if (i.track) i.track._t0 = Date.now(); return i; }
function renderIncomingSeller() {
  const a = sellerAccountState;
  const active = sellerIncoming.filter(i => i.track && !i.track.complete && i.status === 'held_in_vault');
  const panel = el('txLiveTrackPanel');
  if (panel) {
    panel.classList.toggle('hidden', !active.length);
    el('txLiveTrackList').innerHTML = active.map(i => `<div class="trk-card"><div class="trk-head"><div><div class="trk-title">${escapeHtml(i.payerName)}</div><div class="trk-sub">${escapeHtml(i.purpose)} · ${escapeHtml(i.ref)}</div></div><div class="trk-amount">+${fmtMoney(i.amount - (i.feeAmount || 0), i.amountCurrency)}</div></div>${trackerHtml(i.track)}</div>`).join('');
  }
  const box = el('txIncomingList'); if (!box) return;
  box.innerHTML = sellerIncoming.length ? sellerIncoming.map(i => {
    const tracking = i.track && !i.track.complete && i.status === 'held_in_vault';
    const iconCls = i.status === 'credited' ? '' : i.status === 'reversed' ? 'reversed' : 'held';
    const icon = i.status === 'credited' ? 'fa-arrow-down' : i.status === 'reversed' ? 'fa-rotate-left' : 'fa-lock';
    return `<div class="incoming-row" style="flex-wrap:wrap;">
      <div class="incoming-icon ${iconCls}"><i class="fa-solid ${icon}"></i></div>
      <div class="incoming-main">
        <div class="incoming-top-line"><span class="incoming-payer">${escapeHtml(i.payerName)}</span><span class="incoming-amount">+${fmtMoney(i.amount, i.amountCurrency)}</span></div>
        <div class="incoming-purpose">${escapeHtml(i.purpose)}</div>
        <div class="incoming-meta">${fmtDateTime(i.receivedAt)} · ${escapeHtml(i.ref)} · <span class="tx-status-badge ${statusPillClass(i.status)}" style="padding:2px 8px; font-size:0.62rem;">${escapeHtml(INCOMING_STATUS_LABEL[i.status] || i.status)}</span>${i.statusReason ? ` · ${escapeHtml(i.statusReason)}` : ''}</div>
        ${i.feeAmount > 0 ? `<div class="incoming-meta">Fee ${fmtMoney(i.feeAmount, i.amountCurrency)} · Net ${fmtMoney(i.amount - i.feeAmount, i.amountCurrency)}</div>` : ''}
        ${i.receiptUrl ? `<a class="incoming-receipt" href="${i.receiptUrl}" target="_blank"><i class="fa-solid fa-file-invoice"></i> Download receipt</a>` : ''}
        ${tracking ? `<div style="margin-top:12px;">${trackerHtml(i.track)}</div>` : ''}
      </div></div>`;
  }).join('') : '<p class="ledger-empty">No incoming payments recorded yet.</p>';
}
const _renderTxDWBase = renderTxDepositsAndWithdrawals;
renderTxDepositsAndWithdrawals = function () {
  sellerIncoming.forEach(i => { if (i.track && !i.track._t0) i.track._t0 = Date.now(); });
  _renderTxDWBase(); renderIncomingSeller(); renderWithdrawalCards();
};
socket.on('incoming-track-update', ({ groupId, id, status, track }) => {
  if (groupId !== activeGroupId) return;
  const rec = sellerIncoming.find(x => x.id === id);
  if (rec) { rec.track = stampTrack({ ...track }); rec.status = status || rec.status; renderTxDepositsAndWithdrawals(); }
});
socket.on('incoming-list', () => {}); // (app.js already handles; kept for clarity)

// ====================================================================
// 7. KYC: image sharpness check, live face capture, ID details
// ====================================================================
const kycQuality = {}; let kycFace = { detected: false, method: 'none' };
async function imageToCanvas(file, maxW = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const sc = Math.min(1, maxW / img.width); const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height); return c;
  } finally { URL.revokeObjectURL(url); }
}
function sharpness(canvas) {
  const { width: w, height: h } = canvas; const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; sum += l; sum2 += l * l; n++; }
  const mean = sum / n; return sum2 / n - mean * mean;
}
function analyzeFaceCanvas(c) {
  const { width: w, height: h } = c; const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let lum = 0, lum2 = 0, skin = 0, n = 0;
  const cx = w / 2, cy = h / 2, rx = w * .31, ry = h * .36;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
    const i = (y * w + x) * 4; const r = d[i], g = d[i + 1], b = d[i + 2];
    const L = .299 * r + .587 * g + .114 * b; lum += L; lum2 += L * L; n++;
    const Cb = 128 - .168736 * r - .331264 * g + .5 * b, Cr = 128 + .5 * r - .418688 * g - .081312 * b;
    if (Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173 && L > 35) skin++;
  }
  const mean = lum / n, sd = Math.sqrt(Math.max(0, lum2 / n - mean * mean));
  return { mean, sd, skinRatio: skin / n, tooDark: mean < 55 };
}
async function detectFace(canvas) {
  const stats = analyzeFaceCanvas(canvas);
  let detected = false, method = 'colour';
  if ('FaceDetector' in window) {
    try { const faces = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 }).detect(canvas); method = 'native'; detected = faces.length === 1 && (faces[0].boundingBox.width * faces[0].boundingBox.height) / (canvas.width * canvas.height) > 0.06; } catch (e) { method = 'colour'; }
  }
  if (method === 'colour') detected = stats.skinRatio >= 0.22 && stats.sd >= 14 && !stats.tooDark;
  return { detected, tooDark: stats.tooDark, method, skinRatio: Math.round(stats.skinRatio * 100) / 100 };
}

const _handleKycFileBase = handleTxKycFileChosen;
handleTxKycFileChosen = async function (inputEl, key) {
  const file = inputEl.files && inputEl.files[0];
  if (file && file.type.startsWith('image/')) {
    try {
      const c = await imageToCanvas(file);
      if (key === 'idFront' || key === 'idBack') kycQuality[key] = { blurry: sharpness(c) < 14, score: Math.round(sharpness(c)) };
      if (key === 'selfie') kycFace = await detectFace(c);
    } catch (e) { /* analysis is advisory only */ }
  }
  return _handleKycFileBase(inputEl, key);
};
// Selfie: open a live camera with an oval guide instead of the plain file picker.
document.addEventListener('click', (e) => {
  const zone = e.target.closest('#txKycSelfieZone');
  if (!zone) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return; // fall back to the file picker
  e.preventDefault(); openFaceCapture();
}, true);
let faceStream = null, faceTimer = null, faceStart = 0;
async function openFaceCapture() {
  openModal('faceModal'); const st = el('faceStatus'); st.textContent = 'Starting camera…'; el('faceShotBtn').disabled = true; el('faceOval').className = 'face-oval';
  try {
    faceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    const v = el('faceVideo'); v.srcObject = faceStream; await v.play();
    faceStart = Date.now();
    const probe = document.createElement('canvas');
    clearInterval(faceTimer);
    faceTimer = setInterval(async () => {
      if (!v.videoWidth) return;
      probe.width = 320; probe.height = Math.round(320 * v.videoHeight / v.videoWidth);
      probe.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, probe.width, probe.height);
      const r = await detectFace(probe); const waited = Date.now() - faceStart > 10000;
      const ok = r.detected || (waited && !r.tooDark);
      el('faceOval').className = 'face-oval ' + (r.detected ? 'ok' : 'bad');
      st.textContent = r.tooDark ? 'Too dark — move somewhere brighter' : r.detected ? 'Face detected — hold still' : waited ? 'Almost there — press Take photo when your face is in the oval' : 'Centre your face inside the oval';
      st.style.color = r.detected ? 'var(--accent-emerald)' : r.tooDark ? 'var(--accent-rose)' : '';
      el('faceShotBtn').disabled = !ok;
    }, 450);
  } catch (err) {
    closeFaceCapture(); toast('We could not open your camera. You can upload a clear selfie instead.', true); el('txKycSelfie').click();
  }
}
function closeFaceCapture() { clearInterval(faceTimer); if (faceStream) { faceStream.getTracks().forEach(t => t.stop()); faceStream = null; } closeModal('faceModal'); }
async function takeFaceShot() {
  const v = el('faceVideo'); const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0); // un-mirrored, as the camera sees it
  const small = document.createElement('canvas'); small.width = 320; small.height = Math.round(320 * c.height / c.width); small.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, small.width, small.height);
  const res = await detectFace(small);
  kycFace = { detected: res.detected || !res.tooDark, tooDark: res.tooDark, method: res.detected ? res.method : 'live-capture' };
  closeFaceCapture();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
  const zone = el('txKycSelfieZone'), preview = el('txKycSelfiePreview'), status = el('txWizStep4Status');
  preview.src = URL.createObjectURL(file); preview.classList.remove('hidden');
  status.textContent = 'Uploading...'; status.className = 'tx-wizard-status busy';
  const up = await uploadRawFile(file);
  if (up.ok) { txKycUploads.selfie = up.url; zone.classList.add('done'); zone.classList.remove('failed'); zone.querySelector('.tx-upload-title').textContent = 'Photo taken — tap to retake'; status.textContent = '✓ Uploaded'; status.className = 'tx-wizard-status ok'; }
  else { txKycUploads.selfie = null; zone.classList.add('failed'); status.textContent = '✗ ' + up.error; status.className = 'tx-wizard-status bad'; toast(up.error, true); }
}
const _renderKycWizBase = renderTxKycWizard;
renderTxKycWizard = function () {
  _renderKycWizBase();
  const last = txKycStep === (window._txWizTotalSteps || 6) - 1;
  let blk = el('kycIdDetails');
  if (!last) { if (blk) blk.style.display = 'none'; return; }
  if (!blk) {
    blk = document.createElement('div'); blk.id = 'kycIdDetails'; blk.className = 'create-group-form'; blk.style.marginBottom = '12px';
    blk.innerHTML = `<p class="reg-note" style="margin:0 0 6px;">Type the details exactly as printed on your ID. We check them against the document and your account.</p>
      <label class="branding-field">ID / document number<input type="text" id="kycIdNumber" class="message-input" autocomplete="off"></label>
      <label class="branding-field">Full name on the ID<input type="text" id="kycIdName" class="message-input" autocomplete="off"></label>
      <div class="two-col"><label class="branding-field">Date of birth<input type="date" id="kycIdDob" class="message-input"></label><label class="branding-field">Expiry date<input type="date" id="kycIdExpiry" class="message-input"></label></div>`;
    el('txWizSummary').parentNode.insertBefore(blk, el('txWizSummary'));
  }
  blk.style.display = 'flex'; blk.style.flexDirection = 'column';
  if (sellerAccountState) { if (!el('kycIdName').value) el('kycIdName').value = sellerAccountState.fullName || ''; if (!el('kycIdDob').value) el('kycIdDob').value = sellerAccountState.dateOfBirth || ''; }
};
txKycWizardNext = function () {
  const totalSteps = window._txWizTotalSteps || 6;
  if (txKycStep === totalSteps - 1) {
    const steps = txKycStepsForDocType();
    if (steps.filter(k => !txKycUploads[k]).length) return toast('Please upload every document before submitting.', true);
    const idNumber = el('kycIdNumber').value.trim(), idName = el('kycIdName').value.trim(), idDob = el('kycIdDob').value, idExpiry = el('kycIdExpiry').value;
    if (!idNumber) return toast('Please enter the ID number.', true);
    if (!idName) return toast('Please enter the name exactly as on the ID.', true);
    if (!idDob) return toast('Please enter the date of birth on the ID.', true);
    if (!idExpiry) return toast('Please enter the ID expiry date.', true);
    socket.emit('submit-kyc', {
      groupId: activeGroupId, docType: el('txKycDocType').value, idFrontUrl: txKycUploads.idFront, idBackUrl: txKycUploads.idBack,
      proofAddressType: el('txKycProofAddressType').value, proofAddressUrl: txKycUploads.proofAddress, selfieUrl: txKycUploads.selfie,
      idNumber, idName, idDob, idExpiry, quality: kycQuality, face: kycFace
    });
    closeModal('txKycWizardModal'); toast('Checking your documents…');
    return;
  }
  const key = currentWizStepKey();
  if (key && !txKycUploads[key]) return toast('Please upload this document before continuing.', true);
  txKycStep++; renderTxKycWizard();
};
socket.on('kyc-auto-result', (r) => {
  const ic = el('kycResIcon'), ul = el('kycResReasons');
  if (r.passed) {
    ic.className = 'next-badge'; ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    el('kycResTitle').textContent = r.autoApproved ? 'Identity verified' : 'Documents accepted';
    el('kycResText').textContent = r.autoApproved ? 'You can now request withdrawals.' : 'Everything is clear and matches. Your documents are now with the Desk for final review — we will notify you as soon as it is done.';
    ul.className = 'kyc-reasons ok'; ul.innerHTML = (r.checks || []).filter(c => c.ok).slice(0, 6).map(c => `<li>${escapeHtml(c.label)}</li>`).join('');
    el('kycResActions').innerHTML = '<button class="send-btn" onclick="closeModal(\'kycResultModal\')">Done</button>';
  } else {
    ic.className = 'next-badge bad'; ic.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    el('kycResTitle').textContent = 'We could not accept these documents';
    el('kycResText').textContent = 'Please fix the following and submit again:';
    ul.className = 'kyc-reasons'; ul.innerHTML = (r.reasons || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    el('kycResActions').innerHTML = '<button class="send-btn" onclick="closeModal(\'kycResultModal\'); openTxKycWizard()"><i class="fa-solid fa-rotate"></i> Try again</button><button class="ghost-btn" onclick="closeModal(\'kycResultModal\')">Close</button>';
  }
  openModal('kycResultModal');
});

// ====================================================================
// 8. Business upgrade form (seller)
// ====================================================================
const bizDocs = { cert: null, tax: null, addr: null };
function openBusinessModal() {
  const a = sellerAccountState; if (!a) return;
  if (a.kyc.status !== 'verified') return toast('Please complete your personal identity verification first.', true);
  if (a.business && a.business.status === 'pending') return toast('Your Business application is already under review.');
  if (a.accountType === 'business') return toast('Your account is already a Business account.');
  Object.keys(bizDocs).forEach(k => { bizDocs[k] = null; const st = el('biz' + k.charAt(0).toUpperCase() + k.slice(1) + 'State'); if (st) { st.textContent = 'Tap to upload'; st.parentNode.classList.remove('done'); } });
  el('bizDecl').checked = false; openModal('businessModal');
}
async function bizUpload(inp, key) {
  const f = inp.files[0]; if (!f) return; const st = el('biz' + key.charAt(0).toUpperCase() + key.slice(1) + 'State'); st.textContent = 'Uploading…';
  const r = await uploadRawFile(f);
  if (r.ok) { bizDocs[key] = r.url; st.textContent = '✓ ' + f.name.slice(0, 22); st.parentNode.classList.add('done'); }
  else { bizDocs[key] = null; st.textContent = '✗ ' + r.error; toast(r.error, true); }
  inp.value = '';
}
function submitBusinessUpgrade() {
  const v = (id) => el(id).value.trim();
  const p = {
    groupId: activeGroupId, companyName: v('bizName'), legalForm: v('bizForm'), registrationNumber: v('bizRegNo'), registrationCountry: pickState.biz ? pickState.biz.name : '',
    incorporationDate: v('bizIncDate'), taxId: v('bizTax'), vatNumber: v('bizVat'), businessAddress: v('bizAddr'), city: v('bizCity'), postalCode: v('bizPost'),
    businessType: v('bizType'), website: v('bizWeb'), businessPhone: v('bizPhone'), directorName: v('bizDir'), directorRole: v('bizDirRole'), uboName: v('bizUbo'),
    monthlyVolume: v('bizVol'), sourceOfFunds: v('bizSof'), declaration: el('bizDecl').checked, certUrl: bizDocs.cert, taxDocUrl: bizDocs.tax, addressDocUrl: bizDocs.addr
  };
  el('bizSubmit').disabled = true; setTimeout(() => { el('bizSubmit').disabled = false; }, 3000);
  socket.emit('submit-business-upgrade', p);
}
socket.on('business-submitted-ok', ({ companyName }) => { closeModal('businessModal'); toast(`Application received for ${companyName}. We will email you the decision.`); });

// ====================================================================
// 9. Seller sign-in + password recovery
// ====================================================================
let loginResetToken = null;
function loginStep(which) {
  ['Signin', 'Forgot', 'Code', 'New'].forEach(s => el('loginStep' + s).classList.toggle('hidden', s !== which));
  el('loginTitle').textContent = which === 'Signin' ? 'Seller sign in' : 'Reset your password';
  el('loginMsg').textContent = '';
}
function openLoginModal() { loginStep('Signin'); openModal('loginModal'); setTimeout(() => el('loginEmail').focus(), 80); }
function showForgot() { el('forgotEmail').value = el('loginEmail').value; loginStep('Forgot'); }
function showSignin() { loginStep('Signin'); }
function loginMsg(t, bad = true) { const m = el('loginMsg'); m.textContent = t; m.style.color = bad ? 'var(--accent-rose)' : 'var(--accent-emerald)'; }
async function postJson(url, body) {
  try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); let d = {}; try { d = await r.json(); } catch (e) { /* non-JSON */ } return { ok: r.ok, status: r.status, data: d }; }
  catch (e) { return { ok: false, status: 0, data: { error: 'Network error — please check your connection.' } }; }
}
async function doLogin() {
  const email = el('loginEmail').value.trim(), password = el('loginPassword').value;
  if (!isValidEmailClient(email) || !password) return loginMsg('Enter your email and password.');
  const r = await postJson('/api/auth/login', { email, password });
  if (!r.ok) return loginMsg(r.data.error || 'Sign in failed.');
  sessionStorage.setItem('q_session_token', r.data.sessionToken);
  if (r.data.language) localStorage.setItem('q_lang', r.data.language);
  location.href = `/?groupId=${encodeURIComponent(r.data.groupId)}&role=SELLER`;
}
async function forgotRequest(resend) {
  const email = (resend ? el('forgotEmail').value : el('forgotEmail').value).trim();
  if (!isValidEmailClient(email)) return loginMsg('Enter the email on your account.');
  const r = await postJson('/api/auth/forgot-password/request', { email });
  if (!r.ok) return loginMsg(r.data.error || 'Could not send the code. Please try again shortly.');
  el('forgotCodeSub').textContent = `If an account exists for ${email}, a 6-digit code is on its way. It expires in 10 minutes.`;
  loginStep('Code'); loginMsg(resend ? 'A new code was sent.' : '', false); setTimeout(() => el('forgotCode').focus(), 80);
}
async function forgotVerify() {
  const email = el('forgotEmail').value.trim(), code = el('forgotCode').value.trim();
  if (!/^\d{6}$/.test(code)) return loginMsg('Enter the 6-digit code.');
  const r = await postJson('/api/auth/forgot-password/verify', { email, code });
  if (!r.ok) return loginMsg(r.data.error || 'That code is not valid.');
  loginResetToken = r.data.resetToken; loginStep('New');
}
async function forgotReset() {
  const email = el('forgotEmail').value.trim(), p1 = el('forgotNewPw').value, p2 = el('forgotNewPw2').value;
  if (p1.length < 8) return loginMsg('Password must be at least 8 characters.');
  if (p1 !== p2) return loginMsg('Passwords do not match.');
  const r = await postJson('/api/auth/forgot-password/reset', { email, resetToken: loginResetToken, newPassword: p1 });
  if (!r.ok) return loginMsg(r.data.error || 'Could not reset the password.');
  loginResetToken = null; el('loginEmail').value = email; el('loginPassword').value = ''; loginStep('Signin'); loginMsg('Password updated. You can sign in now.', false);
}

// ====================================================================
// 10. Admin: Funds Desk list with flags, Account IDs, access state
// ====================================================================
renderFundsDesk = function () {
  const box = el('fundsDeskList'); if (!box) return;
  if (!fundsOverviewCache.length) { box.innerHTML = '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No groups yet.</p>'; return; }
  const sorted = [...fundsOverviewCache].sort((a, b) => (b.registered - a.registered) || String(a.sellerName).localeCompare(String(b.sellerName)));
  box.innerHTML = sorted.map(s => {
    if (!s.registered) {
      return `<div class="funds-desk-row unregistered"><div class="funds-desk-avatar">${escapeHtml(initialsOfName(s.sellerName))}</div>
        <div class="funds-desk-info"><div class="funds-desk-name">${escapeHtml(s.sellerName)}</div><div class="funds-desk-sub">${escapeHtml(s.groupName)} · Awaiting Transaction Account registration</div></div></div>`;
    }
    const notes = [];
    if (s.activeWithdrawals) notes.push(`${s.activeWithdrawals} withdrawal${s.activeWithdrawals > 1 ? 's' : ''} in progress`);
    if (s.heldIncoming) notes.push(`${s.heldIncoming} held`);
    const chips = [
      s.disabled ? '<span class="lab-chip bad">Disabled</span>' : '',
      s.disbursementEnabled ? '<span class="lab-chip good">Disbursement</span>' : '<span class="lab-chip warn">Awaiting</span>',
      s.accountType === 'business' ? '<span class="lab-chip info">Business</span>' : '',
      s.businessStatus === 'pending' ? '<span class="lab-chip warn">Biz review</span>' : ''
    ].join(' ');
    return `<div class="funds-desk-row" onclick="openFundsDeskModal('${s.groupId}')">
      <div class="funds-desk-avatar">${escapeHtml(initialsOfName(s.sellerName))}</div>
      <div class="funds-desk-info">
        <div class="funds-desk-name">${escapeHtml(s.sellerName)} ${s.countryIso ? `<span class="flag-inline" title="${escapeHtml(s.country || '')}">${flagHtml(s.countryIso, s.country)}</span>` : ''}</div>
        <div class="funds-desk-sub"><span translate="no">ID ${escapeHtml(s.accountId || '—')}</span> · ${escapeHtml(s.groupName)} · ${escapeHtml(s.currency || '')} · KYC: ${escapeHtml((s.kycStatus || '').replace(/_/g, ' '))}</div>
        <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${chips}</div>
      </div>
      <div class="funds-desk-balances">
        <div class="funds-desk-avail">${fmtMoney(s.balances.available, s.currency)}</div>
        ${s.balances.pending ? `<div class="funds-desk-held-note">${fmtMoney(s.balances.pending, s.currency)} pending</div>` : ''}
        ${notes.length ? `<div class="funds-desk-held-note">${escapeHtml(notes.join(' · '))}</div>` : ''}
      </div>
      <i class="fa-solid fa-chevron-right funds-desk-chevron"></i></div>`;
  }).join('');
};

// ---- Funds desk modal: identity bar, elite incoming rows with tracker, 4-stage withdrawals ----
function ledgerAdminBarHtml(a) {
  const dis = !!a.disabled;
  return `<div class="lab-id">
      <div style="font-size:1.5rem">${a.countryIso ? flagHtml(a.countryIso, a.country) : ''}</div>
      <div style="flex:1;min-width:0;"><div class="nm">${escapeHtml(a.fullName || 'Seller')}</div>
        <div class="meta"><span translate="no" style="cursor:pointer" onclick="navigator.clipboard&&navigator.clipboard.writeText('${escapeHtml(a.accountId || '')}');toast('Account ID copied.')" title="Copy">ID <b>${escapeHtml(a.accountId || '—')}</b></span> · ${escapeHtml(a.country || 'Country not set')} · ${escapeHtml(a.phone || 'No phone')}</div></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
        <span class="lab-chip ${dis ? 'bad' : 'good'}">${dis ? 'Disabled' : 'Active'}</span>
        <span class="lab-chip info">${escapeHtml(a.accountTypeLabel || 'Standard account')}</span>
        <span class="lab-chip ${a.kyc.status === 'verified' ? 'good' : a.kyc.status === 'rejected' ? 'bad' : 'warn'}">KYC ${escapeHtml(a.kyc.status.replace(/_/g, ' '))}</span>
        <span class="lab-chip ${a.cryptoDepositVerified ? 'good' : ''}">Crypto ${a.cryptoDepositVerified ? 'unlocked' : 'locked'}</span>
      </div></div>
    <div class="lab-actions">
      <button class="admin-btn" onclick="openSellerProfile('${a.groupId}')"><i class="fa-solid fa-id-badge"></i> Profile &amp; IPs</button>
      <button class="admin-btn ${dis ? '' : 'admin-btn-danger'}" onclick="adminToggleSellerDisabled('${a.groupId}', ${!dis})"><i class="fa-solid ${dis ? 'fa-user-check' : 'fa-user-slash'}"></i> ${dis ? 'Enable account' : 'Disable account'}</button>
      <button class="admin-btn" onclick="adminToggleDisbursement('${a.groupId}', ${!a.disbursementEnabled})"><i class="fa-solid fa-hand-holding-dollar"></i> ${a.disbursementEnabled ? 'Pause disbursement' : 'Enable disbursement'}</button>
      <button class="admin-btn" onclick="socket.emit('admin-set-crypto-verified',{groupId:'${a.groupId}',verified:${!a.cryptoDepositVerified}})"><i class="fa-solid fa-coins"></i> ${a.cryptoDepositVerified ? 'Re-lock crypto' : 'Unlock crypto'}</button>
      <button class="admin-btn" onclick="socket.emit('admin-send-password-reset',{groupId:'${a.groupId}'})"><i class="fa-solid fa-key"></i> Send password reset</button>
    </div>
    <p class="reg-note" style="margin:8px 0 0;">${a.disbursementEnabled ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-emerald)"></i> Disbursement is ON — the seller can withdraw available funds.' : '<i class="fa-solid fa-hourglass-half" style="color:var(--accent-amber)"></i> Disbursement is OFF — withdrawals are blocked until you enable it for this group.'}</p>`;
}
function adminToggleSellerDisabled(groupId, disable) {
  if (disable) showPromptModal({ title: 'Disable seller account', message: 'The seller is notified immediately, with the complaints email. Add a short reason (shown to them).', placeholder: 'Reason' }, (reason) => socket.emit('admin-set-seller-disabled', { groupId, disabled: true, reason }));
  else showConfirmModal({ title: 'Enable seller account', message: 'The seller will be notified that their account is active again.' }, () => socket.emit('admin-set-seller-disabled', { groupId, disabled: false }));
}
function adminToggleDisbursement(groupId, enabled) { socket.emit('admin-set-disbursement', { groupId, enabled }); }

function adminTrackerHtml(i) {
  const t = i.track; if (!t) return '';
  const chips = t.stages.map(s => `<span class="lab-chip ${s.status === 'passed' ? 'good' : s.status === 'in_review' ? 'info' : ''}" style="${s.status === 'in_review' ? 'animation:trkBlink 1.1s infinite' : ''}">${s.n}. ${escapeHtml(s.title.replace('Funds in seller’s vault account', 'Vault'))}</span>`).join(' ');
  const live = !t.complete && i.status === 'held_in_vault';
  const cur = t.stages.find(s => s.status === 'in_review');
  return `<div class="rf-track" style="margin-top:10px;">
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">${chips}</div>
    ${live ? `<div class="reg-note" style="margin:0 0 6px;">${t.mode === 'auto' ? (t.paused ? '⏸ Paused' : '▶ Automatic') : '✋ Manual'} · speed ${t.speed}x · ${cur ? escapeHtml(cur.title) + ' in review' : ''} · <span translate="no">${fmtLeft(t.totalLeftSec)}</span> total left · seller timer ${t.showTimer ? 'visible' : 'hidden'}</div>
    <div class="trk-admin-actions">
      ${t.mode === 'manual' ? `<button class="admin-btn" onclick="socket.emit('admin-tracking-confirm',{id:'${i.id}'})"><i class="fa-solid fa-check"></i> Confirm next</button>` : `<button class="admin-btn" onclick="socket.emit('admin-tracking-set',{id:'${i.id}',paused:${!t.paused}})"><i class="fa-solid ${t.paused ? 'fa-play' : 'fa-pause'}"></i> ${t.paused ? 'Resume' : 'Pause'}</button>`}
      <button class="admin-btn" onclick="socket.emit('admin-tracking-skip',{id:'${i.id}'})"><i class="fa-solid fa-forward-step"></i> Skip stage</button>
      <button class="admin-btn" onclick="openTrackerModal('${i.id}')"><i class="fa-solid fa-sliders"></i> Timers &amp; speed</button>
    </div>` : `<div class="reg-note" style="margin:0;">${t.complete ? '✓ Tracking complete — funds released to the seller.' : ''}</div>`}
  </div>`;
}
function incomingAdminRowHtml(i) {
  const net = i.amount - (i.feeAmount || 0);
  return `<div class="ledger-row"><div class="ledger-row-top">
    <div class="ledger-row-direction in"><i class="fa-solid fa-arrow-down"></i></div>
    <div class="ledger-row-main">
      <div class="ledger-row-title-line"><span class="ledger-row-title">${escapeHtml(i.payerName)}${i.payerCountry ? ` · ${escapeHtml(i.payerCountry)}` : ''}</span><span class="ledger-row-amount in">+${fmtMoney(i.amount, i.amountCurrency)}</span></div>
      <div class="ledger-row-sub">${escapeHtml(i.purpose)}</div>
      <div class="ledger-row-sub">${escapeHtml(METHOD_LABEL[i.method] || i.method)}${i.asset ? ` · ${escapeHtml(i.asset)}${i.network ? ' ' + escapeHtml(i.network) : ''}` : ''}${i.bankName ? ` · ${escapeHtml(i.bankName)}` : ''}${i.senderAccount ? ` · ${escapeHtml(maskTailClient(i.senderAccount))}` : ''} · ${fmtDateTime(i.receivedAt)}</div>
      <div class="ledger-row-sub"><span class="tx-status-badge ${i.status === 'credited' ? 'enabled' : i.status === 'reversed' ? 'disabled' : ''}" style="padding:2px 8px; font-size:0.64rem;">${escapeHtml(INCOMING_STATUS_LABEL[i.status] || i.status)}</span>${i.feeAmount > 0 ? ` · Fee ${fmtMoney(i.feeAmount, i.amountCurrency)} · Net ${fmtMoney(net, i.amountCurrency)}` : ''}${i.amountCurrency !== (fundsDeskLedgerCache.account.currency) ? ` · ≈ ${fmtMoney(i.amountLedger, fundsDeskLedgerCache.account.currency)} @ ${Number(i.fxRate).toFixed(4)}` : ''}</div>
      <div class="ledger-row-ref">${escapeHtml(i.ref)}${i.externalRef ? ` · Ref: ${escapeHtml(i.externalRef)}` : ''}${i.payerEmail ? ` · ${escapeHtml(i.payerEmail)}` : ''}</div>
      ${i.internalNote ? `<div class="ledger-row-note"><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(i.internalNote)} <span class="lab-chip ${i.noteSharedWithBuyer ? 'warn' : ''}" style="margin-left:6px;">${i.noteSharedWithBuyer ? 'Visible to buyer' : 'Admin only'}</span></div>` : ''}
      ${i.proofUrl ? `<a href="${i.proofUrl}" target="_blank" class="incoming-receipt"><i class="fa-solid fa-paperclip"></i> Proof</a>` : ''}
      ${i.receiptUrl ? `<a href="${i.receiptUrl}" target="_blank" class="incoming-receipt" style="margin-left:8px;"><i class="fa-solid fa-file-invoice"></i> Receipt</a>` : ''}
      ${adminTrackerHtml(i)}
      <div class="ledger-row-actions">${incomingRowActionsHtml(i)}</div>
    </div></div></div>`;
}
// The 4 stages an admin can choose for ANY withdrawal.
function withdrawalRowActionsHtml(w) {
  const cur = wdCanon(w.status);
  const opts = [['pending', 'Pending', false], ['processing', 'Processing', false], ['completed', 'Completed', false], ['declined', 'Declined', true]].filter(([k]) => k !== cur);
  const terminal = ['completed', 'declined'].includes(cur);
  return opts.map(([k, label, needsReason]) => `<button class="admin-btn ${k === 'declined' ? 'admin-btn-danger' : ''}" onclick="adminAdvanceWithdrawal('${w.id}','${k}',${needsReason || terminal})">${k === 'completed' ? '<i class="fa-solid fa-check"></i> ' : ''}${label}</button>`).join('');
}
function adminAdvanceWithdrawal(withdrawalId, toStatus, needsReason) {
  if (needsReason) showPromptModal({ title: toStatus === 'declined' ? 'Decline withdrawal' : 'Change withdrawal status', message: 'The seller sees this reason.', placeholder: 'Reason' }, (reason) => socket.emit('admin-advance-withdrawal', { withdrawalId, toStatus, reason }));
  else socket.emit('admin-advance-withdrawal', { withdrawalId, toStatus });
}
const _renderFundsDeskModalBase = renderFundsDeskModal;
renderFundsDeskModal = function () {
  const ledger = fundsDeskLedgerCache; if (!ledger) return;
  _renderFundsDeskModalBase();
  const a = ledger.account, ccy = a.currency || '';
  el('ledgerModalTitle').innerHTML = `${a.countryIso ? flagHtml(a.countryIso, a.country) + ' ' : ''}${escapeHtml(a.fullName || 'Seller')} — ${escapeHtml(a.groupName)}`;
  el('ledgerAdminBar').innerHTML = ledgerAdminBarHtml(a);
  if (el('ledgerPending')) el('ledgerPending').textContent = fmtMoney(a.balances.pending || 0, ccy);
  el('ledgerIncomingList').innerHTML = ledger.incoming.length ? ledger.incoming.map(incomingAdminRowHtml).join('') : '<p class="ledger-empty">No incoming funds recorded yet.</p>';
  el('ledgerWithdrawalsList').innerHTML = ledger.withdrawals.length ? ledger.withdrawals.map(w => `
    <div class="ledger-row"><div class="ledger-row-top"><div class="ledger-row-direction out"><i class="fa-solid fa-arrow-up"></i></div><div class="ledger-row-main">
      ${wdCardHtml(w, true).replace('class="wd-card"', 'class="wd-card" style="margin:0"')}
      ${w.requestIp ? `<div class="ledger-row-ref">Requested from IP <span translate="no">${escapeHtml(w.requestIp)}</span></div>` : ''}
      <div class="ledger-row-actions">${withdrawalRowActionsHtml(w)}</div></div></div></div>`).join('') : '<p class="ledger-empty">No withdrawals yet.</p>';
};
socket.on('incoming-track-update-admin', ({ groupId, id, status, track }) => {
  if (groupId !== fundsDeskGroupId || !fundsDeskLedgerCache) return;
  const rec = fundsDeskLedgerCache.incoming.find(x => x.id === id);
  if (rec) { rec.track = track; rec.status = status || rec.status; renderFundsDeskModal(); if (!el('trackerModal').classList.contains('hidden') && trackerModalId === id) renderTrackerModal(); }
});

// ---- Tracker settings modal (per-stage timers by days/hours/minutes/seconds, mode, speed) ----
let trackerModalId = null; const TRK_WEIGHTS = [10, 25, 35, 10, 20];
function openTrackerModal(id) { trackerModalId = id; renderTrackerModal(); openModal('trackerModal'); }
function dhms(sec) { sec = Math.max(0, Math.floor(sec)); return { d: Math.floor(sec / 86400), h: Math.floor(sec % 86400 / 3600), m: Math.floor(sec % 3600 / 60), s: sec % 60 }; }
function renderTrackerModal() {
  const i = fundsDeskLedgerCache && fundsDeskLedgerCache.incoming.find(x => x.id === trackerModalId); if (!i || !i.track) return;
  const t = i.track; el('trkRef').textContent = i.ref;
  const rows = t.stages.map((s, idx) => { const p = dhms(t.timers[idx]); return `<div class="sp-sec" style="margin:10px 0 4px;padding-top:6px;">${s.n}. ${escapeHtml(s.title)} <span class="lab-chip ${s.status === 'passed' ? 'good' : s.status === 'in_review' ? 'info' : ''}">${s.status.replace('_', ' ')}</span></div>
    <div class="dur-row">${['d', 'h', 'm', 's'].map((k, j) => `<label>${['Days', 'Hours', 'Minutes', 'Seconds'][j]}<input type="number" min="0" value="${p[k]}" data-stage="${idx}" data-unit="${k}"></label>`).join('')}</div>`; }).join('');
  el('trkBody').innerHTML = `
    <div class="two-col"><label class="branding-field">Mode<select id="trkMode" class="message-input"><option value="auto" ${t.mode === 'auto' ? 'selected' : ''}>Automatic (timers)</option><option value="manual" ${t.mode === 'manual' ? 'selected' : ''}>Manual (I confirm)</option></select></label>
      <label class="branding-field">Speed up time<select id="trkSpeed" class="message-input">${[1, 10, 60, 600, 3600, 86400].map(v => `<option value="${v}" ${Number(t.speed) === v ? 'selected' : ''}>${v}x${v === 1 ? ' (real time)' : ''}</option>`).join('')}</select></label></div>
    <div class="branding-field"><span>Quick total</span><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${[[21600, '6 hours'], [86400, '1 day'], [172800, '2 days'], [604800, '7 days']].map(([s, l]) => `<button class="admin-btn" onclick="trackerQuickTotal(${s})">${l}</button>`).join('')}</div>
      <span class="reg-note">A quick total is split across the five stages automatically (10 / 25 / 35 / 10 / 20 %).</span></div>
    ${rows}
    <label class="terms-check"><input type="checkbox" id="trkShow" ${t.showTimer ? 'checked' : ''}> <span>Show the seller a rough time left for the active stage (never queued stages)</span></label>
    <div class="reg-actions"><button class="ghost-btn" onclick="closeModal('trackerModal')">Close</button><button class="send-btn" onclick="saveTrackerModal()"><i class="fa-solid fa-floppy-disk"></i> Save</button></div>`;
}
function trackerQuickTotal(sec) { socket.emit('admin-tracking-set', { id: trackerModalId, totalSeconds: sec }); toast('Timers updated.'); }
function saveTrackerModal() {
  const timers = [0, 0, 0, 0, 0]; const mult = { d: 86400, h: 3600, m: 60, s: 1 };
  document.querySelectorAll('#trkBody [data-stage]').forEach(inp => { timers[+inp.dataset.stage] += (parseInt(inp.value, 10) || 0) * mult[inp.dataset.unit]; });
  if (timers.some(v => v < 2)) return toast('Each stage needs at least 2 seconds.', true);
  socket.emit('admin-tracking-set', { id: trackerModalId, timers, mode: el('trkMode').value, speed: Number(el('trkSpeed').value), showTimer: el('trkShow').checked });
  toast('Tracker saved.');
}

// ---- Withdrawal queue (4 stages) ----
renderWithdrawalsQueue = function () {
  const box = el('withdrawalsQueueList'); if (!box) return;
  const live = withdrawalsQueueCache.filter(w => !['completed', 'declined', 'rejected', 'failed'].includes(w.status));
  box.innerHTML = live.length ? live.map(w => `
    <div class="invite-link-row" style="flex-wrap:wrap;"><div style="flex:1;min-width:0;">
      <div style="font-weight:800;font-size:0.78rem;">${escapeHtml(w.ref)} — ${fmtMoney(w.amount, w.amountCurrency)} · ${w.method === 'crypto' ? escapeHtml(w.asset || 'Crypto') : 'Bank'} <span class="lab-chip info">${wdCanon(w.status)}</span></div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Group ${escapeHtml(w.groupId)} · Account <span translate="no">${escapeHtml(w.sellerAccountId || '—')}</span>${w.requestIp ? ` · IP <span translate="no">${escapeHtml(w.requestIp)}</span>` : ''} · ${fmtDateTime(w.createdAt)}</div>
    </div><div class="ledger-row-actions">${withdrawalRowActionsHtml(w)}</div></div>`).join('')
    : '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No withdrawals in progress.</p>';
  updateAccountsTabBadge();
};

// ---- Seller profile (everything saved at registration + IP controls) ----
function openSellerProfile(groupId) { el('spBody').innerHTML = '<p class="ledger-empty">Loading…</p>'; openModal('sellerProfileModal'); socket.emit('admin-get-seller-profile', { groupId }); }
socket.on('seller-profile', ({ groupId, account: a, viewer }) => {
  viewer = viewer || {};
  if (el('sellerProfileModal').classList.contains('hidden')) return;
  const row = (k, v) => `<div><span>${k}</span><b>${v === null || v === undefined || v === '' ? '—' : v}</b></div>`;
  const auto = a.kyc.autoResult;
  const ips = (a.ips || []).slice().sort((x, y) => new Date(y.lastSeen) - new Date(x.lastSeen));
  el('spTitle').textContent = a.fullName || 'Seller profile';
  el('spBody').innerHTML = `
    <div class="lab-id"><div style="font-size:1.6rem">${a.countryIso ? flagHtml(a.countryIso, a.country) : ''}</div><div style="flex:1"><div class="nm">${escapeHtml(a.fullName || '—')}</div><div class="meta"><span translate="no">Account ID <b>${escapeHtml(a.accountId || '—')}</b></span> · ${escapeHtml(a.accountTypeLabel)}</div></div><span class="lab-chip ${a.disabled ? 'bad' : 'good'}">${a.disabled ? 'Disabled' : 'Active'}</span></div>
    <div class="sp-grid">
      ${row('Email (locked)', escapeHtml(a.email || ''))}${row('Email verified', a.emailVerified ? 'Yes' : 'No')}
      ${row('Phone', escapeHtml(a.phone || ''))}${row('Date of birth', a.dateOfBirth ? fmtDate(a.dateOfBirth) : '')}
      ${row('Country', a.country ? `<span class="flag-inline">${flagHtml(a.countryIso, a.country)} ${escapeHtml(a.country)}</span>` : '')}${row('Account currency', escapeHtml(a.currency || ''))}
      ${row('Language', escapeHtml((QL.findLanguage(a.language) || {}).name || a.language))}${row('Registered', fmtDateTime(a.registeredAt))}
      ${row('Terms accepted', a.termsAcceptedAt ? `${fmtDateTime(a.termsAcceptedAt)} (v${escapeHtml(a.termsVersion || '')})` : '')}
      <div style="grid-column:1/-1"><span>Password</span><b id="spPwBox">${!a.passwordSet ? 'Not set' : !a.passwordStored ? '●●●●●●●● <em style="font-weight:400;color:var(--text-faint)">set before password viewing existed — send a reset to capture it</em>' : viewer.canViewPassword ? `<span id="spPwText" translate="no">●●●●●●●●</span> <button class="admin-btn" id="spPwBtn" onclick="revealSellerPassword('${a.groupId}')"><i class="fa-solid fa-eye"></i> Reveal</button>` : '●●●●●●●● <em style="font-weight:400;color:var(--text-faint)">restricted — only the company or the assigned admin can view</em>'}</b>
        ${viewer.isSuperAdmin ? `<label class="terms-check" style="margin-top:6px"><input type="checkbox" ${a.passwordAdminAccess ? 'checked' : ''} onchange="socket.emit('admin-set-password-access',{groupId:'${a.groupId}',allowed:this.checked})"> <span>The assigned admin may also view this seller's password</span></label>` : ''}
        ${(a.passwordReveals || []).length ? `<div class="reg-note">Viewed ${a.passwordReveals.length} time${a.passwordReveals.length > 1 ? 's' : ''} — last: ${fmtDateTime(a.passwordReveals[a.passwordReveals.length - 1].at)} (${escapeHtml(String(a.passwordReveals[a.passwordReveals.length - 1].role).replace('_', ' ').toLowerCase())})</div>` : ''}</div>
      ${row('Password last changed', fmtDateTime(a.passwordChangedAt))}
      ${row('Failed sign-ins', a.failedLogins)}${row('Locked until', a.lockedUntil ? fmtDateTime(a.lockedUntil) : '')}
      ${row('Balances', `${fmtMoney(a.balances.available, a.currency)} available · ${fmtMoney(a.balances.held, a.currency)} vault · ${fmtMoney(a.balances.pending || 0, a.currency)} pending`)}
    </div>
    <div class="sp-sec">Identity (KYC)</div>
    <div class="sp-grid">${row('Status', escapeHtml(a.kyc.status.replace(/_/g, ' ')))}${row('Document', escapeHtml((a.kyc.docType || '').replace(/_/g, ' ')))}${row('ID number', escapeHtml(a.kyc.idNumber || ''))}${row('Name on ID', escapeHtml(a.kyc.idName || ''))}${row('ID date of birth', a.kyc.idDob ? fmtDate(a.kyc.idDob) : '')}${row('ID expiry', a.kyc.idExpiry ? fmtDate(a.kyc.idExpiry) : '')}</div>
    ${a.kyc.idFrontUrl ? `<p style="margin:8px 0 0;font-size:.78rem;">${[['idFrontUrl', 'ID front'], ['idBackUrl', 'ID back'], ['proofAddressUrl', 'Proof of address'], ['selfieUrl', 'Selfie']].filter(([k]) => a.kyc[k]).map(([k, l]) => `<a href="${a.kyc[k]}" target="_blank" style="color:var(--accent-cyan);margin-right:12px;">${l}</a>`).join('')}</p>` : ''}
    ${auto ? `<ul class="kyc-reasons ${auto.passed ? 'ok' : ''}" style="margin-top:8px;">${(auto.checks || []).map(c => `<li style="${c.ok ? '' : ''}">${escapeHtml(c.label)}: ${c.ok ? 'passed' : 'FAILED'}</li>`).join('')}</ul>` : ''}
    ${a.business && a.business.profile ? `<div class="sp-sec">Business application · ${escapeHtml(a.business.status)}</div><div class="sp-grid">${Object.entries({ 'Company': 'companyName', 'Legal form': 'legalForm', 'Registration no.': 'registrationNumber', 'Registered in': 'registrationCountry', 'Incorporated': 'incorporationDate', 'Tax ID': 'taxId', 'VAT': 'vatNumber', 'Address': 'businessAddress', 'City': 'city', 'Postal code': 'postalCode', 'Business': 'businessType', 'Website': 'website', 'Phone': 'businessPhone', 'Director': 'directorName', 'Role': 'directorRole', 'UBO': 'uboName', 'Monthly volume': 'monthlyVolume', 'Source of funds': 'sourceOfFunds' }).map(([l, k]) => row(l, escapeHtml(a.business.profile[k] || ''))).join('')}</div><p style="margin:8px 0 0;font-size:.78rem;">${[['certUrl', 'Certificate'], ['taxDocUrl', 'Tax document'], ['addressDocUrl', 'Address proof']].filter(([k]) => a.business.profile[k]).map(([k, l]) => `<a href="${a.business.profile[k]}" target="_blank" style="color:var(--accent-cyan);margin-right:12px;">${l}</a>`).join('')}</p>` : ''}
    <div class="sp-sec">IP addresses</div>
    ${ips.length ? ips.map(r => `<div class="ip-row"><span class="ip" translate="no">${escapeHtml(r.ip)}</span><span class="m">${escapeHtml((r.events || []).join(', '))} · ${r.count}× · first ${fmtDateTime(r.firstSeen)} · last ${fmtDateTime(r.lastSeen)}</span>
      <button class="admin-btn ${r.blocked ? '' : 'admin-btn-danger'}" onclick="socket.emit('admin-set-ip-block',{groupId:'${a.groupId}',ip:'${escapeHtml(r.ip)}',blocked:${!r.blocked}})">${r.blocked ? '<i class="fa-solid fa-unlock"></i> Unblock' : '<i class="fa-solid fa-ban"></i> Block IP'}</button></div>`).join('') : '<p class="ledger-empty">No IP activity recorded yet.</p>'}
    <p class="reg-note">A blocked IP cannot register, sign in, join the seller seat or withdraw. Connections from it are cut immediately.</p>`;
});

// ---- Business queue ----
let businessQueueCache = [];
function renderBusinessQueue() {
  const box = el('businessQueueList'); if (!box) return;
  box.innerHTML = businessQueueCache.length ? businessQueueCache.map(a => `
    <div class="invite-link-row" style="flex-wrap:wrap;"><div style="flex:1;min-width:0;">
      <div style="font-weight:800;font-size:0.78rem;">${escapeHtml((a.business.profile || {}).companyName || a.fullName)} <span class="lab-chip warn">Pending</span></div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${escapeHtml(a.fullName || '')} · <span translate="no">ID ${escapeHtml(a.accountId || '—')}</span> · Reg ${escapeHtml((a.business.profile || {}).registrationNumber || '—')} · Tax ${escapeHtml((a.business.profile || {}).taxId || '—')}</div>
    </div>
    <button class="admin-btn" onclick="openSellerProfile('${a.groupId}')"><i class="fa-solid fa-magnifying-glass"></i> Review</button>
    <button class="admin-btn" onclick="socket.emit('admin-review-business',{groupId:'${a.groupId}',decision:'verified'})"><i class="fa-solid fa-check"></i> Approve</button>
    <button class="admin-btn admin-btn-danger" onclick="showPromptModal({title:'Reject business application',placeholder:'Reason (shown to the seller)'},(r)=>socket.emit('admin-review-business',{groupId:'${a.groupId}',decision:'rejected',reason:r}))"><i class="fa-solid fa-xmark"></i> Reject</button></div>`).join('')
    : '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No pending business applications.</p>';
}
socket.on('business-queue-list', (l) => { businessQueueCache = l; renderBusinessQueue(); });
socket.on('business-submitted', (a) => { businessQueueCache = [a, ...businessQueueCache.filter(x => x.groupId !== a.groupId)]; renderBusinessQueue(); });
socket.on('business-resolved', (a) => { businessQueueCache = businessQueueCache.filter(x => x.groupId !== a.groupId); renderBusinessQueue(); });
const _setAdminTabBase = setAdminTab;
setAdminTab = function (tab) { _setAdminTabBase(tab); if (tab === 'accounts') socket.emit('admin-get-business-queue'); };

// ---- Crypto prior-deposit policy editor ----
function openCryptoPolicy() { socket.emit('admin-get-crypto-policy'); openModal('cryptoPolicyModal'); }
socket.on('crypto-policy', (p) => {
  const tier = (i, lab) => { const t = p.tiers[i]; return `<div class="sp-sec" style="margin:10px 0 4px;">Tier ${i + 1} — ${lab}</div><div class="dur-row" style="grid-template-columns:repeat(3,1fr)">
    <label>Min %<input type="number" step="0.01" id="cpMin${i}" value="${(t.minPct * 100).toFixed(2)}"></label><label>Max %<input type="number" step="0.01" id="cpMax${i}" value="${(t.maxPct * 100).toFixed(2)}"></label><label>Applied %<input type="number" step="0.01" id="cpPct${i}" value="${(t.pct * 100).toFixed(2)}"></label></div>`; };
  const b = p.boundaries;
  el('cpBody').innerHTML = `<p class="reg-note" style="margin:0 0 8px;">Before a seller's first crypto withdrawal they must have a verified crypto deposit. The required amount depends on the withdrawal size (USD equivalent). Once met, crypto withdrawals unlock for good. Only a Super Admin can save changes.</p>
    <div class="dur-row" style="grid-template-columns:repeat(3,1fr)"><label>Tier 1 below ($)<input type="number" id="cpB0" value="${b[0]}"></label><label>Tier 2 up to ($)<input type="number" id="cpB1" value="${b[1]}"></label><label>Tier 3 up to ($)<input type="number" id="cpB2" value="${b[2]}"></label></div>
    ${tier(0, `under $${b[0].toLocaleString()}`)}${tier(1, `$${b[0].toLocaleString()} – $${b[1].toLocaleString()}`)}${tier(2, `$${b[1].toLocaleString()} – $${b[2].toLocaleString()}`)}
    <div class="sp-sec" style="margin:10px 0 4px;">Tier 4 — above $${b[2].toLocaleString()} (flat cap)</div><div class="dur-row" style="grid-template-columns:repeat(3,1fr)"><label>Min ($)<input type="number" id="cpFMin" value="${p.tiers[3].flatMin}"></label><label>Max ($)<input type="number" id="cpFMax" value="${p.tiers[3].flatMax}"></label><label>Applied ($)<input type="number" id="cpFlat" value="${p.tiers[3].flat}"></label></div>
    <label class="terms-check"><input type="checkbox" id="cpCum" ${p.cumulative ? 'checked' : ''}> <span>Smaller crypto deposits add up towards the requirement</span></label>
    <div class="reg-actions"><button class="ghost-btn" onclick="closeModal('cryptoPolicyModal')">Close</button><button class="send-btn" onclick="saveCryptoPolicy()">Save policy</button></div>`;
});
function saveCryptoPolicy() {
  const n = (id) => parseFloat(el(id).value); const pct = (id) => n(id) / 100;
  socket.emit('admin-set-crypto-policy', {
    boundaries: [n('cpB0'), n('cpB1'), n('cpB2')],
    tiers: [0, 1, 2].map(i => ({ minPct: pct('cpMin' + i), maxPct: pct('cpMax' + i), pct: pct('cpPct' + i) })).concat([{ flatMin: n('cpFMin'), flatMax: n('cpFMax'), flat: n('cpFlat') }]),
    cumulative: el('cpCum').checked
  });
}

// ====================================================================
// 11. Admin: Record incoming funds (professional form)
// ====================================================================
function openRecordFundsModal() {
  if (!fundsDeskGroupId) return;
  const s = fundsOverviewCache.find(x => x.groupId === fundsDeskGroupId);
  el('recordFundsSellerLabel').textContent = s ? s.sellerName : "this seller's";
  ['rfPayerName', 'rfPayerEmail', 'rfPurpose', 'rfExternalRef', 'rfInternalNote', 'rfBankName', 'rfSenderAccount', 'rfAmount', 'rfFee', 'rfNetwork'].forEach(id => { el(id).value = ''; });
  pickState.rfcountry = null; el('rfCountryFlag').innerHTML = ''; el('rfCountryText').textContent = 'Select country'; el('rfCountryText').classList.add('placeholder');
  el('rfMethod').value = 'bank_transfer'; el('rfAsset').value = 'USDT'; el('rfCurrency').value = (s && s.currency) || 'USD';
  el('rfTreatment').value = 'track'; el('rfTrackMode').value = 'auto'; el('rfTrackPreset').value = '86400';
  ['rfDurD', 'rfDurH', 'rfDurM', 'rfDurS'].forEach(id => { el(id).value = 0; });
  el('rfReceivedAt').value = ''; el('rfShowTimer').checked = false; el('rfShareNote').checked = false; el('rfNotifySeller').checked = true;
  toggleRecordFundsFields(); updateRfPreview(); openModal('recordFundsModal');
}
function toggleRecordFundsFields() {
  const m = el('rfMethod').value, tr = el('rfTreatment').value;
  el('rfCryptoFields').style.display = m === 'crypto' ? 'flex' : 'none';
  el('rfBankFields').style.display = m === 'crypto' ? 'none' : 'flex';
  el('rfRefLabel').textContent = m === 'crypto' ? 'Transaction hash' : m === 'cheque' ? 'Cheque number' : 'Bank reference';
  el('rfTrackBox').style.display = tr === 'track' ? 'block' : 'none';
  updateRfPreview();
}
function rfPresetChange() { el('rfCustomDur').classList.toggle('hidden', el('rfTrackPreset').value !== 'custom'); }
function updateRfPreview() {
  const amt = parseFloat(el('rfAmount').value), fee = parseFloat(el('rfFee').value) || 0, ccy = el('rfCurrency').value;
  const box = el('rfPreview'); if (!(amt > 0)) { box.style.display = 'none'; return; }
  const s = fundsOverviewCache.find(x => x.groupId === fundsDeskGroupId);
  box.style.display = 'block';
  box.innerHTML = `Net to seller: <b>${fmtMoney(Math.max(0, amt - fee), ccy)}</b>${fee > 0 ? ` (after ${fmtMoney(fee, ccy)} fee)` : ''}${s && s.currency && s.currency !== ccy ? ` · converted to ${s.currency} on recording` : ''}`;
}
function submitRecordFunds() {
  if (!fundsDeskGroupId) return;
  const payerName = el('rfPayerName').value.trim(), purpose = el('rfPurpose').value.trim(), method = el('rfMethod').value, amount = parseFloat(el('rfAmount').value), fee = parseFloat(el('rfFee').value) || 0;
  if (!payerName) return toast('Please enter who the payment is from.', true);
  if (!purpose) return toast('Please describe what the payment is for.', true);
  if (!Number.isFinite(amount) || amount <= 0) return toast('Please enter a valid amount.', true);
  if (fee < 0 || fee >= amount) return toast('The fee must be smaller than the amount received.', true);
  const treatment = el('rfTreatment').value;
  const payload = {
    groupId: fundsDeskGroupId, payerName, purpose, method, payerEmail: el('rfPayerEmail').value.trim(), payerCountry: pickState.rfcountry ? pickState.rfcountry.name : '',
    amount, amountCurrency: el('rfCurrency').value, feeAmount: fee, externalRef: el('rfExternalRef').value.trim(), bankName: el('rfBankName').value.trim(), senderAccount: el('rfSenderAccount').value.trim(),
    internalNote: el('rfInternalNote').value.trim(), shareNoteWithBuyer: el('rfShareNote').checked, treatment, notifySeller: el('rfNotifySeller').checked
  };
  if (method === 'crypto') { payload.asset = el('rfAsset').value; payload.network = el('rfNetwork').value.trim(); }
  if (treatment === 'track') {
    payload.trackMode = el('rfTrackMode').value; payload.showTimerToSeller = el('rfShowTimer').checked;
    const preset = el('rfTrackPreset').value;
    if (preset === 'custom') {
      const total = (parseInt(el('rfDurD').value, 10) || 0) * 86400 + (parseInt(el('rfDurH').value, 10) || 0) * 3600 + (parseInt(el('rfDurM').value, 10) || 0) * 60 + (parseInt(el('rfDurS').value, 10) || 0);
      if (total < 60) return toast('Choose a tracking duration of at least 1 minute.', true);
      payload.totalSeconds = total;
    } else payload.totalSeconds = Number(preset);
  }
  const at = el('rfReceivedAt').value; if (at) payload.receivedAt = new Date(at).toISOString();
  el('rfSubmitBtn').disabled = true; setTimeout(() => { el('rfSubmitBtn').disabled = false; }, 2500);
  socket.emit('admin-record-incoming-funds', payload);
}

// ====================================================================
// 12. Notifications: instant alerts, 3x sound, reminders, read sync
// ====================================================================
const AlertSound = (() => {
  let ctx = null;
  function unlock() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { /* no audio */ } }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
  function beep(at, freq, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.35, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + dur + 0.02);
  }
  function play3() {
    if (localStorage.getItem('q_sound') === '0') return;
    try { if (navigator.vibrate) navigator.vibrate([220, 110, 220, 110, 220]); } catch (e) { /* ignore */ }
    if (!ctx) unlock();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) { beep(t + i * 0.55, 880, 0.22); beep(t + i * 0.55 + 0.2, 1320, 0.28); }
  }
  return { play3, unlock };
})();
let flashT = null, unreadFlash = 0; const baseTitle = document.title;
function flashTitle(text) {
  if (!document.hidden) return; unreadFlash++; clearInterval(flashT); let on = false;
  flashT = setInterval(() => { document.title = on ? baseTitle : `(${unreadFlash}) ${text}`; on = !on; }, 1000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(flashT); document.title = baseTitle; unreadFlash = 0; } });
function chatIsAtBottom() { const c = el('messageContainer'); return !c || c.scrollHeight - c.scrollTop - c.clientHeight < 160; }
socket.on('alert', (a) => {
  if (a.silent) { toast(a.body); return; }
  const looking = !document.hidden && document.hasFocus() && a.groupId === activeGroupId && a.kind === 'message' && !a.reminder && chatIsAtBottom();
  if (looking) return;                                         // they are reading it live — no interruption
  AlertSound.play3();
  const t = document.createElement('div');
  toast(`${a.title} — ${a.body}`.slice(0, 220));
  flashTitle(a.reminder ? 'Unread messages' : 'New message');
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { const n = new Notification(a.title, { body: a.body, tag: 'qsd-' + a.groupId, renotify: true, requireInteraction: !!a.reminder, icon: '/icon-192.png' }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { /* ignore */ }
  }
  if (isAdminConfirmed && a.groupId !== activeGroupId) socket.emit('get-all-groups');
});
const readToastAt = {};
socket.on('message-read-by', ({ groupId, readerName }) => {
  if (groupId !== activeGroupId) return;
  const now = Date.now(); if (now - (readToastAt[readerName] || 0) < 30000) return; readToastAt[readerName] = now;
  toast(`${readerName} has read the messages.`);
});
socket.on('toast-info', ({ message }) => toast(message));
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open-url' && e.data.url) { const u = new URL(e.data.url, location.origin); const g = u.searchParams.get('groupId'); if (g && g !== activeGroupId && isAdminConfirmed) switchGroup(g); } });
// One gentle nudge to allow system notifications, so offline users are alerted too.
setTimeout(() => {
  if ('Notification' in window && Notification.permission === 'default' && !localStorage.getItem('q_notif_asked') && typeof togglePushSubscription === 'function') {
    localStorage.setItem('q_notif_asked', '1');
    showConfirmModal({ title: 'Turn on message alerts?', message: 'Get an instant alert — with a sound — when someone messages you, even if this page is closed.' }, () => togglePushSubscription());
  }
}, 9000);

// Reset the per-attempt KYC analysis whenever the wizard is (re)opened.
const _openTxKycWizardBase = openTxKycWizard;
openTxKycWizard = function () {
  Object.keys(kycQuality).forEach(k => delete kycQuality[k]); kycFace = { detected: false, method: 'none' };
  const b = el('kycIdDetails'); if (b) { b.remove(); }
  _openTxKycWizardBase();
};

// The account's saved language wins on first load, so a returning seller always sees their own language.
let _langSynced = false;
socket.on('seller-account-state', (a) => {
  if (_langSynced || !a || !a.registered || !a.language) return;
  _langSynced = true;
  if (a.language !== QI18N.lang) QI18N.setLanguage(a.language, { notify: false });
});

// User directory: show each seller's country flag next to their name.
const _renderDirectoryBase = renderDirectory;
renderDirectory = function () {
  _renderDirectoryBase();
  document.querySelectorAll('#directoryContainer .directory-item').forEach((row, idx) => {
    const name = row.querySelector('.directory-name'); if (!name || name.querySelector('.flag, .flag-emoji')) return;
    const u = directoryCache.find(x => escapeHtml(x.displayName) === name.innerHTML);
    if (u && u.countryIso) name.insertAdjacentHTML('beforeend', ` <span class="flag-inline" title="${escapeHtml(u.country || '')}">${flagHtml(u.countryIso, u.country)}</span>`);
  });
};

// ---- Password reveal (company / assigned admin only; the server logs every view) ----
let pwHideT = null;
function revealSellerPassword(groupId) { socket.emit('admin-reveal-seller-password', { groupId }); }
socket.on('seller-password-revealed', (r) => {
  const t = el('spPwText'), b = el('spPwBtn'); if (!t) return;
  if (!r.available) { t.textContent = 'Not available'; return; }
  t.textContent = r.password; if (b) b.style.display = 'none';
  clearTimeout(pwHideT);
  pwHideT = setTimeout(() => { const x = el('spPwText'); if (x) x.textContent = '●●●●●●●●'; const y = el('spPwBtn'); if (y) y.style.display = ''; }, (r.hideAfterSec || 30) * 1000);
  toast('Password shown for ' + (r.hideAfterSec || 30) + ' seconds. This view has been logged.');
});

// ====================================================================
// 13. Email delivery settings (admin) + problems made visible
// ====================================================================
function openEmailSettings() { socket.emit('admin-get-email-settings'); openModal('emailSettingsModal'); el('emBody').innerHTML = '<p class="ledger-empty">Loading…</p>'; }
let emState = null;
socket.on('email-settings', (s) => { emState = s; renderEmailSettings(); });
async function renderEmailSettings() {
  const s = emState; if (!s || el('emailSettingsModal').classList.contains('hidden')) return; const st = s.status, sv = s.saved || {}; const edit = s.canEdit;
  let tr = null; try { tr = (await (await fetch('/api/health')).json()).translation; } catch (e) { /* optional */ }
  const prov = sv.provider || 'resend';
  el('emBody').innerHTML = `
    <div class="gate-banner" style="margin-bottom:12px;${st.configured ? 'background:rgba(34,211,165,.08);border-color:rgba(34,211,165,.3)' : ''}"><i class="fa-solid ${st.configured ? 'fa-circle-check' : 'fa-triangle-exclamation'}" style="color:${st.configured ? 'var(--accent-emerald)' : 'var(--accent-amber)'}"></i>
      <div><b>${st.configured ? 'Email is set up' : 'Email is NOT set up — sellers cannot receive verification codes'}</b><span>${st.configured ? `Sending through <b>${escapeHtml(st.provider)}</b> (${escapeHtml(st.source)}) from ${escapeHtml(st.from || 'default sender')}.` : 'Choose a provider below, save, then send yourself a test email.'}</span></div></div>
    ${edit ? `
    <label class="branding-field">Provider
      <select id="emProvider" class="message-input" onchange="emProviderChange()">
        <option value="resend" ${prov === 'resend' ? 'selected' : ''}>Resend (recommended, free tier, works on any host)</option>
        <option value="brevo" ${prov === 'brevo' ? 'selected' : ''}>Brevo (free tier)</option>
        <option value="sendgrid" ${prov === 'sendgrid' ? 'selected' : ''}>SendGrid</option>
        <option value="smtp" ${prov === 'smtp' ? 'selected' : ''}>SMTP / Gmail (may be blocked by some hosts)</option>
      </select></label>
    <div id="emKeyBox" class="${prov === 'smtp' ? 'hidden' : ''}"><label class="branding-field">API key<input type="password" id="emApiKey" class="message-input" autocomplete="off" placeholder="${sv.hasKey && prov === sv.provider ? '•••••••• saved — leave blank to keep' : 'Paste your API key'}"></label></div>
    <div id="emSmtpBox" class="${prov === 'smtp' ? '' : 'hidden'}">
      <div class="two-col"><label class="branding-field">SMTP host<input type="text" id="emHost" class="message-input" value="${escapeHtml((sv.smtp && sv.smtp.host) || '')}" placeholder="smtp.gmail.com"></label><label class="branding-field">Port<input type="number" id="emPort" class="message-input" value="${escapeHtml(String((sv.smtp && sv.smtp.port) || 587))}"></label></div>
      <div class="two-col"><label class="branding-field">Username<input type="text" id="emUser" class="message-input" value="${escapeHtml((sv.smtp && sv.smtp.user) || '')}" autocomplete="off"></label><label class="branding-field">Password / app password<input type="password" id="emPass" class="message-input" autocomplete="off" placeholder="${sv.smtp && sv.smtp.hasPass ? '•••••••• saved — leave blank to keep' : ''}"></label></div>
    </div>
    <label class="branding-field">From address<input type="text" id="emFrom" class="message-input" value="${escapeHtml(sv.from || '')}" placeholder='Transaction Desk <no-reply@yourdomain.com>'></label>
    <p class="reg-note">With Resend, until you verify your own domain you can only send to the email you signed up with — use <b>onboarding@resend.dev</b> as the From address for a first test.</p>
    <div class="reg-actions" style="justify-content:flex-start"><button class="send-btn" onclick="saveEmailSettings()"><i class="fa-solid fa-floppy-disk"></i> Save</button></div>` : '<p class="reg-note">Only the company (Super Admin) can change these settings.</p>'}
    <div class="sp-sec">Check your setup</div>
    <div class="lab-actions"><button class="admin-btn" onclick="emVerify()"><i class="fa-solid fa-plug-circle-check"></i> Verify connection</button><button class="admin-btn" onclick="emDeliverability()"><i class="fa-solid fa-shield-halved"></i> Check deliverability (SPF · DKIM · DMARC)</button></div>
    <div id="emDiag" style="margin-top:10px"></div>
    <div class="sp-sec">Send a test email</div>
    <div class="reg-email-row"><input type="email" id="emTestTo" class="message-input" placeholder="you@example.com"><button class="admin-btn" onclick="sendTestEmail()"><i class="fa-solid fa-paper-plane"></i> Send test</button></div>
    <div class="reg-note" id="emTestResult" style="min-height:18px"></div>
    ${tr ? `<div class="sp-sec">Translation privacy</div><p class="reg-note" style="margin:0"><i class="fa-solid ${tr.private ? 'fa-lock' : 'fa-globe'}"></i> ${escapeHtml(tr.note)}${tr.enabled && !tr.private ? ' To keep all chat text on your own server, set <b>LIBRETRANSLATE_URL</b> (see DEPLOY notes).' : ''}</p>` : ''}`;
}
function emProviderChange() { const p = el('emProvider').value; el('emKeyBox').classList.toggle('hidden', p === 'smtp'); el('emSmtpBox').classList.toggle('hidden', p !== 'smtp'); }
function saveEmailSettings() {
  const provider = el('emProvider').value;
  socket.emit('admin-save-email-settings', { provider, from: el('emFrom').value.trim(), apiKey: provider === 'smtp' ? '' : el('emApiKey').value.trim(), smtp: provider === 'smtp' ? { host: el('emHost').value.trim(), port: el('emPort').value, user: el('emUser').value.trim(), pass: el('emPass').value } : null });
}
function sendTestEmail() { const to = el('emTestTo').value.trim(); if (!isValidEmailClient(to)) return toast('Enter an email address to send the test to.', true); el('emTestResult').textContent = 'Sending…'; el('emTestResult').style.color = ''; socket.emit('admin-test-email', { to }); }
socket.on('email-test-result', (r) => { const n = el('emTestResult'); if (!n) return; n.textContent = r.ok ? `✓ Sent via ${r.provider}. Check the inbox (and spam folder).` : `✗ ${r.error}`; n.style.color = r.ok ? 'var(--accent-emerald)' : 'var(--accent-rose)'; });
// Warn admins up front if sellers could not receive codes.
socket.on('init-state', (d) => { if (d.isAdminConfirmed && hasMinRoleClient(d.adminRole, 'ADMIN')) socket.emit('admin-get-email-settings'); });
let emailWarned = false;
socket.on('email-settings', (s) => { if (!emailWarned && s.status && !s.status.configured && el('emailSettingsModal').classList.contains('hidden')) { emailWarned = true; toast('Email is not set up — sellers cannot receive verification codes. Open Accounts → Compliance settings → Email delivery.', true); } });

// Registration email problems: tell the seller instead of leaving them waiting.
socket.on('registration-email-failed', ({ message }) => {
  reg.sentTo = null; clearInterval(reg.cooldownT);
  const b = el('txRegSendCodeBtn'); b.disabled = false; b.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send verification code';
  el('txRegCodeHint').textContent = message; el('txRegCodeHint').style.color = 'var(--accent-rose)'; toast(message, true);
});
socket.on('registration-email-code-sent', ({ devCode }) => { if (devCode) { el('txRegCodeHint').textContent += `  [TEST MODE — your code is ${devCode}]`; } });

// ====================================================================
// 14. Sign-in with several accounts on one email
// ====================================================================
const _doLoginBase = doLogin;
doLogin = async function () {
  const email = el('loginEmail').value.trim(), password = el('loginPassword').value;
  if (!isValidEmailClient(email) || !password) return loginMsg('Enter your email and password.');
  const r = await postJson('/api/auth/login', { email, password });
  if (!r.ok) return loginMsg(r.data.error || 'Sign in failed.');
  sessionStorage.setItem('q_session_token', r.data.sessionToken);
  if (r.data.multiple) {
    el('loginPickList').innerHTML = r.data.accounts.map(a => `<button class="next-card" onclick="location.href='/?groupId=${encodeURIComponent(a.groupId)}&role=SELLER'"><span class="next-ico cyan"><i class="fa-solid fa-briefcase"></i></span><span class="next-text"><b>${escapeHtml(a.groupName)}</b><small translate="no">Account ID ${escapeHtml(a.accountId || '—')}${a.disabled ? ' · disabled' : ''}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('');
    loginStep('Pick'); el('loginTitle').textContent = 'Choose your account'; return;
  }
  if (r.data.language) localStorage.setItem('q_lang', r.data.language);
  location.href = `/?groupId=${encodeURIComponent(r.data.groupId)}&role=SELLER`;
};
const _loginStepBase = loginStep;
loginStep = function (which) { ['Signin', 'Forgot', 'Code', 'New', 'Pick'].forEach(s => { const n = el('loginStep' + s); if (n) n.classList.toggle('hidden', s !== which); }); el('loginTitle').textContent = which === 'Signin' ? 'Seller sign in' : which === 'Pick' ? 'Choose your account' : 'Reset your password'; el('loginMsg').textContent = ''; };

// ====================================================================
// 15. Simpler KYC: only the ID number and expiry date are typed
// ====================================================================
renderTxKycWizard = function () {
  _renderKycWizBase();
  const last = txKycStep === (window._txWizTotalSteps || 6) - 1;
  let blk = el('kycIdDetails');
  if (!last) { if (blk) blk.style.display = 'none'; return; }
  if (!blk) {
    blk = document.createElement('div'); blk.id = 'kycIdDetails'; blk.className = 'create-group-form'; blk.style.marginBottom = '12px';
    blk.innerHTML = `<p class="reg-note" style="margin:0 0 6px;">Last step — two details from your ID. We use your name and date of birth from registration, so there is nothing else to type.</p>
      <div class="two-col"><label class="branding-field">ID / document number<input type="text" id="kycIdNumber" class="message-input" autocomplete="off"></label><label class="branding-field">Expiry date<input type="date" id="kycIdExpiry" class="message-input"></label></div>`;
    el('txWizSummary').parentNode.insertBefore(blk, el('txWizSummary'));
  }
  blk.style.display = 'flex'; blk.style.flexDirection = 'column';
};
txKycWizardNext = function () {
  const totalSteps = window._txWizTotalSteps || 6;
  if (txKycStep === totalSteps - 1) {
    const steps = txKycStepsForDocType();
    if (steps.filter(k => !txKycUploads[k]).length) return toast('Please upload every document before submitting.', true);
    const idNumber = el('kycIdNumber').value.trim(), idExpiry = el('kycIdExpiry').value;
    if (!idNumber) return toast('Please enter the ID number.', true);
    if (!idExpiry) return toast('Please enter the ID expiry date.', true);
    socket.emit('submit-kyc', {
      groupId: activeGroupId, docType: el('txKycDocType').value, idFrontUrl: txKycUploads.idFront, idBackUrl: txKycUploads.idBack,
      proofAddressType: el('txKycProofAddressType').value, proofAddressUrl: txKycUploads.proofAddress, selfieUrl: txKycUploads.selfie,
      idNumber, idExpiry, quality: kycQuality, face: kycFace
    });
    closeModal('txKycWizardModal'); toast('Checking your documents…');
    return;
  }
  const key = currentWizStepKey();
  if (key && !txKycUploads[key]) return toast('Please upload this document before continuing.', true);
  txKycStep++; renderTxKycWizard();
};

// ====================================================================
// 16. Install as an app (Android/desktop prompt, iPhone instructions)
// ====================================================================
let deferredInstall = null;
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (!standalone()) el('installBtn').classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { deferredInstall = null; el('installBtn').classList.add('hidden'); toast('App installed.'); });
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
if (isIos && !standalone()) document.addEventListener('DOMContentLoaded', () => el('installBtn').classList.remove('hidden'));
async function installApp() {
  if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; el('installBtn').classList.add('hidden'); return; }
  if (isIos) return showConfirmModal({ title: 'Install on iPhone / iPad', message: 'Tap the Share button in Safari, then “Add to Home Screen”. The app will open full-screen like any other app.' }, () => {});
  toast('Use your browser menu → “Install app” or “Add to Home screen”.');
}

function emVerify() { el('emDiag').innerHTML = '<p class="reg-note">Connecting…</p>'; socket.emit('admin-verify-email'); }
function emDeliverability() { el('emDiag').innerHTML = '<p class="reg-note">Checking your DNS records…</p>'; socket.emit('admin-check-deliverability'); }
socket.on('email-verify-result', (r) => { const n = el('emDiag'); if (!n) return; n.innerHTML = `<div class="gate-banner" style="margin:0;${r.ok ? 'background:rgba(34,211,165,.08);border-color:rgba(34,211,165,.3)' : ''}"><i class="fa-solid ${r.ok ? 'fa-circle-check' : 'fa-circle-xmark'}" style="color:${r.ok ? 'var(--accent-emerald)' : 'var(--accent-rose)'}"></i><div><b>${r.ok ? 'Connection works' : 'Connection failed'}</b><span>${escapeHtml(r.ok ? r.detail : r.error)}</span></div></div>`; });
socket.on('email-deliverability-result', (r) => {
  const n = el('emDiag'); if (!n) return;
  const ic = { pass: ['fa-circle-check', 'var(--accent-emerald)'], warn: ['fa-triangle-exclamation', 'var(--accent-amber)'], fail: ['fa-circle-xmark', 'var(--accent-rose)'] };
  n.innerHTML = `<p class="reg-note" style="margin:0 0 6px;"><b>${r.domain ? escapeHtml(r.domain) : 'No domain'}</b> — ${r.ok ? 'authentication looks good. This gives your emails the best chance of reaching the inbox.' : 'fix the items marked ✗ so receivers trust your emails.'}</p>` +
    r.checks.map(c => `<div class="ip-row" style="align-items:flex-start"><i class="fa-solid ${ic[c.status][0]}" style="color:${ic[c.status][1]};margin-top:3px"></i><div style="flex:1;min-width:0"><b>${escapeHtml(c.name)}</b><div class="reg-note" style="margin:2px 0 0;word-break:break-word">${escapeHtml(c.detail)}</div>${c.fix ? `<div class="reg-note" style="margin:4px 0 0;color:var(--accent-amber);word-break:break-word"><b>Fix:</b> ${escapeHtml(c.fix)}</div>` : ''}</div></div>`).join('');
});
