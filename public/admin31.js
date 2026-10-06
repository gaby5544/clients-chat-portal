// ============================================================================
// Admin dashboard (v3.1) — Sellers tab, Funds Desk, Record Incoming Funds,
// escrow review console, withdrawal stages, KYC / business queues, policy.
// Everything an admin controls about a seller lives here. Classic script,
// loaded after app.js / ui31.js / seller31.js.
// ============================================================================
'use strict';

const admOk = () => !!isAdminConfirmed && (currentAdminRole === 'ADMIN' || currentAdminRole === 'SUPER_ADMIN');
const admEsc = (s) => escapeHtml(s == null ? '' : String(s));
const SUPPORT_MAIL = 'complaints@usvistra.com';

let admSellers = [];        // publicSellerAccount(admin) for every registered seller
let admFunds = [];          // funds-overview summaries (every group)
let admKyc = [];            // pending KYC submissions
let admBiz = [];            // pending business applications
let admDeposits = [];       // pending crypto "record a deposit" notifications
let admWithdrawals = [];    // pending / processing withdrawals (all sellers)
let admPolicy = null;
let fdGroupId = null;       // group open in the Funds Desk modal
let fdLedger = null;        // latest ledger for it
let fdLedgerAt = 0;         // when it arrived (for the local countdown)
let rfPicker = null;        // payer-country picker
let rfProofUrl = null;

// ---------------------------------------------------------------- helpers
function admGroupName(groupId) {
  const f = admFunds.find((x) => x.groupId === groupId);
  if (f) return f.sellerName && f.registered ? f.sellerName : f.groupName;
  const g = (typeof groupsCache !== 'undefined' ? groupsCache : []).find((x) => x.id === groupId);
  return g ? g.name : 'Group';
}
function admInitials(name) {
  const p = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return p.map((w) => (w[0] || '').toUpperCase()).join('') || '?';
}
function pill(text, tone) { return `<span class="pill-sm ${tone || ''}">${admEsc(text)}</span>`; }
function kycTone(s) { return s === 'verified' ? 'ok' : s === 'rejected' ? 'bad' : s === 'pending' ? 'warn' : ''; }
function kycLabel(s) { return { verified: 'KYC verified', pending: 'KYC pending', rejected: 'KYC rejected', unverified: 'KYC not started', none: 'KYC not started' }[s] || 'KYC ' + (s || 'not started'); }
function disbPillHtml(on) { return on ? pill('Disbursement ON', 'ok') : pill('Disbursement OFF', ''); }
function money(n, ccy) { return fmtMoney(n, ccy); }
function docThumb(url, label) {
  if (!url) return `<div class="adm-doc empty"><i class="fa-regular fa-file"></i><span>${admEsc(label)}<br>not provided</span></div>`;
  const pdf = /\.pdf($|\?)/i.test(url);
  return `<a class="adm-doc" href="${admEsc(url)}" target="_blank" rel="noopener">${pdf ? '<i class="fa-solid fa-file-pdf"></i>' : `<img src="${admEsc(url)}" alt="${admEsc(label)}" loading="lazy">`}<span>${admEsc(label)}</span></a>`;
}
function kvRows(rows) {
  return `<div class="kv">${rows.filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v, raw]) => `<span>${admEsc(k)}</span><b class="notranslate" translate="no">${raw ? v : admEsc(v)}</b>`).join('')}</div>`;
}
// Re-rendering must never eat what an admin is typing: snapshot inputs, rebuild, restore.
function keepInputs(root, fn) {
  const snap = {};
  let focus = null;
  if (root) {
    root.querySelectorAll('input[id],textarea[id],select[id]').forEach((n) => {
      snap[n.id] = n.type === 'checkbox' || n.type === 'radio' ? n.checked : n.value;
    });
    const a = document.activeElement;
    if (a && root.contains(a) && a.id) focus = { id: a.id, s: a.selectionStart, e: a.selectionEnd };
  }
  fn();
  if (!root) return;
  Object.keys(snap).forEach((id) => {
    const n = document.getElementById(id);
    if (!n || !root.contains(n) || n.dataset.keep === 'reset') return; // reset = always show the server's value
    if (n.type === 'checkbox' || n.type === 'radio') n.checked = snap[id];
    else if (n.tagName === 'SELECT') { if (Array.from(n.options).some((o) => o.value === snap[id])) n.value = snap[id]; }
    else n.value = snap[id];
  });
  if (focus) {
    const n = document.getElementById(focus.id);
    if (n) { n.focus(); try { if (focus.s != null) n.setSelectionRange(focus.s, focus.e); } catch (e) { /* not a text input */ } }
  }
}
function acctFor(groupId) {
  if (fdLedger && fdLedger.groupId === groupId) return fdLedger.account;
  return admSellers.find((s) => s.groupId === groupId) || null;
}
function updateAccountsTabBadge() {
  const dot = el('accountsTabDot');
  if (!dot) return;
  const n = admKyc.length + admBiz.length + admDeposits.length + admWithdrawals.filter((w) => w.status === 'pending').length;
  dot.classList.toggle('hidden', n === 0);
}

