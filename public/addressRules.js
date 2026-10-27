// Billing-address rules for the AIRWX card (v3.12). Shared by the browser (instant feedback) and the server (the real check).
// A card is only useful online when its billing address (street, city, state, ZIP / postal code, country) is complete and
// looks right, because shops and payment processors compare it with what the card issuer has on file (AVS).
(function (root) {
  var QC = (typeof module !== 'undefined' && module.exports) ? require('./countries.js') : root.QCountries;

  var US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands' };
  var CA_PROVINCES = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' };
  var STATE_REQUIRED = { US: 1, CA: 1, AU: 1, BR: 1, IN: 1, MX: 1, CN: 1, NG: 1, MY: 1, AE: 1, IT: 1, ES: 1, JP: 1, KR: 1 };
  // countries that have no postal-code system (the ZIP box is then optional)
  var NO_POST = 'AE GH AG AO BS BZ BJ BW BF BI CM CF TD KM CG CD DJ DM GQ ER FJ GM GD GY KI MW ML MR NR NE QA RW KN LC VC SC SL SB SS SR SY TL TG TO TT TV UG VU YE ZW'.split(' ').reduce(function (o, k) { o[k] = 1; return o; }, {});
  var D5 = /^\d{5}$/, D4 = /^\d{4}$/, D6 = /^\d{6}$/;
  var POST = {
    US: /^\d{5}(-\d{4})?$/, CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
    GB: /^(GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i, IE: /^[A-Z]\d{2} ?[A-Z\d]{4}$/i, NL: /^\d{4} ?[A-Z]{2}$/i, PT: /^\d{4}-\d{3}$/, JP: /^\d{3}-?\d{4}$/, BR: /^\d{5}-?\d{3}$/,
    PL: /^\d{2}-\d{3}$/, SE: /^\d{3} ?\d{2}$/, CZ: /^\d{3} ?\d{2}$/, SK: /^\d{3} ?\d{2}$/, GR: /^\d{3} ?\d{2}$/, LV: /^(LV-)?\d{4}$/i, LT: /^(LT-)?\d{5}$/i, MT: /^[A-Z]{3} ?\d{2,4}$/i, KR: D5,
    DE: D5, FR: D5, ES: D5, IT: D5, TR: D5, MX: D5, TH: D5, MY: D5, ID: D5, FI: D5, EE: D5, HR: D5, RS: D5, MA: D5, EG: D5, KE: D5, NP: D5, PK: D5, LK: D5, JO: /^\d{5}$/, DZ: D5, TN: D4, UA: D5, CU: D5, GT: D5, SA: /^\d{5}(-\d{4})?$/,
    CN: D6, IN: D6, SG: D6, RU: D6, KZ: D6, BY: D6, VN: D6, UZ: D6, TJ: D6, KG: D6, TM: D6, RO: D6, KP: D6,
    AU: D4, NZ: D4, ZA: D4, CH: D4, AT: D4, BE: D4, DK: D4, NO: D4, HU: D4, BG: D4, LU: D4, SI: D4, CY: D4, PH: D4, BD: D4, GE: D4, AL: D4, AM: D4, MD: D4, MK: D4, LI: D4, AR: /^([A-Z]\d{4}[A-Z]{3}|\d{4})$/i,
    NG: D6, GH: /^[A-Z]{2}-?\d{3}-?\d{4}$/i, CL: /^\d{7}$/, CO: D6, PE: /^\d{5}$/, EC: D6, UY: D5, VE: D4, BO: /^\d{4}$/, PY: D4, IS: /^\d{3}$/, IL: /^\d{5}(\d{2})?$/, IQ: D5, IR: /^\d{10}$/, KW: D5, BH: /^\d{3,4}$/, OM: /^\d{3}$/, LB: /^\d{4}( ?\d{4})?$/
  };
  var GENERIC_POST = /^[A-Za-z0-9][A-Za-z0-9 \-]{1,8}[A-Za-z0-9]$/;
  var clean = function (v, n) { return String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 100); };

  function postalHelp(iso) {
    return { US: 'ZIP code: 5 digits (12345) or ZIP+4 (12345-6789).', CA: 'Postal code like K1A 0B1.', GB: 'Postcode like SW1A 1AA.', IE: 'Eircode like D02 X285.', NL: 'Postcode like 1012 AB.', JP: 'Postal code like 100-0001.', BR: 'CEP like 01310-100.', PT: 'Postal code like 1000-001.', PL: 'Postal code like 00-001.' }[iso] || 'Enter the postal code exactly as it appears on your address.';
  }
  function validatePostal(iso, zip) {
    var z = clean(zip, 12).toUpperCase();
    if (!z) return NO_POST[iso] ? { ok: true, zip: '' } : { ok: false, error: (iso === 'US' ? 'ZIP code' : 'Postal code') + ' is required.' };
    var re = POST[iso] || GENERIC_POST;
    if (!re.test(z)) return { ok: false, error: 'That is not a valid ' + (iso === 'US' ? 'ZIP code' : 'postal code') + ' for this country. ' + postalHelp(iso) };
    if (/^(\d)\1+$/.test(z.replace(/\D/g, '')) && z.replace(/\D/g, '').length >= 4 && z === z.replace(/\D/g, '')) return { ok: false, error: 'That postal code does not look real. Please check it.' };
    if (iso === 'CA') z = z.replace(/^(.{3}) ?(.{3})$/, '$1 $2');
    if (iso === 'GB' && z.indexOf(' ') < 0) z = z.slice(0, -3) + ' ' + z.slice(-3);
    return { ok: true, zip: z };
  }
  function normState(iso, raw) {
    var t = clean(raw, 60); if (!t) return STATE_REQUIRED[iso] ? { ok: false, error: (iso === 'US' ? 'State' : iso === 'CA' ? 'Province' : 'State / region') + ' is required.' } : { ok: true, state: '' };
    var table = iso === 'US' ? US_STATES : iso === 'CA' ? CA_PROVINCES : null;
    if (table) {
      var up = t.toUpperCase().replace(/\./g, ''); if (table[up]) return { ok: true, state: up };
      for (var k in table) if (table[k].toUpperCase() === up) return { ok: true, state: k };
      return { ok: false, error: 'Please choose a real ' + (iso === 'US' ? 'US state' : 'Canadian province') + ' (for example ' + (iso === 'US' ? 'NY or New York' : 'ON or Ontario') + ').' };
    }
    if (!/[A-Za-zÀ-ɏЀ-ӿ؀-ۿ一-鿿぀-ヿ가-힯]{2}/.test(t)) return { ok: false, error: 'Please enter a valid state or region.' };
    return { ok: true, state: t };
  }
  /** @returns {{ok:true, billing}|{ok:false, error, field}} */
  function validateBilling(input, fallbackIso) {
    input = input || {};
    var c = QC.findCountry(input.country || input.countryIso || fallbackIso);
    if (!c) return { ok: false, error: 'Please choose the billing country.', field: 'country' };
    var line1 = clean(input.address1 || input.address, 100);
    if (line1.length < 5 || !/[A-Za-zÀ-ɏЀ-ӿ؀-ۿ一-鿿぀-ヿ가-힯]/.test(line1)) return { ok: false, error: 'Please enter your full street address (house number and street name).', field: 'address1' };
    var line2 = clean(input.address2, 100);
    var city = clean(input.city, 60);
    if (city.length < 2 || /\d{3,}/.test(city)) return { ok: false, error: 'Please enter your city or town.', field: 'city' };
    var st = normState(c.iso, input.state); if (!st.ok) return { ok: false, error: st.error, field: 'state' };
    var pz = validatePostal(c.iso, input.zip); if (!pz.ok) return { ok: false, error: pz.error, field: 'zip' };
    return { ok: true, billing: { address1: line1, address2: line2, city: city, state: st.state, zip: pz.zip, country: c.name, countryIso: c.iso } };
  }
  function formatBilling(b) {
    if (!b) return '';
    var l = [b.address1, b.address2, [b.city, [b.state, b.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), b.country].filter(Boolean);
    return l.join(', ');
  }
  var api = { US_STATES: US_STATES, CA_PROVINCES: CA_PROVINCES, STATE_REQUIRED: STATE_REQUIRED, NO_POST: NO_POST, validatePostal: validatePostal, normState: normState, validateBilling: validateBilling, formatBilling: formatBilling, postalHelp: postalHelp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QAddress = api;
})(typeof window !== 'undefined' ? window : globalThis);
