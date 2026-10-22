// Receiving account details for a seller's Transaction Account (USD / EUR / GBP).
//
// Shown to the seller ONLY after their identity is approved (kyc_status === 'verified'). Nothing is sent to the
// browser before that — the server decides, not the screen.
//
// Every seller automatically gets a full, valid-looking set of details generated from their Account ID. The values
// are deterministic (same seller => same numbers, no storage needed and nothing to lose on a redeploy). An Admin can
// replace any value for one seller (stored in groups.seller_account_details) or reset it back to the generated set.
//
// IMPORTANT: generated numbers are placeholders that pass the usual checksum rules (IBAN mod-97, ABA routing check
// digit). Before taking real money, set ACCOUNT_BANK_* below to your real banking partner and/or enter the real
// details per seller in Admin ▸ Seller profile ▸ Receiving account details. Set ACCOUNT_DETAILS_AUTOGEN=false to show
// ONLY what an admin has entered by hand.
const crypto = require('crypto');

const CURRENCIES = ['USD', 'EUR', 'GBP'];

// ---- Configuration (all optional) ------------------------------------------------------------------------------
const cfg = () => {
  const name = process.env.ACCOUNT_BANK_NAME || 'Quantum Secure Bank';
  return {
    autogen: String(process.env.ACCOUNT_DETAILS_AUTOGEN || 'true').toLowerCase() !== 'false',
    code: String(process.env.ACCOUNT_BANK_CODE || 'QSBK').toUpperCase().replace(/[^A-Z]/g, '').padEnd(4, 'X').slice(0, 4),
    USD: { bankName: process.env.ACCOUNT_BANK_NAME_USD || `${name} N.A.`, bankAddress: process.env.ACCOUNT_BANK_ADDRESS_USD || '100 Example Street, New York, NY', swift: process.env.ACCOUNT_BANK_SWIFT_USD || null },
    EUR: { bankName: process.env.ACCOUNT_BANK_NAME_EUR || `${name} Europe AG`, bankAddress: process.env.ACCOUNT_BANK_ADDRESS_EUR || 'Beispielplatz 1, 60311 Frankfurt', swift: process.env.ACCOUNT_BANK_SWIFT_EUR || null },
    GBP: { bankName: process.env.ACCOUNT_BANK_NAME_GBP || `${name} UK Ltd`, bankAddress: process.env.ACCOUNT_BANK_ADDRESS_GBP || '1 Example Row, London EC2', swift: process.env.ACCOUNT_BANK_SWIFT_GBP || null }
  };
};

// ---- Field catalogue (order = display order) -------------------------------------------------------------------
const FIELDS = {
  USD: [
    { key: 'accountNumber', label: 'Account number', group: 'holder' },
    { key: 'routing', label: 'ABA routing number', group: 'holder' },
    { key: 'swift', label: 'SWIFT / BIC', group: 'bank' },
    { key: 'bankName', label: 'Bank name', group: 'bank' },
    { key: 'bankAddress', label: 'Bank address', group: 'bank' }
  ],
  EUR: [
    { key: 'iban', label: 'IBAN', group: 'holder' },
    { key: 'swift', label: 'SWIFT / BIC', group: 'bank' },
    { key: 'bankName', label: 'Bank name', group: 'bank' },
    { key: 'bankAddress', label: 'Bank address', group: 'bank' }
  ],
  GBP: [
    { key: 'sortCode', label: 'Sort code', group: 'holder' },
    { key: 'accountNumber', label: 'Account number', group: 'holder' },
    { key: 'iban', label: 'IBAN', group: 'holder' },
    { key: 'swift', label: 'SWIFT / BIC', group: 'bank' },
    { key: 'bankName', label: 'Bank name', group: 'bank' },
    { key: 'bankAddress', label: 'Bank address', group: 'bank' }
  ]
};
const ALLOWED = {}; CURRENCIES.forEach((c) => { ALLOWED[c] = new Set(FIELDS[c].map((f) => f.key)); });

// ---- Deterministic generator ------------------------------------------------------------------------------------
function stream(seed) {
  let n = 0;
  const next = () => { const h = crypto.createHash('sha256').update(`${seed}:${n++}`).digest(); return h; };
  let buf = next(), i = 0;
  return () => { if (i >= buf.length) { buf = next(); i = 0; } return buf[i++]; };
}
const digitsFrom = (rnd, n) => Array.from({ length: n }, () => String(rnd() % 10)).join('');

