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
// If neither exists the seller sees "being prepared". (There is no demo / sample mode: v3.20 removed it.)
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
  // v3.12: the Account name is NOT part of the Desk's shared account any more - every seller's own registered name is
  // used automatically (see holderFor). `holder` is only an optional per-seller override.
  USD: { req: ['accountNumber', 'routing', 'swift', 'bankName'], opt: ['holder', 'bankAddress'] },
  EUR: { req: ['iban', 'swift', 'bankName'], opt: ['holder', 'bankAddress'] },
  GBP: { req: ['sortCode', 'accountNumber', 'swift', 'bankName'], opt: ['holder', 'iban', 'bankAddress'] }
};
const LABEL = { holder: 'Account name', accountNumber: 'Account number', routing: 'ABA routing number', iban: 'IBAN', sortCode: 'Sort code', swift: 'SWIFT / BIC', bankName: 'Bank name', bankAddress: 'Bank address' };

// v3.17: the country of a bank is read from its own SWIFT / BIC (letters 5-6), so it can never disagree with the bank.
const COUNTRY = { US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', IE: 'Ireland', BE: 'Belgium', AT: 'Austria', PT: 'Portugal', FI: 'Finland', LU: 'Luxembourg', GR: 'Greece', MT: 'Malta', CY: 'Cyprus', SK: 'Slovakia', SI: 'Slovenia', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', HR: 'Croatia', CH: 'Switzerland', CA: 'Canada', SG: 'Singapore', HK: 'Hong Kong', AE: 'United Arab Emirates', NG: 'Nigeria', GH: 'Ghana', ZA: 'South Africa', KE: 'Kenya', AU: 'Australia', JP: 'Japan', CN: 'China', IN: 'India', IM: 'Isle of Man', JE: 'Jersey', GG: 'Guernsey' };
const countryOf = (swift) => { const c = String(swift || '').replace(/\s/g, '').toUpperCase().slice(4, 6); return COUNTRY[c] || ''; };
const usIntro = (ccy) => `${ccy} payments are received by international SWIFT wire into the Desk’s United States bank account shown here. Your payer’s bank may convert the payment, and fees can apply. Quote your Payment reference so we can match it to you.`;
const clean = (v, n = 140) => String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- format validators (real banking rules) ----
const ibanMod97 = (iban) => { const s = iban.replace(/\s/g, ''); const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55)); let rem = 0; for (const ch of r) rem = (rem * 10 + Number(ch)) % 97; return rem; };
const abaOk = (r) => /^\d{9}$/.test(r) && (3 * (+r[0] + +r[3] + +r[6]) + 7 * (+r[1] + +r[4] + +r[7]) + (+r[2] + +r[5] + +r[8])) % 10 === 0;
const IBAN_LEN = { GB: 22, DE: 22, FR: 27, ES: 24, IT: 27, NL: 18, IE: 22, BE: 16, AT: 20, PT: 25, FI: 18, LU: 20, GR: 27, MT: 31, CY: 28, SK: 24, SI: 19, EE: 20, LV: 21, LT: 20, HR: 21, IM: 22, JE: 22, GG: 22 };
const spaced = (s) => s.replace(/(.{4})/g, '$1 ').trim();

/** Normalise + validate one field. Check-digit failures (ABA / IBAN mod-97) are WARNINGS, not errors (v3.12): the value is
 *  kept and the Desk is told to double-check it. @returns {{v?:string, err?:string, warn?:string}} */
