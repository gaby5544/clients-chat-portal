// Shared money/ledger helpers for the seller Transaction Account.
// Everything that shapes data leaving the server for a seller or an admin
// lives here, so the two sides can never drift apart and internal-only fields
// (admin notes, proof files, admin session tokens) are stripped in one place.

const crypto = require('crypto');
const ER = require('./escrowReview');
const CD = require('./public/countries');

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

// ---- Universal money display: $2,000,000.00 / £1,250.50 / €9,999.99 (full grouping, 2 decimals) ----
const CCY_SYMBOL = { USD: '$', GBP: '\u00a3', EUR: '\u20ac' };
function fmtMoney(amount, ccy) {
  const n = Number(amount || 0);
  const body = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return CCY_SYMBOL[ccy] ? `${CCY_SYMBOL[ccy]}${body}` : `${body} ${ccy || ''}`.trim();
}

// ---- Withdrawal statuses: pending | processing | declined | completed (legacy values are mapped) ----
const WD_STATUSES = ['pending', 'processing', 'declined', 'completed'];
const WD_LABEL = { pending: 'Pending', processing: 'Processing', declined: 'Declined', completed: 'Completed' };
function normWdStatus(st) {
  if (st === 'rejected' || st === 'failed') return 'declined';
  if (st === 'held_in_vault') return 'pending';
  return WD_STATUSES.includes(st) ? st : 'pending';
}
const INCOMING_LABEL = { in_review: 'Under escrow review', credited: 'Credited', held_in_vault: 'Held in vault', reversed: 'Reversed' };

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
// ---- Private files (KYC documents, business documents, proof of payment) ----
// Stored as /uploads/p_<random>.<ext>. They are NEVER served from a bare URL: every link that leaves the server
// (only to the owning seller or to an admin) carries an HMAC signature and an expiry.
const PRIVATE_RE = /^\/uploads\/p_[A-Za-z0-9._-]+$/;
const signPrivateFile = (name, exp) => crypto.createHmac('sha256', RECEIPT_SECRET).update(`file:${name}:${exp}`).digest('hex').slice(0, 40);
function signFileUrl(url, ttlSec = 6 * 3600) {
  if (typeof url !== 'string' || !PRIVATE_RE.test(url)) return url || null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${url}?exp=${exp}&sig=${signPrivateFile(url.slice('/uploads/'.length), exp)}`;
}
function verifyFileSig(name, exp, sig) {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000 || typeof sig !== 'string' || sig.length !== 40) return false;
  const a = Buffer.from(signPrivateFile(name, e)); const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
function dateOnly(v) {
  return v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null;
}
function plainName(v) { return v == null ? v : String(v).replace(/&#x2F;/g, '/').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

function publicSellerAccount(g, forAdmin) {
  const country = CD.find(plainName(g.seller_country));
  const out = {
    groupId: g.id,
    groupName: g.name,
    registered: g.seller_registered,
    fullName: plainName(g.seller_full_name) || null,
    email: g.email_b || null,
    phone: g.seller_phone || null,
    accountId: g.seller_account_id || null,
    accountType: g.seller_account_type || 'Standard account',
    language: g.seller_language || 'en',
    currency: g.seller_currency || null,
    currencyLocked: !!g.currency_locked_at,
    dateOfBirth: dateOnly(g.seller_date_of_birth),
    country: plainName(g.seller_country) || null,
    countryCode: country ? country.c : null,
    countryFlag: country ? CD.flagEmoji(country.c) : null,
    registeredAt: g.seller_registered_at || null,
    onboardingChoice: g.seller_onboarding_choice || null,
    disabled: !!g.seller_disabled,
    disabledReason: g.seller_disabled ? (g.seller_disabled_reason || null) : null,
    disbursementEnabled: !!g.disbursement_enabled,
    disbursementUpdatedAt: g.disbursement_updated_at || null,
    cryptoDepositVerified: !!g.crypto_deposit_verified,
    business: {
      status: g.business_status || 'none',
      rejectionReason: g.business_status === 'rejected' ? (g.business_rejection_reason || null) : null,
      submittedAt: g.business_submitted_at || null
    },
    kyc: {
      status: g.kyc_status,
      docType: g.kyc_doc_type || null,
      idFrontUrl: signFileUrl(g.kyc_id_front_url),
      idBackUrl: signFileUrl(g.kyc_id_back_url),
      proofAddressUrl: signFileUrl(g.kyc_proof_address_url),
      proofAddressType: g.kyc_proof_address_type || null,
      selfieUrl: signFileUrl(g.kyc_selfie_url),
      submittedAt: g.kyc_submitted_at || null,
      reviewedAt: g.kyc_reviewed_at || null,
      rejectionReason: g.kyc_rejection_reason || null,
      attempts: Number(g.kyc_attempts || 0)
    },
    balances: {
      available: Number(g.balance_available || 0),
      held: Number(g.balance_held || 0),
      totalDeposited: Number(g.total_deposited || 0)
    }
  };
  if (forAdmin) {
    out.termsAcceptedAt = g.seller_terms_accepted_at || null;
    out.termsVersion = g.seller_terms_version || null;
    out.registrationIp = g.seller_registration_ip || null;
    out.lastIp = g.seller_last_ip || null;
    out.ipLog = Array.isArray(g.seller_ip_log) ? g.seller_ip_log.slice(-30).reverse() : [];
    out.blockedIps = Array.isArray(g.seller_blocked_ips) ? g.seller_blocked_ips : [];
    out.kyc.idNumber = g.kyc_id_number || null;
    out.kyc.idName = g.kyc_id_name || null;
    out.kyc.idDob = dateOnly(g.kyc_id_dob);
    out.kyc.idExpiry = dateOnly(g.kyc_id_expiry);
    out.kyc.idCountry = g.kyc_id_country || null;
    out.business.data = g.business_data ? { ...g.business_data, registrationDocUrl: signFileUrl(g.business_data.registrationDocUrl), taxDocUrl: signFileUrl(g.business_data.taxDocUrl), addressDocUrl: signFileUrl(g.business_data.addressDocUrl) } : null;
    out.cryptoOverrideBy = g.crypto_override_by ? 'Desk Officer' : null;
  } else {
    // The seller sees their own ID number only in masked form.
    out.kyc.idNumber = g.kyc_id_number ? String(g.kyc_id_number).replace(/.(?=.{3})/g, '\u2022') : null;
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

function publicWithdrawal(w, forAdmin) {
  const status = normWdStatus(w.status);
  const out = {
    id: w.id, ref: refFor('withdrawal', w.id), groupId: w.group_id, method: w.method, asset: w.asset, network: w.network,
    destination: w.destination, beneficiaryName: w.beneficiary_name, bankName: w.bank_name,
    bankAccount: w.bank_account, bankSwift: w.bank_swift, bankCountry: w.bank_country,
    amount: Number(w.amount), amountCurrency: w.amount_currency, amountLedger: Number(w.amount_ledger),
    status, statusLabel: WD_LABEL[status], statusReason: w.status_reason,
    statusHistory: safeHistory(w.status_history).map((h) => ({ ...h, status: normWdStatus(h.status), statusLabel: WD_LABEL[normWdStatus(h.status)] })),
    payoutReference: w.payout_reference || null, sellerAccountId: w.seller_account_id || null,
    createdAt: w.created_at, updatedAt: w.updated_at,
    receiptUrl: status === 'completed' ? receiptUrl('withdrawal', w.id) : null
  };
  if (forAdmin) out.requestIp = w.request_ip || null;
  return out;
}

// Incoming funds recorded by the Desk. Sellers get everything about the payment
// itself plus the escrow review in its SAFE form (no timers, ever); only admins
// additionally get the internal note, the proof file, the payer's contact
// details, who recorded it and the full review console state.
function publicIncoming(i, forAdmin, nowMs) {
  const accountId = i.target_account_id || null;
  const out = {
    id: i.id, ref: refFor('incoming', i.id), groupId: i.group_id,
    payerName: i.payer_name, payerCountry: i.payer_country || null, payerType: i.payer_type || null, purpose: i.purpose,
    method: i.method, asset: i.asset || null, network: i.network || null, externalRef: i.external_ref || null,
    invoiceRef: i.invoice_ref || null, targetAccountId: accountId,
    amount: Number(i.amount), amountCurrency: i.amount_currency, amountLedger: Number(i.amount_ledger),
    fxRate: Number(i.fx_rate || 1), receivedAt: i.received_at,
    status: i.status, statusLabel: INCOMING_LABEL[i.status] || i.status, statusReason: i.status_reason || null,
    statusHistory: safeHistory(i.status_history),
    sharedNote: i.note_shared && i.internal_note ? i.internal_note : null,
    createdAt: i.created_at, updatedAt: i.updated_at,
    receiptUrl: i.status === 'credited' ? receiptUrl('incoming', i.id) : null,
    review: forAdmin ? ER.adminView(i, accountId, nowMs) : ER.sellerView(i, accountId, nowMs)
  };
  if (forAdmin) {
    out.payerEmail = i.payer_email || null;
    out.payerPhone = i.payer_phone || null;
    out.payerBank = i.payer_bank || null;
    out.walletAddress = i.wallet_address || null;
    out.internalNote = i.internal_note || null;
    out.noteShared = !!i.note_shared;
    out.proofUrl = signFileUrl(i.proof_url);
  }
  return out;
}

module.exports = {
  CURRENCIES, CRYPTO_ASSETS, FX_TO_USD, round2, fxRate, convertCurrency, fmtMoney, CCY_SYMBOL, WD_STATUSES, WD_LABEL, INCOMING_LABEL, normWdStatus, plainName,
  refFor, signReceipt, verifyReceiptSig, receiptUrl, safeHistory, signFileUrl, verifyFileSig,
  publicSellerAccount, publicDeposit, publicWithdrawal, publicIncoming
};
