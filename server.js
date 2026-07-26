const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Admin Passkey
const ADMIN_PASSKEY = "ADMIN123";

// Email Transporter Config (Update with your SMTP credentials)
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your SMTP provider
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-email-password'
  }
});

// Helper Function for Sending Email Notifications
async function sendEmailNotification(to, subject, text) {
  try {
    if (!process.env.EMAIL_USER) {
      console.log(`[Email Mock Sent to ${to}]: ${subject} - ${text}`);
      return;
    }
    await transporter.sendMail({
      from: '"Quantum Desk Alert" <no-reply@quantumdesk.com>',
      to,
      subject,
      text
    });
    console.log(`Email notification sent to ${to}`);
  } catch (err) {
    console.error('Email Notification Failed:', err.message);
  }
}

// In-Memory Data Store
let groups = {
  "default-group": {
    id: "default-group",
    name: "General Transaction Group #1",
    messages: [],
    customNames: { A: "Buyer (Party A)", B: "Seller (Party B)" },
    fileLocked: false
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
        fileLocked: false
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

    // Send state
    socket.emit('init-state', {
      group: groups[groupId],
      isAdminConfirmed: isAdmin,
      socketId: socket.id
    });

    io.to(groupId).emit('message', {
      sender: 'SYSTEM',
      text: `${displayName} connected.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    broadcastPresence(groupId);
    broadcastActiveUsers();
  });

  // 2. Send Message
  socket.on('send-message', ({ groupId, text }) => {
    const user = activeSockets[socket.id];
    if (!user) return;

    const msgData = {
      id: 'msg-' + Date.now(),
      sender: user.displayName,
      senderRole: user.role,
      text: text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    groups[groupId].messages.push(msgData);
    io.to(groupId).emit('message', msgData);
  });

  // 3. ADMIN: Create New Group & Instantly Redirect Creator
  socket.on('create-group', ({ groupName }) => {
    const newId = 'group-' + Date.now();
    const name = groupName || `General Transaction Group #${Object.keys(groups).length + 1}`;
    
    groups[newId] = {
      id: newId,
      name: name,
      messages: [],
      customNames: { A: "Buyer (Party A)", B: "Seller (Party B)" },
      fileLocked: false
    };

    // Broadcast updated group list
    io.emit('all-groups-list', Object.values(groups));

    // Redirect the creator to the new group
    socket.emit('group-created-and-switch', { newGroupId: newId });
  });

  // 4. ADMIN: Delete Group
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

  // 5. ADMIN: Rename Parties
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

  // 6. ADMIN: Toggle File Lock
  socket.on('toggle-file-lock', ({ groupId }) => {
    if (groups[groupId]) {
      groups[groupId].fileLocked = !groups[groupId].fileLocked;
      io.to(groupId).emit('file-lock-status', { fileLocked: groups[groupId].fileLocked });
    }
  });

  // 7. Live Typing & Spectator Draft
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

  // 8. ADMIN: Direct Messaging & Email Trigger
  socket.on('admin-initiate-dm', ({ targetSocketId, initialMessage, userEmail }) => {
    const dmRoomId = `dm-${socket.id}-${targetSocketId}`;
    
    socket.emit('dm-channel-opened', { dmRoomId });
    io.to(targetSocketId).emit('dm-channel-opened', { dmRoomId });

    const msgPayload = {
      dmRoomId,
      sender: "Desk Officer (Admin)",
      text: initialMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    socket.emit('dm-message', msgPayload);
    io.to(targetSocketId).emit('dm-message', msgPayload);

    // Optional Email Notification if email is provided
    if (userEmail) {
      sendEmailNotification(userEmail, "New Direct Message from Officer", initialMessage);
    }
  });

  socket.on('send-dm-reply', ({ dmRoomId, text }) => {
    const user = activeSockets[socket.id];
    const msgPayload = {
      dmRoomId,
      sender: user ? user.displayName : "User",
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.emit('dm-message', msgPayload);
  });

  // 9. Fetch Groups List
  socket.on('get-all-groups', () => {
    socket.emit('all-groups-list', Object.values(groups));
  });

  // 10. Disconnect Handling
  socket.on('disconnect', () => {
    const user = activeSockets[socket.id];
    if (user) {
      user.isOnline = false;
      io.to(user.groupId).emit('message', {
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
