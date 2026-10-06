/* Quantum Secure Transaction Desk v3.1 — shared UI helpers.
   Loaded after app.js. Money/date formatting, flags, the searchable country picker, popups,
   language picker, terms viewer, and the client side of automatic notifications
   (activity reporting, 3-beep alerts, read receipts). */

// ---------------- Money & dates ----------------
const CCY_SYMBOL = { USD: '$', GBP: '£', EUR: '€' };
const _moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** $2,000,000.00 — full digit grouping, always two decimals, in every language. */
function fmtMoney(amount, ccy) {
  const n = Number(amount || 0);
  const body = _moneyFmt.format(Number.isFinite(n) ? n : 0);
  return CCY_SYMBOL[ccy] ? `${CCY_SYMBOL[ccy]}${body}` : `${body}${ccy ? ' ' + ccy : ''}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p2 = (x) => String(x).padStart(2, '0');
  return d ? `${d}d ${p2(h)}:${p2(m)}:${p2(s)}` : h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}
function copyText(text, okMsg) {
  const done = () => toast(okMsg || 'Copied.');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Could not copy.', true));
  else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy.', true); } t.remove(); }
}
function maskMiddle(s, keepStart = 6, keepEnd = 4) {
  s = String(s || '');
  return s.length <= keepStart + keepEnd + 2 ? s : `${s.slice(0, keepStart)}…${s.slice(-keepEnd)}`;
}
/** A toast whose text is already in the user's language (server-localised) — never machine-translated again. */
function toastRaw(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast notranslate' + (isError ? ' error' : '');
  t.setAttribute('translate', 'no');
  t.textContent = msg;
  el('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 6500);
}

// ---------------- Flags ----------------
function flagHtml(code, cls = '') {
  if (!code) return '';
  const lc = String(code).toLowerCase();
  const emoji = window.COUNTRY_DATA.flagEmoji(code);
  return `<img class="flag ${cls}" src="https://flagcdn.com/w40/${lc}.png" srcset="https://flagcdn.com/w80/${lc}.png 2x" alt="" loading="lazy" data-fb="${emoji}" translate="no">`;
}
function countryLine(countryName) {
  const c = window.COUNTRY_DATA.find(countryName);
  if (!c) return escapeHtml(countryName || '—');
  return `<span class="country-line notranslate" translate="no">${flagHtml(c.c)} ${escapeHtml(c.n)}</span>`;
}
// If the flag image cannot load (offline / blocked CDN) fall back to the emoji flag.
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList.contains('flag') && t.dataset.fb) {
    const s = document.createElement('span');
    s.className = 'flag-emoji';
    s.textContent = t.dataset.fb;
    t.replaceWith(s);
  }
}, true);

// ---------------- Password eye ----------------
function togglePw(inputId, btn) {
  const inp = el(inputId);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  if (btn) btn.innerHTML = `<i class="fa-regular ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
  if (btn) btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

// ---------------- Searchable, scrollable country picker ----------------
function mountCountryPicker(root, opts = {}) {
  const CD = window.COUNTRY_DATA;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const placeholder = opts.placeholder || 'Select country';
  root.classList.add('cp');
  root.innerHTML = `
    <button type="button" class="cp-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="cp-flag"></span><span class="cp-label placeholder">${escapeHtml(placeholder)}</span><i class="fa-solid fa-chevron-down cp-chev"></i>
    </button>
    <div class="cp-panel hidden">
      <input class="cp-search" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search country or dial code…" name="cp-search-${Math.random().toString(36).slice(2)}">
      <div class="cp-list" role="listbox"></div>
    </div>`;
  const trigger = root.querySelector('.cp-trigger'), panel = root.querySelector('.cp-panel');
  const search = root.querySelector('.cp-search'), list = root.querySelector('.cp-list');
  const flagBox = root.querySelector('.cp-flag'), label = root.querySelector('.cp-label');
  let selected = null, filtered = CD.list.slice(), active = 0, changeCb = opts.onChange || null;

  function paint() {
    if (selected) {
      flagBox.innerHTML = flagHtml(selected.c);
      label.textContent = opts.showDial ? `${selected.n} (${selected.d})` : selected.n;
      label.classList.remove('placeholder');
    } else {
      flagBox.innerHTML = '<i class="fa-solid fa-earth-africa" style="color:var(--text-faint)"></i>';
      label.textContent = placeholder; label.classList.add('placeholder');
    }
  }
  function renderList() {
    if (!filtered.length) { list.innerHTML = '<div class="cp-empty">No matching country</div>'; return; }
    list.innerHTML = filtered.map((c, i) =>
      `<div class="cp-item${i === active ? ' active' : ''}${selected && selected.c === c.c ? ' selected' : ''}" role="option" data-i="${i}" translate="no">${flagHtml(c.c)}<span>${escapeHtml(c.n)}</span><span class="cp-dial">${escapeHtml(c.d)}</span></div>`).join('');
    const act = list.querySelector('.cp-item.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }
  function applyFilter() {
    const q = norm(search.value).trim();
    if (!q) { filtered = CD.list.slice(); }
    else {
      const digits = q.replace(/[^\d+]/g, '');
      const scored = [];
      CD.list.forEach((c) => {
        const n = norm(c.n);
        let r = -1;
        if (n === q || norm(c.c) === q) r = 0;
        else if (n.startsWith(q)) r = 1;
        else if (n.split(/[\s\-(]+/).some((w) => w.startsWith(q))) r = 2;
        else if (n.includes(q)) r = 3;
        else if (digits.length >= 1 && (/^\+?\d/.test(q)) && c.d.replace('+', '').startsWith(digits.replace('+', ''))) r = 4;
        if (r >= 0) scored.push([r, c]);
      });
      scored.sort((a, b) => a[0] - b[0] || a[1].n.localeCompare(b[1].n));
      filtered = scored.map((x) => x[1]);
    }
    active = 0; renderList();
  }
  function open(prefill) {
    if (!panel.classList.contains('hidden')) return;
    panel.classList.remove('hidden'); trigger.classList.add('open'); trigger.setAttribute('aria-expanded', 'true');
    const r = root.getBoundingClientRect();
    const below = window.innerHeight - r.bottom, above = r.top;
    panel.classList.toggle('up', below < 330 && above > below);
    search.value = prefill || '';
    applyFilter();
    if (selected && !prefill) { const i = filtered.findIndex((c) => c.c === selected.c); if (i >= 0) { active = i; renderList(); } }
    setTimeout(() => search.focus(), 0);
  }
  function close() {
    panel.classList.add('hidden'); trigger.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false');
  }
  function choose(c) {
    selected = c; paint(); close();
    root.closest('.fld')?.classList.remove('has-error');
    if (changeCb) changeCb(c);
    trigger.focus();
  }
  trigger.addEventListener('click', () => (panel.classList.contains('hidden') ? open() : close()));
  trigger.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1 && e.key !== ' ') { e.preventDefault(); open(e.key); }
    else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  search.addEventListener('input', applyFilter);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(filtered.length - 1, active + 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); renderList(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); }
    else if (e.key === 'Tab') close();
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const it = e.target.closest('.cp-item'); if (it) choose(filtered[Number(it.dataset.i)]); });
  document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) close(); });
  paint();
  return {
    el: root,
    getCountry: () => selected,
    getValue: () => (selected ? selected.n : ''),
    setValue(v) { selected = v ? CD.find(v) : null; paint(); if (changeCb) changeCb(selected); },
    clear() { selected = null; paint(); close(); },
    onChange(fn) { changeCb = fn; },
    focus: () => trigger.focus()
  };
}

