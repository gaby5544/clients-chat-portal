// Renders every email the system sends into HTML files you can open in a browser.
//   node scripts/preview-emails.js [outputDir] [lang]
require('module');
const fs = require('fs'); const path = require('path');
const out = process.argv[2] || path.join(__dirname, '..', 'email-previews'); const lang = process.argv[3] || 'en';
fs.mkdirSync(out, { recursive: true });
const TPL = require('../emailTemplate');
process.env.APP_URL = process.env.APP_URL || 'https://desk.usvistra.com';
// Capture instead of sending: fake the transport by intercepting renderEmail through sendTemplated.
const captured = []; const origRender = TPL.renderEmail;
TPL.renderEmail = async (parts, l) => { const m = await origRender(parts, l); captured.push({ parts, ...m }); return m; };
const E = require('../email'); process.env.NODE_ENV = 'development';
const log = console.log; console.log = () => {};
(async () => {
  const g = 'Gold Bullion — Lot 17';
  await E.notifyRegistrationCode('a@b.com', { code: '482916', groupName: g, lang });
  await E.notifyPasswordResetCode('a@b.com', { code: '715204', groupName: g, lang });
  await E.notifyWithdrawalCode('a@b.com', { code: '093827', amountText: '$1,250,000.00', accountId: '15963475226', destination: 'GCB Bank', lang });
  await E.notifyAccountCreated('a@b.com', { groupName: g, accountId: '15963475226', fullName: 'Kwame Mensah', lang });
  await E.notifyAccountAccess('a@b.com', { groupName: g, accountId: '15963475226', disabled: true, reason: 'Compliance review in progress', lang });
  await E.notifyAccountAccess('a@b.com', { groupName: g, accountId: '15963475226', disabled: false, lang });
  await E.notifyKycStatus('a@b.com', { groupName: g, status: 'verified', lang });
  await E.notifyKycStatus('a@b.com', { groupName: g, status: 'rejected', reason: 'The ID expired on 2020-01-01. Please upload a valid, unexpired document.', lang });
  await E.notifyIncomingFunds('a@b.com', { groupName: g, amountText: '$2,000,000.00', payerName: 'ACME Corp', purpose: 'Invoice 42', status: 'held_in_vault', lang });
  await E.notifyIncomingFunds('a@b.com', { groupName: g, amountText: '$2,000,000.00', payerName: 'ACME Corp', purpose: 'Invoice 42', status: 'released', lang });
  await E.notifyWithdrawalStatus('a@b.com', { groupName: g, amount: '1,250,000.00', currency: 'USD', status: 'processing', lang });
  await E.notifyWithdrawalStatus('a@b.com', { groupName: g, amount: '1,250,000.00', currency: 'USD', status: 'declined', reason: 'Beneficiary name does not match the account holder.', lang });
  await E.notifyBusinessStatus('a@b.com', { groupName: g, status: 'verified', lang });
  await E.notifyOfflineMessage('a@b.com', { fromName: 'Desk Officer', groupName: g, text: 'Good afternoon — the vault release for your payment is scheduled for tomorrow morning.', lang });
  await E.notifyMessageReminder('a@b.com', { groupName: g, count: 3, lang });
  console.log = log;
  const names = ['01-registration-code', '02-password-reset', '03-withdrawal-code', '04-account-created', '05-account-disabled', '06-account-enabled', '07-kyc-verified', '08-kyc-rejected', '09-funds-in-vault', '10-funds-released', '11-withdrawal-processing', '12-withdrawal-declined', '13-business-approved', '14-new-message', '15-message-reminder'];
  captured.forEach((c, i) => { fs.writeFileSync(path.join(out, `${names[i]}.html`), c.html); fs.writeFileSync(path.join(out, `${names[i]}.txt`), c.text); });
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Vistra email previews</title><body style="font-family:Arial;background:#111;color:#eee;padding:30px"><h2>Vistra email previews (${lang})</h2><ul>${captured.map((c, i) => `<li style="margin:6px 0"><a style="color:#d4af37" href="${names[i]}.html">${names[i]}</a> — ${c.subject.replace(/</g, '&lt;')}</li>`).join('')}</ul></body>`);
  log(`wrote ${captured.length} previews to ${out}`); process.exit(0);
})();
