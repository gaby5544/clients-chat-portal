/* Realistic default values for the "Record incoming funds" form. Every field offers "Use default" or
   "Write my own". Shared by browser and server (UMD). Values look like genuine banking data. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.FundDefaults = factory(); })(this, function () {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const BANKS = {
    USD: ['JPMorgan Chase Bank, N.A.', 'Bank of America, N.A.', 'Wells Fargo Bank, N.A.', 'Citibank, N.A.', 'U.S. Bank National Association'],
    GBP: ['Barclays Bank UK PLC', 'HSBC UK Bank plc', 'Lloyds Bank plc', 'NatWest Bank plc', 'Santander UK plc'],
    EUR: ['Deutsche Bank AG', 'BNP Paribas S.A.', 'ING Bank N.V.', 'Banco Santander S.A.', 'Commerzbank AG']
  };
  const BANK_CODE = { 'Barclays Bank UK PLC': 'BARC', 'HSBC UK Bank plc': 'HBUK', 'Lloyds Bank plc': 'LOYD', 'NatWest Bank plc': 'NWBK', 'Santander UK plc': 'ABBY' };

  function ibanChecksum(country, bban) {                       // ISO 13616 mod-97, so generated IBANs validate
    const s = bban + country + '00';
    const n = s.split('').map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
    let rem = 0; for (const ch of n) rem = (rem * 10 + Number(ch)) % 97;
    return String(98 - rem).padStart(2, '0');
  }
  function iban(country, bban) { return country + ibanChecksum(country, bban) + bban; }

  function bankName(ccy) { return pick(BANKS[ccy] || BANKS.USD); }
  function senderAccount(ccy, bank) {
    if (ccy === 'GBP') return iban('GB', (BANK_CODE[bank] || 'BARC') + digits(6) + digits(8));
    if (ccy === 'EUR') return iban('DE', digits(8) + digits(10));
    return digits(10);                                         // US-style account number
  }
  function reference(method) {
    const d = new Date(); const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    if (method === 'crypto') return '0x' + hex(64);
    if (method === 'cheque') return digits(6);
    if (method === 'wire') return 'SWF' + ymd + digits(8);
    if (method === 'card') return 'AUTH' + digits(6);
    return 'FT' + ymd + hex(6).toUpperCase();
  }
  const purpose = () => `Payment for goods purchased under the agreed transaction — settlement of invoice INV-${digits(5)}`;
  const internalNote = () => 'Funds verified against the sender\'s bank record. Payer identity checked and cleared. Release authorised once all verification stages are complete.';
  const network = (asset) => (asset === 'BTC' ? 'Bitcoin' : asset === 'ETH' ? 'ERC20' : 'TRC20');
  /** A realistic bank / processing charge: 2.5 % of the amount, rounded up to the next 5, minimum 15. */
  function charge(amount) { const a = Number(amount); if (!(a > 0)) return 0; return Math.max(15, Math.ceil((a * 0.025) / 5) * 5); }

  return { bankName, senderAccount, reference, purpose, internalNote, network, charge };
});
