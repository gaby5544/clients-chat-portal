// Generates a polished, branded PDF receipt for a single transaction
// submission. Pure-JS (pdfkit), no native dependencies, streams directly
// to an HTTP response.

const PDFDocument = require('pdfkit');

const NAVY = '#0d1119';
const CYAN = '#38bdf8';
const VIOLET = '#8b5cf6';
const TEXT_MAIN = '#1a1f2b';
const TEXT_MUTED = '#5b6577';
const BORDER = '#e2e8f0';

function field(doc, x, y, width, label, value) {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_MUTED)
    .text(label.toUpperCase(), x, y, { width, characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(11).fillColor(TEXT_MAIN)
    .text(value && String(value).trim() ? value : '—', x, y + 13, { width });
}

function generateTransactionPdf(res, tx, groupName) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="transaction-receipt-${tx.id}.pdf"`);
  doc.pipe(res);

  // ---- Header band ----
  doc.rect(0, 0, doc.page.width, 110).fill(NAVY);
  doc.save();
  doc.rect(0, 0, doc.page.width, 4)
    .fillColor(CYAN).fill();
  doc.restore();

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text('QUANTUM SECURE TRANSACTION DESK', 50, 32);
  doc.fillColor(CYAN).font('Helvetica-Bold').fontSize(11)
    .text('OFFICIAL TRANSACTION RECEIPT', 50, 58);
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9)
    .text(`Group: ${groupName}  •  Receipt ID: ${tx.id}`, 50, 76);
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9)
    .text(`Issued: ${new Date(tx.submitted_at).toLocaleString()}`, 50, 90);

  let y = 140;
  const leftX = 50;
  const rightX = 310;
  const colWidth = 230;
  const rowGap = 42;

  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_MAIN)
    .text('Party Information', leftX, y);
  y += 22;
  field(doc, leftX, y, colWidth, 'Full Legal Name', tx.full_legal_name);
  field(doc, rightX, y, colWidth, 'Country / Region', tx.country);
  y += rowGap;
  field(doc, leftX, y, colWidth, 'Transaction Role', tx.role);
  field(doc, rightX, y, colWidth, 'Submitted By', tx.submitted_by);
  y += rowGap + 8;

  doc.moveTo(leftX, y).lineTo(545, y).strokeColor(BORDER).lineWidth(1).stroke();
  y += 20;

  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_MAIN)
    .text('Asset Details', leftX, y);
  y += 22;
  field(doc, leftX, y, colWidth, 'Asset / Item Type', tx.asset_type);
  field(doc, rightX, y, colWidth, 'Quantity / Amount', tx.quantity);
  y += rowGap;
  field(doc, leftX, y, 490, 'Asset Description', tx.asset_description);
  y += rowGap + 8;

  doc.moveTo(leftX, y).lineTo(545, y).strokeColor(BORDER).lineWidth(1).stroke();
  y += 20;

  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_MAIN)
    .text('Payment Terms', leftX, y);
  y += 22;
  field(doc, leftX, y, colWidth, 'Agreed Unit Price', tx.unit_price);
  field(doc, rightX, y, colWidth, 'Total Transaction Value', `${tx.total_value || ''} ${tx.payment_currency || ''}`.trim());
  y += rowGap;
  field(doc, leftX, y, colWidth, 'Payment Method', tx.payment_method);
  field(doc, rightX, y, colWidth, 'Payment Terms', tx.payment_terms);
  y += rowGap;
  field(doc, leftX, y, 490, 'Additional Notes', tx.notes);
  y += rowGap + 20;

  // ---- Highlighted total value banner ----
  doc.roundedRect(leftX, y, 495, 56, 8).fillColor('#f0f9ff').fill();
  doc.roundedRect(leftX, y, 495, 56, 8).strokeColor(CYAN).lineWidth(1.5).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_MUTED)
    .text('TOTAL TRANSACTION VALUE', leftX + 20, y + 14);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(VIOLET)
    .text(`${tx.total_value || 'N/A'} ${tx.payment_currency || ''}`.trim(), leftX + 20, y + 28);

  // ---- Footer ----
  const footerY = doc.page.height - 60;
  doc.moveTo(leftX, footerY).lineTo(545, footerY).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED)
    .text('This receipt was generated automatically by Quantum Secure Transaction Desk and reflects the information as submitted. It does not constitute a binding contract on its own.', leftX, footerY + 10, { width: 495 });

  doc.end();
}

module.exports = { generateTransactionPdf };

// ---------------------------------------------------------------------------
// Receipts for the seller Transaction Account: incoming funds and completed
// withdrawals. Deliberately excludes every admin-only field (internal notes,
// proof files, admin identities).
// ---------------------------------------------------------------------------
const SYMBOL = { USD: '$', GBP: '£', EUR: '€' };
function money(amount, ccy) {
  const n = Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return SYMBOL[ccy] ? `${SYMBOL[ccy]}${n}` : `${n} ${ccy || ''}`.trim();
}
const METHOD_LABEL = { bank_transfer: 'Bank transfer', wire: 'Wire transfer (SWIFT)', crypto: 'Cryptocurrency', card: 'Card payment', cheque: 'Cheque', cash: 'Cash', other: 'Other', bank: 'Bank transfer' };
function maskTail(str) {
  const s = String(str || '');
  return s.length <= 4 ? s : `${'•'.repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}`;
}
function fdate(d) { return d ? new Date(d).toUTCString().replace(' GMT', ' UTC') : '—'; }

// Lays out a row of label/value columns, each as tall as its own text, and
// returns the y where the next row should start — long purposes never collide.
function flowRow(doc, y, cols) {
  let tallest = 0;
  cols.forEach((c) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_MUTED).text(c.label.toUpperCase(), c.x, y, { width: c.w, characterSpacing: 0.5 });
    const val = c.value && String(c.value).trim() ? String(c.value) : '—';
    doc.font('Helvetica').fontSize(11).fillColor(TEXT_MAIN).text(val, c.x, y + 13, { width: c.w });
    const h = 13 + doc.heightOfString(val, { width: c.w }) + 12;
    if (h > tallest) tallest = h;
  });
  return y + tallest;
}

function generateFundsReceiptPdf(res, { kind, record, group }) {
  const crypto = require('crypto');
  const isIncoming = kind === 'incoming';
  const ref = record.ref;
  const accountId = group.seller_account_id || '—';
  const holder = (group.seller_full_name || group.name || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const ccy = group.seller_currency;
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${ref} — Receipt`, Author: 'Quantum Secure Transaction Desk', Subject: `Receipt for Account ${accountId}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ref}-receipt.pdf"`);
  doc.pipe(res);

  const PW = doc.page.width; const PH = doc.page.height; const L = 48; const CW = PW - 96;
  const GOLD = '#c9a44c'; const INK = '#0b1020'; const PAPER = '#f7f8fb'; const GREEN = '#0f9d6b'; const AMBER = '#c58a12'; const RED = '#c0392b';

  // ---- Statement of status ----
  let statusText; let statusColor;
  if (isIncoming) {
    if (record.status === 'credited') { statusText = 'RECEIVED & CREDITED'; statusColor = GREEN; }
    else if (record.status === 'held_in_vault') { statusText = 'RECEIVED · HELD IN VAULT'; statusColor = AMBER; }
    else { statusText = 'REVERSED'; statusColor = RED; }
  } else { statusText = 'COMPLETED'; statusColor = GREEN; }

  // ---- Header ----
  doc.rect(0, 0, PW, 132).fill(INK);
  doc.rect(0, 0, PW, 5).fill(GOLD);
  doc.rect(0, 132, PW, 2).fill(GOLD);
  doc.circle(L + 16, 52, 16).lineWidth(1.5).strokeColor(GOLD).stroke();
  doc.font('Helvetica-Bold').fontSize(15).fillColor(GOLD).text('Q', L + 11, 44);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text('QUANTUM SECURE', L + 44, 36, { characterSpacing: 1.5 });
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9).text('TRANSACTION DESK  ·  FUNDS & SETTLEMENT', L + 44, 56, { characterSpacing: 1.2 });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(isIncoming ? 'PAYMENT RECEIPT' : 'WITHDRAWAL RECEIPT', L, 86, { characterSpacing: 1 });
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9).text(`Issued ${fdate(new Date())}`, L, 114);
  // status stamp
  const stW = doc.widthOfString(statusText) + 34;
  doc.roundedRect(PW - L - stW, 44, stW, 26, 13).fill(statusColor);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(statusText, PW - L - stW, 53, { width: stW, align: 'center', characterSpacing: 0.8 });

  // ---- Account holder strip ----
  let y = 156;
  doc.roundedRect(L, y, CW, 70, 8).fill(PAPER);
  doc.roundedRect(L, y, CW, 70, 8).lineWidth(0.8).strokeColor(BORDER).stroke();
  const cell = (x, w, label, value, big) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TEXT_MUTED).text(label.toUpperCase(), x, y + 14, { width: w, characterSpacing: 0.6 });
    doc.font(big ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 15 : 11).fillColor(big ? INK : TEXT_MAIN).text(value || '—', x, y + 29, { width: w, lineBreak: false, ellipsis: true });
  };
  cell(L + 18, 170, 'Account holder', holder);
  cell(L + 200, 150, 'Account ID', accountId, true);
  cell(L + 372, CW - 390, 'Receipt reference', ref);
  y += 90;

  // ---- Amount hero ----
  const converted = record.amountCurrency !== ccy;
  const heroH = converted ? 96 : 78;
  doc.roundedRect(L, y, CW, heroH, 10).fill(INK);
  doc.roundedRect(L, y, 6, heroH, 3).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#9aa5b8').text(isIncoming ? 'AMOUNT RECEIVED' : 'AMOUNT WITHDRAWN', L + 26, y + 16, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff').text(money(record.amount, record.amountCurrency), L + 26, y + 31, { lineBreak: false });
  if (isIncoming && record.feeAmount > 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#9aa5b8').text(`Fee ${money(record.feeAmount, record.amountCurrency)}  ·  Net ${money(record.amount - record.feeAmount, record.amountCurrency)}`, L + 26, y + 66, { lineBreak: false });
  }
  if (converted) {
    doc.font('Helvetica').fontSize(9).fillColor(GOLD).text(`${isIncoming ? 'Credited' : 'Debited'} to your ${ccy} account as ${money(record.amountLedger, ccy)}  (indicative rate ${Number(record.fxRate || 1).toFixed(4)})`, L + 26, y + heroH - 22, { width: CW - 52 });
  }
  y += heroH + 22;

  const heading = (title) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD).text(title.toUpperCase(), L, y, { characterSpacing: 1.4 });
    doc.moveTo(L, y + 14).lineTo(PW - L, y + 14).lineWidth(0.8).strokeColor(BORDER).stroke();
    y += 24;
  };
  const W2 = (CW - 24) / 2; const R2 = L + W2 + 24;

  if (isIncoming) {
    heading('Payment details');
    y = flowRow(doc, y, [{ x: L, w: W2, label: 'Received from', value: record.payerName }, { x: R2, w: W2, label: 'Payer country', value: record.payerCountry }]);
    y = flowRow(doc, y, [{ x: L, w: CW, label: 'Payment for', value: record.purpose }]);
    heading('Transfer information');
    const methodText = `${METHOD_LABEL[record.method] || record.method}${record.asset ? ` — ${record.asset}${record.network ? ` (${record.network})` : ''}` : ''}`;
    y = flowRow(doc, y, [{ x: L, w: W2, label: 'Payment method', value: methodText }, { x: R2, w: W2, label: 'Date received', value: fdate(record.receivedAt) }]);
    if (record.method !== 'crypto' && (record.bankName || record.senderAccount)) {
      y = flowRow(doc, y, [{ x: L, w: W2, label: 'Sending bank', value: record.bankName }, { x: R2, w: W2, label: 'Sender account', value: record.senderAccount ? maskTail(record.senderAccount) : '' }]);
    }
    y = flowRow(doc, y, [{ x: L, w: CW, label: record.method === 'crypto' ? 'Transaction hash' : 'Bank reference', value: record.externalRef }]);
    if (record.receivedInto) {
      y = flowRow(doc, y, [{ x: L, w: W2, label: 'Credited to', value: record.receivedInto.label }, { x: R2, w: W2, label: record.receivedInto.idKind === 'accountNumber' ? (record.receivedInto.currency === 'EUR' ? 'IBAN' : 'Account number') : 'Account ID', value: record.receivedInto.idKind === 'accountNumber' ? '\u2022\u2022' + record.receivedInto.ending : record.receivedInto.accountId }]);
    }
    if (record.status === 'held_in_vault') {
      y += 2;
      doc.roundedRect(L, y, CW, 38, 6).fill('#fff7e6');
      doc.font('Helvetica').fontSize(9).fillColor('#7a5a10').text('These funds have been received and are held in your vault account while they pass the Desk\'s verification stages. They are released to your available balance automatically when the final stage completes.', L + 14, y + 8, { width: CW - 28 });
      y += 50;
    }
  } else {
    heading('Withdrawal details');
    y = flowRow(doc, y, [{ x: L, w: W2, label: 'Requested on', value: fdate(record.createdAt) }, { x: R2, w: W2, label: 'Completed on', value: fdate(record.updatedAt) }]);
    const isCrypto = record.method === 'crypto';
    y = flowRow(doc, y, [{ x: L, w: W2, label: 'Method', value: isCrypto ? `Cryptocurrency — ${record.asset}${record.network ? ` (${record.network})` : ''}` : 'Bank transfer' }, { x: R2, w: W2, label: 'Status', value: 'Completed' }]);
    heading('Destination');
    if (isCrypto) {
      y = flowRow(doc, y, [{ x: L, w: CW, label: 'Destination wallet', value: record.destination }]);
    } else {
      y = flowRow(doc, y, [{ x: L, w: W2, label: 'Beneficiary', value: record.beneficiaryName }, { x: R2, w: W2, label: 'Bank', value: `${record.bankName || ''}${record.bankCountry ? `, ${record.bankCountry}` : ''}` }]);
      y = flowRow(doc, y, [{ x: L, w: W2, label: 'Account / IBAN', value: maskTail(record.bankAccount) }, { x: R2, w: W2, label: 'SWIFT / sort code', value: record.bankSwift }]);
    }
    if (record.statusReason) y = flowRow(doc, y, [{ x: L, w: CW, label: 'Payout note / reference', value: record.statusReason }]);
  }

  // ---- Integrity block ----
  const fingerprint = crypto.createHash('sha256').update([ref, accountId, record.amount, record.amountCurrency, record.receivedAt || record.createdAt || ''].join('|')).digest('hex').slice(0, 16).toUpperCase().replace(/(.{4})/g, '$1 ').trim();
  const by = PH - 118;
  doc.roundedRect(L, by, CW, 40, 6).fill(PAPER);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TEXT_MUTED).text('DOCUMENT FINGERPRINT', L + 14, by + 9, { characterSpacing: 0.8 });
  doc.font('Courier-Bold').fontSize(11).fillColor(INK).text(fingerprint, L + 14, by + 21);
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(`Account ${accountId}`, PW - L - 200, by + 16, { width: 186, align: 'right' });

  const fy = PH - 62;
  doc.moveTo(L, fy).lineTo(PW - L, fy).lineWidth(0.8).strokeColor(BORDER).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED).text(
    `This receipt was generated automatically from the ledger of Transaction Account ${accountId}. Quote the reference ${ref} and your Account ID when contacting the Desk. Questions or complaints: ${process.env.COMPLAINTS_EMAIL || 'complaints@usvistra.com'}. This document is not a bank statement and is valid only with a matching fingerprint on the Desk's records.`,
    L, fy + 9, { width: CW, align: 'left' });
  doc.end();
}

