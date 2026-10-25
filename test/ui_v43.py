import json, sys, base64
from playwright.sync_api import sync_playwright
fx = json.load(open('/tmp/fixtures_v38.json')); gid = fx['gid']
errors = []; passed = 0; failed = 0
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
def ok(c, msg):
    global passed, failed
    if c: passed += 1; print('  ✓', msg)
    else: failed += 1; print('  ✗ FAIL:', msg)
def emit(page, ev, data): page.evaluate("([e,d]) => window.__srv.emit(e,d)", [ev, data])
def sent(page, name): return page.evaluate("(n) => (window.__sent||[]).filter(x => x[0]===n).map(x => x[1])", name)
def clear(page): page.evaluate("() => { window.__sent = []; }")
def shot(page, name):
    if SHOTS: page.screenshot(path=f'{SHOTS}/{name}.png')
def route_block(page):
    for pat in ('**/cdnjs.cloudflare.com/**', '**/flagcdn.com/**', '**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**'): page.route(pat, lambda r: r.abort())
def watch(page, tag): page.on('pageerror', lambda e: errors.append(tag + ' PAGEERROR ' + str(e)))
LED = {'currency': 'USD', 'totalDeposited': 100020, 'moneyIn': 100020, 'moneyOut': 20, 'fees': 20, 'withdrawn': 0, 'inProgress': 0, 'held': 0, 'available': 100000, 'other': 0, 'reconciles': True, 'feeItems': []}
def acct(**o): return {**fx['verified'], 'countryIso': 'GH', 'balances': {'available': 100000, 'held': 0, 'pending': 0, 'totalDeposited': 100020}, 'ledger': LED, 'transfersOpen': True, **o}
CID = base64.urlsafe_b64encode(bytes(range(1, 19))).decode().rstrip('=')
MOCK = """
window.__cred = { created: [], got: [], failGet: null, failCreate: null };
const ab = (a) => new Uint8Array(a).buffer; const RAW = Array.from({length: 18}, (_, i) => i + 1);
window.PublicKeyCredential = window.PublicKeyCredential || function () {};
PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => !window.__noBio;
const creds = { create: async (o) => { window.__cred.created.push(o); if (window.__cred.failCreate) throw Object.assign(new Error('x'), { name: window.__cred.failCreate }); return { rawId: ab(RAW), response: { getPublicKey: () => ab([9, 9, 9, 9]), clientDataJSON: ab([1, 2]) } }; },
  get: async (o) => { window.__cred.got.push(o); if (window.__cred.failGet) throw Object.assign(new Error('x'), { name: window.__cred.failGet }); return { rawId: ab(RAW), response: { authenticatorData: ab([1]), clientDataJSON: ab([2]), signature: ab([3]) } }; } };
try { Object.defineProperty(navigator, 'credentials', { value: creds, configurable: true }); } catch (e) { navigator.credentials.create = creds.create; navigator.credentials.get = creds.get; }
"""
def boot(b, a, app=True, local=False, nobio=False, w=390, h=800):
    kw = {'user_agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' + (' VistraApp/1.0' if app else '')}
    ctx = b.new_context(viewport={'width': w, 'height': h}, **kw)
    ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');" + (f"localStorage.setItem('q_bio_{gid}', '{CID}');" if local else '') + ("window.__noBio = true;" if nobio else '') + MOCK)
    page = ctx.new_page(); watch(page, 'SELLER'); route_block(page)
    page.goto(f'http://localhost:8099/?groupId={gid}&role=SELLER', wait_until='load'); page.wait_for_timeout(600)
    emit(page, 'init-state', fx['init']); emit(page, 'seller-account-state', a); emit(page, 'receiving-details', fx['detailsUSD']); page.wait_for_timeout(300)
    page.evaluate("() => { const o = document.getElementById('onboardingOverlay'); if (o) o.remove(); openTxAccountView(); }"); page.wait_for_timeout(350)
    return ctx, page

