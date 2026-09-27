/* Quantum Secure Transaction Desk — client application */
const socket = io();

// ---------------- STATE ----------------
let sessionToken = sessionStorage.getItem('q_session_token') || ('token-' + Math.random().toString(36).slice(2, 15));
sessionStorage.setItem('q_session_token', sessionToken);

const urlParams = new URLSearchParams(window.location.search);
let activeGroupId = urlParams.get('groupId') || 'default-group';
// If the link itself says who the visitor is (?role=BUYER or SELLER — the
// old ?role=PARTY%20A/PARTY%20B form still works for links already sent
// out), lock them into that role so two people can never both land on the
// same slot just because they opened a shared link and forgot to change a
// dropdown. Whichever form is in the URL, only 'PARTY A'/'PARTY B' — never
// visible to the party — is what's actually sent to the server.
const ROLE_PARAM_MAP = { BUYER: 'PARTY A', SELLER: 'PARTY B', 'PARTY A': 'PARTY A', 'PARTY B': 'PARTY B' };
const urlLockedRole = ROLE_PARAM_MAP[urlParams.get('role')] || null;

let isAdminConfirmed = false;

// Admin Login is hidden from regular users entirely — it only appears if
// this exact URL parameter is present (bookmark it as ?officer=1), or was
// already revealed earlier in this browser tab.
const ADMIN_REVEAL_PARAM = 'officer';
if (urlParams.has(ADMIN_REVEAL_PARAM)) sessionStorage.setItem('q_admin_reveal', '1');
const adminLoginVisible = sessionStorage.getItem('q_admin_reveal') === '1';
if (adminLoginVisible) el('railLogin').classList.remove('hidden');
function updateRailVisibility() {
  el('iconRail').classList.toggle('fully-hidden', !isAdminConfirmed && !adminLoginVisible);
}
updateRailVisibility();

let currentSocketId = null;
let adminPasskeyMemory = null; // kept only in memory, used for CSV export auth link
let typingTimeout = null;
let recognition = null;
let selectedMsgIds = new Set();
let currentTargetMsg = null;
let replyTarget = null;
let fileUploadAllowed = true;
let groupsCache = [];
let directoryCache = [];
let messagesById = new Map();
let favorites = new Set(JSON.parse(localStorage.getItem('q_favorites') || '[]'));
let selectModeActive = false;
let translateBeforeSend = false;
let currentAdminRole = null;
let tasksCache = [];
let brandingCache = null;
let pushSubscribed = false;
let myRole = null; // 'PARTY A' | 'PARTY B' | null (admin) — as confirmed by the server, not just the dropdown
let currentGroupCustomNames = { A: 'Buyer', B: 'Seller' };
let currentGroupEmails = { A: null, B: null };
let myEmail = localStorage.getItem('q_user_email') || null;
let lastPresenceUsers = [];
let pendingInviteLinksGroupId = null; // set right after create-group, consumed once init-state for it arrives

const ROLE_LEVEL = { MODERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };
function hasMinRoleClient(role, minRole) {
  if (!role) return false;
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minRole] || 0);
}

// ---------------- GENERIC MODAL (replaces native prompt()/confirm()) ----------------
function showPromptModal({ title, message = '', placeholder = '', defaultValue = '' }, onConfirm) {
  el('genericModalTitle').textContent = title;
  el('genericModalMessage').textContent = message;
  el('genericModalMessage').style.display = message ? 'block' : 'none';
  const input = el('genericModalInput');
  input.style.display = 'block';
  input.placeholder = placeholder;
  input.value = defaultValue;
  el('genericModal').classList.remove('hidden');
  setTimeout(() => input.focus(), 50);
  const btn = el('genericModalConfirmBtn');
  const handler = () => {
    const val = input.value.trim();
    closeGenericModal();
    if (val) onConfirm(val);
  };
  btn.onclick = handler;
  input.onkeydown = (e) => { if (e.key === 'Enter') handler(); };
}
function showConfirmModal({ title, message }, onConfirm) {
  el('genericModalTitle').textContent = title;
  el('genericModalMessage').textContent = message;
  el('genericModalMessage').style.display = 'block';
  el('genericModalInput').style.display = 'none';
  el('genericModal').classList.remove('hidden');
  el('genericModalConfirmBtn').onclick = () => { closeGenericModal(); onConfirm(); };
}
function closeGenericModal() { el('genericModal').classList.add('hidden'); }

