// Live exchange rates (USD / GBP / EUR), no API key needed.
//   primary : https://api.frankfurter.dev  (European Central Bank reference rates, updated each working day)
//   fallback: https://open.er-api.com
// Rates are cached in memory and in the database, refreshed every 6 hours, and fall back to the last good
// values (or the built-in defaults) if both sources are unreachable. Every incoming payment stores the rate
// it was converted at, so a later change never rewrites history.
const F = require('./finance');

const KEY = 'fx_rates';
const REFRESH_MS = 6 * 3600 * 1000;
const DEFAULTS = { USD: 1, GBP: 1.27, EUR: 1.08 };
const info = { source: 'built-in defaults', updatedAt: null, lastError: null, live: false };
let timer = null;

const sane = (ccy, v) => Number.isFinite(v) && v > 0.2 && v < 5 && ccy !== 'USD';

function apply(usdPer) { // usdPer: { GBP: usd value of 1 GBP, EUR: ... }
  Object.keys(usdPer).forEach((c) => { if (sane(c, usdPer[c])) F.FX_TO_USD[c] = Math.round(usdPer[c] * 1e6) / 1e6; });
  F.FX_TO_USD.USD = 1;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${url.split('/')[2]} answered ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function fetchRates() {
  try {
    const j = await getJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,EUR');
    if (j && j.rates && j.rates.GBP && j.rates.EUR) return { source: 'frankfurter.dev (ECB)', usd: { GBP: 1 / j.rates.GBP, EUR: 1 / j.rates.EUR }, asOf: j.date };
  } catch (e) { info.lastError = e.message; }
  const j2 = await getJson('https://open.er-api.com/v6/latest/USD');
  if (j2 && j2.result === 'success' && j2.rates && j2.rates.GBP && j2.rates.EUR) return { source: 'open.er-api.com', usd: { GBP: 1 / j2.rates.GBP, EUR: 1 / j2.rates.EUR }, asOf: j2.time_last_update_utc || null };
  throw new Error('No exchange-rate source answered');
}

async function refresh(store) {
  try {
    const r = await fetchRates();
    apply(r.usd);
    Object.assign(info, { source: r.source, updatedAt: new Date().toISOString(), asOf: r.asOf || null, lastError: null, live: true });
    if (store) await store.setSetting(KEY, { rates: { GBP: F.FX_TO_USD.GBP, EUR: F.FX_TO_USD.EUR }, source: info.source, updatedAt: info.updatedAt, asOf: info.asOf });
    console.log(`[fx] updated from ${r.source}: GBP=${F.FX_TO_USD.GBP} EUR=${F.FX_TO_USD.EUR} (USD per 1 unit)`);
    return true;
  } catch (e) {
    info.lastError = e.message;
    console.error('[fx] refresh failed, keeping the last rates:', e.message);
    return false;
  }
}

async function start(store) {
  try {
    const saved = store && (await store.getSetting(KEY));
    if (saved && saved.rates) { apply(saved.rates); Object.assign(info, { source: saved.source + ' (saved)', updatedAt: saved.updatedAt, asOf: saved.asOf || null, live: true }); }
  } catch (e) { /* defaults stay */ }
  refresh(store);
  timer = setInterval(() => refresh(store), REFRESH_MS);
  if (timer.unref) timer.unref();
}

const snapshot = () => ({ ...info, rates: { USD: 1, GBP: F.FX_TO_USD.GBP, EUR: F.FX_TO_USD.EUR } });

module.exports = { start, refresh, snapshot, DEFAULTS };
