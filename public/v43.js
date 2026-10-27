/* v3.15 client layer. Loaded last. It only ADDS to / wraps what earlier layers do.
   Fingerprint / face unlock for the App PIN lock screen, using the phone's own sensor (WebAuthn platform authenticator).
   - one-time offer in the installed app, and a switch on the Security page
   - the lock screen / PIN prompts offer "Use fingerprint"; the PIN always still works */
'use strict';
const v43safe = (fn) => { try { return fn(); } catch (e) { console.warn('[v43]', e); } };
const v43El = (id) => document.getElementById(id);
const v43Esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v43b64u = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const v43buf = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; };
const v43Get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const v43Set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } };
const v43Key = () => 'q_bio_' + (typeof activeGroupId !== 'undefined' ? activeGroupId : 'x');
const v43OfferKey = () => 'q_bio_offer_' + (typeof activeGroupId !== 'undefined' ? activeGroupId : 'x');
const v43Local = () => v43Get(v43Key());
const v43 = { supported: null, devices: null, busy: false, autoTried: false };

function v43Label() { const u = navigator.userAgent; return /iPhone|iPad/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android phone' : /Windows/.test(u) ? 'Windows PC' : /Mac/.test(u) ? 'Mac' : 'This device'; }
// Inside the Android app the sensor is reached through the app's own bridge (window.VistraBio); browsers use WebAuthn.
const v43Native = () => { try { return !!(window.VistraBio && typeof VistraBio.status === 'function'); } catch (e) { return false; } };
const v43NativeCalls = {};
window.__vistraBio = (id, json) => { const f = v43NativeCalls[id]; delete v43NativeCalls[id]; let r = null; try { r = JSON.parse(json); } catch (e) { r = { ok: false, code: 'error' }; } if (f) f(r); };
function v43NativeCall(method, payload) {
  return new Promise((resolve) => {
    const id = 'r' + Date.now() + Math.random().toString(36).slice(2, 8); const t = setTimeout(() => { delete v43NativeCalls[id]; resolve({ ok: false, code: 'error' }); }, 120000);
    v43NativeCalls[id] = (r) => { clearTimeout(t); resolve(r); };
    try { VistraBio[method](id, JSON.stringify(payload)); } catch (e) { clearTimeout(t); delete v43NativeCalls[id]; resolve({ ok: false, code: 'error' }); }
  });
}
const v43ClientData = (type, challenge) => JSON.stringify({ type, challenge, origin: location.origin, crossOrigin: false });
async function v43Detect() {
  if (v43Native()) { try { const st = JSON.parse(VistraBio.status()); v43.reason = st.reason; v43.supported = !!st.supported; } catch (e) { v43.supported = false; } return v43.supported; }
  if (v43.supported !== null) return v43.supported;
  try { v43.supported = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { v43.supported = false; }
  return v43.supported;
}
const v43Pin = () => !!(typeof sellerAccountState !== 'undefined' && sellerAccountState && sellerAccountState.pinSet);
const v43OnHere = () => !!(v43Local() && v43.devices && v43.devices.some((d) => d.id === v43Local()));

// ---- turn on (this phone) ----
function v43Enable() {
  if (v43.busy) return; v43.busy = true; v43Note('');
  const o = v43El('v43Offer'); if (o) o.classList.remove('on');
  socket.emit('bio-reg-options', { groupId: activeGroupId });
}
socket.on('bio-reg-options', async (o) => {
  if (v43Native()) {
    const r = await v43NativeCall('register', { rpId: o.rpId, clientDataJSON: v43ClientData('webauthn.create', o.challenge) });
    if (r && r.ok) { socket.emit('bio-register', { groupId: activeGroupId, credentialId: r.credentialId, publicKey: r.publicKey, clientDataJSON: r.clientDataJSON, label: v43Label() }); return; }
    v43.busy = false; const c = r && r.code;
    v43Note(c === 'cancelled' ? 'Fingerprint setup was cancelled.' : c === 'lockout' ? 'Too many wrong tries. Wait a moment and try again, or keep using your PIN.' : c === 'unsupported' ? 'Add a fingerprint in your phone’s Settings first, then try again.' : 'This phone could not set up fingerprint unlock. You can keep using your PIN.', true);
    return;
  }
  try {
    const cred = await navigator.credentials.create({ publicKey: { rp: { name: 'Vistra', id: o.rpId }, user: { id: v43buf(o.userId), name: String(o.userName), displayName: String(o.displayName) }, challenge: v43buf(o.challenge),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged', requireResidentKey: false },
      attestation: 'none', timeout: 60000, excludeCredentials: (o.exclude || []).map((id) => ({ type: 'public-key', id: v43buf(id) })) } });
    const r = cred.response, pk = r.getPublicKey && r.getPublicKey(); if (!pk) throw new Error('nokey');
    socket.emit('bio-register', { groupId: activeGroupId, credentialId: v43b64u(cred.rawId), publicKey: v43b64u(pk), clientDataJSON: v43b64u(r.clientDataJSON), label: v43Label() });
  } catch (e) {
    v43.busy = false;
    v43Note(e && e.name === 'NotAllowedError' ? 'Fingerprint setup was cancelled.' : e && e.name === 'InvalidStateError' ? 'This phone is already set up. Turn it off first, then on again.' : 'This phone could not set up fingerprint unlock. You can keep using your PIN.', true);
  }
});

// ---- unlock ----
function v43Auth(auto) {
  if (v43.busy || !v43Local() || !v43.supported) return;
  v43.busy = true; socket.emit('bio-auth-options', { groupId: activeGroupId });
}
socket.on('bio-auth-options', async (o) => {
  if (v43Native()) {
    const ids = o.ids || [], local = v43Local(); let id = ids.includes(local) ? local : null;
    try { if (!id || !VistraBio.has(id)) id = ids.find((x) => VistraBio.has(x)) || null; } catch (e) { id = null; }
    if (!id) { v43.busy = false; v43Set(v43Key(), null); v43AddBtn(); v43PinMsg('Fingerprint unlock needs to be turned on again. Use your PIN.'); return; }
    const r = await v43NativeCall('authenticate', { credentialId: id, rpId: o.rpId, clientDataJSON: v43ClientData('webauthn.get', o.challenge) });
    if (r && r.ok) { socket.emit('bio-auth', { groupId: activeGroupId, credentialId: r.credentialId, authenticatorData: r.authenticatorData, clientDataJSON: r.clientDataJSON, signature: r.signature }); return; }
    v43.busy = false; const c = r && r.code;
    if (c === 'invalidated' || c === 'nokey') { v43Set(v43Key(), null); v43AddBtn(); v43PinMsg('Your phone’s fingerprints changed, so fingerprint unlock was switched off for safety. Use your PIN, then turn it on again in Security.'); }
    else if (c === 'lockout') v43PinMsg('Too many wrong tries. Wait a moment, or use your PIN.');
    else if (c !== 'cancelled') v43PinMsg('Fingerprint is not available right now. Use your PIN.');
    return;
  }
  try {
    const local = v43Local(), ids = o.ids || [], use = ids.includes(local) ? [local] : ids;
    const a = await navigator.credentials.get({ publicKey: { challenge: v43buf(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 60000, allowCredentials: use.map((id) => ({ type: 'public-key', id: v43buf(id), transports: ['internal'] })) } });
    const r = a.response;
    socket.emit('bio-auth', { groupId: activeGroupId, credentialId: v43b64u(a.rawId), authenticatorData: v43b64u(r.authenticatorData), clientDataJSON: v43b64u(r.clientDataJSON), signature: v43b64u(r.signature) });
  } catch (e) {
    v43.busy = false;
    if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') v43PinMsg('Fingerprint is not available right now. Use your PIN.');
  }
});
function v43PinMsg(t) { const m = v43El('v42PinMsg'); if (m) m.textContent = t || ''; }
function v43Note(t, err) { const m = v43El('v43Msg'); if (m) { m.style.color = err ? 'var(--accent-rose)' : ''; m.textContent = t || ''; } if (t && err && !m) toast(t, true); }

socket.on('bio-result', (r) => v43safe(() => {
  v43.busy = false; if (!r) return;
  if (r.kind === 'enabled' && r.ok) { v43Set(v43Key(), r.id); v43Set(v43OfferKey(), '1'); toast('Fingerprint unlock is on for this phone.'); socket.emit('get-my-bio', { groupId: activeGroupId }); return; }
  if (r.kind === 'removed' && r.ok) { if (r.id) { try { if (v43Native()) VistraBio.remove(r.id); } catch (e) { /* ignore */ } } if (r.id && r.id === v43Local()) v43Set(v43Key(), null); toast('Fingerprint unlock turned off.'); return; }
  if (r.kind === 'auth') { v43PinMsg(r.none ? '' : (r.error || 'Fingerprint not recognised. Use your PIN.')); if (r.none) { v43Set(v43Key(), null); v43AddBtn(); } return; }
  const pw = v43El('v43Pw'); if (r.field === 'password' && pw) pw.focus();
  v43Note(r.error || 'Something went wrong.', true);
}));
socket.on('my-bio', (d) => v43safe(() => {
  v43.devices = (d && d.devices) || []; if (v43Local() && !v43.devices.some((x) => x.id === v43Local())) v43Set(v43Key(), null);
  if (v43El('txSecurityBody') && v43El('v43BioCard')) renderSecurity(); v43AddBtn();
}));

// ---- lock screen / PIN prompt: "Use fingerprint" ----
function v43AddBtn() {
  const o = v43El('v42Pin'); if (!o || !o.classList.contains('on')) return;
  const has = v43Local() && v43.supported, b = v43El('v43BioBtn');
  if (!has) { if (b) b.remove(); return; }
  if (!b) { const foot = o.querySelector('.v42-pin-foot'); if (foot) foot.insertAdjacentHTML('beforebegin', '<button type="button" class="v43-bio" id="v43BioBtn"><i class="fa-solid fa-fingerprint"></i> Use fingerprint</button>'); const nb = v43El('v43BioBtn'); if (nb) nb.addEventListener('click', () => v43Auth(false)); }
}
const _pinOpenV43 = v42PinOpen;
v42PinOpen = function (mode) {
  _pinOpenV43(mode);
  v43Detect().then(() => { v43AddBtn(); if (v43Local() && v43.supported && !v43.busy) setTimeout(() => { const o = v43El('v42Pin'); if (o && o.classList.contains('on')) v43Auth(true); }, 350); });
};
v42PinSub.bio = 'Enter your PIN to turn on fingerprint unlock.';
const _pinRetryV43 = v42PinRetry;
v42PinRetry = function (p) { if (p === 'bio') return v43Enable(); return _pinRetryV43(p); };
socket.on('pin-required', () => { v43.busy = false; });
socket.on('pin-result', (r) => v43safe(() => {
  if (!r) return; v43.busy = false;
  if (r.kind === 'unlock' && !r.ok) v43AddBtn();
  if (r.ok && (r.kind === 'unlock' || r.kind === 'set')) { socket.emit('get-my-bio', { groupId: activeGroupId }); setTimeout(v43MaybeOffer, 700); }
  if (r.ok && r.kind === 'removed') { v43Set(v43Key(), null); v43.devices = []; }
}));

// ---- one-time offer in the installed app ----
function v43Standalone() { try { return window.VInstall ? !!VInstall.standalone() : (/VistraApp\//.test(navigator.userAgent) || matchMedia('(display-mode: standalone)').matches); } catch (e) { return false; } }
async function v43MaybeOffer() {
  if (!v43Standalone() || !v43Pin() || v43Local() || v43Get(v43OfferKey()) === '1' || v43El('v43Offer')) return;
  if (!(await v43Detect())) return;
  const pin = v43El('v42Pin'); if (pin && pin.classList.contains('on')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="v43-offer on" id="v43Offer" role="dialog" aria-modal="true" aria-label="Fingerprint unlock"><div class="v43-card">
    <div class="v43-ic"><i class="fa-solid fa-fingerprint"></i></div><h2>Unlock with your fingerprint?</h2>
    <p>Open your account and confirm card and transfer actions with your fingerprint instead of typing your PIN. Your PIN always still works.</p>
    <button class="send-btn" type="button" onclick="v43Enable()"><i class="fa-solid fa-fingerprint"></i> Turn on fingerprint</button>
    <button class="ghost-btn" type="button" onclick="v43Dismiss()">Not now</button></div></div>`);
}
function v43Dismiss() { v43Set(v43OfferKey(), '1'); const o = v43El('v43Offer'); if (o) o.remove(); }

// ---- Security page card ----
const _renderSecV43 = renderSecurity;
renderSecurity = function () {
  _renderSecV43();
  v43safe(() => {
    const body = v43El('txSecurityBody'), a = typeof sellerAccountState !== 'undefined' && sellerAccountState; if (!body || !a || body.querySelector('.v43-biocard')) return;
    v43Detect().then(() => {
      if (!v43El('txSecurityBody') || v43El('txSecurityBody').querySelector('.v43-biocard')) return;
      const pinCard = body.querySelector('.v42-pincard'), here = v43OnHere(), devs = v43.devices || [];
      let inner;
      if (!v43.supported) inner = v43.reason === 'not_enrolled' ? '<p class="sec-sub">No fingerprint is saved on this phone yet. Add one in your phone’s Settings (Security / Biometrics), then come back here. Your PIN works meanwhile.</p>' : v43.reason === 'old_android' ? '<p class="sec-sub">Fingerprint unlock in the app needs Android 9 or newer. Your PIN works everywhere.</p>' : '<p class="sec-sub">This phone or browser cannot use fingerprint unlock. Open Vistra on your phone (or install the app) to use it. Your PIN works everywhere.</p>';
      else if (!a.pinSet) inner = '<p class="sec-sub">Turn on your App PIN first. Fingerprint unlock works on top of your PIN.</p>';
      else inner = `<p class="sec-sub">Use your phone’s fingerprint (or face unlock, depending on your phone) to open your account and confirm card and transfer actions. Your PIN always still works.</p>
        ${devs.length ? `<div class="v43-devs">${devs.map((d) => `<div class="v43-dev"><i class="fa-solid fa-mobile-screen"></i><span>${v43Esc(d.label)}${d.id === v43Local() ? ' <em>(this phone)</em>' : ''}</span><button type="button" class="admin-btn" onclick="v43Off('${v43Esc(d.id)}')">Turn off</button></div>`).join('')}</div>
        <label class="gate-field"><span>Account password (needed to turn it off)</span><input id="v43Pw" type="password" autocomplete="current-password" placeholder="Your account password"></label>` : ''}
        <div id="v43Msg" class="gate-msg" role="alert"></div>
        ${here ? '' : '<button class="send-btn" type="button" id="v43On" onclick="v43Enable()"><i class="fa-solid fa-fingerprint"></i> Turn on for this phone</button>'}`;
      const html = `<div class="sec-card v43-biocard" id="v43BioCard"><h3><i class="fa-solid fa-fingerprint"></i> Fingerprint unlock <span class="v42-pill ${here ? 'ok' : 'warn'}">${here ? 'On' : 'Off'}</span></h3>${inner}</div>`;
      if (pinCard) pinCard.insertAdjacentHTML('afterend', html); else body.insertAdjacentHTML('afterbegin', html);
    });
    if (v43.devices === null) socket.emit('get-my-bio', { groupId: activeGroupId });
  });
};
function v43Off(id) {
  const pw = v43El('v43Pw'); if (!pw || !pw.value) { v43Note('Enter your account password to turn this off.', true); if (pw) pw.focus(); return; }
  socket.emit('bio-remove', { groupId: activeGroupId, id, password: pw.value });
}
// when the account opens with a PIN, learn which phones use fingerprint
socket.on('seller-account-state', () => setTimeout(() => v43safe(() => { const a = typeof sellerAccountState !== 'undefined' && sellerAccountState; if (a && a.pinSet && v43.devices === null) socket.emit('get-my-bio', { groupId: activeGroupId }); }), 60));