// ---------------- UTIL ----------------
function el(id) { return document.getElementById(id); }
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}
function toast(msg, isError = false, allowHtml = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  if (allowHtml) t.innerHTML = msg; else t.textContent = msg;
  el('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), allowHtml ? 9000 : 4500);
}
function initialsOf(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

// ---------------- I18N ----------------
function setUiLanguage(lang) { applyI18n(lang); }
(function initLang() {
  const saved = localStorage.getItem('q_ui_lang') || 'en';
  el('uiLangSelect').value = saved;
  applyI18n(saved);
})();

// ---------------- PANEL / NAV ----------------
function switchPanel(name) {
  if (!isAdminConfirmed) return; // defense in depth — regular users never get a group list
  el('railChats').classList.toggle('active', name === 'groups');
  el('railDirectory').classList.toggle('active', name === 'directory');
  el('groupsPanel').classList.toggle('hidden', name !== 'groups');
  el('directoryPanel').classList.toggle('hidden', name !== 'directory');
  showListPanelMobile();
}

function showListPanelMobile() {
  document.querySelector('.list-panel').classList.add('mobile-open');
}
function hideListPanelMobile() {
  document.querySelector('.list-panel').classList.remove('mobile-open');
}

function toggleFooterSecondary() {
  el('footerSecondary').classList.toggle('open');
}

function toggleAdminDrawer(force) {
  const drawer = el('adminDrawer');
  const shouldOpen = force !== undefined ? force : !drawer.classList.contains('open');
  drawer.classList.toggle('open', shouldOpen);
  el('adminDrawerMinimized').classList.add('hidden'); // any explicit open/close cancels a minimized state
  if (shouldOpen && isAdminConfirmed) socket.emit('admin-get-stats');
}
function openAdminDrawerTab(tab) { toggleAdminDrawer(true); setAdminTab(tab); }

function minimizeAdminDrawer() {
  el('adminDrawer').classList.remove('open');
  el('adminDrawerMinimized').classList.remove('hidden');
}
function restoreAdminDrawer() {
  el('adminDrawerMinimized').classList.add('hidden');
  el('adminDrawer').classList.add('open');
  if (isAdminConfirmed) socket.emit('admin-get-stats');
}

function setAdminTab(tab) {
  document.querySelectorAll('.drawer-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.drawer-tab-panel').forEach(p => p.classList.add('hidden'));
  el('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.remove('hidden');
  if (tab === 'transactions') loadTransactionsList();
  if (tab === 'accounts') { socket.emit('admin-get-kyc-queue'); socket.emit('admin-get-deposits-queue'); socket.emit('admin-get-withdrawals-queue'); }
  if (tab === 'controls') renderAnnouncementGroupChecks();
  if (tab === 'tasks') socket.emit('get-tasks', { groupId: activeGroupId });
  if (tab === 'branding') loadBrandingIntoForm();
}

function updateRoleBadge() {
  const badge = el('drawerRoleBadge');
  if (!badge) return;
  badge.className = 'role-badge';
  if (currentAdminRole === 'SUPER_ADMIN') { badge.textContent = 'Super Admin'; badge.classList.add('super'); }
  else if (currentAdminRole === 'MODERATOR') { badge.textContent = 'Moderator'; badge.classList.add('moderator'); }
  else if (currentAdminRole === 'ADMIN') { badge.textContent = 'Admin'; }
  else { badge.textContent = ''; }
  el('moderatorNotice').style.display = currentAdminRole === 'MODERATOR' ? 'block' : 'none';
}

function applyGroupBanner(bannerUrl) {
  const el2 = el('groupBannerImg');
  if (bannerUrl) {
    el2.style.backgroundImage = `url('${bannerUrl}')`;
    el2.classList.add('has-image');
    el2.classList.remove('hidden');
  } else {
    el2.classList.remove('has-image');
    el2.classList.add('hidden');
  }
}

function updateTasksDot() {
  const pending = tasksCache.filter(t => t.status === 'Pending').length;
  el('tasksDot').classList.toggle('hidden', pending === 0);
}

// ---------------- SESSION / JOIN ----------------
function loginAsAdmin() {
  showPromptModal(
    { title: 'Administrator Login', placeholder: 'Enter Administrator Passkey' },
    (password) => { adminPasskeyMemory = password; joinSession(password); }
  );
}

function joinSession(adminKey = null) {
  const selectedRole = adminKey ? 'ADMINISTRATOR' : (urlLockedRole || el('roleSelect').value);
  const email = localStorage.getItem('q_user_email') || undefined;
  socket.emit('join-room', { groupId: activeGroupId, role: selectedRole, adminKey, sessionToken, email });
}

socket.on('connect', () => { currentSocketId = socket.id; joinSession(adminPasskeyMemory); });

socket.on('error-msg', (msg) => toast(msg, true));

// ---------------- INIT STATE ----------------
socket.on('init-state', async (data) => {
  isAdminConfirmed = data.isAdminConfirmed;
  currentAdminRole = data.adminRole || null;
  myRole = data.role || null;
  currentSocketId = data.socketId;
  activeGroupId = data.group.id;
  currentGroupCustomNames = data.group.customNames || { A: 'Buyer', B: 'Seller' };
  currentGroupEmails = data.group.emails || { A: null, B: null };
  _myToken = data.sessionToken; // must be set before rendering messages below
  document.body.classList.toggle('is-admin', isAdminConfirmed);
  document.body.classList.remove('role-admin', 'role-super_admin', 'role-moderator');
  if (currentAdminRole) document.body.classList.add('role-' + currentAdminRole.toLowerCase());
  updateRailVisibility();
  updateRoleBadge();

  el('currentGroupName').textContent = data.group.name;
  // Hide the picker entirely once a role is locked in by the link (or for admins) —
  // there's nothing left for the visitor to choose.
  el('roleSelect').style.display = (isAdminConfirmed || urlLockedRole) ? 'none' : 'inline-block';
  if (urlLockedRole) el('roleSelect').disabled = true;
  fileUploadAllowed = data.group.fileUploadsEnabled;
  updateUploadUiState();
  updateTransactionBanner(data.group.transactionFormEnabled);
  applyGroupBanner(data.group.bannerUrl);

  // Admin lands on the chat view (list panel starts closed on mobile);
  // regular users never have a list panel at all.
  hideListPanelMobile();
  exitSelectMode();

  el('messageContainer').innerHTML = '<div class="drop-overlay" id="dropOverlay"><i class="fa-solid fa-cloud-arrow-up"></i><span data-i18n="dropToUpload">Drop file to upload</span></div>';
  messagesById.clear();
  if (data.messages.length === 0) {
    el('messageContainer').insertAdjacentHTML('beforeend', `<div class="empty-state"><i class="fa-solid fa-comments"></i><span>No messages yet</span><small>Say hello to get the conversation started.</small></div>`);
  } else {
    data.messages.forEach(renderMessage);
  }

  renderPinned(data.pinnedMessages);
  tasksCache = data.tasks || [];
  updateTasksDot();
  if (isAdminConfirmed) {
    loadAdminNotes();
    socket.emit('admin-get-stats');
    socket.emit('get-all-groups'); // server ignores this for non-admins anyway; only bother asking as admin
    if (hasMinRoleClient(currentAdminRole, 'ADMIN')) socket.emit('admin-get-dashboard-widgets');
  } else {
    maybeShowOnboarding();
  }

  if (pendingInviteLinksGroupId && pendingInviteLinksGroupId === activeGroupId) {
    pendingInviteLinksGroupId = null;
    openInviteLinksModal(activeGroupId, currentGroupCustomNames.A, currentGroupCustomNames.B);
  }

  // The authoritative presence list for this group arrives moments later via
  // 'presence-update'; render an empty (all-offline) cluster now so the header
  // never flashes stale data left over from a previously viewed group.
  lastPresenceUsers = [];
  renderPresenceBadges(lastPresenceUsers);
});

// ---------------- MESSAGES ----------------
let _myToken = null;
function myToken() { return _myToken; }

function bubbleClassFor(data) {
  if (data.sender === 'SYSTEM') return 'msg-system';
  const mine = data.senderToken === myToken();
  if (mine) return 'msg-party msg-mine-class';
  if (data.senderRole === 'ADMINISTRATOR') return 'msg-admin';
  return 'msg-other';
}

function renderMessage(data) {
  messagesById.set(data.id, data);
  const container = el('messageContainer');
  const wrapper = document.createElement('div');
  const mine = data.senderToken === myToken();
  wrapper.className = `msg-wrapper ${mine ? 'msg-mine' : ''}`;
  wrapper.id = `msg-row-${data.id}`;

  if (data.sender === 'SYSTEM') {
    wrapper.innerHTML = `<div class="message msg-system">${data.text}</div>`;
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    return;
  }

  if (data.sender === 'ANNOUNCEMENT') {
    wrapper.innerHTML = `<div class="message msg-announcement" id="msg-row-inner-${data.id}">
      <i class="fa-solid fa-bullhorn ann-icon"></i>
      <div class="ann-body"><div class="ann-label">Announcement · ${data.time}</div><div class="ann-text">${data.text}</div></div>
    </div>`;
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const checkbox = document.createElement('div');
  checkbox.className = 'msg-select-checkbox';
  checkbox.innerHTML = '<i class="fa-solid fa-check" style="font-size:0.7rem; opacity:0;"></i>';
  checkbox.onclick = (e) => { e.stopPropagation(); toggleMessageSelected(data.id); };

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${bubbleClassFor(data)}`;
  msgDiv.dataset.msgId = data.id;

  let pressTimer;
  msgDiv.addEventListener('contextmenu', (e) => showContextMenu(e, data));
  msgDiv.addEventListener('touchstart', (e) => { pressTimer = setTimeout(() => showContextMenu(e, data), 500); });
  msgDiv.addEventListener('touchend', () => clearTimeout(pressTimer));
  msgDiv.addEventListener('click', () => { if (selectModeActive && isAdminConfirmed) toggleMessageSelected(data.id); });

  let replyHtml = '';
  if (data.replyToId && messagesById.has(data.replyToId)) {
    const orig = messagesById.get(data.replyToId);
    replyHtml = `<div class="reply-quote"><b>${orig.sender}</b>: ${(orig.text || '').slice(0, 80)}</div>`;
  }

  let fileHtml = '';
  if (data.fileUrl) {
    if (data.fileType === 'image') {
      fileHtml = `<img class="msg-image" src="${data.fileUrl}" onclick="window.open('${data.fileUrl}','_blank')" />`;
    } else {
      fileHtml = `<a class="msg-file" href="${data.fileUrl}" target="_blank" download><i class="fa-solid fa-file-arrow-down"></i> ${data.fileName || 'Attachment'}</a>`;
    }
  }

  const editedBadge = (isAdminConfirmed && data.isEdited) ? '<span style="font-size:0.65rem; color:var(--accent-amber); margin-left:6px;">(edited)</span>' : '';
  const forwardedTag = data.forwardedFrom ? `<div style="font-size:0.68rem; color:var(--text-faint); margin-bottom:4px;"><i class="fa-solid fa-share"></i> Forwarded</div>` : '';
  const translateLink = data.text ? `<div class="translate-link" onclick="event.stopPropagation(); translateMessage('${data.id}')" id="translate-link-${data.id}"><i class="fa-solid fa-language"></i> <span data-i18n="translate">Translate</span></div>` : '';
  const statusTicks = mine ? `<span id="msg-status-${data.id}">${renderStatusTicks(data.status)}</span>` : '';

  msgDiv.innerHTML = `
    <div class="sender-tag">
      <span>${data.sender}</span>
      <i class="fa-solid fa-thumbtack" id="msg-pin-${data.id}" style="color:var(--accent-amber); display:none;"></i>
    </div>
    ${forwardedTag}
    ${replyHtml}
    <div id="msg-text-${data.id}">${data.text}${editedBadge}</div>
    ${fileHtml}
    <div class="msg-reactions" id="msg-reactions-${data.id}"></div>
    ${translateLink}
    <div id="translated-box-${data.id}"></div>
    <div class="msg-time">${data.time}${statusTicks}</div>
  `;

  if (mine) { wrapper.appendChild(msgDiv); wrapper.appendChild(checkbox); }
  else { wrapper.appendChild(checkbox); wrapper.appendChild(msgDiv); }
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  renderReactions(data.id, data.reactions || {});
}

function renderReactions(messageId, summary) {
  const box = el(`msg-reactions-${messageId}`);
  if (!box) return;
  box.innerHTML = Object.entries(summary).map(([emoji, count]) => `<span class="reaction-chip">${emoji} ${count}</span>`).join('');
}

function renderStatusTicks(status) {
  if (status === 'read') return `<span class="msg-status-ticks read" title="Read"><i class="fa-solid fa-check-double"></i></span>`;
  if (status === 'delivered') return `<span class="msg-status-ticks delivered" title="Delivered"><i class="fa-solid fa-check-double"></i></span>`;
  return `<span class="msg-status-ticks sent" title="Sent"><i class="fa-solid fa-check"></i></span>`;
}

socket.on('message-status-bulk-update', ({ messageIds, status }) => {
  messageIds.forEach(id => {
    const el2 = el(`msg-status-${id}`);
    if (el2) el2.innerHTML = renderStatusTicks(status);
    if (messagesById.has(id)) messagesById.get(id).status = status;
  });
});

socket.on('message', renderMessage);

socket.on('message-edited', ({ messageId, newText }) => {
  const node = el(`msg-text-${messageId}`);
  if (node) node.innerHTML = newText;
  if (messagesById.has(messageId)) messagesById.get(messageId).text = newText;
});

socket.on('message-edited-admin-flag', ({ messageId }) => {
  const node = el(`msg-text-${messageId}`);
  if (node && isAdminConfirmed && !node.innerHTML.includes('(edited)')) {
    node.innerHTML += ' <span style="font-size:0.65rem; color:var(--accent-amber);">(edited)</span>';
  }
});

socket.on('messages-bulk-deleted', ({ messageIds }) => {
  messageIds.forEach(id => { const rowEl = el(`msg-row-${id}`); if (rowEl) rowEl.remove(); });
});

socket.on('reaction-updated', ({ messageId, reactions }) => renderReactions(messageId, reactions));

// ---------------- SEND MESSAGE / TRANSLATION ----------------
async function translateText(text, targetLang, sourceLang = 'autodetect') {
  if (!text || !targetLang) return text;
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`);
    const data = await res.json();
    return data?.responseData?.translatedText || text;
  } catch (err) { return text; }
}

function toggleTranslateBeforeSend() {
  translateBeforeSend = !translateBeforeSend;
  el('translateToggleBtn').classList.toggle('active', translateBeforeSend);
  toast(translateBeforeSend
    ? `Messages will be translated to ${el('targetLangSelect').selectedOptions[0].textContent.trim()} before sending.`
    : 'Sending in your original language (no auto-translate).');
}

async function translateMessage(messageId) {
  const data = messagesById.get(messageId);
  if (!data) return;
  const box = el(`translated-box-${messageId}`);
  const link = el(`translate-link-${messageId}`);
  if (!box || !link) return;

  // Toggle back to hidden if already showing a translation
  if (box.dataset.showing === '1') {
    box.innerHTML = '';
    box.dataset.showing = '0';
    link.innerHTML = '<i class="fa-solid fa-language"></i> <span data-i18n="translate">Translate</span>';
    return;
  }

  link.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Translating...';
  const targetLang = el('targetLangSelect').value || 'en';
  const plainText = data.text.replace(/<[^>]*>/g, '');
  const translated = await translateText(plainText, targetLang);
  box.innerHTML = `<div class="translated-text"><i class="fa-solid fa-language"></i> ${escapeHtml(translated)}</div>`;
  box.dataset.showing = '1';
  link.innerHTML = '<i class="fa-solid fa-rotate-left"></i> <span>Show original</span>';
}

async function sendMsg() {
  const input = el('messageInput');
  const rawText = input.value.trim();
  if (!rawText) return;
  const targetLang = el('targetLangSelect').value;
  const outgoingText = translateBeforeSend ? await translateText(rawText, targetLang) : rawText;
  socket.emit('send-message', {
    groupId: activeGroupId, text: outgoingText, targetLang,
    replyToId: replyTarget ? replyTarget.id : null
  });
  input.value = '';
  cancelReply();
}

// ---------------- REPLY ----------------
function startReply(data) {
  replyTarget = data;
  el('replyPreviewBar').classList.remove('hidden');
  el('replyPreviewSender').textContent = data.sender;
  el('replyPreviewText').textContent = (data.text || '').slice(0, 90);
  el('messageInput').focus();
}
function cancelReply() { replyTarget = null; el('replyPreviewBar').classList.add('hidden'); }

// ---------------- TYPING ----------------
function handleTyping() {
  const currentDraft = el('messageInput').value;
  socket.emit('typing-start', { isTyping: true, currentDraft });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing-start', { isTyping: false, currentDraft: '' }), 1500);
}
socket.on('user-typing', ({ sender, isTyping }) => { el('typingIndicator').textContent = isTyping ? `${sender} is typing...` : ''; });
socket.on('admin-live-draft', ({ sender, draftText }) => {
  if (!isAdminConfirmed) return;
  el('spectatorBox').textContent = draftText ? `${sender}: "${draftText}"` : 'No active typing detected...';
});

// ---------------- VOICE ----------------
function initSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const input = el('messageInput');
      input.value += (input.value ? ' ' : '') + transcript;
      handleTyping();
    };
  }
}
function toggleSpeechRecognition() {
  if (!recognition) initSpeechRecognition();
  if (!recognition) return toast('Speech recognition not supported in this browser.', true);
  recognition.start();
}

// ---------------- FILE UPLOAD (input + drag&drop) ----------------
function updateUploadUiState() {
  el('fileUploadLabel').style.opacity = fileUploadAllowed ? '1' : '0.35';
  el('fileUploadLabel').style.pointerEvents = fileUploadAllowed ? 'auto' : 'none';
}
socket.on('upload-permission-changed', ({ fileUploadsEnabled }) => {
  fileUploadAllowed = fileUploadsEnabled;
  updateUploadUiState();
  toast(`File uploads ${fileUploadsEnabled ? 'enabled' : 'disabled'} for this group.`);
});

async function uploadFile(file) {
  if (!fileUploadAllowed) return toast('File transfers are currently locked by the Admin.', true);
  if (file.size > 15 * 1024 * 1024) return toast('File exceeds the 15MB limit.', true);
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Upload failed', true);
    socket.emit('send-message', { groupId: activeGroupId, text: '', fileUrl: data.fileUrl, fileType: data.fileType, fileName: data.fileName });
  } catch (err) { toast('Upload failed', true); }
}
function handleFileInputUpload(input) { if (input.files && input.files[0]) uploadFile(input.files[0]); input.value = ''; }

(function setupDragDrop() {
  const zone = el('messageContainer');
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('drag-active'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); if (evt === 'drop') return; zone.classList.remove('drag-active'); }));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-active');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });
})();

