// Shared money/ledger helpers for the seller Transaction Account.
// Everything that shapes data leaving the server for a seller or an admin
// lives here, so the two sides can never drift apart and internal-only fields
// (admin notes, proof files, admin session tokens) are stripped in one place.

const crypto = require('crypto');

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
const COMPLAINTS_EMAIL = process.env.COMPLAINTS_EMAIL || 'complaints@usvistra.com';
const ACCOUNT_TYPE_LABEL = { standard: 'Standard account', business: 'Business account' };

function dateOnly(v) {
  if (!v) return null;
  return (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
}
function jsonOf(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fallback; } }
  return v;
}

function publicSellerAccount(g, { forAdmin = false } = {}) {
  const business = jsonOf(g.business_profile, null);
  const out = {
    groupId: g.id,
    groupName: g.name,
    registered: g.seller_registered,
    fullName: g.seller_full_name || null,
    email: g.email_b || null,
    emailLocked: !!g.seller_email_locked,
    emailVerified: !!g.seller_email_verified_at,
    phone: g.seller_phone || null,
    currency: g.seller_currency || null,
    currencyLocked: !!g.currency_locked_at,
    dateOfBirth: dateOnly(g.seller_date_of_birth),
    country: g.seller_country || null,
    countryIso: g.seller_country_iso || null,
    accountId: g.seller_account_id || null,
    accountType: g.seller_account_type || 'standard',
    accountTypeLabel: ACCOUNT_TYPE_LABEL[g.seller_account_type] || 'Standard account',
    language: g.seller_language || 'en',
    termsAcceptedAt: g.seller_terms_accepted_at || null,
    termsVersion: g.seller_terms_version || null,
    registeredAt: g.seller_registered_at || null,
    disabled: !!g.seller_disabled,
    disabledReason: g.seller_disabled ? (g.seller_disabled_reason || null) : null,
    disabledAt: g.seller_disabled ? (g.seller_disabled_at || null) : null,
    complaintsEmail: COMPLAINTS_EMAIL,
    disbursementEnabled: !!g.disbursement_enabled,
    cryptoDepositVerified: !!g.crypto_deposit_verified,
    business: {
      status: g.business_status || 'none',
      companyName: business ? business.companyName || null : null,
      submittedAt: g.business_submitted_at || null,
      reviewedAt: g.business_reviewed_at || null,
      rejectionReason: g.business_rejection_reason || null
    },
    kyc: {
      status: g.kyc_status,
      docType: g.kyc_doc_type || null,
      idFrontUrl: g.kyc_id_front_url || null,
      idBackUrl: g.kyc_id_back_url || null,
      proofAddressUrl: g.kyc_proof_address_url || null,
      proofAddressType: g.kyc_proof_address_type || null,
      selfieUrl: g.kyc_selfie_url || null,
      submittedAt: g.kyc_submitted_at || null,
      reviewedAt: g.kyc_reviewed_at || null,
      rejectionReason: g.kyc_rejection_reason || null
    },
    balances: {
      available: Number(g.balance_available || 0),
      held: Number(g.balance_held || 0),
      pending: Number(g.balance_pending || 0),
      totalDeposited: Number(g.total_deposited || 0)
    }
  };
  if (forAdmin) {
    out.dateOfBirth = dateOnly(g.seller_date_of_birth);
    out.passwordSet = !!g.seller_password_hash;          // login uses a salted hash; the readable copy is encrypted and only opened via the audited reveal action
    out.passwordStored = !!g.seller_password_enc;
    out.passwordAdminAccess = true;   // any Admin / Super Admin may open it (audited)
    out.loginAlertsEnabled = !jsonOf(g.group_flags, {}).loginAlertsDisabled;
    out.linkExpired = { buyer: !!jsonOf(g.group_flags, {}).buyerLinkRevoked, seller: !!jsonOf(g.group_flags, {}).sellerLinkRevoked };
    out.securityReports = jsonOf(g.group_flags, {}).securityReports || [];
    out.passwordReveals = jsonOf(g.seller_password_reveals, []).slice(-10);
    out.passwordChangedAt = g.seller_password_changed_at || g.seller_registered_at || null;
    out.failedLogins = Number(g.seller_failed_logins || 0);
    out.lockedUntil = g.seller_locked_until || null;
    out.ips = jsonOf(g.seller_ip_log, []).map((r) => ({ ...r, blocked: jsonOf(g.seller_blocked_ips, []).includes(r.ip) }));
    out.blockedIps = jsonOf(g.seller_blocked_ips, []);
    out.business.profile = business;
    out.kyc.idNumber = g.kyc_id_number || null;
    out.kyc.idExpiry = dateOnly(g.kyc_id_expiry);
    out.kyc.idName = g.kyc_id_name || null;
    out.kyc.idDob = dateOnly(g.kyc_id_dob);
    out.kyc.autoResult = jsonOf(g.kyc_auto_result, null);
    out.cryptoDepositRequiredUsd = g.crypto_deposit_required_usd === null || g.crypto_deposit_required_usd === undefined ? null : Number(g.crypto_deposit_required_usd);
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

function publicWithdrawal(w, { forAdmin = false } = {}) {
  const out = {
    id: w.id, ref: refFor('withdrawal', w.id), groupId: w.group_id, method: w.method, asset: w.asset, network: w.network,
    destination: w.destination, beneficiaryName: w.beneficiary_name, bankName: w.bank_name,
    bankAccount: w.bank_account, bankSwift: w.bank_swift, bankCountry: w.bank_country,
    amount: Number(w.amount), amountCurrency: w.amount_currency, amountLedger: Number(w.amount_ledger),
    status: w.status, statusReason: w.status_reason, statusHistory: safeHistory(w.status_history),
    createdAt: w.created_at, updatedAt: w.updated_at,
    sellerAccountId: w.seller_account_id || null,
    emailConfirmed: !!w.email_confirmed_at,
    receiptUrl: w.status === 'completed' ? receiptUrl('withdrawal', w.id) : null
  };
  if (forAdmin) out.requestIp = w.request_ip || null;
  return out;
}

// Incoming funds recorded by the Desk. Sellers get everything about the
// payment itself; only admins additionally get the internal note, the proof
// file and who recorded it.
function publicIncoming(i, forAdmin, accountId, phone) {
  const { publicTrack } = require('./trackingDefs');
  const out = {
    id: i.id, ref: refFor('incoming', i.id), groupId: i.group_id,
    payerName: i.payer_name, payerCountry: i.payer_country || null, purpose: i.purpose,
    method: i.method, asset: i.asset || null, network: i.network || null, externalRef: i.external_ref || null,
    bankName: i.bank_name || null, senderAccount: i.sender_account || null, feeAmount: Number(i.fee_amount || 0),
    feePayer: (jsonOf(i.meta, {}).feePayer) || (Number(i.fee_amount || 0) > 0 ? 'seller' : 'none'),
    buyerTotal: jsonOf(i.meta, {}).buyerTotal != null ? Number(jsonOf(i.meta, {}).buyerTotal) : Number(i.amount),
    sellerReceives: ((jsonOf(i.meta, {}).feePayer || 'seller') === 'seller') ? Number(i.amount) - Number(i.fee_amount || 0) : Number(i.amount),
    autoRelease: !!jsonOf(i.meta, {}).autoRelease,
    amount: Number(i.amount), amountCurrency: i.amount_currency, amountLedger: Number(i.amount_ledger),
    fxRate: Number(i.fx_rate || 1), receivedAt: i.received_at,
    status: i.status, statusReason: i.status_reason || null, statusHistory: safeHistory(i.status_history),
    createdAt: i.created_at, updatedAt: i.updated_at,
    track: publicTrack(i, { accountId, phone, forAdmin: !!forAdmin }),
    receiptUrl: ['credited', 'held_in_vault'].includes(i.status) ? receiptUrl('incoming', i.id) : null
  };
  if (forAdmin) {
    out.payerEmail = i.payer_email || null;
    out.internalNote = i.internal_note || null;
    out.noteSharedWithBuyer = !!i.note_shared_with_buyer;
    out.proofUrl = i.proof_url || null;
  }
  return out;
}

module.exports = {
  CURRENCIES, CRYPTO_ASSETS, FX_TO_USD, round2, fxRate, convertCurrency,
  refFor, signReceipt, verifyReceiptSig, receiptUrl, safeHistory,
  publicSellerAccount, publicDeposit, publicWithdrawal, publicIncoming
};
