/* v3.2 client layer — loaded after v31.js. Adds / replaces behaviour; later function declarations win. */

// ====================================================================
// 0. Local flag images (no outside CDN — works on every PC, phone and offline-first install)
// ====================================================================
function flagHtml(iso, name) {
  if (!iso) return '';
  const lc = String(iso).toLowerCase().replace(/[^a-z-]/g, '');
  return `<img class="flag" alt="${escapeHtml(name || iso)}" loading="lazy" src="/vendor/flags/${lc}.svg" onerror="flagFail(this,'${lc.toUpperCase()}')">`;
}

// ====================================================================
// 1. Dead invite links: the server says "expired" -> show only the expired page
// ====================================================================
socket.on('link-expired', () => {
  // The Desk Officer / admin entry must never be sent to the "expired" page (e.g. while the default group is deleted).
  if (new URLSearchParams(location.search).has('officer') || sessionStorage.getItem('q_admin_reveal') === '1' || (typeof isAdminConfirmed !== 'undefined' && isAdminConfirmed)) return;
  try { socket.disconnect(); } catch (e) { /* ignore */ } location.replace('/expired');
});

// ====================================================================
// 2. Installed-app start screen: no invite link => professional sign-in screen (never a group)
// ====================================================================
let contactInfo = { support: '', complaints: '' };
fetch('/api/contact').then(r => r.json()).then(c => { contactInfo = c; const n = el('gateSupport'); if (n) n.textContent = c.support; }).catch(() => {});
const isStandaloneApp = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function buildGate() {
  if (el('appGate')) return;
  const seenSplash = sessionStorage.getItem('q_splash_done') === '1';
  document.body.insertAdjacentHTML('afterbegin', `
  <div id="appSplash" class="app-splash ${seenSplash ? 'hidden' : ''}">
    <div class="sp-stage"><div class="sp-ring r1"></div><div class="sp-ring r2"></div><div class="sp-ring r3"></div>
      <div class="sp-mark"><i class="fa-solid fa-shield-halved"></i></div></div>
    <div class="sp-name"><span>V</span><span>I</span><span>S</span><span>T</span><span>R</span><span>A</span></div>
    <div class="sp-tag">Secure Transaction Desk</div>
    <div class="sp-load"><div class="sp-bar"><i></i></div><div class="sp-msg" id="spMsg">Establishing secure connection…</div></div>
  </div>
  <div id="appGate" class="app-gate">
    <div class="gate-card">
      <div class="gate-brand"><div class="gate-mark"><i class="fa-solid fa-shield-halved"></i></div>
        <div class="gate-name">VISTRA</div><div class="gate-tag">Secure Transaction Desk</div></div>

      <div class="gv" id="gvWelcome">
        <h1>Welcome</h1><p class="gate-sub">Your transactions, protected end to end. Sign in to continue, or create your account to begin.</p>
        <button class="gate-btn" onclick="gateShow('signin')"><i class="fa-solid fa-right-to-bracket"></i> Sign in</button>
        <button class="gate-btn ghost" onclick="gateShow('role')"><i class="fa-solid fa-user-plus"></i> Create account</button>
        <div class="gate-trust"><span><i class="fa-solid fa-lock"></i> Encrypted</span><span><i class="fa-solid fa-fingerprint"></i> Verified</span><span><i class="fa-solid fa-vault"></i> Escrow-protected</span></div>
      </div>

      <div class="gv hidden" id="gvSignin">
        <button class="gate-back" onclick="gateShow('welcome')"><i class="fa-solid fa-chevron-left"></i> Back</button>
        <h1>Sign in</h1><p class="gate-sub">Use the email and password you created for your account.</p>
        <label class="gate-field"><span>Email address</span><input id="gateEmail" type="email" inputmode="email" autocomplete="username" placeholder="you@example.com"></label>
        <label class="gate-field"><span>Password</span><div class="gate-pw"><input id="gatePassword" type="password" autocomplete="current-password" placeholder="Your password"><button type="button" onclick="togglePw('gatePassword', this)" aria-label="Show password"><i class="fa-solid fa-eye"></i></button></div></label>
        <div id="gateMsg" class="gate-msg"></div>
        <button class="gate-btn" id="gateBtn" onclick="gateLogin()">Sign in securely</button>
        <button class="gate-link" onclick="openLoginModal(); showForgot()">Forgot your password?</button>
      </div>

      <div class="gv hidden" id="gvRole">
        <button class="gate-back" onclick="gateShow('welcome')"><i class="fa-solid fa-chevron-left"></i> Back</button>
        <h1>Create your account</h1><p class="gate-sub">Choose how you are taking part in your transaction.</p>
        <button class="next-card" onclick="gateStartCreate('BUYER')"><span class="next-ico cyan"><i class="fa-solid fa-cart-shopping"></i></span><span class="next-text"><b>I am the Buyer</b><small>Create your password and go straight to your transaction group.</small></span><i class="fa-solid fa-chevron-right"></i></button>
        <button class="next-card" onclick="gateStartCreate('SELLER')"><span class="next-ico violet"><i class="fa-solid fa-store"></i></span><span class="next-text"><b>I am the Seller</b><small>Open your Transaction Account, verify your identity and get paid securely.</small></span><i class="fa-solid fa-chevron-right"></i></button>
      </div>

      <div class="gv hidden" id="gvCreate1">
        <button class="gate-back" onclick="gateShow('role')"><i class="fa-solid fa-chevron-left"></i> Back</button>
        <h1 id="gcTitle">Your email</h1><p class="gate-sub" id="gcSub">Enter the email address your Desk Officer registered for this transaction.</p>
        <label class="gate-field"><span>Email address</span><input id="gcEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"></label>
        <div id="gcMsg1" class="gate-msg"></div>
        <button class="gate-btn" id="gcBtn1" onclick="gateCreateNext()">Continue</button>
      </div>

      <div class="gv hidden" id="gvCreate2">
        <button class="gate-back" onclick="gateShow('create1')"><i class="fa-solid fa-chevron-left"></i> Back</button>
        <h1>Verify and secure</h1><p class="gate-sub">We sent a 6-digit code to <b id="gcSent"></b>. Enter it, then choose a strong password.</p>
        <label class="gate-field"><span>Verification code</span><input id="gcCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456"></label>
        <label class="gate-field"><span>Create password</span><div class="gate-pw"><input id="gcPw" type="password" autocomplete="new-password" placeholder="At least 8 characters, letters and numbers"><button type="button" onclick="togglePw('gcPw', this)" aria-label="Show password"><i class="fa-solid fa-eye"></i></button></div></label>
        <label class="gate-field"><span>Confirm password</span><input id="gcPw2" type="password" autocomplete="new-password" placeholder="Re-enter your password"></label>
        <div id="gcMsg2" class="gate-msg"></div>
        <button class="gate-btn" id="gcBtn2" onclick="gateCreateFinish()">Create account &amp; enter</button>
      </div>

      <div class="gv hidden" id="gvPick"><h1>Choose your account</h1><p class="gate-sub">This email has more than one Transaction Account.</p><div id="gatePickList"></div></div>

      <div class="gate-foot">
        <button class="gate-install hidden" id="gateInstall" onclick="installApp()"><i class="fa-solid fa-download"></i> Install the app on this device</button>
        <p class="gate-help">Need help? <b id="gateSupport">${escapeHtml(contactInfo.support || '')}</b></p>
      </div>
    </div>
  </div>`);
  ['gateEmail', 'gatePassword'].forEach(id => el(id).addEventListener('keydown', e => { if (e.key === 'Enter') gateLogin(); }));
  el('gcEmail').addEventListener('keydown', e => { if (e.key === 'Enter') gateCreateNext(); });
  if (deferredInstall || (isIos && !isStandaloneApp())) el('gateInstall').classList.remove('hidden');
  runSplash(seenSplash);
}
function gateShow(v) {
  document.querySelectorAll('#appGate .gv').forEach(n => n.classList.add('hidden'));
  el('gv' + v.charAt(0).toUpperCase() + v.slice(1)).classList.remove('hidden');
  const first = document.querySelector('#gv' + v.charAt(0).toUpperCase() + v.slice(1) + ' input'); if (first && window.innerWidth > 700) setTimeout(() => first.focus(), 60);
}
function runSplash(skip) {
  const sp = el('appSplash'); if (!sp) return;
  if (skip) { sp.remove(); return; }
  const msgs = ['Establishing secure connection…', 'Verifying device integrity…', 'Preparing your transaction desk…'];
  let i = 0; const m = el('spMsg'); const t = setInterval(() => { i = Math.min(i + 1, msgs.length - 1); if (m) m.textContent = msgs[i]; }, 950);
  setTimeout(() => { clearInterval(t); sp.classList.add('out'); sessionStorage.setItem('q_splash_done', '1'); setTimeout(() => sp.remove(), 700); }, 3100);
}
let gcRole = 'BUYER', gcEmailVal = '';
function gateStartCreate(role) {
  gcRole = role; el('gcMsg1').textContent = '';
  el('gcTitle').textContent = role === 'BUYER' ? 'Create your buyer account' : 'Create your seller account';
  el('gcSub').textContent = role === 'BUYER' ? 'Enter the email address your Desk Officer registered for this transaction. We will send you a code to confirm it is you.' : 'Enter the email address your Desk Officer registered for you. We will take you to open your Transaction Account.';
  gateShow('create1');
}
async function gateCreateNext() {
  const email = el('gcEmail').value.trim(), msg = el('gcMsg1'), b = el('gcBtn1'); msg.textContent = '';
  if (!isValidEmailClient(email)) { msg.textContent = 'Enter a valid email address.'; return; }
  b.disabled = true; b.textContent = 'Checking…';
  const r = await postJson('/api/app/lookup', { email, role: gcRole });
  if (!r.ok) { b.disabled = false; b.textContent = 'Continue'; msg.textContent = r.data.error || 'We could not find your transaction.'; return; }
  if (gcRole === 'SELLER') {
    if (r.data.exists) { b.disabled = false; b.textContent = 'Continue'; msg.textContent = 'You already have an account — please sign in.'; return; }
    location.href = `/?groupId=${encodeURIComponent(r.data.groupId)}&role=SELLER`; return;
  }
  const c = await postJson('/api/buyer/request-code', { email });
  b.disabled = false; b.textContent = 'Continue';
  if (!c.ok) { msg.textContent = c.data.error || 'We could not send the code. Please try again.'; return; }
  gcEmailVal = email; el('gcSent').textContent = email; el('gcMsg2').textContent = '';
  gateShow('create2');
}
async function gateCreateFinish() {
  const code = el('gcCode').value.trim(), pw = el('gcPw').value, pw2 = el('gcPw2').value, msg = el('gcMsg2'), b = el('gcBtn2'); msg.textContent = '';
  if (!/^\d{6}$/.test(code)) { msg.textContent = 'Enter the 6-digit code from your email.'; return; }
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) { msg.textContent = 'Use at least 8 characters with letters and numbers.'; return; }
  if (pw !== pw2) { msg.textContent = 'The passwords do not match.'; return; }
  b.disabled = true; b.textContent = 'Creating your account…';
  const r = await postJson('/api/buyer/register', { email: gcEmailVal, code, password: pw });
  if (!r.ok) { b.disabled = false; b.textContent = 'Create account & enter'; msg.textContent = r.data.error || 'Something went wrong.'; return; }
  sessionStorage.setItem('q_session_token', r.data.sessionToken);
  location.href = `/?groupId=${encodeURIComponent(r.data.groupId)}&role=BUYER`;
}
async function gateLogin() {
  const email = el('gateEmail').value.trim(), password = el('gatePassword').value, msg = el('gateMsg');
  msg.textContent = '';
  if (!isValidEmailClient(email) || !password) { msg.textContent = 'Enter your email and password.'; return; }
  const b = el('gateBtn'); b.disabled = true; b.textContent = 'Signing in…';
  const r = await postJson('/api/auth/login', { email, password });
  b.disabled = false; b.textContent = 'Sign in securely';
  if (!r.ok) { msg.textContent = r.data.error || 'Sign in failed.'; return; }
  sessionStorage.setItem('q_session_token', r.data.sessionToken);
  if (r.data.language) localStorage.setItem('q_lang', r.data.language);
  if (r.data.multiple) {
    gateShow('pick');
    el('gatePickList').innerHTML = r.data.accounts.map(a => `<button class="next-card" onclick="location.href='/?groupId=${encodeURIComponent(a.groupId)}&role=SELLER'"><span class="next-ico cyan"><i class="fa-solid fa-briefcase"></i></span><span class="next-text"><b>Account ${escapeHtml(a.accountId || '—')}</b><small>${a.disabled ? 'Disabled' : 'Active'}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('');
    return;
  }
  location.href = `/?groupId=${encodeURIComponent(r.data.groupId)}&role=${r.data.role === 'BUYER' ? 'BUYER' : 'SELLER'}`;
}
if (window.__holdJoin) {
  buildGate();
  if (new URLSearchParams(location.search).has('forgot')) { gateShow('signin'); openLoginModal(); showForgot(); }
}

// ====================================================================
// 3. Install banner (Android / PC Chrome-Edge: one tap; iPhone: guided)
// ====================================================================
window.addEventListener('beforeinstallprompt', () => { const g = el('gateInstall'); if (g) g.classList.remove('hidden'); setTimeout(maybeShowInstallBanner, 1800); });
function maybeShowInstallBanner() {
  if (isStandaloneApp() || window.__holdJoin || el('installBanner')) return;
  const until = Number(localStorage.getItem('q_install_snooze') || 0);
  if (Date.now() < until) return;
  if (!deferredInstall && !(isIos)) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="installBanner" class="install-banner"><div class="ib-ico"><i class="fa-solid fa-mobile-screen-button"></i></div><div class="ib-txt"><b>Get the Vistra app</b><small>Install it for faster, full-screen, more secure access.</small></div><button class="ib-go" onclick="installApp(); hideInstallBanner()">Install</button><button class="ib-x" onclick="hideInstallBanner(true)" aria-label="Dismiss">&times;</button></div>`);
}
function hideInstallBanner(snooze) { const b = el('installBanner'); if (b) b.remove(); if (snooze) localStorage.setItem('q_install_snooze', String(Date.now() + 7 * 864e5)); }
if (isIos) setTimeout(maybeShowInstallBanner, 4000);
window.addEventListener('appinstalled', () => hideInstallBanner());

// ====================================================================
// 4. Registration -> next step, with no waiting around
// ====================================================================
let regWatch = null, nextStepShown = false;
function showNextStepPage(accountId, fullName) {
  clearTimeout(regWatch); hideRegBusy();
  if (nextStepShown) return; nextStepShown = true;
  closeModal('txRegModal');
  const first = String(fullName || (sellerAccountState && sellerAccountState.fullName) || '').trim();
  const t = el('nextStepTitle'); if (t) t.textContent = first ? `Welcome, ${first.split(/\s+/)[0]} — your account is ready` : 'Your account is ready';
  el('nextStepAccountId').textContent = accountId || (sellerAccountState && sellerAccountState.accountId) || '—';
  openModal('nextStepModal');
}
function showRegBusy() {
  if (el('regBusy')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="regBusy" class="reg-busy"><div class="rb-card"><div class="rb-spin"></div><b>Creating your secure account…</b><small>This only takes a moment. Please do not close this page.</small></div></div>`);
}
function hideRegBusy() { const b = el('regBusy'); if (b) b.remove(); }
socket.off('transaction-account-created');
socket.on('transaction-account-created', ({ accountId, fullName }) => showNextStepPage(accountId, fullName));
// Safety net 1: the account state arrives as "registered" while the form is still open -> move on at once.
socket.on('seller-account-state', (a) => { if (a && a.registered && !el('txRegModal').classList.contains('hidden')) showNextStepPage(a.accountId, a.fullName); });
// Safety net 2: "already created" means it WAS created (e.g. a reply was lost on a weak connection) -> fetch it and move on.
socket.on('error-msg', (m) => { if (/already been created/i.test(String(m)) && !el('txRegModal').classList.contains('hidden')) { socket.emit('get-my-seller-account', { groupId: activeGroupId }); setTimeout(() => { if (sellerAccountState && sellerAccountState.registered) showNextStepPage(sellerAccountState.accountId, sellerAccountState.fullName); }, 900); } });
const _submitReg = submitTxRegistration;
submitTxRegistration = function () {
  const before = el('txRegSubmitBtn').disabled;
  _submitReg();
  if (before || !el('txRegSubmitBtn').disabled) return;     // validation failed -> the original already showed why
  showRegBusy(); nextStepShown = false;
  clearTimeout(regWatch);
  regWatch = setTimeout(() => { socket.emit('get-my-seller-account', { groupId: activeGroupId }); regWatch = setTimeout(() => { hideRegBusy(); if (sellerAccountState && sellerAccountState.registered) showNextStepPage(sellerAccountState.accountId, sellerAccountState.fullName); else toast('This is taking longer than usual. Please check your connection and tap Create Account again.', true); }, 4000); }, 6000);
};
socket.on('error-msg', () => { hideRegBusy(); });

// ====================================================================
// 5. Party view (buyer / seller): clean, app-like header; no admin-style dropdowns
// ====================================================================
let brandOrig = null;
function applyPartyChrome() {
  const t = document.querySelector('.brand-title'); if (t && brandOrig === null) brandOrig = t.textContent;
  if (isAdminConfirmed) { document.body.classList.remove('is-party'); if (t && brandOrig) t.textContent = brandOrig; return; }
  document.body.classList.add('is-party');
  if (t) t.textContent = 'VISTRA';
  const s = el('currentGroupName'); if (s) s.textContent = 'Secure Room';
}
socket.on('init-state', () => setTimeout(applyPartyChrome, 0));

// ====================================================================
// 6. Admin: User Directory + Online Users — Admins / Sellers / Buyers kept apart; online rows open the group,
//    offline rows are inert; IP + location shown to Admin / Super Admin only (the server only sends it to them)
// ====================================================================
function openUserGroup(gid) {
  if (!gid || !isAdminConfirmed) return;
  switchGroup(gid);
  if (window.innerWidth < 900) toggleAdminDrawer(false);
}
function netLine(u) {
  if (!u.ip) return '';
  const g = u.geo;
  return `<div class="dir-net" translate="no">${g && g.countryIso ? flagHtml(g.countryIso, g.country) + ' ' + escapeHtml(g.label || g.country) + ' · ' : ''}<span>${escapeHtml(u.ip)}</span></div>`;
}
function userRowHtml(u) {
  const role = u.isAdmin ? 'admin' : (u.role === 'PARTY A' ? 'buyer' : 'seller');
  const label = u.isAdmin ? 'Admin' : (u.role === 'PARTY A' ? 'Buyer' : 'Seller');
  const clickable = u.isOnline && !u.isAdmin && u.groupId;
  return `<div class="directory-item ${u.isOnline ? 'is-online' : 'is-offline'} ${clickable ? 'clickable' : ''}" ${clickable ? `onclick="openUserGroup('${escapeHtml(u.groupId)}')"` : ''}>
    <div class="avatar" style="width:36px;height:36px;font-size:0.85rem;">${initialsOf(u.displayName)}<span class="online-ring ${u.isOnline ? '' : 'off'}"></span></div>
    <div class="directory-meta"><div class="directory-name">${escapeHtml(u.displayName)} ${u.countryIso ? `<span class="flag-inline" title="${escapeHtml(u.country || '')}">${flagHtml(u.countryIso, u.country)}</span>` : ''}</div>
      <div class="directory-role">${u.isOnline ? 'Online' : 'Offline'}${clickable ? ' · tap to open group' : ''}</div>${netLine(u)}</div>
    <span class="role-chip ${role}">${label}</span>
    ${u.uid !== myUid() ? `<i class="fa-solid fa-trash directory-delete-btn" onclick="event.stopPropagation(); deleteDirectoryUser('${u.uid}')" title="Remove from directory"></i>` : ''}</div>`;
}
renderDirectory = function () {
  const query = (el('directorySearchInput').value || '').toLowerCase();
  const filtered = directoryCache.filter(u => u.displayName.toLowerCase().includes(query)).sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));
  const groups = { Admins: [], Sellers: [], Buyers: [] };
  filtered.forEach(u => { if (u.isAdmin) groups.Admins.push(u); else if (u.role === 'PARTY A') groups.Buyers.push(u); else groups.Sellers.push(u); });
  let html = '';
  for (const [label, users] of Object.entries(groups)) {
    if (!users.length) continue;
    html += `<div class="directory-section-title">${label} (${users.length})</div>` + users.map(userRowHtml).join('');
  }
  el('directoryContainer').innerHTML = html || '<div style="padding:16px; color:var(--text-muted); font-size:0.85rem;">No users yet.</div>';
  const select = el('activeUsersSelect');
  if (select) select.innerHTML = directoryCache.filter(u => u.uid !== myUid()).map(u => `<option value="${u.uid}">${escapeHtml(u.displayName)} (${u.isAdmin ? 'Admin' : u.role})</option>`).join('');
  const kick = el('kickUserSelect');
  if (kick) kick.innerHTML = directoryCache.filter(u => u.uid !== myUid() && !u.isAdmin && u.isOnline).map(u => `<option value="${u.uid}">${escapeHtml(u.displayName)} (${u.role})</option>`).join('') || '<option value="">No online users to disconnect</option>';
  renderOnlineWidget();
};
let _owBusy = false;
function renderOnlineWidget() {
  const box = el('widgetOnlineUsers'); if (!box || _owBusy || !isAdminConfirmed || !directoryCache.length) return;
  _owBusy = true;
  const on = directoryCache.filter(u => u.isOnline), off = directoryCache.filter(u => !u.isOnline && !u.isAdmin);
  const sec = (title, list) => list.length ? `<div class="ow-title">${title} (${list.length})</div>${list.map(userRowHtml).join('')}` : '';
  box.innerHTML = sec('Admins online', on.filter(u => u.isAdmin)) + sec('Sellers online', on.filter(u => !u.isAdmin && u.role === 'PARTY B')) + sec('Buyers online', on.filter(u => !u.isAdmin && u.role === 'PARTY A'))
    + (off.length ? `<div class="ow-title off">Offline (${off.length})</div>${off.map(userRowHtml).join('')}` : '') || '<div class="empty-state ow-empty" style="padding:16px;"><i class="fa-solid fa-user-slash"></i><span>No one online</span></div>';
  _owBusy = false;
}
{ const owBox = el('widgetOnlineUsers'); if (owBox) new MutationObserver(() => { const f = owBox.firstElementChild; if (!_owBusy && !(f && (f.classList.contains('ow-title') || f.classList.contains('ow-empty')))) renderOnlineWidget(); }).observe(owBox, { childList: true }); }
setInterval(() => { if (isAdminConfirmed) renderOnlineWidget(); }, 5000);

// ====================================================================
// 7. Admin: seller profile — IP locations, sign-in alert switch, link status, password access for any Admin
// ====================================================================
socket.on('seller-profile', ({ groupId, account: a }) => {
  const body = el('spBody'); if (!body || el('sellerProfileModal').classList.contains('hidden')) return;
  const geoBy = {}; (a.ips || []).forEach(r => { if (r.geo) geoBy[r.ip] = r.geo; });
  body.querySelectorAll('.ip-row').forEach(row => {
    const ipEl = row.querySelector('.ip'); const g = ipEl && geoBy[ipEl.textContent.trim()];
    if (g && !row.querySelector('.ip-geo')) ipEl.insertAdjacentHTML('afterend', `<span class="ip-geo">${flagHtml(g.countryIso, g.country)} ${escapeHtml(g.label || g.country)}${g.isp ? ' · ' + escapeHtml(g.isp) : ''}</span>`);
  });
  const stale = body.querySelector('input[onchange*="admin-set-password-access"]'); if (stale) stale.closest('label').remove();
  if (!body.querySelector('#spSecurity')) {
    const linkRow = (who, party, expired) => `<div class="sp-link-row"><span>${who} invite link</span><b class="${expired ? 'bad' : 'good'}">${expired ? 'Expired' : 'Active'}</b>${expired ? `<button class="admin-btn" onclick="socket.emit('admin-set-link-revoked',{groupId:'${a.groupId}',party:'${party}',revoked:false}); setTimeout(()=>socket.emit('admin-get-seller-profile',{groupId:'${a.groupId}'}),500)">Re-activate</button>` : ''}</div>`;
    const reports = (a.securityReports || []).slice(-3).map(r => `<div class="reg-note" style="color:var(--accent-rose)">Seller reported a sign-in as NOT them · ${fmtDateTime(r.at)} · ${escapeHtml(r.ip)}</div>`).join('');
    body.querySelector('.sp-grid').insertAdjacentHTML('beforebegin', `<div id="spSecurity" class="sp-security"><div class="sp-sec" style="margin-top:0">Security &amp; access</div>
      <label class="terms-check"><input type="checkbox" ${a.loginAlertsEnabled ? 'checked' : ''} onchange="socket.emit('admin-set-login-alerts',{groupId:'${a.groupId}',enabled:this.checked})"> <span>Email this seller a security alert (time, location, device) on every new sign-in</span></label>
      ${linkRow('Buyer', 'A', a.linkExpired && a.linkExpired.buyer)}${linkRow('Seller', 'B', a.linkExpired && a.linkExpired.seller)}${reports}</div>`);
  }
});

// ====================================================================
// 8. Admin: Record incoming funds — "use default / write my own" on every field, fee payer, release mode
// ====================================================================
const FD = window.FundDefaults;
function rfPrep() {
  if (el('rfDefaultsBar')) return;
  el('recordFundsSellerLabel').closest('p').insertAdjacentHTML('afterend', `<div id="rfDefaultsBar" class="rf-defaults"><span><i class="fa-solid fa-wand-magic-sparkles"></i> Every field below can use a realistic default or your own text.</span><button type="button" class="admin-btn" onclick="rfFillAll()">Fill all with defaults</button></div>`);
  const tag = (id, kind) => { const l = el(id) && el(id).closest('label'); if (l && !l.querySelector('.mini-default')) l.insertAdjacentHTML('afterbegin', `<button type="button" class="mini-default" onclick="rfDefault('${kind}')">Use default</button>`); };
  tag('rfPurpose', 'purpose'); tag('rfBankName', 'bank'); tag('rfSenderAccount', 'sender'); tag('rfExternalRef', 'ref'); tag('rfInternalNote', 'note'); tag('rfFee', 'fee'); tag('rfNetwork', 'network');
  el('rfFee').closest('.two-col').insertAdjacentHTML('afterend', `<label class="branding-field">Who pays the charges
    <select id="rfFeePayer" class="message-input csel" onchange="updateRfPreview()"><option value="buyer">The buyer — charged on top; the seller receives the full amount (default)</option><option value="seller">The seller — deducted from the amount</option><option value="none">No charges</option></select></label>`);
  const opts = el('rfTreatment').options;
  opts[0].textContent = 'Verify with live tracking (incl. phone verification), then hold in vault until I release it (recommended)';
  opts[1].textContent = 'Hold in vault (release manually, no tracking)';
  el('rfShowTimer').closest('label').insertAdjacentHTML('beforebegin', `<label class="terms-check"><input type="checkbox" id="rfAutoRelease"> <span>Release to the seller's main account automatically when tracking finishes (leave unticked to release it yourself from the vault)</span></label>`);
  const note = el('rfTrackBox').querySelector('.reg-note'); if (note) note.textContent = 'The total is split across the six stages automatically (the fifth is a phone verification of the seller); you can fine-tune each stage afterwards from the payment\'s tracker. When every stage is complete the funds stay in the seller\'s vault until you release them. The seller sees only the stage the payment has reached — never the timers.';
}
function rfDefault(kind) {
  const ccy = el('rfCurrency').value, method = el('rfMethod').value;
  if (kind === 'purpose') el('rfPurpose').value = FD.purpose();
  else if (kind === 'bank') el('rfBankName').value = FD.bankName(ccy);
  else if (kind === 'sender') el('rfSenderAccount').value = FD.senderAccount(ccy, el('rfBankName').value.trim() || FD.bankName(ccy));
  else if (kind === 'ref') el('rfExternalRef').value = FD.reference(method);
  else if (kind === 'note') el('rfInternalNote').value = FD.internalNote();
  else if (kind === 'network') el('rfNetwork').value = FD.network(el('rfAsset').value);
  else if (kind === 'fee') { const a = parseFloat(el('rfAmount').value); if (!(a > 0)) return toast('Enter the amount first so the charge can be worked out.', true); el('rfFee').value = FD.charge(a).toFixed(2); }
  updateRfPreview();
}
function rfFillAll() {
  const a = parseFloat(el('rfAmount').value);
  const bank = FD.bankName(el('rfCurrency').value); el('rfBankName').value = el('rfMethod').value === 'crypto' ? '' : bank;
  ['purpose', 'sender', 'ref', 'note'].forEach(rfDefault);
  if (el('rfMethod').value === 'crypto') { el('rfSenderAccount').value = ''; rfDefault('network'); }
  if (a > 0) rfDefault('fee'); else toast('Defaults filled. Enter the amount, then tap "Use default" beside the charge.');
  if (el('rfBankName').value && el('rfMethod').value !== 'crypto') el('rfSenderAccount').value = FD.senderAccount(el('rfCurrency').value, el('rfBankName').value);
}
const _openRf = openRecordFundsModal;
openRecordFundsModal = function () { rfPrep(); _openRf(); el('rfFeePayer').value = 'buyer'; el('rfAutoRelease').checked = false; };
updateRfPreview = function () {
  const amt = parseFloat(el('rfAmount').value), fee = parseFloat(el('rfFee').value) || 0, ccy = el('rfCurrency').value, payer = (el('rfFeePayer') || {}).value || 'buyer';
  const box = el('rfPreview'); if (!(amt > 0)) { box.style.display = 'none'; return; }
  const s = fundsOverviewCache.find(x => x.groupId === fundsDeskGroupId);
  box.style.display = 'block';
  const conv = s && s.currency && s.currency !== ccy ? ` · converted to ${s.currency} on recording` : '';
  if (payer === 'buyer' && fee > 0) box.innerHTML = `Seller is credited: <b>${fmtMoney(amt, ccy)}</b> in full · Buyer pays <b>${fmtMoney(amt + fee, ccy)}</b> in total (${fmtMoney(amt, ccy)} + ${fmtMoney(fee, ccy)} charges)${conv}`;
  else if (payer === 'seller' && fee > 0) box.innerHTML = `Net to seller: <b>${fmtMoney(Math.max(0, amt - fee), ccy)}</b> (after ${fmtMoney(fee, ccy)} charges)${conv}`;
  else box.innerHTML = `Seller is credited: <b>${fmtMoney(amt, ccy)}</b>${conv}`;
};
submitRecordFunds = function () {
  if (!fundsDeskGroupId) return;
  const payerName = el('rfPayerName').value.trim(), purpose = el('rfPurpose').value.trim(), method = el('rfMethod').value, amount = parseFloat(el('rfAmount').value), fee = parseFloat(el('rfFee').value) || 0, feePayer = el('rfFeePayer').value;
  if (!payerName) return toast('Please enter who the payment is from.', true);
  if (!purpose) return toast('Please describe what the payment is for.', true);
  if (!Number.isFinite(amount) || amount <= 0) return toast('Please enter a valid amount.', true);
  if (fee < 0 || (feePayer === 'seller' && fee >= amount)) return toast('The charge must be smaller than the amount received.', true);
  const treatment = el('rfTreatment').value;
  const payload = {
    groupId: fundsDeskGroupId, payerName, purpose, method, payerEmail: el('rfPayerEmail').value.trim(), payerCountry: pickState.rfcountry ? pickState.rfcountry.name : '',
    amount, amountCurrency: el('rfCurrency').value, feeAmount: fee, feePayer, externalRef: el('rfExternalRef').value.trim(), bankName: el('rfBankName').value.trim(), senderAccount: el('rfSenderAccount').value.trim(),
    internalNote: el('rfInternalNote').value.trim(), shareNoteWithBuyer: el('rfShareNote').checked, treatment, notifySeller: el('rfNotifySeller').checked, autoRelease: el('rfAutoRelease').checked
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
};

// ====================================================================
// 9. Seller: payments + live tracking stay on the account for good; fees shown plainly
// ====================================================================
function feeBlockHtml(i) {
  if (!(i.feeAmount > 0)) return '';
  const c = i.amountCurrency;
  if (i.feePayer === 'buyer') return `<div class="incoming-fee"><div><span>Bank / processing charge</span><b>${fmtMoney(i.feeAmount, c)} <em>paid by the buyer</em></b></div><div><span>Buyer paid in total</span><b>${fmtMoney(i.buyerTotal, c)}</b></div><div class="net"><span>You receive</span><b>${fmtMoney(i.amount, c)}</b></div></div>`;
  return `<div class="incoming-fee"><div><span>Fee deducted</span><b>${fmtMoney(i.feeAmount, c)}</b></div><div class="net"><span>You receive</span><b>${fmtMoney(i.amount - i.feeAmount, c)}</b></div></div>`;
}
function trackBadge(i) {
  if (!i.track) return '';
  if (i.status === 'credited') return '<span class="trk-final good"><i class="fa-solid fa-circle-check"></i> Verified &amp; released to your main account</span>';
  if (i.status === 'reversed') return '<span class="trk-final bad"><i class="fa-solid fa-rotate-left"></i> Reversed</span>';
  if (i.track.complete) return '<span class="trk-final await"><i class="fa-solid fa-vault"></i> Verification complete — secured in your vault, awaiting release</span>';
  return '';
}
renderIncomingSeller = function () {
  const tracked = sellerIncoming.filter(i => i.track);
  const panel = el('txLiveTrackPanel');
  if (panel) {
    panel.classList.toggle('hidden', !tracked.length);
    const ordered = [...tracked].sort((a, b) => (a.track.complete ? 1 : 0) - (b.track.complete ? 1 : 0) || new Date(b.receivedAt) - new Date(a.receivedAt));
    el('txLiveTrackList').innerHTML = ordered.map(i => `<div class="trk-card ${i.track.complete ? 'is-complete' : ''}"><div class="trk-head"><div><div class="trk-title">${escapeHtml(i.payerName)}</div><div class="trk-sub">${escapeHtml(i.purpose)} · ${escapeHtml(i.ref)}</div></div><div class="trk-amount">+${fmtMoney(i.sellerReceives != null ? i.sellerReceives : i.amount, i.amountCurrency)}</div></div>${trackBadge(i)}${feeBlockHtml(i)}${trackerHtml(i.track)}</div>`).join('');
  }
  const box = el('txIncomingList'); if (!box) return;
  box.innerHTML = sellerIncoming.length ? sellerIncoming.map(i => {
    const iconCls = i.status === 'credited' ? '' : i.status === 'reversed' ? 'reversed' : 'held';
    const icon = i.status === 'credited' ? 'fa-arrow-down' : i.status === 'reversed' ? 'fa-rotate-left' : 'fa-lock';
    const statusLabel = (i.track && i.track.complete && i.status === 'held_in_vault') ? 'Verified — awaiting release' : (INCOMING_STATUS_LABEL[i.status] || i.status);
    return `<div class="incoming-row" style="flex-wrap:wrap;"><div class="incoming-icon ${iconCls}"><i class="fa-solid ${icon}"></i></div><div class="incoming-main">
      <div class="incoming-top-line"><span class="incoming-payer">${escapeHtml(i.payerName)}</span><span class="incoming-amount">+${fmtMoney(i.sellerReceives != null ? i.sellerReceives : i.amount, i.amountCurrency)}</span></div>
      <div class="incoming-purpose">${escapeHtml(i.purpose)}</div>
      <div class="incoming-meta">${fmtDateTime(i.receivedAt)} · ${escapeHtml(i.ref)} · <span class="tx-status-badge ${statusPillClass(i.status)}" style="padding:2px 8px; font-size:0.62rem;">${escapeHtml(statusLabel)}</span>${i.statusReason ? ` · ${escapeHtml(i.statusReason)}` : ''}</div>
      ${i.externalRef ? `<div class="incoming-meta">${i.method === 'crypto' ? 'Transaction hash' : 'Bank reference'}: <span translate="no">${escapeHtml(i.externalRef)}</span>${i.bankName ? ' · ' + escapeHtml(i.bankName) : ''}</div>` : ''}
      ${feeBlockHtml(i)}
      ${i.receiptUrl ? `<a class="incoming-receipt" href="${i.receiptUrl}" target="_blank"><i class="fa-solid fa-file-invoice"></i> Download receipt</a>` : ''}
      ${i.track ? `<details class="trk-history" ${i.track.complete ? '' : 'open'}><summary>${i.track.complete ? 'View payment tracking history' : 'Live payment tracking'}</summary>${trackBadge(i)}${trackerHtml(i.track)}</details>` : ''}
    </div></div>`;
  }).join('') : '<p class="ledger-empty">No incoming payments recorded yet.</p>';
};

// ====================================================================
// 10. Withdrawals: the reason shown for a declined payout; admin writes it properly
// ====================================================================
const _wdCard = wdCardHtml;
wdCardHtml = function (w, adminView) {
  let h = _wdCard(w, adminView);
  if (wdCanon(w.status) === 'declined') {
    h = h.replace(/<div><span>Security<\/span><b>Email-code confirmed<\/b><\/div>/, '');
    h = h.replace(/<div class="wd-reason"[^>]*>([\s\S]*?)<\/div>/, (m, txt) => `<div class="wd-declined"><div class="wd-declined-h"><i class="fa-solid fa-circle-info"></i> Reason for decline</div><div class="wd-declined-b">${txt}</div><div class="wd-declined-f">The full amount has been returned to your available balance. If you have questions, please contact support${contactInfo.support ? ' at ' + escapeHtml(contactInfo.support) : ''}.</div></div>`);
  }
  return h;
};
const DECLINE_PRESETS = [
  'The beneficiary name does not match the name on your verified account. Please submit a new request with matching details.',
  'The bank details provided could not be validated by the receiving bank. Please check the account number / IBAN and SWIFT code and try again.',
  'Additional verification is required before this payout can be released. Our team will contact you by email shortly.',
  'The wallet address or network supplied is not valid. Please check both carefully and submit a new request.',
  'The requested amount is above the limit currently permitted on your account.'
];
function openReasonModal({ title, hint, presets, onSend }) {
  let m = el('reasonModal');
  if (!m) { document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="reasonModal"><div class="modal-box"><div class="modal-header"><span id="rmTitle"></span><i class="fa-solid fa-xmark" onclick="closeModal('reasonModal')"></i></div><div class="modal-body"><p class="reg-note" id="rmHint" style="margin-top:0"></p><div id="rmPresets" class="rm-presets"></div><textarea id="rmText" class="admin-notes-area" style="width:100%;height:110px;" maxlength="500" placeholder="Write the reason the seller will read…"></textarea><div class="reg-note" id="rmCount"></div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;"><button class="ghost-btn" onclick="closeModal('reasonModal')">Cancel</button><button class="send-btn" id="rmSend">Send to seller</button></div></div></div></div>`); m = el('reasonModal'); }
  el('rmTitle').textContent = title; el('rmHint').textContent = hint; el('rmText').value = '';
  el('rmPresets').innerHTML = (presets || []).map((p, i) => `<button type="button" class="rm-chip" data-i="${i}">${escapeHtml(p.length > 70 ? p.slice(0, 68) + '…' : p)}</button>`).join('');
  el('rmPresets').querySelectorAll('.rm-chip').forEach(b => b.onclick = () => { el('rmText').value = presets[Number(b.dataset.i)]; });
  el('rmSend').onclick = () => { const t = el('rmText').value.trim(); if (t.length < 10) return toast('Please write a clear reason (at least 10 characters) — the seller will read it.', true); closeModal('reasonModal'); onSend(t); };
  openModal('reasonModal'); setTimeout(() => el('rmText').focus(), 80);
}
adminAdvanceWithdrawal = function (withdrawalId, toStatus, needsReason) {
  if (!needsReason) return socket.emit('admin-advance-withdrawal', { withdrawalId, toStatus });
  const declining = toStatus === 'declined';
  openReasonModal({ title: declining ? 'Decline withdrawal' : 'Change withdrawal status', hint: declining ? 'This reason is shown in the seller\'s account and emailed to them. Pick a ready-made reason or write your own.' : 'The seller sees this note.', presets: declining ? DECLINE_PRESETS : [], onSend: (reason) => socket.emit('admin-advance-withdrawal', { withdrawalId, toStatus, reason }) });
};

// ====================================================================
// 11. Crypto deposit requirement — full, reassuring explanation (purpose, tiers, one-time unlock)
// ====================================================================
socket.on('withdrawal-blocked', (b) => {
  if (b.reason !== 'crypto_deposit' || !b.policy) return;
  const ccy = b.currency || (sellerAccountState && sellerAccountState.currency); const P = b.policy, bd = P.boundaries, T = P.tiers;
  const pc = (t) => `${Math.round(t.minPct * 100)}% – ${Math.round(t.maxPct * 100)}% of the withdrawal amount`;
  const usd = (n) => '$' + Number(n).toLocaleString('en-US');
  const rows = [['Under ' + usd(bd[0]), pc(T[0]), b.tierId === 1], [usd(bd[0]) + ' – ' + usd(bd[1]), pc(T[1]), b.tierId === 2], [usd(bd[1]) + ' – ' + usd(bd[2]), pc(T[2]), b.tierId === 3], ['Over ' + usd(bd[2]), 'A fixed amount of ' + usd(T[3].flatMin) + ' – ' + usd(T[3].flatMax) + ' (not a percentage)', b.tierId === 4]];
  el('wdBlockedExtra').innerHTML = `
    <div class="gate-extra">Your verification deposit <b>${fmtMoney(b.requiredLedger, ccy)}</b><br>Already verified <b>${fmtMoney(b.haveLedger, ccy)}</b><br>Still to deposit <b>${fmtMoney(b.shortfallLedger, ccy)}</b></div>
    <div class="cr-ok"><i class="fa-solid fa-circle-check"></i><div><b>This is your money, not a fee.</b> Your verification deposit is added to your <b>available balance</b> as soon as it is confirmed — you can keep it, use it, or withdraw it like any other funds.</div></div>
    <div class="cr-info">
      <h4><i class="fa-solid fa-shield-halved"></i> Why we ask for this</h4>
      <p>Before funds are paid out by cryptocurrency, we confirm that your crypto payout method has a genuine, verifiable funding trail — a standard source-of-funds and anti-money-laundering control. A single qualifying crypto deposit establishes it, independently of any earlier USD, GBP or EUR deposits. It is a routine safeguard applied to every client and is not a sign of any concern about you.</p>
      <h4><i class="fa-solid fa-route"></i> How it works</h4>
      <ol class="cr-steps"><li><b>Deposit</b> — make a crypto deposit of at least <b>${fmtMoney(b.shortfallLedger, ccy)}</b> from the Deposit page.</li><li><b>Confirmation</b> — our team verifies it on the blockchain.</li><li><b>Credited</b> — the full amount appears in your <b>available balance</b>.</li><li><b>Unlocked for good</b> — crypto withdrawals open permanently, with no further deposit and no delay.</li></ol>
      <h4><i class="fa-solid fa-scale-balanced"></i> How the amount is set</h4>
      <p>The larger the withdrawal, the smaller the share we ask for. A flat percentage would be unreasonable for large payouts, so a tiered, reducing scale is used instead:</p>
      <table class="cr-table"><thead><tr><th>Withdrawal amount (USD equivalent)</th><th>Verification deposit</th></tr></thead><tbody>${rows.map(r => `<tr class="${r[2] ? 'me' : ''}"><td>${r[0]}</td><td>${r[1]}${r[2] ? ' ◀ your tier' : ''}</td></tr>`).join('')}</tbody></table>
      <p>At the top tier the requirement is capped, so very large clients are never asked for a six-figure deposit: the purpose is met by the <i>existence</i> of a verified funding trail, not by a value that grows with the withdrawal.</p>
      <h4><i class="fa-solid fa-unlock-keyhole"></i> One time only</h4>
      <p>Once a qualifying crypto deposit has been verified, your account is permanently marked as verified for crypto withdrawals. The check is never repeated on later withdrawals, whatever their size.</p>
      <h4><i class="fa-solid fa-circle-info"></i> Good to know</h4>
      <ul class="cr-list"><li>If you change the withdrawal amount, the required deposit is recalculated instantly.</li><li>Several smaller crypto deposits count together toward the amount.</li><li>Withdrawals to your bank are never affected and remain available at any time.</li><li>Institutional and VIP clients may be verified directly by our compliance team — contact support if that applies to you.</li></ul>
      <p class="cr-foot">Questions? Our team is happy to help${contactInfo.support ? ' at ' + escapeHtml(contactInfo.support) : ''}.</p>
    </div>`;
});

// ====================================================================
// 12. KYC selfie: a REAL, LIVE human face is required — a poster, a wall or a still photo is refused
// ====================================================================
let faceApiP = null;
function loadFaceApi() {
  if (faceApiP) return faceApiP;
  faceApiP = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = '/vendor/face/face-api.js';
    s.onload = async () => { try { for (const be of ['webgl', 'cpu']) { try { if (await faceapi.tf.setBackend(be)) { await faceapi.tf.ready(); break; } } catch (e) { /* try the next backend */ } }
      await faceapi.nets.tinyFaceDetector.loadFromUri('/vendor/face'); await faceapi.nets.faceLandmark68TinyNet.loadFromUri('/vendor/face'); resolve(true); } catch (e) { faceApiP = null; reject(e); } };
    s.onerror = () => { faceApiP = null; reject(new Error('load')); };
    document.head.appendChild(s);
  });
  return faceApiP;
}
async function faceScan(source) {
  await loadFaceApi();
  return faceapi.detectAllFaces(source, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 })).withFaceLandmarks(true);
}
const _d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function eyeRatio(eye) { return (_d(eye[1], eye[5]) + _d(eye[2], eye[4])) / (2 * _d(eye[0], eye[3]) || 1); }
function yawRatio(lm) { const p = lm.positions; return (p[30].x - p[0].x) / ((p[16].x - p[0].x) || 1); }

