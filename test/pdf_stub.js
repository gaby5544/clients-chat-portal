// Runs the real receipt generator against a recording stub of PDFKit to catch reference/type errors.
require('./harness');
const Module = require('module'); const calls = [];
class FakePDF { constructor() { const self = new Proxy(this, { get: (t, p) => { if (p === 'page') return { width: 595.28, height: 841.89 }; if (p === 'widthOfString') return () => 120; if (p === 'heightOfString') return () => 14; if (p === 'then') return undefined; if (p === 'y') return 400; return (...a) => { calls.push([String(p), a[0]]); return self; }; } }); return self; } }
const orig = Module._load; Module._load = function (r, ...rest) { if (r === 'pdfkit') return FakePDF; return orig.call(this, r, ...rest); };
const { generateFundsReceiptPdf } = require('../pdfReceipt');
const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, on() {}, once() {}, emit() {}, write() {}, end() {} };
const F = require('../finance');
const group = { seller_full_name: 'Kwame Mensah', name: 'Gold Deal', seller_currency: 'USD', seller_account_id: '15963475226' };
const inc = { id: 'abcd1234-0000', group_id: 'g', payer_name: 'ACME Corp', payer_country: 'United Kingdom', purpose: 'Invoice 42', method: 'wire', amount: 2000000, amount_currency: 'GBP', amount_ledger: 2500000, fx_rate: 1.25, received_at: new Date().toISOString(), status: 'held_in_vault', status_history: [], bank_name: 'Barclays', sender_account: 'GB29NWBK60161331926819', fee_amount: 500, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), track_enabled: false };
for (const status of ['held_in_vault', 'credited', 'reversed']) { generateFundsReceiptPdf(res, { kind: 'incoming', record: F.publicIncoming({ ...inc, status }, false, group.seller_account_id), group }); }
const wd = { id: 'wd-1', group_id: 'g', method: 'bank', beneficiary_name: 'K Mensah', bank_name: 'GCB', bank_account: '1234567890123', bank_swift: 'GHCBGHAC', bank_country: 'Ghana', amount: 1000, amount_currency: 'USD', amount_ledger: 1000, status: 'completed', status_history: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), seller_account_id: '15963475226' };
generateFundsReceiptPdf(res, { kind: 'withdrawal', record: F.publicWithdrawal(wd), group });
generateFundsReceiptPdf(res, { kind: 'withdrawal', record: F.publicWithdrawal({ ...wd, method: 'crypto', asset: 'USDT', network: 'TRC20', destination: 'TXyz1234567890abcdef' }), group });
const texts = calls.filter(c => c[0] === 'text').map(c => String(c[1]));
console.log('receipt calls:', calls.length, '| contains Account ID:', texts.some(t => t.includes('15963475226')) || JSON.stringify(calls).includes('15963475226'), '| headline:', texts.filter(t => /RECEIPT/.test(t)).slice(0, 2));