// ---------------- Generic popup ----------------
let _popupActions = [];
let _popupDismiss = null;
function showPopup({ icon = 'fa-circle-info', tone = 'info', title = '', body = '', facts = null, actions = [], dismissible = true, onClose = null }) {
  const box = el('popupBody');
  _popupActions = actions;
  _popupDismiss = onClose;
  box.innerHTML = `
    <div class="pop-icon ${tone}"><i class="fa-solid ${icon}"></i></div>
    <div class="pop-title">${escapeHtml(title)}</div>
    <div class="pop-body">${escapeHtml(body).replace(/\n/g, '<br>')}</div>
    ${facts ? `<div class="pop-facts">${facts.map(([k, v]) => `<div><span>${escapeHtml(k)}</span><b class="notranslate" translate="no">${escapeHtml(v)}</b></div>`).join('')}</div>` : ''}
    <div class="pop-actions">${actions.map((a, i) => `<button type="button" class="${a.primary ? 'send-btn' : a.danger ? 'admin-btn admin-btn-danger' : 'ghost-btn'}" data-pa="${i}">${a.icon ? `<i class="fa-solid ${a.icon}"></i> ` : ''}${escapeHtml(a.label)}</button>`).join('')}</div>`;
  el('popupClose').style.display = dismissible ? '' : 'none';
  el('popupModal').classList.remove('hidden');
}
function closePopup() {
  el('popupModal').classList.add('hidden');
  const cb = _popupDismiss; _popupDismiss = null;
  if (cb) cb();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pa]');
  if (!b || !el('popupModal') || el('popupModal').classList.contains('hidden')) return;
  const a = _popupActions[Number(b.dataset.pa)];
  if (!a) return;
  if (!a.keepOpen) { _popupDismiss = null; el('popupModal').classList.add('hidden'); }
  if (a.onClick) a.onClick();
});

// ---------------- Terms viewer ----------------
function openTerms() {
  const L = window.LEGAL_DATA;
  el('termsViewer').innerHTML = `<div class="terms-meta">Version ${escapeHtml(L.version)} · Updated ${escapeHtml(L.updated)}</div>
    <p>${escapeHtml(L.intro)}</p>
    ${L.sections.map((s) => `<h4>${escapeHtml(s.h)}</h4>${s.p.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}`).join('')}`;
  el('termsViewer').scrollTop = 0;
  el('termsModal').classList.remove('hidden');
}
function acceptTermsFromViewer() {
  const cb = el('rgTerms');
  if (cb) { cb.checked = true; cb.closest('.fld')?.classList.remove('has-error'); }
  closeModal('termsModal');
}