// Used by the upload path (and by the old code that still calls it)
detectFace = async function (canvas) {
  const stats = analyzeFaceCanvas(canvas);
  try { const r = await faceScan(canvas); return { detected: r.length === 1, count: r.length, tooDark: stats.tooDark, method: 'faceapi-upload' }; }
  catch (e) {
    if ('FaceDetector' in window) { try { const f = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 }).detect(canvas); return { detected: f.length === 1, count: f.length, tooDark: stats.tooDark, method: 'native' }; } catch (e2) { /* fall through */ } }
    return { detected: false, unavailable: true, tooDark: stats.tooDark, method: 'unavailable' };
  }
};
const _fileChosenV32 = handleTxKycFileChosen;
handleTxKycFileChosen = async function (inputEl, key) {
  const file = inputEl.files && inputEl.files[0];
  if (key === 'selfie' && file && file.type.startsWith('image/')) {
    try {
      const r = await detectFace(await imageToCanvas(file));
      if (!r.detected) { inputEl.value = ''; return toast(r.unavailable ? 'Face check is not available right now. Please reload the page and try again.' : r.count > 1 ? 'More than one face was found. Please upload a photo of only yourself.' : 'We could not find a real human face in that photo. Please upload a clear, front-facing photo of yourself.', true); }
    } catch (e) { inputEl.value = ''; return toast('We could not check that photo. Please try another one.', true); }
  }
  return _fileChosenV32(inputEl, key);
};