function checkField(ccy, f, raw) {
  const t = clean(raw, f === 'bankAddress' ? 200 : 100);
  if (!t) return { err: `${LABEL[f]} is required.` };
  switch (f) {
    case 'holder': return t.length < 2 ? { err: 'Account name is too short.' } : { v: t };
    case 'bankName': return t.length < 3 ? { err: 'Bank name is too short.' } : { v: t };
    case 'bankAddress': return t.length < 8 ? { err: 'Enter the bank’s full street address.' } : { v: t };
    case 'swift': { const s = t.toUpperCase().replace(/\s/g, ''); return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) ? { v: s } : { err: 'SWIFT / BIC must be 8 or 11 characters, e.g. HBUKGB4B.' }; }
    case 'routing': { const s = t.replace(/\D/g, ''); if (!/^\d{9}$/.test(s)) return { err: 'ABA routing number must be 9 digits.' }; return abaOk(s) ? { v: s } : { v: s, warn: 'The ABA routing number was saved, but its check digit does not match - please double-check it with the bank.' }; }
    case 'sortCode': { const d = t.replace(/\D/g, ''); return /^\d{6}$/.test(d) ? { v: `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` } : { err: 'Sort code must be 6 digits (00-00-00).' }; }
    case 'accountNumber': { const d = t.replace(/[\s-]/g, ''); if (ccy === 'GBP') return /^\d{8}$/.test(d) ? { v: d } : { err: 'UK account numbers have 8 digits.' }; return /^\d{4,17}$/.test(d) ? { v: d } : { err: 'US account numbers have 4 to 17 digits.' }; }
    case 'iban': {
      const s = t.toUpperCase().replace(/\s/g, '');
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return { err: 'IBAN is not in a valid format.' };
      if (IBAN_LEN[s.slice(0, 2)] && IBAN_LEN[s.slice(0, 2)] !== s.length) return { err: `A ${s.slice(0, 2)} IBAN has ${IBAN_LEN[s.slice(0, 2)]} characters.` };
      if (ccy === 'GBP' && !/^(GB|IM|JE|GG)/.test(s)) return { err: 'A sterling account IBAN starts with GB.' };
      if (ibanMod97(s) !== 1) return { v: spaced(s), warn: 'The IBAN was saved, but its check digits do not match - please double-check every character with the bank.' };
      return { v: spaced(s) };
    }
    default: return { v: t };
  }
}
/** @returns {{ok:true, fields}|{ok:false, error, errors}} - all required fields (and any supplied optional ones) must be valid. */
function validateAccount(ccy, input, { requireAll = true } = {}) {
  const sc = SCHEMA[ccy]; if (!sc) return { ok: false, error: 'Unsupported currency.' };
  const out = {}, errors = {}, warnings = [];
  for (const f of sc.req.concat(sc.opt)) {
    const raw = input && input[f]; const isOpt = sc.opt.includes(f);
    if ((raw == null || String(raw).trim() === '') && (isOpt || !requireAll)) continue;
    const r = checkField(ccy, f, raw); if (r.err) errors[f] = r.err; else { out[f] = r.v; if (r.warn) warnings.push(`${ccy}: ${r.warn}`); }
  }
  const keys = Object.keys(errors);
  return keys.length ? { ok: false, error: `${ccy}: ${errors[keys[0]]}`, errors } : { ok: true, fields: out, warnings };
}

// ---- storage ----
const parse = (raw) => { try { return raw ? JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) : null; } catch (e) { return null; } };

