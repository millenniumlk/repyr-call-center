import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { createCall } from '../services/api';
import RepyrLogo from '../components/RepyrLogo';
import CallStatusBadge from '../components/CallStatusBadge';
import DebugPanel from '../components/DebugPanel';
import WhatsAppPanel from '../components/WhatsAppPanel';
import Button from '../components/ui/Button';
import socket from '../lib/socket';

// Status label mapping for the WebRTC hook status
const STATUS_LABELS = {
  idle:                 'Ready',
  creating:             'Creating call…',
  waiting:              'Waiting for customer…',
  'customer-answering': 'Customer answering…',
  connecting:           'Connecting…',
  connected:            'Connected',
  ended:                'Call ended',
  failed:               'Connection failed',
  reconnecting:         'Reconnecting…',
};

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function AgentDashboard() {
  // ─── Form state ─────────────────────────────────────────────────────────
  const [phoneInput, setPhoneInput] = useState('+971');
  const [phoneError, setPhoneError] = useState('');

  // ─── Session state ───────────────────────────────────────────────────────
  const [callId, setCallId] = useState(null);
  const [callUrl, setCallUrl] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('idle');
  const [isMockMode, setIsMockMode] = useState(false);
  const [apiError, setApiError] = useState('');
  const [activeNav, setActiveNav] = useState('dashboard');

  // ─── Call duration ───────────────────────────────────────────────────────
  const [duration, setDuration] = useState(0);
  const durationTimer = useRef(null);

  // ─── WebRTC hook ─────────────────────────────────────────────────────────
  const rtc = useWebRTC({ callId, role: 'agent' });

  // ─── Phone validation ────────────────────────────────────────────────────
  const validatePhone = (val) => {
    if (!val.trim()) return 'Phone number is required.';
    if (!/^\+[1-9]\d{6,14}$/.test(val.trim())) return 'Use E.164 format: +971501234567';
    return '';
  };

  // ─── Initiate Call ───────────────────────────────────────────────────────
  const handleCallCustomer = useCallback(async () => {
    const err = validatePhone(phoneInput);
    if (err) { setPhoneError(err); return; }
    setPhoneError('');
    setApiError('');
    setSessionStatus('CREATED');

    try {
      // 1. Create call session on backend (sends WhatsApp or mocks)
      const data = await createCall(phoneInput.trim(), window.location.origin);
      setCallId(data.callId);
      setCallUrl(data.callUrl);
      setIsMockMode(data.mock);
      setSessionStatus('INVITATION_SENT');

      // 2. Start WebRTC connection
      await rtc.connect(data.callId);
      setSessionStatus('WAITING');
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create call.';
      setApiError(msg);
      setSessionStatus('idle');
    }
  }, [phoneInput, rtc]);

  // ─── Sync session status from socket events ──────────────────────────────
  useEffect(() => {
    const onCustomerJoined = () => setSessionStatus('CUSTOMER_OPENED');
    const onAccepted = () => setSessionStatus('CUSTOMER_ANSWERING');
    const onConnected = () => setSessionStatus('CONNECTED');
    const onEnded = () => setSessionStatus('ENDED');

    socket.on('call:customer-joined', onCustomerJoined);
    socket.on('call:accepted', onAccepted);
    socket.on('call:connected', onConnected);
    socket.on('call:ended', onEnded);

    return () => {
      socket.off('call:customer-joined', onCustomerJoined);
      socket.off('call:accepted', onAccepted);
      socket.off('call:connected', onConnected);
      socket.off('call:ended', onEnded);
    };
  }, []);

  // ─── Duration timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (rtc.status === 'connected') {
      durationTimer.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      clearInterval(durationTimer.current);
    }
    return () => clearInterval(durationTimer.current);
  }, [rtc.status]);

  const isCallActive = ['connecting', 'waiting', 'customer-answering', 'connected', 'reconnecting'].includes(rtc.status);
  const isConnected = rtc.status === 'connected';
  const isEnded = rtc.status === 'ended';

  // ─── New call reset ──────────────────────────────────────────────────────
  const handleNewCall = () => {
    setSessionStatus('idle');
    setCallId(null);
    setCallUrl(null);
    setDuration(0);
    setApiError('');
    setPhoneInput('+971');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <RepyrLogo size="md" />
          <p className="text-slate-500 text-xs mt-1">Agent Portal</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {[
            { id: 'dashboard', icon: '⊞', label: 'Dashboard' },
            { id: 'calls',     icon: '☎', label: 'Calls' },
            { id: 'settings',  icon: '⚙', label: 'Settings' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeNav === item.id
                  ? 'bg-repyr-600/20 text-repyr-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-repyr-600 flex items-center justify-center text-sm font-bold">
              A
            </div>
            <div>
              <p className="text-sm font-medium">Agent</p>
              <p className="text-xs text-slate-500">Support Rep</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Center: Call Panel ─────────────────────────────────────────────── */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-xl mx-auto">
          <h1 className="text-2xl font-bold mb-1">Call Center</h1>
          <p className="text-slate-500 mb-8">
            Initiate a WebRTC audio call to a customer via WhatsApp invitation.
          </p>

          {/* ── Call Form ─────────────────────────────────────────────────── */}
          {!isCallActive && !isEnded && (
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 mb-6 animate-fade-in">
              <h2 className="text-lg font-semibold mb-4">New Call</h2>

              <div className="mb-4">
                <label className="block text-sm text-slate-400 mb-2">
                  Customer Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value);
                    setPhoneError('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCallCustomer()}
                  placeholder="+971501234567"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-repyr-500 focus:ring-1 focus:ring-repyr-500 font-mono text-lg"
                />
                {phoneError && (
                  <p className="text-red-400 text-xs mt-1">{phoneError}</p>
                )}
              </div>

              {apiError && (
                <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
                  {apiError}
                </div>
              )}

              <Button
                variant="primary"
                size="lg"
                onClick={handleCallCustomer}
                className="w-full"
                disabled={sessionStatus !== 'idle'}
              >
                ☎ Call Customer
              </Button>
            </div>
          )}

          {/* ── Active Call Panel ──────────────────────────────────────────── */}
          {(isCallActive || isEnded) && (
            <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden mb-6 animate-fade-in">
              {/* Status header */}
              <div className="bg-slate-800 px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Customer</p>
                  <p className="text-lg font-mono font-semibold">{phoneInput}</p>
                </div>
                <CallStatusBadge status={sessionStatus} />
              </div>

              <div className="px-6 py-5">
                {/* Status */}
                <div className="mb-6">
                  <p className="text-sm text-slate-400">Status</p>
                  <p className="text-xl font-semibold mt-1">
                    {STATUS_LABELS[rtc.status] || rtc.status}
                  </p>
                  {isConnected && (
                    <p className="text-3xl font-mono font-bold text-green-400 mt-2">
                      {formatDuration(duration)}
                    </p>
                  )}
                </div>

                {/* Error display */}
                {rtc.error && (
                  <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
                    {rtc.error}
                  </div>
                )}

                {/* Mock mode: open customer URL manually */}
                {isMockMode && callUrl && !isEnded && (
                  <div className="mb-5 p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-xl">
                    <p className="text-yellow-400 text-xs font-semibold mb-1">
                      🧪 MOCK MODE — WhatsApp not sent
                    </p>
                    <p className="text-xs text-slate-400 mb-3">
                      Open this URL in another browser tab or on a second device to simulate the customer:
                    </p>
                    <p className="text-xs font-mono text-slate-300 bg-slate-800 p-2 rounded-lg break-all mb-3">
                      {callUrl}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(callUrl, '_blank')}
                    >
                      Open Customer Call ↗
                    </Button>
                  </div>
                )}

                {/* Call controls */}
                {isCallActive && (
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      variant={rtc.isMuted ? 'outline' : 'ghost'}
                      size="md"
                      onClick={rtc.mute}
                    >
                      {rtc.isMuted ? '🔇 Unmute' : '🔊 Mute'}
                    </Button>
                    <Button
                      variant="danger"
                      size="md"
                      onClick={rtc.hangup}
                    >
                      ✕ Hang Up
                    </Button>
                  </div>
                )}

                {/* After call ended */}
                {isEnded && (
                  <div className="text-center py-4">
                    <p className="text-slate-400 mb-4">
                      Call ended · {formatDuration(duration)}
                    </p>
                    <Button variant="primary" onClick={handleNewCall}>
                      + New Call
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Right Panel: Technical Status ───────────────────────────────────── */}
      <aside className="w-80 bg-slate-900 border-l border-slate-800 p-6 shrink-0 hidden lg:block overflow-y-auto">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          Connection Details
        </h2>

        <div className="space-y-3">
          {[
            { label: 'Call ID',       value: callId ? callId.slice(0, 8) + '…' : '—' },
            { label: 'Call URL',      value: callUrl ? 'Generated ✓' : '—' },
            { label: 'Microphone',    value: rtc.localAudioActive ? '🟢 Active' : '⭕ Inactive' },
            { label: 'Remote Audio',  value: rtc.remoteAudioActive ? '🟢 Active' : '⭕ Inactive' },
            { label: 'ICE State',     value: rtc.iceState },
            { label: 'Connection',    value: rtc.connectionState },
            { label: 'Signaling',     value: rtc.signalingState },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-slate-500">{label}</span>
              <span className="text-slate-300 font-mono text-right">{value}</span>
            </div>
          ))}
        </div>

        {/* Informational callout */}
        <div className="mt-6 p-4 bg-slate-800 rounded-xl">
          <p className="text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-300">How it works:</strong> Your browser establishes
            a direct peer-to-peer audio connection with the customer's browser via WebRTC.
            Audio never passes through the server — only signaling data does.
          </p>
        </div>
      </aside>

      {/* ── Dev Debug Panel ─────────────────────────────────────────────────── */}
      <DebugPanel
        callId={callId}
        socketId={socket.id}
        role="agent"
        rtc={rtc}
      />
    </div>
  );
}
