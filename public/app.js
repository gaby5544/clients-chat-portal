/* Quantum Secure Transaction Desk — client application */
const socket = io();

// ---------------- STATE ----------------
let sessionToken = sessionStorage.getItem('q_session_token') || ('token-' + Math.random().toString(36).slice(2, 15));
sessionStorage.setItem('q_session_token', sessionToken);

const urlParams = new URLSearchParams(window.location.search);
let activeGroupId = urlParams.get('groupId') || 'default-group';

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
}

// ---------------- SESSION / JOIN ----------------
function loginAsAdmin() {
  showPromptModal(
    { title: 'Administrator Login', placeholder: 'Enter Administrator Passkey' },
    (password) => { adminPasskeyMemory = password; joinSession(password); }
  );
}

function joinSession(adminKey = null) {
  const selectedRole = adminKey ? 'ADMINISTRATOR' : el('roleSelect').value;
  const email = localStorage.getItem('q_user_email') || undefined;
  socket.emit('join-room', { groupId: activeGroupId, role: selectedRole, adminKey, sessionToken, email });
}

socket.on('connect', () => { currentSocketId = socket.id; joinSession(adminPasskeyMemory); });

socket.on('error-msg', (msg) => toast(msg, true));

// ---------------- INIT STATE ----------------
socket.on('init-state', async (data) => {
  isAdminConfirmed = data.isAdminConfirmed;
  currentSocketId = data.socketId;
  activeGroupId = data.group.id;
  _myToken = data.sessionToken; // must be set before rendering messages below
  document.body.classList.toggle('is-admin', isAdminConfirmed);
  updateRailVisibility();

  el('currentGroupName').textContent = data.group.name;
  el('roleSelect').style.display = isAdminConfirmed ? 'none' : 'inline-block';
  fileUploadAllowed = data.group.fileUploadsEnabled;
  updateUploadUiState();
  updateTransactionBanner(data.group.transactionFormEnabled);

  // Admin lands on the chat view (list panel starts closed on mobile);
  // regular users never have a list panel at all.
  hideListPanelMobile();
  exitSelectMode();

  el('messageContainer').innerHTML = '<div class="drop-overlay" id="dropOverlay"><i class="fa-solid fa-cloud-arrow-up"></i><span data-i18n="dropToUpload">Drop file to upload</span></div>';
  messagesById.clear();
  data.messages.forEach(renderMessage);

  renderPinned(data.pinnedMessages);
  if (isAdminConfirmed) {
    loadAdminNotes();
    socket.emit('admin-get-stats');
    socket.emit('get-all-groups'); // server ignores this for non-admins anyway; only bother asking as admin
  }
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
    <div class="msg-time">${data.time}</div>
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

socket.on('group-created-and-switch', ({ newGroupId }) => { activeGroupId = newGroupId; joinSession(adminPasskeyMemory); });
socket.on('force-room-switch', ({ newGroupId }) => { activeGroupId = newGroupId; joinSession(adminPasskeyMemory); });

// Renaming a party relabels new messages going forward; it deliberately does
// NOT force a rejoin (that used to cause a disconnect/reconnect cycle that
// spammed the chat with duplicate system messages). Just confirm it worked.
socket.on('party-renamed', ({ party }) => {
  toast(`Party ${party} renamed. They'll see their new label after their next reload.`);
  socket.emit('get-all-groups');
});

function createNewGroup() {
  showPromptModal({ title: 'New Group', placeholder: 'Group name' }, (name) => {
    socket.emit('create-group', { groupName: name });
  });
}
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
function toggleFileLock() { socket.emit('admin-toggle-upload-permission', { groupId: activeGroupId }); }
function toggleHighlightGroup() { socket.emit('toggle-highlight-group', { groupId: activeGroupId }); toast('Group highlight toggled.'); }
function copyInviteLink() {
  const link = `${window.location.origin}/?groupId=${activeGroupId}`;
  navigator.clipboard.writeText(link).then(
    () => toast(`Invite link copied:\n${link}`),
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
socket.on('presence-update', (users) => {
  const peer = users.find(u => u.sessionToken !== myToken() && !u.isAdmin);
  const dot = el('peerStatusDot'); const text = el('peerStatusText');
  if (peer) { dot.className = `status-dot ${peer.isOnline ? 'online' : 'offline'}`; text.textContent = `${peer.displayName}: ${peer.isOnline ? 'Online' : 'Offline'}`; }
  else { dot.className = 'status-dot offline'; text.textContent = 'Counterparty: Offline'; }
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

// ---------------- KICKOFF ----------------
// (Initial view state is now handled inside the init-state handler once
// admin status is known — see hideListPanelMobile()/exitSelectMode() there.)
