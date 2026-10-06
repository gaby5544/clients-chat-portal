// The e-mail layout: a dark, gold-accented, table-based design that renders in Gmail, Outlook, Apple Mail and
// Zoho Mail (inline styles, no scripts, no remote images). Everything the reader sees is passed in already
// translated; this file only lays it out. It also produces the plain-text twin that improves inbox placement.
//
// Brand details come from the environment (see .env.example):
//   BRAND_NAME, BRAND_TAGLINE, BRAND_MONOGRAM (defaults to the first letter of BRAND_NAME),
//   SUPPORT_EMAIL, COMPLAINTS_EMAIL, COMPANY_ADDRESS (optional line in the footer), APP_URL (optional button target).

const { escapeHtml: esc } = require('./security');

const GOLD = '#d4af37';
const TONES = {
  gold: GOLD,
  success: '#3ecf8e',
  warn: '#f5a524',
  bad: '#f4617f',
  info: '#6cb6ff'
};
const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv']);

const attr = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br = (t) => esc(t).replace(/\n/g, '<br>');

function monogram(letter) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 18px;"><tr>
<td align="center" valign="middle" width="64" height="64" bgcolor="#1a1013" style="width:64px;height:64px;border:1px solid ${GOLD};border-radius:50%;font-family:${SERIF};font-size:30px;line-height:64px;font-weight:bold;color:${GOLD};letter-spacing:1px;">${esc(letter)}</td>
</tr></table>`;
}

function factsTable(facts, rtl) {
  if (!facts || !facts.length) return '';
  const al = rtl ? 'right' : 'left', ar = rtl ? 'left' : 'right';
  const rows = facts.map(([k, v], i) => `<tr>
<td style="padding:11px 16px;${i ? 'border-top:1px solid #2c2125;' : ''}font-family:${SANS};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;text-align:${al};" valign="top">${esc(k)}</td>
<td style="padding:11px 16px;${i ? 'border-top:1px solid #2c2125;' : ''}font-family:${SANS};font-size:14px;font-weight:600;color:#fffaf0;text-align:${ar};word-break:break-word;" valign="top">${esc(v)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#1d1418" style="margin:22px 0;background:#1d1418;border:1px solid #3a2c22;border-radius:6px;">${rows}</table>`;
}

function statusChip(status, rtl) {
  if (!status || !status.label) return '';
  const c = TONES[status.tone] || GOLD;
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="padding:6px 14px;border:1px solid ${c};border-radius:999px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${c};">${esc(status.label)}</td></tr></table>`;
}

function codePanel(code, note) {
  if (!code) return '';
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:26px 0;"><tr><td align="center" bgcolor="#0d0809" style="padding:26px 12px 22px;background:#0d0809;border:1px solid ${GOLD};border-radius:6px;">
<div style="font-family:${MONO};font-size:36px;line-height:1.2;font-weight:700;letter-spacing:12px;color:${GOLD};padding-left:12px;">${esc(code)}</div>
${note ? `<div style="margin-top:12px;font-family:${SANS};font-size:12px;letter-spacing:.5px;color:#9ca3af;">${esc(note)}</div>` : ''}
</td></tr></table>`;
}

function button(cta) {
  if (!cta || !cta.label || !cta.url) return '';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;"><tr><td align="center" bgcolor="${GOLD}" style="background:${GOLD};border-radius:4px;"><a href="${attr(cta.url)}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1a1205;text-decoration:none;">${esc(cta.label)}</a></td></tr></table>`;
}

