import json, sys
from playwright.sync_api import sync_playwright
fx = json.load(open('/tmp/fixtures_v38.json')); gid = fx['gid']
errors = []; passed = 0; failed = 0
def ok(c, msg):
    global passed, failed
    if c: passed += 1; print('  ✓', msg)
    else: failed += 1; print('  ✗ FAIL:', msg)
def emit(page, ev, data): page.evaluate("([e,d]) => window.__srv.emit(e,d)", [ev, data])
def sent(page, name): return page.evaluate("(n) => (window.__sent||[]).filter(x => x[0]===n).map(x => x[1])", name)
def clear(page): page.evaluate("() => { window.__sent = []; }")
LED = {'currency': 'USD', 'totalDeposited': 100020, 'moneyIn': 100020, 'moneyOut': 20, 'fees': 20, 'withdrawn': 0, 'inProgress': 0, 'held': 0, 'available': 100000, 'other': 0, 'reconciles': True, 'feeItems': []}
def acct(**o): return {**fx['verified'], 'countryIso': 'GH', 'balances': {'available': 100000, 'held': 0, 'pending': 0, 'totalDeposited': 100020}, 'ledger': LED, 'transfersOpen': True, **o}
ID = 'AwoRGB8mLTQ7QkkQ'  # 22-char id like the app makes
# A stand-in for the Android bridge (window.VistraBio). No navigator.credentials at all, like a real WebView.
MOCK = """
window.__nat = { calls: [], status: {supported: true, reason: 'ready'}, keys: [], reply: null, auto: true };
window.VistraBio = {
  status: () => JSON.stringify(window.__nat.status),
  has: (id) => window.__nat.keys.includes(id),
  remove: (id) => { window.__nat.calls.push(['remove', id]); window.__nat.keys = window.__nat.keys.filter(k => k !== id); return true; },
  register: (rid, j) => { window.__nat.calls.push(['register', rid, JSON.parse(j)]); if (window.__nat.auto) setTimeout(() => window.__vistraBio(rid, JSON.stringify(window.__nat.reply || {ok: true, credentialId: 'AwoRGB8mLTQ7QkkQ', publicKey: 'cHVi', clientDataJSON: 'Y2Q'})), 20); },
  authenticate: (rid, j) => { window.__nat.calls.push(['authenticate', rid, JSON.parse(j)]); if (window.__nat.auto) setTimeout(() => window.__vistraBio(rid, JSON.stringify(window.__nat.reply || {ok: true, credentialId: 'AwoRGB8mLTQ7QkkQ', authenticatorData: 'YWQ', clientDataJSON: 'Y2Q', signature: 'c2ln'})), 20); },
};
"""
def boot(b, a, local=False, mock_extra=''):
    ctx = b.new_context(viewport={'width': 390, 'height': 800}, user_agent='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 VistraApp/1.1')
    ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');" + (f"localStorage.setItem('q_bio_{gid}', '{ID}');" if local else '') + MOCK + mock_extra)
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    for pat in ('**/cdnjs.cloudflare.com/**', '**/flagcdn.com/**', '**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**'): page.route(pat, lambda r: r.abort())
    page.goto(f'http://localhost:8099/?groupId={gid}&role=SELLER', wait_until='load'); page.wait_for_timeout(600)
    emit(page, 'init-state', fx['init']); emit(page, 'seller-account-state', a); emit(page, 'receiving-details', fx['detailsUSD']); page.wait_for_timeout(300)
    page.evaluate("() => { const o = document.getElementById('onboardingOverlay'); if (o) o.remove(); openTxAccountView(); }"); page.wait_for_timeout(350)
    return ctx, page
OPT = {'challenge': 'Y2hhbGxlbmdlLWNoYWxsZW5nZS1jaGFsbGVuZ2U', 'rpId': 'localhost', 'userId': 'dXNlcg', 'userName': 'u', 'displayName': 'K', 'exclude': []}
AOPT = {'challenge': 'YXV0aC1jaGFsbGVuZ2UtYXV0aC1jaGFsbGVuZ2U', 'rpId': 'localhost', 'ids': [ID]}

