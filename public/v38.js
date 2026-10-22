/* v3.8+ — receiving account details, seller wallpapers (styles), bottom bar.
   Loaded last. It only ADDS to what app.js / v31.js / v32.js already do (it wraps functions, never deletes them). */
'use strict';
const v38safe = (fn) => { try { return fn(); } catch (e) { console.warn('[v38]', e); } };
const v38Get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const v38Set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } };
const v38Esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ====================================================================
// 1. Styles (wallpapers) — number 1 is the default
// ====================================================================
const WP_STYLES = [
  { id: '1', name: 'Aurora', accent: '#5aa9ff', shade: [0.18, 0.62] },
  { id: '2', name: 'Midnight Stripe', accent: '#6c7bff', shade: [0.30, 0.70] },
  { id: '3', name: 'Bronze Silk', accent: '#d9a066', shade: [0.34, 0.74] },
  { id: '4', name: 'Summit', accent: '#6fa8ff', shade: [0.26, 0.68] },
  { id: '5', name: 'Crimson Dots', accent: '#ff6b6b', shade: [0.36, 0.76] },
  { id: '6', name: 'Sapphire Eclipse', accent: '#45b5e8', shade: [0.26, 0.68] }
];
let wpCurrent = /^[1-6]$/.test(v38Get('q_style') || '') ? v38Get('q_style') : '1';
function applyStyle(id, persist) {
  const s = WP_STYLES.find((x) => x.id === String(id)) || WP_STYLES[0];
  wpCurrent = s.id;
  const root = document.documentElement;
  root.style.setProperty('--wp-img', `url(/wallpapers/wp${s.id}.webp)`);
  root.style.setProperty('--wp-accent', s.accent);
  root.style.setProperty('--wp-shade-a', `rgba(5,9,18,${s.shade[0]})`); root.style.setProperty('--wp-shade-b', `rgba(5,9,18,${s.shade[1]})`);
  root.dataset.wp = s.id;
  if (persist !== false) v38Set('q_style', s.id);
  document.querySelectorAll('.style-opt').forEach((b) => { b.classList.toggle('sel', b.dataset.style === s.id); b.setAttribute('aria-pressed', String(b.dataset.style === s.id)); });
  const nm = document.getElementById('styleNowName'); if (nm) nm.textContent = `${s.id} · ${s.name}`;
}
applyStyle(wpCurrent, false);

function isSellerUI() {
  return !document.body.classList.contains('is-admin') && typeof sellerAccountState !== 'undefined' && !!sellerAccountState && !!sellerAccountState.registered;
}
function syncSellerWp() { document.body.classList.toggle('wp-seller', isSellerUI()); }