openFaceCapture = async function () {
  openModal('faceModal'); const st = el('faceStatus'); st.style.color = ''; st.textContent = 'Starting camera…'; el('faceShotBtn').disabled = true; el('faceOval').className = 'face-oval';
  try { st.textContent = 'Loading the face check…'; await loadFaceApi(); }
  catch (e) { closeFaceCapture(); toast('The face check could not be loaded. Please check your connection, or upload a clear selfie instead.', true); return el('txKycSelfie').click(); }
  try {
    faceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
    const v = el('faceVideo'); v.srcObject = faceStream; await v.play();
    const probe = document.createElement('canvas'); let busy = false, earBase = null, minEar = 9, earSamples = [], minYaw = 9, maxYaw = -9, blinked = false, turned = false, goodFrames = 0, lostAt = 0;
    clearInterval(faceTimer);
    faceTimer = setInterval(async () => {
      if (busy || !v.videoWidth) return; busy = true;
      try {
        probe.width = 320; probe.height = Math.round(320 * v.videoHeight / v.videoWidth);
        probe.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, probe.width, probe.height);
        const dets = await faceScan(probe), W = probe.width, H = probe.height;
        const oval = el('faceOval');
        if (dets.length === 0) { goodFrames = 0; oval.className = 'face-oval bad'; st.style.color = 'var(--accent-rose)'; st.textContent = 'No face detected — look at the camera'; if (!lostAt) lostAt = Date.now(); if (Date.now() - lostAt > 1500) { blinked = turned = false; earBase = null; earSamples = []; minYaw = 9; maxYaw = -9; } el('faceShotBtn').disabled = true; return; }
        lostAt = 0;
        if (dets.length > 1) { oval.className = 'face-oval bad'; st.style.color = 'var(--accent-rose)'; st.textContent = 'More than one face — only you should be in view'; el('faceShotBtn').disabled = true; return; }
        const d = dets[0], b = d.detection.box, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        const inPlace = Math.abs(cx - W / 2) < W * 0.2 && Math.abs(cy - H / 2) < H * 0.22, sizeOk = b.height > H * 0.3 && b.height < H * 0.85;
        if (!inPlace || !sizeOk) { goodFrames = 0; oval.className = 'face-oval bad'; st.style.color = 'var(--accent-rose)'; st.textContent = !sizeOk ? (b.height <= H * 0.3 ? 'Move a little closer' : 'Move a little back') : 'Centre your face inside the oval'; el('faceShotBtn').disabled = true; return; }
        goodFrames++;
        const ear = (eyeRatio(d.landmarks.getLeftEye()) + eyeRatio(d.landmarks.getRightEye())) / 2, yaw = yawRatio(d.landmarks);
        earSamples.push(ear); if (earSamples.length > 40) earSamples.shift();
        if (earSamples.length >= 6) { const sorted = [...earSamples].sort((x, y) => x - y); earBase = sorted[Math.floor(sorted.length * 0.8)]; if (ear < earBase * 0.74) minEar = Math.min(minEar, ear); else if (minEar < 9 && ear > earBase * 0.88) { blinked = true; } }
        minYaw = Math.min(minYaw, yaw); maxYaw = Math.max(maxYaw, yaw); if (maxYaw - minYaw > 0.2) turned = true;
        const live = blinked || turned;
        oval.className = 'face-oval ' + (live ? 'ok' : 'warn');
        st.style.color = live ? 'var(--accent-emerald)' : 'var(--accent-amber)';
        st.textContent = live ? 'Live face confirmed — tap Take photo' : 'Face found. To prove you are real, blink once or slowly turn your head left and right';
        el('faceShotBtn').disabled = !(live && goodFrames >= 2);
        faceLive = live;
      } catch (e) { /* skip a frame */ } finally { busy = false; }
    }, 220);
  } catch (err) { closeFaceCapture(); toast('We could not open your camera. You can upload a clear selfie instead.', true); el('txKycSelfie').click(); }
};
let faceLive = false;
takeFaceShot = async function () {
  const v = el('faceVideo'); const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  let res; try { res = await faceScan(c); } catch (e) { res = []; }
  if (res.length !== 1 || !faceLive) { toast('We could not confirm a live, real face in that photo. Please try again.', true); return; }
  const small = document.createElement('canvas'); small.width = 320; small.height = Math.round(320 * c.height / c.width); small.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, small.width, small.height);
  kycFace = { detected: true, live: true, tooDark: analyzeFaceCanvas(small).tooDark, method: 'faceapi' };
  closeFaceCapture();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
  const zone = el('txKycSelfieZone'), preview = el('txKycSelfiePreview'), status = el('txWizStep4Status');
  preview.src = URL.createObjectURL(file); preview.classList.remove('hidden');
  status.textContent = 'Uploading...'; status.className = 'tx-wizard-status busy';
  const up = await uploadRawFile(file);
  if (up.ok) { txKycUploads.selfie = up.url; zone.classList.add('done'); zone.classList.remove('failed'); zone.querySelector('.tx-upload-title').textContent = 'Live face verified — tap to retake'; status.textContent = '✓ Real face verified and uploaded'; status.className = 'tx-wizard-status ok'; }
  else { txKycUploads.selfie = null; zone.classList.add('failed'); status.textContent = '✗ ' + up.error; status.className = 'tx-wizard-status bad'; toast(up.error, true); }
};