function ibanChecksum(country, bban) {                      // ISO 13616 mod-97
  const s = bban + country + '00';
  const num = s.split('').map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  let rem = 0; for (const ch of num) rem = (rem * 10 + Number(ch)) % 97;
  return String(98 - rem).padStart(2, '0');
}
const iban = (country, bban) => country + ibanChecksum(country, bban) + bban;
const groupIban = (s) => s.replace(/(.{4})/g, '$1 ').trim();

function abaRouting(rnd) {                                  // 9 digits, check digit: 3(d1+d4+d7)+7(d2+d5+d8)+(d3+d6+d9) ≡ 0 (mod 10)
  const district = 1 + (rnd() % 12);                        // Federal Reserve district 01–12
  const d = [Math.floor(district / 10), district % 10];
  for (let i = 2; i < 8; i++) d.push(rnd() % 10);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5]);
  d.push((10 - (sum % 10)) % 10);
  return d.join('');
}

function generate(group) {
  const c = cfg();
  const seed = `acct-details:${group.seller_account_id || group.id}`;
  const rnd = stream(seed);
  const usdNumber = digitsFrom(rnd, 10);
  const gbpSort = [digitsFrom(rnd, 2), digitsFrom(rnd, 2), digitsFrom(rnd, 2)].join('-');
  const gbpNumber = digitsFrom(rnd, 8);
  const eurBban = digitsFrom(rnd, 8) + digitsFrom(rnd, 10);
  const gbpBban = c.code + gbpSort.replace(/-/g, '') + gbpNumber;
  return {
    USD: { accountNumber: usdNumber, routing: abaRouting(rnd), swift: c.USD.swift || `${c.code}US33`, bankName: c.USD.bankName, bankAddress: c.USD.bankAddress },
    EUR: { iban: groupIban(iban('DE', eurBban)), swift: c.EUR.swift || `${c.code}DEFF`, bankName: c.EUR.bankName, bankAddress: c.EUR.bankAddress },
    GBP: { sortCode: gbpSort, accountNumber: gbpNumber, iban: groupIban(iban('GB', gbpBban)), swift: c.GBP.swift || `${c.code}GB2L`, bankName: c.GBP.bankName, bankAddress: c.GBP.bankAddress }
  };
}

// ---- Overrides (admin-entered values) --------------------------------------------------------------------------
function jsonOf(v, fb) {
  if (v === null || v === undefined) return fb;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fb; } }
  return v;
}
const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

/** Keep only known currencies / known fields, as trimmed strings. Empty string = "use the generated value". */
function sanitizeOverride(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const ccy of CURRENCIES) {
    const src = input[ccy]; if (!src || typeof src !== 'object') continue;
    for (const key of Object.keys(src)) {
      if (!ALLOWED[ccy].has(key)) continue;
      const v = clean(src[key]);
      if (v) { out[ccy] = out[ccy] || {}; out[ccy][key] = v; }
    }
  }
  return out;
}

function effective(group) {
  const custom = sanitizeOverride(jsonOf(group.seller_account_details, {}));
  const gen = cfg().autogen ? generate(group) : { USD: {}, EUR: {}, GBP: {} };
  const out = {}; const customKeys = {};
  for (const ccy of CURRENCIES) {
    out[ccy] = { ...gen[ccy], ...(custom[ccy] || {}) };
    customKeys[ccy] = Object.keys(custom[ccy] || {});
  }
  return { values: out, customKeys, hasCustom: CURRENCIES.some((c) => customKeys[c].length > 0), autogen: cfg().autogen };
}

/** What the screen needs. Rows with no value are dropped, so an incomplete manual entry never shows empty lines. */
function publicDetails(group, { admin = false } = {}) {
  const e = effective(group);
  const holder = String(group.seller_full_name || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const accountId = group.seller_account_id || null;
  const currencies = {};
  for (const ccy of CURRENCIES) {
    const rows = FIELDS[ccy].map((f) => ({ key: f.key, label: f.label, group: f.group, value: e.values[ccy][f.key] || '', custom: e.customKeys[ccy].includes(f.key) }));
    currencies[ccy] = admin ? rows : rows.filter((r) => r.value);
  }
  const ready = CURRENCIES.some((c) => currencies[c].some((r) => r.value));
  const out = { ready, holder, reference: accountId, currencies, order: CURRENCIES.slice() };
  if (admin) { out.hasCustom = e.hasCustom; out.autogen = e.autogen; }
  return out;
}

module.exports = { CURRENCIES, FIELDS, generate, effective, publicDetails, sanitizeOverride, iban, abaRouting, ibanChecksum };
