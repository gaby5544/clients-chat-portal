// Interface / translation languages. [code, English name, native name, direction, flag country (ISO2)].
// `g` = code used by Google / LibreTranslate, `m` = code used by MyMemory (only listed when different).
(function (root) {
  var G = {"fil": "tl", "zh": "zh-CN", "zh-TW": "zh-TW", "he": "iw", "no": "no"};
  var M = {"fil": "tl-PH", "zh": "zh-CN", "zh-TW": "zh-TW", "no": "nb-NO", "pt": "pt-PT", "he": "he-IL"};
  var RAW = [
    ["en", "English", "English", "ltr", "us"],
    ["es", "Spanish", "Español", "ltr", "es"],
    ["fr", "French", "Français", "ltr", "fr"],
    ["de", "German", "Deutsch", "ltr", "de"],
    ["it", "Italian", "Italiano", "ltr", "it"],
    ["pt", "Portuguese", "Português", "ltr", "pt"],
    ["nl", "Dutch", "Nederlands", "ltr", "nl"],
    ["ru", "Russian", "Русский", "ltr", "ru"],
    ["uk", "Ukrainian", "Українська", "ltr", "ua"],
    ["pl", "Polish", "Polski", "ltr", "pl"],
    ["tr", "Turkish", "Türkçe", "ltr", "tr"],
    ["ar", "Arabic", "العربية", "rtl", "sa"],
    ["he", "Hebrew", "עברית", "rtl", "il"],
    ["fa", "Persian", "فارسی", "rtl", "ir"],
    ["ur", "Urdu", "اردو", "rtl", "pk"],
    ["hi", "Hindi", "हिन्दी", "ltr", "in"],
    ["bn", "Bengali", "বাংলা", "ltr", "bd"],
    ["ta", "Tamil", "தமிழ்", "ltr", "in"],
    ["te", "Telugu", "తెలుగు", "ltr", "in"],
    ["mr", "Marathi", "मराठी", "ltr", "in"],
    ["gu", "Gujarati", "ગુજરાતી", "ltr", "in"],
    ["pa", "Punjabi", "ਪੰਜਾਬੀ", "ltr", "in"],
    ["ne", "Nepali", "नेपाली", "ltr", "np"],
    ["si", "Sinhala", "සිංහල", "ltr", "lk"],
    ["zh", "Chinese (Simplified)", "简体中文", "ltr", "cn"],
    ["zh-TW", "Chinese (Traditional)", "繁體中文", "ltr", "tw"],
    ["ja", "Japanese", "日本語", "ltr", "jp"],
    ["ko", "Korean", "한국어", "ltr", "kr"],
    ["th", "Thai", "ไทย", "ltr", "th"],
    ["vi", "Vietnamese", "Tiếng Việt", "ltr", "vn"],
    ["id", "Indonesian", "Bahasa Indonesia", "ltr", "id"],
    ["ms", "Malay", "Bahasa Melayu", "ltr", "my"],
    ["fil", "Filipino", "Filipino", "ltr", "ph"],
    ["sw", "Swahili", "Kiswahili", "ltr", "ke"],
    ["am", "Amharic", "አማርኛ", "ltr", "et"],
    ["ha", "Hausa", "Hausa", "ltr", "ng"],
    ["yo", "Yoruba", "Yorùbá", "ltr", "ng"],
    ["ig", "Igbo", "Igbo", "ltr", "ng"],
    ["zu", "Zulu", "isiZulu", "ltr", "za"],
    ["xh", "Xhosa", "isiXhosa", "ltr", "za"],
    ["af", "Afrikaans", "Afrikaans", "ltr", "za"],
    ["so", "Somali", "Soomaali", "ltr", "so"],
    ["rw", "Kinyarwanda", "Kinyarwanda", "ltr", "rw"],
    ["mg", "Malagasy", "Malagasy", "ltr", "mg"],
    ["ro", "Romanian", "Română", "ltr", "ro"],
    ["hu", "Hungarian", "Magyar", "ltr", "hu"],
    ["cs", "Czech", "Čeština", "ltr", "cz"],
    ["sk", "Slovak", "Slovenčina", "ltr", "sk"],
    ["bg", "Bulgarian", "Български", "ltr", "bg"],
    ["sr", "Serbian", "Српски", "ltr", "rs"],
    ["hr", "Croatian", "Hrvatski", "ltr", "hr"],
    ["sl", "Slovenian", "Slovenščina", "ltr", "si"],
    ["bs", "Bosnian", "Bosanski", "ltr", "ba"],
    ["mk", "Macedonian", "Македонски", "ltr", "mk"],
    ["sq", "Albanian", "Shqip", "ltr", "al"],
    ["el", "Greek", "Ελληνικά", "ltr", "gr"],
    ["sv", "Swedish", "Svenska", "ltr", "se"],
    ["da", "Danish", "Dansk", "ltr", "dk"],
    ["no", "Norwegian", "Norsk", "ltr", "no"],
    ["fi", "Finnish", "Suomi", "ltr", "fi"],
    ["is", "Icelandic", "Íslenska", "ltr", "is"],
    ["et", "Estonian", "Eesti", "ltr", "ee"],
    ["lv", "Latvian", "Latviešu", "ltr", "lv"],
    ["lt", "Lithuanian", "Lietuvių", "ltr", "lt"],
    ["ka", "Georgian", "ქართული", "ltr", "ge"],
    ["hy", "Armenian", "Հայերեն", "ltr", "am"],
    ["az", "Azerbaijani", "Azərbaycanca", "ltr", "az"],
    ["kk", "Kazakh", "Қазақша", "ltr", "kz"],
    ["uz", "Uzbek", "Oʻzbekcha", "ltr", "uz"],
    ["mn", "Mongolian", "Монгол", "ltr", "mn"],
    ["km", "Khmer", "ខ្មែរ", "ltr", "kh"],
    ["lo", "Lao", "ລາວ", "ltr", "la"],
    ["my", "Burmese", "မြန်မာ", "ltr", "mm"],
    ["ps", "Pashto", "پښتو", "rtl", "af"],
    ["ku", "Kurdish", "Kurdî", "ltr", "iq"],
    ["ca", "Catalan", "Català", "ltr", "es"],
    ["eu", "Basque", "Euskara", "ltr", "es"],
    ["gl", "Galician", "Galego", "ltr", "es"],
    ["ga", "Irish", "Gaeilge", "ltr", "ie"],
    ["cy", "Welsh", "Cymraeg", "ltr", "gb"],
    ["mt", "Maltese", "Malti", "ltr", "mt"],
    ["ht", "Haitian Creole", "Kreyòl ayisyen", "ltr", "ht"]
  ];
  var LANGUAGES = RAW.map(function (r) {
    return { code: r[0], name: r[1], native: r[2], dir: r[3], flag: r[4], g: G[r[0]] || r[0], m: M[r[0]] || r[0] };
  });
  var BY_CODE = {}; LANGUAGES.forEach(function (l) { BY_CODE[l.code] = l; });
  function get(code) { return BY_CODE[code] || null; }
  // Best match for a browser language tag such as "pt-BR" or "zh-Hant-TW".
  function fromBrowser(tag) {
    if (!tag) return 'en';
    var t = String(tag).replace('_', '-');
    if (/^zh/i.test(t)) return /(hant|tw|hk|mo)/i.test(t) ? 'zh-TW' : 'zh';
    var base = t.split('-')[0].toLowerCase();
    if (base === 'nb' || base === 'nn') return 'no';
    if (base === 'tl') return 'fil';
    return BY_CODE[base] ? base : 'en';
  }
  function fill(select) {
    if (!select || select.dataset.filled) return;
    select.dataset.filled = '1';
    select.innerHTML = LANGUAGES.map(function (l) {
      return '<option value="' + l.code + '" data-flag="' + l.flag + '" data-label="' + l.native.replace(/"/g, '&quot;') + '" data-hint="' + l.name + '" data-keywords="' + l.native + '">' + l.native + '</option>';
    }).join('');
  }
  function fillAll(root) { (root || document).querySelectorAll('select[data-languages]').forEach(fill); }
  var API = { list: LANGUAGES, get: get, fromBrowser: fromBrowser, fill: fill, fillAll: fillAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.LangData = API; if (typeof document !== 'undefined') fillAll(); }
})(typeof window !== 'undefined' ? window : this);
