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
module.exports = { generateAccountId, ensureAccountId, ensureAllAccountIds };
