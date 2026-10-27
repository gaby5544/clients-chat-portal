import json, sys
from playwright.sync_api import sync_playwright
fx = json.load(open('/tmp/fixtures_v38.json')); gid = fx['gid']
errors = []; passed = 0; failed = 0
def ok(c, msg):
    global passed, failed
    if c: passed += 1; print('  ✓', msg)
    else: failed += 1; print('  ✗ FAIL:', msg)
def emit(page, ev, data): page.evaluate("([e,d]) => window.__srv.emit(e,d)", [ev, data])
LED = {'currency': 'USD', 'totalDeposited': 100020, 'moneyIn': 100020, 'moneyOut': 20, 'fees': 20, 'withdrawn': 0, 'inProgress': 0, 'held': 0, 'available': 100000, 'other': 0, 'reconciles': True, 'feeItems': []}
def acct(**o): return {**fx['verified'], 'countryIso': 'GH', 'balances': {'available': 100000, 'held': 0, 'pending': 0, 'totalDeposited': 100020}, 'ledger': LED, 'statementUrl': f'/api/statement/{gid}?sig=' + 'a' * 40, **o}
def block(page):
    for pat in ('**/cdnjs.cloudflare.com/**', '**/flagcdn.com/**', '**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**'): page.route(pat, lambda r: r.abort())
SPY = "document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[data-v47]'); if (a) { e.preventDefault(); (window.__dl = window.__dl || []).push(a.getAttribute('href')); } }, true);"
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (390, 1100):
        ctx = b.new_context(viewport={'width': w, 'height': 800}); ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');" + SPY)
        page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e))); block(page)
        page.goto(f'http://localhost:8099/?groupId={gid}&role=SELLER', wait_until='load'); page.wait_for_timeout(600)
        emit(page, 'init-state', fx['init']); emit(page, 'seller-account-state', acct()); emit(page, 'receiving-details', fx['detailsUSD']); page.wait_for_timeout(300)
        page.evaluate("() => { const o = document.getElementById('onboardingOverlay'); if (o) o.remove(); openTxAccountView(); setTxAccountNav('accounts'); }"); page.wait_for_timeout(400)
        print(f'\nStatement row at {w}px')
        ok(page.locator('#v47Stmt').count() == 1 and 'Statement of account' in page.inner_text('#v47Stmt') and page.is_visible('#v47Range'), 'the Accounts page has "Statement of account" with a period choice')
        ok(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), 'nothing spills sideways')
        page.select_option('#v47Range', '30'); page.click('#v47Stmt .admin-btn'); page.wait_for_timeout(200)
        dl = page.evaluate("() => window.__dl || []")
        ok(dl == [f'/api/statement/{gid}?sig=' + 'a' * 40 + '&range=30'], 'Download opens the signed link for the chosen period')
        page.evaluate("() => setTxAccountNav('accounts')"); page.wait_for_timeout(300)
        ok(page.locator('#v47Stmt').count() == 1, 'the row is not duplicated when the page re-renders')
        ctx.close()
    ctx = b.new_context(viewport={'width': 390, 'height': 800}); ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');")
    page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e))); block(page)
    page.goto(f'http://localhost:8099/?groupId={gid}&role=SELLER', wait_until='load'); page.wait_for_timeout(600)
    emit(page, 'init-state', fx['init']); emit(page, 'seller-account-state', acct(statementUrl=None)); page.wait_for_timeout(300)
    page.evaluate("() => { const o = document.getElementById('onboardingOverlay'); if (o) o.remove(); openTxAccountView(); setTxAccountNav('accounts'); }"); page.wait_for_timeout(400)
    ok(page.locator('#v47Stmt').count() == 0, 'no statement row when the account has no statement link')
    ok(not errors, 'no JavaScript errors: ' + str(errors))
    b.close()
print(f'\nRESULT: {passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
