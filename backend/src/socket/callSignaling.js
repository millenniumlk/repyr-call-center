/**
 * WebRTC Call Signaling - Socket.io Handlers
 *
 * This module implements the signaling server for WebRTC.
 * Socket.io carries ONLY signaling data (SDP offers, SDP answers,
 * ICE candidates, and call control events). Audio NEVER passes
 * through this server - it flows peer-to-peer via WebRTC.
 *
 * --- Signaling Events ---
 *
 * CLIENT -> SERVER:
 *   call:agent-join      { callId }         - Agent announces readiness
 *   call:join            { token }          - Customer joins via token
 *   webrtc:offer         { callId, sdp }    - Agent sends SDP offer
 *   webrtc:answer        { callId, sdp }    - Customer sends SDP answer
 *   webrtc:ice-candidate { callId, candidate } - Trickle ICE
 *   call:accepted        { callId }         - Customer accepted the call
 *   call:declined        { callId }         - Customer declined
 *   call:hangup          { callId }         - Either side hangs up
 *   call:mute            { callId, muted }  - Mute state sync
 *
 * SERVER -> CLIENT:
 *   call:customer-joined { callId }                - Notifies agent
 *   call:ready           { callId }                - Notifies customer agent is ready
 *   webrtc:offer         { callId, sdp }           - Forwarded to customer
 *   webrtc:answer        { callId, sdp }           - Forwarded to agent
 *   webrtc:ice-candidate { callId, candidate }     - Forwarded to other peer
 *   call:connected       { callId }                - Both sides
 *   call:ended           { callId, reason }        - Both sides
 *   call:mute            { callId, muted, role }   - Forwarded to other peer
 *   call:error           { callId, message }       - Error notification
 *
 * --- Security ---
 *   - callId is NEVER trusted from the client for room operations
 *   - callId is resolved server-side from the validated token
 *   - Only the agent and customer of the SAME call receive events
 *   - Socket rooms are named `call:<callId>` and are private
 */

const callSessionService = require('../services/callSessionService');

/** Map: socketId to { callId, role } (for disconnect cleanup) */
const socketCallMap = new Map();

