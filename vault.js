// Reversible encryption for the few secrets the Desk must be able to read back:
//   * a seller's account password (viewable only by authorised staff, every view logged)
//   * email-provider credentials entered in the admin dashboard
// AES-256-GCM with a random IV per value. The key comes from PASSWORD_VAULT_KEY
// (recommended — keep it ONLY in your host's environment variables). If it is not
// set, a random key is generated once and kept in the database settings table:
// better than plain text, but anyone who can read the whole database can read the key too.

const crypto = require('crypto');
const { store } = require('./db');

let keyPromise = null;
function deriveKey(secret) { return crypto.createHash('sha256').update('qsd-vault-v1|' + String(secret)).digest(); }

async function getKey() {
  if (!keyPromise) {
    keyPromise = (async () => {
      if (process.env.PASSWORD_VAULT_KEY) return deriveKey(process.env.PASSWORD_VAULT_KEY);
      let stored = await store.getSetting('vault_key', null);
      if (!stored) { stored = crypto.randomBytes(32).toString('hex'); await store.setSetting('vault_key', stored); console.warn('[vault] PASSWORD_VAULT_KEY is not set — generated a key and stored it in the database. Set PASSWORD_VAULT_KEY in your environment for proper protection.'); }
      return deriveKey(stored);
    })();
  }
  return keyPromise;
}

async function encrypt(plain) {
  const key = await getKey(); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

async function decrypt(blob) {
  if (!blob) return null;
  const [ver, iv, tag, data] = String(blob).split(':');
  if (ver !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', await getKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch (e) { return null; }   // wrong key / tampered value
}

module.exports = { encrypt, decrypt };
