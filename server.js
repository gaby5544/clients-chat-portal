require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const { initStore } = require('./db');
const { registerSocketHandlers } = require('./socketHandlers');
const { buildRouter } = require('./routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
  maxHttpBufferSize: 2 * 1024 * 1024 // 2MB cap on socket payloads (files go through /api/upload instead)
});

// Basic hardening
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Global light rate limit on all HTTP traffic (Socket.IO handshake included,
// since it rides over HTTP first).
app.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // HTML/JS/CSS must always be revalidated — this app is actively updated,
    // and a stale cached app.js after a redeploy causes exactly the kind of
    // "half the features silently don't work" symptom this project has hit
    // before. Uploaded user files (served separately in routes.js) are fine
    // to cache normally since they're immutable once created.
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use(buildRouter());

io.on('connection', (socket) => registerSocketHandlers(io, socket));

const PORT = process.env.PORT || 3000;

initStore()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Quantum Secure Transaction Desk running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize data store:', err);
    process.exit(1);
  });

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