with sync_playwright() as p:
    b = p.chromium.launch()
    print('\nA. Inside the Android app: turning it on')
    ctx, page = boot(b, acct(pinSet=True))
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1100)
    ok(page.is_visible('#v43Offer'), 'the app offers fingerprint after the first unlock (no browser sensor needed)')
    clear(page); page.click('#v43Offer .send-btn'); page.wait_for_timeout(100)
    emit(page, 'bio-reg-options', OPT); page.wait_for_timeout(300)
    c = page.evaluate("() => window.__nat.calls.filter(x => x[0]==='register')")
    ok(len(c) == 1 and c[0][2]['rpId'] == 'localhost', 'the app is asked to create the key for this website')
    cd = json.loads(c[0][2]['clientDataJSON']) if c else {}
    ok(cd.get('type') == 'webauthn.create' and cd.get('challenge') == OPT['challenge'] and cd.get('origin') == 'http://localhost:8099', 'the request carries the server challenge and the website address')
    r = sent(page, 'bio-register')
    ok(len(r) == 1 and r[0]['credentialId'] == ID and r[0]['publicKey'] == 'cHVi' and r[0]['clientDataJSON'] == 'Y2Q' and r[0]['label'] == 'Android phone', 'only the public key goes to the server')
    emit(page, 'bio-result', {'ok': True, 'kind': 'enabled', 'id': ID}); page.wait_for_timeout(200)
    ok(page.evaluate(f"() => localStorage.getItem('q_bio_{gid}')") == ID, 'this phone remembers it is on')
    ctx.close()

    print('\nB. Setup problems are explained')
    for code, text in (('cancelled', 'cancelled'), ('lockout', 'Too many wrong tries'), ('unsupported', 'Add a fingerprint'), ('error', 'could not set up')):
        ctx, page = boot(b, acct(pinSet=True))
        page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1000)
        if page.locator('#v43Offer .ghost-btn').count(): page.click('#v43Offer .ghost-btn')
        page.evaluate("() => setTxAccountNav('security')"); page.wait_for_timeout(600)
        page.evaluate("c => { window.__nat.reply = {ok: false, code: c}; }", code)
        clear(page); page.click('#v43On'); emit(page, 'bio-reg-options', OPT); page.wait_for_timeout(300)
        ok(text in page.inner_text('#v43Msg') and not sent(page, 'bio-register'), f'code "{code}" shows a clear note and saves nothing')
        ctx.close()

    print('\nC. Unlocking with the fingerprint in the app')
    ctx, page = boot(b, acct(pinSet=True), local=True, mock_extra=f"window.__nat.keys = ['{ID}'];")
    page.wait_for_timeout(500)
    ok(page.is_visible('#v43BioBtn') and len(sent(page, 'bio-auth-options')) >= 1, 'lock screen shows "Use fingerprint" and starts the prompt by itself')
    emit(page, 'bio-auth-options', AOPT); page.wait_for_timeout(300)
    c = page.evaluate("() => window.__nat.calls.filter(x => x[0]==='authenticate')")
    cd = json.loads(c[0][2]['clientDataJSON']) if c else {}
    ok(len(c) == 1 and c[0][2]['credentialId'] == ID and cd.get('type') == 'webauthn.get' and cd.get('challenge') == AOPT['challenge'], 'the app is asked to sign this challenge with this phone\'s key')
    a = sent(page, 'bio-auth')
    ok(len(a) == 1 and a[0]['signature'] == 'c2ln' and a[0]['authenticatorData'] == 'YWQ' and a[0]['credentialId'] == ID, 'the signed answer is sent to the server')
    emit(page, 'pin-result', {'ok': True, 'kind': 'unlock', 'via': 'fingerprint'}); page.wait_for_timeout(250)
    ok(not page.is_visible('#v42Pin'), 'the account opens')
    ctx.close()

    ctx, page = boot(b, acct(pinSet=True), local=True, mock_extra=f"window.__nat.keys = ['{ID}'];")
    page.evaluate("() => { window.__nat.reply = {ok: false, code: 'cancelled'}; }"); clear(page); page.click('#v43BioBtn'); emit(page, 'bio-auth-options', AOPT); page.wait_for_timeout(300)
    ok(page.is_visible('#v42Pin') and page.inner_text('#v42PinMsg').strip() == '' and not sent(page, 'bio-auth'), '"Use PIN instead" / cancel: no error, PIN keypad is right there')
    page.evaluate("() => { window.__nat.reply = {ok: false, code: 'lockout'}; }"); page.click('#v43BioBtn'); emit(page, 'bio-auth-options', AOPT); page.wait_for_timeout(300)
    ok('Too many wrong tries' in page.inner_text('#v42PinMsg'), 'too many wrong fingers: told to wait or use the PIN')
    page.evaluate("() => { window.__nat.reply = {ok: false, code: 'invalidated'}; }"); page.click('#v43BioBtn'); emit(page, 'bio-auth-options', AOPT); page.wait_for_timeout(300)
    ok('fingerprints changed' in page.inner_text('#v42PinMsg') and page.locator('#v43BioBtn').count() == 0 and page.evaluate(f"() => localStorage.getItem('q_bio_{gid}')") is None, 'phone\'s fingerprints changed: switched off for safety, PIN still works')
    ctx.close()
    ctx, page = boot(b, acct(pinSet=True), local=True)   # key is gone from the phone
    page.wait_for_timeout(500); emit(page, 'bio-auth-options', AOPT); page.wait_for_timeout(300)
    ok('turned on again' in page.inner_text('#v42PinMsg') and page.locator('#v43BioBtn').count() == 0, 'if the key is no longer on the phone, it says so and offers the PIN')
    ctx.close()

    print('\nD. Phones that cannot do it')
    for st, txt in (({'supported': False, 'reason': 'not_enrolled'}, 'No fingerprint is saved'), ({'supported': False, 'reason': 'old_android'}, 'Android 9 or newer'), ({'supported': False, 'reason': 'no_sensor'}, 'cannot use fingerprint')):
        ctx, page = boot(b, acct(pinSet=True), mock_extra=f"window.__nat.status = {json.dumps(st)};")
        page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(1000)
        ok(page.locator('#v43Offer').count() == 0, f'{st["reason"]}: no offer pop-up')
        page.evaluate("() => setTxAccountNav('security')"); page.wait_for_timeout(600)
        ok(txt in page.inner_text('#v43BioCard') and page.locator('#v43On').count() == 0, f'{st["reason"]}: plain explanation, no switch')
        ctx.close()

    print('\nE. Turning off removes the key from the phone')
    ctx, page = boot(b, acct(pinSet=True), local=True, mock_extra=f"window.__nat.keys = ['{ID}'];")
    page.keyboard.type('482916'); emit(page, 'pin-result', {'ok': True, 'kind': 'unlock'}); page.wait_for_timeout(300)
    emit(page, 'my-bio', {'devices': [{'id': ID, 'label': 'Android phone', 'createdAt': 'x'}], 'pinSet': True})
    page.evaluate("() => setTxAccountNav('security')"); page.wait_for_timeout(600)
    page.fill('#v43Pw', 'Passw0rd!x'); clear(page); page.click('#v43BioCard .v43-dev button')
    ok(sent(page, 'bio-remove') == [{'groupId': gid, 'id': ID, 'password': 'Passw0rd!x'}], 'turn off asks the server (password needed)')
    emit(page, 'bio-result', {'ok': True, 'kind': 'removed', 'id': ID}); page.wait_for_timeout(200)
    ok(page.evaluate("() => window.__nat.keys.length") == 0 and page.evaluate(f"() => localStorage.getItem('q_bio_{gid}')") is None, 'once the server agrees, the key is deleted from the phone')
    ctx.close()
    ok(not errors, 'no JavaScript errors: ' + str(errors))
    b.close()
print(f'\nRESULT: {passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
