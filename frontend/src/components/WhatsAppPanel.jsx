/**
 * WhatsApp Connection Panel
 *
 * Shows the current WhatsApp Web connection status in the agent dashboard.
 * If a QR code is available, it displays it inline so the agent can scan
 * without leaving the browser.
 *
 * States:
 *   initializing  → spinner
 *   qr_ready      → QR code image (scan with phone)
 *   authenticated → checkmark (saving session)
 *   ready         → green connected badge
 *   disconnected  → error with reload hint
 *   auth_failure  → error with re-scan hint
 *   mock          → grey "Mock mode" badge
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getWhatsAppStatus, getWhatsAppQr } from '../services/api';

const STATUS_CONFIG = {
  initializing:  { color: 'text-slate-400', dot: 'bg-slate-500 animate-pulse', label: 'Initializing…' },
  qr_ready:      { color: 'text-yellow-400', dot: 'bg-yellow-500 animate-pulse', label: 'Scan QR to connect' },
  authenticated: { color: 'text-blue-400',  dot: 'bg-blue-500 animate-pulse',  label: 'Saving session…' },
  ready:         { color: 'text-green-400', dot: 'bg-green-500',               label: 'Connected' },
  disconnected:  { color: 'text-red-400',   dot: 'bg-red-500',                 label: 'Disconnected' },
  auth_failure:  { color: 'text-red-400',   dot: 'bg-red-500',                 label: 'Auth failed' },
};

export default function WhatsAppPanel() {
  const [status, setStatus] = useState('initializing');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [isMock, setIsMock] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const poll = useCallback(async () => {
    try {
      const s = await getWhatsAppStatus();
      setStatus(s.status);
      setIsMock(s.mock);

      // Fetch QR code image if one is available
      if (s.hasQr) {
        try {
          const qrData = await getWhatsAppQr();
          setQrDataUrl(qrData.qr);
        } catch {
          setQrDataUrl(null);
        }
      } else {
        setQrDataUrl(null);
      }
    } catch {
      setStatus('disconnected');
    }
  }, []);

  // Poll every 3 seconds until ready, then every 15 seconds
  useEffect(() => {
    poll();
    const interval = setInterval(poll, status === 'ready' ? 15000 : 3000);
    return () => clearInterval(interval);
  }, [poll, status]);

  if (isMock) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full bg-slate-600" />
        WhatsApp: Mock mode
      </div>
    );
  }

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.initializing;

  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          <span className="text-sm font-medium text-slate-300">WhatsApp</span>
          <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
        </div>
        <span className="text-slate-500 text-xs">{collapsed ? '▲' : '▼'}</span>
      </button>

      {/* QR code */}
      {!collapsed && status === 'qr_ready' && qrDataUrl && (
        <div className="px-4 pb-4 flex flex-col items-center gap-3">
          <p className="text-xs text-slate-400 text-center">
            Open WhatsApp on your phone →{' '}
            <strong className="text-slate-300">Linked Devices → Link a Device</strong>
          </p>
          <img
            src={qrDataUrl}
            alt="WhatsApp QR Code"
            className="w-48 h-48 rounded-xl border-4 border-white shadow-lg"
          />
          <p className="text-xs text-slate-500">Session will be saved automatically</p>
        </div>
      )}

      {/* Connected info */}
      {!collapsed && status === 'ready' && (
        <div className="px-4 pb-4">
          <p className="text-xs text-green-400">
            ✓ WhatsApp is connected. Call invitations will be sent automatically.
          </p>
        </div>
      )}

      {/* Error info */}
      {!collapsed && (status === 'disconnected' || status === 'auth_failure') && (
        <div className="px-4 pb-4">
          <p className="text-xs text-red-400 mb-2">
            {status === 'auth_failure'
              ? 'Authentication failed. Restart the server to get a new QR code.'
              : 'WhatsApp disconnected. The server will attempt to reconnect.'}
          </p>
        </div>
      )}
    </div>
  );
}
