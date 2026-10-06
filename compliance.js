// Compliance rules in one place: the crypto prior-deposit requirement (tiered,
// degressive — see crypto-withdrawal-deposit-requirement spec), the daily
// withdrawal cap / business-account upgrade, and moderate automatic KYC checks.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const F = require('./finance');
const { namesRoughlyMatch } = require('./security');

// ------------------------------------------------------------------
// 1. Crypto prior-deposit requirement (spec §2–§6)
// ------------------------------------------------------------------
const SETTING_KEY_CRYPTO = 'crypto_deposit_policy';

// Boundaries and the chosen value inside each range are configurable; these
// are the defaults (mid-point of each range in the spec) until compliance
// signs off the exact values (spec §7). Percentages are fractions (0.20 = 20%).
const DEFAULT_CRYPTO_POLICY = {
  boundaries: [10000, 100000, 1000000],           // USD — tier 1 < b0, tier 2 <= b1, tier 3 <= b2, tier 4 > b2
  tiers: [
    { id: 1, minPct: 0.15, maxPct: 0.25, pct: 0.20 },
    { id: 2, minPct: 0.05, maxPct: 0.10, pct: 0.075 },
    { id: 3, minPct: 0.01, maxPct: 0.05, pct: 0.03 },
    { id: 4, flatMin: 5000, flatMax: 25000, flat: 15000 }
  ],
  cumulative: true,        // spec §6: multiple smaller deposits count toward the requirement
  vipBypass: true          // spec §4.5: admin may flip crypto_deposit_verified manually
};

function sanitizePolicy(input) {
  const base = JSON.parse(JSON.stringify(DEFAULT_CRYPTO_POLICY));
  if (!input || typeof input !== 'object') return base;
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  if (Array.isArray(input.boundaries) && input.boundaries.length === 3) {
    const b = input.boundaries.map(Number);
    if (b.every(Number.isFinite) && b[0] > 0 && b[0] < b[1] && b[1] < b[2]) base.boundaries = b;
  }
  if (Array.isArray(input.tiers)) {
    for (let i = 0; i < 3; i++) {
      const src = input.tiers[i] || {}; const t = base.tiers[i];
      t.minPct = num(src.minPct, 0, 1, t.minPct);
      t.maxPct = num(src.maxPct, t.minPct, 1, t.maxPct);
      t.pct = num(src.pct, t.minPct, t.maxPct, Math.min(Math.max(t.pct, t.minPct), t.maxPct));
    }
    const s4 = input.tiers[3] || {}; const t4 = base.tiers[3];
    t4.flatMin = num(s4.flatMin, 0, 1e9, t4.flatMin);
    t4.flatMax = num(s4.flatMax, t4.flatMin, 1e9, t4.flatMax);
    t4.flat = num(s4.flat, t4.flatMin, t4.flatMax, Math.min(Math.max(t4.flat, t4.flatMin), t4.flatMax));
  }
  if (typeof input.cumulative === 'boolean') base.cumulative = input.cumulative;
  if (typeof input.vipBypass === 'boolean') base.vipBypass = input.vipBypass;
  return base;
}

function findTier(amountUsd, policy) {
  const [b0, b1, b2] = policy.boundaries;
  if (amountUsd < b0) return policy.tiers[0];
  if (amountUsd <= b1) return policy.tiers[1];
  if (amountUsd <= b2) return policy.tiers[2];
  return policy.tiers[3];
}

/** Required crypto deposit, in USD, for a withdrawal of `amountUsd`. */
function requiredCryptoDepositUsd(amountUsd, policy) {
  const tier = findTier(amountUsd, policy);
  if (tier.flat !== undefined) return F.round2(tier.flat);
  return F.round2(amountUsd * tier.pct);
}

/**
 * canWithdrawCrypto(): spec §5. `verifiedCryptoDepositsUsd` is the sum of this
 * seller's admin-verified crypto deposits (in USD); `group.crypto_deposit_verified`
 * is the one-time unlock flag.
 */
