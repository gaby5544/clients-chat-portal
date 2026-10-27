// v3.11 client layer (additive - nothing in app.js / v31.js / v32.js / v38.js is removed).
//   1. Welcome tour: slide 5 "Partnered with Airwallex" (animated hero, skippable, swipe or scroll)
//   2. Seller: AIRWX virtual card page (not eligible -> contact Support; eligible -> apply, pay fee, wait, card)
//   3. Seller: incoming payments name the account they landed in, and the Receive page lists them with their stage
//   4. Desk: virtual-card switch per seller + issuing queue, and the receiving account shown when recording funds

// ====================================================================
// 1. Welcome tour - slide 5: Partnered with Airwallex
// ====================================================================
const AW_SERVICES = [
  ['Multi-currency business accounts', 'Hold and send money in multiple currencies, with local and international transfers and competitive FX rates.'],
  ['Payments', 'Accept payments from customers and make payments, domestically or internationally, via web and API.'],
  ['Treasury and spend management', 'Cards and expense tools, all in one place.'],
  ['Embedded finance', 'APIs that let other companies build financial features into their own products.']
];
const AW_WORD = 'Airwallex';
function awSlideHtml() {
  const chars = AW_WORD.split('').map((c, i) => `<span class="aw-ch" aria-hidden="true" style="animation-delay:${(i * 0.07).toFixed(2)}s">${c}</span>`).join('');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // typed once: every letter gets its own delay (title first, then its description), exactly like the supplied hero
  const split = (text, base, step) => {
    if (reduce) return { html: v38Esc(text), dur: 0 };
    let i = 0;
    const html = `<span class="aw-sr">${v38Esc(text)}</span>` + text.split(' ').map((w, wi, all) => {
      const letters = w.split('').map((c) => { const s = `<span class="aw-rvc" style="animation-delay:${(base + i * step).toFixed(3)}s">${v38Esc(c)}</span>`; i++; return s; }).join('');
      const out = `<span class="aw-w" aria-hidden="true">${letters}</span>${wi < all.length - 1 ? ' ' : ''}`; if (wi < all.length - 1) i++; return out;
    }).join('');
    return { html, dur: i * step };
  };
  const items = AW_SERVICES.map((s, k) => {
    const t0 = 2.2 + k * 1.5; const t = split(s[0], t0, 0.028); const d = split(s[1], t0 + t.dur * 0.6, 0.011);
    return `<div class="aw-it"><span class="aw-n">0${k + 1}</span><div><h3>${t.html}</h3><p>${d.html}</p></div></div>`;
  }).join('');
  return `<svg class="aw-bg" aria-hidden="true" viewBox="-450 -450 900 900" preserveAspectRatio="xMidYMid meet">
    <g class="aw-pulse"><circle cx="0" cy="0" r="190" fill="none" stroke="#2B3A78" stroke-width="1.5"/><circle cx="0" cy="0" r="290" fill="none" stroke="#223067" stroke-width="1.5"/><circle cx="0" cy="0" r="400" fill="none" stroke="#1A2554" stroke-width="1.5"/></g>
    <g class="aw-spin-a"><circle cx="0" cy="0" r="290" fill="none" stroke="#FF6A55" stroke-width="2" stroke-dasharray="2 38" stroke-linecap="round"/><circle cx="290" cy="0" r="7" fill="#FF6A55"/><circle cx="-145" cy="251" r="5" fill="#FFB4A8"/></g>
    <g class="aw-spin-b"><circle cx="0" cy="0" r="400" fill="none" stroke="#6C8CFF" stroke-width="2" stroke-dasharray="2 46" stroke-linecap="round"/><circle cx="0" cy="-400" r="6" fill="#6C8CFF"/><circle cx="400" cy="0" r="5" fill="#B9C8FF"/><circle cx="-283" cy="283" r="6" fill="#6C8CFF"/></g>
    <g><circle class="aw-dot" cx="-390" cy="-170" r="4" fill="#FF6A55"/><circle class="aw-dot" cx="390" cy="-190" r="3" fill="#6C8CFF" style="animation-delay:.8s"/><circle class="aw-dot" cx="400" cy="180" r="4" fill="#FF6A55" style="animation-delay:1.6s"/><circle class="aw-dot" cx="-400" cy="190" r="3" fill="#6C8CFF" style="animation-delay:2.2s"/><circle class="aw-dot" cx="220" cy="280" r="3" fill="#FFB4A8" style="animation-delay:1.1s"/><circle class="aw-dot" cx="-220" cy="-270" r="3" fill="#B9C8FF" style="animation-delay:.4s"/></g></svg>
  <div class="aw-inner">
    <div>
      <div class="aw-label">Partnered with</div>
      <h2 class="aw-word" aria-label="${AW_WORD}">${chars}</h2>
      <div class="aw-bar"><div class="aw-rule"></div><div class="aw-shine"></div></div>
      <div class="aw-svc">${items}</div>
    </div>
    <div class="aw-vwrap"><div class="aw-vcard" role="img" aria-label="Virtual card, Jane Madison, valid thru 02/30">
      <div class="aw-vtop"><div class="aw-vbadge">Virtual card</div>
        <svg aria-hidden="true" style="width:8cqw;height:8cqw" viewBox="0 0 28 28" fill="none" stroke="#C9D4F2" stroke-width="2" stroke-linecap="round"><path d="M8 9c3 3 3 7 0 10"/><path d="M13 6c5 5 5 11 0 16"/><path d="M18 3c7 7 7 15 0 22"/></svg></div>
      <div class="aw-vchip"></div>
      <div class="aw-vnum">&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; 2345</div>
      <div class="aw-vrow"><div><div class="aw-vlab">Cardholder</div><div class="aw-vval">Jane Madison</div></div><div><div class="aw-vlab">Valid thru</div><div class="aw-vval">02/30</div></div></div>
    </div></div>
  </div><div class="aw-fade" aria-hidden="true"></div>`;
}
// slide 5 joins the four existing ones (the shared helpers read INTRO.length and INTRO[i].c1/.c2)
if (typeof INTRO !== 'undefined' && !INTRO.some((s) => s.aw)) INTRO.push({ aw: true, img: '', c1: '#FF6A55', c2: '#6C8CFF', kicker: 'Partnered with Airwallex', title: AW_WORD, text: '' });
function awInject() {
  const track = document.getElementById('introTrack'); if (!track) return;
  let sec = track.querySelectorAll('.intro-slide')[INTRO.length - 1];
  if (!sec) { sec = document.createElement('section'); sec.className = 'intro-slide'; track.appendChild(sec); const dots = document.querySelector('.intro-dots'); if (dots) dots.insertAdjacentHTML('beforeend', `<i onclick="el('introTrack').scrollTo({left:${INTRO.length - 1}*el('introTrack').clientWidth,behavior:'smooth'})"></i>`); }
  if (sec.classList.contains('aw-slide')) return;
  sec.className = 'intro-slide aw-slide'; sec.style.cssText = '--c1:#FF6A55;--c2:#6C8CFF'; sec.innerHTML = awSlideHtml();
  sec.setAttribute('aria-label', 'Partnered with Airwallex');
  introSync();
}
const _showIntroV39 = showIntro;
showIntro = function () { _showIntroV39(); awInject(); };
const _introSyncV39 = introSync;
introSync = function () {
  _introSyncV39();
  const sec = document.querySelector('.aw-slide'); if (!sec) return;
  const act = sec.classList.contains('is-active');
  if (act && !sec.__wasActive) { if (sec.dataset.played) sec.classList.add('aw-done'); else sec.dataset.played = '1'; }   // typed in ONCE; coming back later shows them already typed
  sec.__wasActive = act;
};
v38safe(() => { if (document.getElementById('appIntro')) awInject(); });                    // intro opened before this file loaded