function callout(note, tone, rtl) {
  if (!note) return '';
  const c = TONES[tone] || GOLD;
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr><td bgcolor="#1d1418" style="padding:14px 18px;background:#1d1418;border-${rtl ? 'right' : 'left'}:3px solid ${c};font-family:${SANS};font-size:13px;line-height:1.7;color:#c9ced6;">${nl2br(note)}</td></tr></table>`;
}

function contactCell(c, accent, width) {
  return `<td class="qcol" width="${width}" valign="top" style="width:${width};padding:0 6px 12px;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#120a0d" style="background:#120a0d;border:1px solid #2d2227;border-top:2px solid ${accent};border-radius:4px;"><tr><td style="padding:16px 16px 14px;font-family:${SANS};">
<div style="font-family:${SERIF};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${accent};">${esc(c.title)}</div>
<div style="margin-top:8px;font-size:12px;line-height:1.6;color:#9ca3af;">${esc(c.desc)}</div>
<div style="margin-top:10px;font-size:13px;"><a href="mailto:${attr(c.email)}" style="color:${accent};font-weight:600;text-decoration:none;">${esc(c.email)}</a></div>
</td></tr></table></td>`;
}

/**
 * o = { lang, brand, tagline, monogram, preheader, eyebrow, tone, title, paragraphs[], status, facts[[k,v]],
 *       code, codeNote, cta, note, noteTone, signoff:{ closing, role, org }, contacts:[{kind,title,desc,email}],
 *       address, legal, year }
 */
function render(o) {
  const rtl = RTL.has(String(o.lang || 'en').split('-')[0]);
  const dir = rtl ? 'rtl' : 'ltr', al = rtl ? 'right' : 'left';
  const accent = TONES[o.tone] || GOLD;
  const supportAccent = GOLD, complaintsAccent = '#e0788a';
  const cs = o.contacts || [];
  const width = cs.length > 1 ? '50%' : '100%';
  const contactRow = cs.length
    ? `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>${cs.map((c) => contactCell(c, c.kind === 'complaints' ? complaintsAccent : supportAccent, width)).join('')}</tr></table>`
    : '';
  const paragraphs = (o.paragraphs || []).map((t) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.85;color:#d1d5db;text-align:${al};">${nl2br(t)}</p>`).join('');
  const sign = o.signoff ? `<p style="margin:30px 0 0;font-family:${SERIF};font-size:16px;line-height:1.6;color:#fffdfa;text-align:${al};">${esc(o.signoff.closing)}<br><span style="font-size:14px;letter-spacing:.5px;color:${GOLD};">${esc(o.signoff.role)}</span><br><span style="font-size:15px;letter-spacing:1px;color:#ffffff;font-weight:bold;">${esc(o.signoff.org)}</span></p>` : '';

  const html = `<!doctype html>
<html lang="${esc(o.lang || 'en')}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>${esc(o.title)}</title>
<style>@media only screen and (max-width:640px){.qwrap{width:100%!important}.qpad{padding:32px 22px!important}.qcol{display:block!important;width:100%!important;padding:0 0 12px!important}}</style></head>
<body bgcolor="#0a0708" style="margin:0;padding:0;background:#0a0708;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#0a0708;">${esc(o.preheader || o.title)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0a0708" style="background:#0a0708;"><tr><td align="center" style="padding:36px 12px;">
<table role="presentation" class="qwrap" width="620" border="0" cellpadding="0" cellspacing="0" bgcolor="#140f12" style="width:620px;max-width:100%;background:#140f12;border:1px solid #4a3d17;border-radius:6px;">
<tr><td align="center" bgcolor="#0d0809" style="padding:44px 30px 36px;background:#0d0809;border-bottom:2px solid ${GOLD};border-radius:6px 6px 0 0;">
${monogram(o.monogram)}
<div style="font-family:${SERIF};font-size:20px;line-height:1.4;letter-spacing:4px;text-transform:uppercase;color:#ffffff;">${esc(o.brand)}</div>
<div style="margin-top:8px;font-family:${SANS};font-size:10px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:${GOLD};">${esc(o.tagline)}</div>
</td></tr>
<tr><td class="qpad" bgcolor="#170f12" dir="${dir}" style="padding:46px 44px 40px;background:#170f12;text-align:${al};">
${o.eyebrow ? `<div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${accent};">${esc(o.eyebrow)}</div>` : ''}
<h1 style="margin:10px 0 14px;font-family:${SERIF};font-size:26px;line-height:1.3;font-weight:normal;color:#fffaf0;text-align:${al};">${esc(o.title)}</h1>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td width="48" height="2" bgcolor="${accent}" style="width:48px;height:2px;font-size:0;line-height:0;background:${accent};">&nbsp;</td></tr></table>
${statusChip(o.status, rtl)}${paragraphs}${factsTable(o.facts, rtl)}${codePanel(o.code, o.codeNote)}${button(o.cta)}${callout(o.note, o.noteTone, rtl)}${sign}
</td></tr>
<tr><td class="qpad" bgcolor="#0b0507" dir="${dir}" style="padding:30px 38px 34px;background:#0b0507;border-top:1px solid #2a2024;border-radius:0 0 6px 6px;text-align:${al};">
${contactRow}
<div style="margin-top:14px;border-top:1px solid #2a2024;"></div>
<p style="margin:18px 0 0;font-family:${SANS};font-size:10px;line-height:1.7;font-style:italic;color:#6b7280;text-align:${al};">${esc(o.legal)}</p>
${o.address ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:10px;line-height:1.7;color:#6b7280;text-align:${al};">${esc(o.address)}</p>` : ''}
<p style="margin:8px 0 0;font-family:${SANS};font-size:10px;letter-spacing:.5px;color:#6b7280;text-align:${al};">&copy; ${esc(o.year)} ${esc(o.brand)}. All rights reserved.</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const L = [];
  if (o.eyebrow) L.push(o.eyebrow.toUpperCase());
  L.push(o.title, '='.repeat(Math.min(60, o.title.length)), '');
  if (o.status && o.status.label) L.push(`[ ${o.status.label} ]`, '');
  (o.paragraphs || []).forEach((t) => L.push(t, ''));
  (o.facts || []).forEach(([k, v]) => L.push(`${k}: ${v}`));
  if (o.facts && o.facts.length) L.push('');
  if (o.code) L.push(`    ${o.code}`, o.codeNote ? `    ${o.codeNote}` : '', '');
  if (o.cta && o.cta.url) L.push(`${o.cta.label}: ${o.cta.url}`, '');
  if (o.note) L.push(o.note, '');
  if (o.signoff) L.push(o.signoff.closing, o.signoff.role, o.signoff.org, '');
  L.push('--');
  cs.forEach((c) => L.push(`${c.title}: ${c.email} — ${c.desc}`));
  L.push('', o.legal, o.address || '', `(c) ${o.year} ${o.brand}`);
  return { html, text: L.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim() };
}

module.exports = { render, TONES };
