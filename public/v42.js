/* v3.14 client layer. Loaded last. It only ADDS to / wraps what earlier layers do (never deletes them).
   - "Send" is now "Transfer": a bank-transfer form (local / international) that uses the same secure pipeline as withdrawals
     (emailed code, funds reserved, Desk stages) and opens only at the disbursement stage - or at once for sellers the Desk added by hand
   - AIRWX card: the seller no longer types a billing address; the Desk registers it with the card and the seller sees it with the card details
   - card freeze / unfreeze for the seller
   - App PIN (6 digits): lock screen, PIN prompts for sensitive actions, set / change / remove on the Security page
   - automatic sign-out after 2 minutes without activity
*/
'use strict';
const v42safe = (fn) => { try { return fn(); } catch (e) { console.warn('[v42]', e); } };
const v42Esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v42El = (id) => document.getElementById(id);
const v42Acct = () => (typeof sellerAccountState !== 'undefined' && sellerAccountState) || null;
const v42Money = (n, c) => (typeof fmtMoney === 'function' ? fmtMoney(n, c) : Number(n || 0).toFixed(2) + ' ' + (c || ''));

// ====================================================================
// 1. Transfer (was "Send")
// ====================================================================
const v42T = { kind: 'local', name: '', bank: '', acct: '', swift: '', iso: '', amount: '', ref: '', msg: '', field: '', sig: '' };
let v42TPending = false;                                                     // a transfer (not a plain withdrawal) is waiting for its emailed code
const v42TransfersOpen = () => { const a = v42Acct(); return !!(a && (a.transfersOpen || (a.transfersOpen === undefined && a.disbursementEnabled))); };

function v42Iban(raw) {                                                      // mod-97 check; anything that does not look like an IBAN is left to the Desk
  const s = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s)) return { looks: false, ok: true };
  const r = s.slice(4) + s.slice(0, 4); let rem = 0;
  for (const ch of r) { const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch; for (const d of v) rem = (rem * 10 + Number(d)) % 97; }
  return { looks: true, ok: rem === 1 };
}

function v42TransferLockedPopup() {
  const icon = v42El('wdBlockedIcon'); if (!icon) return;
  icon.className = 'next-badge warn'; icon.innerHTML = '<i class="fa-solid fa-hourglass-half"></i>';
  v42El('wdBlockedTitle').textContent = 'Transfers are not open yet';
  v42El('wdBlockedText').textContent = 'Your transaction has not reached the disbursement stage. You can transfer your funds to any bank account as soon as it does.';
  v42El('wdBlockedExtra').innerHTML = `<ol class="v42-stages"><li class="done"><i class="fa-solid fa-check"></i><span>Funds received and secured</span></li><li class="now"><i class="fa-solid fa-hourglass-half"></i><span>Both parties confirm the transaction</span></li><li><i class="fa-solid fa-hand-holding-dollar"></i><span>The Desk moves it to the <b>disbursement stage</b></span></li><li><i class="fa-solid fa-building-columns"></i><span>Transfers open for your available balance</span></li></ol>`;
  v42El('wdBlockedActions').innerHTML = `<button class="send-btn" onclick="goCompleteTransaction()"><i class="fa-solid fa-comments-dollar"></i> Complete transaction</button><button class="ghost-btn" onclick="closeModal('wdBlockedModal')">Close</button>`;
  openModal('wdBlockedModal');
}
function v42OpenTransfer() { if (!v42TransfersOpen()) return v42TransferLockedPopup(); setTxAccountNav('transfer'); }

const _navV42 = setTxAccountNav;
setTxAccountNav = function (nav) {
  if (nav === 'transfer' && v42Acct() && !v42TransfersOpen()) return v42TransferLockedPopup();      // not at the disbursement stage yet: a pop-up, never the form
  _navV42(nav);
  if (nav === 'transfer') v42safe(v42RenderTransfer);
};

