import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC';
import { validateToken } from '../services/api';
import RepyrLogo from '../components/RepyrLogo';
import DebugPanel from '../components/DebugPanel';
import Button from '../components/ui/Button';
import socket from '../lib/socket';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Customer Call Page — /c/:token
 *
 * This is the mobile-first customer-facing call experience.
 * The customer arrives here by tapping the WhatsApp invitation button.
 *
 * States:
 *   loading    → Validating the token with the backend
 *   invalid    → Token expired or not found
 *   incoming   → Valid token, showing incoming call UI (Answer / Decline)
 *   connecting → Customer tapped Answer, WebRTC negotiating
 *   connected  → Audio connected, showing live call UI
 *   ended      → Call ended by either side
 *   failed     → WebRTC connection failed
 */
export default function CustomerCall() {
  const { token } = useParams();

  // ─── Token validation state ──────────────────────────────────────────────
  const [tokenState, setTokenState] = useState('loading');
  const [callInfo, setCallInfo] = useState(null);

  // ─── Duration timer ──────────────────────────────────────────────────────
  const [duration, setDuration] = useState(0);
  const durationTimer = useRef(null);

  // ─── WebRTC hook ─────────────────────────────────────────────────────────
  const rtc = useWebRTC({
    callId: callInfo?.callId,
    role: 'customer',
    token,
  });

  // ─── Validate token on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setTokenState('invalid');
      return;
    }

    validateToken(token)
      .then((data) => {
        if (data.valid) {
          setCallInfo(data);
          setTokenState('valid');
        } else {
          setTokenState('invalid');
        }
      })
      .catch(() => setTokenState('invalid'));
  }, [token]);

  // ─── Duration timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (rtc.status === 'connected') {
      durationTimer.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      clearInterval(durationTimer.current);
    }
    return () => clearInterval(durationTimer.current);
  }, [rtc.status]);

  // ─── Decline handler ─────────────────────────────────────────────────────
  const handleDecline = useCallback(() => {
    if (callInfo?.callId && socket.connected) {
      socket.emit('call:declined', { callId: callInfo.callId });
    }
    setTokenState('invalid'); // Show expired screen as a declined state
  }, [callInfo]);

  // ─── LOADING ─────────────────────────────────────────────────────────────
  if (tokenState === 'loading') {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-repyr-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">Verifying invitation…</p>
        </div>
      </Screen>
    );
  }

  // ─── INVALID / EXPIRED TOKEN ─────────────────────────────────────────────
  if (tokenState === 'invalid') {
    return (
      <Screen>
        <div className="text-center animate-fade-in max-w-xs">
          <div className="w-20 h-20 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-4xl mx-auto mb-6">
            ⏱
          </div>
          <h2 className="text-2xl font-bold mb-3">Invitation Expired</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            This call invitation is no longer valid or has been declined.
            Please ask your Repyr agent to send a new invitation.
          </p>
        </div>
      </Screen>
    );
  }

  // ─── CALL ENDED ──────────────────────────────────────────────────────────
  if (rtc.status === 'ended') {
    return (
      <Screen>
        <div className="text-center animate-fade-in max-w-xs">
          <div className="w-20 h-20 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-4xl mx-auto mb-6">
            📵
          </div>
          <h2 className="text-2xl font-bold mb-2">Call Ended</h2>
          <p className="text-slate-400 text-sm mb-2">
            {duration > 0 ? formatDuration(duration) + ' · ' : ''}Thank you for contacting Repyr
          </p>
          <p className="text-slate-600 text-xs mb-8">You may close this window.</p>
          <Button variant="ghost" onClick={() => window.close()}>
            Close
          </Button>
        </div>
      </Screen>
    );
  }

  // ─── CONNECTION FAILED ───────────────────────────────────────────────────
  if (rtc.status === 'failed') {
    return (
      <Screen>
        <div className="text-center animate-fade-in max-w-xs">
          <div className="w-20 h-20 rounded-full bg-red-900/30 border border-red-800 flex items-center justify-center text-4xl mx-auto mb-6">
            ⚠
          </div>
          <h2 className="text-2xl font-bold mb-3">Unable to Connect</h2>
          <p className="text-slate-400 text-sm max-w-xs leading-relaxed mb-6">
            {rtc.error || 'A network error prevented the call from connecting. This may be a firewall or microphone issue.'}
          </p>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </Screen>
    );
  }

  // ─── CONNECTED — Active call UI ──────────────────────────────────────────
  if (rtc.status === 'connected') {
    return (
      <Screen dark>
        <div className="flex flex-col items-center animate-fade-in w-full max-w-sm">
          {/* Logo */}
          <div className="mb-10">
            <RepyrLogo size="md" />
          </div>

          {/* Caller avatar */}
          <div className="relative mb-6">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-repyr-600 to-repyr-800 flex items-center justify-center text-5xl font-black text-white shadow-2xl">
              R
            </div>
            {/* Active call indicator */}
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full border-2 border-slate-950" />
          </div>

          <h2 className="text-2xl font-bold">Repyr Support</h2>
          <p className="text-green-400 font-mono text-4xl font-bold mt-3 mb-12 tabular-nums">
            {formatDuration(duration)}
          </p>

          {/* Controls */}
          <div className="flex items-end justify-center gap-10">
            {/* Mute */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={rtc.mute}
                className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl transition-all active:scale-95 ${
                  rtc.isMuted
                    ? 'bg-white/25 ring-2 ring-white/40'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                {rtc.isMuted ? '🔇' : '🔊'}
              </button>
              <span className="text-xs text-slate-400">
                {rtc.isMuted ? 'Unmute' : 'Mute'}
              </span>
            </div>

            {/* Hang up */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={rtc.hangup}
                className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-3xl transition-all active:scale-95 shadow-lg shadow-red-900"
              >
                📵
              </button>
              <span className="text-xs text-slate-400">End Call</span>
            </div>
          </div>
        </div>

        <DebugPanel callId={callInfo?.callId} socketId={socket.id} role="customer" rtc={rtc} />
      </Screen>
    );
  }

  // ─── CONNECTING ───────────────────────────────────────────────────────────
  if (rtc.status === 'connecting' || rtc.status === 'reconnecting') {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-6 animate-fade-in">
          <RepyrLogo size="md" />

          <div className="mt-6 relative">
            <div className="w-12 h-12 border-2 border-repyr-500 border-t-transparent rounded-full animate-spin" />
          </div>

          <div className="text-center">
            <p className="text-slate-200 text-lg font-medium">Connecting…</p>
            <p className="text-slate-500 text-sm mt-1">Setting up your secure audio channel</p>
          </div>

          {rtc.error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm text-center max-w-xs">
              {rtc.error}
            </div>
          )}
        </div>
      </Screen>
    );
  }

  // ─── INCOMING CALL (default state after token validated) ─────────────────
  return (
    <Screen>
      <div className="flex flex-col items-center w-full max-w-sm animate-fade-in">
        {/* Logo + tagline */}
        <div className="mb-1">
          <RepyrLogo size="md" />
        </div>
        <p className="text-slate-600 text-xs mb-12 tracking-widest uppercase">
          Vehicle Diagnostics
        </p>

        {/* Ringing animation */}
        <div className="relative mb-10 flex items-center justify-center">
          {/* Pulse rings */}
          <div
            className="absolute rounded-full border border-repyr-500/25 animate-ping"
            style={{ width: 192, height: 192, animationDuration: '2s' }}
          />
          <div
            className="absolute rounded-full border border-repyr-500/15 animate-ping"
            style={{ width: 240, height: 240, animationDuration: '2.5s', animationDelay: '0.4s' }}
          />

          {/* Avatar */}
          <div className="relative w-36 h-36 rounded-full bg-gradient-to-br from-repyr-600 to-repyr-800 flex items-center justify-center text-6xl font-black text-white shadow-2xl shadow-repyr-900/50 z-10">
            R
          </div>
        </div>

        {/* Caller info */}
        <p className="text-xs text-slate-500 tracking-widest uppercase mb-1">
          Incoming Call
        </p>
        <h2 className="text-3xl font-bold mb-1">
          {callInfo?.callerName || 'Repyr'}
        </h2>
        <p className="text-slate-400 text-sm mb-1">Customer Support</p>
        <p className="text-slate-600 text-xs font-mono mb-10">
          {callInfo?.customerPhoneMasked}
        </p>

        {/* Error message */}
        {rtc.error && (
          <div className="mb-6 p-3 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm text-center max-w-xs">
            {rtc.error}
          </div>
        )}

        {/* Browser support warning */}
        {!navigator.mediaDevices && (
          <div className="mb-6 p-3 bg-orange-900/30 border border-orange-800 rounded-xl text-orange-300 text-xs text-center max-w-xs">
            ⚠ Your browser may not support audio calls. Please use Chrome or Safari.
          </div>
        )}

        {/* Answer / Decline */}
        <div className="flex items-center justify-between w-full max-w-xs">
          {/* Decline */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleDecline}
              className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-3xl transition-all active:scale-95 shadow-lg shadow-red-900/50"
            >
              📵
            </button>
            <span className="text-sm text-slate-400">Decline</span>
          </div>

          {/* Answer */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={rtc.accept}
              className="w-20 h-20 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center text-3xl transition-all active:scale-95 shadow-lg shadow-green-900/50 animate-pulse"
              style={{ animationDuration: '1.5s' }}
            >
              📞
            </button>
            <span className="text-sm text-slate-400">Answer</span>
          </div>
        </div>

        <p className="mt-12 text-xs text-slate-700 text-center max-w-xs">
          Repyr will request microphone access when you answer. This is a browser-based audio call — no app required.
        </p>
      </div>

      <DebugPanel callId={callInfo?.callId} socketId={socket.id} role="customer" rtc={rtc} />
    </Screen>
  );
}

/**
 * Full-height centered layout for the customer call page.
 * Optimized for mobile: 375px – 430px width.
 */
function Screen({ children, dark = false }) {
  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-center px-6 py-12 ${
        dark
          ? 'bg-slate-950'
          : 'bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950'
      }`}
    >
      {children}
    </div>
  );
}
