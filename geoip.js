// IP -> country / city lookup. Used for (a) the admin-only IP columns and (b) the "new sign-in"
// security email. Free HTTPS providers are tried in order, results are cached for 24 h, every call has
// a short timeout and NEVER throws — a failed lookup simply returns { known:false } so sign-in, chat and
// emails are never delayed or broken by it. Set GEOIP_PROVIDER=off to disable outside lookups entirely.

const QC = require('./public/countries');

const TTL_MS = 24 * 3600 * 1000;
const cache = new Map();   // ip -> { at, geo }

const isPrivate = (ip) => !ip || ip === 'unknown'
  || /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip) || ip === 'localhost';

function clean(ip) { return String(ip || '').replace(/^::ffff:/, '').trim(); }

async function fetchJson(url, ms = 3500) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'QuantumSecureDesk/3.2' } }); if (!r.ok) return null; return await r.json(); }
  catch (e) { return null; } finally { clearTimeout(t); }
}

const PROVIDERS = [
  async (ip) => { const d = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`); return d && d.success ? { country: d.country, countryIso: d.country_code, region: d.region, city: d.city, isp: d.connection && (d.connection.isp || d.connection.org) } : null; },
  async (ip) => { const d = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`); return d && !d.error ? { country: d.country_name, countryIso: d.country_code, region: d.region, city: d.city, isp: d.org } : null; }
];

/** @returns {Promise<{known:boolean, ip:string, country?:string, countryIso?:string, region?:string, city?:string, isp?:string, label:string}>} */
async function lookup(rawIp) {
  const ip = clean(rawIp);
  if (isPrivate(ip)) return { known: false, ip, label: ip && ip !== 'unknown' ? 'Private / local network' : 'Unknown location' };
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.geo;
  let geo = { known: false, ip, label: 'Location unavailable' };
  if (String(process.env.GEOIP_PROVIDER || '').toLowerCase() !== 'off') {
    for (const p of PROVIDERS) {
      const r = await p(ip).catch(() => null);
      if (r && r.countryIso) {
        const c = QC.findCountry(r.countryIso);
        const country = (c && c.name) || r.country || r.countryIso;
        const where = [r.city, r.region && r.region !== r.city ? r.region : null, country].filter(Boolean).join(', ');
        geo = { known: true, ip, country, countryIso: String(r.countryIso).toUpperCase(), region: r.region || null, city: r.city || null, isp: r.isp || null, label: where };
        break;
      }
    }
  }
  cache.set(ip, { at: Date.now(), geo: geo.known ? geo : { ...geo } });
  if (!geo.known) setTimeout(() => cache.delete(ip), 5 * 60 * 1000).unref();   // retry unknowns sooner
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return geo;
}

module.exports = { lookup, isPrivate };
