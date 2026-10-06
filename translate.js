// Server-side translation service. One place that every translation in the app
// goes through: chat messages, interface text, and automatic notifications
// (push / email). Providers are tried in this order, first one configured wins:
//
//   DEEPL_API_KEY            (DEEPL_API_URL for the free tier: https://api-free.deepl.com)
//   GOOGLE_TRANSLATE_API_KEY (Cloud Translation v2)
//   LIBRETRANSLATE_URL       (+ optional LIBRETRANSLATE_API_KEY) — self-hostable
//   MyMemory (fallback; no key needed, but anonymous quotas are small — set MYMEMORY_EMAIL to raise them)
//
// Results are cached in memory so the same text is never translated twice, and a
// failed translation always falls back to the original text (never an error in the chat).

const LANG = require('./public/languages');

const CACHE = new Map();
const MAX_CACHE = 20000;
const MAX_LEN = 4500;

function key(text, source, target) { return `${source || 'auto'}|${target}|${text}`; }
function remember(k, v) {
  if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(k, v);
}

function norm(code) {
  const l = LANG.find(code);
  return l ? l.c : null;
}

async function withTimeout(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

async function deepl(text, source, target) {
  const base = process.env.DEEPL_API_URL || (String(process.env.DEEPL_API_KEY).endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');
  const map = { 'zh-TW': 'ZH-HANT', zh: 'ZH-HANS', pt: 'PT-PT', no: 'NB', en: 'EN-US' };
  const body = new URLSearchParams({ text, target_lang: (map[target] || target).toUpperCase() });
  if (source && source !== 'auto') body.set('source_lang', (map[source] || source).toUpperCase().split('-')[0]);
  const r = await withTimeout(`${base}/v2/translate`, { method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('deepl ' + r.status);
  const j = await r.json();
  return j.translations && j.translations[0] && j.translations[0].text;
}
async function google(text, source, target) {
  const body = { q: text, target, format: 'text' };
  if (source && source !== 'auto') body.source = source;
  const r = await withTimeout(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(process.env.GOOGLE_TRANSLATE_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('google ' + r.status);
  const j = await r.json();
  return j.data && j.data.translations && j.data.translations[0] && j.data.translations[0].translatedText;
}
async function libre(text, source, target) {
  const body = { q: text, source: source && source !== 'auto' ? source : 'auto', target, format: 'text' };
  if (process.env.LIBRETRANSLATE_API_KEY) body.api_key = process.env.LIBRETRANSLATE_API_KEY;
  const r = await withTimeout(`${process.env.LIBRETRANSLATE_URL.replace(/\/$/, '')}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('libre ' + r.status);
  const j = await r.json();
  return j.translatedText;
}
async function myMemory(text, source, target) {
  const pair = `${source && source !== 'auto' ? source : 'Autodetect'}|${target}`;
  let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;
  if (process.env.MYMEMORY_EMAIL) url += `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}`;
  const r = await withTimeout(url);
  if (!r.ok) throw new Error('mymemory ' + r.status);
  const j = await r.json();
  const out = j.responseData && j.responseData.translatedText;
  if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) throw new Error('mymemory quota/invalid');
  return out;
}

// Keyless extra fallback (public Lingva instance). Best-effort only — the chain moves on if it is down.
async function lingva(text, source, target) {
  const r = await withTimeout(`https://lingva.ml/api/v1/${encodeURIComponent(source || 'auto')}/${encodeURIComponent(target)}/${encodeURIComponent(text)}`, {}, 6000);
  if (!r.ok) throw new Error('lingva ' + r.status);
  const j = await r.json();
  if (!j || typeof j.translation !== 'string' || !j.translation) throw new Error('lingva empty');
  return j.translation;
}

const stats = { ok: 0, failed: 0, lastProvider: null, lastError: null };

function provider() {
  if (process.env.DEEPL_API_KEY) return 'deepl';
  if (process.env.GOOGLE_TRANSLATE_API_KEY) return 'google';
  if (process.env.LIBRETRANSLATE_URL) return 'libre';
  return 'mymemory';
}

// Translate one string. Never throws: on any failure returns { text: original, ok:false }.
async function translateOne(text, target, source) {
  const t = norm(target);
  const s = source ? norm(source) : null;
  const clean = String(text == null ? '' : text);
  if (!clean.trim() || !t || t === s) return { text: clean, ok: true, same: true };
  if (clean.length > MAX_LEN) return { text: clean, ok: false };
  const k = key(clean, s, t);
  if (CACHE.has(k)) return { text: CACHE.get(k), ok: true, cached: true };
  const order = { deepl, google, libre, mymemory: myMemory, lingva };
  const p = provider();
  const chain = p === 'mymemory' ? ['mymemory', 'lingva'] : [p, 'mymemory', 'lingva'];
  for (const name of chain) {
    try {
      const out = await order[name](clean, s, t);
      if (out && typeof out === 'string') {
        const decoded = out.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        remember(k, decoded);
        stats.ok++; stats.lastProvider = name;
        return { text: decoded, ok: true, provider: name };
      }
    } catch (e) { stats.lastError = `${name}: ${e.message}`; /* try the next provider */ }
  }
  stats.failed++;
  return { text: clean, ok: false };
}

// Translate many strings with limited concurrency, preserving order.
async function translateMany(texts, target, source, concurrency = 5) {
  const out = new Array(texts.length);
  let i = 0;
  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      out[idx] = await translateOne(texts[idx], target, source);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return out;
}

// Text is stored HTML-escaped in the chat; translate the plain text and re-escape.
function unescapeHtml(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/').replace(/&amp;/g, '&'); }
const { escapeHtml } = require('./security');

async function translateStoredText(storedText, target, source) {
  const plain = unescapeHtml(storedText);
  const r = await translateOne(plain, target, source);
  return { ...r, text: escapeHtml(r.text) };
}

const getStats = () => ({ ...stats, provider: provider(), keyed: provider() !== 'mymemory', cached: CACHE.size });
module.exports = { getStats, translateOne, translateMany, translateStoredText, provider, norm, unescapeHtml };
