// Country detection & flag rendering.
// Uses geoip-lite's bundled offline database (no external API calls, no
// per-country data file to maintain) and Node's built-in Intl.DisplayNames
// to resolve a human-readable country name. Flags are generated from the
// ISO 3166-1 alpha-2 code using Unicode regional indicator symbols, so
// every country is supported automatically with zero hardcoded data.

const geoip = require('geoip-lite');

let regionNames;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch (e) {
  regionNames = null; // Very old Node fallback
}

function countryCodeToFlagEmoji(code) {
  if (!code || code.length !== 2) return '🌐';
  const upper = code.toUpperCase();
  const points = [...upper].map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
}

function countryNameFromCode(code) {
  if (!code) return 'Unknown';
  try {
    return (regionNames && regionNames.of(code.toUpperCase())) || code.toUpperCase();
  } catch (e) {
    return code.toUpperCase();
  }
}

/**
 * Resolves a client IP (from the socket handshake / req) to a country code.
 * Falls back to null for local/private addresses (e.g. during local dev),
 * in which case the UI should just skip showing a flag.
 */
function countryFromIp(ip) {
  if (!ip) return null;
  const clean = ip.replace('::ffff:', '');
  if (clean === '::1' || clean === '127.0.0.1' || clean.startsWith('10.') || clean.startsWith('192.168.')) {
    return null;
  }
  const lookup = geoip.lookup(clean);
  return lookup ? lookup.country : null;
}

module.exports = { countryCodeToFlagEmoji, countryNameFromCode, countryFromIp };
