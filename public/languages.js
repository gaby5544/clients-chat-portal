// Languages offered to every user. `code` is what the translation service
// expects; `flag` is an ISO country code used only to draw a small flag;
// `native` is shown so people can always recognise their own language even
// when the interface is currently in one they cannot read.
(function (root) {
  var RAW = [
    ['en','English','English','gb'],['es','Spanish','Español','es'],['fr','French','Français','fr'],['de','German','Deutsch','de'],
    ['it','Italian','Italiano','it'],['pt','Portuguese','Português','pt'],['nl','Dutch','Nederlands','nl'],['sv','Swedish','Svenska','se'],
    ['da','Danish','Dansk','dk'],['no','Norwegian','Norsk','no'],['fi','Finnish','Suomi','fi'],['pl','Polish','Polski','pl'],
    ['cs','Czech','Čeština','cz'],['sk','Slovak','Slovenčina','sk'],['hu','Hungarian','Magyar','hu'],['ro','Romanian','Română','ro'],
    ['bg','Bulgarian','Български','bg'],['el','Greek','Ελληνικά','gr'],['tr','Turkish','Türkçe','tr'],['ru','Russian','Русский','ru'],
    ['uk','Ukrainian','Українська','ua'],['ar','Arabic','العربية','sa'],['he','Hebrew','עברית','il'],['fa','Persian','فارسی','ir'],
    ['ur','Urdu','اردو','pk'],['hi','Hindi','हिन्दी','in'],['bn','Bengali','বাংলা','bd'],['ta','Tamil','தமிழ்','in'],
    ['te','Telugu','తెలుగు','in'],['mr','Marathi','मराठी','in'],['gu','Gujarati','ગુજરાતી','in'],['pa','Punjabi','ਪੰਜਾਬੀ','in'],
    ['ne','Nepali','नेपाली','np'],['si','Sinhala','සිංහල','lk'],['th','Thai','ไทย','th'],['vi','Vietnamese','Tiếng Việt','vn'],
    ['id','Indonesian','Bahasa Indonesia','id'],['ms','Malay','Bahasa Melayu','my'],['tl','Filipino','Filipino','ph'],
    ['zh-CN','Chinese (Simplified)','简体中文','cn'],['zh-TW','Chinese (Traditional)','繁體中文','tw'],['ja','Japanese','日本語','jp'],
    ['ko','Korean','한국어','kr'],['sw','Swahili','Kiswahili','ke'],['am','Amharic','አማርኛ','et'],['ha','Hausa','Hausa','ng'],
    ['yo','Yoruba','Yorùbá','ng'],['ig','Igbo','Igbo','ng'],['zu','Zulu','isiZulu','za'],['af','Afrikaans','Afrikaans','za'],['so','Somali','Soomaali','so']
  ];
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1 };
  var LANGUAGES = RAW.map(function (r) { return { code: r[0], name: r[1], native: r[2], flag: r[3], rtl: !!RTL[r[0]] }; });
  var BY_CODE = {}; LANGUAGES.forEach(function (l) { BY_CODE[l.code] = l; });
  function findLanguage(code) { return BY_CODE[code] || BY_CODE[String(code || '').split('-')[0]] || null; }
  function isSupported(code) { return !!BY_CODE[code]; }
  var api = { LANGUAGES: LANGUAGES, findLanguage: findLanguage, isSupported: isSupported };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QLanguages = api;
})(typeof window !== 'undefined' ? window : globalThis);
