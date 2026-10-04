// Selects the active data store implementation.
// If DATABASE_URL is set, uses PostgreSQL (persistent across restarts).
// Otherwise falls back to an in-memory store (fine for local dev/testing,
// but data is lost on process restart).

let store;
let backendName;

if (process.env.DATABASE_URL) {
  const PgStore = require('./pgStore');
  store = new PgStore(process.env.DATABASE_URL);
  backendName = 'postgres';
} else {
  const MemStore = require('./memStore');
  store = new MemStore();
  backendName = 'memory';
}

// v3.1 moved a requested withdrawal's money out of "available" immediately (into
// a pending balance). Withdrawals created before that still have their money in
// available/held, so shift them once. Guarded by a settings flag — safe to re-run.
async function migrateV31() {
  if (await store.getSetting('migration_v31_withdrawals', false)) return;
  const groups = await store.getAllGroups();
  for (const g of groups) {
    const wds = await store.getWithdrawalsForGroup(g.id);
    for (const w of wds) {
      const amt = Number(w.amount_ledger) || 0;
      if (!amt) continue;
      if (w.status === 'pending') await store.adjustBalances(g.id, { available: -amt, pending: amt });          // was still in available
      else if (['held_in_vault', 'processing'].includes(w.status)) await store.adjustBalances(g.id, { held: -amt, pending: amt }); // was earmarked in held
    }
  }
  await store.setSetting('migration_v31_withdrawals', true);
}

// Sellers who registered before v3.1 have no Account ID, country code or locked email.
// Give them one (unique, 11 digits), derive the country code, and lock their email.
async function migrateV31Accounts() {
  if (await store.getSetting('migration_v31_accounts', false)) return;
  const { generateAccountId } = require('./accountHandlers');   // lazy: accountHandlers requires this module
  const QC = require('./public/countries');
  const groups = await store.getAllGroups();
  for (const g of groups) {
    if (!g.seller_registered) continue;
    const fields = {};
    if (!g.seller_account_id) fields.seller_account_id = await generateAccountId();
    if (!g.seller_country_iso && g.seller_country) { const c = QC.findCountry(g.seller_country); if (c) fields.seller_country_iso = c.iso; }
    if (!g.seller_email_locked && g.email_b) fields.seller_email_locked = true;
    if (!g.seller_registered_at) fields.seller_registered_at = g.created_at || new Date().toISOString();
    if (Object.keys(fields).length) await store.updateGroup(g.id, fields);
  }
  await store.setSetting('migration_v31_accounts', true);
}

async function initStore() {
  await store.init();
  try { await migrateV31(); } catch (err) { console.error('[migration] v3.1 withdrawal migration failed:', err.message); }
  try { await migrateV31Accounts(); } catch (err) { console.error('[migration] v3.1 account migration failed:', err.message); }
  if (backendName === 'memory') {
    console.warn(
      '[storage] No DATABASE_URL set — running with in-memory storage. ' +
      'Data will NOT survive a restart or redeploy. Set DATABASE_URL to a ' +
      'Postgres connection string (see DEPLOY.md) for real persistence.'
    );
  } else {
    console.log('[storage] Connected to PostgreSQL. Persistence enabled.');
  }
  return store;
}

module.exports = {
  migrateV31, migrateV31Accounts, store, initStore, backendName: () => backendName };
