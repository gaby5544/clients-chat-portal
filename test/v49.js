// v3.21: Statement of Account PDF. The real `pdfkit` package is not installed in this offline sandbox, so a recording stand-in
// with the same drawing calls is used: it checks the statement's content, period filtering, pagination and the signed route.
process.env.ACCOUNT_RATE_MAX = '1000';
require('./harness'); const Module = require('module');
class MockPDF {
  constructor() { this.page = { width: 595.28, height: 841.89 }; this.pages = 1; this.texts = []; this.fillC = ''; this.badY = 0; }
  pipe(res) { this.res = res; return this; } end() { this.res.end(JSON.stringify({ pages: this.pages, texts: this.texts })); }
  addPage() { this.pages++; this.cur = this.pages - 1; return this; } bufferedPageRange() { return { start: 0, count: this.pages }; } switchToPage(i) { this.cur = i; return this; }
  rect() { return this; } roundedRect() { return this; } circle() { return this; } fill() { return this; } stroke() { return this; } moveTo() { return this; } lineTo() { return this; }
  lineWidth() { return this; } strokeColor() { return this; } font() { return this; } fontSize() { return this; } fillColor() { return this; }
  widthOfString(t) { return String(t).length * 5; } heightOfString(t, o) { return Math.max(1, Math.ceil(String(t).length * 4.6 / ((o && o.width) || 400))) * 10.5; }
  text(t, x, y, o) { if (y > this.page.height - 20) this.badY++; this.texts.push({ p: this.cur == null ? this.pages - 1 : this.cur, t: String(t), y }); return this; }
}
const origLoad = Module._load; Module._load = function (req) { return req === 'pdfkit' ? MockPDF : origLoad.apply(this, arguments); };
const origLog = console.log; console.log = (...a) => { const s = a.join(' '); if (!/\[email:mock\]|\[storage\]|\[push\]/.test(s)) origLog(...a); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; origLog('  ✓', m); } else { fail++; origLog('  ✗ FAIL:', m); } };
(async () => {
  const { initStore, store } = require('../db'); await initStore(); const F = require('../finance'); const BD = require('../bankDetails'); const PDF = require('../pdfReceipt');
  const { hashPassword } = require('../security'); const { buildRouter } = require('../routes');
  const gid = 'stmtgrp1'; await store.createGroupIfMissing(gid, 'Stmt Deal');
  await store.updateGroup(gid, { seller_registered: true, seller_currency: 'USD', kyc_status: 'verified', seller_account_id: '48213907765', seller_full_name: 'Kwame Mensah', email_b: 'k@example.com', seller_phone: '+233244123456', seller_password_hash: hashPassword('Passw0rd!x') });
  await BD.setProfiles(store, { USD: { bankName: 'Chase Bank', swift: 'CHASUS33', accountNumber: '994077359', routing: '021000021' } });
  let grp = await store.getGroup(gid); await BD.addToPool(store, 'USD', '5550000001'); await BD.assignNumber(store, grp, { next: true });
  const now = Date.now(), day = 86400000;
  for (let i = 0; i < 40; i++) await store.createIncomingFunds({ groupId: gid, payerName: `Payer ${i}`, payerCountry: 'US', purpose: `Invoice ${1000 + i} for goods and services supplied`, method: 'wire', amount: 100 + i, amountCurrency: 'USD', amountLedger: 100 + i, feeAmount: 0, fxRate: 1, receivedAt: new Date(now - (i * 3) * day).toISOString(), status: i % 9 === 0 ? 'held_in_vault' : 'credited', meta: {} });
  const wd = await store.createWithdrawal({ groupId: gid, method: 'bank', beneficiaryName: 'Ama Boateng', bankName: 'GTBank', amount: 250, amountCurrency: 'USD', amountLedger: 250 }); await store.advanceWithdrawal(wd.id, { status: 'completed', reason: 'Paid', by: null, expectedStatus: 'pending' });
  await store.adjustBalances(gid, { available: 3000, total: 4000, held: 1000 }); grp = await store.getGroup(gid);
  const a = F.publicSellerAccount(grp); ok(/^\/api\/statement\/stmtgrp1\?sig=[0-9a-f]{40}$/.test(a.statementUrl), 'the seller\'s account carries a signed statement link');
  const route = buildRouter().routes.find((r) => r[0] === 'get' && r[1] === '/api/statement/:groupId'); ok(!!route, 'the statement route exists');
  const call = (q, gidParam = gid) => new Promise((resolve) => { const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { resolve({ status: this.code, json: o }); }, write() {}, on() { return this; }, once() { return this; }, emit() {}, end(b) { resolve({ status: this.code, headers: this.headers, data: b ? JSON.parse(b) : null }); } }; route[2][route[2].length - 1]({ params: { groupId: gidParam }, query: q }, res); });
  const sig = F.signReceipt('statement', gid);
  let r = await call({ sig }); const d = r.data;
  ok(r.status === 200 && r.headers['Content-Type'] === 'application/pdf' && /ST-STMTGR-\d{8}-statement\.pdf/.test(r.headers['Content-Disposition']), 'a PDF named with its statement reference');
  const all = d.texts.map((x) => x.t).join('\n'); const at = (n) => d.texts.filter((x) => x.p === n).map((x) => x.t).join('\n');
  ok(d.pages >= 2, `41 transactions flow onto several pages (${d.pages})`);
  ok(/STATEMENT OF ACCOUNT/.test(all) && /Kwame Mensah/.test(all) && /48213907765/.test(all) && /Chase Bank ••0001/.test(all), 'header, holder, Account ID and the receiving account (••0001)');
  ok(/Payer 0\b/.test(all) && /Payer 39/.test(all) && /Ama Boateng/.test(all) && /HELD IN VAULT/.test(all) && /CREDITED/.test(all) && /COMPLETED/.test(all), 'every payment in and out appears, with its status');
  ok(/Page 1 of \d/.test(all) && new RegExp(`Page ${d.pages} of ${d.pages}`).test(all) && /DOCUMENT FINGERPRINT/.test(all), 'every page has the fingerprint and "Page n of N"');
  ok(!/not a bank statement/.test(all) && /Issued by the Quantum Secure Transaction Desk/.test(all), 'the footer names the Desk as the issuer (no "not a bank statement" wording)');
  ok(d.texts.every((x) => x.y < 842), 'nothing is drawn below the page');
  ok(/Money in \(all time\)/i.test(all) && /\$3,000\.00/.test(all) && /\$1,000\.00/.test(all), 'the reconciled balances are shown (available $3,000.00, held $1,000.00)');
  r = await call({ sig, range: '30' }); const t30 = r.data.texts.map((x) => x.t).join('\n');
  ok(/Last 30 days/.test(t30) && /Payer 0\b/.test(t30) && !/Payer 39/.test(t30), 'a 30-day period shows only recent payments');
  r = await call({ sig, from: '2999-01-01', to: '2999-02-01' }); ok(/No transactions in this period/.test(r.data.texts.map((x) => x.t).join('\n')), 'an empty period says so');
  r = await call({ sig: 'a'.repeat(40) }); ok(r.status === 404, 'a wrong signature is refused');
  r = await call({ sig }, 'otherone'); ok(r.status === 404, 'a link cannot be re-pointed at another seller');
  const P = PDF.statementPeriod({ range: '90' }, new Date('2026-10-26T00:00:00Z')); ok(P.from && /^Last 90 days/.test(P.label), 'period helper: last 90 days');
  const L = PDF.statementLines({ incoming: [{ ref: 'IN-1', receivedAt: '2026-10-01T00:00:00Z', status: 'reversed', amountLedger: 50, payerName: 'X' }, { ref: 'IN-2', receivedAt: '2026-10-02T00:00:00Z', status: 'credited', amountLedger: 70, payerName: 'Y' }], withdrawals: [{ ref: 'WD-1', createdAt: '2026-10-03T00:00:00Z', status: 'rejected', amountLedger: 20, method: 'bank' }, { ref: 'WD-2', createdAt: '2026-10-04T00:00:00Z', status: 'completed', amountLedger: 30, method: 'bank' }], ledger: {}, period: { from: null, to: new Date('2026-11-01') } });
  ok(L.moneyIn === 70 && L.moneyOut === 30 && L.lines.length === 4, 'totals count only money that really moved (reversed / declined items are listed but not counted)');
  console.log = origLog; origLog(`RESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { origLog('CRASH', e); process.exit(1); });
