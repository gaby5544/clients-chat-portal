/* v3.12 client layer. Loaded last. It only ADDS to / wraps what earlier layers do (never deletes them).
   - seller layout: visible "Chat room" access, flag chip, no support/bell in the top bar, Notifications page + automatic push
   - composer: roomy typing box, mic beside Send, no clipboard button, universal keyboard / auto-correct settings on every field
   - phone numbers must match the selected country; dark searchable country picker in Add seller
   - AIRWX card billing address (street, city, state, ZIP, country)
   - Admin: silent email change in the seller profile */
'use strict';
const v40safe = (fn) => { try { return fn(); } catch (e) { console.warn('[v40]', e); } };
const v40Esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v40El = (id) => document.getElementById(id);

// ====================================================================
// 1. Seller account view: layout
// ====================================================================
v40safe(() => {
  const view = v40El('txAccountView'); if (!view) return;
  // top bar: no Support, no bell (Notifications now lives in the side list); add the flag chip and a Chat room button
  ['txSupportBtn', 'txBellBtn'].forEach((id) => { const n = v40El(id); if (n) n.remove(); });
  const right = view.querySelector('.tx-topbar-right');
  if (right && !v40El('txFlagChip')) right.insertAdjacentHTML('afterbegin', '<button type="button" class="tx-flagchip hidden" id="txFlagChip" onclick="setTxAccountNav(\'profile\')" aria-label="Your country"><span class="fl" id="txFlagChipFlag"></span><b id="txFlagChipName"></b></button>');
  if (right && !v40El('txChatPill')) right.insertAdjacentHTML('beforeend', '<button type="button" class="tx-chatpill" id="txChatPill" onclick="closeTxAccountView()" aria-label="Open the chat room"><i class="fa-solid fa-comments"></i><span>Chat room</span></button>');
  if (right && v40El('txAvatar') && v40El('txChatPill')) right.insertBefore(v40El('txChatPill'), v40El('txAvatar'));
  // sidebar: a clear "Chat room" button at the top, a Notifications entry in the list, and the old exit button relabelled
  const nav = view.querySelector('.tx-nav');
  if (nav && !v40El('txNavChat')) nav.insertAdjacentHTML('afterbegin', '<button type="button" class="tx-nav-item tx-nav-chat" id="txNavChat" onclick="closeTxAccountView()"><i class="fa-solid fa-comments"></i> Chat room <small>Talk to the Desk</small></button>');
  if (nav && !nav.querySelector('[data-txnav="notifications"]')) {
    const b = document.createElement('button'); b.className = 'tx-nav-item'; b.dataset.txnav = 'notifications'; b.onclick = () => setTxAccountNav('notifications');
    b.innerHTML = '<i class="fa-solid fa-bell"></i> Notifications <span class="v40-dot hidden" id="v40NavDot"></span>';
    const ref = nav.querySelector('[data-txnav="profile"]'); nav.insertBefore(b, ref || null);
  }
  const back = view.querySelector('.tx-sidebar > button.tx-nav-item[onclick="closeTxAccountView()"]');
  if (back) { back.classList.add('tx-back-chat'); back.removeAttribute('style'); back.innerHTML = '<i class="fa-solid fa-comments"></i> Back to chat room'; }
  const scroll = view.querySelector('.tx-scroll');
  if (scroll && !v40El('txPageNotifications')) scroll.insertAdjacentHTML('beforeend', '<div class="tx-page hidden" id="txPageNotifications"><div id="txNotificationsBody"></div></div>');
  TX_NAV_TITLES.notifications = ['Notifications', 'Updates about your payments, card and account.'];
  // bottom bar: a Chat button so the chat room is one tap away on a phone
  const bn = v40El('txBottomNav');
  if (bn && !bn.querySelector('[data-bn-chat]')) {
    bn.insertAdjacentHTML('beforeend', '<button type="button" data-bn-chat="1" aria-label="Chat room"><i class="fa-solid fa-comments"></i>Chat</button>');
    bn.querySelector('[data-bn-chat]').addEventListener('click', (e) => { e.stopPropagation(); closeTxAccountView(); });
  }
});
const _navV40 = setTxAccountNav;
setTxAccountNav = function (nav) {
  _navV40(nav);
  if (nav === 'notifications') { v40MarkRead(); v40RenderNotes(); }
};

