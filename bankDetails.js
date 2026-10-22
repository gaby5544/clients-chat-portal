// Receiving account details shown to identity-verified sellers (USD / EUR / GBP).
//
// IMPORTANT: this module never invents account numbers. Every number a seller sees was typed in by the Desk and
// comes from a real bank account that actually exists (the Desk's own collection account at its partner bank, or an
// account the bank issued for that individual seller). A number the bank never issued would send a payer's money
// to the wrong place or bounce it.
//
// Two sources, in order of priority:
//   1. A per-seller override typed by the Desk (setting `recv_override:<groupId>`) - for banks that issue one account per customer.
//   2. The Desk's global account for the seller's currency (setting `bank_profiles`) - shown with the seller's Account ID
//      as their payment reference, so the Desk can match each incoming payment to the right seller.
// If neither exists the seller sees "being prepared" - unless ALLOW_SAMPLE_BANK_DETAILS=true (demo mode, clearly labelled).
//
// A seller only ever receives the details for the currency they registered with.

const CCYS = ['USD', 'EUR', 'GBP'];
const SYMBOL = { USD: '$', EUR: '€', GBP: '£' };
const INTRO = {
  USD: 'US dollar account. Receive USD by ACH, domestic wire and international SWIFT transfer.',
  EUR: 'Euro account. Receive EUR by SEPA and international SWIFT transfer. Euro accounts are identified by their IBAN.',
  GBP: 'Pound sterling account. Receive GBP by Faster Payments, CHAPS, BACS and international SWIFT transfer.'
};
// Which fields make up an account, per currency. `req` fields must be present and valid before it counts as configured.
const SCHEMA = {
  USD: { req: ['holder', 'accountNumber', 'routing', 'swift', 'bankName', 'bankAddress'], opt: [] },
  EUR: { req: ['holder', 'iban', 'swift', 'bankName', 'bankAddress'], opt: [] },
  GBP: { req: ['holder', 'sortCode', 'accountNumber', 'swift', 'bankName', 'bankAddress'], opt: ['iban'] }
};
const LABEL = { holder: 'Account name', accountNumber: 'Account number', routing: 'ABA routing number', iban: 'IBAN', sortCode: 'Sort code', swift: 'SWIFT / BIC', bankName: 'Bank name', bankAddress: 'Bank address' };

const clean = (v, n = 140) => String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- format validators (real banking rules) ----
const ibanMod97 = (iban) => { const s = iban.replace(/\s/g, ''); const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55)); let rem = 0; for (const ch of r) rem = (rem * 10 + Number(ch)) % 97; return rem; };
const abaOk = (r) => /^\d{9}$/.test(r) && (3 * (+r[0] + +r[3] + +r[6]) + 7 * (+r[1] + +r[4] + +r[7]) + (+r[2] + +r[5] + +r[8])) % 10 === 0;
const IBAN_LEN = { GB: 22, DE: 22, FR: 27, ES: 24, IT: 27, NL: 18, IE: 22, BE: 16, AT: 20, PT: 25, FI: 18, LU: 20, GR: 27, MT: 31, CY: 28, SK: 24, SI: 19, EE: 20, LV: 21, LT: 20, HR: 21, IM: 22, JE: 22, GG: 22 };
const spaced = (s) => s.replace(/(.{4})/g, '$1 ').trim();

