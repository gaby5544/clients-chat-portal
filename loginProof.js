// Proof that a browser session really signed in (password) to a given account. It lets a person whose trading room was
// closed (removed from the group, or the group was deleted) still open THEIR OWN account without any room access, while
// anybody who merely holds an old link and never signed in gets the sign-in screen instead.
const { store } = require('./db');
const TTL_MS = 30 * 24 * 3600 * 1000;
const key = (t) => 'lp:' + String(t || '').slice(0, 80);
async function issue(token, groupIds) {
  if (!token) return;
  const cur = await read(token); const g = new Set([...(cur ? cur.g : []), ...groupIds]);
  await store.setSetting(key(token), JSON.stringify({ g: Array.from(g).slice(-20), at: Date.now() }));
}
async function read(token) { try { const v = await store.getSetting(key(token), null); const o = v ? JSON.parse(typeof v === 'string' ? v : JSON.stringify(v)) : null; return o && Date.now() - o.at < TTL_MS ? o : null; } catch (e) { return null; } }
async function check(token, groupId) { const o = token ? await read(token) : null; return !!(o && o.g.includes(groupId)); }
module.exports = { issue, check };