function v40SyncFlag() {
  const a = (typeof sellerAccountState !== 'undefined' && sellerAccountState) || null;
  const chip = v40El('txFlagChip'); if (!chip) return;
  if (!a || !a.country) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden'); chip.title = a.country;
  const fc = a.countryIso || ((QC.findCountry(a.country) || {}).iso || '');
  v40El('txFlagChipFlag').innerHTML = fc ? flagHtml(fc, a.country) : '';
  v40El('txFlagChipName').textContent = a.country;
}
socket.on('seller-account-state', () => setTimeout(() => { v40SyncFlag(); v40AutoPush(); }, 10));

// ====================================================================
// 2. Notifications: in-app list + push that switches itself on
// ====================================================================
const v40NoteKey = () => 'q_notes_' + (typeof activeGroupId !== 'undefined' ? activeGroupId : 'x');
function v40LoadNotes() { try { return JSON.parse(localStorage.getItem(v40NoteKey()) || '[]'); } catch (e) { return []; } }
function v40SaveNotes(l) { try { localStorage.setItem(v40NoteKey(), JSON.stringify(l.slice(0, 40))); } catch (e) { /* storage may be blocked */ } }
socket.on('seller-notice', (n) => {
  if (!n) return; const l = v40LoadNotes(); l.unshift({ kind: n.kind || 'info', title: String(n.title || ''), body: String(n.body || ''), at: new Date().toISOString(), read: false }); v40SaveNotes(l);
  v40RenderDot(); const pg = v40El('txPageNotifications'); if (pg && !pg.classList.contains('hidden')) { v40MarkRead(); v40RenderNotes(); }
});
function v40RenderDot() { const d = v40El('v40NavDot'); if (d) d.classList.toggle('hidden', !v40LoadNotes().some((x) => !x.read)); }
function v40MarkRead() { const l = v40LoadNotes(); l.forEach((x) => { x.read = true; }); v40SaveNotes(l); v40RenderDot(); }
function v40NoteIcon(k) { return { card: 'fa-regular fa-credit-card', tracking: 'fa-solid fa-satellite-dish', payment: 'fa-solid fa-arrow-down', withdrawal: 'fa-solid fa-arrow-up' }[k] || 'fa-solid fa-bell'; }
let v40PushState = 'unknown';   // on | blocked | off | unsupported | unknown
function v40PushLabel() {
  return { on: ['good', 'fa-circle-check', 'Notifications are on for this device', 'You will be told as soon as a payment moves, your card is ready or the Desk replies.'],
    blocked: ['bad', 'fa-ban', 'Notifications are blocked by your browser', 'Open your browser or phone settings for this site, set Notifications to Allow, then come back and tap the button below.'],
    unsupported: ['warn', 'fa-circle-info', 'This browser cannot show push notifications', 'You will still see every update here, and in your email.'],
    off: ['warn', 'fa-bell-slash', 'Notifications are not switched on yet', 'Tap the button to allow them. It takes one tap.'], unknown: ['warn', 'fa-bell', 'Checking notifications…', ''] }[v40PushState];
}
function v40RenderNotes() {
  const host = v40El('txNotificationsBody'); if (!host) return;
  const [cls, ic, title, sub] = v40PushLabel(); const l = v40LoadNotes();
  host.innerHTML = `<div class="v40-notes"><div class="v40-pushcard ${cls}"><div class="ic"><i class="fa-solid ${ic}"></i></div><div class="tx"><b>${v40Esc(title)}</b><small>${v40Esc(sub)}</small></div>
    ${v40PushState === 'on' || v40PushState === 'unsupported' ? '' : '<button type="button" class="send-btn" onclick="v40EnablePush(true)"><i class="fa-solid fa-bell"></i> Turn on</button>'}</div>
    <div class="rc-gt" style="border-radius:12px 12px 0 0">Recent updates ${l.length ? '<button type="button" class="v40-clear" onclick="v40ClearNotes()">Clear</button>' : ''}</div>
    <div class="v40-nlist">${l.length ? l.map((n) => `<div class="v40-note ${n.read ? '' : 'new'}"><span class="ic"><i class="${v40NoteIcon(n.kind)}"></i></span><div><b>${v40Esc(n.title)}</b><small>${v40Esc(n.body)}</small><em>${v40Esc(typeof fmtDateTime === 'function' ? fmtDateTime(n.at) : n.at)}</em></div></div>`).join('') : '<p class="rc-empty">No updates yet. New payments, card news and replies from the Desk will appear here.</p>'}</div></div>`;
}
function v40ClearNotes() { v40SaveNotes([]); v40RenderNotes(); v40RenderDot(); }
// Browsers never allow a site to grant itself notification permission silently. What we CAN do is ask automatically the
// moment a seller is signed in (and again on their first tap, which some phones require), subscribe straight away when
// allowed, and show a one-tap button if the person (or browser) said no.
async function v40EnablePush(fromTap) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { v40PushState = 'unsupported'; v40RenderNotes(); return 'unsupported'; }
  if (Notification.permission === 'denied') { v40PushState = 'blocked'; v40RenderNotes(); if (fromTap) toast('Notifications are blocked in your browser settings for this site.', true); return 'blocked'; }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (Notification.permission !== 'granted') { const p = await Notification.requestPermission(); if (p !== 'granted') { v40PushState = p === 'denied' ? 'blocked' : 'off'; v40RenderNotes(); return v40PushState; } }
      const { publicKey } = await (await fetch('/api/push/vapid-public-key')).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    }
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionToken, subscription: sub.toJSON() }) });
    pushSubscribed = true; v40PushState = 'on'; v40RenderNotes();
    if (fromTap) toast('Notifications are on.');
    return 'on';
  } catch (e) { v40PushState = 'off'; v40RenderNotes(); return 'error'; }
}
let v40PushTried = false, v40TapBound = false;
function v40AutoPush() {
  v40RenderDot();
  if (typeof isSellerUI !== 'function' || !isSellerUI()) return;
  if (!v40PushTried) { v40PushTried = true; v40EnablePush(false); }
  if (!v40TapBound && 'Notification' in window && Notification.permission === 'default') {
    v40TapBound = true; const once = () => { document.removeEventListener('pointerdown', once, true); if (Notification.permission === 'default') v40EnablePush(false); };
    document.addEventListener('pointerdown', once, true);
  }
}