// ---------------- CONTEXT MENU ----------------
const contextMenu = el('contextMenu');
function showContextMenu(e, data) {
  e.preventDefault();
  currentTargetMsg = data;
  const x = e.clientX || (e.touches && e.touches[0].clientX) || 120;
  const y = e.clientY || (e.touches && e.touches[0].clientY) || 120;
  contextMenu.style.top = `${Math.min(y, window.innerHeight - 260)}px`;
  contextMenu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  contextMenu.style.display = 'flex';
}
document.addEventListener('click', () => { contextMenu.style.display = 'none'; el('reactionPicker').style.display = 'none'; });

function triggerCtxReply() { if (currentTargetMsg) startReply(currentTargetMsg); }

function triggerCtxForward() {
  if (!currentTargetMsg) return;
  const list = el('forwardGroupList');
  list.innerHTML = groupsCache.filter(g => g.id !== activeGroupId).map(g =>
    `<div class="forward-group-item" onclick="doForward('${g.id}')"><i class="fa-solid fa-comments"></i> ${escapeHtml(g.name)}</div>`
  ).join('') || '<div style="color:var(--text-muted); font-size:0.85rem;">No other groups available.</div>';
  el('forwardModal').classList.remove('hidden');
}
function doForward(targetGroupId) {
  socket.emit('send-message', { groupId: targetGroupId, text: currentTargetMsg.text, targetLang: 'en', forwardedFrom: currentTargetMsg.id });
  closeModal('forwardModal');
  toast('Message forwarded.');
}

function triggerCtxReact(e) {
  const picker = el('reactionPicker');
  const rect = contextMenu.getBoundingClientRect();
  picker.style.top = `${rect.top}px`;
  picker.style.left = `${rect.right + 8}px`;
  picker.style.display = 'flex';
}
function pickReaction(emoji) {
  if (!currentTargetMsg) return;
  socket.emit('toggle-reaction', { groupId: activeGroupId, messageId: currentTargetMsg.id, emoji });
  el('reactionPicker').style.display = 'none';
}

function triggerCtxPin() {
  if (!currentTargetMsg || !isAdminConfirmed) return;
  socket.emit('admin-toggle-pin-message', { groupId: activeGroupId, messageId: currentTargetMsg.id });
}
function triggerCtxEdit() {
  if (!currentTargetMsg || !isAdminConfirmed) return;
  showPromptModal(
    { title: 'Edit Message', defaultValue: currentTargetMsg.text.replace(/<[^>]*>/g, '') },
    (newText) => socket.emit('admin-edit-message', { groupId: activeGroupId, messageId: currentTargetMsg.id, newText })
  );
}
function triggerCtxHistory() {
  if (!currentTargetMsg || !isAdminConfirmed) return;
  socket.emit('admin-get-edit-history', { messageId: currentTargetMsg.id });
}
socket.on('edit-history-result', ({ history }) => {
  const list = el('historyList');
  list.innerHTML = history.length
    ? history.map(h => `<div class="tx-card"><div class="tx-card-row"><b>${new Date(h.editedAt).toLocaleString()}</b></div><div>${h.oldText}</div></div>`).join('')
    : '<div style="color:var(--text-muted);">No prior edits recorded.</div>';
  el('historyModal').classList.remove('hidden');
});

// ---------------- SELECT MODE / BULK DELETE ----------------
function toggleSelectMode() {
  if (!isAdminConfirmed) return;
  selectModeActive = !selectModeActive;
  el('messageContainer').classList.toggle('select-mode', selectModeActive);
  el('selectModeBtn').classList.toggle('active', selectModeActive);
  if (!selectModeActive) clearSelection();
}
function exitSelectMode() {
  selectModeActive = false;
  el('messageContainer')?.classList.remove('select-mode');
  el('selectModeBtn')?.classList.remove('active');
  clearSelection();
}
function triggerCtxSelect() {
  if (!currentTargetMsg || !isAdminConfirmed) return;
  if (!selectModeActive) toggleSelectMode();
  toggleMessageSelected(currentTargetMsg.id);
}
function toggleMessageSelected(id) {
  const row = el(`msg-row-${id}`);
  if (!row) return;
  const bubble = row.querySelector('.message');
  const checkbox = row.querySelector('.msg-select-checkbox');
  if (selectedMsgIds.has(id)) {
    selectedMsgIds.delete(id);
    bubble?.classList.remove('selected-msg');
    checkbox?.classList.remove('checked');
  } else {
    selectedMsgIds.add(id);
    bubble?.classList.add('selected-msg');
    checkbox?.classList.add('checked');
  }
  updateBulkDeleteBar();
}
function selectAllMessages() {
  if (!isAdminConfirmed) return;
  if (!selectModeActive) toggleSelectMode();
  messagesById.forEach((data, id) => {
    if (data.sender === 'SYSTEM') return;
    selectedMsgIds.add(id);
    const row = el(`msg-row-${id}`);
    row?.querySelector('.message')?.classList.add('selected-msg');
    row?.querySelector('.msg-select-checkbox')?.classList.add('checked');
  });
  updateBulkDeleteBar();
}
function clearSelection() {
  selectedMsgIds.forEach(id => {
    const row = el(`msg-row-${id}`);
    row?.querySelector('.message')?.classList.remove('selected-msg');
    row?.querySelector('.msg-select-checkbox')?.classList.remove('checked');
  });
  selectedMsgIds.clear();
  updateBulkDeleteBar();
}
function updateBulkDeleteBar() {
  const bar = el('bulkDeleteBar');
  if (selectedMsgIds.size > 0 && isAdminConfirmed) { bar.style.display = 'flex'; el('bulkDeleteCount').textContent = `${selectedMsgIds.size} message(s) selected`; }
  else bar.style.display = 'none';
}
function executeBulkDeleteMessages() {
  if (selectedMsgIds.size === 0) return;
  showConfirmModal(
    { title: 'Delete Messages', message: `Delete ${selectedMsgIds.size} selected message(s)? This cannot be undone.` },
    () => {
      socket.emit('admin-bulk-delete-messages', { groupId: activeGroupId, messageIds: Array.from(selectedMsgIds) });
      exitSelectMode();
    }
  );
}
function triggerCtxDelete() {
  if (!currentTargetMsg || !isAdminConfirmed) return;
  showConfirmModal(
    { title: 'Delete Message', message: 'Delete this message? This cannot be undone.' },
    () => socket.emit('admin-bulk-delete-messages', { groupId: activeGroupId, messageIds: [currentTargetMsg.id] })
  );
}

function closeModal(id) { el(id).classList.add('hidden'); }

// ---------------- PINNED ----------------
function renderPinned(list) {
  el('pinnedDot').classList.toggle('hidden', list.length === 0);
  el('pinnedList').innerHTML = list.map(m =>
    `<div class="pinned-item" onclick="scrollToMessage('${m.id}')"><span><b>${m.sender}:</b> ${(m.text || '').slice(0, 80)}</span></div>`
  ).join('');
  document.querySelectorAll('[id^="msg-pin-"]').forEach(i => i.style.display = 'none');
  list.forEach(m => { const pinEl = el(`msg-pin-${m.id}`); if (pinEl) pinEl.style.display = 'inline'; });
}
socket.on('pinned-messages-updated', ({ pinnedMessages }) => renderPinned(pinnedMessages));
function togglePinnedBar() { el('pinnedBar').classList.toggle('hidden'); }
function scrollToMessage(id) {
  const rowEl = el(`msg-row-${id}`);
  if (rowEl) { rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); rowEl.querySelector('.message')?.animate([{ outline: '2px solid var(--accent-cyan)' }, { outline: '2px solid transparent' }], { duration: 1200 }); }
}

// ---------------- GROUPS LIST ----------------
socket.on('all-groups-list', (list) => {
  groupsCache = list;
  renderGroupsList();
  const sel = el('sendFormGroupSelect');
  if (sel) {
    const prevValue = sel.value;
    sel.innerHTML = list.map(g => `<option value="${g.id}">${escapeHtml(g.name)}${g.transactionFormEnabled ? ' (currently ON)' : ''}</option>`).join('');
    if (list.some(g => g.id === prevValue)) sel.value = prevValue;
  }
});

function toggleFavorite(groupId, ev) {
  ev.stopPropagation();
  if (favorites.has(groupId)) favorites.delete(groupId); else favorites.add(groupId);
  localStorage.setItem('q_favorites', JSON.stringify([...favorites]));
  renderGroupsList();
}

function renderGroupsList() {
  const query = (el('groupSearchInput').value || '').toLowerCase();
  const container = el('chatsListContainer');
  let list = groupsCache.filter(g => g.name.toLowerCase().includes(query));
  list.sort((a, b) => (favorites.has(b.id) - favorites.has(a.id)) || (b.highlighted - a.highlighted));

  container.innerHTML = list.map(g => {
    const onlineCount = directoryCache.filter(u => u.isOnline).length; // global online count shown per-group as presence hint
    return `
    <div class="chat-item ${g.id === activeGroupId ? 'active' : ''}" onclick="switchGroup('${g.id}')">
      <div class="avatar">${initialsOf(g.name)}</div>
      <div class="chat-info">
        <div class="chat-name-row">
          <span class="chat-name">${escapeHtml(g.name)} ${g.highlighted ? '<i class="fa-solid fa-star" style="color:var(--accent-amber); font-size:0.7rem;"></i>' : ''}</span>
        </div>
        <div class="chat-last-msg">${escapeHtml(g.lastMessagePreview)}</div>
      </div>
      <div class="chat-item-meta">
        <i class="fa-solid fa-star star-icon ${favorites.has(g.id) ? '' : 'inactive'}" onclick="toggleFavorite('${g.id}', event)"></i>
        ${g.unreadCount > 0 ? `<span class="unread-badge">${g.unreadCount}</span>` : `<span class="online-count-pill">${onlineCount} online</span>`}
      </div>
    </div>`;
  }).join('');
}

function switchGroup(groupId) {
  hideListPanelMobile();
  if (groupId === activeGroupId) return;
  activeGroupId = groupId;
  socket.emit('mark-group-read', { groupId });
  joinSession(adminPasskeyMemory);
}

socket.on('group-created-and-switch', ({ newGroupId }) => {
  pendingInviteLinksGroupId = newGroupId; // consumed by init-state once we're in the new room
  activeGroupId = newGroupId;
  joinSession(adminPasskeyMemory);
});
socket.on('force-room-switch', ({ newGroupId }) => { activeGroupId = newGroupId; joinSession(adminPasskeyMemory); });

// Renaming a party relabels new messages going forward; it deliberately does
// NOT force a rejoin (that used to cause a disconnect/reconnect cycle that
// spammed the chat with duplicate system messages). Just confirm it worked,
// and if it's the group the officer is currently looking at, update the
// header badges immediately so the new name shows without a reload.
socket.on('party-renamed', ({ groupId, party, customNames }) => {
  if (groupId === activeGroupId && customNames) {
    currentGroupCustomNames = customNames;
    renderPresenceBadges(lastPresenceUsers);
  }
  toast(`Party ${party} renamed. They'll see their new label after their next reload.`);
  socket.emit('get-all-groups');
});

