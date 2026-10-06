// Seller Account IDs — an 11-digit, unique, non-guessable-by-sequence number
// generated once when a seller completes registration (e.g. 15963475226).
const crypto = require('crypto');

async function generateAccountId(store) {
  for (let i = 0; i < 25; i++) {
    const id = String(crypto.randomInt(1, 10)) + String(crypto.randomInt(0, 10000000000)).padStart(10, '0');
    if (!(await store.getGroupBySellerAccountId(id))) return id;
  }
  throw new Error('Could not allocate a unique Account ID');
}

// Make sure a registered seller has an Account ID (covers sellers registered before this feature existed).
async function ensureAccountId(store, group) {
  if (!group || group.seller_account_id || !group.seller_registered) return group;
  const id = await generateAccountId(store);
  return (await store.updateGroup(group.id, { seller_account_id: id })) || group;
}
async function ensureAllAccountIds(store) {
  const groups = await store.getAllGroups();
  let n = 0;
  for (const g of groups) if (g.seller_registered && !g.seller_account_id) { await ensureAccountId(store, g); n++; }
  return n;
}

// ---- Trusted seller sessions ---------------------------------------------------------------
// A registered seller's account is protected by sign-in (email + password), not by the invite link.
// Every browser/device that has signed in (or created the account) is remembered here as a SHA-256
// hash of its session token. join-room and every money action check this list.
const MAX_TRUSTED = 12;
const hashToken = (t) => crypto.createHash('sha256').update(String(t || '')).digest('hex');
function trustedList(g) { return Array.isArray(g && g.seller_auth_tokens) ? g.seller_auth_tokens : []; }
function isSellerToken(g, token) {
  if (!g || !token) return false;
  const list = trustedList(g);
  if (list.includes(hashToken(token))) return true;
  // accounts created before sign-in existed: the token that holds the seat is trusted once
  return list.length === 0 && g.seller_session_token === token;
}
async function trustSellerToken(store, g, token) {
  const h = hashToken(token);
  const list = trustedList(g).filter((x) => x !== h && x !== '__revoked__');
  list.push(h);
  return (await store.updateGroup(g.id, { seller_auth_tokens: list.slice(-MAX_TRUSTED) })) || g;
}
async function revokeSellerToken(store, g, token) {
  const h = hashToken(token);
  const next = trustedList(g).filter((x) => x !== h); if (!next.length) next.push('__revoked__');
  return (await store.updateGroup(g.id, { seller_auth_tokens: next, seller_session_token: g.seller_session_token === token ? null : g.seller_session_token })) || g;
}
async function revokeAllSellerTokens(store, g) {
  return (await store.updateGroup(g.id, { seller_auth_tokens: ['__revoked__'], seller_session_token: null })) || g;
}
module.exports = { generateAccountId, ensureAccountId, ensureAllAccountIds, hashToken, isSellerToken, trustSellerToken, revokeSellerToken, revokeAllSellerTokens };