// ====================================================================
// 3. Country picker (dark, searchable, scrolls) - used by Add seller and the card billing form
// ====================================================================
const v40PickCb = {};
function v40OpenCountry(mode, cb) { v40PickCb[mode] = cb; openCountryPicker(mode); }
const _pickCountryV40 = pickCountry;
pickCountry = function (iso) {
  const mode = pickState.mode; _pickCountryV40(iso);
  const c = QC.findCountry(iso); if (!c) return;
  if (mode === 'country') { pickState.dial = c; pickState.dialManual = false; paintDial(); }   // the phone code always follows the country
  if (v40PickCb[mode]) v40PickCb[mode](c);
  if (mode === 'country' || mode === 'dial') v40RegPhoneHint(false);
};
function v40CountryBtnHtml(id, label) { return `<button type="button" class="message-input v40-cbtn" id="${id}"><span class="fl"></span><span class="tx placeholder">${v40Esc(label || 'Select country')}</span><i class="fa-solid fa-chevron-down"></i></button>`; }
function v40PaintCountryBtn(id, c) { const b = v40El(id); if (!b) return; b.querySelector('.fl').innerHTML = c ? flagHtml(c.iso, c.name) : ''; const t = b.querySelector('.tx'); t.textContent = c ? c.name : 'Select country'; t.classList.toggle('placeholder', !c); }

