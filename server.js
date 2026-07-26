const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  console.log('Nodemailer module not found. Email features will run in fallback mock mode.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const ADMIN_PASSKEY = "ADMIN123";

let transporter = null;
if (nodemailer && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

async function sendEmailNotification(to, subject, text) {
  try {
    if (transporter) {
      await transporter.sendMail({
        from: '"Quantum Desk Alert" <no-reply@quantumdesk.com>',
        to,
        subject,
        text
      });
      console.log(`Email notification sent to ${to}`);
    } else {
      console.log(`[Mock Email Sent to ${to}]: ${subject} - ${text}`);
    }
  } catch (err) {
    console.error('Email Notification Failed:', err.message);
  }
}

let groups = {
  "default-group": {
    id: "default-group",
    name: "General Transaction Group #1",
    messages: [],
    customNames: { A: "Buyer (Party A)", B: "Seller (Party B)" },
    fileLocked: false,
    highlighted: false
  }
};

let activeSockets = {}; 

io.on('connection', (socket) => {

  // 1. Join Room
  socket.on('join-room', ({ groupId, role, adminKey, sessionToken }) => {
    if (!groups[groupId]) {
      groups[groupId] = {
        id: groupId,
        name: `Transaction Group #${Object.keys(groups).length + 1}`,
        messages: [],
        customNames: { A: "Buyer (Party A)", B: "Seller (Party B)" },
        fileLocked: false,
        highlighted: false
      };
    }

    const isAdmin = (adminKey === ADMIN_PASSKEY);
    const displayName = isAdmin 
      ? "Desk Officer (Admin)" 
      : (role === "PARTY A" ? groups[groupId].customNames.A : groups[groupId].customNames.B);

    socket.rooms.forEach(r => { if(r !== socket.id) socket.leave(r); });
    socket.join(groupId);

    activeSockets[socket.id] = {
      socketId: socket.id,
      groupId,
      role,
      displayName,
      isAdmin,
      sessionToken,
      isOnline: true
    };

    socket.emit('init-state', {
      group: groups[groupId],
      isAdminConfirmed: isAdmin,
      socketId: socket.id
    });

    io.to(groupId).emit('message', {
      id: 'sys-' + Date.now(),
      sender: 'SYSTEM',
      text: `${displayName} connected.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    broadcastPresence(groupId);
    broadcastActiveUsers();
  });

  // 2. Send Message
  socket.on('send-message', ({ groupId, text, targetLang }) => {
    const user = activeSockets[socket.id];
    if (!user) return;

    const msgData = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      sender: user.displayName,
      senderRole: user.role,
      senderSocketId: socket.id,
      text: text,
      targetLang: targetLang || 'en',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    groups[groupId].messages.push(msgData);
    io.to(groupId).emit('message', msgData);
  });

  // 3. ADMIN: Edit Any Message
  socket.on('admin-edit-message', ({ groupId, messageId, newText }) => {
    const user = activeSockets[socket.id];
    if (!user || !user.isAdmin) return;

    if (groups[groupId]) {
      const msgIndex = groups[groupId].messages.findIndex(m => m.id === messageId);
      if (msgIndex !== -1) {
        groups[groupId].messages[msgIndex].text = newText;
        groups[groupId].messages[msgIndex].edited = true;

        io.to(groupId).emit('message-edited', {
          groupId,
          messageId,
          newText
        });
      }
    }
  });

  // 4. ADMIN: Bulk Delete Messages
  socket.on('admin-bulk-delete-messages', ({ groupId, messageIds }) => {
    const user = activeSockets[socket.id];
    if (!user || !user.isAdmin) return;

    if (groups[groupId] && Array.isArray(messageIds)) {
      groups[groupId].messages = groups[groupId].messages.filter(m => !messageIds.includes(m.id));
      
      io.to(groupId).emit('messages-bulk-deleted', {
        groupId,
        messageIds
      });
    }
  });

  // 5. ADMIN: Create New Group
  socket.on('create-group', ({ groupName }) => {
    const newId = 'group-' + Date.now();
    const name = groupName || `General Transaction Group #${Object.keys(groups).length + 1}`;
    
    groups[newId] = {
      id: newId,
      name: name,
      messages: [],
      customNames: { A: "Buyer (Party A)", B: "Seller (Party B)" },
      fileLocked: false,
      highlighted: false
    };

    io.emit('all-groups-list', Object.values(groups));
    socket.emit('group-created-and-switch', { newGroupId: newId });
  });

  // 6. ADMIN: Delete Group
  socket.on('delete-group', ({ groupId }) => {
    if (Object.keys(groups).length <= 1) {
      socket.emit('error-msg', "Cannot delete the last remaining group!");
      return;
    }

    delete groups[groupId];
    io.emit('all-groups-list', Object.values(groups));

    const remainingGroup = Object.keys(groups)[0];
    io.to(groupId).emit('force-room-switch', { newGroupId: remainingGroup });
  });

  socket.on('bulk-delete-groups', ({ groupIds }) => {
    if (!groupIds || !Array.isArray(groupIds)) return;
    
    groupIds.forEach(gid => {
      if (Object.keys(groups).length > 1 && groups[gid]) {
        delete groups[gid];
        const remaining = Object.keys(groups)[0];
        io.to(gid).emit('force-room-switch', { newGroupId: remaining });
      }
    });

    io.emit('all-groups-list', Object.values(groups));
  });

  socket.on('toggle-highlight-group', ({ groupId }) => {
    if (groups[groupId]) {
      groups[groupId].highlighted = !groups[groupId].highlighted;
      io.emit('all-groups-list', Object.values(groups));
    }
  });

  socket.on('rename-party', ({ groupId, party, newName }) => {
    if (groups[groupId]) {
      groups[groupId].customNames[party] = newName;

      Object.values(activeSockets).forEach(u => {
        if (u.groupId === groupId) {
          if (party === 'A' && u.role === 'PARTY A') u.displayName = newName;
          if (party === 'B' && u.role === 'PARTY B') u.displayName = newName;
        }
      });

      io.to(groupId).emit('init-state', {
        group: groups[groupId],
        isAdminConfirmed: activeSockets[socket.id]?.isAdmin || false,
        socketId: socket.id
      });
      broadcastPresence(groupId);
    }
  });

  socket.on('toggle-file-lock', ({ groupId }) => {
    if (groups[groupId]) {
      groups[groupId].fileLocked = !groups[groupId].fileLocked;
      io.to(groupId).emit('file-lock-status', { fileLocked: groups[groupId].fileLocked });
    }
  });

  socket.on('typing-start', ({ isTyping, currentDraft }) => {
    const user = activeSockets[socket.id];
    if (!user) return;

    socket.to(user.groupId).emit('user-typing', { sender: user.displayName, isTyping });

    Object.values(activeSockets).forEach(u => {
      if (u.isAdmin && u.groupId === user.groupId) {
        io.to(u.socketId).emit('admin-live-draft', { sender: user.displayName, draftText: currentDraft });
      }
    });
  });

  socket.on('admin-initiate-dm', ({ targetSocketId, initialMessage, userEmail }) => {
    const dmRoomId = `dm-${socket.id}-${targetSocketId}`;
    
    socket.emit('dm-channel-opened', { dmRoomId, targetSocketId });
    io.to(targetSocketId).emit('dm-channel-opened', { dmRoomId, targetSocketId: socket.id });

    const msgPayload = {
      dmRoomId,
      sender: "Desk Officer (Admin)",
      senderSocketId: socket.id,
      text: initialMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    socket.emit('dm-message', msgPayload);
    io.to(targetSocketId).emit('dm-message', msgPayload);

    if (userEmail) {
      sendEmailNotification(userEmail, "New Direct Message from Officer", initialMessage);
    }
  });

  socket.on('send-dm-reply', ({ dmRoomId, text }) => {
    const user = activeSockets[socket.id];
    const msgPayload = {
      dmRoomId,
      sender: user ? user.displayName : "User",
      senderSocketId: socket.id,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.emit('dm-message', msgPayload);
  });

  socket.on('get-all-groups', () => {
    socket.emit('all-groups-list', Object.values(groups));
  });

  socket.on('disconnect', () => {
    const user = activeSockets[socket.id];
    if (user) {
      user.isOnline = false;
      io.to(user.groupId).emit('message', {
        id: 'sys-' + Date.now(),
        sender: 'SYSTEM',
        text: `${user.displayName} disconnected.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      broadcastPresence(user.groupId);
      delete activeSockets[socket.id];
      broadcastActiveUsers();
    }
  });

  function broadcastPresence(groupId) {
    const roomUsers = Object.values(activeSockets).filter(u => u.groupId === groupId);
    io.to(groupId).emit('presence-update', roomUsers);
  }

  function broadcastActiveUsers() {
    const users = Object.values(activeSockets);
    io.emit('active-users-list', users);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
