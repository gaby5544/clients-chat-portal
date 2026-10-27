// Phone-number rules per country (v3.12). Shared by the browser (instant feedback) and the server (the real check).
//
// A number is accepted only when:
//   1. the dialling code is the one that belongs to the SELECTED country (so +233 can never go with Nigeria),
//   2. the national number has a length that numbers in that country really have, and
//   3. for the larger countries, it starts the way real numbers there start (for example a US/Canada number cannot start
//      with 0 or 1, a UK mobile starts with 7, an Indian mobile with 6-9).
// Obvious fakes (1111111111, 1234567890, 0000000) are refused everywhere.
//
// Lengths are national significant numbers WITHOUT the country code and WITHOUT the leading trunk 0.
// This is a self-contained rule table (no network lookups), kept deliberately a little permissive on length for countries
// whose numbering plans are mixed, and strict on the dialling code and on obviously impossible numbers.
(function (root) {
  var QC = (typeof module !== 'undefined' && module.exports) ? require('./countries.js') : root.QCountries;

  // iso: [minLength, maxLength, optionalPattern]
  var R = {
    AF: [9, 9], AL: [8, 9], DZ: [8, 9], AD: [6, 9], AO: [9, 9], AR: [10, 10], AM: [8, 8], AU: [9, 9, /^[2-478]\d{8}$/], AT: [9, 13], AZ: [9, 9],
    BH: [8, 8], BD: [8, 10], BY: [9, 9], BE: [8, 9], BZ: [7, 7], BJ: [8, 10], BT: [7, 8], BO: [8, 8], BA: [8, 9], BW: [7, 8],
    BR: [10, 11, /^[1-9][1-9]\d{8,9}$/], BN: [7, 7], BG: [8, 9], BF: [8, 8], BI: [8, 8], CV: [7, 7], KH: [8, 9], CM: [9, 9],
    CA: [10, 10, /^[2-9]\d{2}[2-9]\d{6}$/], US: [10, 10, /^[2-9]\d{2}[2-9]\d{6}$/], CF: [8, 8], TD: [8, 8], CL: [9, 9],
    CN: [10, 11, /^(1[3-9]\d{9}|[2-9]\d{9,10})$/], CO: [10, 10], KM: [7, 7], CD: [9, 9], CG: [9, 9], CR: [8, 8], HR: [8, 9], CU: [8, 8], CY: [8, 8],
    CZ: [9, 9], DK: [8, 8], DJ: [8, 8], EC: [8, 9], EG: [8, 10], SV: [8, 8], GQ: [9, 9], ER: [7, 7], EE: [7, 8], SZ: [8, 8], ET: [9, 9], FJ: [7, 7],
    FI: [6, 12], FR: [9, 9, /^[1-9]\d{8}$/], GA: [7, 8], GM: [7, 7], GE: [9, 9], DE: [10, 11, /^[1-9]\d{9,10}$/], GH: [9, 9, /^[2-5]\d{8}$/], GR: [10, 10],
    GT: [8, 8], GN: [9, 9], GW: [7, 9], GY: [7, 7], HT: [8, 8], HN: [8, 8], HU: [8, 9], IS: [7, 7], IN: [10, 10, /^[6-9]\d{9}$|^[1-5]\d{9}$/], ID: [9, 12],
    IR: [10, 10], IQ: [9, 10], IE: [8, 10], IL: [8, 9], IT: [8, 11], CI: [8, 10], JP: [9, 10, /^[1-9]\d{8,9}$/], JO: [8, 9], KZ: [10, 10], KE: [9, 9, /^[127]\d{8}$/],
    KI: [5, 8], XK: [8, 9], KW: [8, 8], KG: [9, 9], LA: [8, 10], LV: [8, 8], LB: [7, 8], LS: [8, 8], LR: [7, 9], LY: [9, 10], LI: [7, 9], LT: [8, 8],
    LU: [6, 11], MG: [9, 9], MW: [7, 9], MY: [8, 10], MV: [7, 7], ML: [8, 8], MT: [8, 8], MH: [7, 7], MR: [8, 8], MU: [7, 8], MX: [10, 10, /^[1-9]\d{9}$/],
    FM: [7, 7], MD: [8, 8], MC: [8, 9], MN: [8, 8], ME: [8, 8], MA: [9, 9], MZ: [8, 9], MM: [7, 10], NA: [7, 9], NR: [7, 7], NP: [8, 10], NL: [9, 9],
    NZ: [8, 10], NI: [8, 8], NE: [8, 8], NG: [8, 10, /^([789]\d{9}|[1-6]\d{6,8})$/], KP: [6, 10], MK: [8, 8], NO: [8, 8], OM: [8, 8], PK: [9, 10], PW: [7, 7],
    PS: [8, 9], PA: [7, 8], PG: [7, 8], PY: [8, 9], PE: [8, 9], PH: [8, 10], PL: [9, 9], PT: [9, 9], QA: [8, 8], RO: [9, 9], RU: [10, 10], RW: [9, 9],
    WS: [5, 7], SM: [6, 10], ST: [7, 7], SA: [9, 9, /^[1-9]\d{8}$/], SN: [9, 9], RS: [8, 9], SC: [7, 7], SL: [8, 8], SG: [8, 8], SK: [9, 9], SI: [8, 8],
    SB: [5, 7], SO: [7, 9], ZA: [9, 9, /^[1-8]\d{8}$/], KR: [8, 10], SS: [9, 9], ES: [9, 9], LK: [9, 9], SD: [9, 9], SR: [6, 7], SE: [7, 10], CH: [9, 9],
    SY: [8, 9], TW: [8, 9], TJ: [9, 9], TZ: [9, 9], TH: [8, 9], TL: [7, 8], TG: [8, 8], TO: [5, 7], TN: [8, 8], TR: [10, 10], TM: [8, 8], TV: [5, 6],
    UG: [9, 9], UA: [9, 9], AE: [8, 9, /^([2-4679]\d{7}|5\d{8})$/], GB: [9, 10, /^[1-35789]\d{8,9}$/], UY: [8, 8], UZ: [9, 9], VU: [5, 7], VA: [6, 10], VE: [10, 10],
    VN: [9, 10], YE: [7, 9], ZM: [9, 9], ZW: [9, 10]
  };
  // Caribbean NANP countries: the dialling code already includes the area code (+1 268 ...), the rest is 7 digits.
  var NANP7 = { AG: 1, BS: 1, BB: 1, DM: 1, GD: 1, JM: 1, KN: 1, LC: 1, VC: 1, TT: 1 };
  var DO_AREAS = { '809': 1, '829': 1, '849': 1 };

  function fake(d) {
    if (/^(\d)\1+$/.test(d)) return true;                                      // 1111111111
    var asc = '01234567890123456789', desc = '98765432109876543210';
    if (d.length >= 6 && (asc.indexOf(d) >= 0 || desc.indexOf(d) >= 0)) return true;   // 1234567890, 987654321
    if (/^(\d{2,3})\1{2,}$/.test(d)) return true;                              // 123123123, 121212121
    return false;
  }

  /**
   * @param {string} countryNameOrIso the country the person selected
   * @param {string} dial the dialling code that was chosen (with or without +)
   * @param {string} local the number typed in (national format; a leading 0 is allowed)
   * @returns {{ok:true, e164:string, dial:string, national:string}|{ok:false, error:string}}
   */
  function validatePhone(countryNameOrIso, dial, local) {
    var c = QC.findCountry(countryNameOrIso);
    if (!c) return { ok: false, error: 'Please select your country first.' };
    var dc = String(dial == null || dial === '' ? c.dial : dial).replace(/\D/g, '');
    var d = String(local || '').replace(/\D/g, '');
    if (!d) return { ok: false, error: 'Please enter your phone number.' };
    var wantDial = c.dial, found = c.iso;
    // Dominican Republic uses 809 / 829 / 849: accept the area code typed in front.
    if (c.iso === 'DO') {
      var n10 = d.replace(/^0+/, '');
      if (n10.length === 10 && DO_AREAS[n10.slice(0, 3)] && (dc === '1809' || dc === '1' || dc === '1' + n10.slice(0, 3))) { wantDial = '1' + n10.slice(0, 3); d = n10.slice(3); dc = wantDial; }
    }
    if (dc !== wantDial) {
      var other = QC.COUNTRIES.filter(function (x) { return x.dial === dc; })[0];
      return { ok: false, error: 'The phone code +' + dc + (other ? ' belongs to ' + other.name : ' is not a valid country code') + ', but you selected ' + c.name + ' (+' + wantDial + '). Please use +' + wantDial + ' for ' + c.name + '.' };
    }
    // the person typed the country code into the number box
    var stripped = d.replace(/^0+/, '');
    if (fake(stripped)) return { ok: false, error: 'That does not look like a real ' + c.name + ' phone number. Please enter your own number.' };
    if (NANP7[c.iso] || (c.iso === 'DO' && wantDial.length === 4)) {
      // 7-digit local number, optionally with the area code typed in front
      var area = wantDial.slice(1); if (stripped.length === 10 && stripped.slice(0, 3) === area) stripped = stripped.slice(3);
      if (!/^[2-9]\d{6}$/.test(stripped) || fake(stripped)) return { ok: false, error: c.name + ' numbers have 7 digits after +' + wantDial + ' (they cannot start with 0 or 1). Please check your number.' };
      return { ok: true, e164: '+' + wantDial + stripped, dial: wantDial, national: stripped };
    }
    var rule = R[found] || [6, 12];
    var min = rule[0], max = rule[1], pat = rule[2];
    var okLen = stripped.length >= min && stripped.length <= max;
    var okPat = !pat || pat.test(stripped);
    if (!okLen || !okPat) {
      if (stripped.indexOf(wantDial) === 0) {
        var rest = stripped.slice(wantDial.length);
        if (rest.length >= min && rest.length <= max && (!pat || pat.test(rest)) && !fake(rest)) return { ok: true, e164: '+' + wantDial + rest, dial: wantDial, national: rest };   // the code was typed inside the number: accept it once
      }
      var lenTxt = min === max ? min + ' digits' : min + ' to ' + max + ' digits';
      return { ok: false, error: !okLen ? c.name + ' phone numbers have ' + lenTxt + ' after +' + wantDial + ' (you entered ' + stripped.length + '). Please check your number.' : 'That is not a valid ' + c.name + ' phone number. Please check the first digits and try again.' };
    }
    var full = wantDial + stripped; if (full.length < 7 || full.length > 15) return { ok: false, error: 'That phone number is not the right length.' };
    return { ok: true, e164: '+' + full, dial: wantDial, national: stripped };
  }

  var api = { validatePhone: validatePhone, RULES: R };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QPhone = api;
})(typeof window !== 'undefined' ? window : globalThis);
