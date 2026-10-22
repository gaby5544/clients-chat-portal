/* QI18N — whole-interface translation for every language in languages.js.
 *
 * The interface text is written in English. When a person picks another
 * language, every visible string (labels, buttons, placeholders, popups,
 * toasts, account pages, even text added later) is translated through the
 * server (/api/translate/batch — cached, with provider fallback) and swapped in
 * place. Original English is remembered, so switching language — or back to
 * English — is instant and lossless. Chat messages are handled separately
 * (translateText / autoTranslate) because they are user content.
 */
(function () {
  var LS_LANG = 'q_lang', LS_AUTO = 'q_auto_msgs', LS_CACHE = 'q_trc_';
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, CODE: 1, PRE: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  var origText = new WeakMap();      // text node -> original English
  var shownText = new WeakMap();     // text node -> what we wrote (to ignore our own mutations)
  var cache = {};                    // english -> translated (current language)
  var lang = 'en';
  var pending = new Set();           // nodes waiting to be translated
  var timer = null, applying = false, runId = 0;
  var autoMsgs = localStorage.getItem(LS_AUTO) !== '0';

  function L() { return window.QLanguages; }
  function isoOk(code) { return L() && L().isSupported(code); }
  function detectBrowser() {
    var cands = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (isoOk(c)) return c;
      var base = String(c).split('-')[0];
      if (isoOk(base)) return base;
    }
    return 'en';
  }

  function loadCache(code) {
    try { cache = JSON.parse(localStorage.getItem(LS_CACHE + code) || '{}') || {}; } catch (e) { cache = {}; }
  }
  var saveT = null;
  function saveCache() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try {
        var keys = Object.keys(cache);
        if (keys.length > 3500) { var trimmed = {}; keys.slice(-3000).forEach(function (k) { trimmed[k] = cache[k]; }); cache = trimmed; }
        localStorage.setItem(LS_CACHE + lang, JSON.stringify(cache));
      } catch (e) { /* storage full — fine, the server still caches */ }
    }, 600);
  }

  function hasLetters(s) { try { return /\p{L}/u.test(s); } catch (e) { return /[A-Za-z\u00C0-\u024F]/.test(s); } }
  function skipped(node) {
    for (var el = node.nodeType === 3 ? node.parentNode : node; el && el !== document.body; el = el.parentNode) {
      if (el.nodeType !== 1) continue;
      if (SKIP_TAGS[el.tagName]) return true;
      if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate') || el.hasAttribute('data-notranslate')) return true;
      if (el.id === 'messageContainer' || el.id === 'pinnedList') return true;           // chat content is translated per message
      if (window.I18N && window.I18N[lang] && el.hasAttribute('data-i18n')) return true;  // handled by the built-in dictionary
    }
    return false;
  }

  function collect(root, out) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipped(root)) out.texts.push(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) { if (!skipped(n)) out.texts.push(n); }
    var els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label]') : [];
    if (root.matches && root.matches('[placeholder],[title],[aria-label]')) out.attrs.push(root);
    for (var i = 0; i < els.length; i++) if (!skipped(els[i])) out.attrs.push(els[i]);
  }

  function eligible(str) { var t = str.trim(); return t.length >= 2 && t.length <= 600 && hasLetters(t); }

  function apply(out, myRun) {
    applying = true;
    try {
      out.texts.forEach(function (node) {
        var orig = origText.has(node) ? origText.get(node) : node.nodeValue;
        if (!origText.has(node)) {
          if (!eligible(orig)) return;
          origText.set(node, orig);
        } else if (shownText.get(node) !== node.nodeValue) {
          // The app rewrote this node after we translated it — treat the new value as the new original.
          orig = node.nodeValue; if (!eligible(orig)) { origText.delete(node); return; } origText.set(node, orig);
        }
        var key = orig.trim();
        var tr = cache[key];
        if (tr) {
          var lead = orig.match(/^\s*/)[0], trail = orig.match(/\s*$/)[0];
          var val = lead + tr + trail;
          if (node.nodeValue !== val) node.nodeValue = val;
          shownText.set(node, val);
        }
      });
      out.attrs.forEach(function (el) {
        ATTRS.forEach(function (a) {
          if (!el.hasAttribute(a)) return;
          var dk = 'data-orig-' + a;
          var cur = el.getAttribute(a);
          var orig = el.hasAttribute(dk) ? el.getAttribute(dk) : cur;
          if (el.hasAttribute(dk) && el.getAttribute('data-shown-' + a) !== cur) orig = cur;   // app changed it
          if (!eligible(orig)) return;
          el.setAttribute(dk, orig);
          var tr = cache[orig.trim()];
          if (tr) { el.setAttribute(a, tr); el.setAttribute('data-shown-' + a, tr); }
        });
      });
    } finally { applying = false; }
  }

  function needed(out) {
    var set = {};
    out.texts.forEach(function (n) {
      var o = origText.has(n) && shownText.get(n) === n.nodeValue ? origText.get(n) : n.nodeValue;
      if (eligible(o) && !cache[o.trim()]) set[o.trim()] = 1;
    });
    out.attrs.forEach(function (el) {
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        var dk = 'data-orig-' + a; var cur = el.getAttribute(a);
        var o = el.hasAttribute(dk) && el.getAttribute('data-shown-' + a) === cur ? el.getAttribute(dk) : cur;
        if (eligible(o) && !cache[o.trim()]) set[o.trim()] = 1;
      });
    });
    return Object.keys(set);
  }

  async function fetchBatch(strings, myRun) {
    var BATCH = 40;
    for (var i = 0; i < strings.length; i += BATCH) {
      if (myRun !== runId) return;
      var slice = strings.slice(i, i + BATCH);
      try {
        var res = await fetch('/api/translate/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: slice, target: lang, source: 'en' }) });
        if (!res.ok) continue;
        var data = await res.json();
        (data.results || []).forEach(function (t, k) { if (t && t !== slice[k]) cache[slice[k]] = t; else if (t) cache[slice[k]] = t; });
      } catch (e) { /* network hiccup — leave the English in place */ }
    }
    saveCache();
  }

  async function translateNodes(nodes) {
    if (lang === 'en') return;
    var out = { texts: [], attrs: [] };
    nodes.forEach(function (n) { collect(n, out); });
    if (!out.texts.length && !out.attrs.length) return;
    var myRun = runId;
    apply(out, myRun);                       // instantly use whatever is already cached
    var need = needed(out);
    if (!need.length) return;
    await fetchBatch(need, myRun);
    if (myRun !== runId) return;
    apply(out, myRun);
  }

  function restore() {
    applying = true;
    try {
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
      while ((n = w.nextNode())) {
        if (origText.has(n)) { if (shownText.get(n) === n.nodeValue) n.nodeValue = origText.get(n); origText.delete(n); shownText.delete(n); }
      }
      document.querySelectorAll('[data-orig-placeholder],[data-orig-title],[data-orig-aria-label]').forEach(function (el) {
        ATTRS.forEach(function (a) {
          var dk = 'data-orig-' + a;
          if (el.hasAttribute(dk)) { if (el.getAttribute('data-shown-' + a) === el.getAttribute(a)) el.setAttribute(a, el.getAttribute(dk)); el.removeAttribute(dk); el.removeAttribute('data-shown-' + a); }
        });
      });
    } finally { applying = false; }
  }

  function flush() {
    timer = null;
    var nodes = Array.from(pending); pending.clear();
    translateNodes(nodes);
  }
  function queue(node) { if (lang === 'en' || applying) return; pending.add(node); if (!timer) timer = setTimeout(flush, 220); }

  var observer = new MutationObserver(function (muts) {
    if (lang === 'en' || applying) return;
    muts.forEach(function (m) {
      if (m.type === 'childList') m.addedNodes.forEach(function (n) { if (n.nodeType === 1 || n.nodeType === 3) queue(n); });
      else if (m.type === 'characterData') { if (shownText.get(m.target) !== m.target.nodeValue) queue(m.target); }
      else if (m.type === 'attributes') { var el = m.target; if (el.getAttribute('data-shown-' + m.attributeName) !== el.getAttribute(m.attributeName)) queue(el); }
    });
  });

  function setLanguage(code, opts) {
    opts = opts || {};
    if (!isoOk(code)) code = 'en';
    var prev = lang;
    lang = code; runId++;
    localStorage.setItem(LS_LANG, code);
    var info = L().findLanguage(code);
    document.documentElement.lang = code;
    document.documentElement.dir = info && info.rtl ? 'rtl' : 'ltr';
    // Built-in dictionary languages first, English base for everything else.
    var base = (window.I18N && window.I18N[code]) ? code : 'en';
    if (typeof applyI18n === 'function') applyI18n(base);
    var uiSel = document.getElementById('uiLangSelect'); if (uiSel && uiSel.querySelector('option[value="' + base + '"]')) uiSel.value = base;
    localStorage.setItem('q_ui_lang', base);
    if (prev !== 'en') restore();
    loadCache(code);
    if (code !== 'en') translateNodes([document.body]);
    updateLangButton();
    if (opts.notify !== false && typeof socket !== 'undefined' && socket.connected) socket.emit('set-my-language', { language: code });
    document.dispatchEvent(new CustomEvent('qi18n:change', { detail: { lang: code } }));
  }

  function updateLangButton() {
    var info = L() && L().findLanguage(lang);
    var b = document.getElementById('langBtn');
    if (b && info) b.title = info.name + ' (' + info.native + ')';
  }

  // -- chat message translation ------------------------------------------------
  async function translateOne(text, target, source) {
    try {
      var res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, target: target, source: source || 'auto' }) });
      if (!res.ok) return { text: text, ok: false };
      return await res.json();
    } catch (e) { return { text: text, ok: false }; }
  }
  var msgQueue = [], msgBusy = 0;
  function pumpMsgs() {
    while (msgBusy < 2 && msgQueue.length) {
      var job = msgQueue.shift(); msgBusy++;
      job().finally(function () { msgBusy--; pumpMsgs(); });
    }
  }
  function sameLang(detected, target) { return detected && String(detected).split('-')[0].toLowerCase() === String(target).split('-')[0].toLowerCase(); }
  function autoTranslate(data) {
    if (!autoMsgs || !data) return;
    var mine = typeof myUid === 'function' && data.senderId === myUid();
    if (mine) return;
    var plain = String(data.text || '').replace(/<[^>]*>/g, '').trim();
    if (plain.length < 2 || !hasLetters(plain)) return;
    msgQueue.push(async function () {
      // On join the message list is still being drawn — wait briefly for this message's box.
      var b = null;
      for (var n = 0; n < 12 && !(b = document.getElementById('translated-box-' + data.id)); n++) await new Promise(function (r) { setTimeout(r, 250); });
      if (!b) return;
      var r = await translateOne(plain, lang);
      if (!r.ok || sameLang(r.detected, lang) || r.text.trim().toLowerCase() === plain.toLowerCase()) return;
      b = document.getElementById('translated-box-' + data.id); if (!b) return;
      var d = document.createElement('div'); d.className = 'translated-text';
      d.innerHTML = '<i class="fa-solid fa-language"></i> '; d.appendChild(document.createTextNode(r.text));
      b.innerHTML = ''; b.appendChild(d); b.dataset.showing = '1';
      var lk = document.getElementById('translate-link-' + data.id);
      if (lk) lk.innerHTML = '<i class="fa-solid fa-rotate-left"></i> <span>Show original</span>';
    });
    pumpMsgs();
  }

  function init() {
    var saved = localStorage.getItem(LS_LANG);
    var start = saved && isoOk(saved) ? saved : detectBrowser();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // Translate once the rest of the app has rendered its first screen.
    setTimeout(function () { setLanguage(start, { notify: false }); }, 50);
  }

  window.QI18N = {
    get lang() { return lang; },
    setLanguage: setLanguage,
    translateOne: translateOne,
    autoTranslate: autoTranslate,
    translateNow: function (node) { return translateNodes([node || document.body]); },
    get autoMsgs() { return autoMsgs; },
    setAutoMsgs: function (on) { autoMsgs = !!on; localStorage.setItem(LS_AUTO, on ? '1' : '0'); },
    init: init
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
