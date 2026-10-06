/* Quantum Secure Transaction Desk v3.1 — interface & chat translation.

   * The interface is written in English. When a person picks another language, every piece of
     visible text (buttons, labels, placeholders, popups, toasts, the transaction account, the
     system messages in the group chat) is translated:
        1. hand-checked phrases for the most important screens (instant, works offline),
        2. the existing de/it/tr dictionary (i18n.js),
        3. the server translation service (POST /api/translate — DeepL / Google / LibreTranslate /
           MyMemory, configured by the host) for everything else, cached in the browser.
   * Chat messages written by people are NOT rewritten in place: incoming ones get an automatic
     translation underneath (with "Show original"), via the same service.
   * Notifications (push, email, in-app alerts) are translated on the server into the recipient's language. */

const Xlate = (() => {
  const LD = window.LANG_DATA;
  const KEYS = [
    'Dashboard', 'Transactions', 'Withdraw', 'Profile', 'Forms',
    'Payment tracking', 'Back to chat', 'Available Balance', 'Held in Vault', 'Total Deposited',
    'Pending Withdrawals', 'Create account', 'Start transaction', 'Continue KYC verification', 'Complete the transaction',
    'Request withdrawal', 'Pending', 'Processing', 'Completed', 'Declined',
    'Account ID', 'Account currency', 'Cancel', 'Confirm', 'Send code',
    'Verify', 'Password', 'Confirm password', 'Phone number', 'Country',
    'Full legal name', 'Email', 'Close', 'Continue', 'Back',
    'Standard account', 'Business account', 'Language', 'Terms of Service & Escrow Policy', 'Submit for Review'
  ];
  const HAND = {
    es: ['Panel', 'Transacciones', 'Retirar', 'Perfil', 'Formularios',
      'Seguimiento de pagos', 'Volver al chat', 'Saldo disponible', 'Retenido en la bóveda', 'Total depositado',
      'Retiros pendientes', 'Crear cuenta', 'Iniciar transacción', 'Continuar con la verificación KYC', 'Completar la transacción',
      'Solicitar retiro', 'Pendiente', 'En proceso', 'Completado', 'Rechazado',
      'ID de cuenta', 'Moneda de la cuenta', 'Cancelar', 'Confirmar', 'Enviar código',
      'Verificar', 'Contraseña', 'Confirmar contraseña', 'Número de teléfono', 'País',
      'Nombre legal completo', 'Correo electrónico', 'Cerrar', 'Continuar', 'Atrás',
      'Cuenta estándar', 'Cuenta empresarial', 'Idioma', 'Términos de servicio y política de depósito en garantía', 'Enviar para revisión'],
    fr: ['Tableau de bord', 'Transactions', 'Retirer', 'Profil', 'Formulaires',
      'Suivi des paiements', 'Retour au chat', 'Solde disponible', 'Retenu dans le coffre', 'Total déposé',
      'Retraits en attente', 'Créer un compte', 'Démarrer la transaction', 'Poursuivre la vérification KYC', 'Terminer la transaction',
      'Demander un retrait', 'En attente', 'En cours de traitement', 'Terminé', 'Refusé',
      'ID du compte', 'Devise du compte', 'Annuler', 'Confirmer', 'Envoyer le code',
      'Vérifier', 'Mot de passe', 'Confirmer le mot de passe', 'Numéro de téléphone', 'Pays',
      'Nom légal complet', 'E-mail', 'Fermer', 'Continuer', 'Retour',
      'Compte standard', 'Compte professionnel', 'Langue', 'Conditions d’utilisation et politique de séquestre', 'Soumettre pour examen'],
    pt: ['Painel', 'Transações', 'Sacar', 'Perfil', 'Formulários',
      'Acompanhamento de pagamentos', 'Voltar ao chat', 'Saldo disponível', 'Retido no cofre', 'Total depositado',
      'Saques pendentes', 'Criar conta', 'Iniciar transação', 'Continuar a verificação KYC', 'Concluir a transação',
      'Solicitar saque', 'Pendente', 'Em processamento', 'Concluído', 'Recusado',
      'ID da conta', 'Moeda da conta', 'Cancelar', 'Confirmar', 'Enviar código',
      'Verificar', 'Senha', 'Confirmar senha', 'Número de telefone', 'País',
      'Nome legal completo', 'E-mail', 'Fechar', 'Continuar', 'Voltar',
      'Conta padrão', 'Conta empresarial', 'Idioma', 'Termos de Serviço e Política de Custódia', 'Enviar para análise'],
    ru: ['Панель', 'Транзакции', 'Вывод средств', 'Профиль', 'Формы',
      'Отслеживание платежей', 'Назад в чат', 'Доступный баланс', 'Удерживается в хранилище', 'Всего внесено',
      'Ожидающие выводы', 'Создать аккаунт', 'Начать сделку', 'Продолжить верификацию KYC', 'Завершить сделку',
      'Запросить вывод', 'В ожидании', 'Обрабатывается', 'Выполнено', 'Отклонено',
      'ID аккаунта', 'Валюта аккаунта', 'Отмена', 'Подтвердить', 'Отправить код',
      'Проверить', 'Пароль', 'Подтвердите пароль', 'Номер телефона', 'Страна',
      'Полное юридическое имя', 'Эл. почта', 'Закрыть', 'Продолжить', 'Назад',
      'Стандартный аккаунт', 'Бизнес-аккаунт', 'Язык', 'Условия обслуживания и политика эскроу', 'Отправить на проверку'],
    ar: ['لوحة التحكم', 'المعاملات', 'سحب', 'الملف الشخصي', 'النماذج',
      'تتبّع المدفوعات', 'العودة إلى الدردشة', 'الرصيد المتاح', 'محتجز في الخزنة', 'إجمالي الإيداعات',
      'السحوبات المعلّقة', 'إنشاء حساب', 'بدء المعاملة', 'متابعة التحقق من الهوية (KYC)', 'إكمال المعاملة',
      'طلب سحب', 'قيد الانتظار', 'قيد المعالجة', 'مكتمل', 'مرفوض',
      'معرّف الحساب', 'عملة الحساب', 'إلغاء', 'تأكيد', 'إرسال الرمز',
      'تحقق', 'كلمة المرور', 'تأكيد كلمة المرور', 'رقم الهاتف', 'الدولة',
      'الاسم القانوني الكامل', 'البريد الإلكتروني', 'إغلاق', 'متابعة', 'رجوع',
      'حساب قياسي', 'حساب تجاري', 'اللغة', 'شروط الخدمة وسياسة الضمان', 'إرسال للمراجعة'],
    hi: ['डैशबोर्ड', 'लेन-देन', 'निकासी', 'प्रोफ़ाइल', 'फ़ॉर्म',
      'भुगतान ट्रैकिंग', 'चैट पर वापस जाएँ', 'उपलब्ध शेष राशि', 'वॉल्ट में रोकी गई राशि', 'कुल जमा',
      'लंबित निकासी', 'खाता बनाएँ', 'लेन-देन शुरू करें', 'KYC सत्यापन जारी रखें', 'लेन-देन पूरा करें',
      'निकासी का अनुरोध करें', 'लंबित', 'प्रसंस्करणाधीन', 'पूर्ण', 'अस्वीकृत',
      'खाता आईडी', 'खाता मुद्रा', 'रद्द करें', 'पुष्टि करें', 'कोड भेजें',
      'सत्यापित करें', 'पासवर्ड', 'पासवर्ड की पुष्टि करें', 'फ़ोन नंबर', 'देश',
      'पूरा कानूनी नाम', 'ईमेल', 'बंद करें', 'जारी रखें', 'वापस',
      'मानक खाता', 'व्यावसायिक खाता', 'भाषा', 'सेवा की शर्तें और एस्क्रो नीति', 'समीक्षा के लिए जमा करें'],
    zh: ['仪表板', '交易', '提现', '个人资料', '表单',
      '付款跟踪', '返回聊天', '可用余额', '保管库中冻结', '累计存入',
      '待处理提现', '创建账户', '开始交易', '继续 KYC 验证', '完成交易',
      '申请提现', '待处理', '处理中', '已完成', '已拒绝',
      '账户 ID', '账户币种', '取消', '确认', '发送验证码',
      '验证', '密码', '确认密码', '手机号码', '国家/地区',
      '法定全名', '电子邮箱', '关闭', '继续', '返回',
      '标准账户', '企业账户', '语言', '服务条款与托管政策', '提交审核']
  };

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const dict = {};                 // lang -> { normalised English -> translation }
  function buildDict() {
    Object.entries(HAND).forEach(([l, arr]) => { dict[l] = dict[l] || {}; KEYS.forEach((k, i) => { if (arr[i]) dict[l][k] = arr[i]; }); });
    if (typeof I18N !== 'undefined' && I18N.en) {
      Object.keys(I18N).forEach((l) => {
        if (l === 'en') return;
        dict[l] = dict[l] || {};
        Object.keys(I18N[l]).forEach((k) => { if (I18N.en[k] && !dict[l][norm(I18N.en[k])]) dict[l][norm(I18N.en[k])] = I18N[l][k]; });
      });
    }
  }
  buildDict();

  // ---------- state ----------
  const saved = (() => { try { return localStorage.getItem('q_lang'); } catch (e) { return null; } })();
  let lang = saved && LD.find(saved) ? saved : 'en';
  let lastLocalChange = 0;
  const listeners = [];
  const cache = new Map();         // `${lang}\u0001${text}` -> translation (this session + localStorage)
  let known = new Set();           // translated strings for the current language (never re-translate them)
  const tracked = new Set();       // records of translated text nodes / attributes
  const textRec = new WeakMap();   // text node -> record
  const attrRec = new WeakMap();   // element -> { attr: record }
  const pending = new Map();       // text -> Set(record)
  const inflight = new Set();
  const attempts = new Map();
  let flushTimer = null, saveTimer = null, busy = 0, blocked = false;

  const SKIP = '[translate="no"],.notranslate,script,style,textarea,#groupsPanel,#directoryPanel,#dmModal,#contextMenu,#historyModal,.msg-wrapper .message:not(.msg-system):not(.msg-announcement),#presenceCluster,#currentGroupName,#pinnedList,.translated-text,.brand-title,[contenteditable="true"],#toastContainer .toast.notranslate';

  function loadCache(l) {
    try {
      const raw = localStorage.getItem('q_xl_' + l);
      if (raw) { const o = JSON.parse(raw); Object.keys(o).forEach((k) => cache.set(l + '\u0001' + k, o[k])); }
    } catch (e) { /* ignore */ }
  }
  function saveCache() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const o = {}; let n = 0;
        for (const [k, v] of cache) { if (k.startsWith(lang + '\u0001')) { o[k.slice(lang.length + 1)] = v; if (++n > 3000) break; } }
        localStorage.setItem('q_xl_' + lang, JSON.stringify(o));
      } catch (e) { /* quota — fine, it is only a cache */ }
    }, 1200);
  }
  function rebuildKnown() {
    known = new Set();
    for (const [k, v] of cache) if (k.startsWith(lang + '\u0001')) known.add(v);
    Object.values(dict[lang] || {}).forEach((v) => known.add(v));
  }
  function lookup(text) {
    if (lang === 'en') return null;
    const d = dict[lang] && dict[lang][text];
    if (d) return d;
    const c = cache.get(lang + '\u0001' + text);
    return c === undefined ? null : c;
  }

  // ---------- applying ----------
  function eligible(text) {
    return text.length >= 2 && text.length <= 700 && /\p{L}{2,}/u.test(text) && !/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(text) && !/^https?:\/\//.test(text);
  }
  function setNode(rec, translated) {
    const lead = rec.orig.match(/^\s*/)[0], trail = rec.orig.match(/\s*$/)[0];
    rec.shown = lead + translated + trail;
    if (rec.kind === 'text') { if (rec.node.nodeValue !== rec.shown) rec.node.nodeValue = rec.shown; }
    else if (rec.el.getAttribute(rec.attr) !== rec.shown) rec.el.setAttribute(rec.attr, rec.shown);
  }
  function restore(rec) {
    if (rec.kind === 'text') { if (rec.node.nodeValue === rec.shown) rec.node.nodeValue = rec.orig; }
    else if (rec.el.getAttribute(rec.attr) === rec.shown) rec.el.setAttribute(rec.attr, rec.orig);
  }
  function consider(rec) {
    const key = norm(rec.orig);
    if (!eligible(key)) return;
    const hit = lookup(key);
    if (hit !== null) { setNode(rec, hit); return; }
    if (!pending.has(key)) pending.set(key, new Set());
    pending.get(key).add(rec);
    scheduleFlush();
  }
  function handleText(node) {
    if (lang === 'en' && !textRec.has(node)) return;
    let rec = textRec.get(node);
    const val = node.nodeValue;
    if (rec) {
      if (val === rec.shown) return;                    // our own write
      rec.orig = val; rec.shown = null;                 // the app rewrote it
    } else {
      if (!val || !val.trim()) return;
      const e = node.parentElement;
      if (!e || e.closest(SKIP)) return;
      if (known.has(norm(val))) return;                 // already in the target language (e.g. csel option rows)
      rec = { kind: 'text', node, orig: val, shown: null };
      textRec.set(node, rec); tracked.add(rec);
    }
    if (lang !== 'en') consider(rec);
  }
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function handleAttr(elm, attr) {
    if (elm.closest && elm.closest(SKIP)) return;
    const val = elm.getAttribute(attr);
    if (!val) return;
    const map = attrRec.get(elm) || {};
    let rec = map[attr];
    if (rec) {
      if (val === rec.shown) return;
      rec.orig = val; rec.shown = null;
    } else {
      if (known.has(norm(val))) return;
      rec = { kind: 'attr', el: elm, attr, orig: val, shown: null };
      map[attr] = rec; attrRec.set(elm, map); tracked.add(rec);
    }
    if (lang !== 'en') consider(rec);
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { handleText(root); return; }
    if (root.nodeType !== 1) return;
    if (root.closest && root.closest(SKIP)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) handleText(n);
    const sel = ATTRS.map((a) => `[${a}]`).join(',');
    if (root.matches && root.matches(sel)) ATTRS.forEach((a) => root.hasAttribute(a) && handleAttr(root, a));
    root.querySelectorAll(sel).forEach((e) => ATTRS.forEach((a) => e.hasAttribute(a) && handleAttr(e, a)));
  }

  // ---------- machine translation ----------
  function scheduleFlush(delay = 140) { if (!flushTimer) flushTimer = setTimeout(flush, delay); }
  function isVisibleRec(rec) {
    const e = rec.kind === 'text' ? rec.node.parentElement : rec.el;
    return !!(e && e.isConnected && e.getClientRects().length);
  }
  async function flush() {
    flushTimer = null;
    if (lang === 'en' || blocked) return;
    const keys = [...pending.keys()].filter((k) => !inflight.has(k));
    if (!keys.length) return;
    const vis = [], hid = [];
    keys.forEach((k) => ([...pending.get(k)].some(isVisibleRec) ? vis : hid).push(k));
    const batch = vis.length ? vis.slice(0, 40) : hid.slice(0, 40);
    batch.forEach((k) => inflight.add(k));
    busy++; updateBusy();
    const target = lang;
    try {
      const res = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, texts: batch, target, source: 'en' })
      });
      if (res.status === 401) { blocked = true; batch.forEach((k) => inflight.delete(k)); return; }
      const data = await res.json();
      if (!res.ok || !data.results) throw new Error('bad response');
      batch.forEach((k, i) => {
        inflight.delete(k);
        const r = data.results[i];
        if (r && r.ok && r.text && target === lang) {
          cache.set(target + '\u0001' + k, r.text); known.add(r.text);
          (pending.get(k) || []).forEach((rec) => { if (rec.kind === 'text' ? rec.node.isConnected : rec.el.isConnected) setNode(rec, r.text); });
          pending.delete(k);
        } else {
          const n = (attempts.get(k) || 0) + 1; attempts.set(k, n);
          if (n >= 3) pending.delete(k);
        }
      });
      saveCache();
    } catch (err) {
      batch.forEach((k) => { inflight.delete(k); attempts.set(k, (attempts.get(k) || 0) + 1); if (attempts.get(k) >= 3) pending.delete(k); });
    } finally {
      busy--; updateBusy();
      if ([...pending.keys()].some((k) => !inflight.has(k))) scheduleFlush(busyDelay());
    }
  }
  function busyDelay() { return [...pending.keys()].some((k) => (attempts.get(k) || 0) > 0) ? 8000 : 60; }
  function updateBusy() {
    const b = document.getElementById('xlBusy');
    if (b) b.classList.toggle('show', busy > 0 && lang !== 'en');
  }

  // Translate arbitrary text for the chat (not tied to the DOM translator).
  const chatCache = new Map();
  async function translateText(text, target, source) {
    const t = String(text || '').trim();
    if (!t || !target) return { text: t, ok: true };
    const k = `${target}|${source || ''}|${t}`;
    if (chatCache.has(k)) return chatCache.get(k);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, texts: [t], target, source: source || undefined })
      });
      const data = await res.json();
      const r = res.ok && data.results && data.results[0];
      const out = r && r.ok ? { text: r.text, ok: true } : { text: t, ok: false };
      if (out.ok) chatCache.set(k, out);
      return out;
    } catch (e) { return { text: t, ok: false }; }
  }

  // ---------- language switching ----------
  function setLanguage(code, opts = {}) {
    const l = LD.find(code);
    if (!l) return;
    if (l.c === lang && !opts.force) return;
    lang = l.c; lastLocalChange = Date.now();
    try { localStorage.setItem('q_lang', lang); localStorage.setItem('q_lang_prompted', '1'); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = l.rtl ? 'rtl' : 'ltr';
    if (lang !== 'en') loadCache(lang);
    rebuildKnown();
    pending.clear(); attempts.clear(); blocked = false;
    // Re-evaluate everything we already touched, then everything on the page.
    [...tracked].forEach((rec) => {
      const live = rec.kind === 'text' ? rec.node.isConnected : rec.el.isConnected;
      if (!live) { tracked.delete(rec); return; }
      restore(rec);
      if (lang !== 'en') consider(rec); else tracked.delete(rec);
    });
    if (lang !== 'en') scan(document.body);
    if (opts.persist !== false && opts.persist) socket.emit('set-language', { groupId: activeGroupId, lang });
    syncLangButtons();
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { /* ignore */ } });
  }
  function syncLangButtons() {
    const code = lang.toUpperCase().slice(0, 3);
    document.querySelectorAll('.lang-code').forEach((s) => { s.textContent = code; });
    const sel = document.getElementById('rgLang');
    if (sel && sel.value !== lang) sel.value = lang;
  }

  // ---------- auto-translate incoming chat messages into my language ----------
  function autoMessage(data, mine) {
    if (lang === 'en' || mine || !data || !data.text || data.sender === 'SYSTEM' || data.sender === 'ANNOUNCEMENT') return;
    const plain = String(data.text).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#x2F;/g, '/').trim();
    if (!/\p{L}{2,}/u.test(plain)) return;
    setTimeout(() => { if (typeof translateMessage === 'function' && document.getElementById(`translate-link-${data.id}`)) translateMessage(data.id, { auto: true }); }, 30);
  }

  // ---------- boot ----------
  function init() {
    document.documentElement.lang = lang;
    document.documentElement.dir = (LD.find(lang) || {}).rtl ? 'rtl' : 'ltr';
    if (lang !== 'en') { loadCache(lang); rebuildKnown(); }
    const busyEl = document.createElement('div');
    busyEl.id = 'xlBusy'; busyEl.className = 'xl-busy notranslate'; busyEl.setAttribute('translate', 'no');
    busyEl.innerHTML = '<i class="fa-solid fa-language fa-beat"></i> <span>Translating…</span>';
    document.body.appendChild(busyEl);
    let queue = new Set(), raf = null;
    const run = () => {
      raf = null;
      const q = queue; queue = new Set();
      q.forEach((n) => { if (n.isConnected) scan(n); });
    };
    new MutationObserver((muts) => {
      if (lang === 'en' && !tracked.size) return;
      muts.forEach((m) => {
        if (m.type === 'childList') m.addedNodes.forEach((n) => queue.add(n));
        else if (m.type === 'characterData') queue.add(m.target);
        else if (m.type === 'attributes') queue.add(m.target);
      });
      if (!raf) raf = setTimeout(run, 60);
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // Attribute mutations come through `scan(element)`, which re-reads the three attributes.
    if (lang !== 'en') scan(document.body);
    syncLangButtons();
    // The chat's own "translate outgoing" selector lists every language.
    const sel = document.getElementById('targetLangSelect');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = LD.list.map((l) => `<option value="${l.c}">${l.n} · ${l.e}</option>`).join('');
      sel.value = cur || 'en';
      sel.title = 'Language your outgoing messages are translated into (when "Translate before sending" is on)';
    }
  }

  socket.on('init-state', () => { blocked = false; if (pending.size) scheduleFlush(50); });
  socket.on('language-saved', () => { /* server confirmed */ });

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  return {
    get lang() { return lang; },
    get lastLocalChange() { return lastLocalChange; },
    setLanguage, translateText, autoMessage, onChange: (fn) => listeners.push(fn),
    isRtl: () => !!(LD.find(lang) || {}).rtl
  };
})();