/** Normalise + validate one field. @returns {{v?:string, err?:string}} */
function checkField(ccy, f, raw) {
  const t = clean(raw, f === 'bankAddress' ? 200 : 100);
  if (!t) return { err: `${LABEL[f]} is required.` };
  switch (f) {
    case 'holder': return t.length < 2 ? { err: 'Account name is too short.' } : { v: t };
    case 'bankName': return t.length < 3 ? { err: 'Bank name is too short.' } : { v: t };
    case 'bankAddress': return t.length < 8 ? { err: 'Enter the bank’s full street address.' } : { v: t };
    case 'swift': { const s = t.toUpperCase().replace(/\s/g, ''); return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) ? { v: s } : { err: 'SWIFT / BIC must be 8 or 11 characters, e.g. HBUKGB4B.' }; }
    case 'routing': { const s = t.replace(/\D/g, ''); return abaOk(s) ? { v: s } : { err: 'ABA routing number must be 9 digits and pass the ABA check-digit test.' }; }
    case 'sortCode': { const d = t.replace(/\D/g, ''); return /^\d{6}$/.test(d) ? { v: `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` } : { err: 'Sort code must be 6 digits (00-00-00).' }; }
    case 'accountNumber': { const d = t.replace(/[\s-]/g, ''); if (ccy === 'GBP') return /^\d{8}$/.test(d) ? { v: d } : { err: 'UK account numbers have 8 digits.' }; return /^\d{4,17}$/.test(d) ? { v: d } : { err: 'US account numbers have 4 to 17 digits.' }; }
    case 'iban': {
      const s = t.toUpperCase().replace(/\s/g, '');
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return { err: 'IBAN is not in a valid format.' };
      if (IBAN_LEN[s.slice(0, 2)] && IBAN_LEN[s.slice(0, 2)] !== s.length) return { err: `A ${s.slice(0, 2)} IBAN has ${IBAN_LEN[s.slice(0, 2)]} characters.` };
      if (ibanMod97(s) !== 1) return { err: 'IBAN check digits are wrong. Please re-check every character.' };
      if (ccy === 'GBP' && !/^(GB|IM|JE|GG)/.test(s)) return { err: 'A sterling account IBAN starts with GB.' };
      return { v: spaced(s) };
    }
    default: return { v: t };
  }
}
/** @returns {{ok:true, fields}|{ok:false, error, errors}} - all required fields (and any supplied optional ones) must be valid. */
function validateAccount(ccy, input, { requireAll = true } = {}) {
  const sc = SCHEMA[ccy]; if (!sc) return { ok: false, error: 'Unsupported currency.' };
  const out = {}, errors = {};
  for (const f of sc.req.concat(sc.opt)) {
    const raw = input && input[f]; const isOpt = sc.opt.includes(f);
    if ((raw == null || String(raw).trim() === '') && (isOpt || !requireAll)) continue;
    const r = checkField(ccy, f, raw); if (r.err) errors[f] = r.err; else out[f] = r.v;
  }
  const keys = Object.keys(errors);
  return keys.length ? { ok: false, error: `${ccy}: ${errors[keys[0]]}`, errors } : { ok: true, fields: out };
}

// ---- storage ----
const parse = (raw) => { try { return raw ? JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) : null; } catch (e) { return null; } };

async function getProfiles(store) {
  const saved = parse(await store.getSetting('bank_profiles', null)) || {};
  const out = {};
  for (const c of CCYS) { const v = validateAccount(c, saved[c] || {}); out[c] = { ccy: c, fields: saved[c] || {}, configured: !!(saved[c] && v.ok) }; }
  return out;
}
/** updates = { USD: {...fields}, EUR: {...}, GBP: {...} }. A currency with every field blank is cleared. */
async function setProfiles(store, updates) {
  const toSave = {}; const cur = parse(await store.getSetting('bank_profiles', null)) || {};
  for (const c of CCYS) {
    const u = updates && updates[c]; if (!u) { if (cur[c]) toSave[c] = cur[c]; continue; }
    const blank = Object.values(u).every((x) => String(x == null ? '' : x).trim() === '');
    if (blank) continue;                                  // cleared
    const v = validateAccount(c, u); if (!v.ok) return { ok: false, error: v.error, errors: v.errors };
    toSave[c] = v.fields;
  }
  await store.setSetting('bank_profiles', JSON.stringify(toSave));
  return { ok: true, profiles: await getProfiles(store) };
}
async function getOverride(store, groupId) { return parse(await store.getSetting(`recv_override:${groupId}`, null)); }
async function setOverride(store, group, input) {
  const ccy = group.seller_currency; if (!CCYS.includes(ccy)) return { ok: false, error: 'This seller’s currency has no receiving-account template.' };
  const v = validateAccount(ccy, input); if (!v.ok) return { ok: false, error: v.error, errors: v.errors };
  await store.setSetting(`recv_override:${group.id}`, JSON.stringify({ ccy, fields: v.fields, updatedAt: new Date().toISOString() }));
  return { ok: true, fields: v.fields };
}
async function clearOverride(store, groupId) { await store.setSetting(`recv_override:${groupId}`, ''); }

