require('./harness');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FAIL:', m); };
(async () => {
  const T = require('../translator');
  const msg = 'Please send to IBAN GB29 NWBK 6016 1331 9268 19 or email kwame@example.com, call +233 24 412 3456. Wallet TXyz1234567890abcdefghijklmnopqrst1 see https://pay.example.com/x?id=9';
  const { text, map } = T.redact(msg);
  ok(!/GB29|kwame@|\+233|TXyz|https:/.test(text) && map.length >= 5, 'redaction masks IBAN, email, phone, wallet and link: ' + text.slice(0, 80));
  ok(T.restore(text, map).text === msg && T.restore(text, map).ok, 'restores the original details exactly after translation');
  ok(T.restore(text.replace('⟦2⟧', ''), map).ok === false, 'a lost placeholder is detected (translation is then discarded, not shown wrong)');
  // fake providers through fetch: capture what leaves the server
  const sent = []; global.fetch = async (url) => { sent.push(decodeURIComponent(String(url))); return { ok: true, status: 200, json: async () => [[['«traducido» ' + (decodeURIComponent(String(url).split('&q=')[1] || '')), 'x']], null, 'en'] }; };
  delete process.env.LIBRETRANSLATE_URL; delete process.env.TRANSLATE_PROVIDER;
  let r = await T.translateText(msg, 'es');
  ok(r.ok && sent.length === 1 && !/GB29|kwame@example|\+233|TXyz1234|pay\.example/.test(sent[0]), 'what leaves the server contains none of the sensitive details');
  ok(r.ok && r.text.includes('kwame@example.com') && r.text.includes('GB29 NWBK 6016 1331 9268 19'), 'the reader still sees the real details in the translation');
  ok(T.translationStatus().private === false && T.translationStatus().redaction === true, 'status: third-party with masking');
  // with LibreTranslate configured, nothing goes to third parties
  sent.length = 0; process.env.LIBRETRANSLATE_URL = 'http://libre.local:5000';
  global.fetch = async (url, o) => { sent.push(String(url)); if (String(url).endsWith('/languages')) return { ok: true, status: 200, json: async () => [{ code: 'es' }, { code: 'fr' }] }; return { ok: true, status: 200, json: async () => ({ translatedText: 'hola' }) }; };
  r = await T.translateText('Hello friend', 'es'); ok(r.ok && r.provider === 'libre' && sent.every(u => u.startsWith('http://libre.local')), 'with LibreTranslate set, text only goes to your own server');
  ok(T.translationStatus().private === true, 'status: private');
  global.fetch = async (url) => { sent.push(String(url)); if (String(url).endsWith('/languages')) return { ok: true, json: async () => [{ code: 'es' }] }; throw new Error('down'); };
  sent.length = 0; r = await T.translateText('Good morning everyone', 'es'); ok(r.ok === false && sent.every(u => u.startsWith('http://libre.local')), 'if your server is down, it does NOT fall back to outside services');
  process.env.TRANSLATE_PROVIDER = 'off'; r = await T.translateText('Another sentence here', 'es'); ok(r.ok === false && T.translationStatus().enabled === false, 'TRANSLATE_PROVIDER=off disables translation completely');
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