// ====================================================================
// 2. Seller: AIRWX virtual card
// ====================================================================
let cdData = null, cdLoaded = false, cdReveal = null, cdTimer = 0, cdBusy = false, cdMsg = '';
function cdRequest() { if (typeof activeGroupId !== 'undefined' && activeGroupId && isSellerUI()) socket.emit('get-my-card', { groupId: activeGroupId }); }
socket.on('my-card', (d) => { cdData = d || { eligible: false }; cdLoaded = true; cdBusy = false; if (!(cdData.card && !cdData.card.frozen)) cdHide(); renderCardPage(); renderCardTile(); });
socket.on('card-result', (r) => { cdBusy = false; cdMsg = r && !r.ok ? (r.error || 'Something went wrong. Please try again.') : ''; renderCardPage(); });
socket.on('card-reveal', (c) => {
  cdReveal = c; let left = 30; clearInterval(cdTimer);
  cdTimer = setInterval(() => { left--; const t = document.getElementById('cdCount'); if (t) t.textContent = left + 's'; if (left <= 0) cdHide(); }, 1000);
  renderCardPage();
});
function cdHide() { cdReveal = null; clearInterval(cdTimer); renderCardPage(); }
socket.on('seller-account-state', () => setTimeout(() => {
  if (!isSellerUI()) return;
  const onCard = document.getElementById('txPageCard') && !document.getElementById('txPageCard').classList.contains('hidden');
  if (!cdLoaded || (onCard && cdData && cdData.eligible && cdData.status === 'awaiting_fee')) cdRequest();   // balance may have changed (a deposit was credited)
}, 50));