// ====================================================================
// 4. Phone numbers must be real for the selected country
// ====================================================================
function v40Hint(id, ok, msg) { const h = v40El(id); if (!h) return; h.className = 'v40-hint' + (msg ? (ok ? ' good' : ' bad') : ''); h.innerHTML = msg ? `<i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${v40Esc(msg)}` : ''; }
function v40RegPhoneCheck() {
  const inp = v40El('txRegPhoneInput'); if (!inp || !pickState.country) return null;
  return QPhone.validatePhone(pickState.country.iso, pickState.dial ? pickState.dial.dial : '', inp.value);
}
function v40RegPhoneHint(showErr) {
  const inp = v40El('txRegPhoneInput'); if (!inp) return;
  if (!inp.value.trim()) return v40Hint('txRegPhoneHint', true, '');
  if (!pickState.country) return v40Hint('txRegPhoneHint', false, showErr ? 'Please select your country first.' : '');
  const r = v40RegPhoneCheck();
  if (r.ok) v40Hint('txRegPhoneHint', true, 'Valid ' + pickState.country.name + ' number: ' + r.e164);
  else if (showErr || (v40El('txRegPhoneHint') && v40El('txRegPhoneHint').classList.contains('bad'))) v40Hint('txRegPhoneHint', false, r.error); else v40Hint('txRegPhoneHint', true, '');
}
v40safe(() => {
  const inp = v40El('txRegPhoneInput'); if (!inp) return;
  const row = inp.closest('.reg-phone-row'); if (row && !v40El('txRegPhoneHint')) row.insertAdjacentHTML('afterend', '<div class="v40-hint" id="txRegPhoneHint" role="status" aria-live="polite"></div>');
  inp.addEventListener('input', () => v40RegPhoneHint(false)); inp.addEventListener('blur', () => v40RegPhoneHint(true));
});
const _submitRegV40 = submitTxRegistration;
submitTxRegistration = function () {
  const r = v40RegPhoneCheck(); if (r && !r.ok) { v40RegPhoneHint(true); return toast(r.error, true); }
  _submitRegV40();
};

// ====================================================================
// 5. Admin: Add seller (dark country picker, phone check) and silent email change
// ====================================================================
const _openAddSellerV40 = openAddSeller;
openAddSeller = function () {
  _openAddSellerV40();
  v40safe(() => {
    const sel = v40El('asCountry'); if (!sel) return;
    if (!v40El('asCountryBtn')) {
      sel.classList.remove('csel'); sel.style.display = 'none';
      sel.insertAdjacentHTML('afterend', v40CountryBtnHtml('asCountryBtn'));
      v40El('asCountryBtn').addEventListener('click', () => v40OpenCountry('ascountry', (c) => { sel.value = c.iso; v40PaintCountryBtn('asCountryBtn', c); v40AsPhoneHint(); }));
      const ph = v40El('asPhone'); if (ph) { ph.insertAdjacentHTML('afterend', '<div class="v40-hint" id="asPhoneHint" role="status"></div>'); ph.addEventListener('input', () => v40AsPhoneHint()); ph.addEventListener('blur', () => v40AsPhoneHint(true)); }
      ['asCcy', 'asLang'].forEach((id) => { const s = v40El(id); if (s && !s.dataset.cselDone) { s.classList.add('csel'); enhanceSelect(s); } });
    }
    sel.value = ''; pickState.ascountry = null; v40PaintCountryBtn('asCountryBtn', null); v40Hint('asPhoneHint', true, '');
  });
};
function v40AsPhoneHint(showErr) {
  const ph = v40El('asPhone'), sel = v40El('asCountry'); if (!ph) return;
  if (!ph.value.trim()) return v40Hint('asPhoneHint', true, '');
  if (!sel.value) return v40Hint('asPhoneHint', false, showErr ? 'Choose the country first.' : '');
  const r = QPhone.validatePhone(sel.value, '', ph.value);
  if (r.ok) v40Hint('asPhoneHint', true, 'Valid number: ' + r.e164); else if (showErr) v40Hint('asPhoneHint', false, r.error); else v40Hint('asPhoneHint', true, '');
}
const _submitAddSellerV40 = submitAddSeller;
submitAddSeller = function () {
  const ph = v40El('asPhone'), sel = v40El('asCountry');
  if (ph && ph.value.trim() && sel && sel.value) { const r = QPhone.validatePhone(sel.value, '', ph.value); if (!r.ok) { v40AsPhoneHint(true); return toast(r.error, true); } }
  _submitAddSellerV40();
};
socket.on('seller-profile', ({ groupId, account: a }) => {
  setTimeout(() => {
    const body = v40El('spBody'), modal = v40El('sellerProfileModal'); if (!body || !modal || modal.classList.contains('hidden') || !a) return;
    let box = v40El('spEmailChange');
    const hist = (a.emailChanges || []).slice().reverse().map((c) => `<li>${v40Esc(typeof fmtDateTime === 'function' ? fmtDateTime(c.at) : c.at)} · ${v40Esc(c.from || '—')} → ${v40Esc(c.to)}</li>`).join('');
    const html = `<div class="ctrl-row" style="margin-bottom:6px"><div><b><i class="fa-solid fa-envelope-circle-check"></i> Change email address</b><small>Updates the address this seller signs in with. <u>Nothing is sent</u> to the seller: no email to the old or new address, no notification, no pop-up. The change is recorded in the account's audit trail.</small></div></div>
      <div class="v40-emailrow"><input id="spNewEmail" type="email" class="message-input" inputmode="email" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="${v40Esc(a.email || '')}" placeholder="new@example.com"><button class="send-btn" type="button" onclick="v40ChangeEmail('${v40Esc(a.groupId || groupId)}')"><i class="fa-solid fa-check"></i> Change silently</button></div>
      ${hist ? `<ul class="v40-hist">${hist}</ul>` : ''}`;
    if (!box) body.insertAdjacentHTML('beforeend', `<div class="widget-card" id="spEmailChange" style="margin-top:12px" data-current="${v40Esc(a.email || '')}">${html}</div>`); else if (box.dataset.current !== (a.email || '')) { box.dataset.current = a.email || ''; box.innerHTML = html; }
  }, 90);
});
function v40ChangeEmail(gid) {
  const v = (v40El('spNewEmail').value || '').trim().toLowerCase();
  if (!isValidEmailClient(v)) return toast('Enter a valid email address.', true);
  if (!confirm('Change this seller’s email to ' + v + '?\n\nThe seller will NOT be notified.')) return;
  socket.emit('admin-change-seller-email', { groupId: gid, email: v });
}

