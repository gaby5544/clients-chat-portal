// ⚠️ PLACEHOLDER FX RATES — replace before going live.
//
// These are fixed, approximate rates so the withdrawal/deposit flow has
// something real to compute with in dev/demo. A production deployment
// should swap `convert()` below to call a live FX API (e.g.
// exchangerate.host, Open Exchange Rates) on some short cache (a few
// minutes), and should snapshot whatever rate was used onto the record
// at submission time (already wired up in routes.js via `amountUsdEquiv`
// and `entered_amount`/`entered_currency`) so historical requests don't
// silently change value if rates move later.

const RATES_TO_USD = {
  USD: 1,
  EUR: 1.09,
  GBP: 1.29
};

const SUPPORTED_CURRENCIES = Object.keys(RATES_TO_USD);

function toUsd(amount, currency) {
  const rate = RATES_TO_USD[currency];
  if (rate == null) throw new Error(`Unsupported currency: ${currency}`);
  return amount * rate;
}

function convert(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  const usd = toUsd(amount, fromCurrency);
  return usd / RATES_TO_USD[toCurrency];
}

module.exports = { RATES_TO_USD, SUPPORTED_CURRENCIES, toUsd, convert };
