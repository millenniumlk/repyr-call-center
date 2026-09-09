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
  const [status, setStatus] = useState('idle');
  const [connectionState, setConnectionState] = useState('new');
  const [iceState, setIceState] = useState('new');
  const [iceGatheringState, setIceGatheringState] = useState('new');
  const [signalingState, setSignalingState] = useState('stable');
  const [isMuted, setIsMuted] = useState(false);
  const [localAudioActive, setLocalAudioActive] = useState(false);
  const [remoteAudioActive, setRemoteAudioActive] = useState(false);
  const [error, setError] = useState(null);

  // ─── Refs (don't trigger re-renders) ────────────────────────────────────
  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteAudioEl = useRef(null);
  const pendingCandidates = useRef([]);
  const offerCreated = useRef(false);
  const cleanedUp = useRef(false);

  // *** THE KEY FIX: Store callId in a ref so closures always see the latest value ***
  const callIdRef = useRef(callId);

  // Keep callIdRef in sync whenever the prop changes
  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  // ─── Create remote audio element ──────────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;
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

    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      localStream.current = null;
      setLocalAudioActive(false);
    }

    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    if (remoteAudioEl.current) {
      remoteAudioEl.current.srcObject = null;
    }

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
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    // ── ICE candidate handler ─────────────────────────────────────────
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] Sending ICE candidate');
        socket.emit('webrtc:ice-candidate', {
          callId: callIdRef.current,  // Always use ref
          candidate: event.candidate,
        });
      }
    };

    // ── Remote track received ─────────────────────────────────────────
    pc.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind);
      if (remoteAudioEl.current && event.streams[0]) {
        remoteAudioEl.current.srcObject = event.streams[0];
        setRemoteAudioActive(true);

        remoteAudioEl.current.play().catch((err) => {
          console.warn('[WebRTC] Autoplay blocked:', err.message);
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
          socket.emit('call:connected', { callId: callIdRef.current });
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
  }, [role]); // Removed callId dependency — we use callIdRef instead

  // ─── Get user microphone ───────────────────────────────────────────────
  const getMicrophone = useCallback(async () => {
    try {
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
  // ALL event handlers use callIdRef.current so they always see the latest callId
  const registerSocketListeners = useCallback(() => {
    // ── For agent: customer joined ──────────────────────────────────────
    socket.on('call:customer-joined', async ({ callId: cid }) => {
      const currentCallId = callIdRef.current;
      console.log(`[WebRTC] call:customer-joined received. cid=${cid}, currentCallId=${currentCallId}, role=${role}`);
      if (cid !== currentCallId || role !== 'agent') return;
      if (offerCreated.current) return;
      offerCreated.current = true;

      console.log('[WebRTC] Customer joined — creating SDP offer...');
      setStatus('connecting');

      try {
        const pc = peerConnection.current;
        if (!pc) {
          console.error('[WebRTC] No peer connection available!');
          return;
        }

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
        });

        await pc.setLocalDescription(offer);

        socket.emit('webrtc:offer', {
          callId: currentCallId,
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
      const currentCallId = callIdRef.current;
      console.log(`[WebRTC] webrtc:offer received. cid=${cid}, currentCallId=${currentCallId}, role=${role}`);
      if (cid !== currentCallId || role !== 'customer') return;

      console.log('[WebRTC] Received SDP offer from agent');

      try {
        const pc = peerConnection.current;
        if (!pc) return;

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingCandidates(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc:answer', {
          callId: currentCallId,
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
      const currentCallId = callIdRef.current;
      if (cid !== currentCallId || role !== 'agent') return;

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
      if (cid !== callIdRef.current) return;

      const pc = peerConnection.current;

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
      if (cid !== callIdRef.current) return;
      setStatus('connected');
    });

    // ── Call ended ─────────────────────────────────────────────────────
    socket.on('call:ended', ({ callId: cid, reason }) => {
      if (cid !== callIdRef.current) return;
      console.log('[WebRTC] Call ended, reason:', reason);
      setStatus('ended');
      cleanup();
    });

    // ── Remote mute state ──────────────────────────────────────────────
    socket.on('call:mute', ({ callId: cid, muted: remoteMuted, role: remoteRole }) => {
      if (cid !== callIdRef.current) return;
      console.log(`[WebRTC] ${remoteRole} ${remoteMuted ? 'muted' : 'unmuted'}`);
    });

    // ── Errors ─────────────────────────────────────────────────────────
    socket.on('call:error', ({ message }) => {
      console.error('[Socket] Call error:', message);
      setError(message);
    });

    // ── Customer accepted (for agent) ──────────────────────────────────
    socket.on('call:accepted', ({ callId: cid }) => {
      if (cid !== callIdRef.current || role !== 'agent') return;
      setStatus('customer-answering');
    });
  }, [role, cleanup, flushPendingCandidates]); // Removed callId — we use callIdRef

  // ─── AGENT: Initialize call (connect and wait for customer) ───────────
  const connect = useCallback(async (explicitCallId = null) => {
    const activeCallId = explicitCallId || callIdRef.current;
    if (role !== 'agent' || !activeCallId) return;

    // *** Set the ref IMMEDIATELY so all closures see it ***
    callIdRef.current = activeCallId;

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
      const joinRoom = () => {
        console.log(`[WebRTC] Agent joining room for call ${activeCallId}`);
        socket.emit('call:agent-join', { callId: activeCallId });
        setStatus('waiting');
      };

      if (socket.connected) {
        joinRoom();
      } else {
        socket.once('connect', joinRoom);
      }
    } catch (err) {
      console.error('[WebRTC] connect() failed:', err);
      setStatus('failed');
    }
  }, [role, getMicrophone, createPeerConnection, addLocalTracks, registerSocketListeners]);

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
        console.log(`[WebRTC] Customer joining with token, callId=${callIdRef.current}`);
        socket.emit('call:join', { token });
        socket.emit('call:accepted', { callId: callIdRef.current });
      };

      if (socket.connected) {
        joinCall();
      } else {
        socket.once('connect', joinCall);
      }
    } catch (err) {
      console.error('[WebRTC] accept() failed:', err);
      setStatus('failed');
    }
  }, [role, token, getMicrophone, createPeerConnection, addLocalTracks, registerSocketListeners]);

  // ─── Hang up ───────────────────────────────────────────────────────────
  const hangup = useCallback(() => {
    socket.emit('call:hangup', { callId: callIdRef.current });
    setStatus('ended');
    cleanup();
  }, [cleanup]);

  // ─── Mute / Unmute ─────────────────────────────────────────────────────
  const mute = useCallback(() => {
    if (!localStream.current) return;

    const audioTrack = localStream.current.getAudioTracks()[0];
    if (!audioTrack) return;

    const newMuted = !isMuted;
    audioTrack.enabled = !newMuted;
    setIsMuted(newMuted);

    socket.emit('call:mute', { callId: callIdRef.current, muted: newMuted });
  }, [isMuted]);

  return {
    // Actions
    connect,
    accept,
    hangup,
    mute,

    // State
    status,
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