// ---------------- Language picker (always reachable: globe buttons in the chat header and the dashboard) ----------------
function openLanguagePicker() {
  el('langSearch').value = '';
  renderLanguageList('');
  el('langModal').classList.remove('hidden');
  setTimeout(() => el('langSearch').focus(), 50);
}
function renderLanguageList(q) {
  const cur = window.Xlate ? Xlate.lang : 'en';
  const needle = String(q || '').toLowerCase().trim();
  const items = window.LANG_DATA.list.filter((l) => !needle || l.n.toLowerCase().includes(needle) || l.e.toLowerCase().includes(needle) || l.c.toLowerCase() === needle);
  el('langList').innerHTML = items.length ? items.map((l) =>
    `<button type="button" class="lang-item notranslate${l.c === cur ? ' sel' : ''}" translate="no" data-lang="${l.c}"><b>${escapeHtml(l.n)}</b><small>${escapeHtml(l.e)}</small></button>`).join('')
    : '<p class="ledger-empty" style="grid-column:1/-1">No matching language</p>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.lang-item');
  if (!b || !el('langModal') || el('langModal').classList.contains('hidden')) return;
  Xlate.setLanguage(b.dataset.lang, { persist: true });
  closeModal('langModal');
});

// ---------------- Automatic notifications — client side ----------------
const Notif = (() => {
  let ctx = null;
  function unlock() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* audio unavailable */ }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));
  // A short two-tone chime, repeated `times` times (the spec: sound 3 times when the person is not active).
  function chime(times = 3) {
    unlock();
    if (navigator.vibrate) { try { navigator.vibrate([180, 90, 180, 90, 180]); } catch (e) { /* ignore */ } }
    if (!ctx || ctx.state !== 'running') return false;
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < times; i++) {
      [[880, 0], [1318.5, 0.14]].forEach(([freq, off]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        const s = t0 + i * 0.62 + off;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.28, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.34);
        o.connect(g); g.connect(ctx.destination);
        o.start(s); o.stop(s + 0.36);
      });
    }
    return true;
  }
  let flashTimer = null, baseTitle = document.title;
  function flashTitle(text) {
    if (flashTimer) return;
    baseTitle = document.title;
    let on = false;
    flashTimer = setInterval(() => { on = !on; document.title = on ? `● ${text}` : baseTitle; }, 900);
  }
  function stopFlash() { if (flashTimer) { clearInterval(flashTimer); flashTimer = null; document.title = baseTitle; } }
  return { chime, flashTitle, stopFlash, unlock };
})();

function isPageActive() { return document.visibilityState === 'visible' && document.hasFocus(); }

function reportActivity() {
  socket.emit('client-activity', { visible: document.visibilityState === 'visible', focused: document.hasFocus() });
}
let _readTimer = null;
function scheduleMarkRead() {
  clearTimeout(_readTimer);
  _readTimer = setTimeout(() => {
    if (isPageActive() && activeGroupId) socket.emit('mark-group-read', { groupId: activeGroupId });
  }, 600);
}
document.addEventListener('visibilitychange', () => { reportActivity(); if (isPageActive()) { Notif.stopFlash(); scheduleMarkRead(); } });
window.addEventListener('focus', () => { reportActivity(); Notif.stopFlash(); scheduleMarkRead(); });
window.addEventListener('blur', reportActivity);
socket.on('connect', reportActivity);
socket.on('init-state', () => { reportActivity(); scheduleMarkRead(); });
socket.on('message', (m) => { if (m && m.senderToken !== myToken() && m.sender !== 'SYSTEM') scheduleMarkRead(); });

socket.on('notify', (n) => {
  const t = document.createElement('div');
  t.className = 'toast notify notranslate' + (n.kind === 'reminder' ? ' reminder' : '');
  t.setAttribute('translate', 'no');
  t.innerHTML = `<b>${escapeHtml(n.title || '')}</b>${escapeHtml(n.body || '')}`;
  t.onclick = () => {
    t.remove();
    if (n.groupId && n.groupId !== activeGroupId && isAdminConfirmed) switchGroup(n.groupId);
    else { closeTxAccountView(); const i = el('messageInput'); if (i) i.focus(); }
  };
  el('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 12000);
  if (n.playSound) Notif.chime(n.repeat || 3);
  if (!isPageActive()) Notif.flashTitle(n.title || 'New activity');
});

socket.on('read-notice', (n) => {
  if (!n || n.groupId !== activeGroupId) { /* still tell admins about other groups */ }
  const t = document.createElement('div');
  t.className = 'toast read-notice';
  t.textContent = `${n.by} read ${n.count > 1 ? n.count + ' messages' : 'your message'} in ${n.groupName}.`;
  el('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 5000);
});

socket.on('admin-notice', (n) => { if (n && n.message) toast(n.message); });
