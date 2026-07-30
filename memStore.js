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

async function initStore() {
  await store.init();
  if (backendName === 'memory') {
    console.warn(
      '[storage] No DATABASE_URL set — running with in-memory storage. ' +
      'Data will NOT survive a restart or redeploy. Set DATABASE_URL to a ' +
      'Postgres connection string (see DEPLOY_RENDER.md) for real persistence.'
    );
  } else {
    console.log('[storage] Connected to PostgreSQL. Persistence enabled.');
  }
  return store;
}

module.exports = { store, initStore, backendName: () => backendName };
