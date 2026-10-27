const BD = require('../bankDetails.js');
const mem = {}; const store = { getSetting: async (k, d) => (k in mem ? mem[k] : d), setSetting: async (k, v) => { mem[k] = v; } };
const grp = (ccy) => ({ id: 'g1', kyc_status: 'verified', seller_account_id: '48213907765', seller_currency: ccy, seller_full_name: 'Kwame Mensah' });
(async () => {
  let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ok:' : '  FAIL:', m); };
  const usd = { bankName: 'Chase Bank', bankAddress: '699 W Gaines St, Tallahassee, FL 32304', swift: 'chasus33', accountNumber: '994077359', routing: '021000021' };
  let r = await BD.setProfiles(store, { EUR: { useUsd: true } });
  ok(!r.ok && /USD account first/.test(r.error), 'EUR cannot use the US bank before the USD account exists');
  r = await BD.setProfiles(store, { USD: usd, EUR: { useUsd: true }, GBP: { useUsd: true } });
  ok(r.ok && r.profiles.EUR.configured && r.profiles.GBP.configured && r.profiles.EUR.useUsd, 'saved together: USD + EUR + GBP use the US bank');
  for (const c of ['USD', 'EUR', 'GBP']) {
    const g = await BD.getForGroup(store, grp(c)); const d = g.details[c]; const rows = Object.fromEntries([...d.a, ...d.b]);
    ok(g.ready && rows['Account number'] === '994077359' && rows['ABA routing number'] === '021000021' && rows['SWIFT / BIC'] === 'CHASUS33' && rows['Bank country'] === 'United States' && /Tallahassee/.test(rows['Bank address']) && rows['Account name'] === 'Kwame Mensah' && rows['Payment reference'] === '48213907765', `${c}: sellers see the one US bank, own name, own reference, "Bank country: United States"`);
    ok(!('IBAN' in rows) && !('Sort code' in rows), `${c}: no IBAN / sort code shown (a US account has none)`);
    ok(c === 'USD' ? /Receive USD by ACH/.test(d.intro) : new RegExp(`${c} payments are received by international SWIFT wire into the Desk’s United States`).test(d.intro), `${c}: the wording fits the currency`);
  }
  const snap = await BD.receivingSnapshot(store, grp('EUR'));
  ok(snap.ready && snap.ending === '7359' && snap.accountNumber === '994077359' && /Account number/.test(snap.idLabel), 'payment records for EUR sellers name the real account (••7359)');
  r = await BD.setProfiles(store, { EUR: { bankName: 'Deutsche Bank AG', bankAddress: 'Taunusanlage 12, 60325 Frankfurt, Germany', swift: 'DEUTDEFF', iban: 'DE89 3704 0044 0532 0130 00' } });
  const g2 = await BD.getForGroup(store, grp('EUR')); const rows2 = Object.fromEntries([...g2.details.EUR.a, ...g2.details.EUR.b]);
  ok(r.ok && rows2['IBAN'] && rows2['Bank country'] === 'Germany' && /^Euro account/.test(g2.details.EUR.intro), 'a real euro account of its own still works, and its country is read from its SWIFT (Germany)');
  r = await BD.setProfiles(store, { USD: { bankName: '', bankAddress: '', swift: '', accountNumber: '', routing: '' }, GBP: { useUsd: true } });
  ok(!r.ok, 'removing USD while GBP depends on it is refused');
  const p = await BD.getProfiles(store); ok(p.USD.configured, 'USD stays untouched after the refused change');
  console.log(`RESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
