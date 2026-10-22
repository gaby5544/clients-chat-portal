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
// 2. Seller screen: Accounts page + bottom bar + style button
// ====================================================================
v38safe(() => {
  const view = document.getElementById('txAccountView'); if (!view) return;
  // sidebar entry (kept next to Transactions) + page container
  const nav = view.querySelector('.tx-nav');
  if (nav && !nav.querySelector('[data-txnav="accounts"]')) {
    const b = document.createElement('button'); b.className = 'tx-nav-item'; b.dataset.txnav = 'accounts'; b.onclick = () => setTxAccountNav('accounts');
    b.innerHTML = '<i class="fa-solid fa-building-columns"></i> Accounts';
    const tr = nav.querySelector('[data-txnav="transactions"]'); nav.insertBefore(b, tr || null);
  }
  const scroll = view.querySelector('.tx-scroll');
  if (scroll && !document.getElementById('txPageAccounts')) scroll.insertAdjacentHTML('beforeend', '<div class="tx-page hidden" id="txPageAccounts"><div id="txAccountsBody"></div></div>');
  TX_NAV_TITLES.accounts = ['Accounts', 'The details people use to send money to you.'];
  // bottom bar
  if (!document.getElementById('txBottomNav')) {
    view.insertAdjacentHTML('beforeend', `<nav class="tx-bottomnav" id="txBottomNav" aria-label="Main">
      <button type="button" data-bn="dashboard"><i class="fa-solid fa-house"></i>Home</button>
      <button type="button" data-bn="withdraw"><i class="fa-solid fa-right-left"></i>Transfer</button>
      <button type="button" data-bn="accounts"><i class="fa-solid fa-building-columns"></i>Accounts</button>
      <button type="button" data-bn="profile"><i class="fa-solid fa-user"></i>Profile</button></nav>`);
    document.getElementById('txBottomNav').addEventListener('click', (e) => { const b = e.target.closest('[data-bn]'); if (b) setTxAccountNav(b.dataset.bn); });
  }
  // style button in the top bar
  const right = view.querySelector('.tx-topbar-right');
  if (right && !document.getElementById('txStyleBtn')) right.insertAdjacentHTML('afterbegin', '<button class="icon-btn" id="txStyleBtn" title="Change style" aria-label="Change style" onclick="openStylePicker()"><i class="fa-solid fa-palette"></i></button>');
  // Quick action on the dashboard
  const dep = view.querySelector('#txPageDashboard .admin-btn[onclick*="openTxDepositModal"]');
  if (dep && !document.getElementById('qaReceive')) dep.insertAdjacentHTML('afterend', '<button class="admin-btn" id="qaReceive" style="width:100%; justify-content:center; margin-top:10px;" onclick="setTxAccountNav(\'accounts\')"><i class="fa-solid fa-building-columns"></i> Receive money — my account details</button>');
  // Profile: style row
  const prof = document.getElementById('txPageProfile');
  if (prof && !document.getElementById('txProfileStyleRow')) {
    const last = prof.querySelector('.tx-profile-row:last-of-type');
    const row = '<div class="tx-profile-row" id="txProfileStyleRow"><span>Style</span><b class="style-btn-row"><span class="style-now"></span><button class="admin-btn" onclick="openStylePicker()"><i class="fa-solid fa-palette"></i> Change style</button></b></div>';
    if (last) last.insertAdjacentHTML('afterend', row);
  }
});

const _navV38 = setTxAccountNav;
setTxAccountNav = function (nav) {
  _navV38(nav);
  document.querySelectorAll('#txBottomNav [data-bn]').forEach((b) => b.classList.toggle('active', b.dataset.bn === nav));
  if (nav === 'accounts') { renderAccountsPage(); requestReceiving(); }
};