// ====================================================================
// 13. KYC comes first: after registering, the seller goes straight to identity verification.
//     Until it is submitted they see neither the dashboard nor the transaction room.
// ====================================================================
function kycGateNeeded() {
  return !isAdminConfirmed && myRoleIsSeller() && sellerAccountState && sellerAccountState.registered && sellerAccountState.kyc && (!sellerAccountState.kyc.status || sellerAccountState.kyc.status === 'none' || sellerAccountState.kyc.status === 'not_submitted');
}
function myRoleIsSeller() { return typeof myRole !== 'undefined' ? myRole === 'PARTY B' : true; }
function ensureKycGate() {
  let g = el('kycGate');
  if (!kycGateNeeded()) { if (g) { g.remove(); closeModal('txKycWizardModal'); openTxAccountView(); setTxAccountNav('dashboard'); } return; }   // KYC submitted -> straight to the dashboard
  if (g) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="kycGate" class="kyc-gate"><div class="kg-card">
    <div class="kg-ico"><i class="fa-solid fa-id-card-clip"></i></div>
    <div class="kg-step">Step 1 of 1 · Required</div>
    <h1>Verify your identity to continue</h1>
    <p>To protect you, your funds and the other party, every seller completes a short identity check before using the platform. It takes about two minutes and you only do it once.</p>
    <ul class="kg-list"><li><i class="fa-solid fa-id-badge"></i><span><b>Your ID document</b> — passport, national ID or driver's licence</span></li><li><i class="fa-solid fa-camera"></i><span><b>A quick live selfie</b> — to confirm it is really you</span></li><li><i class="fa-solid fa-unlock"></i><span><b>Then you are in</b> — your dashboard and transaction room open immediately</span></li></ul>
    <button class="gate-btn" onclick="startKycFromGate()"><i class="fa-solid fa-shield-halved"></i> Start verification</button>
    <small class="kg-foot"><i class="fa-solid fa-lock"></i> Encrypted and reviewed only by our compliance team.</small></div></div>`);
}
function startKycFromGate() { openTxAccountView(); setTimeout(() => openTxKycWizard(), 200); }
socket.on('seller-account-state', () => setTimeout(ensureKycGate, 0));
socket.on('init-state', () => setTimeout(ensureKycGate, 400));
chooseNextStep = function () {
  closeModal('nextStepModal');
  ensureKycGate();
  openTxAccountView();
  setTimeout(() => openTxKycWizard(), 250);
};

// ====================================================================
// 14. Last seen (admin sees all; parties see each other only when the Desk allows it and both share)
// ====================================================================
function seenText(info) {
  if (!info) return '';
  if (info.hidden) return 'Last seen hidden';
  if (info.online) return 'Online';
  if (info.recently) return 'Last seen recently';
  if (info.at) {
    const d = new Date(info.at), now = new Date(), t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const same = d.toDateString() === now.toDateString(), yest = new Date(now - 864e5).toDateString() === d.toDateString();
    return `Last seen ${same ? 'today' : yest ? 'yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${t}`;
  }
  return 'Offline';
}
function ensureLastSeenBar() {
  let bar = el('lastSeenBar'); if (bar) return bar;
  const anchor = document.querySelector('.chat-header'); if (!anchor) return null;
  anchor.insertAdjacentHTML('afterend', '<div id="lastSeenBar" class="lastseen-bar hidden"></div>');
  return el('lastSeenBar');
}
socket.on('last-seen', (d) => {
  if (d.groupId !== activeGroupId) return;
  const bar = ensureLastSeenBar(); if (!bar) return;
  if (d.admin) {
    bar.classList.remove('hidden');
    const line = (who, i) => `<span class="ls-item"><b>${who}</b> ${i.online ? '<em class="on">Online</em>' : seenText({ at: i.at, online: false })}</span>`;
    bar.innerHTML = `${line('Buyer', d.buyer)}${line('Seller', d.seller)}<label class="ls-mode" title="What the buyer and seller are allowed to see"><span>Parties see:</span><select onchange="socket.emit('admin-set-last-seen-mode',{groupId:activeGroupId,mode:this.value})"><option value="off" ${d.mode === 'off' ? 'selected' : ''}>Nothing (default)</option><option value="recently" ${d.mode === 'recently' ? 'selected' : ''}>Last seen recently</option><option value="exact" ${d.mode === 'exact' ? 'selected' : ''}>Exact last seen</option></select></label>`;
    return;
  }
  if (d.mode === 'off') { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const other = (typeof myRole !== 'undefined' && myRole === 'PARTY A') ? 'Seller' : 'Buyer';
  bar.innerHTML = `<span class="ls-item"><b>${other}</b> ${escapeHtml(seenText(d.other))}</span><label class="ls-switch" title="Turn off to hide your last seen — you will not see theirs either"><span>Share my last seen</span><input type="checkbox" ${d.mine ? 'checked' : ''} onchange="socket.emit('set-my-last-seen-share',{enabled:this.checked})"><i></i></label>`;
});
socket.on('init-state', () => { const b = el('lastSeenBar'); if (b) b.classList.add('hidden'); });

// ====================================================================
// 15. Admin: automatic missed-message email toggle
// ====================================================================
socket.on('auto-email-state', ({ enabled }) => {
  const box = el('autoEmailToggleBox');
  if (!box) {
    const host = el('tabControls');
    if (!host) return;
    host.insertAdjacentHTML('afterbegin', `<div class="widget-card" id="autoEmailToggleBox"><div class="ctrl-row"><div><b>Automatic missed-message emails</b><small>When ON, anyone who is away is emailed automatically the moment someone writes (users or admins). When OFF, emails wait for your approval.</small></div><label class="ls-switch big"><input type="checkbox" id="autoEmailChk" onchange="socket.emit('admin-set-auto-email',{enabled:this.checked})"><i></i></label></div></div>`);
  }
  const c = el('autoEmailChk'); if (c) c.checked = !!enabled;
});

// ====================================================================
// 16. Composer: multi-paragraph writing, paste as copied / plain; messages keep their paragraphs
// ====================================================================
(function upgradeComposer() {
  const old = el('messageInput'); if (!old || old.tagName === 'TEXTAREA') return;
  const ta = document.createElement('textarea');
  ta.id = 'messageInput'; ta.className = old.className + ' composer-ta'; ta.rows = 1; ta.placeholder = old.placeholder; ta.setAttribute('data-i18n-placeholder', 'writeMessage'); ta.setAttribute('enterkeyhint', 'enter'); ta.setAttribute('autocomplete', 'off');
  old.replaceWith(ta);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
  const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  ta.addEventListener('input', () => { fit(); handleTyping(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && desktop) { e.preventDefault(); sendMsg(); setTimeout(fit, 0); }
  });
  const _send = sendMsg;
  sendMsg = async function () { await _send(); fit(); };
  // Paste menu: as copied (keeps every line break) / as plain text (tidied)
  const sendBtn = ta.parentElement.querySelector('.send-btn, #sendBtn') || ta.nextElementSibling;
  ta.insertAdjacentHTML('beforebegin', '<button type="button" class="paste-btn" id="pasteBtn" title="Paste options" aria-label="Paste options"><i class="fa-solid fa-paste"></i></button>');
  document.body.insertAdjacentHTML('beforeend', '<div class="paste-menu" id="pasteMenu"><button onclick="pasteInto(false)"><i class="fa-solid fa-clipboard"></i> Paste as copied<small>keeps all lines and spacing</small></button><button onclick="pasteInto(true)"><i class="fa-solid fa-align-left"></i> Paste as plain text<small>tidies spacing and symbols</small></button></div>');
  el('pasteBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = el('pasteMenu'), r = el('pasteBtn').getBoundingClientRect(); m.style.left = Math.max(8, r.left) + 'px'; m.style.bottom = (window.innerHeight - r.top + 8) + 'px'; m.classList.toggle('show'); });
  document.addEventListener('click', () => el('pasteMenu').classList.remove('show'));
})();
function plainify(t) { return String(t).replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
async function pasteInto(plain) {
  el('pasteMenu').classList.remove('show');
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch (e) { return toast('Your browser blocked clipboard access. Press Ctrl+V (or long-press → Paste) instead.', true); }
  if (!t) return toast('Nothing to paste — copy some text first.', true);
  const ta = el('messageInput'), s = ta.selectionStart, e2 = ta.selectionEnd, ins = plain ? plainify(t) : t.replace(/\r\n?/g, '\n');
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e2); ta.selectionStart = ta.selectionEnd = s + ins.length;
  ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus();
}

// ====================================================================
// 17. Copy any message (and any selection of messages)
// ====================================================================
const decodeHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent; };
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied to clipboard.'); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); toast('Copied to clipboard.'); } catch (e2) { toast('Could not copy.', true); } a.remove(); } }
function triggerCtxCopy() { if (currentTargetMsg) copyText(decodeHtml(currentTargetMsg.text)); }
(function addCopyOptions() {
  const menu = el('contextMenu'); if (menu && !el('ctxCopyBtn')) menu.insertAdjacentHTML('afterbegin', '<div class="context-menu-item" id="ctxCopyBtn" onclick="triggerCtxCopy()"><i class="fa-solid fa-copy"></i> <span>Copy</span></div>');
  const bar = el('bulkDeleteBar'); if (bar && !el('bulkCopyBtn')) { const b = document.createElement('button'); b.id = 'bulkCopyBtn'; b.className = 'ghost-btn'; b.innerHTML = '<i class="fa-solid fa-copy"></i> Copy'; b.onclick = () => { const out = []; messagesById.forEach((d, id) => { if (selectedMsgIds.has(id)) out.push(`${d.sender}: ${decodeHtml(d.text)}`); }); copyText(out.join('\n\n')); }; bar.querySelector('div').prepend(b); }
})();

// ====================================================================
// 18. Seller account: professional sidebar (account details live here, not on the dashboard),
//     payment tracking under Transactions, and new pages: Statements, Security, Help & Support
// ====================================================================
(function restructureSellerAccount() {
  const card = document.querySelector('.tx-group-card'), right = document.querySelector('.tx-topbar-right'); if (!card || !right) return;
  const box = document.createElement('div'); box.className = 'tx-side-details'; box.id = 'txSideDetails';
  right.querySelectorAll('.tx-currency-pill').forEach(p => box.appendChild(p));        // moved with their ids and handlers
  box.insertAdjacentHTML('beforeend', '<div class="tx-currency-pill" id="txTypePill"><i class="fa-solid fa-layer-group"></i> Account type: <b id="txTypeLabel">Standard</b></div>');
  card.appendChild(box);
  // Live payment tracking belongs under Transactions
  const panel = el('txLiveTrackPanel'), tx = el('txPageTransactions');
  if (panel && tx) tx.insertAdjacentElement('afterbegin', panel);
  // New nav items + pages
  const nav = document.querySelector('.tx-nav');
  const add = (key, icon, label, before) => { const b = document.createElement('button'); b.className = 'tx-nav-item'; b.dataset.txnav = key; b.onclick = () => setTxAccountNav(key); b.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`; const ref = before && nav.querySelector(`[data-txnav="${before}"]`); ref ? nav.insertBefore(b, ref) : nav.appendChild(b); };
  add('statements', 'fa-file-invoice-dollar', 'Statements', 'forms'); add('security', 'fa-shield-halved', 'Security', 'profile'); add('help', 'fa-life-ring', 'Help &amp; Support');
  const scroll = document.querySelector('.tx-scroll');
  ['Statements', 'Security', 'Help'].forEach(n => scroll.insertAdjacentHTML('beforeend', `<div class="tx-page hidden" id="txPage${n}"><div id="tx${n}Body"></div></div>`));
  TX_NAV_TITLES.statements = ['Statements', 'Your payment history, receipts and downloadable statement.'];
  TX_NAV_TITLES.security = ['Security', 'Protect your account and review recent sign-ins.'];
  TX_NAV_TITLES.help = ['Help & Support', 'Answers to common questions and ways to reach our team.'];
  TX_NAV_TITLES.transactions = ['Transactions', 'Live tracking of incoming payments, plus your full payment history.'];
  const hdr = tx && tx.querySelector('.tx-panel-title, h3, .tx-section-title');
  if (tx && !el('txTrackTitle')) panel && panel.insertAdjacentHTML('beforebegin', '<div class="tx-sec-head" id="txTrackTitle"><i class="fa-solid fa-satellite-dish"></i> Incoming payments &amp; live tracking</div>');
})();
const _navV32 = setTxAccountNav;
setTxAccountNav = function (nav) {
  _navV32(nav);
  if (nav === 'statements') renderStatements();
  if (nav === 'security') { renderSecurity(); socket.emit('get-my-security', { groupId: activeGroupId }); }
  if (nav === 'help') renderHelp();
};
function renderSideDetails() {
  const a = sellerAccountState; if (!a) return;
  const t = el('txTypeLabel'); if (t) t.textContent = a.accountTypeLabel || 'Standard';
  const nm = el('txSideGroupName'); if (nm) nm.textContent = a.fullName || '—';
  const sub = el('txSideGroupSub'); if (sub) sub.textContent = a.email || 'Seller';
}
socket.on('seller-account-state', () => setTimeout(renderSideDetails, 0));

// ---- Statements ----
function statementRows() {
  const rows = [];
  sellerIncoming.forEach(i => rows.push({ at: i.receivedAt, type: 'Payment received', ref: i.ref, desc: `${i.payerName} — ${i.purpose}`, amount: (i.sellerReceives != null ? i.sellerReceives : i.amount), ccy: i.amountCurrency, status: i.status === 'credited' ? 'Credited' : (i.track && i.track.complete ? 'Verified — awaiting release' : (i.status === 'reversed' ? 'Reversed' : 'In verification')), sign: 1, receipt: i.receiptUrl }));
  sellerWithdrawals.forEach(w => rows.push({ at: w.createdAt, type: 'Withdrawal', ref: w.ref, desc: w.method === 'crypto' ? 'Crypto payout' : 'Bank transfer', amount: w.amount, ccy: w.amountCurrency, status: String(w.status || '').replace(/_/g, ' '), sign: -1 }));
  sellerDeposits.forEach(d => rows.push({ at: d.createdAt || d.at, type: 'Deposit', ref: d.ref || '', desc: d.method || d.asset || 'Deposit', amount: d.amount, ccy: d.currency || d.amountCurrency, status: String(d.status || '').replace(/_/g, ' '), sign: 1 }));
  return rows.filter(r => r.at).sort((x, y) => new Date(y.at) - new Date(x.at));
}
function renderStatements() {
  const rows = statementRows(); const a = sellerAccountState || {}; const ccy = a.currency || 'USD';
  const sum = (t) => rows.filter(r => r.type === t && /credited|completed|verified|released/i.test(r.status)).reduce((n, r) => n + Number(r.amount || 0), 0);
  el('txStatementsBody').innerHTML = `
    <div class="tx-stat-grid" style="margin-bottom:14px;"><div class="tx-stat-card"><div class="tx-stat-label">TOTAL RECEIVED</div><div class="tx-stat-value">${fmtMoney(sum('Payment received'), ccy)}</div></div><div class="tx-stat-card"><div class="tx-stat-label">TOTAL WITHDRAWN</div><div class="tx-stat-value">${fmtMoney(sum('Withdrawal'), ccy)}</div></div></div>
    <div class="st-bar"><div><b>${rows.length}</b> entr${rows.length === 1 ? 'y' : 'ies'}</div><button class="send-btn" onclick="downloadStatement()"><i class="fa-solid fa-download"></i> Download statement (CSV)</button></div>
    ${rows.length ? `<div class="st-list">${rows.map(r => `<div class="st-row"><div class="st-ico ${r.sign > 0 ? 'in' : 'out'}"><i class="fa-solid ${r.type === 'Withdrawal' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i></div><div class="st-main"><div class="st-top"><b>${escapeHtml(r.type)}</b><span class="st-amt ${r.sign > 0 ? 'in' : 'out'}">${r.sign > 0 ? '+' : '−'}${fmtMoney(r.amount, r.ccy || ccy)}</span></div><div class="st-desc">${escapeHtml(r.desc || '')}</div><div class="st-meta">${fmtDateTime(r.at)} · ${escapeHtml(r.ref || '')} · ${escapeHtml(r.status)}${r.receipt ? ` · <a href="${r.receipt}" target="_blank">Receipt</a>` : ''}</div></div></div>`).join('')}</div>` : '<p class="tx-empty">No activity yet. Payments, deposits and withdrawals appear here.</p>'}`;
}
function downloadStatement() {
  const rows = statementRows(); const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = ['Date,Type,Reference,Description,Amount,Currency,Status'].concat(rows.map(r => [new Date(r.at).toISOString(), r.type, r.ref, r.desc, (r.sign > 0 ? '' : '-') + Number(r.amount || 0).toFixed(2), r.ccy, r.status].map(esc).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = `statement-${(sellerAccountState && sellerAccountState.accountId) || 'account'}.csv`; document.body.appendChild(a); a.click(); a.remove();
}
socket.on('incoming-list', () => { if (!el('txPageStatements').classList.contains('hidden')) renderStatements(); });

// ---- Security ----
function renderSecurity() {
  el('txSecurityBody').innerHTML = `
    <div class="sec-card"><h3><i class="fa-solid fa-key"></i> Change password</h3><p class="sec-sub">Choose a strong password that you do not use anywhere else.</p>
      <label class="gate-field"><span>Current password</span><input id="cpCur" type="password" autocomplete="current-password" placeholder="Your current password"></label>
      <label class="gate-field"><span>New password</span><div class="gate-pw"><input id="cpNew" type="password" autocomplete="new-password" placeholder="At least 8 characters"><button type="button" onclick="togglePw('cpNew', this)"><i class="fa-solid fa-eye"></i></button></div></label>
      <label class="gate-field"><span>Confirm new password</span><input id="cpNew2" type="password" autocomplete="new-password" placeholder="Re-enter the new password"></label>
      <div id="cpMsg" class="gate-msg"></div><button class="send-btn" id="cpBtn" onclick="submitChangePassword()"><i class="fa-solid fa-lock"></i> Update password</button></div>
    <div class="sec-card"><h3><i class="fa-solid fa-clock-rotate-left"></i> Recent sign-ins</h3><div id="secRecent"><p class="tx-empty">Loading…</p></div>
      <p class="sec-sub" id="secPwDate"></p></div>
    <div class="sec-card"><h3><i class="fa-solid fa-circle-check"></i> How we protect you</h3><ul class="cr-list"><li>We email you whenever your account is accessed from a new place, and you can tell us if it was not you.</li><li>Every withdrawal needs a one-time code sent to your email.</li><li>We will never ask you for your password or a code by phone, email or chat.</li><li>Your documents are encrypted and seen only by our compliance team.</li></ul></div>`;
}
function submitChangePassword() {
  const cur = el('cpCur').value, n1 = el('cpNew').value, n2 = el('cpNew2').value, m = el('cpMsg'); m.style.color = ''; m.textContent = '';
  if (n1.length < 8) { m.textContent = 'Choose a password of at least 8 characters.'; return; }
  if (n1 !== n2) { m.textContent = 'The new passwords do not match.'; return; }
  el('cpBtn').disabled = true; socket.emit('change-my-password', { groupId: activeGroupId, currentPassword: cur, newPassword: n1 });
}
socket.on('password-change-result', (r) => {
  const b = el('cpBtn'); if (b) b.disabled = false; const m = el('cpMsg'); if (!m) return;
  if (r.ok) { m.style.color = 'var(--accent-emerald)'; m.textContent = '✓ Your password has been updated. A confirmation was sent to your email.'; ['cpCur', 'cpNew', 'cpNew2'].forEach(i => { el(i).value = ''; }); socket.emit('get-my-security', { groupId: activeGroupId }); }
  else { m.style.color = 'var(--accent-rose)'; m.textContent = r.error || 'Something went wrong.'; }
});
socket.on('my-security', (d) => {
  const box = el('secRecent'); if (!box) return;
  box.innerHTML = d.recent.length ? d.recent.map(r => `<div class="sec-row">${r.iso ? flagHtml(r.iso, '') : '<i class="fa-solid fa-globe"></i>'}<div><b>${escapeHtml(r.where)}</b><small>${fmtDateTime(r.at)} · ${escapeHtml(r.ip)} · ${r.count}×</small></div></div>`).join('') : '<p class="tx-empty">No sign-ins recorded yet.</p>';
  const p = el('secPwDate'); if (p) p.textContent = d.passwordChangedAt ? 'Password last changed ' + fmtDateTime(d.passwordChangedAt) + '.' : 'You have not set a password yet.';
});

// ---- Help & Support ----
function renderHelp() {
  const sup = contactInfo.support || '', com = contactInfo.complaints || '';
  const faq = [
    ['How long does a payment take to be verified?', 'Every incoming payment passes six stages: payment received, payer verification, authenticity review, payment confirmed, phone verification, and funds secured in your vault. You can follow each stage live under Transactions. When all six are complete, our team releases the funds to your available balance.'],
    ['Why do I need to verify my identity (KYC)?', 'Identity verification protects you, your funds and the other party. It takes about two minutes, is done once, and unlocks withdrawals.'],
    ['How do withdrawals work?', 'Open Withdraw, choose bank transfer or crypto, enter your details and confirm with the one-time code we email you. You can follow the status of every withdrawal in real time.'],
    ['Why is a crypto deposit needed before my first crypto withdrawal?', 'It creates a verifiable funding trail for crypto payouts — a standard compliance step. The deposit is credited to your available balance in full, and crypto withdrawals unlock permanently afterwards.'],
    ['I forgot my password.', 'On the sign-in screen choose “Forgot your password?”, enter your email and the 6-digit code we send you, then choose a new password. You can also change it any time under Security.']
  ];
  el('txHelpBody').innerHTML = `
    <div class="help-cards"><a class="help-card" href="mailto:${escapeHtml(sup)}"><i class="fa-solid fa-headset"></i><b>Contact support</b><small>${escapeHtml(sup)}</small></a><a class="help-card" href="mailto:${escapeHtml(com)}"><i class="fa-solid fa-scale-balanced"></i><b>Complaints &amp; escalations</b><small>${escapeHtml(com)}</small></a></div>
    <div class="sec-card"><h3><i class="fa-solid fa-circle-question"></i> Frequently asked questions</h3>${faq.map(f => `<details class="faq"><summary>${escapeHtml(f[0])}</summary><p>${escapeHtml(f[1])}</p></details>`).join('')}</div>
    <div class="sec-card"><h3><i class="fa-solid fa-mobile-screen-button"></i> Get the app</h3><p class="sec-sub">Install Vistra on your phone or computer for faster, full-screen access.</p><button class="send-btn" onclick="installApp()"><i class="fa-solid fa-download"></i> Install the app</button></div>`;
}

// ====================================================================
// 19. Locked transaction room (seller): dashboard only, until the Desk unlocks it
// ====================================================================
function showRoomLocked(on) {
  let box = el('roomLockedBox'); const host = document.querySelector('.chat-main');
  if (!on) { if (box) box.remove(); return; }
  if (box || !host) return;
  host.style.position = 'relative';
  host.insertAdjacentHTML('beforeend', `<div id="roomLockedBox" class="room-locked"><div class="rl-card"><div class="rl-ico"><i class="fa-solid fa-lock"></i></div><h2>This transaction room is locked</h2><p>This group has not been opened for you yet, so it is not available. Your Desk Officer will unlock it when your transaction is ready.</p><button class="gate-btn" onclick="openTxAccountView()"><i class="fa-solid fa-table-columns"></i> Go to my dashboard</button><small>Need help? ${escapeHtml(contactInfo.support || '')}</small></div></div>`);
}
socket.on('init-state', (d) => { if (d && !d.isAdminConfirmed) { showRoomLocked(!!d.locked); if (d.locked) setTimeout(() => { if (!kycGateNeeded()) openTxAccountView(); }, 700); } });
socket.on('room-lock-state', ({ locked }) => { if (locked) showRoomLocked(true); else { showRoomLocked(false); toast('Your transaction room has been unlocked.'); setTimeout(() => location.reload(), 800); } });

// ---- Dashboard: a compact pointer to live tracking (the tracker itself lives under Transactions) ----
const _renderIncV32 = renderIncomingSeller;
renderIncomingSeller = function () {
  _renderIncV32();
  const dash = el('txPageDashboard'); if (!dash) return;
  let s = el('txTrackSummary'); const active = sellerIncoming.filter(i => i.track && !i.track.complete);
  if (!active.length) { if (s) s.remove(); return; }
  if (!s) { dash.insertAdjacentHTML('afterbegin', '<div class="tx-track-summary" id="txTrackSummary" onclick="setTxAccountNav(\'transactions\')"></div>'); s = el('txTrackSummary'); }
  const stg = active[0].track.stage;
  s.innerHTML = `<i class="fa-solid fa-satellite-dish"></i><div><b>${active.length} payment${active.length > 1 ? 's' : ''} being verified</b><small>Stage ${stg} of 6 — tap to follow the live tracking</small></div><i class="fa-solid fa-chevron-right"></i>`;
};

// ====================================================================
// 20. Admin: add seller manually, all-sellers table with every detail and every action
// ====================================================================
function openAddSeller() {
  let m = el('addSellerModal');
  if (!m) {
    const countries = (QC.COUNTRIES || []).map(c => `<option value="${c.iso}">${escapeHtml(c.name)}</option>`).join('');
    const ccys = Array.from(el('rfCurrency').options).map(o => `<option value="${o.value}">${escapeHtml(o.textContent)}</option>`).join('');
    const langs = (QL.LANGUAGES || []).map(l => `<option value="${l.code}">${escapeHtml(l.name)}</option>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="addSellerModal"><div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-user-plus"></i> Add a seller manually</span><i class="fa-solid fa-xmark" onclick="closeModal('addSellerModal')"></i></div><div class="modal-body">
      <p class="reg-note" style="margin-top:0">No form for the seller. They sign in with this email, tap <b>Forgot password</b>, receive a code and choose their own password, then complete KYC.</p>
      <label class="branding-field">Full name<input id="asName" class="message-input" placeholder="First and last name"></label>
      <label class="branding-field">Email address<input id="asEmail" type="email" class="message-input" placeholder="seller@example.com"></label>
      <div class="two-col"><label class="branding-field">Country<select id="asCountry" class="message-input csel"><option value="">Select…</option>${countries}</select></label><label class="branding-field">Account currency<select id="asCcy" class="message-input csel">${ccys}</select></label></div>
      <div class="two-col"><label class="branding-field">Phone (optional)<input id="asPhone" class="message-input" placeholder="e.g. 0244123456"></label><label class="branding-field">Language<select id="asLang" class="message-input csel">${langs}</select></label></div>
      <label class="terms-check"><input type="checkbox" id="asLock" checked> <span>Keep the transaction room <b>locked</b> until I unlock it (the seller sees only their dashboard)</span></label>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;"><button class="ghost-btn" onclick="closeModal('addSellerModal')">Cancel</button><button class="send-btn" id="asBtn" onclick="submitAddSeller()"><i class="fa-solid fa-check"></i> Add seller</button></div></div></div></div>`);
    el('asLang').value = 'en'; el('asCcy').value = el('rfCurrency').value;
  }
  ['asName', 'asEmail', 'asPhone'].forEach(i => { el(i).value = ''; }); openModal('addSellerModal');
}
function submitAddSeller() {
  const p = { fullName: el('asName').value.trim(), email: el('asEmail').value.trim(), country: el('asCountry').value, currency: el('asCcy').value, phoneNumber: el('asPhone').value.trim(), language: el('asLang').value, lockRoom: el('asLock').checked };
  if (!p.fullName || !/\s/.test(p.fullName)) return toast('Enter the seller\'s full name (first and last name).', true);
  if (!isValidEmailClient(p.email)) return toast('Enter a valid email address.', true);
  if (!p.country) return toast('Choose the seller\'s country.', true);
  el('asBtn').disabled = true; setTimeout(() => { el('asBtn').disabled = false; }, 2500); socket.emit('admin-add-seller', p);
}
socket.on('admin-seller-added', () => { closeModal('addSellerModal'); requestSellers(); });
let sellersT = null;
function requestSellers() { clearTimeout(sellersT); sellersT = setTimeout(() => socket.emit('admin-list-sellers'), 250); }
socket.on('seller-account-updated', () => { if (el('allSellersBox') && !el('tabAccounts').classList.contains('hidden')) requestSellers(); });
const _tabV32 = setAdminTab;
setAdminTab = function (tab) { _tabV32(tab); if (tab === 'accounts') { ensureSellersPanel(); requestSellers(); } };
function ensureSellersPanel() {
  if (el('allSellersBox')) return;
  el('tabAccounts').insertAdjacentHTML('afterbegin', `<div class="widget-card" id="allSellersBox"><div class="ctrl-row" style="margin-bottom:10px"><div><b><i class="fa-solid fa-users"></i> All sellers</b><small>Every seller's details, status and controls in one place.</small></div><button class="send-btn" onclick="openAddSeller()"><i class="fa-solid fa-user-plus"></i> Add seller</button></div><input id="sellersFilter" class="message-input" placeholder="Search name, email, account ID, country…" oninput="renderSellers()" style="margin-bottom:10px"><div id="sellersList"><p class="ledger-empty">Loading…</p></div></div>`);
}
let sellersCache = [];
socket.on('sellers-list', (rows) => { sellersCache = rows; renderSellers(); });
function chip(t, cls) { return `<span class="lab-chip ${cls}">${t}</span>`; }
function renderSellers() {
  const box = el('sellersList'); if (!box) return; const q = (el('sellersFilter').value || '').toLowerCase();
  const rows = sellersCache.filter(a => !q || [a.fullName, a.email, a.accountId, a.country, a.phone].join(' ').toLowerCase().includes(q));
  const kyc = (s) => ({ verified: chip('KYC verified', 'good'), pending: chip('KYC pending', 'warn'), rejected: chip('KYC rejected', 'bad') }[s] || chip('KYC not submitted', 'warn'));
  box.innerHTML = rows.length ? rows.map(a => `<div class="seller-card ${a.banned ? 'is-banned' : ''}">
    <div class="sc-head">${a.countryIso ? flagHtml(a.countryIso, a.country) : ''}<div class="sc-id"><b>${escapeHtml(a.fullName || '—')}</b><small translate="no">Account ${escapeHtml(a.accountId || '—')} · ${escapeHtml(a.currency || '')}</small></div>
      <div class="sc-chips">${a.banned ? chip('Banned', 'bad') : a.disabled ? chip('Disabled', 'bad') : chip('Active', 'good')}${kyc(a.kyc && a.kyc.status)}${a.manual ? chip('Added by admin', 'info') : ''}${a.roomLocked ? chip('Room locked', 'warn') : ''}</div></div>
    <div class="sc-grid"><div><span>Email</span><b>${escapeHtml(a.email || '—')}</b></div><div><span>Phone</span><b>${escapeHtml(a.phone || '—')}</b></div><div><span>Country</span><b>${escapeHtml(a.country || '—')}</b></div><div><span>Registered</span><b>${fmtDateTime(a.registeredAt)}</b></div>
      <div><span>Last sign-in</span><b>${a.lastLoginAt ? fmtDateTime(a.lastLoginAt) + (a.lastGeo ? ' · ' + escapeHtml(a.lastGeo) : '') : '—'}</b></div><div><span>Password</span><b translate="no" id="pw-${a.groupId}">${a.passwordSet ? (a.passwordStored ? `<button class="admin-btn" onclick="socket.emit('admin-reveal-seller-password',{groupId:'${a.groupId}'})"><i class="fa-solid fa-eye"></i> Show</button>` : 'Set (not stored)') : 'Not set yet'}</b></div>
      <div><span>Balances</span><b>${fmtMoney(a.balances.available, a.currency)} avail · ${fmtMoney(a.balances.held, a.currency)} vault</b></div><div><span>Sign-in alerts</span><b>${a.loginAlertsEnabled ? 'On' : 'Off'}</b></div></div>
    <div class="sc-actions"><button class="admin-btn" onclick="openSellerProfile('${a.groupId}')"><i class="fa-solid fa-address-card"></i> Full profile</button>
      <button class="admin-btn ${a.disabled && !a.banned ? '' : 'admin-btn-danger'}" ${a.banned ? 'disabled' : ''} onclick="toggleDisable('${a.groupId}', ${!a.disabled})">${a.disabled ? '<i class="fa-solid fa-circle-check"></i> Reactivate' : '<i class="fa-solid fa-ban"></i> Disable'}</button>
      <button class="admin-btn admin-btn-danger" onclick="toggleBan('${a.groupId}', ${!a.banned})">${a.banned ? '<i class="fa-solid fa-rotate-left"></i> Unban' : '<i class="fa-solid fa-gavel"></i> Ban'}</button>
      <button class="admin-btn" onclick="socket.emit('admin-set-room-locked',{groupId:'${a.groupId}',locked:${!a.roomLocked}}); requestSellers()">${a.roomLocked ? '<i class="fa-solid fa-lock-open"></i> Unlock room' : '<i class="fa-solid fa-lock"></i> Lock room'}</button>
      <button class="admin-btn" onclick="socket.emit('admin-set-login-alerts',{groupId:'${a.groupId}',enabled:${!a.loginAlertsEnabled}}); requestSellers()"><i class="fa-solid fa-bell${a.loginAlertsEnabled ? '-slash' : ''}"></i> ${a.loginAlertsEnabled ? 'Turn off' : 'Turn on'} sign-in alerts</button></div></div>`).join('') : '<p class="ledger-empty">No sellers found.</p>';
}
function toggleDisable(gid, disable) {
  if (!disable) return socket.emit('admin-set-seller-disabled', { groupId: gid, disabled: false });
  openReasonModal({ title: 'Disable this account', hint: 'The seller is told their account is disabled and sees this reason.', presets: ['Account under compliance review.', 'We need additional information to verify your account.'], onSend: (reason) => socket.emit('admin-set-seller-disabled', { groupId: gid, disabled: true, reason }) });
}
function toggleBan(gid, ban) {
  if (!ban) return socket.emit('admin-set-seller-banned', { groupId: gid, banned: false });
  openReasonModal({ title: 'Ban this seller', hint: 'The account is closed, the seller\'s link expires and they can no longer sign in. You can unban at any time.', presets: ['Account closed following a compliance review.', 'Account closed for breach of the Terms of Service.'], onSend: (reason) => socket.emit('admin-set-seller-banned', { groupId: gid, banned: true, reason }) });
}
socket.off('seller-password-revealed');
const pwCache = {};
function applyCachedPw(gid) { const t = el('spPwText'), b = el('spPwBtn'); if (t && pwCache[gid]) { t.textContent = pwCache[gid]; if (b) b.style.display = 'none'; } }
socket.on('seller-password-revealed', (r) => {
  if (r.groupId && r.available !== false) pwCache[r.groupId] = r.password;
  const t = el('spPwText'), b = el('spPwBtn');
  if (t) { t.textContent = r.available === false ? 'Not available' : r.password; if (b) b.style.display = 'none'; }
  const row = r.groupId && el('pw-' + r.groupId); if (row && r.available !== false) row.innerHTML = `<span class="pw-shown">${escapeHtml(r.password)}</span>`;
});
// Seller profile: password shown straight away, plus ban / unban and room lock
socket.on('seller-profile', ({ groupId, account: a, viewer }) => {
  const body = el('spBody'); if (!body || el('sellerProfileModal').classList.contains('hidden')) return;
  applyCachedPw(a.groupId);
  if (viewer && viewer.canViewPassword && a.passwordStored && !body.dataset.pwAuto) { body.dataset.pwAuto = '1'; setTimeout(() => socket.emit('admin-reveal-seller-password', { groupId: a.groupId }), 150); }
  if (!body.querySelector('#spControls')) {
    const sec = body.querySelector('#spSecurity'); if (!sec) return;
    sec.insertAdjacentHTML('beforeend', `<div id="spControls" class="sc-actions" style="margin-top:10px">
      <button class="admin-btn admin-btn-danger" onclick="toggleBan('${a.groupId}', ${!a.banned})">${a.banned ? '<i class="fa-solid fa-rotate-left"></i> Unban seller' : '<i class="fa-solid fa-gavel"></i> Ban seller'}</button>
      <button class="admin-btn" onclick="socket.emit('admin-set-room-locked',{groupId:'${a.groupId}',locked:${!a.roomLocked}})">${a.roomLocked ? '<i class="fa-solid fa-lock-open"></i> Unlock transaction room' : '<i class="fa-solid fa-lock"></i> Lock transaction room'}</button></div>
      <p class="reg-note">${a.manualSeller ? 'This account was added manually by an admin. ' : ''}Transaction room: <b>${a.roomLocked ? 'Locked' : 'Open'}</b>${a.banned ? ' · <b style="color:var(--accent-rose)">BANNED</b>' : ''}</p>`);
  }
});

const _openSP = openSellerProfile;
openSellerProfile = function (gid) { const b = el('spBody'); if (b) delete b.dataset.pwAuto; delete pwCache[gid]; _openSP(gid); };
