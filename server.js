const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7 // 10MB Limit
});

app.use(express.static('public'));

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ADMIN123';
const ADMIN_SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 Hours

// Global Registries
const groups = {
  "default-group": {
    id: "default-group",
    name: "General Transaction Group #1",
    messages: [],
    pinnedMessage: null,
    fileUploadsLocked: false,
    customNames: {
      'PARTY A': 'Party A (Buyer)',
      'PARTY B': 'Party B (Seller)'
    }
  }
};

// Store active DMs: { dmId: { participants: [socketId1, socketId2], messages: [] } }
const directMessages = {};
// Store user online statuses: { userId/socketId: { role, groupId, isOnline, email, lastActive } }
const userPresence = {};

function getOrCreateGroup(groupId, groupName) {
  if (!groups[groupId]) {
    groups[groupId] = {
      id: groupId,
      name: groupName || `Transaction Group #${groupId}`,
      messages: [],
      pinnedMessage: null,
      fileUploadsLocked: false,
      customNames: {
        'PARTY A': 'Party A (Buyer)',
        'PARTY B': 'Party B (Seller)'
      }
    };
  }
  return groups[groupId];
}

// Utility: Trigger Email Notification for Offline Users (Integration Hook)
function sendOfflineEmailNotification(userEmail, senderName, messageText) {
  console.log(`[EMAIL DISPATCH] Alert sent to ${userEmail}: New message from ${senderName}: "${messageText.substring(0, 30)}..."`);
  // Integrate Nodemailer / SendGrid here
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  function resetAdminTimeout() {
    if (socket.adminTimer) clearTimeout(socket.adminTimer);
    if (socket.isAdmin) {
      socket.adminTimer = setTimeout(() => {
        socket.isAdmin = false;
        socket.role = 'PARTY A';
        socket.emit('admin-session-expired', 'Your Admin session expired after 2 hours of inactivity.');
        
        const grp = getOrCreateGroup(socket.groupId);
        socket.emit('init-state', {
          group: grp,
          isAdminConfirmed: false
        });
      }, ADMIN_SESSION_TIMEOUT_MS);
    }
  }

  // Join Specific Group
  socket.on('join-room', ({ groupId, groupName, role, adminKey, sessionToken, userEmail }) => {
    const targetGroupId = groupId || "default-group";
    const grp = getOrCreateGroup(targetGroupId, groupName);

    socket.userEmail = userEmail || null;
    socket.sessionToken = sessionToken || socket.id;

    if (role === 'ADMINISTRATOR') {
      if (adminKey && adminKey === ADMIN_SECRET) {
        socket.isAdmin = true;
        socket.role = 'ADMINISTRATOR';
        resetAdminTimeout();
      } else {
        socket.emit('auth-failed', 'Access Denied: Invalid Administrator Credentials.');
        return;
      }
    } else {
      socket.isAdmin = false;
      socket.role = role || 'PARTY A';
    }

    if (socket.groupId) socket.leave(socket.groupId);

    socket.join(targetGroupId);
    socket.groupId = targetGroupId;

    // Track Presence
    userPresence[socket.id] = {
      socketId: socket.id,
      groupId: targetGroupId,
      role: socket.role,
      isAdmin: socket.isAdmin,
      isOnline: true,
      displayName: socket.isAdmin ? 'Transaction Officer' : (grp.customNames[socket.role] || socket.role)
    };

    const displayName = userPresence[socket.id].displayName;

    socket.emit('init-state', {
      group: grp,
      isAdminConfirmed: socket.isAdmin,
      socketId: socket.id
    });

    // Broadcast presence update
    io.to(targetGroupId).emit('presence-update', Object.values(userPresence).filter(p => p.groupId === targetGroupId));

    io.to(targetGroupId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${displayName} connected.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Admin: Get List of All Active Groups & Online Users
  socket.on('get-all-groups', () => {
    if (!socket.isAdmin) return;
    const groupList = Object.values(groups).map(g => ({ id: g.id, name: g.name }));
    socket.emit('all-groups-list', groupList);
    socket.emit('active-users-list', Object.values(userPresence));
  });

  // Admin: Create New Group
  socket.on('create-group', ({ groupName }) => {
    if (!socket.isAdmin) return;
    const newId = 'grp-' + Math.random().toString(36).substring(2, 9);
    const grp = getOrCreateGroup(newId, groupName);

    const groupList = Object.values(groups).map(g => ({ id: g.id, name: g.name }));
    io.emit('all-groups-list', groupList);
    socket.emit('group-created', { id: newId, name: grp.name });
  });

  socket.on('ping-activity', () => {
    if (socket.isAdmin) resetAdminTimeout();
  });

  // Typing Indicators & Admin Spectator Mode
  socket.on('typing-start', ({ isTyping, currentDraft }) => {
    if (socket.groupId) {
      const grp = getOrCreateGroup(socket.groupId);
      const senderName = socket.isAdmin ? 'Transaction Officer' : (grp.customNames[socket.role] || socket.role);
      
      // Public typing alert
      socket.to(socket.groupId).emit('user-typing', { socketId: socket.id, sender: senderName, isTyping });

      // Admin Spectator Mode (Feature 6i): Stream live draft to Admin only
      if (!socket.isAdmin) {
        io.to(socket.groupId).emit('admin-live-draft', {
          socketId: socket.id,
          sender: senderName,
          draftText: currentDraft || ''
        });
      }
    }
  });

  // Direct Messaging (Feature 4: Admin Initiates DMs)
  socket.on('admin-initiate-dm', ({ targetSocketId, initialMessage }) => {
    if (!socket.isAdmin) return;

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (!targetSocket) {
      socket.emit('error-msg', 'Target user is no longer connected.');
      return;
    }

    const dmRoomId = `dm-${socket.id}-${targetSocketId}`;
    socket.join(dmRoomId);
    targetSocket.join(dmRoomId);

    const dmMsg = {
      id: Date.now().toString(),
      sender: 'TRANSACTION OFFICER (ADMIN)',
      senderSocketId: socket.id,
      text: initialMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dmRoomId
    };

    io.to(dmRoomId).emit('dm-message', dmMsg);
    targetSocket.emit('dm-channel-opened', { dmRoomId, adminName: 'Transaction Officer' });
  });

  socket.on('send-dm-reply', ({ dmRoomId, text }) => {
    const dmMsg = {
      id: Date.now().toString(),
      sender: userPresence[socket.id]?.displayName || socket.role,
      senderSocketId: socket.id,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dmRoomId
    };
    io.to(dmRoomId).emit('dm-message', dmMsg);
  });

  // Public Group Message Dispatch
  socket.on('send-message', ({ groupId, text, englishOriginal, language, fileData, fileName }) => {
    const grp = getOrCreateGroup(groupId);

    if (socket.isAdmin) resetAdminTimeout();

    if (fileData && grp.fileUploadsLocked && !socket.isAdmin) {
      socket.emit('error-msg', 'File transfers are currently locked by the Administrator.');
      return;
    }

    const senderName = socket.isAdmin 
      ? 'TRANSACTION OFFICER' 
      : (grp.customNames[socket.role] || socket.role);

    const msg = {
      id: Date.now().toString(),
      senderRole: socket.role,
      sender: senderName,
      text: text || '',
      englishOriginal: englishOriginal || text || '',
      language: language || 'en',
      fileData: fileData || null,
      fileName: fileName || null,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    grp.messages.push(msg);
    io.to(groupId).emit('message', msg);

    // Check for offline participants in the room to dispatch emails
    Object.values(userPresence).forEach(user => {
      if (user.groupId === groupId && !user.isOnline && user.email) {
        sendOfflineEmailNotification(user.email, senderName, text);
      }
    });
  });

  socket.on('rename-party', ({ groupId, targetParty, newName }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const grp = getOrCreateGroup(groupId);
    const partyKey = targetParty === 'A' ? 'PARTY A' : 'PARTY B';
    grp.customNames[partyKey] = newName;

    grp.messages.forEach(m => {
      if (m.senderRole === partyKey) m.sender = newName;
    });

    io.to(groupId).emit('names-updated', {
      customNames: grp.customNames,
      history: grp.messages
    });
  });

  socket.on('edit-message', ({ groupId, msgId, newText }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const grp = getOrCreateGroup(groupId);
    const targetMsg = grp.messages.find(m => m.id === msgId);
    if (targetMsg) {
      targetMsg.text = newText;
      targetMsg.englishOriginal = newText;
      io.to(groupId).emit('message-edited', { msgId, newText });
    }
  });

  socket.on('delete-message', ({ groupId, msgIds }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const grp = getOrCreateGroup(groupId);
    const idsToDelete = Array.isArray(msgIds) ? msgIds : [msgIds];
    grp.messages = grp.messages.filter(m => !idsToDelete.includes(m.id));
    io.to(groupId).emit('messages-deleted', { msgIds: idsToDelete });
  });

  socket.on('pin-message', ({ groupId, msgId }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const grp = getOrCreateGroup(groupId);
    const targetMsg = grp.messages.find(m => m.id === msgId);
    if (targetMsg) {
      grp.pinnedMessage = targetMsg;
      io.to(groupId).emit('update-pinned', grp.pinnedMessage);
    }
  });

  socket.on('toggle-file-lock', ({ groupId }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const grp = getOrCreateGroup(groupId);
    grp.fileUploadsLocked = !grp.fileUploadsLocked;
    io.to(groupId).emit('file-lock-updated', grp.fileUploadsLocked);
  });

  socket.on('disconnect', () => {
    if (socket.adminTimer) clearTimeout(socket.adminTimer);
    if (userPresence[socket.id]) {
      userPresence[socket.id].isOnline = false;
    }

    if (socket.groupId && socket.role) {
      const grp = getOrCreateGroup(socket.groupId);
      const displayName = socket.isAdmin 
        ? 'Transaction Administrator' 
        : (grp.customNames[socket.role] || socket.role);

      io.to(socket.groupId).emit('presence-update', Object.values(userPresence).filter(p => p.groupId === socket.groupId));

      io.to(socket.groupId).emit('message', {
        id: Date.now().toString(),
        sender: 'SYSTEM',
        text: `${displayName} disconnected.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Transaction Gateway Active] Listening on port ${PORT}`));