function v42CountryOf(iso) { return iso && typeof QC !== 'undefined' ? QC.findCountry(iso) : null; }
function v42TransferField(id, key, label, attrs, hint) {
  return `<label class="v42-f ${v42T.field === key ? 'err' : ''}"><span>${label}</span><input class="message-input" id="${id}" data-tr="${key}" value="${v42Esc(v42T[key])}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>`;
}
function v42RenderTransfer() {
  const pg = v42El('txPageTransfer'), a = v42Acct(); if (!pg || !a) return;
  const h1 = pg.querySelector(':scope > h1.v41-page'); if (h1) h1.textContent = 'Transfer';
  pg.querySelectorAll(':scope > .v41-move').forEach((n) => { n.style.display = 'none'; });            // the old Send / Add money / Withdraw list (kept in the page, hidden)
  let host = v42El('v42Transfer'); if (!host) { pg.insertAdjacentHTML('beforeend', '<div id="v42Transfer" class="v42-tr"></div>'); host = v42El('v42Transfer'); }
  const ccy = a.currency || 'USD', avail = a.balances ? Number(a.balances.available || 0) : 0;
  const verified = a.kyc ? a.kyc.status === 'verified' : (a.kycStatus || 'verified') === 'verified';
  const sig = [v42TransfersOpen(), verified, v42T.kind, ccy, a.disabled ? 1 : 0].join('|');
  if (host.dataset.sig === sig) { const av = host.querySelector('.v42-avail b'); if (av) av.textContent = v42Money(avail, ccy); return; }      // same form: only refresh the balance
  host.dataset.sig = sig;
  const head = `<div class="v42-avail"><span>Available to transfer</span><b class="tnum" translate="no">${v42Esc(v42Money(avail, ccy))}</b></div>`;
  if (!verified) { host.innerHTML = head + `<div class="v42-lock"><i class="fa-solid fa-id-card"></i><div><b>Verify your identity first</b><span>For your protection, transfers open once your identity is verified.</span></div><button class="send-btn" onclick="openTxKycWizard()">Verify now</button></div>`; return; }
  if (a.disabled) { host.innerHTML = head + `<div class="v42-lock"><i class="fa-solid fa-ban"></i><div><b>Account disabled</b><span>Please contact Support to restore transfers.</span></div></div>`; return; }
  if (!v42TransfersOpen()) { host.innerHTML = head + `<div class="v42-lock"><i class="fa-solid fa-hourglass-half"></i><div><b>Transfers open at the disbursement stage</b><span>Complete your part of the transaction. Once the Desk confirms it, you can transfer your funds.</span></div><button class="send-btn" onclick="goCompleteTransaction()">Complete transaction</button></div>`; return; }
  const intl = v42T.kind === 'intl';
  if (!v42T.iso && !v42T.isoTouched) v42T.iso = intl ? '' : (a.countryIso || '');
  const c = v42CountryOf(v42T.iso);
  host.innerHTML = `${head}
    <div class="v42-seg" role="tablist" aria-label="Transfer type"><button type="button" role="tab" aria-selected="${!intl}" class="${intl ? '' : 'on'}" onclick="v42SetKind('local')"><i class="fa-solid fa-building-columns"></i> Local transfer</button><button type="button" role="tab" aria-selected="${intl}" class="${intl ? 'on' : ''}" onclick="v42SetKind('intl')"><i class="fa-solid fa-earth-americas"></i> International wire</button></div>
    <p class="v42-sub">${intl ? 'Send money to a bank abroad using its IBAN or account number and SWIFT / BIC code.' : 'Send money to a bank account in your own country using its account number.'}</p>
    <div class="v42-card" id="v42TrForm">
      <h3><i class="fa-solid fa-user"></i> Recipient</h3>
      ${v42TransferField('v42tName', 'name', 'Account holder name', 'autocomplete="off" autocapitalize="words" maxlength="120" placeholder="Name exactly as on the bank account"')}
      <h3><i class="fa-solid fa-building-columns"></i> Bank details</h3>
      ${v42TransferField('v42tBank', 'bank', 'Bank name', 'autocomplete="off" autocapitalize="words" maxlength="120" placeholder="e.g. HSBC"')}
      ${v42TransferField('v42tAcct', 'acct', intl ? 'IBAN / account number' : 'Account number', 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="42" placeholder="' + (intl ? 'IBAN or account number' : 'Account number') + '"')}
      ${v42TransferField('v42tSwift', 'swift', intl ? 'SWIFT / BIC code' : 'Sort code / routing number (optional)', 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="' + (intl ? '8 or 11 characters, e.g. HBUKGB4B' : 'If your bank uses one') + '"')}
      <div class="v42-f ${v42T.field === 'country' ? 'err' : ''}"><span>Bank country</span><button type="button" class="message-input v42-cbtn" id="v42tCountry"><span class="fl">${c ? flagHtml(c.iso, c.name) : ''}</span><span class="tx ${c ? '' : 'placeholder'}">${v42Esc(c ? c.name : 'Select country')}</span><i class="fa-solid fa-chevron-down"></i></button></div>
      <h3><i class="fa-solid fa-money-bill-transfer"></i> Amount</h3>
      <label class="v42-f ${v42T.field === 'amount' ? 'err' : ''}"><span>Amount to send <em>(${v42Esc(ccy)})</em></span><div class="v42-amt"><input class="message-input" id="v42tAmount" data-tr="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${v42Esc(v42T.amount)}"><button type="button" onclick="v42Max()">Max</button></div></label>
      ${v42TransferField('v42tRef', 'ref', 'Reference (optional)', 'autocomplete="off" maxlength="140" placeholder="Shown to the recipient\'s bank, e.g. Invoice 2041"')}
      <div class="gate-msg v42-msg" id="v42tMsg" role="alert">${v42Esc(v42T.msg)}</div>
      <button class="send-btn v42-go" id="v42tGo" type="button" onclick="v42SubmitTransfer()"><i class="fa-solid fa-envelope-circle-check"></i> Continue &mdash; send security code</button>
      <p class="v42-note"><i class="fa-solid fa-shield-halved"></i> We email you a 6-digit code to confirm. After that the Desk reviews and sends your transfer; follow it under Activity (Pending &rarr; Processing &rarr; Completed).</p>
    </div>`;
  host.querySelectorAll('[data-tr]').forEach((i) => i.addEventListener('input', () => { v42T[i.dataset.tr] = i.value; }));
  const cb = v42El('v42tCountry'); if (cb) cb.addEventListener('click', () => v40OpenCountry('v42country', (cc) => { v42T.iso = cc.iso; v42T.isoTouched = true; if (v42T.field === 'country') v42T.field = ''; host.dataset.sig = ''; v42RenderTransfer(); }));
}
function v42SetKind(k) { if (v42T.kind === k) return; v42TransferRead(); v42T.kind = k; v42T.msg = ''; v42T.field = ''; if (k === 'intl' && !v42T.isoTouched) v42T.iso = ''; if (k === 'local' && !v42T.isoTouched) v42T.iso = (v42Acct() || {}).countryIso || ''; v42RenderTransfer(); }
function v42TransferRead() { document.querySelectorAll('#v42Transfer [data-tr]').forEach((i) => { v42T[i.dataset.tr] = i.value; }); }
function v42Max() { const a = v42Acct(); if (!a || !a.balances) return; const i = v42El('v42tAmount'); if (i) { i.value = Number(a.balances.available || 0).toFixed(2); v42T.amount = i.value; } }
function v42TrErr(msg, field) { v42T.msg = msg; v42T.field = field || ''; const m = v42El('v42tMsg'); if (m) m.textContent = msg; document.querySelectorAll('#v42Transfer .v42-f').forEach((n) => n.classList.remove('err')); const i = field && document.querySelector(`#v42Transfer [data-tr="${field}"]`); if (i && i.closest('.v42-f')) i.closest('.v42-f').classList.add('err'); if (field === 'country') { const b = v42El('v42tCountry'); if (b) b.closest('.v42-f').classList.add('err'); } return false; }
function v42SubmitTransfer() {
  const a = v42Acct(); if (!a) return; v42TransferRead();
  if (!v42TransfersOpen()) return v42TransferLockedPopup();
  const intl = v42T.kind === 'intl', ccy = a.currency || 'USD', avail = a.balances ? Number(a.balances.available || 0) : 0;
  const name = v42T.name.trim().replace(/\s+/g, ' '), bank = v42T.bank.trim(), acct = v42T.acct.replace(/\s+/g, '').toUpperCase(), swift = v42T.swift.replace(/\s+/g, '').toUpperCase();
  const amount = Number(String(v42T.amount).replace(/,/g, ''));
  if (name.length < 2 || !/[A-Za-zÀ-ɏЀ-ӿ؀-ۿ一-鿿]/.test(name)) return v42TrErr('Enter the account holder’s name exactly as it appears on the bank account.', 'name');
  if (bank.length < 2) return v42TrErr('Enter the name of the recipient’s bank.', 'bank');
  if (!/^[A-Z0-9\-]{6,34}$/.test(acct)) return v42TrErr(intl ? 'Enter a valid IBAN or account number (6 to 34 letters and digits).' : 'Enter a valid account number (6 to 34 letters and digits).', 'acct');
  const ib = v42Iban(acct); if (ib.looks && !ib.ok) return v42TrErr('That IBAN is not valid (its check digits do not match). Please re-check it.', 'acct');
  if (intl && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift)) return v42TrErr('Enter the bank’s SWIFT / BIC code (8 or 11 characters, e.g. HBUKGB4B).', 'swift');
  const c = v42CountryOf(v42T.iso); if (!c) return v42TrErr('Select the bank’s country.', 'country');
  if (!Number.isFinite(amount) || amount <= 0) return v42TrErr('Enter the amount you want to send.', 'amount');
  if (amount > avail + 1e-9) return v42TrErr('That is more than your available balance (' + v42Money(avail, ccy) + ').', 'amount');
  v42TrErr('', '');
  const payload = { groupId: activeGroupId, kind: 'transfer', method: 'bank', beneficiaryName: name, bankName: bank, bankAccount: acct, bankSwift: swift, bankCountry: c.name, reference: v42T.ref.trim(), amount: Math.round(amount * 100) / 100, amountCurrency: ccy };
  wdPendingDraft = payload; v42TPending = true;
  const go = v42El('v42tGo'); if (go) { go.disabled = true; setTimeout(() => { go.disabled = false; }, 3500); }
  socket.emit('request-withdrawal', payload);
}
// wording of the code box and the result for a transfer
socket.on('withdrawal-code-sent', () => v42safe(() => {
  if (!v42TPending) return;
  const s = v42El('wdCodeSub'); if (s) s.textContent = s.textContent.replace('confirm this withdrawal', 'confirm this transfer');
  const sum = v42El('wdCodeSummary'); const d = wdPendingDraft || {};
  if (sum && d.reference) sum.insertAdjacentHTML('beforeend', `<div>Reference <b>${v42Esc(d.reference)}</b></div>`);
}));
socket.on('withdrawal-confirm-result', (r) => v42safe(() => {
  if (!v42TPending) return;
  if (r && (r.ok || r.restart)) v42TPending = false;
  if (r && r.ok) { Object.assign(v42T, { name: '', bank: '', acct: '', swift: '', amount: '', ref: '', msg: '', field: '', sig: '' }); const h = v42El('v42Transfer'); if (h) h.dataset.sig = ''; v42RenderTransfer(); }
}));
const _toastV42 = toast;
toast = function (msg, isError, allowHtml) { if (v42TPending && typeof msg === 'string' && /^Withdrawal .* submitted/.test(msg)) msg = msg.replace(/^Withdrawal/, 'Transfer'); return _toastV42(msg, isError, allowHtml); };
socket.on('withdrawal-blocked', (b) => v42safe(() => {                                        // the server says the stage is not reached (stale screen): same friendly pop-up
  if (v42TPending && b && b.reason === 'disbursement') { v42TPending = false; closeModal('wdCodeModal'); }
}));
socket.on('disbursement-updated', ({ enabled }) => v42safe(() => {
  const a = v42Acct(); if (!a) return; a.transfersOpen = !!enabled || !!a.manualSeller; const h = v42El('v42Transfer'); if (h) h.dataset.sig = ''; v42RenderTransfer(); v42PatchHome();
}));

