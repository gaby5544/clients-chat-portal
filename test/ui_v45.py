import json, sys, copy
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
USD = {'accountNumber': '994077359', 'routing': '021000021', 'swift': 'CHASUS33', 'bankName': 'Chase Bank', 'bankAddress': '699 W Gaines St, Tallahassee, FL 32304'}
def profiles(eur_us, gbp_us):
    return {'profiles': {'USD': {'ccy': 'USD', 'fields': USD, 'configured': True},
        'EUR': {'ccy': 'EUR', 'fields': {'useUsd': True} if eur_us else {}, 'configured': eur_us, **({'useUsd': True} if eur_us else {})},
        'GBP': {'ccy': 'GBP', 'fields': {'useUsd': True} if gbp_us else {}, 'configured': gbp_us, **({'useUsd': True} if gbp_us else {})}},
        'schema': fx['bankProfiles']['schema'], 'labels': fx['bankProfiles']['labels'], 'allowSample': False}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1100, 'height': 900}); ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');")
    print('\nA. Desk: Receiving accounts')
    ap = ctx.new_page(); ap.on('pageerror', lambda e: errors.append(str(e))); block(ap)
    ap.goto(f'http://localhost:8099/?officer=1&groupId={gid}', wait_until='load'); ap.wait_for_timeout(500)
    emit(ap, 'bank-profiles', profiles(False, False)); ap.wait_for_timeout(250)
    ap.add_style_tag(content='html.officer-signin #appShell, #appShell{display:flex!important} .admin-only{display:flex!important}'); ap.evaluate("() => { const g = document.getElementById('officerGate'); if (g) g.remove(); openAdminDrawerTab('controls'); }"); ap.wait_for_timeout(400)
    ok(ap.locator('#banksBox [data-bkusd]').count() == 2 and ap.locator('[data-bkusd="USD"]').count() == 0, 'EUR and GBP each get a "Use my US bank account" switch (USD does not)')
    ok(all(not ap.is_checked(f'[data-bkusd="{c}"]') for c in ('EUR', 'GBP')) and ap.locator('#banksBox [data-bk]').count() >= 15 and ap.is_visible('#banksBox [data-bk="EUR.iban"]'), 'off by default: all the euro / pound boxes are there as before')
    ok('No IBAN is shown' in ap.inner_text('#banksBox'), 'it explains that no IBAN is shown for a US account')
    ap.check('[data-bkusd="EUR"]'); ap.wait_for_timeout(100)
    ok(not ap.is_visible('#banksBox [data-bk="EUR.iban"]') and ap.is_visible('#banksBox [data-bk="GBP.sortCode"]'), 'ticking EUR hides the euro boxes only')
    clear(ap); ap.check('[data-bkusd="GBP"]'); ap.evaluate("() => saveBankProfiles()")
    sv = sent(ap, 'admin-set-bank-profiles')
    ok(len(sv) == 1 and sv[0]['profiles']['EUR'] == {'useUsd': True} and sv[0]['profiles']['GBP'] == {'useUsd': True} and sv[0]['profiles']['USD']['swift'] == 'CHASUS33', 'save sends USD as typed and EUR / GBP as "use the US bank"')
    emit(ap, 'bank-profiles', profiles(True, True)); ap.wait_for_timeout(250)
    ok(ap.is_checked('[data-bkusd="EUR"]') and ap.is_checked('[data-bkusd="GBP"]') and not ap.is_visible('#banksBox [data-bk="GBP.iban"]') and ap.locator('#banksBox em.ok').count() == 3, 'after saving, the switches stay on and all three show configured')
    clear(ap); ap.uncheck('[data-bkusd="EUR"]'); ap.fill('[data-bk="EUR.iban"]', 'DE89 3704 0044 0532 0130 00'); ap.evaluate("() => saveBankProfiles()")
    sv = sent(ap, 'admin-set-bank-profiles'); ok(sv[0]['profiles']['EUR'].get('iban', '').startswith('DE89') and 'useUsd' not in sv[0]['profiles']['EUR'], 'switching it off sends the euro account\'s own boxes again')

    print('\nB. Seller sees the one US bank')
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); block(pg)
    pg.goto(f'http://localhost:8099/?groupId={gid}&role=SELLER', wait_until='load'); pg.wait_for_timeout(600)
    acct = {**fx['verified'], 'countryIso': 'DE', 'balances': {'available': 0, 'held': 0, 'pending': 0, 'totalDeposited': 0}}
    emit(pg, 'init-state', fx['init']); emit(pg, 'seller-account-state', acct)
    for ccy, who in (('EUR', 'DE'), ('GBP', 'GB')):
        rows_a = [['Account name', 'Kwame Mensah'], ['Account number', '994077359'], ['ABA routing number', '021000021'], ['Payment reference', '48213907765']]
        rows_b = [['SWIFT / BIC', 'CHASUS33'], ['Bank name', 'Chase Bank'], ['Bank address', '699 W Gaines St, Tallahassee, FL 32304'], ['Bank country', 'United States']]
        d = {**fx['detailsUSD'], 'currency': ccy, 'details': {ccy: {'symbol': '€' if ccy == 'EUR' else '£', 'intro': f'{ccy} payments are received by international SWIFT wire into the Desk’s United States bank account shown here. Your payer’s bank may convert the payment, and fees can apply. Quote your Payment reference so we can match it to you.', 'sample': False, 'a': rows_a, 'b': rows_b}}}
        emit(pg, 'receiving-details', d)
        pg.evaluate("() => { const o = document.getElementById('onboardingOverlay'); if (o) o.remove(); openTxAccountView(); setTxAccountNav('accounts'); }"); pg.wait_for_timeout(400)
        t = pg.inner_text('#rcCard') if pg.locator('#rcCard').count() else ''
        ok('Bank country' in t and 'United States' in t and 'Tallahassee' in t and 'CHASUS33' in t and 'SWIFT wire' in t, f'{ccy} seller: card shows the US bank, "Bank country: United States" and the SWIFT-wire wording')
        ok('IBAN' not in t.upper().replace('IBAN', 'IBAN') or 'IBAN' not in t, f'{ccy} seller: no IBAN row')
        ok(pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), f'{ccy} seller: nothing spills sideways')
    ok(not errors, 'no JavaScript errors: ' + str(errors))
    b.close()
print(f'\nRESULT: {passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
