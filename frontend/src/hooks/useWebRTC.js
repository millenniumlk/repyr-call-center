/**
 * useWebRTC — Core WebRTC Hook
 *
 * Manages the complete WebRTC lifecycle for both the agent and customer.
 *
 * ─── WebRTC Connection Flow ──────────────────────────────────────────────
 *
 * 1. AGENT calls connect():
 *    - Gets microphone via getUserMedia
 *    - Creates RTCPeerConnection
 *    - Adds local audio track
 *    - Emits call:agent-join so server knows agent is ready
 *
 * 2. CUSTOMER opens page, validates token, then calls accept():
 *    - Connects socket, emits call:join with token
 *    - Gets microphone via getUserMedia
 *    - Waits for SDP offer from agent
 *
 * 3. AGENT receives call:customer-joined (via server):
 *    - Creates SDP offer (contains codec & network info)
 *    - Sets it as local description
 *    - Emits webrtc:offer to server
 *    - Server forwards to customer
 *
 * 4. CUSTOMER receives webrtc:offer:
 *    - Sets it as remote description
 *    - Creates SDP answer
 *    - Sets it as local description
 *    - Emits webrtc:answer to server
 *    - Server forwards to agent
 *
 * 5. AGENT receives webrtc:answer:
 *    - Sets it as remote description
 *    - ICE candidate exchange begins (trickle ICE)
 *
 * 6. ICE candidate exchange:
 *    - Both sides emit webrtc:ice-candidate as candidates are found
 *    - Server forwards each to the other peer
 *    - WebRTC finds the best network path
 *
 * 7. CONNECTION ESTABLISHED:
 *    - ontrack fires on both sides with the remote audio stream
 *    - Audio flows peer-to-peer (not through server)
 *
 * @param {object} params
 * @param {string} params.callId    - The call session ID
 * @param {'agent'|'customer'} params.role - Role of this peer
 * @param {string} [params.token]   - Customer token (required for customer role)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import socket from '../lib/socket';

// ─── ICE server configuration ─────────────────────────────────────────────
/**
 * Build the ICE server config from environment variables.
 * STUN is always included. TURN is only added if configured.
 *
 * In production, use a TURN server for reliability on mobile networks
 * and symmetric NAT. STUN alone works ~80% of the time.
 */
function buildIceServers() {
  const stunUrl = import.meta.env.VITE_STUN_URL || 'stun:stun.l.google.com:19302';
  const servers = [{ urls: stunUrl }];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUser = import.meta.env.VITE_TURN_USERNAME;
  const turnCred = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrl && turnUser && turnCred) {
    servers.push({
      urls: turnUrl,
      username: turnUser,
      credential: turnCred,
    });
  }

  return servers;
}

