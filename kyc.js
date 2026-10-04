// KYC auto-validation. Runs on the server BEFORE a submission reaches an admin.
//
// Philosophy (moderate, not strict): reject only what is demonstrably wrong —
// a name/date of birth that doesn't match the registered account, an expired or
// malformed ID, an unreadable or duplicated image, an under-age applicant, an ID
// number already used on another account. A clear, consistent submission passes.
//
// What this module can and can't do (stated honestly in the README):
//   * It validates structured data the applicant typed against what they registered
//     with, and inspects the uploaded files themselves (real type, size, pixel
//     dimensions, duplicates). The browser also measures sharpness/brightness and
//     runs live face detection where the device supports it; those results are
//     passed in and enforced here.
//   * It does NOT read text off the ID image (OCR) or biometrically match the
//     selfie to the ID photo — that needs a KYC provider. Passing submissions go
//     to a human reviewer (or auto-approve if the admin turns that on).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { namesMatch } = require('./security');
const CD = require('./public/countries');

const UPLOAD_DIR = path.join(__dirname, 'uploads');

const MIN_IMAGE_BYTES = 8 * 1024;
const MIN_W = 480, MIN_H = 320;
const MAX_EXPIRY_YEARS = 25;
// Client-measured sharpness (variance of Laplacian on a downscaled copy) and mean brightness (0-255).
const MIN_SHARPNESS = 12;
const MIN_BRIGHT = 35, MAX_BRIGHT = 235;

const ID_RULES = {
  passport: { label: 'passport number', re: /^[A-Z0-9]{6,9}$/ },
  national_id: { label: 'national ID number', re: /^[A-Z0-9][A-Z0-9\-\/]{4,19}$/ },
  drivers_license: { label: 'driver’s licence number', re: /^[A-Z0-9][A-Z0-9\-\/ ]{4,23}$/ }
};