function createNewGroup() {
  el('createGroupNameInput').value = '';
  el('createGroupNameAInput').value = '';
  el('createGroupNameBInput').value = '';
  el('createGroupEmailAInput').value = '';
  el('createGroupEmailBInput').value = '';
  el('createGroupModal').classList.remove('hidden');
  el('createGroupNameInput').focus();
}
function submitCreateGroupModal() {
  const groupName = el('createGroupNameInput').value.trim();
  const customNameA = el('createGroupNameAInput').value.trim();
  const customNameB = el('createGroupNameBInput').value.trim();
  const emailA = el('createGroupEmailAInput').value.trim();
  const emailB = el('createGroupEmailBInput').value.trim();
  if (emailA && !isValidEmailClient(emailA)) return toast("That doesn't look like a valid buyer email.", true);
  if (emailB && !isValidEmailClient(emailB)) return toast("That doesn't look like a valid seller email.", true);
  closeModal('createGroupModal');
  socket.emit('create-group', { groupName, customNameA, customNameB, emailA, emailB });
}
function isValidEmailClient(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function deleteCurrentGroup() {
  showConfirmModal({ title: 'Delete Group', message: 'Delete the active group? All its messages and transactions will be removed. This cannot be undone.' }, () => {
    socket.emit('delete-group', { groupId: activeGroupId });
  });
}
function clearChatHistory() {
  showConfirmModal({ title: 'Clear Chat History', message: 'Delete every message in this group? This cannot be undone.' }, () => {
    socket.emit('admin-clear-chat', { groupId: activeGroupId });
    toast('Chat history cleared.');
  });
}
function renameParty(party) {
  showPromptModal({ title: `Rename Party ${party}`, placeholder: 'New display name' }, (newName) => {
    socket.emit('rename-party', { groupId: activeGroupId, party, newName });
  });
}
function setPartyEmail(party) {
  const current = (party === 'A' ? currentGroupEmails.A : currentGroupEmails.B) || '';
  showPromptModal({
    title: `${party === 'A' ? (currentGroupCustomNames.A || 'Buyer') : (currentGroupCustomNames.B || 'Seller')}'s Email`,
    message: 'Used only for missed-message alerts, sent once you approve them. Leave blank and save to clear it.',
    placeholder: 'name@example.com',
    defaultValue: current
  }, (value) => {
    const email = value.trim();
    if (email && !isValidEmailClient(email)) return toast("That doesn't look like a valid email.", true);
    socket.emit('admin-set-party-email', { groupId: activeGroupId, party, email });
  });
}
socket.on('party-email-updated', ({ groupId, party, email }) => {
  if (groupId === activeGroupId) {
    if (party === 'A') currentGroupEmails.A = email; else currentGroupEmails.B = email;
  }
  toast(`${party === 'A' ? 'Buyer' : 'Seller'} email ${email ? 'updated' : 'cleared'}.`);
});
socket.on('my-email-updated', ({ email }) => toast(`Your email is set — you'll get alerts at ${email} if you miss a chat.`));

// ---------------- PENDING EMAIL APPROVALS (admin only) ----------------
let pendingEmailsCache = [];
function renderPendingEmailsList() {
  const box = el('pendingEmailsList');
  if (!box) return;
  if (!pendingEmailsCache.length) {
    box.innerHTML = '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No pending emails.</p>';
    return;
  }
  box.innerHTML = pendingEmailsCache.map(p => `
    <div class="invite-link-row" style="flex-wrap:wrap;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:800; font-size:0.78rem;">${escapeHtml(p.groupName)} — to ${escapeHtml(p.toEmail)} (${p.party === 'A' ? 'Buyer' : 'Seller'})</div>
        <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">From ${escapeHtml(p.fromName)}: "${escapeHtml(p.text)}"</div>
      </div>
      <button class="admin-btn" onclick="approvePendingEmail('${p.id}')"><i class="fa-solid fa-check"></i> Approve</button>
      <button class="admin-btn admin-btn-danger" onclick="rejectPendingEmail('${p.id}')"><i class="fa-solid fa-xmark"></i> Reject</button>
    </div>`).join('');
}
socket.on('pending-emails-list', (list) => { pendingEmailsCache = list; renderPendingEmailsList(); });
socket.on('pending-email-created', (p) => { pendingEmailsCache.unshift(p); renderPendingEmailsList(); toast(`New missed-message email awaiting your approval (${p.party === 'A' ? 'Buyer' : 'Seller'}).`); });
socket.on('pending-email-resolved', (p) => { pendingEmailsCache = pendingEmailsCache.filter(x => x.id !== p.id); renderPendingEmailsList(); });
function approvePendingEmail(id) { socket.emit('admin-approve-pending-email', { id }); }
function rejectPendingEmail(id) {
  showConfirmModal({ title: 'Reject Email', message: 'This missed-message email will not be sent. Continue?' }, () => {
    socket.emit('admin-reject-pending-email', { id });
  });
}

// ---------------- SELF-SERVICE EMAIL (Buyer/Seller) ----------------
// Admin taps the bell-adjacent envelope to jump straight to the Pending
// Email Approvals panel; Buyer/Seller use it to add or update their own
// email for missed-message alerts.
function openEmailSettings() {
  if (isAdminConfirmed) return openAdminDrawerTab('controls');
  showPromptModal({
    title: 'Email Alerts',
    message: "Add your email and, once the Desk Officer approves it, you'll get an email any time you miss a chat message.",
    placeholder: 'name@example.com',
    defaultValue: myEmail || ''
  }, (value) => {
    const email = value.trim();
    if (!isValidEmailClient(email)) return toast("That doesn't look like a valid email.", true);
    myEmail = email;
    localStorage.setItem('q_user_email', email);
    socket.emit('set-my-email', { groupId: activeGroupId, email });
  });
}
function toggleFileLock() { socket.emit('admin-toggle-upload-permission', { groupId: activeGroupId }); }

// =====================================================================
// TRANSACTION ACCOUNT SYSTEM (client) — Seller registration/KYC/balance/
// deposits/withdrawals, plus the matching Admin backend queues. Buyer never
// sees any of this; none of it lives in the general group state.
// =====================================================================
let sellerAccountState = null;
let sellerDeposits = [];
let sellerWithdrawals = [];
let kycQueueCache = [];
let depositsQueueCache = [];
let withdrawalsQueueCache = [];
const CCY_SYMBOL = { USD: '$', GBP: '£', EUR: '€' };
function fmtMoney(amount, ccy) { return `${CCY_SYMBOL[ccy] || ''}${Number(amount || 0).toFixed(2)}${CCY_SYMBOL[ccy] ? '' : ' ' + (ccy || '')}`; }
function fmtDate(iso) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

// Large phone-camera photos are the single most common cause of upload
// failures (a hosting proxy or CDN in front of the app frequently caps
// request size well below what a raw 8-12MP photo needs) — so every image
// is downscaled and re-compressed client-side before it's ever sent.
// Non-images (PDFs) are sent as-is.
function compressImageFile(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return resolve(file);
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file); // compression failed for some reason — fall back to the original
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file); // not a decodable image — send as-is, server will reject if truly invalid
    reader.readAsDataURL(file);
  });
}

// A generic "upload this file, get back a URL" — unlike uploadFile() this
// never sends a chat message and is never blocked by the chat file-lock
// toggle (KYC documents aren't chat attachments). Compresses images first
// and surfaces the real failure reason instead of a bare "Upload failed".
async function uploadRawFile(rawFile) {
  if (!rawFile) return { ok: false, error: 'No file selected.' };
  const file = await compressImageFile(rawFile);
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: 'File is too large even after compression (15MB limit).' };
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    let data;
    try { data = await res.json(); }
    catch { return { ok: false, error: `Server returned an unexpected response (HTTP ${res.status}). Your hosting platform may be blocking large uploads.` }; }
    if (!res.ok) return { ok: false, error: data.error || `Upload failed (HTTP ${res.status}).` };
    return { ok: true, url: data.fileUrl };
  } catch (err) {
    return { ok: false, error: 'Network error during upload — check your connection and try again.' };
  }
}

socket.on('seller-account-state', (acct) => {
  if (activeGroupId && acct.groupId !== activeGroupId) return;
  sellerAccountState = acct;
  renderTxAccountUI();
  maybeShowTxRegModal();
});
socket.on('deposits-list', ({ groupId, deposits }) => { if (groupId === activeGroupId) { sellerDeposits = deposits; renderTxDepositsAndWithdrawals(); } });
socket.on('withdrawals-list', ({ groupId, withdrawals }) => { if (groupId === activeGroupId) { sellerWithdrawals = withdrawals; renderTxDepositsAndWithdrawals(); } });
socket.on('deposit-created', (d) => {
  if (d.groupId === activeGroupId) { sellerDeposits = [d, ...sellerDeposits.filter(x => x.id !== d.id)]; renderTxDepositsAndWithdrawals(); }
  if (!depositsQueueCache.find(x => x.id === d.id) && d.status === 'held_in_vault') depositsQueueCache = [d, ...depositsQueueCache];
  renderDepositsQueue();
});
socket.on('deposit-updated', (d) => {
  if (d.groupId === activeGroupId) { sellerDeposits = sellerDeposits.map(x => x.id === d.id ? d : x); renderTxDepositsAndWithdrawals(); }
});
socket.on('deposit-resolved', (d) => { depositsQueueCache = depositsQueueCache.filter(x => x.id !== d.id); renderDepositsQueue(); });
socket.on('withdrawal-created', (w) => {
  if (w.groupId === activeGroupId) { sellerWithdrawals = [w, ...sellerWithdrawals.filter(x => x.id !== w.id)]; renderTxDepositsAndWithdrawals(); toast('Withdrawal request submitted.'); }
  if (!withdrawalsQueueCache.find(x => x.id === w.id)) withdrawalsQueueCache = [w, ...withdrawalsQueueCache];
  renderWithdrawalsQueue();
});
socket.on('withdrawal-updated', (w) => {
  if (w.groupId === activeGroupId) { sellerWithdrawals = sellerWithdrawals.map(x => x.id === w.id ? w : x); renderTxDepositsAndWithdrawals(); }
  withdrawalsQueueCache = withdrawalsQueueCache.map(x => x.id === w.id ? w : x);
  renderWithdrawalsQueue();
});
socket.on('withdrawal-resolved', (w) => { withdrawalsQueueCache = withdrawalsQueueCache.filter(x => !['completed', 'rejected', 'failed'].includes(x.status) || x.id !== w.id); renderWithdrawalsQueue(); });
socket.on('transaction-account-created', () => { closeModal('txRegModal'); toast('Your Transaction Account is ready.'); openTxAccountView(); });
socket.on('kyc-queue-list', (list) => { kycQueueCache = list; renderKycQueue(); });
socket.on('kyc-submitted', (acct) => {
  kycQueueCache = [acct, ...kycQueueCache.filter(x => x.groupId !== acct.groupId)];
  renderKycQueue();
  toast(`New identity documents submitted for review — ${acct.fullName || acct.groupId}.`);
  playAdminAlertPing();
});
socket.on('kyc-resolved', (acct) => { kycQueueCache = kycQueueCache.filter(x => x.groupId !== acct.groupId); renderKycQueue(); });
socket.on('deposits-queue-list', (list) => { depositsQueueCache = list; renderDepositsQueue(); });
socket.on('withdrawals-queue-list', (list) => { withdrawalsQueueCache = list; renderWithdrawalsQueue(); });

// A single red dot on the admin drawer's "Accounts" tab so pending reviews
// are impossible to miss — updates every time any of the three queues change.
function updateAccountsTabBadge() {
  const dot = el('accountsTabDot');
  if (!dot) return;
  const count = kycQueueCache.length + depositsQueueCache.length + withdrawalsQueueCache.filter(w => ['pending', 'held_in_vault', 'processing'].includes(w.status)).length;
  dot.classList.toggle('hidden', count === 0);
}
function playAdminAlertPing() { /* placeholder hook — the toast + red dot already cover this; wire a sound here if wanted */ }

// ---- Seller: registration popup ----
function maybeShowTxRegModal() {
  if (myRole !== 'PARTY B' || !sellerAccountState) return;
  el('txAccountBtn').classList.remove('hidden');
  el('brandMenuTxAccount').classList.remove('hidden');
  if (sellerAccountState.registered) { closeModal('txRegModal'); return; }
  el('txRegEmailRow').style.display = sellerAccountState.email ? 'none' : 'flex';
  el('txRegModal').classList.remove('hidden');
}
function submitTxRegistration() {
  const fullName = el('txRegNameInput').value.trim();
  const email = el('txRegEmailInput').value.trim();
  const password = el('txRegPasswordInput').value;
  const confirm = el('txRegPasswordConfirmInput').value;
  const currency = el('txRegCurrencyInput').value;
  if (!fullName) return toast('Please enter your full name.', true);
  if (!sellerAccountState.email && !isValidEmailClient(email)) return toast("That doesn't look like a valid email.", true);
  if (password.length < 8) return toast('Password must be at least 8 characters.', true);
  if (password !== confirm) return toast('Passwords do not match.', true);
  socket.emit('register-transaction-account', { groupId: activeGroupId, fullName, email, password, currency });
}

