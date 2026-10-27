// v3.23: sign in with an emailed code (for accounts the Desk added by hand) + the Desk's copyable login link.
(function () {
  const g$ = (id) => document.getElementById(id);
  let codeEmail = '';
  function inject() {
    const card = document.querySelector('#appGate .gate-card'); if (!card || g$('gvCodeEmail')) return;
    const foot = card.querySelector('.gate-foot');
    foot.insertAdjacentHTML('beforebegin', `
      <div class="gv hidden" id="gvCodeEmail">
        <button class="gate-back" onclick="gateShow('signin')"><i class="fa-solid fa-chevron-left"></i> Back</button>
        <h1>Sign in with a code</h1><p class="gate-sub">Enter the email address your Desk Officer registered for you. We will email you a 6-digit code to sign in — no password needed.</p>
        <label class="gate-field"><span>Email address</span><input id="v50Email" type="email" inputmode="email" autocomplete="username" placeholder="you@example.com"></label>
        <div id="v50Msg1" class="gate-msg"></div>
        <button class="gate-btn" id="v50Btn1" onclick="v50Request()"><i class="fa-solid fa-envelope"></i> Send me a code</button>
      </div>
      <div class="gv hidden" id="gvCodeEnter">
        <button class="gate-back" onclick="gateShow('codeEmail')"><i class="fa-solid fa-chevron-left"></i> Back</button>
        <h1>Enter your code</h1><p class="gate-sub">We sent a 6-digit code to <b id="v50Sent"></b>. It expires in 10 minutes and works once.</p>
        <label class="gate-field"><span>Sign-in code</span><input id="v50Code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456"></label>
        <div id="v50Msg2" class="gate-msg"></div>
        <button class="gate-btn" id="v50Btn2" onclick="v50Verify()"><i class="fa-solid fa-right-to-bracket"></i> Sign in</button>
        <button class="gate-link" onclick="v50Request(true)">Send a new code</button>
      </div>`);
    const si = g$('gvSignin'); const btn = si && si.querySelector('.gate-link');
    if (si && !g$('v50Link')) si.insertAdjacentHTML('beforeend', '<button class="gate-link" id="v50Link" onclick="v50Open()"><i class="fa-solid fa-envelope-open-text"></i> Sign in with an email code instead</button>');
    g$('v50Email').addEventListener('keydown', (e) => { if (e.key === 'Enter') v50Request(); });
    g$('v50Code').addEventListener('keydown', (e) => { if (e.key === 'Enter') v50Verify(); });
    g$('v50Code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
  }
  window.v50Open = function (email) {
    inject(); const e = g$('v50Email'); if (!e) return;
    if (email) e.value = email; else if (!e.value && g$('gateEmail')) e.value = g$('gateEmail').value;
    g$('v50Msg1').textContent = ''; gateShow('codeEmail');
  };
  window.v50Request = async function (resend) {
    const email = (resend ? codeEmail : g$('v50Email').value).trim(), msg = g$(resend ? 'v50Msg2' : 'v50Msg1'), b = g$('v50Btn1'); msg.textContent = '';
    if (!isValidEmailClient(email)) { msg.textContent = 'Enter a valid email address.'; return; }
    b.disabled = true; const old = b.innerHTML; b.textContent = 'Sending…';
    const r = await postJson('/api/auth/code/request', { email });
    b.disabled = false; b.innerHTML = old;
    if (!r.ok) { msg.textContent = r.data.error || 'We could not send the code. Please try again.'; return; }
    codeEmail = email; g$('v50Sent').textContent = email; g$('v50Code').value = ''; g$('v50Msg2').textContent = '';
    gateShow('codeEnter'); if (resend) { g$('v50Msg2').textContent = 'A new code was sent.'; g$('v50Msg2').style.color = 'var(--accent-emerald, #34d399)'; } else g$('v50Msg2').style.color = '';
    setTimeout(() => g$('v50Code').focus(), 80);
  };
  window.v50Verify = async function () {
    const code = g$('v50Code').value.trim(), msg = g$('v50Msg2'), b = g$('v50Btn2'); msg.textContent = ''; msg.style.color = '';
    if (!/^\d{6}$/.test(code)) { msg.textContent = 'Enter the 6-digit code from your email.'; return; }
    b.disabled = true; const old = b.innerHTML; b.textContent = 'Signing in…';
    const r = await postJson('/api/auth/code/verify', { email: codeEmail, code });
    b.disabled = false; b.innerHTML = old;
    if (!r.ok) { msg.textContent = r.data.error || 'That code is not valid.'; return; }
    sessionStorage.setItem('q_session_token', r.data.sessionToken);
    if (r.data.language) localStorage.setItem('q_lang', r.data.language);
    if (r.data.multiple) {
      gateShow('pick');
      g$('gatePickList').innerHTML = r.data.accounts.map((a) => `<button class="next-card" onclick="location.href='/?groupId=${encodeURIComponent(a.groupId)}&role=SELLER'"><span class="next-ico cyan"><i class="fa-solid fa-briefcase"></i></span><span class="next-text"><b>Account ${escapeHtml(a.accountId || '')}</b><small>${escapeHtml(a.groupName || '')}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('');
      return;
    }
    location.href = `/?groupId=${encodeURIComponent(r.data.groupId)}&role=SELLER`;
  };
  // The Desk's login link: <site>/?signin=code&email=…  — opens straight on the "send me a code" step.
  function fromLink() {
    const q = new URLSearchParams(location.search); if (q.get('signin') !== 'code') return;
    const go = () => { if (!g$('appGate')) return false; inject(); v50Open(q.get('email') || ''); return true; };
    if (!go()) { let n = 0; const t = setInterval(() => { if (go() || ++n > 40) clearInterval(t); }, 150); }
  }
  inject();
  if (typeof buildGate === 'function') { const _b = buildGate; buildGate = function () { _b.apply(this, arguments); inject(); }; }
  fromLink();

  // ---- Admin: copy the seller's login link ----
  window.v50LoginLink = (email) => `${location.origin}/?signin=code&email=${encodeURIComponent(email || '')}`;
  window.v50CopyLink = function (email) {
    const link = v50LoginLink(email);
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Login link copied. Send it to the seller.')).catch(() => { try { prompt('Copy this login link:', link); } catch (e) { /* ignore */ } });
  };
  socket.on('admin-seller-added', (d) => {
    if (!d || !d.email || typeof openModal !== 'function') return;
    let m = g$('v50Added'); if (m) m.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="v50Added"><div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-user-check"></i> Seller added</span><i class="fa-solid fa-xmark" onclick="closeModal('v50Added')"></i></div><div class="modal-body">
      <p class="reg-note"><b>${escapeHtml(d.name || '')}</b> · Account ID <b translate="no">${escapeHtml(d.accountId || '')}</b></p>
      <p class="reg-note">We emailed ${escapeHtml(d.email)} their login link. The seller opens it, asks for a 6-digit code, enters it from their email, and signs in. Their first step after that is identity verification.</p>
      <input class="message-input" id="v50AddedLink" readonly value="${escapeHtml(v50LoginLink(d.email))}" onclick="this.select()">
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="ghost-btn" onclick="closeModal('v50Added')">Close</button><button class="send-btn" onclick="v50CopyLink('${escapeHtml(d.email)}')"><i class="fa-solid fa-copy"></i> Copy login link</button></div>
    </div></div></div>`);
    setTimeout(() => openModal('v50Added'), 200);
  });
  socket.on('seller-profile', ({ account: a }) => {
    if (!a || !a.manualSeller || !a.email) return;
    setTimeout(() => {
      const c = g$('spControls'); if (!c || g$('v50CopyBtn')) return;
      c.insertAdjacentHTML('beforeend', `<button class="admin-btn" id="v50CopyBtn" onclick="v50CopyLink('${escapeHtml(a.email)}')"><i class="fa-solid fa-link"></i> Copy login link</button>`);
    }, 60);
  });
})();
