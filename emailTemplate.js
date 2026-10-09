// Vistra email template — the Desk's dark-burgundy / gold letterhead, as designed in the Vistra
// HTML you supplied, rebuilt as bullet-proof table markup (renders in Gmail, Outlook, Apple Mail,
// Zoho Mail and on phones) with a matching plain-text version for inbox-placement hygiene.
//
//   Brand lines kept EXACTLY:  VISTRA · Sovereign Wealth & Trust Architecture · Vistra Fund Solutions
//   Where "Quantum Secure Transaction Desk" appears:
//     1) the service bar directly under the letterhead (which desk is writing to you)
//     2) the signature, under "Vistra Fund Solutions"
//     3) the footer line "Issued by the Quantum Secure Transaction Desk, a service of Vistra Fund Solutions"
//   Support and Complaints are two separate contact cards, each with its own wording.

const BRAND = 'VISTRA';
const COMPANY = 'Vistra Fund Solutions';
const SERVICE = 'Quantum Secure Transaction Desk';
const TAGLINE = 'Sovereign Wealth & Trust Architecture';
const ADDRESS = 'Vistra New York, 156 W 56th. St. 3rd Floor, New York, NY 10019';
const CONFIDENTIALITY = 'This message is confidential and intended solely for the recipient. Unauthorized use or distribution is strictly prohibited. Vistra processes all communications and transactions under regulatory oversight.';
const supportEmail = () => process.env.SUPPORT_EMAIL || 'support@usvistra.com';
const complaintsEmail = () => process.env.COMPLAINTS_EMAIL || 'complaints@usvistra.com';
const appUrl = () => (process.env.APP_URL || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

const RTL = new Set(['ar', 'he', 'fa', 'ur']);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
/** Names are HTML-escaped when stored; undo that so the template can escape exactly once. */
const unesc = (s) => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

// ---- Static wording (translated for non-English recipients) ---------------------------------------
const STATIC = {
  respectfully: 'Respectfully,',
  supportTitle: 'Support',
  supportText: 'For help with your account, a verification code or a transaction, our Trading Support team is here for you.',
  complaintsTitle: 'Complaints & Escalations',
  complaintsText: 'To raise a formal complaint, dispute a decision or request a review of your account, write to our Complaints desk and quote your Account ID. Every complaint is logged, acknowledged and reviewed by a senior officer.',
  respTime: 'Typical response time:',
  issuedBy: 'Issued by the Quantum Secure Transaction Desk, a service of Vistra Fund Solutions.',
  security: 'Security notice',
  codeNote: 'Valid for 10 minutes · Single use',
  neverShare: 'Vistra will never ask you for this code by phone, email or chat. Do not share it with anyone.',
  disputeLead: 'Do you disagree with this decision?',
  disputeText: 'You have the right to ask for a review. Write to our Complaints desk, quote your Account ID and explain why you believe it should be reconsidered — a senior officer who was not involved in the original decision will examine your case.',
  rights: 'All rights reserved.'
};

// ---- Translation with protected terms -------------------------------------------------------------
const PROTECT = [
  /Vistra Fund Solutions|Quantum Secure Transaction Desk|Sovereign Wealth & Trust Architecture|VISTRA|Vistra/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /\b[A-Z]{2,}-[A-Z0-9-]{4,}\b/g,
  /[$£€]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,.]{2,}\b/g
];
async function localizeList(strings, lang) {
  if (!lang || lang === 'en') return strings.slice();
  let translateMany; try { ({ translateMany } = require('./translator')); } catch (e) { return strings.slice(); }
  const masked = strings.map((s) => { const keep = []; let out = String(s); for (const re of PROTECT) out = out.replace(re, (m) => { keep.push(m); return `\u27E6${keep.length}\u27E7`; }); return { out, keep }; });
  let res; try { res = await translateMany(masked.map((m) => m.out), lang); } catch (e) { return strings.slice(); }
  return strings.map((orig, i) => {
    const r = res[i]; if (!r || !r.ok) return orig;
    let t = r.text; const keep = masked[i].keep;
    for (let n = 1; n <= keep.length; n++) if ((t.match(new RegExp(`\\u27E6\\s*${n}\\s*\\u27E7`, 'g')) || []).length !== 1) return orig;
    return t.replace(/\u27E6\s*(\d+)\s*\u27E7/g, (_, n) => keep[n - 1] || '');
  });
}

// ---- Rendering ------------------------------------------------------------------------------------
const TONES = { success: ['#34d399', '#0f2a22'], warning: ['#f5c26b', '#2e2410'], danger: ['#fb7185', '#2f1218'], info: ['#d4af37', '#271d0c'] };
const SERIF = "'Times New Roman',Times,serif";
const SANS = "'Helvetica Neue',Arial,sans-serif";

