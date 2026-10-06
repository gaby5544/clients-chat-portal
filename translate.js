// Server-side machine translation used for (a) the /api/translate endpoint the
// browser calls for chat messages and interface text, and (b) translating
// push / email notifications into the recipient's language.
//
// COMPLETELY FREE BY DEFAULT — no account, no key, no card. Providers are tried in this order and
// each text falls through to the next provider if one fails or is rate-limited:
//   1. Google Cloud Translation  — only if you set GOOGLE_TRANSLATE_API_KEY (optional, paid-tier)
//   2. LibreTranslate            — only if you set LIBRETRANSLATE_URL (self-hosted, free)
//   3. gtx    — Google Translate's public web endpoint (free, no key)
//   4. lingva — Lingva Translate, an open-source free front for Google Translate (several public servers)
//   5. mymemory — MyMemory free API (small daily quota; MYMEMORY_EMAIL raises it)
// A provider that keeps failing is skipped for 5 minutes (circuit breaker) so one outage never slows chat.
// EVERY result is stored permanently (memory + database table translation_cache), so a given sentence
// is only ever translated ONCE for all users — interface text and notifications become instant and free.
// Override the order with TRANSLATE_PROVIDERS=gtx,lingva,mymemory

const LANGS = require('./public/languages.js');

const crypto = require('crypto');
const CACHE_MAX = 20000;
const cache = new Map(); // `${lang}\u0001${text}` -> translated string (hot cache; the database is the permanent one)
const ck = (lang, text) => `${lang}\u0001${text}`;
function cacheSet(lang, text, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(ck(lang, text), value);
}
const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex');
let storeRef = null;
function getStore() { if (storeRef === null) { try { storeRef = require('./db').store || false; } catch (e) { storeRef = false; } } return storeRef || null; }

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

async function viaGoogle(texts, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) return null;
  const to = (LANGS.get(target) || { g: target }).g;
  const t = withTimeout(10000);
  try {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: t.signal,
      body: JSON.stringify({ q: texts, target: to, format: 'text' })
    });
    if (!res.ok) throw new Error(`google ${res.status}`);
    const data = await res.json();
    const out = data && data.data && data.data.translations;
    if (!Array.isArray(out) || out.length !== texts.length) throw new Error('google bad response');
    return out.map((o) => o.translatedText);
  } finally { t.done(); }
}

