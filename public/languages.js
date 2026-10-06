/* Supported interface / chat languages — shared by the browser and the server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LANG_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var list = [
    { c: 'en', n: 'English', e: 'English' }, { c: 'es', n: 'Español', e: 'Spanish' }, { c: 'fr', n: 'Français', e: 'French' },
    { c: 'de', n: 'Deutsch', e: 'German' }, { c: 'it', n: 'Italiano', e: 'Italian' }, { c: 'pt', n: 'Português', e: 'Portuguese' },
    { c: 'nl', n: 'Nederlands', e: 'Dutch' }, { c: 'ru', n: 'Русский', e: 'Russian' }, { c: 'uk', n: 'Українська', e: 'Ukrainian' },
    { c: 'pl', n: 'Polski', e: 'Polish' }, { c: 'tr', n: 'Türkçe', e: 'Turkish' }, { c: 'ar', n: 'العربية', e: 'Arabic', rtl: true },
    { c: 'he', n: 'עברית', e: 'Hebrew', rtl: true }, { c: 'fa', n: 'فارسی', e: 'Persian', rtl: true }, { c: 'ur', n: 'اردو', e: 'Urdu', rtl: true },
    { c: 'hi', n: 'हिन्दी', e: 'Hindi' }, { c: 'bn', n: 'বাংলা', e: 'Bengali' }, { c: 'ta', n: 'தமிழ்', e: 'Tamil' },
    { c: 'zh', n: '中文 (简体)', e: 'Chinese (Simplified)' }, { c: 'zh-TW', n: '中文 (繁體)', e: 'Chinese (Traditional)' },
    { c: 'ja', n: '日本語', e: 'Japanese' }, { c: 'ko', n: '한국어', e: 'Korean' }, { c: 'vi', n: 'Tiếng Việt', e: 'Vietnamese' },
    { c: 'th', n: 'ไทย', e: 'Thai' }, { c: 'id', n: 'Bahasa Indonesia', e: 'Indonesian' }, { c: 'ms', n: 'Bahasa Melayu', e: 'Malay' },
    { c: 'tl', n: 'Filipino', e: 'Filipino' }, { c: 'sw', n: 'Kiswahili', e: 'Swahili' }, { c: 'ha', n: 'Hausa', e: 'Hausa' },
    { c: 'yo', n: 'Yorùbá', e: 'Yoruba' }, { c: 'ig', n: 'Igbo', e: 'Igbo' }, { c: 'am', n: 'አማርኛ', e: 'Amharic' },
    { c: 'zu', n: 'isiZulu', e: 'Zulu' }, { c: 'af', n: 'Afrikaans', e: 'Afrikaans' }, { c: 'el', n: 'Ελληνικά', e: 'Greek' },
    { c: 'ro', n: 'Română', e: 'Romanian' }, { c: 'hu', n: 'Magyar', e: 'Hungarian' }, { c: 'cs', n: 'Čeština', e: 'Czech' },
    { c: 'sk', n: 'Slovenčina', e: 'Slovak' }, { c: 'bg', n: 'Български', e: 'Bulgarian' }, { c: 'sr', n: 'Српски', e: 'Serbian' },
    { c: 'hr', n: 'Hrvatski', e: 'Croatian' }, { c: 'sv', n: 'Svenska', e: 'Swedish' }, { c: 'da', n: 'Dansk', e: 'Danish' },
    { c: 'no', n: 'Norsk', e: 'Norwegian' }, { c: 'fi', n: 'Suomi', e: 'Finnish' }
  ];
  var byCode = {};
  list.forEach(function (l) { byCode[l.c.toLowerCase()] = l; });
  function find(code) {
    if (!code) return null;
    var k = String(code).toLowerCase();
    if (byCode[k]) return byCode[k];
    var base = k.split('-')[0];
    return byCode[base] || null;
  }
  function isRtl(code) { var l = find(code); return !!(l && l.rtl); }
  return { list: list, find: find, isRtl: isRtl };
});
