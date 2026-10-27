// "New sign-in" security email. Sent when a seller signs in (password or invite link) from a network
// address the account has not used before, and on every explicit password sign-in (throttled).
// The admin can switch it off per seller (group_flags.loginAlertsDisabled).
// Never throws and never delays the sign-in — callers fire-and-forget.

const { store } = require('./db');
const geoip = require('./geoip');
const E = require('./email');
const { hmac } = require('./identity');
const TPL = require('./emailTemplate');

const THROTTLE_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

/** Signed, expiring token for the "Yes, this was me" / "No, secure my account" links. */
function signToken(groupId, ip) {
  const body = Buffer.from(JSON.stringify({ g: groupId, i: ip, t: Date.now() })).toString('base64url');
  return `${body}.${hmac('login-alert', body)}`;
}
function readToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig || hmac('login-alert', body) !== sig) return null;
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!d || !d.g || Date.now() - d.t > TOKEN_TTL_MS) return null;
    return d;
  } catch (e) { return null; }
}

function flagsOf(g) {
  const f = g && g.group_flags;
  if (!f) return {};
  if (typeof f === 'string') { try { return JSON.parse(f); } catch (e) { return {}; } }
  return f;
}

/** "Chrome on Windows" from a User-Agent — enough for a human to recognise their own device. */
function describeDevice(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const browser = /Edg\//.test(s) ? 'Microsoft Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`;
}

/**
 * @param group  the seller's group row
 * @param ip     the address they signed in from
 * @param opts   { ua, source: 'password'|'link' }
 */
async function sendLoginAlert(group, ip, { ua, source = 'password', baseUrl } = {}) {
  try {
    if (!group || !group.seller_registered || !group.email_b) return { skipped: 'no-account' };
    const flags = flagsOf(group);
    if (flags.loginAlertsDisabled) return { skipped: 'disabled-by-admin' };
    if ((flags.trustedIps || []).includes(ip)) return { skipped: 'trusted' };
    const sent = { ...(flags.loginAlertSent || {}) };
    const last = sent[ip] ? new Date(sent[ip]).getTime() : 0;
    const seenBefore = (() => { try { const l = typeof group.seller_ip_log === 'string' ? JSON.parse(group.seller_ip_log) : (group.seller_ip_log || []); return l.some((r) => r.ip === ip && r.count > 1); } catch (e) { return false; } })();
    if (Date.now() - last < THROTTLE_MS) return { skipped: 'throttled' };
    // An invite-link re-entry from an address already known to the account is routine — no email.
    if (source === 'link' && (seenBefore || last)) return { skipped: 'known-address' };

    const geo = await geoip.lookup(ip);
    const when = new Date();
    const base = baseUrl || TPL.appUrl(); const tok = signToken(group.id, ip);
    const r = await E.notifyLoginAlert(group.email_b, {
      name: group.seller_full_name, accountId: group.seller_account_id, lang: group.seller_language,
      time: when, ip, geo, device: describeDevice(ua), source,
      appBase: base,
      confirmUrl: base ? `${base}/security/login/${tok}/yes` : undefined, denyUrl: base ? `${base}/security/login/${tok}/no` : undefined
    });
    sent[ip] = when.toISOString();
    const keys = Object.keys(sent).sort((a, b) => new Date(sent[b]) - new Date(sent[a])).slice(0, 25);
    const trimmed = {}; keys.forEach((k) => { trimmed[k] = sent[k]; });
    await store.updateGroup(group.id, { group_flags: { ...flagsOf(await store.getGroup(group.id)), loginAlertSent: trimmed } });
    return r;
  } catch (err) { console.error('[login-alert]', err.message); return { error: err.message }; }
}

async function setLoginAlertsEnabled(groupId, enabled) {
  const g = await store.getGroup(groupId);
  if (!g) return null;
  const f = { ...flagsOf(g), loginAlertsDisabled: !enabled };
  return store.updateGroup(groupId, { group_flags: f });
}

module.exports = { signToken, readToken, sendLoginAlert, setLoginAlertsEnabled, flagsOf, describeDevice };
