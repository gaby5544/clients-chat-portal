/* =====================================================================
   v4.js — loaded after app.js. Adds / overrides:
     1  helpers, elite money formatting, flags
     2  language system (picker, whole-interface translation, chat auto-translation)
     3  notification client (sound x3, desktop alerts, reminders, read notices, auto push)
     4  seller sign-in, forgot password, blocked / disabled overlays
     5  registration (+ terms), post-registration choice
     6  seller dashboard extras (Account ID, country flag, Tracking Payment)
     7  KYC extras (details, live face camera, automatic result)
     8  withdrawals (disbursement gate, limits, crypto requirement, email code, tracker, business upgrade)
     9  admin (funds desk, escrow console, record funds, controls, IP, queues, crypto tiers)
   ===================================================================== */

/* ---------- 1. helpers ---------- */
const V4 = { lang: 'en', started: false };
function v4esc(s) { return escapeHtml(String(s == null ? '' : s)); }
function v4html(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function v4flag(code, cls = '') { return code ? `<img class="csel-flag ${cls}" alt="" src="https://flagcdn.com/24x18/${String(code).toLowerCase()}.png" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'csel-flag-emoji',textContent:cselEmojiFlag('${String(code).toLowerCase()}')}))">` : ''; }
function v4country(name) { return (window.CountryData && CountryData.byName(name)) || null; }
function v4ensureModal(id, inner, opts = {}) {
  let m = el(id);
  if (m) return m;
  m = document.createElement('div');
  m.className = 'modal-overlay hidden' + (opts.cls ? ' ' + opts.cls : '');
  m.id = id;
  m.innerHTML = inner;
  document.body.appendChild(m);
  return m;
}
function v4open(id) { el(id).classList.remove('hidden'); }
function v4close(id) { const m = el(id); if (m) m.classList.add('hidden'); }
function v4selects(root) { (root || document).querySelectorAll('select.csel').forEach(enhanceSelect); }
function v4fillData() { if (window.CountryData) CountryData.fillAll(); if (window.LangData) LangData.fillAll(); }
function v4pwToggle(inputId) { const i = el(inputId); i.type = i.type === 'password' ? 'text' : 'password'; const b = i.parentElement.querySelector('.v4-eye i'); if (b) b.className = i.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'; }
function v4pwField(id, label, ph) {
  return `<label class="v4-field">${label}<span class="v4-pw"><input type="password" id="${id}" class="message-input" placeholder="${ph || ''}" autocomplete="new-password"><button type="button" class="v4-eye" onclick="v4pwToggle('${id}')" aria-label="Show or hide password"><i class="fa-solid fa-eye"></i></button></span></label>`;
}
function v4strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++; if (pw.length >= 12) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, Math.max(pw ? 1 : 0, s - 1));
}
function v4money(amount, ccy) { // exact figure, thousands separators — for tooltips and legal text
  const n = Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return CCY_SYMBOL[ccy] ? `${CCY_SYMBOL[ccy]}${n}` : `${n} ${ccy || ''}`.trim();
}
// Elite display everywhere: full figure below one million, compact above ($2.00M, $1.25B).
window.fmtMoney = function (amount, ccy) {
  const n = Number(amount || 0); const abs = Math.abs(n); const sign = n < 0 ? '-' : '';
  const sym = CCY_SYMBOL[ccy] || ''; const tail = sym ? '' : (ccy ? ' ' + ccy : '');
  let body;
  if (abs >= 1e12) body = (abs / 1e12).toFixed(2) + 'T';
  else if (abs >= 1e9) body = (abs / 1e9).toFixed(2) + 'B';
  else if (abs >= 1e6) body = (abs / 1e6).toFixed(2) + 'M';
  else body = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${sym}${body}${tail}`;
};
function v4fdate(iso, withTime) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, withTime ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
function v4dhms(s) { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return [d && d + 'd', (d || h) && h + 'h', (d || h || m) && m + 'm', x + 's'].filter(Boolean).join(' '); }
function v4copy(text, label) { navigator.clipboard.writeText(text).then(() => toast(`${label || 'Copied'}: ${text}`), () => toast(text)); }
const V4_SUPPORT = 'complaints@usvistra.com';   // formal complaints / reviews
const V4_HELP = 'support@usvistra.com';          // general help

/* ---------- 2. language system ---------- */
const UiT = {
  lang: 'en', cache: {}, nodes: new Set(), orig: new WeakMap(), applied: new WeakMap(), attrOrig: new WeakMap(),
  timer: null, busy: false, warned: false, pending: new Set(), observer: null, dict: false,
  SKIP: 'script,style,textarea,input,select,option,noscript,[data-nt],.nt,.notranslate,#messageContainer,#presenceCluster,.avatar,.directory-name,.funds-desk-name',
  loadCache(lang) { try { this.cache = JSON.parse(localStorage.getItem('q_ut_' + lang) || '{}'); } catch (e) { this.cache = {}; } },
  saveCache() { try { const j = JSON.stringify(this.cache); if (j.length < 900000) localStorage.setItem('q_ut_' + this.lang, j); } catch (e) { /* quota — fine, server cache still helps */ } },
  translatable(node) {
    const t = node.nodeValue; if (!t || !/\p{L}/u.test(t) || !t.trim()) return false;
    const p = node.parentElement; if (!p) return false;
    if (p.closest(this.SKIP) && !p.closest('.msg-system')) return false;
    if (this.dict && p.closest('[data-i18n]')) return false;
    const s = t.trim();
    if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(s) || /^https?:\/\//.test(s)) return false;
    if (!/\s/.test(s) && /\d/.test(s) && s.length > 10) return false; // ids / references
    return true;
  },
  walk(root, fn) {
    if (!root) return;
    if (root.nodeType === 3) { if (this.translatable(root)) fn(root); return; }
    if (root.nodeType !== 1) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (this.translatable(n)) fn(n);
    (root.matches && root.matches('[placeholder],[title]') ? [root] : []).concat(Array.from(root.querySelectorAll ? root.querySelectorAll('[placeholder],[title]') : [])).forEach((e) => {
      if (e.closest(this.SKIP) && !e.closest('.msg-system')) return;
      ['placeholder', 'title'].forEach((a) => { const v = e.getAttribute(a); if (v && /\p{L}/u.test(v)) fn({ el: e, attr: a, value: v }); });
    });
  },
  schedule(root) { this.pending.add(root || document.body); clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 160); },
  async run() {
    if (this.lang === 'en' || this.busy) { if (this.lang !== 'en') this.schedule(); return; }
    this.busy = true;
    try {
      const roots = Array.from(this.pending); this.pending.clear();
      const items = [];
      roots.forEach((r) => this.walk(r, (x) => {
        if (x.nodeType === 3) {
          if (this.applied.get(x) === x.nodeValue) return; // already our translation
          this.orig.set(x, x.nodeValue); this.nodes.add(new WeakRef(x)); items.push({ node: x, text: x.nodeValue.trim() });
        } else {
          let o = this.attrOrig.get(x.el); if (!o) { o = {}; this.attrOrig.set(x.el, o); }
          if (o['t_' + x.attr] === x.value) return;
          o[x.attr] = x.value; items.push({ el: x.el, attr: x.attr, text: x.value.trim() });
        }
      }));
      const need = Array.from(new Set(items.map((i) => i.text).filter((t) => this.cache[t] === undefined)));
      for (let i = 0; i < need.length; i += 40) {
        const batch = need.slice(i, i + 40);
        try {
          const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: batch, target: this.lang }) });
          const data = await res.json();
          if (data.failed && !this.warned) { this.warned = true; toast('Translation is busy right now — some text is still in English. It will update automatically.'); setTimeout(() => { this.warned = false; this.pending.add(document.body); this.run(); }, 45000); }
          batch.forEach((t, k) => { const tr = data.translations && data.translations[k]; if (tr && tr !== t) this.cache[t] = tr; else if (tr && !data.failed) this.cache[t] = t; });
        } catch (e) { /* offline — retry on next change */ }
      }
      this.saveCache();
      this.apply(items);
    } finally { this.busy = false; }
  },
  apply(items) {
    this.observer && this.observer.disconnect();
    items.forEach((it) => {
      const tr = this.cache[it.text]; if (!tr) return;
      if (it.node) {
        if (!it.node.isConnected) return;
        const raw = this.orig.get(it.node) || ''; const lead = raw.match(/^\s*/)[0]; const trail = raw.match(/\s*$/)[0];
        const out = lead + tr + trail; it.node.nodeValue = out; this.applied.set(it.node, out);
      } else if (it.el && it.el.isConnected) { it.el.setAttribute(it.attr, tr); const o = this.attrOrig.get(it.el); if (o) o['t_' + it.attr] = tr; }
    });
    this.watch();
  },
  restore() {
    this.observer && this.observer.disconnect();
    this.nodes.forEach((ref) => { const n = ref.deref(); if (!n) return; const o = this.orig.get(n); if (o !== undefined && n.isConnected) n.nodeValue = o; });
    document.querySelectorAll('[placeholder],[title]').forEach((e) => { const o = this.attrOrig.get(e); if (o) ['placeholder', 'title'].forEach((a) => { if (o[a] !== undefined && o['t_' + a] !== undefined) { e.setAttribute(a, o[a]); delete o['t_' + a]; } }); });
    this.nodes.clear(); this.watch();
  },
  watch() {
    if (!this.observer) {
      this.observer = new MutationObserver((muts) => {
        if (this.lang === 'en') return;
        muts.forEach((m) => {
          if (m.type === 'characterData') { if (this.applied.get(m.target) !== m.target.nodeValue) this.schedule(m.target.parentElement); }
          else m.addedNodes.forEach((n) => { if (n.nodeType === 1 || n.nodeType === 3) this.schedule(n.nodeType === 3 ? n.parentElement : n); });
        });
      });
    }
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  },
  setLang(lang) {
    if (lang === this.lang && lang !== 'en') { this.schedule(document.body); return; }
    if (this.lang !== 'en') this.restore();
    this.lang = lang; this.pending.clear();
    if (lang === 'en') { if (this.observer) this.observer.disconnect(); return; }
    this.loadCache(lang); this.schedule(document.body);
  }
};

function v4RtlLang(l) { return ['ar', 'he', 'fa', 'ur', 'ps'].includes(l); }
function v4SetLanguage(lang, { save = true, fromServer = false } = {}) {
  const L = window.LangData && LangData.get(lang) ? lang : 'en';
  V4.lang = L;
  localStorage.setItem('q_ui_lang', L);
  document.documentElement.lang = L; document.documentElement.dir = v4RtlLang(L) ? 'rtl' : 'ltr';
  document.body.classList.toggle('rtl', v4RtlLang(L));
  const hasDict = typeof I18N !== 'undefined' && I18N[L];
  try { applyI18n(hasDict ? L : 'en'); } catch (e) { /* dictionary applier unavailable */ }
  UiT.dict = !!hasDict; // dictionary-translated labels are left alone; machine translation fills everything else
  UiT.setLang(L);
  const sel = el('targetLangSelect'); if (sel) { sel.value = L; refreshSelect(sel); }
  const us = el('uiLangSelect'); if (us) { us.value = L; refreshSelect(us); }
  v4RenderLangButtons();
  if (save && !fromServer && window.socket && socket.connected) socket.emit('set-my-language', { lang: L });
  v4RenderLangList();
}
window.setUiLanguage = (lang) => v4SetLanguage(lang);

function v4RenderLangButtons() {
  const l = LangData.get(V4.lang) || LangData.get('en');
  document.querySelectorAll('.v4-lang-btn').forEach((b) => { b.innerHTML = `${v4flag(l.flag)}<span class="code nt">${v4esc(l.native)}</span><i class="fa-solid fa-globe"></i>`; });
}
function v4LangButtonHtml(extra = '') { return `<button type="button" class="v4-lang-btn" onclick="v4OpenLangModal()" title="Language" ${extra}></button>`; }

function v4BuildLangModal() {
  v4ensureModal('v4LangModal', `<div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-globe"></i> Choose your language</span><i class="fa-solid fa-xmark" onclick="v4close('v4LangModal')"></i></div>
    <div class="modal-body"><p class="v4-hint" style="margin:0 0 8px;">The whole interface, your chat messages and your notifications will be shown in this language.</p>
      <input type="text" id="v4LangSearch" class="message-input" style="width:100%;" placeholder="Search language…" autocomplete="off" oninput="v4RenderLangList()">
      <div id="v4LangSuggest"></div><div class="v4-lang-list" id="v4LangList"></div><div class="v4-lang-status" id="v4LangStatus"></div></div></div>`, { cls: 'v4-top' });
}
function v4OpenLangModal() { v4BuildLangModal(); el('v4LangSearch').value = ''; v4RenderLangList(); v4open('v4LangModal'); setTimeout(() => el('v4LangSearch').focus(), 50); }
function v4RenderLangList() {
  const box = el('v4LangList'); if (!box) return;
  const q = cselNorm(el('v4LangSearch') ? el('v4LangSearch').value : '').trim();
  const guess = LangData.fromBrowser(navigator.language);
  const sug = el('v4LangSuggest');
  if (sug) { const g = LangData.get(guess); sug.innerHTML = (!q && g && guess !== V4.lang) ? `<div class="v4-lang-suggest"><span>${v4flag(g.flag)} Your device is set to <b>${v4esc(g.native)}</b></span><button class="v4-mini-btn" onclick="v4PickLang('${guess}')">Use it</button></div>` : ''; }
  box.innerHTML = LangData.list.filter((l) => !q || cselNorm(l.native + ' ' + l.name + ' ' + l.code).includes(q)).map((l) =>
    `<div class="v4-lang-item ${l.code === V4.lang ? 'active' : ''}" onclick="v4PickLang('${l.code}')">${v4flag(l.flag)}<div class="nt"><span>${v4esc(l.native)}</span><small>${v4esc(l.name)}</small></div></div>`).join('') || '<div class="csel-empty">No matching language</div>';
}
function v4PickLang(code) {
  v4SetLanguage(code);
  el('v4LangStatus').textContent = 'Translating…';
  setTimeout(() => { if (el('v4LangStatus')) el('v4LangStatus').textContent = ''; v4close('v4LangModal'); }, 600);
}

// One-time friendly offer on a first visit (never forced, never hidden).
function v4MaybeOfferLanguage() {
  if (localStorage.getItem('q_ui_lang') || localStorage.getItem('q_lang_offered')) return;
  const g = LangData.fromBrowser(navigator.language);
  localStorage.setItem('q_lang_offered', '1');
  if (g === 'en') return;
  const l = LangData.get(g);
  const bar = v4html(`<div class="v4-lang-suggest" style="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:5500;background:#0e1320;max-width:92vw;box-shadow:var(--shadow-deep);"><span>${v4flag(l.flag)} Use <b>${v4esc(l.native)}</b> for the whole app?</span><span style="display:flex;gap:6px;"><button class="v4-mini-btn" id="v4OfferYes">Yes</button><button class="v4-mini-btn" id="v4OfferMore">Other language</button><button class="v4-mini-btn" id="v4OfferNo">No</button></span></div>`);
  document.body.appendChild(bar);
  bar.querySelector('#v4OfferYes').onclick = () => { v4SetLanguage(g); bar.remove(); };
  bar.querySelector('#v4OfferMore').onclick = () => { bar.remove(); v4OpenLangModal(); };
  bar.querySelector('#v4OfferNo').onclick = () => { localStorage.setItem('q_ui_lang', 'en'); bar.remove(); };
}

// ---- chat translation: automatic, in the viewer's language ----
function v4AutoTranslateOn() { return localStorage.getItem('q_auto_tr') !== '0'; }
function v4MyChatLang() { return V4.lang || 'en'; }
function v4OutgoingTarget() {
  const counter = myRole === 'PARTY B' ? 'PARTY A' : 'PARTY B';
  const u = (lastPresenceUsers || []).find((x) => !x.isAdmin && x.role === counter);
  return (u && u.language && LangData.get(u.language)) ? u.language : 'en';
}
window.toggleTranslateBeforeSend = function () {
  translateBeforeSend = !translateBeforeSend;
  el('translateToggleBtn').classList.toggle('active', translateBeforeSend);
  const t = LangData.get(v4OutgoingTarget());
  toast(translateBeforeSend ? `Your messages will be translated into ${t.name} (the other party's language) before sending.` : 'Sending in your own language — the other side sees it translated automatically.');
};
window.sendMsg = async function () {
  const input = el('messageInput'); const rawText = input.value.trim(); if (!rawText) return;
  const target = translateBeforeSend ? v4OutgoingTarget() : v4MyChatLang();
  const outgoingText = translateBeforeSend ? await translateText(rawText, target) : rawText;
  socket.emit('send-message', { groupId: activeGroupId, text: outgoingText, targetLang: target, replyToId: replyTarget ? replyTarget.id : null });
  input.value = ''; cancelReply();
};
window.translateMessage = async function (messageId) {
  const data = messagesById.get(messageId); if (!data) return;
  const box = el(`translated-box-${messageId}`); const link = el(`translate-link-${messageId}`); if (!box || !link) return;
  if (box.dataset.showing === '1') { box.innerHTML = ''; box.dataset.showing = '0'; link.innerHTML = '<i class="fa-solid fa-language"></i> <span data-i18n="translate">Translate</span>'; return; }
  link.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  const plain = data.text.replace(/<[^>]*>/g, '');
  const tr = await translateText(plain, v4MyChatLang());
  box.innerHTML = `<div class="v4-translated nt"><span class="tag">${v4esc((LangData.get(V4.lang) || {}).name || '')}</span>${v4esc(tr)}</div>`;
  box.dataset.showing = '1'; link.innerHTML = '<i class="fa-solid fa-rotate-left"></i> <span>Show original</span>';
};
let v4ReadTimer = null;
function v4MarkReadIfActive() {
  clearTimeout(v4ReadTimer);
  v4ReadTimer = setTimeout(() => { if (document.visibilityState === 'visible' && document.hasFocus() && activeGroupId && _myToken) socket.emit('mark-group-read', { groupId: activeGroupId }); }, 450);
}
window.v4AfterMessage = async function (data) {
  if (!data || data.sender === 'SYSTEM') return;
  const mine = data.senderToken === myToken();
  if (!mine && data.groupId === activeGroupId) v4MarkReadIfActive();
  if (mine || !v4AutoTranslateOn() || !data.text) return;
  const plain = String(data.text).replace(/<[^>]*>/g, '').trim();
  if (!plain || !/\p{L}/u.test(plain)) return;
  const box = el(`translated-box-${data.id}`); const link = el(`translate-link-${data.id}`);
  if (!box || box.dataset.showing === '1') return;
  const tr = await translateText(plain, v4MyChatLang());
  if (!tr || tr.trim().toLowerCase() === plain.toLowerCase()) return; // already in my language
  if (!el(`translated-box-${data.id}`) || box.dataset.showing === '1') return;
  box.innerHTML = `<div class="v4-translated nt"><span class="tag"><i class="fa-solid fa-language"></i> ${v4esc((LangData.get(V4.lang) || {}).name || '')}</span>${v4esc(tr)}</div>`;
  box.dataset.showing = '1'; if (link) link.innerHTML = '<i class="fa-solid fa-rotate-left"></i> <span>Show original</span>';
};

/* ---------- 3. notification client ---------- */
let v4Audio = null; let v4TitleTimer = null; const v4OrigTitle = document.title;
function v4UnlockAudio() {
  try {
    if (!v4Audio) v4Audio = new (window.AudioContext || window.webkitAudioContext)();
    if (v4Audio.state === 'suspended') v4Audio.resume();
  } catch (e) { /* no audio support */ }
}
['click', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, v4UnlockAudio, { passive: true }));
function v4SoundOn() { return localStorage.getItem('q_sound') !== '0'; }
function v4Chime3() { // three two-tone chimes
  if (!v4SoundOn()) return;
  try {
    v4UnlockAudio(); if (!v4Audio) return;
    const t0 = v4Audio.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      [[880, 0], [1175, 0.16]].forEach(([f, off]) => {
        const o = v4Audio.createOscillator(); const g = v4Audio.createGain();
        o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(v4Audio.destination);
        const s = t0 + i * 0.7 + off;
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.35, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
        o.start(s); o.stop(s + 0.36);
      });
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  } catch (e) { /* ignore */ }
}
function v4FlashTitle(text) {
  clearInterval(v4TitleTimer); let on = false;
  v4TitleTimer = setInterval(() => { document.title = on ? v4OrigTitle : `🔔 ${text}`; on = !on; }, 900);
}
function v4StopFlash() { clearInterval(v4TitleTimer); document.title = v4OrigTitle; }
window.addEventListener('focus', () => { v4StopFlash(); v4MarkReadIfActive(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { v4StopFlash(); v4MarkReadIfActive(); } });
function v4Viewing(groupId) { return groupId === activeGroupId && document.visibilityState === 'visible' && document.hasFocus(); }
async function v4DesktopNotify(title, body, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const lang = v4MyChatLang();
    if (lang !== 'en') { [title, body] = await Promise.all([translateText(title, lang), translateText(body, lang)]); }
    new Notification(title, { body, icon: '/icon-192.png', tag: tag || 'qsd', renotify: true });
  } catch (e) { /* ignore */ }
}
function v4Alert({ title, body, tag, groupId }) {
  v4Chime3(); v4FlashTitle(title); v4DesktopNotify(title, body, tag);
  toast(`${title}${body ? ' — ' + body : ''}`);
}
socket.on('notify-message', (n) => {
  if (v4Viewing(n.groupId)) return; // they are looking at it — read receipts handle it
  v4Alert({ title: `New message from ${n.fromName}`, body: `${n.groupName}${n.text ? ': ' + n.text.replace(/<[^>]*>/g, '').slice(0, 120) : ''}`, tag: 'qsd-' + n.groupId, groupId: n.groupId });
});
socket.on('unread-reminder', (n) => v4Alert({ title: n.title || 'Unread messages', body: n.body, tag: 'qsd-reminder-' + n.groupId, groupId: n.groupId }));
let v4ReadToastAt = {};
socket.on('message-read-notice', (n) => {
  const now = Date.now(); if (now - (v4ReadToastAt[n.groupId] || 0) < 10000) return; v4ReadToastAt[n.groupId] = now;
  toast(`✓ ${n.byName} opened the message${n.count > 1 ? 's' : ''}`);
});
socket.on('seller-notice', (n) => { if (!document.hasFocus() || document.visibilityState !== 'visible') { v4Chime3(); v4FlashTitle(n.title); v4DesktopNotify(n.title, n.body, 'qsd-notice'); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'push-sound' && (document.hidden || !document.hasFocus())) { v4Chime3(); v4FlashTitle(e.data.title || 'New message'); } });