v38safe(() => {
  const view = document.getElementById('txAccountView'); if (!view) return;
  const nav = view.querySelector('.tx-nav');
  if (nav && !nav.querySelector('[data-txnav="card"]')) {
    const b = document.createElement('button'); b.className = 'tx-nav-item'; b.dataset.txnav = 'card'; b.onclick = () => setTxAccountNav('card');
    b.innerHTML = '<i class="fa-regular fa-credit-card"></i> Card';
    const tr = nav.querySelector('[data-txnav="transactions"]'); nav.insertBefore(b, tr || null);
  }
  const scroll = view.querySelector('.tx-scroll');
  if (scroll && !document.getElementById('txPageCard')) scroll.insertAdjacentHTML('beforeend', '<div class="tx-page hidden" id="txPageCard"><div id="txCardBody"></div></div>');
  TX_NAV_TITLES.card = ['Card', 'Your AIRWX Visa virtual card.'];
  const dash = document.getElementById('txPageDashboard'), row = document.getElementById('txActionRow');
  if (dash && !document.getElementById('txCardTile')) {
    const tile = `<button type="button" class="cd-tile" id="txCardTile" onclick="setTxAccountNav('card')"><span class="cd-tile-ic"><i class="fa-regular fa-credit-card"></i></span><span class="cd-tile-tx"><b>AIRWX virtual card</b><small id="txCardTileSub">Visa</small></span><i class="fa-solid fa-chevron-right"></i></button>`;
    if (row) row.insertAdjacentHTML('afterend', tile); else dash.insertAdjacentHTML('afterbegin', tile);
  }
});
const _navV39 = setTxAccountNav;
setTxAccountNav = function (nav) {
  _navV39(nav);
  document.querySelectorAll('#txBottomNav [data-bn]').forEach((b) => b.classList.toggle('active', b.dataset.bn === nav));
  if (nav === 'card') { renderCardPage(); cdRequest(); }
  if (nav === 'accounts') renderAccountsPage();
};
function renderCardTile() {
  const s = document.getElementById('txCardTileSub'); if (!s || !cdData) return;
  const st = cdData.status;
  s.textContent = !cdData.eligible ? 'Visa' : st === 'issued' ? 'Active · ending ' + (cdData.card ? cdData.card.last4 : '') : st === 'processing' ? 'Being generated' : st === 'awaiting_fee' ? 'Pay the fee to continue' : st === 'frozen' ? 'Frozen' : 'Apply now';
}
function cdFace(opt) {
  const o = opt || {}; const num = o.pan ? o.pan.replace(/(\d{4})(?=\d)/g, '$1 ') : `•••• •••• •••• ${o.last4 || '••••'}`;
  const exp = o.expMonth ? `${String(o.expMonth).padStart(2, '0')}/${String(o.expYear).slice(-2)}` : '••/••';
  return `<div class="cd-face ${o.frozen ? 'frozen' : ''} ${o.ghost ? 'ghost' : ''}" translate="no">
    <div class="cd-top"><span class="cd-prog">AIRWX</span><span class="cd-type">Virtual card</span></div>
    <div class="cd-chip"></div>
    <div class="cd-num">${v38Esc(num)}</div>
    <div class="cd-row"><div><small>Cardholder</small><b>${v38Esc((o.holder || '').toUpperCase() || '—')}</b></div><div><small>Valid thru</small><b>${exp}</b></div>${o.cvv ? `<div><small>CVV</small><b>${v38Esc(o.cvv)}</b></div>` : ''}<span class="cd-visa">VISA</span></div>
    ${o.frozen ? '<div class="cd-frost"><i class="fa-solid fa-snowflake"></i> Frozen</div>' : ''}</div>`;
}
function cdSteps(at) {
  const L = ['Apply', 'Pay fee', 'Card generated', 'Ready to use'];
  return `<ol class="cd-steps">${L.map((t, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span>${i < at ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>${t}</li>`).join('')}</ol>`;
}
function cdRows(rows) { return `<div class="cd-info">${rows.map((r) => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div>`; }
function renderCardPage() {
  const host = document.getElementById('txCardBody'); if (!host) return;
  const a = (typeof sellerAccountState !== 'undefined' && sellerAccountState) || {};
  if (!cdLoaded) { host.innerHTML = '<div class="rc-wrap"><div class="rc-skel"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div></div>'; return; }
  const d = cdData || { eligible: false };
  // Not eligible: say so, point to Support, and show nothing else.
  if (!d.eligible) {
    host.innerHTML = `<div class="rc-wrap"><div class="rc-lock"><div class="ic"><i class="fa-regular fa-credit-card"></i></div><h3>Virtual card not available</h3>
      <p>Your account is not eligible for a virtual card at the moment. Please contact Support if you would like to know more.</p>
      <button class="send-btn" onclick="openSupportModal()"><i class="fa-solid fa-headset"></i> Contact Support</button></div></div>`;
    return;
  }
  const ccy = d.fee.currency, feeTxt = fmtMoney(d.fee.amount, ccy), usdTxt = `${d.fee.usd} USD`;
  const err = cdMsg ? `<div class="gate-msg" role="alert" style="margin:10px 0 0">${v38Esc(cdMsg)}</div>` : '';
  const spin = cdBusy ? '<i class="fa-solid fa-spinner fa-spin"></i> ' : '';
  let body = '';
  if (d.status === 'issued' || d.status === 'frozen') {
    const c = d.card || {}, frozen = d.status === 'frozen';
    body = `${cdFace({ last4: c.last4, expMonth: c.expMonth, expYear: c.expYear, holder: c.holder, frozen, pan: cdReveal && cdReveal.pan, cvv: cdReveal && cdReveal.cvv })}
      <div class="cd-actions">${frozen ? `<div class="cd-note"><i class="fa-solid fa-snowflake"></i> This card is frozen. Please contact Support.</div><button class="send-btn" onclick="openSupportModal()"><i class="fa-solid fa-headset"></i> Contact Support</button>`
        : cdReveal ? `<button class="admin-btn" onclick="cdHide()"><i class="fa-solid fa-eye-slash"></i> Hide details</button><span class="cd-count">Hides in <b id="cdCount">30s</b></span>`
        : `<button class="send-btn" onclick="cdShow()"><i class="fa-solid fa-eye"></i> Show card details</button>`}</div>
      ${cdRows([['Card', 'AIRWX Visa virtual card'], ['Status', frozen ? 'Frozen' : 'Active'], ['Issued', c.issuedAt ? fmtDate(c.issuedAt) : '—'], ['Issuing fee paid', `${feeTxt} (${usdTxt})`]])}
      <p class="cd-small"><i class="fa-solid fa-lock"></i> Your full card number and security code are only shown when you ask, and are hidden again after 30 seconds.</p>`;
  } else if (d.status === 'processing') {
    body = `${cdFace({ holder: d.holder, ghost: true })}${cdSteps(2)}
      <div class="cd-wait"><div class="cd-orbit"><i></i><i></i><i></i></div><h3>We are generating your card</h3><p>Your issuing fee was received. Our team is generating your AIRWX Visa virtual card now. You can leave this page; we will email you as soon as it is ready.</p></div>
      ${cdRows([['Issuing fee paid', `${feeTxt} (${usdTxt})`], ['Reference', v38Esc(d.fee.ref || '—')]])}`;
  } else if (d.status === 'awaiting_fee') {
    body = `${cdFace({ holder: d.holder, ghost: true })}${cdSteps(1)}
      ${cdRows([['One-time issuing fee', `${feeTxt} <em>(${usdTxt})</em>`], ['Your available balance', fmtMoney(d.balance.available, ccy)]])}
      ${d.balance.enough ? `<button class="send-btn cd-wide" ${cdBusy ? 'disabled' : ''} onclick="cdPay()">${spin}<i class="fa-solid fa-credit-card"></i> Pay ${feeTxt} from my balance</button>`
        : `<div class="cd-note"><i class="fa-solid fa-circle-info"></i> Your balance is ${fmtMoney(d.balance.short, ccy)} short of the issuing fee. Add funds, then come back to pay.</div><button class="send-btn cd-wide" onclick="openTxDepositModal()"><i class="fa-solid fa-paper-plane"></i> Add funds</button>`}
      <p class="cd-small">The fee is taken from your available balance. Your card is generated after the fee is received.</p>${err}`;
  } else {
    const declined = d.status === 'declined';
    body = `${cdFace({ holder: d.holder || a.fullName, ghost: true })}${cdSteps(0)}
      ${declined ? `<div class="cd-note bad"><i class="fa-solid fa-circle-xmark"></i> Your last application was not approved${d.declinedReason ? ': ' + v38Esc(d.declinedReason) : ''}. Any fee you paid was returned to your balance.</div>` : ''}
      ${cdRows([['Card', 'AIRWX Visa virtual card'], ['One-time issuing fee', `${feeTxt} <em>(${usdTxt})</em>`], ['Your available balance', fmtMoney(d.balance.available, ccy)]])}
      ${d.verified ? `<button class="send-btn cd-wide" ${cdBusy ? 'disabled' : ''} onclick="cdApply(${d.balance.enough})">${spin}<i class="fa-solid fa-circle-check"></i> ${declined ? 'Apply again' : 'Apply for my card'}</button>` : `<div class="cd-note"><i class="fa-solid fa-id-card"></i> Please verify your identity first.</div><button class="send-btn cd-wide" onclick="openTxKycWizard()">Verify identity</button>`}
      <p class="cd-small">${d.balance.enough ? 'Applying also pays the issuing fee from your available balance.' : 'You can apply now and pay the issuing fee when your balance covers it.'}</p>${err}`;
  }
  host.innerHTML = `<div class="cd-wrap">${body}</div>`;
}
function cdApply(payNow) { if (cdBusy) return; cdBusy = true; cdMsg = ''; renderCardPage(); socket.emit('apply-virtual-card', { groupId: activeGroupId, payNow: !!payNow }); }
function cdPay() { if (cdBusy) return; cdBusy = true; cdMsg = ''; renderCardPage(); socket.emit('pay-card-fee', { groupId: activeGroupId }); }
function cdShow() { socket.emit('reveal-card', { groupId: activeGroupId }); }
// the issuing fee appears in Statements as a debit
function cardFeeRows() {
  if (!cdData || !cdData.eligible || !cdData.fee || !cdData.fee.paid) return [];
  return [{ at: cdData.fee.paidAt, type: 'Card fee', ref: cdData.fee.ref || '', desc: 'AIRWX virtual card issuing fee', amount: cdData.fee.amount, ccy: cdData.fee.currency, status: cdData.status === 'declined' ? 'Refunded' : 'Paid', sign: -1 }];
}
socket.on('my-card', () => { if (typeof renderStatements === 'function' && document.getElementById('txPageStatements') && !document.getElementById('txPageStatements').classList.contains('hidden')) renderStatements(); });

// ====================================================================
// 3. Incoming payments <-> the account they land in
// ====================================================================
// v3.13: the account is identified by its account number once bank details exist, otherwise by the Account ID
function rcIdLabel(a) {
  a = a || {};
  try {
    if (typeof rcData !== 'undefined' && rcData && rcData.ready && rcData.details && rcData.currency) {
      const d = rcData.details[rcData.currency]; const rows = [].concat((d && d.a) || [], (d && d.b) || []);
      const hit = rows.find((r) => /^(account number|iban)$/i.test(r[0]));
      if (hit) { const t = String(hit[1]).replace(/[^0-9A-Za-z]/g, ''); return `${/iban/i.test(hit[0]) ? 'IBAN' : 'Account number'} \u2022\u2022${t.slice(-4)}`; }
    }
  } catch (e) { /* fall back to the Account ID */ }
  return `Account ID ${a.accountId || ''}`.trim();
}
function rcIncomingHtml() {
  const list = (typeof sellerIncoming !== 'undefined' ? sellerIncoming : []).slice(0, 5);
  const a = sellerAccountState || {};
  const rows = list.map((i) => {
    let st = i.status === 'credited' ? 'Credited' : i.status === 'reversed' ? 'Reversed' : 'In verification';
    if (i.track && i.status === 'held_in_vault') {
      const cur = (i.track.stages || []).find((s) => s.status === 'in_review');
      st = i.track.complete ? 'Verified, awaiting release' : cur ? `Stage ${cur.n} of ${i.track.stages.length} · ${cur.title}` : st;
    }
    return `<div class="rc-in"><div><b>${v38Esc(i.payerName)}</b><small>${v38Esc(i.ref)} · ${v38Esc(i.receivedInto ? i.receivedInto.label : (a.currency || '') + ' account')}</small></div><div class="rc-in-r"><b>+${v38Esc(fmtMoney(i.sellerReceives != null ? i.sellerReceives : i.amount, i.amountCurrency))}</b><span>${v38Esc(st)}</span></div></div>`;
  }).join('');
  return `<div class="rc-wrap rc-incoming" id="rcIncoming"><div class="rc-gt"><span>Incoming to <span translate="no">${v38Esc(rcIdLabel(a))}</span></span></div>${rows || '<p class="rc-empty">No incoming payments yet. When a payment is recorded for you it appears here and moves through the verification stages.</p>'}</div>`;
}
const _renderAccV39 = renderAccountsPage;
renderAccountsPage = function () {
  _renderAccV39();
  const host = document.getElementById('txAccountsBody');
  if (host && rcData && rcData.approved && rcData.ready && !document.getElementById('rcIncoming')) host.insertAdjacentHTML('beforeend', rcIncomingHtml());
};
socket.on('incoming-list', () => { if (document.getElementById('rcIncoming')) renderAccountsPage(); });

// ====================================================================
// 4. Desk (admin)
// ====================================================================
let cardQ = { list: [], eligible: [], fee: 20 };
socket.on('card-queue', (d) => { cardQ = d || cardQ; renderCardAdmin(); });
socket.on('card-queue-dirty', () => socket.emit('admin-get-card-queue'));
socket.on('auto-email-state', () => socket.emit('admin-get-card-queue'));
const CD_ST = { awaiting_fee: 'Waiting for the fee', processing: 'Fee paid - generate the card', frozen: 'Frozen', issued: 'Issued', declined: 'Declined', none: 'No application' };
function cdIssueForm(a) {
  return `<div class="cdq-form"><div class="bk-grid">
    <label>Card number (16 digits)<input class="message-input" data-ci="${a.groupId}.pan" inputmode="numeric" autocomplete="off" maxlength="19" placeholder="4xxx xxxx xxxx xxxx" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/(.{4})/g,'$1 ').trim()"></label>
    <label>Expiry month<input class="message-input" data-ci="${a.groupId}.expMonth" inputmode="numeric" maxlength="2" placeholder="MM"></label>
    <label>Expiry year<input class="message-input" data-ci="${a.groupId}.expYear" inputmode="numeric" maxlength="4" placeholder="YY"></label>
    <label>CVV<input class="message-input" data-ci="${a.groupId}.cvv" inputmode="numeric" autocomplete="off" maxlength="3" placeholder="3 digits"></label>
    <label>Name on card<input class="message-input" data-ci="${a.groupId}.holder" value="${v38Esc((a.sellerName || '').toUpperCase())}" placeholder="Cardholder"></label></div>
    <div class="cdq-btns"><button class="send-btn" onclick="cdIssue('${a.groupId}')"><i class="fa-solid fa-credit-card"></i> Issue card</button>
    <button class="admin-btn admin-btn-danger" onclick="cdDecline('${a.groupId}')"><i class="fa-solid fa-xmark"></i> Decline &amp; refund fee</button></div></div>`;
}
function cdIssue(gid) {
  const f = {}; document.querySelectorAll(`[data-ci^="${gid}."]`).forEach((i) => { f[i.dataset.ci.split('.')[1]] = i.value.trim(); });
  socket.emit('admin-issue-card', { groupId: gid, pan: f.pan, expMonth: f.expMonth, expYear: f.expYear, cvv: f.cvv, holder: f.holder });
}
function cdDecline(gid) { const r = prompt('Reason shown to the seller (optional). Any fee they paid is returned in full.', ''); if (r === null) return; socket.emit('admin-decline-card', { groupId: gid, reason: r }); }
function renderCardAdmin() {
  const host = document.getElementById('tabControls'); if (!host) return;
  const open = cardQ.list.filter((a) => a.status === 'processing').length;
  const rows = cardQ.list.map((a) => `<div class="cdq-row"><div class="cdq-top"><b>${v38Esc(a.sellerName)}</b><span class="sup-tag" translate="no">${v38Esc(a.accountId || '')}</span><span class="cdq-st ${a.status}">${CD_ST[a.status] || a.status}</span></div>
    <small>${a.fee.paid ? `Fee ${v38Esc(fmtMoney(a.fee.amount, a.fee.currency))} paid · ${v38Esc(a.fee.ref || '')}` : 'Fee not paid yet'} · applied ${a.appliedAt ? v38Esc(new Date(a.appliedAt).toLocaleString()) : ''}</small>
    ${a.status === 'processing' ? cdIssueForm(a) : a.status === 'frozen' ? `<div class="cdq-btns"><button class="admin-btn" onclick="socket.emit('admin-freeze-card',{groupId:'${a.groupId}',frozen:false})">Unfreeze</button></div>` : ''}</div>`).join('');
  const chips = cardQ.eligible.map((e) => `<span class="cdq-chip">${v38Esc(e.sellerName)}</span>`).join('');
  const html = `<div class="ctrl-row" style="margin-bottom:6px"><div><b><i class="fa-regular fa-credit-card"></i> AIRWX virtual cards ${open ? `<span class="sup-badge">${open} to generate</span>` : ''}</b><small>Sellers are NOT eligible by default. Switch a seller on from their profile (Virtual card). After they apply and pay the ${cardQ.fee} USD fee, enter the card your issuer generated here. The number and CVV are stored encrypted and only the owner can reveal them.</small></div></div>
    ${rows || '<p class="ledger-empty">No applications waiting.</p>'}
    <div class="cdq-elig"><small>Eligible sellers (${cardQ.eligible.length})</small><div>${chips || '<em>None yet</em>'}</div></div>`;
  let box = document.getElementById('cardsBox');
  if (!box) host.insertAdjacentHTML('afterbegin', `<div class="widget-card" id="cardsBox">${html}</div>`); else box.innerHTML = html;
}
// per-seller switch inside the seller profile
socket.on('seller-profile', ({ groupId }) => {
  setTimeout(() => {
    const body = document.getElementById('spBody'); if (!body || document.getElementById('sellerProfileModal').classList.contains('hidden')) return;
    if (!document.getElementById('spCard')) body.insertAdjacentHTML('beforeend', '<div class="widget-card" id="spCard" style="margin-top:12px"><p class="ledger-empty">Loading virtual card…</p></div>');
    socket.emit('admin-get-card', { groupId });
  }, 90);
});
socket.on('admin-card', (d) => {
  const box = document.getElementById('spCard'); if (box && d) {
    box.innerHTML = `<div class="ctrl-row"><div><b><i class="fa-regular fa-credit-card"></i> AIRWX virtual card</b><small>Status: ${CD_ST[d.status] || d.status}${d.last4 ? ' · ending ' + v38Esc(d.last4) : ''}${d.reveals ? ' · revealed ' + d.reveals + '×' : ''}. Off by default: the seller sees "not eligible - contact Support".</small>
      </div></div><label class="terms-check" style="margin:8px 0"><input type="checkbox" ${d.eligible ? 'checked' : ''} onchange="socket.emit('admin-set-card-eligible',{groupId:'${d.groupId}',eligible:this.checked})"> <span>Eligible for the AIRWX virtual card (the seller can apply once this is on)</span></label>
      ${['issued', 'frozen'].includes(d.status) ? `<div class="cdq-btns"><button class="admin-btn" onclick="socket.emit('admin-freeze-card',{groupId:'${d.groupId}',frozen:${d.status !== 'frozen'}})"><i class="fa-solid fa-snowflake"></i> ${d.status === 'frozen' ? 'Unfreeze card' : 'Freeze card'}</button></div>` : ''}
      ${d.status === 'processing' ? cdIssueForm(d) : ''}`;
  }
  socket.emit('admin-get-card-queue');
});
// recording funds: show exactly which account the payment lands in, and whether the payer's reference matches
let rfRecv = null;
socket.on('admin-seller-receiving', (d) => { rfRecv = d || null; renderRfStrip(); });
const _openRfV39 = typeof openRecordFundsModal === 'function' ? openRecordFundsModal : null;
if (_openRfV39) openRecordFundsModal = function () {
  _openRfV39(); rfRecv = null;
  const m = document.getElementById('recordFundsModal'); const body = m && (m.querySelector('.modal-body') || m.querySelector('.modal-box'));
  if (body && !document.getElementById('rfStrip')) body.insertAdjacentHTML('afterbegin', '<div class="rf-strip" id="rfStrip"></div>');
  const strip = document.getElementById('rfStrip'); if (strip) strip.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking the seller’s receiving account…';
  if (typeof fundsDeskGroupId !== 'undefined' && fundsDeskGroupId) socket.emit('admin-get-seller-receiving', { groupId: fundsDeskGroupId });
  ['rfCurrency', 'rfExternalRef'].forEach((id) => { const e = document.getElementById(id); if (e && !e.dataset.v39) { e.dataset.v39 = '1'; e.addEventListener('input', renderRfStrip); e.addEventListener('change', renderRfStrip); } });
};
function renderRfStrip() {
  const strip = document.getElementById('rfStrip'); if (!strip || !rfRecv || !rfRecv.snapshot) return;
  const s = rfRecv.snapshot, cur = (document.getElementById('rfCurrency') || {}).value, ref = ((document.getElementById('rfExternalRef') || {}).value || '').replace(/[\s-]/g, '');
  const lines = [`<div><i class="fa-solid fa-building-columns"></i> Pays into <b translate="no">${v38Esc(s.label || 'the seller account')}</b> · Account ID <b translate="no">${v38Esc(s.accountId || '—')}</b>${s.bankName ? ' · ' + v38Esc(s.bankName) : ''}</div>`];
  if (!s.ready) lines.push('<div class="warn"><i class="fa-solid fa-triangle-exclamation"></i> No receiving account is set for this currency yet (Controls → Receiving accounts).</div>');
  if (cur && s.currency && cur !== s.currency) lines.push(`<div class="warn"><i class="fa-solid fa-right-left"></i> The seller’s account is in ${v38Esc(s.currency)}; this payment will be converted.</div>`);
  const byNo = !!(s.ready && s.source === 'seller' && s.accountNumber && s.accountNumber.length >= 6 && ref.toUpperCase().includes(String(s.accountNumber).toUpperCase()));
  if (s.ready) lines.push(`<div><i class="fa-solid fa-hashtag"></i> Identified by <b translate="no">${v38Esc(s.idLabel || '')}</b>${s.source === 'seller' ? ' (the seller’s own account)' : ' · the payer quotes the seller’s Account ID as the reference'}</div>`);
  else lines.push('<div><i class="fa-solid fa-fingerprint"></i> No bank details yet, so this payment is identified by the Account ID <b translate="no">' + v38Esc(s.accountId || '—') + '</b>.</div>');
  if (ref && s.accountId) lines.push(ref.includes(String(s.accountId)) ? '<div class="good"><i class="fa-solid fa-circle-check"></i> The reference contains the seller’s Account ID.</div>' : byNo ? '<div class="good"><i class="fa-solid fa-circle-check"></i> The reference contains the seller’s account number.</div>' : '<div class="warn"><i class="fa-solid fa-triangle-exclamation"></i> The reference does not contain the seller’s ' + (s.source === 'seller' ? 'Account ID or account number' : 'Account ID') + '. Check it against the payer before crediting.</div>');
  strip.innerHTML = lines.join('');
}
