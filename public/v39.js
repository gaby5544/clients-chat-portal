// v3.9 — seller app design, receiving-account card, wallpapers, admin editor for account details.
// Loaded after v32.js. It only ADDS to the page and wraps existing functions; nothing earlier is removed.
(function () {
  'use strict';

  // ------------------------------------------------------------------ constants
  const WALLS = [
    { id: 1, name: 'Aurora Blue' }, { id: 2, name: 'Midnight Weave' }, { id: 3, name: 'Gold Dunes' },
    { id: 4, name: 'Summit Lines' }, { id: 5, name: 'Crimson Lattice' }, { id: 6, name: 'Halftone Eclipse' }
  ];
  const CCY_INFO = {
    USD: { sym: '$', intro: 'US dollar account. Receive USD from anywhere in the world.', note: 'International USD payments may pass through an intermediary bank. Allow 1 to 3 business days.' },
    EUR: { sym: '€', intro: 'Euro account. Receive EUR via SEPA and international transfers.', note: 'SEPA transfers usually arrive within one business day. Use the IBAN for all euro payments.' },
    GBP: { sym: '£', intro: 'Pound account. Receive GBP via Faster Payments and SWIFT.', note: 'UK payments need the sort code and account number. Overseas senders should use the IBAN and SWIFT.' }
  };
  const MONO = new Set(['accountNumber', 'routing', 'iban', 'sortCode', 'swift', 'reference']);
  const SECONDARY = new Set(['transactions', 'forms', 'statements', 'security', 'help']);
  const ICON = {
    home: '<svg viewBox="0 0 24 24"><path d="M3.5 10.8 12 3.6l8.5 7.2"/><path d="M5.5 9.6V20h13V9.6"/><path d="M10 20v-5.2a2 2 0 0 1 4 0V20"/></svg>',
    transfer: '<svg viewBox="0 0 24 24"><path d="M4 9h15.5M16 5.5 19.5 9 16 12.5"/><path d="M20 15H4.5M8 11.5 4.5 15 8 18.5"/></svg>',
    bank: '<svg viewBox="0 0 24 24"><path d="M3.5 9.5 12 4l8.5 5.5"/><path d="M4.5 9.5h15"/><path d="M6.5 12v5.5M10.2 12v5.5M13.8 12v5.5M17.5 12v5.5"/><path d="M3.5 20h17"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeoff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6a9.4 9.4 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-3.2 3.9M6.6 7.6A16 16 0 0 0 2.5 12S6 18.1 12 18.1a9 9 0 0 0 3.5-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    palette: '<svg viewBox="0 0 24 24"><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.7 0-1.4-1.2-1.6-1.2-2.8 0-1 .8-1.7 1.9-1.7H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.7 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.4" r="1"/><circle cx="15" cy="7.8" r="1"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="3.5" y="8" width="17" height="11.5" rx="2.5"/><path d="M16 13.7h2.2"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4.5v11M7 11l5 5 5-5"/><path d="M5 19.5h14"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.2" cy="6.5" r=".8"/><circle cx="4.2" cy="12" r=".8"/><circle cx="4.2" cy="17.5" r=".8"/></svg>'
  };
  let acctCcy = null;
  let hideBal = false;
  try { hideBal = localStorage.getItem('q_hide_bal') === '1'; } catch (e) { /* storage unavailable */ }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const acct = () => (typeof sellerAccountState !== 'undefined' ? sellerAccountState : null);
  const isSellerView = () => typeof isAdminConfirmed !== 'undefined' && !isAdminConfirmed && typeof myRole !== 'undefined' && myRole === 'PARTY B';
  const gid = () => (typeof activeGroupId !== 'undefined' ? activeGroupId : null);

  // ================================================================== 1. Wallpapers
  function wallKey() { return 'q_wall_' + (gid() || 'x'); }
  function currentWall() {
    const a = acct();
    if (a && Number(a.wallpaper) >= 1 && Number(a.wallpaper) <= WALLS.length) return Number(a.wallpaper);
    try { const v = Number(localStorage.getItem(wallKey())); if (v >= 1 && v <= WALLS.length) return v; } catch (e) { /* ignore */ }
    return 1;                                                     // #1 is the default
  }
  function applyWall() {
    const b = document.body;
    if (!isSellerView()) { b.classList.remove('seller-wall'); b.removeAttribute('data-wall'); const w = $('wallBtn'); if (w) w.classList.add('hidden'); return; }
    b.classList.add('seller-wall'); b.setAttribute('data-wall', String(currentWall()));
    const w = $('wallBtn'); if (w) w.classList.remove('hidden');
    paintWallGrids();
  }
  function wallGridHtml() {
    const cur = currentWall();
    return `<div class="wall-grid">${WALLS.map((w) => `<div><button type="button" class="wall-opt${w.id === cur ? ' on' : ''}" data-wall-id="${w.id}" onclick="chooseWall(${w.id})" aria-label="Style ${w.id}: ${esc(w.name)}" aria-pressed="${w.id === cur}"><img src="/wallpapers/wp-${w.id}-thumb.jpg" alt="" loading="lazy"><span class="wn">${w.id}</span><span class="wc"><i class="fa-solid fa-check"></i></span></button><div class="wall-cap">${esc(w.name)}${w.id === 1 ? ' · default' : ''}</div></div>`).join('')}</div>`;
  }
  function paintWallGrids() {
    document.querySelectorAll('[data-wall-grid]').forEach((box) => { box.innerHTML = wallGridHtml(); });
  }
  window.chooseWall = function (n) {
    n = Number(n); if (!(n >= 1 && n <= WALLS.length)) return;
    const a = acct(); if (a) a.wallpaper = n;
    try { localStorage.setItem(wallKey(), String(n)); } catch (e) { /* ignore */ }
    applyWall();
    if (typeof socket !== 'undefined') socket.emit('set-my-wallpaper', { groupId: gid(), wallpaper: n });
    if (typeof toast === 'function') toast(`Style ${n} applied — ${WALLS[n - 1].name}.`);
  };
  window.openWallPicker = function () {
    if (!$('wallModal')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="wallModal"><div class="modal-box wide"><div class="modal-header"><span><i class="fa-solid fa-palette"></i> Choose your style</span><i class="fa-solid fa-xmark" onclick="closeModal('wallModal')"></i></div><div class="modal-body"><p class="wall-hint">Your style becomes the background of your home page and your chat. It is saved on your account, so it follows you to every device.</p><div data-wall-grid></div></div></div></div>`);
    }
    paintWallGrids(); openModal('wallModal');
  };
  (function addHeaderButton() {
    const bar = document.querySelector('.header-actions'); if (!bar || $('wallBtn')) return;
    const b = document.createElement('button'); b.className = 'icon-btn hidden'; b.id = 'wallBtn'; b.title = 'Choose your style'; b.setAttribute('aria-label', 'Choose your style');
    b.onclick = () => window.openWallPicker(); b.innerHTML = '<i class="fa-solid fa-palette"></i>';
    const ref = $('txAccountBtn'); if (ref) bar.insertBefore(b, ref); else bar.appendChild(b);
  })();

  // ================================================================== 2. Shell: hero, bottom navigation, pages
  TX_NAV_TITLES.accounts = ['Accounts', 'Your receiving account details.'];

  (function buildShell() {
    const view = $('txAccountView'); if (!view || $('txBottomNav')) return;
    // bottom navigation (floating, rounded)
    view.insertAdjacentHTML('beforeend', `<nav class="tx-bnav" id="txBottomNav" aria-label="Account navigation">
      <button type="button" data-txnav="dashboard" onclick="setTxAccountNav('dashboard')">${ICON.home}<span>Home</span></button>
      <button type="button" data-txnav="withdraw" onclick="setTxAccountNav('withdraw')">${ICON.transfer}<span>Transfer</span></button>
      <button type="button" data-txnav="accounts" onclick="setTxAccountNav('accounts')">${ICON.bank}<span>Accounts</span></button>
      <button type="button" data-txnav="profile" onclick="setTxAccountNav('profile')">${ICON.user}<span>Profile</span></button>
    </nav>`);
    const main = view.querySelector('.tx-main'); if (main) main.style.position = 'relative';
    // back button in the page header (other pages go back to Home)
    const left = view.querySelector('.tx-topbar > div'); if (left) left.insertAdjacentHTML('afterbegin', `<button type="button" class="tx-back-btn" id="txBackBtn" onclick="setTxAccountNav('dashboard')" aria-label="Back to Home">${ICON.back}</button>`);
    // hero + home account card on the dashboard
    const dash = $('txPageDashboard');
    if (dash) dash.insertAdjacentHTML('afterbegin', `<div class="tx-hero" id="txHero">
        <div class="hero-top">
          <button type="button" class="hero-ic" onclick="closeTxAccountView()" aria-label="Back to chat" title="Back to chat">${ICON.back}</button>
          <div class="hero-brand"><span class="hero-mark">Q</span><span>TRANSACTION ACCOUNT</span></div>
          <button type="button" class="hero-ic" onclick="setTxAccountNav('transactions')" aria-label="Recent activity" title="Recent activity">${ICON.bell}</button>
        </div>
        <div class="hero-bal-row"><div><div class="hero-lab">Available balance</div><div class="hero-bal" id="txHeroBal">—</div></div>
          <button type="button" class="hero-ic" id="txHeroEye" onclick="toggleHeroBalance()" aria-label="Hide balance">${ICON.eye}</button></div>
        <div class="hero-chips"><span class="hero-chip gold" id="txHeroType">Standard</span><span class="hero-chip warn" id="txHeroKyc"></span><span class="hero-name" id="txHeroName"></span></div>
        <div class="hero-actions">
          <button type="button" class="hero-act" onclick="setTxAccountNav('accounts')">${ICON.down}Receive</button>
          <button type="button" class="hero-act" onclick="setTxAccountNav('withdraw')">${ICON.transfer}Transfer</button>
          <button type="button" class="hero-act" onclick="setTxAccountNav('transactions')">${ICON.list}Activity</button>
        </div>
      </div>
      <div class="tx-panel home-acct" id="txHomeAcct"></div>`);
    // Accounts page
    const scroll = view.querySelector('.tx-scroll');
    if (scroll && !$('txPageAccounts')) scroll.insertAdjacentHTML('beforeend', '<div class="tx-page hidden" id="txPageAccounts"><div id="txAccountsBody"></div></div>');
    // Profile page: style picker + "more" menu
    const prof = $('txPageProfile');
    if (prof && !$('txProfileAppearance')) {
      prof.insertAdjacentHTML('beforeend', `
        <div class="tx-panel" id="txProfileAppearance" style="max-width:560px;margin-top:16px;">
          <div class="tx-panel-head"><span><i class="fa-solid fa-palette"></i> Your style</span></div>
          <p class="wall-hint">Pick a look for your home page and chat. Style 1 is the default.</p>
          <div data-wall-grid></div>
        </div>
        <div class="tx-panel" id="txProfileMore" style="max-width:560px;margin-top:16px;">
          <div class="tx-panel-head"><span>More</span></div>
          <div class="more-list">
            <button type="button" class="more-item" onclick="setTxAccountNav('transactions')"><i class="fa-solid fa-bars-staggered ic"></i> Transactions<i class="fa-solid fa-chevron-right go"></i></button>
            <button type="button" class="more-item" onclick="setTxAccountNav('statements')"><i class="fa-solid fa-file-invoice-dollar ic"></i> Statements<i class="fa-solid fa-chevron-right go"></i></button>
            <button type="button" class="more-item" onclick="setTxAccountNav('forms')"><i class="fa-solid fa-file-lines ic"></i> Forms<i class="fa-solid fa-chevron-right go"></i></button>
            <button type="button" class="more-item" onclick="setTxAccountNav('security')"><i class="fa-solid fa-shield-halved ic"></i> Security<i class="fa-solid fa-chevron-right go"></i></button>
            <button type="button" class="more-item" onclick="setTxAccountNav('help')"><i class="fa-solid fa-life-ring ic"></i> Help &amp; Support<i class="fa-solid fa-chevron-right go"></i></button>
            <button type="button" class="more-item danger" onclick="closeTxAccountView()"><i class="fa-solid fa-arrow-right-from-bracket ic"></i> Back to chat<i class="fa-solid fa-chevron-right go"></i></button>
          </div>
        </div>`);
    }
  })();

  window.toggleHeroBalance = function () {
    hideBal = !hideBal; try { localStorage.setItem('q_hide_bal', hideBal ? '1' : '0'); } catch (e) { /* ignore */ }
    renderHero();
  };

  function kycChip(a) {
    const s = (a && a.kyc && a.kyc.status) || 'not_submitted';
    return { verified: ['ok', '✓ Verified'], pending: ['warn', 'Under review'], rejected: ['bad', 'Not approved'], not_submitted: ['warn', 'Not verified'] }[s] || ['warn', s];
  }
  function renderHero() {
    const a = acct(); if (!a || !$('txHero')) return;
    const ccy = a.currency || 'USD';
    $('txHeroBal').textContent = hideBal ? '••••••••' : fmtMoney(a.balances.available, ccy);
    const eye = $('txHeroEye'); eye.innerHTML = hideBal ? ICON.eyeoff : ICON.eye; eye.setAttribute('aria-label', hideBal ? 'Show balance' : 'Hide balance');
    $('txHeroType').textContent = (a.accountType === 'business' ? 'Business' : 'Standard');
    const [cls, label] = kycChip(a); const k = $('txHeroKyc'); k.className = 'hero-chip ' + cls; k.textContent = label;
    $('txHeroName').textContent = a.fullName || '';
  }

  // Home card: a glance at the receiving account (or why it is not available yet)
  function renderHomeAcct() {
    const box = $('txHomeAcct'); const a = acct(); if (!box || !a) return;
    const d = a.accountDetails; const ccy = pickCcy(a);
    if (a.kyc.status === 'verified' && d && d.ready && d.currencies[ccy]) {
      const rows = d.currencies[ccy].filter((r) => r.group === 'holder').slice(0, 2);
      box.innerHTML = `<div class="tx-panel-head"><span>${ICON.wallet.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:1.8;margin-right:6px"')}Receive money · ${esc(ccy)}</span><a href="#" onclick="setTxAccountNav('accounts'); return false;">All details →</a></div>
        <div class="ha-row"><span>Account name</span><b>${esc(d.holder || a.fullName || '')}</b></div>
        ${rows.map((r) => `<div class="ha-row"><span>${esc(r.label)}</span><b translate="no">${esc(r.value)}</b></div>`).join('')}`;
    } else {
      const msg = a.kyc.status === 'pending' ? 'Your documents are under review. Your account details appear here the moment you are approved.'
        : a.kyc.status === 'rejected' ? 'Your verification was not approved. Resubmit your documents to unlock your account details.'
          : 'Verify your identity to unlock your account details.';
      box.innerHTML = `<div class="ha-lock"><i class="fa-solid fa-lock"></i><div>${esc(msg)}</div></div>
        <div class="ha-foot"><span></span>${a.kyc.status === 'pending' ? '' : `<button type="button" class="send-btn" onclick="openTxKycWizard()"><i class="fa-solid fa-id-card"></i> ${a.kyc.status === 'rejected' ? 'Resubmit' : 'Verify now'}</button>`}</div>`;
    }
  }

  // ================================================================== 3. Accounts page (Receive money)
  function pickCcy(a) {
    const d = a && a.accountDetails; const have = d && d.ready ? d.order.filter((c) => (d.currencies[c] || []).length) : [];
    if (acctCcy && have.includes(acctCcy)) return acctCcy;
    if (a && have.includes(a.currency)) return a.currency;
    return have[0] || (a && a.currency) || 'USD';
  }
  const rowHtml = (r) => `<div class="acct-row"><span>${esc(r.label)}</span><b class="${MONO.has(r.key) ? 'mono' : ''}" translate="no">${esc(r.value)}</b></div>`;
  function groupsHtml(d, ccy) {
    const rows = d.currencies[ccy] || [];
    const holder = [{ key: 'holder', label: 'Account name', value: d.holder }].concat(rows.filter((r) => r.group === 'holder'));
    if (d.reference) holder.push({ key: 'reference', label: 'Payment reference (your Account ID)', value: d.reference });
    const bank = rows.filter((r) => r.group === 'bank');
    return `<div class="acct-grp"><div class="acct-gt">Account holder details</div>${holder.filter((r) => r.value).map(rowHtml).join('')}</div>
      ${bank.length ? `<div class="acct-grp"><div class="acct-gt">Bank details</div>${bank.map(rowHtml).join('')}</div>` : ''}`;
  }
  function lockedHtml(a) {
    const s = a.kyc.status;
    const done = (ok, t) => `<div><i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle todo'}"></i> ${t}</div>`;
    const steps = `<div class="steps">${done(true, 'Transaction Account created')}${done(s === 'pending' || s === 'verified', 'Identity documents submitted')}${done(false, 'Approved by the Desk — your details appear here')}</div>`;
    if (s === 'pending') return `<div class="acct-lock"><div class="big"><i class="fa-solid fa-hourglass-half"></i></div><h3>Your documents are under review</h3><p>We are checking your identity. Your receiving account details will appear on this page the moment you are approved, and we will notify you.</p>${steps}</div>`;
    if (s === 'rejected') return `<div class="acct-lock"><div class="big"><i class="fa-solid fa-circle-exclamation"></i></div><h3>Verification not approved</h3><p>${esc(a.kyc.rejectionReason || 'Please check your documents and submit them again.')}</p><button type="button" class="send-btn" onclick="openTxKycWizard()"><i class="fa-solid fa-upload"></i> Resubmit documents</button></div>`;
    return `<div class="acct-lock"><div class="big"><i class="fa-solid fa-lock"></i></div><h3>Your account details unlock after approval</h3><p>Verify your identity once and your receiving account details — account number, routing, IBAN and bank information — will be shown here.</p>${steps}<button type="button" class="send-btn" onclick="openTxKycWizard()"><i class="fa-solid fa-id-card"></i> Verify now</button></div>`;
  }
  function renderAccounts() {
    const box = $('txAccountsBody'); const a = acct(); if (!box || !a) return;
    if (a.kyc.status !== 'verified') { box.innerHTML = `<div class="acct-wrap">${lockedHtml(a)}</div>`; return; }
    const d = a.accountDetails;
    if (!d || !d.ready) { box.innerHTML = `<div class="acct-wrap"><div class="acct-lock ok"><div class="big"><i class="fa-solid fa-gear fa-spin"></i></div><h3>Your account is being prepared</h3><p>You are approved. The Desk is finalising your receiving account details and they will appear here shortly. We will notify you.</p></div></div>`; return; }
    const ccys = d.order.filter((c) => (d.currencies[c] || []).length);
    const cur = pickCcy(a); acctCcy = cur; const info = CCY_INFO[cur] || { intro: '', note: '' };
    const when = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    box.innerHTML = `<div class="acct-wrap" id="txAcctCard">
      <div class="print-only"><h2>Receiving account details</h2><p>${esc(d.holder || '')} · Account ID ${esc(d.reference || '')} · ${esc(when)}</p></div>
      <div class="acct-live">
        <div class="acct-title">Receive money</div>
        <div class="acct-tabs" role="tablist">${ccys.map((c) => `<button type="button" role="tab" aria-selected="${c === cur}" class="acct-tab${c === cur ? ' on' : ''}" onclick="setAcctCcy('${c}')">${(CCY_INFO[c] || {}).sym || ''} ${c}</button>`).join('')}</div>
        <div class="acct-intro">${esc(info.intro)}</div>
        ${groupsHtml(d, cur)}
        <div class="acct-note"><i class="fa-solid fa-circle-info"></i><div>${esc(info.note)} Always quote your Account ID as the payment reference.</div></div>
        <div class="acct-actions no-print"><button type="button" class="admin-btn" onclick="shareAcctPdf()"><i class="fa-solid fa-file-pdf"></i> Share as PDF</button></div>
        <div class="acct-foot no-print"><i class="fa-solid fa-lock"></i> Private to you — only you and the Desk can see these details.</div>
      </div>
      <div class="acct-print-all">${ccys.map((c) => `<div class="acct-pc"><h3>${(CCY_INFO[c] || {}).sym || ''} ${c} account</h3>${groupsHtml(d, c)}</div>`).join('')}</div>
    </div>`;
  }
  window.setAcctCcy = function (c) { acctCcy = c; renderAccounts(); };
  window.shareAcctPdf = function () {
    document.body.classList.add('print-acct');
    const done = () => { document.body.classList.remove('print-acct'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try { window.print(); } finally { setTimeout(done, 1500); } }, 60);
  };

  // ================================================================== 4. Navigation wrapper
  const _nav39 = setTxAccountNav;
  setTxAccountNav = function (nav) {
    _nav39(nav);
    const v = $('txAccountView'); if (v) v.dataset.page = nav;
    const prof = document.querySelector('#txBottomNav [data-txnav="profile"]');
    if (prof && SECONDARY.has(nav)) prof.classList.add('active');
    if (nav === 'accounts') renderAccounts();
    if (nav === 'dashboard') { renderHero(); renderHomeAcct(); }
    if (nav === 'profile') paintWallGrids();
    const sc = document.querySelector('#txAccountView .tx-scroll'); if (sc) sc.scrollTop = 0;
  };

  // keep toasts clear of the floating navigation while the account view is open
  (function watchOpen() {
    const v = $('txAccountView'); if (!v || !window.MutationObserver) return;
    const sync = () => document.body.classList.toggle('tx-open', !v.classList.contains('hidden'));
    new MutationObserver(sync).observe(v, { attributes: true, attributeFilter: ['class'] }); sync();
  })();

  // ================================================================== 5. Live updates
  function refresh() {
    applyWall(); renderHero(); renderHomeAcct();
    const p = $('txPageAccounts'); if (p && !p.classList.contains('hidden')) renderAccounts();
  }
  socket.on('seller-account-state', () => setTimeout(refresh, 0));
  socket.on('init-state', () => setTimeout(applyWall, 0));
  window.addEventListener('storage', (e) => { if (e.key === wallKey()) applyWall(); });
  setTimeout(() => { applyWall(); const v = $('txAccountView'); if (v && !v.dataset.page) v.dataset.page = 'dashboard'; }, 0);

  // ================================================================== 6. Admin: receiving account details editor
  socket.on('seller-profile', ({ account: a }) => {
    const body = $('spBody'); if (!body || !a || !a.accountDetailsAdmin || $('sellerProfileModal').classList.contains('hidden')) return;
    const d = a.accountDetailsAdmin; const st = a.kyc.status;
    const status = d.hasCustom
      ? '<div class="ad-status cus"><i class="fa-solid fa-pen-to-square"></i> Customised for this seller. Fields marked ✎ are your own values; the rest are generated.</div>'
      : (d.autogen ? '<div class="ad-status gen"><i class="fa-solid fa-triangle-exclamation"></i> These details are <b>auto-generated placeholders</b> (valid format, not tied to a real bank account). Enter your real banking details below before accepting real money.</div>'
        : '<div class="ad-status gen"><i class="fa-solid fa-triangle-exclamation"></i> Auto-generation is off. The seller sees only what you enter here.</div>');
    const vis = `<div class="reg-note">The seller sees these details only after identity approval. Current status: <b>${esc(String(st).replace(/_/g, ' '))}</b>.</div>`;
    const blocks = d.order.map((c) => `<div class="ad-ccy"><h4>${(CCY_INFO[c] || {}).sym || ''} ${c}</h4><div class="ad-grid">${(d.currencies[c] || []).map((r) => `<label class="${r.key === 'bankAddress' ? 'wide' : ''}"><span class="${r.custom ? 'cust' : ''}">${esc(r.label)}${r.custom ? ' ✎' : ''}</span><input type="text" class="message-input" maxlength="140" autocomplete="off" spellcheck="false" data-ad-ccy="${c}" data-ad-key="${r.key}" data-ad-orig="${esc(r.value)}" data-ad-custom="${r.custom ? 1 : 0}" value="${esc(r.value)}"></label>`).join('')}</div></div>`).join('');
    body.insertAdjacentHTML('beforeend', `<div class="sp-sec">Receiving account details</div><div class="ad-wrap" data-ad-group="${esc(a.groupId)}">${status}${vis}${blocks}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;"><button type="button" class="send-btn" onclick="adSave()"><i class="fa-solid fa-floppy-disk"></i> Save details</button><button type="button" class="admin-btn" onclick="adReset()"><i class="fa-solid fa-rotate-left"></i> Reset to generated</button></div></div>`);
  });
  window.adSave = function () {
    const wrap = document.querySelector('.ad-wrap'); if (!wrap) return;
    const details = {};
    wrap.querySelectorAll('input[data-ad-key]').forEach((i) => {
      const v = i.value.trim(); const orig = i.dataset.adOrig || ''; const wasCustom = i.dataset.adCustom === '1';
      if (v && (v !== orig || wasCustom)) { (details[i.dataset.adCcy] = details[i.dataset.adCcy] || {})[i.dataset.adKey] = v; }
    });
    socket.emit('admin-set-account-details', { groupId: wrap.dataset.adGroup, details });
  };
  window.adReset = function () {
    const wrap = document.querySelector('.ad-wrap'); if (!wrap) return;
    if (!confirm('Reset this seller\'s receiving account details to the generated set? Any values you typed will be removed.')) return;
    socket.emit('admin-reset-account-details', { groupId: wrap.dataset.adGroup });
  };
})();
