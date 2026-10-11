/* Shared install helper: detects the device/browser and returns the exact steps to install the app. */
(function () {
  const ua = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;     // iPadOS reports itself as a Mac
  const ios = /iphone|ipad|ipod/i.test(ua) || touchMac;
  const android = /android/i.test(ua);
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|Telegram|Twitter|MicroMessenger|; wv\)/i.test(ua);
  const edge = /Edg\//.test(ua), samsung = /SamsungBrowser/i.test(ua), firefox = /Firefox|FxiOS/i.test(ua), opera = /OPR\//.test(ua);
  const chrome = /Chrome\/|CriOS/.test(ua) && !edge && !samsung && !opera;
  const safari = /Safari\//.test(ua) && !chrome && !edge && !firefox && !opera && !samsung;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const device = ios ? (/ipad/i.test(ua) || touchMac ? 'iPad' : 'iPhone') : android ? 'Android' : /Windows/i.test(ua) ? 'Windows PC' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux|CrOS/i.test(ua) ? 'computer' : 'device';

  function steps(canPrompt) {
    if (standalone()) return { title: 'The app is already installed', steps: ['Open Vistra from your home screen, Start menu or app launcher.'], ok: true };
    if (inApp) return { title: 'Open in your browser first', steps: [`Tap the menu (⋮ or ⋯) in the corner of this screen.`, ios ? 'Choose “Open in Safari”.' : 'Choose “Open in browser” (or “Open in Chrome”).', 'Then come back here and tap Install.'] };
    if (ios) return { title: `Install on your ${device}`, steps: safari ? ['Tap the Share button (the square with an arrow) at the bottom of Safari.', 'Scroll down and tap “Add to Home Screen”.', 'Tap “Add”. Vistra now opens full-screen like any other app.'] : ['Tap the Share button in your browser.', 'Choose “Add to Home Screen”. (If you do not see it, open this page in Safari.)', 'Tap “Add”. Vistra now opens full-screen like any other app.'] };
    if (android) return { title: 'Install on your Android phone', steps: canPrompt ? ['Tap “Install now” below and confirm.', 'Vistra is added to your home screen and app drawer.'] : samsung ? ['Tap the menu (☰) in Samsung Internet.', 'Choose “Add page to” → “Home screen”.', 'Tap “Add”.'] : firefox ? ['Tap the menu (⋮) in Firefox.', 'Choose “Install”.', 'Confirm — Vistra is added to your home screen.'] : ['Tap the menu (⋮) in Chrome.', 'Choose “Install app” (or “Add to Home screen”).', 'Confirm — Vistra is added to your home screen and app drawer.'] };
    if (firefox) return { title: 'Use Chrome or Edge to install', steps: ['Firefox on computers cannot install web apps.', 'Open this page in Google Chrome or Microsoft Edge.', 'Then click the install icon in the address bar and choose Install.'] };
    if (safari && device === 'Mac') return { title: 'Install on your Mac', steps: ['In Safari choose File → “Add to Dock…”.', 'Click “Add”. Vistra opens in its own window from the Dock.'] };
    return { title: `Install on your ${device}`, steps: canPrompt ? ['Click “Install now” below and confirm.', 'Vistra opens in its own window and is added to your Start menu / Applications.'] : ['Click the install icon at the right end of the address bar (a screen with a down arrow).', 'Or open the browser menu (⋮) → “Install Vistra” / “Save and share” → “Install page as app”.', 'Confirm — Vistra opens in its own window.'] };
  }
  window.VInstall = { ios, android, inApp, device, standalone, steps };
})();