function openStylePicker() {
  let m = document.getElementById('styleModal');
  if (!m) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="styleModal"><div class="modal-box" style="max-width:460px">
      <div class="modal-header"><span><i class="fa-solid fa-palette"></i> Choose your style</span><i class="fa-solid fa-xmark" onclick="closeModal('styleModal')"></i></div>
      <div class="modal-body"><p style="color:var(--text-muted);font-size:.8rem;margin:0 0 14px">Your style becomes the background of your account home and your conversation. It is saved to your account and follows you on every device. Currently: <b id="styleNowName"></b></p>
      <div class="style-grid" id="styleGrid"></div></div></div></div>`);
    m = document.getElementById('styleModal');
    document.getElementById('styleGrid').innerHTML = WP_STYLES.map((s) => `<button type="button" class="style-opt" data-style="${s.id}" aria-label="Style ${s.id}: ${s.name}"><img src="/wallpapers/wp${s.id}-thumb.webp" alt="" loading="lazy"><span class="so-no">${s.id}</span><span class="so-ok"><i class="fa-solid fa-check"></i></span><span class="so-name">${s.name}${s.id === '1' ? ' · default' : ''}</span></button>`).join('');
    document.getElementById('styleGrid').addEventListener('click', (e) => {
      const b = e.target.closest('.style-opt'); if (!b) return;
      applyStyle(b.dataset.style);
      if (typeof activeGroupId !== 'undefined' && activeGroupId && isSellerUI()) socket.emit('set-my-style', { groupId: activeGroupId, style: b.dataset.style });
      if (typeof toast === 'function') toast('Style updated.');
    });
  }
  applyStyle(wpCurrent, false);
  m.classList.remove('hidden');
}
socket.on('my-style', (d) => { if (d && /^[1-6]$/.test(String(d.style))) applyStyle(d.style); });

// ====================================================================
// 2. Seller screen: Accounts page, greeting, action buttons, support, bottom bar
// ====================================================================
const GREET = {
  en: ['Good morning', 'Good afternoon', 'Good evening'], fr: ['Bonjour', 'Bon après-midi', 'Bonsoir'], es: ['Buenos días', 'Buenas tardes', 'Buenas noches'],
  pt: ['Bom dia', 'Boa tarde', 'Boa noite'], de: ['Guten Morgen', 'Guten Tag', 'Guten Abend'], it: ['Buongiorno', 'Buon pomeriggio', 'Buonasera']
};
function greetingText() {
  const a = (typeof sellerAccountState !== 'undefined' && sellerAccountState) || {};
  const h = new Date().getHours(), i = h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : 2;                       // the seller's own clock
  const lang = String(a.language || (typeof QI18N !== 'undefined' && QI18N.lang) || 'en').slice(0, 2).toLowerCase();
  const first = String(a.fullName || '').trim().split(/\s+/)[0];
  const nm = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
  return `${(GREET[lang] || GREET.en)[i]}${nm ? ', ' + nm : ''}`;
}
function renderGreeting() { const t = document.getElementById('txPageTitle'); const dash = document.getElementById('txPageDashboard'); if (t && dash && !dash.classList.contains('hidden')) t.textContent = greetingText(); }

v38safe(() => {
  const view = document.getElementById('txAccountView'); if (!view) return;
  const nav = view.querySelector('.tx-nav');
  if (nav && !nav.querySelector('[data-txnav="accounts"]')) {
    const b = document.createElement('button'); b.className = 'tx-nav-item'; b.dataset.txnav = 'accounts'; b.onclick = () => setTxAccountNav('accounts');
    b.innerHTML = '<i class="fa-solid fa-building-columns"></i> Accounts';
    const tr = nav.querySelector('[data-txnav="transactions"]'); nav.insertBefore(b, tr || null);
  }
  const scroll = view.querySelector('.tx-scroll');
  if (scroll && !document.getElementById('txPageAccounts')) scroll.insertAdjacentHTML('beforeend', '<div class="tx-page hidden" id="txPageAccounts"><div id="txAccountsBody"></div></div>');
  TX_NAV_TITLES.accounts = ['Accounts', 'The details people use to send money to you.'];
  if (!document.getElementById('txBottomNav')) {
    view.insertAdjacentHTML('beforeend', `<nav class="tx-bottomnav" id="txBottomNav" aria-label="Main">
      <button type="button" data-bn="dashboard"><i class="fa-solid fa-house"></i>Home</button>
      <button type="button" data-bn="withdraw"><i class="fa-solid fa-right-left"></i>Transfer</button>
      <button type="button" data-bn="accounts"><i class="fa-solid fa-building-columns"></i>Accounts</button>
      <button type="button" data-bn="profile"><i class="fa-solid fa-user"></i>Profile</button></nav>`);
    document.getElementById('txBottomNav').addEventListener('click', (e) => { const b = e.target.closest('[data-bn]'); if (b) setTxAccountNav(b.dataset.bn); });
  }
  // top bar: Support (the style button lives on the Profile page only)
  const right = view.querySelector('.tx-topbar-right');
  if (right && !document.getElementById('txSupportBtn')) right.insertAdjacentHTML('afterbegin', '<button class="icon-btn" id="txSupportBtn" title="Contact Support" aria-label="Contact Support" onclick="openSupportModal()"><i class="fa-solid fa-headset"></i></button>');
  // dashboard: Send · Receive · Withdraw · Support
  const dash = document.getElementById('txPageDashboard');
  if (dash && !document.getElementById('txActionRow')) dash.insertAdjacentHTML('afterbegin', `<div class="tx-actionrow" id="txActionRow">
    <button type="button" onclick="openTxDepositModal()"><span><i class="fa-solid fa-paper-plane"></i></span>Send</button>
    <button type="button" onclick="setTxAccountNav('accounts')"><span><i class="fa-solid fa-arrow-down"></i></span>Receive</button>
    <button type="button" onclick="setTxAccountNav('withdraw')"><span><i class="fa-solid fa-arrow-up"></i></span>Withdraw</button>
    <button type="button" onclick="openSupportModal()"><span><i class="fa-solid fa-headset"></i></span>Support</button></div>`);
  // Profile: style row
  const prof = document.getElementById('txPageProfile');
  if (prof && !document.getElementById('txProfileStyleRow')) {
    const last = prof.querySelector('.tx-profile-row:last-of-type');
    if (last) last.insertAdjacentHTML('afterend', '<div class="tx-profile-row" id="txProfileStyleRow"><span>Style</span><b class="style-btn-row"><span class="style-now"></span><button class="admin-btn" onclick="openStylePicker()"><i class="fa-solid fa-palette"></i> Change style</button></b></div>');
  }
});

const _navV38 = setTxAccountNav;
setTxAccountNav = function (nav) {
  _navV38(nav);
  document.querySelectorAll('#txBottomNav [data-bn]').forEach((b) => b.classList.toggle('active', b.dataset.bn === nav));
  if (nav === 'dashboard') renderGreeting();
  if (nav === 'accounts') { renderAccountsPage(); requestReceiving(); }
};
setInterval(renderGreeting, 60000);

// ---- Receiving details: shown only after identity approval, only the seller's own currency, no copy buttons ----
let rcData = null, rcHide = false, rcLoaded = false;
function requestReceiving() { if (typeof activeGroupId !== 'undefined' && activeGroupId && isSellerUI()) socket.emit('get-receiving-details', { groupId: activeGroupId }); }
socket.on('receiving-details', (d) => { rcData = d || null; rcLoaded = true; renderAccountsPage(); });
socket.on('seller-account-state', () => setTimeout(() => {
  syncSellerWp(); renderGreeting();
  if (isSellerUI()) {
    if (window.__wpSynced !== activeGroupId) { window.__wpSynced = activeGroupId; socket.emit('get-my-style', { groupId: activeGroupId }); }
    if (sellerAccountState.kyc && sellerAccountState.kyc.status === 'verified') requestReceiving(); else { rcData = { approved: false, status: sellerAccountState.kyc && sellerAccountState.kyc.status }; rcLoaded = true; renderAccountsPage(); }
  }
}, 0));

function rcMask(v) { return String(v).replace(/[0-9A-Z]/g, (c, i, s) => (i < s.length - 4 ? '•' : c)); }
function rcLock(icon, title, text, btn) { return `<div class="rc-wrap"><div class="rc-lock"><div class="ic"><i class="fa-solid fa-${icon}"></i></div><h3>${title}</h3><p>${text}</p>${btn || ''}</div></div>`; }
function renderAccountsPage() {
  const host = document.getElementById('txAccountsBody'); if (!host) return;
  const a = sellerAccountState || {};
  if (!rcLoaded) { host.innerHTML = '<div class="rc-wrap"><div class="rc-skel"><i class="fa-solid fa-spinner fa-spin"></i> Loading your account details…</div></div>'; return; }
  if (!rcData || !rcData.approved) {
    const st = (rcData && rcData.status) || (a.kyc && a.kyc.status) || 'not_submitted';
    const pending = st === 'pending', rejected = st === 'rejected';
    host.innerHTML = rcLock(pending ? 'hourglass-half' : 'lock', pending ? 'Your verification is being reviewed' : rejected ? 'Verification needs your attention' : 'Your account details are almost ready',
      pending ? 'As soon as your identity is approved, your account details appear here automatically.' : rejected ? 'Please resubmit your documents. Your account details will appear here once your identity is approved.' : 'Verify your identity once, and your account details will appear here so people anywhere can send you money.',
      pending ? '' : `<button class="send-btn" onclick="openTxKycWizard()"><i class="fa-solid fa-id-card"></i> ${rejected ? 'Resubmit documents' : 'Verify identity'}</button>`);
    return;
  }
  if (!rcData.ready) {
    host.innerHTML = rcLock('building-columns', rcData.unsupported ? 'Your account details are arranged with the Desk' : 'Your account details are being prepared',
      rcData.unsupported ? 'Receiving details for your account currency are issued by our team. Please contact Support and we will set them up for you.' : 'Your identity is verified. Our team is finalising your receiving account, and it will appear here automatically as soon as it is ready.',
      '<button class="send-btn" onclick="openSupportModal()"><i class="fa-solid fa-headset"></i> Contact Support</button>');
    return;
  }
  const ccy = rcData.currency, d = rcData.details[ccy], bal = a.balances ? a.balances.available : 0;
  const grp = (title, rows) => `<div class="rc-grp"><div class="rc-gt">${title}</div>${rows.map((r) => { const sens = /account number|iban/i.test(r[0]); const val = rcHide && sens ? rcMask(r[1]) : r[1]; const ref = /reference/i.test(r[0]); return `<div class="rc-row ${ref ? 'ref' : ''}"><span>${v38Esc(r[0])}</span><b translate="no">${v38Esc(val)}</b></div>`; }).join('')}</div>`;
  host.innerHTML = `<div class="rc-wrap" id="rcCard">
    <div class="rc-hd"><div class="rc-brand"><b>V</b><span>VISTRA</span></div>
      <div class="rc-balrow"><div><small>Available balance</small><div class="rc-bal" translate="no">${rcHide ? '••••••••' : v38Esc(fmtMoney(bal, ccy))}</div></div>
        <button class="rc-eye" type="button" onclick="rcToggleHide()" aria-label="${rcHide ? 'Show details' : 'Hide details'}"><i class="fa-solid fa-${rcHide ? 'eye-slash' : 'eye'}"></i></button></div>
      <div class="rc-badges"><span class="rc-tier">${v38Esc(a.accountTypeLabel || 'Standard')}</span><span class="rc-ok"><i class="fa-solid fa-shield-halved"></i> Verified</span><span class="rc-nm">${v38Esc(rcData.holder || a.fullName || '')}</span></div></div>
    <div class="rc-title">Receive ${v38Esc(ccy)}</div>
    <div class="rc-intro">${v38Esc(d.intro)}</div>
    ${grp('Account holder details', d.a)}${grp('Bank details', d.b)}
    <div class="rc-actions"><button type="button" onclick="rcPrint()"><i class="fa-solid fa-file-pdf"></i> Save as PDF</button></div>
    <div class="rc-foot ${d.sample ? 'sample' : ''}"><i class="fa-solid fa-lock"></i> Protected with 256-bit encryption${d.sample ? ' · Sample data only' : ''}</div></div>`;
}
function rcToggleHide() { rcHide = !rcHide; renderAccountsPage(); }
function rcPrint() { document.body.classList.add('print-details'); const done = () => { document.body.classList.remove('print-details'); window.removeEventListener('afterprint', done); }; window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50); }

const _profV38 = typeof renderTxProfile === 'function' ? renderTxProfile : null;
if (_profV38) renderTxProfile = function () { _profV38(); const s = document.querySelector('#txProfileStyleRow .style-now'); if (s) s.style.backgroundImage = `url(/wallpapers/wp${wpCurrent}-thumb.webp)`; };

// ---- Support popup ----
function openSupportModal() {
  let m = document.getElementById('supportModal');
  if (!m) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="supportModal"><div class="modal-box" style="max-width:460px">
      <div class="modal-header"><span><i class="fa-solid fa-headset"></i> Contact Support</span><i class="fa-solid fa-xmark" onclick="closeModal('supportModal')"></i></div>
      <div class="modal-body" id="supportBody"></div></div></div>`);
    m = document.getElementById('supportModal');
  }
  const a = sellerAccountState || {};
  document.getElementById('supportBody').innerHTML = `<p style="color:var(--text-muted);font-size:.82rem;margin:0 0 14px">Tell us how we can help. Your message goes straight to our Support team and we reply to the email address below.</p>
    <label class="branding-field">Your name<input type="text" id="supName" class="message-input" autocomplete="name" value="${v38Esc(a.fullName || '')}"></label>
    <label class="branding-field">Email address<input type="email" id="supEmail" class="message-input" autocomplete="email" value="${v38Esc(a.email || '')}"></label>
    <label class="branding-field">Topic<select id="supTopic" class="message-input csel" style="width:100%"><option>Question</option><option>Payment issue</option><option>Account or login</option><option>Complaint</option><option>Other</option></select></label>
    <label class="branding-field">Your question or issue<textarea id="supMsg" class="message-input" rows="5" maxlength="2000" placeholder="Please include as much detail as you can, such as dates, amounts or reference numbers." style="resize:vertical"></textarea></label>
    <div id="supErr" class="gate-msg" role="alert"></div>
    <button class="send-btn" id="supSend" style="width:100%;margin-top:6px" onclick="sendSupportRequest()"><i class="fa-solid fa-paper-plane"></i> Send to Support</button>`;
  m.classList.remove('hidden');
}
function sendSupportRequest() {
  const g = (id) => document.getElementById(id), err = g('supErr'); err.style.color = ''; err.textContent = '';
  const email = g('supEmail').value.trim(), message = g('supMsg').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Please enter a valid email address so we can reply to you.'; g('supEmail').focus(); return; }
  if (message.length < 10) { err.textContent = 'Please describe your question or issue in a little more detail.'; g('supMsg').focus(); return; }
  g('supSend').disabled = true; g('supSend').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
  socket.emit('submit-support-request', { groupId: activeGroupId, name: g('supName').value.trim(), email, topic: g('supTopic').value, message });
}
socket.on('support-request-result', (r) => {
  const body = document.getElementById('supportBody'); if (!body) return;
  if (r && r.ok) {
    body.innerHTML = `<div class="rc-lock" style="padding:18px 6px 6px"><div class="ic" style="color:#4ade80;background:rgba(74,222,128,.12);border-color:rgba(74,222,128,.4)"><i class="fa-solid fa-check"></i></div><h3>Your message has been sent</h3><p>Thank you. Our Support team has your request and will reply to the email address you gave. A confirmation is on its way to you.</p><p style="margin-top:-6px"><b translate="no" id="supRef">${v38Esc(r.ref)}</b><br><small>Your reference number</small></p><button class="send-btn" onclick="closeModal('supportModal')">Done</button></div>`;
    return;
  }
  const err = document.getElementById('supErr'), btn = document.getElementById('supSend');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send to Support'; }
  if (err) { err.style.color = ''; err.textContent = (r && r.error) || 'We could not send your message. Please try again.'; }
});
// Help page: a direct way to open the popup
const _helpV38 = typeof renderHelp === 'function' ? renderHelp : null;
if (_helpV38) renderHelp = function () { _helpV38(); const b = document.getElementById('txHelpBody'); if (b && !document.getElementById('helpOpenSupport')) b.insertAdjacentHTML('afterbegin', '<div class="sec-card" id="helpOpenSupport"><h3><i class="fa-solid fa-headset"></i> Write to Support</h3><p class="sec-sub">Send us a question or complaint without leaving the app.</p><button class="send-btn" onclick="openSupportModal()"><i class="fa-solid fa-paper-plane"></i> Contact Support</button></div>'); };

