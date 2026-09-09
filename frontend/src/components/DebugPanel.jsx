import React, { useState } from 'react';

/**
 * Developer diagnostics panel — only visible in development mode.
 * Shows real-time WebRTC state information useful for debugging.
 */
export default function DebugPanel({ callId, socketId, role, rtc }) {
  const [collapsed, setCollapsed] = useState(false);

  // Only render in development
  if (!import.meta.env.DEV) return null;

  const rows = [
    ['Call ID', callId || '\u2014'],
    ['Socket ID', socketId || '\u2014'],
    ['Role', role || '\u2014'],
    ['\u2500\u2500\u2500\u2500\u2500', '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'],
    ['Hook Status', rtc?.status || '\u2014'],
    ['Connection', rtc?.connectionState || '\u2014'],
    ['ICE State', rtc?.iceState || '\u2014'],
    ['ICE Gathering', rtc?.iceGatheringState || '\u2014'],
    ['Signaling', rtc?.signalingState || '\u2014'],
    ['\u2500\u2500\u2500\u2500\u2500', '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'],
    ['Local Audio', rtc?.localAudioActive ? '\uD83D\uDFE2 Active' : '\u2B55 Inactive'],
    ['Remote Audio', rtc?.remoteAudioActive ? '\uD83D\uDFE2 Active' : '\u2B55 Inactive'],
    ['Muted', rtc?.isMuted ? '\uD83D\uDD07 Yes' : '\uD83D\uDD0A No'],
  ];

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl text-xs font-mono overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 bg-slate-800 cursor-pointer"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="text-yellow-400 font-bold">\uD83D\uDEE0 Debug Panel</span>
        <span className="text-slate-400">{collapsed ? '\u25B2' : '\u25BC'}</span>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-1">
          {rows.map(([key, val], i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="text-slate-500 shrink-0">{key}</span>
              <span className="text-slate-200 text-right truncate">{val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
