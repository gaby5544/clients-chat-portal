JavaScript


const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer'); // Email notification handler

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7 
});

app.use(express.static('public'));

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ADMIN123';

// Simulated Email Transporter
const mailTransporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: { user: 'demo@ethereal.email', pass: 'demopass' }
});

const groups = {
  "grp-default": {
    id: "grp-default",
    name: "General Transaction Desk",
    messages: [],
    pinnedMessage: null,
    fileUploadsLocked: false,
    customNames: { 'PARTY_A': 'Party A (Buyer)', 'PARTY_B': 'Party B (Seller)' }
  }
};

// Track Active Users: { socketId: { userId, groupId, role, isOnline, email } }
const connectedUsers = {};
// Direct Messages Store: { dmRoomId: [ messages ] }
const directMessages = {};

function getOrCreateGroup(groupId, groupName) {
  if (!groups[groupId]) {
    groups[groupId] = {
      id: groupId,
      name: groupName || `Transaction Group #${groupId}`,
      messages: [],
      pinnedMessage: null,
      fileUploadsLocked: false,
      customNames: { 'PARTY_A': 'Party A (Buyer)', 'PARTY_B': 'Party B (Seller)' }
    };
  }
  return groups[groupId];
}

io.on('connection', (socket) => {
  console.log('Client Connected:', socket.id);

  socket.on('join-room', ({ groupId, role, adminKey, userId, userEmail }) => {
    const targetGroupId = groupId || "grp-default";
    const grp = getOrCreateGroup(targetGroupId);

    socket.userId = userId || 'user_' + Math.random().toString(36).substring(2, 7);
    socket.userEmail = userEmail || null;

    if (role === 'ADMINISTRATOR' && adminKey === ADMIN_SECRET) {
      socket.isAdmin = true;
      socket.role = 'ADMINISTRATOR';
    } else {
      socket.isAdmin = false;
      socket.role = role || 'PARTY_A';
    }

    if (socket.groupId) socket.leave(socket.groupId);

    socket.join(targetGroupId);
    socket.groupId = targetGroupId;

    connectedUsers[socket.userId] = {
      socketId: socket.id,
      userId: socket.userId,
      groupId: targetGroupId,
      role: socket.role,
      isOnline: true,
      email: socket.userEmail
    };

    socket.emit('init-state', {
      group: grp,
      isAdminConfirmed: socket.isAdmin,
      userId: socket.userId,
      onlineUsers: Object.values(connectedUsers)
    });

    // Notify group of online status
    io.to(targetGroupId).emit('user-status-change', {
      userId: socket.userId,
      role: socket.role,
      isOnline: true
    });
  });

  // Real-time Typing Preview (Admin sees draft, Users see indicator)
  socket.on('typing-draft', ({ text }) => {
    if (!socket.groupId) return;
    
    // Broadcast generic typing to group participants
    socket.to(socket.groupId).emit('user-typing', {
      userId: socket.userId,
      role: socket.role,
      isTyping: text.length > 0
    });

    // Broadcast live draft text ONLY to Admin sockets
    io.sockets.sockets.forEach((s) => {
      if (s.isAdmin) {
        s.emit('admin-live-type-preview', {
          groupId: socket.groupId,
          userId: socket.userId,
          role: socket.role,
          draftText: text
        });
      }
    });
  });

  // Handle Group Messages & Offline Email Dispatch
  socket.on('send-message', ({ groupId, text, englishOriginal, language, fileData, fileName }) => {
    const grp = getOrCreateGroup(groupId);

    const msg = {
      id: Date.now().toString(),
      senderRole: socket.role,
      sender: socket.isAdmin ? 'TRANSACTION OFFICER' : (grp.customNames[socket.role] || socket.role),
      text: text || '',
      englishOriginal: englishOriginal || text || '',
      language: language || 'en',
      fileData: fileData || null,
      fileName: fileName || null,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    grp.messages.push(msg);
    io.to(groupId).emit('message', msg);

    // Offline Notification Handler
    Object.values(connectedUsers).forEach(u => {
      if (u.groupId === groupId && !u.isOnline && u.email) {
        console.log(`[EMAIL ALERT Sent to ${u.email}]: New message in ${grp.name}`);
        /* Send email via nodemailer transport */
      }
    });
  });

  // Admin Direct Messaging (DM) Out of Group
  socket.on('admin-send-dm', ({ targetUserId, text }) => {
    if (!socket.isAdmin) return;

    const dmRoomId = `dm-${targetUserId}`;
    if (!directMessages[dmRoomId]) directMessages[dmRoomId] = [];

    const dmMsg = {
      id: Date.now().toString(),
      sender: 'TRANSACTION OFFICER (ADMIN)',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    directMessages[dmRoomId].push(dmMsg);

    // Send to Admin & Target User
    socket.emit('dm-received', { dmRoomId, targetUserId, msg: dmMsg });
    
    const targetUser = connectedUsers[targetUserId];
    if (targetUser && targetUser.socketId) {
      io.to(targetUser.socketId).emit('dm-received', { dmRoomId, targetUserId, msg: dmMsg });
      io.to(targetUser.socketId).emit('unlock-dm-tab', { dmRoomId });
    }
  });

  socket.on('user-reply-dm', ({ dmRoomId, text }) => {
    if (!directMessages[dmRoomId]) directMessages[dmRoomId] = [];

    const dmMsg = {
      id: Date.now().toString(),
      sender: socket.role,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    directMessages[dmRoomId].push(dmMsg);

    // Broadcast DM to participant and Admins
    socket.emit('dm-received', { dmRoomId, msg: dmMsg });
    io.sockets.sockets.forEach((s) => {
      if (s.isAdmin) s.emit('dm-received', { dmRoomId, msg: dmMsg });
    });
  });

  socket.on('disconnect', () => {
    if (socket.userId && connectedUsers[socket.userId]) {
      connectedUsers[socket.userId].isOnline = false;
      io.to(socket.groupId).emit('user-status-change', {
        userId: socket.userId,
        role: socket.role,
        isOnline: false
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Gateway Active] Running on Port ${PORT}`));