// ---- presentation ----
function rowsFor(ccy, f, { reference } = {}) {
  const a = [['Account name', f.holder]];
  if (ccy === 'USD') a.push(['Account number', f.accountNumber], ['ABA routing number', f.routing]);
  if (ccy === 'EUR') a.push(['IBAN', f.iban]);
  if (ccy === 'GBP') { a.push(['Sort code', f.sortCode], ['Account number', f.accountNumber]); if (f.iban) a.push(['IBAN', f.iban]); }
  if (reference) a.push(['Payment reference', reference]);
  const b = [['SWIFT / BIC', f.swift], ['Bank name', f.bankName], ['Bank address', f.bankAddress]];
  return { a, b };
}
const SAMPLE_FIELDS = {
  USD: { holder: 'Sample Holder', accountNumber: '0123456789', routing: '000111222', swift: 'SAMPUS33', bankName: 'Sample Bank N.A.', bankAddress: '100 Example Street, New York, NY' },
  EUR: { holder: 'Sample Holder', iban: 'DE89 3704 0044 0532 0130 00', swift: 'SAMPDEFF', bankName: 'Sample Bank AG', bankAddress: 'Beispielplatz 1, 60311 Frankfurt' },
  GBP: { holder: 'Sample Holder', sortCode: '00-00-00', accountNumber: '01234567', swift: 'SAMPGB2L', bankName: 'Sample Bank Ltd', bankAddress: '1 Example Row, London EC2' }
};

/** What one seller sees. Only identity-verified sellers with an Account ID; only their own currency. */
async function getForGroup(store, group, { allowSample = false } = {}) {
  if (!group || group.kyc_status !== 'verified' || !group.seller_account_id) return { approved: false, status: group ? group.kyc_status || 'not_submitted' : 'not_submitted' };
  const ccy = group.seller_currency; const accountId = group.seller_account_id;
  const base = { approved: true, accountId, currency: ccy, holder: group.seller_full_name || null };
  if (!CCYS.includes(ccy)) return { ...base, ready: false, unsupported: true };
  const ov = await getOverride(store, group.id);
  let fields = null, source = null, reference = null;
  if (ov && ov.ccy === ccy && validateAccount(ccy, ov.fields).ok) { fields = ov.fields; source = 'seller'; }
  else { const p = (await getProfiles(store))[ccy]; if (p.configured) { fields = p.fields; source = 'desk'; reference = accountId; } }
  let sample = false;
  if (!fields && allowSample) { fields = SAMPLE_FIELDS[ccy]; source = 'sample'; sample = true; }
  if (!fields) return { ...base, ready: false };
  const { a, b } = rowsFor(ccy, fields, { reference });
  return { ...base, ready: true, source, details: { [ccy]: { symbol: SYMBOL[ccy], intro: INTRO[ccy], sample, a, b } } };
}
/** Admin view of one seller: the override fields, the global account, and what the seller currently sees. */
async function adminView(store, group, { allowSample = false } = {}) {
  const ccy = group.seller_currency; const ov = await getOverride(store, group.id);
  const prof = CCYS.includes(ccy) ? (await getProfiles(store))[ccy] : null;
  const eff = await getForGroup(store, group, { allowSample });
  return { groupId: group.id, currency: ccy, supported: CCYS.includes(ccy), verified: group.kyc_status === 'verified', schema: CCYS.includes(ccy) ? SCHEMA[ccy] : null, labels: LABEL, override: ov && ov.ccy === ccy ? ov.fields : null, globalConfigured: !!(prof && prof.configured), source: eff.source || null, ready: !!eff.ready };
}

module.exports = { CCYS, SCHEMA, LABEL, validateAccount, checkField, ibanMod97, abaOk, getProfiles, setProfiles, getOverride, setOverride, clearOverride, getForGroup, adminView };
