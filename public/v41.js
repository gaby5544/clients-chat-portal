/* v3.13 client layer. Loaded last. It only ADDS to / wraps what earlier layers do (never deletes them).
   - seller account view in the bank style: balance card, quick actions, reconciled stats, recent activity, details sheet
   - Home · Transfer · Cards · Activity · Profile bottom bar; the virtual card has its own page
   - profile photo instead of initials; Sign out at the bottom of the side list
   - Summit is the default wallpaper (see v38.js)
   - Desk Officer (?officer=1) gets its own sign-in page, not the client welcome screen */
'use strict';
const v41safe = (fn) => { try { return fn(); } catch (e) { console.warn('[v41]', e); } };
const v41Esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v41El = (id) => document.getElementById(id);
const v41Get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const v41Set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } };
const v41Money = (n, c) => (typeof fmtMoney === 'function' ? fmtMoney(n, c) : Number(n || 0).toFixed(2) + ' ' + (c || ''));
const v41Acct = () => (typeof sellerAccountState !== 'undefined' && sellerAccountState) || null;

// ====================================================================
// 1. Layout of the seller account view
// ====================================================================
const V41_H1 = { transactions: 'Activity', transfer: 'Move money', withdraw: 'Withdraw', forms: 'Forms', profile: 'Profile', accounts: 'Accounts', card: 'Cards', statements: 'Statements', security: 'Security', help: 'Help & Support', notifications: 'Notifications' };
const V41_BN = [['dashboard', 'fa-solid fa-house', 'Home'], ['transfer', 'fa-solid fa-right-left', 'Transfer'], ['card', 'fa-regular fa-credit-card', 'Cards'], ['transactions', 'fa-solid fa-list', 'Activity'], ['profile', 'fa-solid fa-user', 'Profile']];
const V41_GROUP = { transfer: ['transfer', 'accounts', 'withdraw'], transactions: ['transactions', 'statements'], profile: ['profile', 'security', 'notifications', 'forms', 'help'], card: ['card'], dashboard: ['dashboard'] };

