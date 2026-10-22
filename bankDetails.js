// Receiving account details for approved sellers (USD / EUR / GBP).
//
// - The bank PROFILE (bank name, address, SWIFT/BIC, routing or sort code) is set by the Desk in Controls ->
//   "Receiving bank details" and is stored in the settings table. Until it is saved the sample profile below is
//   used and every card says "Sample data only", so sample numbers can never be mistaken for real ones.
// - The seller's own numbers (account number / IBAN) are issued once, when identity verification is approved, and
//   then FROZEN for that seller (stored under `recv:<groupId>`). Changing the profile later does not change
//   details already issued; the Desk can re-issue a seller on request.
// - IBANs are generated with the real ISO 13616 mod-97 check digits, so they pass any IBAN validator.
const crypto = require('crypto');

const CCYS = ['USD', 'EUR', 'GBP'];
const SAMPLE = {
  USD: { symbol: '$', bankName: 'Northvale Bank N.A.', bankAddress: '100 Example Street, New York, NY', swift: 'NVLBUS33', routing: '000111222',
    intro: 'US dollar account. Receive USD from anywhere in the world.', note: 'International USD payments may pass through an intermediary bank. Allow 1 to 3 business days.' },
  EUR: { symbol: '€', bankName: 'Northvale Bank Europe AG', bankAddress: 'Beispielplatz 1, 60311 Frankfurt', swift: 'NVLBDEFF', ibanCountry: 'DE', bankCode: '00000000',
    intro: 'Euro account. Receive EUR via SEPA and international transfers.', note: 'SEPA transfers usually arrive within one business day. Use the IBAN for all euro payments.' },
  GBP: { symbol: '£', bankName: 'Northvale Bank UK Ltd', bankAddress: '1 Example Row, London EC2', swift: 'NVLBGB2L', sortCode: '00-00-00', ibanBank: 'NVLB',
    intro: 'Pound account. Receive GBP via Faster Payments and SWIFT.', note: 'UK payments need the sort code and account number. Overseas senders should use the IBAN and SWIFT.' }
};
const FIELDS = { USD: ['bankName', 'bankAddress', 'swift', 'routing'], EUR: ['bankName', 'bankAddress', 'swift', 'bankCode'], GBP: ['bankName', 'bankAddress', 'swift', 'sortCode', 'ibanBank'] };
const RX = { swift: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, routing: /^\d{9}$/, bankCode: /^\d{8}$/, sortCode: /^\d{2}-\d{2}-\d{2}$/, ibanBank: /^[A-Z]{4}$/ };

const clean = (v, n = 140) => String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);

async function getProfiles(store) {
  let saved = {};
  try { const raw = await store.getSetting('bank_profiles', null); if (raw) saved = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); } catch (e) { saved = {}; }
  const out = {};
  for (const c of CCYS) out[c] = { ccy: c, ...SAMPLE[c], ...(saved[c] || {}), sample: !saved[c] };
  return out;
}

/** @returns {{ok:true, profiles}|{ok:false, error}} */
async function setProfiles(store, updates) {
  const cur = await getProfiles(store); const toSave = {};
  for (const c of CCYS) {
    const u = updates && updates[c]; const base = { ...cur[c] };
    if (u) for (const f of FIELDS[c]) if (u[f] != null && String(u[f]).trim() !== '') base[f] = f === 'swift' || f === 'ibanBank' ? clean(u[f], 11).toUpperCase().replace(/\s/g, '') : clean(u[f], f === 'bankAddress' ? 200 : 100);
    for (const f of FIELDS[c]) {
      if (!base[f]) return { ok: false, error: `${c}: "${f}" is required.` };
      if (RX[f] && !RX[f].test(base[f])) return { ok: false, error: `${c}: "${f}" is not in a valid format.` };
    }
    toSave[c] = Object.fromEntries(FIELDS[c].map((f) => [f, base[f]]));
  }
  await store.setSetting('bank_profiles', JSON.stringify(toSave));
  return { ok: true, profiles: await getProfiles(store) };
}

// ---- number generation ----
const digitsFrom = (seed, n, firstNonZero) => {
  let h = crypto.createHash('sha256').update(seed).digest('hex'), out = '';
  for (const ch of h) { out += String(parseInt(ch, 16) % 10); if (out.length >= n) break; }
  if (firstNonZero && out[0] === '0') out = String(1 + (parseInt(h[0], 16) % 9)) + out.slice(1);
  return out;
};
function ibanCheck(country, bban) {
  const rearr = bban + country + '00'; let rem = 0;
  for (const ch of rearr.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))) rem = (rem * 10 + Number(ch)) % 97;
  return String(98 - rem).padStart(2, '0');
}
const iban = (country, bban) => country + ibanCheck(country, bban) + bban;
const spaced = (s) => s.replace(/(.{4})/g, '$1 ').trim();

function build(ccy, p, accountId) {
  const seed = `${accountId}|${ccy}|recv`;
  if (ccy === 'USD') return { number: digitsFrom(seed, 10, true), routing: p.routing };
  if (ccy === 'EUR') { const acct = digitsFrom(seed, 10, true); return { iban: spaced(iban(p.ibanCountry || 'DE', p.bankCode + acct)) }; }
  const acct = digitsFrom(seed, 8, true); const sort6 = p.sortCode.replace(/-/g, '');
  return { sortCode: p.sortCode, number: acct, iban: spaced(iban('GB', p.ibanBank + sort6 + acct)) };
}

function rowsFor(ccy, holder, p, nums) {
  const a = [['Account name', holder]];
  if (ccy === 'USD') a.push(['Account number', nums.number], ['ABA routing number', nums.routing]);
  if (ccy === 'EUR') a.push(['IBAN', nums.iban]);
  if (ccy === 'GBP') a.push(['Sort code', nums.sortCode], ['Account number', nums.number], ['IBAN', nums.iban]);
  const b = [['SWIFT / BIC', p.swift], ['Bank name', p.bankName], ['Bank address', p.bankAddress]];
  return { a, b };
}

async function issue(store, group, profiles) {
  const accountId = group.seller_account_id; const holder = group.seller_full_name || 'Account holder';
  const details = {};
  for (const c of CCYS) { const p = profiles[c]; const { a, b } = rowsFor(c, holder, p, build(c, p, accountId)); details[c] = { symbol: p.symbol, intro: p.intro, note: p.note, sample: !!p.sample, a, b }; }
  const rec = { issuedAt: new Date().toISOString(), accountId, holder, details };
  await store.setSetting(`recv:${group.id}`, JSON.stringify(rec));
  return rec;
}

/** Details for one seller. Only an identity-verified seller with an Account ID gets any. */
async function getForGroup(store, group, { reissue = false } = {}) {
  if (!group || group.kyc_status !== 'verified' || !group.seller_account_id) return { approved: false, status: group ? group.kyc_status || 'not_submitted' : 'not_submitted' };
  let rec = null;
  if (!reissue) { try { const raw = await store.getSetting(`recv:${group.id}`, null); if (raw) rec = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); } catch (e) { rec = null; } }
  if (!rec || rec.accountId !== group.seller_account_id) rec = await issue(store, group, await getProfiles(store));
  return { approved: true, issuedAt: rec.issuedAt, holder: rec.holder, accountId: rec.accountId, currency: group.seller_currency || null, details: rec.details };
}

module.exports = { CCYS, SAMPLE, FIELDS, getProfiles, setProfiles, getForGroup, ibanCheck, iban };
