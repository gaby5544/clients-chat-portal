const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7 // Up to 10MB file transfers
});

app.use(express.static('public'));

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

  socket.on('join-room', ({ roomId, role }) => {
    socket.join(roomId);
    socket.role = role;
    socket.roomId = roomId;

    const state = getRoomState(roomId);

    socket.emit('init-state', {
      history: state.messages,
      pinnedMessage: state.pinnedMessage,
      fileUploadsLocked: state.fileUploadsLocked,
      customNames: state.customNames
    });

    io.to(roomId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${role} joined the portal session.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('send-message', ({ roomId, text, fileData, fileName }) => {
    const state = getRoomState(roomId);

    if (fileData && state.fileUploadsLocked && !socket.role?.includes('ADMIN')) {
      socket.emit('error-msg', 'File transfers are currently restricted by Admin.');
      return;
    }

    let displayName = socket.role || 'Participant';
    if (socket.role === 'PARTY A (Buyer)') displayName = state.customNames['PARTY A'];
    if (socket.role === 'PARTY B (Seller)') displayName = state.customNames['PARTY B'];

    const msg = {
      id: Date.now().toString(),
      sender: displayName,
      rawRole: socket.role,
      text: text || '',
      fileData: fileData || null,
      fileName: fileName || null,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    state.messages.push(msg);
    io.to(roomId).emit('message', msg);
  });

  // ✏️ Admin Edit Message
  socket.on('edit-message', ({ roomId, msgId, newText }) => {
    if (!socket.role?.includes('ADMIN')) return;
    const state = getRoomState(roomId);
    const targetMsg = state.messages.find(m => m.id === msgId);
    if (targetMsg) {
      targetMsg.text = newText;
      io.to(roomId).emit('message-edited', { msgId, newText });
    }
  });

  // 🗑️ Admin Delete Message
  socket.on('delete-message', ({ roomId, msgId }) => {
    if (!socket.role?.includes('ADMIN')) return;
    const state = getRoomState(roomId);
    state.messages = state.messages.filter(m => m.id !== msgId);
    io.to(roomId).emit('message-deleted', { msgId });
  });

  // 👤 Admin Rename Party
  socket.on('rename-party', ({ roomId, targetParty, newName }) => {
    if (!socket.role?.includes('ADMIN')) return;
    const state = getRoomState(roomId);
    if (targetParty === 'A') state.customNames['PARTY A'] = newName;
    if (targetParty === 'B') state.customNames['PARTY B'] = newName;

    io.to(roomId).emit('names-updated', state.customNames);
  });

  // 📌 Admin Pin Message
  socket.on('pin-message', ({ roomId, msgId }) => {
    if (!socket.role?.includes('ADMIN')) return;
    const state = getRoomState(roomId);
    const targetMsg = state.messages.find(m => m.id === msgId);
    if (targetMsg) {
      state.pinnedMessage = targetMsg;
      io.to(roomId).emit('update-pinned', state.pinnedMessage);
    }
  });

  // 🔒 Lock File Uploads
  socket.on('toggle-file-lock', ({ roomId }) => {
    if (!socket.role?.includes('ADMIN')) return;
    const state = getRoomState(roomId);
    state.fileUploadsLocked = !state.fileUploadsLocked;
    io.to(roomId).emit('file-lock-updated', state.fileUploadsLocked);
  });

  // 🚫 Kick Participant
  socket.on('kick-participant', ({ roomId, targetRole }) => {
    if (!socket.role?.includes('ADMIN')) return;

    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (socketsInRoom) {
      for (const socketId of socketsInRoom) {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (clientSocket && clientSocket.role === targetRole) {
          clientSocket.emit('kicked', 'Session terminated by Administrator.');
          clientSocket.leave(roomId);
          clientSocket.disconnect(true);
        }
      }
    }

    io.to(roomId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${targetRole} was disconnected by Administrator.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    if (socket.roomId && socket.role) {
      io.to(socket.roomId).emit('message', {
        id: Date.now().toString(),
        sender: 'SYSTEM',
        text: `${socket.role} left the session.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