async function getProfiles(store) {
  const saved = parse(await store.getSetting('bank_profiles', null)) || {};
  const out = {};
  for (const c of CCYS) { const v = validateAccount(c, saved[c] || {}); out[c] = { ccy: c, fields: saved[c] || {}, configured: !!(saved[c] && v.ok) }; }
  // v3.17: EUR / GBP can be "received into the Desk's US bank account" (same details as USD, paid as an international SWIFT wire).
  const usdOk = out.USD && out.USD.configured;
  for (const c of ['EUR', 'GBP']) if (saved[c] && saved[c].useUsd) out[c] = { ccy: c, fields: { useUsd: true }, configured: !!usdOk, useUsd: true };
  return out;
}
/** updates = { USD: {...fields}, EUR: {...}, GBP: {...} }. A currency with every field blank is cleared. */
async function setProfiles(store, updates) {
  const toSave = {}, warnings = []; const cur = parse(await store.getSetting('bank_profiles', null)) || {};
  for (const c of CCYS) {
    const u = updates && updates[c]; if (!u) { if (cur[c]) toSave[c] = cur[c]; continue; }
    if (c !== 'USD' && (u.useUsd === true || u.useUsd === 'true' || u.useUsd === 1 || u.useUsd === '1')) {
      const uu = updates.USD, uuFilled = !!uu && Object.values(uu).some((x) => String(x == null ? '' : x).trim() !== '');
      const usdV = validateAccount('USD', uuFilled ? uu : (uu ? {} : (cur.USD || {})));   // a USD block sent empty means: remove USD
      if (!usdV.ok) return { ok: false, error: `${c}: fill in and save the USD account first, then ${c} can use it.`, errors: {} };
      toSave[c] = { useUsd: true }; continue;
    }
    const blank = Object.values(u).every((x) => String(x == null ? '' : x).trim() === '');
    if (blank) continue;                                  // cleared
    const v = validateAccount(c, u); if (!v.ok) return { ok: false, error: v.error, errors: v.errors };
    const f = { ...v.fields }; delete f.holder;           // the shared account never carries a name: each seller's own name is used
    toSave[c] = f; warnings.push(...(v.warnings || []));
  }
  await store.setSetting('bank_profiles', JSON.stringify(toSave));
  return { ok: true, profiles: await getProfiles(store), warnings };
}
async function getOverride(store, groupId) { return parse(await store.getSetting(`recv_override:${groupId}`, null)); }
async function setOverride(store, group, input) {
  const ccy = group.seller_currency; if (!CCYS.includes(ccy)) return { ok: false, error: 'This seller’s currency has no receiving-account template.' };
  const v = validateAccount(ccy, input); if (!v.ok) return { ok: false, error: v.error, errors: v.errors };
  await store.setSetting(`recv_override:${group.id}`, JSON.stringify({ ccy, fields: v.fields, updatedAt: new Date().toISOString() }));
  return { ok: true, fields: v.fields, warnings: v.warnings || [] };
}
async function clearOverride(store, groupId) { await store.setSetting(`recv_override:${groupId}`, ''); }