// ---------------------------------------------------------------- Funds Desk list (Accounts tab)
socket.on('funds-overview', (list) => { if (!admOk()) return; admFunds = list; renderFundsDesk(); });
socket.on('funds-desk-summary', (s) => {
  if (!admOk()) return;
  const i = admFunds.findIndex((x) => x.groupId === s.groupId);
  if (i >= 0) admFunds[i] = s; else admFunds.unshift(s);
  renderFundsDesk();
});
function renderFundsDesk() {
  const box = el('fundsDeskList');
  if (!box) return;
  if (!admFunds.length) { box.innerHTML = '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No groups yet.</p>'; return; }
  const rows = admFunds.slice().sort((a, b) => (b.registered - a.registered) || (b.inReview - a.inReview) || (b.activeWithdrawals - a.activeWithdrawals) || a.groupName.localeCompare(b.groupName));
  box.innerHTML = rows.map((s) => {
    const ccy = s.currency;
    const flag = s.registered && s.country ? `<span title="${admEsc(s.country)}">${countryLine ? '' : ''}${s.countryFlag ? admEsc(s.countryFlag) : ''}</span>` : '';
    const name = s.registered ? s.sellerName : s.groupName;
    return `<div class="seller-card ${s.disabled ? 'disabled' : ''}" style="cursor:pointer;" onclick="openFundsDeskModal('${admEsc(s.groupId)}')">
      <div class="seller-card-head">
        <div class="seller-av">${admEsc(admInitials(name))}</div>
        <div style="flex:1; min-width:0;">
          <div class="seller-name notranslate" translate="no"><span>${admEsc(name)}</span> ${flag}
            ${s.accountId ? `<span class="tx-acctid-pill notranslate" translate="no">${admEsc(s.accountId)}</span>` : ''}
            ${s.disabled ? pill('Disabled', 'bad') : ''}</div>
          <div class="seller-sub notranslate" translate="no">${s.registered ? admEsc(s.email || 'no email') : 'Account not created yet'} · ${admEsc(s.groupName)}</div>
          <div class="seller-sub" style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
            ${s.registered ? disbPillHtml(s.disbursementEnabled) : ''}
            ${s.registered ? pill(kycLabel(s.kycStatus), kycTone(s.kycStatus)) : ''}
            ${s.businessStatus && s.businessStatus !== 'none' ? pill('Business ' + s.businessStatus, kycTone(s.businessStatus)) : ''}
            ${s.inReview ? pill(s.inReview + ' in escrow review', 'warn') : ''}
            ${s.activeWithdrawals ? pill(s.activeWithdrawals + ' withdrawal' + (s.activeWithdrawals > 1 ? 's' : ''), 'warn') : ''}
          </div>
        </div>
        ${s.registered ? `<div style="text-align:end; font-size:.7rem; color:var(--text-muted); white-space:nowrap;"><div style="font-weight:800; color:var(--accent-emerald); font-size:.82rem;">${money(s.balances.available, ccy)}</div><div>in vault ${money(s.balances.held, ccy)}</div></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- Seller controls (shared by Sellers tab + Funds Desk)
function sellerControlsHtml(a, p) {
  const gid = admEsc(a.groupId);
  const ips = (a.ipLog || []);
  const blocked = a.blockedIps || [];
  const uniq = [];
  ips.forEach((x) => { if (!uniq.find((u) => u.ip === x.ip)) uniq.push(x); });
  blocked.forEach((ip) => { if (!uniq.find((u) => u.ip === ip)) uniq.push({ ip, action: 'blocked', at: null }); });
  return `
  <div class="adm-controls">
    ${a.disabled
      ? `<div class="callout warn show" style="margin-bottom:8px;"><b>This seller is disabled.</b> ${a.disabledReason ? 'Reason: ' + admEsc(a.disabledReason) + '. ' : ''}They see a notice with ${SUPPORT_MAIL}.</div>
         <button class="admin-btn" onclick="adminSetDisabled('${gid}', false)"><i class="fa-solid fa-user-check"></i> Re-enable seller</button>`
      : `<div class="fld" style="margin:0 0 8px;"><label class="fld-label" for="${p}DisReason">Disable seller (optional reason shown to them)</label>
           <div class="input-row"><input id="${p}DisReason" class="message-input" maxlength="300" placeholder="e.g. Compliance review in progress" autocomplete="off">
           <button class="admin-btn admin-btn-danger" style="width:auto; white-space:nowrap;" onclick="adminSetDisabled('${gid}', true, '${p}DisReason')"><i class="fa-solid fa-user-slash"></i> Disable</button></div></div>`}
    <div class="sw-row"><div>Confirmed &amp; in disbursement stage<small>ON: the seller can request withdrawals. OFF: they see a popup pointing to the transaction group.</small></div>
      <label class="sw"><input type="checkbox" ${a.disbursementEnabled ? 'checked' : ''} onchange="adminSetDisbursement('${gid}', this.checked)" data-keep="reset"><i></i></label></div>
    <div class="sw-row"><div>Crypto prior-deposit requirement met<small>Override for VIP / institutional sellers — skips the required deposit before the first crypto withdrawal.</small></div>
      <label class="sw"><input type="checkbox" ${a.cryptoDepositVerified ? 'checked' : ''} onchange="adminSetCryptoOverride('${gid}', this.checked)" data-keep="reset"><i></i></label></div>
    <div class="btn-row">
      <button class="admin-btn" style="width:auto;" onclick="adminSendReset('${gid}')"><i class="fa-solid fa-key"></i> Email password-reset code</button>
      <button class="admin-btn" style="width:auto;" onclick="adminTempPassword('${gid}')"><i class="fa-solid fa-user-lock"></i> Set temporary password</button>
      <button class="admin-btn" style="width:auto;" onclick="adminRevokeSessions('${gid}')"><i class="fa-solid fa-right-from-bracket"></i> Sign out all devices</button>
      <button class="admin-btn" style="width:auto;" onclick="adminOpenGroup('${gid}')"><i class="fa-solid fa-comments"></i> Open chat group</button>
    </div>
    <div class="adm-sub-label">Login IP addresses</div>
    ${uniq.length ? `<div class="adm-ip-list">${uniq.map((x) => {
      const isB = blocked.includes(x.ip);
      return `<div class="adm-ip ${isB ? 'blocked' : ''}"><code class="notranslate" translate="no">${admEsc(x.ip)}</code><span>${admEsc(x.action || '')}${x.at ? ' · ' + admEsc(fmtDateTime(x.at)) : ''}</span>
        <button class="link-btn" onclick="adminIp('${gid}', '${admEsc(x.ip)}', ${isB ? 'false' : 'true'})">${isB ? 'Allow again' : 'Block'}</button></div>`;
    }).join('')}</div>` : '<p class="ledger-empty" style="padding:8px;">No IP addresses recorded yet.</p>'}
    <div class="input-row" style="margin-top:6px;"><input id="${p}IpAdd" class="message-input" placeholder="Block an IP address (e.g. 203.0.113.7)" autocomplete="off"><button class="admin-btn" style="width:auto;" onclick="adminIpAdd('${gid}', '${p}IpAdd')"><i class="fa-solid fa-ban"></i> Block IP</button></div>
    <p class="fld-hint" style="margin-top:4px;">A blocked IP cannot log in as this seller, create an account, or withdraw.</p>
  </div>`;
}
function adminSetDisabled(groupId, disabled, reasonInputId) {
  const reason = reasonInputId && el(reasonInputId) ? el(reasonInputId).value.trim() : '';
  const go = () => socket.emit('admin-set-seller-disabled', { groupId, disabled, reason });
  if (disabled) showConfirmModal({ title: 'Disable this seller?', message: `They will be notified immediately (live, push and email) and see a notice with ${SUPPORT_MAIL}. They cannot log in to their account until you re-enable it.` }, go);
  else go();
}
function adminSetDisbursement(groupId, enabled) { socket.emit('admin-set-disbursement', { groupId, enabled: !!enabled }); }
function adminSetCryptoOverride(groupId, enabled) { socket.emit('admin-set-crypto-override', { groupId, enabled: !!enabled }); toast(enabled ? 'Crypto requirement overridden for this seller.' : 'Crypto requirement restored for this seller.'); }
function adminSendReset(groupId) {
  showConfirmModal({ title: 'Email a password-reset code?', message: 'Passwords are stored securely hashed and cannot be viewed by anyone. A 6-digit reset code will be emailed to the seller instead.' }, () => socket.emit('admin-send-password-reset', { groupId }));
}
function adminIp(groupId, ip, block) { socket.emit(block ? 'admin-block-ip' : 'admin-unblock-ip', { groupId, ip }); }
function adminIpAdd(groupId, inputId) {
  const v = (el(inputId).value || '').trim();
  if (!v) return toast('Enter an IP address first.', true);
  socket.emit('admin-block-ip', { groupId, ip: v }); el(inputId).value = '';
}
function adminOpenGroup(groupId) {
  closeFundsDeskModal();
  if (typeof toggleAdminDrawer === 'function') toggleAdminDrawer(false);
  switchGroup(groupId);
}

// ---------------------------------------------------------------- Sellers tab
socket.on('sellers-list', (list) => { if (!admOk()) return; admSellers = list; renderSellersTab(); });
socket.on('seller-account-updated', (a) => {
  if (!admOk() || !a || !a.registered) return;
  const i = admSellers.findIndex((x) => x.groupId === a.groupId);
  if (i >= 0) admSellers[i] = a; else admSellers.unshift(a);
  renderSellersTab();
  if (fdGroupId === a.groupId && fdLedger) { fdLedger.account = Object.assign({}, fdLedger.account, a, { balances: Object.assign({}, a.balances, fdLedger.account.balances) }); renderFundsDeskModal(); }
});
const _openSellerCards = new Set();
function toggleSellerCard(gid) {
  if (_openSellerCards.has(gid)) _openSellerCards.delete(gid); else _openSellerCards.add(gid);
  const c = document.getElementById('sc-' + gid); if (c) c.classList.toggle('open', _openSellerCards.has(gid));
}
function renderSellersTab() {
  const box = el('sellersList');
  if (!box) return;
  const q = (el('sellerSearch').value || '').trim().toLowerCase();
  const list = admSellers.filter((a) => !q || [a.fullName, a.email, a.phone, a.accountId, a.country, a.groupName, a.currency].some((v) => String(v || '').toLowerCase().includes(q)));
  if (!list.length) { box.innerHTML = `<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">${admSellers.length ? 'No seller matches your search.' : 'No seller has created an account yet.'}</p>`; return; }
  keepInputs(box, () => {
    box.innerHTML = list.map((a) => {
      const p = 'sc' + a.groupId.replace(/[^A-Za-z0-9]/g, '');
      return `<div class="seller-card ${a.disabled ? 'disabled' : ''} ${_openSellerCards.has(a.groupId) ? 'open' : ''}" id="sc-${admEsc(a.groupId)}">
        <div class="seller-card-head" onclick="toggleSellerCard('${admEsc(a.groupId)}')">
          <div class="seller-av">${admEsc(admInitials(a.fullName || a.groupName))}</div>
          <div style="flex:1; min-width:0;">
            <div class="seller-name notranslate" translate="no"><span>${admEsc(a.fullName || a.groupName)}</span>
              ${a.countryCode ? flagHtml(a.countryCode) : (a.countryFlag || '')}
              <span class="tx-acctid-pill notranslate" translate="no">${admEsc(a.accountId || '—')}</span>
              ${a.disabled ? pill('Disabled', 'bad') : ''}</div>
            <div class="seller-sub notranslate" translate="no">${admEsc(a.email || '')} · ${admEsc(a.country || '')}</div>
          </div>
          <i class="fa-solid fa-chevron-down" style="color:var(--text-faint); font-size:.7rem;"></i>
        </div>
        <div class="seller-body">
          ${kvRows([
            ['Full name', a.fullName], ['Email (tied to account)', a.email], ['Phone', a.phone], ['Account ID', a.accountId],
            ['Country', a.country ? (a.countryFlag ? a.countryFlag + ' ' : '') + a.country : ''],
            ['Date of birth', a.dateOfBirth], ['Account type', a.accountType], ['Account currency', a.currency],
            ['Preferred language', a.language], ['Transaction group', a.groupName],
            ['Registered', a.registeredAt ? fmtDateTime(a.registeredAt) : ''],
            ['Terms accepted', a.termsAcceptedAt ? `${fmtDateTime(a.termsAcceptedAt)} (v${a.termsVersion || '—'})` : 'Not recorded'],
            ['Registration IP', a.registrationIp], ['Last IP', a.lastIp],
            ['KYC', kycLabel(a.kyc.status) + (a.kyc.attempts ? ` · ${a.kyc.attempts} attempt(s)` : '')],
            ['Business account', a.business.status === 'none' ? 'Not applied' : a.business.status],
            ['Disbursement stage', a.disbursementEnabled ? 'ON — withdrawals open' : 'OFF — withdrawals closed']
          ])}
          <div class="btn-row" style="margin:6px 0 10px;">
            <button class="send-btn" style="width:auto;" onclick="openFundsDeskModal('${admEsc(a.groupId)}')"><i class="fa-solid fa-vault"></i> Open ledger &amp; funds</button>
          </div>
          ${sellerControlsHtml(a, p)}
        </div>
      </div>`;
    }).join('');
  });
}

// ---------------------------------------------------------------- Funds Desk modal
function openFundsDeskModal(groupId) {
  if (!admOk()) return;
  fdGroupId = groupId; fdLedger = null;
  el('ledgerModalTitle').textContent = admGroupName(groupId) + ' — ledger';
  el('fdProfile').innerHTML = '<p class="ledger-empty">Loading…</p>';
  el('fundsDeskModal').classList.remove('hidden');
  socket.emit('admin-get-seller-ledger', { groupId });
}
function closeFundsDeskModal() { fdGroupId = null; fdLedger = null; el('fundsDeskModal').classList.add('hidden'); }
socket.on('funds-desk-ledger', (ledger) => {
  if (!admOk() || !ledger || ledger.groupId !== fdGroupId) return;
  fdLedger = ledger; fdLedgerAt = Date.now();
  renderFundsDeskModal();
});

function renderFundsDeskModal() {
  const L = fdLedger;
  if (!L) return;
  const a = L.account;
  const ccy = a.currency;
  el('ledgerModalTitle').textContent = (a.fullName || a.groupName) + ' — ledger';
  el('ledgerAvailable').textContent = money(a.balances.available, ccy);
  el('ledgerHeld').textContent = money(a.balances.inVault != null ? a.balances.inVault : a.balances.held, ccy);
  el('ledgerPendingWd').textContent = money(a.balances.pendingWithdrawals || 0, ccy);
  el('ledgerTotal').textContent = money(a.balances.totalDeposited, ccy);
  const root = el('fundsDeskModal').querySelector('.modal-body');
  keepInputs(root, () => {
    el('fdProfile').innerHTML = `
      <div class="adm-profile">
        <div class="seller-av" style="width:52px;height:52px;font-size:1rem;">${admEsc(admInitials(a.fullName || a.groupName))}</div>
        <div style="flex:1; min-width:0;">
          <div class="seller-name notranslate" translate="no" style="font-size:1rem;">${admEsc(a.fullName || a.groupName)} ${a.countryCode ? flagHtml(a.countryCode) : ''}
            ${a.disabled ? pill('Disabled', 'bad') : pill('Active', 'ok')} ${disbPillHtml(a.disbursementEnabled)} ${pill(kycLabel(a.kyc.status), kycTone(a.kyc.status))}</div>
          <div class="seller-sub notranslate" translate="no">Account ID <b class="notranslate" translate="no" style="color:var(--accent-cyan);">${admEsc(a.accountId || '—')}</b> · ${admEsc(a.accountType)} · ${admEsc(ccy || '')}</div>
        </div>
      </div>
      ${a.registered ? kvRows([
        ['Email', a.email], ['Phone', a.phone], ['Country', a.country], ['Date of birth', a.dateOfBirth], ['Language', a.language],
        ['Registered', a.registeredAt ? fmtDateTime(a.registeredAt) : ''], ['Terms accepted', a.termsAcceptedAt ? fmtDateTime(a.termsAcceptedAt) : ''],
        ['Registration IP', a.registrationIp], ['Last IP', a.lastIp],
        ['Daily limit', L.limits ? (L.limits.unlimited ? 'Unlimited (business)' : `${money(L.limits.used, ccy)} used of ${money(L.limits.daily, ccy)}`) : '']
      ]) : '<div class="callout warn show">This seller has not created their Transaction Account yet.</div>'}
      ${a.registered ? `<details class="adm-details"><summary>Seller controls — disable, disbursement, crypto override, IPs</summary>${sellerControlsHtml(a, 'fd')}</details>` : ''}
    `;
    el('ledgerIncomingList').innerHTML = L.incoming.length ? L.incoming.map(incomingRowHtml).join('') : '<p class="ledger-empty">No incoming funds recorded yet.</p>';
    el('ledgerWithdrawalsList').innerHTML = L.withdrawals.length ? L.withdrawals.map((w) => withdrawalRowHtml(w, true)).join('') : '<p class="ledger-empty">No withdrawals yet.</p>';
  });
  const btn = el('fundsDeskModal').querySelector('.send-btn');
  if (btn) btn.disabled = !a.registered;
}

const METHOD_NAMES = { bank_transfer: 'Bank transfer', wire: 'Wire transfer', crypto: 'Cryptocurrency', card: 'Card payment', cheque: 'Cheque', cash: 'Cash', other: 'Other' };
function incomingRowHtml(r) {
  const ccy = fdLedger.account.currency;
  const sameCcy = r.amountCurrency === ccy;
  const amt = money(r.amount, r.amountCurrency) + (sameCcy ? '' : ` <span style="font-size:.7rem;color:var(--text-muted);font-weight:600;">≈ ${money(r.amountLedger, ccy)}</span>`);
  const tone = r.status === 'credited' ? 'ok' : r.status === 'reversed' ? 'bad' : 'warn';
  const rid = admEsc(r.id);
  const actions = [];
  if (r.status === 'held_in_vault') actions.push(`<button class="admin-btn" style="width:auto;" onclick="adminReleaseHeld('${rid}')"><i class="fa-solid fa-unlock"></i> Release to available</button>`);
  if (['held_in_vault', 'credited', 'in_review'].includes(r.status)) actions.push(`<button class="admin-btn admin-btn-danger" style="width:auto;" onclick="adminReverseIncoming('${rid}')"><i class="fa-solid fa-rotate-left"></i> Reverse</button>`);
  return `<div class="ledger-row" id="inc-${rid}">
    <div class="ledger-row-top">
      <div class="ledger-row-direction in"><i class="fa-solid fa-arrow-down"></i></div>
      <div class="ledger-row-main">
        <div class="ledger-row-title-line"><span class="ledger-row-title notranslate" translate="no">${admEsc(r.payerName)}${r.payerType === 'company' ? ' · company' : ''}</span><span class="ledger-row-amount in">${amt}</span></div>
        <div class="ledger-row-sub notranslate" translate="no">${admEsc(r.purpose)}</div>
        <div class="ledger-row-sub">${pill(r.statusLabel, tone)} ${admEsc(METHOD_NAMES[r.method] || r.method)}${r.asset ? ' · ' + admEsc(r.asset) + (r.network ? ' ' + admEsc(r.network) : '') : ''} · received ${admEsc(fmtDateTime(r.receivedAt))}</div>
        <div class="ledger-row-ref notranslate" translate="no">${admEsc(r.ref)}${r.invoiceRef ? ' · inv ' + admEsc(r.invoiceRef) : ''}${r.externalRef ? ' · ' + admEsc(r.externalRef) : ''} · → <span class="notranslate" translate="no">${admEsc(r.targetAccountId || '—')}</span></div>
        <details class="adm-details"><summary>Payer details</summary>${kvRows([
          ['Email', r.payerEmail], ['Phone', r.payerPhone], ['Country', r.payerCountry], ['Bank', r.payerBank], ['Wallet', r.walletAddress]
        ])}${r.proofUrl ? `<a class="ledger-row-receipt" href="${admEsc(r.proofUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-paperclip"></i> View proof of payment</a>` : ''}</details>
      </div>
    </div>
    ${r.review && r.status === 'in_review' ? escConsoleHtml(r) : (r.review && r.status === 'credited' ? '<div class="ledger-row-sub" style="margin-top:6px;">' + pill('Review complete', 'ok') + '</div>' : '')}
    ${actions.length ? `<div class="ledger-row-actions">${actions.join('')}</div>` : ''}
    <div class="adm-note">
      <label class="fld-label" for="note-${rid}">Internal note</label>
      <textarea id="note-${rid}" class="message-input" rows="2" maxlength="1000" placeholder="Only admins see this unless you tick the box below.">${admEsc(r.internalNote || '')}</textarea>
      <div class="adm-note-row"><label><input type="checkbox" id="noteShare-${rid}" ${r.noteShared ? 'checked' : ''}> Buyer and seller can see this note</label>
        <button class="admin-btn" style="width:auto;" onclick="adminSaveNote('${rid}')"><i class="fa-solid fa-floppy-disk"></i> Save note</button></div>
    </div>
    ${r.receiptUrl ? `<a class="ledger-row-receipt" href="${admEsc(r.receiptUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-pdf"></i> Download receipt</a>` : ''}
    ${r.statusReason && r.status === 'reversed' ? `<div class="ledger-row-note">Reversed: ${admEsc(r.statusReason)}</div>` : ''}
  </div>`;
}
function adminSaveNote(id) {
  socket.emit('admin-set-incoming-note', { id, note: el('note-' + id).value, shared: el('noteShare-' + id).checked });
  toast('Note saved.');
}
function adminReleaseHeld(id) {
  showConfirmModal({ title: 'Release these funds?', message: 'The held amount moves to the seller\'s available balance and they are notified.' }, () => socket.emit('admin-update-incoming-funds', { id, action: 'release' }));
}
function adminReverseIncoming(id) {
  showPromptModal({ title: 'Reverse these funds', message: 'A reason is required. The seller is notified.', placeholder: 'Reason for reversal' }, (reason) => socket.emit('admin-update-incoming-funds', { id, action: 'reverse', reason }));
}

// ---- Escrow review console (the uploaded console, per in-review payment) ----
function escConsoleHtml(r) {
  const v = r.review;
  const rid = admEsc(r.id);
  const active = v.stages.find((s) => s.status === 'in_review');
  const manual = v.mode === 'manual';
  const nextLabel = v.nextAction || '';
  const left = (secs, paused) => `<span class="js-left" data-s="${secs == null ? '' : secs}" data-live="${!manual && !v.paused ? 1 : 0}" data-at="${fdLedgerAt}">${secs == null ? '—' : fmtDuration(secs)}</span>`;
  return `<div class="esc" id="esc-${rid}">
    <div class="esc-top"><span><i class="fa-solid fa-shield-halved"></i> Escrow review · ${admEsc(v.statusLine)}</span>
      <span>${manual ? pill('Manual', '') : pill(v.paused ? 'Paused' : 'Auto · ' + v.speed + '×', v.paused ? 'warn' : 'ok')} ${pill(v.progress + '%', '')}</span></div>
    <div class="esc-stages">${v.stages.map((s) => `<div class="esc-st ${s.status}"><div>${s.index}. ${admEsc(s.title)}</div><div style="font-weight:600;opacity:.8;margin-top:2px;">${s.status === 'passed' ? 'Passed' : s.status === 'in_review' ? 'In review' : 'Queued'}${s.durationSeconds ? '<br>' + admEsc(fmtDuration(s.durationSeconds)) : ''}</div></div>`).join('')}</div>
    ${active ? `<ul class="esc-checks">${active.checks.map((c) => `<li class="${c.done ? 'done' : ''}"><i class="fa-${c.done ? 'solid fa-circle-check' : 'regular fa-circle'}"></i> ${admEsc(c.text)}</li>`).join('')}</ul>` : ''}
    ${!manual ? `<div class="ledger-row-sub">Stage time left: ${left(v.stageSecondsLeft)} · whole review: ${left(v.totalSecondsLeft)}</div>` : ''}
    <div class="esc-ctl" style="margin-top:8px;">
      ${manual ? `<button class="admin-btn" style="width:auto;" onclick="escAct('${rid}','confirm')"><i class="fa-solid fa-check"></i> ${admEsc(nextLabel || 'Confirm check')}</button>` : ''}
      <button class="admin-btn" style="width:auto;" onclick="escAct('${rid}','approve')"><i class="fa-solid fa-forward-step"></i> Approve stage</button>
      <button class="admin-btn" style="width:auto;" onclick="escAct('${rid}','${v.paused ? 'resume' : 'pause'}')"><i class="fa-solid fa-${v.paused ? 'play' : 'pause'}"></i> ${v.paused ? 'Resume' : 'Pause'}</button>
      <button class="admin-btn" style="width:auto;" onclick="escAct('${rid}','restart')"><i class="fa-solid fa-rotate-left"></i> Restart</button>
      <button class="admin-btn" style="width:auto;" onclick="escRelease('${rid}')"><i class="fa-solid fa-bolt"></i> Release now</button>
    </div>
    <details class="adm-details"><summary>Review settings — mode, speed, duration</summary>
      <div class="esc-ctl" style="margin-top:8px;">
        <select id="escMode-${rid}" class="message-input" data-keep="reset"><option value="auto" ${v.mode === 'auto' ? 'selected' : ''}>Automatic</option><option value="manual" ${manual ? 'selected' : ''}>Manual</option></select>
        <select id="escSpeed-${rid}" class="message-input" data-keep="reset">${[1, 10, 60, 600, 3600].map((n) => `<option value="${n}" ${v.speed === n ? 'selected' : ''}>${n}×</option>`).join('')}<option value="fit">Auto-fit (~45 s)</option></select>
        <input id="escDur-${rid}" type="number" min="1" step="1" class="message-input" style="width:80px;" placeholder="Total">
        <select id="escUnit-${rid}" class="message-input"><option value="60">min</option><option value="3600" selected>hours</option><option value="86400">days</option></select>
        <label style="font-size:.72rem;display:flex;gap:6px;align-items:center;"><input type="checkbox" id="escShow-${rid}" ${v.showTime ? 'checked' : ''} data-keep="reset"> show seller the active-stage time</label>
        <button class="admin-btn" style="width:auto;" onclick="escConfigure('${rid}')"><i class="fa-solid fa-sliders"></i> Apply</button>
      </div>
      <p class="fld-hint">Leave the total empty to keep the current stage timers. Changing the total re-splits it across the 5 stages (10/25/35/10/20 %) and restarts the current stage clock.</p>
    </details>
  </div>`;
}
function escAct(id, action) { socket.emit('admin-review-action', { id, action }); }
function escRelease(id) {
  showConfirmModal({ title: 'Release immediately?', message: 'This skips the remaining review stages. The funds move to the seller\'s available balance now.' }, () => socket.emit('admin-update-incoming-funds', { id, action: 'release' }));
}
function escConfigure(id) {
  const opts = { mode: el('escMode-' + id).value, speed: el('escSpeed-' + id).value === 'fit' ? 'fit' : Number(el('escSpeed-' + id).value), showTime: el('escShow-' + id).checked };
  const dur = Number(el('escDur-' + id).value);
  if (dur > 0) opts.totalSeconds = Math.round(dur * Number(el('escUnit-' + id).value));
  socket.emit('admin-review-action', { id, action: 'configure', opts });
}
// local 1s countdown for the admin timers (the server re-pushes on every stage change)
setInterval(() => {
  document.querySelectorAll('.js-left').forEach((n) => {
    if (n.dataset.live !== '1' || n.dataset.s === '') return;
    const s = Math.max(0, Number(n.dataset.s) - Math.floor((Date.now() - Number(n.dataset.at)) / 1000));
    n.textContent = fmtDuration(s);
  });
}, 1000);

// ---------------------------------------------------------------- Withdrawals (stage control)
const WD_NEXT = { pending: ['processing', 'completed', 'declined'], processing: ['pending', 'completed', 'declined'] };
const WD_TEXT = { pending: 'Pending', processing: 'Processing', completed: 'Completed', declined: 'Declined' };
const WD_TONE = { pending: 'warn', processing: 'warn', completed: 'ok', declined: 'bad' };
function wdDestination(w) {
  if (w.method === 'crypto') return `${w.asset || ''} ${w.network ? '(' + w.network + ')' : ''} → ${w.destination || ''}`;
  return [w.beneficiaryName, w.bankName, w.bankAccount, w.bankSwift ? 'SWIFT ' + w.bankSwift : '', w.bankCountry].filter(Boolean).join(' · ');
}
function withdrawalRowHtml(w, inDesk) {
  const wid = admEsc(w.id);
  const next = WD_NEXT[w.status] || [];
  const ccyL = (fdLedger && fdLedger.groupId === w.groupId ? fdLedger.account.currency : (admFunds.find((f) => f.groupId === w.groupId) || {}).currency) || w.amountCurrency;
  return `<div class="ledger-row" id="${inDesk ? 'wd' : 'wq'}-${wid}">
    <div class="ledger-row-top">
      <div class="ledger-row-direction out"><i class="fa-solid fa-arrow-up"></i></div>
      <div class="ledger-row-main">
        <div class="ledger-row-title-line"><span class="ledger-row-title notranslate" translate="no">${inDesk ? '' : admEsc(admGroupName(w.groupId)) + ' · '}${w.method === 'crypto' ? 'Crypto' : 'Bank'} withdrawal</span><span class="ledger-row-amount out">${money(w.amount, w.amountCurrency)}</span></div>
        <div class="ledger-row-sub">${pill(w.statusLabel, WD_TONE[w.status])} <span class="notranslate" translate="no">${admEsc(wdDestination(w))}</span></div>
        <div class="ledger-row-ref notranslate" translate="no">${admEsc(w.ref)} · requested ${admEsc(fmtDateTime(w.createdAt))}${w.requestIp ? ' · IP ' + admEsc(w.requestIp) : ''}${w.payoutReference ? ' · payout ref ' + admEsc(w.payoutReference) : ''}</div>
        ${w.statusReason ? `<div class="ledger-row-note">${admEsc(w.statusReason)}</div>` : ''}
      </div>
    </div>
    ${next.length ? `<div class="esc-ctl adm-wd-ctl">
      <select id="wdSel-${wid}" class="message-input">${next.map((s) => `<option value="${s}">${WD_TEXT[s]}</option>`).join('')}</select>
      <input id="wdRef-${wid}" class="message-input" placeholder="Payout reference (completed)" maxlength="120" style="min-width:160px;" autocomplete="off">
      <input id="wdNote-${wid}" class="message-input" placeholder="Note / decline reason" maxlength="500" style="min-width:160px;" autocomplete="off">
      <button class="admin-btn" style="width:auto;" onclick="adminApplyWdStage('${wid}')"><i class="fa-solid fa-arrow-right"></i> Update stage</button>
    </div>` : `<div class="ledger-row-sub" style="margin-top:6px;">${pill(w.status === 'completed' ? 'Completed — final' : 'Declined — final', WD_TONE[w.status])}</div>`}
    ${w.receiptUrl ? `<a class="ledger-row-receipt" href="${admEsc(w.receiptUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-pdf"></i> Download receipt</a>` : ''}
  </div>`;
}
function adminApplyWdStage(id) {
  const toStatus = el('wdSel-' + id).value;
  const ref = el('wdRef-' + id).value.trim();
  const note = el('wdNote-' + id).value.trim();
  const send = (reason) => socket.emit('admin-set-withdrawal-stage', { withdrawalId: id, toStatus, reason, payoutReference: ref });
  if (toStatus === 'declined') {
    if (note) return showConfirmModal({ title: 'Decline this withdrawal?', message: 'The reserved funds return to the seller\'s available balance. This is final.' }, () => send(note));
    return showPromptModal({ title: 'Decline withdrawal', message: 'A reason is required. The funds return to the seller\'s available balance.', placeholder: 'Reason for declining' }, (r) => send(r));
  }
  if (toStatus === 'completed') return showConfirmModal({ title: 'Mark as completed?', message: 'The payout is final: the reserved funds leave the account. This cannot be undone.' }, () => send(note));
  send(note);
}
socket.on('withdrawals-queue-list', (list) => { if (!admOk()) return; admWithdrawals = list; renderWithdrawalsQueue(); });
socket.on('withdrawal-created', (w) => {
  if (!admOk() || !w) return;
  admWithdrawals = [w, ...admWithdrawals.filter((x) => x.id !== w.id)];
  renderWithdrawalsQueue();
  if (typeof Notif !== 'undefined' && Notif.chime) { try { Notif.chime(1); } catch (e) { /* audio blocked */ } }
  toast(`New withdrawal request: ${money(w.amount, w.amountCurrency)} from ${admGroupName(w.groupId)}`);
});
socket.on('withdrawal-updated', (w) => {
  if (!admOk() || !w) return;
  admWithdrawals = admWithdrawals.map((x) => (x.id === w.id ? w : x));
  renderWithdrawalsQueue();
});
socket.on('withdrawal-resolved', (w) => {
  if (!admOk() || !w) return;
  admWithdrawals = admWithdrawals.filter((x) => x.id !== w.id);
  renderWithdrawalsQueue();
});
function renderWithdrawalsQueue() {
  updateAccountsTabBadge();
  const box = el('withdrawalsQueueList');
  if (!box) return;
  keepInputs(box, () => {
    box.innerHTML = admWithdrawals.length ? admWithdrawals.map((w) => withdrawalRowHtml(w, false)).join('') : '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No withdrawals waiting.</p>';
  });
}

// ---------------------------------------------------------------- KYC queue
socket.on('kyc-queue-list', (list) => { if (!admOk()) return; admKyc = list; renderKycQueue(); });
socket.on('kyc-submitted', (a) => {
  if (!admOk() || !a) return;
  if (a.kyc.status === 'pending') { admKyc = [a, ...admKyc.filter((x) => x.groupId !== a.groupId)]; renderKycQueue(); toast(`KYC submitted by ${a.fullName || a.groupName}`); }
});
socket.on('kyc-resolved', (a) => { if (!admOk() || !a) return; admKyc = admKyc.filter((x) => x.groupId !== a.groupId); renderKycQueue(); });
function renderKycQueue() {
  updateAccountsTabBadge();
  const box = el('kycQueueList');
  if (!box) return;
  if (!admKyc.length) { box.innerHTML = '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No pending KYC submissions.</p>'; return; }
  box.innerHTML = admKyc.map((a) => {
    const k = a.kyc;
    const nameMatch = a.fullName && k.idName && a.fullName.trim().toLowerCase() === k.idName.trim().toLowerCase();
    return `<div class="seller-card open"><div class="seller-body" style="display:block; border-top:0;">
      <div class="seller-name notranslate" translate="no" style="margin-top:10px;"><span>${admEsc(a.fullName || a.groupName)}</span> ${a.countryCode ? flagHtml(a.countryCode) : ''} <span class="tx-acctid-pill notranslate" translate="no">${admEsc(a.accountId || '—')}</span> ${pill('Pending review', 'warn')}</div>
      ${kvRows([
        ['Registered name', a.fullName], ['Name on document', k.idName ? k.idName + (nameMatch ? ' ✓' : ' ⚠ differs') : ''], ['Document', (k.docType || '').replace(/_/g, ' ')],
        ['Document no.', k.idNumber], ['Issuing country', k.idCountry], ['Date of birth', k.idDob ? k.idDob + (a.dateOfBirth && a.dateOfBirth !== k.idDob ? ' ⚠ differs from registration (' + a.dateOfBirth + ')' : ' ✓') : ''],
        ['Expiry', k.idExpiry], ['Proof of address', k.proofAddressType ? k.proofAddressType.replace(/_/g, ' ') : ''], ['Attempts', k.attempts], ['Submitted', k.submittedAt ? fmtDateTime(k.submittedAt) : ''], ['Email', a.email]
      ])}
      <div class="adm-doc-grid">${docThumb(k.idFrontUrl, 'ID front')}${docThumb(k.idBackUrl, 'ID back')}${docThumb(k.proofAddressUrl, 'Proof of address')}${docThumb(k.selfieUrl, 'Live face photo')}</div>
      <div class="btn-row">
        <button class="send-btn" style="width:auto;" onclick="adminReviewKyc('${admEsc(a.groupId)}','verified')"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="admin-btn admin-btn-danger" style="width:auto;" onclick="adminReviewKyc('${admEsc(a.groupId)}','rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
      </div></div></div>`;
  }).join('');
}
function adminReviewKyc(groupId, decision) {
  if (decision === 'verified') return socket.emit('admin-review-kyc', { groupId, decision });
  showPromptModal({ title: 'Reject KYC', message: 'Tell the seller what to fix — they can resubmit.', placeholder: 'Reason' }, (reason) => socket.emit('admin-review-kyc', { groupId, decision, reason }));
}

// ---------------------------------------------------------------- Business applications
socket.on('business-queue-list', (list) => { if (!admOk()) return; admBiz = list; renderBusinessQueue(); });
socket.on('business-submitted', (a) => {
  if (!admOk() || !a) return;
  admBiz = [a, ...admBiz.filter((x) => x.groupId !== a.groupId)]; renderBusinessQueue(); toast(`Business application from ${a.fullName || a.groupName}`);
});
socket.on('business-resolved', (a) => { if (!admOk() || !a) return; admBiz = admBiz.filter((x) => x.groupId !== a.groupId); renderBusinessQueue(); });
function renderBusinessQueue() {
  updateAccountsTabBadge();
  const box = el('businessQueueList');
  if (!box) return;
  if (!admBiz.length) { box.innerHTML = '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No pending applications.</p>'; return; }
  box.innerHTML = admBiz.map((a) => {
    const b = (a.business && a.business.data) || {};
    return `<div class="seller-card open"><div class="seller-body" style="display:block; border-top:0;">
      <div class="seller-name notranslate" translate="no" style="margin-top:10px;"><span>${admEsc(b.businessName || a.groupName)}</span> <span class="tx-acctid-pill notranslate" translate="no">${admEsc(a.accountId || '—')}</span> ${pill('Business upgrade', 'warn')}</div>
      ${kvRows([
        ['Applicant', a.fullName], ['Trading name', b.tradingName], ['Registration no.', b.regNumber], ['Tax no.', b.taxNumber], ['Incorporated in', b.incorporationCountry],
        ['Incorporation date', b.incorporationDate], ['Type', b.businessType], ['Industry', b.industry], ['Address', b.address], ['Website', b.website],
        ['Contact', [b.contactName, b.contactRole].filter(Boolean).join(' — ')], ['Expected volume', b.expectedMonthlyVolume], ['Source of funds', b.sourceOfFunds],
        ['Beneficial owner', b.uboName ? `${b.uboName} (${b.uboOwnershipPct}%)` : ''], ['Submitted', a.business.submittedAt ? fmtDateTime(a.business.submittedAt) : '']
      ])}
      <div class="adm-doc-grid">${docThumb(b.registrationDocUrl, 'Registration')}${docThumb(b.taxDocUrl, 'Tax document')}${docThumb(b.addressDocUrl, 'Address proof')}</div>
      <div class="btn-row">
        <button class="send-btn" style="width:auto;" onclick="adminReviewBusiness('${admEsc(a.groupId)}','verified')"><i class="fa-solid fa-check"></i> Approve — Business account</button>
        <button class="admin-btn admin-btn-danger" style="width:auto;" onclick="adminReviewBusiness('${admEsc(a.groupId)}','rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
      </div></div></div>`;
  }).join('');
}
function adminReviewBusiness(groupId, decision) {
  if (decision === 'verified') return showConfirmModal({ title: 'Approve business account?', message: 'The seller is upgraded to a Business account with no daily withdrawal limit.' }, () => socket.emit('admin-review-business', { groupId, decision }));
  showPromptModal({ title: 'Reject application', message: 'Tell them what to fix — they can reapply.', placeholder: 'Reason' }, (reason) => socket.emit('admin-review-business', { groupId, decision, reason }));
}

// ---------------------------------------------------------------- Crypto "record a deposit" queue
socket.on('deposits-queue-list', (list) => { if (!admOk()) return; admDeposits = list; renderDepositsQueue(); });
socket.on('deposit-created', (d) => {
  if (!admOk() || !d) return;
  admDeposits = [d, ...admDeposits.filter((x) => x.id !== d.id)]; renderDepositsQueue();
});
socket.on('deposit-resolved', (d) => { if (!admOk() || !d) return; admDeposits = admDeposits.filter((x) => x.id !== d.id); renderDepositsQueue(); });
function renderDepositsQueue() {
  updateAccountsTabBadge();
  const box = el('depositsQueueList');
  if (!box) return;
  if (!admDeposits.length) { box.innerHTML = '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No pending deposits.</p>'; return; }
  box.innerHTML = admDeposits.map((d) => `<div class="ledger-row">
    <div class="ledger-row-top"><div class="ledger-row-direction in"><i class="fa-solid fa-coins"></i></div>
    <div class="ledger-row-main"><div class="ledger-row-title-line"><span class="ledger-row-title notranslate" translate="no">${admEsc(admGroupName(d.groupId))}</span><span class="ledger-row-amount in">${admEsc(Number(d.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} ${admEsc(d.asset || '')}</span></div>
      <div class="ledger-row-sub">${admEsc(d.asset || '')} ${d.network ? '· ' + admEsc(d.network) : ''} · notified ${admEsc(fmtDateTime(d.notifiedAt))}</div><div class="ledger-row-ref notranslate" translate="no">${admEsc(d.ref)}</div></div></div>
    <div class="ledger-row-actions">
      <button class="send-btn" style="width:auto;" onclick="adminReviewDeposit('${admEsc(d.id)}','verified')"><i class="fa-solid fa-check"></i> Funds arrived</button>
      <button class="admin-btn admin-btn-danger" style="width:auto;" onclick="adminReviewDeposit('${admEsc(d.id)}','rejected')"><i class="fa-solid fa-xmark"></i> Not received</button></div></div>`).join('');
}
function adminReviewDeposit(depositId, decision) {
  if (decision === 'verified') return socket.emit('admin-review-deposit', { depositId, decision });
  showPromptModal({ title: 'Deposit not received', message: 'Give the seller a reason.', placeholder: 'Reason' }, (reason) => socket.emit('admin-review-deposit', { depositId, decision, reason }));
}

// ---------------------------------------------------------------- Policy (daily limit, crypto tiers, KYC mode)
socket.on('policy', (p) => {
  if (!admOk()) return; admPolicy = p; renderPolicy();
  ['admin-get-email-status', 'admin-get-translation-status', 'admin-get-fx', 'admin-get-ip-info'].forEach((e) => socket.emit(e));
});
function renderPolicy() {
  const box = el('policyBox');
  if (!box || !admPolicy) return;
  const p = admPolicy;
  const T = p.tiers, R = p.ranges;
  const names = ['Under $10,000', '$10,000 – $100,000', '$100,000 – $1,000,000', 'Over $1,000,000'];
  keepInputs(box, () => {
    box.innerHTML = `
    <div class="fld" style="margin-bottom:12px;"><label class="fld-label" for="polDaily">Maximum withdrawal per day (account currency)</label>
      <input type="number" id="polDaily" class="message-input" min="1" step="1" value="${admEsc(p.daily)}">
      <div class="fld-hint">Applies to every Standard account, in whichever currency it holds. Business accounts are unlimited.</div></div>
    <div class="adm-sub-label">Crypto withdrawal — prior deposit required (first crypto withdrawal only)</div>
    <table class="policy-table"><thead><tr><th>Withdrawal size</th><th>Required deposit</th><th>Allowed range</th></tr></thead><tbody>
      ${T.map((t, i) => i < 3
        ? `<tr><td>${names[i]}</td><td><input type="number" id="polTier${i}" step="0.1" min="${R[i].min * 100}" max="${R[i].max * 100}" value="${+(t.pct * 100).toFixed(3)}"> %</td><td>${R[i].min * 100}% – ${R[i].max * 100}%</td></tr>`
        : `<tr><td>${names[i]}</td><td><input type="number" id="polTier${i}" step="100" min="${R[i].flatMin}" max="${R[i].flatMax}" value="${t.flat}"> USD flat</td><td>$${R[i].flatMin.toLocaleString('en-US')} – $${R[i].flatMax.toLocaleString('en-US')}</td></tr>`).join('')}
    </tbody></table>
    <div class="fld-hint">Once a seller meets the requirement and completes a crypto withdrawal, the flag is saved and they are never asked again. Fiat withdrawals are unaffected. You can override per seller from their controls.</div>
    <div class="sw-row" style="margin-top:12px;"><div>Auto-approve KYC that passes every automatic check<small>Off: valid submissions wait for an admin to approve. On: they are verified instantly.</small></div>
      <label class="sw"><input type="checkbox" id="polKycAuto" ${p.kycAutoApprove ? 'checked' : ''} data-keep="reset"><i></i></label></div>
    <div class="fld-hint" style="margin-top:8px;">Email delivery: ${p.emailConfigured ? '<b style="color:var(--accent-emerald);">SMTP configured — codes and notices are sent.</b>' : '<b style="color:var(--accent-rose);">SMTP not configured — emails are only logged. Set SMTP_HOST / SMTP_USER / SMTP_PASS.</b>'}</div>
    <button class="send-btn" style="margin-top:12px;" onclick="adminSavePolicy()"><i class="fa-solid fa-floppy-disk"></i> Save policy</button>`;
  });
}
function adminSavePolicy() {
  const tiers = (admPolicy.tiers || []).map((t, i) => (i < 3 ? { upTo: t.upTo, pct: Number(el('polTier' + i).value) / 100 } : { upTo: null, flat: Number(el('polTier' + i).value) }));
  socket.emit('admin-save-policy', { tiers, daily: Number(el('polDaily').value), kycAutoApprove: el('polKycAuto').checked });
}

// ---------------------------------------------------------------- Record Incoming Funds
function openRecordFundsModal() {
  if (!admOk() || !fdLedger) return;
  const a = fdLedger.account;
  if (!a.registered) return toast('This seller has not created their Transaction Account yet.', true);
  el('recordFundsSellerLabel').textContent = a.fullName || a.groupName;
  el('rfTargetAcct').textContent = a.accountId || '—';
  el('rfTargetCcy').textContent = a.currency || '—';
  el('rfForm').reset();
  rfProofUrl = null; el('rfProofStatus').textContent = '';
  hideCallout('rfError');
  el('rfCurrency').value = a.currency || 'USD';
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  el('rfReceivedAt').value = now.toISOString().slice(0, 16); el('rfReceivedAt').max = now.toISOString().slice(0, 16);
  if (!rfPicker) rfPicker = mountCountryPicker(el('rfPayerCountry'), { placeholder: 'Select payer country' });
  else rfPicker.clear();
  [['rfPayerType'], ['rfMethod'], ['rfCurrency'], ['rfReviewMode'], ['rfSpeed'], ['rfDurUnit']].forEach(([id]) => { if (typeof cselSyncTrigger === 'function') setSelect(id, el(id).value); });
  el('rfAdv').classList.add('hidden');
  toggleRecordFundsFields(); rfTreatChanged();
  el('recordFundsModal').classList.remove('hidden');
  setBusy(el('rfSubmitBtn'), false);
}
function toggleRecordFundsFields() {
  el('rfCryptoFields').style.display = el('rfMethod').value === 'crypto' ? 'grid' : 'none';
}
function rfTreatChanged() {
  const t = (document.querySelector('input[name="rfTreat"]:checked') || {}).value || 'review';
  el('rfReviewBox').style.display = t === 'review' ? 'block' : 'none';
  const manual = el('rfReviewMode').value === 'manual';
  el('rfSpeedRow').style.display = manual ? 'none' : '';
  el('rfTimeBox').style.display = manual ? 'none' : '';
}
function rfToggleAdv() {
  const adv = el('rfAdv');
  adv.classList.toggle('hidden');
  if (!adv.classList.contains('hidden') && !el('rfT0').value) {
    const total = Math.max(10, Math.round(Number(el('rfDurValue').value || 6) * Number(el('rfDurUnit').value)));
    const w = [10, 25, 35, 10, 20];
    const parts = w.map((x) => Math.max(2, Math.floor(total * x / 100)));
    parts.forEach((s, i) => { el('rfT' + i).value = s; });
  }
}
async function rfUploadProof(input) {
  const f = input.files && input.files[0];
  rfProofUrl = null;
  if (!f) { el('rfProofStatus').textContent = ''; return; }
  el('rfProofStatus').textContent = 'Uploading…';
  const r = await uploadRawFile(f);
  if (r.ok) { rfProofUrl = r.url; el('rfProofStatus').textContent = '✓ ' + f.name + ' attached (admin-only)'; }
  else { el('rfProofStatus').textContent = r.error; input.value = ''; }
}
function submitRecordFunds() {
  if (!fdLedger) return;
  const a = fdLedger.account;
  const val = (id) => (el(id).value || '').trim();
  const method = el('rfMethod').value;
  const treatment = (document.querySelector('input[name="rfTreat"]:checked') || {}).value || 'review';
  if (!val('rfPayerName')) return showCallout('rfError', 'Enter who the payment is from.');
  if (!val('rfPurpose')) return showCallout('rfError', 'Describe what the payment is for.');
  const amount = Number(el('rfAmount').value);
  if (!(amount > 0)) return showCallout('rfError', 'Enter a valid amount.');
  const payload = {
    groupId: a.groupId, payerName: val('rfPayerName'), payerType: el('rfPayerType').value, payerEmail: val('rfPayerEmail'), payerPhone: val('rfPayerPhone'),
    payerCountry: rfPicker && rfPicker.getCountry() ? rfPicker.getCountry().n : '', payerBank: val('rfPayerBank'),
    purpose: val('rfPurpose'), method, amount, amountCurrency: el('rfCurrency').value,
    receivedAt: el('rfReceivedAt').value ? new Date(el('rfReceivedAt').value).toISOString() : undefined,
    invoiceRef: val('rfInvoiceRef'), externalRef: val('rfExternalRef'), proofUrl: rfProofUrl || undefined,
    treatment, internalNote: val('rfInternalNote'), noteShared: el('rfShareNote').checked, notifySeller: el('rfNotifySeller').checked
  };
  if (method === 'crypto') { payload.asset = el('rfAsset').value; payload.network = val('rfNetwork'); payload.walletAddress = val('rfWallet'); }
  if (treatment === 'review') {
    payload.reviewMode = el('rfReviewMode').value;
    payload.reviewShowTime = el('rfShowTime').checked;
    if (payload.reviewMode === 'auto') {
      payload.reviewSpeed = el('rfSpeed').value === 'fit' ? 'fit' : Number(el('rfSpeed').value);
      if (!el('rfAdv').classList.contains('hidden') && el('rfT0').value) {
        payload.reviewTimers = [0, 1, 2, 3, 4].map((i) => Number(el('rfT' + i).value));
        if (payload.reviewTimers.some((n) => !Number.isFinite(n) || n < 2)) return showCallout('rfError', 'Each stage needs at least 2 seconds.');
      } else {
        const total = Math.round(Number(el('rfDurValue').value) * Number(el('rfDurUnit').value));
        if (!(total >= 10)) return showCallout('rfError', 'Enter a total review time of at least 10 seconds.');
        payload.reviewTotalSeconds = total;
      }
    }
  }
  hideCallout('rfError');
  setBusy(el('rfSubmitBtn'), true, '<i class="fa-solid fa-spinner fa-spin"></i> Recording…');
  socket.emit('admin-record-incoming-funds', payload);
}
socket.on('incoming-funds-recorded', () => {
  if (!admOk()) return;
  setBusy(el('rfSubmitBtn'), false);
  closeModal('recordFundsModal');
  toast('Funds recorded — the seller has been notified.');
});
socket.on('error-msg', (m) => {
  if (!admOk()) return;
  const open = el('recordFundsModal') && !el('recordFundsModal').classList.contains('hidden');
  if (open) { setBusy(el('rfSubmitBtn'), false); showCallout('rfError', m); }
});

// ---------------------------------------------------------------- Disbursement toggle (Controls tab + chat header, active group)
function adminToggleDisbursement(on) { socket.emit('admin-set-disbursement', { groupId: activeGroupId, enabled: !!on }); }
function syncAdminDisbursementUi(on) {
  const sw = el('ctlDisbSwitch');
  if (sw) sw.checked = !!on;
  const t = el('ctlDisbText');
  if (t) t.textContent = on ? 'ON — this transaction is confirmed and in the disbursement stage. Withdrawals are open.' : 'OFF — withdrawals are closed. The seller sees a popup with a "complete the transaction" button.';
}
socket.on('init-state', (d) => {
  if (!isAdminConfirmed) return;
  syncAdminDisbursementUi(d.group && d.group.disbursementEnabled);
  const pill2 = el('disbPill');
  if (pill2 && admOk()) { pill2.style.cursor = 'pointer'; pill2.title = 'Click to switch the disbursement stage on/off'; pill2.onclick = () => adminToggleDisbursement(!(typeof groupDisbursement !== 'undefined' && groupDisbursement)); }
  if (admOk()) {
    socket.emit('admin-get-kyc-queue'); socket.emit('admin-get-deposits-queue'); socket.emit('admin-get-withdrawals-queue');
    socket.emit('admin-get-funds-overview'); socket.emit('admin-get-business-queue'); socket.emit('admin-get-sellers');
  }
});
socket.on('disbursement-status', ({ groupId, enabled }) => {
  if (!isAdminConfirmed) return;
  if (groupId === activeGroupId) syncAdminDisbursementUi(enabled);
  const f = admFunds.find((x) => x.groupId === groupId); if (f) { f.disbursementEnabled = !!enabled; renderFundsDesk(); }
  const s = admSellers.find((x) => x.groupId === groupId); if (s) { s.disbursementEnabled = !!enabled; renderSellersTab(); }
  if (fdLedger && fdLedger.groupId === groupId) { fdLedger.account.disbursementEnabled = !!enabled; renderFundsDeskModal(); }
});

// Group list: show each seller's disbursement stage + disabled state next to the group name.
(function decorateGroupList() {
  const orig = window.renderGroupsList;
  if (typeof orig !== 'function') return;
  window.renderGroupsList = function () {
    orig.apply(this, arguments);
    if (!admOk()) return;
    document.querySelectorAll('#chatsListContainer .chat-item').forEach((row) => {
      const m = /switchGroup\('([^']+)'\)/.exec(row.getAttribute('onclick') || '');
      const g = m && groupsCache.find((x) => x.id === m[1]);
      const nm = row.querySelector('.chat-name');
      if (!g || !nm || !g.sellerRegistered) return;
      nm.insertAdjacentHTML('beforeend', ` <span class="pill-sm group-disb ${g.disbursementEnabled ? 'ok' : ''}">${g.disbursementEnabled ? 'Disbursement' : 'Awaiting'}</span>${g.sellerDisabled ? ' <span class="pill-sm group-disb bad">Disabled</span>' : ''}`);
    });
  };
})();


// ---------------------------------------------------------------- System status: email, translation, exchange rates, IP detection
const sysState = { email: null, tr: null, fx: null, ip: null, testResult: null };
socket.on('email-status', (s) => { if (admOk()) { sysState.email = s; renderSysStatus(); } });
socket.on('translation-status', (s) => { if (admOk()) { sysState.tr = s; renderSysStatus(); } });
socket.on('fx-info', (s) => { if (admOk()) { sysState.fx = s; renderSysStatus(); } });
socket.on('deliverability-info', (s) => { if (admOk()) { sysState.dlv = s; renderSysStatus(); } });
socket.on('ip-info', (s) => { if (admOk()) { sysState.ip = s; renderSysStatus(); } });
socket.on('test-email-result', (r) => { if (!admOk()) return; sysState.testResult = r; renderSysStatus(); toast(r.ok ? `Test email sent to ${r.to}.` : 'Test email failed: ' + r.error, !r.ok); });
function sysRow(label, valueHtml, tone) { return `<div class="sys-row"><span>${admEsc(label)}</span><b class="${tone || ''}">${valueHtml}</b></div>`; }
function renderSysStatus() {
  const box = el('sysStatusBox');
  if (!box) return;
  const { email: e, tr, fx, ip, dlv } = sysState;
  const nt = (v) => `<span class="notranslate" translate="no">${admEsc(v)}</span>`;
  keepInputs(box, () => {
    box.innerHTML = `
    <div class="sys-card"><div class="sys-title"><i class="fa-solid fa-envelope"></i> Email delivery ${e ? (e.configured ? pill('Configured', 'ok') : pill('Not configured', 'bad')) : ''}</div>
      ${e ? sysRow('Provider', e.provider ? nt(e.provider) : 'none — emails are only logged', e.provider ? 'ok' : 'bad') + sysRow('Sender', nt(e.from)) + sysRow('Sent / failed', `${e.sent} / ${e.failed}`) + (e.host ? sysRow('Server', nt(e.host)) : '') + (e.verified === true ? sysRow('Login check', 'OK', 'ok') : e.verified === false ? sysRow('Login check', nt(e.verifyError || 'failed'), 'bad') : '') + (e.fromNote ? sysRow('Sender note', nt(e.fromNote), 'warn') : '') + (e.lastError ? sysRow('Last error', nt(e.lastError), 'bad') : '') : ''}
      <div class="input-row" style="margin-top:8px;"><input id="sysTestTo" class="message-input" type="email" placeholder="Send a test email to…" autocomplete="off"><button class="admin-btn" style="width:auto;" onclick="adminSendTestEmail()"><i class="fa-solid fa-paper-plane"></i> Send test</button></div>
      ${sysState.testResult ? `<div class="fld-hint" style="margin-top:6px; color:var(--${sysState.testResult.ok ? 'accent-emerald' : 'accent-rose'});">${sysState.testResult.ok ? 'Delivered to the provider: ' + admEsc(sysState.testResult.to) : 'Failed: ' + admEsc(sysState.testResult.error)}</div>` : ''}
      <button class="admin-btn" style="width:auto; margin-top:8px;" onclick="socket.emit('admin-check-deliverability')"><i class="fa-solid fa-shield-halved"></i> Check spam protection (SPF · DKIM · DMARC)</button>
      ${dlv ? `<div style="margin-top:8px;">${dlv.checks.map((c) => sysRow(c.label, nt(c.detail), c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'warn' : 'bad') + (c.fix ? `<div class="fld-hint" style="margin:0 0 6px;">${admEsc(c.fix)}</div>` : '')).join('')}<div class="fld-hint">${dlv.ok ? 'All checks pass for ' + admEsc(dlv.domain) + '.' : 'Fix the red items in your domain\'s DNS, wait a few minutes, then check again.'}</div></div>` : ''}
      ${e && !e.configured ? '<div class="fld-hint" style="margin-top:6px;">For Zoho set <b>EMAIL_SERVICE=zoho</b>, <b>EMAIL_USER</b>, <b>EMAIL_PASS</b> and <b>EMAIL_FROM</b> (same address), or set <b>RESEND_API_KEY</b> (or BREVO_API_KEY / SENDGRID_API_KEY, or SMTP settings) and <b>EMAIL_FROM</b>, then restart. Sellers cannot receive verification or withdrawal codes until this is green.</div>' : ''}
    </div>
    <div class="sys-card"><div class="sys-title"><i class="fa-solid fa-language"></i> Translation ${tr ? (tr.keyed ? pill('Provider key set', 'ok') : pill('Free fallback', 'warn')) : ''}</div>
      ${tr ? sysRow('Provider', nt(tr.provider)) + sysRow('Translated / failed', `${tr.ok} / ${tr.failed}`) + sysRow('Cached phrases', tr.cached) + (tr.lastError ? sysRow('Last provider error', nt(tr.lastError), 'bad') : '') + (tr.test ? sysRow('Test (EN→ES)', tr.test.ok ? nt(tr.test.text) : 'failed — original text returned', tr.test.ok ? 'ok' : 'bad') : '') : ''}
      <button class="admin-btn" style="width:auto; margin-top:8px;" onclick="socket.emit('admin-test-translation')"><i class="fa-solid fa-vial"></i> Run translation test</button>
      ${tr && !tr.keyed ? '<div class="fld-hint" style="margin-top:6px;">The free fallback has small daily quotas. Set DEEPL_API_KEY (free tier available), GOOGLE_TRANSLATE_API_KEY or LIBRETRANSLATE_URL for reliable translation.</div>' : ''}
    </div>
    <div class="sys-card"><div class="sys-title"><i class="fa-solid fa-coins"></i> Exchange rates ${fx ? (fx.live ? pill('Live', 'ok') : pill('Built-in defaults', 'warn')) : ''}</div>
      ${fx ? sysRow('1 GBP', nt('$' + fx.rates.GBP.toFixed(4))) + sysRow('1 EUR', nt('$' + fx.rates.EUR.toFixed(4))) + sysRow('Source', nt(fx.source)) + sysRow('Updated', fx.updatedAt ? admEsc(fmtDateTime(fx.updatedAt)) : '—') + (fx.lastError ? sysRow('Last error', nt(fx.lastError), 'bad') : '') : ''}
      <button class="admin-btn" style="width:auto; margin-top:8px;" onclick="socket.emit('admin-refresh-fx')"><i class="fa-solid fa-rotate"></i> Refresh rates now</button>
    </div>
    <div class="sys-card"><div class="sys-title"><i class="fa-solid fa-location-crosshairs"></i> IP detection ${ip ? (ip.private ? pill('Check proxy setting', 'bad') : pill('Working', 'ok')) : ''}</div>
      ${ip ? sysRow('Your IP as the server sees it', nt(ip.detected), ip.private ? 'bad' : 'ok') + sysRow('Network (blocks apply to)', nt(ip.network)) + sysRow('Connection address', nt(ip.socketAddress)) + sysRow('X-Forwarded-For', nt(ip.xForwardedFor || '—')) + sysRow('Trusted proxy hops', ip.hops) : ''}
      <button class="admin-btn" style="width:auto; margin-top:8px;" onclick="socket.emit('admin-get-ip-info')"><i class="fa-solid fa-rotate"></i> Re-check</button>
      <div class="fld-hint" style="margin-top:6px;">The first line must be your real public IP (compare with any "what is my IP" site). If it shows a private address (10.x, 172.16–31.x, 192.168.x, 127.x), set <b>TRUST_PROXY_HOPS</b> to the number of proxies in front of the app (1 for most hosts, 2 behind Cloudflare), or <b>TRUST_CLOUDFLARE=1</b>.</div>
    </div>`;
  });
}
function adminSendTestEmail() {
  const to = (el('sysTestTo').value || '').trim();
  if (!to) return toast('Enter an email address first.', true);
  socket.emit('admin-send-test-email', { to });
}

// ---------------------------------------------------------------- Admin sets a temporary password (shown once)
socket.on('temp-password', ({ email, password }) => {
  if (!admOk()) return;
  showPopup({
    icon: 'fa-key', tone: 'info', title: 'Temporary password created',
    body: `Passwords are never stored in a readable form, so existing ones cannot be viewed. This temporary password replaces the old one and every device was signed out. It is shown ONCE — pass it to the seller securely and ask them to change it with "Forgot password" after signing in.`,
    facts: [['Seller email', email || '—'], ['Temporary password', password]],
    actions: [{ label: 'Copy password', primary: true, icon: 'fa-copy', keepOpen: true, onClick: () => copyText(password, 'Password copied.') }, { label: 'Done' }]
  });
});
function adminTempPassword(groupId) {
  showConfirmModal({ title: 'Create a temporary password?', message: 'The seller\'s current password stops working and they are signed out of every device. You will see the new password once.' }, () => socket.emit('admin-set-temp-password', { groupId }));
}
function adminRevokeSessions(groupId) {
  showConfirmModal({ title: 'Sign the seller out everywhere?', message: 'Every device must sign in again with the seller\'s password.' }, () => socket.emit('admin-revoke-seller-sessions', { groupId }));
}