// Home: the first quick action is Transfer; the old withdraw page's banner follows the same rule
function v42PatchHome() {
  const first = document.querySelector('#v41Home .v41-act:first-child');
  if (first && !first.dataset.v42) { first.dataset.v42 = '1'; first.setAttribute('onclick', 'v42OpenTransfer()'); first.innerHTML = '<span class="c"><i class="fa-solid fa-money-bill-transfer"></i></span>Transfer'; }
  const a = v42Acct(); const g = v42El('wdGateBanner'); if (g && a && v42TransfersOpen()) g.classList.add('hidden');
}
const _rhV42 = v41RenderHome;
v41RenderHome = function () { _rhV42(); v42safe(v42PatchHome); };                // also when the eye is tapped
const _raV42 = v41RenderAll;
v41RenderAll = function () { _raV42(); v42safe(() => { v42PatchHome(); if (v42Acct()) v42RenderTransfer(); }); };
// "Add money" by crypto stays reachable from the Accounts page now that Send is a transfer
const _accV42 = renderAccountsPage;
renderAccountsPage = function () {
  _accV42();
  v42safe(() => {
    const host = v42El('txAccountsBody'); if (!host || v42El('v42CryptoRow')) return;
    const row = `<div class="v41-list" id="v42CryptoRow"><button type="button" class="v41-item" onclick="openTxDepositModal()"><span class="ico"><i class="fa-brands fa-bitcoin"></i></span><span class="t"><b>Deposit crypto</b><small>Add funds with BTC or USDT</small></span><i class="fa-solid fa-chevron-right chev"></i></button></div>`;
    const inc = v42El('rcIncoming'); if (inc) inc.insertAdjacentHTML('beforebegin', row); else host.insertAdjacentHTML('beforeend', row);
  });
};

