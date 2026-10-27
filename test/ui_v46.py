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
def block(page):
    for pat in ('**/cdnjs.cloudflare.com/**', '**/flagcdn.com/**', '**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**'): page.route(pat, lambda r: r.abort())
USD = {'accountNumber': '994077359', 'routing': '021000021', 'swift': 'CHASUS33', 'bankName': 'Chase Bank'}
def profiles(usd=True, eur_us=False, pool=None):
    return {'profiles': {'USD': {'ccy': 'USD', 'fields': USD if usd else {}, 'configured': usd},
        'EUR': {'ccy': 'EUR', 'fields': {'useUsd': True} if eur_us else {}, 'configured': eur_us, **({'useUsd': True} if eur_us else {})},
        'GBP': {'ccy': 'GBP', 'fields': {}, 'configured': False}},
        'schema': json.loads(json.dumps(fx['bankProfiles']['schema'])), 'labels': fx['bankProfiles']['labels'], 'allowSample': False,
        'pool': pool or {'USD': {'free': 2, 'used': 5}, 'EUR': {'free': 0, 'used': 0}, 'GBP': {'free': 0, 'used': 0}}}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1100, 'height': 900}); ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');")
    ap = ctx.new_page(); ap.on('pageerror', lambda e: errors.append(str(e))); block(ap)
    ap.goto(f'http://localhost:8099/?officer=1&groupId={gid}', wait_until='load'); ap.wait_for_timeout(500)
    emit(ap, 'bank-profiles', profiles()); ap.wait_for_timeout(250)
    ap.add_style_tag(content='html.officer-signin #appShell, #appShell{display:flex!important} .admin-only{display:flex!important}'); ap.evaluate("() => { const g = document.getElementById('officerGate'); if (g) g.remove(); openAdminDrawerTab('controls'); }")
    ok(ap.locator('.v46-pool').count() == 3, 'each currency gets its own "Account number for each seller" box')
    t = ap.inner_text('[data-v46="USD"]')
    ok('already issued to you' in t and 'never makes numbers up' in t and ap.inner_text('[data-v46f="USD"]') == '2' and ap.inner_text('[data-v46u="USD"]') == '5', 'it says real numbers only, and shows 2 free / 5 given to sellers')
    ok('IBANs' in ap.inner_text('[data-v46="EUR"]') and 'account numbers' in ap.inner_text('[data-v46="GBP"]'), 'euro asks for IBANs, the others for account numbers')
    clear(ap); ap.click('[data-v46="USD"] button'); ok(not sent(ap, 'admin-add-number-pool') and 'Paste at least one' in ap.inner_text('[data-v46m="USD"]'), 'empty box: nothing is sent')
    ap.fill('[data-v46t="USD"]', '5550000001\n5550000002'); ap.click('[data-v46="USD"] button')
    ok(sent(ap, 'admin-add-number-pool') == [{'ccy': 'USD', 'text': '5550000001\n5550000002'}], 'Add sends the pasted numbers')
    emit(ap, 'number-pool', {'ccy': 'USD', 'ok': True, 'added': 1, 'duplicates': 0, 'invalid': [{'text': 'abc', 'error': 'US account numbers have 4 to 17 digits.'}], 'invalidCount': 1, 'pool': {'USD': {'free': 3, 'used': 5}, 'EUR': {'free': 0, 'used': 0}, 'GBP': {'free': 0, 'used': 0}}}); ap.wait_for_timeout(150)
    ok(ap.inner_text('[data-v46f="USD"]') == '3' and '1 added' in ap.inner_text('[data-v46m="USD"]') and 'abc' in ap.inner_text('[data-v46m="USD"]') and ap.input_value('[data-v46t="USD"]') == 'abc', 'result: counts update, refused entries are named and kept in the box to fix')
    emit(ap, 'bank-profiles', profiles(eur_us=True)); ap.wait_for_timeout(250)
    ok(ap.locator('[data-v46="EUR"]').count() == 0 and ap.locator('[data-v46="USD"]').count() == 1, 'when EUR uses the US bank, it has no list of its own (sellers get the US account)')
    ok('does not assign numbers by itself' not in t, 'wording check')
    ok('from that seller' in t and 'being prepared' in t, 'the box tells the Desk to give each seller their number from that seller\u2019s profile')
    # per-seller card: assign controls
    emit(ap, 'bank-profiles', profiles()); ap.wait_for_timeout(100)
    ap.evaluate("() => { openModal('sellerProfileModal'); document.getElementById('spBody').innerHTML = '<p>profile</p>'; }")
    emit(ap, 'seller-profile', {'groupId': gid, 'account': fx['adminProfile']['account'], 'viewer': fx['adminProfile'].get('viewer')}); ap.wait_for_timeout(250)
    rv = {**fx['sellerRecv'], 'schema': {'req': ['accountNumber', 'routing', 'swift', 'bankName'], 'opt': ['holder', 'bankAddress']}, 'assignedNumber': None, 'poolFree': 2, 'awaitingNumber': True, 'useUsd': False, 'assigned': False}
    emit(ap, 'admin-seller-receiving', rv); ap.wait_for_timeout(300)
    ok(ap.locator('#spReceiving .v46-assign').count() == 1 and 'No number assigned yet' in ap.inner_text('#spReceiving .v46-assign') and '2 free' in ap.inner_text('#spReceiving .v46-assign'), 'seller card: shows "no number assigned yet" and 2 free in the list')
    clear(ap); ap.fill('#v46AssignInput', '5550000009'); ap.click('#spReceiving .v46-assign .send-btn')
    ok(sent(ap, 'admin-assign-seller-number') == [{'groupId': rv['groupId'], 'number': '5550000009'}], 'Assign sends the typed number')
    clear(ap); ap.click('#spReceiving .v46-assign .admin-btn')
    ok(sent(ap, 'admin-assign-seller-number') == [{'groupId': rv['groupId'], 'next': True}], '"Assign next from my list" asks for the next free number')
    emit(ap, 'admin-seller-receiving', {**rv, 'assignedNumber': '5550000001', 'poolFree': 1, 'awaitingNumber': False, 'assigned': True}); ap.wait_for_timeout(300)
    ok('5550000001' in ap.inner_text('#spReceiving .v46-assign') and ap.locator('#spReceiving .v46-assign .admin-btn').count() == 2 and ap.locator('#spReceiving .v46-assign').count() == 1, 'after assigning, the card shows the number, with Remove, and no duplicate box')
    ap.once('dialog', lambda d: d.accept()); clear(ap); ap.click('#spReceiving .v46-assign .admin-btn >> nth=1')
    ok(sent(ap, 'admin-unassign-seller-number') == [{'groupId': rv['groupId']}], 'Remove asks for confirmation, then removes it')
    ok(ap.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), 'nothing spills sideways')
    ok(not errors, 'no JavaScript errors: ' + str(errors))
    b.close()
print(f'\nRESULT: {passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
