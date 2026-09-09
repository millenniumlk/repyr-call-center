import React from 'react';

const STATUS_CONFIG = {
  CREATED:              { label: 'Creating call\u2026',          color: 'bg-slate-500',  pulse: true },
  INVITATION_SENDING:   { label: 'Sending invitation\u2026',     color: 'bg-yellow-500', pulse: true },
  INVITATION_SENT:      { label: 'Invitation sent',         color: 'bg-blue-500',   pulse: false },
  INVITATION_FAILED:    { label: 'Invitation failed',       color: 'bg-orange-500', pulse: false },
  WAITING:              { label: 'Waiting for customer',    color: 'bg-blue-500',   pulse: true },
  CUSTOMER_OPENED:      { label: 'Customer opened call',    color: 'bg-cyan-500',   pulse: true },
  CUSTOMER_ANSWERING:   { label: 'Customer answering\u2026',     color: 'bg-indigo-500', pulse: true },
  CONNECTING:           { label: 'Connecting\u2026',             color: 'bg-violet-500', pulse: true },
  CONNECTED:            { label: 'Connected',               color: 'bg-green-500',  pulse: false },
  ENDED:                { label: 'Call ended',              color: 'bg-slate-500',  pulse: false },
  FAILED:               { label: 'Connection failed',       color: 'bg-red-500',    pulse: false },
  DECLINED:             { label: 'Customer declined',       color: 'bg-orange-500', pulse: false },
};

export default function CallStatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'bg-slate-500', pulse: false };

  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 text-sm font-medium text-slate-200">
      <span
        className={`w-2 h-2 rounded-full ${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''}`}
      />
      {cfg.label}
    </span>
  );
}
