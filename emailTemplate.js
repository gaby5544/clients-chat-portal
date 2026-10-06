// The Vistra email design — one template for every email the Transaction Desk sends.
// Based on the Vistra layout supplied by the client (burgundy + gold, VISTRA monogram header,
// "Sovereign Wealth & Trust Architecture", signature block and footer kept word-for-word) with
// the Quantum Secure Transaction Desk shown as a gold badge under the header and in the footer.
//
// render(spec, t, opts) -> { html, text }
//   spec = { eyebrow, title, greeting, paragraphs[], code, codeNote, facts[[label,value]],
//            status:{label,tone}, notice:{tone,text}, cta:{label,url}, quote, preheader, closing[] }
//   tone: 'success' | 'danger' | 'warn' | 'info' | 'gold'
//   t(s) translates a human sentence (identity when English); values (amounts, ids, codes) are never passed through it.

const { escapeHtml: esc } = require('./security');

const ORG = 'VISTRA';
const ORG_NAME = 'Vistra Fund Solutions';
const ORG_TAGLINE = 'Sovereign Wealth & Trust Architecture';
const ADDRESS = process.env.COMPANY_ADDRESS || 'Vistra New York, 156 W 56th. St. 3rd Floor, New York, NY 10019';

const TONES = {
  success: { fg: '#34d399', bg: '#10241d', line: '#1f6f55' },
  danger: { fg: '#f87171', bg: '#2a1214', line: '#7f2a30' },
  warn: { fg: '#d4af37', bg: '#2a2210', line: '#7a6425' },
  info: { fg: '#93c5fd', bg: '#101a2a', line: '#2d4a77' },
  gold: { fg: '#d4af37', bg: '#1d1417', line: '#7a6425' }
};
const SERIF = "'Times New Roman',Times,serif";   // single quotes: these sit inside style="..." attributes
const SANS = "'Helvetica Neue',Arial,sans-serif";

// Every human-readable string the template adds itself (so it can be translated in one batch).
const FIXED = {
  respectfully: 'Respectfully,',
  supportTitle: 'Client Support',
  supportBody: 'Account help, security codes, identity verification, deposits and withdrawals.',
  complaintsTitle: 'Complaints & Escalations',
  complaintsBody: 'Formal complaints, disputed decisions, account reviews and suspected unauthorised activity.',
  email: 'Email',
  address: 'Address',
  issued: 'Issued through the Quantum Secure Transaction Desk',
  confidential: 'This message is confidential and intended solely for the recipient. Unauthorized use or distribution is strictly prohibited. Vistra processes all communications and transactions under regulatory oversight.',
  rights: 'All rights reserved.',
  dearDefault: 'Dear Valued Client,',
  reference: 'Reference'
};
const FIXED_KEYS = Object.keys(FIXED);

function badge(desk) {
  return `<table border="0" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 0"><tr><td align="center" style="padding:7px 18px;border:1px solid #d4af37;border-radius:30px;background-color:#1a0e11">
<span style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#d4af37">&#9670;&nbsp; ${esc(desk)} &nbsp;&#9670;</span></td></tr></table>`;
}

function codeBlock(code, note) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:26px 0"><tr><td align="center" style="padding:26px 12px;background-color:#0d0608;border:1px solid #d4af37;border-radius:6px">
<div class="code" style="font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:700;letter-spacing:14px;color:#d4af37;text-indent:14px">${esc(code)}</div>
${note ? `<div style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;margin-top:12px">${esc(note)}</div>` : ''}
</td></tr></table>`;
}

function factsTable(facts) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-top:1px solid #3a2a1f">${facts.map(([k, v]) => `
<tr><td style="padding:12px 0;border-bottom:1px solid #2a1d20;font-family:${SANS};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#d4af37;width:38%;vertical-align:top">${esc(k)}</td>
<td style="padding:12px 0;border-bottom:1px solid #2a1d20;font-family:${SANS};font-size:14px;color:#ffffff;vertical-align:top;word-break:break-word">${esc(v)}</td></tr>`).join('')}</table>`;
}

function statusPill(status) {
  const c = TONES[status.tone] || TONES.gold;
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px"><tr><td style="padding:6px 16px;border:1px solid ${c.fg};border-radius:30px;background-color:${c.bg}">
<span style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${c.fg}">&#9679;&nbsp; ${esc(status.label)}</span></td></tr></table>`;
}

function noticeBox(n) {
  const c = TONES[n.tone] || TONES.warn;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="padding:16px 20px;background-color:${c.bg};border-left:3px solid ${c.fg};border-top:1px solid ${c.line};border-right:1px solid ${c.line};border-bottom:1px solid ${c.line};border-radius:4px;font-family:${SANS};font-size:13.5px;line-height:1.75;color:#e5e7eb">${esc(n.text).replace(/\n/g, '<br>')}</td></tr></table>`;
}

function quoteBox(q) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="padding:18px 22px;background-color:#0f080a;border-left:3px solid #d4af37;border-radius:4px;font-family:${SERIF};font-size:16px;line-height:1.8;font-style:italic;color:#fffdfa">&ldquo;${esc(q).replace(/\n/g, '<br>')}&rdquo;</td></tr></table>`;
}