// ====================================================================
// 6. AIRWX card: billing address (street, city, state, ZIP, country)
// ====================================================================
const v40Bill = { address1: '', address2: '', city: '', state: '', zip: '', iso: '', edit: false, field: '' };
function v40BillFill(b) { if (!b) return; Object.assign(v40Bill, { address1: b.address1 || '', address2: b.address2 || '', city: b.city || '', state: b.state || '', zip: b.zip || '', iso: b.countryIso || v40Bill.iso }); }
function v40BillForm(d, saveLabel, saveFn) {
  const iso = v40Bill.iso || d.billingDefaultIso || ''; const c = iso ? QC.findCountry(iso) : null;
  const isUS = iso === 'US', isCA = iso === 'CA';
  const stLabel = isUS ? 'State' : isCA ? 'Province' : 'State / region'; const zLabel = isUS ? 'ZIP code' : 'Postal code';
  const need = QAddress.STATE_REQUIRED[iso]; const noPost = QAddress.NO_POST[iso];
  const f = (id, label, val, attrs, key) => `<label class="${v40Bill.field === key ? 'err' : ''}">${label}<input class="message-input" id="${id}" data-bill="${key}" value="${v40Esc(val)}" ${attrs}></label>`;
  return `<div class="v40-bill" id="v40BillForm"><div class="v40-bill-h"><i class="fa-solid fa-location-dot"></i> Billing address <small>Shops compare this with the card, so it must be your real address.</small></div>
    <div class="v40-bill-grid">
      ${f('cbAddr1', 'Street address', v40Bill.address1, 'autocomplete="address-line1" autocapitalize="words" autocorrect="on" spellcheck="true" maxlength="100" placeholder="House number and street"', 'address1')}
      ${f('cbAddr2', 'Apartment, suite (optional)', v40Bill.address2, 'autocomplete="address-line2" autocapitalize="words" autocorrect="on" maxlength="100" placeholder="Apt, suite, unit"', 'address2')}
      ${f('cbCity', 'City', v40Bill.city, 'autocomplete="address-level2" autocapitalize="words" autocorrect="on" spellcheck="true" maxlength="60" placeholder="City or town"', 'city')}
      ${f('cbState', stLabel + (need ? '' : ' (optional)'), v40Bill.state, `autocomplete="address-level1" autocapitalize="${isUS || isCA ? 'characters' : 'words'}" autocorrect="off" maxlength="60" placeholder="${isUS ? 'e.g. NY or New York' : isCA ? 'e.g. ON or Ontario' : 'State or region'}"`, 'state')}
      ${f('cbZip', zLabel + (noPost ? ' (optional)' : ''), v40Bill.zip, `autocomplete="postal-code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" placeholder="${isUS ? '12345' : ''}"`, 'zip')}
      <label class="${v40Bill.field === 'country' ? 'err' : ''}">Country${v40CountryBtnHtml('cbCountryBtn', c ? c.name : 'Select country').replace('placeholder', c ? '' : 'placeholder')}</label></div>
    ${iso ? `<small class="v40-bill-help">${v40Esc(QAddress.postalHelp(iso))}</small>` : ''}
    ${saveFn ? `<button class="send-btn cd-wide" type="button" onclick="${saveFn}"><i class="fa-solid fa-floppy-disk"></i> ${saveLabel}</button>` : ''}</div>`;
}
function v40BillRead() {
  document.querySelectorAll('#v40BillForm [data-bill]').forEach((i) => { v40Bill[i.dataset.bill] = i.value; });
  return { address1: v40Bill.address1, address2: v40Bill.address2, city: v40Bill.city, state: v40Bill.state, zip: v40Bill.zip, country: v40Bill.iso };
}
function v40BillCheck() {
  const b = v40BillRead(); const r = QAddress.validateBilling(b, ''); v40Bill.field = r.ok ? '' : r.field;
  if (!r.ok) { cdMsg = r.error; renderCardPage(); return null; }
  return r.billing;
}
function v40BillBind() {
  const f = v40El('v40BillForm'); if (!f) return;
  f.addEventListener('input', (e) => { if (e.target.dataset.bill) v40Bill[e.target.dataset.bill] = e.target.value; });
  const btn = v40El('cbCountryBtn'); if (btn) { const c = v40Bill.iso ? QC.findCountry(v40Bill.iso) : null; v40PaintCountryBtn('cbCountryBtn', c);
    btn.addEventListener('click', () => { v40BillRead(); v40OpenCountry('cdcountry', (cc) => { v40Bill.iso = cc.iso; renderCardPage(); }); }); }
}
const _renderCardV40 = renderCardPage;
renderCardPage = function () {
  _renderCardV40();
  v40safe(() => {
    const host = v40El('txCardBody'); const d = typeof cdData !== 'undefined' ? cdData : null; if (!host || !d || !d.eligible) return;
    const wrap = host.querySelector('.cd-wrap'); if (!wrap) return;
    if (d.billing && !v40Bill.address1 && !v40Bill.edit) v40BillFill(d.billing);
    if (!v40Bill.iso) v40Bill.iso = (d.billing && d.billing.countryIso) || d.billingDefaultIso || '';
    const apply = wrap.querySelector('button[onclick^="cdApply"]');
    if (apply) {                                                    // not applied yet: the form comes before the Apply button
      apply.insertAdjacentHTML('beforebegin', v40BillForm(d)); v40BillBind();
    } else if (d.billing || ['awaiting_fee', 'processing'].includes(d.status)) {
      const editable = ['awaiting_fee', 'processing'].includes(d.status);
      const html = v40Bill.edit && editable ? v40BillForm(d, 'Save address', 'v40SaveBilling()') : `<div class="cd-rows v40-billsum"><div><span>Billing address</span><b>${v40Esc(QAddress.formatBilling(d.billing) || '—')}</b></div></div>${editable ? '<button type="button" class="admin-btn v40-editbill" onclick="v40Bill.edit=true;renderCardPage()"><i class="fa-solid fa-pen"></i> Edit billing address</button>' : ''}`;
      const small = wrap.querySelector('.cd-small'); if (small) small.insertAdjacentHTML('beforebegin', html); else wrap.insertAdjacentHTML('beforeend', html);
      v40BillBind();
    }
  });
};
cdApply = function (payNow) {
  if (cdBusy) return; const b = v40BillCheck(); if (!b) return;
  cdBusy = true; cdMsg = ''; renderCardPage(); socket.emit('apply-virtual-card', { groupId: activeGroupId, payNow: !!payNow, billing: b });
};
function v40SaveBilling() { const b = v40BillCheck(); if (!b) return; cdMsg = ''; socket.emit('save-card-billing', { groupId: activeGroupId, billing: b }); }
socket.on('card-result', (r) => { if (r && r.ok && r.step === 'billing') { v40Bill.edit = false; v40Bill.field = ''; cdRequest(); toast('Billing address saved.'); } else if (r && !r.ok && r.field) { v40Bill.field = r.field; renderCardPage(); } });
const _cdIssueFormV40 = cdIssueForm;
cdIssueForm = function (a) {
  const bill = a.billingText ? `<div class="v40-adminbill"><b><i class="fa-solid fa-location-dot"></i> Billing address for this card</b><span>${v40Esc(a.billingText)}</span></div>` : '<div class="v40-adminbill warn"><b>No billing address on file.</b></div>';
  return bill + _cdIssueFormV40(a);
};