function canWithdrawCrypto(group, amountUsd, policy, verifiedCryptoDepositsUsd) {
  if (group.crypto_deposit_verified) return { allowed: true, reason: 'verified' };
  const requiredUsd = requiredCryptoDepositUsd(amountUsd, policy);
  const have = policy.cumulative ? verifiedCryptoDepositsUsd : 0;
  if (have + 1e-9 >= requiredUsd) return { allowed: true, reason: 'meets_requirement', requiredUsd, haveUsd: have, autoVerify: true };
  const tier = findTier(amountUsd, policy);
  return {
    allowed: false, requiredUsd, haveUsd: F.round2(have), shortfallUsd: F.round2(requiredUsd - have),
    tierId: tier.id, tierPct: tier.flat !== undefined ? null : tier.pct, flat: tier.flat !== undefined
  };
}

// ------------------------------------------------------------------
// 2. Daily withdrawal cap & business (unlimited) accounts
// ------------------------------------------------------------------
const DAILY_WITHDRAWAL_CAP = Number(process.env.DAILY_WITHDRAWAL_CAP) || 10000000; // in the account's own currency

function startOfUtcDayIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// ------------------------------------------------------------------
// 3. Automatic (moderate) KYC validation
// ------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const UPLOAD_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;

function fileFromUrl(url) {
  if (typeof url !== 'string' || !UPLOAD_URL_RE.test(url)) return null;
  const p = path.join(UPLOAD_DIR, path.basename(url));
  return p.startsWith(UPLOAD_DIR) && fs.existsSync(p) ? p : null;
}

// Width/height from the file header (no image library needed). Returns null for PDFs/unknown.
function readImageInfo(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return { type: 'jpeg', width: 0, height: 0 };
    }
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      if (buf.toString('ascii', 12, 16) === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return { type: 'webp', width: 0, height: 0 };
    }
    if (buf.length > 5 && buf.toString('ascii', 0, 5) === '%PDF-') return { type: 'pdf' };
  } catch (e) { /* fall through */ }
  return null;
}

function inspectUpload(url) {
  const p = fileFromUrl(url);
  if (!p) return { exists: false };
  const buf = fs.readFileSync(p);
  return { exists: true, size: buf.length, info: readImageInfo(buf), hash: crypto.createHash('sha1').update(buf).digest('hex') };
}

const ID_PATTERNS = {
  passport: { re: /^[A-Z0-9]{6,12}$/, hint: 'A passport number is 6–12 letters and numbers, with no spaces.' },
  national_id: { re: /^[A-Z0-9][A-Z0-9\-\/]{4,23}$/, hint: 'A national ID number is 5–24 letters, numbers or hyphens.' },
  drivers_license: { re: /^[A-Z0-9][A-Z0-9\-\/ ]{4,23}$/, hint: 'A driver\'s licence number is 5–24 letters, numbers or hyphens.' }
};