/**
 * parts = {
 *   subject, preheader, eyebrow, title, name?, paragraphs: [..],
 *   badge?: { text, tone }, details?: [[label, value], ..], code?: '123456', quote?: 'text',
 *   notice?: 'text' | true (= standard "never share" notice), cta?: { label, url },
 *   dispute?: true  (adds the "disagree with this decision?" callout pointing to Complaints)
 * }
 */
function collectStrings(parts) {
  const S = {}; const add = (k, v) => { if (v) S[k] = v; };
  add('subject', parts.subject); add('preheader', parts.preheader); add('eyebrow', parts.eyebrow); add('title', parts.title);
  (parts.paragraphs || []).forEach((p, i) => add('p' + i, p));
  add('badge', parts.badge && parts.badge.text); (parts.details || []).forEach((d, i) => add('d' + i, d[0]));
  add('quote', parts.quote); if (typeof parts.notice === 'string') add('notice', parts.notice); if (parts.cta) add('cta', parts.cta.label); if (parts.cta2) add('cta2', parts.cta2.label);
  add('greeting', parts.name ? `Dear ${unesc(parts.name)},` : 'Dear Client,');
  Object.entries(STATIC).forEach(([k, v]) => add('s_' + k, v));
  return S;
}
async function renderEmail(parts, lang = 'en') {
  const S = collectStrings(parts); const keys = Object.keys(S); const outv = await localizeList(keys.map((k) => S[k]), lang);
  const T = {}; keys.forEach((k, i) => { T[k] = outv[i]; });
  return assemble(parts, T, lang);
}
/** English-only, synchronous — for legacy callers that expect a string straight away. */
function renderEmailSync(parts) { return assemble(parts, collectStrings(parts), 'en'); }

