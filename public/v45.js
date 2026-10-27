/* v3.17 (loaded last). Desk > Controls > Receiving accounts:
   a switch under EUR and GBP: "Use my US bank account (the USD details above)".
   Sellers in that currency then see the Desk's ONE US bank (same address, SWIFT, account and routing number, "Bank country: United States"),
   paid as an international SWIFT wire. Nothing is invented: it is the USD account you already entered. */
'use strict';
const _renderBankAdminV45 = renderBankAdmin;
renderBankAdmin = function () {
  _renderBankAdminV45();
  try {
    const box = document.getElementById('banksBox'); if (!box || !bankState) return;
    box.querySelectorAll('.bk-ccy').forEach((h) => {
      const c = (h.textContent || '').trim().slice(0, 3); if (c !== 'EUR' && c !== 'GBP') return;
      const grid = h.nextElementSibling; if (!grid || !grid.classList.contains('bk-grid') || box.querySelector('[data-bkusd="' + c + '"]')) return;
      const on = !!(bankState.profiles[c] && bankState.profiles[c].useUsd);
      h.insertAdjacentHTML('afterend', '<label class="v45-usd"><input type="checkbox" data-bkusd="' + c + '"' + (on ? ' checked' : '') + '><span><b>Use my US bank account for ' + c + '</b><small>Sellers in ' + c + ' see the same US bank as USD (same address, SWIFT, account and routing number, “Bank country: United States”) and are told to pay by international SWIFT wire. No IBAN is shown, because a US account has none.</small></span></label>');
      const cb = box.querySelector('[data-bkusd="' + c + '"]'); const sync = () => { grid.style.display = cb.checked ? 'none' : ''; };
      cb.addEventListener('change', sync); sync();
    });
  } catch (e) { console.warn('[v45]', e); }
};
saveBankProfiles = function () {
  const out = {};
  document.querySelectorAll('#banksBox [data-bk]').forEach((i) => { const [c, f] = i.dataset.bk.split('.'); (out[c] = out[c] || {})[f] = i.value.trim(); });
  document.querySelectorAll('#banksBox [data-bkusd]').forEach((cb) => { if (cb.checked) out[cb.dataset.bkusd] = { useUsd: true }; });
  socket.emit('admin-set-bank-profiles', { profiles: out });
};