function looksFakeNumber(n) {
  const s = n.replace(/[^A-Z0-9]/g, '');
  if (/^(.)\1+$/.test(s)) return true;                                    // 000000, AAAAAA
  if (/^(0123456789|1234567890|123456789|12345678|1234567|123456|987654321|87654321)$/.test(s)) return true;
  if (/^(TEST|DEMO|SAMPLE|FAKE|XXXX)/.test(s)) return true;
  return false;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(String(v).length === 10 ? v + 'T00:00:00Z' : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Moderate, explainable validation of a KYC submission. Every failed check
 * produces a plain-English reason the seller sees; a submission only goes
 * through to the Desk when every hard check passes.
 */
function validateKyc(input, account, now = new Date()) {
  const checks = []; const reasons = [];
  const add = (key, label, ok, failReason) => { checks.push({ key, label, ok }); if (!ok && failReason) reasons.push(failReason); };

  const docType = input.docType;
  const pat = ID_PATTERNS[docType];
  const number = String(input.idNumber || '').trim().toUpperCase();

  // --- ID number ---
  add('id_number', 'ID number format', !!pat && pat.re.test(number) && !looksFakeNumber(number),
    !number ? 'The ID number is missing.' : (pat && !pat.re.test(number)) ? `The ID number looks invalid. ${pat.hint}` : 'The ID number entered does not look genuine. Please copy it exactly as printed on your document.');

  // --- Name / date of birth: checked only when the seller typed them (they are no longer required) ---
  if (input.idName) {
    add('id_name', 'Name matches your account', namesRoughlyMatch(input.idName, account.fullName),
      `The name on your ID ("${String(input.idName).slice(0, 60)}") does not match the name on your account ("${account.fullName}"). Please use the same legal name.`);
  }
  if (input.idDob) {
    const dobId = parseDate(input.idDob); const dobAcct = parseDate(account.dateOfBirth);
    add('id_dob', 'Date of birth matches', !!dobId && !!dobAcct && dobId.toISOString().slice(0, 10) === dobAcct.toISOString().slice(0, 10),
      !dobId ? 'The date of birth entered is not valid.' : 'The date of birth on your ID does not match the date of birth on your account.');
  }

  // --- Expiry ---
  const exp = parseDate(input.idExpiry);
  let expOk = !!exp;
  let expReason = 'Please enter the expiry date shown on your ID.';
  if (exp) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (exp.getTime() < today.getTime()) { expOk = false; expReason = `This ID expired on ${exp.toISOString().slice(0, 10)}. Please upload a valid, unexpired document.`; }
    else if (exp.getUTCFullYear() > now.getUTCFullYear() + 25) { expOk = false; expReason = 'The expiry date looks incorrect. Please check it against your document.'; }
  }
  add('id_expiry', 'ID is not expired', expOk, expReason);

  // --- Files: present, readable, not tiny, not duplicated ---
  const slots = [['idFront', 'front of your ID', input.idFrontUrl, 600], ['idBack', 'back of your ID', docType === 'passport' ? null : input.idBackUrl, 600],
    ['proof', 'proof of address', input.proofAddressUrl, 400], ['selfie', 'selfie', input.selfieUrl, 320]];
  const seen = new Map();
  for (const [key, label, url, minSide] of slots) {
    if (key === 'idBack' && docType === 'passport') continue;
    const ins = inspectUpload(url);
    if (!ins.exists) { add('file_' + key, `${label} uploaded`, false, `The ${label} could not be read. Please upload it again.`); continue; }
    let ok = true; let why = '';
    if (ins.info && ins.info.type !== 'pdf') {
      const w = ins.info.width, h = ins.info.height;
      if (w && h && Math.min(w, h) < minSide) { ok = false; why = `The ${label} is too small or low-resolution (${w}×${h}). Take a clearer, closer photo so every detail is readable.`; }
    }
    if (ins.size < (key === 'selfie' ? 12000 : 20000)) { ok = false; why = why || `The ${label} looks blank or too low quality. Please upload a clear photo.`; }
    if (ins.hash && seen.has(ins.hash)) { ok = false; why = `The ${label} is the same file as your ${seen.get(ins.hash)}. Each document must be a separate image.`; }
    if (ins.hash) seen.set(ins.hash, label);
    add('file_' + key, `${label} is clear`, ok, why);
  }

  // --- Client-side image quality + live face check (advisory metrics from the browser) ---
  const q = input.quality || {};
  for (const [k, label] of [['idFront', 'front of your ID'], ['idBack', 'back of your ID']]) {
    if (k === 'idBack' && docType === 'passport') continue;
    if (q[k] && q[k].blurry === true) add('blur_' + k, `${label} is sharp`, false, `The ${label} looks blurry. Hold the camera steady, use good light and keep the whole document in frame.`);
  }
  // Face: a lenient check. We only reject when the browser's own face detector looked and found NO face,
  // or the photo is clearly too dark. If the fallback (colour-based) check was unsure, the submission still
  // goes through and is flagged for the Desk to eyeball — nobody is locked out by a machine guess.
  const face = input.face || {};
  const nativeNo = face.method === 'native' && face.detected === false;
  add('face', 'Face clearly visible', !nativeNo, 'We could not clearly see your face in the selfie. Look straight at the camera in good light, remove sunglasses or a mask, and keep your whole face inside the oval.');
  if (face.tooDark === true) add('face_light', 'Selfie is well lit', false, 'Your selfie is too dark. Please retake it somewhere brighter.');
  const faceUnverified = face.detected !== true && !nativeNo && face.tooDark !== true;

  return { passed: reasons.length === 0, reasons, checks, faceUnverified, checkedAt: now.toISOString() };
}

module.exports = {
  SETTING_KEY_CRYPTO, DEFAULT_CRYPTO_POLICY, sanitizePolicy, findTier, requiredCryptoDepositUsd, canWithdrawCrypto,
  DAILY_WITHDRAWAL_CAP, startOfUtcDayIso, validateKyc, readImageInfo, ID_PATTERNS
};