// Notifications "just work": register push automatically (asks permission on the first tap), keep it linked to this session.
async function v4AutoPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const link = async (sub) => { await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionToken, subscription: sub.toJSON() }) }); pushSubscribed = true; const b = el('notifyToggleBtn'); if (b) b.classList.add('subscribed'); };
    const existing = await reg.pushManager.getSubscription();
    if (existing) return link(existing);
    const subscribe = async () => {
      const { publicKey } = await (await fetch('/api/push/vapid-public-key')).json();
      await link(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
    };
    if (Notification.permission === 'granted') return subscribe();
    if (Notification.permission === 'default' && !sessionStorage.getItem('q_push_asked')) {
      const ask = async () => { document.removeEventListener('click', ask); sessionStorage.setItem('q_push_asked', '1'); try { if ((await Notification.requestPermission()) === 'granted') await subscribe(); } catch (e) { /* declined */ } };
      document.addEventListener('click', ask, { once: true });
    }
  } catch (e) { /* unsupported — in-app alerts still work */ }
}

/* ---------- 4. seller sign-in, forgot password, blockers ---------- */
function v4BuildAuthModals() {
  v4ensureModal('v4LoginModal', `<div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-lock"></i> Sign in to your Transaction Account</span>${v4LangButtonHtml()}</div>
    <div class="modal-body">
      <p class="v4-hint" style="margin:0 0 12px;line-height:1.5;">This transaction group already has a Transaction Account. Sign in with the email and password you created. <span id="v4LoginHint"></span></p>
      <label class="v4-field">Email address<input type="email" id="v4LoginEmail" class="message-input" autocomplete="username" placeholder="name@example.com"></label>
      ${v4pwField('v4LoginPw', 'Password', 'Your password')}
      <div class="v4-hint bad" id="v4LoginErr" style="min-height:16px;"></div>
      <div class="v4-modal-actions" style="justify-content:space-between;align-items:center;"><button class="v4-link" onclick="v4OpenForgot()">Forgot password?</button><button class="send-btn" id="v4LoginBtn" onclick="v4DoLogin()"><i class="fa-solid fa-right-to-bracket"></i> Sign in</button></div>
    </div></div>`, { cls: 'v4-top' });
  v4ensureModal('v4ForgotModal', `<div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-key"></i> Reset your password</span><i class="fa-solid fa-xmark" onclick="v4close('v4ForgotModal')"></i></div>
    <div class="modal-body">
      <div id="v4Fg1"><p class="v4-hint" style="margin:0 0 12px;line-height:1.5;">Enter the email on your account. We will send a 6-digit code to it.</p>
        <label class="v4-field">Email address<input type="email" id="v4FgEmail" class="message-input" placeholder="name@example.com"></label>
        <div class="v4-modal-actions"><button class="send-btn" onclick="v4ForgotRequest()"><i class="fa-solid fa-paper-plane"></i> Send code</button></div></div>
      <div id="v4Fg2" class="hidden"><div class="v4-note ok"><i class="fa-solid fa-envelope-circle-check"></i><span>If an account exists for that email, a code is on its way. It expires in 10 minutes.</span></div>
        <label class="v4-field">6-digit code<input type="text" inputmode="numeric" maxlength="6" id="v4FgCode" class="message-input v4-code-input" placeholder="••••••" autocomplete="one-time-code"></label>
        <div class="v4-modal-actions" style="justify-content:space-between;"><button class="v4-link" onclick="v4ForgotRequest(true)">Resend code</button><button class="send-btn" onclick="v4ForgotVerify()"><i class="fa-solid fa-check"></i> Verify</button></div></div>
      <div id="v4Fg3" class="hidden">${v4pwField('v4FgPw', 'New password', 'At least 8 characters, a letter and a number')}${v4pwField('v4FgPw2', 'Confirm new password', 'Re-enter the password')}
        <div class="v4-hint" id="v4FgMatch"></div>
        <div class="v4-modal-actions"><button class="send-btn" onclick="v4ForgotReset()"><i class="fa-solid fa-lock"></i> Save new password</button></div></div>
      <div class="v4-hint bad" id="v4FgErr" style="min-height:16px;margin-top:8px;"></div>
    </div></div>`, { cls: 'v4-top' });
  v4ensureModal('v4IpBlockedModal', `<div class="modal-box"><div class="modal-body"><div class="v4-hero bad"><div class="badge"><i class="fa-solid fa-ban"></i></div><h3>Access from this network is blocked</h3>
    <p>The Desk has blocked this network address from your Transaction Account. If you believe this is a mistake, please contact the Desk to lodge a complaint.</p></div>
    <div class="v4-modal-actions" style="justify-content:center;"><a class="send-btn" href="mailto:${V4_SUPPORT}?subject=Blocked%20network%20-%20complaint"><i class="fa-solid fa-envelope"></i> ${V4_SUPPORT}</a></div></div></div>`, { cls: 'v4-blocker' });
  v4ensureModal('v4DisabledModal', `<div class="modal-box"><div class="modal-body"><div class="v4-hero bad"><div class="badge"><i class="fa-solid fa-user-lock"></i></div><h3>Your account has been disabled</h3>
    <p id="v4DisabledText">Your Transaction Account is currently disabled and cannot be used.</p></div>
    <div class="v4-note bad"><i class="fa-solid fa-circle-info"></i><span><b>Complaints &amp; reviews:</b> to lodge a complaint or ask for this decision to be reviewed, write to <b>${V4_SUPPORT}</b> and quote your Account ID.<br><b>General help:</b> <b>${V4_HELP}</b></span></div>
    <div class="v4-modal-actions" style="justify-content:center;"><a class="send-btn" id="v4DisabledMail" href="mailto:${V4_SUPPORT}"><i class="fa-solid fa-envelope"></i> Contact ${V4_SUPPORT}</a></div></div></div>`, { cls: 'v4-blocker' });
  const pw2 = el('v4FgPw2'); if (pw2) pw2.addEventListener('input', () => { const m = el('v4FgPw').value === pw2.value && pw2.value; el('v4FgMatch').textContent = pw2.value ? (m ? '✓ Passwords match' : 'Passwords do not match') : ''; el('v4FgMatch').className = 'v4-hint ' + (pw2.value ? (m ? 'ok' : 'bad') : ''); });
  ['v4LoginEmail', 'v4LoginPw'].forEach((id) => el(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') v4DoLogin(); }));
}
socket.on('seller-login-required', (d) => {
  v4BuildAuthModals(); v4close('txRegModal');
  el('v4LoginHint').textContent = d && d.emailHint ? `The account email looks like ${d.emailHint}.` : '';
  v4RenderLangButtons(); v4open('v4LoginModal');
});
socket.on('seller-ip-blocked', () => { v4BuildAuthModals(); ['v4LoginModal', 'txRegModal'].forEach(v4close); v4open('v4IpBlockedModal'); });
async function v4DoLogin() {
  const email = el('v4LoginEmail').value.trim(); const password = el('v4LoginPw').value; const err = el('v4LoginErr');
  err.textContent = '';
  if (!isValidEmailClient(email)) { err.textContent = 'Please enter a valid email address.'; return; }
  if (!password) { err.textContent = 'Please enter your password.'; return; }
  const btn = el('v4LoginBtn'); btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, groupId: activeGroupId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) { err.textContent = data.error || 'Sign-in failed. Please try again.'; if (data.blocked) { v4close('v4LoginModal'); v4open('v4IpBlockedModal'); } return; }
    if (data.groupId !== activeGroupId) { err.textContent = 'That account belongs to a different transaction group. Please open your own invite link.'; return; }
    sessionToken = data.sessionToken; sessionStorage.setItem('q_session_token', sessionToken);
    localStorage.setItem('q_user_email', email);
    el('v4LoginPw').value = ''; v4close('v4LoginModal');
    joinSession(adminPasskeyMemory);
  } catch (e) { err.textContent = 'Network error — please check your connection and try again.'; } finally { btn.disabled = false; }
}
function v4OpenForgot() { v4close('v4LoginModal'); el('v4FgEmail').value = el('v4LoginEmail').value; ['v4Fg2', 'v4Fg3'].forEach((i) => el(i).classList.add('hidden')); el('v4Fg1').classList.remove('hidden'); el('v4FgErr').textContent = ''; v4open('v4ForgotModal'); }
async function v4Json(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { ok: r.ok, data: await r.json().catch(() => ({})) }; }
async function v4ForgotRequest(resend) {
  const email = el('v4FgEmail').value.trim(); el('v4FgErr').textContent = '';
  if (!isValidEmailClient(email)) { el('v4FgErr').textContent = 'Please enter a valid email address.'; return; }
  const r = await v4Json('/api/auth/forgot-password/request', { email, groupId: activeGroupId });
  if (!r.ok) { el('v4FgErr').textContent = r.data.error || 'Too many requests — please wait a minute and try again.'; return; }
  el('v4Fg1').classList.add('hidden'); el('v4Fg2').classList.remove('hidden'); if (resend) toast('A new code has been sent.');
  setTimeout(() => el('v4FgCode').focus(), 50);
}
async function v4ForgotVerify() {
  const email = el('v4FgEmail').value.trim(); const code = el('v4FgCode').value.trim(); el('v4FgErr').textContent = '';
  if (!/^\d{6}$/.test(code)) { el('v4FgErr').textContent = 'Please enter the 6-digit code.'; return; }
  const r = await v4Json('/api/auth/forgot-password/verify', { email, code, groupId: activeGroupId });
  if (!r.ok) { el('v4FgErr').textContent = r.data.error || 'That code is not valid.'; return; }
  V4.resetToken = r.data.resetToken; el('v4Fg2').classList.add('hidden'); el('v4Fg3').classList.remove('hidden');
}
async function v4ForgotReset() {
  const email = el('v4FgEmail').value.trim(); const pw = el('v4FgPw').value; el('v4FgErr').textContent = '';
  if (pw !== el('v4FgPw2').value) { el('v4FgErr').textContent = 'The two passwords do not match.'; return; }
  const r = await v4Json('/api/auth/forgot-password/reset', { email, resetToken: V4.resetToken, newPassword: pw, groupId: activeGroupId });
  if (!r.ok) { el('v4FgErr').textContent = r.data.error || 'Could not reset the password.'; return; }
  v4close('v4ForgotModal'); toast('Password updated. Please sign in with your new password.');
  el('v4LoginEmail').value = email; el('v4LoginPw').value = ''; v4open('v4LoginModal');
}

/* ---------- 5. registration, terms, post-registration ---------- */
const V4_TERMS_VERSION = 'QSTD-TERMS-2026-10';
const V4_TERMS_HTML = `
<h4>1. About this account</h4><p>The Transaction Account (the "Account") is a managed settlement account operated by the Transaction Desk (the "Desk") for the sole purpose of holding, reviewing and releasing funds connected with the transaction group in which you were invited to act as Seller. It is not a bank account, a deposit account or an investment product, and it does not earn interest.</p>
<h4>2. Eligibility and accurate information</h4><p>You confirm that you are at least 18 years old, that you act on your own behalf or with full authority to bind the business you represent, and that every detail you provide — including your legal name, country, date of birth, phone number and email address — is true, complete and current. You agree to keep it so and to tell the Desk promptly of any change that you are permitted to make.</p>
<h4>3. Email address tied to the Account</h4><p>The email address used to create the Account is permanently linked to it and cannot be changed. It is used for security codes, withdrawal confirmations and official notices. You are responsible for keeping that mailbox secure and accessible.</p>
<h4>4. Account security</h4><p>You must keep your password and every verification code confidential and never share them with anyone, including anyone claiming to represent the Desk. The Desk will never ask you for your password or a security code. You are responsible for all activity carried out with your credentials. Sign-in attempts, registrations and withdrawals are logged together with the network address they came from, and the Desk may block a network address from your Account at its discretion.</p>
<h4>5. Identity verification (KYC) and compliance</h4><p>Withdrawals are available only after your identity has been verified. You agree to provide genuine, valid and unexpired documents, to complete additional verification (including business verification) when requested, and to cooperate with source-of-funds enquiries. Submissions that are expired, unreadable, inconsistent or that do not match your registered details may be rejected automatically with the reason shown to you. The Desk may delay, hold or refuse any action where required by law, by a financial institution, or to prevent fraud or financial crime.</p>
<h4>6. Incoming funds, review and the vault</h4><p>Funds recorded to your Account may be held in the vault while the payment passes the Desk's escrow review (payment received, payer verification, authenticity review, payment confirmation and settlement). Held funds are not available to withdraw until they are released to your available balance, which happens automatically at the end of the review or earlier at the Desk's direction, regardless of the status of the underlying transaction. A payment that cannot be verified may be reversed.</p>
<h4>7. Withdrawals and the disbursement stage</h4><p>You may withdraw only your available balance, and only once the transaction in your group is confirmed by both parties and the Desk has placed it in the disbursement stage. This protects both parties: you cannot withdraw funds before you have completed your own obligations under the transaction. Each withdrawal is confirmed with a one-time code sent to your registered email address and moves through the stages Pending, Processing and either Completed or Declined. A declined withdrawal is returned to your available balance. Withdrawals made by cryptocurrency may require a prior verified crypto deposit; bank withdrawals are not affected by that requirement.</p>
<h4>8. Limits and business accounts</h4><p>A standard daily withdrawal limit applies to each rolling 24-hour period, in your Account currency. Withdrawing above that limit requires an approved business account, for which you must provide company, registration and tax details and supporting documents. Approval is at the Desk's discretion.</p>
<h4>9. Fees, currency and conversion</h4><p>Your Account currency is fixed when the Account is created. Incoming payments in another currency are converted at an indicative rate at the time of recording. Third-party bank, network or exchange charges may apply to a payout and are outside the Desk's control.</p>
<h4>10. Prohibited use</h4><p>You must not use the Account for unlawful activity, to disguise the source of funds, to evade sanctions or taxes, to operate for anyone else without disclosure, or to attempt to circumvent any control, limit or review described in these terms.</p>
<h4>11. Suspension and disabling</h4><p>The Desk may disable or restrict your Account at any time to protect users, comply with the law or investigate a concern. While disabled, you cannot use the Account. Disabled Account holders can lodge a complaint at <b>complaints@usvistra.com</b>, quoting their Account ID. Funds remain recorded to your Account while it is disabled.</p>
<h4>12. Privacy and communications</h4><p>Your details are used to operate, secure and review the Account, to meet legal obligations and to send you service notices — including push notifications, emails and reminders in your chosen language. Machine translation is used to translate messages and notices; important decisions should be confirmed in writing with the Desk.</p>
<h4>13. Liability</h4><p>To the extent permitted by law, the Desk is not liable for losses arising from incorrect details you provide, a compromised mailbox or device, delays by banks or blockchain networks, or events outside its reasonable control. Nothing in these terms limits liability that cannot be limited by law.</p>
<h4>14. Changes and acceptance</h4><p>The Desk may update these terms and will notify you of material changes. By ticking the acceptance box and creating the Account you confirm that you have read, understood and agree to these Terms &amp; Policy (version ${V4_TERMS_VERSION}); the date and version of your acceptance are recorded against your Account.</p>`;

