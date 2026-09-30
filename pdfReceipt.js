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
  const isIncoming = kind === 'incoming';
  const ref = record.ref;
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ref}-receipt.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 110).fill(NAVY);
  doc.rect(0, 0, doc.page.width, 4).fillColor(CYAN).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('TRANSACTION ACCOUNT', 50, 32);
  doc.fillColor(CYAN).font('Helvetica-Bold').fontSize(11).text(isIncoming ? 'INCOMING FUNDS RECEIPT' : 'WITHDRAWAL RECEIPT', 50, 58);
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9).text(`Reference: ${ref}  •  Account: ${group.seller_full_name || group.name}`, 50, 76);
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9).text(`Issued: ${fdate(new Date())}`, 50, 90);

  const L = 50; const R = 310; const W = 230;
  let y = 140;
  const heading = (t) => { doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_MAIN).text(t, L, y); y += 24; };
  const rule = () => { doc.moveTo(L, y).lineTo(545, y).strokeColor(BORDER).lineWidth(1).stroke(); y += 18; };

  if (isIncoming) {
    heading('Payment Details');
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Received from', value: record.payerName }, { x: R, w: W, label: 'Payer country', value: record.payerCountry }]);
    y = flowRow(doc, y, [{ x: L, w: 495, label: 'Payment for', value: record.purpose }]);
    rule();
    heading('Transfer Information');
    const methodText = `${METHOD_LABEL[record.method] || record.method}${record.asset ? ` — ${record.asset}${record.network ? ` (${record.network})` : ''}` : ''}`;
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Payment method', value: methodText }, { x: R, w: W, label: 'Date received', value: fdate(record.receivedAt) }]);
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Bank reference / transaction hash', value: record.externalRef }, { x: R, w: W, label: 'Status', value: record.status === 'credited' ? 'Received & credited' : record.status === 'held_in_vault' ? 'Received — held in vault' : 'Reversed' }]);
    rule();
    const converted = record.amountCurrency !== group.seller_currency;
    y += 4;
    doc.roundedRect(L, y, 495, converted ? 78 : 56, 8).fillColor('#f0f9ff').fill();
    doc.roundedRect(L, y, 495, converted ? 78 : 56, 8).strokeColor(CYAN).lineWidth(1.5).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_MUTED).text('AMOUNT RECEIVED', L + 20, y + 14);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(VIOLET).text(money(record.amount, record.amountCurrency), L + 20, y + 28);
    if (converted) {
      doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(`Credited to your ${group.seller_currency} account as ${money(record.amountLedger, group.seller_currency)} (indicative rate ${record.fxRate.toFixed(4)} at time of recording).`, L + 20, y + 56, { width: 455 });
    }
  } else {
    heading('Withdrawal Details');
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Requested on', value: fdate(record.createdAt) }, { x: R, w: W, label: 'Completed on', value: fdate(record.updatedAt) }]);
    const isCrypto = record.method === 'crypto';
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Method', value: isCrypto ? `Cryptocurrency — ${record.asset}${record.network ? ` (${record.network})` : ''}` : 'Bank transfer' }, { x: R, w: W, label: 'Status', value: 'Completed' }]);
    if (isCrypto) {
      y = flowRow(doc, y, [{ x: L, w: 495, label: 'Destination wallet', value: record.destination }]);
    } else {
      y = flowRow(doc, y, [{ x: L, w: W, label: 'Beneficiary', value: record.beneficiaryName }, { x: R, w: W, label: 'Bank', value: `${record.bankName || ''}${record.bankCountry ? `, ${record.bankCountry}` : ''}` }]);
      y = flowRow(doc, y, [{ x: L, w: W, label: 'Account / IBAN', value: maskTail(record.bankAccount) }, { x: R, w: W, label: 'SWIFT / Sort code', value: record.bankSwift }]);
    }
    if (record.statusReason) y = flowRow(doc, y, [{ x: L, w: 495, label: 'Payout note / reference', value: record.statusReason }]);
    rule();
    const converted = record.amountCurrency !== group.seller_currency;
    y += 4;
    doc.roundedRect(L, y, 495, converted ? 78 : 56, 8).fillColor('#f0f9ff').fill();
    doc.roundedRect(L, y, 495, converted ? 78 : 56, 8).strokeColor(CYAN).lineWidth(1.5).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_MUTED).text('AMOUNT SENT', L + 20, y + 14);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(VIOLET).text(money(record.amount, record.amountCurrency), L + 20, y + 28);
    if (converted) doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(`Debited from your ${group.seller_currency} account as ${money(record.amountLedger, group.seller_currency)}.`, L + 20, y + 56, { width: 455 });
  }

  const footerY = doc.page.height - 60;
  doc.moveTo(L, footerY).lineTo(545, footerY).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED)
    .text('This receipt was generated automatically from your Transaction Account ledger. Reference numbers can be quoted to your Desk Officer at any time.', L, footerY + 10, { width: 495 });
  doc.end();
}

module.exports.generateFundsReceiptPdf = generateFundsReceiptPdf;
