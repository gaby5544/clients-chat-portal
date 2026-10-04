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

async function viaLibre(text, target, source) {
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

function providers() {
  const forced = (process.env.TRANSLATE_PROVIDER || '').toLowerCase();
  const all = [];
  if (process.env.LIBRETRANSLATE_URL) all.push(['libre', viaLibre]);
  all.push(['google', viaGoogle], ['mymemory', viaMyMemory]);
  return forced ? all.filter(([n]) => n === forced) : all;
}

/** Translate one string. Never throws — on failure returns the original text with ok:false. */
async function translateText(text, target, source = 'auto') {
  const clean = String(text == null ? '' : text);
  if (!clean.trim() || !isSupported(target)) return { text: clean, detected: null, ok: true, cached: true };
  if (/^[\s\d.,:;!?()\-\/+%$€£#@*&_=<>"'\u2013\u2014]*$/.test(clean)) return { text: clean, detected: null, ok: true, cached: true };
  const key = target + '\u0001' + clean;
  const hit = cacheGet(key);
  if (hit) return { ...hit, ok: true, cached: true };
  for (const [name, fn] of providers()) {
    try {
      const r = await fn(clean, target, source);
      const val = { text: r.text, detected: r.detected || null };
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

module.exports = { translateText, translateMany, _cache: cache };