// ---- Receiving details (shown only after identity approval; no copy buttons) ----
let rcData = null, rcCur = null, rcHide = false, rcLoaded = false;
function requestReceiving() { if (typeof activeGroupId !== 'undefined' && activeGroupId && isSellerUI()) socket.emit('get-receiving-details', { groupId: activeGroupId }); }
socket.on('receiving-details', (d) => { rcData = d || null; rcLoaded = true; if (rcData && rcData.approved) { const ks = Object.keys(rcData.details || {}); if (!rcCur || ks.indexOf(rcCur) < 0) rcCur = ks.indexOf(rcData.currency) > -1 ? rcData.currency : ks[0]; } renderAccountsPage(); });
socket.on('seller-account-state', () => setTimeout(() => {
  syncSellerWp();
  if (isSellerUI()) {
    if (!window.__wpSynced || window.__wpSynced !== activeGroupId) { window.__wpSynced = activeGroupId; socket.emit('get-my-style', { groupId: activeGroupId }); }
    if (sellerAccountState.kyc && sellerAccountState.kyc.status === 'verified') requestReceiving(); else { rcData = { approved: false, status: sellerAccountState.kyc && sellerAccountState.kyc.status }; rcLoaded = true; renderAccountsPage(); }
  }
}, 0));

function rcMask(v) { return String(v).replace(/[0-9A-Z]/g, (c, i, s) => (i < s.length - 4 ? '•' : c)); }
function renderAccountsPage() {
  const host = document.getElementById('txAccountsBody'); if (!host) return;
  const a = sellerAccountState || {};
  if (!rcLoaded) { host.innerHTML = '<div class="rc-wrap"><div class="rc-skel"><i class="fa-solid fa-spinner fa-spin"></i> Loading your account details…</div></div>'; return; }
  if (!rcData || !rcData.approved) {
    const st = (rcData && rcData.status) || (a.kyc && a.kyc.status) || 'not_submitted';
    const pending = st === 'pending', rejected = st === 'rejected';
    host.innerHTML = `<div class="rc-wrap"><div class="rc-lock"><div class="ic"><i class="fa-solid fa-${pending ? 'hourglass-half' : 'lock'}"></i></div>
      <h3>${pending ? 'Your verification is being reviewed' : rejected ? 'Verification needs your attention' : 'Your account details are almost ready'}</h3>
      <p>${pending ? 'As soon as your identity is approved, your account numbers and bank details appear here automatically.' : rejected ? 'Please resubmit your documents. Your account details will appear here once your identity is approved.' : 'Verify your identity once, and your account numbers and bank details will appear here so people anywhere can send you money.'}</p>
      ${pending ? '' : '<button class="send-btn" onclick="openTxKycWizard()"><i class="fa-solid fa-id-card"></i> ' + (rejected ? 'Resubmit documents' : 'Verify identity') + '</button>'}</div></div>`;
    return;
  }
  const ccy = a.currency || 'USD', bal = a.balances ? a.balances.available : 0;
  const d = rcData.details[rcCur] || rcData.details[Object.keys(rcData.details)[0]];
  const tabs = Object.keys(rcData.details).map((c) => `<button type="button" class="rc-tab ${c === rcCur ? 'on' : ''}" onclick="rcPick('${c}')">${v38Esc(rcData.details[c].symbol)} ${c}</button>`).join('');
  const grp = (title, rows, gi) => `<div class="rc-grp"><div class="rc-gt">${title}</div>${rows.map((r) => { const sens = /account number|iban/i.test(r[0]); const val = rcHide && sens ? rcMask(r[1]) : r[1]; return `<div class="rc-row"><span>${v38Esc(r[0])}</span><b translate="no">${v38Esc(val)}</b></div>`; }).join('')}</div>`;
  host.innerHTML = `<div class="rc-wrap" id="rcCard">
    <div class="rc-hd"><div class="rc-brand"><b>V</b><span>VISTRA</span></div>
      <div class="rc-balrow"><div><small>Available balance</small><div class="rc-bal" translate="no">${rcHide ? '••••••••' : v38Esc(fmtMoney(bal, ccy))}</div></div>
        <button class="rc-eye" type="button" onclick="rcToggleHide()" aria-label="${rcHide ? 'Show details' : 'Hide details'}"><i class="fa-solid fa-${rcHide ? 'eye-slash' : 'eye'}"></i></button></div>
      <div class="rc-badges"><span class="rc-tier">${v38Esc(a.accountTypeLabel || 'Standard')}</span><span class="rc-ok"><i class="fa-solid fa-shield-halved"></i> Verified</span><span class="rc-nm">${v38Esc(rcData.holder || a.fullName || '')}</span></div></div>
    <div class="rc-title">Receive money</div>
    <div class="rc-tabs" role="tablist">${tabs}</div>
    <div class="rc-intro">${v38Esc(d.intro)}</div>
    ${grp('Account holder details', d.a, 0)}${grp('Bank details', d.b, 1)}
    <div class="rc-note"><i class="fa-solid fa-circle-info" style="margin-top:2px"></i><div>${v38Esc(d.note)}</div></div>
    <div class="rc-actions"><button type="button" onclick="rcPrint()"><i class="fa-solid fa-file-pdf"></i> Save as PDF</button></div>
    <div class="rc-foot ${d.sample ? 'sample' : ''}"><i class="fa-solid fa-lock"></i> Protected with 256-bit encryption${d.sample ? ' · Sample data only' : ''}</div></div>`;
}
function rcPick(c) { rcCur = c; renderAccountsPage(); }
function rcToggleHide() { rcHide = !rcHide; renderAccountsPage(); }
function rcPrint() { document.body.classList.add('print-details'); const done = () => { document.body.classList.remove('print-details'); window.removeEventListener('afterprint', done); }; window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50); }

