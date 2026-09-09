/**
 * Repyr WebRTC Call Center — Main Server
 *
 * Responsibilities:
 *  - Express HTTP API (call session management)
 *  - Socket.io WebSocket server (WebRTC signaling)
 *  - CORS configuration
 *  - Rate limiting
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const cors = require('cors');

const callRoutes = require('./src/routes/calls');
const { registerSignalingHandlers } = require('./src/socket/callSignaling');

process.on('uncaughtException', (err) => console.error('[Global] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('[Global] Unhandled Rejection:', reason));

const app = express();
app.set('trust proxy', 1); // Trust first proxy (localtunnel)
const httpServer = http.createServer(app);

// --- CORS ---
app.use(
  cors({
    origin: true, // Reflect the request origin (allow all in dev)
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  })
);

// --- Body parsing ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- HTTP Routes ---
app.use('/api/calls', callRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// --- Socket.io ---
const io = new SocketServer(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Prefer WebSocket transport
  transports: ['websocket', 'polling'],
});

// Attach signaling handlers to every new socket connection
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);
  registerSignalingHandlers(io, socket);

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} — ${reason}`);
  });
});

// --- Start ---
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Repyr Call Center Backend`);
  console.log(`   HTTP  : http://localhost:${PORT}`);
  console.log(`   WS    : ws://localhost:${PORT}`);
  console.log(`   CORS  : All origins allowed (dev mode)`);
  console.log();
});

module.exports = { app, io };