// ---- v3.19: pool of REAL per-seller account numbers ----
// The Desk pastes numbers its bank / provider has ALREADY issued (USD / GBP account numbers, or full IBANs for EUR). The shared fields
// (routing, sort code, SWIFT, bank name ...) stay the same for everyone; each verified seller automatically receives the next free number
// and keeps it. Nothing is ever generated here: a number the bank never issued cannot receive money.
const POOL_KEY = 'acct_pool';
let poolLock = Promise.resolve();
const withPoolLock = (fn) => { const run = poolLock.then(fn, fn); poolLock = run.catch(() => {}); return run; };
const emptyPool = () => ({ USD: { free: [], used: {}, retired: [] }, EUR: { free: [], used: {}, retired: [] }, GBP: { free: [], used: {}, retired: [] } });
async function readPool(store) {
  const raw = parse(await store.getSetting(POOL_KEY, null)) || {}; const out = emptyPool();
  for (const c of CCYS) if (raw[c]) { out[c].free = Array.isArray(raw[c].free) ? raw[c].free.map(String) : []; out[c].used = raw[c].used && typeof raw[c].used === 'object' ? raw[c].used : {}; out[c].retired = Array.isArray(raw[c].retired) ? raw[c].retired.map(String) : []; }
  return out;
}
const writePool = (store, pool) => store.setSetting(POOL_KEY, JSON.stringify(pool));
/** One pasted entry -> the stored form, or an error. Stricter than the shared account: a check-digit mismatch is a refusal (it is almost always a typo). */
function poolEntry(ccy, raw) {
  const t = clean(raw, 60); if (!t) return { err: 'empty' };
  if (ccy === 'EUR') { const r = checkField('EUR', 'iban', t); return r.err ? { err: r.err } : r.warn ? { err: 'IBAN check digits do not match' } : { v: r.v }; }
  const r = checkField(ccy, 'accountNumber', t); return r.err ? { err: r.err } : { v: r.v };
}
/** Add numbers (one per line; commas / spaces also split USD & GBP). @returns {{ok, added, duplicates, invalid:[{text,error}]}} */
async function addToPool(store, ccy, text) {
  if (!CCYS.includes(ccy)) return { ok: false, error: 'Unsupported currency.' };
  const parts = String(text == null ? '' : text).split(ccy === 'EUR' ? /[\r\n;,]+/ : /[\r\n,;\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 5000);
  if (!parts.length) return { ok: false, error: 'Paste at least one number.' };
  return withPoolLock(async () => {
    const pool = await readPool(store); const seen = new Set([...pool[ccy].free, ...Object.keys(pool[ccy].used), ...pool[ccy].retired]); let added = 0, duplicates = 0; const invalid = [];
    for (const t of parts) { const e = poolEntry(ccy, t); if (e.err) { invalid.push({ text: t.slice(0, 40), error: e.err }); continue; } if (seen.has(e.v)) { duplicates++; continue; } seen.add(e.v); pool[ccy].free.push(e.v); added++; }
    if (added) await writePool(store, pool);
    return { ok: true, added, duplicates, invalid: invalid.slice(0, 10), invalidCount: invalid.length };
  });
}
async function poolStats(store) { const pool = await readPool(store); const out = {}; for (const c of CCYS) out[c] = { free: pool[c].free.length, used: Object.keys(pool[c].used).length }; return out; }
/** The number the Desk assigned to this seller (lookup only - numbers are never handed out on their own). */
async function assignedFor(store, group, ccy) {
  if (!group || !CCYS.includes(ccy)) return null;
  const pool = await readPool(store); return Object.keys(pool[ccy].used).find((k) => pool[ccy].used[k] === group.id) || null;
}
/** Once the Desk has started using per-seller numbers for a currency (any number listed or assigned), a seller sees their bank
 *  details only after the Desk has assigned theirs. Until then: "being prepared". */
async function assignmentMode(store, ccy) { const pool = await readPool(store); return !!pool[ccy] && (pool[ccy].free.length + Object.keys(pool[ccy].used).length) > 0; }
/** The Desk gives one seller a number: `number` (typed, must be a real one the bank issued) or `next` (the next free one in the list).
 *  A number can belong to only one seller. A replaced number is retired for good so it can never reach a different seller. */
async function assignNumber(store, group, { number, next } = {}) {
  const ccy = group && group.seller_currency; if (!CCYS.includes(ccy)) return { ok: false, error: 'This seller\u2019s currency has no receiving-account template.' };
  return withPoolLock(async () => {
    const pool = await readPool(store); const P = pool[ccy]; const mine = Object.keys(P.used).find((k) => P.used[k] === group.id) || null; let n;
    if (next) { if (!P.free.length) return { ok: false, error: `The ${ccy} list has no free numbers left. Add more, or type one.` }; n = P.free[0]; }
    else { const e = poolEntry(ccy, number); if (e.err) return { ok: false, error: e.err === 'empty' ? 'Type the account number to assign.' : e.err }; n = e.v; if (P.retired.includes(n)) return { ok: false, error: 'That number was retired earlier and cannot be used again.' }; if (P.used[n] && P.used[n] !== group.id) return { ok: false, error: 'That number is already assigned to another seller.' }; }
    if (mine === n) return { ok: true, number: n, changed: false };
    P.free = P.free.filter((x) => x !== n); if (mine) { delete P.used[mine]; P.retired.push(mine); } P.used[n] = group.id;
    await writePool(store, pool); return { ok: true, number: n, changed: true, replaced: mine };
  });
}
async function unassignNumber(store, group) {
  const ccy = group && group.seller_currency; if (!CCYS.includes(ccy)) return { ok: false, error: 'Unsupported currency.' };
  return withPoolLock(async () => {
    const pool = await readPool(store); const P = pool[ccy]; const mine = Object.keys(P.used).find((k) => P.used[k] === group.id); if (!mine) return { ok: true, changed: false };
    delete P.used[mine]; P.retired.push(mine); await writePool(store, pool); return { ok: true, changed: true, retired: mine };
  });
}
const withAssigned = (ccy, fields, n) => (n ? { ...fields, [ccy === 'EUR' ? 'iban' : 'accountNumber']: n } : fields);

// ---- presentation ----
/** The name an account is shown under: the seller's own registered name (HTML entities undone), unless the Desk typed a
 *  different one for this seller. This is what makes "Account name" fill in by itself for every seller. */
const unesc = (v) => String(v == null ? '' : v).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const holderFor = (group, fields) => clean((fields && fields.holder) || '', 100) || clean(unesc(group && (group.seller_full_name || group.name)), 100) || '';
function rowsFor(ccy, f, { reference } = {}) {
  const a = [['Account name', f.holder]];
  if (ccy === 'USD' || f.useUsd) a.push(['Account number', f.accountNumber], ['ABA routing number', f.routing]);
  if (ccy === 'EUR' && !f.useUsd) a.push(['IBAN', f.iban]);
  if (ccy === 'GBP' && !f.useUsd) { a.push(['Sort code', f.sortCode], ['Account number', f.accountNumber]); if (f.iban) a.push(['IBAN', f.iban]); }
  if (reference) a.push(['Payment reference', reference]);
  const b = [['SWIFT / BIC', f.swift], ['Bank name', f.bankName]]; if (f.bankAddress) b.push(['Bank address', f.bankAddress]);   // v3.18: the address is optional
  const ctry = countryOf(f.swift); if (ctry) b.push(['Bank country', ctry]);
  return { a, b };
}

/** What one seller sees. Only identity-verified sellers with an Account ID; only their own currency. */
async function getForGroup(store, group) {
  if (!group || group.kyc_status !== 'verified' || !group.seller_account_id) return { approved: false, status: group ? group.kyc_status || 'not_submitted' : 'not_submitted' };
  const ccy = group.seller_currency; const accountId = group.seller_account_id;
  const base = { approved: true, accountId, currency: ccy, holder: holderFor(group) || null };
  if (!CCYS.includes(ccy)) return { ...base, ready: false, unsupported: true };
  const ov = await getOverride(store, group.id);
  let fields = null, source = null, reference = null, assigned = null, awaiting = false;
  if (ov && ov.ccy === ccy && validateAccount(ccy, ov.fields).ok) { fields = ov.fields; source = 'seller'; }
  else { const all = await getProfiles(store); const p = all[ccy]; if (p.configured) { fields = p.useUsd ? { ...all.USD.fields, useUsd: true } : p.fields; source = 'desk'; reference = accountId; if (!p.useUsd) { assigned = await assignedFor(store, group, ccy); if (assigned) fields = withAssigned(ccy, fields, assigned); else if (await assignmentMode(store, ccy)) { awaiting = true; fields = null; source = null; reference = null; } } } }
  if (!fields) return { ...base, ready: false, awaitingNumber: awaiting };
  const { a, b } = rowsFor(ccy, { ...fields, holder: holderFor(group, source === 'desk' ? null : fields) }, { reference });
  return { ...base, ready: true, source, assigned: !!assigned, details: { [ccy]: { symbol: SYMBOL[ccy], intro: fields.useUsd ? usIntro(ccy) : INTRO[ccy], a, b } } };
}

// ---- Matching incoming payments to the receiving account (v3.11) ----
// One function decides what "the seller's receiving account" is, so the account card, the incoming-payment record,
// stage 4 of the tracker, the emails and the PDF receipt can never disagree.
const tail4 = (v) => String(v || '').replace(/[^0-9A-Za-z]/g, '').slice(-4).toUpperCase();
/** @returns {{accountId, currency, ready, source, ending, bankName, label}} */
async function receivingSnapshot(store, group) {
  const ccy = group && group.seller_currency; const accountId = (group && group.seller_account_id) || null;
  const base = { accountId, currency: ccy || null, ready: false, source: null, ending: null, bankName: null };
  base.idKind = 'accountId'; base.idLabel = accountId ? `Account ID ${accountId}` : null; base.accountNumber = null;
  if (!accountId || !CCYS.includes(ccy)) return { ...base, label: accountId ? `${ccy || ''} account`.trim() : null };
  const ov = await getOverride(store, group.id); let f = null, src = null;
  if (ov && ov.ccy === ccy && validateAccount(ccy, ov.fields).ok) { f = ov.fields; src = 'seller'; }
  else { const all = await getProfiles(store); const p = all[ccy]; if (p.configured) { f = p.useUsd ? { ...all.USD.fields, useUsd: true } : p.fields; src = 'desk'; if (!p.useUsd) { const n = await assignedFor(store, group, ccy); if (n) { f = withAssigned(ccy, f, n); src = 'seller'; } else if (await assignmentMode(store, ccy)) { f = null; src = null; } } } }
  if (!f) return { ...base, label: `${ccy} account` };
  const ending = tail4(ccy === 'EUR' && !f.useUsd ? f.iban : f.accountNumber || f.iban);
  // v3.13: once real bank details exist the payment is identified by the ACCOUNT NUMBER (IBAN for EUR); until then, by the Account ID.
  const accountNumber = String((ccy === 'EUR' && !f.useUsd ? f.iban : f.accountNumber || f.iban) || '').replace(/[\s-]/g, '');
  return { accountId, currency: ccy, ready: true, source: src, ending, bankName: f.bankName || null, label: `${ccy} account ••${ending}`, accountNumber, idKind: 'accountNumber', idLabel: `${ccy === 'EUR' && !f.useUsd ? 'IBAN' : 'Account number'} ••${ending}` };
}
/** Does the payer's bank reference carry the seller's Account ID (the payment reference we ask payers to quote)? */
function referenceCheck(accountId, ...texts) {
  const given = texts.map((t) => String(t || '')).join(' ').trim();
  if (!given) return 'none';
  return accountId && given.replace(/[\s-]/g, '').includes(String(accountId)) ? 'matched' : 'different';
}
/** v3.13: does the payer's reference carry what identifies the seller? Either the seller's Account ID, or (when the seller has a
 *  DEDICATED account of their own) that account's number. The Desk's shared pooled account number never identifies a seller by
 *  itself, so it is not accepted as a match. @returns {{result:'matched'|'different'|'none', by:'account_id'|'account_number'|null}} */
function referenceMatch(snap, ...texts) {
  const given = texts.map((t) => String(t || '')).join(' ').trim();
  if (!given) return { result: 'none', by: null };
  const flat = given.replace(/[\s-]/g, '').toUpperCase();
  if (snap && snap.accountId && flat.includes(String(snap.accountId))) return { result: 'matched', by: 'account_id' };
  if (snap && snap.ready && snap.source === 'seller' && snap.accountNumber && snap.accountNumber.length >= 6 && flat.includes(snap.accountNumber.toUpperCase())) return { result: 'matched', by: 'account_number' };
  return { result: 'different', by: null };
}
/** Admin view of one seller: the override fields, the global account, and what the seller currently sees. */
async function adminView(store, group) {
  const ccy = group.seller_currency; const ov = await getOverride(store, group.id);
  const prof = CCYS.includes(ccy) ? (await getProfiles(store))[ccy] : null;
  const eff = await getForGroup(store, group);
  return { groupId: group.id, sellerName: holderFor(group), currency: ccy, supported: CCYS.includes(ccy), verified: group.kyc_status === 'verified', schema: CCYS.includes(ccy) ? SCHEMA[ccy] : null, labels: LABEL, override: ov && ov.ccy === ccy ? ov.fields : null, globalConfigured: !!(prof && prof.configured), useUsd: !!(prof && prof.useUsd), source: eff.source || null, assigned: !!eff.assigned, assignedNumber: await assignedFor(store, group, ccy), poolFree: (await readPool(store))[ccy] ? (await readPool(store))[ccy].free.length : 0, awaitingNumber: !!eff.awaitingNumber, ready: !!eff.ready, snapshot: await receivingSnapshot(store, group) };
}

module.exports = { holderFor, CCYS, SCHEMA, LABEL, validateAccount, checkField, ibanMod97, abaOk, getProfiles, setProfiles, getOverride, setOverride, clearOverride, getForGroup, adminView, receivingSnapshot, referenceCheck, referenceMatch, addToPool, poolStats, assignedFor, assignmentMode, assignNumber, unassignNumber };