// ====================================================================
// 3. Desk (admin): receiving accounts, per-seller details, support inbox
// ====================================================================
let bankState = null;
socket.on('bank-profiles', (d) => { bankState = d || null; renderBankAdmin(); });
socket.on('auto-email-state', () => { socket.emit('get-bank-profiles'); socket.emit('get-support-requests'); });
const BK_ORDER = ['holder', 'bankName', 'bankAddress', 'swift', 'accountNumber', 'routing', 'sortCode', 'iban'];
const BK_PH = { USD: { swift: 'e.g. MRMDUS33', routing: '9 digits', accountNumber: 'Account number' }, EUR: { swift: 'e.g. HBUKGB4B', iban: 'e.g. DE89 3704 …' }, GBP: { swift: 'e.g. HBUKGB4B', sortCode: '00-00-00', accountNumber: '8 digits', iban: 'optional' } };
function bkInputs(ccy, schema, labels, vals, prefix) {
  const fields = BK_ORDER.filter((f) => schema.req.includes(f) || schema.opt.includes(f));
  return fields.map((f) => `<label>${v38Esc(labels[f])}${schema.opt.includes(f) ? ' (optional)' : ''}<input class="message-input" data-${prefix}="${ccy}.${f}" value="${v38Esc((vals && vals[f]) || '')}" placeholder="${v38Esc((BK_PH[ccy] || {})[f] || '')}" spellcheck="false" autocomplete="off" translate="no"></label>`).join('');
}
function renderBankAdmin() {
  const host = document.getElementById('tabControls'); if (!host || !bankState) return;
  const sec = Object.keys(bankState.schema).map((c) => { const p = bankState.profiles[c]; return `<div class="bk-ccy">${c} <em class="${p.configured ? 'ok' : ''}">${p.configured ? 'configured' : 'not set'}</em></div><div class="bk-grid">${bkInputs(c, bankState.schema[c], bankState.labels, p.fields, 'bk')}</div>`; }).join('');
  const html = `<div class="ctrl-row" style="margin-bottom:6px"><div><b><i class="fa-solid fa-building-columns"></i> Receiving accounts</b><small>Enter the REAL account your bank issued for each currency (for example your HSBC USA, HSBC UK and euro accounts). Verified sellers registered in that currency see these details together with their own Account ID as the payment reference, so you can match every payment to the right seller. Every field is checked (IBAN check digits, ABA routing digit, UK sort code and account format). Until a currency is set, sellers see "being prepared". Leave a currency completely blank to remove it.</small></div></div>${sec}<button class="send-btn" onclick="saveBankProfiles()"><i class="fa-solid fa-floppy-disk"></i> Save receiving accounts</button>`;
  let box = document.getElementById('banksBox');
  if (!box) host.insertAdjacentHTML('afterbegin', `<div class="widget-card" id="banksBox">${html}</div>`); else box.innerHTML = html;
}
function saveBankProfiles() {
  const out = {}; document.querySelectorAll('#banksBox [data-bk]').forEach((i) => { const [c, f] = i.dataset.bk.split('.'); (out[c] = out[c] || {})[f] = i.value.trim(); });
  socket.emit('admin-set-bank-profiles', { profiles: out });
}
// per-seller section inside the seller profile
let spRecv = null;
socket.on('seller-profile', ({ groupId }) => {
  setTimeout(() => {
    const body = document.getElementById('spBody'); if (!body || document.getElementById('sellerProfileModal').classList.contains('hidden')) return;
    if (!document.getElementById('spReceiving')) body.insertAdjacentHTML('beforeend', '<div class="widget-card" id="spReceiving" style="margin-top:12px"><p class="ledger-empty">Loading receiving details…</p></div>');
    socket.emit('admin-get-seller-receiving', { groupId });
  }, 60);
});
socket.on('admin-seller-receiving', (d) => {
  spRecv = d; const box = document.getElementById('spReceiving'); if (!box || !d) return;
  if (!d.supported) { box.innerHTML = '<b><i class="fa-solid fa-building-columns"></i> Receiving account</b><p class="reg-note">This seller’s currency has no receiving-account template.</p>'; return; }
  const src = d.source === 'seller' ? 'This seller has their own account details (below).' : d.source === 'desk' ? 'Showing the Desk’s global ' + d.currency + ' account with this seller’s Account ID as the payment reference.' : d.source === 'sample' ? 'Demo mode: sample details are showing.' : (d.verified ? 'Nothing is set for ' + d.currency + ' yet, so the seller sees "being prepared".' : 'The seller is not identity-verified yet, so they see nothing.');
  box.innerHTML = `<div class="ctrl-row" style="margin-bottom:6px"><div><b><i class="fa-solid fa-building-columns"></i> Receiving account (${v38Esc(d.currency)})</b><small>${v38Esc(src)} To give this seller their own account, enter the details your bank issued for them. Real details only.</small></div></div>
    <div class="bk-grid">${bkInputs(d.currency, d.schema, d.labels, d.override || {}, 'sr')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="send-btn" onclick="saveSellerReceiving('${v38Esc(d.groupId)}')"><i class="fa-solid fa-floppy-disk"></i> Save for this seller</button>${d.override ? `<button class="admin-btn" onclick="socket.emit('admin-clear-seller-receiving',{groupId:'${v38Esc(d.groupId)}'})"><i class="fa-solid fa-rotate-left"></i> Use the global account</button>` : ''}</div>`;
});
function saveSellerReceiving(groupId) {
  const f = {}; document.querySelectorAll('#spReceiving [data-sr]').forEach((i) => { f[i.dataset.sr.split('.')[1]] = i.value.trim(); });
  socket.emit('admin-set-seller-receiving', { groupId, fields: f });
}
// support inbox
let supportList = [];
socket.on('support-requests', (d) => { supportList = (d && d.list) || []; renderSupportAdmin(); });
socket.on('support-request-new', (t) => { supportList.unshift(t); renderSupportAdmin(); if (typeof toast === 'function') toast(`New support request ${t.ref} from ${t.name || t.email}`); });
function renderSupportAdmin() {
  const host = document.getElementById('tabControls'); if (!host) return;
  const open = supportList.filter((t) => !t.resolved).length;
  const rows = supportList.slice(0, 30).map((t) => `<div class="sup-row ${t.resolved ? 'done' : ''}"><div class="sup-top"><b translate="no">${v38Esc(t.ref)}</b><span class="sup-tag">${v38Esc(t.topic)}</span><small>${v38Esc(new Date(t.createdAt).toLocaleString())}</small><label class="ls-switch" title="Mark resolved"><input type="checkbox" ${t.resolved ? 'checked' : ''} onchange="socket.emit('admin-resolve-support-request',{ref:'${v38Esc(t.ref)}',resolved:this.checked})"><i></i></label></div><div class="sup-who">${v38Esc(t.name || '')} · <a href="mailto:${v38Esc(t.email)}">${v38Esc(t.email)}</a>${t.accountId ? ' · Account ' + v38Esc(t.accountId) : ''}</div><div class="sup-msg">${v38Esc(t.message)}</div></div>`).join('');
  const html = `<div class="ctrl-row" style="margin-bottom:6px"><div><b><i class="fa-solid fa-headset"></i> Support requests ${open ? `<span class="sup-badge">${open} open</span>` : ''}</b><small>Everything sellers send from the Support button also arrives in your support email inbox.</small></div></div>${rows || '<p class="ledger-empty">No requests yet.</p>'}`;
  let box = document.getElementById('supportBox');
  if (!box) host.insertAdjacentHTML('afterbegin', `<div class="widget-card" id="supportBox">${html}</div>`); else box.innerHTML = html;
}

// first paint: apply the cached style (landing page, link pages)
v38safe(() => applyStyle(wpCurrent, false));