function assemble(parts, T, lang) {
  const year = new Date().getFullYear();
  const rtl = RTL.has(String(lang).split('-')[0]);
  const dir = rtl ? 'rtl' : 'ltr'; const align = rtl ? 'right' : 'left';

  const tr = (k, fallback) => (T[k] !== undefined ? T[k] : fallback);

  const support = supportEmail(), complaints = complaintsEmail(); const respTime = process.env.SUPPORT_RESPONSE_TIME;
  const url = parts.cta && (parts.cta.url || appUrl());

  // 2) HTML
  const gold = '#d4af37';
  const body = [];
  body.push(`<div style="font:600 11px ${SANS};letter-spacing:3px;text-transform:uppercase;color:${gold};margin:0 0 10px;">${esc(tr('eyebrow', parts.eyebrow || ''))}</div>`);
  body.push(`<div class="h1" style="font:400 26px/1.3 ${SERIF};color:#fffdfa;margin:0 0 14px;">${esc(tr('title', parts.title))}</div>`);
  body.push(`<div style="width:56px;height:2px;background:${gold};margin:0 0 26px;font-size:0;line-height:0;">&nbsp;</div>`);
  if (parts.badge) { const [c, bg] = TONES[parts.badge.tone] || TONES.info; body.push(`<div style="margin:0 0 22px;"><span style="display:inline-block;padding:6px 16px;border:1px solid ${c};background:${bg};color:${c};border-radius:30px;font:700 11px ${SANS};letter-spacing:2px;text-transform:uppercase;">${esc(tr('badge', parts.badge.text))}</span></div>`); }
  if (!parts.noGreeting) body.push(`<p style="margin:0 0 16px;font:500 15px/1.8 ${SANS};color:#fffdfa;">${esc(tr('greeting'))}</p>`);
  (parts.paragraphs || []).forEach((p, i) => body.push(`<p style="margin:0 0 16px;font:15px/1.85 ${SANS};color:#d1d5db;">${nl2br(tr('p' + i, p))}</p>`));
  if (parts.bodyHtml) body.push(parts.bodyHtml);
  if (parts.details && parts.details.length) {
    body.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;border-top:1px solid #2b2112;">${parts.details.map((d, i) => `<tr><td style="padding:12px 0;border-bottom:1px solid #2b2112;font:600 11px ${SANS};letter-spacing:2px;text-transform:uppercase;color:${gold};text-align:${align};width:42%;vertical-align:top;">${esc(tr('d' + i, d[0]))}</td><td style="padding:12px 0;border-bottom:1px solid #2b2112;font:500 15px ${SANS};color:#fffdfa;text-align:${rtl ? 'left' : 'right'};vertical-align:top;word-break:break-word;">${esc(d[1])}</td></tr>`).join('')}</table>`);
  }
  if (parts.quote) body.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 24px;"><tr><td style="border-${rtl ? 'right' : 'left'}:3px solid ${gold};background:#1b1114;padding:16px 20px;font:italic 15px/1.7 ${SERIF};color:#e5e7eb;text-align:${align};">${nl2br(tr('quote', parts.quote))}</td></tr></table>`);
  if (parts.code) body.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:10px 0 26px;"><tr><td align="center" bgcolor="#0d0608" style="background:#0d0608;border:1px solid ${gold};border-radius:4px;padding:26px 16px;"><div style="font:700 36px ui-monospace,Menlo,Consolas,'Courier New',monospace;letter-spacing:12px;color:#f5d77a;padding-left:12px;" dir="ltr">${esc(parts.code)}</div><div style="margin-top:10px;font:600 11px ${SANS};letter-spacing:2px;text-transform:uppercase;color:#9ca3af;">${esc(tr('s_codeNote'))}</div></td></tr></table>`);
  if (parts.notice) body.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;"><tr><td style="border-${rtl ? 'right' : 'left'}:3px solid ${gold};background:#1b1114;padding:16px 20px;font:13px/1.7 ${SANS};color:#d1d5db;text-align:${align};"><b style="color:#fffdfa;letter-spacing:1px;text-transform:uppercase;font-size:11px;">${esc(tr('s_security'))}</b><br>${esc(typeof parts.notice === 'string' ? tr('notice', parts.notice) : tr('s_neverShare'))}</td></tr></table>`);
  if (parts.cta && url) body.push(`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 26px;"><tr><td align="center" bgcolor="${gold}" style="background:${gold};border-radius:3px;"><a href="${esc(url)}" style="display:inline-block;padding:15px 38px;font:700 12px ${SANS};letter-spacing:2.5px;text-transform:uppercase;color:#140b0d;text-decoration:none;">${esc(tr('cta', parts.cta.label))}</a></td></tr></table>`);
  if (parts.cta2 && parts.cta2.url) body.push(`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:-10px 0 26px;"><tr><td align="center" style="border:1px solid ${gold};border-radius:3px;"><a href="${esc(parts.cta2.url)}" style="display:inline-block;padding:14px 36px;font:700 12px ${SANS};letter-spacing:2.5px;text-transform:uppercase;color:${gold};text-decoration:none;">${esc(tr('cta2', parts.cta2.label))}</a></td></tr></table>`);
  if (parts.dispute) body.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;"><tr><td style="border:1px solid #3d3218;background:#120a0c;padding:16px 20px;font:13px/1.7 ${SANS};color:#d1d5db;text-align:${align};"><b style="color:${gold};">${esc(tr('s_disputeLead'))}</b> ${esc(tr('s_disputeText'))}<br><a href="mailto:${esc(complaints)}" style="color:${gold};font-weight:600;text-decoration:none;">${esc(complaints)}</a></td></tr></table>`);
  // signature (exact wording from the Vistra template)
  body.push(`<p style="margin:34px 0 0;font:600 16px/1.7 ${SERIF};color:#fffdfa;">${esc(tr('s_respectfully'))}<br><span style="font:400 15px ${SERIF};letter-spacing:.5px;color:${gold};display:inline-block;margin-top:4px;">Trading Support Coordinator</span><br><span style="font:600 16px ${SERIF};letter-spacing:1px;color:#ffffff;display:inline-block;margin-top:2px;">${COMPANY}</span><br><span style="font:600 10px ${SANS};letter-spacing:3px;text-transform:uppercase;color:#9ca3af;display:inline-block;margin-top:6px;">${SERVICE}</span></p>`);

  const card = (title, text, mail, extra) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px;"><tr><td style="border-${rtl ? 'right' : 'left'}:2px solid ${gold};padding:2px 16px;text-align:${align};"><b style="font:700 11px ${SERIF};text-transform:uppercase;letter-spacing:1.5px;color:#e5e7eb;">${esc(title)}</b><div style="margin-top:6px;font:12px/1.7 ${SANS};color:#9ca3af;">${esc(text)}${extra ? ' ' + esc(extra) : ''}</div><div style="margin-top:6px;font:12px ${SANS};">📧 <a href="mailto:${esc(mail)}" style="color:${gold};font-weight:600;text-decoration:none;">${esc(mail)}</a></div></td></tr></table>`;
  const footer = `${card(tr('s_supportTitle'), tr('s_supportText'), support, respTime ? `${tr('s_respTime')} ${respTime}.` : '')}${card(tr('s_complaintsTitle'), tr('s_complaintsText'), complaints)}
    <div style="margin-top:6px;font:12px/1.7 ${SANS};color:#9ca3af;text-align:${align};">🏢 ${esc(ADDRESS)}</div><hr style="border:0;border-top:1px solid #2b2112;margin:20px 0;">
    <div style="font:italic 10px/1.6 ${SANS};color:#6b7280;text-align:${align};">${esc(tr('s_issuedBy'))}<br>${esc(CONFIDENTIALITY.replace(/Vistra processes/, 'Vistra processes'))}</div>
    <div style="margin-top:10px;font:10px ${SANS};letter-spacing:.5px;color:#6b7280;text-align:${align};">© ${year} ${COMPANY}. ${esc(tr('s_rights'))}</div>`;

  const html = `<!doctype html><html lang="${esc(lang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><style>@media only screen and (max-width:480px){.px{padding-left:24px!important;padding-right:24px!important}.h1{font-size:23px!important}}</style><title>${esc(tr('subject', parts.subject))}</title></head>
<body style="margin:0;padding:0;background:#050203;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#050203;font-size:1px;line-height:1px;">${esc(tr('preheader', parts.preheader || parts.title))}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#050203" style="background:#050203;"><tr><td align="center" style="padding:44px 12px;">
<table role="presentation" width="620" cellspacing="0" cellpadding="0" bgcolor="#140b0d" style="width:100%;max-width:620px;background:#140b0d;border:1px solid #3d3218;border-radius:4px;overflow:hidden;">
 <tr><td align="center" bgcolor="#0d0608" style="background:#0d0608;background-image:linear-gradient(#1d0f12,#0d0608);border-bottom:2px solid ${gold};padding:46px 30px 40px;">
  <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 16px;"><tr><td align="center" width="64" height="64" bgcolor="#150b0d" style="width:64px;height:64px;background:#150b0d;border:1px solid ${gold};border-radius:50%;font:700 30px/64px ${SERIF};color:${gold};letter-spacing:2px;">V</td></tr></table>
  <div style="font:400 28px ${SERIF};letter-spacing:7px;text-transform:uppercase;color:#ffffff;">${BRAND}</div>
  <div style="margin-top:8px;font:600 10px ${SANS};letter-spacing:6px;text-transform:uppercase;color:${gold};">${esc(TAGLINE)}</div>
 </td></tr>
 <tr><td align="center" bgcolor="#100809" style="background:#100809;border-bottom:1px solid #2b2112;padding:13px 20px;"><span style="font:600 10px ${SANS};letter-spacing:4px;text-transform:uppercase;color:${gold};">${SERVICE}</span></td></tr>
 <tr><td class="px" bgcolor="#170d10" style="background:#170d10;padding:44px 40px 40px;text-align:${align};">${body.join('\n')}</td></tr>
 <tr><td class="px" bgcolor="#0b0507" style="background:#0b0507;border-top:1px solid #2b2112;padding:34px 40px 30px;">${footer}</td></tr>
</table></td></tr></table></body></html>`;

  // 3) plain text (always sent alongside the HTML)
  const L = [];
  L.push(`${BRAND} — ${TAGLINE}`, SERVICE, '='.repeat(46), '', String(tr('eyebrow', parts.eyebrow || '')).toUpperCase(), tr('title', parts.title), '', tr('greeting'), '');
  if (parts.badge) L.push(`[ ${tr('badge', parts.badge.text)} ]`, '');
  (parts.paragraphs || []).forEach((p, i) => L.push(tr('p' + i, p), ''));
  (parts.details || []).forEach((d, i) => L.push(`${tr('d' + i, d[0])}: ${d[1]}`)); if (parts.details && parts.details.length) L.push('');
  if (parts.quote) L.push(`"${tr('quote', parts.quote)}"`, '');
  if (parts.code) L.push(`>>> ${parts.code} <<<`, tr('s_codeNote'), '');
  if (parts.notice) L.push(`${tr('s_security')}: ${typeof parts.notice === 'string' ? tr('notice', parts.notice) : tr('s_neverShare')}`, '');
  if (parts.cta && url) L.push(`${tr('cta', parts.cta.label)}: ${url}`, '');
  if (parts.cta2 && parts.cta2.url) L.push(`${tr('cta2', parts.cta2.label)}: ${parts.cta2.url}`, '');
  if (parts.dispute) L.push(`${tr('s_disputeLead')} ${tr('s_disputeText')} ${complaints}`, '');
  L.push(tr('s_respectfully'), 'Trading Support Coordinator', COMPANY, SERVICE, '', '-'.repeat(46),
    `${String(tr('s_supportTitle')).toUpperCase()}: ${support}`, tr('s_supportText') + (respTime ? ` ${tr('s_respTime')} ${respTime}.` : ''), '',
    `${String(tr('s_complaintsTitle')).toUpperCase()}: ${complaints}`, tr('s_complaintsText'), '', ADDRESS, '', tr('s_issuedBy'), CONFIDENTIALITY, `© ${year} ${COMPANY}. ${tr('s_rights')}`);
  return { subject: tr('subject', parts.subject), html, text: L.join('\n') };
}

module.exports = { unesc, renderEmail, renderEmailSync, localizeList, BRAND, COMPANY, SERVICE, TAGLINE, ADDRESS, supportEmail, complaintsEmail, appUrl };