v41safe(() => {
  const view = v41El('txAccountView'); if (!view) return;
  view.classList.add('v41');
  const top = view.querySelector('.tx-topbar'), right = view.querySelector('.tx-topbar-right');
  if (top && right && !v41El('v41Hello')) {
    const oldLeft = top.firstElementChild;                       // the old "title + subtitle" group (kept in the page, hidden)
    const left = document.createElement('div'); left.className = 'v41-hd-left';
    left.innerHTML = '<div class="v41-hello" id="v41Hello"><small id="v41HelloSmall"></small><b id="v41HelloName"></b></div>';
    const av = v41El('txAvatar'); if (av) { av.setAttribute('role', 'button'); av.setAttribute('aria-label', 'Your profile'); left.insertBefore(av, left.firstChild); }
    top.insertBefore(left, top.firstChild);
    if (oldLeft && oldLeft !== left) oldLeft.classList.add('v41-oldtitle');
    const menu = view.querySelector('.tx-mobile-nav-btn'); if (menu) { menu.classList.add('v41-menu'); menu.setAttribute('aria-label', 'Menu'); right.appendChild(menu); }
    const chat = v41El('txChatPill');
    if (chat) { chat.innerHTML = '<i class="fa-solid fa-comments"></i><span class="long">Chat room</span><span class="short">Chat</span>'; right.insertBefore(chat, right.firstChild); }
    const flag = v41El('txFlagChip'); if (flag) right.insertBefore(flag, chat ? chat.nextSibling : right.firstChild);
  }
  // side list: a footer with "Back to chat room" and, at the very bottom, Sign out
  const side = view.querySelector('.tx-sidebar');
  if (side && !v41El('v41SideFoot')) {
    const foot = document.createElement('div'); foot.className = 'v41-sidefoot'; foot.id = 'v41SideFoot';
    const back = side.querySelector('button.tx-back-chat'); if (back) foot.appendChild(back);
    foot.insertAdjacentHTML('beforeend', '<button type="button" class="tx-nav-item v41-signout" id="txSignOut" onclick="v41SignOut()"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out</button>');
    side.appendChild(foot);
  }
  // bottom bar
  const bn = v41El('txBottomNav');
  if (bn) bn.innerHTML = V41_BN.map(([k, ic, lb]) => `<button type="button" data-bn="${k}" aria-label="${lb}"><i class="${ic}"></i>${lb}</button>`).join('');
  // Transfer page
  const scroll = view.querySelector('.tx-scroll');
  if (scroll && !v41El('txPageTransfer')) {
    scroll.insertAdjacentHTML('beforeend', `<div class="tx-page hidden" id="txPageTransfer"><div class="v41-list v41-move">
      <button type="button" class="v41-item" onclick="openTxDepositModal()"><span class="ico"><i class="fa-solid fa-paper-plane"></i></span><span class="t"><b>Send</b><small>Record a deposit you have made</small></span><i class="fa-solid fa-chevron-right chev"></i></button>
      <button type="button" class="v41-item" onclick="setTxAccountNav('accounts')"><span class="ico"><i class="fa-solid fa-plus"></i></span><span class="t"><b>Add money</b><small>Share your account details to receive a payment</small></span><i class="fa-solid fa-chevron-right chev"></i></button>
      <button type="button" class="v41-item" onclick="setTxAccountNav('withdraw')"><span class="ico"><i class="fa-solid fa-arrow-up"></i></span><span class="t"><b>Withdraw</b><small>Send your available balance to a bank or wallet</small></span><i class="fa-solid fa-chevron-right chev"></i></button></div></div>`);
  }
  TX_NAV_TITLES.transfer = ['Transfer', 'Move money in and out of your account.'];
  // a page title at the top of every page (the old title block in the top bar is hidden)
  Object.keys(V41_H1).forEach((k) => { const pg = v41El('txPage' + k.charAt(0).toUpperCase() + k.slice(1)); if (pg && !pg.querySelector(':scope > h1.v41-page')) pg.insertAdjacentHTML('afterbegin', `<h1 class="v41-page">${v41Esc(V41_H1[k])}</h1>`); });
  // dashboard: our home block above everything; the KYC banner stays on top
  const dash = v41El('txPageDashboard');
  if (dash && !v41El('v41Home')) {
    dash.insertAdjacentHTML('afterbegin', '<div id="v41Home"></div>');
    const banner = v41El('txKycBanner'); if (banner) dash.insertBefore(banner, dash.firstChild);
  }
  // transactions page: summary on top, the new list at the end; the old table panel is replaced
  const tp = v41El('txPageTransactions');
  if (tp && !v41El('v41ActSum')) {
    const h1 = tp.querySelector(':scope > h1.v41-page');
    (h1 || tp).insertAdjacentHTML(h1 ? 'afterend' : 'afterbegin', '<div id="v41ActSum"></div>');
    tp.insertAdjacentHTML('beforeend', '<div class="v41-sec"><h2>All activity</h2></div><div class="v41-list" id="v41ActAll"></div>');
    const old = v41El('txFullActivityBody'); if (old && old.closest('.tx-panel')) old.closest('.tx-panel').classList.add('v41-old');
  }
  // profile page: photo header, account-number row, sign-out button
  const pp = v41El('txPageProfile');
  if (pp && !v41El('v41ProfHead')) {
    const h1 = pp.querySelector(':scope > h1.v41-page');
    (h1 || pp).insertAdjacentHTML(h1 ? 'afterend' : 'afterbegin', `<div class="v41-prof" id="v41ProfHead">
      <button type="button" class="v41-avatar-big" id="v41PickPhoto" aria-label="Add or change your photo"><span id="v41ProfInit">?</span><i class="cam fa-solid fa-camera"></i></button>
      <input type="file" id="v41File" accept="image/*" hidden>
      <div class="t"><b id="v41ProfName">—</b><small>Account owner · tap the photo to change it</small><button type="button" class="v41-link hidden" id="v41RemovePhoto" onclick="v41RemovePhoto()">Remove photo</button></div>
      <span class="tx-status-badge" id="v41ProfBadge">—</span></div>`);
    v41El('v41PickPhoto').addEventListener('click', () => v41El('v41File').click());
    v41El('v41File').addEventListener('change', v41PickFile);
    const idRow = v41El('txProfileAcctId') && v41El('txProfileAcctId').closest('.tx-profile-row');
    if (idRow && !v41El('txProfileAcctNoRow')) idRow.insertAdjacentHTML('afterend', '<div class="tx-profile-row" id="txProfileAcctNoRow"><span id="txProfileAcctNoLbl">Account number</span><b><span id="txProfileAcctNo" translate="no">—</span><button type="button" class="v41-eyebtn hidden" id="v41AcctNoEye" aria-label="Show account number" onclick="v41ToggleAcctNo()"><i class="fa-solid fa-eye-slash"></i></button></b></div>');
    pp.insertAdjacentHTML('beforeend', '<button type="button" class="v41-signout-row" onclick="v41SignOut()"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out</button>');
  }
  // details sheet (transaction details)
  if (!v41El('v41Sheet')) view.insertAdjacentHTML('beforeend', '<div class="v41-sheetbg" id="v41SheetBg"></div><div class="v41-sheet" id="v41Sheet" role="dialog" aria-modal="true" aria-label="Details"></div>');
  v41El('v41SheetBg').addEventListener('click', v41CloseSheet);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') v41CloseSheet(); });

function v41SyncHello() {
  const g = typeof greetingText === 'function' ? greetingText() : 'Hello'; const i = g.indexOf(',');
  const s = v41El('v41HelloSmall'), n = v41El('v41HelloName'); if (!s || !n) return;
  s.textContent = i > 0 ? g.slice(0, i) : g;
  const a = v41Acct(); n.textContent = i > 0 ? g.slice(i + 1).trim() : String((a && a.fullName) || '').split(/\s+/)[0] || '';
}
setInterval(() => v41safe(v41SyncHello), 60000);

function v41MarkNav(nav) {
  document.querySelectorAll('#txBottomNav [data-bn]').forEach((b) => { b.classList.toggle('active', (V41_GROUP[b.dataset.bn] || [b.dataset.bn]).includes(nav)); });
}
const _navV41 = setTxAccountNav;
setTxAccountNav = function (nav) {
  v41CloseSheet();
  _navV41(nav);
  v41MarkNav(nav);
  const sc = document.querySelector('#txAccountView .tx-scroll'); if (sc) sc.scrollTop = 0;
  if (nav === 'dashboard') { v41SyncHello(); v41RenderHome(); }
  if (nav === 'transactions') v41RenderActivityPage();
  if (nav === 'profile') v41RenderProfile();
};

// ====================================================================
// 2. The money picture (reconciled by the server; a safe fallback if an older state arrives)
// ====================================================================
let v41LastLedger = null;
function v41Ledger() {
  const a = v41Acct() || {}; const b = a.balances || {};
  if (a.ledger && typeof a.ledger === 'object') { v41LastLedger = a.ledger; return a.ledger; }
  if (v41LastLedger) return v41LastLedger;
  const total = Number(b.totalDeposited || 0), held = Number(b.held || 0), avail = Number(b.available || 0);
  let inn = Math.round((total - held) * 100) / 100, out = Math.round((inn - avail) * 100) / 100; if (out < 0) { inn -= out; out = 0; }
  const wd = (typeof sellerWithdrawals !== 'undefined' ? sellerWithdrawals : []).filter((w) => w.status === 'completed').reduce((s, w) => s + Number(w.amountLedger || w.amount || 0), 0);
  return { currency: a.currency || 'USD', totalDeposited: total, moneyIn: inn, moneyOut: out, fees: 0, withdrawn: Math.round(wd * 100) / 100, inProgress: Number(b.pending || 0), held, available: avail, other: 0, reconciles: true, feeItems: [] };
}
function v41AcctTail() {
  const a = v41Acct() || {};
  try {
    if (typeof rcData !== 'undefined' && rcData && rcData.ready && rcData.details && rcData.currency) {
      const d = rcData.details[rcData.currency]; const rows = [].concat((d && d.a) || [], (d && d.b) || []);
      const hit = rows.find((r) => /^account number$/i.test(r[0])) || rows.find((r) => /^iban$/i.test(r[0]));
      if (hit) { const t = String(hit[1]).replace(/[^0-9A-Za-z]/g, ''); return { kind: 'number', label: hit[0], value: String(hit[1]), text: '•••• ' + t.slice(-4) }; }
    }
  } catch (e) { /* fall through to the Account ID */ }
  const id = String(a.accountId || '');
  return id ? { kind: 'id', label: 'Account ID', value: id, text: 'ID •••• ' + id.slice(-4) } : { kind: '', label: '', value: '', text: '' };
}

// ====================================================================
// 3. Activity: every movement of money, newest first (incoming, deposits, withdrawals, fees)
// ====================================================================
let v41Rows = [];
function v41BuildActivity() {
  const a = v41Acct() || {}, ccy = a.currency || 'USD', rows = [];
  (typeof sellerIncoming !== 'undefined' ? sellerIncoming : []).forEach((i) => {
    const cr = i.status === 'credited', held = i.status === 'held_in_vault';
    rows.push({ kind: 'in', title: 'Payment from ' + (i.payerName || 'payer'), date: i.receivedAt, amount: Number(i.amountLedger != null ? i.amountLedger : i.amount), ccy, sign: cr ? 1 : 0, tone: cr ? 'pos' : held ? 'hold' : 'mute',
      status: cr ? 'Completed' : held ? 'In verification' : 'Reversed', ref: i.ref, src: i });
  });
  (typeof sellerDeposits !== 'undefined' ? sellerDeposits : []).forEach((d) => {
    const ok = d.status === 'verified', held = d.status === 'held_in_vault';
    rows.push({ kind: 'dep', title: 'Deposit' + (d.method === 'crypto' && d.asset ? ' · ' + d.asset : ''), date: d.verifiedAt || d.notifiedAt, amount: Number(d.amount), ccy, sign: ok ? 1 : 0, tone: ok ? 'pos' : held ? 'hold' : 'mute',
      status: ok ? 'Completed' : held ? 'Awaiting confirmation' : 'Declined', ref: d.ref, src: d });
  });
  (typeof sellerWithdrawals !== 'undefined' ? sellerWithdrawals : []).forEach((w) => {
    const done = w.status === 'completed', dec = ['declined', 'rejected', 'failed'].includes(w.status);
    rows.push({ kind: 'out', title: 'Withdrawal' + (w.method === 'crypto' ? ' · ' + (w.asset || 'Crypto') : ' · Bank'), date: w.createdAt, amount: Number(w.amountLedger != null ? w.amountLedger : w.amount), ccy, sign: dec ? 0 : -1, tone: dec ? 'mute' : done ? 'neg' : 'hold',
      status: done ? 'Completed' : dec ? 'Declined' : 'In progress', ref: w.ref, src: w });
  });
  const l = v41Ledger();
  (l.feeItems || []).forEach((f) => rows.push({ kind: 'fee', title: f.title || 'Fee', date: f.date, amount: Number(f.amount), ccy, sign: -1, tone: 'neg', status: 'Completed', ref: f.ref, src: f }));
  rows.sort((x, y) => new Date(y.date) - new Date(x.date));
  v41Rows = rows; return rows;
}
function v41RowHtml(x, i) {
  const ic = { in: 'fa-arrow-down', dep: 'fa-arrow-down', out: 'fa-arrow-up', fee: 'fa-receipt' }[x.kind] || 'fa-circle';
  const cls = x.sign > 0 ? 'in' : x.sign < 0 ? 'out' : x.tone === 'hold' ? 'hold' : '';
  const sg = x.sign > 0 ? '+' : x.sign < 0 ? '−' : '';
  const vcls = x.sign > 0 ? 'pos' : x.sign < 0 ? 'neg' : x.tone === 'hold' ? 'warn' : 'mute';
  return `<button type="button" class="v41-item" onclick="v41OpenTx(${i})"><span class="ico ${cls}"><i class="fa-solid ${ic}"></i></span><span class="t"><b>${v41Esc(x.title)}</b><small>${v41Esc(typeof fmtDateTime === 'function' ? fmtDateTime(x.date) : x.date)}</small></span><span class="v tnum ${vcls}" translate="no">${sg}${v41Esc(v41Money(x.amount, x.ccy))}<small>${v41Esc(x.status)}</small></span></button>`;
}

// ====================================================================
// 4. Home
// ====================================================================
let v41Hide = v41Get('q_hide_bal') === '1';
function v41ToggleBal() { v41Hide = !v41Hide; v41Set('q_hide_bal', v41Hide ? '1' : '0'); v41RenderHome(); }
function v41RenderHome() {
  const host = v41El('v41Home'), a = v41Acct(); if (!host || !a) return;
  const l = v41Ledger(), ccy = a.currency || l.currency || 'USD', rows = v41BuildActivity(), tail = v41AcctTail();
  const hid = v41Hide, f = (n) => v41Esc(v41Money(n, ccy));
  const sym = v41Money(0, ccy).replace(/[0-9.,\s]/g, '').replace(ccy, '').trim();
  const heldCount = (typeof sellerIncoming !== 'undefined' ? sellerIncoming : []).filter((i) => i.status === 'held_in_vault').length + (typeof sellerDeposits !== 'undefined' ? sellerDeposits : []).filter((d) => d.status === 'held_in_vault').length;
  const doneW = (typeof sellerWithdrawals !== 'undefined' ? sellerWithdrawals : []).filter((w) => w.status === 'completed').length;
  const kyc = (a.kyc && a.kyc.status) || 'not_submitted';
  const kycLabel = { not_submitted: 'Not submitted', pending: 'Pending review', verified: 'Verified', rejected: 'Rejected' }[kyc] || kyc;
  const kycHint = { not_submitted: 'Tap to verify', pending: 'Under review', rejected: 'Tap to resubmit', verified: 'Your account has full access' }[kyc] || '';
  const kycCls = kyc === 'verified' ? 'enabled' : kyc === 'rejected' ? 'disabled' : '';
  host.innerHTML = `
  <section class="v41-bal ${hid ? 'hid' : ''}" aria-label="Available balance">
    <div class="bt"><span>Available balance</span><span class="cur">${v41Esc(ccy)}</span></div>
    <div class="amtrow"><div class="amount tnum" id="v41Amount" translate="no">${hid ? (sym || '') + '••••••••' : f(l.available)}</div>
      <button class="eye" id="v41Eye" type="button" aria-pressed="${hid}" aria-label="${hid ? 'Show balance' : 'Hide balance'}" onclick="v41ToggleBal()"><i class="fa-solid fa-eye${hid ? '-slash' : ''}"></i></button></div>
    <div class="mm2"><div><small>Money in</small><b class="tnum pos" translate="no">${f(l.moneyIn)}</b></div><div><small>Money out</small><b class="tnum neg" translate="no">${f(l.moneyOut)}</b></div></div>
    <div class="bf"><span>${v41Esc(a.fullName || '')} · ${v41Esc(a.accountTypeLabel || 'Personal account')}</span><span class="tnum" translate="no" title="${v41Esc(tail.label)}">${hid ? '•••• ••••' : v41Esc(tail.text)}</span></div>
  </section>
  <div class="v41-actions">
    <button type="button" class="v41-act" onclick="openTxDepositModal()"><span class="c"><i class="fa-solid fa-paper-plane"></i></span>Send</button>
    <button type="button" class="v41-act" onclick="setTxAccountNav('accounts')"><span class="c"><i class="fa-solid fa-arrow-down"></i></span>Receive</button>
    <button type="button" class="v41-act" onclick="setTxAccountNav('withdraw')"><span class="c"><i class="fa-solid fa-arrow-up"></i></span>Withdraw</button>
    <button type="button" class="v41-act" onclick="setTxAccountNav('statements')"><span class="c"><i class="fa-regular fa-file-lines"></i></span>Statements</button>
  </div>
  <div class="v41-stats">
    <div class="v41-stat"><p>Total deposited</p><b class="tnum" translate="no">${f(l.totalDeposited)}</b><small>Lifetime</small></div>
    <div class="v41-stat"><p>Fees paid</p><b class="tnum" translate="no">${f(l.fees)}</b><small>${l.fees > 0 ? 'Card issuing fee' : 'No fees charged'}</small></div>
    <div class="v41-stat"><p>Withdrawn</p><b class="tnum" translate="no">${f(l.withdrawn)}</b><small>${doneW ? doneW + ' completed' : 'No withdrawals yet'}${l.inProgress > 0 ? ' · ' + f(l.inProgress) + ' in progress' : ''}</small></div>
    <div class="v41-stat"><p>Held in vault</p><b class="tnum" translate="no">${f(l.held)}</b><small>${heldCount ? heldCount + ' in review' : 'Nothing in review'}</small></div>
  </div>
  <div class="v41-list"><button type="button" class="v41-item v41-ident" onclick="handleTxIdentityCardClick()"><span class="ico"><i class="fa-solid fa-id-card"></i></span><span class="t"><b>Identity status</b><small>${v41Esc(kycHint)}</small></span><span class="tx-status-badge ${kycCls}">${v41Esc(kycLabel)}</span></button></div>
  <div class="v41-sec"><h2>Recent activity</h2><button type="button" onclick="setTxAccountNav('transactions')">See all</button></div>
  <div class="v41-list" id="v41Recent">${rows.length ? rows.slice(0, 3).map((x, i) => v41RowHtml(x, i)).join('') : '<div class="v41-empty">No activity yet. Payments, withdrawals and fees appear here.</div>'}</div>`;
}
function v41RenderActivityPage() {
  const a = v41Acct(); if (!a) return;
  const l = v41Ledger(), ccy = a.currency || l.currency || 'USD', rows = v41BuildActivity();
  const sum = v41El('v41ActSum'), all = v41El('v41ActAll');
  if (sum) sum.innerHTML = `<div class="v41-stats"><div class="v41-stat"><p>Money in</p><b class="tnum pos" translate="no">${v41Esc(v41Money(l.moneyIn, ccy))}</b><small>Credited to your balance</small></div><div class="v41-stat"><p>Money out</p><b class="tnum neg" translate="no">${v41Esc(v41Money(l.moneyOut, ccy))}</b><small>Withdrawals and fees</small></div></div>`;
  if (all) all.innerHTML = rows.length ? rows.map((x, i) => v41RowHtml(x, i)).join('') : '<div class="v41-empty">No activity yet.</div>';
}
function v41RenderAll() {
  const a = v41Acct(); if (!a) return;
  v41SyncHello(); v41RenderHome(); v41RenderProfile();
  const tp = v41El('txPageTransactions'); if (tp && !tp.classList.contains('hidden')) v41RenderActivityPage();
  v41ApplyPhoto();
}
const _rtaV41 = renderTxAccountUI;
renderTxAccountUI = function () { _rtaV41(); v41safe(v41RenderAll); };

// ====================================================================
// 5. Transaction details sheet
// ====================================================================
function v41CloseSheet() { const s = v41El('v41Sheet'), b = v41El('v41SheetBg'); if (s) s.classList.remove('on'); if (b) b.classList.remove('on'); }
function v41OpenTx(i) {
  const x = v41Rows[i], s = v41El('v41Sheet'); if (!x || !s) return;
  const dl = (k, v) => (v == null || v === '' ? '' : `<div class="v41-dl"><span>${v41Esc(k)}</span><b translate="no">${v41Esc(v)}</b></div>`);
  const sg = x.sign > 0 ? '+' : x.sign < 0 ? '−' : '', cls = x.sign > 0 ? 'pos' : x.sign < 0 ? 'neg' : x.tone === 'hold' ? 'warn' : '';
  const r = x.src || {}; let rows = dl('Status', x.status) + dl('Date', typeof fmtDateTime === 'function' ? fmtDateTime(x.date) : x.date);
  let receipt = '';
  if (x.kind === 'in') {
    rows += dl('From', r.payerName) + dl('Payment for', r.purpose);
    if (r.amountCurrency && r.amountCurrency !== x.ccy) rows += dl('Amount sent', v41Money(r.amount, r.amountCurrency));
    if (Number(r.feeAmount) > 0) rows += dl('Charge', v41Money(r.feeAmount, r.amountCurrency) + (r.feePayer === 'buyer' ? ' (paid by the buyer)' : ' (deducted)'));
    if (r.receivedInto) rows += dl('Credited to', r.receivedInto.idLabel ? r.receivedInto.label + ' · ' + r.receivedInto.idLabel : r.receivedInto.label);
    if (r.statusReason) rows += dl('Note', r.statusReason);
    if (r.receiptUrl) receipt = `<a class="v41-cta" href="${v41Esc(r.receiptUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-invoice"></i> Download receipt</a>`;
  } else if (x.kind === 'out') {
    rows += dl('Method', r.method === 'crypto' ? 'Crypto · ' + (r.asset || '') + (r.network ? ' (' + r.network + ')' : '') : 'Bank transfer');
    if (r.method !== 'crypto' && r.bankName) rows += dl('Bank', r.bankName);
    const dest = r.method === 'crypto' ? r.destination : r.bankAccount; if (dest) { const t = String(dest); rows += dl('To', t.length > 8 ? '•••• ' + t.slice(-4) : t); }
    if (r.statusReason) rows += dl('Note', r.statusReason);
    if (r.receiptUrl) receipt = `<a class="v41-cta" href="${v41Esc(r.receiptUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-invoice"></i> Download receipt</a>`;
  } else if (x.kind === 'fee') {
    rows += dl('Type', 'One-time issuing fee');
  } else if (r.rejectionReason) rows += dl('Note', r.rejectionReason);
  rows += dl('Reference', x.ref);
  s.innerHTML = `<div class="v41-grab"></div><h3>${v41Esc(x.title)}</h3><p class="hint">${v41Esc(typeof fmtDateTime === 'function' ? fmtDateTime(x.date) : '')}</p>
    <div class="v41-bigamt tnum ${cls}" translate="no">${sg}${v41Esc(v41Money(x.amount, x.ccy))}</div><div class="v41-list">${rows}</div>${receipt}<button type="button" class="v41-cta ghost" onclick="v41CloseSheet()">Close</button>`;
  s.scrollTop = 0; v41El('v41SheetBg').classList.add('on'); s.classList.add('on');
}

// ====================================================================
// 6. Profile: photo, account number, Sign out
// ====================================================================
let v41Photo = null, v41ShowNo = false;
const v41PhotoKey = () => 'q_photo_' + (typeof activeGroupId !== 'undefined' ? activeGroupId : 'x');
function v41ApplyPhoto() {
  ['txAvatar', 'v41PickPhoto'].forEach((id) => { const n = v41El(id); if (!n) return; n.style.backgroundImage = v41Photo ? `url(${v41Photo})` : ''; n.classList.toggle('has', !!v41Photo); });
  const rm = v41El('v41RemovePhoto'); if (rm) rm.classList.toggle('hidden', !v41Photo);
}
function v41SetPhoto(d, save) {
  v41Photo = d || null; v41Set(v41PhotoKey(), v41Photo); v41ApplyPhoto();
  if (save && typeof socket !== 'undefined') socket.emit('set-my-photo', { groupId: activeGroupId, photo: v41Photo });
}
function v41RemovePhoto() { v41SetPhoto(null, true); if (typeof toast === 'function') toast('Profile photo removed.'); }
function v41PickFile(e) {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!/^image\//.test(f.type || '')) return toast('Please choose a picture (JPG or PNG).', true);
  const url = URL.createObjectURL(f), im = new Image();
  im.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 256; const m = Math.min(im.width, im.height);
      c.getContext('2d').drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, 256, 256);
      const d = c.toDataURL('image/jpeg', 0.85); URL.revokeObjectURL(url);
      v41SetPhoto(d, true); toast('Profile photo updated.');
    } catch (x) { toast('We could not read that picture. Try a JPG or PNG.', true); }
  };
  im.onerror = () => { URL.revokeObjectURL(url); toast('We could not read that picture. Try a JPG or PNG.', true); };
  im.src = url;
}
socket.on('my-photo', (d) => { v41Photo = d && d.photo ? d.photo : null; v41Set(v41PhotoKey(), v41Photo); v41ApplyPhoto(); });
socket.on('photo-result', (d) => { if (d && d.ok === false) { toast(d.error || 'We could not save your photo.', true); socket.emit('get-my-photo', { groupId: activeGroupId }); } });
socket.on('seller-account-state', () => setTimeout(() => {
  if (typeof isSellerUI === 'function' && !isSellerUI()) return;
  if (!v41Photo) { const c = v41Get(v41PhotoKey()); if (c) { v41Photo = c; v41ApplyPhoto(); } }
  if (window.__v41PhotoSynced !== activeGroupId) { window.__v41PhotoSynced = activeGroupId; socket.emit('get-my-photo', { groupId: activeGroupId }); }
  v41safe(v41RenderAll);
}, 5));
socket.on('receiving-details', () => setTimeout(() => v41safe(v41RenderAll), 5));

