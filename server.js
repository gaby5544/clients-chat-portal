const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7 // Allow file transfers up to 10MB
});

app.use(express.static('public'));

// In-memory state storage for demo rooms
const roomStates = {};

function getRoomState(roomId) {
  if (!roomStates[roomId]) {
    roomStates[roomId] = {
      messages: [],
      pinnedMessage: null,
      fileUploadsLocked: false
    };
  }
  return roomStates[roomId];
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins room
  socket.on('join-room', ({ roomId, role }) => {
    socket.join(roomId);
    socket.role = role;
    socket.roomId = roomId;

    const state = getRoomState(roomId);

    // Send room state and history to joining user
    socket.emit('init-state', {
      history: state.messages,
      pinnedMessage: state.pinnedMessage,
      fileUploadsLocked: state.fileUploadsLocked
    });

    // Notify room
    io.to(roomId).emit('message', {
      id: Date.now().toString(),
      sender: 'SYSTEM',
      text: `${role} has joined the workspace.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Handle incoming messages
  socket.on('send-message', ({ roomId, text, fileData, fileName }) => {
    const state = getRoomState(roomId);

    // Check file upload lock for non-admin users
    if (fileData && state.fileUploadsLocked && !socket.role?.includes('ADMIN')) {
      socket.emit('error-msg', 'File uploads are currently locked by the Administrator.');
      return;
    }

    const msg = {
      id: Date.now().toString(),
      sender: socket.role || 'Participant',
      text: text || '',
      fileData: fileData || null,
      fileName: fileName || null,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    state.messages.push(msg);
    io.to(roomId).emit('message', msg);
  });

  // Admin Pin Message
  socket.on('pin-message', ({ roomId, msgId }) => {
    if (!socket.role?.includes('ADMIN')) return;
    const state = getRoomState(roomId);
    const targetMsg = state.messages.find(m => m.id === msgId);
    if (targetMsg) {
      state.pinnedMessage = targetMsg;
      io.to(roomId).emit('update-pinned', state.pinnedMessage);
    }
  });

  // Admin Lock/Unlock File Uploads
  socket.on('toggle-file-lock', ({ roomId }) => {
    if (!socket.role?.includes('ADMIN')) return;
    const state = getRoomState(roomId);
    state.fileUploadsLocked = !state.fileUploadsLocked;
    io.to(roomId).emit('file-lock-updated', state.fileUploadsLocked);
  });

  // Admin Kick Participant
  socket.on('kick-participant', ({ roomId, targetRole }) => {
    if (!socket.role?.includes('ADMIN')) return;

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
      text: `${targetRole} was removed from the session by the Administrator.`,
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
