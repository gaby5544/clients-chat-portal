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