// ====================================================================
// 7. Composer + every input: roomy typing box, mic beside Send, no clipboard button, universal keyboard settings
// ====================================================================
v40safe(() => {
  const fc = document.querySelector('.footer-controls'); if (!fc || fc.querySelector('.composer-tools')) return;
  const tools = document.createElement('div'); tools.className = 'composer-tools'; tools.id = 'composerTools';
  ['moreOptionsBtn', 'translateToggleBtn', 'fileUploadLabel'].forEach((id) => { const n = v40El(id); if (n) tools.appendChild(n); });
  fc.insertBefore(tools, fc.firstChild);
  const pb = v40El('pasteBtn'); if (pb) pb.remove();                     // the clipboard button is gone (normal paste still works everywhere)
  const mic = v40El('micBtn'), send = fc.querySelector('.send-btn-elite'); if (mic && send) fc.insertBefore(mic, send);
});
// Standard, universal field settings. Names -> capitalised words; email/password/codes -> no auto-correct; chat and long text -> auto-correct + spell check.
function v40FixField(i) {
  if (!i || i.dataset.v40) return; if (i.tagName !== 'INPUT' && i.tagName !== 'TEXTAREA') return;
  const t = (i.type || 'text').toLowerCase(); if (['checkbox', 'radio', 'file', 'hidden', 'button', 'submit', 'range', 'color', 'date', 'datetime-local', 'time'].includes(t)) return;
  i.dataset.v40 = '1'; const id = (i.id || '').toLowerCase(), set = (k, v) => { if (!i.hasAttribute(k)) i.setAttribute(k, v); };
  const money = /iban|swift|routing|account|sort|pan|cvv|code|ref|amount|data-bk|data-sr|data-ci/i.test(id + ' ' + Array.from(i.attributes).map((a) => a.name).join(' '));
  if (t === 'email') { set('autocapitalize', 'none'); set('autocorrect', 'off'); set('spellcheck', 'false'); set('inputmode', 'email'); set('autocomplete', 'email'); }
  else if (t === 'password') { set('autocapitalize', 'none'); set('autocorrect', 'off'); set('spellcheck', 'false'); }
  else if (t === 'tel') { set('inputmode', 'tel'); set('autocorrect', 'off'); set('spellcheck', 'false'); set('autocapitalize', 'none'); }
  else if (/code/.test(id) && /^(\d|)/.test(i.getAttribute('maxlength') || '') && (i.getAttribute('maxlength') === '6')) { set('inputmode', 'numeric'); set('autocomplete', 'one-time-code'); set('autocorrect', 'off'); set('spellcheck', 'false'); }
  else if (money) { set('autocorrect', 'off'); set('spellcheck', 'false'); set('autocapitalize', 'none'); }
  else if (/name|beneficiary|holder|company|city|address/.test(id)) { set('autocapitalize', 'words'); set('autocorrect', 'on'); set('spellcheck', 'true'); if (/name/.test(id) && !/bank|company|user/.test(id)) set('autocomplete', 'name'); }
  else { set('autocapitalize', 'sentences'); set('autocorrect', 'on'); set('spellcheck', 'true'); }
}
function v40FixAll(root) { (root || document).querySelectorAll('input, textarea').forEach(v40FixField); }
v40safe(() => {
  const ta = v40El('messageInput'); if (ta) { ta.removeAttribute('autocomplete'); ta.setAttribute('autocomplete', 'on'); ta.setAttribute('autocapitalize', 'sentences'); ta.setAttribute('autocorrect', 'on'); ta.setAttribute('spellcheck', 'true'); ta.setAttribute('enterkeyhint', 'send'); ta.dataset.v40 = '1'; ta.setAttribute('lang', (typeof QI18N !== 'undefined' && QI18N.lang) || 'en'); }
  v40FixAll();
  new MutationObserver((muts) => { muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches && n.matches('input,textarea')) v40FixField(n); else if (n.querySelectorAll) v40FixAll(n); } })); }).observe(document.body, { childList: true, subtree: true });
});
v40safe(() => { v40RenderDot(); v40SyncFlag(); });