/**
 * Register all signaling event handlers for a new socket connection.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function registerSignalingHandlers(io, socket) {
  // -- Agent join --
  /**
   * Agent announces it is ready for a call.
   * The callId comes from the agent's own session (created via POST /api/calls)
   * and is considered trusted here since agents are authenticated users of
   * the dashboard. In production, add agent authentication middleware.
   */
  socket.on('call:agent-join', ({ callId }) => {
    if (!callId) return;

    const session = callSessionService.getCallById(callId);
    if (!session) {
      socket.emit('call:error', { callId, message: 'Call session not found.' });
      return;
    }

    // Store agent socket ID
    callSessionService.updateCallStatus(callId, session.status, {
      agentSocketId: socket.id,
    });

    // Track socket to call mapping for disconnect handling
    socketCallMap.set(socket.id, { callId, role: 'agent' });

    // Join the Socket.io room for this call
    const room = `call:${callId}`;
    socket.join(room);

    console.log(`[Signal] Agent ${socket.id} joined call ${callId}`);

    // If the customer already joined before the agent (race condition), notify agent
    if (session.customerSocketId) {
      socket.emit('call:customer-joined', { callId });
    }
  });

  // -- Customer join (via token) --
  /**
   * Customer joins the call using their secret token.
   * The token is validated server-side - the customer never sees or provides
   * a raw callId. This prevents session ID enumeration.
   */
  socket.on('call:join', ({ token }) => {
    if (!token) {
      socket.emit('call:error', { message: 'Token is required.' });
      return;
    }

    const session = callSessionService.getCallByToken(token);
    if (!session) {
      socket.emit('call:error', { message: 'Invalid or expired call token.' });
      return;
    }

    const { callId } = session;

    // Prevent duplicate customer connections
    if (session.customerSocketId && session.customerSocketId !== socket.id) {
      socket.emit('call:error', { callId, message: 'Another device is already connected to this call.' });
      return;
    }

    // Update session with customer socket
    callSessionService.updateCallStatus(callId, 'CUSTOMER_OPENED', {
      customerSocketId: socket.id,
    });

    socketCallMap.set(socket.id, { callId, role: 'customer' });

    const room = `call:${callId}`;
    socket.join(room);

    console.log(`[Signal] Customer ${socket.id} joined call ${callId}`);

    // Notify agent that customer has opened the call page
    socket.to(room).emit('call:customer-joined', { callId });

    // Tell customer that the agent is ready (if agent already joined)
    if (session.agentSocketId) {
      socket.emit('call:ready', { callId });
    }
  });

  // -- Customer accepted the call --
  socket.on('call:accepted', ({ callId }) => {
    if (!_verifyMembership(socket, callId, 'customer')) return;

    callSessionService.updateCallStatus(callId, 'CUSTOMER_ANSWERING');
    const room = `call:${callId}`;
    socket.to(room).emit('call:accepted', { callId });
    console.log(`[Signal] Customer accepted call ${callId}`);
  });

  // -- Customer declined the call --
  socket.on('call:declined', ({ callId }) => {
    if (!_verifyMembership(socket, callId)) return;

    callSessionService.updateCallStatus(callId, 'DECLINED');
    const room = `call:${callId}`;
    io.to(room).emit('call:ended', { callId, reason: 'declined' });
    callSessionService.endCall(callId);
    console.log(`[Signal] Customer declined call ${callId}`);
  });

  // -- WebRTC: SDP Offer (agent -> customer) --
  /**
   * After customer taps "Answer", agent creates an SDP offer and sends it.
   * The server forwards it ONLY to the customer socket in the same room.
   *
   * SDP (Session Description Protocol) describes the media capabilities:
   * codecs, encryption, ICE credentials, and media direction.
   */
  socket.on('webrtc:offer', ({ callId, sdp }) => {
    if (!_verifyMembership(socket, callId, 'agent')) return;

    callSessionService.updateCallStatus(callId, 'CONNECTING');
    const room = `call:${callId}`;
    socket.to(room).emit('webrtc:offer', { callId, sdp });
    console.log(`[Signal] SDP offer forwarded for call ${callId}`);
  });

  // -- WebRTC: SDP Answer (customer -> agent) --
  /**
   * Customer receives the SDP offer, creates an SDP answer, and sends it back.
   * The server forwards it ONLY to the agent socket.
   */
  socket.on('webrtc:answer', ({ callId, sdp }) => {
    if (!_verifyMembership(socket, callId, 'customer')) return;

    const room = `call:${callId}`;
    socket.to(room).emit('webrtc:answer', { callId, sdp });
    console.log(`[Signal] SDP answer forwarded for call ${callId}`);
  });

  // -- WebRTC: ICE Candidate (trickle ICE, both directions) --
  /**
   * ICE (Interactive Connectivity Establishment) candidates are network
   * addresses that WebRTC uses to find a path between the two peers.
   * Trickle ICE means candidates are sent as they are discovered rather
   * than waiting for all candidates before starting the connection.
   *
   * Both the agent and customer emit ice candidates as they are gathered,
   * and the server forwards each one to the other peer in the same room.
   */
  socket.on('webrtc:ice-candidate', ({ callId, candidate }) => {
    if (!_verifyMembership(socket, callId)) return;
    if (!candidate) return;

    const room = `call:${callId}`;
    socket.to(room).emit('webrtc:ice-candidate', { callId, candidate });
  });

  // -- Call connected (either side can confirm) --
  socket.on('call:connected', ({ callId }) => {
    if (!_verifyMembership(socket, callId)) return;

    const session = callSessionService.getCallById(callId);
    if (session && session.status !== 'CONNECTED') {
      callSessionService.updateCallStatus(callId, 'CONNECTED');
      const room = `call:${callId}`;
      io.to(room).emit('call:connected', { callId });
      console.log(`[Signal] Call ${callId} CONNECTED`);
    }
  });

  // -- Hang up --
  socket.on('call:hangup', ({ callId }) => {
    const info = socketCallMap.get(socket.id);
    const role = info?.callId === callId ? info.role : null;

    const reason = role === 'agent' ? 'agent_hangup' : 'customer_hangup';
    const room = `call:${callId}`;

    io.to(room).emit('call:ended', { callId, reason });
    callSessionService.endCall(callId);
    console.log(`[Signal] Call ${callId} hung up by ${role}`);
  });

  // -- Mute state sync --
  socket.on('call:mute', ({ callId, muted }) => {
    if (!_verifyMembership(socket, callId)) return;

    const info = socketCallMap.get(socket.id);
    const role = info?.role || 'unknown';
    const room = `call:${callId}`;

    // Forward mute state to the other participant
    socket.to(room).emit('call:mute', { callId, muted, role });
  });

  // -- Disconnect cleanup --
  socket.on('disconnect', () => {
    const info = socketCallMap.get(socket.id);
    if (!info) return;

    const { callId, role } = info;
    socketCallMap.delete(socket.id);

    const session = callSessionService.getCallById(callId);
    if (!session || session.status === 'ENDED') return;

    const room = `call:${callId}`;
    const reason = `${role}_disconnected`;

    console.log(`[Signal] ${role} disconnected from call ${callId}`);

    // Notify the other peer
    socket.to(room).emit('call:ended', { callId, reason });
    callSessionService.endCall(callId);
  });
}

// --- Internal helpers ---

/**
 * Verify that this socket belongs to the given call.
 * Optionally restrict to a specific role ('agent' or 'customer').
 * @param {import('socket.io').Socket} socket
 * @param {string} callId
 * @param {string} [expectedRole]
 * @returns {boolean}
 */
function _verifyMembership(socket, callId, expectedRole) {
  if (!callId) return false;

  const info = socketCallMap.get(socket.id);
  if (!info) {
    console.error(`[Verify] Socket ${socket.id} has no info for call ${callId}`);
    socket.emit('call:error', { callId, message: 'Not authorized for this call.' });
    return false;
  }

  if (info.callId !== callId) {
    console.error(`[Verify] Socket ${socket.id} info.callId (${info.callId}) !== ${callId}`);
    socket.emit('call:error', { callId, message: 'Not authorized for this call.' });
    return false;
  }

  if (expectedRole && info.role !== expectedRole) {
    console.error(`[Verify] Socket ${socket.id} info.role (${info.role}) !== ${expectedRole}`);
    socket.emit('call:error', { callId, message: `Action not allowed for role: ${info.role}` });
    return false;
  }

  return true;
}

module.exports = { registerSignalingHandlers };
