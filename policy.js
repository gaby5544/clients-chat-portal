// Withdrawal policy: the daily limit and the tiered prior-crypto-deposit requirement.
// Everything is configurable at runtime (stored in app_settings, edited from the
// admin Funds Desk) — nothing here is a hard-coded business rule except the
// defaults and the compliance ranges the config is validated against.

const F = require('./finance');

const DAILY_LIMIT_DEFAULT = 10000000; // per rolling 24h, in the account's own currency
const DAILY_LIMIT_KEY = 'withdrawal_limits';
const TIERS_KEY = 'crypto_deposit_tiers';

// Tier ranges from the crypto-deposit spec. A value outside its range is rejected
// by validateTiers so compliance can tune within policy, not accidentally outside it.
const RANGES = [
  { min: 0.15, max: 0.25 },       // tier 1: < 10k
  { min: 0.05, max: 0.10 },       // tier 2: 10k – 100k
  { min: 0.01, max: 0.05 },       // tier 3: 100k – 1M
  { flatMin: 5000, flatMax: 25000 } // tier 4: > 1M (flat, not a %)
];

// Defaults sit inside each range: 20%, 7.5%, 3%, flat $10,000.
const DEFAULT_TIERS = [
  { upTo: 10000, pct: 0.20 },
  { upTo: 100000, pct: 0.075 },
  { upTo: 1000000, pct: 0.03 },
  { upTo: null, flat: 10000 } // null = no upper bound
];

function validateTiers(t) {
  if (!Array.isArray(t) || t.length !== 4) return { error: 'There must be exactly 4 tiers.' };
  const out = [];
  let prev = 0;
  for (let i = 0; i < 4; i++) {
    const row = t[i] || {};
    if (i < 3) {
      const up = Number(row.upTo);
      if (!Number.isFinite(up) || up <= prev) return { error: `Tier ${i + 1}: the upper bound must be greater than the previous tier.` };
      const pct = Number(row.pct);
      if (!Number.isFinite(pct) || pct < RANGES[i].min - 1e-9 || pct > RANGES[i].max + 1e-9) {
        return { error: `Tier ${i + 1}: the percentage must be between ${RANGES[i].min * 100}% and ${RANGES[i].max * 100}%.` };
      }
      out.push({ upTo: up, pct });
      prev = up;
    } else {
      const flat = Number(row.flat);
      if (!Number.isFinite(flat) || flat < RANGES[3].flatMin || flat > RANGES[3].flatMax) {
        return { error: `Tier 4: the flat amount must be between $${RANGES[3].flatMin.toLocaleString('en-US')} and $${RANGES[3].flatMax.toLocaleString('en-US')}.` };
      }
      out.push({ upTo: null, flat });
    }
  }
  return { tiers: out };
}

async function getTiers(store) {
  const saved = await store.getSetting(TIERS_KEY);
  if (saved) { const v = validateTiers(saved); if (v.tiers) return v.tiers; }
  return DEFAULT_TIERS.map((x) => ({ ...x }));
}
async function saveTiers(store, tiers) {
  const v = validateTiers(tiers);
  if (v.error) return v;
  await store.setSetting(TIERS_KEY, v.tiers);
  return v;
}

async function getDailyLimit(store) {
  const saved = await store.getSetting(DAILY_LIMIT_KEY);
  const n = saved && Number(saved.daily);
  return Number.isFinite(n) && n > 0 ? n : DAILY_LIMIT_DEFAULT;
}
async function saveDailyLimit(store, daily) {
  const n = Number(daily);
  if (!Number.isFinite(n) || n < 1000 || n > 1e12) return { error: 'The daily limit must be between 1,000 and 1,000,000,000,000.' };
  await store.setSetting(DAILY_LIMIT_KEY, { daily: n });
  return { daily: n };
}

// USD-equivalent of an amount in the account currency (all thresholds are evaluated in USD).
function toUsd(amount, ccy) { return F.convertCurrency(amount, ccy, 'USD'); }
function fromUsd(usd, ccy) { return F.convertCurrency(usd, 'USD', ccy); }

// Required prior crypto deposit for a withdrawal of `amountUsd`.
function requiredDepositUsd(amountUsd, tiers) {
  const a = Number(amountUsd);
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.upTo === null || a < t.upTo || (i === tiers.length - 1)) {
      if (t.flat !== undefined) return { tier: i + 1, flat: t.flat, required: F.round2(t.flat) };
      return { tier: i + 1, pct: t.pct, required: F.round2(a * t.pct) };
    }
  }
  return { tier: 4, flat: tiers[3].flat, required: F.round2(tiers[3].flat) };
}

// Is a crypto withdrawal of `amountLedger` (account currency) allowed right now?
//   group: the seller row; deposits: the seller's deposit rows (all statuses)
function cryptoGate(group, deposits, amountLedger, tiers) {
  const ccy = group.seller_currency || 'USD';
  const tierInfo = requiredDepositUsd(toUsd(amountLedger, ccy), tiers);
  if (group.crypto_deposit_verified) {
    return { allowed: true, unlocked: true, byFlag: true, ...describe(tierInfo, 0, ccy) };
  }
  const haveUsd = F.round2(deposits.filter((d) => d.status === 'verified' && d.method === 'crypto').reduce((s, d) => s + toUsd(Number(d.amount), ccy), 0));
  const pendingUsd = F.round2(deposits.filter((d) => d.status === 'held_in_vault' && d.method === 'crypto').reduce((s, d) => s + toUsd(Number(d.amount), ccy), 0));
  const ok = haveUsd + 1e-9 >= tierInfo.required;
  return { allowed: ok, unlocked: ok, byFlag: false, willSetFlag: ok, ...describe(tierInfo, haveUsd, ccy), pendingUsd };
}

function describe(tierInfo, haveUsd, ccy) {
  const remaining = Math.max(0, F.round2(tierInfo.required - haveUsd));
  return {
    tier: tierInfo.tier, pct: tierInfo.pct ?? null, flat: tierInfo.flat ?? null,
    requiredUsd: tierInfo.required, requiredLedger: fromUsd(tierInfo.required, ccy),
    haveUsd, remainingUsd: remaining, remainingLedger: fromUsd(remaining, ccy), currency: ccy
  };
}

// Rolling-24h withdrawn total (declined requests do not count) for the daily cap.
function withdrawnLast24h(withdrawals, nowMs = Date.now()) {
  const since = nowMs - 24 * 3600 * 1000;
  return F.round2(withdrawals
    .filter((w) => !['declined', 'rejected', 'failed'].includes(w.status) && new Date(w.created_at).getTime() >= since)
    .reduce((s, w) => s + Number(w.amount_ledger || 0), 0));
}

function dailyLimitCheck(group, withdrawals, amountLedger, limit, nowMs = Date.now()) {
  const unlimited = group.business_status === 'verified';
  const used = withdrawnLast24h(withdrawals, nowMs);
  if (unlimited) return { allowed: true, unlimited: true, limit: null, used, remaining: null };
  const remaining = Math.max(0, F.round2(limit - used));
  return { allowed: used + Number(amountLedger) <= limit + 1e-9, unlimited: false, limit, used, remaining };
}

module.exports = {
  DAILY_LIMIT_DEFAULT, DEFAULT_TIERS, RANGES, validateTiers, getTiers, saveTiers, getDailyLimit, saveDailyLimit,
  toUsd, fromUsd, requiredDepositUsd, cryptoGate, withdrawnLast24h, dailyLimitCheck
};