export function useWebRTC({ callId, role, token }) {
  // ─── State ──────────────────────────────────────────────────────────────
  const [status, setStatus] = useState('idle');           // idle | connecting | connected | ended | failed
  const [connectionState, setConnectionState] = useState('new'); // RTCPeerConnectionState
  const [iceState, setIceState] = useState('new');         // RTCIceConnectionState
  const [iceGatheringState, setIceGatheringState] = useState('new');
  const [signalingState, setSignalingState] = useState('stable');
  const [isMuted, setIsMuted] = useState(false);
  const [localAudioActive, setLocalAudioActive] = useState(false);
  const [remoteAudioActive, setRemoteAudioActive] = useState(false);
  const [error, setError] = useState(null);

  // ─── Refs (don't trigger re-renders) ────────────────────────────────────
  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteAudioEl = useRef(null); // <audio> element for remote audio
  const pendingCandidates = useRef([]);
  const offerCreated = useRef(false);
  const cleanedUp = useRef(false);

  // ─── Create remote audio element ──────────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true; // Important for iOS
    remoteAudioEl.current = audio;

    return () => {
      audio.srcObject = null;
    };
  }, []);

  // ─── Cleanup function ──────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (cleanedUp.current) return;
    cleanedUp.current = true;

    console.log('[WebRTC] Cleaning up...');

    // Stop all local media tracks
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      localStream.current = null;
      setLocalAudioActive(false);
    }

    // Close peer connection
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    // Clear remote audio
    if (remoteAudioEl.current) {
      remoteAudioEl.current.srcObject = null;
    }

    // Remove socket listeners and disconnect
    socket.off('call:customer-joined');
    socket.off('call:ready');
    socket.off('call:accepted');
    socket.off('webrtc:offer');
    socket.off('webrtc:answer');
    socket.off('webrtc:ice-candidate');
    socket.off('call:connected');
    socket.off('call:ended');
    socket.off('call:error');
    socket.off('call:mute');
    socket.disconnect();

    pendingCandidates.current = [];
    offerCreated.current = false;
  }, []);

  // ─── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // ─── Create RTCPeerConnection ──────────────────────────────────────────
  const createPeerConnection = useCallback(() => {
    if (peerConnection.current) return peerConnection.current;

    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(),
      // Bundle policy: use one transport for all media (more efficient)
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    // ── ICE candidate handler ─────────────────────────────────────────
    /**
     * When a new ICE candidate is found, send it to the other peer
     * via the signaling server. This is "trickle ICE" — we send
     * candidates as they're discovered rather than waiting for all.
     */
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:ice-candidate', {
          callId,
          candidate: event.candidate,
        });
      }
    };

    // ── Remote track received ─────────────────────────────────────────
    /**
     * This fires when the remote peer's audio track arrives.
     * We attach it to an Audio element for playback.
     * On mobile, autoplay requires user gesture — this is satisfied
     * because the user tapped "Answer" before we get here.
     */
    pc.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind);
      if (remoteAudioEl.current && event.streams[0]) {
        remoteAudioEl.current.srcObject = event.streams[0];
        setRemoteAudioActive(true);

        // Handle mobile autoplay restrictions
        remoteAudioEl.current.play().catch((err) => {
          console.warn('[WebRTC] Autoplay blocked, trying muted:', err.message);
          // If autoplay is blocked, unmute on first user interaction
          remoteAudioEl.current.muted = false;
          remoteAudioEl.current.play().catch(console.error);
        });
      }
    };

    // ── Connection state changes ──────────────────────────────────────
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[WebRTC] Connection state:', state);
      setConnectionState(state);

      switch (state) {
        case 'connected':
          setStatus('connected');
          socket.emit('call:connected', { callId });
          break;
        case 'disconnected':
          setStatus('reconnecting');
          break;
        case 'failed':
          setError('WebRTC connection failed. This may be a network or TURN issue.');
          setStatus('failed');
          break;
        case 'closed':
          setStatus('ended');
          break;
      }
    };

    // ── ICE connection state changes ──────────────────────────────────
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('[WebRTC] ICE state:', state);
      setIceState(state);

      if (state === 'failed') {
        // Attempt ICE restart
        console.warn('[WebRTC] ICE failed, attempting restart...');
        if (role === 'agent') pc.restartIce();
      }
    };

    // ── ICE gathering state ───────────────────────────────────────────
    pc.onicegatheringstatechange = () => {
      setIceGatheringState(pc.iceGatheringState);
    };

    // ── Signaling state ───────────────────────────────────────────────
    pc.onsignalingstatechange = () => {
      setSignalingState(pc.signalingState);
    };

    peerConnection.current = pc;
    return pc;
  }, [callId, role]);

  // ─── Get user microphone ───────────────────────────────────────────────
  const getMicrophone = useCallback(async () => {
    try {
      /**
       * Request ONLY audio. Never request video — this is a voice call.
       * Echo cancellation, noise suppression, and auto gain are enabled
       * for the best call quality experience.
       */
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStream.current = stream;
      setLocalAudioActive(true);
      console.log('[WebRTC] Microphone acquired');
      return stream;
    } catch (err) {
      let message = 'Microphone access denied.';
      if (err.name === 'NotFoundError') message = 'No microphone found on this device.';
      if (err.name === 'NotAllowedError') message = 'Microphone permission was denied.';
      if (err.name === 'NotReadableError') message = 'Microphone is in use by another app.';
      if (!navigator.mediaDevices) message = 'Your browser does not support microphone access.';

      setError(message);
      throw new Error(message);
    }
  }, []);

  // ─── Add local audio tracks to peer connection ─────────────────────────
  const addLocalTracks = useCallback((pc, stream) => {
    stream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
  }, []);

  // ─── Process pending ICE candidates ───────────────────────────────────
  const flushPendingCandidates = useCallback(async (pc) => {
    for (const candidate of pendingCandidates.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Failed to add queued ICE candidate:', e);
      }
    }
    pendingCandidates.current = [];
  }, []);

  // ─── Register socket event listeners ──────────────────────────────────
  const registerSocketListeners = useCallback(() => {
    // ── For agent: customer joined ──────────────────────────────────────
    socket.on('call:customer-joined', async ({ callId: cid }) => {
      if (cid !== callId || role !== 'agent') return;
      if (offerCreated.current) return; // Prevent duplicate offers
      offerCreated.current = true;

      console.log('[WebRTC] Customer joined — creating SDP offer...');
      setStatus('connecting');

      try {
        const pc = peerConnection.current;
        if (!pc) return;

        /**
         * Create SDP Offer:
         * The offer describes what media we want to send/receive,
         * the codecs we support, and our ICE credentials.
         */
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
        });

        // Set as our local description ("this is what I can do")
        await pc.setLocalDescription(offer);

        // Send the offer to the customer via signaling server
        socket.emit('webrtc:offer', {
          callId,
          sdp: pc.localDescription,
        });

        console.log('[WebRTC] SDP offer sent');
      } catch (err) {
        console.error('[WebRTC] Failed to create offer:', err);
        setError('Failed to create call. Please try again.');
        setStatus('failed');
      }
    });

    // ── For customer: receive SDP offer ────────────────────────────────
    socket.on('webrtc:offer', async ({ callId: cid, sdp }) => {
      if (cid !== callId || role !== 'customer') return;

      console.log('[WebRTC] Received SDP offer from agent');

      try {
        const pc = peerConnection.current;
        if (!pc) return;

        /**
         * Set the agent's offer as the remote description.
         * ("This is what the other side can do")
         */
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Flush any ICE candidates that arrived before the offer
        await flushPendingCandidates(pc);

        /**
         * Create SDP Answer:
         * The answer confirms which codecs and media we'll actually use.
         */
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc:answer', {
          callId,
          sdp: pc.localDescription,
        });

        console.log('[WebRTC] SDP answer sent');
      } catch (err) {
        console.error('[WebRTC] Failed to handle offer:', err);
        setError('Failed to connect. Please try again.');
        setStatus('failed');
      }
    });

    // ── For agent: receive SDP answer ──────────────────────────────────
    socket.on('webrtc:answer', async ({ callId: cid, sdp }) => {
      if (cid !== callId || role !== 'agent') return;

      console.log('[WebRTC] Received SDP answer from customer');

      try {
        const pc = peerConnection.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingCandidates(pc);
        console.log('[WebRTC] Remote description set — ICE negotiation in progress');
      } catch (err) {
        console.error('[WebRTC] Failed to handle answer:', err);
        setError('Connection setup failed.');
        setStatus('failed');
      }
    });

    // ── ICE candidates (both directions) ───────────────────────────────
    socket.on('webrtc:ice-candidate', async ({ callId: cid, candidate }) => {
      if (cid !== callId) return;

      const pc = peerConnection.current;

      /**
       * If we receive an ICE candidate before the remote description is set,
       * queue it and process it once the remote description is available.
       */
      if (!pc || !pc.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Failed to add ICE candidate:', e);
      }
    });

    // ── Call connected ─────────────────────────────────────────────────
    socket.on('call:connected', ({ callId: cid }) => {
      if (cid !== callId) return;
      setStatus('connected');
    });

    // ── Call ended ─────────────────────────────────────────────────────
    socket.on('call:ended', ({ callId: cid, reason }) => {
      if (cid !== callId) return;
      console.log('[WebRTC] Call ended, reason:', reason);
      setStatus('ended');
      cleanup();
    });

    // ── Remote mute state ──────────────────────────────────────────────
    socket.on('call:mute', ({ callId: cid, muted: remoteMuted, role: remoteRole }) => {
      if (cid !== callId) return;
      console.log(`[WebRTC] ${remoteRole} ${remoteMuted ? 'muted' : 'unmuted'}`);
    });

    // ── Errors ─────────────────────────────────────────────────────────
    socket.on('call:error', ({ message }) => {
      console.error('[Socket] Call error:', message);
      setError(message);
    });

    // ── Customer accepted (for agent) ──────────────────────────────────
    socket.on('call:accepted', ({ callId: cid }) => {
      if (cid !== callId || role !== 'agent') return;
      setStatus('customer-answering');
    });
  }, [callId, role, cleanup, flushPendingCandidates]);

  // ─── AGENT: Initialize call (connect and wait for customer) ───────────
  const connect = useCallback(async () => {
    if (role !== 'agent') return;
    cleanedUp.current = false;
    setError(null);
    setStatus('connecting');

    try {
      // 1. Get microphone
      const stream = await getMicrophone();

      // 2. Create peer connection
      const pc = createPeerConnection();

      // 3. Add audio tracks
      addLocalTracks(pc, stream);

      // 4. Connect to signaling server
      socket.connect();

      // 5. Register all event handlers
      registerSocketListeners();

      // 6. Tell server the agent is ready for this call
      socket.once('connect', () => {
        socket.emit('call:agent-join', { callId });
        setStatus('waiting');
      });

      // If socket is already connected
      if (socket.connected) {
        socket.emit('call:agent-join', { callId });
        setStatus('waiting');
      }
    } catch (err) {
      setStatus('failed');
    }
  }, [role, callId, getMicrophone, createPeerConnection, addLocalTracks, registerSocketListeners]);

  // ─── CUSTOMER: Accept the call (after tapping Answer) ─────────────────
  const accept = useCallback(async () => {
    if (role !== 'customer') return;
    cleanedUp.current = false;
    setError(null);
    setStatus('connecting');

    try {
      // 1. Get microphone (user gesture = "Answer" button tap)
      const stream = await getMicrophone();

      // 2. Create peer connection
      const pc = createPeerConnection();

      // 3. Add audio tracks
      addLocalTracks(pc, stream);

      // 4. Connect socket and join call room
      socket.connect();
      registerSocketListeners();

      const joinCall = () => {
        socket.emit('call:join', { token });
        socket.emit('call:accepted', { callId });
      };

      if (socket.connected) {
        joinCall();
      } else {
        socket.once('connect', joinCall);
      }
    } catch (err) {
      setStatus('failed');
    }
  }, [role, callId, token, getMicrophone, createPeerConnection, addLocalTracks, registerSocketListeners]);

  // ─── Hang up ───────────────────────────────────────────────────────────
  const hangup = useCallback(() => {
    socket.emit('call:hangup', { callId });
    setStatus('ended');
    cleanup();
  }, [callId, cleanup]);

  // ─── Mute / Unmute ─────────────────────────────────────────────────────
  const mute = useCallback(() => {
    if (!localStream.current) return;

    const audioTrack = localStream.current.getAudioTracks()[0];
    if (!audioTrack) return;

    const newMuted = !isMuted;
    /**
     * Mute by disabling the track — this is the correct way.
     * Setting enabled = false stops the track from sending audio
     * without stopping the track entirely (no hardware indicator change).
     */
    audioTrack.enabled = !newMuted;
    setIsMuted(newMuted);

    // Sync mute state to the other participant
    socket.emit('call:mute', { callId, muted: newMuted });
  }, [callId, isMuted]);

  return {
    // Actions
    connect,   // Agent: initialize and wait for customer
    accept,    // Customer: accept the call and connect
    hangup,    // Both: hang up
    mute,      // Both: toggle mute

    // State
    status,         // 'idle' | 'connecting' | 'waiting' | 'customer-answering' | 'connected' | 'ended' | 'failed' | 'reconnecting'
    isMuted,
    error,

    // WebRTC diagnostics (for DebugPanel)
    connectionState,
    iceState,
    iceGatheringState,
    signalingState,
    localAudioActive,
    remoteAudioActive,
  };
}