// ====================================================================
// 2. AIRWX card: no billing form for the seller; billing shows with the card details; freeze / unfreeze
// ====================================================================
cdApply = function (payNow) { if (cdBusy) return; cdBusy = true; cdMsg = ''; renderCardPage(); socket.emit('apply-virtual-card', { groupId: activeGroupId, payNow: !!payNow }); };
const _renderCardV42 = renderCardPage;
renderCardPage = function () {
  _renderCardV42();
  v42safe(() => {
    const host = v42El('txCardBody'), d = typeof cdData !== 'undefined' ? cdData : null; if (!host || !d || !d.eligible) return;
    host.querySelectorAll('.v40-bill, .v40-billsum, .v40-editbill').forEach((n) => n.remove());          // the seller never fills in a billing address
    const wrap = host.querySelector('.cd-wrap'); if (!wrap || !['issued', 'frozen'].includes(d.status)) return;
    const acts = wrap.querySelector('.cd-actions'), frozen = d.status === 'frozen', by = d.card && d.card.frozenBy;
    if (acts && !frozen) acts.insertAdjacentHTML('beforeend', '<button type="button" class="admin-btn v42-freeze" onclick="v42Freeze(true)"><i class="fa-solid fa-snowflake"></i> Freeze card</button>');
    if (acts && frozen && by === 'seller') acts.innerHTML = `<div class="cd-note"><i class="fa-solid fa-snowflake"></i> You froze this card. Purchases are blocked until you unfreeze it.</div><button class="send-btn" onclick="v42Freeze(false)"><i class="fa-solid fa-lock-open"></i> Unfreeze card</button>`;
    const small = wrap.querySelector('.cd-small');
    if (!frozen && typeof cdReveal !== 'undefined' && cdReveal && cdReveal.billing) {
      const b = cdReveal.billing, us = b.countryIso === 'US';
      const rows = [['Street address', v42Esc(b.address1)]]; if (b.address2) rows.push(['Apartment / suite', v42Esc(b.address2)]);
      rows.push(['City', v42Esc(b.city)]); if (b.state) rows.push([us ? 'State' : 'State / region', v42Esc(b.state)]); if (b.zip) rows.push([us ? 'ZIP code' : 'Postal code', v42Esc(b.zip)]); rows.push(['Country', v42Esc(b.country)]);
      const html = `<div class="v42-billview"><div class="v42-billhead"><i class="fa-solid fa-location-dot"></i> Billing address <small>Use this exactly when a shop asks for it</small></div>${cdRows(rows)}</div>`;
      if (small) small.insertAdjacentHTML('beforebegin', html); else wrap.insertAdjacentHTML('beforeend', html);
    } else if (!frozen && small) small.insertAdjacentHTML('beforebegin', '<p class="cd-small v42-billhint"><i class="fa-solid fa-location-dot"></i> Your billing address appears here with your card details.</p>');
  });
};
function v42Freeze(on) { if (on) { socket.emit('set-card-frozen', { groupId: activeGroupId, frozen: true }); } else { socket.emit('set-card-frozen', { groupId: activeGroupId, frozen: false }); } }
socket.on('card-result', (r) => v42safe(() => { if (r && r.ok && r.step === 'frozen') toast('Card frozen. Purchases are blocked.'); if (r && r.ok && r.step === 'unfrozen') toast('Card unfrozen. It is ready to use again.'); }));