// ---- Seller: full dashboard view ----
function toggleBrandMenu(force) {
  const menu = el('brandMenu');
  if (typeof force === 'boolean') { menu.classList.toggle('hidden', !force); return; }
  menu.classList.toggle('hidden');
}
document.addEventListener('click', (e) => {
  const group = el('brandGroup');
  if (group && !group.contains(e.target)) toggleBrandMenu(false);
});
function openTxAccountView() {
  toggleBrandMenu(false);
  if (!sellerAccountState) return;
  if (!sellerAccountState.registered) return maybeShowTxRegModal();
  socket.emit('get-my-seller-account', { groupId: activeGroupId }); // re-sync before showing, never trust a stale cache
  el('txAccountView').classList.remove('hidden');
  renderTxAccountUI();
  renderTxDepositsAndWithdrawals();
  setTxAccountNav('dashboard');
}
function closeTxAccountView() { el('txAccountView').classList.add('hidden'); document.querySelector('.tx-sidebar').classList.remove('open'); }
function toggleTxSidebar() { document.querySelector('.tx-sidebar').classList.toggle('open'); }
const TX_NAV_TITLES = {
  dashboard: ['Dashboard', "Welcome back — here's where your account stands today."],
  transactions: ['Transactions', 'Every deposit and withdrawal on this account.'],
  withdraw: ['Withdraw', 'Send your available balance out to crypto or a bank account.'],
  forms: ['Forms', 'Anything the Desk Officer has sent your group.'],
  profile: ['Profile', 'Your account details.']
};
function setTxAccountNav(nav) {
  document.querySelectorAll('#txAccountView [data-txnav]').forEach(b => b.classList.toggle('active', b.dataset.txnav === nav));
  document.querySelectorAll('#txAccountView .tx-page').forEach(p => p.classList.add('hidden'));
  el('txPage' + nav.charAt(0).toUpperCase() + nav.slice(1)).classList.remove('hidden');
  el('txPageTitle').textContent = TX_NAV_TITLES[nav][0];
  el('txPageSub').textContent = TX_NAV_TITLES[nav][1];
  document.querySelector('.tx-sidebar').classList.remove('open');
  if (nav === 'forms') renderTxForms();
  if (nav === 'profile') renderTxProfile();
}
function renderTxForms() {
  const box = el('txFormsBody');
  if (!box) return;
  if (window.currentGroupTxFormEnabled) {
    box.innerHTML = `<div class="invite-link-row"><div style="flex:1;"><div style="font-weight:800; font-size:0.82rem;">Transaction Form</div><div style="font-size:0.74rem; color:var(--text-muted);">Sent by the Desk Officer for this deal.</div></div><button class="send-btn" onclick="openTransactionForm()">Fill Form</button></div>`;
  } else {
    box.innerHTML = '<p class="tx-empty">No forms right now.</p>';
  }
}
function renderTxProfile() {
  if (!sellerAccountState) return;
  el('txProfileName').textContent = sellerAccountState.fullName || '—';
  el('txProfileEmail').textContent = sellerAccountState.email || '—';
  el('txProfileCurrency').textContent = sellerAccountState.currency || '—';
  el('txProfileKyc').textContent = { not_submitted: 'Not submitted', pending: 'Pending review', verified: 'Verified', rejected: 'Rejected' }[sellerAccountState.kyc.status] || sellerAccountState.kyc.status;
}

