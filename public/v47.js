/* v3.21 (loaded last). Seller > Accounts: "Statement of account" - a PDF of every payment in and out for the chosen period,
   generated on the spot from the seller's own ledger. */
'use strict';
const v47safe = (fn) => { try { return fn(); } catch (e) { console.warn('[v47]', e); } };
const _accV47 = renderAccountsPage;
renderAccountsPage = function () {
  _accV47();
  v47safe(() => {
    const host = document.getElementById('txAccountsBody'), a = typeof sellerAccountState !== 'undefined' && sellerAccountState;
    if (!host || !a || !a.statementUrl || document.getElementById('v47Stmt')) return;
    const row = '<div class="v41-list" id="v47Stmt"><div class="v41-item v47-stmt"><span class="ico"><i class="fa-solid fa-file-lines"></i></span><span class="t"><b>Statement of account</b><small>PDF of every payment in and out</small></span>'
      + '<select id="v47Range" class="message-input" aria-label="Statement period"><option value="30">Last 30 days</option><option value="90" selected>Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last 12 months</option><option value="all">All activity</option></select>'
      + '<button type="button" class="admin-btn" onclick="v47Download()"><i class="fa-solid fa-download"></i> Download</button></div></div>';
    const anchor = document.getElementById('v42CryptoRow') || document.getElementById('rcIncoming');
    if (anchor) anchor.insertAdjacentHTML(anchor.id === 'v42CryptoRow' ? 'afterend' : 'beforebegin', row); else host.insertAdjacentHTML('beforeend', row);
  });
};
function v47Download() {
  const a = typeof sellerAccountState !== 'undefined' && sellerAccountState; if (!a || !a.statementUrl) return toast('Your statement is not available yet.', true);
  const sel = document.getElementById('v47Range'); const range = sel ? sel.value : 'all';
  const l = document.createElement('a'); l.href = a.statementUrl + '&range=' + encodeURIComponent(range); l.target = '_blank'; l.rel = 'noopener'; l.setAttribute('download', ''); l.dataset.v47 = '1';
  document.body.appendChild(l); l.click(); setTimeout(() => l.remove(), 500);
  toast('Preparing your statement…');
}