module.exports.generateFundsReceiptPdf = generateFundsReceiptPdf;

// ---------------------------------------------------------------------------
// v3.21 Statement of Account: every payment in and out of one seller's Transaction Account for a period, with the reconciled
// balances. Built only from the seller's own ledger (never admin notes, proofs or internal fields).
// ---------------------------------------------------------------------------
const ST_STATUS = {
  credited: 'Credited', held_in_vault: 'Held in vault', reversed: 'Reversed',
  completed: 'Completed', pending: 'In progress', processing: 'In progress', awaiting_email_confirmation: 'In progress', approved: 'In progress', rejected: 'Declined', failed: 'Failed', cancelled: 'Cancelled'
};
const ST_RANGES = { '30': 30, '90': 90, '180': 180, '365': 365 };
/** Which period a request means: ?range=30|90|180|365|all, or ?from=YYYY-MM-DD&to=YYYY-MM-DD. @returns {{from:Date|null,to:Date,label:string}} */
function statementPeriod(q = {}, now = new Date()) {
  const to = new Date(now); const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(String(q.from || '')) || iso.test(String(q.to || ''))) {
    const f = iso.test(String(q.from || '')) ? new Date(`${q.from}T00:00:00Z`) : null; const t = iso.test(String(q.to || '')) ? new Date(`${q.to}T23:59:59Z`) : to;
    if ((f && isNaN(f)) || isNaN(t)) return statementPeriod({}, now);
    const d = (x) => x.toISOString().slice(0, 10);
    return { from: f, to: t > to ? to : t, label: `${f ? d(f) : 'Account opening'} to ${d(t > to ? to : t)}` };
  }
  const days = ST_RANGES[String(q.range || '')];
  if (days) { const from = new Date(to.getTime() - days * 86400000); return { from, to, label: `Last ${days} days (${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)})` }; }
  return { from: null, to, label: `All activity to ${to.toISOString().slice(0, 10)}` };
}
/** The statement lines for a period, oldest first, plus totals (only money that actually moved or is in progress is counted). */
function statementLines({ incoming = [], withdrawals = [], ledger = {}, period }) {
  const inRange = (d) => { const t = new Date(d).getTime(); return Number.isFinite(t) && (!period.from || t >= period.from.getTime()) && t <= period.to.getTime(); };
  const lines = [];
  for (const i of incoming) { const when = i.receivedAt || i.createdAt; if (!inRange(when)) continue;
    lines.push({ at: when, ref: i.ref, desc: `Payment received from ${i.payerName || 'payer'}${i.purpose ? ` — ${i.purpose}` : ''}`, status: i.status, credit: Number(i.amountLedger || 0), debit: 0, counted: ['credited', 'held_in_vault'].includes(i.status) }); }
  for (const w of withdrawals) { const when = w.createdAt; if (!inRange(when)) continue;
    const dest = w.method === 'crypto' ? `${w.asset || 'Crypto'}${w.network ? ` (${w.network})` : ''}` : `${w.beneficiaryName || 'Bank transfer'}${w.bankName ? `, ${w.bankName}` : ''}`;
    lines.push({ at: when, ref: w.ref, desc: `${w.method === 'crypto' ? 'Crypto withdrawal' : 'Bank transfer'} to ${dest}`, status: w.status, credit: 0, debit: Number(w.amountLedger || 0), counted: ['completed', 'pending', 'processing', 'awaiting_email_confirmation', 'approved'].includes(w.status) }); }
  for (const f of (ledger.feeItems || [])) { if (!inRange(f.date)) continue; lines.push({ at: f.date, ref: f.ref || 'FEE', desc: f.title || 'Fee', status: 'completed', credit: 0, debit: Number(f.amount || 0), counted: true, fee: true }); }
  lines.sort((a, b) => new Date(a.at) - new Date(b.at));
  const sum = (arr, k) => Math.round(arr.reduce((a, l) => a + (l.counted ? l[k] : 0), 0) * 100) / 100;
  return { lines, moneyIn: sum(lines, 'credit'), moneyOut: sum(lines, 'debit') };
}

