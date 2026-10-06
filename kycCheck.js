// Automatic KYC pre-check. Deliberately MODERATE — neither strict nor a rubber
// stamp: it rejects only clear problems and tells the seller exactly why, so a
// valid, readable submission goes straight through to the Desk's review queue.
//
// Rejected with a reason:
//   * expired ID / expiry date missing or not a real date / expiry absurdly far away
//   * name on the ID does not match the registered name (word-level, order/case/accent insensitive)
//   * ID number that is clearly not an ID number (too short/long, one repeated character, a plain sequence)
//   * the same ID number already used on another seller account
//   * image documents that are unreadable: far too small, extremely blurry, almost black or blown-out
//   * a selfie that is not an image / is too small to show a face
// Passed through (never auto-rejected): PDFs (only checked for being a real PDF of sensible size),
// slightly soft photos, ordinary lighting, small differences in spelling of a name.
//
// FACE MATCHING (free, on your own server — no paid KYC provider): faceMatch.js compares the face on the ID
// photo with the selfie using open-source models. It rejects (with a reason) when there is no face on the ID,
// no face / several people in the selfie, or the two faces are clearly different people. A borderline match is
// accepted but flagged for the Desk Officer, who still gives the final approval. If the models cannot run,
// the browser's face-in-frame check is used and the officer compares the two photos by eye.

const fs = require('fs');
const path = require('path');
let sharp = null;
try { sharp = require('sharp'); } catch (e) { console.warn('[kyc] "sharp" is not installed — image-quality checks are skipped (documents still go to manual review).'); }

const FaceMatch = require('./faceMatch');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
function isPdfFile(file) { try { const b = Buffer.alloc(4); const fd = fs.openSync(file, 'r'); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return b.toString() === '%PDF'; } catch (e) { return true; } }

