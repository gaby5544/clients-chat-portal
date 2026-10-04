// Shared shaping/posting helpers for chat messages (used by socketHandlers and fundsHandlers).
const { store } = require('./db');
const { escapeHtml } = require('./security');

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function publicMessage(m) {
  const [reactions, status] = await Promise.all([store.getReactionSummary(m.id), store.getMessageStatus(m.id)]);
  return {
    id: m.id, groupId: m.group_id, sender: m.sender_name, senderRole: m.sender_role, senderToken: m.sender_token,
    text: m.text, fileUrl: m.file_url, fileType: m.file_type, fileName: m.file_name, replyToId: m.reply_to_id,
    forwardedFrom: m.forwarded_from, targetLang: m.target_lang, isEdited: m.is_edited, time: nowTime(),
    createdAt: m.created_at, reactions, status
  };
}

// A system line in the group chat, visible to everyone in that group (both parties + admins).
// `text` is plain text; it is escaped here.
async function postSystemMessage(io, groupId, text, prefix = 'sys') {
  const msg = await store.insertMessage({
    id: prefix + '-' + Date.now() + Math.random().toString(36).slice(2, 6),
    groupId, senderName: 'SYSTEM', text: escapeHtml(text)
  });
  io.to(groupId).emit('message', await publicMessage(msg));
  return msg;
}

module.exports = { nowTime, publicMessage, postSystemMessage };