with sync_playwright() as p:
    b = p.chromium.launch()

    print('\nA. The installed app offers fingerprint once')
    ctx, page = boot(b, acct(pinSet=True), app=True)
    ok(page.is_visible('#v42Pin') and page.locator('#v43BioBtn').count() == 0, 'PIN lock screen first; no fingerprint button yet (this phone is not enrolled)')
    ok(page.locator('#v43Offer').count() == 0, 'no offer while the lock screen is up')
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1100)
    ok(page.is_visible('#v43Offer') and 'Unlock with your fingerprint?' in page.inner_text('#v43Offer') and 'PIN always still works' in page.inner_text('#v43Offer'), 'after unlocking, the app asks: "Unlock with your fingerprint?" (PIN always still works)')
    shot(page, 'v43_offer')
    clear(page); page.click('#v43Offer .send-btn'); page.wait_for_timeout(150)
    ok(sent(page, 'bio-reg-options') == [{'groupId': gid}] and page.locator('#v43Offer.on').count() == 0, 'Turn on fingerprint asks the server to start')
    emit(page, 'bio-reg-options', {'challenge': 'Y2hhbGxlbmdlLWNoYWxsZW5nZS1jaGFsbGVuZ2U', 'rpId': 'localhost', 'userId': 'dXNlcg', 'userName': '48213907765', 'displayName': 'Kwame Mensah', 'exclude': []}); page.wait_for_timeout(350)
    c = page.evaluate("() => window.__cred.created.map(o => ({ rp: o.publicKey.rp.id, att: o.publicKey.authenticatorSelection.authenticatorAttachment, uv: o.publicKey.authenticatorSelection.userVerification, algs: o.publicKey.pubKeyCredParams.map(a => a.alg), attestation: o.publicKey.attestation }))")
    ok(len(c) == 1 and c[0] == {'rp': 'localhost', 'att': 'platform', 'uv': 'required', 'algs': [-7, -257], 'attestation': 'none'}, "the phone's own sensor is requested (platform authenticator, user verification required, no attestation)")
    r = sent(page, 'bio-register')
    ok(len(r) == 1 and r[0]['credentialId'] == CID and r[0]['publicKey'] == 'CQkJCQ' and r[0]['clientDataJSON'] == 'AQI' and r[0]['groupId'] == gid and r[0]['label'] == 'Android phone', 'the new key is sent to the server (public key only)')
    emit(page, 'bio-result', {'ok': True, 'kind': 'enabled', 'id': CID}); emit(page, 'my-bio', {'devices': [{'id': CID, 'label': 'Android phone', 'createdAt': '2026-10-24T10:00:00Z'}], 'pinSet': True}); page.wait_for_timeout(250)
    ok(page.evaluate(f"() => localStorage.getItem('q_bio_{gid}')") == CID and 'Fingerprint unlock is on' in page.inner_text('#toastContainer'), 'on success this phone remembers it and says so')
    ctx.close()

    ctx, page = boot(b, acct(pinSet=True), app=True)
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1100)
    page.click('#v43Offer .ghost-btn'); ok(page.locator('#v43Offer').count() == 0 and page.evaluate(f"() => localStorage.getItem('q_bio_offer_{gid}')") == '1', '"Not now" closes it and it is not asked again')
    emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1100); ok(page.locator('#v43Offer').count() == 0, 'even after the next unlock')
    ctx.close()

    ctx, page = boot(b, acct(pinSet=True), app=False)
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1100)
    ok(page.locator('#v43Offer').count() == 0, 'in a normal browser tab the pop-up offer is not shown (the Security page has the switch)')
    ctx.close()
    ctx, page = boot(b, acct(pinSet=True), app=True, nobio=True)
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1100)
    ok(page.locator('#v43Offer').count() == 0, 'a phone without a fingerprint / face sensor is never offered it')
    ctx.close()

    print('\nB. Lock screen with fingerprint')
    ctx, page = boot(b, acct(pinSet=True), app=True, local=True)
    page.wait_for_timeout(500)
    ok(page.is_visible('#v43BioBtn') and 'Use fingerprint' in page.inner_text('#v43BioBtn') and page.is_visible('#v42Pad'), 'the lock screen offers "Use fingerprint" and keeps the PIN keypad')
    shot(page, 'v43_lock')
    ok(len(sent(page, 'bio-auth-options')) >= 1, 'it asks for the fingerprint by itself as soon as the lock screen opens')
    emit(page, 'bio-auth-options', {'challenge': 'YXV0aC1jaGFsbGVuZ2UtYXV0aC1jaGFsbGVuZ2U', 'rpId': 'localhost', 'ids': [CID]}); page.wait_for_timeout(300)
    g = page.evaluate("() => window.__cred.got.map(o => ({ rp: o.publicKey.rpId, uv: o.publicKey.userVerification, ids: o.publicKey.allowCredentials.length }))")
    ok(g == [{'rp': 'localhost', 'uv': 'required', 'ids': 1}], 'the sensor is asked with user verification required, for this phone\'s key')
    a = sent(page, 'bio-auth')
    ok(len(a) == 1 and a[0]['groupId'] == gid and a[0]['credentialId'] == CID and a[0]['authenticatorData'] == 'AQ' and a[0]['signature'] == 'Aw' and a[0]['clientDataJSON'] == 'Ag', 'the signed answer is sent to the server')
    emit(page, 'pin-result', {'ok': True, 'kind': 'unlock', 'via': 'fingerprint'}); page.wait_for_timeout(250)
    ok(not page.is_visible('#v42Pin') and page.is_visible('#txAccountView'), 'the server accepts it and the account opens')
    ctx.close()
    ctx, page = boot(b, acct(pinSet=True), app=True, local=True)
    page.evaluate("() => { window.__cred.failGet = 'NotAllowedError'; }"); page.wait_for_timeout(300)
    clear(page); page.evaluate("() => { window.__cred.got = []; }"); page.click('#v43BioBtn'); page.wait_for_timeout(200)
    emit(page, 'bio-auth-options', {'challenge': 'YXV0aC1jaGFsbGVuZ2UtYXV0aC1jaGFsbGVuZ2U', 'rpId': 'localhost', 'ids': [CID]}); page.wait_for_timeout(300)
    ok(page.is_visible('#v42Pin') and page.inner_text('#v42PinMsg').strip() == '' and len(sent(page, 'bio-auth')) == 0, 'if the person cancels the fingerprint prompt, nothing is sent and no scary message; the PIN is right there')
    page.evaluate("() => { window.__cred.failGet = null; }"); clear(page)
    page.click('#v43BioBtn'); emit(page, 'bio-auth-options', {'challenge': 'YXV0aC1jaGFsbGVuZ2UtYXV0aC1jaGFsbGVuZ2U', 'rpId': 'localhost', 'ids': [CID]}); page.wait_for_timeout(300)
    emit(page, 'bio-result', {'ok': False, 'kind': 'auth', 'error': 'Your fingerprint could not be verified.'}); page.wait_for_timeout(150)
    ok('could not be verified' in page.inner_text('#v42PinMsg') and page.is_visible('#v42Pad'), 'a refusal from the server is shown and the PIN still works')
    emit(page, 'bio-result', {'ok': False, 'kind': 'auth', 'error': 'x', 'none': True}); page.wait_for_timeout(150)
    ok(page.locator('#v43BioBtn').count() == 0 and page.evaluate(f"() => localStorage.getItem('q_bio_{gid}')") is None, 'if the server says it is no longer turned on, the button goes away')
    ctx.close()
    ctx, page = boot(b, acct(pinSet=True), app=True, local=True)
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(300)
    page.click('#txBottomNav [data-bn=card]'); emit(page, 'my-card', {'eligible': True, 'program': 'AIRWX', 'network': 'Visa', 'status': 'issued', 'fee': {'usd': 20, 'amount': 20, 'currency': 'USD', 'paid': True}, 'balance': {'available': 1, 'enough': True, 'short': 0}, 'verified': True, 'holder': 'K', 'card': {'last4': '1111', 'expMonth': 12, 'expYear': 2031, 'holder': 'K M', 'frozen': False}}); page.wait_for_timeout(200)
    clear(page); emit(page, 'pin-required', {'action': 'reveal'}); page.wait_for_timeout(700)
    ok(page.is_visible('#v43BioBtn') and len(sent(page, 'bio-auth-options')) >= 1, 'showing card details also offers (and starts) the fingerprint prompt')
    ctx.close()

    print('\nC. Security page')
    ctx, page = boot(b, acct(pinSet=True), app=False, nobio=True)
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(300)
    page.evaluate("() => setTxAccountNav('security')"); page.wait_for_timeout(600)
    ok('cannot use fingerprint' in page.inner_text('#v43BioCard') and page.locator('#v43On').count() == 0, 'a phone or browser without a sensor: a plain explanation, no switch')
    ctx.close()
    ctx, page = boot(b, acct(pinSet=False), app=False)
    page.evaluate("() => setTxAccountNav('security')"); page.wait_for_timeout(600)
    ok('Turn on your App PIN first' in page.inner_text('#v43BioCard') and page.locator('#v43On').count() == 0, 'without a PIN: "Turn on your App PIN first"')
    ctx.close()
    ctx, page = boot(b, acct(pinSet=True), app=False)
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(300)
    page.evaluate("() => setTxAccountNav('security')"); page.wait_for_timeout(600)
    ok('Fingerprint unlock' in page.inner_text('#v43BioCard') and 'off' in page.inner_text('#v43BioCard h3').lower() and page.is_visible('#v43On'), 'with a PIN: Fingerprint unlock is Off, with "Turn on for this phone"')
    shot(page, 'v43_security')
    clear(page); page.click('#v43On'); ok(sent(page, 'bio-reg-options') == [{'groupId': gid}], 'turning it on starts setup')
    emit(page, 'pin-required', {'action': 'bio'}); page.wait_for_timeout(200)
    ok(page.is_visible('#v42Pin') and 'turn on fingerprint' in page.inner_text('#v42PinSub').lower(), 'if the PIN was not entered recently, it is asked for first')
    clear(page); page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(300)
    ok(sent(page, 'bio-reg-options') == [{'groupId': gid}], 'and then setup carries on by itself')
    page.evaluate("() => { window.__cred.failCreate = 'NotAllowedError'; }")
    emit(page, 'bio-reg-options', {'challenge': 'Y2hhbGxlbmdlLWNoYWxsZW5nZS1jaGFsbGVuZ2U', 'rpId': 'localhost', 'userId': 'dXNlcg', 'userName': 'u', 'displayName': 'K', 'exclude': []}); page.wait_for_timeout(300)
    ok('cancelled' in page.inner_text('#v43Msg') and len(sent(page, 'bio-register')) == 0, 'cancelling the fingerprint prompt during setup shows a short note, nothing is saved')
    emit(page, 'my-bio', {'devices': [{'id': CID, 'label': 'Android phone', 'createdAt': 'x'}, {'id': 'other-device-id-123456', 'label': 'iPhone', 'createdAt': 'x'}], 'pinSet': True}); page.wait_for_timeout(500)
    page.evaluate(f"() => localStorage.setItem('q_bio_{gid}', '{CID}')"); emit(page, 'my-bio', {'devices': [{'id': CID, 'label': 'Android phone', 'createdAt': 'x'}, {'id': 'other-device-id-123456', 'label': 'iPhone', 'createdAt': 'x'}], 'pinSet': True}); page.wait_for_timeout(500)
    t = page.inner_text('#v43BioCard')
    ok('Android phone' in t and '(this phone)' in t and 'iPhone' in t and page.locator('#v43BioCard .v43-dev button').count() == 2 and page.locator('#v43On').count() == 0, 'phones using it are listed, this one marked, each with Turn off')
    clear(page); page.click('#v43BioCard .v43-dev button >> nth=1'); ok('password' in page.inner_text('#v43Msg').lower() and not sent(page, 'bio-remove'), 'turning one off needs the account password')
    page.fill('#v43Pw', 'Passw0rd!x'); page.click('#v43BioCard .v43-dev button >> nth=1'); ok(sent(page, 'bio-remove') == [{'groupId': gid, 'id': 'other-device-id-123456', 'password': 'Passw0rd!x'}], 'with the password the request is sent')
    ctx.close()

    print('\nD. Everything quiet')
    ok(not errors, 'no JavaScript errors: ' + str(errors))
    b.close()
print(f'\nRESULT: {passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