function deaccent(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function nameTokens(s) { return deaccent(s).replace(/[^a-z\u0400-\u04ff\u0600-\u06ff\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\s'-]/g, ' ').split(/[\s'-]+/).filter((t) => t.length > 1); }

/** Word-level match: most words of the shorter name must appear in the other (allowing 1-letter typos on long words). */
function namesMatch(a, b) {
  const A = nameTokens(a); const B = nameTokens(b);
  if (!A.length || !B.length) return false;
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  const close = (x, y) => x === y || (x.length >= 5 && y.length >= 5 && lev(x, y) <= 1);
  const hits = small.filter((t) => big.some((u) => close(t, u))).length;
  return hits / small.length >= (small.length === 1 ? 1 : 0.6);
}
function lev(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function idNumberProblem(raw) {
  const v = String(raw || '').replace(/[\s-]/g, '');
  if (v.length < 5 || v.length > 24) return 'The ID number should be between 5 and 24 characters.';
  if (!/^[A-Za-z0-9/.]+$/.test(v)) return 'The ID number can only contain letters and numbers.';
  if (/^(.)\1+$/.test(v)) return 'That ID number does not look genuine (one repeated character).';
  if (/^(0123456789|1234567890|123456|1234567|12345678|123456789|987654321|abcdef)/i.test(v) && v.length <= 12) return 'That ID number looks like a placeholder, not a real ID number.';
  return null;
}

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function resolveUpload(url) {
  const m = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(url || '');
  return m ? path.join(UPLOAD_DIR, m[1]) : null;
}

/** Quality of one uploaded file. Returns { problems: string[], notes: string[] } using plain-language labels. */
async function inspectFile(url, label, { imageOnly = false, minShort = 480 } = {}) {
  const out = { problems: [], notes: [] };
  const file = resolveUpload(url);
  if (!file || !fs.existsSync(file)) { out.problems.push(`${label}: the file was not received. Please upload it again.`); return out; }
  const stat = fs.statSync(file);
  if (stat.size < 8 * 1024) { out.problems.push(`${label}: the file is too small to be a readable document. Please upload a clear photo or scan.`); return out; }
  const head = Buffer.alloc(8); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  if (head.slice(0, 4).toString() === '%PDF') {
    if (imageOnly) out.problems.push(`${label}: please upload a photo (JPG or PNG), not a PDF.`);
    else out.notes.push(`${label}: PDF accepted`);
    return out;
  }
  if (!sharp) { out.notes.push(`${label}: quality check skipped`); return out; }
  try {
    const img = sharp(file, { failOn: 'none' });
    const meta = await img.metadata();
    const w = meta.width || 0; const h = meta.height || 0;
    if (!w || !h) { out.problems.push(`${label}: this does not look like an image or PDF. Please upload a JPG, PNG or PDF.`); return out; }
    if (Math.min(w, h) < minShort) out.problems.push(`${label}: the image is too small (${w}×${h}). Please take it again closer or at a higher quality so the text is readable.`);
    // Analyse a normalised greyscale copy so photo size does not skew the thresholds.
    const { data, info } = await sharp(file, { failOn: 'none' }).rotate().resize(480, 480, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const W = info.width; const H = info.height; const N = W * H;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += data[i];
    const mean = sum / N;
    let varSum = 0; let lapN = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const lap = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - W] - data[i + W];
      varSum += lap * lap; lapN++;
    }
    const sharpness = lapN ? varSum / lapN : 0; // mean-square Laplacian — higher = more edge detail
    if (mean < 28) out.problems.push(`${label}: the photo is too dark to read. Please retake it in good light.`);
    else if (mean > 240) out.problems.push(`${label}: the photo is overexposed / washed out. Please retake it without glare or flash.`);
    if (sharpness < 12) out.problems.push(`${label}: the photo is too blurry to read. Please hold the camera steady and retake it.`);
    out.notes.push(`${label}: ${w}×${h}, brightness ${Math.round(mean)}, sharpness ${Math.round(sharpness)}`);
  } catch (err) {
    out.problems.push(`${label}: this file could not be read as an image or PDF. Please upload a JPG, PNG or PDF.`);
  }
  return out;
}

/**
 * Runs every check. `input` = { fullName, docType, nameOnId, idNumber, idExpiry, issuingCountry,
 *   idFrontUrl, idBackUrl, proofAddressUrl, selfieUrl, selfieFaceCount }.
 * `otherIdNumbers` = ID numbers already registered on OTHER sellers (normalised) for the duplicate check.
 * Returns { ok, reasons[], report }.
 */
async function runKycChecks(input, { otherIdNumbers = [], today = new Date() } = {}) {
  const reasons = []; const notes = [];

  // ---- details ----
  const exp = parseDate(input.idExpiry);
  if (!exp) reasons.push('The ID expiry date is missing or not a valid date.');
  else {
    const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (exp.getTime() < t0) reasons.push(`This ${docLabel(input.docType)} expired on ${input.idExpiry}. Please use a valid, unexpired document.`);
    else if (exp.getTime() > t0 + 25 * 365.25 * 86400000) reasons.push('The expiry date is too far in the future to be correct. Please check the date on your document.');
  }
  const idProblem = idNumberProblem(input.idNumber);
  if (idProblem) reasons.push(idProblem);
  const norm = String(input.idNumber || '').replace(/[\s-]/g, '').toUpperCase();
  if (!idProblem && otherIdNumbers.includes(norm)) reasons.push('This ID number is already registered on another account. If this is a mistake, please contact the Desk.');
  if (!nameTokens(input.nameOnId).length) reasons.push('Please enter your full name exactly as it appears on the document.');
  else if (!namesMatch(input.nameOnId, input.fullName)) reasons.push(`The name on the ID ("${String(input.nameOnId).slice(0, 80)}") does not match the name on your account ("${String(input.fullName).slice(0, 80)}"). Please correct one of them so they match.`);
  if (!String(input.issuingCountry || '').trim()) reasons.push('Please select the country that issued the document.');

  // ---- files ----
  const jobs = [inspectFile(input.idFrontUrl, 'ID (front)')];
  if (input.docType !== 'passport') jobs.push(inspectFile(input.idBackUrl, 'ID (back)'));
  jobs.push(inspectFile(input.proofAddressUrl, 'Proof of address', { minShort: 400 }));
  jobs.push(inspectFile(input.selfieUrl, 'Selfie', { imageOnly: true, minShort: 300 }));
  for (const r of await Promise.all(jobs)) { reasons.push(...r.problems); notes.push(...r.notes); }

  // ---- face: is there a face on the ID, one person in the selfie, and do they match? ----
  const selfieMsg = {
    none: 'Selfie: we could not see a face in your photo. Please face the camera with your whole face inside the oval, in good light.',
    many: 'Selfie: more than one person was found. Please take the selfie alone.'
  };
  let faceMatch = null;
  const idFile = resolveUpload(input.idFrontUrl); const selfieFile = resolveUpload(input.selfieUrl);
  const imageProblem = reasons.some((r) => /^(ID \(front\)|Selfie):/.test(r));
  if (FaceMatch.enabled() && !imageProblem && idFile && selfieFile && fs.existsSync(idFile) && fs.existsSync(selfieFile) && !isPdfFile(idFile) && !isPdfFile(selfieFile)) {
    faceMatch = await FaceMatch.compare(idFile, selfieFile);
  }
  if (faceMatch && faceMatch.available) {
    if (!faceMatch.selfie || faceMatch.selfie.faces === 0) reasons.push(selfieMsg.none);
    else if (faceMatch.selfie.others > 0) reasons.push(selfieMsg.many);
    if (!faceMatch.id || faceMatch.id.faces === 0) reasons.push('ID (front): we could not find the photo of your face on the document. Please photograph the whole card flat, close enough that the photo is sharp, without glare.');
    if (faceMatch.level === 'mismatch') reasons.push('The face in your selfie does not appear to match the photo on your ID. Please retake the selfie facing the camera in good light (no hat or sunglasses), or upload a clearer photo of the ID.');
    if (faceMatch.distance !== null && faceMatch.distance !== undefined) notes.push(`Face match: ${faceMatch.level} (distance ${faceMatch.distance})`);
  } else {
    // models unavailable: fall back to the browser's own face-in-frame count; the Desk Officer compares by eye
    if (input.selfieFaceCount === 0) reasons.push(selfieMsg.none);
    else if (input.selfieFaceCount > 1) reasons.push(selfieMsg.many);
    if (faceMatch && faceMatch.error) notes.push(`Automatic face match unavailable (${faceMatch.error}) — compare the photos manually`);
  }

  return {
    ok: reasons.length === 0, reasons,
    report: { checkedAt: new Date().toISOString(), passed: reasons.length === 0, reasons, notes, selfieFaceCount: input.selfieFaceCount ?? null,
      faceMatch: faceMatch && faceMatch.available ? { distance: faceMatch.distance, level: faceMatch.level, idFaces: faceMatch.id && faceMatch.id.faces, selfieFaces: faceMatch.selfie && faceMatch.selfie.faces, thresholds: FaceMatch.THRESHOLDS } : { available: false, reason: (faceMatch && faceMatch.error) || 'not run' } }
  };
}
function docLabel(t) { return t === 'passport' ? 'passport' : t === 'drivers_license' ? "driver's license" : 'ID'; }

module.exports = { runKycChecks, namesMatch, idNumberProblem, parseDate, inspectFile };
