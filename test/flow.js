process.env.COMPLAINTS_EMAIL = 'complaints@usvistra.com';
const { FakeIO } = require('./harness');
const logs = []; const origLog = console.log;
console.log = (...a) => { const s = a.join(' '); logs.push(s); if (!/\[email:mock\]|\[storage\]|\[push\]/.test(s)) origLog(...a); };
const assert = require('assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeFrom = (re) => { for (let i = logs.length - 1; i >= 0; i--) { const m = logs[i].match(re); if (m) return m[1]; } return null; };

(async () => {
  const { initStore, store } = require('../db');
  await initStore();
  const { registerSocketHandlers } = require('../socketHandlers');
  const io = new FakeIO();

  // --- admin ---
  const admin = io.add('9.9.9.9'); registerSocketHandlers(io, admin);
  const adminKey = process.env.ADMIN_PASSKEY || process.env.SUPER_ADMIN_PASSKEY || 'admin';
  await store.createGroupIfMissing && null;
  console.log = origLog;
  console.log('store ready; admin socket created');
  module.exports = { io, admin, store, logs, codeFrom, sleep, assert, registerSocketHandlers };
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
