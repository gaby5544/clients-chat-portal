// Server-side translation with caching and provider fallback, so the browser
// never talks to a third-party translation API directly (no CORS problems, one
// shared cache, and rate limits are absorbed here instead of in every client).
//
// Provider order:
//   1. LibreTranslate  — if LIBRETRANSLATE_URL is set (optionally LIBRETRANSLATE_KEY)
//   2. Google (gtx)    — no key needed
//   3. MyMemory        — last resort (500 chars per request, so text is chunked)
// Set TRANSLATE_PROVIDER=google|mymemory|libre to force a single provider.

const { isSupported } = require('./public/languages');

const CACHE_MAX = 6000;
const cache = new Map();           // `${target}\u0001${text}` -> { text, detected }
const FETCH_TIMEOUT_MS = 8000;

function cacheGet(k) { const v = cache.get(k); if (v) { cache.delete(k); cache.set(k, v); } return v; }
function cacheSet(k, v) { cache.set(k, v); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }

async function timedFetch(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(timer); }
}

function chunkText(text, max) {
  if (text.length <= max) return [text];
  const out = []; let cur = '';
  for (const part of text.split(/(?<=[.!?。！？\n])\s*/)) {
    if ((cur + ' ' + part).trim().length > max && cur) { out.push(cur.trim()); cur = part; }
    else cur = (cur ? cur + ' ' : '') + part;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let libreLangs = null;           // Set of language codes your LibreTranslate server supports
async function loadLibreLangs() {
  if (libreLangs || !process.env.LIBRETRANSLATE_URL) return libreLangs;
  try { const r = await timedFetch(process.env.LIBRETRANSLATE_URL.replace(/\/$/, '') + '/languages'); const d = await r.json(); libreLangs = new Set(d.map((l) => l.code)); } catch (e) { libreLangs = null; }
  return libreLangs;
}
async function viaLibre(text, target, source) {
  const langs = await loadLibreLangs(); const base = target.split('-')[0] === 'zh' ? 'zh' : target.split('-')[0];
  if (langs && !langs.has(base)) throw new Error('language not supported by your LibreTranslate');
  const res = await timedFetch(process.env.LIBRETRANSLATE_URL.replace(/\/$/, '') + '/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: source || 'auto', target: target.split('-')[0] === 'zh' ? 'zh' : target.split('-')[0], format: 'text', api_key: process.env.LIBRETRANSLATE_KEY || undefined })
  });
  if (!res.ok) throw new Error('libre ' + res.status);
  const d = await res.json();
  if (!d.translatedText) throw new Error('libre empty');
  return { text: d.translatedText, detected: d.detectedLanguage && d.detectedLanguage.language };
}

async function viaGoogle(text, target, source) {
  const out = []; let detected = null;
  for (const piece of chunkText(text, 1800)) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + encodeURIComponent(source || 'auto') + '&tl=' + encodeURIComponent(target) + '&q=' + encodeURIComponent(piece);
    const res = await timedFetch(url);
    if (!res.ok) throw new Error('google ' + res.status);
    const d = await res.json();
    if (!Array.isArray(d) || !Array.isArray(d[0])) throw new Error('google shape');
    out.push(d[0].map((x) => (x && x[0]) || '').join(''));
    if (!detected && typeof d[2] === 'string') detected = d[2];
  }
  const joined = out.join(' ').trim();
  if (!joined) throw new Error('google empty');
  return { text: joined, detected };
}

async function viaMyMemory(text, target, source) {
  const out = [];
  for (const piece of chunkText(text, 450)) {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(piece) + '&langpair=' + encodeURIComponent((source && source !== 'auto' ? source : 'Autodetect') + '|' + target);
    const res = await timedFetch(url);
    if (!res.ok) throw new Error('mymemory ' + res.status);
    const d = await res.json();
    const t = d && d.responseData && d.responseData.translatedText;
    if (!t || /MYMEMORY WARNING|INVALID/i.test(t)) throw new Error('mymemory refused');
    out.push(t);
  }
  return { text: out.join(' '), detected: null };
}

// ---------------------------------------------------------------------------
// Privacy controls
//   LIBRETRANSLATE_URL set  -> text goes ONLY to your own server (private). Third-party
//                              services are used only if TRANSLATE_ALLOW_THIRD_PARTY=true.
//   no LibreTranslate       -> third-party services (Google/MyMemory) are used, but
//                              sensitive details are masked first (TRANSLATE_REDACT, default on).
//   TRANSLATE_PROVIDER=off  -> translation is disabled entirely; nothing leaves the server.
// ---------------------------------------------------------------------------
const redactOn = () => String(process.env.TRANSLATE_REDACT || 'true').toLowerCase() !== 'false';
const allowThirdParty = () => String(process.env.TRANSLATE_ALLOW_THIRD_PARTY || '').toLowerCase() === 'true';

