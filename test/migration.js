require('./harness');
const log = console.log; console.log = () => {};
(async () => {
  const db = require('../db'); await db.initStore();
  const { store } = db;
  await store.createGroupIfMissing('old1', 'Old Deal');
  await store.updateGroup('old1', { seller_registered: true, seller_country: 'Nigeria', email_b: 'old@example.com', seller_full_name: 'Old Seller' });
  await store.setSetting('migration_v31_accounts', false);
  await db.migrateV31Accounts();
  const g = await store.getGroup('old1');
  console.log = log;
  const ok = /^[1-9]\d{10}$/.test(g.seller_account_id) && g.seller_country_iso === 'NG' && g.seller_email_locked === true;
  console.log(ok ? '✓ existing seller backfilled: ID ' + g.seller_account_id + ', ' + g.seller_country_iso + ', email locked' : '✗ FAIL backfill', JSON.stringify([g.seller_account_id, g.seller_country_iso, g.seller_email_locked]));
  process.exit(ok ? 0 : 1);
})();