function ctaButton(c) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:30px auto 8px"><tr><td align="center" bgcolor="#d4af37" style="border-radius:3px;background:linear-gradient(135deg,#e6c75a,#b8922b) #d4af37">
<a href="${esc(c.url)}" target="_blank" style="display:inline-block;padding:15px 38px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;text-decoration:none;color:#140b0d">${esc(c.label)}</a></td></tr></table>`;
}

function render(spec, t = (s) => s, opts = {}) {
  const T = Object.assign({}, FIXED, opts.fixed || {});
  const desk = opts.desk || 'Quantum Secure Transaction Desk';
  const supportEmail = opts.supportEmail || 'support@usvistra.com';
  const complaintsEmail = opts.complaintsEmail || 'complaints@usvistra.com';
  const year = new Date().getFullYear();
  const dir = opts.rtl ? 'rtl' : 'ltr';
  const align = opts.rtl ? 'right' : 'left';
  const paras = (spec.paragraphs || []).filter(Boolean);
  const greeting = spec.greeting === false ? '' : (spec.greeting || T.dearDefault);

  const bodyParts = [];
  if (spec.status) bodyParts.push(statusPill(spec.status));
  if (greeting) bodyParts.push(`<p style="margin:0 0 16px;font-family:${SERIF};font-size:17px;color:#fffdfa">${esc(greeting)}</p>`);
  if (paras[0]) bodyParts.push(`<p style="margin:0 0 16px">${esc(paras[0]).replace(/\n/g, '<br>')}</p>`);
  if (spec.quote) bodyParts.push(quoteBox(spec.quote));
  if (spec.code) bodyParts.push(codeBlock(spec.code, spec.codeNote));
  if (spec.facts && spec.facts.length) bodyParts.push(factsTable(spec.facts));
  paras.slice(1).forEach((p) => bodyParts.push(`<p style="margin:0 0 16px">${esc(p).replace(/\n/g, '<br>')}</p>`));
  if (spec.notice) bodyParts.push(noticeBox(spec.notice));
  if (spec.cta && spec.cta.url) bodyParts.push(ctaButton(spec.cta));

  const html = `<!doctype html>
