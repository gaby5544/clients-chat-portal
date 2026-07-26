const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7 // 10MB limit
});

app.use(express.static('public'));

// Secret password for Admin access
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ADMIN123';

const roomStates = {};

function getRoomState(roomId) {
  if (!roomStates[roomId]) {
    roomStates[roomId] = {
      messages: [],
      pinnedMessage: null,
      fileUploadsLocked: false,
      customNames: {
        'PARTY A': 'Party A',
        'PARTY B': 'Party B'
      }
    };
  }
  return roomStates[roomId];
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Verification helper
  function checkAdminAuth() {
    return socket.isAdmin === true;
  }

  // Join Room with authentication
  socket.on('join-room', ({ roomId, role, adminKey }) => {
    const state = getRoomState(roomId);
    
    if (role === 'ADMINISTRATOR') {
      if (adminKey === ADMIN_SECRET) {
        socket.isAdmin = true;
        socket.role = 'ADMINISTRATOR';
      } else {
        socket.emit('auth-failed', 'Incorrect Admin Password.');
        return;
      }
    } else {
      socket.isAdmin = false;
      socket.role = role; // "PARTY A" or "PARTY B"
    }

    socket.join(roomId);
    socket.roomId = roomId;

    const displayName = socket.isAdmin 
      ? 'Administrator' 
      : (state.customNames[socket.role] || socket.role);

    // Initial state sent to joining client
    socket.emit('init-state', {
      history: state.messages,
      pinnedMessage: state.pinnedMessage,
      fileUploadsLocked: state.fileUploadsLocked,
      customNames: state.customNames,
      isAdminConfirmed: socket.isAdmin
    });

    // Notify room of arrival
    io.to(roomId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${displayName} has joined the workspace.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Handle incoming messages
  socket.on('send-message', ({ roomId, text, fileData, fileName }) => {
    const state = getRoomState(roomId);

    if (fileData && state.fileUploadsLocked && !socket.isAdmin) {
      socket.emit('error-msg', 'File uploads are currently locked by the Administrator.');
      return;
    }

    // Resolve sender's active display name
    const senderName = socket.isAdmin 
      ? 'ADMINISTRATOR' 
      : (state.customNames[socket.role] || socket.role || 'Participant');

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

  // Admin: Custom Rename (e.g. Party A -> "John (Buyer)")
  socket.on('rename-party', ({ roomId, targetParty, newName }) => {
    if (!checkAdminAuth()) return;
    const state = getRoomState(roomId);
    
    const partyKey = targetParty === 'A' ? 'PARTY A' : 'PARTY B';
    state.customNames[partyKey] = newName;

    // Update existing message history labels for this party
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

  // Admin: Edit Message
  socket.on('edit-message', ({ roomId, msgId, newText }) => {
    if (!checkAdminAuth()) return;
    const state = getRoomState(roomId);
    const targetMsg = state.messages.find(m => m.id === msgId);
    if (targetMsg) {
      targetMsg.text = newText;
      io.to(roomId).emit('message-edited', { msgId, newText });
    }
  });

  // Admin: Delete Message
  socket.on('delete-message', ({ roomId, msgId }) => {
    if (!checkAdminAuth()) return;
    const state = getRoomState(roomId);
    state.messages = state.messages.filter(m => m.id !== msgId);
    io.to(roomId).emit('message-deleted', { msgId });
  });

  // Admin: Pin Message
  socket.on('pin-message', ({ roomId, msgId }) => {
    if (!checkAdminAuth()) return;
    const state = getRoomState(roomId);
    const targetMsg = state.messages.find(m => m.id === msgId);
    if (targetMsg) {
      state.pinnedMessage = targetMsg;
      io.to(roomId).emit('update-pinned', state.pinnedMessage);
    }
  });

  // Admin: Toggle Lock File Uploads
  socket.on('toggle-file-lock', ({ roomId }) => {
    if (!checkAdminAuth()) return;
    const state = getRoomState(roomId);
    state.fileUploadsLocked = !state.fileUploadsLocked;
    io.to(roomId).emit('file-lock-updated', state.fileUploadsLocked);
  });

  // Admin: Kick Participant
  socket.on('kick-participant', ({ roomId, targetParty }) => {
    if (!checkAdminAuth()) return;

    const targetRole = targetParty === 'A' ? 'PARTY A' : 'PARTY B';
    const state = getRoomState(roomId);
    const displayName = state.customNames[targetRole] || targetRole;

    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (socketsInRoom) {
      for (const socketId of socketsInRoom) {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (clientSocket && clientSocket.role === targetRole) {
          clientSocket.emit('kicked', 'You have been disconnected by the Workspace Administrator.');
          clientSocket.leave(roomId);
          clientSocket.disconnect(true);
        }
      }
    }

    io.to(roomId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${displayName} was removed from the session by the Administrator.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    if (socket.roomId && socket.role) {
      const state = getRoomState(socket.roomId);
      const displayName = socket.isAdmin 
        ? 'Administrator' 
        : (state.customNames[socket.role] || socket.role);

      io.to(socket.roomId).emit('message', {
        id: Date.now().toString(),
        sender: 'SYSTEM',
        text: `${displayName} left the session.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