function v41ToggleAcctNo() { v41ShowNo = !v41ShowNo; v41RenderProfile(); }
function v41RenderProfile() {
  const a = v41Acct(); if (!a) return;
  const nm = v41El('v41ProfName'); if (nm) nm.textContent = a.fullName || '—';
  const ini = v41El('v41ProfInit'); if (ini) ini.textContent = String(a.fullName || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const kyc = (a.kyc && a.kyc.status) || 'not_submitted', bd = v41El('v41ProfBadge');
  if (bd) { bd.textContent = { not_submitted: 'Not submitted', pending: 'Pending review', verified: 'Verified', rejected: 'Rejected' }[kyc] || kyc; bd.className = 'tx-status-badge' + (kyc === 'verified' ? ' enabled' : kyc === 'rejected' ? ' disabled' : ''); }
  const tail = v41AcctTail(), no = v41El('txProfileAcctNo'), eye = v41El('v41AcctNoEye'), lbl = v41El('txProfileAcctNoLbl');
  if (no) {
    if (tail.kind === 'number') { if (lbl) lbl.textContent = tail.label; no.textContent = v41ShowNo ? tail.value : (typeof rcMask === 'function' ? rcMask(tail.value) : tail.text); if (eye) { eye.classList.remove('hidden'); eye.setAttribute('aria-label', v41ShowNo ? 'Hide account number' : 'Show account number'); eye.innerHTML = `<i class="fa-solid fa-eye${v41ShowNo ? '' : '-slash'}"></i>`; } }
    else { if (lbl) lbl.textContent = 'Account number'; no.textContent = 'Not issued yet — payments use your Account ID'; if (eye) eye.classList.add('hidden'); }
  }
  v41ApplyPhoto();
}
// leaving the profile page hides the number again
const _navV41b = setTxAccountNav;
setTxAccountNav = function (nav) { if (nav !== 'profile') v41ShowNo = false; _navV41b(nav); };

function v41SignOut() {
  showConfirmModal({ title: 'Sign out?', message: 'You will need your email address and password to get back into your account.' }, v41DoSignOut);
}
function v41DoSignOut() {
  const gid = typeof activeGroupId !== 'undefined' ? activeGroupId : 'x';
  ['q_session_token', 'q_room_closed', 'q_admin_reveal'].forEach((k) => { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } });
  ['q_user_email', 'q_photo_' + gid, 'q_notes_' + gid].forEach((k) => v41Set(k, null));
  try { socket.disconnect(); } catch (e) { /* ignore */ }
  location.replace('/');
}