function generateStatementPdf(res, { group, snapshot, receiving, period, now = new Date() }) {
  const crypto = require('crypto');
  const account = snapshot.account, ledger = account.ledger || {};
  const ccy = group.seller_currency || ledger.currency || 'USD';
  const accountId = group.seller_account_id || '—';
  const holder = (group.seller_full_name || group.name || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const { lines, moneyIn, moneyOut } = statementLines({ incoming: snapshot.incoming, withdrawals: snapshot.withdrawals, ledger, period });
  const ref = `ST-${String(group.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}-${now.toISOString().slice(0, 10).replace(/-/g, '')}`;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `${ref} — Statement of Account`, Author: 'Quantum Secure Transaction Desk', Subject: `Statement of Account ${accountId}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ref}-statement.pdf"`);
  doc.pipe(res);
  const PW = doc.page.width, PH = doc.page.height, L = 48, CW = PW - 96;
  const GOLD = '#c9a44c', INK = '#0b1020', PAPER = '#f7f8fb', GREEN = '#0f9d6b', RED = '#c0392b';
  const header = (first) => {
    doc.rect(0, 0, PW, first ? 132 : 56).fill(INK); doc.rect(0, 0, PW, 5).fill(GOLD); doc.rect(0, first ? 132 : 56, PW, 2).fill(GOLD);
    doc.circle(L + 16, first ? 52 : 30, 14).lineWidth(1.4).strokeColor(GOLD).stroke();
    doc.font('Helvetica-Bold').fontSize(13).fillColor(GOLD).text('Q', L + 11.5, first ? 45 : 23);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(first ? 15 : 12).text('QUANTUM SECURE', L + 42, first ? 36 : 18, { characterSpacing: 1.5 });
    doc.fillColor('#9aa5b8').font('Helvetica').fontSize(first ? 9 : 8).text('TRANSACTION DESK  ·  FUNDS & SETTLEMENT', L + 42, first ? 56 : 35, { characterSpacing: 1.2 });
    if (first) {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('STATEMENT OF ACCOUNT', L, 86, { characterSpacing: 1 });
      doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9).text(`Issued ${fdate(now)}  ·  ${period.label}`, L, 114);
    } else { doc.fillColor('#9aa5b8').font('Helvetica').fontSize(8).text(`${ref}  ·  Account ${accountId}`, PW - L - 260, 30, { width: 260, align: 'right' }); }
  };
  header(true);
  let y = 156;
  doc.roundedRect(L, y, CW, 70, 8).fill(PAPER); doc.roundedRect(L, y, CW, 70, 8).lineWidth(0.8).strokeColor(BORDER).stroke();
  const cell = (x, w, label, value, big) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TEXT_MUTED).text(label.toUpperCase(), x, y + 14, { width: w, characterSpacing: 0.6 });
    doc.font(big ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 15 : 11).fillColor(big ? INK : TEXT_MAIN).text(value || '—', x, y + 29, { width: w, lineBreak: false, ellipsis: true });
  };
  cell(L + 18, 170, 'Account holder', holder); cell(L + 200, 150, 'Account ID', accountId, true); cell(L + 372, CW - 390, 'Statement reference', ref);
  y += 84;
  if (receiving && receiving.ready) { doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(`Receiving account: ${receiving.bankName || 'Bank'} ••${receiving.ending || ''}  ·  Currency: ${ccy}`, L, y, { width: CW }); y += 18; }
  else { doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(`Currency: ${ccy}`, L, y, { width: CW }); y += 18; }

  // balances (as at the moment the statement was issued)
  const boxW = (CW - 36) / 4; const boxes = [['Money in (all time)', ledger.moneyIn, INK], ['Money out (all time)', ledger.moneyOut, INK], ['Held in vault', ledger.held, '#c58a12'], ['Available balance', ledger.available, GREEN]];
  boxes.forEach((b, k) => { const x = L + k * (boxW + 12); doc.roundedRect(x, y, boxW, 58, 8).fill(INK); doc.roundedRect(x, y, 4, 58, 2).fill(GOLD);
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#9aa5b8').text(b[0].toUpperCase(), x + 14, y + 11, { width: boxW - 20, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff').text(money(b[1] || 0, ccy), x + 14, y + 29, { width: boxW - 20, lineBreak: false, ellipsis: true }); });
  y += 76;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD).text('ACTIVITY IN THIS PERIOD', L, y, { characterSpacing: 1.4 });
  doc.font('Helvetica').fontSize(8.5).fillColor(TEXT_MUTED).text(`In ${money(moneyIn, ccy)}  ·  Out ${money(moneyOut, ccy)}  ·  ${lines.length} transaction${lines.length === 1 ? '' : 's'}`, L, y, { width: CW, align: 'right' });
  doc.moveTo(L, y + 14).lineTo(PW - L, y + 14).lineWidth(0.8).strokeColor(BORDER).stroke(); y += 24;

  const cols = { date: L, ref: L + 78, desc: L + 150, status: L + 318, inn: L + 388, out: L + 450 }; const cw = { date: 72, ref: 68, desc: 160, status: 66, inn: 58, out: CW - 402 };
  const head = () => { doc.rect(L, y - 4, CW, 18).fill(PAPER);
    [['DATE', 'date', 'left'], ['REFERENCE', 'ref', 'left'], ['DESCRIPTION', 'desc', 'left'], ['STATUS', 'status', 'left'], ['MONEY IN', 'inn', 'right'], ['MONEY OUT', 'out', 'right']].forEach(([t, k, al]) => doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_MUTED).text(t, cols[k], y + 1, { width: cw[k], align: al, characterSpacing: 0.5 })); y += 20; };
  head();
  if (!lines.length) { doc.font('Helvetica').fontSize(10).fillColor(TEXT_MUTED).text('No transactions in this period.', L, y + 6, { width: CW, align: 'center' }); y += 40; }
  lines.forEach((ln, idx) => {
    const d = ln.desc.length > 120 ? `${ln.desc.slice(0, 117)}…` : ln.desc; doc.font('Helvetica').fontSize(8.5);
    const h = Math.max(16, doc.heightOfString(d, { width: cw.desc }) + 8);
    if (y + h > PH - 130) { doc.addPage(); header(false); y = 76; head(); }
    if (idx % 2 === 0) doc.rect(L, y - 3, CW, h).fill('#fbfcfe');
    const muted = !ln.counted; const col = muted ? '#9aa5b8' : TEXT_MAIN;
    doc.font('Helvetica').fontSize(8.5).fillColor(col);
    doc.text(new Date(ln.at).toISOString().slice(0, 10), cols.date, y, { width: cw.date });
    doc.font('Courier').fontSize(7.5).text(ln.ref || '—', cols.ref, y + 0.5, { width: cw.ref, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(8.5).text(d, cols.desc, y, { width: cw.desc });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(muted ? RED : ln.status === 'held_in_vault' ? '#c58a12' : GREEN).text((ST_STATUS[ln.status] || ln.status || '').toUpperCase(), cols.status, y + 0.5, { width: cw.status, characterSpacing: 0.3 });
    doc.font('Helvetica').fontSize(8.5).fillColor(muted ? '#9aa5b8' : GREEN).text(ln.credit ? money(ln.credit, ccy) : '', cols.inn, y, { width: cw.inn, align: 'right' });
    doc.fillColor(muted ? '#9aa5b8' : TEXT_MAIN).text(ln.debit ? money(ln.debit, ccy) : '', cols.out, y, { width: cw.out, align: 'right' });
    y += h;
  });
  y += 10;
  if (y > PH - 175) { doc.addPage(); header(false); y = 76; }
  doc.moveTo(L, y).lineTo(PW - L, y).lineWidth(0.8).strokeColor(BORDER).stroke(); y += 10;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Period totals', L, y); doc.text(`In ${money(moneyIn, ccy)}   ·   Out ${money(moneyOut, ccy)}`, L, y, { width: CW, align: 'right' }); y += 16;
  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED).text('Declined, failed and reversed items are shown greyed and are not counted. Balances above are as at the time this statement was issued and reconcile as: money in − money out = available balance.', L, y, { width: CW });

  const fingerprint = crypto.createHash('sha256').update([ref, accountId, ledger.moneyIn, ledger.moneyOut, ledger.available, lines.length, period.label].join('|')).digest('hex').slice(0, 16).toUpperCase().replace(/(.{4})/g, '$1 ').trim();
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const by = PH - 118; doc.roundedRect(L, by, CW, 40, 6).fill(PAPER);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TEXT_MUTED).text('DOCUMENT FINGERPRINT', L + 14, by + 9, { characterSpacing: 0.8 });
    doc.font('Courier-Bold').fontSize(11).fillColor(INK).text(fingerprint, L + 14, by + 21);
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(`Page ${i + 1} of ${range.count}  ·  Account ${accountId}`, PW - L - 220, by + 16, { width: 206, align: 'right' });
    const fy = PH - 62; doc.moveTo(L, fy).lineTo(PW - L, fy).lineWidth(0.8).strokeColor(BORDER).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED).text(`This statement was generated automatically from the ledger of Transaction Account ${accountId}. Quote the reference ${ref} and your Account ID when contacting the Desk. Questions or complaints: ${process.env.COMPLAINTS_EMAIL || 'complaints@usvistra.com'}. Issued by the Quantum Secure Transaction Desk; valid only with a matching fingerprint on the Desk's records.`, L, fy + 9, { width: CW });
  }
  doc.end();
  return { lines: lines.length, moneyIn, moneyOut, ref };
}
module.exports.generateStatementPdf = generateStatementPdf;
module.exports.statementPeriod = statementPeriod;
module.exports.statementLines = statementLines;
