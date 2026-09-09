import React from 'react';

/**
 * Repyr logo component.
 * Renders the wordmark with an optional icon variant.
 */
export default function RepyrLogo({ size = 'md', variant = 'full' }) {
  const sizes = {
    sm: { text: 'text-lg', icon: 32 },
    md: { text: 'text-2xl', icon: 40 },
    lg: { text: 'text-4xl', icon: 56 },
    xl: { text: 'text-5xl', icon: 72 },
  };

  const s = sizes[size] || sizes.md;

  return (
    <div className="flex items-center gap-2">
      {/* Logo icon — stylized R in a hexagon */}
      <div
        className="flex items-center justify-center rounded-lg bg-repyr-600 text-white font-black"
        style={{ width: s.icon, height: s.icon, fontSize: s.icon * 0.5 }}
      >
        R
      </div>

      {variant === 'full' && (
        <span className={`${s.text} font-bold tracking-tight text-white`}>
          Repyr
        </span>
      )}
    </div>
  );
}