// Things that must never reach an outside translator: emails, links, phone numbers, long digit
// strings (account / IBAN / card / ID numbers), crypto wallet addresses and transaction hashes.
const SENSITIVE = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,                  // email
  /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi,                               // links
  /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, // IBAN
  /\b(?:0x)?[A-Fa-f0-9]{32,}\b|\b(?:bc1|[13])[A-HJ-NP-Za-km-z1-9]{25,60}\b|\bT[A-Za-z1-9]{33}\b/g, // hashes / BTC / TRON
  /\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{26,}\b/g,                              // any long mixed token: wallet addresses, hashes, reference IDs
  /\+?\d[\d\s().-]{7,}\d/g                                             // phone numbers & long digit runs
];
function redact(text) {
  const map = []; let out = String(text);
  for (const re of SENSITIVE) {
    out = out.replace(re, (m) => { map.push(m); return `\u27E6${map.length}\u27E7`; });
  }
  return { text: out, map };
}
function restore(text, map) {
  if (!map.length) return { text, ok: true };
  let ok = true;
  const out = String(text).replace(/\u27E6\s*(\d+)\s*\u27E7/g, (_, n) => (map[n - 1] !== undefined ? map[n - 1] : (ok = false, '')));
  // Every placeholder must come back exactly once; otherwise the translator mangled it and we show the original instead.
  for (let i = 1; i <= map.length; i++) { const c = (String(text).match(new RegExp(`\\u27E6\\s*${i}\\s*\\u27E7`, 'g')) || []).length; if (c !== 1) ok = false; }
  return { text: out, ok };
}

function providers() {
  const forced = (process.env.TRANSLATE_PROVIDER || '').toLowerCase();
  if (forced === 'off' || forced === 'none') return [];
  const all = [];
  if (process.env.LIBRETRANSLATE_URL) all.push(['libre', viaLibre, false]);
  if (!process.env.LIBRETRANSLATE_URL || allowThirdParty()) all.push(['google', viaGoogle, true], ['mymemory', viaMyMemory, true]);
  return forced ? all.filter(([n]) => n === forced || (forced === 'libre' && n === 'libre')) : all;
}

function translationStatus() {
  const list = providers();
  const outside = list.some(([, , external]) => external);
  return {
    enabled: list.length > 0,
    providers: list.map(([n]) => n),
    private: list.length > 0 && !outside,
    redaction: outside && redactOn(),
    note: !list.length ? 'Translation is switched off.' : !outside ? 'All translation stays on your own server.' : (redactOn() ? 'Text is sent to an outside translation service with emails, links, phone and account numbers masked.' : 'Text is sent to an outside translation service without masking.')
  };
}

/** Translate one string. Never throws — on failure returns the original text with ok:false. */
async function translateText(text, target, source = 'auto') {
  const clean = String(text == null ? '' : text);
  if (!clean.trim() || !isSupported(target)) return { text: clean, detected: null, ok: true, cached: true };
  if (/^[\s\d.,:;!?()\-\/+%$€£#@*&_=<>"'\u2013\u2014]*$/.test(clean)) return { text: clean, detected: null, ok: true, cached: true };
  const key = target + '\u0001' + clean;
  const hit = cacheGet(key);
  if (hit) return { ...hit, ok: true, cached: true };
  for (const [name, fn, external] of providers()) {
    try {
      let payload = clean; let map = [];
      if (external && redactOn()) ({ text: payload, map } = redact(clean));
      if (external && redactOn() && !payload.replace(/\u27E6\d+\u27E7/g, '').trim()) continue;   // nothing but sensitive data — don't send
      const r = await fn(payload, target, source);
      let out = r.text;
      if (map.length) { const back = restore(out, map); if (!back.ok) throw new Error('placeholder lost'); out = back.text; }
      const val = { text: out, detected: r.detected || null };
      cacheSet(key, val);
      return { ...val, ok: true, provider: name };
    } catch (err) { /* try the next provider */ }
  }
  return { text: clean, detected: null, ok: false };
}

/**
 * Translate many strings efficiently. Short strings are packed into newline-joined
 * chunks (one provider call per ~1,500 characters instead of one per string); if a
 * provider ever returns a different number of lines, that chunk is redone one by one.
 */
async function translateMany(texts, target, source = 'auto', concurrency = 3) {
  const results = new Array(texts.length);
  const pending = [];
  texts.forEach((raw, i) => {
    const text = String(raw == null ? '' : raw);
    const trivial = !text.trim() || !isSupported(target) || /^[\s\d.,:;!?()\-\/+%$€£#@*&_=<>"'\u2013\u2014]*$/.test(text);
    const hit = trivial ? null : cacheGet(target + '\u0001' + text);
    if (trivial) results[i] = { text, ok: true, cached: true };
    else if (hit) results[i] = { ...hit, ok: true, cached: true };
    else pending.push(i);
  });
  // Pack
  const chunks = []; let cur = []; let len = 0;
  for (const i of pending) {
    const text = String(texts[i]);
    if (text.includes('\n') || text.length > 600) { chunks.push([i]); continue; }
    if (len + text.length + 1 > 1500 && cur.length) { chunks.push(cur); cur = []; len = 0; }
    cur.push(i); len += text.length + 1;
  }
  if (cur.length) chunks.push(cur);

  let next = 0;
  async function worker() {
    while (true) {
      const ci = next++; if (ci >= chunks.length) return;
      const idxs = chunks[ci];
      if (idxs.length === 1) { results[idxs[0]] = await translateText(texts[idxs[0]], target, source); continue; }
      const joined = idxs.map((i) => String(texts[i])).join('\n');
      const r = await translateText(joined, target, source);
      const lines = r.ok ? r.text.split('\n') : null;
      if (lines && lines.length === idxs.length && lines.every((l) => l.trim())) {
        idxs.forEach((i, k) => { const v = { text: lines[k].trim(), detected: null }; cacheSet(target + '\u0001' + String(texts[i]), v); results[i] = { ...v, ok: true }; });
      } else {
        for (const i of idxs) results[i] = await translateText(texts[i], target, source);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length || 1) }, worker));
  return results;
}

module.exports = { translateText, translateMany, translationStatus, redact, restore, _cache: cache };
