// v3.24: Admin can edit a seller's details and delete a seller's account permanently.
(function () {
  const g$ = (id) => document.getElementById(id);
  const find = (gid) => (typeof sellersCache !== 'undefined' ? sellersCache : []).find((a) => a.groupId === gid);
  const localDT = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };

  // ---- buttons on every seller card + the full-profile panel ----
  const btns = (gid) => `<button class="admin-btn v51-edit" onclick="v51Edit('${gid}')"><i class="fa-solid fa-pen-to-square"></i> Edit details</button><button class="admin-btn admin-btn-danger v51-del" onclick="v51Delete('${gid}')"><i class="fa-solid fa-trash-can"></i> Delete account</button>`;
  const _render = renderSellers;
  renderSellers = function () {
    _render.apply(this, arguments);
    document.querySelectorAll('#sellersList .seller-card').forEach((card) => {
      if (card.querySelector('.v51-edit')) return;
      const m = (card.querySelector('.sc-actions button') || {}).getAttribute && card.querySelector('.sc-actions button').getAttribute('onclick').match(/openSellerProfile\('([^']+)'\)/);
      if (m) card.querySelector('.sc-actions').insertAdjacentHTML('beforeend', btns(m[1]));
    });
  };
  socket.on('seller-profile', ({ account: a }) => {
    if (!a) return;
    setTimeout(() => { const c = g$('spControls'); if (c && !c.querySelector('.v51-edit')) c.insertAdjacentHTML('beforeend', btns(a.groupId)); }, 80);
  });
  if (typeof sellersCache !== 'undefined' && sellersCache.length) renderSellers();

  // ---- Edit ----
  function ensureEdit() {
    if (g$('v51EditModal')) return;
    const countries = (QC.COUNTRIES || []).map((c) => `<option value="${c.iso}">${escapeHtml(c.name)}</option>`).join('');
    const ccys = Array.from(g$('rfCurrency').options).map((o) => `<option value="${o.value}">${escapeHtml(o.textContent)}</option>`).join('');
    const langs = (QL.LANGUAGES || []).map((l) => `<option value="${l.code}">${escapeHtml(l.name)}</option>`).join('');
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="v51EditModal"><div class="modal-box"><div class="modal-header"><span><i class="fa-solid fa-pen-to-square"></i> Edit seller details</span><i class="fa-solid fa-xmark" onclick="closeModal('v51EditModal')"></i></div><div class="modal-body">
      <p class="reg-note v51-head" id="v51EditWho" style="margin-top:0"></p>
      <label class="branding-field">Full name<input id="v51Name" class="message-input" autocomplete="off"></label>
      <label class="branding-field">Email address<input id="v51Email" type="email" class="message-input" autocomplete="off"></label>
      <div class="two-col"><label class="branding-field">Country<select id="v51Country" class="message-input csel">${countries}</select></label><label class="branding-field">Phone<input id="v51Phone" class="message-input" placeholder="+233 24 412 3456" autocomplete="off"></label></div>
      <div class="two-col"><label class="branding-field">Date of birth<input id="v51Dob" type="date" class="message-input"></label><label class="branding-field">Registered on<input id="v51Reg" type="datetime-local" class="message-input"></label></div>
      <div class="two-col"><label class="branding-field">Language<select id="v51Lang" class="message-input csel">${langs}</select></label><label class="branding-field">Account currency<select id="v51Ccy" class="message-input csel">${ccys}</select></label></div>
      <p class="reg-note" id="v51CcyNote"></p>
      <p class="reg-note">The seller is not notified of these changes. Every change is recorded on the account with the date and your role.</p>
      <div id="v51EditMsg" class="reg-note" style="color:var(--accent-rose)"></div>
      <div class="v51-actions"><button class="ghost-btn" onclick="closeModal('v51EditModal')">Cancel</button><button class="send-btn" id="v51Save" onclick="v51Save()"><i class="fa-solid fa-check"></i> Save changes</button></div>
    </div></div></div>`);
  }
  let editing = null;
  window.v51Edit = function (gid) {
    const a = find(gid); if (!a) return toast('Open the Accounts list first, then try again.', true);
    ensureEdit(); editing = a;
    g$('v51EditWho').innerHTML = `<b>${escapeHtml(a.fullName || '')}</b> · Account <b translate="no">${escapeHtml(a.accountId || '')}</b>`;
    g$('v51Name').value = a.fullName || ''; g$('v51Email').value = a.email || ''; g$('v51Country').value = a.countryIso || '';
    g$('v51Phone').value = a.phone || ''; g$('v51Dob').value = a.dateOfBirth || ''; g$('v51Reg').value = localDT(a.registeredAt);
    g$('v51Lang').value = a.language || 'en'; g$('v51Ccy').value = a.currency || '';
    const b = a.balances || {}; const hasMoney = (Number(b.available) || 0) || (Number(b.held) || 0) || (Number(b.pending) || 0) || (Number(b.totalDeposited) || 0);
    g$('v51Ccy').disabled = !!hasMoney; g$('v51CcyNote').textContent = hasMoney ? 'The currency is fixed because this account already has money or payment history.' : 'You can still change the currency because the account has no money or history yet. Any account number assigned for the old currency is released.';
    g$('v51EditMsg').textContent = ''; g$('v51Save').disabled = false; openModal('v51EditModal');
  };
  window.v51Save = function () {
    if (!editing) return; const a = editing; const m = g$('v51EditMsg'); m.textContent = '';
    const p = { groupId: a.groupId, fullName: g$('v51Name').value.trim(), email: g$('v51Email').value.trim(), country: g$('v51Country').value, phone: g$('v51Phone').value.trim(), dateOfBirth: g$('v51Dob').value, language: g$('v51Lang').value };
    if (!p.fullName || !/\s/.test(p.fullName)) { m.textContent = 'Enter the full name (first and last name).'; return; }
    if (!isValidEmailClient(p.email)) { m.textContent = 'Enter a valid email address.'; return; }
    if (!p.country) { m.textContent = 'Choose the country.'; return; }
    if (g$('v51Reg').value) { const d = new Date(g$('v51Reg').value); if (isNaN(d)) { m.textContent = 'Enter a valid registration date.'; return; } if (d.getTime() > Date.now() + 60000) { m.textContent = 'The registration date cannot be in the future.'; return; } p.registeredAt = d.toISOString(); }
    if (!g$('v51Ccy').disabled) p.currency = g$('v51Ccy').value;
    g$('v51Save').disabled = true; setTimeout(() => { const b = g$('v51Save'); if (b) b.disabled = false; }, 2500);
    socket.emit('admin-edit-seller', p);
  };
  socket.on('seller-edited', () => { closeModal('v51EditModal'); if (typeof requestSellers === 'function') requestSellers(); });

  // ---- Delete ----
  function ensureDelete() {
    if (g$('v51DelModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay hidden" id="v51DelModal"><div class="modal-box"><div class="modal-header"><span style="color:var(--accent-rose)"><i class="fa-solid fa-triangle-exclamation"></i> Delete seller account</span><i class="fa-solid fa-xmark" onclick="closeModal('v51DelModal')"></i></div><div class="modal-body">
      <p class="reg-note v51-head" id="v51DelWho" style="margin-top:0"></p>
      <p class="reg-note">This <b>permanently</b> deletes the seller&rsquo;s account: their profile, sign-in, identity documents, balances, deposits, withdrawals, messages and transaction room. Their links stop working and they can never sign in again. <b>This cannot be undone.</b> To close an account but keep the record, use <b>Ban</b> instead.</p>
      <div id="v51DelFunds" class="v51-funds hidden"><label class="terms-check"><input type="checkbox" id="v51DelAck"> <span id="v51DelFundsText"></span></label></div>
      <label class="branding-field">To confirm, type the Account ID <b translate="no" id="v51DelId"></b><input id="v51DelType" class="message-input" autocomplete="off" inputmode="numeric" placeholder="Account ID"></label>
      <div class="v51-actions"><button class="ghost-btn" onclick="closeModal('v51DelModal')">Cancel</button><button class="send-btn v51-danger" id="v51DelBtn" onclick="v51DelGo()" disabled><i class="fa-solid fa-trash-can"></i> Delete permanently</button></div>
    </div></div></div>`);
    g$('v51DelType').addEventListener('input', v51DelCheck); g$('v51DelAck').addEventListener('change', v51DelCheck);
  }
  let deleting = null;
  function v51DelCheck() {
    if (!deleting) return; const a = deleting; const b = a.balances || {}; const funds = (Number(b.available) || 0) + (Number(b.held) || 0) + (Number(b.pending) || 0);
    g$('v51DelBtn').disabled = !(g$('v51DelType').value.trim() === String(a.accountId) && (funds <= 0 || g$('v51DelAck').checked));
  }
  window.v51Delete = function (gid) {
    const a = find(gid); if (!a) return toast('Open the Accounts list first, then try again.', true);
    ensureDelete(); deleting = a; const b = a.balances || {}; const funds = (Number(b.available) || 0) + (Number(b.held) || 0) + (Number(b.pending) || 0);
    g$('v51DelWho').innerHTML = `<b>${escapeHtml(a.fullName || '')}</b> · ${escapeHtml(a.email || '')} · Account <b translate="no">${escapeHtml(a.accountId || '')}</b>`;
    g$('v51DelId').textContent = a.accountId || ''; g$('v51DelType').value = ''; g$('v51DelAck').checked = false;
    g$('v51DelFunds').classList.toggle('hidden', funds <= 0);
    g$('v51DelFundsText').textContent = `This account still holds ${fmtMoney(funds, a.currency)}. I understand its money record will be deleted too.`;
    g$('v51DelBtn').disabled = true; openModal('v51DelModal');
  };
  window.v51DelGo = function () {
    if (!deleting) return; g$('v51DelBtn').disabled = true;
    socket.emit('admin-delete-seller', { groupId: deleting.groupId, confirm: g$('v51DelType').value.trim(), acknowledgeFunds: g$('v51DelAck').checked });
    setTimeout(() => { if (g$('v51DelBtn')) v51DelCheck(); }, 2500);
  };
  socket.on('seller-account-deleted', (d) => {
    if (!d || !d.groupId) return;
    if (typeof sellersCache !== 'undefined') { const i = sellersCache.findIndex((a) => a.groupId === d.groupId); if (i >= 0) sellersCache.splice(i, 1); renderSellers(); }
    closeModal('v51DelModal'); const sp = g$('sellerProfileModal'); if (sp && !sp.classList.contains('hidden')) closeModal('sellerProfileModal');
    deleting = null; if (typeof requestSellers === 'function') requestSellers();
  });
})();
