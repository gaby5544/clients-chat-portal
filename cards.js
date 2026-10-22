// AIRWX virtual card (Visa) - eligibility, application, the 20 USD issuing fee, and the Desk-issued card itself.
//
// Rules the Desk asked for:
//   * Not eligible by default. A seller only becomes eligible when an admin switches it on for THAT seller.
//   * A seller who is not eligible sees "not eligible - contact Support" and nothing else (no pop-ups, no hints).
//   * Once enabled: apply -> pay the 20 USD issuing fee -> wait while the Desk generates the card -> card is live.
//
// Card numbers are NEVER invented here. A card number only exists once a real issuer has issued one; the Desk types
// the issued details in (validated: Visa prefix, Luhn check digit, expiry, CVV). The number and CVV are stored
// encrypted (AES-256-GCM, vault.js), are never sent in lists or to admins, and reach only the owning seller on request.

const crypto = require('crypto');
const vault = require('./vault');

const PROGRAM = 'AIRWX';
const NETWORK = 'Visa';
const FEE_USD = Number(process.env.CARD_FEE_USD) > 0 ? Number(process.env.CARD_FEE_USD) : 20;

const parse = (raw) => { try { return raw ? JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) : null; } catch (e) { return null; } };
const kElig = (gid) => `card_elig:${gid}`;
const kCard = (gid) => `card:${gid}`;

async function isEligible(store, gid) { return String(await store.getSetting(kElig(gid), '')) === 'true'; }
async function setEligible(store, gid, on) { await store.setSetting(kElig(gid), on ? 'true' : ''); }
async function getCard(store, gid) { return parse(await store.getSetting(kCard(gid), null)); }
async function saveCard(store, gid, rec) { await store.setSetting(kCard(gid), JSON.stringify(rec)); return rec; }

// ---- validation ----
function luhnOk(num) {
  const s = String(num || '').replace(/\D/g, ''); if (s.length < 12) return false;
  let sum = 0, alt = false;
  for (let i = s.length - 1; i >= 0; i--) { let n = s.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
/** @returns {{ok:true, v}|{ok:false, error}} v = { pan, expMonth, expYear, cvv, holder } */
function validateIssued(input, fallbackHolder, now = new Date()) {
  const pan = String((input && input.pan) || '').replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(pan)) return { ok: false, error: 'The card number must be 16 digits.' };
  if (pan[0] !== '4') return { ok: false, error: 'AIRWX cards are Visa cards: the number must start with 4.' };
  if (!luhnOk(pan)) return { ok: false, error: 'That card number is not valid (the check digit does not match). Please re-check it.' };
  const mm = Number(input && input.expMonth); let yy = Number(input && input.expYear);
  if (!Number.isInteger(mm) || mm < 1 || mm > 12) return { ok: false, error: 'The expiry month must be between 1 and 12.' };
  if (!Number.isInteger(yy)) return { ok: false, error: 'Please enter the expiry year.' };
  if (yy < 100) yy += 2000;
  const endOfMonth = new Date(Date.UTC(yy, mm, 1)).getTime();
  if (endOfMonth <= now.getTime()) return { ok: false, error: 'That expiry date has already passed.' };
  if (yy > now.getUTCFullYear() + 10) return { ok: false, error: 'That expiry date is too far in the future.' };
  const cvv = String((input && input.cvv) || '').trim();
  if (!/^\d{3}$/.test(cvv)) return { ok: false, error: 'The security code (CVV) must be 3 digits.' };
  const holder = String((input && input.holder) || fallbackHolder || '').replace(/&amp;/g, '&').replace(/[^A-Za-z .'\-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 26);
  if (holder.length < 2) return { ok: false, error: 'Please enter the cardholder name (letters only, as it should print on the card).' };
  return { ok: true, v: { pan, expMonth: mm, expYear: yy, cvv, holder } };
}
const panHash = (pan) => crypto.createHash('sha256').update('airwx-pan|' + pan).digest('hex');

// ---- money ----
const feeFor = (convert, ccy) => ({ usd: FEE_USD, ledger: convert(FEE_USD, 'USD', ccy), currency: ccy });

// ---- what each audience sees ----
/** The seller's view. A seller who is not eligible gets {eligible:false} and NOTHING else. */
async function sellerView(store, group, { convert }) {
  if (!(await isEligible(store, group.id))) return { eligible: false };
  const rec = await getCard(store, group.id);
  const ccy = group.seller_currency || 'USD';
  const fee = feeFor(convert, ccy);
  const avail = Number(group.balance_available || 0);
  const out = {
    eligible: true, program: PROGRAM, network: NETWORK, status: rec ? rec.status : 'none',
    fee: { usd: fee.usd, amount: fee.ledger, currency: ccy, paid: !!(rec && rec.fee && rec.fee.paidAt), paidAt: rec && rec.fee ? rec.fee.paidAt || null : null, ref: rec && rec.fee ? rec.fee.ref || null : null },
    balance: { available: avail, enough: avail + 1e-9 >= fee.ledger, short: Math.max(0, Math.round((fee.ledger - avail) * 100) / 100) },
    verified: group.kyc_status === 'verified', holder: (group.seller_full_name || '').replace(/&amp;/g, '&')
  };
  if (rec) {
    out.appliedAt = rec.appliedAt || null;
    if (rec.status === 'declined') out.declinedReason = rec.declinedReason || null;
    if (rec.status === 'issued' || rec.status === 'frozen') {
      out.card = { last4: rec.last4, expMonth: rec.expMonth, expYear: rec.expYear, holder: rec.holder, issuedAt: rec.issuedAt, frozen: rec.status === 'frozen' };
    }
  }
  return out;
}
/** The Desk's view of one seller. Never contains the card number or CVV, only the last four digits. */
async function adminView(store, group, { convert }) {
  const rec = await getCard(store, group.id);
  const ccy = group.seller_currency || 'USD';
  return {
    groupId: group.id, sellerName: (group.seller_full_name || group.name || '').replace(/&amp;/g, '&'), accountId: group.seller_account_id || null, currency: ccy,
    verified: group.kyc_status === 'verified', eligible: await isEligible(store, group.id), status: rec ? rec.status : 'none',
    fee: { usd: FEE_USD, amount: feeFor(convert, ccy).ledger, currency: ccy, paid: !!(rec && rec.fee && rec.fee.paidAt), paidAt: rec && rec.fee ? rec.fee.paidAt || null : null, ref: rec && rec.fee ? rec.fee.ref || null : null },
    appliedAt: rec ? rec.appliedAt || null : null, issuedAt: rec ? rec.issuedAt || null : null, last4: rec ? rec.last4 || null : null,
    holder: rec ? rec.holder || null : null, declinedReason: rec ? rec.declinedReason || null : null, reveals: rec ? rec.reveals || 0 : 0, lastRevealAt: rec ? rec.lastRevealAt || null : null
  };
}

module.exports = { PROGRAM, NETWORK, FEE_USD, isEligible, setEligible, getCard, saveCard, luhnOk, validateIssued, panHash, feeFor, sellerView, adminView, vault };