function v4BuildRegistration() {
  if (el('txRegModal')) return;
  v4fillData();
  v4ensureModal('txRegModal', `<div class="modal-box wide"><div class="modal-header"><span><i class="fa-solid fa-shield-halved"></i> Create Your Transaction Account</span>${v4LangButtonHtml()}</div>
  <div class="modal-body">
    <p class="v4-hint" style="margin:0 0 14px;line-height:1.55;">One last step before you can trade — set up the account that holds your balance, identity verification and withdrawals for this deal.</p>
    <label class="v4-field">Full legal name<input type="text" id="txRegNameInput" class="message-input" placeholder="As it appears on your ID" autocomplete="name"></label>

    <label class="v4-field">Email address
      <span class="v4-email-box"><input type="email" id="txRegEmailInput" class="message-input" placeholder="name@example.com" autocomplete="email"><button type="button" class="v4-mini-btn" id="v4RegEmailClear" onclick="v4RegUseOtherEmail()" style="display:none;"><i class="fa-solid fa-pen"></i> Use another email</button></span>
    </label>
    <div class="v4-note warn"><i class="fa-solid fa-link"></i><span><b>Important:</b> this email address will be permanently tied to your Transaction Account and <b>can never be changed</b>. It receives your security codes and withdrawal confirmations — please use an address that only you can access.</span></div>
    <div id="v4RegCodeBlock" style="display:none;">
      <div class="v4-row" style="align-items:flex-end;"><label class="v4-field" style="margin:0;">Email verification code<input type="text" inputmode="numeric" maxlength="6" id="v4RegCode" class="message-input" placeholder="6-digit code" autocomplete="one-time-code"></label><button type="button" class="v4-mini-btn" id="v4RegSendCode" onclick="v4RegSendCode()" style="flex:0 0 auto;height:42px;"><i class="fa-solid fa-paper-plane"></i> Send code</button></div>
      <div class="v4-hint" id="v4RegCodeHint" style="margin:6px 0 10px;">We will email you a 6-digit code to confirm this address.</div>
    </div>

    <div class="v4-row">
      <label class="v4-field">Country<select id="txRegCountryInput" class="message-input csel" data-countries="1" data-search="1" data-placeholder="Select your country" style="width:100%;"></select></label>
      <label class="v4-field">Date of birth<input type="date" id="txRegDobInput" class="message-input"></label>
    </div>
    <label class="v4-field">Phone number<span class="v4-phone"><select id="v4RegDial" class="message-input csel" data-search="1" style="width:100%;"></select><input type="tel" id="v4RegPhone" class="message-input" placeholder="Phone number" autocomplete="tel-national"></span></label>

    ${v4pwField('txRegPasswordInput', 'Password', 'At least 8 characters, a letter and a number')}
    <div class="v4-meter"><i id="v4PwMeter"></i></div><div class="v4-hint" id="v4PwHint" style="margin:4px 0 10px;"></div>
    ${v4pwField('txRegPasswordConfirmInput', 'Confirm password', 'Re-enter your password')}
    <div class="v4-hint" id="v4PwMatch" style="margin:-4px 0 10px;"></div>

    <div class="v4-row">
      <label class="v4-field">Account currency<select id="txRegCurrencyInput" class="message-input csel" style="width:100%;"><option value="USD">USD — US Dollar</option><option value="GBP">GBP — British Pound</option><option value="EUR">EUR — Euro</option></select></label>
      <label class="v4-field">Preferred language<select id="v4RegLang" class="message-input csel" data-languages="1" data-search="1" style="width:100%;"></select></label>
    </div>
    <div class="v4-hint" style="margin:-4px 0 10px;">Your currency is locked once set. Your language is used across your whole account, notices and emails.</div>

    <div class="v4-field" style="margin-bottom:12px;">Account type
      <div class="v4-account-type"><div class="ico"><i class="fa-solid fa-layer-group"></i></div><div><b>Standard account</b><span>Selected automatically — includes secure escrow review, vault protection and standard daily withdrawals.</span></div><i class="fa-solid fa-circle-check tick"></i></div>
      <input type="hidden" id="v4RegAccountType" value="Standard account">
    </div>

    <label class="v4-check"><input type="checkbox" id="v4RegTerms"><span>I have read and accept the <a onclick="v4OpenTerms(event)">Terms &amp; Policy</a> of the Transaction Account, and I confirm that all the details I have provided are accurate.</span></label>
    <div class="v4-modal-actions"><button class="send-btn" id="v4RegSubmit" onclick="submitTxRegistration()"><i class="fa-solid fa-check"></i> Create Account</button></div>
  </div></div>`);
  v4ensureModal('v4TermsModal', `<div class="modal-box wide"><div class="modal-header"><span><i class="fa-solid fa-file-contract"></i> Transaction Account — Terms &amp; Policy</span><i class="fa-solid fa-xmark" onclick="v4close('v4TermsModal')"></i></div>
    <div class="modal-body"><div class="v4-hint" style="margin-bottom:10px;">Version ${V4_TERMS_VERSION} · Effective 4 October 2026</div><div class="v4-terms-body nt">${V4_TERMS_HTML}</div>
    <div class="v4-modal-actions"><button class="ghost-btn" onclick="v4close('v4TermsModal')">Close</button><button class="send-btn" onclick="el('v4RegTerms').checked=true;v4close('v4TermsModal');"><i class="fa-solid fa-check"></i> I accept</button></div></div></div>`, { cls: 'v4-top' });
  // fill the country + language lists INSIDE the modal that was just created, then build the dial-code list
  CountryData.fillAll(el('txRegModal')); LangData.fillAll(el('txRegModal'));
  const dial = el('v4RegDial');
  dial.innerHTML = CountryData.list.map((c) => `<option value="${c.dial}" data-flag="${c.code}" data-label="+${c.dial}" data-hint="${c.name.replace(/"/g, '&quot;')}" data-keywords="${c.code}">+${c.dial}</option>`).join('');
  dial.value = '1';
  const lang = el('v4RegLang'); lang.value = V4.lang;
  v4selects(el('txRegModal'));
  // country -> dial code
  el('txRegCountryInput').addEventListener('change', () => { const c = v4country(el('txRegCountryInput').value); if (c) { dial.value = c.dial; refreshSelect(dial); } });
  el('v4RegLang').addEventListener('change', () => v4SetLanguage(el('v4RegLang').value));
  // password feedback
  el('txRegPasswordInput').addEventListener('input', v4RegPwFeedback); el('txRegPasswordConfirmInput').addEventListener('input', v4RegPwFeedback);
  el('txRegEmailInput').addEventListener('input', () => { if (V4.codeSentFor && V4.codeSentFor !== el('txRegEmailInput').value.trim()) { V4.codeSentFor = null; el('v4RegCode').value = ''; el('v4RegCodeHint').textContent = 'The email changed — please send a new code.'; el('v4RegCodeHint').className = 'v4-hint'; } });
}
function v4RegPwFeedback() {
  const pw = el('txRegPasswordInput').value; const c = el('txRegPasswordConfirmInput').value;
  const sc = v4strength(pw); const meter = el('v4PwMeter');
  meter.style.width = (pw ? [20, 40, 65, 100][Math.max(0, sc - 1)] || 20 : 0) + '%';
  meter.style.background = ['#fb5479', '#f5a524', '#38bdf8', '#22d3a5'][Math.max(0, sc - 1)] || '#fb5479';
  const problem = !pw ? '' : pw.length < 8 ? 'Use at least 8 characters.' : (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) ? 'Include at least one letter and one number.' : ['', 'Acceptable', 'Good', 'Strong'][sc - 1] || 'Acceptable';
  el('v4PwHint').textContent = problem; el('v4PwHint').className = 'v4-hint ' + (!pw ? '' : (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) ? 'bad' : 'ok');
  const m = el('v4PwMatch'); m.textContent = c ? (c === pw ? '✓ Passwords match' : 'Passwords do not match') : ''; m.className = 'v4-hint ' + (c ? (c === pw ? 'ok' : 'bad') : '');
}
function v4OpenTerms(e) { if (e) { e.preventDefault(); e.stopPropagation(); } v4open('v4TermsModal'); }
function v4RegUseOtherEmail() { const i = el('txRegEmailInput'); i.value = ''; i.focus(); V4.codeSentFor = null; el('v4RegCode').value = ''; }
function v4RegSendCode() {
  const email = el('txRegEmailInput').value.trim();
  if (!isValidEmailClient(email)) return toast('Please enter a valid email address first.', true);
  el('v4RegSendCode').disabled = true; socket.emit('send-registration-code', { groupId: activeGroupId, email });
  setTimeout(() => { if (el('v4RegSendCode')) el('v4RegSendCode').disabled = false; }, 4000);
}
socket.on('registration-code-sent', (d) => {
  if (!el('v4RegCodeHint')) return;
  if (d.required === false) { el('v4RegCodeBlock').style.display = 'none'; return; }
  V4.codeSentFor = d.email;
  el('v4RegCodeHint').textContent = `Code sent to ${d.emailMasked || d.email}. It expires in 10 minutes.`; el('v4RegCodeHint').className = 'v4-hint ok';
  let left = d.resendInSec || 30; const b = el('v4RegSendCode'); b.disabled = true;
  const t = setInterval(() => { left--; if (!el('v4RegSendCode') || left <= 0) { clearInterval(t); if (el('v4RegSendCode')) { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Resend code'; } } else b.textContent = `Resend in ${left}s`; }, 1000);
  setTimeout(() => el('v4RegCode') && el('v4RegCode').focus(), 50);
});
window.maybeShowTxRegModal = function () {
  if (myRole !== 'PARTY B' || !sellerAccountState) return;
  el('txAccountBtn').classList.remove('hidden'); el('brandMenuTxAccount').classList.remove('hidden');
  if (sellerAccountState.registered) { v4close('txRegModal'); return; }
  v4BuildRegistration(); v4RenderLangButtons();
  const email = el('txRegEmailInput');
  if (!email.dataset.init) {
    email.dataset.init = '1'; email.value = sellerAccountState.email || '';
    el('v4RegEmailClear').style.display = sellerAccountState.email ? '' : 'none';
  }
  el('v4RegCodeBlock').style.display = sellerAccountState.emailCodeRequired ? 'block' : 'none';
  v4open('txRegModal');
};
window.submitTxRegistration = function () {
  const g = (id) => el(id).value;
  const fullName = g('txRegNameInput').trim(); const email = g('txRegEmailInput').trim(); const pw = g('txRegPasswordInput');
  if (fullName.length < 3) return toast('Please enter your full legal name.', true);
  if (!isValidEmailClient(email)) return toast('Please enter a valid email address.', true);
  if (!g('txRegCountryInput')) return toast('Please select your country.', true);
  if (!g('txRegDobInput')) return toast('Please enter your date of birth.', true);
  if ((Date.now() - new Date(g('txRegDobInput')).getTime()) / 31557600000 < 18) return toast('You must be at least 18 years old to create a Transaction Account.', true);
  const digits = g('v4RegPhone').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length < 5) return toast('Please enter a valid phone number.', true);
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return toast('Password must be at least 8 characters with a letter and a number.', true);
  if (pw !== g('txRegPasswordConfirmInput')) return toast('The two passwords do not match.', true);
  if (sellerAccountState.emailCodeRequired && !/^\d{6}$/.test(g('v4RegCode').trim())) return toast(V4.codeSentFor ? 'Please enter the 6-digit code we emailed you.' : 'Please send the verification code to your email first.', true);
  if (!el('v4RegTerms').checked) return toast('Please tick the box to accept the Terms & Policy.', true);
  const btn = el('v4RegSubmit'); btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 5000);
  socket.emit('register-transaction-account', {
    groupId: activeGroupId, fullName, email, phone: `+${g('v4RegDial')}${digits}`, password: pw, passwordConfirm: g('txRegPasswordConfirmInput'),
    currency: g('txRegCurrencyInput'), dateOfBirth: g('txRegDobInput'), country: g('txRegCountryInput'), language: g('v4RegLang') || V4.lang,
    accountType: g('v4RegAccountType'), acceptTerms: true, emailCode: g('v4RegCode').trim()
  });
};

// ---- Section 2.1: what next? ----
function v4BuildChoice() {
  v4ensureModal('v4ChoiceModal', `<div class="modal-box"><div class="modal-body">
    <div class="v4-hero"><div class="badge"><i class="fa-solid fa-circle-check"></i></div><h3>Your Transaction Account is ready</h3>
      <p>Welcome aboard. Your account has been created and secured. Choose how you would like to continue.</p>
      <div class="v4-idchip"><i class="fa-solid fa-fingerprint"></i> Account ID <b id="v4ChoiceId" class="nt">—</b></div></div>
    <div class="v4-choice">
      <button class="v4-choice-card" onclick="v4ChooseNext('transaction')"><div class="ico"><i class="fa-solid fa-handshake"></i></div><div><b>Start transaction</b><span>Go straight to your transaction group and begin the deal with the buyer and the Desk.</span></div><i class="fa-solid fa-chevron-right go"></i></button>
      <button class="v4-choice-card" onclick="v4ChooseNext('kyc')"><div class="ico"><i class="fa-solid fa-id-card"></i></div><div><b>Continue KYC verification</b><span>Verify your identity now so you can withdraw as soon as funds are released to you.</span></div><i class="fa-solid fa-chevron-right go"></i></button>
    </div></div></div>`, { cls: 'v4-top' });
}
window.v4OnAccountCreated = function (d) {
  v4BuildChoice(); el('v4ChoiceId').textContent = d && d.accountId ? d.accountId : (sellerAccountState && sellerAccountState.accountId) || '—';
  v4close('txRegModal'); v4open('v4ChoiceModal');
};
function v4GoToTransaction() { closeTxAccountView(); ['v4ChoiceModal', 'v4WdBlockModal'].forEach(v4close); const c = el('messageContainer'); if (c) c.scrollTop = c.scrollHeight; setTimeout(() => { const i = el('messageInput'); if (i) i.focus(); }, 150); }
function v4ChooseNext(which) {
  v4close('v4ChoiceModal');
  if (which === 'transaction') {
    v4GoToTransaction();
    if (window.currentGroupTxFormEnabled) { openTransactionForm(); toast('Your transaction group is open — complete the transaction form to begin.'); }
    else toast('Your transaction group is open. Send a message to the buyer and the Desk to begin.');
  } else { openTxAccountView(); setTimeout(() => openTxKycWizard(), 250); }
}

/* ---------- 6. seller dashboard extras ---------- */
let v4TrackId = null; let v4TrackSig = '';
function v4InitAccountShell() {
  if (el('txPageTracking')) return;
  TX_NAV_TITLES.tracking = ['Tracking Payment', 'Follow every incoming payment through the escrow review, live.'];
  // nav item
  const navTx = document.querySelector('[data-txnav="transactions"]');
  if (navTx) navTx.insertAdjacentHTML('afterend', '<button class="tx-nav-item" data-txnav="tracking" onclick="setTxAccountNav(\'tracking\')"><i class="fa-solid fa-route"></i> Tracking Payment <span class="v4-live-dot hidden" id="v4TrackDot"></span></button>');
  // page
  const pageTx = el('txPageTransactions');
  if (pageTx) pageTx.insertAdjacentHTML('afterend', `<div class="tx-page hidden" id="txPageTracking"><div class="tx-panel">
    <div class="v4-track-head"><label class="branding-field"><span>Select a payment to track</span><select id="v4TrackSelect" class="message-input csel" data-search="1" style="width:100%;"></select></label></div>
    <div id="v4TrackBody"><p class="ledger-empty">No incoming payments yet. When the Desk records a payment to your account it appears here.</p></div></div></div>`);
  el('v4TrackSelect').addEventListener('change', () => { v4TrackId = el('v4TrackSelect').value; v4RenderTracking(true); });
  v4selects(el('txPageTracking'));
  // top-bar pills: Account ID + country
  const ccyPill = document.querySelector('.tx-topbar-right .tx-currency-pill');
  if (ccyPill) ccyPill.insertAdjacentHTML('afterend', `<div class="tx-currency-pill v4-id hidden" id="v4IdPill"><i class="fa-solid fa-fingerprint"></i> Account ID: <b id="v4AccountId" class="nt">—</b><button class="v4-copy" onclick="v4copy(sellerAccountState.accountId,'Account ID copied')" title="Copy"><i class="fa-regular fa-copy"></i></button></div><div class="tx-currency-pill v4-flagpill hidden" id="v4CountryPill"></div>`);
  // withdraw page: gate banner, limit line, crypto hint, tracker
  const wf = el('txWithdrawForm');
  if (wf) {
    wf.insertAdjacentHTML('beforebegin', `<div id="v4Gate" class="tx-kyc-banner hidden" style="margin-bottom:14px;"><div class="tx-kyc-banner-text"><i class="fa-solid fa-hourglass-half"></i> <span id="v4GateText"></span></div><button class="send-btn tx-kyc-banner-btn" onclick="v4GoToTransaction()"><i class="fa-solid fa-handshake"></i> Complete transaction</button></div><div id="v4BizBanner" class="hidden"></div>`);
    const amt = el('txWdAmount'); if (amt) { amt.closest('label').insertAdjacentHTML('afterend', '<div id="v4CryptoHint" class="v4-note warn hidden"><i class="fa-solid fa-coins"></i><span id="v4CryptoHintText"></span></div><div class="v4-limit" id="v4LimitLine"></div>'); }
    wf.querySelectorAll('input').forEach((i) => i.setAttribute('autocomplete', 'off'));
    const old = el('txWithdrawalsOnlyBody'); const oldPanel = old ? old.closest('.tx-panel, table') : null;
    if (oldPanel) { const holder = oldPanel.tagName === 'TABLE' ? oldPanel.parentElement : oldPanel; holder.insertAdjacentHTML('beforeend', '<div id="v4WdTrack"></div>'); if (oldPanel.tagName === 'TABLE') oldPanel.style.display = 'none'; }
    else wf.parentElement.insertAdjacentHTML('beforeend', '<div id="v4WdTrack"></div>');
  }
  // profile page extra rows
  const prof = el('txProfileCountry'); if (prof) {
    const row = prof.closest('.tx-profile-row');
    row.insertAdjacentHTML('beforebegin', `<div class="tx-profile-row"><span>Account ID</span><b id="v4PfId" class="nt">—</b></div><div class="tx-profile-row"><span>Account type</span><b id="v4PfType">—</b></div><div class="tx-profile-row"><span>Phone</span><b id="v4PfPhone" class="nt">—</b></div>`);
    row.insertAdjacentHTML('afterend', `<div class="tx-profile-row"><span>Preferred language</span><b><button class="v4-lang-btn" onclick="v4OpenLangModal()"></button></b></div><div class="tx-profile-row"><span>Email verified</span><b id="v4PfEmailV">—</b></div><div class="tx-profile-row"><span>Account opened</span><b id="v4PfOpened">—</b></div><div class="tx-profile-row"><span>Terms &amp; Policy accepted</span><b id="v4PfTerms">—</b></div>`);
    ['txProfileName', 'txProfileEmail', 'txProfileCountry'].forEach((id) => { const e = el(id); if (e) e.classList.add('nt'); });
  }
}
const _v4RenderTxAccountUI = window.renderTxAccountUI;
window.renderTxAccountUI = function () {
  _v4RenderTxAccountUI.apply(this, arguments);
  const a = sellerAccountState; if (!a || !a.registered) return;
  v4InitAccountShell();
  const ccy = a.currency || 'USD';
  [['txAvailableBalance', a.balances.available], ['txHeldBalance', a.balances.held], ['txTotalDeposited', a.balances.totalDeposited]].forEach(([id, v]) => { const e = el(id); if (e) { e.textContent = fmtMoney(v, ccy); e.title = v4money(v, ccy); } });
  el('v4IdPill').classList.toggle('hidden', !a.accountId); el('v4AccountId').textContent = a.accountId || '—';
  const cp = el('v4CountryPill'); const c = a.countryCode ? { code: a.countryCode } : v4country(a.country);
  cp.classList.toggle('hidden', !a.country); if (a.country) cp.innerHTML = `${v4flag(c && c.code)}<span class="nt">${v4esc(a.country)}</span>`;
  const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  set('v4PfId', a.accountId || '—'); set('v4PfType', a.accountType || 'Standard account'); set('v4PfPhone', a.phone || '—');
  set('v4PfEmailV', a.emailVerified ? '✓ Verified' : 'Not verified'); set('v4PfOpened', v4fdate(a.registeredAt)); set('v4PfTerms', a.termsAcceptedAt ? `${v4fdate(a.termsAcceptedAt)} · ${a.termsVersion || ''}` : '—');
  const pc = el('txProfileCountry'); if (pc && a.country) pc.innerHTML = `${v4flag(c && c.code)} <span class="nt">${v4esc(a.country)}</span>`;
  const sub = el('txSideGroupSub'); if (sub) sub.textContent = `${a.accountType || 'Standard account'} · ${a.accountId || ''}`;
  v4RenderLangButtons();
  // disabled / re-enabled — the blocking notice is for the SELLER only, never for a Desk Officer viewing the group
  const isSeller = myRole === 'PARTY B' && !isAdminConfirmed;
  if (!isSeller) { v4close('v4DisabledModal'); }
  else if (a.disabled) {
    v4BuildAuthModals(); el('v4DisabledText').textContent = `Your Transaction Account has been disabled${a.disabledReason ? ` — ${a.disabledReason}` : ''}.`;
    el('v4DisabledMail').href = `mailto:${V4_SUPPORT}?subject=${encodeURIComponent('Account disabled - complaint - ' + (a.accountId || ''))}`;
    v4open('v4DisabledModal'); V4.wasDisabled = true;
  } else if (V4.wasDisabled) { V4.wasDisabled = false; v4close('v4DisabledModal'); toast('Your Transaction Account has been re-enabled.'); }
  v4RenderGate(); v4RenderLimitLine(); v4RenderBizBanner();
};
const _v4RenderTxDW = window.renderTxDepositsAndWithdrawals;
window.renderTxDepositsAndWithdrawals = function () {
  _v4RenderTxDW.apply(this, arguments);
  v4InitAccountShell(); v4RenderTracking(); v4RenderWdTracker();
  const live = sellerIncoming.some((i) => i.status === 'held_in_vault');
  const dot = el('v4TrackDot'); if (dot) dot.classList.toggle('hidden', !live);
  // incoming list: add a Track button + exact amounts on hover
  document.querySelectorAll('#txIncomingList .incoming-row').forEach((row, idx) => {
    const i = sellerIncoming[idx]; if (!i) return;
    const amt = row.querySelector('.incoming-amount'); if (amt) amt.title = v4money(i.amount, i.amountCurrency);
    if (!row.querySelector('.v4-track-btn') && i.tracker) row.querySelector('.incoming-main').insertAdjacentHTML('beforeend', `<button class="v4-mini-btn v4-track-btn" style="margin-top:8px;" onclick="v4TrackPayment('${i.id}')"><i class="fa-solid fa-route"></i> Track payment</button>`);
  });
};
function v4TrackPayment(id) { v4TrackId = id; setTxAccountNav('tracking'); }
const _v4SetTxAccountNav = window.setTxAccountNav;
window.setTxAccountNav = function (nav) {
  v4InitAccountShell();
  _v4SetTxAccountNav(nav);
  if (nav === 'tracking') v4RenderTracking(true);
  if (nav === 'withdraw') { v4ResetWithdrawForm(); v4RenderGate(); v4RenderLimitLine(); v4RenderBizBanner(); v4RenderWdTracker(); }
};
const _v4OpenTxAccountView = window.openTxAccountView;
window.openTxAccountView = function () { v4InitAccountShell(); _v4OpenTxAccountView.apply(this, arguments); };

function v4RenderTracking(force) {
  const sel = el('v4TrackSelect'); const body = el('v4TrackBody'); if (!sel || !body) return;
  const list = sellerIncoming.filter((i) => i.tracker);
  const sig = list.map((i) => i.id + i.status).join('|');
  if (!v4TrackId || !list.find((i) => i.id === v4TrackId)) v4TrackId = (list.find((i) => i.status === 'held_in_vault') || list[0] || {}).id || null;
  if (sig !== v4TrackSig || force) {
    v4TrackSig = sig;
    sel.innerHTML = list.map((i) => `<option value="${i.id}" data-label="${v4esc(`${i.payerName} · ${fmtMoney(i.amount, i.amountCurrency)} · ${v4fdate(i.receivedAt)}`)}">${v4esc(i.payerName)} — ${fmtMoney(i.amount, i.amountCurrency)}</option>`).join('');
    if (v4TrackId) sel.value = v4TrackId; refreshSelect(sel);
  }
  const rec = list.find((i) => i.id === v4TrackId);
  if (!rec) { body.innerHTML = '<p class="ledger-empty">No incoming payments yet. When the Desk records a payment to your account it appears here.</p>'; return; }
  const t = rec.tracker; const ccy = (sellerAccountState && sellerAccountState.currency) || rec.amountCurrency;
  const credited = t.vault === 'credited';
  const timeLine = t.activeStageTimeLeft !== undefined ? `<span class="v4-tag" style="margin-left:auto;">About ${v4dhms(t.activeStageTimeLeft)} left</span>` : '';
  body.innerHTML = `
    <div class="v4-status-line ${t.finished ? 'done' : ''}"><i class="fa-solid ${t.finished ? 'fa-circle-check' : 'fa-satellite-dish'}" style="color:${t.finished ? 'var(--accent-emerald)' : 'var(--accent-cyan)'};"></i><span>${v4esc(t.statusLine)}</span>${timeLine}</div>
    <div class="v4-stages">${t.stages.map((s) => `
      <div class="v4-stage ${s.status}"><div class="num">${s.status === 'passed' ? '<i class="fa-solid fa-check"></i>' : s.n}</div>
        <div class="body"><div class="top"><div><div class="title">${v4esc(s.title)}</div><div class="team">${v4esc(s.team)}</div></div><span class="v4-tag">${s.status === 'passed' ? 'Passed' : s.status === 'in_review' ? 'In review' : 'Queued'}</span></div>
        ${s.checks.length ? `<ul class="v4-checks">${s.checks.map((c) => `<li class="${c.done ? 'done' : ''}"><i class="fa-solid ${c.done ? 'fa-circle-check' : 'fa-circle-notch'}"></i><span class="nt">${v4esc(c.text)}</span></li>`).join('')}</ul>` : ''}</div></div>`).join('')}</div>
    <div class="v4-vault"><div><div class="v4-hint">Your vault account</div><b title="${v4money(rec.amountLedger, ccy)}">${credited ? fmtMoney(rec.amountLedger, ccy) : fmtMoney(0, ccy) + ' pending'}</b></div><span class="state ${credited ? 'ok' : 'hold'}">${credited ? 'Credited' : 'On hold'}</span></div>
    ${rec.receiptUrl ? `<div style="margin-top:12px;"><a class="send-btn" style="text-decoration:none;display:inline-flex;" href="${rec.receiptUrl}" target="_blank"><i class="fa-solid fa-file-invoice"></i> Download receipt</a></div>` : ''}`;
}

/* ---------- 7. KYC extras ---------- */
function v4InitKycShell() {
  if (el('v4KycDetails')) return;
  v4fillData();
  const grid = el('txDocTypeGrid'); if (!grid) return;
  grid.insertAdjacentHTML('afterend', `<div id="v4KycDetails" style="margin-top:14px;">
    <div class="v4-hint" style="margin-bottom:8px;">Enter the details exactly as printed on the document — we check them against your photos.</div>
    <label class="v4-field">Full name on the document<input type="text" id="v4KycName" class="message-input" autocomplete="off"></label>
    <div class="v4-row"><label class="v4-field">Document number<input type="text" id="v4KycNumber" class="message-input" autocomplete="off" placeholder="e.g. A12345678"></label><label class="v4-field">Expiry date<input type="date" id="v4KycExpiry" class="message-input"></label></div>
    <label class="v4-field">Issuing country<select id="v4KycCountry" class="message-input csel" data-countries="1" data-search="1" style="width:100%;"></select></label></div>`);
  CountryData.fill(el('v4KycCountry')); enhanceSelect(el('v4KycCountry'));
  const selfieZone = el('txKycSelfieZone');
  if (selfieZone) selfieZone.insertAdjacentHTML('beforebegin', `<button type="button" class="v4-choice-card" style="margin-bottom:12px;" onclick="v4OpenFaceCamera()"><div class="ico"><i class="fa-solid fa-camera"></i></div><div><b>Take a live selfie (face check)</b><span>Look at the camera with your whole face inside the oval. We confirm a face is visible before you submit.</span></div><i class="fa-solid fa-chevron-right go"></i></button><div class="v4-hint" id="v4FaceStatus" style="margin-bottom:8px;"></div>`);
}
const _v4OpenKyc = window.openTxKycWizard;
window.openTxKycWizard = function () {
  const st = sellerAccountState ? sellerAccountState.kyc.status : 'not_submitted';
  if (st === 'pending' || st === 'verified') return _v4OpenKyc();
  v4InitKycShell(); _v4OpenKyc();
  V4.faceCount = null; if (el('v4FaceStatus')) el('v4FaceStatus').textContent = '';
  el('v4KycName').value = (sellerAccountState && sellerAccountState.kyc.nameOnId) || (sellerAccountState && sellerAccountState.fullName) || '';
  el('v4KycNumber').value = ''; el('v4KycExpiry').value = '';
  const c = el('v4KycCountry'); c.value = (sellerAccountState && sellerAccountState.country) || ''; refreshSelect(c);
};
window.txKycWizardNext = function () {
  const totalSteps = window._txWizTotalSteps || 6;
  if (txKycStep === 0) {
    const name = el('v4KycName').value.trim(); const num = el('v4KycNumber').value.trim(); const exp = el('v4KycExpiry').value;
    if (name.length < 3) return toast('Please enter your full name exactly as it appears on the document.', true);
    if (num.replace(/[\s-]/g, '').length < 5) return toast('Please enter the document number.', true);
    if (!exp) return toast('Please enter the document expiry date.', true);
    if (new Date(exp + 'T00:00:00Z') < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) return toast('That document has expired. Please use a valid, unexpired document.', true);
    if (!el('v4KycCountry').value) return toast('Please select the issuing country.', true);
  }
  if (txKycStep === totalSteps - 1) {
    const missing = txKycStepsForDocType().filter((k) => !txKycUploads[k]);
    if (missing.length) return toast('Please upload every document before submitting.', true);
    el('txWizNextBtn').disabled = true; el('txWizNextBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking your documents…';
    socket.emit('submit-kyc', {
      groupId: activeGroupId, docType: el('txKycDocType').value, idFrontUrl: txKycUploads.idFront, idBackUrl: txKycUploads.idBack,
      proofAddressType: el('txKycProofAddressType').value, proofAddressUrl: txKycUploads.proofAddress, selfieUrl: txKycUploads.selfie,
      nameOnId: el('v4KycName').value.trim(), idNumber: el('v4KycNumber').value.trim(), idExpiry: el('v4KycExpiry').value, issuingCountry: el('v4KycCountry').value,
      selfieFaceCount: V4.faceCount
    });
    return;
  }
  const key = currentWizStepKey();
  if (key && !txKycUploads[key]) return toast('Please upload this document before continuing.', true);
  txKycStep++; renderTxKycWizard();
};
socket.on('kyc-auto-result', (r) => {
  const b = el('txWizNextBtn'); if (b) { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-upload"></i> Submit for Review'; }
  v4ensureModal('v4KycResultModal', '<div class="modal-box"><div class="modal-body" id="v4KycResultBody"></div></div>', { cls: 'v4-top' });
  closeModal('txKycWizardModal');
  el('v4KycResultBody').innerHTML = r.ok
    ? `<div class="v4-hero"><div class="badge"><i class="fa-solid fa-circle-check"></i></div><h3>Documents received</h3><p>Everything checks out. Your identity documents are now with the Desk for review — we will notify you as soon as they are approved.</p></div><div class="v4-modal-actions" style="justify-content:center;"><button class="send-btn" onclick="v4close('v4KycResultModal')"><i class="fa-solid fa-check"></i> Done</button></div>`
    : `<div class="v4-hero bad"><div class="badge"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>We could not accept these documents</h3><p>Please fix the following and submit again:</p></div><ul class="v4-reasons">${r.reasons.map((x) => `<li><i class="fa-solid fa-circle-xmark"></i><span class="nt">${v4esc(x)}</span></li>`).join('')}</ul><div class="v4-modal-actions" style="justify-content:center;"><button class="ghost-btn" onclick="v4close('v4KycResultModal')">Close</button><button class="send-btn" onclick="v4close('v4KycResultModal');openTxKycWizard();"><i class="fa-solid fa-rotate-right"></i> Fix and resubmit</button></div>`;
  v4open('v4KycResultModal');
});

// ---- live face camera with on-device face detection (where the browser supports it) ----
async function v4DetectFaces(source) {
  try { if (!('FaceDetector' in window)) return null; const fd = new FaceDetector({ fastMode: true, maxDetectedFaces: 4 }); return (await fd.detect(source)).length; } catch (e) { return null; }
}
function v4BuildCamera() {
  v4ensureModal('v4CamModal', `<div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-camera"></i> Face verification</span><i class="fa-solid fa-xmark" onclick="v4CloseCamera()"></i></div><div class="modal-body">
    <div class="v4-cam" id="v4CamBox"><video id="v4CamVideo" autoplay playsinline muted></video><div class="oval"></div><div class="tip" id="v4CamTip">Starting camera…</div></div>
    <div class="v4-hint" style="margin-top:8px;text-align:center;">Good light, no hat or sunglasses, face centred in the oval.</div>
    <div class="v4-modal-actions" style="justify-content:center;"><button class="ghost-btn" onclick="v4CloseCamera()">Cancel</button><button class="send-btn" id="v4CamShot" onclick="v4CaptureFace()" disabled><i class="fa-solid fa-camera"></i> Capture</button></div></div></div>`, { cls: 'v4-top' });
}
async function v4OpenFaceCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Camera is not available here — please upload a clear selfie instead.', true); return; }
  v4BuildCamera(); v4open('v4CamModal'); el('v4CamShot').disabled = true; el('v4CamTip').textContent = 'Starting camera…';
  try {
    V4.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    const v = el('v4CamVideo'); v.srcObject = V4.stream; await v.play().catch(() => {});
    const supported = 'FaceDetector' in window; V4.faceNow = null;
    el('v4CamTip').textContent = supported ? 'Looking for your face…' : 'Position your face in the oval, then capture';
    if (!supported) el('v4CamShot').disabled = false;
    clearInterval(V4.camTimer);
    V4.camTimer = setInterval(async () => {
      if (!supported || !v.videoWidth) return;
      const n = await v4DetectFaces(v); V4.faceNow = n;
      const ok = n === 1; el('v4CamBox').classList.toggle('ok', ok); el('v4CamShot').disabled = !ok;
      el('v4CamTip').textContent = n === 0 ? 'No face found — move into the oval' : n > 1 ? 'Only one face please' : n === 1 ? 'Face detected ✓ — hold still and capture' : 'Position your face in the oval';
    }, 500);
  } catch (e) { v4CloseCamera(); toast('We could not open your camera. Please allow camera access, or upload a selfie instead.', true); }
}
function v4CloseCamera() { clearInterval(V4.camTimer); if (V4.stream) V4.stream.getTracks().forEach((t) => t.stop()); V4.stream = null; v4close('v4CamModal'); }
async function v4CaptureFace() {
  const v = el('v4CamVideo'); if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  const faces = await v4DetectFaces(c); V4.faceCount = faces;
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  v4CloseCamera();
  const zone = el('txKycSelfieZone'); const status = el('txWizStep4Status'); const prev = el('txKycSelfiePreview');
  status.textContent = 'Uploading…'; status.className = 'tx-wizard-status busy';
  const res = await uploadRawFile(new File([blob], 'selfie.jpg', { type: 'image/jpeg' }));
  if (!res.ok) { status.textContent = '✗ ' + res.error; status.className = 'tx-wizard-status bad'; return toast(res.error, true); }
  txKycUploads.selfie = res.url; prev.src = URL.createObjectURL(blob); prev.classList.remove('hidden'); zone.classList.add('done'); zone.querySelector('.tx-upload-title').textContent = 'Captured — tap to replace';
  status.textContent = '✓ Selfie captured'; status.className = 'tx-wizard-status ok';
  if (el('v4FaceStatus')) { el('v4FaceStatus').textContent = faces === 1 ? '✓ Face verified in frame' : faces === null ? '✓ Selfie captured' : ''; el('v4FaceStatus').className = 'v4-hint ok'; }
}
const _v4KycFile = window.handleTxKycFileChosen;
window.handleTxKycFileChosen = async function (input, key) {
  const file = input.files && input.files[0];
  if (key === 'selfie' && file && file.type.startsWith('image/')) {
    try { const bmp = await createImageBitmap(file); V4.faceCount = await v4DetectFaces(bmp); } catch (e) { V4.faceCount = null; }
    if (V4.faceCount === 0) toast('We could not see a face in that photo. Please retake it with your whole face visible.', true);
  }
  return _v4KycFile(input, key);
};

// KYC button must never stay stuck if the server answers with an error instead of a result.
socket.on('error-msg', () => { const b = el('txWizNextBtn'); if (b && b.disabled) { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-upload"></i> Submit for Review'; } const s = el('v4RegSubmit'); if (s) s.disabled = false; });

/* ---------- 8. withdrawals ---------- */
function v4ResetWithdrawForm() {
  // Always start clean — nothing from an earlier visit (bank details, wallet, amount, method) is kept.
  ['txWdAmount', 'txWdDestination', 'txWdBeneficiary', 'txWdBankName', 'txWdBankAccount', 'txWdSwift'].forEach((id) => { const e = el(id); if (e) e.value = ''; });
  const set = (id, v) => { const e = el(id); if (e) { e.value = v; refreshSelect(e); } };
  set('txWithdrawMethod', 'crypto'); set('txWdAsset', 'USDT'); set('txWdNetwork', 'TRC20'); set('txWdBankCountry', '');
  if (el('txWithdrawCryptoFields')) { el('txWithdrawBankFields').style.display = 'none'; el('txWithdrawCryptoFields').style.display = 'block'; }
  const h = el('v4CryptoHint'); if (h) h.classList.add('hidden');
}
const _v4ToggleFields = window.toggleTxWithdrawFields;
window.toggleTxWithdrawFields = function () {
  const isCrypto = el('txWithdrawMethod').value === 'crypto';
  // switching method wipes the OTHER method's fields so stale details can never be re-used
  (isCrypto ? ['txWdBeneficiary', 'txWdBankName', 'txWdBankAccount', 'txWdSwift'] : ['txWdDestination']).forEach((id) => { el(id).value = ''; });
  if (!isCrypto) { el('txWdBankCountry').value = ''; refreshSelect(el('txWdBankCountry')); }
  _v4ToggleFields();
  v4CheckCrypto();
};
function v4RenderGate() {
  const g = el('v4Gate'); if (!g) return; const a = sellerAccountState;
  const show = a && a.registered && a.kyc.status === 'verified' && !a.disbursementEnabled;
  g.classList.toggle('hidden', !show);
  if (show) el('v4GateText').textContent = 'Withdrawals open once both parties are confirmed and your transaction reaches the disbursement stage. Complete your part of the transaction to unlock them.';
}
function v4RenderLimitLine() {
  const l = el('v4LimitLine'); const a = sellerAccountState; if (!l || !a) return;
  l.innerHTML = a.business.status === 'verified'
    ? '<i class="fa-solid fa-infinity" style="color:var(--accent-emerald)"></i> Business account — no daily withdrawal limit.'
    : `Daily withdrawal limit: <b>${v4money(a.dailyLimit, a.currency)}</b> in any 24 hours. Need more? <a onclick="v4OpenBusiness()">Upgrade to a business account for unlimited withdrawals</a>.`;
}
function v4RenderBizBanner() {
  const b = el('v4BizBanner'); const a = sellerAccountState; if (!b || !a) return;
  const st = a.business.status;
  b.classList.toggle('hidden', st === 'none');
  b.innerHTML = st === 'pending' ? '<div class="v4-note"><i class="fa-solid fa-building-circle-arrow-right"></i><span><b>Business application under review.</b> We will notify you as soon as it is decided.</span></div>'
    : st === 'rejected' ? `<div class="v4-note bad"><i class="fa-solid fa-building-circle-xmark"></i><span><b>Business application not approved.</b> ${v4esc(a.business.rejectionReason || '')} <a class="v4-link" onclick="v4OpenBusiness()">Apply again</a></span></div>`
    : st === 'verified' ? '<div class="v4-note ok"><i class="fa-solid fa-building-circle-check"></i><span><b>Business account approved.</b> Unlimited daily withdrawals are active.</span></div>' : '';
}
// live crypto-requirement preview — recalculated whenever the amount (or method) changes
let v4CryptoTimer = null;
function v4CheckCrypto() {
  clearTimeout(v4CryptoTimer);
  const hint = el('v4CryptoHint'); if (!hint) return;
  if (!sellerAccountState || el('txWithdrawMethod').value !== 'crypto' || sellerAccountState.cryptoDepositVerified) { hint.classList.add('hidden'); return; }
  v4CryptoTimer = setTimeout(() => { const amt = parseFloat(el('txWdAmount').value); if (!amt || amt <= 0) return hint.classList.add('hidden'); socket.emit('check-crypto-requirement', { groupId: activeGroupId, amount: amt, amountCurrency: sellerAccountState.currency }); }, 350);
}
socket.on('crypto-requirement', (r) => {
  const hint = el('v4CryptoHint'); if (!hint) return;
  if (r.allowed || r.empty) { hint.classList.add('hidden'); return; }
  el('v4CryptoHintText').innerHTML = `<b>Prior crypto deposit needed.</b> For a withdrawal this size, a verified crypto deposit of at least <b>${v4money(r.requiredAccount, r.currency)}</b> must be on file before your first crypto withdrawal${r.haveAccount ? ` (you have ${v4money(r.haveAccount, r.currency)} verified — ${v4money(r.remainingAccount, r.currency)} to go)` : ''}. Bank withdrawals are not affected. <a class="v4-link" onclick="openTxDepositModal()">Make a deposit</a>`;
  hint.classList.remove('hidden');
});
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'txWdAmount') v4CheckCrypto(); });

window.submitTxWithdrawal = function () {
  const a = sellerAccountState; if (!a) return;
  const method = el('txWithdrawMethod').value; const amount = parseFloat(el('txWdAmount').value);
  if (!amount || amount <= 0) return toast('Please enter a valid amount.', true);
  const payload = { groupId: activeGroupId, method, amount, amountCurrency: a.currency || 'USD' };
  if (method === 'bank') {
    Object.assign(payload, { beneficiaryName: el('txWdBeneficiary').value.trim(), bankName: el('txWdBankName').value.trim(), bankAccount: el('txWdBankAccount').value.trim(), bankSwift: el('txWdSwift').value.trim(), bankCountry: el('txWdBankCountry').value });
    if (!payload.beneficiaryName || !payload.bankName || !payload.bankAccount) return toast('Beneficiary name, bank name and account number / IBAN are required.', true);
  } else {
    Object.assign(payload, { asset: el('txWdAsset').value, network: el('txWdNetwork').value, destination: el('txWdDestination').value.trim() });
    if (payload.destination.length < 10) return toast('Please enter a valid destination wallet address.', true);
  }
  V4.lastWd = payload; socket.emit('request-withdrawal', payload);
};

// ---- gates ----
function v4BuildBlockModal() { v4ensureModal('v4WdBlockModal', '<div class="modal-box"><div class="modal-body" id="v4WdBlockBody"></div></div>', { cls: 'v4-top' }); }
socket.on('withdrawal-blocked', (b) => {
  v4BuildBlockModal(); const body = el('v4WdBlockBody'); const ccy = b.currency || (sellerAccountState && sellerAccountState.currency);
  if (b.reason === 'disbursement') {
    body.innerHTML = `<div class="v4-hero warn"><div class="badge"><i class="fa-solid fa-hourglass-half"></i></div><h3>${v4esc(b.title)}</h3><p>${v4esc(b.message)}</p></div>
      <div class="v4-note warn"><i class="fa-solid fa-circle-info"></i><span>Your funds are safe in your account. The Desk will open withdrawals once both parties have confirmed the transaction.</span></div>
      <div class="v4-modal-actions" style="justify-content:center;"><button class="ghost-btn" onclick="v4close('v4WdBlockModal')">Close</button><button class="send-btn" onclick="v4GoToTransaction()"><i class="fa-solid fa-handshake"></i> Complete transaction</button></div>`;
  } else if (b.reason === 'daily_limit') {
    body.innerHTML = `<div class="v4-hero warn"><div class="badge"><i class="fa-solid fa-gauge-high"></i></div><h3>${v4esc(b.title)}</h3><p>${v4esc(b.message)}</p></div>
      <div class="v4-admin-grid"><div>Daily limit<b>${v4money(b.limit, ccy)}</b></div><div>Withdrawn in the last 24h<b>${v4money(b.used, ccy)}</b></div><div>Still available today<b>${v4money(b.remaining, ccy)}</b></div><div>This request<b>${v4money(b.requested, ccy)}</b></div></div>
      <div class="v4-note"><i class="fa-solid fa-building"></i><span><b>Unlimited withdrawals</b> are available to verified business accounts. You will be asked for your company name, registration number and tax details.</span></div>
      <div class="v4-modal-actions" style="justify-content:center;"><button class="ghost-btn" onclick="v4close('v4WdBlockModal')">Close</button>${b.businessStatus === 'pending' ? '<button class="send-btn" disabled>Business application under review</button>' : '<button class="send-btn" onclick="v4close(\'v4WdBlockModal\');v4OpenBusiness()"><i class="fa-solid fa-building-circle-arrow-right"></i> Upgrade to business account</button>'}</div>`;
  } else if (b.reason === 'crypto_deposit') {
    body.innerHTML = `<div class="v4-hero warn"><div class="badge"><i class="fa-solid fa-coins"></i></div><h3>${v4esc(b.title)}</h3><p>${v4esc(b.message)}</p></div>
      <div class="v4-admin-grid"><div>Required deposit<b>${v4money(b.requiredAccount, ccy)}</b></div><div>Verified so far<b>${v4money(b.haveAccount, ccy)}</b></div><div>Still needed<b>${v4money(b.remainingAccount, ccy)}</b></div><div>Requirement<b>${b.flat ? 'Flat amount (tier ' + b.tier + ')' : Math.round((b.pct || 0) * 100) + '% of the withdrawal (tier ' + b.tier + ')'}</b></div></div>
      <div class="v4-note"><i class="fa-solid fa-circle-info"></i><span>This is a one-time check. After your first qualifying crypto deposit is verified, crypto withdrawals unlock permanently. ${b.pendingUsd > 0 ? 'You already have a crypto deposit awaiting verification.' : ''} <b>Bank withdrawals are not affected.</b></span></div>
      <div class="v4-modal-actions" style="justify-content:center;"><button class="ghost-btn" onclick="v4close('v4WdBlockModal');el('txWithdrawMethod').value='bank';refreshSelect(el('txWithdrawMethod'));toggleTxWithdrawFields();">Withdraw by bank instead</button><button class="send-btn" onclick="v4close('v4WdBlockModal');openTxDepositModal();el('txDepositAmount').value='${b.remainingAccount || ''}';"><i class="fa-solid fa-arrow-down"></i> Make a crypto deposit</button></div>`;
  }
  v4open('v4WdBlockModal');
});

// ---- email-code confirmation ----
function v4BuildCodeModal() {
  v4ensureModal('v4WdCodeModal', `<div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-envelope-open-text"></i> Confirm your withdrawal</span><i class="fa-solid fa-xmark" onclick="v4close('v4WdCodeModal')"></i></div><div class="modal-body">
    <div class="v4-note"><i class="fa-solid fa-shield-halved"></i><span id="v4WdCodeMsg">We sent a 6-digit code to your email.</span></div>
    <label class="v4-field">Security code<input type="text" inputmode="numeric" maxlength="6" id="v4WdCode" class="message-input v4-code-input" placeholder="••••••" autocomplete="one-time-code"></label>
    <div class="v4-hint">Never share this code. The Desk will never ask for it.</div>
    <div class="v4-modal-actions" style="justify-content:space-between;align-items:center;"><button class="v4-link" id="v4WdResend" onclick="socket.emit('resend-withdrawal-code',{groupId:activeGroupId})">Resend code</button><button class="send-btn" onclick="v4ConfirmWithdrawal()"><i class="fa-solid fa-check"></i> Confirm withdrawal</button></div></div></div>`, { cls: 'v4-top' });
  el('v4WdCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') v4ConfirmWithdrawal(); });
}
socket.on('withdrawal-code-sent', (d) => {
  v4BuildCodeModal(); el('v4WdCodeMsg').textContent = `We sent a 6-digit code to ${d.emailMasked || 'your email'}. It expires in 10 minutes.`; if (!d.resent) el('v4WdCode').value = '';
  v4open('v4WdCodeModal'); setTimeout(() => el('v4WdCode').focus(), 60);
  let left = d.resendInSec || 30; const b = el('v4WdResend'); b.disabled = true; clearInterval(V4.wdTimer);
  V4.wdTimer = setInterval(() => { left--; if (left <= 0 || !el('v4WdResend')) { clearInterval(V4.wdTimer); if (el('v4WdResend')) { b.disabled = false; b.textContent = 'Resend code'; } } else b.textContent = `Resend in ${left}s`; }, 1000);
  if (d.resent) toast('A new code has been sent.');
});
function v4ConfirmWithdrawal() { const c = el('v4WdCode').value.trim(); if (!/^\d{6}$/.test(c)) return toast('Please enter the 6-digit code.', true); socket.emit('confirm-withdrawal', { groupId: activeGroupId, code: c }); }
socket.on('withdrawal-created', () => { v4close('v4WdCodeModal'); v4ResetWithdrawForm(); });

// ---- business (unlimited) upgrade ----
function v4BuildBusiness() {
  if (el('v4BizModal')) return; v4fillData();
  v4ensureModal('v4BizModal', `<div class="modal-box wide"><div class="modal-header"><span><i class="fa-solid fa-building-columns"></i> Upgrade to a Business Account</span><i class="fa-solid fa-xmark" onclick="v4close('v4BizModal')"></i></div><div class="modal-body">
    <div class="v4-note"><i class="fa-solid fa-infinity"></i><span><b>Unlimited withdrawal.</b> Business accounts are not subject to the daily withdrawal limit. We verify every company before approval, so please provide accurate, current details that match your registration documents.</span></div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-building"></i> Company</div>
      <div class="v4-row"><label class="v4-field">Registered company name<input id="bzName" class="message-input"></label><label class="v4-field">Trading name (optional)<input id="bzTrading" class="message-input"></label></div>
      <div class="v4-row"><label class="v4-field">Company registration number<input id="bzReg" class="message-input"></label><label class="v4-field">Tax number (TIN / VAT)<input id="bzTax" class="message-input"></label></div>
      <div class="v4-row"><label class="v4-field">Country of incorporation<select id="bzCountry" class="message-input csel" data-countries="1" data-search="1"></select></label><label class="v4-field">Business type<select id="bzType" class="message-input csel"><option value="llc">Limited company / LLC</option><option value="corporation">Corporation</option><option value="partnership">Partnership</option><option value="sole_proprietor">Sole proprietor</option><option value="ngo">NGO / Non-profit</option><option value="other">Other</option></select></label></div>
      <div class="v4-row"><label class="v4-field">Date of incorporation<input type="date" id="bzDate" class="message-input"></label><label class="v4-field">Industry / nature of business<input id="bzIndustry" class="message-input"></label></div>
      <label class="v4-field">Registered business address<textarea id="bzAddress" class="message-input" rows="2"></textarea></label>
      <div class="v4-row"><label class="v4-field">Business email (optional)<input type="email" id="bzEmail" class="message-input"></label><label class="v4-field">Business phone (optional)<input id="bzPhone" class="message-input"></label></div>
      <label class="v4-field">Website (optional)<input id="bzSite" class="message-input"></label></div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-user-tie"></i> Director / authorised signatory</div>
      <div class="v4-row"><label class="v4-field">Full name<input id="bzDirector" class="message-input"></label><label class="v4-field">Title / position<input id="bzTitle" class="message-input" placeholder="e.g. Managing Director"></label></div></div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-scale-balanced"></i> Compliance</div>
      <label class="v4-field">Source of funds<textarea id="bzSource" class="message-input" rows="2" placeholder="Where do the funds in this account come from?"></textarea></label>
      <label class="v4-field">Expected monthly withdrawal volume<input id="bzVolume" class="message-input" placeholder="e.g. 20,000,000"></label></div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-file-arrow-up"></i> Documents</div>
      <label class="v4-field">Certificate of incorporation / business registration (required)<input type="file" id="bzCert" accept="image/*,application/pdf" class="message-input"></label>
      <label class="v4-field">Proof of business address (optional)<input type="file" id="bzAddr" accept="image/*,application/pdf" class="message-input"></label></div>
    <label class="v4-check"><input type="checkbox" id="bzDecl"><span>I declare that the information and documents provided are true and complete, and that I am authorised to apply on behalf of this business.</span></label>
    <div class="v4-modal-actions"><button class="ghost-btn" onclick="v4close('v4BizModal')">Cancel</button><button class="send-btn" id="bzSubmit" onclick="v4SubmitBusiness()"><i class="fa-solid fa-paper-plane"></i> Submit application</button></div></div></div>`);
  CountryData.fillAll(el('v4BizModal')); v4selects(el('v4BizModal'));
}
function v4OpenBusiness() {
  const a = sellerAccountState;
  if (a && a.business.status === 'pending') return toast('Your business application is already under review.');
  if (a && a.business.status === 'verified') return toast('Your business account is already approved.');
  v4BuildBusiness(); v4open('v4BizModal');
}
async function v4SubmitBusiness() {
  const g = (id) => el(id).value.trim(); const cert = el('bzCert').files[0]; const addr = el('bzAddr').files[0];
  for (const [id, label] of [['bzName', 'company name'], ['bzReg', 'registration number'], ['bzTax', 'tax number'], ['bzAddress', 'registered address'], ['bzDirector', 'director name'], ['bzIndustry', 'industry'], ['bzSource', 'source of funds'], ['bzVolume', 'expected monthly volume']]) if (!g(id)) return toast(`Please enter the ${label}.`, true);
  if (!el('bzCountry').value) return toast('Please select the country of incorporation.', true);
  if (!cert) return toast('Please upload your certificate of incorporation.', true);
  if (!el('bzDecl').checked) return toast('Please confirm the declaration.', true);
  const btn = el('bzSubmit'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
  const up = await uploadRawFile(cert); if (!up.ok) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit application'; return toast(up.error, true); }
  let addrUrl = null; if (addr) { const u2 = await uploadRawFile(addr); if (!u2.ok) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit application'; return toast(u2.error, true); } addrUrl = u2.url; }
  socket.emit('submit-business-application', { groupId: activeGroupId, companyName: g('bzName'), tradingName: g('bzTrading'), registrationNumber: g('bzReg'), taxNumber: g('bzTax'), country: el('bzCountry').value, businessType: el('bzType').value, incorporationDate: el('bzDate').value, businessAddress: g('bzAddress'), directorName: g('bzDirector'), directorTitle: g('bzTitle'), industry: g('bzIndustry'), website: g('bzSite'), sourceOfFunds: g('bzSource'), expectedMonthlyVolume: g('bzVolume'), businessEmail: g('bzEmail'), businessPhone: g('bzPhone'), acceptDeclaration: true, certificateUrl: up.url, addressProofUrl: addrUrl });
  setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit application'; }, 3000);
}
socket.on('business-submitted', (d) => { if (d && d.ok) { v4close('v4BizModal'); toast('Business application submitted — we will notify you once it is reviewed.'); } });

// ---- withdrawal tracker: horizontal stepper (deliberately unlike the incoming-funds list) ----
function v4RenderWdTracker() {
  const box = el('v4WdTrack'); if (!box) return;
  const list = sellerWithdrawals; const ccy = sellerAccountState ? sellerAccountState.currency : '';
  if (!list.length) { box.innerHTML = '<div class="tx-panel-head" style="margin-top:18px;">Withdrawal tracking</div><p class="ledger-empty">No withdrawals yet.</p>'; return; }
  box.innerHTML = '<div class="tx-panel-head" style="margin-top:22px;">Withdrawal tracking</div>' + list.map((w) => {
    const crypto = w.method === 'crypto';
    const labels = ['Submitted', 'Pending', 'Processing', w.status === 'rejected' ? 'Declined' : 'Completed'];
    const idx = { pending: 1, processing: 2, completed: 3, rejected: 3 }[w.status] ?? 1;
    const steps = labels.map((l, i) => {
      let cls = ''; let icon = i + 1;
      if (w.status === 'rejected') { if (i < 1) { cls = 'done'; icon = '<i class="fa-solid fa-check"></i>'; } else if (i === 3) { cls = 'declined'; icon = '<i class="fa-solid fa-xmark"></i>'; } else if (i <= (w.statusHistory.some((h) => h.status === 'processing') ? 2 : 1)) { cls = 'done'; icon = '<i class="fa-solid fa-check"></i>'; } }
      else if (w.status === 'completed' || i < idx) { cls = 'done'; icon = '<i class="fa-solid fa-check"></i>'; }
      else if (i === idx) cls = 'current';
      return `<div class="v4-step ${cls}"><div class="dot">${icon}</div>${l}</div>`;
    }).join('');
    const last = (w.statusHistory || []).slice(-1)[0];
    const meta = crypto
      ? `<div>Date created<b>${v4fdate(w.createdAt, true)}</b></div><div>Asset / network<b>${v4esc(w.asset)}${w.network ? ' · ' + v4esc(w.network) : ''}</b></div><div>Destination wallet<b class="nt">${v4esc(w.destination)}</b></div><div>Reference<b class="nt">${v4esc(w.ref)}</b></div>`
      : `<div>Date created<b>${v4fdate(w.createdAt, true)}</b></div><div>Beneficiary<b class="nt">${v4esc(w.beneficiaryName)}</b></div><div>Bank<b class="nt">${v4esc(w.bankName)}${w.bankCountry ? ', ' + v4esc(w.bankCountry) : ''}</b></div><div>Account<b class="nt">${v4esc(w.bankAccount)}</b></div><div>Reference<b class="nt">${v4esc(w.ref)}</b></div>`;
    return `<div class="v4-wd-card ${crypto ? 'crypto' : 'bank'}"><div class="v4-wd-top"><div class="v4-wd-title"><i class="fa-solid ${crypto ? 'fa-coins' : 'fa-building-columns'}" style="color:${crypto ? 'var(--accent-violet)' : 'var(--accent-cyan)'};"></i>${crypto ? 'Crypto withdrawal' : 'Bank transfer withdrawal'}</div><div class="v4-wd-amt" title="${v4money(w.amount, w.amountCurrency)}">${fmtMoney(w.amount, w.amountCurrency)}</div></div>
      <div class="v4-wd-meta">${meta}</div><div class="v4-stepper">${steps}</div>
      <div class="v4-hint" style="margin-top:10px;">${last ? `Last update ${v4fdate(last.at, true)}${w.statusReason ? ' — ' + v4esc(w.statusReason) : ''}` : ''}</div>
      ${w.receiptUrl ? `<div style="margin-top:10px;"><a class="v4-mini-btn" style="text-decoration:none;display:inline-block;" href="${w.receiptUrl}" target="_blank"><i class="fa-solid fa-file-invoice"></i> Download receipt</a></div>` : ''}</div>`;
  }).join('');
}

/* ---------- 9. admin ---------- */
const _v4SetAdminTab = window.setAdminTab;
window.setAdminTab = function (tab) {
  v4InitAdminShell(); _v4SetAdminTab(tab);
  if (tab === 'accounts') { socket.emit('admin-get-business-queue'); socket.emit('admin-get-crypto-tiers'); socket.emit('admin-email-status'); }
  if (tab === 'controls') v4RenderDisbControl();
};
function v4InitAdminShell() {
  const tab = el('tabAccounts'); if (!tab || el('v4BizQueue')) return;
  const kyc = el('kycQueueList') && el('kycQueueList').closest('.admin-section');
  const html = `<div class="admin-section admin-plus-only" id="v4BizSection"><span class="admin-section-label"><i class="fa-solid fa-building-columns"></i> BUSINESS ACCOUNT APPLICATIONS</span><p style="font-size:0.76rem;color:var(--text-muted);margin:0 0 8px;">Sellers who need to withdraw above the daily limit. Approving lifts the limit for that account.</p><div id="v4BizQueue"><p style="font-size:0.78rem;color:var(--text-faint);margin:0;">No pending applications.</p></div></div>
  <div class="admin-section admin-plus-only" id="v4EmailSection"><span class="admin-section-label"><i class="fa-solid fa-envelope-circle-check"></i> EMAIL DELIVERY (ZOHO)</span><div id="v4EmailStatus"><p style="font-size:0.78rem;color:var(--text-faint);margin:0;">Checking…</p></div>
    <div class="v4-btn-row" style="margin-top:8px;"><input type="email" id="v4EmailTo" class="message-input" placeholder="Send a test to…" style="max-width:220px;padding:7px 10px;font-size:0.78rem;"><button class="admin-btn" onclick="v4SendTestEmail()"><i class="fa-solid fa-paper-plane"></i> Send test email</button><button class="admin-btn" onclick="socket.emit('admin-check-deliverability');el('v4EmailDns').innerHTML='<p class=v4-hint>Checking your DNS…</p>'"><i class="fa-solid fa-shield-halved"></i> Check inbox-readiness</button><button class="admin-btn" onclick="socket.emit('admin-email-status')"><i class="fa-solid fa-rotate"></i> Refresh</button></div><div id="v4EmailDns" style="margin-top:8px;"></div></div>
  <div class="admin-section admin-plus-only" id="v4TierSection"><span class="admin-section-label"><i class="fa-solid fa-coins"></i> CRYPTO WITHDRAWAL — PRIOR DEPOSIT REQUIREMENT</span><p style="font-size:0.76rem;color:var(--text-muted);margin:0 0 8px;">A seller needs a verified crypto deposit on file before their first crypto withdrawal (one-time unlock). Amounts below are in USD equivalent. Only a Super Admin can change them.</p><div id="v4Tiers"></div></div>`;
  (kyc || tab.lastElementChild).insertAdjacentHTML('afterend', html);
  // group Controls tab: disbursement switch
  const ctl = el('tabControls');
  if (ctl) ctl.insertAdjacentHTML('afterbegin', `<div class="admin-section admin-plus-only"><span class="admin-section-label"><i class="fa-solid fa-sack-dollar"></i> DISBURSEMENT STAGE — THIS GROUP</span><p style="font-size:0.76rem;color:var(--text-muted);margin:0 0 8px;">Switch ON only when both parties are fully confirmed and the transaction is in the disbursement stage. Until then the seller cannot withdraw — they are shown a notice and a link back to this group.</p><div id="v4DisbControl"></div></div>`);
}
function v4RenderDisbControl() {
  const box = el('v4DisbControl'); if (!box) return;
  const g = (typeof allGroupsCache !== 'undefined' ? allGroupsCache : []).find((x) => x.id === activeGroupId || x.groupId === activeGroupId);
  const on = V4.disb !== undefined ? V4.disb : !!(g && g.disbursementEnabled);
  box.innerHTML = `<div class="v4-switch ${on ? 'on' : ''}" onclick="v4ToggleDisb('${activeGroupId}',${!on})"><span class="pip"></span>${on ? 'Disbursement stage: ON — seller may withdraw' : 'Disbursement stage: OFF — withdrawals locked'}</div>`;
}
function v4ToggleDisb(groupId, enable) {
  showConfirmModal({ title: enable ? 'Open withdrawals?' : 'Lock withdrawals?', message: enable ? 'Confirm that BOTH parties are fully confirmed and this transaction is in the disbursement stage. The seller will be able to withdraw their available funds.' : 'The seller will no longer be able to withdraw until you switch this back on.' }, () => socket.emit('admin-set-disbursement', { groupId, enabled: enable }));
}

// ---- header: always-visible language button + disbursement chip + init hook ----
window.v4OnInitState = function (data) {
  v4fillData(); v4selects(document);
  // header globe (visible to everyone — language selection is never hidden away)
  if (!el('v4HeaderLang')) { const bell = el('notifyToggleBtn'); if (bell) bell.insertAdjacentHTML('beforebegin', '<button class="v4-lang-btn" id="v4HeaderLang" onclick="v4OpenLangModal()" title="Language"></button>'); }
  if (!el('v4DisbChip')) { const n = el('currentGroupName'); if (n) n.insertAdjacentHTML('afterend', '<span class="v4-chip off" id="v4DisbChip" onclick="v4ChipClick()" style="cursor:default;"></span>'); }
  V4.disb = !!(data.group && data.group.disbursementEnabled); v4RenderDisbChip();
  // language: a registered seller's account language wins; otherwise keep what this device already chose
  const L = data.accountLanguage || localStorage.getItem('q_ui_lang') || (data.language && LangData.get(data.language) ? data.language : null);
  if (L && L !== V4.lang) v4SetLanguage(L, { save: false, fromServer: true }); else v4RenderLangButtons();
  if (!V4.started) { V4.started = true; v4AutoPush(); setTimeout(v4MaybeOfferLanguage, 1500); }
  v4InitAdminShell(); v4RenderDisbControl();
};
function v4RenderDisbChip() {
  const c = el('v4DisbChip'); if (!c) return;
  c.className = 'v4-chip ' + (V4.disb ? 'on' : 'off');
  c.innerHTML = `<i class="fa-solid ${V4.disb ? 'fa-circle-check' : 'fa-hourglass-half'}"></i> ${V4.disb ? 'Disbursement stage: active' : 'Disbursement: awaiting both parties'}`;
  c.title = V4.disb ? 'Both parties are confirmed — the seller may withdraw.' : 'The seller can withdraw once both parties are confirmed and the Desk opens the disbursement stage.';
  c.style.cursor = isAdminConfirmed && hasMinRoleClient(currentAdminRole, 'ADMIN') ? 'pointer' : 'default';
}
function v4ChipClick() { if (isAdminConfirmed && hasMinRoleClient(currentAdminRole, 'ADMIN')) v4ToggleDisb(activeGroupId, !V4.disb); }
socket.on('disbursement-status', (d) => { if (d.groupId === activeGroupId) { V4.disb = d.enabled; v4RenderDisbChip(); v4RenderDisbControl(); toast(d.enabled ? 'Disbursement stage reached — withdrawals are open.' : 'Disbursement stage paused.'); } });
socket.on('my-language-updated', () => {});

/* ---- keep what an admin is in the middle of choosing across live re-renders ---- */
function v4FormKey(e) { return e.id || (e.dataset && e.dataset.esc ? `${e.dataset.esc}|${e.dataset.st}|${e.dataset.u}` : null); }
function v4CaptureForm(root) {
  const m = {}; if (!root) return m;
  root.querySelectorAll('select,input,textarea').forEach((e) => { const k = v4FormKey(e); if (k && e.type !== 'file') m[k] = e.type === 'checkbox' ? e.checked : e.value; });
  return m;
}
function v4RestoreForm(root, m) {
  if (!root) return;
  root.querySelectorAll('select,input,textarea').forEach((e) => {
    const k = v4FormKey(e); if (!k || !(k in m) || e.type === 'file') return;
    if (e.type === 'checkbox') e.checked = m[k];
    else if (e.tagName === 'SELECT') { if (Array.from(e.options).some((o) => o.value === m[k])) e.value = m[k]; }
    else e.value = m[k];
  });
}

/* ---- Funds Desk modal (rebuilt) ---- */
V4.openEsc = new Set(); V4.ips = null;
function v4Sw(on, label, fn, danger) { return `<div class="v4-switch ${on ? 'on' : ''} ${danger ? 'danger' : ''}" onclick="${fn}"><span class="pip"></span>${label}</div>`; }
const _v4OpenFD = window.openFundsDeskModal;
window.openFundsDeskModal = function (groupId) { V4.ips = null; _v4OpenFD(groupId); socket.emit('admin-get-seller-ips', { groupId }); };
socket.on('seller-ips', (d) => { if (d.groupId === fundsDeskGroupId) { V4.ips = d.ips; renderFundsDeskModal(); } });
document.addEventListener('focusout', () => { if (V4.deferRender) setTimeout(() => { if (V4.deferRender && !(document.activeElement && document.activeElement.closest('#fundsDeskModal') && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) { V4.deferRender = false; renderFundsDeskModal(); } }, 120); });

function v4FdBar() {
  if (el('v4LedgerControls')) return;
  const stats = document.querySelector('#fundsDeskModal .ledger-stats-row');
  if (stats) stats.insertAdjacentHTML('beforebegin', '<div id="v4LedgerControls"></div>');
}
window.renderFundsDeskModal = function () {
  const L = fundsDeskLedgerCache; if (!L) return;
  const act = document.activeElement;
  if (act && act.closest && act.closest('#fundsDeskModal') && /INPUT|SELECT|TEXTAREA/.test(act.tagName)) { V4.deferRender = true; return; }
  v4FdBar();
  const keep = v4CaptureForm(el('fundsDeskModal'));
  const a = L.account; const ccy = a.currency || ''; const c = a.countryCode ? { code: a.countryCode } : v4country(a.country);
  el('ledgerModalTitle').innerHTML = `${v4flag(c && c.code)} <span class="nt">${v4esc(a.fullName || 'Seller')}</span> — <span class="nt">${v4esc(a.groupName)}</span>${a.disabled ? '<span class="v4-chip bad">DISABLED</span>' : ''}`;
  [['ledgerAvailable', a.balances.available], ['ledgerHeld', a.balances.held], ['ledgerTotal', a.balances.totalDeposited]].forEach(([id, v]) => { el(id).textContent = fmtMoney(v, ccy); el(id).title = v4money(v, ccy); });
  const auto = a.kyc.autoReport;
  el('v4LedgerControls').innerHTML = `
    <div class="v4-section"><div class="t"><i class="fa-solid fa-id-badge"></i> Seller profile</div>
      <div class="v4-admin-grid">
        <div>Full name<b class="nt">${v4esc(a.fullName || '—')}</b></div><div>Account ID<b class="nt">${v4esc(a.accountId || '—')}</b></div>
        <div>Email<b class="nt">${v4esc(a.email || '—')} ${a.emailVerified ? '<span class="v4-hint ok">✓ verified</span>' : ''}</b></div><div>Phone<b class="nt">${v4esc(a.phone || '—')}</b></div>
        <div>Country<b>${v4flag(c && c.code)} <span class="nt">${v4esc(a.country || '—')}</span></b></div><div>Date of birth<b>${v4esc(a.dateOfBirth || '—')}</b></div>
        <div>Account type<b>${v4esc(a.accountType)}</b></div><div>Currency<b>${v4esc(a.currency || '—')}</b></div>
        <div>Language<b>${v4esc((LangData.get(a.language) || {}).name || a.language)}</b></div><div>Password<b>${a.passwordSet ? '●●●●●●●● (set — stored hashed)' : 'Not set'}</b></div>
        <div>Registered<b>${v4fdate(a.registeredAt, true)}</b></div><div>Registered from IP<b class="nt">${v4esc(a.registeredIp || '—')}</b></div>
        <div>Terms accepted<b>${a.termsAcceptedAt ? v4fdate(a.termsAcceptedAt, true) + ' · ' + v4esc(a.termsVersion || '') : '—'}</b></div><div>KYC<b>${v4esc(String(a.kyc.status).replace(/_/g, ' '))}</b></div>
        <div>Business account<b>${v4esc(a.business.status)}</b></div><div>Daily limit<b>${a.business.status === 'verified' ? 'Unlimited' : v4money(a.dailyLimit, ccy)}</b></div>
      </div>
      ${auto ? `<div class="v4-kyc-report"><b>KYC auto-check:</b> ${auto.passed ? '<span class="v4-hint ok">passed</span>' : '<span class="v4-hint bad">rejected</span>'} ${auto.reasons && auto.reasons.length ? '— ' + auto.reasons.map(v4esc).join(' · ') : ''}</div>` : ''}
      <div class="v4-ctl-row">
        ${a.disabled ? `<div class="v4-switch danger on" onclick="v4ToggleDisabled(true)"><span class="pip"></span>Account DISABLED — click to enable</div>` : v4Sw(true, 'Account enabled — click to disable', 'v4ToggleDisabled(false)')}
        ${v4Sw(a.disbursementEnabled, a.disbursementEnabled ? 'Disbursement stage: ON' : 'Disbursement stage: OFF', `v4ToggleDisb('${a.groupId}',${!a.disbursementEnabled})`)}
        ${v4Sw(a.cryptoDepositVerified, a.cryptoDepositVerified ? 'Crypto deposit verified (override)' : 'Crypto deposit not verified', `socket.emit('admin-set-crypto-verified',{groupId:'${a.groupId}',verified:${!a.cryptoDepositVerified}})`)}
        <button class="v4-mini-btn" onclick="v4ResetPw('${a.groupId}')"><i class="fa-solid fa-key"></i> Reset password</button>
      </div>
    </div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-network-wired"></i> IP addresses &amp; access</div>${v4IpTable(a.groupId)}</div>`;
  el('ledgerIncomingList').innerHTML = L.incoming.length ? L.incoming.map((i) => v4IncomingRow(i, ccy)).join('') : '<p class="ledger-empty">No incoming funds recorded yet.</p>';
  el('ledgerWithdrawalsList').innerHTML = L.withdrawals.length ? L.withdrawals.map((w) => v4WdRow(w)).join('') : '<p class="ledger-empty">No withdrawals yet.</p>';
  v4RestoreForm(el('fundsDeskModal'), keep);
};
function v4IpTable(gid) {
  if (!V4.ips) return '<p class="ledger-empty">Loading…</p>';
  if (!V4.ips.length) return '<p class="ledger-empty">No activity recorded yet.</p>';
  return `<table class="v4-ip-table"><tr><th>IP address</th><th>Activity</th><th>First seen</th><th>Last seen</th><th></th></tr>${V4.ips.map((r) => `<tr><td class="nt"><b>${v4esc(r.ip)}</b>${r.blocked ? ' <span class="v4-chip bad">BLOCKED</span>' : ''}</td><td>${Object.entries(r.kinds || {}).map(([k, n]) => `${v4esc(k.replace('_', ' '))} ×${n}`).join(', ')}</td><td>${v4fdate(r.first_seen, true)}</td><td>${v4fdate(r.last_seen, true)}</td><td>${r.blocked ? `<button class="v4-mini-btn" onclick="socket.emit('admin-unblock-ip',{groupId:'${gid}',ip:'${v4esc(r.ip)}'})">Unblock</button>` : `<button class="v4-mini-btn" onclick="v4BlockIp('${gid}','${v4esc(r.ip)}')">Block</button>`}</td></tr>`).join('')}</table>`;
}
function v4BlockIp(gid, ip) { showPromptModal({ title: `Block ${ip}`, message: 'This IP address will no longer be able to sign in to or use this seller account. Live sessions from it are ended immediately.', placeholder: 'Reason (internal)' }, (reason) => socket.emit('admin-block-ip', { groupId: gid, ip, reason })); }
function v4ToggleDisabled(currentlyDisabled) {
  const gid = fundsDeskGroupId;
  if (currentlyDisabled) return showConfirmModal({ title: 'Enable this account?', message: 'The seller is notified and can use their Transaction Account again.' }, () => socket.emit('admin-set-seller-disabled', { groupId: gid, disabled: false }));
  showPromptModal({ title: 'Disable this account', message: 'The seller is shown a notice with the complaints address and cannot use the account until you enable it.', placeholder: 'Reason (shown to the seller)' }, (reason) => socket.emit('admin-set-seller-disabled', { groupId: gid, disabled: true, reason }));
}
function v4ResetPw(gid) { showPromptModal({ title: 'Reset seller password', message: 'Set a temporary password (8+ characters, a letter and a number). The seller is signed out everywhere and emailed.', placeholder: 'New temporary password' }, (pw) => socket.emit('admin-reset-seller-password', { groupId: gid, newPassword: pw })); }
socket.on('seller-password-reset-done', () => toast('Password reset. Share the temporary password with the seller securely.'));

function v4IncomingRow(i, ccy) {
  const st = { credited: 'enabled', reversed: 'disabled' }[i.status] || 'warn';
  const e = i.escrow; const open = V4.openEsc.has(i.id);
  return `<div class="ledger-row"><div class="ledger-row-main"><div class="ledger-row-top"><div><div class="ledger-row-title nt">${v4esc(i.payerName)}${i.payerCompany ? ' · ' + v4esc(i.payerCompany) : ''}</div><div class="ledger-row-sub">${v4esc(METHOD_LABEL[i.method] || i.method)}${i.asset ? ' · ' + v4esc(i.asset) : ''} · ${v4fdate(i.receivedAt, true)} · <span class="tx-status-badge ${st}" style="padding:2px 8px;font-size:0.64rem;">${v4esc(INCOMING_STATUS_LABEL[i.status] || i.status)}</span> · <span class="nt">${v4esc(i.ref)}</span></div></div><div class="ledger-row-amount" title="${v4money(i.amount, i.amountCurrency)}">${fmtMoney(i.amount, i.amountCurrency)}${i.amountCurrency !== ccy ? `<small style="display:block;color:var(--text-faint);font-size:0.68rem;">≈ ${fmtMoney(i.amountLedger, ccy)}</small>` : ''}</div></div>
    <div class="v4-admin-grid" style="margin-top:8px;">${i.payerEmail ? `<div>Payer email<b class="nt">${v4esc(i.payerEmail)}</b></div>` : ''}${i.payerPhone ? `<div>Payer phone<b class="nt">${v4esc(i.payerPhone)}</b></div>` : ''}${i.payerCountry ? `<div>Payer country<b>${v4esc(i.payerCountry)}</b></div>` : ''}${i.payerBank ? `<div>Payer bank<b class="nt">${v4esc(i.payerBank)}</b></div>` : ''}${i.orderRef ? `<div>Order / invoice<b class="nt">${v4esc(i.orderRef)}</b></div>` : ''}${i.externalRef ? `<div>Bank ref / hash<b class="nt">${v4esc(i.externalRef)}</b></div>` : ''}<div>For<b>${v4esc(i.purpose)}</b></div></div>
    ${i.internalNote ? `<div class="ledger-row-note"><i class="fa-solid fa-note-sticky"></i> Internal: ${v4esc(i.internalNote)} ${i.buyerVisibleNote ? '<span class="v4-chip on">buyer can see</span>' : '<span class="v4-chip">internal only</span>'}</div>` : ''}
    ${i.proofUrl ? `<div style="margin-top:6px;"><a href="${i.proofUrl}" target="_blank" style="color:var(--accent-cyan);font-size:0.74rem;"><i class="fa-solid fa-paperclip"></i> View proof of payment</a></div>` : ''}
    <div class="ledger-row-actions">${incomingRowActionsHtml(i)}${e ? `<button class="v4-mini-btn" onclick="v4ToggleEsc('${i.id}')"><i class="fa-solid fa-sliders"></i> Escrow review ${open ? '▲' : '▼'}</button>` : ''}</div>
    ${e && open ? v4EscrowConsole(i) : (e ? v4MiniEscrow(e) : '')}</div></div>`;
}
function v4MiniEscrow(e) { return `<div class="v4-mini-stages" title="${v4esc(e.statusLine)}">${e.stages.map((s) => `<i class="${s.status}"></i>`).join('')}</div><div class="v4-hint">${v4esc(e.statusLine)}${e.finished ? '' : ' · ' + (e.mode === 'manual' ? 'manual review' : e.paused ? 'paused' : 'automatic · ' + v4dhms(e.totalSecondsLeft) + ' left')}</div>`; }
function v4ToggleEsc(id) { V4.openEsc.has(id) ? V4.openEsc.delete(id) : V4.openEsc.add(id); renderFundsDeskModal(); }
function v4Esc(id, action, value) { socket.emit('admin-escrow-action', { id, action, value }); }
function v4EscrowConsole(i) {
  const e = i.escrow; const live = i.status === 'held_in_vault' && !e.finished; const id = i.id;
  const spd = [[1, '1x'], [10, '10x'], [60, '60x'], [600, '600x'], [3600, '3600x'], ['fit', 'Auto-fit']];
  const fmtSpeed = e.speed > 1 && !spd.some(([v]) => v === e.speed) ? `${Math.round(e.speed)}x (auto-fit)` : `${e.speed}x`;
  return `<div class="v4-escrow"><h5><span><i class="fa-solid fa-shield-halved"></i> Escrow payment review</span><span class="v4-hint">${e.finished ? 'Finished' : 'Stage ' + e.stage + ' of 5'}</span></h5>
    ${v4MiniEscrow(e)}
    <div class="v4-admin-grid" style="margin-bottom:6px;">${e.stages.map((s) => `<div>${s.n}. ${v4esc(s.title)}<b>${s.status === 'passed' ? '✓ Passed' : s.status === 'in_review' ? '● In review — ' + e.checksDone + '/' + e.checksPerStage[s.n - 1] + ' checks' : 'Queued'} · ${v4dhms(e.timersSeconds[s.n - 1])}</b></div>`).join('')}</div>
    ${live ? `
    <div class="v4-btn-row"><span class="v4-hint" style="align-self:center;">Mode:</span>
      <button class="v4-mini-btn ${e.mode === 'auto' ? 'on' : ''}" ${e.mode === 'auto' ? 'style="border-color:var(--accent-emerald);color:var(--accent-emerald)"' : ''} onclick="v4Esc('${id}','mode','auto')">Automatic</button>
      <button class="v4-mini-btn" ${e.mode === 'manual' ? 'style="border-color:var(--accent-emerald);color:var(--accent-emerald)"' : ''} onclick="v4Esc('${id}','mode','manual')">Manual review</button>
      ${e.paused ? `<button class="v4-mini-btn" onclick="v4Esc('${id}','resume')"><i class="fa-solid fa-play"></i> Resume</button>` : `<button class="v4-mini-btn" onclick="v4Esc('${id}','pause')"><i class="fa-solid fa-pause"></i> Pause</button>`}
      <button class="v4-mini-btn" onclick="v4Esc('${id}','skip')"><i class="fa-solid fa-forward-step"></i> Skip stage</button>
      <button class="v4-mini-btn" onclick="if(confirm('Restart this review from stage 1?'))v4Esc('${id}','restart')"><i class="fa-solid fa-rotate-left"></i> Restart</button></div>
    ${e.mode === 'manual' ? `<div class="v4-btn-row"><button class="v4-mini-btn" onclick="v4Esc('${id}','confirm-check')"><i class="fa-solid fa-square-check"></i> Confirm check (${e.checksDone}/${e.checksPerStage[e.stage - 1]})</button><button class="v4-mini-btn" onclick="v4Esc('${id}','approve-stage')"><i class="fa-solid fa-circle-check"></i> Approve stage</button></div>` : `
    <div class="v4-btn-row"><span class="v4-hint" style="align-self:center;">Speed up time (now ${fmtSpeed}):</span>${spd.map(([v, l]) => `<button class="v4-mini-btn" onclick="v4Esc('${id}','speed',${typeof v === 'string' ? `'${v}'` : v})">${l}</button>`).join('')}</div>
    <div class="v4-btn-row"><span class="v4-hint" style="align-self:center;">Complete the whole review in:</span>${[['6h', '6 hours'], ['1d', '1 day'], ['2d', '2 days'], ['7d', '7 days']].map(([v, l]) => `<button class="v4-mini-btn" onclick="v4Esc('${id}','timers',{quick:'${v}'})">${l}</button>`).join('')}<input type="datetime-local" class="message-input" style="max-width:200px;padding:6px 8px;font-size:0.74rem;" id="esc-by-${id}"><button class="v4-mini-btn" onclick="v4EscBy('${id}')">Complete by date</button></div>
    <div class="v4-hint">Or set exact time per stage (days / hours / minutes / seconds):</div>
    <div class="v4-timer-grid">${e.timersDhms.map((t, k) => `<label>${k + 1}. ${v4esc(e.stages[k].title.split(' ')[0])}<span style="display:flex;gap:2px;">${['d', 'h', 'm', 's'].map((u) => `<input type="number" min="0" value="${t[u]}" data-esc="${id}" data-st="${k}" data-u="${u}" title="${u}">`).join('')}</span></label>`).join('')}</div>
    <div class="v4-btn-row"><button class="v4-mini-btn" onclick="v4EscApplyTimers('${id}')">Apply stage times</button></div>`}
    <div class="v4-ctl-row">${v4Sw(e.showTimeToSeller, 'Show estimated time left to the seller', `v4Esc('${id}','show-time',${!e.showTimeToSeller})`)}</div>` : ''}
    <details style="margin-top:6px;"><summary class="v4-hint" style="cursor:pointer;">Review log</summary><div class="v4-hint" style="margin-top:4px;line-height:1.6;">${(e.log || []).slice().reverse().map((l) => `${v4fdate(l.at, true)} — ${v4esc(l.event)}`).join('<br>')}</div></details></div>`;
}
function v4EscBy(id) { const v = el('esc-by-' + id).value; if (!v) return toast('Pick a date and time first.', true); v4Esc(id, 'timers', { completeBy: new Date(v).toISOString() }); }
function v4EscApplyTimers(id) {
  const per = [0, 1, 2, 3, 4].map((k) => { const o = {}; ['d', 'h', 'm', 's'].forEach((u) => { o[u] = parseInt(document.querySelector(`input[data-esc="${id}"][data-st="${k}"][data-u="${u}"]`).value, 10) || 0; }); return o; });
  for (const t of per) if (t.h > 23 || t.m > 59 || t.s > 59) return toast('Hours up to 23, minutes and seconds up to 59.', true);
  v4Esc(id, 'timers', { perStage: per });
}

// ---- withdrawals: the admin may pick ANY of the four stages — one explicit button per stage ----
// (No dropdown-then-apply: what is clicked is exactly what is sent, so a live refresh can never swap the choice.)
window.withdrawalRowActionsHtml = function (w) {
  if (w.status === 'completed') return '<span class="v4-hint"><i class="fa-solid fa-lock"></i> Completed — final</span>';
  const stages = [['pending', 'Pending', 'fa-hourglass-half'], ['processing', 'Processing', 'fa-gears'], ['completed', 'Completed', 'fa-circle-check'], ['rejected', 'Declined', 'fa-ban']]
    .filter(([v]) => v !== w.status && !(w.status === 'rejected' && v === 'completed'));
  return `<span class="v4-wd-stage-sel"><span class="v4-hint">Move to:</span>${stages.map(([v, l, ic]) => `<button class="admin-btn ${v === 'rejected' ? 'admin-btn-danger' : ''}" data-stage="${v}" onclick="v4SetWdStage('${w.id}','${v}')"><i class="fa-solid ${ic}"></i> ${l}</button>`).join('')}</span>`;
};
function v4SetWdStage(id, to) {
  if (to === 'completed') return showConfirmModal({ title: 'Mark as completed?', message: 'This confirms the payout was sent. A completed withdrawal is final and cannot be changed.' }, () => adminAdvanceWithdrawal(id, 'completed', false));
  adminAdvanceWithdrawal(id, to, to === 'rejected');
}
function v4WdRow(w) {
  const crypto = w.method === 'crypto'; const st = statusPillClass(w.status);
  return `<div class="ledger-row"><div class="ledger-row-main"><div class="ledger-row-top"><div><div class="ledger-row-title">${crypto ? v4esc(w.asset) + ' withdrawal' : 'Bank withdrawal'} · <span class="nt">${v4esc(w.ref)}</span></div>
    <div class="ledger-row-sub">${v4fdate(w.createdAt, true)} · <span class="tx-status-badge ${st}" style="padding:2px 8px;font-size:0.64rem;">${v4esc(statusLabelText(w.status))}</span>${w.ip ? ` · IP <span class="nt">${v4esc(w.ip)}</span>` : ''}${w.confirmedAt ? ' · email-code confirmed' : ''}</div></div><div class="ledger-row-amount" title="${v4money(w.amount, w.amountCurrency)}">${fmtMoney(w.amount, w.amountCurrency)}</div></div>
    <div class="v4-admin-grid" style="margin-top:8px;">${crypto ? `<div>Network<b>${v4esc(w.network || '—')}</b></div><div>Wallet<b class="nt">${v4esc(w.destination)}</b></div>` : `<div>Beneficiary<b class="nt">${v4esc(w.beneficiaryName)}</b></div><div>Bank<b class="nt">${v4esc(w.bankName)}${w.bankCountry ? ', ' + v4esc(w.bankCountry) : ''}</b></div><div>Account / IBAN<b class="nt">${v4esc(w.bankAccount)}</b></div><div>SWIFT / sort<b class="nt">${v4esc(w.bankSwift || '—')}</b></div>`}</div>
    ${w.statusReason ? `<div class="ledger-row-note"><i class="fa-solid fa-note-sticky"></i> ${v4esc(w.statusReason)}</div>` : ''}<div class="ledger-row-actions">${withdrawalRowActionsHtml(w)}</div></div></div>`;
}

/* ---- Record Incoming Funds (rebuilt) ---- */
function v4BuildRecordFunds() {
  if (el('rfPayerName')) return; v4fillData();
  v4ensureModal('recordFundsModal', `<div class="modal-box wide"><div class="modal-header"><span><i class="fa-solid fa-circle-plus"></i> Record incoming funds — <span id="recordFundsSellerLabel" class="nt">seller</span></span><i class="fa-solid fa-xmark" onclick="closeModal('recordFundsModal')"></i></div><div class="modal-body">
    <div class="v4-section"><div class="t"><i class="fa-solid fa-user"></i> Payer</div>
      <div class="v4-row"><label class="v4-field">Payer name<input id="rfPayerName" class="message-input" placeholder="Who sent the payment"></label><label class="v4-field">Company (optional)<input id="rfPayerCompany" class="message-input"></label></div>
      <div class="v4-row"><label class="v4-field">Payer email (optional)<input id="rfPayerEmail" type="email" class="message-input"></label><label class="v4-field">Payer phone (optional)<input id="rfPayerPhone" class="message-input"></label></div>
      <div class="v4-row"><label class="v4-field">Payer country<select id="rfPayerCountry" class="message-input csel" data-countries="1" data-search="1" data-placeholder="Select country"></select></label><label class="v4-field">Payer bank (optional)<input id="rfPayerBank" class="message-input"></label></div></div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-money-check-dollar"></i> Payment</div>
      <div class="v4-row"><label class="v4-field">Method<select id="rfMethod" class="message-input csel" onchange="toggleRecordFundsFields()"><option value="bank_transfer">Bank transfer</option><option value="wire">Wire transfer (SWIFT)</option><option value="crypto">Cryptocurrency</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
        <label class="v4-field">Date &amp; time received<input id="rfReceivedAt" type="datetime-local" class="message-input"></label></div>
      <div class="v4-row" id="rfCryptoFields" style="display:none;"><label class="v4-field">Asset<select id="rfAsset" class="message-input csel"><option value="USDT">USDT</option><option value="BTC">BTC</option><option value="ETH">ETH</option></select></label><label class="v4-field">Network<input id="rfNetwork" class="message-input" placeholder="e.g. TRC20"></label></div>
      <div class="v4-row"><label class="v4-field">Amount received<input id="rfAmount" type="number" min="0" step="0.01" class="message-input" placeholder="0.00" oninput="v4RfPreview()"></label><label class="v4-field">Currency<select id="rfCurrency" class="message-input csel" onchange="v4RfPreview()"><option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option></select></label></div>
      <div class="v4-hint" id="rfPreview" style="margin:-4px 0 10px;"></div>
      <div class="v4-row"><label class="v4-field">Order / invoice reference<input id="rfOrderRef" class="message-input" placeholder="e.g. PO-1043"></label><label class="v4-field">Bank reference / transaction hash<input id="rfExternalRef" class="message-input"></label></div>
      <label class="v4-field">What is the payment for?<input id="rfPurpose" class="message-input" placeholder="e.g. Invoice 1001 — 40ft container of goods"></label></div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-vault"></i> Treatment &amp; escrow review</div>
      <label class="v4-field">What happens to the funds?<select id="rfTreatment" class="message-input csel" onchange="toggleRecordFundsFields()"><option value="hold">Hold in vault — run the 5-stage escrow review, then release automatically</option><option value="credit">Credit now — available to the seller immediately</option></select></label>
      <div id="rfEscrowBox"><div class="v4-row"><label class="v4-field">Review mode<select id="rfEscMode" class="message-input csel"><option value="auto">Automatic — timers move it along</option><option value="manual">Manual — the Desk approves each stage</option></select></label>
        <label class="v4-field">Complete the review in<select id="rfEscQuick" class="message-input csel"><option value="6h">6 hours</option><option value="1d" selected>1 day</option><option value="2d">2 days</option><option value="7d">7 days</option></select></label></div>
        <label class="v4-field">…or complete by a date (optional)<input type="datetime-local" id="rfEscBy" class="message-input"></label>
        <label class="v4-check"><input type="checkbox" id="rfEscShow"><span>Show the seller a rough "time left" for the active stage (off = they see no timing at all)</span></label>
        <div class="v4-hint" style="margin-top:6px;">The seller sees the payment move through the stages live in <b>Tracking Payment</b>. Funds stay in the vault until the review finishes, whatever the transaction status.</div></div></div>
    <div class="v4-section"><div class="t"><i class="fa-solid fa-note-sticky"></i> Notes &amp; proof</div>
      <label class="v4-field">Proof of payment (optional)<input type="file" id="rfProof" accept="image/*,application/pdf" class="message-input"></label>
      <label class="v4-field">Internal note<textarea id="rfInternalNote" class="message-input" rows="2" placeholder="Visible to the Desk only — unless you release it to the buyer below"></textarea></label>
      <label class="v4-check"><input type="checkbox" id="rfBuyerSees"><span>Let the <b>buyer</b> see this note (sent to them privately in the group chat — the seller does not see it)</span></label>
      <label class="v4-check" style="margin-top:8px;"><input type="checkbox" id="rfNotifySeller" checked><span>Notify the seller (push + email) that funds were recorded</span></label></div>
    <div class="v4-modal-actions"><button class="ghost-btn" onclick="closeModal('recordFundsModal')">Cancel</button><button class="send-btn" id="rfSubmitBtn" onclick="submitRecordFunds()"><i class="fa-solid fa-check"></i> Record funds</button></div></div></div>`);
  CountryData.fillAll(el('recordFundsModal')); v4selects(el('recordFundsModal'));
}
window.openRecordFundsModal = function () {
  if (!fundsDeskGroupId) return; v4BuildRecordFunds();
  const s = fundsOverviewCache.find((x) => x.groupId === fundsDeskGroupId);
  el('recordFundsSellerLabel').textContent = s ? s.sellerName : 'seller';
  ['rfPayerName', 'rfPayerCompany', 'rfPayerEmail', 'rfPayerPhone', 'rfPayerBank', 'rfPurpose', 'rfExternalRef', 'rfOrderRef', 'rfInternalNote', 'rfAmount', 'rfReceivedAt', 'rfEscBy', 'rfProof', 'rfNetwork'].forEach((id) => { el(id).value = ''; });
  const set = (id, v) => { el(id).value = v; refreshSelect(el(id)); };
  set('rfPayerCountry', ''); set('rfMethod', 'bank_transfer'); set('rfAsset', 'USDT'); set('rfCurrency', (s && s.currency) || 'USD'); set('rfTreatment', 'hold'); set('rfEscMode', 'auto'); set('rfEscQuick', '1d');
  el('rfBuyerSees').checked = false; el('rfNotifySeller').checked = true; el('rfEscShow').checked = false; el('rfPreview').textContent = '';
  toggleRecordFundsFields(); v4open('recordFundsModal');
};
window.toggleRecordFundsFields = function () { el('rfCryptoFields').style.display = el('rfMethod').value === 'crypto' ? 'flex' : 'none'; el('rfEscrowBox').style.display = el('rfTreatment').value === 'hold' ? 'block' : 'none'; };
function v4RfPreview() {
  const a = parseFloat(el('rfAmount').value); const s = fundsOverviewCache.find((x) => x.groupId === fundsDeskGroupId); const p = el('rfPreview');
  if (!a || a <= 0 || !s || !s.currency) { p.textContent = ''; return; }
  const from = el('rfCurrency').value; const to = s.currency;
  const usd = { USD: 1, GBP: 1.27, EUR: 1.09 }; const conv = Math.round(a * usd[from] / usd[to] * 100) / 100;
  p.textContent = from === to ? `Credited as ${v4money(a, to)}` : `≈ ${v4money(conv, to)} in the seller's ${to} account (indicative rate)`;
}
window.submitRecordFunds = async function () {
  if (!fundsDeskGroupId) return;
  const g = (id) => el(id).value.trim(); const amount = parseFloat(el('rfAmount').value); const method = el('rfMethod').value;
  if (!g('rfPayerName')) return toast('Please enter who the payment is from.', true);
  if (!g('rfPurpose')) return toast('Please describe what the payment is for.', true);
  if (!Number.isFinite(amount) || amount <= 0) return toast('Please enter a valid amount.', true);
  const btn = el('rfSubmitBtn'); btn.disabled = true;
  let proofUrl = null; const f = el('rfProof').files[0];
  if (f) { const up = await uploadRawFile(f); if (!up.ok) { btn.disabled = false; return toast(up.error, true); } proofUrl = up.url; }
  const payload = { groupId: fundsDeskGroupId, payerName: g('rfPayerName'), payerCompany: g('rfPayerCompany'), payerEmail: g('rfPayerEmail'), payerPhone: g('rfPayerPhone'), payerCountry: el('rfPayerCountry').value, payerBank: g('rfPayerBank'),
    method, amount, amountCurrency: el('rfCurrency').value, orderRef: g('rfOrderRef'), externalRef: g('rfExternalRef'), purpose: g('rfPurpose'), treatment: el('rfTreatment').value,
    internalNote: g('rfInternalNote'), buyerVisibleNote: el('rfBuyerSees').checked, notifySeller: el('rfNotifySeller').checked, proofUrl };
  if (method === 'crypto') { payload.asset = el('rfAsset').value; payload.network = g('rfNetwork'); }
  if (el('rfReceivedAt').value) payload.receivedAt = new Date(el('rfReceivedAt').value).toISOString();
  if (payload.treatment === 'hold') payload.escrow = { mode: el('rfEscMode').value, showTime: el('rfEscShow').checked, ...(el('rfEscBy').value ? { completeBy: new Date(el('rfEscBy').value).toISOString() } : { quick: el('rfEscQuick').value }) };
  socket.emit('admin-record-incoming-funds', payload);
  setTimeout(() => { btn.disabled = false; }, 2500);
};

/* ---- KYC queue (shows everything the reviewer needs) ---- */
window.renderKycQueue = function () {
  const box = el('kycQueueList'); if (!box) return;
  box.innerHTML = kycQueueCache.length ? kycQueueCache.map((a) => { const c = v4country(a.country); const r = a.kyc.autoReport; return `
    <div class="v4-section" style="padding:10px;">
      <div style="font-weight:800;font-size:0.8rem;">${v4flag(c && c.code)} <span class="nt">${v4esc(a.fullName || 'Unnamed')}</span> — <span class="nt">${v4esc(a.email || '')}</span> · ID <span class="nt">${v4esc(a.accountId || '—')}</span></div>
      <div class="v4-admin-grid" style="margin-top:8px;"><div>Name on document<b class="nt">${v4esc(a.kyc.nameOnId || '—')}</b></div><div>Document<b>${v4esc(String(a.kyc.docType || '').replace(/_/g, ' '))} · <span class="nt">${v4esc(a.kyc.idNumber || '')}</span></b></div><div>Expiry<b>${v4esc(a.kyc.idExpiry || '—')}</b></div><div>Issued by<b>${v4esc(a.kyc.issuingCountry || '—')}</b></div><div>Phone<b class="nt">${v4esc(a.phone || '—')}</b></div><div>Country<b>${v4esc(a.country || '—')}</b></div></div>
      <div class="v4-kyc-report">Auto-check: ${r && r.passed ? '<span class="v4-hint ok">passed</span>' : '—'} ${r && r.notes ? '· ' + r.notes.map(v4esc).join(' · ') : ''}</div>
      ${v4FaceBadge(r)}
      <div style="font-size:0.74rem;margin:6px 0;"><a href="${a.kyc.idFrontUrl}" target="_blank" style="color:var(--accent-cyan);">ID front</a>${a.kyc.idBackUrl ? ` · <a href="${a.kyc.idBackUrl}" target="_blank" style="color:var(--accent-cyan);">back</a>` : ''} · <a href="${a.kyc.proofAddressUrl}" target="_blank" style="color:var(--accent-cyan);">address</a> · <a href="${a.kyc.selfieUrl}" target="_blank" style="color:var(--accent-cyan);">selfie</a> <span class="v4-hint">(compare the selfie with the ID photo)</span></div>
      <div class="v4-btn-row"><button class="admin-btn" onclick="adminReviewKyc('${a.groupId}','verified')"><i class="fa-solid fa-check"></i> Verify</button><button class="admin-btn admin-btn-danger" onclick="adminReviewKyc('${a.groupId}','rejected')"><i class="fa-solid fa-xmark"></i> Reject</button></div></div>`; }).join('') : '<p style="font-size:0.78rem;color:var(--text-faint);margin:0;">No pending KYC submissions.</p>';
  updateAccountsTabBadge();
};

/* ---- email status / test / deliverability ---- */
function v4SendTestEmail() { const to = el('v4EmailTo').value.trim(); if (!isValidEmailClient(to)) return toast('Enter the email address to send the test to.', true); toast('Sending test email…'); socket.emit('admin-send-test-email', { to }); }
socket.on('email-status', (st) => {
  const box = el('v4EmailStatus'); if (!box) return;
  const cls = !st.configured ? 'bad' : st.working ? 'ok' : st.checking ? 'warn' : 'bad';
  const head = !st.configured ? 'Not set up — emails are only printed in the server log, and security codes are OFF.' : st.working ? 'Connected — emails are being sent.' : st.checking ? 'Checking the mail server…' : 'Not working — see below. Security codes are OFF until this is fixed.';
  box.innerHTML = `<div class="v4-note ${cls}"><i class="fa-solid ${cls === 'ok' ? 'fa-circle-check' : cls === 'warn' ? 'fa-spinner fa-spin' : 'fa-triangle-exclamation'}"></i><span><b>${v4esc(head)}</b>${st.working ? `<br>Server: <span class="nt">${v4esc(st.server)}</span> · Sending as: <span class="nt">${v4esc(st.from)}</span><br>Security codes: ${st.codesRequired ? '<b>required</b> for registration and withdrawals' : 'not required'}` : ''}${st.error && !st.working ? `<br>${v4esc(st.error)}` : ''}${!st.working && st.tried && st.tried.length ? `<br><span class="v4-hint">Tried: ${st.tried.map((t) => v4esc(t.server)).join(', ')}</span>` : ''}</span></div>`;
});
socket.on('email-test-result', (r) => { toast(r.ok ? `Test email sent to ${r.to} — check the inbox (and Spam).` : `Test failed: ${r.error}`, !r.ok); });
socket.on('email-deliverability', (d) => {
  const box = el('v4EmailDns'); if (!box) return;
  box.innerHTML = `<div class="v4-hint" style="margin-bottom:6px;">Sending domain: <b class="nt">${v4esc(d.domain)}</b></div>` + d.checks.map((c) => `<div class="v4-note ${c.ok ? 'ok' : 'bad'}" style="margin:4px 0;"><i class="fa-solid ${c.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i><span><b>${v4esc(c.name)}</b> — ${c.ok ? 'OK' : 'needs fixing'}${c.found ? `<br><span class="v4-hint nt" style="word-break:break-all;">${v4esc(c.found)}</span>` : ''}${c.fix ? `<br>${v4esc(c.fix)}` : ''}</span></div>`).join('') + `<div class="v4-hint" style="margin-top:6px;"><b>${v4esc(d.summary)}</b></div>`;
});

function v4FaceBadge(r) {
  const f = r && r.faceMatch;
  if (!f || f.available === false) return '<div class="v4-note warn" style="margin:6px 0;"><i class="fa-solid fa-user-magnifying-glass"></i><span><b>Face match: not run automatically</b> — compare the selfie with the ID photo yourself before approving.</span></div>';
  const tone = { strong: 'ok', good: 'ok', low: 'warn', mismatch: 'bad' }[f.level] || 'warn';
  const word = { strong: 'Strong match', good: 'Good match', low: 'Low-confidence match — look closely before approving', mismatch: 'Mismatch' }[f.level] || 'Unknown';
  return `<div class="v4-note ${tone}" style="margin:6px 0;"><i class="fa-solid fa-face-smile"></i><span><b>Face match: ${word}</b> <span class="v4-hint">(distance ${f.distance} — lower is more alike; automatic check by open-source model, you give the final approval)</span></span></div>`;
}

/* ---- business queue + crypto tiers ---- */
V4.bizQueue = [];
socket.on('business-queue-list', (l) => { V4.bizQueue = l; v4RenderBizQueue(); });
socket.on('business-submitted', (a) => { if (a && a.groupId && !V4.bizQueue.find((x) => x.groupId === a.groupId)) { V4.bizQueue.unshift(a); v4RenderBizQueue(); } });
socket.on('business-resolved', (a) => { V4.bizQueue = V4.bizQueue.filter((x) => x.groupId !== a.groupId); v4RenderBizQueue(); });
function v4RenderBizQueue() {
  const box = el('v4BizQueue'); if (!box) return;
  box.innerHTML = V4.bizQueue.length ? V4.bizQueue.map((a) => { const d = a.business.data || {}; return `<div class="v4-section" style="padding:10px;"><div style="font-weight:800;font-size:0.8rem;"><span class="nt">${v4esc(d.companyName || '')}</span> — seller <span class="nt">${v4esc(a.fullName || '')}</span> · ID <span class="nt">${v4esc(a.accountId || '')}</span></div>
    <div class="v4-admin-grid" style="margin-top:8px;"><div>Registration no.<b class="nt">${v4esc(d.registrationNumber)}</b></div><div>Tax number<b class="nt">${v4esc(d.taxNumber)}</b></div><div>Country<b>${v4esc(d.country)}</b></div><div>Type<b>${v4esc(d.businessType)}</b></div><div>Incorporated<b>${v4esc(d.incorporationDate || '—')}</b></div><div>Industry<b>${v4esc(d.industry)}</b></div><div>Director<b class="nt">${v4esc(d.directorName)} ${d.directorTitle ? '· ' + v4esc(d.directorTitle) : ''}</b></div><div>Expected volume<b>${v4esc(d.expectedMonthlyVolume)}</b></div></div>
    <div class="v4-hint" style="line-height:1.5;">Address: ${v4esc(d.businessAddress)}<br>Source of funds: ${v4esc(d.sourceOfFunds)}${d.website ? '<br>Website: ' + v4esc(d.website) : ''}</div>
    <div style="font-size:0.74rem;margin:6px 0;"><a href="${v4esc(d.certificateUrl)}" target="_blank" style="color:var(--accent-cyan);">Certificate of incorporation</a>${d.addressProofUrl ? ` · <a href="${v4esc(d.addressProofUrl)}" target="_blank" style="color:var(--accent-cyan);">Address proof</a>` : ''}</div>
    <div class="v4-btn-row"><button class="admin-btn" onclick="socket.emit('admin-review-business',{groupId:'${a.groupId}',decision:'verified'})"><i class="fa-solid fa-check"></i> Approve</button><button class="admin-btn admin-btn-danger" onclick="v4RejectBiz('${a.groupId}')"><i class="fa-solid fa-xmark"></i> Reject</button></div></div>`; }).join('') : '<p style="font-size:0.78rem;color:var(--text-faint);margin:0;">No pending applications.</p>';
  const dot = el('accountsTabDot'); if (dot && V4.bizQueue.length) dot.classList.remove('hidden');
}
function v4RejectBiz(gid) { showPromptModal({ title: 'Reject business application', placeholder: 'Reason (shown to the seller)' }, (reason) => socket.emit('admin-review-business', { groupId: gid, decision: 'rejected', reason })); }
socket.on('crypto-tiers', (d) => {
  const box = el('v4Tiers'); if (!box) return; V4.tiersData = d; const T = d.tiers; const R = d.ranges; const ed = d.canEdit;
  const names = ['Under', 'Up to', 'Up to'];
  box.innerHTML = [0, 1, 2].map((i) => `<div class="v4-tier-grid"><label>Tier ${i + 1} — withdrawal below (USD)<input type="number" id="tr-max-${i}" value="${T[i].maxUsd}" ${ed ? '' : 'disabled'}></label><label>Required deposit (% — ${R[i].pct[0] * 100}–${R[i].pct[1] * 100}%)<input type="number" step="0.1" id="tr-pct-${i}" value="${Math.round(T[i].pct * 1000) / 10}" ${ed ? '' : 'disabled'}></label><div class="v4-hint">e.g. $${Math.round(T[i].maxUsd / 2).toLocaleString()} → $${(Math.round(T[i].maxUsd / 2 * T[i].pct * 100) / 100).toLocaleString()}</div></div>`).join('')
    + `<div class="v4-tier-grid"><label>Tier 4 — above the last limit: flat deposit (USD, $${R[3].flat[0].toLocaleString()}–$${R[3].flat[1].toLocaleString()})<input type="number" id="tr-flat" value="${T[3].flatUsd}" ${ed ? '' : 'disabled'}></label></div>`
    + (ed ? '<button class="admin-btn" onclick="v4SaveTiers()"><i class="fa-solid fa-floppy-disk"></i> Save tiers</button>' : '<p class="v4-hint">Read-only — a Super Admin can change these.</p>') + (d.saved ? '<span class="v4-hint ok"> Saved ✓</span>' : '');
});
function v4SaveTiers() {
  const tiers = [0, 1, 2].map((i) => ({ maxUsd: Number(el('tr-max-' + i).value), pct: Number(el('tr-pct-' + i).value) / 100 })).concat([{ flatUsd: Number(el('tr-flat').value) }]);
  socket.emit('admin-set-crypto-tiers', { tiers });
}

/* ---------- boot ---------- */
(function v4Boot() {
  v4fillData(); v4selects(document); v4BuildAuthModals(); v4RenderLangButtons();
  const saved = localStorage.getItem('q_ui_lang'); v4SetLanguage(saved && LangData.get(saved) ? saved : 'en', { save: false, fromServer: true });
})();