function renderTxAccountUI() {
  if (!sellerAccountState) return;
  const a = sellerAccountState;
  const ccy = a.currency || 'USD';
  if (el('txAvailableBalance')) el('txAvailableBalance').textContent = fmtMoney(a.balances.available, ccy);
  if (el('txHeldBalance')) el('txHeldBalance').textContent = fmtMoney(a.balances.held, ccy);
  if (el('txTotalDeposited')) el('txTotalDeposited').textContent = fmtMoney(a.balances.totalDeposited, ccy);
  if (el('txCcyLabel')) el('txCcyLabel').textContent = ccy;
  if (el('txHeldNote')) {
    const pendingDeposits = sellerDeposits.filter(d => d.status === 'held_in_vault').length;
    const pendingWithdrawals = sellerWithdrawals.filter(w => w.status === 'held_in_vault').length;
    el('txHeldNote').textContent = (pendingDeposits || pendingWithdrawals) ? `${pendingDeposits} deposit + ${pendingWithdrawals} withdrawal in review` : 'Nothing in review';
  }
  const lastWd = sellerWithdrawals.find(w => w.status === 'completed');
  if (el('txLastWithdrawal')) el('txLastWithdrawal').textContent = lastWd ? fmtMoney(lastWd.amount, lastWd.amountCurrency) : '—';
  if (el('txLastWithdrawalNote')) el('txLastWithdrawalNote').textContent = lastWd ? fmtDate(lastWd.updatedAt) : 'No withdrawals yet';

  const kycLabel = { not_submitted: 'Not submitted', pending: 'Pending review', verified: 'Verified', rejected: 'Rejected' }[a.kyc.status] || a.kyc.status;
  const kycClass = a.kyc.status === 'verified' ? 'enabled' : a.kyc.status === 'rejected' ? 'disabled' : '';
  [el('txKycBadgeSmall'), el('txSideKycPill')].forEach(elm => {
    if (!elm) return;
    elm.textContent = kycLabel;
    elm.className = 'tx-status-badge' + (kycClass ? ' ' + kycClass : '');
  });
  if (el('txVerifyIdentityNote')) el('txVerifyIdentityNote').textContent = kycLabel + (a.kyc.status === 'rejected' && a.kyc.rejectionReason ? ` — ${a.kyc.rejectionReason}` : '');
  if (el('txVerifyIdentityIcon')) el('txVerifyIdentityIcon').className = 'tx-verify-icon' + (a.kyc.status === 'verified' ? ' ok' : a.kyc.status === 'rejected' ? ' bad' : '');
  if (el('txVerifyIdentityAction')) el('txVerifyIdentityAction').style.display = a.kyc.status === 'verified' ? 'none' : 'block';

  const kycOk = a.kyc.status === 'verified';
  if (el('txWithdrawKycLock')) el('txWithdrawKycLock').style.display = kycOk ? 'none' : 'block';
  if (el('txWithdrawForm')) el('txWithdrawForm').style.display = kycOk ? 'flex' : 'none';

  if (el('txSideGroupName')) el('txSideGroupName').textContent = a.fullName || 'Your Account';
  if (el('txAvatar')) el('txAvatar').textContent = (a.fullName || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const badge = el('txAccountBtn');
  if (badge) badge.classList.toggle('hidden', myRole !== 'PARTY B');
}

function mergedActivity() {
  const deps = sellerDeposits.map(d => ({ date: d.notifiedAt, type: `Deposit${d.method === 'crypto' ? ` · ${d.asset}` : ''}`, amount: fmtMoney(d.amount, sellerAccountState ? sellerAccountState.currency : ''), status: d.status, note: d.rejectionReason || '' }));
  const wds = sellerWithdrawals.map(w => ({ date: w.createdAt, type: `Withdrawal${w.method === 'crypto' ? ` · ${w.asset}` : ' · Bank'}`, amount: fmtMoney(w.amount, w.amountCurrency), status: w.status, note: w.statusReason || '' }));
  return [...deps, ...wds].sort((a, b) => new Date(b.date) - new Date(a.date));
}
function statusPillClass(status) {
  if (['verified', 'completed'].includes(status)) return 'enabled';
  if (['rejected', 'failed'].includes(status)) return 'disabled';
  return '';
}
function renderTxDepositsAndWithdrawals() {
  const all = mergedActivity();
  const recentBody = el('txRecentActivityBody');
  if (recentBody) {
    recentBody.innerHTML = all.length ? all.slice(0, 5).map(row => `
      <tr><td>${fmtDate(row.date)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.amount)}</td>
      <td><span class="tx-status-badge ${statusPillClass(row.status)}">${row.status.replace('_', ' ')}</span></td></tr>`).join('')
      : '<tr><td colspan="4" class="tx-empty">No activity yet.</td></tr>';
  }
  const fullBody = el('txFullActivityBody');
  if (fullBody) {
    fullBody.innerHTML = all.length ? all.map(row => `
      <tr><td>${fmtDate(row.date)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.amount)}</td>
      <td><span class="tx-status-badge ${statusPillClass(row.status)}">${row.status.replace('_', ' ')}</span></td><td>${escapeHtml(row.note)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="tx-empty">No activity yet.</td></tr>';
  }
  const wdOnlyBody = el('txWithdrawalsOnlyBody');
  if (wdOnlyBody) {
    wdOnlyBody.innerHTML = sellerWithdrawals.length ? sellerWithdrawals.map(w => `
      <tr><td>${fmtDate(w.createdAt)}</td><td>${fmtMoney(w.amount, w.amountCurrency)}</td>
      <td><span class="tx-status-badge ${statusPillClass(w.status)}">${w.status.replace('_', ' ')}</span></td></tr>`).join('')
      : '<tr><td colspan="3" class="tx-empty">No withdrawals yet.</td></tr>';
  }
  renderTxAccountUI(); // held-note / last-withdrawal depend on these lists too
}

// ---- Seller: KYC — one document per step, uploaded immediately on choice ----
let txKycUploads = { idFront: null, idBack: null, proofAddress: null, selfie: null };
let txKycStep = 0; // 0 = doc type picker, then one step per required file, then a final review step
function txKycStepsForDocType() {
  const docType = el('txKycDocType').value;
  const steps = ['idFront'];
  if (docType !== 'passport') steps.push('idBack');
  steps.push('proofAddress', 'selfie');
  return steps;
}
function openTxKycWizard() {
  txKycUploads = { idFront: null, idBack: null, proofAddress: null, selfie: null };
  txKycStep = 0;
  ['txKycIdFront', 'txKycIdBack', 'txKycProofAddress', 'txKycSelfie'].forEach(id => { el(id).value = ''; });
  ['txWizStep1Status', 'txWizStep2Status', 'txWizStep3Status', 'txWizStep4Status'].forEach(id => { el(id).textContent = ''; el(id).className = 'tx-wizard-status'; });
  el('txKycWizardModal').classList.remove('hidden');
  renderTxKycWizard();
}
const TX_WIZ_STEP_IDS = ['txWizStep0', 'txWizStep1', 'txWizStep2', 'txWizStep3', 'txWizStep4', 'txWizStep5'];
function renderTxKycWizard() {
  const steps = txKycStepsForDocType(); // e.g. ['idFront','proofAddress','selfie'] for a passport
  const totalSteps = 1 + steps.length + 1; // doc-type picker + each file + final review
  // Map the logical file key back to which fixed template id ('txWizStep1'..4) represents it,
  // so a passport (no idBack) simply skips straight from step 1 to step 3.
  const KEY_TO_TEMPLATE = { idFront: 'txWizStep1', idBack: 'txWizStep2', proofAddress: 'txWizStep3', selfie: 'txWizStep4' };
  const activeTemplateIds = ['txWizStep0', ...steps.map(k => KEY_TO_TEMPLATE[k]), 'txWizStep5'];

  TX_WIZ_STEP_IDS.forEach(id => el(id).classList.add('hidden'));
  el(activeTemplateIds[txKycStep]).classList.remove('hidden');

  const dotsBox = el('txWizardStepsIndicator');
  dotsBox.innerHTML = Array.from({ length: totalSteps }).map((_, i) =>
    `<div class="dot ${i < txKycStep ? 'done' : i === txKycStep ? 'active' : ''}"></div>`).join('');

  el('txWizBackBtn').style.visibility = txKycStep === 0 ? 'hidden' : 'visible';
  if (txKycStep === totalSteps - 1) {
    el('txWizNextBtn').innerHTML = '<i class="fa-solid fa-upload"></i> Submit for Review';
    el('txWizSummary').innerHTML = steps.map(k => `<div>✓ ${({ idFront: 'ID — Front', idBack: 'ID — Back', proofAddress: 'Proof of Address', selfie: 'Selfie' })[k]} uploaded</div>`).join('');
  } else {
    el('txWizNextBtn').innerHTML = 'Continue';
  }
  window._txWizActiveTemplateIds = activeTemplateIds;
  window._txWizTotalSteps = totalSteps;
}
async function handleTxKycFileChosen(inputEl, key) {
  const file = inputEl.files[0];
  if (!file) return;
  const stepNum = { idFront: 1, idBack: 2, proofAddress: 3, selfie: 4 }[key];
  const statusEl = el(`txWizStep${stepNum}Status`);
  statusEl.textContent = 'Uploading...'; statusEl.className = 'tx-wizard-status busy';
  const result = await uploadRawFile(file);
  if (result.ok) {
    txKycUploads[key] = result.url;
    statusEl.textContent = '✓ Uploaded'; statusEl.className = 'tx-wizard-status ok';
  } else {
    txKycUploads[key] = null;
    statusEl.textContent = '✗ ' + result.error; statusEl.className = 'tx-wizard-status bad';
    toast(result.error, true);
  }
}
function currentWizStepKey() {
  const steps = txKycStepsForDocType();
  const KEY_TO_TEMPLATE = { idFront: 'txWizStep1', idBack: 'txWizStep2', proofAddress: 'txWizStep3', selfie: 'txWizStep4' };
  const templateId = ['txWizStep0', ...steps.map(k => KEY_TO_TEMPLATE[k]), 'txWizStep5'][txKycStep];
  return Object.keys(KEY_TO_TEMPLATE).find(k => KEY_TO_TEMPLATE[k] === templateId) || null;
}
function txKycWizardNext() {
  const totalSteps = window._txWizTotalSteps || 6;
  if (txKycStep === totalSteps - 1) {
    const steps = txKycStepsForDocType();
    const missing = steps.filter(k => !txKycUploads[k]);
    if (missing.length) return toast('Please upload every document before submitting.', true);
    socket.emit('submit-kyc', {
      groupId: activeGroupId, docType: el('txKycDocType').value,
      idFrontUrl: txKycUploads.idFront, idBackUrl: txKycUploads.idBack,
      proofAddressUrl: txKycUploads.proofAddress, selfieUrl: txKycUploads.selfie
    });
    closeModal('txKycWizardModal');
    toast('Documents submitted for review.');
    return;
  }
  const key = currentWizStepKey();
  if (key && !txKycUploads[key]) return toast('Please upload this document before continuing.', true);
  txKycStep++;
  renderTxKycWizard();
}
function txKycWizardBack() {
  if (txKycStep === 0) return;
  txKycStep--;
  renderTxKycWizard();
}

// ---- Seller: deposit (crypto only) ----
function openTxDepositModal() { el('txDepositAmount').value = ''; el('txDepositModal').classList.remove('hidden'); }
function submitTxDeposit() {
  const amount = parseFloat(el('txDepositAmount').value);
  if (!amount || amount <= 0) return toast('Please enter a valid amount.', true);
  socket.emit('notify-deposit', { groupId: activeGroupId, asset: el('txDepositAsset').value, network: el('txDepositNetwork').value, amount });
  closeModal('txDepositModal');
}

// ---- Seller: withdrawal ----
function toggleTxWithdrawFields() {
  const isCrypto = el('txWithdrawMethod').value === 'crypto';
  el('txWithdrawBankFields').style.display = isCrypto ? 'none' : 'block';
  el('txWithdrawCryptoFields').style.display = isCrypto ? 'block' : 'none';
}
function submitTxWithdrawal() {
  const method = el('txWithdrawMethod').value;
  const amount = parseFloat(el('txWdAmount').value);
  if (!amount || amount <= 0) return toast('Please enter a valid amount.', true);
  const payload = { groupId: activeGroupId, method, amount, amountCurrency: sellerAccountState ? sellerAccountState.currency : 'USD' };
  if (method === 'bank') {
    Object.assign(payload, {
      beneficiaryName: el('txWdBeneficiary').value.trim(), bankName: el('txWdBankName').value.trim(),
      bankAccount: el('txWdBankAccount').value.trim(), bankSwift: el('txWdSwift').value.trim(), bankCountry: el('txWdBankCountry').value.trim()
    });
  } else {
    Object.assign(payload, { asset: el('txWdAsset').value, network: el('txWdNetwork').value, destination: el('txWdDestination').value.trim() });
  }
  socket.emit('request-withdrawal', payload);
  el('txWdAmount').value = '';
}

// ---- Admin: review queues ----
function renderKycQueue() {
  const box = el('kycQueueList');
  if (!box) return;
  box.innerHTML = kycQueueCache.length ? kycQueueCache.map(a => `
    <div class="invite-link-row" style="flex-wrap:wrap;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:800; font-size:0.78rem;">${escapeHtml(a.fullName || 'Unnamed')} — ${escapeHtml(a.email || 'no email')}</div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">
          Group: ${escapeHtml(a.groupId)} · Doc: ${escapeHtml(a.kyc.docType || '')} ·
          <a href="${a.kyc.idFrontUrl}" target="_blank" style="color:var(--accent-cyan);">ID front</a>
          ${a.kyc.idBackUrl ? ` · <a href="${a.kyc.idBackUrl}" target="_blank" style="color:var(--accent-cyan);">back</a>` : ''}
          · <a href="${a.kyc.proofAddressUrl}" target="_blank" style="color:var(--accent-cyan);">address</a>
          · <a href="${a.kyc.selfieUrl}" target="_blank" style="color:var(--accent-cyan);">selfie</a>
        </div>
      </div>
      <button class="admin-btn" onclick="adminReviewKyc('${a.groupId}','verified')"><i class="fa-solid fa-check"></i> Verify</button>
      <button class="admin-btn admin-btn-danger" onclick="adminReviewKyc('${a.groupId}','rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
    </div>`).join('') : '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No pending KYC submissions.</p>';
  updateAccountsTabBadge();
}
function adminReviewKyc(groupId, decision) {
  if (decision === 'rejected') {
    showPromptModal({ title: 'Reject KYC', placeholder: 'Reason (shown to the seller)' }, (reason) => {
      socket.emit('admin-review-kyc', { groupId, decision, reason });
    });
  } else {
    socket.emit('admin-review-kyc', { groupId, decision });
  }
}
function renderDepositsQueue() {
  const box = el('depositsQueueList');
  if (!box) return;
  box.innerHTML = depositsQueueCache.length ? depositsQueueCache.map(d => `
    <div class="invite-link-row">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:800; font-size:0.78rem;">${escapeHtml(`${d.asset} (${d.network || ''})`)} — ${fmtMoney(d.amount, '')}</div>
        <div style="font-size:0.72rem; color:var(--text-muted);">Group: ${escapeHtml(d.groupId)} · ${new Date(d.notifiedAt).toLocaleString()}</div>
      </div>
      <button class="admin-btn" onclick="adminReviewDeposit('${d.id}','verified')"><i class="fa-solid fa-check"></i> Verify</button>
      <button class="admin-btn admin-btn-danger" onclick="adminReviewDeposit('${d.id}','rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
    </div>`).join('') : '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No pending deposits.</p>';
  updateAccountsTabBadge();
}
function adminReviewDeposit(depositId, decision) {
  if (decision === 'rejected') {
    showPromptModal({ title: 'Reject Deposit', placeholder: 'Reason (shown to the seller)' }, (reason) => {
      socket.emit('admin-review-deposit', { depositId, decision, reason });
    });
  } else {
    socket.emit('admin-review-deposit', { depositId, decision });
  }
}
const WD_NEXT_ACTIONS = {
  pending: [['held_in_vault', 'Hold in Vault', false], ['rejected', 'Reject', true]],
  held_in_vault: [['processing', 'Process', false], ['failed', 'Fail', true]],
  processing: [['completed', 'Complete', false], ['failed', 'Fail', true]]
};
function renderWithdrawalsQueue() {
  const box = el('withdrawalsQueueList');
  if (!box) return;
  const active = withdrawalsQueueCache.filter(w => !['completed', 'rejected', 'failed'].includes(w.status));
  box.innerHTML = active.length ? active.map(w => {
    const actions = WD_NEXT_ACTIONS[w.status] || [];
    return `
    <div class="invite-link-row" style="flex-wrap:wrap;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:800; font-size:0.78rem;">${escapeHtml(w.method === 'crypto' ? `${w.asset} withdrawal` : 'Bank withdrawal')} — ${fmtMoney(w.amount, w.amountCurrency)}</div>
        <div style="font-size:0.72rem; color:var(--text-muted);">Group: ${escapeHtml(w.groupId)} · Status: ${w.status.replace('_', ' ')}</div>
      </div>
      ${actions.map(([to, label, needsReason]) => `<button class="admin-btn ${needsReason ? 'admin-btn-danger' : ''}" onclick="adminAdvanceWithdrawal('${w.id}','${to}',${needsReason})"><i class="fa-solid fa-arrow-right"></i> ${label}</button>`).join('')}
    </div>`;
  }).join('') : '<p style="font-size:0.78rem; color:var(--text-faint); margin:0;">No withdrawals in progress.</p>';
  updateAccountsTabBadge();
}
function adminAdvanceWithdrawal(withdrawalId, toStatus, needsReason) {
  if (needsReason) {
    showPromptModal({ title: `Move to "${toStatus}"`, placeholder: 'Reason (required, shown to the seller)' }, (reason) => {
      socket.emit('admin-advance-withdrawal', { withdrawalId, toStatus, reason });
    });
  } else {
    socket.emit('admin-advance-withdrawal', { withdrawalId, toStatus });
  }
}
function toggleHighlightGroup() { socket.emit('toggle-highlight-group', { groupId: activeGroupId }); toast('Group highlight toggled.'); }
function copyInviteLink(party) {
  // party: 'A' -> locks visitor into Buyer, 'B' -> locks into Seller,
  // undefined -> old unlocked link (kept for backwards compatibility, not shown in UI anymore).
  // The URL says "BUYER"/"SELLER", never "PARTY A"/"PARTY B" — that internal
  // slot name must never show up in a party's own address bar.
  const roleParam = party === 'A' ? '&role=BUYER' : party === 'B' ? '&role=SELLER' : '';
  const label = party === 'A' ? (currentGroupCustomNames.A || 'Buyer') : party === 'B' ? (currentGroupCustomNames.B || 'Seller') : 'Invite';
  const link = `${window.location.origin}/?groupId=${activeGroupId}${roleParam}`;
  navigator.clipboard.writeText(link).then(
    () => toast(`${label} link copied:\n${link}`),
    () => toast(`Copy this link manually: ${link}`, true)
  );
}

// Shown once, right after a new group is created, so both links can be
// grabbed and sent out in one go instead of hunting through the Controls tab.
function openInviteLinksModal(groupId, nameA, nameB) {
  el('inviteLinkALabel').textContent = nameA || 'Buyer';
  el('inviteLinkBLabel').textContent = nameB || 'Seller';
  el('inviteLinkAValue').textContent = `${window.location.origin}/?groupId=${groupId}&role=BUYER`;
  el('inviteLinkBValue').textContent = `${window.location.origin}/?groupId=${groupId}&role=SELLER`;
  el('inviteLinksModal').classList.remove('hidden');
}
function copyShownInviteLink(party) {
  const link = (party === 'A' ? el('inviteLinkAValue') : el('inviteLinkBValue')).textContent;
  const label = (party === 'A' ? el('inviteLinkALabel') : el('inviteLinkBLabel')).textContent;
  navigator.clipboard.writeText(link).then(
    () => toast(`${label} link copied:\n${link}`),
    () => toast(`Copy this link manually: ${link}`, true)
  );
}
function kickSelectedUser() {
  const targetSessionToken = el('kickUserSelect').value;
  if (!targetSessionToken) return toast('No user selected.', true);
  showConfirmModal({ title: 'Disconnect User', message: 'Force-disconnect this user? They can rejoin using their invite link.' }, () => {
    socket.emit('admin-kick-user', { targetSessionToken });
    toast('User disconnected.');
  });
}

// ---------------- DIRECTORY ----------------
socket.on('user-directory', (users) => { directoryCache = users; renderDirectory(); renderGroupsList(); });

function renderDirectory() {
  const query = (el('directorySearchInput').value || '').toLowerCase();
  const filtered = directoryCache.filter(u => u.displayName.toLowerCase().includes(query));
  const groups = { Admins: [], Buyers: [], Sellers: [] };
  filtered.forEach(u => {
    if (u.isAdmin) groups.Admins.push(u);
    else if (u.role === 'PARTY A') groups.Buyers.push(u);
    else groups.Sellers.push(u);
  });
  let html = '';
  for (const [label, users] of Object.entries(groups)) {
    if (users.length === 0) continue;
    html += `<div class="directory-section-title">${label} (${users.length})</div>`;
    html += users.map(u => `
      <div class="directory-item">
        <div class="avatar" style="width:36px;height:36px;font-size:0.85rem;">${initialsOf(u.displayName)}<span class="online-ring ${u.isOnline ? '' : 'off'}"></span></div>
        <div class="directory-meta">
          <div class="directory-name">${escapeHtml(u.displayName)}</div>
          <div class="directory-role">${u.isOnline ? 'Online' : 'Offline'}</div>
        </div>
        <span class="role-chip ${u.isAdmin ? 'admin' : (u.role === 'PARTY A' ? 'buyer' : 'seller')}">${u.isAdmin ? 'Admin' : (u.role === 'PARTY A' ? 'Buyer' : 'Seller')}</span>
        ${u.sessionToken !== myToken() ? `<i class="fa-solid fa-trash directory-delete-btn" onclick="deleteDirectoryUser('${u.sessionToken}')" title="Remove from directory"></i>` : ''}
      </div>`).join('');
  }
  el('directoryContainer').innerHTML = html || '<div style="padding:16px; color:var(--text-muted); font-size:0.85rem;">No users yet.</div>';

  const select = el('activeUsersSelect');
  if (select) {
    select.innerHTML = directoryCache.filter(u => u.sessionToken !== myToken()).map(u =>
      `<option value="${u.sessionToken}">${escapeHtml(u.displayName)} (${u.isAdmin ? 'Admin' : u.role})</option>`
    ).join('');
  }
  const kickSelect = el('kickUserSelect');
  if (kickSelect) {
    kickSelect.innerHTML = directoryCache.filter(u => u.sessionToken !== myToken() && !u.isAdmin && u.isOnline).map(u =>
      `<option value="${u.sessionToken}">${escapeHtml(u.displayName)} (${u.role})</option>`
    ).join('') || '<option value="">No online users to disconnect</option>';
  }
}

function deleteDirectoryUser(targetSessionToken) {
  showConfirmModal(
    { title: 'Remove User', message: 'Remove this user from the directory? If they are currently online, they will be disconnected.' },
    () => socket.emit('admin-delete-user', { targetSessionToken })
  );
}

function clearOfflineUsers() {
  showConfirmModal(
    { title: 'Clear Offline Users', message: 'Remove every offline user from the directory? Online users are not affected.' },
    () => socket.emit('admin-clear-offline-users')
  );
}
socket.on('directory-cleared', ({ removed }) => toast(`Removed ${removed} offline user(s) from the directory.`));

// ---------------- PRESENCE ----------------
function presenceBadgeHtml(label, isOnline) {
  return `<div class="presence-badge">
    <div class="status-dot ${isOnline ? 'online' : 'offline'}"></div>
    <span>${escapeHtml(label)}: ${isOnline ? 'Online' : 'Offline'}</span>
  </div>`;
}

// Builds the header presence cluster. What each side sees is intentionally
// different:
//  - Admin/Desk Officer: their own "You: Online", plus the Buyer's status and
//    the Seller's status (labelled with whatever custom name is set) — full
//    visibility across both parties in this group.
//  - Buyer or Seller: never "You: Online" (that badge only makes sense for
//    the officer watching the desk), never the literal "Party A"/"Party B"
//    slot names — only whether the Desk Officer is currently reachable, and
//    whether the other party in this transaction is online.
function renderPresenceBadges(users) {
  const cluster = el('presenceCluster');
  if (!cluster) return;

  if (isAdminConfirmed) {
    const buyer = users.find(u => !u.isAdmin && u.role === 'PARTY A');
    const seller = users.find(u => !u.isAdmin && u.role === 'PARTY B');
    cluster.innerHTML = [
      presenceBadgeHtml('You', true),
      presenceBadgeHtml(currentGroupCustomNames.A || 'Buyer', !!(buyer && buyer.isOnline)),
      presenceBadgeHtml(currentGroupCustomNames.B || 'Seller', !!(seller && seller.isOnline))
    ].join('');
    return;
  }

  const anyAdminOnline = users.some(u => u.isAdmin && u.isOnline);
  const counterpartRole = myRole === 'PARTY B' ? 'PARTY A' : 'PARTY B';
  const counterpartLabel = counterpartRole === 'PARTY A'
    ? (currentGroupCustomNames.A || 'Buyer')
    : (currentGroupCustomNames.B || 'Seller');
  const counterpart = users.find(u => !u.isAdmin && u.role === counterpartRole);
  cluster.innerHTML = [
    presenceBadgeHtml('Admin', anyAdminOnline),
    presenceBadgeHtml(counterpartLabel, !!(counterpart && counterpart.isOnline))
  ].join('');
}

socket.on('presence-update', (users) => {
  lastPresenceUsers = users;
  renderPresenceBadges(users);
});

// ---------------- ADMIN STATS ----------------
socket.on('admin-stats', (stats) => {
  el('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.totalUsers}</div><div class="stat-label">Total Users</div></div>
    <div class="stat-card"><div class="stat-value">${stats.onlineUsers}</div><div class="stat-label">Online</div></div>
    <div class="stat-card"><div class="stat-value">${stats.offlineUsers}</div><div class="stat-label">Offline</div></div>
    <div class="stat-card"><div class="stat-value">${stats.totalGroups}</div><div class="stat-label">Total Groups</div></div>
    <div class="stat-card"><div class="stat-value">${stats.messagesToday}</div><div class="stat-label">Messages Today</div></div>
    <div class="stat-card"><div class="stat-value">${stats.uploadsToday}</div><div class="stat-label">Uploads Today</div></div>
    <div class="stat-card" style="grid-column: span 2;"><div class="stat-value">${stats.transactionsSubmitted}</div><div class="stat-label">Transactions Submitted</div></div>
  `;
});

// ---------------- ADMIN NOTES ----------------
function saveAdminNotes() { localStorage.setItem(`admin_notes_${activeGroupId}`, el('adminPrivateNotes').value); }
function loadAdminNotes() { el('adminPrivateNotes').value = localStorage.getItem(`admin_notes_${activeGroupId}`) || ''; }

// ---------------- ADMIN DM ----------------
function initiateAdminDM() {
  const targetSessionToken = el('activeUsersSelect').value;
  if (!targetSessionToken) return toast('No user selected.', true);
  showPromptModal({ title: 'Direct Message', placeholder: 'Type your message...' }, (initialMessage) => {
    socket.emit('admin-initiate-dm', { targetSessionToken, initialMessage });
  });
}
socket.on('dm-channel-opened', () => { el('dmModal').style.display = 'flex'; });
socket.on('dm-message', (msg) => {
  el('dmModal').style.display = 'flex';
  const body = el('dmBody');
  const isSelf = msg.senderToken === myToken();
  const row = document.createElement('div');
  row.className = `dm-bubble-row ${isSelf ? 'sent' : 'received'}`;
  row.innerHTML = `<div class="dm-bubble ${isSelf ? 'sent' : 'received'}"><strong>${msg.sender}</strong><div>${msg.text}</div></div>`;
  body.appendChild(row);
  body.scrollTop = body.scrollHeight;
  window._activeDmRoomId = msg.dmRoomId;
});
function sendDMReply() {
  const input = el('dmInput');
  if (input.value.trim() && window._activeDmRoomId) {
    socket.emit('send-dm-reply', { dmRoomId: window._activeDmRoomId, text: input.value.trim() });
    input.value = '';
  }
}
function closeDMModal() { el('dmModal').style.display = 'none'; }

// ---------------- TRANSACTION FORM (user-facing) ----------------
function updateTransactionBanner(enabled) {
  el('transactionBanner').classList.toggle('hidden', !enabled || isAdminConfirmed);
}
function updateTxStatusBadge(enabled) {
  const badge = el('txStatusBadge');
  if (!badge) return;
  badge.textContent = `Status: ${enabled ? 'ENABLED' : 'DISABLED'} for this group`;
  badge.classList.toggle('enabled', enabled);
  badge.classList.toggle('disabled', !enabled);
  const label = el('txToggleBtnLabel');
  if (label) label.textContent = enabled ? 'Disable Form' : 'Enable Form';
}
socket.on('transaction-form-status', ({ enabled }) => {
  updateTransactionBanner(enabled);
  updateTxStatusBadge(enabled);
  toast(`Transaction form ${enabled ? 'enabled' : 'disabled'} for this group.`);
});

function openTransactionForm() { el('txFormModal').classList.remove('hidden'); }
function submitTransactionForm(evt) {
  evt.preventDefault();
  const form = el('txForm');
  const formData = Object.fromEntries(new FormData(form).entries());
  socket.emit('submit-transaction', { groupId: activeGroupId, formData });
  return false;
}
socket.on('transaction-submit-ack', ({ txId }) => {
  toast('Transaction submitted successfully. Downloading your PDF receipt...');
  closeModal('txFormModal');
  el('txForm').reset();
  if (txId) {
    // Auto-download; if the browser's popup blocker intercepts it, the
    // toast link below is the fallback.
    const pdfUrl = `/api/transactions/pdf/${txId}`;
    const win = window.open(pdfUrl, '_blank');
    if (!win) toast(`Pop-up blocked — <a href="${pdfUrl}" target="_blank" style="color:var(--accent-cyan); text-decoration:underline;">tap here to download your receipt</a>.`, false, true);
  }
});

// ---------------- ADMIN: TRANSACTION BOARD ----------------
function toggleTransactionForm() { socket.emit('admin-toggle-transaction-form', { groupId: activeGroupId }); }

function sendFormToSelectedGroup() {
  const sel = el('sendFormGroupSelect');
  const targetGroupId = sel.value;
  if (!targetGroupId) return toast('No group selected.', true);
  const targetName = sel.selectedOptions[0]?.textContent || 'that group';
  socket.emit('admin-toggle-transaction-form', { groupId: targetGroupId });
  toast(`Transaction form toggled for ${targetName}.`);
}
function loadTransactionsList() { socket.emit('admin-get-transactions', { groupId: activeGroupId }); }
socket.on('transactions-list', ({ transactions, formEnabled }) => {
  updateTxStatusBadge(!!formEnabled);
  const container = el('transactionsListContainer');
  container.innerHTML = transactions.length ? transactions.map(t => `
    <div class="tx-card">
      <div class="tx-card-row"><b>${t.full_legal_name}</b><span>${new Date(t.submitted_at).toLocaleDateString()}</span></div>
      <div class="tx-card-row"><span>${t.role}</span><span>${t.country}</span></div>
      <div class="tx-card-row"><span>${t.asset_type}</span><span>${t.total_value || ''} ${t.payment_currency || ''}</span></div>
      <div class="tx-card-actions">
        <a class="tx-pdf-btn" href="/api/transactions/pdf/${t.id}" target="_blank"><i class="fa-solid fa-file-pdf"></i> PDF</a>
        <span class="tx-delete-btn" onclick="deleteTransaction('${t.id}')"><i class="fa-solid fa-trash"></i> Delete</span>
      </div>
    </div>`).join('') : '<div style="color:var(--text-muted); font-size:0.85rem;">No submissions yet.</div>';
});
socket.on('transaction-submitted', () => { if (!el('tabTransactions').classList.contains('hidden')) loadTransactionsList(); toast('New transaction submitted.'); });
socket.on('transaction-deleted', () => loadTransactionsList());
function deleteTransaction(txId) {
  showConfirmModal({ title: 'Delete Transaction', message: 'Delete this transaction submission? This cannot be undone.' }, () => {
    socket.emit('admin-delete-transaction', { groupId: activeGroupId, txId });
  });
}
function exportTransactions() {
  const key = adminPasskeyMemory || '';
  window.open(`/api/transactions/${encodeURIComponent(activeGroupId)}/export?adminKey=${encodeURIComponent(key)}`, '_blank');
}

// ---------------- TASKS & APPROVALS ----------------
function openTasksModal() {
  socket.emit('get-tasks', { groupId: activeGroupId });
  el('tasksModal').classList.remove('hidden');
}

function renderTaskStatusButtons(task) {
  const statuses = ['Pending', 'Completed', 'Rejected'];
  return `<div class="task-status-row">${statuses.map(s =>
    `<button class="task-status-btn ${task.status === s ? 'active ' + s.toLowerCase() : ''}" onclick="updateTaskStatusClient('${task.id}','${s}')">${s}</button>`
  ).join('')}</div>`;
}

function renderUserTasksList(tasks) {
  const container = el('userTasksListContainer');
  if (!tasks.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-list-check"></i><span>No tasks yet</span><small>Your Desk Officer hasn't assigned any tasks.</small></div>`;
    return;
  }
  container.innerHTML = tasks.map(t => `
    <div class="task-card">
      <div class="task-card-title">${t.title}</div>
      ${t.description ? `<div class="task-card-desc">${t.description}</div>` : ''}
      ${renderTaskStatusButtons(t)}
      <div class="task-card-meta">${t.assignedRole ? `Assigned to ${t.assignedRole === 'PARTY A' ? 'Buyer' : 'Seller'}` : 'Assigned to both parties'} · ${new Date(t.createdAt).toLocaleDateString()}</div>
    </div>`).join('');
}

function renderAdminTasksList(tasks) {
  const container = el('adminTasksListContainer');
  if (!container) return;
  if (!tasks.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><span>No tasks yet</span></div>`;
    return;
  }
  container.innerHTML = tasks.map(t => `
    <div class="task-card">
      <div class="task-card-title">${t.title}</div>
      ${t.description ? `<div class="task-card-desc">${t.description}</div>` : ''}
      ${renderTaskStatusButtons(t)}
      <div class="task-card-meta">${t.assignedRole ? `Assigned to ${t.assignedRole === 'PARTY A' ? 'Buyer' : 'Seller'}` : 'Both parties'}
        <span class="tx-delete-btn admin-plus-only" style="margin-left:10px;" onclick="deleteTaskClient('${t.id}')"><i class="fa-solid fa-trash"></i> Delete</span>
      </div>
    </div>`).join('');
}

socket.on('tasks-list', ({ tasks }) => {
  tasksCache = tasks;
  updateTasksDot();
  renderUserTasksList(tasks);
  renderAdminTasksList(tasks);
});
socket.on('task-created', (task) => {
  if (!tasksCache.some(t => t.id === task.id)) tasksCache.unshift(task);
  updateTasksDot();
  renderUserTasksList(tasksCache);
  renderAdminTasksList(tasksCache);
  toast(`New task: ${task.title}`);
});
socket.on('task-updated', (task) => {
  tasksCache = tasksCache.map(t => t.id === task.id ? task : t);
  updateTasksDot();
  renderUserTasksList(tasksCache);
  renderAdminTasksList(tasksCache);
});
socket.on('task-deleted', ({ taskId }) => {
  tasksCache = tasksCache.filter(t => t.id !== taskId);
  updateTasksDot();
  renderUserTasksList(tasksCache);
  renderAdminTasksList(tasksCache);
});

function createTask() {
  const title = el('taskTitleInput').value.trim();
  if (!title) return toast('Task title is required.', true);
  const description = el('taskDescInput').value.trim();
  const assignedRole = el('taskAssignedRoleSelect').value;
  socket.emit('create-task', { groupId: activeGroupId, title, description, assignedRole });
  el('taskTitleInput').value = '';
  el('taskDescInput').value = '';
  toast('Task created.');
}
function updateTaskStatusClient(taskId, status) {
  socket.emit('update-task-status', { groupId: activeGroupId, taskId, status });
}
function deleteTaskClient(taskId) {
  showConfirmModal({ title: 'Delete Task', message: 'Delete this task? This cannot be undone.' }, () => {
    socket.emit('delete-task', { groupId: activeGroupId, taskId });
  });
}

// ---------------- ANNOUNCEMENTS ----------------
function renderAnnouncementGroupChecks() {
  const container = el('announcementGroupChecks');
  if (!container) return;
  if (!groupsCache.length) { container.innerHTML = `<span style="color:var(--text-muted); font-size:0.76rem;">Loading groups...</span>`; return; }
  container.innerHTML = groupsCache.map(g =>
    `<label><input type="checkbox" value="${g.id}" ${g.id === activeGroupId ? 'checked' : ''}> ${escapeHtml(g.name)}</label>`
  ).join('');
}
function sendAnnouncement() {
  const text = el('announcementText').value.trim();
  if (!text) return toast('Announcement text is required.', true);
  const groupIds = Array.from(document.querySelectorAll('#announcementGroupChecks input:checked')).map(i => i.value);
  if (!groupIds.length) return toast('Select at least one group.', true);
  socket.emit('create-announcement', { groupIds, text });
  el('announcementText').value = '';
  toast(`Announcement posted to ${groupIds.length} group(s).`);
}
socket.on('announcement-created', () => { /* the pinned message + chat bubble already reflect it live */ });

// ---------------- LIVE DASHBOARD WIDGETS ----------------
socket.on('dashboard-widgets-update', (w) => {
  el('widgetOnlineUsers').innerHTML = w.onlineUsers.length
    ? w.onlineUsers.map(u => `<div class="widget-item"><span class="widget-item-main">${escapeHtml(u.displayName)}</span><span class="widget-item-sub">${u.isAdmin ? 'Admin' : u.role}</span></div>`).join('')
    : `<div class="empty-state" style="padding:16px;"><i class="fa-solid fa-user-slash"></i><span>No one online</span></div>`;

  el('widgetRecentTx').innerHTML = w.recentTransactions.length
    ? w.recentTransactions.map(t => `<div class="widget-item"><span class="widget-item-main">${escapeHtml(t.full_legal_name)}</span><span class="widget-item-sub">${t.total_value || ''} ${t.payment_currency || ''}</span></div>`).join('')
    : `<div class="empty-state" style="padding:16px;"><i class="fa-solid fa-money-bill-trend-up"></i><span>No transactions yet</span></div>`;

  el('widgetRecentUploads').innerHTML = w.recentUploads.length
    ? w.recentUploads.map(u => `<div class="widget-item"><span class="widget-item-main">${escapeHtml(u.fileName || 'Attachment')}</span><span class="widget-item-sub">${escapeHtml(u.sender)}</span></div>`).join('')
    : `<div class="empty-state" style="padding:16px;"><i class="fa-solid fa-cloud-arrow-up"></i><span>No uploads yet</span></div>`;

  el('widgetPendingReviews').textContent = w.pendingReviews;
});

// ---------------- BRANDING CENTER ----------------
async function loadBranding() {
  try {
    const res = await fetch('/api/branding');
    brandingCache = await res.json();
    applyBranding(brandingCache);
  } catch (err) { /* branding is cosmetic — fail silently and keep defaults */ }
}
function applyBranding(b) {
  if (!b) return;
  const root = document.documentElement;
  if (b.accent_color) root.style.setProperty('--accent-cyan', b.accent_color);
  if (b.accent_color_2) root.style.setProperty('--accent-violet', b.accent_color_2);
  if (b.welcome_message) el('onboardingWelcomeMessage').textContent = b.welcome_message;
  if (b.logo_url) {
    document.querySelectorAll('.vault-icon').forEach(v => { v.innerHTML = `<img src="${b.logo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:13px;" />`; });
  }
  if (b.background_url) document.body.style.backgroundImage = `linear-gradient(rgba(5,7,13,0.85), rgba(5,7,13,0.9)), url('${b.background_url}')`;
}
function loadBrandingIntoForm() {
  if (!brandingCache) return;
  el('brandLogoUrl').value = brandingCache.logo_url || '';
  el('brandAccentColor').value = brandingCache.accent_color || '#38bdf8';
  el('brandAccentColor2').value = brandingCache.accent_color_2 || '#8b5cf6';
  el('brandWelcomeMessage').value = brandingCache.welcome_message || '';
  el('brandBackgroundUrl').value = brandingCache.background_url || '';
}
async function saveBranding() {
  const payload = {
    logo_url: el('brandLogoUrl').value.trim(),
    accent_color: el('brandAccentColor').value,
    accent_color_2: el('brandAccentColor2').value,
    welcome_message: el('brandWelcomeMessage').value.trim(),
    background_url: el('brandBackgroundUrl').value.trim()
  };
  try {
    const res = await fetch('/api/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPasskeyMemory || '' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { const e = await res.json(); return toast(e.error || 'Failed to save branding.', true); }
    brandingCache = await res.json();
    applyBranding(brandingCache);
    toast('Branding updated for everyone.');
  } catch (err) { toast('Failed to save branding.', true); }
}
function saveGroupBanner() {
  const bannerUrl = el('groupBannerUrlInput').value.trim();
  socket.emit('admin-set-group-banner', { groupId: activeGroupId, bannerUrl });
  toast('Group banner updated.');
}
socket.on('group-banner-updated', ({ groupId, bannerUrl }) => {
  if (groupId === activeGroupId) applyGroupBanner(bannerUrl);
});

// ---------------- ONBOARDING ----------------
function maybeShowOnboarding() {
  if (localStorage.getItem('q_onboarded') === '1') return;
  el('onboardingOverlay').classList.remove('hidden');
}
function dismissOnboarding() {
  localStorage.setItem('q_onboarded', '1');
  el('onboardingOverlay').classList.add('hidden');
}

// ---------------- PUSH NOTIFICATIONS ----------------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
async function togglePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return toast('Push notifications are not supported in this browser.', true);
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) });
      await existing.unsubscribe();
      pushSubscribed = false;
      el('notifyToggleBtn').classList.remove('subscribed');
      return toast('Notifications disabled.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return toast('Notification permission was not granted.', true);
    const keyRes = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await keyRes.json();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionToken, subscription: sub.toJSON() }) });
    pushSubscribed = true;
    el('notifyToggleBtn').classList.add('subscribed');
    toast('Notifications enabled for this device.');
  } catch (err) {
    toast('Could not enable notifications on this device/browser.', true);
  }
}

// ---------------- KICKOFF ----------------
// (Initial view state is now handled inside the init-state handler once
// admin status is known — see hideListPanelMobile()/exitSelectMode() there.)
loadBranding();

(async function checkExistingPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { pushSubscribed = true; el('notifyToggleBtn').classList.add('subscribed'); }
  } catch (err) { /* not fatal — button just shows the unsubscribed state */ }
})();
