/* Shared install helper: detects the device/browser and returns the exact steps to install the app. */
(function () {
  const ua = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;     // iPadOS reports itself as a Mac
  const ios = /iphone|ipad|ipod/i.test(ua) || touchMac;
  const android = /android/i.test(ua);
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|Telegram|Twitter|MicroMessenger|; wv\)/i.test(ua);
  const edge = /Edg(e|A|iOS)?\//.test(ua), samsung = /SamsungBrowser/i.test(ua), firefox = /Firefox|FxiOS/i.test(ua), opera = /OPR\/|OPT\/|Opera/i.test(ua);
  const chrome = /Chrome\/|CriOS/.test(ua) && !edge && !samsung && !opera;
  const safari = /Safari\//.test(ua) && !chrome && !edge && !firefox && !opera && !samsung;
  const standalone = () => /VistraApp\//.test(ua) || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const device = ios ? (/ipad/i.test(ua) || touchMac ? 'iPad' : 'iPhone') : android ? 'Android' : /Windows/i.test(ua) ? 'Windows PC' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux|CrOS/i.test(ua) ? 'computer' : 'device';

  function steps(canPrompt) {
    if (standalone()) return { title: 'The app is already installed', steps: ['Open Vistra from your home screen, Start menu or app launcher.'], ok: true };
    if (inApp) return { title: 'Open in your browser first', steps: [`Tap the menu (⋮ or ⋯) in the corner of this screen.`, ios ? 'Choose “Open in Safari”.' : 'Choose “Open in browser” (or “Open in Chrome”).', 'Then come back here and tap Install.'] };
    if (ios) return { title: `Install on your ${device}`, steps: safari ? ['Tap the Share button (the square with an arrow) at the bottom of Safari.', 'Scroll down and tap “Add to Home Screen”.', 'Tap “Add”. Vistra now opens full-screen like any other app.'] : ['Tap the Share button in your browser.', 'Choose “Add to Home Screen”. (If you do not see it, open this page in Safari.)', 'Tap “Add”. Vistra now opens full-screen like any other app.'] };
    if (android) return { title: 'Install on your Android phone', steps: canPrompt ? ['Tap “Install now” below and confirm.', 'Vistra is added to your home screen and app drawer.'] : samsung ? ['Tap the menu (☰) in Samsung Internet.', 'Choose “Add page to” → “Home screen”.', 'Tap “Add”.'] : firefox ? ['Tap the menu (⋮) in Firefox.', 'Choose “Install”.', 'Confirm — Vistra is added to your home screen.'] : ['Tap the browser menu (⋮ or ≡).', 'Choose “Install app”, “Add to Home screen” or “Add to phone”.', 'Confirm — Vistra is added to your home screen and app drawer.'] };
    if (firefox) return { title: 'Use Chrome or Edge to install', steps: ['Firefox on computers cannot install web apps.', 'Open this page in Google Chrome or Microsoft Edge.', 'Then click the install icon in the address bar and choose Install.'] };
    if (safari && device === 'Mac') return { title: 'Install on your Mac', steps: ['In Safari choose File → “Add to Dock…”.', 'Click “Add”. Vistra opens in its own window from the Dock.'] };
    return { title: `Install on your ${device}`, steps: canPrompt ? ['Click “Install now” below and confirm.', 'Vistra opens in its own window and is added to your Start menu / Applications.'] : ['Click the install icon at the right end of the address bar (a screen with a down arrow).', 'Or open the browser menu (⋮) → “Install Vistra” / “Save and share” → “Install page as app”.', 'Confirm — Vistra opens in its own window.'] };
  }
  const win = /Windows/i.test(ua), mac = /Mac OS X|Macintosh/i.test(ua) && !ios;
  const platform = ios ? 'ios' : android ? 'android' : win ? 'windows' : mac ? 'mac' : 'other';
  const FILES = { android: { url: '/downloads/Vistra.apk', name: 'Vistra.apk', label: 'Download for Android', os: 'Android' }, windows: { url: '/downloads/Vistra-Setup.exe', name: 'Vistra-Setup.exe', label: 'Download for Windows', os: 'Windows' } };
  const file = (p) => FILES[p || platform] || null;
  /** What to do once the file has downloaded (or, on iPhone, the only way Apple allows). */
  const after = (p) => ({
    android: ['Open the downloaded file “Vistra.apk” — tap the download notification, or find it in Files → Downloads.', 'If Android asks, tap Settings → turn on “Allow from this source” (first time only), then go back.', 'Tap Install, then Open. Vistra is now on your home screen with its own icon.'],
    windows: ['Open “Vistra-Setup.exe” from your Downloads.', 'If Windows shows “Windows protected your PC”, click More info → Run anyway. (It appears for any new app — nothing is wrong.)', 'Finish the installer. A Vistra icon appears on your desktop and in the Start menu.'],
    ios: ['Open this page in Safari.', 'Tap the Share button, then “Add to Home Screen”, then “Add”.', 'Apple does not allow apps to be downloaded outside the App Store, so this is the only way on iPhone and iPad. Vistra then opens full-screen like any app.'],
    mac: ['A downloadable app is available for Android and Windows.', 'On a Mac, open Vistra in Safari and choose File → Add to Dock — or simply keep using it in your browser.'],
    other: ['A downloadable app is available for Android and Windows.', 'On this device, keep using Vistra in your browser.']
  }[p || platform]);
  const chromeLike = chrome && !edge && !samsung && !opera;
  const browser = edge ? 'Edge' : samsung ? 'Samsung Internet' : opera ? 'Opera' : firefox ? 'Firefox' : chromeLike ? 'Chrome' : safari ? 'Safari' : 'your browser';
  /** Android: link that opens this exact page in Chrome, where one-tap install works. */
  const chromeIntent = () => `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
  window.VInstall = { platform, file, after, apkUrl: '/downloads/Vistra.apk', ios, android, inApp, device, browser, chromeLike, standalone, steps, chromeIntent };
})();
