// Shared money/ledger helpers for the seller Transaction Account.
// Everything that shapes data leaving the server for a seller or an admin
// lives here, so the two sides can never drift apart and internal-only fields
// (admin notes, proof files, admin session tokens) are stripped in one place.

const crypto = require('crypto');
const Escrow = require('./escrow');
const COUNTRIES = require('./public/countries.js');
const Email = require('./email');

const CURRENCIES = new Set(['USD', 'GBP', 'EUR']);
const CRYPTO_ASSETS = new Set(['BTC', 'ETH', 'USDT']);

// Fixed, illustrative FX rates (see README "Known gaps"). Replace with a live
// feed before production — every conversion in the app goes through here.
const FX_TO_USD = { USD: 1, GBP: 1.27, EUR: 1.08 };

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function fxRate(from, to) {
  if (from === to) return 1;
  return (FX_TO_USD[from] || 1) / (FX_TO_USD[to] || 1);
}
function convertCurrency(amount, from, to) {
  return round2(Number(amount) * fxRate(from, to));
}

// ---- Presentation of money ----
// Below one million: full figure with thousands separators ($250,000.00).
// One million and above: compact and elegant ($2.00M, $1.25B) — never a wall of zeros.
const CCY_SYMBOL = { USD: '$', GBP: '£', EUR: '€' };
function fmtElite(amount, ccy) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sym = CCY_SYMBOL[ccy] || '';
  const suffix = CCY_SYMBOL[ccy] ? '' : ` ${ccy || ''}`.trimEnd();
  const sign = n < 0 ? '-' : '';
  let body;
  if (abs >= 1e12) body = `${(abs / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) body = `${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) body = `${(abs / 1e6).toFixed(2)}M`;
  else body = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${sym}${body}${suffix ? ' ' + suffix.trim() : ''}`;
}
function fmtFull(amount, ccy) {
  const n = Number(amount) || 0;
  const body = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return CCY_SYMBOL[ccy] ? `${CCY_SYMBOL[ccy]}${body}` : `${body} ${ccy || ''}`.trim();
}

// ---- Human-friendly references (derived from the record id — no extra column) ----
const REF_PREFIX = { incoming: 'IN', deposit: 'DP', withdrawal: 'WD' };
function refFor(kind, id) {
  return `${REF_PREFIX[kind] || 'TX'}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// ---- Signed receipt links ----
// Receipts are only ever handed to the seller who owns the record or to a
// finance admin (inside the socket payload), and each link carries an HMAC
// signature — so a receipt URL can't be guessed or edited to point at
// someone else's record. Set RECEIPT_SECRET so links survive restarts.
const RECEIPT_SECRET = process.env.RECEIPT_SECRET || crypto.randomBytes(32).toString('hex');
function signReceipt(kind, id) {
  return crypto.createHmac('sha256', RECEIPT_SECRET).update(`${kind}:${id}`).digest('hex').slice(0, 40);
}
function verifyReceiptSig(kind, id, sig) {
  if (typeof sig !== 'string' || sig.length !== 40) return false;
  const expected = Buffer.from(signReceipt(kind, id));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
function receiptUrl(kind, id) {
  return `/api/receipts/${kind}/${encodeURIComponent(id)}?sig=${signReceipt(kind, id)}`;
}

// A status_history entry as sellers/admins see it: never the admin's session
// token, only who kind of actor made the change.
function safeHistory(history) {
  return (Array.isArray(history) ? history : []).map((h) => ({
    status: h.status,
    at: h.at,
    note: h.note || null,
    actor: h.by ? 'Desk Officer' : (h.status === 'pending' ? 'You' : 'System')
  }));
}

// ---- Seller account state (sensitive: only the seller + finance admins) ----
const DAILY_WITHDRAWAL_LIMIT = Number(process.env.DAILY_WITHDRAWAL_LIMIT) > 0 ? Number(process.env.DAILY_WITHDRAWAL_LIMIT) : 10000000;
const dateOnly = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);
const maskTail = (v) => { const t = String(v || ''); return t.length <= 4 ? t : `${'•'.repeat(Math.min(t.length - 4, 8))}${t.slice(-4)}`; };

