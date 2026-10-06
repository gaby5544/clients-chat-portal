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
  const accountId = group.seller_account_id || '';
  const holder = group.seller_full_name || group.name;
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${isIncoming ? 'Incoming funds' : 'Withdrawal'} receipt ${ref}`, Author: 'Transaction Account' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ref}-receipt.pdf"`);
  doc.pipe(res);
  const PW = doc.page.width;
  const GOLD = '#b8924a';

  // ---- Masthead ----
  doc.rect(0, 0, PW, 132).fill(NAVY);
  doc.rect(0, 0, PW, 5).fill(GOLD);
  // shield mark (vector — no image files needed)
  doc.save().translate(50, 34);
  doc.path('M22 0 L44 8 L44 26 C44 40 34 50 22 56 C10 50 0 40 0 26 L0 8 Z').fill(GOLD);
  doc.path('M22 7 L38 13 L38 26 C38 36 31 43 22 48 C13 43 6 36 6 26 L6 13 Z').fill(NAVY);
  doc.path('M13 27 L20 34 L32 19').lineWidth(3.2).lineCap('round').lineJoin('round').strokeColor(GOLD).stroke();
  doc.restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text('TRANSACTION ACCOUNT', 112, 36, { characterSpacing: 1.5 });
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10).text(isIncoming ? 'OFFICIAL RECEIPT  -  INCOMING FUNDS' : 'OFFICIAL RECEIPT  -  WITHDRAWAL', 112, 62, { characterSpacing: 1.2 });
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9).text(`Receipt no. ${ref}`, 112, 82);
  doc.text(`Issued ${fdate(new Date())}`, 112, 96);
  // status stamp
  const stamp = isIncoming ? (record.status === 'credited' ? 'CREDITED' : record.status === 'held_in_vault' ? 'IN VAULT' : 'REVERSED') : 'COMPLETED';
  doc.roundedRect(PW - 168, 40, 118, 34, 6).lineWidth(1.5).strokeColor(GOLD).stroke();
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(13).text(stamp, PW - 168, 51, { width: 118, align: 'center', characterSpacing: 1.5 });

  const L = 50; const R = 310; const W = 230; const FULL = 495;
  let y = 160;
  const heading = (t) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GOLD).text(t.toUpperCase(), L, y, { characterSpacing: 1.6 });
    doc.moveTo(L, y + 15).lineTo(L + FULL, y + 15).strokeColor(BORDER).lineWidth(1).stroke();
    y += 26;
  };

  // ---- Account holder (always shows the Account ID) ----
  heading('Account holder');
  y = flowRow(doc, y, [
    { x: L, w: W, label: 'Account name', value: holder },
    { x: R, w: W, label: 'Account ID', value: accountId || '—' }
  ]);
  y = flowRow(doc, y, [
    { x: L, w: W, label: 'Account type', value: group.seller_account_type || 'Standard account' },
    { x: R, w: W, label: 'Account currency', value: group.seller_currency }
  ]);
  y += 6;

  if (isIncoming) {
    heading('Payment details');
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Received from', value: record.payerName }, { x: R, w: W, label: 'Payer country', value: record.payerCountry }]);
    if (record.payerCompany) y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Company', value: record.payerCompany }]);
    y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Payment for', value: record.purpose }]);
    const methodText = `${METHOD_LABEL[record.method] || record.method}${record.asset ? ` - ${record.asset}${record.network ? ` (${record.network})` : ''}` : ''}`;
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Payment method', value: methodText }, { x: R, w: W, label: 'Date received', value: fdate(record.receivedAt) }]);
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Order / invoice reference', value: record.orderRef }, { x: R, w: W, label: 'Bank reference / transaction hash', value: record.externalRef }]);
    y += 4;
    const converted = record.amountCurrency !== group.seller_currency;
    const boxH = converted ? 92 : 70;
    doc.roundedRect(L, y, FULL, boxH, 8).fillColor('#faf6ee').fill();
    doc.roundedRect(L, y, FULL, boxH, 8).strokeColor(GOLD).lineWidth(1.2).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_MUTED).text('AMOUNT RECEIVED', L + 22, y + 15, { characterSpacing: 1.2 });
    doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY).text(money(record.amount, record.amountCurrency), L + 22, y + 30);
    if (converted) doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(`Credited to your ${group.seller_currency} account as ${money(record.amountLedger, group.seller_currency)} (indicative rate ${Number(record.fxRate).toFixed(4)} at the time of recording).`, L + 22, y + 64, { width: FULL - 44 });
    y += boxH + 22;
    // The confirmation line the escrow review ends with — carries the matched Account ID.
    heading('Escrow confirmation');
    const steps = ['Payment confirmed', 'Funds confirmed by escrow', `Funds transferred to the seller account ${accountId}`, record.status === 'credited' ? 'Funds credited to the seller' : 'Funds held in the seller vault account'];
    steps.forEach((t) => {
      doc.circle(L + 5, y + 6, 5).fillColor(GOLD).fill();
      doc.path(`M${L + 2.6} ${y + 6} L${L + 4.6} ${y + 8.2} L${L + 8} ${y + 3.6}`).lineWidth(1.4).strokeColor('#ffffff').stroke();
      doc.font('Helvetica').fontSize(10.5).fillColor(TEXT_MAIN).text(t, L + 20, y);
      y += 19;
    });
  } else {
    heading('Withdrawal details');
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Requested on', value: fdate(record.createdAt) }, { x: R, w: W, label: 'Completed on', value: fdate(record.updatedAt) }]);
    const isCrypto = record.method === 'crypto';
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Method', value: isCrypto ? `Cryptocurrency - ${record.asset}${record.network ? ` (${record.network})` : ''}` : 'Bank transfer' }, { x: R, w: W, label: 'Status', value: 'Completed' }]);
    if (isCrypto) y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Destination wallet', value: record.destination }]);
    else {
      y = flowRow(doc, y, [{ x: L, w: W, label: 'Beneficiary', value: record.beneficiaryName }, { x: R, w: W, label: 'Bank', value: `${record.bankName || ''}${record.bankCountry ? `, ${record.bankCountry}` : ''}` }]);
      y = flowRow(doc, y, [{ x: L, w: W, label: 'Account / IBAN', value: maskTail(record.bankAccount) }, { x: R, w: W, label: 'SWIFT / Sort code', value: record.bankSwift }]);
    }
    if (record.statusReason) y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Payout note / reference', value: record.statusReason }]);
    y += 4;
    const converted = record.amountCurrency !== group.seller_currency;
    const boxH = converted ? 92 : 70;
    doc.roundedRect(L, y, FULL, boxH, 8).fillColor('#faf6ee').fill();
    doc.roundedRect(L, y, FULL, boxH, 8).strokeColor(GOLD).lineWidth(1.2).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_MUTED).text('AMOUNT SENT', L + 22, y + 15, { characterSpacing: 1.2 });
    doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY).text(money(record.amount, record.amountCurrency), L + 22, y + 30);
    if (converted) doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(`Debited from your ${group.seller_currency} account as ${money(record.amountLedger, group.seller_currency)}.`, L + 22, y + 64, { width: FULL - 44 });
    y += boxH + 8;
  }

  // ---- Footer: authenticity fingerprint ----
  const fp = crypto.createHash('sha256').update(`${ref}|${accountId}|${record.amount}|${record.amountCurrency}|${record.updatedAt || ''}`).digest('hex').slice(0, 20).toUpperCase().replace(/(.{5})/g, '$1-').slice(0, -1);
  const footerY = doc.page.height - 78;
  doc.moveTo(L, footerY).lineTo(L + FULL, footerY).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(`Authenticity code  ${fp}`, L, footerY + 10, { characterSpacing: 0.6 });
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(`Account ID ${accountId || '—'}  -  Quote the receipt number and authenticity code to your Desk Officer to verify this document. Generated automatically from the Transaction Account ledger; it contains no internal notes.`, L, footerY + 24, { width: FULL });
  doc.end();
}

module.exports.generateFundsReceiptPdf = generateFundsReceiptPdf;