<html lang="${esc(opts.lang || 'en')}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${esc(spec.title)}</title>
<style>@media only screen and (max-width:640px){.card{width:100%!important}.pad{padding:34px 22px!important}.hdr{padding:36px 20px!important}.code{font-size:28px!important;letter-spacing:8px!important;text-indent:8px!important}.ttl{font-size:23px!important}}a{color:#d4af37}</style></head>
<body style="margin:0;padding:0;background-color:#050203">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#050203;font-size:1px;line-height:1px">${esc(spec.preheader || spec.title)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table width="100%" cellspacing="0" cellpadding="0" bgcolor="#050203" style="padding:48px 0;background:#050203;width:100%;table-layout:fixed"><tbody><tr><td align="center" style="padding:0 10px">
<table class="card" cellspacing="0" cellpadding="0" width="620" bgcolor="#140b0d" style="width:620px;max-width:620px;border-radius:4px;overflow:hidden;border:1px solid #3d3317;background:#140b0d"><tbody>

<tr style="background:#0d0608;border-bottom:2px solid #d4af37"><td class="hdr" align="center" bgcolor="#0d0608" style="padding:50px 40px 44px;background:linear-gradient(#1d0f12 0%,#0d0608 100%) #0d0608;border-bottom:2px solid #d4af37">
<table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto"><tbody>
<tr><td align="center"><table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 18px"><tbody><tr><td align="center" style="width:64px;height:64px;background:#150a0c;border-radius:50%;border:1px solid #d4af37">
<span style="font-family:${SERIF};font-size:30px;line-height:64px;letter-spacing:2px;font-weight:bold;color:#d4af37">V</span></td></tr></tbody></table></td></tr>
<tr><td align="center"><span style="font-family:${SERIF};font-size:28px;letter-spacing:7px;text-transform:uppercase;display:block;color:#ffffff">${ORG}</span></td></tr>
<tr><td align="center" style="padding-top:6px"><span style="font-family:${SANS};font-size:10px;font-weight:600;letter-spacing:6px;text-transform:uppercase;display:block;color:#d4af37">${esc(ORG_TAGLINE)}</span></td></tr>
</tbody></table>
${badge(desk)}
</td></tr>

<tr><td class="pad" align="${align}" bgcolor="#170d10" style="padding:52px 46px 40px;font-size:15px;line-height:1.9;font-family:${SANS};background-color:#170d10;color:#d1d5db;text-align:${align}">
${spec.eyebrow ? `<div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#d4af37;margin:0 0 12px">${esc(spec.eyebrow)}</div>` : ''}
<div class="ttl" style="font-family:${SERIF};font-size:27px;line-height:1.3;color:#ffffff;margin:0 0 6px">${esc(spec.title)}</div>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:14px 0 26px"><tr><td width="56" height="2" bgcolor="#d4af37" style="font-size:0;line-height:0;height:2px">&nbsp;</td></tr></table>
${bodyParts.join('\n')}
<p style="margin:34px 0 0;font-family:${SERIF};font-size:16px;color:#fffdfa;font-weight:600"><br>${esc(T.respectfully)}<br>
<span style="font-family:${SERIF};font-size:15px;letter-spacing:.5px;display:inline-block;margin-top:4px;font-weight:normal;color:#d4af37">Trading Support Coordinator</span><br>
<span style="font-family:${SERIF};font-size:16px;letter-spacing:1px;display:inline-block;margin-top:2px;color:#ffffff">${ORG_NAME}</span></p>
</td></tr>

<tr bgcolor="#0b0507" style="background-color:#0b0507;border-top:1px solid #3a2a1f"><td align="${align}" style="padding:36px 46px 34px;font-size:12px;line-height:1.7;font-family:${SANS};color:#9ca3af;background-color:#0b0507;border-top:1px solid #3a2a1f;text-align:${align}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td valign="top" width="50%" style="padding:0 14px 18px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:#9ca3af">
<b style="text-transform:uppercase;letter-spacing:1.5px;font-family:${SERIF};font-size:11px;color:#e5e7eb">${esc(T.supportTitle)}</b><br>
<span style="font-size:11.5px">${esc(T.supportBody)}</span><br>
<span style="display:inline-block;margin-top:6px">&#128231; ${esc(T.email)}: <a href="mailto:${esc(supportEmail)}" style="text-decoration:none;font-weight:600;color:#d4af37">${esc(supportEmail)}</a></span></td>
<td valign="top" width="50%" style="padding:0 0 18px 14px;border-${opts.rtl ? 'right' : 'left'}:1px solid #2a1d20;font-family:${SANS};font-size:12px;line-height:1.7;color:#9ca3af">
<b style="text-transform:uppercase;letter-spacing:1.5px;font-family:${SERIF};font-size:11px;color:#e5e7eb">${esc(T.complaintsTitle)}</b><br>
<span style="font-size:11.5px">${esc(T.complaintsBody)}</span><br>
<span style="display:inline-block;margin-top:6px">&#128231; ${esc(T.email)}: <a href="mailto:${esc(complaintsEmail)}" style="text-decoration:none;font-weight:600;color:#d4af37">${esc(complaintsEmail)}</a></span></td>
</tr></table>
<div style="margin-top:4px">&#127970; ${esc(T.address)}: ${esc(ADDRESS)}</div>
<hr style="border:none;border-top:1px solid #2a1d20;margin:20px 0">
<div style="font-size:10px;line-height:1.6;font-style:italic;color:#6b7280">${esc(T.confidential)}</div>
<div style="margin-top:12px;font-size:10px;letter-spacing:.5px;color:#6b7280">&copy; ${year} ${ORG_NAME}. ${esc(T.rights)}</div>
<div style="margin-top:6px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#7a6425">${esc(T.issued)}</div>
</td></tr>

</tbody></table></td></tr></tbody></table></body></html>`;

  // ---- plain-text twin (always sent alongside the HTML) ----
  const L = [];
  const rule = '='.repeat(56);
  L.push(rule, `${ORG}  |  ${ORG_TAGLINE}`, desk.toUpperCase(), rule, '');
  if (spec.eyebrow) L.push(spec.eyebrow.toUpperCase());
  L.push(spec.title, '');
  if (spec.status) L.push(`[ ${spec.status.label.toUpperCase()} ]`, '');
  if (greeting) L.push(greeting, '');
  if (paras[0]) L.push(paras[0], '');
  if (spec.quote) L.push(`"${spec.quote}"`, '');
  if (spec.code) L.push(`    ${spec.code}`, ...(spec.codeNote ? [`    (${spec.codeNote})`] : []), '');
  if (spec.facts && spec.facts.length) { spec.facts.forEach(([k, v]) => L.push(`${k}: ${v}`)); L.push(''); }
  paras.slice(1).forEach((p) => L.push(p, ''));
  if (spec.notice) L.push(`>> ${spec.notice.text}`, '');
  if (spec.cta && spec.cta.url) L.push(`${spec.cta.label}: ${spec.cta.url}`, '');
  L.push(T.respectfully, 'Trading Support Coordinator', ORG_NAME, '', '-'.repeat(56));
  L.push(`${T.supportTitle}: ${supportEmail}`, `  ${T.supportBody}`, `${T.complaintsTitle}: ${complaintsEmail}`, `  ${T.complaintsBody}`, `${T.address}: ${ADDRESS}`, '', T.issued, `(c) ${year} ${ORG_NAME}. ${T.rights}`);
  return { html, text: L.join('\n') };
}

module.exports = { render, FIXED, FIXED_KEYS, ORG, ORG_NAME, ORG_TAGLINE, ADDRESS };
