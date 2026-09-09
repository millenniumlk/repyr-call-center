/**
 * Socket.io Client Singleton
 *
 * We create a single Socket.io client instance that is reused across
 * the entire application. This prevents multiple connections from being
 * established when components mount/unmount.
 *
 * The socket does NOT auto-connect on import. It connects only when
 * socket.connect() is explicitly called (usually in useWebRTC hook).
 */

import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

/** @type {import('socket.io-client').Socket} */
const socket = io(SOCKET_URL, {
  // Don't auto-connect — we control connection timing
  autoConnect: false,
  // Prefer WebSocket ONLY to prevent transport upgrade disconnects on proxy tunnels
  transports: ['websocket'],
  // Reconnection settings
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  extraHeaders: {
    'Bypass-Tunnel-Reminder': 'true'
  }
});

// Development logging
if (import.meta.env.DEV) {
  socket.on('connect', () => console.log('[Socket] Connected:', socket.id));
  socket.on('disconnect', (reason) => console.log('[Socket] Disconnected:', reason));
  socket.on('connect_error', (err) => console.error('[Socket] Error:', err.message));
}

export default socket;
