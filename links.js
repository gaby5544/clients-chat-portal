// Invite-link validity. A link (?groupId=…&role=BUYER|SELLER) stops working the moment
//   * its group is deleted from the admin dashboard, or
//   * the Buyer / Seller who held that seat is deleted by an admin (that party's link only).
// Anyone opening a dead link sees ONLY the "link expired" page with the company's contact details —
// never a group, a chat or any part of the transaction workspace.

const { store } = require('./db');
const TPL = require('./emailTemplate');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function flagsOf(g) {
  const f = g && g.group_flags;
  if (!f) return {};
  if (typeof f === 'string') { try { return JSON.parse(f); } catch (e) { return {}; } }
  return f;
}
const partyOf = (role) => (role === 'SELLER' || role === 'PARTY B') ? 'B' : (role === 'BUYER' || role === 'PARTY A') ? 'A' : null;

// Links already handed out to clients must survive a redeploy / database reset. A link ONLY dies when an admin
// deletes its group (that id is then tombstoned) or deletes the buyer/seller. IDs listed here (plus any in the
// PRESERVED_GROUP_IDS environment variable, comma-separated) are re-created on first open if the database lost them.
const PRESERVED = new Set(['group-1791374307913', ...String(process.env.PRESERVED_GROUP_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
async function tombstones() { try { const v = await store.getSetting('deleted_groups', '[]'); return new Set(JSON.parse(typeof v === 'string' ? v : JSON.stringify(v))); } catch (e) { return new Set(); } }
async function tombstone(groupId) { const t = await tombstones(); t.add(groupId); await store.setSetting('deleted_groups', JSON.stringify(Array.from(t).slice(-500))); }
/** The group, re-creating a preserved one the database no longer has (never one an admin deleted). */
async function ensureGroup(groupId) {
  let g = await store.getGroup(groupId);
  if (g || !PRESERVED.has(groupId)) return g;
  if ((await tombstones()).has(groupId)) return null;
  return store.createGroupIfMissing(groupId, 'Transaction Group');
}

/** @returns {{valid:boolean, reason?:string, group?:object, party?:'A'|'B'|null}} */
async function linkState(groupId, role) {
  if (!groupId || typeof groupId !== 'string') return { valid: false, reason: 'missing' };
  const g = await ensureGroup(groupId.slice(0, 100));
  if (!g) return { valid: false, reason: 'removed' };
  const party = partyOf(role);
  const f = flagsOf(g);
  if (party === 'A' && f.buyerLinkRevoked) return { valid: false, reason: 'revoked', group: g, party };
  if (party === 'B' && f.sellerLinkRevoked) return { valid: false, reason: 'revoked', group: g, party };
  return { valid: true, group: g, party };
}

async function setRevoked(groupId, party, revoked) {
  const g = await store.getGroup(groupId);
  if (!g) return null;
  const f = { ...flagsOf(g) };
  if (party === 'A') f.buyerLinkRevoked = !!revoked; else f.sellerLinkRevoked = !!revoked;
  return store.updateGroup(groupId, { group_flags: f });
}

function contact() { return { support: TPL.supportEmail(), complaints: TPL.complaintsEmail() }; }

/** Standalone, self-contained page — no scripts, no app code, no group data. */
function expiredPageHtml() {
  const { support, complaints } = contact();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0b0507"><title>Link expired — ${esc(TPL.BRAND)}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#050203;color:#e5e7eb;font-family:'Helvetica Neue',Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:max(20px,env(safe-area-inset-top)) 16px max(20px,env(safe-area-inset-bottom))}
.card{width:100%;max-width:520px;background:#140b0d;border:1px solid #3d3218;border-radius:6px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.head{text-align:center;padding:34px 24px 26px;background:linear-gradient(#1d0f12,#0d0608);border-bottom:2px solid #d4af37}
.mono{width:58px;height:58px;margin:0 auto 14px;border:1px solid #d4af37;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 27px 'Times New Roman',serif;color:#d4af37}
.brand{font:400 25px 'Times New Roman',serif;letter-spacing:7px;color:#fff;text-transform:uppercase}
.tag{margin-top:7px;font:600 9px 'Helvetica Neue',Arial;letter-spacing:5px;color:#d4af37;text-transform:uppercase}
.body{padding:34px 30px 30px;text-align:center}
.ico{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:#2f1218;border:1px solid #fb7185;display:flex;align-items:center;justify-content:center}
.ico svg{width:30px;height:30px;stroke:#fb7185;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
h1{margin:0 0 12px;font:400 26px 'Times New Roman',serif;color:#fffdfa}
.rule{width:56px;height:2px;background:#d4af37;margin:0 auto 18px}
p{margin:0 0 14px;font-size:15px;line-height:1.75;color:#d1d5db}
.contact{margin-top:22px;text-align:left;border:1px solid #3d3218;background:#120a0c;border-radius:4px;padding:16px 18px}
.contact b{display:block;font:700 11px 'Helvetica Neue',Arial;letter-spacing:2px;text-transform:uppercase;color:#d4af37;margin-bottom:4px}
.contact a{color:#fffdfa;font-weight:600;text-decoration:none;word-break:break-all}
.contact div+div{margin-top:14px}
.foot{padding:16px 24px;background:#0b0507;border-top:1px solid #2b2112;text-align:center;font-size:11px;line-height:1.7;color:#6b7280}
</style></head><body><main class="card">
<div class="head"><div class="mono">V</div><div class="brand">${esc(TPL.BRAND)}</div><div class="tag">${esc(TPL.TAGLINE)}</div></div>
<div class="body">
<div class="ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
<h1>This link has expired</h1><div class="rule"></div>
<p>The secure link you opened is no longer active, so we are unable to open it.</p>
<p>If you believe this is a mistake, or you need a new link, please contact us and our team will be glad to help.</p>
<div class="contact">
<div><b>Contact us</b><a href="mailto:${esc(support)}">${esc(support)}</a></div>
<div><b>Complaints &amp; escalations</b><a href="mailto:${esc(complaints)}">${esc(complaints)}</a></div>
</div></div>
<div class="foot">${esc(TPL.ADDRESS)}<br>© ${new Date().getFullYear()} ${esc(TPL.COMPANY)}. All rights reserved.</div>
</main></body></html>`;
}

module.exports = { tombstone, ensureGroup, flagsOf, partyOf, linkState, setRevoked, expiredPageHtml, contact };
