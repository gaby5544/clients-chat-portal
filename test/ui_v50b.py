import json
from playwright.sync_api import sync_playwright
fx = json.load(open('/tmp/fixtures_v38.json')); gid = fx['gid']; errs=[]; res=[]
def ok(c,m): res.append(c); print('  ✓' if c else '  ✗ FAIL:', m)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width':390,'height':800}); ctx.add_init_script("sessionStorage.setItem('q_splash_done','1'); localStorage.setItem('q_intro_done','1');")
    ctx.grant_permissions(['clipboard-read','clipboard-write'])
    page = ctx.new_page(); page.on('pageerror', lambda e: errs.append(str(e)))
    for pat in ('**/cdnjs.cloudflare.com/**','**/flagcdn.com/**','**/fonts.googleapis.com/**','**/fonts.gstatic.com/**'): page.route(pat, lambda r: r.abort())
    page.goto(f'http://localhost:8099/?groupId={gid}&role=SELLER', wait_until='load'); page.wait_for_timeout(600)
    page.evaluate("() => document.body.insertAdjacentHTML('beforeend','<div id=addSellerModal class=\"modal-overlay hidden\"></div>')")
    page.evaluate("([e,d]) => window.__srv.emit(e,d)", ['admin-seller-added', {'groupId':'g1','accountId':'4821390776','email':'ama@example.com','name':'Ama Boateng'}]); page.wait_for_timeout(600)
    ok(page.is_visible('#v50Added'), 'admin sees a "Seller added" box')
    ok(page.input_value('#v50AddedLink').endswith('/?signin=code&email=ama%40example.com'), 'it shows the seller\'s login link')
    page.click('#v50Added .send-btn'); page.wait_for_timeout(300)
    ok(page.evaluate("() => navigator.clipboard.readText()").endswith('/?signin=code&email=ama%40example.com'), 'Copy login link puts it on the clipboard')
    ok(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), 'no sideways spill')
print(len(errs)==0, errs[:2]); raise SystemExit(0 if all(res) and not errs else 1)
