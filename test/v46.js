// v3.18: bank address optional; bank country required on bank withdrawals.
const BD = require('../bankDetails.js');
const mem = {}; const store = { getSetting: async (k, d) => (k in mem ? mem[k] : d), setSetting: async (k, v) => { mem[k] = v; } };
const grp = (ccy) => ({ id: 'g1', kyc_status: 'verified', seller_account_id: '48213907765', seller_currency: ccy, seller_full_name: 'Kwame Mensah' });
(async () => {
  let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ok:' : '  FAIL:', m); };
  const usd = { bankName: 'Chase Bank', swift: 'chasus33', accountNumber: '994077359', routing: '021000021' };
  let r = await BD.setProfiles(store, { USD: usd });
  ok(r.ok && r.profiles.USD.configured, 'USD saves without a bank address');
  let g = await BD.getForGroup(store, grp('USD')); let rows = Object.fromEntries([...g.details.USD.a, ...g.details.USD.b]);
  ok(g.ready && !('Bank address' in rows) && rows['Bank name'] === 'Chase Bank' && rows['SWIFT / BIC'] === 'CHASUS33' && rows['Bank country'] === 'United States', 'sellers see no empty "Bank address" row; name, SWIFT and country still show');
  r = await BD.setProfiles(store, { USD: { ...usd, bankAddress: '699 W Gaines St, Tallahassee, FL 32304' } });
  g = await BD.getForGroup(store, grp('USD')); rows = Object.fromEntries([...g.details.USD.a, ...g.details.USD.b]);
  ok(r.ok && /Tallahassee/.test(rows['Bank address']), 'an address typed anyway is still shown');
  r = await BD.setProfiles(store, { USD: { ...usd, bankAddress: 'x' } });
  ok(!r.ok, 'a too-short address is still refused (so typos do not slip in)');
  r = await BD.setProfiles(store, { USD: usd, EUR: { bankName: 'Euro Bank', swift: 'DEUTDEFF', iban: 'DE89 3704 0044 0532 0130 00' }, GBP: { bankName: 'UK Bank', swift: 'BARCGB22', sortCode: '201595', accountNumber: '12345678' } });
  ok(r.ok && r.profiles.EUR.configured && r.profiles.GBP.configured, 'EUR and GBP also save without an address');
  console.log(`RESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