async function viaLibre(texts, target) {
  const base = process.env.LIBRETRANSLATE_URL;
  if (!base) return null;
  const to = (LANGS.get(target) || { g: target }).g;
  const t = withTimeout(15000);
  try {
    const body = { q: texts, source: 'auto', target: to, format: 'text' };
    if (process.env.LIBRETRANSLATE_API_KEY) body.api_key = process.env.LIBRETRANSLATE_API_KEY;
    const res = await fetch(`${base.replace(/\/$/, '')}/translate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: t.signal, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`libretranslate ${res.status}`);
    const data = await res.json();
    const out = data && data.translatedText;
    if (!Array.isArray(out) || out.length !== texts.length) throw new Error('libretranslate bad response');
    return out;
  } finally { t.done(); }
}

// MyMemory accepts at most ~500 bytes per request, so long text is split on sentence breaks.
function chunkText(text, max = 450) {
  if (text.length <= max) return [text];
  const parts = text.split(/(?<=[.!?\n])\s+/);
  const chunks = []; let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length > max) {
      if (cur) chunks.push(cur);
      if (p.length > max) { for (let i = 0; i < p.length; i += max) chunks.push(p.slice(i, i + max)); cur = ''; } else cur = p;
    } else cur = (cur ? cur + ' ' : '') + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
async function myMemoryOne(text, target) {
  const to = (LANGS.get(target) || { m: target }).m;
  const email = process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : '';
  const pieces = [];
  for (const chunk of chunkText(text)) {
    const t = withTimeout(8000);
    try {
      const res = await fetch(`${MYMEMORY_URL}?q=${encodeURIComponent(chunk)}&langpair=autodetect|${encodeURIComponent(to)}${email}`, { signal: t.signal });
      if (!res.ok) throw new Error(`mymemory ${res.status}`);
      const data = await res.json();
      const out = data && data.responseData && data.responseData.translatedText;
      if (!out || Number(data.responseStatus) !== 200 || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error('mymemory unavailable');
      pieces.push(out);
    } finally { t.done(); }
  }
  return pieces.join(' ');
}
async function viaMyMemory(texts, target) {
  const out = new Array(texts.length);
  let next = 0; let failed = 0;
  async function worker() {
    while (next < texts.length) {
      const i = next++;
      try { out[i] = await myMemoryOne(texts[i], target); } catch (e) { out[i] = null; failed++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  if (failed === texts.length) throw new Error('mymemory failed');
  return out;
}


// ---------- free providers ----------
const GTX_URL = process.env.TRANSLATE_GTX_URL || 'https://translate.googleapis.com/translate_a/single';
const LINGVA_URLS = String(process.env.LINGVA_URLS || 'https://lingva.ml,https://lingva.lunar.icu,https://translate.plausibility.cloud').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
const MYMEMORY_URL = process.env.MYMEMORY_URL || 'https://api.mymemory.translated.net/get';

/** Runs fn over items with limited concurrency; results keep their order; a failed item is null. */
async function pool(items, limit, fn) {
  const out = new Array(items.length).fill(null); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; try { out[i] = await fn(items[i]); } catch (e) { out[i] = null; } }
  }));
  return out;
}

async function viaGtx(texts, target) {
  const tl = (LANGS.get(target) || { g: target }).g;
  return pool(texts, 4, async (text) => {
    const t = withTimeout(9000);
    try {
      const res = await fetch(`${GTX_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&dj=0`, {
        method: 'POST', signal: t.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'Mozilla/5.0 (compatible; TransactionDesk/4)' },
        body: `q=${encodeURIComponent(text)}`
      });
      if (!res.ok) throw new Error(`gtx ${res.status}`);
      const data = await res.json();
      const out = Array.isArray(data) && Array.isArray(data[0]) ? data[0].map((c) => (c && c[0]) || '').join('') : '';
      if (!out) throw new Error('gtx empty');
      return out;
    } finally { t.done(); }
  });
}

let lingvaStart = 0;
async function viaLingva(texts, target) {
  const tl = (LANGS.get(target) || { g: target }).g;
  return pool(texts, 3, async (text) => {
    if (encodeURIComponent(text).length > 1800) throw new Error('too long for lingva');
    // try each public server in turn, starting from a rotating one so load is shared
    for (let k = 0; k < LINGVA_URLS.length; k++) {
      const base = LINGVA_URLS[(lingvaStart + k) % LINGVA_URLS.length];
      const t = withTimeout(8000);
      try {
        const res = await fetch(`${base}/api/v1/auto/${encodeURIComponent(tl)}/${encodeURIComponent(text)}`, { signal: t.signal });
        if (!res.ok) throw new Error(`lingva ${res.status}`);
        const data = await res.json();
        if (data && data.translation) { lingvaStart = (lingvaStart + k) % LINGVA_URLS.length; return data.translation; }
        throw new Error('lingva empty');
      } catch (e) { /* next server */ } finally { t.done(); }
    }
    throw new Error('all lingva servers failed');
  });
}

// Circuit breaker: 3 whole-batch failures in a row pauses a provider for 5 minutes.
const breaker = {};
const isOpen = (name) => breaker[name] && breaker[name].until > Date.now();
function noteResult(name, okCount, total) {
  const b = breaker[name] || (breaker[name] = { fails: 0, until: 0 });
  if (okCount === 0 && total > 0) { b.fails++; if (b.fails >= 3) { b.until = Date.now() + 5 * 60 * 1000; b.fails = 0; console.warn(`[translate] ${name} keeps failing — paused for 5 minutes`); } }
  else b.fails = 0;
}
const PROVIDERS = {
  google: async (t, l) => { const r = await viaGoogle(t, l); return r; },
  libre: async (t, l) => { const r = await viaLibre(t, l); return r; },
  gtx: viaGtx, lingva: viaLingva, mymemory: async (t, l) => { const r = await viaMyMemory(t, l); return r; }
};
function providerOrder() {
  const forced = String(process.env.TRANSLATE_PROVIDERS || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => PROVIDERS[x]);
  if (forced.length) return forced;
  const list = [];
  if (process.env.GOOGLE_TRANSLATE_API_KEY) list.push('google');
  if (process.env.LIBRETRANSLATE_URL) list.push('libre');
  list.push('gtx', 'lingva', 'mymemory');
  return list;
}

const worthTranslating = (s) => typeof s === 'string' && /\p{L}/u.test(s) && s.trim().length > 0;

/**
 * Translate an array of strings into `target`. Never throws: anything that could not be translated
 * comes back unchanged, and `failed` says so. Returns { translations: string[], failed: boolean }.
 */
async function translateBatch(texts, target) {
  const lang = LANGS.get(target) ? target : 'en';
  const result = texts.map((s) => (typeof s === 'string' ? s : ''));
  let need = [];
  texts.forEach((s, i) => {
    if (!worthTranslating(s)) return;
    const hit = cache.get(ck(lang, s));
    if (hit !== undefined) result[i] = hit; else need.push(i);
  });
  if (!need.length) return { translations: result, failed: false };

  // permanent cache (database) — one query for everything still missing
  const st = getStore();
  if (st && st.getTranslations) {
    try {
      const uniq = Array.from(new Set(need.map((i) => texts[i])));
      const found = await st.getTranslations(lang, uniq.map(hashOf));
      uniq.forEach((u) => { const v = found[hashOf(u)]; if (v) cacheSet(lang, u, v); });
      need = need.filter((i) => { const v = cache.get(ck(lang, texts[i])); if (v !== undefined) { result[i] = v; return false; } return true; });
    } catch (e) { /* database unavailable — translate fresh */ }
  }
  if (!need.length) return { translations: result, failed: false };

  const unique = Array.from(new Set(need.map((i) => texts[i])));
  const done = new Map();
  for (const name of providerOrder()) {
    const todo = unique.filter((u) => !done.has(u));
    if (!todo.length) break;
    if (isOpen(name)) continue;
    try {
      const out = await PROVIDERS[name](todo, lang);
      let ok = 0;
      todo.forEach((u, idx) => { const v = out && out[idx]; if (v && typeof v === 'string') { done.set(u, v); ok++; } });
      noteResult(name, ok, todo.length);
    } catch (err) { noteResult(name, 0, 1); console.warn('[translate]', name, 'failed:', err.message); }
  }
  const toSave = [];
  done.forEach((v, u) => { cacheSet(lang, u, v); toSave.push({ h: hashOf(u), text: v }); });
  if (st && st.saveTranslations && toSave.length) st.saveTranslations(lang, toSave).catch(() => {});
  let failed = false;
  need.forEach((i) => { const v = done.get(texts[i]); if (v) result[i] = v; else failed = true; });
  return { translations: result, failed };
}

async function translateText(text, target) {
  if (!worthTranslating(text) || !target || target === 'en') return text;
  const { translations } = await translateBatch([text], target);
  return translations[0] || text;
}

module.exports = { translateBatch, translateText, _test: { breaker, PROVIDERS, hashOf, cache, providerOrder } };
