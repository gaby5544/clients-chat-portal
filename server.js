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

// Secure Admin Passkey (Can be overridden by environment variable)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ADMIN123';
const ADMIN_SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 Hours

const roomStates = {};

function getRoomState(roomId) {
  if (!roomStates[roomId]) {
    roomStates[roomId] = {
      messages: [],
      pinnedMessage: null,
      fileUploadsLocked: false,
      customNames: {
        'PARTY A': 'Party A (Buyer)',
        'PARTY B': 'Party B (Seller)'
      }
    };
  }
  return roomStates[roomId];
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Auto-logout timer helper
  function resetAdminTimeout() {
    if (socket.adminTimer) clearTimeout(socket.adminTimer);
    if (socket.isAdmin) {
      socket.adminTimer = setTimeout(() => {
        socket.isAdmin = false;
        socket.role = 'PARTY A'; // Fallback
        socket.emit('admin-session-expired', 'Your Admin session expired after 2 hours of inactivity.');
        
        const state = getRoomState(socket.roomId);
        socket.emit('init-state', {
          history: state.messages,
          pinnedMessage: state.pinnedMessage,
          fileUploadsLocked: state.fileUploadsLocked,
          customNames: state.customNames,
          isAdminConfirmed: false
        });
      }, ADMIN_SESSION_TIMEOUT_MS);
    }
  }

  // Join Room Event
  socket.on('join-room', ({ roomId, role, adminKey }) => {
    const state = getRoomState(roomId);
    
    // Strict Admin Password Check
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

    socket.join(roomId);
    socket.roomId = roomId;

    const displayName = socket.isAdmin 
      ? 'Escrow Administrator' 
      : (state.customNames[socket.role] || socket.role);

    // Send state to joining user ONLY (never broadcast admin keys)
    socket.emit('init-state', {
      history: state.messages,
      pinnedMessage: state.pinnedMessage,
      fileUploadsLocked: state.fileUploadsLocked,
      customNames: state.customNames,
      isAdminConfirmed: socket.isAdmin
    });

    // Notify room of connection
    io.to(roomId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${displayName} connected to the session.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Track Admin activity to keep session alive
  socket.on('ping-activity', () => {
    if (socket.isAdmin) {
      resetAdminTimeout();
    }
  });

  // Send Message
  socket.on('send-message', ({ roomId, text, fileData, fileName }) => {
    const state = getRoomState(roomId);

    if (socket.isAdmin) resetAdminTimeout();

    if (fileData && state.fileUploadsLocked && !socket.isAdmin) {
      socket.emit('error-msg', 'File transfers are currently locked by the Administrator.');
      return;
    }

    const senderName = socket.isAdmin 
      ? 'ESCROW OFFICER' 
      : (state.customNames[socket.role] || socket.role);

    const msg = {
      id: Date.now().toString(),
      senderRole: socket.role,
      sender: senderName,
      text: text || '',
      fileData: fileData || null,
      fileName: fileName || null,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    state.messages.push(msg);
    io.to(roomId).emit('message', msg);
  });

  // Admin Actions
  socket.on('rename-party', ({ roomId, targetParty, newName }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const state = getRoomState(roomId);
    const partyKey = targetParty === 'A' ? 'PARTY A' : 'PARTY B';
    state.customNames[partyKey] = newName;

    // Update prior history dynamically
    state.messages.forEach(m => {
      if (m.senderRole === partyKey) {
        m.sender = newName;
      }
    });

    io.to(roomId).emit('names-updated', {
      customNames: state.customNames,
      history: state.messages
    });
  });

  socket.on('edit-message', ({ roomId, msgId, newText }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const state = getRoomState(roomId);
    const targetMsg = state.messages.find(m => m.id === msgId);
    if (targetMsg) {
      targetMsg.text = newText;
      io.to(roomId).emit('message-edited', { msgId, newText });
    }
  });

  socket.on('delete-message', ({ roomId, msgId }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const state = getRoomState(roomId);
    state.messages = state.messages.filter(m => m.id !== msgId);
    io.to(roomId).emit('message-deleted', { msgId });
  });

  socket.on('pin-message', ({ roomId, msgId }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const state = getRoomState(roomId);
    const targetMsg = state.messages.find(m => m.id === msgId);
    if (targetMsg) {
      state.pinnedMessage = targetMsg;
      io.to(roomId).emit('update-pinned', state.pinnedMessage);
    }
  });

  socket.on('toggle-file-lock', ({ roomId }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const state = getRoomState(roomId);
    state.fileUploadsLocked = !state.fileUploadsLocked;
    io.to(roomId).emit('file-lock-updated', state.fileUploadsLocked);
  });

  socket.on('kick-participant', ({ roomId, targetParty }) => {
    if (!socket.isAdmin) return;
    resetAdminTimeout();

    const targetRole = targetParty === 'A' ? 'PARTY A' : 'PARTY B';
    const state = getRoomState(roomId);
    const displayName = state.customNames[targetRole] || targetRole;

    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (socketsInRoom) {
      for (const socketId of socketsInRoom) {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (clientSocket && clientSocket.role === targetRole) {
          clientSocket.emit('kicked', 'Session terminated by Escrow Officer.');
          clientSocket.leave(roomId);
          clientSocket.disconnect(true);
        }
      }
    }

    io.to(roomId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${displayName} was disconnected by the Escrow Officer.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    if (socket.adminTimer) clearTimeout(socket.adminTimer);
    if (socket.roomId && socket.role) {
      const state = getRoomState(socket.roomId);
      const displayName = socket.isAdmin 
        ? 'Escrow Administrator' 
        : (state.customNames[socket.role] || socket.role);

      io.to(socket.roomId).emit('message', {
        id: Date.now().toString(),
        sender: 'SYSTEM',
        text: `${displayName} left the workspace.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Secure Gateway Active] Listening on port ${PORT}`));
