// Free, on-server face matching for KYC (no paid KYC provider, nothing leaves your server).
// compare(idFront, selfie) runs faceWorker.cjs in a short-lived child process (one at a time, so memory stays
// bounded) and returns { available, id, selfie, distance, level }.
//   level: 'strong' (clearly the same person) | 'good' | 'low' (borderline — passed to the reviewer flagged) | 'mismatch'
// Thresholds are the distance between the two faces' 128-number fingerprints (smaller = more alike):
//   <= FACE_MATCH_STRONG (0.50)  strong      <= FACE_MATCH_REVIEW (0.60)  good
//   <= FACE_MATCH_REJECT (0.68)  low — accepted but flagged for the Desk Officer      > 0.68  mismatch -> rejected with a reason
// Moderate by design (neither strict nor easy); change with the three env vars. FACE_MATCH=off disables it.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const STRONG = Number(process.env.FACE_MATCH_STRONG) || 0.50;
const REVIEW = Number(process.env.FACE_MATCH_REVIEW) || 0.60;
const REJECT = Number(process.env.FACE_MATCH_REJECT) || 0.68;
const TIMEOUT_MS = Number(process.env.FACE_MATCH_TIMEOUT_MS) || 70000;

let chain = Promise.resolve();       // one face job at a time
function enabled() { return String(process.env.FACE_MATCH || 'auto').toLowerCase() !== 'off'; }

function run(idPath, selfiePath) {
  return new Promise((resolve) => {
    const worker = path.join(__dirname, 'faceWorker.cjs');
    if (!fs.existsSync(worker)) return resolve({ available: false, error: 'worker missing' });
    execFile(process.execPath, ['--max-old-space-size=640', worker, idPath, selfiePath], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, cwd: __dirname }, (err, stdout) => {
      if (err && !stdout) return resolve({ available: false, error: err.killed ? 'face check timed out' : String(err.message).slice(0, 160) });
      try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); } catch (e) { resolve({ available: false, error: 'unreadable worker output' }); }
    });
  });
}

function classify(distance) {
  if (distance === null || distance === undefined) return null;
  return distance <= STRONG ? 'strong' : distance <= REVIEW ? 'good' : distance <= REJECT ? 'low' : 'mismatch';
}

/** Never throws. */
function compare(idPath, selfiePath) {
  if (!enabled()) return Promise.resolve({ available: false, error: 'face matching is turned off (FACE_MATCH=off)' });
  const job = chain.then(() => run(idPath, selfiePath)).then((r) => Object.assign(r, { level: classify(r.distance) }));
  chain = job.catch(() => {});
  return job.catch((e) => ({ available: false, error: String(e && e.message || e) }));
}

module.exports = { compare, classify, enabled, THRESHOLDS: { STRONG, REVIEW, REJECT } };
