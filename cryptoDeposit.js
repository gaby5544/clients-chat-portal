// Crypto withdrawal — prior deposit requirement (tiered model).
// Implements crypto-withdrawal-deposit-requirement-spec-1.md:
//   * one-time gate: a seller needs a verified crypto deposit on file before the
//     first crypto withdrawal; once satisfied, crypto_deposit_verified = true and
//     the check is skipped for good (any amount);
//   * degressive tiers evaluated on the USD equivalent of the withdrawal;
//   * every boundary / percentage / flat cap is configurable (app_settings key
//     "crypto_deposit_tiers", editable by a Super Admin) — nothing is hard-coded
//     into the logic below, only into DEFAULT_TIERS;
//   * cumulative verified crypto deposits count toward the requirement;
//   * an admin / compliance role can set the flag manually (VIP / institutional).
// Bank withdrawals are never affected.

const F = require('./finance');

const SETTING_KEY = 'crypto_deposit_tiers';

// Starting values = the LOW end of each range in the spec; compliance can raise them.
const DEFAULT_TIERS = [
  { maxUsd: 10000,    pct: 0.15 },   // Tier 1  < $10,000            15–25 %
  { maxUsd: 100000,   pct: 0.05 },   // Tier 2  $10,000 – $100,000    5–10 %
  { maxUsd: 1000000,  pct: 0.01 },   // Tier 3  $100,000 – $1,000,000 1–5 %
  { maxUsd: null,     flatUsd: 5000 } // Tier 4  > $1,000,000          flat $5,000–$25,000
];
// The spec's permitted ranges — used to validate what an admin saves.
const RANGES = [
  { pct: [0.15, 0.25] }, { pct: [0.05, 0.10] }, { pct: [0.01, 0.05] }, { flat: [5000, 25000] }
];

function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length !== 4) return 'Exactly four tiers are required.';
  let prev = 0;
  for (let i = 0; i < 4; i++) {
    const t = tiers[i];
    if (i < 3) {
      const max = Number(t.maxUsd);
      if (!Number.isFinite(max) || max <= prev) return `Tier ${i + 1} upper limit must be greater than the previous tier's.`;
      prev = max;
      const pct = Number(t.pct);
      if (!Number.isFinite(pct) || pct < RANGES[i].pct[0] - 1e-9 || pct > RANGES[i].pct[1] + 1e-9) {
        return `Tier ${i + 1} percentage must be between ${RANGES[i].pct[0] * 100}% and ${RANGES[i].pct[1] * 100}%.`;
      }
    } else {
      const flat = Number(t.flatUsd);
      if (!Number.isFinite(flat) || flat < RANGES[3].flat[0] || flat > RANGES[3].flat[1]) return `Tier 4 flat amount must be between $${RANGES[3].flat[0]} and $${RANGES[3].flat[1]}.`;
    }
  }
  return null;
}
function cleanTiers(tiers) {
  return tiers.map((t, i) => (i < 3 ? { maxUsd: Number(t.maxUsd), pct: Number(t.pct) } : { maxUsd: null, flatUsd: Number(t.flatUsd) }));
}

async function loadTiers(store) {
  const saved = await store.getSetting(SETTING_KEY);
  if (saved && !validateTiers(saved)) return cleanTiers(saved);
  return DEFAULT_TIERS;
}

function tierIndexFor(usdAmount, tiers) {
  for (let i = 0; i < tiers.length - 1; i++) if (usdAmount < tiers[i].maxUsd) return i;
  return tiers.length - 1;
}

/** Required deposit in USD for a withdrawal of `usdAmount` USD. */
function requiredDepositUsd(usdAmount, tiers) {
  const i = tierIndexFor(usdAmount, tiers);
  const t = tiers[i];
  const usd = t.flatUsd !== undefined ? t.flatUsd : F.round2(usdAmount * t.pct);
  return { tier: i + 1, requiredUsd: F.round2(usd), pct: t.pct !== undefined ? t.pct : null, flat: t.flatUsd !== undefined };
}

const toUsd = (amount, ccy) => F.round2(Number(amount) * (F.FX_TO_USD[ccy] || 1));
const fromUsd = (usd, ccy) => F.round2(Number(usd) / (F.FX_TO_USD[ccy] || 1));

/**
 * Decide whether `group` may withdraw `amount` (in `amountCurrency`) by crypto.
 * Returns { allowed, verified, ... }. When blocked it carries everything the popup needs.
 * `verifiedDeposits` = this seller's deposits (any status); only method=crypto,status=verified count.
 */
function evaluate({ group, amount, amountCurrency, tiers, deposits }) {
  if (group.crypto_deposit_verified) return { allowed: true, alreadyVerified: true };
  const ccy = group.seller_currency || 'USD';
  const usdAmount = toUsd(amount, amountCurrency || ccy);
  const req = requiredDepositUsd(usdAmount, tiers);
  const haveUsd = F.round2((deposits || [])
    .filter((d) => d.method === 'crypto' && d.status === 'verified')
    .reduce((a, d) => a + toUsd(d.amount, ccy), 0)); // deposits are recorded in the account currency
  const pendingUsd = F.round2((deposits || [])
    .filter((d) => d.method === 'crypto' && d.status === 'held_in_vault')
    .reduce((a, d) => a + toUsd(d.amount, ccy), 0));
  if (haveUsd >= req.requiredUsd) return { allowed: true, qualifies: true, requiredUsd: req.requiredUsd, haveUsd, tier: req.tier };
  return {
    allowed: false, tier: req.tier, flat: req.flat, pct: req.pct,
    requiredUsd: req.requiredUsd, haveUsd, pendingUsd,
    requiredAccount: fromUsd(req.requiredUsd, ccy), haveAccount: fromUsd(haveUsd, ccy),
    remainingAccount: Math.max(0, F.round2(fromUsd(req.requiredUsd, ccy) - fromUsd(haveUsd, ccy))),
    currency: ccy, usdAmount
  };
}

module.exports = { SETTING_KEY, DEFAULT_TIERS, RANGES, validateTiers, cleanTiers, loadTiers, requiredDepositUsd, tierIndexFor, evaluate, toUsd, fromUsd };