// ====================================================================
// 7. Desk Officer sign-in: a page of its own (?officer=1), nothing like the client welcome screen
// ====================================================================
const V41_OFFICER = new URLSearchParams(location.search).has('officer') || (() => { try { return sessionStorage.getItem('q_admin_reveal') === '1'; } catch (e) { return false; } })();
let v41OfficerTried = false;
function v41OfficerOpen() { return !!v41El('officerGate') && document.documentElement.classList.contains('officer-signin'); }
function v41OfficerClose() { document.documentElement.classList.remove('officer-signin'); const g = v41El('officerGate'); if (g) g.remove(); }
function v41OfficerMsg(t) { const m = v41El('ogMsg'); if (m) m.textContent = t || ''; const b = v41El('ogBtn'); if (b) { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Enter the Desk'; } }
function v41OfficerSubmit() {
  const key = (v41El('ogKey').value || '').trim();
  if (!key) { v41OfficerMsg('Enter your administrator passkey.'); v41El('ogKey').focus(); return; }
  v41OfficerMsg(''); const b = v41El('ogBtn'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking…';
  v41OfficerTried = true; adminPasskeyMemory = key;
  clearTimeout(window.__ogT); window.__ogT = setTimeout(() => { if (v41OfficerOpen()) v41OfficerFail('The Desk did not answer. Check your connection and try again.'); }, 15000);
  joinSession(key);
}
function v41OfficerFail(text) {
  clearTimeout(window.__ogT); adminPasskeyMemory = null; v41OfficerTried = false; v41OfficerMsg(text);
  const k = v41El('ogKey'); if (k) { k.value = ''; k.focus(); }
  try { socket.disconnect(); setTimeout(() => socket.connect(), 60); } catch (e) { /* ignore */ }   // leave the room we may have been put into as a visitor
}
if (V41_OFFICER) v41safe(() => {
  window.__holdJoin = true;                                  // never join a room as a visitor from the officer page
  document.documentElement.classList.add('officer-signin');
  document.body.insertAdjacentHTML('beforeend', `<div class="officer-gate" id="officerGate" role="dialog" aria-modal="true" aria-label="Desk Officer sign-in"><div class="og-card">
    <div class="og-badge"><i class="fa-solid fa-user-shield"></i></div>
    <div class="og-brand">VISTRA</div><h1>Desk Officer Console</h1>
    <div class="og-restricted"><i class="fa-solid fa-lock"></i> Restricted access · Authorised personnel only</div>
    <label class="og-field"><span>Administrator passkey</span><div class="og-pw"><i class="fa-solid fa-key"></i>
      <input id="ogKey" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Enter your passkey" aria-label="Administrator passkey">
      <button type="button" id="ogEye" aria-label="Show passkey"><i class="fa-solid fa-eye"></i></button></div></label>
    <div class="og-msg" id="ogMsg" role="alert"></div>
    <button type="button" class="og-btn" id="ogBtn"><i class="fa-solid fa-right-to-bracket"></i> Enter the Desk</button>
    <p class="og-foot"><i class="fa-solid fa-shield-halved"></i><span>Every officer session is logged and monitored. If you are not a Desk Officer, please close this page.</span></p></div></div>`);
  v41El('ogBtn').addEventListener('click', v41OfficerSubmit);
  v41El('ogKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') v41OfficerSubmit(); });
  v41El('ogEye').addEventListener('click', () => { const k = v41El('ogKey'), show = k.type === 'password'; k.type = show ? 'text' : 'password'; v41El('ogEye').innerHTML = `<i class="fa-solid fa-eye${show ? '-slash' : ''}"></i>`; v41El('ogEye').setAttribute('aria-label', show ? 'Hide passkey' : 'Show passkey'); });
  setTimeout(() => { const k = v41El('ogKey'); if (k) k.focus(); }, 80);
  socket.on('init-state', (d) => {
    if (!v41OfficerOpen()) return;
    if (d && d.isAdminConfirmed) { clearTimeout(window.__ogT); v41OfficerClose(); return; }
    if (v41OfficerTried) v41OfficerFail('That passkey was not recognised. Please try again.');
  });
  socket.on('room-closed', () => { if (v41OfficerOpen() && v41OfficerTried) v41OfficerFail('That passkey was not recognised. Please try again.'); });
});
// the officer page never joins a room as a visitor: only a passkey joins
const _joinV41 = joinSession;
joinSession = function (adminKey) { if (V41_OFFICER && !adminKey && !(typeof isAdminConfirmed !== 'undefined' && isAdminConfirmed)) return; return _joinV41(adminKey); };
// the client welcome screen must never replace the officer page
const _showClosedV41 = typeof showRoomClosed === 'function' ? showRoomClosed : null;
if (_showClosedV41) showRoomClosed = function (d) { if (V41_OFFICER && v41OfficerOpen()) return; return _showClosedV41(d); };

v41safe(() => { v41MarkNav('dashboard'); v41SyncHello(); });