// keep the style swatch on the Profile page current
const _profV38 = typeof renderTxProfile === 'function' ? renderTxProfile : null;
if (_profV38) renderTxProfile = function () { _profV38(); const s = document.querySelector('#txProfileStyleRow .style-now'); if (s) s.style.backgroundImage = `url(/wallpapers/wp${wpCurrent}-thumb.webp)`; };

// ====================================================================
// 3. Admin: receiving bank details (Controls)
// ====================================================================
let bankProfiles = null;
socket.on('bank-profiles', (d) => { bankProfiles = d && d.profiles; renderBankAdmin(); });
socket.on('auto-email-state', () => socket.emit('get-bank-profiles'));
const BK_LABELS = { bankName: 'Bank name', bankAddress: 'Bank address', swift: 'SWIFT / BIC', routing: 'ABA routing (9 digits)', bankCode: 'Bank code (8 digits)', sortCode: 'Sort code (00-00-00)', ibanBank: 'IBAN bank code (4 letters)' };
const BK_FIELDS = { USD: ['bankName', 'bankAddress', 'swift', 'routing'], EUR: ['bankName', 'bankAddress', 'swift', 'bankCode'], GBP: ['bankName', 'bankAddress', 'swift', 'sortCode', 'ibanBank'] };
function renderBankAdmin() {
  const host = document.getElementById('tabControls'); if (!host || !bankProfiles) return;
  const sec = Object.keys(BK_FIELDS).map((c) => { const p = bankProfiles[c]; return `<div class="bk-ccy">${c} ${p.sample ? '<em>sample — replace</em>' : ''}</div><div class="bk-grid">${BK_FIELDS[c].map((f) => `<label>${BK_LABELS[f]}<input class="message-input" data-bk="${c}.${f}" value="${v38Esc(p[f] || '')}" spellcheck="false" translate="no"></label>`).join('')}</div>`; }).join('');
  const html = `<div class="ctrl-row" style="margin-bottom:6px"><div><b><i class="fa-solid fa-building-columns"></i> Receiving bank details</b><small>The bank details sellers see on their Accounts page once identity is approved. Each seller's own account number / IBAN is generated automatically and frozen. Enter your real partner-bank details; until you save, sellers see a "Sample data only" label.</small></div></div>${sec}<button class="send-btn" onclick="saveBankProfiles()"><i class="fa-solid fa-floppy-disk"></i> Save bank details</button>`;
  let box = document.getElementById('banksBox');
  if (!box) host.insertAdjacentHTML('afterbegin', `<div class="widget-card" id="banksBox">${html}</div>`); else box.innerHTML = html;
}
function saveBankProfiles() {
  const out = {}; document.querySelectorAll('[data-bk]').forEach((i) => { const [c, f] = i.dataset.bk.split('.'); (out[c] = out[c] || {})[f] = i.value.trim(); });
  socket.emit('admin-set-bank-profiles', { profiles: out });
}

// first paint for returning sellers: apply the cached style to the landing page straight away
v38safe(() => applyStyle(wpCurrent, false));
