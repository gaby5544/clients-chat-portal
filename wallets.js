// Company deposit wallets shown to sellers. The three defaults below are the addresses supplied by the Desk
// (each one verified: bech32 checksum, EIP-55 checksum and Tron base58check). Admins can change an address or
// switch a wallet off from Controls -> Deposit wallets; the saved list lives in the settings table.

const DEFAULTS = [
  { id: 'btc', asset: 'BTC', network: 'Bitcoin', label: 'Bitcoin', sub: 'BTC · Bitcoin network', address: 'bc1qs42pu5fnssfu7xzsfspylmdx9dqqqa4xnl0knz', enabled: true },
  { id: 'usdt-bep20', asset: 'USDT', network: 'BEP20', label: 'USDT', sub: 'BNB Smart Chain (BEP20)', address: '0xb61C2E8D64a26C0D8B72876b202ea4d0AC9F2484', enabled: true },
  { id: 'usdt-trc20', asset: 'USDT', network: 'TRC20', label: 'USDT', sub: 'Tron (TRC20)', address: 'TFoXSskaH3mRb3ZrvEe6WELgLUjkXJoWzV', enabled: true }
];

const VALID = {
  BTC: (a) => /^(bc1[02-9ac-hj-np-z]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a),
  BEP20: (a) => /^0x[a-fA-F0-9]{40}$/.test(a),
  TRC20: (a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)
};
const validFor = (w, address) => (w.asset === 'BTC' ? VALID.BTC : VALID[w.network] || (() => false))(address);

async function getWallets(store) {
  try {
    const raw = await store.getSetting('deposit_wallets', null);
    const saved = raw ? JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) : [];
    return DEFAULTS.map((d) => { const s = saved.find((x) => x.id === d.id); return s && validFor(d, s.address) ? { ...d, address: s.address, enabled: s.enabled !== false } : { ...d }; });
  } catch (e) { return DEFAULTS.map((d) => ({ ...d })); }
}
/** @returns {{ok:true, wallets}|{ok:false, error}} */
async function setWallets(store, updates) {
  const cur = await getWallets(store);
  for (const u of Array.isArray(updates) ? updates : []) {
    const w = cur.find((x) => x.id === u.id); if (!w) continue;
    const addr = String(u.address || '').trim();
    if (!validFor(w, addr)) return { ok: false, error: `That is not a valid ${w.sub} address. Please check it carefully.` };
    w.address = addr; w.enabled = u.enabled !== false;
  }
  if (!cur.some((w) => w.enabled)) return { ok: false, error: 'At least one deposit wallet must stay switched on.' };
  await store.setSetting('deposit_wallets', JSON.stringify(cur.map((w) => ({ id: w.id, address: w.address, enabled: w.enabled }))));
  return { ok: true, wallets: cur };
}
module.exports = { DEFAULTS, getWallets, setWallets, validFor };
