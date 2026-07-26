const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" } 
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, role }) => {
    socket.join(roomId);
    socket.role = role;
    socket.roomId = roomId;
    
    io.to(roomId).emit('message', {
      sender: 'SYSTEM',
      text: `${role} has authenticated and entered the session.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('send-message', ({ roomId, text }) => {
    if (!text || !text.trim()) return;

    io.to(roomId).emit('message', {
      sender: socket.role || 'Participant',
      text: text.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    if (socket.roomId && socket.role) {
      io.to(socket.roomId).emit('message', {
        sender: 'SYSTEM',
        text: `${socket.role} has disconnected from the session.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
