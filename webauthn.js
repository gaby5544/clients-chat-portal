// v3.15 Fingerprint / face unlock via WebAuthn (a platform authenticator: the phone's own fingerprint or face sensor).
// The phone proves "the owner was verified on this device" with a signature that only the device's private key can make;
// the server keeps only the PUBLIC key. Attestation is not used (we do not need to know the phone model).
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const fromB64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const newChallenge = () => b64u(crypto.randomBytes(32));
const rpIdOf = (origin) => { try { return new URL(origin).hostname; } catch (e) { return ''; } };
const MAX_B64 = 6000;

function parseClientData(b64, type, challenge, origin) {
  if (typeof b64 !== 'string' || b64.length > MAX_B64) return { ok: false, error: 'Invalid response.' };
  let cd; try { cd = JSON.parse(fromB64u(b64).toString('utf8')); } catch (e) { return { ok: false, error: 'Invalid response.' }; }
  if (!cd || cd.type !== type) return { ok: false, error: 'Unexpected response type.' };
  if (!challenge || cd.challenge !== challenge) return { ok: false, error: 'This request expired. Please try again.' };
  if (cd.origin !== origin) return { ok: false, error: 'This request did not come from the Vistra app.' };
  return { ok: true };
}
/** Registration: keep the public key the phone created (SPKI, ES256 or RS256). */
function verifyRegistration(p, { challenge, origin }) {
  const c = parseClientData(p && p.clientDataJSON, 'webauthn.create', challenge, origin); if (!c.ok) return c;
  const id = String((p && p.credentialId) || ''); if (!/^[A-Za-z0-9_-]{16,512}$/.test(id)) return { ok: false, error: 'Invalid credential.' };
  let key; try { key = crypto.createPublicKey({ key: fromB64u(p.publicKey), format: 'der', type: 'spki' }); } catch (e) { return { ok: false, error: 'We could not read the fingerprint key from this phone.' }; }
  const t = key.asymmetricKeyType, curve = key.asymmetricKeyDetails && key.asymmetricKeyDetails.namedCurve;
  if (!((t === 'ec' && curve === 'prime256v1') || (t === 'rsa' && (key.asymmetricKeyDetails.modulusLength || 0) >= 2048))) return { ok: false, error: 'This phone’s fingerprint key type is not supported.' };
  return { ok: true, cred: { id, pub: b64u(key.export({ format: 'der', type: 'spki' })), kty: t, counter: 0 } };
}
/** Authentication: origin, challenge, rpId hash, user presence + user verification, counter, and the signature. */
function verifyAssertion(p, cred, { challenge, origin }) {
  const c = parseClientData(p && p.clientDataJSON, 'webauthn.get', challenge, origin); if (!c.ok) return c;
  if (!cred || String(p.credentialId) !== cred.id) return { ok: false, error: 'This phone is not set up for fingerprint unlock.' };
  if (typeof p.authenticatorData !== 'string' || typeof p.signature !== 'string' || p.authenticatorData.length > MAX_B64 || p.signature.length > MAX_B64) return { ok: false, error: 'Invalid response.' };
  const ad = fromB64u(p.authenticatorData), sig = fromB64u(p.signature);
  if (ad.length < 37) return { ok: false, error: 'Invalid response.' };
  if (!ad.subarray(0, 32).equals(sha256(Buffer.from(rpIdOf(origin))))) return { ok: false, error: 'This request did not come from the Vistra app.' };
  const flags = ad[32]; if (!(flags & 0x01) || !(flags & 0x04)) return { ok: false, error: 'Your fingerprint was not verified.' };
  const counter = ad.readUInt32BE(33);
  if ((counter !== 0 || cred.counter !== 0) && counter <= cred.counter) return { ok: false, error: 'This fingerprint key looks cloned. Use your PIN.' };
  let good = false;
  try { good = crypto.verify('sha256', Buffer.concat([ad, sha256(fromB64u(p.clientDataJSON))]), crypto.createPublicKey({ key: fromB64u(cred.pub), format: 'der', type: 'spki' }), sig); } catch (e) { good = false; }
  if (!good) return { ok: false, error: 'Your fingerprint could not be verified.' };
  return { ok: true, counter };
}
module.exports = { b64u, fromB64u, sha256, newChallenge, rpIdOf, verifyRegistration, verifyAssertion };