function ymd(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function validDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

// ---- Minimal image inspection (no native deps) ----
function imageInfo(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  // JPEG: walk segments to the first SOFn marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { type: 'jpeg', width: 0, height: 0 };
  }
  // GIF
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  // WebP
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const fmt = buf.slice(12, 16).toString('ascii');
    if (fmt === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (fmt === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    return { type: 'webp', width: 0, height: 0 };
  }
  if (buf.slice(0, 4).toString('ascii') === '%PDF') return { type: 'pdf' };
  return null;
}

function readUpload(url) {
  const name = path.basename(String(url || ''));
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const p = path.join(UPLOAD_DIR, name);
  try {
    const buf = fs.readFileSync(p);
    return { buf, size: buf.length, hash: crypto.createHash('sha256').update(buf).digest('hex'), info: imageInfo(buf) };
  } catch (_) { return null; }
}

// input: { docType, idNumber, idName, idDob, idExpiry, idCountry,
//          idFrontUrl, idBackUrl, proofAddressUrl, selfieUrl,
//          quality: { idFront:{sharp,bright}, idBack:{...}, selfie:{...} },
//          face: { live:boolean, detected: true|false|null } }
// ctx:   { group, allGroups }
function validateSubmission(input, ctx, now = new Date()) {
  const reasons = [];
  const add = (r) => { if (!reasons.includes(r)) reasons.push(r); };
  const { group, allGroups = [] } = ctx;
  const rule = ID_RULES[input.docType];
  if (!rule) return { ok: false, reasons: ['Please choose a valid document type.'] };

  // --- Identity details vs the registered account ---
  const idName = String(input.idName || '').trim();
  if (idName.length < 3) add('Enter your full name exactly as it appears on the ID.');
  else if (group.seller_full_name && !namesMatch(idName, String(group.seller_full_name).replace(/&amp;|&#39;|&quot;/g, ''))) {
    add(`The name on your ID (“${idName}”) does not match the name on your account (“${String(group.seller_full_name).replace(/&amp;|&#39;|&quot;/g, '')}”).`);
  }

  const dob = validDateStr(input.idDob);
  if (!dob) add('Enter the date of birth shown on your ID.');
  else {
    const reg = ymd(group.seller_date_of_birth);
    if (reg && reg !== input.idDob) add('The date of birth on your ID does not match the date of birth you registered with.');
    const age = (now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) add('You must be at least 18 years old.');
    if (age > 120) add('The date of birth on your ID does not look valid.');
  }

  const exp = validDateStr(input.idExpiry);
  if (!exp) add('Enter the expiry date shown on your ID.');
  else {
    const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
    if (exp.getTime() < today.getTime()) add('This ID has expired. Please upload a valid, unexpired document.');
    else if (exp.getTime() > today.getTime() + MAX_EXPIRY_YEARS * 366 * 24 * 3600 * 1000) add('The expiry date does not look valid.');
  }

  const num = String(input.idNumber || '').trim().toUpperCase();
  if (!num) add(`Enter your ${rule.label}.`);
  else if (!rule.re.test(num)) add(`That ${rule.label} does not look valid. Check it against your document.`);
  else if (allGroups.some((g) => g.id !== group.id && g.kyc_id_number && String(g.kyc_id_number).toUpperCase() === num && g.kyc_status !== 'rejected')) {
    add('This ID number is already registered to another account.');
  }

  const country = CD.find(input.idCountry);
  if (!country) add('Select the country that issued your ID.');

  // --- The files themselves ---
  const slots = [['idFront', input.idFrontUrl, 'ID (front)', true]];
  if (input.docType !== 'passport') slots.push(['idBack', input.idBackUrl, 'ID (back)', true]);
  slots.push(['selfie', input.selfieUrl, 'selfie', true], ['proof', input.proofAddressUrl, 'proof of address', false]);
  const hashes = {};
  for (const [key, url, label, imageOnly] of slots) {
    const f = readUpload(url);
    if (!f) { add(`Your ${label} did not upload correctly. Please upload it again.`); continue; }
    hashes[key] = f.hash;
    const t = f.info && f.info.type;
    if (!t) { add(`Your ${label} is not a readable image or PDF.`); continue; }
    if (imageOnly && t === 'pdf') { add(`Your ${label} must be a photo (JPG or PNG), not a PDF.`); continue; }
    if (t !== 'pdf') {
      if (f.size < MIN_IMAGE_BYTES) add(`Your ${label} is too small or heavily compressed to read.`);
      if (f.info.width && f.info.height && (Math.max(f.info.width, f.info.height) < MIN_W || Math.min(f.info.width, f.info.height) < MIN_H) && key !== 'selfie') {
        add(`Your ${label} resolution is too low (${f.info.width}×${f.info.height}). Use a clearer, larger photo.`);
      }
      if (key === 'selfie' && f.info.width && Math.min(f.info.width, f.info.height) < 240) add('Your selfie resolution is too low.');
    }
  }
  const seen = {};
  for (const [k, h] of Object.entries(hashes)) {
    if (seen[h]) {
      const pair = [seen[h], k].sort().join('+');
      if (pair.includes('selfie')) add('Your selfie must be a live photo of your face, not the same image as another document.');
      else if (pair === 'idBack+idFront') add('The front and back of your ID cannot be the same image.');
      else add('The same file was uploaded for two different documents.');
    } else seen[h] = k;
  }

  // --- Client-measured clarity (advisory inputs enforced here) ---
  const q = input.quality || {};
  for (const [key, label] of [['idFront', 'ID (front)'], ['idBack', 'ID (back)']]) {
    const m = q[key];
    if (key === 'idBack' && input.docType === 'passport') continue;
    if (m && Number.isFinite(m.sharp) && m.sharp < MIN_SHARPNESS) add(`Your ${label} looks blurry. Hold the camera steady and retake it.`);
    if (m && Number.isFinite(m.bright) && (m.bright < MIN_BRIGHT || m.bright > MAX_BRIGHT)) add(`Your ${label} is ${m.bright < MIN_BRIGHT ? 'too dark' : 'overexposed'}. Retake it in even lighting.`);
  }
  const sm = q.selfie;
  if (sm && Number.isFinite(sm.bright) && (sm.bright < MIN_BRIGHT || sm.bright > MAX_BRIGHT)) add('Your face is not clearly lit. Retake the selfie in even lighting.');

  // --- Face verification (live camera + face detection when supported) ---
  const face = input.face || {};
  if (face.live !== true) add('Please complete the live face verification step.');
  else if (face.detected === false) add('We could not clearly detect your face. Face the camera, remove sunglasses or a mask, and try again.');

  return {
    ok: reasons.length === 0, reasons,
    normalized: reasons.length ? null : {
      idNumber: num, idName, idDob: input.idDob, idExpiry: input.idExpiry, idCountry: country ? country.n : null,
      faceChecked: face.detected === true ? 'detected' : 'captured'
    }
  };
}

// Business account (unlimited withdrawals) — structured validation.
function validateBusiness(b) {
  const errors = [];
  const t = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const out = {
    businessName: t(b.businessName, 200), tradingName: t(b.tradingName, 200), regNumber: t(b.regNumber, 60).toUpperCase(),
    taxNumber: t(b.taxNumber, 60).toUpperCase(), incorporationCountry: t(b.incorporationCountry, 100), incorporationDate: t(b.incorporationDate, 10),
    businessType: t(b.businessType, 60), industry: t(b.industry, 120), address: t(b.address, 300), website: t(b.website, 200),
    contactName: t(b.contactName, 120), contactRole: t(b.contactRole, 120), expectedMonthlyVolume: t(b.expectedMonthlyVolume, 60),
    sourceOfFunds: t(b.sourceOfFunds, 400), registrationDocUrl: t(b.registrationDocUrl, 300), taxDocUrl: t(b.taxDocUrl, 300),
    addressDocUrl: t(b.addressDocUrl, 300), uboName: t(b.uboName, 200), uboOwnershipPct: t(b.uboOwnershipPct, 6)
  };
  if (out.businessName.length < 2) errors.push('Enter the registered business name.');
  if (!/^[A-Z0-9][A-Z0-9\-\/. ]{3,59}$/.test(out.regNumber)) errors.push('Enter a valid company registration number.');
  if (!/^[A-Z0-9][A-Z0-9\-\/. ]{3,59}$/.test(out.taxNumber)) errors.push('Enter a valid tax identification number.');
  if (!CD.find(out.incorporationCountry)) errors.push('Select the country of incorporation.');
  const inc = validDateStr(out.incorporationDate);
  if (!inc || inc.getTime() > Date.now()) errors.push('Enter a valid incorporation date.');
  if (!out.businessType) errors.push('Select the business type.');
  if (out.address.length < 8) errors.push('Enter the registered business address.');
  if (out.contactName.length < 3) errors.push('Enter the authorised contact’s full name.');
  if (out.sourceOfFunds.length < 5) errors.push('Briefly describe the source of funds.');
  if (out.uboName.length < 3) errors.push('Enter the ultimate beneficial owner’s name.');
  const pct = Number(out.uboOwnershipPct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) errors.push('Enter the beneficial owner’s ownership percentage (1–100).');
  const urlRe = /^\/uploads\/[A-Za-z0-9._-]+$/;
  if (!urlRe.test(out.registrationDocUrl)) errors.push('Upload the certificate of incorporation / registration.');
  if (!urlRe.test(out.taxDocUrl)) errors.push('Upload a tax registration document.');
  if (out.addressDocUrl && !urlRe.test(out.addressDocUrl)) errors.push('The address document did not upload correctly.');
  if (out.website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(out.website)) errors.push('The website must start with http:// or https://');
  return errors.length ? { errors } : { value: out };
}

module.exports = { validateSubmission, validateBusiness, imageInfo, readUpload, ID_RULES, MIN_SHARPNESS };
