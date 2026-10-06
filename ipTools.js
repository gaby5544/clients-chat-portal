// Client IP + country detection for the registration / login / withdrawal audit
// trail and the admin per-seller IP block list. Works for both Express requests
// and Socket.IO handshakes, and is careful about proxies: the app normally sits
// behind a host's load balancer, so the TCP peer is the proxy, not the visitor.
//
// TRUST_PROXY_HOPS = how many reverse proxies sit in front of the app (default 1,
// correct for Northflank/Render/Railway/Fly). Set 0 if the app is exposed directly,
// 2 if there is a CDN in front of the host's own proxy.

const net = require('net');

const HOPS = Number.isFinite(Number(process.env.TRUST_PROXY_HOPS)) ? Number(process.env.TRUST_PROXY_HOPS) : 1;

function normalize(ip) {
  if (!ip || typeof ip !== 'string') return null;
  let v = ip.trim();
  if (v.startsWith('::ffff:') && net.isIPv4(v.slice(7))) v = v.slice(7);
  if (v.startsWith('[') && v.includes(']')) v = v.slice(1, v.indexOf(']'));
  if (net.isIPv4(v.split(':')[0]) && v.includes('.') && v.includes(':') && !net.isIPv6(v)) v = v.split(':')[0]; // ip:port
  return net.isIP(v) ? v : null;
}

function fromHeaders(headers, peer) {
  headers = headers || {};
  if (process.env.TRUST_CLOUDFLARE === '1' && headers['cf-connecting-ip']) {
    const cf = normalize(String(headers['cf-connecting-ip']));
    if (cf) return cf;
  }
  const xff = headers['x-forwarded-for'];
  if (HOPS > 0 && xff) {
    const list = String(xff).split(',').map((s) => normalize(s)).filter(Boolean);
    if (list.length) return list[Math.max(0, list.length - HOPS)];
  }
  if (HOPS > 0 && headers['x-real-ip']) {
    const r = normalize(String(headers['x-real-ip']));
    if (r) return r;
  }
  return normalize(peer) || 'unknown';
}

const fromRequest = (req) => fromHeaders(req.headers, req.socket && req.socket.remoteAddress);
const fromSocket = (socket) => fromHeaders(socket.handshake && socket.handshake.headers, socket.handshake && socket.handshake.address);

// Best-effort country (ISO2) from headers some hosts / CDNs add; null if none.
function countryFromHeaders(headers) {
  headers = headers || {};
  const raw = headers['cf-ipcountry'] || headers['x-vercel-ip-country'] || headers['cloudfront-viewer-country'] || headers['x-country-code'] || headers['x-appengine-country'];
  const v = raw ? String(raw).trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null;
}

module.exports = { fromRequest, fromSocket, fromHeaders, countryFromHeaders, normalize, HOPS };
