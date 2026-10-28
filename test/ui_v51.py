import json
from playwright.sync_api import sync_playwright
fx = json.load(open('/tmp/fixtures_v38.json')); gid = fx['gid']
errors = []; passed = 0; failed = 0
def ok(c, msg):
    global passed, failed
    if c: passed += 1; print('  ✓', msg)
    else: failed += 1; print('  ✗ FAIL:', msg)
def emit(page, ev, data): page.evaluate("([e,d]) => window.__srv.emit(e,d)", [ev, data])
def block(page):
    for pat in ('**/cdnjs.cloudflare.com/**', '**/flagcdn.com/**', '**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**'): page.route(pat, lambda r: r.abort())
ROW = lambda i, name, funds: {'groupId': f'g{i}', 'fullName': name, 'email': f'u{i}@example.com', 'phone': '+4915112345678', 'country': 'Germany', 'countryIso': 'DE', 'currency': 'EUR', 'accountId': f'3521366379{i}', 'registeredAt': '2026-10-27T06:58:00.000Z', 'dateOfBirth': '1988-05-17', 'language': 'en', 'kyc': {'status': 'not_submitted'}, 'balances': {'available': funds, 'held': 0, 'pending': 0, 'totalDeposited': funds}, 'manual': True, 'passwordSet': False, 'loginAlertsEnabled': False}
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (390, 1100):
        print(f'\nEdit / delete at {w}px')
        ctx = b.new_context(viewport={'width': w, 'height': 800}); ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');")
        page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e))); block(page)
        page.goto(f'http://localhost:8099/?groupId={gid}&role=SELLER', wait_until='load'); page.wait_for_timeout(600)
        page.evaluate("() => { let t = document.getElementById('tabAccounts'); if (!t) { t = document.createElement('div'); t.id = 'tabAccounts'; document.body.appendChild(t); } ensureSellersPanel(); const box = document.getElementById('allSellersBox'); document.body.appendChild(box); box.style.cssText = 'position:fixed;inset:0;z-index:50;overflow:auto;background:#0b1020'; }")
        emit(page, 'sellers-list', [ROW(1, 'Martin Friedrich', 0), ROW(2, 'Rich Holder', 250.5)]); page.wait_for_timeout(300)
        ok(page.locator('#sellersList .seller-card').count() == 2 and page.locator('#sellersList .v51-edit').count() == 2 and page.locator('#sellersList .v51-del').count() == 2, 'every seller card has Edit details and Delete account')
        emit(page, 'sellers-list', [ROW(1, 'Martin Friedrich', 0), ROW(2, 'Rich Holder', 250.5)]); page.wait_for_timeout(200)
        ok(page.locator('#sellersList .v51-edit').count() == 2, 'buttons are not duplicated when the list refreshes')
        # --- edit
        page.locator('#sellersList .v51-edit').first.click(); page.wait_for_timeout(300)
        ok(page.is_visible('#v51EditModal') and page.input_value('#v51Name') == 'Martin Friedrich' and page.input_value('#v51Country') == 'DE' and page.input_value('#v51Dob') == '1988-05-17', 'Edit opens filled with the seller\'s details')
        ok(page.input_value('#v51Reg').startswith('2026-10-2'), 'the registered date is editable: ' + page.input_value('#v51Reg'))
        ok(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), 'no sideways spill')
        page.evaluate("() => { window.__sent = []; }")
        page.fill('#v51Name', 'Martin'); page.click('#v51Save'); ok('full name' in page.inner_text('#v51EditMsg'), 'a one-word name is stopped on the screen')
        page.fill('#v51Name', 'Martin F. Weber'); page.fill('#v51Reg', '2026-03-14T09:30'); page.fill('#v51Phone', '+49 151 1234 5678'); page.click('#v51Save')
        sent = page.evaluate("() => (window.__sent || []).filter(x => x[0] === 'admin-edit-seller')")
        ok(len(sent) == 1 and sent[0][1]['groupId'] == 'g1' and sent[0][1]['fullName'] == 'Martin F. Weber' and sent[0][1]['registeredAt'].startswith('2026-03-14') and sent[0][1]['currency'] == 'EUR', 'Save sends the edited details: ' + json.dumps(sent[0][1])[:140] if sent else 'nothing sent')
        emit(page, 'seller-edited', {'groupId': 'g1', 'changed': ['fullName']}); page.wait_for_timeout(200)
        ok(not page.is_visible('#v51EditModal'), 'the form closes once saved')
        page.locator('#sellersList .v51-edit').nth(1).click(); page.wait_for_timeout(250)
        ok(page.is_disabled('#v51Ccy') and 'fixed' in page.inner_text('#v51CcyNote'), 'currency is locked for an account that holds money')
        page.evaluate("() => closeModal('v51EditModal')")
        # --- delete (no money)
        page.locator('#sellersList .v51-del').first.click(); page.wait_for_timeout(250)
        ok(page.is_visible('#v51DelModal') and page.is_disabled('#v51DelBtn') and page.is_hidden('#v51DelFunds'), 'Delete asks for confirmation; the button starts disabled')
        page.fill('#v51DelType', '12345'); ok(page.is_disabled('#v51DelBtn'), 'a wrong Account ID keeps it disabled')
        page.fill('#v51DelType', '35213663791'); ok(page.is_enabled('#v51DelBtn'), 'the exact Account ID enables it')
        page.evaluate("() => { window.__sent = []; }"); page.click('#v51DelBtn')
        sent = page.evaluate("() => (window.__sent || []).filter(x => x[0] === 'admin-delete-seller')")
        ok(len(sent) == 1 and sent[0][1]['groupId'] == 'g1' and sent[0][1]['confirm'] == '35213663791', 'Delete sends the request with the typed ID')
        emit(page, 'seller-account-deleted', {'groupId': 'g1', 'accountId': '35213663791', 'name': 'Martin'}); page.wait_for_timeout(250)
        ok(page.locator('#sellersList .seller-card').count() == 1 and not page.is_visible('#v51DelModal'), 'the card disappears and the box closes')
        # --- delete with funds
        page.locator('#sellersList .v51-del').first.click(); page.wait_for_timeout(250)
        ok(page.is_visible('#v51DelFunds') and '250.50' in page.inner_text('#v51DelFundsText'), 'an account with money shows how much it holds')
        page.fill('#v51DelType', '35213663792'); ok(page.is_disabled('#v51DelBtn'), 'the ID alone is not enough when money is held')
        page.check('#v51DelAck'); ok(page.is_enabled('#v51DelBtn'), 'ID + tick enables it')
        ok(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), 'no sideways spill')
    b.close()
ok(not errors, 'no page errors ' + str(errors[:2]))
print(f'\n{passed} passed, {failed} failed'); raise SystemExit(1 if failed else 0)
