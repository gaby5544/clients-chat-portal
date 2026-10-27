import json
from playwright.sync_api import sync_playwright
errors = []; passed = 0; failed = 0
def ok(c, msg):
    global passed, failed
    if c: passed += 1; print('  ✓', msg)
    else: failed += 1; print('  ✗ FAIL:', msg)
def block(page):
    for pat in ('**/cdnjs.cloudflare.com/**', '**/flagcdn.com/**', '**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**'): page.route(pat, lambda r: r.abort())
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (390, 1100):
        print(f'\nCode sign-in at {w}px')
        ctx = b.new_context(viewport={'width': w, 'height': 800}); ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');")
        page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e))); block(page)
        calls = []
        def handle(route):
            req = route.request; body = json.loads(req.post_data or '{}'); calls.append((req.url.split('/api/')[1], body))
            if req.url.endswith('/code/request'): route.fulfill(status=200, content_type='application/json', body='{"success":true}')
            else:
                if body.get('code') == '123456': route.fulfill(status=200, content_type='application/json', body='{"success":true,"groupId":"g-x","sessionToken":"tok-1","language":"en"}')
                else: route.fulfill(status=400, content_type='application/json', body='{"error":"That code is not correct or has expired. Please request a new one."}')
        page.route('**/api/auth/code/*', handle)
        page.goto('http://localhost:8099/?signin=code&email=ama%40example.com', wait_until='load'); page.wait_for_timeout(900)
        ok(page.is_visible('#gvCodeEmail') and page.input_value('#v50Email') == 'ama@example.com', 'the Desk link opens on "Sign in with a code" with the email filled in')
        ok(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), 'nothing spills sideways')
        ok(len(calls) == 0, 'opening the link sends nothing by itself (a mail scanner cannot trigger a code)')
        page.click('#v50Btn1'); page.wait_for_timeout(400)
        ok(calls and calls[0] == ('auth/code/request', {'email': 'ama@example.com'}) and page.is_visible('#gvCodeEnter') and 'ama@example.com' in page.inner_text('#v50Sent'), 'Send me a code -> asks for the 6-digit code')
        page.fill('#v50Code', 'ab12cd'); ok(page.input_value('#v50Code') == '12', 'only digits are accepted')
        page.fill('#v50Code', '99'); page.click('#v50Btn2'); ok('6-digit' in page.inner_text('#v50Msg2'), 'a short code is rejected on the screen')
        page.fill('#v50Code', '000000'); page.click('#v50Btn2'); page.wait_for_timeout(300)
        ok('not correct' in page.inner_text('#v50Msg2'), 'a wrong code shows the server message')
        page.click('text=Send a new code'); page.wait_for_timeout(300)
        ok(sum(1 for c in calls if c[0] == 'auth/code/request') == 2 and 'new code' in page.inner_text('#v50Msg2'), 'Send a new code asks again')
        page.fill('#v50Code', '123456')
        with page.expect_navigation(timeout=4000): page.click('#v50Btn2')
        ok('groupId=g-x' in page.url and 'role=SELLER' in page.url, 'the right code opens the seller account')
        ok(page.evaluate("() => sessionStorage.getItem('q_session_token')") == 'tok-1', 'the session token is saved')
        # normal sign-in screen has the link
        page2 = ctx.new_page(); page2.on('pageerror', lambda e: errors.append(str(e))); block(page2)
        page2.goto('http://localhost:8099/', wait_until='load'); page2.wait_for_timeout(700)
        page2.evaluate("() => gateShow('signin')"); ok(page2.is_visible('#v50Link'), 'the normal Sign in screen offers "Sign in with an email code instead"')
        page2.fill('#gateEmail', 'zed@example.com'); page2.click('#v50Link'); ok(page2.is_visible('#gvCodeEmail') and page2.input_value('#v50Email') == 'zed@example.com', 'it carries the typed email across')
    b.close()
ok(not errors, 'no page errors ' + str(errors[:2]))
print(f'\n{passed} passed, {failed} failed'); raise SystemExit(1 if failed else 0)
