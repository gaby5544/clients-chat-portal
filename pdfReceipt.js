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
  const n = Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// Plain-text-safe country (Helvetica cannot draw flag emoji).
function asciiSafe(t) { return String(t == null ? '' : t).replace(/[^\x20-\x7E -ÿ–—•…€]/g, ''); }

const STAGE_TITLES = ['Payment received', 'Payer verification', 'Authenticity review', 'Payment confirmed', 'Funds in seller vault account'];

function generateFundsReceiptPdf(res, { kind, record, group, raw }) {
  const isIncoming = kind === 'incoming';
  const ref = record.ref;
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${isIncoming ? 'Incoming funds' : 'Withdrawal'} receipt ${ref}`, Author: 'Quantum Secure Transaction Desk' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ref}-receipt.pdf"`);
  doc.pipe(res);

  const W_PAGE = doc.page.width; const L = 50; const R = 310; const W = 230; const FULL = 495;
  const accountId = group.seller_account_id || record.targetAccountId || record.sellerAccountId || '';
  const holder = asciiSafe(String(group.seller_full_name || group.name).replace(/&#x2F;/g, '/').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));

  // ---- Header ----
  doc.rect(0, 0, W_PAGE, 132).fill(NAVY);
  doc.rect(0, 0, W_PAGE, 5).fillColor(CYAN).fill();
  doc.rect(W_PAGE * 0.55, 0, W_PAGE * 0.45, 5).fillColor(VIOLET).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text('QUANTUM SECURE', L, 30, { characterSpacing: 1.5 });
  doc.fillColor('#ffffff').font('Helvetica').fontSize(11).text('TRANSACTION DESK', L, 53, { characterSpacing: 3 });
  doc.fillColor(CYAN).font('Helvetica-Bold').fontSize(10).text(isIncoming ? 'OFFICIAL RECEIPT — INCOMING FUNDS' : 'OFFICIAL RECEIPT — WITHDRAWAL', L, 88, { characterSpacing: 1 });
  doc.fillColor('#9aa5b8').font('Helvetica').fontSize(9).text(`Reference ${ref}   •   Issued ${fdate(new Date())}`, L, 106);
  // seal
  const cx = W_PAGE - 90; const cy = 66;
  doc.circle(cx, cy, 36).lineWidth(1.5).strokeColor(CYAN).stroke();
  doc.circle(cx, cy, 31).lineWidth(0.6).strokeColor('#4b5a73').stroke();
  doc.fillColor(CYAN).font('Helvetica-Bold').fontSize(8).text('VERIFIED', cx - 36, cy - 12, { width: 72, align: 'center', characterSpacing: 1.5 });
  doc.fillColor('#ffffff').font('Helvetica').fontSize(7).text(isIncoming ? 'ESCROW' : 'PAYOUT', cx - 36, cy + 1, { width: 72, align: 'center', characterSpacing: 1 });
  doc.fillColor('#9aa5b8').fontSize(7).text('SETTLED', cx - 36, cy + 11, { width: 72, align: 'center', characterSpacing: 1 });

  let y = 156;
  const ensure = (h) => { if (y + h > doc.page.height - 80) { doc.addPage(); y = 50; } };
  const heading = (t) => { ensure(60); doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT_MAIN).text(t, L, y); doc.moveTo(L, y + 18).lineTo(L + 40, y + 18).strokeColor(CYAN).lineWidth(2).stroke(); y += 28; };
  const rule = () => { doc.moveTo(L, y).lineTo(545, y).strokeColor(BORDER).lineWidth(1).stroke(); y += 18; };

  // ---- Amount card ----
  const converted = record.amountCurrency !== group.seller_currency;
  const cardH = converted ? 92 : 72;
  doc.roundedRect(L, y, FULL, cardH, 10).fillColor('#f0f9ff').fill();
  doc.roundedRect(L, y, FULL, cardH, 10).strokeColor(CYAN).lineWidth(1.2).stroke();
  doc.rect(L, y + 10, 4, cardH - 20).fillColor(VIOLET).fill();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_MUTED).text(isIncoming ? 'AMOUNT RECEIVED & CREDITED' : 'AMOUNT PAID OUT', L + 22, y + 14, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(26).fillColor(VIOLET).text(money(record.amount, record.amountCurrency), L + 22, y + 28);
  if (converted) {
    doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text(`${isIncoming ? 'Credited to' : 'Debited from'} your ${group.seller_currency} account as ${money(record.amountLedger, group.seller_currency)} (indicative rate ${Number(record.fxRate || 1).toFixed(4)}).`, L + 22, y + 65, { width: 440 });
  }
  y += cardH + 22;

  // ---- Account ----
  heading('Account');
  y = flowRow(doc, y, [{ x: L, w: W, label: 'Account holder', value: holder }, { x: R, w: W, label: 'Account ID', value: accountId }]);
  y = flowRow(doc, y, [{ x: L, w: W, label: 'Account type', value: group.seller_account_type || 'Standard account' }, { x: R, w: W, label: 'Account currency', value: group.seller_currency }]);
  rule();

  if (isIncoming) {
    heading('Payment');
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Received from', value: asciiSafe(record.payerName) }, { x: R, w: W, label: 'Payer country', value: asciiSafe(record.payerCountry) }]);
    y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Payment for', value: asciiSafe(record.purpose) }]);
    const methodText = `${METHOD_LABEL[record.method] || record.method}${record.asset ? ` — ${record.asset}${record.network ? ` (${record.network})` : ''}` : ''}`;
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Payment method', value: methodText }, { x: R, w: W, label: 'Date received', value: fdate(record.receivedAt) }]);
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Bank reference / transaction hash', value: record.externalRef }, { x: R, w: W, label: 'Invoice / order reference', value: record.invoiceRef }]);
    if (record.sharedNote) y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Note from the Desk', value: asciiSafe(record.sharedNote) }]);
    rule();

    // Escrow review trail
    heading('Escrow review trail');
    const times = (raw && Array.isArray(raw.review_stage_times)) ? raw.review_stage_times : [];
    const reviewed = raw && raw.review_mode && raw.review_mode !== 'none';
    if (reviewed) {
      STAGE_TITLES.forEach((t, i) => {
        ensure(34);
        const when = times.find((x) => Number(x.stage) === i + 1);
        doc.circle(L + 8, y + 8, 7).fillColor('#10b981').fill();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('✓', L + 4.2, y + 4.6, { lineBreak: false });
        if (i < 4) doc.moveTo(L + 8, y + 16).lineTo(L + 8, y + 32).strokeColor('#a7f3d0').lineWidth(1.5).stroke();
        doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_MAIN).text(`${i + 1}. ${t}`, L + 26, y, { continued: false });
        let sub = when ? `Passed ${fdate(when.at)}` : 'Passed';
        if (i === 3) sub = `Funds confirmed by escrow • Funds transferred to the seller account ${accountId}${when ? ` • ${fdate(when.at)}` : ''}`;
        if (i === 4) sub = `Funds credited to the seller${record.statusHistory && record.statusHistory.length ? ` • ${fdate(record.statusHistory[record.statusHistory.length - 1].at)}` : ''}`;
        doc.font('Helvetica').fontSize(8.5).fillColor(TEXT_MUTED).text(sub, L + 26, y + 13, { width: 460 });
        y += 34;
      });
      y += 4;
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(TEXT_MAIN).text(`Funds credited directly to the seller account ${accountId}.`, L, y, { width: FULL });
      y += 28;
    }
    rule();
    heading('Settlement');
    const last = (record.statusHistory || []).slice(-1)[0];
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Status', value: record.status === 'credited' ? 'Credited to the seller account' : record.status }, { x: R, w: W, label: 'Credited on', value: fdate(last && last.at) }]);
    y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Funds transferred to the seller account', value: accountId }]);
  } else {
    heading('Withdrawal');
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Requested on', value: fdate(record.createdAt) }, { x: R, w: W, label: 'Completed on', value: fdate(record.updatedAt) }]);
    const isCrypto = record.method === 'crypto';
    y = flowRow(doc, y, [{ x: L, w: W, label: 'Method', value: isCrypto ? `Cryptocurrency — ${record.asset}${record.network ? ` (${record.network})` : ''}` : 'Bank transfer' }, { x: R, w: W, label: 'Status', value: 'Completed' }]);
    if (isCrypto) {
      y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Destination wallet', value: record.destination }]);
    } else {
      y = flowRow(doc, y, [{ x: L, w: W, label: 'Beneficiary', value: asciiSafe(record.beneficiaryName) }, { x: R, w: W, label: 'Bank', value: asciiSafe(`${record.bankName || ''}${record.bankCountry ? `, ${record.bankCountry}` : ''}`) }]);
      y = flowRow(doc, y, [{ x: L, w: W, label: 'Account / IBAN', value: maskTail(record.bankAccount) }, { x: R, w: W, label: 'SWIFT / Sort code', value: record.bankSwift }]);
    }
    if (record.payoutReference) y = flowRow(doc, y, [{ x: L, w: FULL, label: isCrypto ? 'Transaction hash (TXID)' : 'Bank payout reference', value: record.payoutReference }]);
    if (record.statusReason) y = flowRow(doc, y, [{ x: L, w: FULL, label: 'Note', value: asciiSafe(record.statusReason) }]);
  }

  // ---- Footer on every page ----
  const pages = doc.bufferedPageRange ? null : null;
  const footerY = doc.page.height - 62;
  doc.moveTo(L, footerY).lineTo(545, footerY).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED)
    .text('This receipt was generated automatically from your Transaction Account ledger and is valid without a signature. Quote the reference above in any correspondence. Queries: complaints@usvistra.com', L, footerY + 10, { width: FULL });
  doc.end();
}

module.exports.generateFundsReceiptPdf = generateFundsReceiptPdf;