// ---- Desk: billing address registered with the card (shown in the issue form, and editable any time) ----
const v42BillDraft = {};
function v42BillOf(a) { const d = v42BillDraft[a.groupId] || {}, b = a.billing || {}; return { address1: d.address1 != null ? d.address1 : (b.address1 || ''), address2: d.address2 != null ? d.address2 : (b.address2 || ''), city: d.city != null ? d.city : (b.city || ''), state: d.state != null ? d.state : (b.state || ''), zip: d.zip != null ? d.zip : (b.zip || ''), iso: d.iso || b.countryIso || a.countryIso || '' }; }
function v42BillInput(gid, k, v) { (v42BillDraft[gid] = v42BillDraft[gid] || {})[k] = v; }
function v42BillCountry(gid, iso) { v42BillInput(gid, 'iso', iso); document.querySelectorAll(`[data-cbhelp="${gid}"]`).forEach((n) => { n.textContent = iso && typeof QAddress !== 'undefined' ? QAddress.postalHelp(iso) : ''; }); }
function v42BillAdmin(a, save) {
  const v = v42BillOf(a), gid = v42Esc(a.groupId), on = !!a.billing;
  const opts = (typeof QC !== 'undefined' ? QC.COUNTRIES.slice().sort((x, y) => x.name.localeCompare(y.name)) : []).map((c) => `<option value="${c.iso}" ${c.iso === v.iso ? 'selected' : ''}>${v42Esc(c.name)}</option>`).join('');
  const f = (k, label, ph, extra) => `<label class="v42-bf ${extra || ''}"><span>${label}</span><input class="message-input" data-cb="${gid}.${k}" value="${v42Esc(v[k])}" placeholder="${ph}" autocomplete="off" oninput="v42BillInput('${gid}','${k}',this.value)"></label>`;
  return `<div class="v42-bill"><div class="v42-bill-h"><i class="fa-solid fa-location-dot"></i><div><b>Billing address</b><small>Registered with this card. The seller sees it only after the card is issued, together with the card details.</small></div><span class="v42-pill ${on ? 'ok' : 'warn'}">${on ? 'On file' : 'Required'}</span></div>
    <div class="v42-bill-grid">${f('address1', 'Street address', 'House number and street', 'wide')}${f('address2', 'Apartment, suite (optional)', 'Apt, suite, unit', 'wide')}${f('city', 'City', 'City or town')}${f('state', 'State / region', 'e.g. NY or New York')}${f('zip', 'ZIP / postal code', 'e.g. 10001')}
      <label class="v42-bf"><span>Country</span><select class="message-input" data-cb="${gid}.iso" onchange="v42BillCountry('${gid}',this.value)"><option value="">Select country</option>${opts}</select></label></div>
    <small class="v42-bill-help" data-cbhelp="${gid}">${v.iso && typeof QAddress !== 'undefined' ? v42Esc(QAddress.postalHelp(v.iso)) : ''}</small>
    <div class="gate-msg v42-bill-err" data-cbe="${gid}" role="alert"></div>
    ${save ? `<button class="admin-btn" type="button" onclick="v42BillSave('${gid}')"><i class="fa-solid fa-floppy-disk"></i> Save billing address</button>` : ''}</div>`;
}
function v42BillRead(gid) {
  const o = {}; document.querySelectorAll(`[data-cb^="${gid}."]`).forEach((i) => { o[i.dataset.cb.split('.')[1]] = i.value; });
  const cur = v42BillDraft[gid] || {}; return { address1: o.address1 != null ? o.address1 : cur.address1 || '', address2: o.address2 != null ? o.address2 : cur.address2 || '', city: o.city != null ? o.city : cur.city || '', state: o.state != null ? o.state : cur.state || '', zip: o.zip != null ? o.zip : cur.zip || '', country: o.iso || cur.iso || '' };
}
function v42BillErr(gid, msg, field) {
  document.querySelectorAll(`[data-cbe="${gid}"]`).forEach((n) => { n.textContent = msg || ''; });
  document.querySelectorAll(`[data-cb^="${gid}."]`).forEach((i) => i.closest('.v42-bf').classList.toggle('err', !!field && i.dataset.cb === `${gid}.${field === 'country' ? 'iso' : field}`));
}
function v42BillCheck(gid) { const r = QAddress.validateBilling(v42BillRead(gid), ''); if (!r.ok) { v42BillErr(gid, r.error, r.field); return null; } v42BillErr(gid, '', ''); return r.billing; }
function v42BillSave(gid) { const b = v42BillCheck(gid); if (!b) return; socket.emit('admin-save-card-billing', { groupId: gid, billing: b }); }
socket.on('card-billing-error', (e) => v42safe(() => { if (e) v42BillErr(e.groupId, e.error, e.field); }));
const _cdIssueFormV42 = cdIssueForm;
cdIssueForm = function (a) { return v42BillAdmin(a, false) + _cdIssueFormV40(a); };           // v39 form + the billing address the Desk registers with the card
cdIssue = function (gid) {
  const b = v42BillCheck(gid); if (!b) return toast('Add the billing address first: street, city, state, postal code and country.', true);
  const f = {}; document.querySelectorAll(`[data-ci^="${gid}."]`).forEach((i) => { f[i.dataset.ci.split('.')[1]] = i.value.trim(); });
  socket.emit('admin-issue-card', { groupId: gid, pan: f.pan, expMonth: f.expMonth, expYear: f.expYear, cvv: f.cvv, holder: f.holder, billing: b });
};
socket.on('admin-card', (d) => v42safe(() => {                                                 // seller profile: billing for applications that are not at the issue step
  const box = v42El('spCard'); if (!box || !d || !d.eligible || !['awaiting_fee', 'issued', 'frozen'].includes(d.status)) return;
  if (!box.querySelector('.v42-bill')) box.insertAdjacentHTML('beforeend', v42BillAdmin(d, true));
}));