/** forAdmin = true adds fields a seller must never receive (IP, raw ID number, auto-check report, business filing). */
function publicSellerAccount(g, { forAdmin = false } = {}) {
  const country = g.seller_country || null;
  const c = COUNTRIES.byName(country);
  const biz = g.business_data || null;
  const out = {
    groupId: g.id,
    groupName: g.name,
    registered: g.seller_registered,
    fullName: g.seller_full_name || null,
    email: g.email_b || null,
    emailVerified: !!g.seller_email_verified,
    phone: g.seller_phone || null,
    accountId: g.seller_account_id || null,
    accountType: g.seller_account_type || 'Standard account',
    language: g.seller_language || 'en',
    currency: g.seller_currency || null,
    currencyLocked: !!g.currency_locked_at,
    dateOfBirth: dateOnly(g.seller_date_of_birth),
    country,
    countryCode: c ? c.code : null,
    registeredAt: g.seller_registered_at || null,
    termsAcceptedAt: g.terms_accepted_at || null,
    termsVersion: g.terms_version || null,
    disabled: !!g.seller_disabled,
    disabledReason: g.seller_disabled ? (g.seller_disabled_reason || null) : null,
    disabledAt: g.seller_disabled ? (g.seller_disabled_at || null) : null,
    disbursementEnabled: !!g.disbursement_enabled,
    cryptoDepositVerified: !!g.crypto_deposit_verified,
    dailyLimit: DAILY_WITHDRAWAL_LIMIT,
    emailCodeRequired: Email.emailCodesRequired(),
    business: {
      status: g.business_status || 'none',
      rejectionReason: g.business_rejection_reason || null,
      submittedAt: g.business_submitted_at || null,
      reviewedAt: g.business_reviewed_at || null,
      companyName: biz ? biz.companyName || null : null
    },
    kyc: {
      status: g.kyc_status,
      docType: g.kyc_doc_type || null,
      idFrontUrl: g.kyc_id_front_url || null,
      idBackUrl: g.kyc_id_back_url || null,
      proofAddressUrl: g.kyc_proof_address_url || null,
      proofAddressType: g.kyc_proof_address_type || null,
      selfieUrl: g.kyc_selfie_url || null,
      nameOnId: g.kyc_name_on_id || null,
      idExpiry: dateOnly(g.kyc_id_expiry),
      issuingCountry: g.kyc_issuing_country || null,
      idNumberMasked: g.kyc_id_number ? maskTail(g.kyc_id_number) : null,
      submittedAt: g.kyc_submitted_at || null,
      reviewedAt: g.kyc_reviewed_at || null,
      rejectionReason: g.kyc_rejection_reason || null
    },
    balances: {
      available: Number(g.balance_available || 0),
      held: Number(g.balance_held || 0),
      totalDeposited: Number(g.total_deposited || 0)
    }
  };
  if (forAdmin) {
    out.registeredIp = g.seller_registered_ip || null;
    out.passwordSet = !!g.seller_password_hash;
    out.kyc.idNumber = g.kyc_id_number || null;
    out.kyc.autoReport = g.kyc_auto_report || null;
    out.business.data = biz;
  }
  return out;
}

function publicDeposit(d) {
  return {
    id: d.id, ref: refFor('deposit', d.id), groupId: d.group_id, method: d.method, asset: d.asset, network: d.network,
    referenceCode: d.reference_code, amount: Number(d.amount), status: d.status,
    notifiedAt: d.notified_at, verifiedAt: d.verified_at, rejectionReason: d.rejection_reason
  };
}

// Withdrawals have exactly four stages: pending -> processing -> completed, or declined.
// (Older records may still carry 'held_in_vault' or 'failed'; they read as pending / declined.)
function normalizeWdStatus(status) {
  if (status === 'held_in_vault') return 'pending';
  if (status === 'failed') return 'rejected';
  return status;
}

function publicWithdrawal(w, { forAdmin = false } = {}) {
  const status = normalizeWdStatus(w.status);
  return {
    id: w.id, ref: refFor('withdrawal', w.id), groupId: w.group_id, method: w.method, asset: w.asset, network: w.network,
    destination: w.destination, beneficiaryName: w.beneficiary_name, bankName: w.bank_name,
    bankAccount: forAdmin ? w.bank_account : maskTail(w.bank_account), bankSwift: w.bank_swift, bankCountry: w.bank_country,
    amount: Number(w.amount), amountCurrency: w.amount_currency, amountLedger: Number(w.amount_ledger),
    rawStatus: w.status, status, statusReason: w.status_reason, statusHistory: safeHistory(w.status_history),
    confirmedAt: w.confirmed_at || null, fundsReserved: !!w.funds_reserved,
    ip: forAdmin ? (w.ip || null) : undefined,
    createdAt: w.created_at, updatedAt: w.updated_at,
    receiptUrl: status === 'completed' ? receiptUrl('withdrawal', w.id) : null
  };
}

// Incoming funds recorded by the Desk. Sellers get everything about the
// payment itself plus the SAFE escrow tracker view (no timers, ever); only
// admins additionally get the internal note, proof file, payer contact details,
// the full escrow console data and who recorded it.
function publicIncoming(i, forAdmin, { accountId } = {}) {
  const out = {
    id: i.id, ref: refFor('incoming', i.id), groupId: i.group_id,
    payerName: i.payer_name, payerCompany: i.payer_company || null, payerCountry: i.payer_country || null, purpose: i.purpose,
    orderRef: i.order_ref || null,
    method: i.method, asset: i.asset || null, network: i.network || null, externalRef: i.external_ref || null,
    amount: Number(i.amount), amountCurrency: i.amount_currency, amountLedger: Number(i.amount_ledger),
    fxRate: Number(i.fx_rate || 1), receivedAt: i.received_at,
    status: i.status, statusReason: i.status_reason || null, statusHistory: safeHistory(i.status_history),
    createdAt: i.created_at, updatedAt: i.updated_at,
    receiptUrl: i.status === 'credited' ? receiptUrl('incoming', i.id) : null,
    tracker: i.status === 'reversed' ? null : Escrow.sellerView(i.review, { accountId })
  };
  if (forAdmin) {
    out.payerEmail = i.payer_email || null;
    out.payerPhone = i.payer_phone || null;
    out.payerBank = i.payer_bank || null;
    out.internalNote = i.internal_note || null;
    out.buyerVisibleNote = !!i.buyer_visible_note;
    out.proofUrl = i.proof_url || null;
    out.escrow = Escrow.adminView(i.review, { accountId });
  }
  return out;
}

module.exports = {
  CURRENCIES, CRYPTO_ASSETS, FX_TO_USD, CCY_SYMBOL, DAILY_WITHDRAWAL_LIMIT, round2, fxRate, convertCurrency, fmtElite, fmtFull, normalizeWdStatus, maskTail,
  refFor, signReceipt, verifyReceiptSig, receiptUrl, safeHistory,
  publicSellerAccount, publicDeposit, publicWithdrawal, publicIncoming
};