// ====================================================================
// 8. Closed trading room: the app never shows a dead-end "link expired" page
//    - not signed in  -> the app opens on Sign in / Create account, with a short, friendly note
//    - signed in      -> the person sees THEIR ACCOUNT; only the trading room is closed
// ====================================================================
window.__roomClosed = false;
function v40ClosedText(reason) {
  return reason === 'banned' ? 'This account has been closed. Please contact Support if you think this is a mistake.'
    : 'This invitation no longer opens a trading room. Sign in to see your account, or create one to get started.';
}
function showRoomClosed(d) {
  d = d || {}; try { sessionStorage.setItem('q_room_closed', '1'); } catch (e) { /* ignore */ }
  if (d.hasAccount && !d.needLogin) return v40ClosedAccountUI(d.reason);                 // signed in: keep them on their account
  window.__holdJoin = true;
  v40safe(() => {
    buildGate();
    const sp = v40El('appSplash'); if (sp) sp.classList.add('hidden');
    document.documentElement.classList.add('gate-signin');
    gateShow('welcome');
    // v3.13: no "this invitation no longer opens a trading room" box on the welcome screen - the person just sees Sign in / Create account.
  });
}
socket.on('room-closed', (d) => showRoomClosed(d));
function v40ClosedAccountUI(reason) {
  window.__roomClosed = true; document.body.classList.add('room-closed');
  const old = v40El('roomLockedBox'); if (old) old.remove();
  const host = document.querySelector('.chat-main');
  if (host && !v40El('roomClosedBox')) { host.style.position = 'relative'; host.insertAdjacentHTML('beforeend', `<div id="roomClosedBox" class="room-locked"><div class="rl-card"><div class="rl-ico"><i class="fa-solid fa-door-closed"></i></div><h2>This trading room is closed</h2><p>You no longer have access to this trading room. Your own account is not affected: you can still see your balance, details, statements and card.</p><button class="gate-btn" onclick="openTxAccountView()"><i class="fa-solid fa-table-columns"></i> Go to my account</button></div></div>`); }
  v40safe(() => {
    const view = v40El('txAccountView');
    if (view && !v40El('v40ClosedBanner')) { const sc = view.querySelector('.tx-scroll'); if (sc) sc.insertAdjacentHTML('beforebegin', '<div class="v40-closedbanner" id="v40ClosedBanner"><i class="fa-solid fa-door-closed"></i> Your trading room is closed. Your account stays fully available here.</div>'); }
    setTimeout(() => { try { openTxAccountView(); } catch (e) { /* ignore */ } }, 300);
  });
}
socket.on('init-state', (d) => { if (d && d.roomClosed) v40ClosedAccountUI(d.closedReason); });
const _closeViewV40 = closeTxAccountView;
closeTxAccountView = function () { if (window.__roomClosed) return; _closeViewV40(); };