// ====================================================================
// 3. App PIN
// ====================================================================
const v42Pin = { unlocked: false, buf: '', pending: null, mode: 'lock', busy: false, until: 0, timer: 0 };
const v42PinSub = { lock: 'Your account is locked. Enter your 6-digit PIN to continue.', reveal: 'Enter your PIN to show your card details.', unfreeze: 'Enter your PIN to unfreeze your card.', transfer: 'Enter your PIN to continue with your transfer.' };
function v42PinOpen(mode) {
  v42Pin.mode = mode; v42Pin.buf = ''; v42Pin.busy = false;
  let o = v42El('v42Pin');
  if (!o) {
    document.body.insertAdjacentHTML('beforeend', `<div class="v42-pin" id="v42Pin" role="dialog" aria-modal="true" aria-label="Enter your PIN"><div class="v42-pin-card">
      <div class="v42-pin-badge"><i class="fa-solid fa-lock"></i></div><h2>Enter your PIN</h2><p id="v42PinSub"></p>
      <div class="v42-dots" id="v42Dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="v42-pin-msg" id="v42PinMsg" role="alert"></div>
      <div class="v42-pad" id="v42Pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}" aria-label="${n}">${n}</button>`).join('')}<span></span><button type="button" data-k="0" aria-label="0">0</button><button type="button" data-k="back" aria-label="Delete"><i class="fa-solid fa-delete-left"></i></button></div>
      <div class="v42-pin-foot"><button type="button" id="v42PinOut"></button></div></div></div>`);
    o = v42El('v42Pin');
    v42El('v42Pad').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (b) v42PinKey(b.dataset.k); });
    v42El('v42PinOut').addEventListener('click', () => { if (v42Pin.mode === 'lock') v42SignOut(); else v42PinClose(true); });
  }
  v42El('v42PinSub').textContent = v42PinSub[mode] || v42PinSub.lock;
  v42El('v42PinMsg').textContent = ''; v42El('v42PinOut').innerHTML = mode === 'lock' ? '<i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out' : 'Cancel';
  o.classList.add('on'); document.documentElement.classList.add('v42-pin-open'); v42PinPaint();
}
function v42PinClose(cancel) { const o = v42El('v42Pin'); if (o) o.classList.remove('on'); document.documentElement.classList.remove('v42-pin-open'); v42Pin.buf = ''; if (cancel) v42Pin.pending = null; clearInterval(v42Pin.timer); }
function v42PinPaint() { document.querySelectorAll('#v42Dots i').forEach((d, i) => d.classList.toggle('on', i < v42Pin.buf.length)); }
function v42PinKey(k) {
  const o = v42El('v42Pin'); if (!o || !o.classList.contains('on') || v42Pin.busy || Date.now() < v42Pin.until) return;
  if (k === 'back') v42Pin.buf = v42Pin.buf.slice(0, -1); else if (/^\d$/.test(k) && v42Pin.buf.length < 6) v42Pin.buf += k;
  v42El('v42PinMsg').textContent = ''; v42PinPaint();
  if (v42Pin.buf.length === 6) { v42Pin.busy = true; socket.emit('unlock-pin', { groupId: activeGroupId, pin: v42Pin.buf }); }
}
document.addEventListener('keydown', (e) => { const o = v42El('v42Pin'); if (!o || !o.classList.contains('on')) return; if (/^\d$/.test(e.key)) { e.preventDefault(); v42PinKey(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); v42PinKey('back'); } else if (e.key === 'Escape' && v42Pin.mode !== 'lock') v42PinClose(true); });
function v42PinPrompt(action) { v42Pin.pending = action; v42PinOpen(action === 'lock' ? 'lock' : (v42PinSub[action] ? action : 'reveal')); }
function v42PinRetry(p) {
  if (p === 'reveal') cdShow();
  else if (p === 'unfreeze') socket.emit('set-card-frozen', { groupId: activeGroupId, frozen: false });
  else if (p === 'transfer' && typeof wdPendingDraft !== 'undefined' && wdPendingDraft) socket.emit('request-withdrawal', wdPendingDraft);
}
socket.on('pin-required', ({ action }) => v42safe(() => { v42Pin.unlocked = false; v42PinPrompt(action || 'reveal'); }));
socket.on('pin-result', (r) => v42safe(() => {
  if (!r) return;
  if (r.kind === 'unlock') {
    v42Pin.busy = false;
    if (r.ok) { v42Pin.unlocked = true; const p = v42Pin.pending; v42Pin.pending = null; v42PinClose(false); if (p) v42PinRetry(p); return; }
    v42Pin.buf = ''; v42PinPaint(); const m = v42El('v42PinMsg'); if (m) m.textContent = r.error || 'That PIN is not correct.';
    const card = document.querySelector('.v42-pin-card'); if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
    if (r.locked && r.retryIn) { v42Pin.until = Date.now() + r.retryIn * 1000; clearInterval(v42Pin.timer); v42Pin.timer = setInterval(() => { const left = Math.ceil((v42Pin.until - Date.now()) / 1000); if (left <= 0) { clearInterval(v42Pin.timer); if (m) m.textContent = ''; } else if (m) m.textContent = `Too many wrong PINs. Try again in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`; }, 1000); }
    return;
  }
  if (r.kind === 'set' || r.kind === 'removed') {
    const a = v42Acct(); const m = v42El('v42PinFormMsg'); const b = v42El('v42PinSave'); if (b) b.disabled = false;
    if (r.ok) { if (a) a.pinSet = r.kind === 'set'; if (r.kind === 'set') v42Pin.unlocked = true; toast(r.kind === 'set' ? 'Your PIN is on.' : 'Your PIN was removed.'); if (typeof renderSecurity === 'function') renderSecurity(); }
    else if (m) { m.style.color = 'var(--accent-rose)'; m.textContent = r.error || 'Something went wrong.'; }
  }
}));
// the lock screen: when the account opens (sign-in or reload) and a PIN is set
socket.on('seller-account-state', () => setTimeout(() => v42safe(() => {
  const a = v42Acct(); if (!a || !isSellerUI()) return;
  if (a.pinSet && !v42Pin.unlocked && !(v42El('v42Pin') && v42El('v42Pin').classList.contains('on'))) v42PinPrompt('lock');
  if (!a.pinSet) { v42Pin.unlocked = false; const o = v42El('v42Pin'); if (o && o.classList.contains('on')) v42PinClose(true); }
}), 30));

// Security page: set / change / remove the PIN
const _renderSecV42 = renderSecurity;
renderSecurity = function () {
  _renderSecV42();
  v42safe(() => {
    const body = v42El('txSecurityBody'), a = v42Acct(); if (!body || !a || body.querySelector('.v42-pincard')) return;
    const on = !!a.pinSet;
    body.insertAdjacentHTML('afterbegin', `<div class="sec-card v42-pincard"><h3><i class="fa-solid fa-lock"></i> App PIN <span class="v42-pill ${on ? 'ok' : 'warn'}">${on ? 'On' : 'Off'}</span></h3>
      <p class="sec-sub">A 6-digit PIN locks your account. You enter it to open your account, show your card details, unfreeze your card and start a transfer.</p>
      <label class="gate-field"><span>Account password</span><input id="v42PinPw" type="password" autocomplete="current-password" placeholder="Your account password"></label>
      <label class="gate-field"><span>${on ? 'New PIN' : 'Choose a PIN'}</span><input id="v42PinNew" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="6 digits"></label>
      <label class="gate-field"><span>Confirm PIN</span><input id="v42PinNew2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="Re-enter the 6 digits"></label>
      <div id="v42PinFormMsg" class="gate-msg" role="alert"></div>
      <div class="v42-pin-actions"><button class="send-btn" id="v42PinSave" type="button" onclick="v42SavePin()"><i class="fa-solid fa-lock"></i> ${on ? 'Change PIN' : 'Turn on PIN'}</button>${on ? '<button class="admin-btn admin-btn-danger" type="button" onclick="v42RemovePin()"><i class="fa-solid fa-lock-open"></i> Remove PIN</button>' : ''}</div>
      <ul class="cr-list"><li>Avoid easy PINs such as 111111 or 123456.</li><li>You are signed out automatically after 2 minutes without activity. Next time, sign in again${on ? ' and enter your PIN' : ''}.</li></ul></div>`);
    body.querySelectorAll('#v42PinNew, #v42PinNew2').forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 6); }));
  });
};
function v42SavePin() {
  const pw = v42El('v42PinPw').value, p1 = v42El('v42PinNew').value, p2 = v42El('v42PinNew2').value, m = v42El('v42PinFormMsg'); m.style.color = ''; m.textContent = '';
  if (!pw) { m.textContent = 'Enter your account password to continue.'; return; }
  if (!/^\d{6}$/.test(p1)) { m.textContent = 'Your PIN must be exactly 6 digits.'; return; }
  if (p1 !== p2) { m.textContent = 'The two PINs do not match.'; return; }
  v42El('v42PinSave').disabled = true; socket.emit('set-my-pin', { groupId: activeGroupId, pin: p1, password: pw });
}
function v42RemovePin() {
  const pw = v42El('v42PinPw').value, m = v42El('v42PinFormMsg'); m.style.color = ''; m.textContent = '';
  if (!pw) { m.textContent = 'Enter your account password to remove the PIN.'; return; }
  socket.emit('remove-my-pin', { groupId: activeGroupId, password: pw });
}

// ====================================================================
// 4. Sign out, and automatic sign-out after 2 minutes without activity
// ====================================================================
function v42SignOut(reason) {
  if (reason === 'idle') { try { sessionStorage.setItem('q_idle_note', '1'); } catch (e) { /* ignore */ } }
  try { socket.emit('seller-logout'); } catch (e) { /* ignore */ }
  setTimeout(() => v41DoSignOut(), 150);
}
const _doSignOutV42 = v41DoSignOut;
v41DoSignOut = function () { try { socket.emit('seller-logout'); } catch (e) { /* ignore */ } return _doSignOutV42(); };
let v42Last = Date.now(), v42Out = false;
['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll', 'click'].forEach((ev) => document.addEventListener(ev, () => { v42Last = Date.now(); }, { passive: true, capture: true }));
function v42IdleCheck() {
  if (v42Out) return;
  if (!isSellerUI()) { v42Last = Date.now(); return; }
  if (Date.now() - v42Last >= (window.__V42_IDLE_MS || 120000)) { v42Out = true; v42SignOut('idle'); }
}
setInterval(() => v42safe(v42IdleCheck), 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) v42safe(v42IdleCheck); });
window.addEventListener('pageshow', () => v42safe(v42IdleCheck));
v42safe(() => {
  let note = false; try { note = sessionStorage.getItem('q_idle_note') === '1'; sessionStorage.removeItem('q_idle_note'); } catch (e) { /* ignore */ }
  if (!note) return;
  const show = () => {
    if (v42El('v42Idle')) return;
    document.body.insertAdjacentHTML('beforeend', '<div class="v42-idle" id="v42Idle" role="status"><i class="fa-solid fa-clock"></i><span>You were signed out after 2 minutes of inactivity. Please sign in again to continue.</span><button type="button" aria-label="Dismiss" onclick="this.parentNode.remove()">&times;</button></div>');
    setTimeout(() => { const n = v42El('v42Idle'); if (n) n.remove(); }, 20000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
});
